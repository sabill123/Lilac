#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
MACOS_DIR="${SCRIPT_DIR:h}"
APP_DIR="$MACOS_DIR/.build/Lilac.app"
ICONSET_DIR="$MACOS_DIR/.build/Lilac.iconset"

swift build -c release --package-path "$MACOS_DIR"
BIN_DIR="$(swift build -c release --show-bin-path --package-path "$MACOS_DIR")"

mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$BIN_DIR/LilacMac" "$APP_DIR/Contents/MacOS/LilacMac"
cp "$MACOS_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"
swift "$MACOS_DIR/IconRenderer.swift" "$ICONSET_DIR"
iconutil -c icns "$ICONSET_DIR" -o "$APP_DIR/Contents/Resources/Lilac.icns"
codesign --force --deep --sign - "$APP_DIR"

echo "$APP_DIR"
