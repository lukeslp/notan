# Release

Nothing here has been signed, uploaded or published. Every step below is the
owner's. App sessions on napoleon cannot read the login keychain, so the
signing steps have to run from Luke's own Terminal (or Xcode).

## Identity

| Thing | Value |
|---|---|
| App Store name | `Notan` (fallback `Notan Nonogram`, if taken) |
| Home-screen name | `Notan` (`CFBundleDisplayName`, independent of the listing) |
| iOS bundle id | `com.playnotan.app` (confirmed; permanent after first upload) |
| Android application id | `com.playnotan.app` (same) |
| Apple team | `596T7J7FB6` |
| Version | `1.0.1 (4)` on both platforms (1.0.0 (3) is live) |

## 0. Before anything

Done on 2026-11-13: the id `com.playnotan.app` is confirmed (Luke), the
game-riffs sync excludes `/app` (game-riffs PR 143), and the privacy policy
is live at `https://playnotan.com/privacy.html` (PR 144).

## 1. iOS: App Store Connect record

In App Store Connect → Apps → **+** → New App: platform iOS, name `Notan`
(or the fallback), primary language English (U.S.), bundle id
`com.playnotan.app`, SKU `notan-ios`. The App ID is already registered
(App Store Connect API, 2026-11-13, resource `72N53SY469`).

Fill the listing from `app-store/metadata/en-US/` and the answers in
`app-store/PRIVACY.md`. Screenshots: `app-store/screenshots/en-US/*.png`
(1320×2868, the 6.9" iPhone slot) and `*-ipad.png` (2064×2752, the 13" iPad
slot). App icon is in the binary; `app-store/icon-1024.png` is the same art.
iPhone Duo: `app-store/screenshots/iphone-duo-outer/` (1398×2034, the folded
outer screen). `scripts/capture-duo.sh <udid> <outer|inner> <outdir> [App.app]`
makes the outer or inner set from a Debug build with no taps (its header has
the build command); `asc_ship.py screenshots` reads one folder, so stage these
next to the en-US files. The 6.9" and iPad solved shots predate the solved
colors of 1.0.0 (2) (the picture now turns a color; those shots show it black).

## 2. iOS: archive and upload to TestFlight

The same commands Hexsweeper uses (`hexsweeper/app/docs/RELEASE.md`); the
signing script in step 3 runs them for build 1:

```bash
cd ~/workspace/notan/app
pnpm install && pnpm smoke

# napoleon's App Store Connect key (team 596T7J7FB6)
read -r KEY ISS < <(python3 -c "import json,os; d=json.load(open(os.path.expanduser('~/.appstoreconnect/api_key.json'))); print(d['key_id'], d['issuer_id'])")
mkdir -p ~/notan-build
cat > ~/notan-build/export.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>596T7J7FB6</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><false/>
</dict></plist>
PLIST

cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath ~/notan-build/Notan.xcarchive \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_$KEY.p8 \
  -authenticationKeyID $KEY -authenticationKeyIssuerID $ISS archive

xcodebuild -exportArchive \
  -archivePath ~/notan-build/Notan.xcarchive \
  -exportPath ~/notan-build/export \
  -exportOptionsPlist ~/notan-build/export.plist \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_$KEY.p8 \
  -authenticationKeyID $KEY -authenticationKeyIssuerID $ISS

xcrun altool --upload-app -f ~/notan-build/export/App.ipa -t ios \
  --apiKey $KEY --apiIssuer $ISS
```

Or in Xcode: `pnpm cap:open:ios`, Product → Archive, Distribute App →
App Store Connect. Keep `uploadSymbols` false (Hexsweeper's "Copy failed"
lesson). If Homebrew rsync breaks the export, put `/usr/bin` first in PATH
(the LocalType note). Raise `CURRENT_PROJECT_VERSION` for every new upload.

## 3. Android: release key and signed builds

The key is a toolkit identity like the rest: profile `notan` in
android-release-toolkit (PR 20), alias `notan-release`, keystore under
`~/Library/Application Support/AndroidReleaseToolkit/keystores/`, password in
napoleon's login Keychain, sops-encrypted backup on Beast
(`~/signing-keys/android/notan.yaml`). One script does the key, the backup,
the signed APK and AAB and the TestFlight upload, prompting only through the
Keychain:

