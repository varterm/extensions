#!/usr/bin/env bash
# Publish the same VSIX to VS Code Marketplace and Open VSX (Cursor) in parallel.
#
#   ./scripts/publish-stores.sh                  package, publish both, compare listings
#   ./scripts/publish-stores.sh --only-ovsx      publish Open VSX only (no Azure token needed)
#   ./scripts/publish-stores.sh --only-vscode    publish VS Code Marketplace only
#   ./scripts/publish-stores.sh --skip-package   reuse the VSIX already on disk
#   ./scripts/publish-stores.sh --compare        no publish, just show what each store serves
#   ./scripts/publish-stores.sh --dry-run        package and check credentials, publish nothing
#
# Credentials are only required for the stores actually being published:
#   OVSX_PAT   Open VSX, from https://open-vsx.org/user-settings/tokens
#   VSCE_PAT   VS Code Marketplace, an Azure DevOps PAT with Marketplace > Manage
#              scope, or a stored `vsce login <publisher>` in the OS keychain
#
# Tokens are read from the environment first, then ~/.varterm-publish.env, then
# .env.publish next to package.json. Prefer the home-directory file: anything
# beside package.json gets packaged into the VSIX unless .vscodeignore excludes
# it, so keeping credentials outside the extension folder removes the risk
# rather than relying on an ignore rule.
#
# The Marketplace also accepts a manual VSIX upload, which needs no token at
# all: https://marketplace.visualstudio.com/manage/publishers/<publisher>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$EXT_DIR"

SKIP_PACKAGE=0
COMPARE_ONLY=0
DRY_RUN=0
PUBLISH_VSCE=1
PUBLISH_OVSX=1

show_help() {
  awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
}

for arg in "$@"; do
  case "$arg" in
    --skip-package) SKIP_PACKAGE=1 ;;
    --compare|--check) COMPARE_ONLY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --only-ovsx|--ovsx-only) PUBLISH_VSCE=0 ;;
    --only-vscode|--vscode-only) PUBLISH_OVSX=0 ;;
    -h|--help) show_help; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$PUBLISH_VSCE" -eq 0 && "$PUBLISH_OVSX" -eq 0 ]]; then
  echo "Nothing to do: --only-ovsx and --only-vscode cancel each other out." >&2
  exit 2
fi

VERSION="$(node -p "require('./package.json').version")"
PUBLISHER="$(node -p "require('./package.json').publisher")"
VSIX="$EXT_DIR/varterm-cursor-${VERSION}.vsix"

compare_stores() {
  echo
  echo "=== Listing comparison ==="
  node "$SCRIPT_DIR/store-status.mjs"
}

# Reminder for the store we are deliberately not pushing to, so a partial
# release does not quietly look like a complete one.
manual_upload_note() {
  cat <<EOF

VS Code Marketplace was skipped. To update that listing by hand:
  1. https://marketplace.visualstudio.com/manage/publishers/$PUBLISHER
  2. Use the ... menu on "$PUBLISHER.varterm-cursor" and choose Update
  3. Upload $VSIX
EOF
}

if [[ "$COMPARE_ONLY" -eq 1 ]]; then
  node "$SCRIPT_DIR/store-status.mjs"
  exit $?
fi

# Pull tokens from an untracked env file when they are not already exported.
# Parsed rather than sourced: a credentials file should not be able to run
# shell, and an already-exported value must win over the file instead of being
# silently overwritten the way `source` would.
load_env_file() {
  local file="$1" key value
  [[ -f "$file" ]] || return 0
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n "${!key:-}" ]] && continue
    export "$key=$value"
  done <"$file"
}

load_env_file "$HOME/.varterm-publish.env"
load_env_file "$EXT_DIR/.env.publish"

# An unfilled placeholder from the generated .env.publish would otherwise be
# sent to a registry as a real token and fail with a confusing auth error.
# Treat it as absent so the missing-credential message below explains itself,
# and so a placeholder for a store we are not publishing to is simply ignored.
for var in VSCE_PAT OVSX_PAT; do
  if [[ "${!var:-}" == replace-with-* ]]; then
    unset "$var"
  fi
done

