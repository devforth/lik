#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Building Capacitor Android (Docker multi-stage)..."

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

OUT_DIR="$PROJECT_ROOT/dist-android"

# Clean old artifacts to avoid uploading a stale bundle
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.aab

echo "🔨 docker build..."
docker build -f build/Dockerfile --target aab --output "type=local,dest=$OUT_DIR" .

echo "✅ Done. AABs:"
ls -la "$OUT_DIR"/*.aab

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
