# Varterm TTS

**Highlight text to hear it — nothing is copied.** Select a range in the editor and click the status bar icon, or right-click **Read Selection Aloud**. Flip on Agent Auto-read and finished replies play while you keep working. Click **1×** for speed and voice — preview a voice before you pick it. Play, pause, stop, jump from the status bar. MIT. No login.

## Install

Extensions panel → search **Varterm TTS** → **Install**. Works in Cursor (Open VSX) and VS Code.

Running many Cursor windows? Install **once for your user** — not **Install Workspace Extension**. Workspace installs only cover one folder, which is why the button seems to flip back and forth. Reload your other windows and you are done.

Prefer a file? Grab `varterm-cursor-*.vsix` from [GitHub Releases](https://github.com/varterm/extensions/releases) and run `Extensions: Install from VSIX...`.

**On Linux**, one MP3 player needs to be on your `PATH`: `ffplay` (from ffmpeg), `mpv`, `mpg123`, `mpg321`, `cvlc` (VLC), `gst-play-1.0`, or `play` (SoX). Installing ffmpeg covers it. Varterm takes the first it finds and checks before synthesising, so a missing player is named up front rather than surfacing as a failure once audio is ready. macOS and Windows need nothing installed.

More at [varterm.com/extensions](https://varterm.com/extensions).

## Highlight to listen

Select text **in a file** and press **Play**, or the selection / clipboard icon to the right of Auto-read. The highlight is read directly. Copy is only used when nothing is selected.

- Right-click a selection → **Read Selection Aloud**.
- The status bar icon turns into a selection mark while text is highlighted, and a clipboard when it will read what you copied.
- Click the **speed** chip (`1×`) at the end of that row for a menu: 0.75×–2×, voice, and settings. In the voice list, click the speaker to preview; Enter uses that voice.
- **Build plans.** Cursor’s plan view is not a text editor and often cannot copy. Press the selection button to hear the markdown file behind the plan (`~/.cursor/plans` or `.cursor/plans`). To hear a highlight only, open the plan with **Open With → Text Editor**. Chat and agent panels still need a copy, or Auto-read.

## Agent Auto-read

Click **Auto-read** in the status bar. When an agent reply **finishes**, it plays.

It changes the loop: send the prompt, go back to your file, and let the answer come to you. No parking on the chat panel watching tokens stream, no scrolling back up to find the one line that mattered — jump back and hear it again.

- One install covers every Cursor window; only the focused window speaks, so parallel agents never talk over each other. Other windows show the mark dimmed while another one is talking, and pressing Play there moves playback over instead of starting a second copy.
- Playback stays in the editor — no Music.app, no extra tab. macOS and Windows need nothing installed; Linux wants an MP3 player, covered under Install.
- Transport is icon-only while playing: jump back, pause, stop, jump forward, replay. A queue icon appears when something is waiting or you can go back. Auto-read joins the queue instead of cutting off the current listen.
- The logo mark animates between Play and Auto-read so you can spot the window that is talking — five solid capsules rippling out from the centre line. It settles into the static mark when paused and vanishes when idle.
- Each jump moves one part, so you can skip the preamble without losing the rest of the reply.
- Clipboard and pasted text interrupt whatever is playing. The next finished agent reply takes the speaker back — you do not need to toggle Auto-read.

## Long form

Built for text that does not fit in one request — whole files, RFCs, and long agent dumps.

- Text is split into paragraph-sized parts before synthesis.
- Playback starts on part one while the rest is still generating, so there is no single-request timeout wall.
- Hover the jump arrows to see part *n* of *total*, and move through them one at a time.
- `vartermCursor.maxTotalTextChars` caps a single run (default 1,000,000 characters).

## Voices and languages

66 neural voices across 29 languages. Pick one from the `1×` chip → **Voice**, or `Varterm: Select Read-Aloud Voice`, and preview it before committing. Each entry shows its locale and a short description, so typing a language name finds its voices.

Arabic, Bengali, Chinese (Simplified), Chinese (Traditional), Dutch, English (US, UK, Australia), Farsi, French, German, Hebrew, Hindi, Indonesian, Italian, Japanese, Korean, Malayalam, Polish, Portuguese, Romanian, Russian, Spanish, Swahili, Tamil, Telugu, Thai, Turkish, Ukrainian, Urdu, and Vietnamese.

Varterm reads, it does not translate — a Spanish voice reads Spanish text as written.

The list comes from the service rather than the extension, so voices added later show up without an update.

Voices are locale specific, and a mismatched one returns silence rather than an error. Hand an English voice a page of Chinese and Varterm names a voice that can read it instead of leaving you with a failure and nothing to act on.

## Commands

- `Varterm: Read Selection Aloud` — speak the highlight. Nothing is copied.
- `Varterm: Read Selection or Clipboard` — status bar icon: selection if you have one, otherwise clipboard.
- `Varterm: Read Editor/Selection Aloud` — selection first, otherwise the whole file.
- `Varterm: Read Clipboard Aloud` — speak whatever you copied.
- `Varterm: Read Errors & Warnings Aloud` — speak diagnostics for the current file.
- `Varterm: Toggle Auto-Read` — agent replies play when they finish.
- `Varterm: Read Last Agent Reply` — replay the last captured reply.
- `Varterm: Pause Playback` / `Resume Playback` / `Stop Playback` / `Replay Last Audio`.
- `Varterm: Reading Speed and Voice` — status bar speed chip: 0.75×–2×, voice, settings.
- `Varterm: Select Read-Aloud Voice` — 66 Edge voices across 29 languages, plus Premium.
- `Varterm: Set ElevenLabs API Key` — stored in secure extension storage.
- `Varterm: Connect` — only for a custom server or token.
- `Varterm: Open Settings` / `Customize Keyboard Shortcuts`.
- `Varterm: Clear Audio Cache` / `Save Last Audio as MP3`.

## Shortcuts

| Action | macOS | Windows / Linux |
|--------|-------|-----------------|
| Read editor / selection | `⌘+Shift+⌥+R` | `Ctrl+Shift+R` |
| Read clipboard | `⌘+Shift+⌥+L` | `Ctrl+Shift+Y` |

Change or remove them with **`Varterm: Customize Keyboard Shortcuts`**.

## Settings

Everything lives under `vartermCursor.*`:

- `readAloudVoice`, `readAloudRate`, `readAloudProvider` — voice, speed, Edge or Premium. Speed is also the `1×` chip on the status bar.
- `autoReadAgentOutput` — mirrored from the status bar. Off/On after restart comes from `~/.cursor/varterm-autoread.json`, so an update cannot turn it back on.
- `showPlayingIndicator` — the animated meter in the status bar (default on).
- `resumeRewindMs` — how far resume rewinds after a pause (default 600ms) so no words are lost at the join.
- `maxCachedAudioFiles` (default 8), `maxCachedAudioAgeHours` (default 24; `0` keeps until the count limit).
- `requestTimeoutMs`, `requestRetries` — for very long passages.
- `elevenLabsApiKey` — plain-text fallback; the secure command is preferred.
- `telemetry` — send crash and failed-read reports to Sentry (default on). Never includes the text you listen to. Also off when Cursor/VS Code telemetry is off.

## Build it yourself

```bash
npm install
npm run build
npm run package
```

MIT licensed. Source: [varterm/extensions](https://github.com/varterm/extensions).
