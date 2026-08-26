# Varterm TTS

**Hear your agent.** Flip on Agent Auto-read and finished replies play while you keep working. One install, every window, zero echo. Play, pause, stop, jump — all from the status bar. Editor, selection, and clipboard too. MIT. No login.

## Install

Extensions panel → search **Varterm TTS** → **Install**. Works in Cursor (Open VSX) and VS Code.

Running many Cursor windows? Install **once for your user** — not **Install Workspace Extension**. Workspace installs only cover one folder, which is why the button seems to flip back and forth. Reload your other windows and you are done.

Prefer a file? Grab `varterm-cursor-*.vsix` from [GitHub Releases](https://github.com/varterm/extensions/releases) and run `Extensions: Install from VSIX...`.

More at [varterm.com/extensions](https://varterm.com/extensions).

## Agent Auto-read

Click **Auto-read** in the status bar. When an agent reply **finishes**, it plays.

It changes the loop: send the prompt, go back to your file, and let the answer come to you. No parking on the chat panel watching tokens stream, no scrolling back up to find the one line that mattered — jump back and hear it again.

- One install covers every Cursor window; only the focused window speaks, so parallel agents never talk over each other. Other windows show the mark dimmed while another one is talking, and pressing Play there moves playback over instead of starting a second copy.
- Playback stays in the editor. On macOS it runs through `afplay` — no Music.app, no extra tab.
- Transport is icon-only while playing: jump back, pause, stop, jump forward, replay.
- The logo mark animates between Play and Auto-read so you can spot the window that is talking — five solid capsules rippling out from the centre line. It settles into the static mark when paused and vanishes when idle.
- Each jump moves one part, so you can skip the preamble without losing the rest of the reply.
- Chat selections are not readable (webview). Auto-read captures the finished reply instead.

## Long form

Built for text that does not fit in one request — whole files, RFCs, and long agent dumps.

- Text is split into paragraph-sized parts before synthesis.
- Playback starts on part one while the rest is still generating, so there is no single-request timeout wall.
- Hover the jump arrows to see part *n* of *total*, and move through them one at a time.
- `vartermCursor.maxTotalTextChars` caps a single run (default 1,000,000 characters).

## Commands

- `Varterm: Toggle Auto-Read` — agent replies play when they finish.
- `Varterm: Read Editor/Selection Aloud` — selection first, otherwise the whole file.
- `Varterm: Read Clipboard Aloud` — speak whatever you copied.
- `Varterm: Read Last Agent Reply` — replay the last captured reply.
- `Varterm: Pause Playback` / `Resume Playback` / `Stop Playback` / `Replay Last Audio`.
- `Varterm: Select Read-Aloud Voice` — Edge and Premium voices.
- `Varterm: Set ElevenLabs API Key` — stored in secure extension storage.
- `Varterm: Connect` — only for a custom server or token.
- `Varterm: Open Settings` / `Customize Keyboard Shortcuts`.
- `Varterm: Clear Audio Cache` / `Save Last Audio as MP3`.

## Shortcuts

| Action | macOS | Windows / Linux |
|--------|-------|-----------------|
| Read clipboard | `⌘+Shift+⌥+L` | `Ctrl+Shift+Y` |
| Read editor / selection | `⌘+Shift+⌥+R` | `Ctrl+Shift+R` |

Change or remove them with **`Varterm: Customize Keyboard Shortcuts`**.

## Settings

Everything lives under `vartermCursor.*`:

- `readAloudVoice`, `readAloudRate`, `readAloudProvider` — voice, speed, Edge or Premium.
- `autoReadAgentOutput` — same as the status bar toggle.
- `showPlayingIndicator` — the animated meter in the status bar (default on).
- `resumeRewindMs` — how far resume rewinds after a pause (default 600ms) so no words are lost at the join.
- `maxCachedAudioFiles` (default 8), `maxCachedAudioAgeHours` (default 24; `0` keeps until the count limit).
- `requestTimeoutMs`, `requestRetries` — for very long passages.
- `elevenLabsApiKey` — plain-text fallback; the secure command is preferred.

## Build it yourself

```bash
npm install
npm run build
npm run package
```

MIT licensed. Source: [varterm/extensions](https://github.com/varterm/extensions).
