#!/bin/zsh

set -euo pipefail

PROJECT_DIR="${0:A:h}"
OUTPUT_DIR="$PROJECT_DIR/dist/windows"
BUILT_EXE="$PROJECT_DIR/dist-electron/LuckyDraw.exe"

mkdir -p "$OUTPUT_DIR"
cd "$PROJECT_DIR"
if [[ ! -d node_modules ]]; then
  npm ci
fi

npx electron-builder --win portable --x64 --publish never
/usr/bin/ditto "$BUILT_EXE" "$OUTPUT_DIR/LuckyDraw.exe"

echo "완료: $OUTPUT_DIR/LuckyDraw.exe"
