#!/usr/bin/env bash
# Publish the same VSIX to VS Code Marketplace and Open VSX (Cursor) in parallel.
#
#   ./scripts/publish-stores.sh              package, publish both, then compare listings
#   ./scripts/publish-stores.sh --skip-package   reuse the VSIX already on disk
#   ./scripts/publish-stores.sh --compare        no publish, just show what each store serves
#   ./scripts/publish-stores.sh --dry-run        package and check credentials, publish nothing
#
# Credentials, in priority order:
#   1. VSCE_PAT / OVSX_PAT in the environment
#   2. .env.publish next to package.json, or ~/.varterm-publish.env (gitignored, KEY=value)
#   3. VS Code Marketplace only: a stored `vsce login <publisher>` in the OS keychain
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$EXT_DIR"

SKIP_PACKAGE=0
COMPARE_ONLY=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --skip-package) SKIP_PACKAGE=1 ;;
    --compare|--check) COMPARE_ONLY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

VERSION="$(node -p "require('./package.json').version")"
PUBLISHER="$(node -p "require('./package.json').publisher")"
VSIX="$EXT_DIR/varterm-cursor-${VERSION}.vsix"

compare_stores() {
  echo
  echo "=== Listing comparison ==="
  node "$SCRIPT_DIR/store-status.mjs"
}

if [[ "$COMPARE_ONLY" -eq 1 ]]; then
  node "$SCRIPT_DIR/store-status.mjs"
  exit $?
fi

# Pull tokens from an untracked env file when they are not already exported.
for env_file in "$EXT_DIR/.env.publish" "$HOME/.varterm-publish.env"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
done

VSCE_USES_STORED_LOGIN=0
if [[ -z "${VSCE_PAT:-}" ]]; then
  if npx --yes @vscode/vsce ls-publishers 2>/dev/null | grep -qx "$PUBLISHER"; then
    VSCE_USES_STORED_LOGIN=1
    echo "VS Code Marketplace: using stored login for '$PUBLISHER'."
  else
    cat >&2 <<EOF
Missing VS Code Marketplace credentials. Either:
  export VSCE_PAT=<Azure DevOps PAT with Marketplace > Manage scope>
  or run: npx @vscode/vsce login $PUBLISHER   (stores the PAT in your keychain)
  or put VSCE_PAT=... in $EXT_DIR/.env.publish
EOF
    exit 1
  fi
fi

if [[ -z "${OVSX_PAT:-}" ]]; then
  cat >&2 <<EOF
Missing Open VSX credentials (ovsx has no stored login). Either:
  export OVSX_PAT=<token from https://open-vsx.org/user-settings/tokens>
  or put OVSX_PAT=... in $EXT_DIR/.env.publish
EOF
  exit 1
fi

if [[ "$SKIP_PACKAGE" -eq 0 ]]; then
  npm run package
fi

if [[ ! -f "$VSIX" ]]; then
  echo "VSIX not found: $VSIX" >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run: credentials present, $VSIX ready. Nothing published."
  compare_stores
  exit 0
fi

echo "Publishing $VSIX to VS Code Marketplace and Open VSX in parallel..."

VSCE_LOG="$(mktemp)"
OVSX_LOG="$(mktemp)"
cleanup() {
  rm -f "$VSCE_LOG" "$OVSX_LOG"
}
trap cleanup EXIT

set +e
if [[ "$VSCE_USES_STORED_LOGIN" -eq 1 ]]; then
  npx --yes @vscode/vsce publish --packagePath "$VSIX" >"$VSCE_LOG" 2>&1 &
else
  npx --yes @vscode/vsce publish --packagePath "$VSIX" --pat "$VSCE_PAT" >"$VSCE_LOG" 2>&1 &
fi
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
compare_stores
