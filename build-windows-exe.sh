#!/bin/zsh

set -euo pipefail

PROJECT_DIR="${0:A:h}"
OUTPUT_DIR="$PROJECT_DIR/dist/windows"
UNPACKED_DIR="$PROJECT_DIR/dist-electron/win-unpacked"
NSIS_SCRIPT="$PROJECT_DIR/build/windows-portable.nsi"
BUILDER_CACHE_DIR="${XDG_CACHE_HOME:-$HOME/Library/Caches}/electron-builder"

mkdir -p "$OUTPUT_DIR"
cd "$PROJECT_DIR"
if [[ ! -d node_modules ]]; then
  npm ci
fi

npx electron-builder --win dir --x64 --publish never

MAKENSIS_PATH="$(find "$BUILDER_CACHE_DIR" -type f -path '*/mac/makensis' | head -n 1)"
if [[ -z "$MAKENSIS_PATH" ]]; then
  echo "오류: Electron Builder의 NSIS 도구를 찾을 수 없습니다."
  exit 1
fi
NSIS_ROOT="${MAKENSIS_PATH:h:h}"

NSISDIR="$NSIS_ROOT" "$MAKENSIS_PATH" \
  -DAPP_SOURCE="$UNPACKED_DIR" \
  -DOUTPUT_FILE="$OUTPUT_DIR/LuckyDraw.exe" \
  "$NSIS_SCRIPT"

echo "완료: $OUTPUT_DIR/LuckyDraw.exe"
