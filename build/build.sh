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
# Clean old artifacts to avoid confusion
rm -f "$OUT_DIR"/*.aab "$OUT_DIR"/*.apk 2>/dev/null || true
CID=$(docker create "$IMAGE_NAME")

# Standard path for release AAB
docker cp "$CID":/workspace/android/app/build/outputs/bundle/release/. "$OUT_DIR" 2>/dev/null || true

# Fallback: extract any *.aab from android/
if ! ls "$OUT_DIR"/*.aab >/dev/null 2>&1; then
  echo "🔎 Fallback: search for AABs..."
  docker cp "$CID":/workspace/android /tmp/_android_copy
  find /tmp/_android_copy -name '*.aab' -exec cp {} "$OUT_DIR"/ \;
  rm -rf /tmp/_android_copy
fi

docker rm "$CID" >/dev/null

echo "✅ Done. AABs:"
# Remove any debug artifacts to avoid accidental uploads
rm -f "$OUT_DIR"/*-debug.* 2>/dev/null || true
ls -la "$OUT_DIR" || echo "No AAB files found"

# --- Optional: sign newest AAB if AAB_PASS is set ---
if [[ -n "${AAB_PASS:-}" ]]; then
  echo "🔏 Signing newest AAB with provided AAB_PASS..."
  KEYSTORE="$PROJECT_ROOT/build/my-release-key.jks"

  if [[ ! -f "$KEYSTORE" ]]; then
    echo "❌ Keystore not found at $KEYSTORE. Skipping signing." >&2
    exit 1
  fi

  if ! command -v keytool >/dev/null 2>&1 || ! command -v jarsigner >/dev/null 2>&1; then
    echo "❌ keytool/jarsigner not found on host. Install a JDK (e.g., openjdk-17-jdk) and re-run." >&2
    exit 1
  fi

  NEWEST_AAB=$(ls -t "$OUT_DIR"/*.aab 2>/dev/null | head -n1 || true)
  if [[ -z "${NEWEST_AAB}" ]]; then
    echo "❌ No .aab found in $OUT_DIR to sign." >&2
    exit 1
  fi

  ALIAS=$(keytool -list -v -keystore "$KEYSTORE" -storepass "$AAB_PASS" 2>/dev/null | awk -F': ' '/^Alias name:/{print $2; exit}')
  if [[ -z "$ALIAS" ]]; then
    echo "❌ Could not detect alias from keystore. Check AAB_PASS or keystore contents." >&2
    exit 1
  fi

  echo "➡️  Signing $NEWEST_AAB with alias '$ALIAS'..."
  jarsigner -keystore "$KEYSTORE" -storepass "$AAB_PASS" -keypass "$AAB_PASS" \
    "$NEWEST_AAB" "$ALIAS"

  echo "🔎 Verifying signature..."
  jarsigner -verify -verbose -certs "$NEWEST_AAB" >/dev/null
  echo "✅ Signed: $NEWEST_AAB"
else
  echo "ℹ️  Skipping signing (set AAB_PASS to enable)."
fi
