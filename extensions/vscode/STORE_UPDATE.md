# Submit Varterm TTS 0.1.76

Both stores take their **short description** from `package.json` and their **long description** from `README.md` when you publish this VSIX. Neither is edited in the store UI; change the files and publish.

```bash
cd extensions/extensions/vscode
npm run publish:stores      # both stores
npm run publish:ovsx        # Open VSX only, no Azure token needed
```

Artifact: `extensions/extensions/vscode/varterm-cursor-0.1.76.vsix`

Current state: Open VSX is on **0.1.74**; the VS Code Marketplace may still lag. The Open VSX jump is 0.1.74 → 0.1.76.

Because the long description ships *inside* the VSIX, any further README edits have to happen before `npm run package`, not after. A published version cannot be replaced, so late copy waits for the next one.

---

## Short description (both stores)

```
Text to speech for Cursor and VS Code. Hear agent replies read aloud as they finish, or highlight any text and listen. Speed, voice, and playback from the status bar. Free, MIT licensed, no account.
```

New in 0.1.73. The previous line opened with "Highlight text to hear it — no copy", which referred to a clipboard step removed in 0.1.47 and never said "text to speech".

---

## What's new

Open VSX (coming from 0.1.74):

```
Pressing the last-reply button before a chat has finished no longer files an error report. The toast still explains to wait.
```

VS Code Marketplace (coming from 0.1.66):

```
Windows playback works out of the box. Long selections no longer fail part-way through. An editor can read every finished reply from Cursor's Agents window. Three commands that did nothing and five unused settings are gone. The listing now describes what ships: one shared reading queue across windows, markdown stripped before speech, 66 free voices in 29 languages, and ElevenLabs with your own key.
```

---

## VS Code Marketplace (if VSCE_PAT is still a placeholder)

`VSCE_PAT` in `~/.varterm-publish.env` ships as a `replace-with-...` placeholder. Either fill it in, run `npx @vscode/vsce login varterm` once to use the keychain instead, or upload by hand:

1. https://marketplace.visualstudio.com/manage/publishers/varterm
2. **varterm.varterm-cursor** → **… → Update**
3. Upload `varterm-cursor-0.1.76.vsix`

## Checking what each store is serving

```bash
npm run stores:status
```

The Marketplace search index lags its own API by a few minutes, so the public listing can show the previous version briefly after a successful publish. Open VSX holds a new version inactive until its scan finishes, which took about four minutes for 0.1.64 — during that window the API 404s the version even though publishing succeeded. Wait rather than re-running the publish.
