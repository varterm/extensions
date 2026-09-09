# Varterm Extensions

Source for the Varterm editor and browser extensions. MIT licensed.

The editor extension ships **highlight-to-listen** (select text, no copy) and **Agent Auto-read**: finished Cursor agent replies play while you keep working. One install, every window, zero echo. Long replies split into parts you can jump through, so you skip the preamble instead of scrolling the chat. Same engine reads whole files, RFCs, and multi-page docs — playback starts on part one while the rest generates.


## Repository Layout

- `extensions/chrome` - Chrome extension source and packaging script.
- `extensions/vscode` - VS Code extension source and packaging script.
- `plugins/claude-code` - Claude Code plugin that reads replies aloud.
- `packages/tts-client` - shared API client used by extension surfaces.
- `.claude-plugin/marketplace.json` - makes this repo a Claude Code plugin
  marketplace, so `claude plugin marketplace add varterm/extensions` works.

## Build and Package

### Chrome Extension

```bash
cd extensions/chrome
bash package.sh
```

### VS Code Extension

```bash
cd extensions/vscode
npm ci
npm run package
```

### Claude Code Plugin

Nothing to build. Load it straight from the checkout:

```bash
claude --plugin-dir plugins/claude-code
```

## Releases

GitHub release workflow packages both extension artifacts:

- `extensions/chrome/varterm-tts-chrome.zip`
- `extensions/vscode/*.vsix`

Publish the editor VSIX to **VS Code Marketplace** and **Open VSX** (Cursor) in parallel:

```bash
cd extensions/vscode
export VSCE_PAT=...   # Azure DevOps PAT, scope: Marketplace > Manage
export OVSX_PAT=...   # https://open-vsx.org/user-settings/tokens
npm run publish:stores
```

Instead of exporting the marketplace PAT every time you can run `npx @vscode/vsce login varterm`
once and the script will use the stored keychain credential. Open VSX has no stored login, so
`OVSX_PAT` is always required.

Either token can live in an untracked `KEY=value` file. **Use `~/.varterm-publish.env`, not
`extensions/vscode/.env.publish`.** `vsce` packages the extension folder wholesale, so anything
next to `package.json` ends up inside the VSIX unless `.vscodeignore` excludes it — a token stored
there gets published with the extension. `.vscodeignore` now excludes `.env*`, and the publish
script refuses to upload a VSIX containing credential-looking files, but keeping secrets out of the
extension folder removes the risk instead of guarding it.

Each store is independent, and credentials are only required for the ones you are actually
publishing to. Open VSX is the registry Cursor installs from, and its token comes from GitHub, so
it can be released on its own without touching Azure:

```bash
npm run publish:ovsx      # Open VSX only, no Azure token needed
```

The Marketplace listing can then be updated by hand with no token at all: open
<https://marketplace.visualstudio.com/manage/publishers/varterm>, pick **Update** on the extension,
and upload the same `.vsix`. The script prints those steps whenever it skips that store.

```bash
npm run stores:status          # version + description each store is serving vs package.json
npm run publish:dry-run        # package and verify credentials, publish nothing
npm run publish:dry-run:ovsx   # same, Open VSX only
```

Both stores read the listing text from `package.json` `description`, so it only changes when a
new version is published. `stores:status` flags the drift.