VSCE_USES_STORED_LOGIN=0
if [[ "$PUBLISH_VSCE" -eq 1 && -z "${VSCE_PAT:-}" ]]; then
  if npx --yes @vscode/vsce ls-publishers 2>/dev/null | grep -qx "$PUBLISHER"; then
    VSCE_USES_STORED_LOGIN=1
    echo "VS Code Marketplace: using stored login for '$PUBLISHER'."
  else
    cat >&2 <<EOF
Missing VS Code Marketplace credentials. Either:
  export VSCE_PAT=<Azure DevOps PAT with Marketplace > Manage scope>
  or run: npx @vscode/vsce login $PUBLISHER   (stores the PAT in your keychain)
  or put VSCE_PAT=... in $EXT_DIR/.env.publish
  or skip this store with --only-ovsx and upload the VSIX by hand
EOF
    exit 1
  fi
fi

if [[ "$PUBLISH_OVSX" -eq 1 && -z "${OVSX_PAT:-}" ]]; then
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

# .gitignore says nothing about the VSIX, and vsce packages the extension folder
# wholesale, so a credential file sitting next to package.json ships inside the
# extension unless .vscodeignore excludes it. Open VSX scans for this and blocks
# the upload, but by then the token has already left the machine.
if unzip -l "$VSIX" | grep -Eiq '(^|/)\.env|\.pem$|\.key$|credentials'; then
  echo "Refusing to publish: $VSIX contains a credential-looking file." >&2
  echo "Offending entries:" >&2
  unzip -l "$VSIX" | grep -Ei '(^|/)\.env|\.pem$|\.key$|credentials' >&2
  echo "Add it to .vscodeignore, repackage, and treat the secret as compromised." >&2
  exit 1
fi

targets=()
[[ "$PUBLISH_VSCE" -eq 1 ]] && targets+=("VS Code Marketplace")
[[ "$PUBLISH_OVSX" -eq 1 ]] && targets+=("Open VSX")
printf -v TARGET_LIST '%s and ' "${targets[@]}"
TARGET_LIST="${TARGET_LIST% and }"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry run: credentials present for $TARGET_LIST, $VSIX ready. Nothing published."
  [[ "$PUBLISH_VSCE" -eq 0 ]] && manual_upload_note
  compare_stores
  exit 0
fi

echo "Publishing $VSIX to $TARGET_LIST..."

VSCE_LOG="$(mktemp)"
OVSX_LOG="$(mktemp)"
cleanup() {
  rm -f "$VSCE_LOG" "$OVSX_LOG"
}
trap cleanup EXIT

VSCE_EC=0
OVSX_EC=0
VSCE_PID=""
OVSX_PID=""

set +e
if [[ "$PUBLISH_VSCE" -eq 1 ]]; then
  if [[ "$VSCE_USES_STORED_LOGIN" -eq 1 ]]; then
    npx --yes @vscode/vsce publish --packagePath "$VSIX" >"$VSCE_LOG" 2>&1 &
  else
    npx --yes @vscode/vsce publish --packagePath "$VSIX" --pat "$VSCE_PAT" >"$VSCE_LOG" 2>&1 &
  fi
  VSCE_PID=$!
fi
if [[ "$PUBLISH_OVSX" -eq 1 ]]; then
  npx --yes ovsx publish "$VSIX" --pat "$OVSX_PAT" >"$OVSX_LOG" 2>&1 &
  OVSX_PID=$!
fi

[[ -n "$VSCE_PID" ]] && { wait "$VSCE_PID"; VSCE_EC=$?; }
[[ -n "$OVSX_PID" ]] && { wait "$OVSX_PID"; OVSX_EC=$?; }
set -e

if [[ "$PUBLISH_VSCE" -eq 1 ]]; then
  echo
  echo "=== VS Code Marketplace ==="
  cat "$VSCE_LOG"
fi
if [[ "$PUBLISH_OVSX" -eq 1 ]]; then
  echo
  echo "=== Open VSX (Cursor) ==="
  cat "$OVSX_LOG"
fi

if [[ "$VSCE_EC" -ne 0 || "$OVSX_EC" -ne 0 ]]; then
  echo
  echo "Publish failed: marketplace exit $VSCE_EC, Open VSX exit $OVSX_EC" >&2
  exit 1
fi

echo
echo "Published $VERSION to $TARGET_LIST."
[[ "$PUBLISH_VSCE" -eq 0 ]] && manual_upload_note
compare_stores
