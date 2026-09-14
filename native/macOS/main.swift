import AppKit
import WebKit
import UniformTypeIdentifiers

/// The only extra drag target is the unused space above sidebar search. Keeping
/// it narrow leaves task controls and the editor interactive up to the top edge.
private final class SidebarWindowDragView: NSView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        guard let window, !window.styleMask.contains(.fullScreen) else { return }
        if event.clickCount == 2 {
            window.performZoom(nil)
        } else {
            window.performDrag(with: event)
        }
    }
}

final class DaymarkAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var bridge: DaymarkWebBridge!
    private var terminationPending = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let store = try DaymarkStore()
            bridge = DaymarkWebBridge(store: store)
            guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileNoSuchFile) }
            let webView = bridge.makeWebView(root: resources.appendingPathComponent("Web"))
            webView.setValue(false, forKey: "drawsBackground")
            window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1420, height: 920), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.title = "GreenDay"
            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            window.titlebarSeparatorStyle = .none
            window.isMovableByWindowBackground = false
            window.backgroundColor = NSColor(calibratedRed: 243 / 255, green: 244 / 255, blue: 246 / 255, alpha: 1)
            window.minSize = NSSize(width: 860, height: 620)
            installContent(webView)
            window.initialFirstResponder = webView
            window.delegate = self
            window.setFrameAutosaveName("DaymarkMainWindow")
            if !window.setFrameUsingName("DaymarkMainWindow") { window.center() }
            buildMenus()
            bridge.chooseFolder = { [weak self] requestID in self?.chooseFolder(requestID) }
            bridge.attach = { [weak self] requestID in self?.attach(requestID) }
            bridge.export = { [weak self] state, requestID in self?.export(state, requestID: requestID) }
            bridge.openURL = { url in NSWorkspace.shared.open(url) }
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = "GreenDay could not open its data folder"
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    private func installContent(_ webView: WKWebView) {
        let content = NSView()
        window.contentView = content
        webView.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(webView)

        let dragView = SidebarWindowDragView()
        dragView.translatesAutoresizingMaskIntoConstraints = false
        dragView.setAccessibilityElement(false)
        content.addSubview(dragView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            dragView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            dragView.topAnchor.constraint(equalTo: content.topAnchor),
            // Match the native sidebar's 44-point top reserve and keep inside
            // its minimum width. AppKit's traffic lights remain above this view.
            dragView.widthAnchor.constraint(equalToConstant: 184),
            dragView.heightAnchor.constraint(equalToConstant: 44),
        ])
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.terminate(nil)
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard bridge != nil else { return .terminateNow }
        if terminationPending { return .terminateLater }
        terminationPending = true
        // AppKit must receive terminateLater before the eventual reply, including
        // when the web editor is not loaded and there is nothing to flush.
        DispatchQueue.main.async { [weak self] in
            guard let self else { sender.reply(toApplicationShouldTerminate: true); return }
            self.bridge.flush { [weak self] result in
                guard let self else { sender.reply(toApplicationShouldTerminate: true); return }
                switch result {
                case .success:
                    sender.reply(toApplicationShouldTerminate: true)
                case .failure(let error):
                    self.terminationPending = false
                    let alert = NSAlert()
                    alert.messageText = "Your latest changes could not be saved"
                    alert.informativeText = error.localizedDescription
                    alert.alertStyle = .warning
                    alert.addButton(withTitle: "Keep GreenDay Open")
                    alert.addButton(withTitle: "Quit Anyway")
                    alert.beginSheetModal(for: self.window) { response in
                        sender.reply(toApplicationShouldTerminate: response == .alertSecondButtonReturn)
                    }
                }
            }
        }
        return .terminateLater
    }

    private func buildMenus() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About GreenDay", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide GreenDay", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit GreenDay", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let fileItem = NSMenuItem()
        menu.addItem(fileItem)
        let fileMenu = NSMenu(title: "File")
        fileItem.submenu = fileMenu
        let newTask = fileMenu.addItem(withTitle: "New Task", action: #selector(newTaskAction), keyEquivalent: "n")
        newTask.target = self
        let choose = fileMenu.addItem(withTitle: "Choose Sync Folder…", action: #selector(chooseFolderAction), keyEquivalent: "")
        choose.target = self
        let exportItem = fileMenu.addItem(withTitle: "Export All Tasks…", action: #selector(exportAction), keyEquivalent: "")
        exportItem.target = self

        let editItem = NSMenuItem()
        menu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editItem.submenu = editMenu
        for (name, selector, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: name, action: Selector(selector), keyEquivalent: key)
        }

        let windowItem = NSMenuItem()
        menu.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = menu
    }

    @objc private func newTaskAction() {
        bridge.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('daymark-new-task'));", completionHandler: nil)
    }

    @objc private func chooseFolderAction() { chooseFolder(nil) }
    @objc private func exportAction() { export(nil, requestID: nil) }

    private func chooseFolder(_ requestID: Any?) {
        let panel = NSOpenPanel()
        panel.title = "Choose GreenDay’s sync folder"
        panel.message = "Choose your existing workspace folder in iCloud Drive, including a folder named Daymark. Use the same folder on iPhone. Existing tasks are copied into it."
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Use Folder"
        bridge.store.perform({ self.bridge.store.folder }) { [weak self] result in
            guard let self else { return }
            if case .success(let folder) = result { panel.directoryURL = folder }
            panel.beginSheetModal(for: self.window) { [weak self] response in
                guard let self else { return }
                guard response == .OK, let url = panel.url else { self.bridge.send(["type": "cancelled"], requestID: requestID); return }
                self.bridge.store.perform({ try self.bridge.store.chooseFolder(url) }) { result in
                    switch result {
                    case .success: self.bridge.sendState(requestID: requestID)
                    case .failure(let error): self.bridge.sendError(error.localizedDescription, requestID: requestID)
                    }
                }
            }
        }
    }

    private func attach(_ requestID: Any?) {
        let panel = NSOpenPanel()
        panel.title = "Attach an image or PDF"
        panel.allowedContentTypes = [.image, .pdf]
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            guard response == .OK, let url = panel.url else { self.bridge.send(["type": "cancelled"], requestID: requestID); return }
            self.bridge.store.perform({ try self.bridge.store.addAttachment(url) }) { result in
                switch result {
                case .success(let attachment): self.bridge.send(["type": "attachment", "attachment": attachment], requestID: requestID)
                case .failure(let error): self.bridge.sendError(error.localizedDescription, requestID: requestID)
                }
            }
        }
    }

    private func export(_ state: [String: Any]?, requestID: Any?) {
        let panel = NSSavePanel()
        panel.title = "Export GreenDay tasks"
        panel.nameFieldStringValue = "GreenDay-export.json"
        panel.allowedContentTypes = [.json]
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self else { return }
            guard response == .OK, let url = panel.url else { self.bridge.send(["type": "cancelled"], requestID: requestID); return }
            self.bridge.store.perform({
                let value = try state ?? self.bridge.store.load() ?? ["schemaVersion": 1, "tasks": [], "projects": [], "columns": []]
                let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
                try data.write(to: url, options: .atomic)
            }) { result in
                switch result {
                case .success: self.bridge.send(["type": "exported", "path": url.path], requestID: requestID)
                case .failure(let error): self.bridge.sendError(error.localizedDescription, requestID: requestID)
                }
            }
        }
    }
}

let application = NSApplication.shared
let delegate = DaymarkAppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.appearance = NSAppearance(named: .aqua)
application.run()
