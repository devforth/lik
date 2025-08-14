#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Building Capacitor Android (Docker multi-stage)..."

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

IMAGE_NAME="lik-android:latest"
OUT_DIR="$PROJECT_ROOT/dist-android"

echo "🔨 docker build..."
docker build -f build/Dockerfile -t "$IMAGE_NAME" .

echo "📦 Extracting AAB..."
mkdir -p "$OUT_DIR"
CID=$(docker create "$IMAGE_NAME")

# Standard path for debug AAB
docker cp "$CID":/workspace/android/app/build/outputs/bundle/debug/. "$OUT_DIR" 2>/dev/null || true

# Fallback: extract any *.aab from android/
if ! ls "$OUT_DIR"/*.aab >/dev/null 2>&1; then
  echo "🔎 Fallback: search for AABs..."
  docker cp "$CID":/workspace/android /tmp/_android_copy
  find /tmp/_android_copy -name '*.aab' -exec cp {} "$OUT_DIR"/ \;
  rm -rf /tmp/_android_copy
fi

docker rm "$CID" >/dev/null

echo "✅ Done. AABs:"
ls -la "$OUT_DIR" || echo "No AAB files found"
