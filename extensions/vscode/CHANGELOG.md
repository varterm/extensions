# Changelog

## 0.1.49 - 2026-09-10

### Fixed
- **Play keeps the last file highlight.** Clicking the status bar used to drop the editor selection, so Play skipped the text you just marked. Chat and agent highlights still cannot be read — copy those, or use Auto-read.

## 0.1.48 - 2026-09-10

### Fixed
- **Auto-read is per window.** Turning it on or off in the status bar no longer writes the user setting, so other Cursor windows keep their own state.

## 0.1.47 - 2026-09-05

### Fixed
- **Voice preview no longer fires on every arrow key.** That stacked TTS requests, tore down playback, then re-generated the entire last reply when you pressed Enter — it felt like a hang after the first sample. Click the speaker on a voice to hear a short clip. Enter only saves that voice. The last read is re-generated only if something is already playing.

## 0.1.46 - 2026-09-05

### Fixed
- **Voice picker plays a preview** as you arrow through the list. Enter keeps that voice.
- **Speed and voice actually change the next listen.** Play used to replay the old MP3, so 1.5× and a new voice sounded the same. Changing either now re-synthesizes the current text.

## 0.1.45 - 2026-09-05

### Added
- **Speed menu from the status bar.** A `1×` chip sits to the right of the clipboard icon. Click it for 0.75×–2×, voice, and settings. Changing speed while something is playing re-reads it at the new rate.

## 0.1.44 - 2026-09-05

### Added
- **Read the highlight without copying.** Select text in the editor and click the status bar icon, or right-click **Read Selection Aloud**. The selection is spoken directly.
- **Read Errors & Warnings Aloud** — speaks diagnostics for the current file (or all files if no editor is focused).

### Changed
- Store listing now leads with highlight-to-listen. The first-run tip and empty-state copy no longer tell you to copy first.

## 0.1.43 - 2026-09-05

### Added
- **Clipboard icon in the status bar**, to the right of Auto-read. Click it to read the selection if you have one, otherwise the clipboard. It shows a selection mark when text is highlighted, and a clipboard when it will read what you copied.

## 0.1.42 - 2026-09-05

### Added
- **Speaker in the editor toolbar.** It reads the selection if you have one, otherwise the clipboard. Right-click the editor for Read Selection or Read Clipboard on their own.

## 0.1.41 - 2026-09-05

### Fixed
- **Auto-read comes back after clipboard or paste.** Reading copied or pasted text used to steal the speaker and never give it back: the next finished agent reply was cancelled by the clipboard read cleaning up, and Play kept replaying the paste. Clipboard and paste still interrupt whatever is playing — that is what you asked for — but the next finished reply takes the speaker again. You do not need to toggle Auto-read.
- **Read Last Agent Reply still finds the agent** after a clipboard or paste listen. Manual audio and agent audio are remembered separately, so a paste cannot hide the last reply.

### Changed
- Clipboard, pasted text, selection, and editor reads now replace the current clip immediately. No more “Wait / Cancel and start over” prompt when you already chose something else to hear.

## 0.1.40 - 2026-08-25

### Fixed
- **No more overlapping reads across windows.** Auto-read is claimed by one window, so every other window looked idle: its status bar still showed Play, and pressing it read the same reply a second time on top of the window already speaking. Windows now share who holds the audio. The others show the mark dimmed with "playing in another Cursor window", and pressing Play moves playback to the window you pressed it in rather than starting a second copy.
- **Pause actually pauses.** It used to suspend `afplay` with `SIGSTOP`, which does not stop the sound: `afplay` hands the clip to CoreAudio, so the audio played on while the process was frozen and whatever elapsed during the pause was lost. Pause now stops the player and remembers the position, and resume trims the part to that point and plays the remainder. Resume rewinds 600ms by default so nothing is clipped at the join; tune it with `vartermCursor.resumeRewindMs`.

### Changed
- The playing meter is now the logo mark itself: five solid capsules that grow out from a shared centre line. It ships as an icon font contributed by the extension, so the bars are solid strokes rather than braille dots, and every frame keeps the logo's tall-middle silhouette. Eight frames at 120ms, with a static logo mark when paused.
- The meter fills the icon box, so it reads a little taller than the surrounding status bar icons instead of sitting at 80% of the available height.
- Transport controls are grouped: jump back, play/pause, stop, jump forward, replay, meter, then the Auto-read toggle. Stop and the jump arrows used to be scattered around the Auto-read label, which split the controls into two halves.

