# Notan (iOS + Android)

Native Capacitor shell for **Notan**, the black-and-white nonogram at
<https://playnotan.com/>. The game is the plain HTML/CSS/JS at the root of
this repository (synced from `notan/` in lukeslp/game-riffs); this folder
wraps it for iPhone, iPad and Android as a sealed offline payload. It follows
Hexsweeper's native shell (`app/` in lukeslp/hexsweeper) folder for folder.

The app opens straight onto the board, exactly like the web game: level 1 on
a first launch, otherwise wherever the saved game left off. Nothing opens by
itself. How to play, Levels and Settings are the game's own sheets.

## Before the next sync from game-riffs

`tools/publish-notan-source.sh` in game-riffs copies `notan/` here with
`rsync -a --delete` and then `git add -A`. Its exclude list does not name
`app/`, so **the next sync would delete this folder and commit the
deletion**. Add one exclude before running it again:

```diff
-rsync -a --delete --exclude README.md --exclude LICENSE --exclude .gitignore --exclude .git --exclude node_modules --exclude /primitives notan/ "$dest/"
+rsync -a --delete --exclude README.md --exclude LICENSE --exclude .gitignore --exclude .git --exclude node_modules --exclude /primitives --exclude /app notan/ "$dest/"
```

## Decisions for the owner

| Decision | Proposed | Why |
|---|---|---|
| iOS bundle id and Android application id | **`com.playnotan.app`** (one id for both, as Hexsweeper shares one) | Reverse of the game's own domain, playnotan.com, the pattern of Luke's other domain-named apps (`com.naqbu.app`, `com.diachronica.app`). Hexsweeper's own id, `app.hexodus.ios`, is inherited from an abandoned app and is not a pattern to copy. **Permanent after the first upload to either store.** Change it in `capacitor.config.js`, `android/app/build.gradle` (`namespace`, `applicationId`, plus the Java package folder) and `PRODUCT_BUNDLE_IDENTIFIER` in the Xcode project before any upload if you want another |
| App Store name | `Notan` (fallback `Notan Nonogram`) | The App Store requires a unique name; `Notan` may be taken. The home-screen name stays `Notan` either way (`CFBundleDisplayName`) |
| Google Play title | `Notan: Nonogram` | Play titles need not be unique; the suffix helps search |
| Android backup | Off | Matches Hexsweeper 1.0.10. Progress is one small `ink.v1` value; carrying it to a new phone would need Hexsweeper's `TravelingData` approach. A follow-up, not a blocker |
| Version | 1.0.0, build 1 / versionCode 1 | Fresh records on both stores |

## The names

| Thing | Value |
|---|---|
| Product / display name | **Notan** |
| Repository | `lukeslp/notan`, this folder (`app/`) |
| Game source | the repository root, synced from game-riffs `notan/` |
| iOS bundle id / Android application id | `com.playnotan.app` (proposed, see above) |
| Apple team | `596T7J7FB6` (Hexsweeper's), automatic signing |
| App Store Connect record | not created yet |

## Layout

| Path | Role |
|---|---|
| `www/` | The game. Generated: **do not hand-edit** |
| `WWW_SOURCE.txt` | Which commit `www/` came from, plus per-file checksums |
| `scripts/export-www.py` | The only writer of `www/`; lists its three deliberate changes |
| `capacitor.config.js` | Capacitor config (`.js`, not `.ts`, as in Hexsweeper) |
| `ios/` | Xcode project, automatic signing, `PrivacyInfo.xcprivacy` |
| `android/` | Capacitor Android project, API 24–36, no permissions |
| `scripts/smoke.sh` | Payload integrity, offline posture, both `cap sync`s |
| `scripts/android-build.sh` | JDK 21 Gradle wrapper for APK/AAB builds and unit tests |
| `scripts/generate-icons.sh` | App icons rendered from `../favicon.svg` |
| `app-store/` | Store copy, screenshots, icons, privacy answers, privacy policy draft |
| `docs/` | Release steps and device checks |
| `licenses/`, `THIRD-PARTY-NOTICES.md` | Notices for bundled third-party material |

### What `export-www.py` changes

The payload is the files listed in the game's `runtime.json`, unchanged
except for three edits, each asserted so a moved target fails the export:

1. The GoatCounter `<script>` is removed. The app sends nothing.
2. A Content-Security-Policy `<meta>` limits fetches, sockets, scripts,
   styles, fonts and images to the bundled files. The Access frame reads it
   and hides its camera and eye-tracker rows, which need WebAssembly or a
   socket to 127.0.0.1 and could not work in the app anyway.
3. Quick play's **Share blank** link points at `https://playnotan.com/`
   instead of the WebView's own origin, which nobody else could open.

These are better made in the game source eventually (a `native` flag the
page reads), as Hexsweeper's exporter does in its own source. Until then
they live here so game-riffs stays untouched.

### Native behavior

- **Safe areas.** The game pads itself with `env(safe-area-inset-*)` under
  `viewport-fit=cover`. iOS hides the status bar and lets the page run edge
  to edge. Android runs immersive (bars hidden, swipe to show) and wraps the
  WebView in Hexsweeper's `GameViewport`, which keeps the page clear of
  camera cutouts; the strip it leaves is painted the page's color, reported
  by a small script the shell injects (the page itself is untouched).
- **Theme.** The game follows the system light or dark setting unless the
  player picks one in Settings. Android's theme is DayNight so the WebView
  reports `prefers-color-scheme` correctly; launch screens use the page
  color (white or black) so nothing flashes.
- **System Back** (Android) closes the topmost open sheet, then leaves.
- **Saves** are the game's own `localStorage` key `ink.v1`. They survive a
  relaunch on both platforms. On Android a move made less than about a
  second before a force-stop can be lost (the WebView commits storage in
  batches); iOS kept even an immediate kill. See `docs/DEVICE_VERIFY.md`.
- **Display size change** (Android) reloads the page once so it lays out
  for the new density; the save makes that invisible.
- **Links** open in the system browser.

## Updating the game

```bash
# after game-riffs has synced a new notan/ into the repository root
cd app
python3 scripts/export-www.py          # rewrites www/ and WWW_SOURCE.txt
scripts/smoke.sh --with-source ..      # or ~/workspace/game-riffs/notan
```

`export-www.py` refuses to run when the game files have uncommitted
changes, so `WWW_SOURCE.txt` always names a real commit.

## Verify

```bash
pnpm install
pnpm smoke                                   # integrity, offline, cap sync
scripts/smoke.sh --with-source ~/workspace/game-riffs/notan
pnpm android:build:debug                     # android/app/build/outputs/apk/debug/app-debug.apk
scripts/android-build.sh test                # JVM unit tests (viewport bounds, backdrop color)
pnpm android:bundle:release                  # release AAB, unsigned unless NOTAN_ANDROID_* are set
pnpm cap:open:ios                            # Xcode
```

Capacitor 8 needs Node 22+, an Android SDK with API 36 and JDK 21 (the
wrapper finds Homebrew's keg-only `openjdk@21`). iOS builds need Xcode 26 or
later. Release steps are in [docs/RELEASE.md](docs/RELEASE.md).

## License

MIT; see [LICENSE](LICENSE). The payload bundles IBM Plex Sans and IBM Plex
Mono under the SIL Open Font License 1.1; see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
