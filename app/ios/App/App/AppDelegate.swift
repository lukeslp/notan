import UIKit
import Capacitor
#if DEBUG
import WebKit
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // URL opens and universal links: UIKit delivers them to SceneDelegate under
    // the scene life cycle, so they are forwarded to Capacitor there.

}

// MARK: - NotanBridgeViewController
//
// The storyboard's root view controller. It only frames the sealed game:
// the web view takes the system background (white or black, as the game's
// own theme follows the system) so nothing flashes before the first paint,
// the page does not rubber-band, and the status bar stays out of the way of
// a board that runs edge to edge (the game pads itself with the safe areas).
class NotanBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        view.backgroundColor = .systemBackground
        guard let webView = webView else { return }
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        StoreShot.install(on: webView)
        #endif
    }

    override var prefersStatusBarHidden: Bool { true }
}

#if DEBUG
// MARK: - StoreShot (Debug builds only)
//
// `xcrun simctl launch <device> com.playnotan.app -NotanShot <scene>` opens the
// game on a fixed screen with no taps, for store screenshots on screens simctl
// cannot tap (the iPhone Duo's outer screen while folded). `scripts/capture-duo.sh`
// drives it. Scenes, matching the 6.9" iPhone set:
//   progress  Owl (level 35), top six rows filled, 0:30, light
//   solved    Fish (level 14) solved, 0:18, light
//   levels    the Levels sheet, levels 1-34 solved, dark
// The script writes the game's own save (`ink.v1`) just before the game first
// reads it, so the game opens the scene through its normal start-up; the payload
// in www/ is untouched. Release builds compile none of this.
enum StoreShot {
    static let scenes = ["progress", "solved", "levels"]

    static func install(on webView: WKWebView) {
        guard let scene = UserDefaults.standard.string(forKey: "NotanShot"), scenes.contains(scene) else { return }
        let source = script.replacingOccurrences(of: "__SCENE__", with: scene)
        webView.configuration.userContentController.addUserScript(
            WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        NSLog("NotanShot: %@", scene)
    }

    private static let script = """
    (function () {
      'use strict';
      var scene = '__SCENE__', KEY = 'ink.v1', theme = scene === 'levels' ? 'dark' : 'light';
      // index.html reads the theme from the save before the engine loads.
      try { localStorage.setItem(KEY, JSON.stringify({ theme: theme })); } catch (e) {}
      // Then notan.js reads the save once engine.js and levels.js are in.
      var get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) {
        if (k === KEY && window.InkEngine && window.InkLevels) {
          Storage.prototype.getItem = get;
          try { localStorage.setItem(KEY, JSON.stringify(seed())); } catch (e) { console.error('NotanShot', e); }
        }
        return get.apply(this, arguments);
      };
      function cells(id, rows) {
        var level = window.InkLevels.find(function (l) { return l.id === id; });
        var p = window.InkEngine.fromArt(level.art), out = '';
        for (var i = 0; i < p.sol.length; i++) out += Math.floor(i / p.w) < rows && p.sol[i] ? '1' : '0';
        return out;
      }
      function seed() {
        var solved = {};
        window.InkLevels.slice(0, 34).forEach(function (l, i) { solved[l.id] = 25 + 7 * i; });
        var s = { at: 'owl', solved: solved, boards: { owl: { c: cells('owl', 6), t: 30 } },
                  hinted: {}, seen: true, rampOrder: 2, theme: theme };
        if (scene === 'solved') { s.at = 'fish'; s.boards.fish = { c: cells('fish', 99), t: 18 }; }
        return s;
      }
      if (scene === 'levels') addEventListener('load', function () {
        setTimeout(function () { document.getElementById('lvl-btn').click(); }, 400);
      });
    })();
    """
}
#endif
