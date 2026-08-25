#!/usr/bin/env bash
# Publish the same VSIX to VS Code Marketplace and Open VSX (Cursor) in parallel.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$EXT_DIR"

SKIP_PACKAGE=0
if [[ "${1:-}" == "--skip-package" ]]; then
  SKIP_PACKAGE=1
fi

if [[ -z "${VSCE_PAT:-}" ]]; then
  echo "Missing VSCE_PAT (Azure DevOps PAT with Marketplace publish)." >&2
  exit 1
fi
if [[ -z "${OVSX_PAT:-}" ]]; then
  echo "Missing OVSX_PAT (Open VSX access token)." >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
VSIX="$EXT_DIR/varterm-cursor-${VERSION}.vsix"

if [[ "$SKIP_PACKAGE" -eq 0 ]]; then
  npm run package
fi

if [[ ! -f "$VSIX" ]]; then
  echo "VSIX not found: $VSIX" >&2
  exit 1
fi

echo "Publishing $VSIX to VS Code Marketplace and Open VSX in parallel..."

VSCE_LOG="$(mktemp)"
OVSX_LOG="$(mktemp)"
cleanup() {
  rm -f "$VSCE_LOG" "$OVSX_LOG"
}
trap cleanup EXIT

set +e
npx --yes @vscode/vsce publish --packagePath "$VSIX" --pat "$VSCE_PAT" >"$VSCE_LOG" 2>&1 &
VSCE_PID=$!
npx --yes ovsx publish "$VSIX" --pat "$OVSX_PAT" >"$OVSX_LOG" 2>&1 &
OVSX_PID=$!

wait "$VSCE_PID"
VSCE_EC=$?
wait "$OVSX_PID"
OVSX_EC=$?
set -e

echo
echo "=== VS Code Marketplace ==="
cat "$VSCE_LOG"
echo
echo "=== Open VSX (Cursor) ==="
cat "$OVSX_LOG"

if [[ "$VSCE_EC" -ne 0 || "$OVSX_EC" -ne 0 ]]; then
  echo
  echo "Publish failed: marketplace exit $VSCE_EC, Open VSX exit $OVSX_EC" >&2
  exit 1
fi

echo
echo "Published $VERSION to both stores."
