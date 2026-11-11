// Ascent Widget — a small Mac panel that shows the Assistant's /widget page on
// the desktop, under every normal window. See README.md in this folder.
//
// Built by build.sh with the Command Line Tools' swiftc. No Xcode project.

import AppKit
import WebKit

// The app's address. Override for a test deploy with:
//   defaults write com.ascentbuildingco.widget baseURL https://…
let baseURL: URL = {
    let s = UserDefaults.standard.string(forKey: "baseURL") ?? "https://ascent-companion.vercel.app"
    return URL(string: s)!
}()
let widgetURL = baseURL.appendingPathComponent("widget")
let refreshSeconds: TimeInterval = 5 * 60

// Paths on the app's own host that may load INSIDE the panel: the widget and
// the sign-in flow. Anything else on the app opens in the default browser.
func staysInPanel(_ url: URL) -> Bool {
    guard url.host == baseURL.host else { return true } // Google sign-in pages
    let p = url.path
    return p == "/widget" || p.hasPrefix("/login") || p.hasPrefix("/api/auth")
}

// Desktop level: above the desktop icons, below every normal window.
let desktopLevel = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)

final class Controller: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var status: NSStatusItem!
    var urlWatch: NSKeyValueObservation?
    var onTopItem: NSMenuItem!

    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // keeps the sign-in between launches
        web = WKWebView(frame: .zero, configuration: config)
        // Google refuses sign-in from an embedded web view's own user agent.
        // Safari's lets the normal Google sign-in run.
        web.customUserAgent =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 380, height: 640),
            styleMask: [.titled, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.contentView = web
        window.minSize = NSSize(width: 300, height: 300)
        window.setFrameAutosaveName("AscentWidget")
        if !window.setFrameUsingName("AscentWidget"), let screen = NSScreen.main {
            let v = screen.visibleFrame
            window.setFrameOrigin(NSPoint(x: v.maxX - 400, y: v.maxY - 660))
        }
        applyLevel()
        window.orderFront(nil)

        // A Next.js link changes the address without a page load, so the
        // navigation delegate never sees it. Watch the address instead.
        urlWatch = web.observe(\.url, options: [.new]) { [weak self] w, _ in
            guard let self, let u = w.url, !staysInPanel(u) else { return }
            NSWorkspace.shared.open(u)
            self.load()
        }

        buildStatusItem()
        load()
        Timer.scheduledTimer(withTimeInterval: refreshSeconds, repeats: true) { [weak self] _ in
            // Never mid sign-in. load(), not reload(): after an outage the page
            // on screen is the offline note, and reload() would repeat that.
            guard let self, self.web.url?.path == "/widget" else { return }
            self.load()
        }
    }

    func load() { web.load(URLRequest(url: widgetURL)) }

    var keepOnTop: Bool {
        get { UserDefaults.standard.bool(forKey: "keepOnTop") }
        set { UserDefaults.standard.set(newValue, forKey: "keepOnTop") }
    }

    func applyLevel() { window.level = keepOnTop ? .floating : desktopLevel }

    func buildStatusItem() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(systemSymbolName: "mountain.2", accessibilityDescription: "Ascent")
        let m = NSMenu()
        m.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r").target = self
        m.addItem(withTitle: "Open Ascent Assistant", action: #selector(openApp), keyEquivalent: "o").target = self
        m.addItem(.separator())
        m.addItem(withTitle: "Show / Hide Widget", action: #selector(toggle), keyEquivalent: "").target = self
        onTopItem = m.addItem(withTitle: "Keep on Top", action: #selector(toggleOnTop), keyEquivalent: "")
        onTopItem.target = self
        onTopItem.state = keepOnTop ? .on : .off
        m.addItem(.separator())
        m.addItem(withTitle: "Quit Ascent Widget", action: #selector(quit), keyEquivalent: "q").target = self
        status.menu = m
    }

    @objc func reload() { load() }
    @objc func openApp() { NSWorkspace.shared.open(baseURL) }
    @objc func quit() { NSApp.terminate(nil) }
    @objc func toggle() {
        if window.isVisible { window.orderOut(nil) } else { window.orderFront(nil) }
    }
    @objc func toggleOnTop() {
        keepOnTop.toggle()
        onTopItem.state = keepOnTop ? .on : .off
        applyLevel()
    }

    // A real page load to anywhere outside the panel's paths: browser instead.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = action.request.url, action.targetFrame?.isMainFrame != false, !staysInPanel(u) {
            NSWorkspace.shared.open(u)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // window.open / target=_blank — the widget page sends every link here.
    func webView(_ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url { NSWorkspace.shared.open(u) }
        return nil
    }

    // Offline or the app is down: retry on the next refresh tick.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
        webView.loadHTMLString(
            "<body style='font:13px -apple-system;color:#999;background:#0A0A0A;padding:24px'>Ascent is unreachable. The widget retries every 5 minutes, or use Reload in the menu bar.</body>",
            baseURL: widgetURL)
    }
}

let app = NSApplication.shared
let controller = Controller()
app.delegate = controller
app.setActivationPolicy(.accessory) // menu bar item, no Dock icon
app.run()
