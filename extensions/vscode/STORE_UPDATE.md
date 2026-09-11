# Submit Varterm TTS 0.1.62

Both stores take their **short description** from `package.json` and their **long description** from `README.md` when you publish this VSIX.

```bash
cd extensions/extensions/vscode
npm run publish:stores
```

Open VSX can run without a Marketplace token:

```bash
npm run publish:ovsx
```

Artifact: `extensions/extensions/vscode/varterm-cursor-0.1.62.vsix`

---

## Short description (both stores)

```
Highlight text to hear it — no copy. Auto-read speaks agent replies. Change speed and preview voices from the status bar.
```

---

## What’s new

```
Auto-read Off stays off after reload and stops this window’s listen. Failed reads can report to Sentry (no spoken text). Listen queue, plan files, and markdown-stripped speech from 0.1.55 are included.
```

---

## VS Code Marketplace (if VSCE_PAT is still a placeholder)

1. https://marketplace.visualstudio.com/manage/publishers/varterm
2. **varterm.varterm-cursor** → **… → Update**
3. Upload `varterm-cursor-0.1.62.vsix`