## 0.1.39 - 2026-08-25

### Changed
- Playing meter sits between Play and Auto-read (reload after installing this VSIX).
- The meter is now five bars in the logo's silhouette with a wave running through them, at 140ms a frame. The earlier three-bar version only moved its middle glyph, so it read as one bar twitching instead of the mark equalizing.

## 0.1.38 - 2026-08-25

### Added
- A small animated meter in the status bar shows which window is playing. It sits between Play and Auto-read, dims to a flat bar when paused, and disappears when nothing is playing. Hover for the part number, click to pause. Turn it off with `vartermCursor.showPlayingIndicator`.

### Changed
- Playing meter uses a 3-bar mountain (logo inner bars) so it reads as vertical capsules and takes less status-bar width than a five-bar copy.
- `npm run publish:stores` accepts a stored `vsce login` when `VSCE_PAT` is unset, reads tokens from an untracked `.env.publish`, and prints a listing comparison after publishing. `npm run stores:status` shows the version and description each store is serving.

## 0.1.37 - 2026-08-25

### Fixed
- Extra Cursor windows can use the extension without writing user settings. Auto-read is stored in extension state if `settings.json` is locked.

## 0.1.36 - 2026-08-25

### Fixed
- Auto-read plays in only one Cursor window. Extra windows no longer start the same clip and echo.

## 0.1.35 - 2026-08-25

### Added
- **Auto-read** for the agent window: when on, a finished assistant reply plays aloud.
- Status bar **play / pause / stop / replay**, plus **jump** back or forward through remaining parts.

### Fixed
- Auto-read on/off toast is shorter so the full sentence is visible.

## 0.1.34 - 2026-08-25

### Fixed
- Jump forward now kills the current `afplay` process before starting the next part, so the old clip cannot keep playing underneath.

## 0.1.33 - 2026-08-25

### Fixed
- Jump forward now advances one remaining part per tap. Killing the current clip no longer races to the last track, and a single long clip is split into paragraph-sized parts.

## 0.1.32 - 2026-08-25

### Fixed
- Jump forward now steps through remaining chunks instead of skipping to the end of a single long clip.

## 0.1.31 - 2026-08-25

### Changed
- Status bar is icon-only while playing: pause, stop, replay, and jump back/forward. Mash jump to skip chunks.

## 0.1.30 - 2026-08-25

### Fixed
- Auto-read hook now uses an absolute script path so Cursor can find it from any workspace. It was never writing the last agent reply.
- Status bar Play reads the editor **selection** first. The bar shows whether you are hearing a selection, agent reply, or replay.

## 0.1.29 - 2026-08-25

### Fixed
- Extension starts when the window finishes loading, so Auto-read and Play/Pause show in the status bar without running a command first.

## 0.1.28 - 2026-08-25

### Added
- Status bar **Pause** (click while playing) and **Resume** (click while paused). **Stop** sits next to it.
- Commands: Pause Playback, Resume Playback, Replay Last Audio.
- One-time prompt to turn Auto-read on. A new assistant reply replaces in-progress audio instead of asking you to wait.

## 0.1.27 - 2026-08-25

### Added
- MIT `LICENSE` file in the VSIX so Open VSX can show the license on the listing.

### Changed
- Varterm TTS is listed on Open VSX. In Cursor or VS Code, open Extensions and search **Varterm TTS** — playback stays in the editor. GitHub Releases still has the `.vsix` if you prefer a manual install.

## 0.1.26 - 2026-08-25

### Changed
- Marketplace icon is now the official Varterm mark from varterm.com (512×512).

## 0.1.25 - 2026-08-25

### Changed
- Marketplace and in-editor copy no longer mention Cursor or agent readout. Listing is VS Code / editor TTS.

## 0.1.24 - 2026-08-25

### Added
- Status bar **Auto-read** toggle. When on, Varterm plays Cursor agent replies after they finish (`afterAgentResponse` hook).

## 0.1.23 - 2026-08-25

### Fixed
- Status bar speaker-with-X (`$(mute)`) only ran Stop, so clicks did nothing and it looked broken.
- It now shows a Play control: click to read clipboard, replay last audio, or stop. Playback uses `/usr/bin/afplay`.

