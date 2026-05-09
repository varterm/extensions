# Varterm Cursor Extension

Convert long-form text to natural speech in Cursor/VS Code, with markdown cleanup for selected text, editor content, clipboard, and agent output. Free to use with no login required.

## Commands

- `Varterm: Connect` - configure base URL and optional bearer token.
- `Varterm: Set ElevenLabs API Key` - store/clear ElevenLabs key in secure extension storage.
- `Varterm: Select Read-Aloud Voice` - pick from available Edge/Premium voices.
- `Varterm: Read Editor/Selection Aloud` - synthesize active selection (or full editor text) and play audio.
- `Varterm: Read Clipboard Aloud` - speak copied text, useful for agent/chat output.
- `Varterm: Open Settings` - open all `vartermCursor.*` settings.
- `Varterm: Clear Audio Cache` - remove locally cached generated MP3 files.

Player notes:
- The player opens in a split panel.
- Playback speed is controlled via the audio player's built-in controls.

## Settings

You can tune behavior in Settings under `vartermCursor.*`:

- `vartermCursor.requestTimeoutMs`
- `vartermCursor.requestRetries`
- `vartermCursor.readAloudVoice`
- `vartermCursor.readAloudRate`
- `vartermCursor.readAloudProvider`
- `vartermCursor.elevenLabsApiKey` (optional plain-text fallback; secure storage command is preferred)
- `vartermCursor.maxCachedAudioFiles`

## Development

```bash
npm install
npm run build
```

Package VSIX:

```bash
npm run package
```
