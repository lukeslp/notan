# Release

Nothing here has been signed, uploaded or published. Every step below is the
owner's. App sessions on napoleon cannot read the login keychain, so the
signing steps have to run from Luke's own Terminal (or Xcode).

## Identity

| Thing | Value |
|---|---|
| App Store name | `Notan` (fallback `Notan Nonogram`, if taken) |
| Home-screen name | `Notan` (`CFBundleDisplayName`, independent of the listing) |
| iOS bundle id | `com.playnotan.app` (proposed; permanent after first upload) |
| Android application id | `com.playnotan.app` (same) |
| Apple team | `596T7J7FB6` |
| Version | `1.0.0 (1)` on both platforms |

## 0. Before anything

1. Confirm or change the id (README, "Decisions for the owner").
2. Add `--exclude /app` to game-riffs `tools/publish-notan-source.sh`
   (README, "Before the next sync").
3. Publish `app-store/privacy-policy.html` at
   `https://playnotan.com/privacy.html`. Both stores want the URL.

## 1. iOS: App Store Connect record

In App Store Connect → Apps → **+** → New App: platform iOS, name `Notan`
(or the fallback), primary language English (U.S.), bundle id
`com.playnotan.app`, SKU `notan-ios`. If the bundle id is not offered,
register it first under Certificates, Identifiers & Profiles → Identifiers
(App IDs, explicit, no capabilities), or let the archive below register it
through `-allowProvisioningUpdates`.

Fill the listing from `app-store/metadata/en-US/` and the answers in
`app-store/PRIVACY.md`. Screenshots: `app-store/screenshots/en-US/*.png`
(1320×2868, the 6.9" iPhone slot) and `*-ipad.png` (2064×2752, the 13" iPad
slot). App icon is in the binary; `app-store/icon-1024.png` is the same art.

## 2. iOS: archive and upload to TestFlight

The same commands Hexsweeper uses (`hexsweeper/app/docs/RELEASE.md`), with
the App Store Connect API key from there:

```bash
cd ~/workspace/notan/app
pnpm install && pnpm smoke

KEY=<Hexsweeper's API key id>
ISS=<Hexsweeper's issuer id>
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

## 3. Android: release key

Create an upload key once, outside the repository, and keep a copy where the
other release keys live (sops vault on Beast, Storage Box):

```bash
keytool -genkeypair -v -keystore ~/signing-keys/notan-upload.jks \
  -alias notan -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Luke Steuber"
```

(or add a `notan` profile to android-release-toolkit and use
`android-release with-signing --profile notan -- <cmd>`, as Hexsweeper does).

## 4. Android: signed builds

```bash
cd ~/workspace/notan/app
export NOTAN_ANDROID_STORE_FILE=~/signing-keys/notan-upload.jks
export NOTAN_ANDROID_KEY_ALIAS=notan
read -rs NOTAN_ANDROID_STORE_PASSWORD && export NOTAN_ANDROID_STORE_PASSWORD
export NOTAN_ANDROID_KEY_PASSWORD="$NOTAN_ANDROID_STORE_PASSWORD"

scripts/android-build.sh bundleRelease    # Play: android/app/build/outputs/bundle/release/app-release.aab
scripts/android-build.sh assembleRelease  # direct/F-Droid: android/app/build/outputs/apk/release/app-release.apk
"$HOME/Library/Android/sdk/build-tools/36.0.0/apksigner" verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

Without the four variables both tasks still succeed but produce unsigned
output. Raise `versionCode` in `android/app/build.gradle` for every upload.

## 5. Google Play

Play Console → Create app: name `Notan: Nonogram`, Game, Free. Turn on Play
App Signing and upload `app-release.aab` to Internal testing first. Listing:
`app-store/google-play/en-US/*.txt`, icon `google-play/images/icon-512.png`,
feature graphic `google-play/images/feature-1024x500.png` (cropped from the
game's own `og.png`), phone screenshots `google-play/screenshots/phone/`
(1080×1920), tablet `google-play/screenshots/tablet/` (1600×2560). Data
safety, content rating and target audience: `app-store/PRIVACY.md`. A new
personal developer account may need the closed-testing period before
production.

## 6. F-Droid repository and downloads site

Both take the signed `app-release.apk` from step 4. Use the existing flows:
the owned batch in the LocalType releases F-Droid repository
(android-release-toolkit), and the `android-download-publish` skill for the
dr.eamer.dev downloads page. The APK holds no permissions and no trackers,
which suits both.
