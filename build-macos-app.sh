#!/bin/zsh

set -euo pipefail

PROJECT_DIR="${0:A:h}"
APP_BUNDLE="$PROJECT_DIR/dist/LuckyDraw.app"
BUILT_APP="$PROJECT_DIR/dist-electron/mac-arm64/LuckyDraw.app"

cd "$PROJECT_DIR"
if [[ ! -d node_modules ]]; then
  npm ci
fi

npx electron-builder --mac dir --arm64 --publish never

rm -rf "$APP_BUNDLE"
/usr/bin/ditto "$BUILT_APP" "$APP_BUNDLE"
codesign --force --deep --sign - "$APP_BUNDLE"

echo "완료: $APP_BUNDLE"