```bash
bash ~/workspace/play-builds-20261112/sign/notan-1.0.0.sh   # Terminal.app on napoleon
```

Later builds sign the same way:

```bash
cd ~/workspace/android-release-toolkit
scripts/android-release with-signing --profile notan -- \
  bash -c 'cd ~/workspace/notan/app && scripts/android-build.sh assembleRelease && scripts/android-build.sh bundleRelease'
```

Raise `versionCode` in `android/app/build.gradle` for every upload. What
happens after signing (Play key swap, listings, downloads, F-Droid) is in
[PUBLISH-AFTER-SIGNING.md](PUBLISH-AFTER-SIGNING.md).

## 4. Google Play

Play Console → Create app: name `Notan: Nonogram`, Game, Free. Turn on Play
App Signing and upload `app-release.aab` to Internal testing first. Listing:
`app-store/google-play/en-US/*.txt`, icon `google-play/images/icon-512.png`,
feature graphic `google-play/images/feature-1024x500.png` (cropped from the
game's own `og.png`), phone screenshots `google-play/screenshots/phone/`
(1080×1920), tablet `google-play/screenshots/tablet/` (1600×2560). Data
safety, content rating and target audience: `app-store/PRIVACY.md`. A new
personal developer account may need the closed-testing period before
production.

## 5. F-Droid repository and downloads site

Both take the signed APK from step 3; details in PUBLISH-AFTER-SIGNING.md. Use the existing flows:
the owned batch in the LocalType releases F-Droid repository
(android-release-toolkit), and the `android-download-publish` skill for the
dr.eamer.dev downloads page. The APK holds no permissions and no trackers,
which suits both.

## 1.0.1 (4), prepared 2026-11-18, signed and published 2026-11-19

Brings the app to the game the web (playnotan.com) and Minimal Primitives
0.5.11 run (game-riffs `4a9c688`; 1.0 (3) shipped `d6db95d`).

What players get, from game-riffs `d6db95d..4a9c688` (`notan/`): a second
Hint press makes the hinted move; after the solve, Next is the round
continue disc Weaves uses, placed by the painted board, with the picture's
caption kept; Next past the last puzzle goes to the first unfinished one;
the end of each campaign shows on screen. game-riffs also gained a test that
every dealt board has one answer logic reaches (`test-solvable.cjs`).

Checked on napoleon 2026-11-18, side by side with the web copy and Minimal
0.5.11's `build/html` (Playwright at 390×844, light and dark, Chromium and
WebKit): Settings identical to the web (Minimal adds only Collection
scores), the continue disc the same 64 px disc at the same spot, Help the
same, no page errors. `pnpm smoke` green.

Simulator, 2026-11-18 (napoleon, Xcode 27.2, iOS 27.2 iPhone Duo sim
"Slant Duo 20261114", folded outer screen): Debug build, `scripts/capture-duo.sh … outer`
scenes solved, in progress and levels all accepted; the solved scene shows
the new continue disc. `simctl launch --console-pty` printed `WebView
loaded`, no UIScene line and no errors. The other outer shots are
pixel-identical to 1.0's; `iphone-duo-outer/02-solved.png` was replaced
with the new disc. On the folded screen the toolbar stops short of the
trailing edge: that is iOS's status-bar column beside the camera, and 1.0
did the same. External links: no `allowNavigation` is set, so Capacitor
opens any outside host in Safari (iOS `WebViewDelegationHandler`) or the
browser (Android `Bridge.launchIntent`, `ACTION_VIEW`); read in the
Capacitor 8.5.3 source, not tapped. **Not run:** the unfolded Duo poses
(folding needs a click in Device Hub), an Android emulator (the Android
WebView is the Chromium checked above), a phone.

What's New, **approved by Luke 2026-11-18**, in
`app-store/metadata/en-US/release_notes.txt` and
`app-store/google-play/en-US/release_notes.txt`:

> Press Hint twice to make the hinted move. After a solve, the arrow takes
> you to the next puzzle, and once you reach the end it takes you back to the
> first one you haven't solved.