## 0.1.22 - 2026-08-25

### Fixed
- Stopped opening an editor-tab webview player. Cursor was flashing it at the top of the editor and dismissing it before anything could play.
- Playback now uses macOS `afplay` in the background so you stay in the editor and actually hear audio.
- Status bar shows generating/playing. Click it or run **Varterm: Stop Playback** to stop.

## 0.1.21 - 2026-08-25

### Fixed
- Stopped waiting on `player.focus`, which flashed the top of the editor and could hang generation so retries said "already generating audio".
- Retry now offers **Cancel and start over** instead of getting stuck.
- Player opens as a visible split with Play / Pause / Stop. Press **Play** if you do not hear audio.

## 0.1.20 - 2026-08-25

### Fixed
- Playback now stays in Cursor: a bottom **Varterm / Player** panel with large Play / Pause / Stop / seek controls.
- Removed "open in default/system player" and the top input-box path that claimed audio was playing when nothing was audible.
- Native `<audio>` controls were clipped and easy to miss; custom controls are the player.

### Changed
- Paste text in the player panel and press **Read pasted text**. No toast, no Finder, no Music.app.

## 0.1.19 - 2026-08-25

### Fixed
- **Open in System Player** now launches the OS audio app (`open` on macOS) instead of Cursor's `openExternal`, which often did nothing for local MP3s.

### Changed
- Playback stays in the editor panel. The post-generation toast ("Reveal audio file") is gone.
- Generated audio is kept in memory. An MP3 is written only when you open the system player or save a file.
- Cache now auto-prunes by count (default 8) and age (default 24 hours). **Clear Audio Cache** reports how much space was freed.
- Player panel adds **Open in System Player** and **Save MP3…**.

## 0.1.18 - 2026-08-25

### Changed
- macOS default for **Read Clipboard** is now **`Cmd+Shift+Option+L`** (Listen) instead of `Cmd+Shift+Y`, which conflicts with macOS Stickies on many systems.
- macOS default for **Read Editor/Selection** is now **`Cmd+Shift+Option+R`** to reduce clashes with built-in editor shortcuts.

## 0.1.17 - 2026-08-25

### Added
- Default keyboard shortcuts (no manual binding required):
  - **Read Clipboard (agent output):** `Cmd+Shift+Y` (macOS) / `Ctrl+Shift+Y` (Windows/Linux)
  - **Read Editor/Selection:** `Cmd+Shift+R` / `Ctrl+Shift+R` when the editor is focused
- **`Varterm: Customize Keyboard Shortcuts`** — opens Keyboard Shortcuts filtered to Varterm so users can change or remove bindings
- Player panel **Shortcuts** section with a **Change or remove shortcuts…** button
- One-time tip on first install explaining the agent readout flow (copy → shortcut)

## 0.1.16 - 2026-05-20

### Fixed
- Aligned extension version with GitHub release tags so VSIX download URLs resolve correctly on varterm.com.

## 0.1.13 - 2026-05-08

### Fixed
- Reduced per-request Edge TTS chunk size to avoid long single-request generation timeouts.
- Increased default request timeout from 45s to 90s for long read-aloud operations.
- Updated default API base URL to `https://www.varterm.com` for direct endpoint access.

## 0.1.12 - 2026-05-08

### Fixed
- Improved in-editor audio playback reliability by switching webview playback from large data URIs to Blob URLs.
- Added playback error reporting and extension-side logging for autoplay/player failures.

## 0.1.11 - 2026-05-08

### Fixed
- Re-centered marketplace icon artwork so the Varterm mark is visually centered in store listings.

## 0.1.10 - 2026-05-08

### Changed
- Updated extension identity to match existing marketplace ID (`varterm-cursor`) for update compatibility.
- Renamed user-facing extension name to `Varterm TTS`.
- Refined marketplace description for TTS-first positioning.

## 0.1.9 - 2026-05-08

### Changed
- Updated marketplace metadata and keywords to focus on TTS/agent readout positioning.
- Updated extension branding assets (icon + gallery banner) to match Varterm green branding.

## 0.1.8 - 2026-05-04

