import Foundation
import WebKit

final class DaymarkSchemeHandler: NSObject, WKURLSchemeHandler {
    let webRoot: URL
    let store: DaymarkStore
    init(webRoot: URL, store: DaymarkStore) { self.webRoot = webRoot; self.store = store }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        do {
            let data: Data
            if url.host == "attachment" {
                data = try store.attachmentData(url)
            } else if url.host == "app" {
                let relativePath = url.path == "/" ? "index.html" : String(url.path.dropFirst())
                let file = webRoot.appendingPathComponent(relativePath).standardizedFileURL
                guard file.path.hasPrefix(webRoot.standardizedFileURL.path + "/") else { throw CocoaError(.fileReadNoPermission) }
                data = try Data(contentsOf: file)
            } else { throw CocoaError(.fileReadNoPermission) }
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": DaymarkStore.mimeType(url.pathExtension), "Content-Length": String(data.count), "Access-Control-Allow-Origin": "daymark://app", "Cache-Control": "no-cache"])!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

final class DaymarkWebBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let store: DaymarkStore
    weak var webView: WKWebView?
    var chooseFolder: ((Any?) -> Void)?
    var attach: ((Any?) -> Void)?
    var export: (([String: Any]?, Any?) -> Void)?
    var openURL: ((URL) -> Void)?
    private var timer: Timer?
    private var signature: Data?
    private var ready = false
    private var flushCompletion: ((Result<Void, Error>) -> Void)?
    private var flushTimeout: DispatchWorkItem?
    private var flushRequestID: String?

    init(store: DaymarkStore) { self.store = store }
    deinit { timer?.invalidate() }

    func makeWebView(root: URL) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(DaymarkSchemeHandler(webRoot: root, store: store), forURLScheme: "daymark")
        configuration.userContentController.add(self, name: "daymark")
        // Early feature detection works before the application mounts.
        let script = "window.__DAYMARK_NATIVE__ = true; window.__DAYMARK_PLATFORM__ = '\(Self.platform)';"
        configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        webView = view
        view.load(URLRequest(url: URL(string: "daymark://app/index.html")!))
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.poll() }
        return view
    }

    static var platform: String {
        #if os(macOS)
        return "macos"
        #else
        return "ios"
        #endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.host == "app", let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        let requestID = body["requestId"]
        do {
            switch action {
            case "load": ready = true; try sendState(requestID: requestID)
            case "save":
                guard let state = body["state"] as? [String: Any] else { throw CocoaError(.coderInvalidValue) }
                let merged = try store.save(state)
                signature = try merged.map { try DaymarkStore.json($0) }
                send(["type": "saved", "storage": store.storageInfo], requestID: requestID)
                if let merged, try normalizedStateData(merged) != normalizedStateData(state) {
                    send(["type": "state", "state": merged, "storage": store.storageInfo], requestID: nil)
                }
                if let flushRequestID, requestID as? String == flushRequestID { finishFlush(.success(())) }
            case "chooseFolder": chooseFolder?(requestID)
            case "attach": attach?(requestID)
            case "export": export?(body["state"] as? [String: Any], requestID)
            case "openAttachment":
                let attachment = body["attachment"] as? [String: Any]
                let raw = attachment?["url"] as? String ?? body["url"] as? String ?? body["attachment"] as? String
                if let raw, let url = URL(string: raw), let file = store.attachmentURL(url) { openURL?(file) }
            default: sendError("Unknown native action: \(action)", requestID: requestID)
            }
        } catch {
            sendError(error.localizedDescription, requestID: requestID)
            if action == "save", let flushRequestID, requestID as? String == flushRequestID { finishFlush(.failure(error)) }
        }
    }

    private func normalizedStateData(_ state: [String: Any]) throws -> Data {
        var normalized = state
        for collection in DaymarkStore.collections {
            if let records = state[collection] as? [[String: Any]] {
                normalized[collection] = records.sorted { ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") }
            }
        }
        return try DaymarkStore.json(normalized)
    }

    /// Closing waits for the web editor's freshest state to finish a coordinated save.
    func flush(completion: @escaping (Result<Void, Error>) -> Void) {
        guard ready, let webView else { completion(.success(())); return }
        guard flushCompletion == nil else { return }
        flushCompletion = completion
        let requestID = "native-flush-" + UUID().uuidString
        flushRequestID = requestID
        let timeout = DispatchWorkItem { [weak self] in
            let error = NSError(domain: "DaymarkStorage", code: 2, userInfo: [NSLocalizedDescriptionKey: "The editor did not confirm that your latest changes were saved. Please keep Daymark open and try again."])
            self?.finishFlush(.failure(error))
        }
        flushTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: timeout)
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('daymark-flush', { detail: { requestId: '\(requestID)' } }));") { [weak self] _, error in
            if let error { self?.finishFlush(.failure(error)) }
        }
    }

    private func finishFlush(_ result: Result<Void, Error>) {
        guard let completion = flushCompletion else { return }
        flushTimeout?.cancel()
        flushTimeout = nil
        flushRequestID = nil
        flushCompletion = nil
        completion(result)
    }

    func send(_ value: [String: Any], requestID: Any? = nil) {
        var payload = value
        if let requestID { payload["requestId"] = requestID }
        guard let data = try? DaymarkStore.json(payload), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.daymarkNativeReceive && window.daymarkNativeReceive(\(json));", completionHandler: nil)
    }

    func sendError(_ message: String, requestID: Any? = nil) { send(["type": "error", "message": message], requestID: requestID) }

    func sendState(requestID: Any? = nil) throws {
        let state = try store.load()
        signature = try state.map { try DaymarkStore.json($0) }
        send(["type": "state", "state": state as Any? ?? NSNull(), "storage": store.storageInfo], requestID: requestID)
    }

    private func poll() {
        guard ready else { return }
        do {
            let current = try store.load()
            let next = try current.map { try DaymarkStore.json($0) }
            if next != signature {
                signature = next
                send(["type": "state", "state": current as Any? ?? NSNull(), "storage": store.storageInfo])
            }
        } catch { /* A transient iCloud download or file-provider delay retries on the next poll. */ }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "daymark", url.host == "app" { decisionHandler(.allow); return }
        if url.scheme == "daymark", url.host == "attachment", let file = store.attachmentURL(url) {
            if navigationAction.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
            openURL?(file)
        }
        else if ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") { openURL?(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") { openURL?(url) }
        return nil
    }
}
