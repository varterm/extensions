# Varterm Extensions

Source code for Varterm browser and editor extensions.

## Repository Layout

- `extensions/chrome` - Chrome extension source and packaging script.
- `extensions/vscode` - VS Code extension source and packaging script.
- `packages/tts-client` - shared API client used by extension surfaces.

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

## Releases

GitHub release workflow packages both extension artifacts:

- `extensions/chrome/varterm-tts-chrome.zip`
- `extensions/vscode/*.vsix`

Publish the editor VSIX to **VS Code Marketplace** and **Open VSX** (Cursor) in parallel:

```bash
cd extensions/vscode
export VSCE_PAT=...   # Azure DevOps PAT with Marketplace publish
export OVSX_PAT=...   # Open VSX access token
npm run publish:stores
```