Store screenshots retaken 2026-11-18 from Debug builds of the merged code
with `scripts/capture-duo.sh` (now also `phone` and `ipad`) on new
simulators "Store iPhone 6.9 20261118" (iPhone 17 Pro Max) and "Store
iPad 13 20261118" (iPad Pro 13" M5), iOS 27.2. The two black solved shots
are fixed: `02-solved-fish.png` shows the fish in color with the continue
disc, and the iPad's #2 is now the fish too (`02-solved-fish-ipad.png`,
replacing the moth: the Debug `-NotanShot solved` scene stages only the
fish, and adding a moth scene would change app code after the pin). The
owl and levels shots changed slightly with the new code and were replaced;
`03-dark-in-progress*` and `05-how-to-play` have no scene and were kept.

Sign script: `~/workspace/release-1.0.1-20261118/sign/notan-1.0.1-4.sh` (run in Terminal.app on
napoleon). It builds from a clean clone at the main commit that merges
these store files, and refuses unless every build input under `app/`
(all but docs, store copy and capture scripts) matches the 1.0.1 merge
`fb9f6a1`. It signs Android with the existing release key, stages the AAB
and notes in `~/workspace/play-uploads/to-upload/`, then archives, checks,
validates and uploads the iOS build to App Store Connect. Nothing is
attached to a version or submitted. The App Store screenshots above go up
with the 1.0.1 version, once its build is processed.

### Receipts, 2026-11-19

- **Signed** by Luke (`~/workspace/release-1.0.1-20261118/sign/notan-1.0.1-4.log`), from main `9607355` (build inputs `fb9f6a1`). Signer `8dc97814…ebdfc0` on APK and AAB; `jarsigner -verify` passes on the staged AAB.
  - APK `notan-1.0.1-4-00b27df6.apk` SHA-256 `00b27df67efe0170d367614b114d7358786ef6816267d8cf7e425ad865d2751b`; AAB SHA-256 `7b407c8577b45663ab143dc40735757e1d3d28e5993d9247dcfd299c61ee8beb`; IPA SHA-256 `843e707dc533bcd884b2336f76a052179f8de8ee87f67b3ff52b1b926e0ece74`. Files: `~/workspace/release-1.0.1-20261118/out/notan-1.0.1-4/`.
- **TestFlight**: build 4 validated and uploaded about 00:01 PT; App Store Connect read it `VALID`, internal `IN_BETA_TESTING` (the internal group gets every build). No 1.0.1 App Store version yet: creating it, attaching build 4, the What's New and the new screenshots, and any submission wait on Luke.
- **Google Play**: `~/workspace/play-uploads/to-upload/Notan-1.0.1-4.aab` with its `.notes.txt` (the approved What's New), row in that folder's README. Not uploaded; Luke drags it in.
- **Direct download**: `https://dr.eamer.dev/downloads/android/notan/notan-1.0.1-4-00b27df6.apk`, hash checked over HTTPS; the page on dr.eamer.dev and lukesteuber.com links it. downloads-site `080de4c` (with the other app's 1.0.1), backup `~/backups/publish-downloads-20261119T084157Z` on Drummer; `audit-catalog --live-registry` exit 0; registry row android-release-toolkit PR 50, merged `d2560e1`.
- **Hosted F-Droid**: target `20261119-slant-notan-1.0.1-b470087f` (downloads-site `f0196a3`) on top of `20261119-minimal-primitives-0.5.12-7ff2cc89`; 25 packages, 52 → 54 versions, only Slant 1.0.1 and Notan 1.0.1 added. Galactus workspace adopted (index `b449ea40…`). Batch `releases-20261119b.json`, localtype-keyboard PR 334, merged `a3911ed`. Scripts and logs: `~/workspace/release-1.0.1-20261118/publish/`.
- **Still not run**: the unfolded Duo poses, a phone run of the signed build.
- **App Store, 2026-11-19 (Luke: "yes" to submitting)**: version 1.0.1 created, build 4 attached, What's New set from `app-store/metadata/en-US/release_notes.txt`; the whole screenshot set placed from `app-store/screenshots/` (5 iPhone 6.9", 4 iPad 13", 3 folded iPhone Duo: the Duo group had held the same three shots twice), each group read back in order and a dry run then planned no changes. **Submitted for review**, state `WAITING_FOR_REVIEW`. `.asc-asset-library.json` in each screenshot folder records the uploaded assets.
