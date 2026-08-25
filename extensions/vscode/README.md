# Varterm TTS

Convert long-form text to natural speech in VS Code, with markdown cleanup for selected text, editor content, and clipboard. Free to use with no login required.

## Commands

- `Varterm: Connect` - configure base URL and optional bearer token.
- `Varterm: Set ElevenLabs API Key` - store/clear ElevenLabs key in secure extension storage.
- `Varterm: Select Read-Aloud Voice` - pick from available Edge/Premium voices.
- `Varterm: Read Editor/Selection Aloud` — synthesize active selection (or full editor text) and play audio.
- `Varterm: Read Clipboard Aloud` — speak copied text.
- `Varterm: Customize Keyboard Shortcuts` — change or remove Varterm key bindings.
- `Varterm: Open Settings` — open all `vartermCursor.*` settings.
- `Varterm: Clear Audio Cache` — remove leftover MP3s from older versions.
- `Varterm: Save Last Audio as MP3` — optional export; playback does not write files.

## Default shortcuts

Installed automatically (customize anytime via command palette):

| Action | macOS | Windows / Linux |
|--------|-------|-----------------|
| Read clipboard | `⌘+Shift+⌥+L` | `Ctrl+Shift+Y` |
| Read editor / selection | `⌘+Shift+⌥+R` | `Ctrl+Shift+R` |

To change or remove shortcuts: run **`Varterm: Customize Keyboard Shortcuts`**.

Player notes:
- On macOS, audio plays in the background with `afplay`. You stay in the editor — no Music.app, no extra tab.
- Status bar **Play** control: click to read the clipboard, replay, or stop.
- Status bar **Auto-read**: click to play new assistant replies when they finish.

## Settings

You can tune behavior in Settings under `vartermCursor.*`:

- `vartermCursor.requestTimeoutMs`
- `vartermCursor.requestRetries`
- `vartermCursor.readAloudVoice`
- `vartermCursor.readAloudRate`
- `vartermCursor.readAloudProvider`
- `vartermCursor.elevenLabsApiKey` (optional plain-text fallback; secure storage command is preferred)
- `vartermCursor.maxCachedAudioFiles` (temporary files; default 8)
- `vartermCursor.maxCachedAudioAgeHours` (default 24; `0` = keep until count limit)

## Development

```bash
npm install
npm run build
```

Package VSIX:

```bash
npm run package
```
