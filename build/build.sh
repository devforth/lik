#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Building Capacitor Android (Docker multi-stage)..."

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

IMAGE_NAME="lik-android:latest"
OUT_DIR="$PROJECT_ROOT/dist-android"

echo "🔨 docker build..."
docker build -f build/Dockerfile -t "$IMAGE_NAME" .

echo "📦 Extracting APK..."
mkdir -p "$OUT_DIR"
CID=$(docker create "$IMAGE_NAME")

# Standard path for debug APK
docker cp "$CID":/workspace/android/app/build/outputs/apk/debug/. "$OUT_DIR" 2>/dev/null || true

# Fallback: extract any *.apk from android/
if ! ls "$OUT_DIR"/*.apk >/dev/null 2>&1; then
  echo "🔎 Fallback: search for APKs..."
  docker cp "$CID":/workspace/android /tmp/_android_copy
  find /tmp/_android_copy -name '*.apk' -exec cp {} "$OUT_DIR"/ \;
  rm -rf /tmp/_android_copy
fi

docker rm "$CID" >/dev/null

echo "✅ Done. APKs:"
ls -la "$OUT_DIR" || echo "No APK files found"
