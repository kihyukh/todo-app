import SwiftUI
import UIKit
import UniformTypeIdentifiers
import QuickLook
import WebKit

@main
struct DaymarkApp: App {
    var body: some Scene {
        WindowGroup {
            DaymarkView().preferredColorScheme(.light)
        }
    }
}

struct DaymarkView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> DaymarkViewController { DaymarkViewController() }
    func updateUIViewController(_ uiViewController: DaymarkViewController, context: Context) {}
}

final class DaymarkViewController: UIViewController, UIDocumentPickerDelegate, QLPreviewControllerDataSource {
    private var bridge: DaymarkWebBridge!
    private var pickerAction = ""
    private var pendingRequestID: Any?
    private var previewURL: URL?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    deinit { NotificationCenter.default.removeObserver(self) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.965, green: 0.965, blue: 0.957, alpha: 1)
        do {
            let store = try DaymarkStore()
            bridge = DaymarkWebBridge(store: store)
            guard let root = Bundle.main.resourceURL?.appendingPathComponent("Web") else { throw CocoaError(.fileNoSuchFile) }
            let web = bridge.makeWebView(root: root)
            web.isOpaque = false
            web.backgroundColor = view.backgroundColor
            web.scrollView.contentInsetAdjustmentBehavior = .never
            web.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(web)
            NSLayoutConstraint.activate([
                web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
            ])
            bridge.chooseFolder = { [weak self] requestID in self?.showPicker(action: "chooseFolder", requestID: requestID) }
            bridge.attach = { [weak self] requestID in self?.showPicker(action: "attach", requestID: requestID) }
            bridge.export = { [weak self] state, requestID in self?.export(state, requestID: requestID) }
            bridge.openURL = { [weak self] url in
                if url.isFileURL {
                    self?.previewURL = url
                    let preview = QLPreviewController()
                    preview.dataSource = self
                    self?.present(preview, animated: true)
                } else { UIApplication.shared.open(url) }
            }
            NotificationCenter.default.addObserver(self, selector: #selector(flushBeforeBackground), name: UIApplication.willResignActiveNotification, object: nil)
        } catch {
            let label = UILabel()
            label.text = "Daymark could not open its data folder.\n\(error.localizedDescription)"
            label.numberOfLines = 0
            label.frame = view.bounds.insetBy(dx: 24, dy: 80)
            label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.addSubview(label)
        }
    }

    @objc private func flushBeforeBackground() {
        guard bridge != nil, backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Save Daymark") { [weak self] in self?.endBackgroundSave() }
        bridge.flush { [weak self] _ in self?.endBackgroundSave() }
    }

    private func endBackgroundSave() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    private func showPicker(action: String, requestID: Any?) {
        pickerAction = action
        pendingRequestID = requestID
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: action == "chooseFolder" ? [.folder] : [.image, .pdf], asCopy: false)
        picker.allowsMultipleSelection = false
        picker.delegate = self
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        do {
            switch pickerAction {
            case "chooseFolder": try bridge.store.chooseFolder(url); try bridge.sendState(requestID: pendingRequestID)
            case "attach": bridge.send(["type": "attachment", "attachment": try bridge.store.addAttachment(url)], requestID: pendingRequestID)
            case "export": bridge.send(["type": "exported", "path": url.path], requestID: pendingRequestID)
            default: break
            }
        } catch { bridge.sendError(error.localizedDescription, requestID: pendingRequestID) }
        pendingRequestID = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        bridge.send(["type": "cancelled"], requestID: pendingRequestID)
        pendingRequestID = nil
    }

    private func export(_ state: [String: Any]?, requestID: Any?) {
        do {
            let value = try state ?? bridge.store.load() ?? ["schemaVersion": 1, "tasks": [], "projects": [], "columns": []]
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("Daymark-export.json")
            try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
            pickerAction = "export"
            pendingRequestID = requestID
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            present(picker, animated: true)
        } catch { bridge.sendError(error.localizedDescription, requestID: requestID) }
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewURL == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { previewURL! as NSURL }
}
