#!/usr/bin/env bash
# Renders the app icons from Notan's own mark, ../favicon.svg (black square,
# white L of filled squares). Nothing is drawn by hand or generated: the
# square icons are that SVG at size, and the round one puts the same mark,
# smaller, on a black circle. Android's adaptive and themed icons are vector
# drawables of the same path (res/drawable/ic_launcher_foreground.xml).
#
# Needs ImageMagick 7 (`magick`). Run from app/: scripts/generate-icons.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVG="$APP_DIR/../favicon.svg"
RES="$APP_DIR/android/app/src/main/res"
ICONSET="$APP_DIR/ios/App/App/Assets.xcassets/AppIcon.appiconset"
STORE="$APP_DIR/app-store"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

command -v magick >/dev/null || { echo "generate-icons: needs ImageMagick 7 (magick)" >&2; exit 1; }
[ -f "$SVG" ] || { echo "generate-icons: $SVG missing" >&2; exit 1; }

# The mark's path, read from the SVG so the icons follow it if it changes.
MARK="$(sed -n 's/.*<path fill="#fff" d="\([^"]*\)".*/\1/p' "$SVG")"
[ -n "$MARK" ] || { echo "generate-icons: no white path in $SVG" >&2; exit 1; }

# Round legacy icon: the mark at 72% on a black circle.
cat > "$TMP/round.svg" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#000"/><g transform="translate(32 32) scale(0.72) translate(-32 -32)"><path fill="#fff" d="$MARK"/></g></svg>
EOF

square() { magick -background none -density 1200 "$SVG" -resize "${1}x${1}" -background black -alpha remove -alpha off "PNG24:$2"; }
round()  { magick -background none -density 1200 "$TMP/round.svg" -resize "${1}x${1}" "PNG32:$2"; }

# iOS: one 1024 square, no alpha (App Store Connect rejects transparency).
mkdir -p "$ICONSET"
square 1024 "$ICONSET/AppIcon-1024.png"

# Android legacy launcher icons (API 24-25; newer use the adaptive XML).
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
    density="${pair%%:*}"; size="${pair##*:}"
    mkdir -p "$RES/mipmap-$density"
    square "$size" "$RES/mipmap-$density/ic_launcher.png"
    round "$size" "$RES/mipmap-$density/ic_launcher_round.png"
done

# Store icons: Google Play 512, App Store marketing 1024.
mkdir -p "$STORE/google-play/images"
square 512 "$STORE/google-play/images/icon-512.png"
square 1024 "$STORE/icon-1024.png"

echo "generate-icons: done"
