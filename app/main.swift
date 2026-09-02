import Cocoa
import WebKit

final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let resourceRoot: URL

    override init() {
        guard let resourceRoot = Bundle.main.resourceURL else {
            fatalError("앱 리소스 폴더를 찾을 수 없습니다.")
        }
        self.resourceRoot = resourceRoot.standardizedFileURL
        super.init()
    }

    func resourceURL(for url: URL) -> URL? {
        guard url.scheme == "luckydraw", url.host == "app" else { return nil }

        let relativePath = url.path == "/" ? "upload.html" : String(url.path.dropFirst())
        let fileURL = resourceRoot.appendingPathComponent(relativePath).standardizedFileURL
        let rootPath = resourceRoot.path.hasSuffix("/") ? resourceRoot.path : resourceRoot.path + "/"

        guard fileURL.path.hasPrefix(rootPath) else { return nil }
        return fileURL
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard
            let url = urlSchemeTask.request.url,
            let fileURL = resourceURL(for: url),
            let data = try? Data(contentsOf: fileURL)
        else {
            urlSchemeTask.didFailWithError(
                NSError(domain: "LuckyDraw", code: 404, userInfo: [NSLocalizedDescriptionKey: "리소스를 찾을 수 없습니다."])
            )
            return
        }

        let response = URLResponse(
            url: url,
            mimeType: mimeType(for: fileURL.pathExtension),
            expectedContentLength: data.count,
            textEncodingName: isTextFile(fileURL.pathExtension) ? "utf-8" : nil
        )
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func isTextFile(_ fileExtension: String) -> Bool {
        ["html", "js", "css", "svg", "json"].contains(fileExtension.lowercased())
    }

    private func mimeType(for fileExtension: String) -> String {
        switch fileExtension.lowercased() {
        case "html": return "text/html"
        case "js": return "text/javascript"
        case "css": return "text/css"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        default: return "application/octet-stream"
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let schemeHandler = BundleSchemeHandler()
    private let isSelfTesting = CommandLine.arguments.contains("--self-test")
    private var selfTestStep = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenu()

        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "luckydraw")
        configuration.websiteDataStore = .default()

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsMagnification = true

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "럭키드로우"
        window.minSize = NSSize(width: 880, height: 560)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.contentView = webView
        window.center()

        if isSelfTesting {
            window.alphaValue = 0
            window.orderFront(nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
                guard let self, self.selfTestStep < 2 else { return }
                self.writeSelfTestResult("SELF_TEST_FAILED: timed out while loading the app")
                NSApp.terminate(nil)
            }
        } else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }

        guard let startURL = URL(string: "luckydraw://app/upload.html") else {
            presentFatalError("시작 페이지 주소를 만들 수 없습니다.")
            return
        }
        webView.load(URLRequest(url: startURL))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if navigationAction.targetFrame == nil || url.pathExtension.lowercased() == "xlsx" {
            openOutsideApp(url)
            decisionHandler(.cancel)
            return
        }

        if url.scheme == "luckydraw" && url.host == "app" {
            decisionHandler(.allow)
        } else {
            openOutsideApp(url)
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            openOutsideApp(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard isSelfTesting, let currentURL = webView.url else { return }

        if selfTestStep == 0, currentURL.path.hasSuffix("upload.html") {
            selfTestStep = 1
            webView.evaluateJavaScript("typeof XLSX") { [weak self, weak webView] result, error in
                guard let self, let webView else { return }
                guard error == nil, ["object", "function"].contains(result as? String ?? "") else {
                    self.writeSelfTestResult("SELF_TEST_FAILED: bundled XLSX library did not load")
                    NSApp.terminate(nil)
                    return
                }

                webView.evaluateJavaScript(
                    "localStorage.setItem('luckydraw_numbers', JSON.stringify(['00012','00014'])); location.href='index.html';"
                )
            }
            return
        }

        if selfTestStep == 1, currentURL.path.hasSuffix("index.html") {
            selfTestStep = 2
            webView.evaluateJavaScript(
                "JSON.parse(localStorage.getItem('luckydraw_numbers') || '[]').join(',') + '|' + document.querySelectorAll('.digit-box').length + '|' + typeof confetti"
            ) { result, error in
                let value = result as? String
                if error == nil && value == "00012,00014|5|function" {
                    self.writeSelfTestResult("SELF_TEST_OK: offline resources, shared storage, and draw screen loaded")
                } else {
                    self.writeSelfTestResult("SELF_TEST_FAILED: \(error?.localizedDescription ?? value ?? "unknown error")")
                }

                webView.evaluateJavaScript("localStorage.removeItem('luckydraw_numbers')") { _, _ in
                    NSApp.terminate(nil)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    private func handleLoadFailure(_ error: Error) {
        if isSelfTesting {
            writeSelfTestResult("SELF_TEST_FAILED: \(error.localizedDescription)")
            NSApp.terminate(nil)
        } else {
            presentFatalError("페이지를 불러오지 못했습니다.\n\(error.localizedDescription)")
        }
    }

    private func openOutsideApp(_ url: URL) {
        if url.scheme == "luckydraw", let bundledURL = schemeHandler.resourceURL(for: url) {
            NSWorkspace.shared.open(bundledURL)
        } else if ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") {
            NSWorkspace.shared.open(url)
        }
    }

    private func presentFatalError(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "럭키드로우 실행 오류"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func writeSelfTestResult(_ message: String) {
        guard let data = (message + "\n").data(using: .utf8) else { return }
        FileHandle.standardOutput.write(data)
    }

    private func configureMenu() {
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)

        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "럭키드로우 정보", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "럭키드로우 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu

        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "보기")
        viewMenu.addItem(withTitle: "전체 화면 시작", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        viewMenu.items.last?.keyEquivalentModifierMask = [.control, .command]
        viewMenuItem.submenu = viewMenu

        NSApp.mainMenu = mainMenu
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
