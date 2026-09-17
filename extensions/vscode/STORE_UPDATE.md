# Submit Varterm TTS 0.1.66

Both stores take their **short description** from `package.json` and their **long description** from `README.md` when you publish this VSIX. Neither is edited in the store UI; change the files and publish.

```bash
cd extensions/extensions/vscode
npm run publish:stores      # both stores
npm run publish:ovsx        # Open VSX only, no Azure token needed
```

Artifact: `extensions/extensions/vscode/varterm-cursor-0.1.66.vsix`

Current state: both stores are on **0.1.65** and in step with each other for the first time in several releases, so this is a straight one-version bump on both. Nothing is outstanding from an earlier release, and the listing copy in this VSIX is current.

Because the long description ships *inside* the VSIX, any further README edits have to happen before `npm run package`, not after. A published version cannot be replaced, so late copy waits for the next one.

---

## Short description (both stores)

```
Highlight text to hear it — no copy. Auto-read speaks agent replies. Change speed and preview voices from the status bar.
```

Unchanged in 0.1.66.

---

## What's new

```
Open several projects at once and they now share one reading queue, so replies are read in the order they arrived and whichever window is free reads the next. The status bar says which window is talking and which is waiting its turn. Fixes a reply queued behind another window that could wait indefinitely, and two windows that could start reading at the same moment.
```

Both stores are coming from 0.1.65, so this covers only what 0.1.66 changes.

---

## VS Code Marketplace (if VSCE_PAT is still a placeholder)

`VSCE_PAT` in `~/.varterm-publish.env` ships as a `replace-with-...` placeholder. Either fill it in, run `npx @vscode/vsce login varterm` once to use the keychain instead, or upload by hand:

1. https://marketplace.visualstudio.com/manage/publishers/varterm
2. **varterm.varterm-cursor** → **… → Update**
3. Upload `varterm-cursor-0.1.66.vsix`

## Checking what each store is serving

```bash
npm run stores:status
```

The Marketplace search index lags its own API by a few minutes, so the public listing can show the previous version briefly after a successful publish. Open VSX holds a new version inactive until its scan finishes, which took about four minutes for 0.1.64 — during that window the API 404s the version even though publishing succeeded. Wait rather than re-running the publish.
