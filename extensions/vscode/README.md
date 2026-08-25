# Varterm TTS

Read the agent window, editor, selection, and clipboard aloud. Turn on **Auto-read** to hear finished assistant replies. Play, pause, stop, and jump from the status bar. Free, no login.

## Install

In VS Code, open Extensions, search **Varterm TTS**, and click Install. Same search works in other compatible editors that use Open VSX.

Optional: download the latest `varterm-cursor-*.vsix` from [GitHub Releases](https://github.com/varterm/extensions/releases) and run `Extensions: Install from VSIX...`.

Site and extra setup: [varterm.com/extensions](https://varterm.com/extensions).

## Commands

- `Varterm: Connect` - configure base URL and optional bearer token.
- `Varterm: Set ElevenLabs API Key` - store/clear ElevenLabs key in secure extension storage.
- `Varterm: Select Read-Aloud Voice` - pick from available Edge/Premium voices.
- `Varterm: Read Editor/Selection Aloud` — synthesize active selection (or full editor text) and play audio.
- `Varterm: Read Clipboard Aloud` — speak copied text.
- `Varterm: Toggle Auto-Read` — play finished assistant replies from the status bar.
- `Varterm: Read Last Agent Reply` — speak the last captured assistant reply again.
- `Varterm: Pause Playback` / `Varterm: Resume Playback` / `Varterm: Stop Playback`.
- `Varterm: Replay Last Audio` — play the last generated audio from the start.
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
- Status bar **Auto-read**: click once to turn on. When an assistant reply **finishes**, that reply plays. Selecting text in the chat panel is not a source — the hook captures the finished reply.
- Status bar while playing: **Pause**, **Stop**, **Replay**, and **jump** arrows. Mash jump to skip back or forward through chunks.

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
- `vartermCursor.autoReadAgentOutput` — same as the Auto-read status bar toggle

## Development

```bash
npm install
npm run build
npm run package
```

