# Submit Varterm TTS 0.1.55

Both stores take their **short description** from `package.json` and their **long description** from `README.md` when you publish this VSIX.

```bash
cd extensions/extensions/vscode
npm run publish:stores
```

Open VSX can run without a Marketplace token:

```bash
npm run publish:ovsx
```

Artifact: `extensions/extensions/vscode/varterm-cursor-0.1.55.vsix`

---

## Short description (both stores)

```
Highlight text to hear it — no copy. Auto-read speaks agent replies. Change speed and preview voices from the status bar.
```

---

## What’s new

```
Listen queue in the status bar — a new reply waits instead of cutting you off. Auto-read no longer steals another window’s speaker; only Play does. Plans read from the file behind the view. Markdown is stripped before speech.
```

---

## VS Code Marketplace (if VSCE_PAT is still a placeholder)

1. https://marketplace.visualstudio.com/manage/publishers/varterm
2. **varterm.varterm-cursor** → **… → Update**
3. Upload `varterm-cursor-0.1.55.vsix`
