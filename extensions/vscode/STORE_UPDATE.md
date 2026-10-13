# Submit Varterm TTS 0.1.77

Both stores take their **short description** from `package.json` and their **long description** from `README.md` when you publish this VSIX. Neither is edited in the store UI; change the files and publish.

```bash
cd extensions/extensions/vscode
npm run publish:stores      # both stores
npm run publish:ovsx        # Open VSX only, no Azure token needed
```

Artifact: `extensions/extensions/vscode/varterm-cursor-0.1.77.vsix`

Current state: Open VSX is on **0.1.76**; the VS Code Marketplace is still on **0.1.66**. Upload this VSIX by hand for Marketplace.

---

## Short description (both stores)

```
Text to speech for Cursor and VS Code. Hear agent replies read aloud as they finish, or highlight any text and listen. Speed, voice, and playback from the status bar. Free, MIT licensed, no account.
```

---

## What's new

Open VSX (coming from 0.1.76):

```
Expected empty states (no reply yet, Linux with no MP3 player) show as information, not a red error, and are not filed as crash reports.
```

VS Code Marketplace (coming from 0.1.66):

```
Windows playback works out of the box. Long selections no longer fail part-way through. An editor can read every finished reply from Cursor's Agents window. Empty-state toasts are information, not errors. The listing describes what ships: one shared reading queue across windows, markdown stripped before speech, 66 free voices in 29 languages, and ElevenLabs with your own key.
```

---

## VS Code Marketplace (if VSCE_PAT is still a placeholder)

`VSCE_PAT` in `~/.varterm-publish.env` ships as a `replace-with-...` placeholder. Either fill it in, run `npx @vscode/vsce login varterm` once to use the keychain instead, or upload by hand:

1. https://marketplace.visualstudio.com/manage/publishers/varterm
2. **varterm.varterm-cursor** → **… → Update**
3. Upload `varterm-cursor-0.1.77.vsix`

## Checking what each store is serving

```bash
npm run stores:status
```
