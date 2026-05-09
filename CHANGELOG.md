# Changelog

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
