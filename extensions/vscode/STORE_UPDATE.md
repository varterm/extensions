# Submit Varterm TTS 0.1.64

Both stores take their **short description** from `package.json` and their **long description** from `README.md` when you publish this VSIX. Neither is edited in the store UI; change the files and publish.

```bash
cd extensions/extensions/vscode
npm run publish:stores      # both stores
npm run publish:ovsx        # Open VSX only, no Azure token needed
```

Artifact: `extensions/extensions/vscode/varterm-cursor-0.1.64.vsix`

Current state: Open VSX is on **0.1.64**. The Marketplace is on **0.1.62** — 0.1.63 never reached it — so publishing there moves users forward two versions.

## The listing copy is behind the repo

`README.md` gained a **Voices and languages** section and moved the Linux player requirement into Install, but that happened *after* `varterm-cursor-0.1.64.vsix` was packaged and published. The shipped VSIX carries the previous README, so neither store is showing the new copy and Open VSX cannot be corrected — a published version is immutable.

Publish the **existing** VSIX to the Marketplace rather than repackaging. Repackaging would produce a second, different 0.1.64: one on Open VSX, another on the Marketplace, and a third already attached to the GitHub release. The listing copy then goes out with **0.1.65**, and both stores pick it up together.

---

## Short description (both stores)

```
Highlight text to hear it — no copy. Auto-read speaks agent replies. Change speed and preview voices from the status bar.
```

Unchanged in 0.1.64.

---

## What's new

```
Linux plays without ffmpeg installed — mpv, mpg123, VLC and SoX all work now, and a missing player is named instead of failing silently. 66 voices across 29 languages. A voice handed text it cannot read says so and names one that can.
```

---

## VS Code Marketplace (if VSCE_PAT is still a placeholder)

`VSCE_PAT` in `~/.varterm-publish.env` ships as a `replace-with-...` placeholder. Either fill it in, run `npx @vscode/vsce login varterm` once to use the keychain instead, or upload by hand:

1. https://marketplace.visualstudio.com/manage/publishers/varterm
2. **varterm.varterm-cursor** → **… → Update**
3. Upload `varterm-cursor-0.1.64.vsix`

## Checking what each store is serving

```bash
npm run stores:status
```

The Marketplace search index lags its own API by a few minutes, so the public listing can show the previous version briefly after a successful publish. Open VSX holds a new version inactive until its scan finishes, which took about four minutes for 0.1.64 — during that window the API 404s the version even though publishing succeeded.
