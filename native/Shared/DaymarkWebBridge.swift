import Foundation
import WebKit

final class DaymarkSchemeHandler: NSObject, WKURLSchemeHandler {
    let webRoot: URL
    let store: DaymarkStore
    private var activeTasks = Set<ObjectIdentifier>()
    init(webRoot: URL, store: DaymarkStore) { self.webRoot = webRoot; self.store = store }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        let identifier = ObjectIdentifier(urlSchemeTask)
        activeTasks.insert(identifier)
        store.perform({ [store, webRoot] in
            let data: Data
            if url.host == "attachment" {
                data = try store.attachmentData(url)
            } else if url.host == "app" {
                let relativePath = url.path == "/" ? "index.html" : String(url.path.dropFirst())
                let file = webRoot.appendingPathComponent(relativePath).standardizedFileURL
                guard file.path.hasPrefix(webRoot.standardizedFileURL.path + "/") else { throw CocoaError(.fileReadNoPermission) }
                data = try Data(contentsOf: file)
            } else { throw CocoaError(.fileReadNoPermission) }
            return data
        }, completion: { [weak self] result in
            guard self?.activeTasks.remove(identifier) != nil else { return }
            switch result {
            case .success(let data):
                let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": DaymarkStore.mimeType(url.pathExtension), "Content-Length": String(data.count), "Access-Control-Allow-Origin": "daymark://app", "Cache-Control": "no-cache"])!
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            case .failure(let error): urlSchemeTask.didFailWithError(error)
            }
        })
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        activeTasks.remove(ObjectIdentifier(urlSchemeTask))
    }
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
    private var pollPending = false
    private var flushCompletion: ((Result<Void, Error>) -> Void)?
    private var flushTimeout: DispatchWorkItem?
    private var flushRequestID: String?

    init(store: DaymarkStore) { self.store = store }
    deinit { timer?.invalidate() }

    func makeWebView(root: URL) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        if #available(macOS 14.0, iOS 17.0, *) { configuration.allowsInlinePredictions = false }
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
            case "load": ready = true; sendState(requestID: requestID)
            case "save":
                guard let state = body["state"] as? [String: Any] else { throw CocoaError(.coderInvalidValue) }
                save(state, requestID: requestID)
            case "chooseFolder": chooseFolder?(requestID)
            case "attach": attach?(requestID)
            case "export": export?(body["state"] as? [String: Any], requestID)
            case "openAttachment":
                let attachment = body["attachment"] as? [String: Any]
                let raw = attachment?["url"] as? String ?? body["url"] as? String ?? body["attachment"] as? String
                if let raw, let url = URL(string: raw) { openAttachment(url, requestID: requestID) }
            default: sendError("Unknown native action: \(action)", requestID: requestID)
            }
        } catch {
            sendError(error.localizedDescription, requestID: requestID)
            if action == "save", let flushRequestID, requestID as? String == flushRequestID { finishFlush(.failure(error)) }
        }
    }

    private static func normalizedStateData(_ state: [String: Any]) throws -> Data {
        var normalized = state
        for collection in DaymarkStore.collections {
            if let records = state[collection] as? [[String: Any]] {
                normalized[collection] = records.sorted { ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") }
            }
        }
        return try DaymarkStore.json(normalized)
    }

    private func save(_ state: [String: Any], requestID: Any?) {
        store.perform({ [store] in
            let merged = try store.save(state)
            let next = try merged.map { try Self.normalizedStateData($0) }
            return (merged, next, store.storageInfo, try Self.normalizedStateData(state) != next)
        }, completion: { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let (merged, next, storage, hasRemoteChanges)):
                self.signature = next
                self.send(["type": "saved", "storage": storage], requestID: requestID)
                if hasRemoteChanges, let merged {
                    self.send(["type": "state", "state": merged, "storage": storage])
                }
                if let flushRequestID = self.flushRequestID, requestID as? String == flushRequestID {
                    self.finishFlush(.success(()))
                }
            case .failure(let error):
                self.sendError(error.localizedDescription, requestID: requestID)
                if let flushRequestID = self.flushRequestID, requestID as? String == flushRequestID {
                    self.finishFlush(.failure(error))
                }
            }
        })
    }

    private func openAttachment(_ url: URL, requestID: Any? = nil) {
        store.perform({ [store] in store.attachmentURL(url) }, completion: { [weak self] result in
            switch result {
            case .success(let file):
                if let file { self?.openURL?(file) }
            case .failure(let error): self?.sendError(error.localizedDescription, requestID: requestID)
            }
        })
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

    func sendState(requestID: Any? = nil) {
        store.perform({ [store] in
            let state = try store.load()
            return (state, try state.map { try Self.normalizedStateData($0) }, store.storageInfo)
        }, completion: { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let (state, next, storage)):
                self.signature = next
                self.send(["type": "state", "state": state as Any? ?? NSNull(), "storage": storage], requestID: requestID)
            case .failure(let error): self.sendError(error.localizedDescription, requestID: requestID)
            }
        })
    }

    private func poll() {
        guard ready, !pollPending else { return }
        pollPending = true
        store.perform({ [store] in
            let current = try store.load()
            return (current, try current.map { try Self.normalizedStateData($0) }, store.storageInfo)
        }, completion: { [weak self] result in
            guard let self else { return }
            self.pollPending = false
            if case .success(let (current, next, storage)) = result, next != self.signature {
                self.signature = next
                self.send(["type": "state", "state": current as Any? ?? NSNull(), "storage": storage])
            }
            // A transient iCloud download or file-provider delay retries on the next poll.
        })
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "daymark", url.host == "app" { decisionHandler(.allow); return }
        if url.scheme == "daymark", url.host == "attachment" {
            // The scheme handler validates attachment paths on the storage queue.
            if navigationAction.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
            openAttachment(url)
        }
        else if ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") { openURL?(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") { openURL?(url) }
        return nil
    }
}
