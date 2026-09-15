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
    private enum PickerAction { case folder, attachment, export }
    private var bridge: DaymarkWebBridge?
    private var pickerAction: PickerAction?
    private var pendingRequestID: Any?
    private var exportURL: URL?
    private var previewURL: URL?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var saveInFlight = false
    private var flushRunning = false
    private var flushQueue: [(Result<Void, Error>) -> Void] = []
    private var pendingSaveError: String?
    private var displayName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "GreenDay"
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        loadWorkspace()
        NotificationCenter.default.addObserver(self, selector: #selector(flushBeforeBackground), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(refreshAfterForeground), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    private func loadWorkspace() {
        do {
            let store = try DaymarkStore()
            let bridge = DaymarkWebBridge(store: store)
            self.bridge = bridge
            guard let root = Bundle.main.resourceURL?.appendingPathComponent("Web"),
                  FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else { throw CocoaError(.fileNoSuchFile) }
            let web = bridge.makeWebView(root: root)
            web.isOpaque = false
            web.backgroundColor = .white
            web.scrollView.backgroundColor = .white
            web.scrollView.contentInsetAdjustmentBehavior = .never
            web.scrollView.keyboardDismissMode = .interactive
            web.allowsBackForwardNavigationGestures = false
            web.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(web)
            // Resize the note viewport above both the software keyboard and home
            // indicator. A floating iPad keyboard leaves the full layout available.
            view.keyboardLayoutGuide.followsUndockedKeyboard = false
            NSLayoutConstraint.activate([
                web.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
                web.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
                web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                web.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
            ])
            bridge.chooseFolder = { [weak self] requestID in self?.showPicker(action: .folder, requestID: requestID) }
            bridge.attach = { [weak self] requestID in self?.showPicker(action: .attachment, requestID: requestID) }
            bridge.export = { [weak self] state, requestID in self?.export(state, requestID: requestID) }
            bridge.openURL = { [weak self] url in self?.open(url) }
        } catch {
            bridge = nil
            let label = UILabel()
            label.text = "\(displayName) could not open its data folder.\n\n\(error.localizedDescription)"
            label.font = .preferredFont(forTextStyle: .body)
            label.adjustsFontForContentSizeCategory = true
            label.numberOfLines = 0
            label.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(label)
            NSLayoutConstraint.activate([
                label.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
                label.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
                label.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor)
            ])
        }
    }

    @objc private func flushBeforeBackground() {
        guard bridge != nil, !saveInFlight else { return }
        saveInFlight = true
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Save notes") { [weak self] in
            self?.endBackgroundSave()
        }
        flushLatest { [weak self] result in
            guard let self else { return }
            if case .failure(let error) = result { self.pendingSaveError = error.localizedDescription }
            self.saveInFlight = false
            self.endBackgroundSave()
        }
    }

    // The bridge accepts one flush at a time. Serialize overlapping background,
    // folder-switch, and export requests, taking a fresh editor snapshot for each batch.
    private func flushLatest(_ completion: @escaping (Result<Void, Error>) -> Void) {
        guard bridge != nil else { completion(.success(())); return }
        flushQueue.append(completion)
        drainFlushQueue()
    }

    private func drainFlushQueue() {
        guard !flushRunning, !flushQueue.isEmpty, let bridge else { return }
        flushRunning = true
        let completions = flushQueue
        flushQueue.removeAll()
        bridge.flush { [weak self] result in
            guard let self else { return }
            self.flushRunning = false
            completions.forEach { $0(result) }
            self.drainFlushQueue()
        }
    }

    private func endBackgroundSave() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    @objc private func refreshAfterForeground() {
        guard let bridge else { return }
        bridge.sendState()
        if let message = pendingSaveError {
            pendingSaveError = nil
            bridge.sendError(message)
        }
    }

    override var keyCommands: [UIKeyCommand]? {
        [UIKeyCommand(title: "Save notes", action: #selector(saveFromKeyboard), input: "s", modifierFlags: .command)]
    }

    @objc private func saveFromKeyboard() {
        flushLatest { [weak self] result in
            if case .failure(let error) = result { self?.bridge?.sendError(error.localizedDescription) }
        }
    }

    private func showPicker(action: PickerAction, requestID: Any?) {
        guard presentedViewController == nil, pickerAction == nil else {
            bridge?.sendError("Finish the open file picker first.", requestID: requestID)
            return
        }
        view.endEditing(true)
        pickerAction = action
        pendingRequestID = requestID
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: action == .folder ? [.folder] : [.item], asCopy: false)
        picker.allowsMultipleSelection = false
        picker.delegate = self
        picker.shouldShowFileExtensions = true
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let bridge, let action = pickerAction else { clearPicker(); return }
        let requestID = pendingRequestID
        guard let url = urls.first else {
            bridge.send(["type": "cancelled"], requestID: requestID)
            clearPicker()
            return
        }
        // Keep folder switching reserved until its asynchronous merge finishes.
        // Previewing an old attachment while its security scope closes is unsafe.
        if action != .folder { clearPicker() }
        let store = bridge.store
        switch action {
        case .folder:
            // Commit the editor's latest draft to the old folder before merging
            // into a user-selected iCloud Drive folder shared with the Mac app.
            flushLatest { [weak self] result in
                guard let self else { return }
                if case .failure(let error) = result {
                    self.clearPicker()
                    self.bridge?.sendError(error.localizedDescription, requestID: requestID)
                    return
                }
                store.perform({ try store.chooseFolder(url) }) { [weak self] result in
                    self?.clearPicker()
                    switch result {
                    case .success: self?.bridge?.sendState(requestID: requestID)
                    case .failure(let error): self?.bridge?.sendError(error.localizedDescription, requestID: requestID)
                    }
                }
            }
        case .attachment:
            store.perform({ try store.addAttachment(url) }) { [weak self] result in
                switch result {
                case .success(let attachment): self?.bridge?.send(["type": "attachment", "attachment": attachment], requestID: requestID)
                case .failure(let error): self?.bridge?.sendError(error.localizedDescription, requestID: requestID)
                }
            }
        case .export:
            bridge.send(["type": "exported", "path": url.path], requestID: requestID)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        bridge?.send(["type": "cancelled"], requestID: pendingRequestID)
        clearPicker()
    }

    private func clearPicker() {
        pickerAction = nil
        pendingRequestID = nil
        if let exportURL { try? FileManager.default.removeItem(at: exportURL.deletingLastPathComponent()) }
        exportURL = nil
    }

    private func export(_ fallback: [String: Any]?, requestID: Any?) {
        guard let bridge, presentedViewController == nil, pickerAction == nil else {
            bridge?.sendError("Finish the open file picker first.", requestID: requestID)
            return
        }
        view.endEditing(true)
        pickerAction = .export
        pendingRequestID = requestID
        let store = bridge.store
        let name = displayName
        flushLatest { [weak self] result in
            guard let self else { return }
            if case .failure(let error) = result {
                self.clearPicker()
                self.bridge?.sendError(error.localizedDescription, requestID: requestID)
                return
            }
            store.perform({
                let value = try store.load() ?? fallback ?? ["schemaVersion": 1, "tasks": [], "projects": [], "columns": [], "tags": []]
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let url = directory.appendingPathComponent(name + "-export.json")
                try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
                return url
            }) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let url):
                    self.pickerAction = .export
                    self.pendingRequestID = requestID
                    self.exportURL = url
                    let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
                    picker.delegate = self
                    self.present(picker, animated: true)
                case .failure(let error):
                    self.clearPicker()
                    self.bridge?.sendError(error.localizedDescription, requestID: requestID)
                }
            }
        }
    }

    private func open(_ url: URL) {
        guard pickerAction == nil, presentedViewController == nil else { return }
        if !url.isFileURL { UIApplication.shared.open(url); return }
        guard QLPreviewController.canPreview(url as NSURL) else {
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = view
            share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            present(share, animated: true)
            return
        }
        previewURL = url
        let preview = QLPreviewController()
        preview.dataSource = self
        present(preview, animated: true)
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewURL == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { previewURL! as NSURL }
}
