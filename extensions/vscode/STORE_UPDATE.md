# Submit Varterm TTS 0.1.47

Both stores take their **short description** from `package.json` and their **long description** from `README.md` when you publish this VSIX.

```bash
cd extensions/extensions/vscode
npm run check
npm run package
```

Artifact: `extensions/extensions/vscode/varterm-cursor-0.1.47.vsix`

---

## Short description (both stores)

```
Highlight text to hear it — no copy. Auto-read speaks agent replies. Change speed and preview voices from the status bar.
```

---

## What’s new (paste into both store “What’s new” fields)

```
Highlight text to hear it — nothing is copied. Status bar speed menu (0.75×–2×) and voice picker with a speaker-button preview. Auto-read still speaks finished agent replies and comes back after a clipboard listen. Also: Read Errors & Warnings Aloud.
```

Shorter alternative:

```
Highlight to listen, no copy. Speed and voice preview from the status bar. Auto-read for agent replies.
```

---

## Open VSX (Cursor)

```bash
npm run publish:ovsx -- --skip-package
```

---

## VS Code Marketplace

`VSCE_PAT` is still a placeholder. Upload by hand:

1. https://marketplace.visualstudio.com/manage/publishers/varterm
2. **varterm.varterm-cursor** → **… → Update**
3. Upload `varterm-cursor-0.1.47.vsix`
4. Paste the short description / What’s new if the form asks
