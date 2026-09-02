#!/bin/zsh

set -euo pipefail

PROJECT_DIR="${0:A:h}"
OUTPUT_DIR="$PROJECT_DIR/dist/windows"

mkdir -p "$OUTPUT_DIR"

dotnet publish "$PROJECT_DIR/windows/LuckyDraw.Windows.csproj" \
  --configuration Release \
  --runtime win-x64 \
  --self-contained true \
  -p:PublishSingleFile=true \
  --output "$OUTPUT_DIR"

echo "완료: $OUTPUT_DIR/LuckyDraw.exe"