### Fixed
- Prevented repeated autoplay loops/flicker by de-duplicating autoplay attempts in the player webview.
- Stopped automatic system-player launch; playback now stays editor-first unless user explicitly chooses "Open in default player".
- Updated autoplay-block handling to show an in-editor prompt instead of force-opening external audio.

## 0.1.6 - 2026-05-04

### Changed
- Removed `Ask AI` and ingest actions from command palette and player quick actions for a cleaner read-aloud-only workflow.
- Added `Varterm: Open Settings` command for quick access to extension settings.
- Updated player UI polish:
  - premium provider label now reads `Premium (ElevenLabs API key needed)`
  - normalized control heights so provider/voice controls align visually
  - removed bottom helper text
  - stronger autoplay retries and load behavior

## 0.1.5 - 2026-05-04

### Fixed
- Improved reliability when player failed to appear by simplifying panel targeting to always open beside current editor.
- Added stronger playback fallback by writing and opening a temp OS audio file automatically.
- Reduced duplicate/hidden playback failures by using a single shared panel creation path.

## 0.1.4 - 2026-05-04

### Changed
- Ensure player panel appears earlier with loading/error state screens while audio is being prepared.
- Added command and settings for audio cache management (`Varterm: Clear Audio Cache`, `vartermCursor.maxCachedAudioFiles`).
- Added single-flight audio generation guard to prevent duplicate "generating" flows.
- Added autoplay-block fallback message path to open latest audio in external player.

## 0.1.3 - 2026-05-04

### Changed
- Removed duplicate top speed input from player UI; speed now comes from the audio player's built-in control path.
- Added clearer helper text in player UI explaining `Ingest Editor` and `Ask AI`.
- Improved autoplay reliability by re-attempting playback when panel becomes visible and when audio reaches `canplay`.

## 0.1.2 - 2026-05-04

### Changed
- Improved split-column behavior for the player panel by anchoring to the active editor column and reopening in a side column.
- Strengthened autoplay attempts with multiple retries and clearer status messaging when browser autoplay policies block playback.
- Added automatic audio-cache pruning and configurable retention limit (`vartermCursor.maxCachedAudioFiles`).

### Added
- New command: `Varterm: Clear Audio Cache`.

## 0.1.1 - 2026-05-04

### Changed
- Bumped extension version to force a clean reinstall/update in VS Code/Cursor.
- Included latest player UX updates:
  - split-column persistent player
  - quick action buttons in player panel
  - single-track dropdown hidden for cleaner UI

## 0.1.0 - 2026-05-04

### Added
- Initial Cursor/VS Code extension scaffold for Varterm.
- Commands:
  - `Varterm: Connect`
  - `Varterm: Set ElevenLabs API Key`
  - `Varterm: Select Read-Aloud Voice`
  - `Varterm: Ingest Documents`
  - `Varterm: Ingest Active Editor`
  - `Varterm: Ask AI`
  - `Varterm: Read Editor/Selection Aloud`
  - `Varterm: Read Clipboard Aloud`
  - `Varterm: Clear Session`
- Secure token storage via `ExtensionContext.secrets`.
- File ingestion safeguards:
  - file count cap
  - per-file byte cap
  - total text cap
  - binary-file detection
- API reliability features:
  - request timeout
  - retries/backoff for `429`/`5xx`
  - cancellable ingest and ask flows
- Configurable extension settings:
  - request timeout
  - retry count
  - ingest chunk size and overlap
  - max ingest characters
  - ask context/chunk limits
- Source navigation:
  - source picker after answer
  - open source files and reveal highlighted ranges when provided.
- Read-aloud support:
  - synthesize and play active selection/document text
  - optional auto-read for Ask AI answers
  - compact in-editor mini player with track list for long content
  - player now opens in a split column and keeps context when hidden
  - added quick action buttons in player (Read Clipboard, Read Editor/Selection, Ask AI, Ingest Editor)
  - hidden track dropdown for single-track playback to reduce UI clutter
  - provider-aware voice selection (Edge and Premium when available)
  - editor/clipboard fallback path for Cursor agent-style content
  - clipboard-empty flow now prompts for manual paste input
  - automatic fallback to Edge voice if Premium playback fails due to missing ElevenLabs API key
  - premium requests now include optional extension-provided ElevenLabs key header

### Packaging
- Added VSIX packaging configuration and generated `varterm-vscode-0.1.0.vsix`.
