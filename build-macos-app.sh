#!/bin/zsh

set -euo pipefail

PROJECT_DIR="${0:A:h}"
APP_BUNDLE="$PROJECT_DIR/dist/LuckyDraw.app"
CONTENTS_DIR="$APP_BUNDLE/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
MODULE_CACHE_DIR="$PROJECT_DIR/.build/module-cache"

mkdir -p "$MACOS_DIR" "$RESOURCES_DIR/images" "$RESOURCES_DIR/files" "$RESOURCES_DIR/vendor" "$MODULE_CACHE_DIR"

xcrun swiftc \
  -O \
  -module-cache-path "$MODULE_CACHE_DIR" \
  -framework Cocoa \
  -framework WebKit \
  "$PROJECT_DIR/app/main.swift" \
  -o "$MACOS_DIR/LuckyDraw"

cp "$PROJECT_DIR/app/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$PROJECT_DIR/upload.html" "$RESOURCES_DIR/upload.html"
cp "$PROJECT_DIR/index.html" "$RESOURCES_DIR/index.html"
cp "$PROJECT_DIR/files/luckydraw_sample.xlsx" "$RESOURCES_DIR/files/luckydraw_sample.xlsx"
cp "$PROJECT_DIR/vendor/xlsx.full.min.js" "$RESOURCES_DIR/vendor/xlsx.full.min.js"
cp "$PROJECT_DIR/vendor/confetti.browser.min.js" "$RESOURCES_DIR/vendor/confetti.browser.min.js"

codesign --force --sign - "$APP_BUNDLE"

echo "완료: $APP_BUNDLE"
