# Changelog

## 0.1.27 - 2026-08-25

### Added
- MIT `LICENSE` file in the VSIX so Open VSX can show the license on the listing.

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
