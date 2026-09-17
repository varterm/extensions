# Submit Varterm TTS 0.1.65

Both stores take their **short description** from `package.json` and their **long description** from `README.md` when you publish this VSIX. Neither is edited in the store UI; change the files and publish.

```bash
cd extensions/extensions/vscode
npm run publish:stores      # both stores
npm run publish:ovsx        # Open VSX only, no Azure token needed
```

Artifact: `extensions/extensions/vscode/varterm-cursor-0.1.65.vsix`

Current state: the Marketplace is on **0.1.62**, Open VSX on **0.1.64**. Publishing moves Marketplace users forward three versions and brings the two stores back into line.

## This release carries the listing copy that 0.1.64 missed

The **Voices and languages** section and the Linux player note landed in `README.md` after 0.1.64 was packaged, so neither store ever showed them — a published version is immutable and could not be corrected. 0.1.65 is packaged from the current README, so both stores pick that copy up along with this release's own additions. Nothing is outstanding from 0.1.64.

Because the long description ships *inside* the VSIX, any further README edits have to happen before `npm run package`, not after.

---

## Short description (both stores)

```
Highlight text to hear it — no copy. Auto-read speaks agent replies. Change speed and preview voices from the status bar.
```

Unchanged in 0.1.65.

---

## What's new

```
Hear the last agent reply again from the status bar or ⌘⇧⌥A — no copying, and each window keeps its own. Text with nothing speakable in it now says so instead of ending in silence. Plus everything 0.1.64 added: Linux plays without ffmpeg, 66 voices across 29 languages, and a voice handed text it cannot read names one that can.
```

The last sentence is there because Marketplace users are coming from 0.1.62 and have not seen the 0.1.64 notes.

---

## VS Code Marketplace (if VSCE_PAT is still a placeholder)

`VSCE_PAT` in `~/.varterm-publish.env` ships as a `replace-with-...` placeholder. Either fill it in, run `npx @vscode/vsce login varterm` once to use the keychain instead, or upload by hand:

1. https://marketplace.visualstudio.com/manage/publishers/varterm
2. **varterm.varterm-cursor** → **… → Update**
3. Upload `varterm-cursor-0.1.65.vsix`

## Checking what each store is serving

```bash
npm run stores:status
```

The Marketplace search index lags its own API by a few minutes, so the public listing can show the previous version briefly after a successful publish. Open VSX holds a new version inactive until its scan finishes, which took about four minutes for 0.1.64 — during that window the API 404s the version even though publishing succeeded. Wait rather than re-running the publish.
