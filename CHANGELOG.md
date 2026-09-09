# Changelog

## 0.1.47 - 2026-09-05

### Fixed
- **Voice preview no longer fires on every arrow key.** Click the speaker on a voice to hear a short clip. Enter only saves that voice. The last read is re-generated only if something is already playing.

### Chrome 1.4.2
- Searchable video transcripts, jump and speed chips, and optional per-site auto-read of new AI chat replies. Read shortcut is Alt+Shift+R.

## 0.1.46 - 2026-09-05

### Fixed
- Voice picker previews as you move through the list. Speed and voice changes re-synthesize instead of replaying the old clip.

## 0.1.45 - 2026-09-05

### Added
- **Speed menu from the status bar.** Click the `1×` chip for 0.75×–2×, voice, and settings. Changing speed mid-read re-synthesizes at the new rate.

## 0.1.44 - 2026-09-05

### Added
- **Read the highlight without copying.** Select text and click the status bar icon, or right-click Read Selection Aloud.
- **Read Errors & Warnings Aloud** for the current file.

### Changed
- Marketplace and Open VSX short description now leads with highlight-to-listen.

## 0.1.43 - 2026-09-05

### Added
- **Clipboard icon in the status bar**, right of Auto-read. Selection if you have one, otherwise the clipboard.

## 0.1.42 - 2026-09-05

### Added
- **Speaker in the editor toolbar.** Selection if you have one, otherwise the clipboard. Right-click for each action on its own.

## 0.1.41 - 2026-09-05

### Fixed
- **Auto-read comes back after clipboard or paste.** Reading copied or pasted text used to cancel the next agent reply while it cleaned up, so Auto-read looked stuck on until you reloaded. The next finished reply takes the speaker again. **Read Last Agent Reply** still finds the agent after a manual listen.

### Changed
- Clipboard, pasted text, selection, and editor reads replace the current clip immediately instead of asking you to wait.

## Claude Code plugin 0.1.0 - 2026-09-01

### Added
- **A Claude Code plugin that reads replies aloud.** Claude Code has no read-aloud of its own, and the alternatives run a local model you download first. This posts the reply to Varterm's hosted synthesis and plays what comes back: nothing to install, no Python, no weights, no key. `/varterm:on`, `:off`, `:stop`, `:voice`, and `:status` control it, and any Microsoft neural voice id works, which covers over a hundred languages.
- This repository is now a Claude Code plugin marketplace, so `claude plugin marketplace add varterm/extensions` installs it. `plugins/claude-code/SUBMISSION.md` covers getting it into the public community catalogue.

### Notes
- The `Stop` hook hands the text to a detached player and returns immediately. Reading a paragraph inline would leave you unable to type for as long as it took to say it, since a Stop hook holds up the turn while it runs.
- The reply text comes from `last_assistant_message` rather than the transcript file, which the hooks reference recommends for exactly this: the transcript is written asynchronously and may not hold the final message yet.
- Two sessions finishing at once would talk over each other. The cross-window lock from the editor extension is ported here with one deliberate change: an editor window claims playback because you pressed Play, so the last claim should win, whereas here nobody pressed anything, so a session that finds someone already speaking stays quiet instead of interrupting.
- `voice-bridge` already does something close to this in the community catalogue, also free and also on edge-tts. The differences worth claiming are one voice across Cursor, the browser, and the CLI, the non-blocking hook, and the cross-session lock. Recorded in `SUBMISSION.md` rather than overstated in the listing.
- The submission route in the plan is gone: `anthropics/claude-plugins-community` is a read-only mirror now and closes pull requests automatically. Submissions go through a form and are pinned to a commit SHA.

## Chrome 1.3.0 - 2026-09-01

### Added
- **Claude replies read in a Varterm voice.** Claude has its own Read Aloud button; this reads the same replies in whichever voice you picked. Tick "Read Claude replies aloud" in the popup and each reply is spoken as it finishes. There is also a small Varterm button under every reply, beside Claude's own controls, and a "Read the last reply" right-click action, both of which work whether or not the automatic reading is on.
- Long replies open the reader panel, so search, jump, scrubbing, pause, and the voice and speed controls all work on a Claude reply exactly as they do on a page or a transcript.
- `tests/claude-dom.test.mjs`, which runs the reader against a real DOM. claude.ai needs a login and cannot be visited by a test, so the page shapes it is known to serve are rebuilt as fixtures and driven in headless Chrome over the DevTools protocol. Still no dependencies: Node's built-in WebSocket does the talking, and the test skips itself where Chrome is absent.

### Notes
- **Nothing changes for anyone who does not want this.** Access to claude.ai is an optional permission, so installing and upgrading ask for nothing new. Chrome requests it at the moment the feature is switched on, and revoking it in Chrome's settings unregisters the reader rather than leaving it half-connected.
- Replies already on screen are marked as read without being spoken, so turning the feature on part way through a conversation does not read the backlog aloud.
- Code blocks, extended thinking, and tool-use chrome are left out. What is spoken is the prose.
- The completion signal is the `data-is-streaming` flag claude.ai puts on each turn, which flips to `false` when a reply finishes, rather than a guess based on when the text stops changing. Several independent open-source integrations rely on the same flag, which is the best evidence available that it survives a redeploy; the send button turning into a stop control is kept as a fallback. Reply bodies are matched against three known shapes for the same reason.
- A detached clone is not rendered, so `innerText` on one quietly becomes `textContent` and glues the end of one paragraph to the start of the next. Block boundaries are marked before the text is flattened. The DOM test covers this, having caught it.

## Chrome 1.2.0 - 2026-08-31

### Added
- **A reader panel showing the words being spoken.** Long text now opens a panel listing every line, with the part currently being read highlighted and scrolled to. Video transcripts keep their timestamps, so the panel reads like the transcript on the video.
- **Search the whole text, not the part being read.** Type in the panel to filter every line to the matches, with hits highlighted; Enter walks through them, Shift+Enter walks back. Results stay grouped under the part they came from and the counter reads like `12 of 189 in 14 parts`, so it is clear the search covered all of it. Verified on a 532-line talk: searching one word matched 189 lines spread across all 14 parts.
- **Jump to that point in the video.** On a video page the timestamps in the panel are clickable, so a line found by searching is also a place in the video. The player's play state is left alone, since starting it would talk over the voice.
- **Jump anywhere in the text.** Click any line to read from there. Because a part is one audio file, the click lands where the line falls inside the part rather than restarting it. Skip forward and back a part at a time, or drag the scrub bar to move within the part being spoken.
- **Parts are visible.** The list is divided by the parts the transport steps through, and each divider is a jump. Previously the buttons stepped through something nothing on screen showed.
- **Voice and speed moved into the panel**, behind the gear. Changing either re-reads the current part in the new voice and drops the audio generated in the old one.
- **The panel collapses and resizes.** Collapse leaves a compact player and gives the page back; drag the left edge to set the width. Both are remembered.
- **Pause now has somewhere to press.** It existed but nothing exposed it. There is now a button in the panel, one in the popup, and `Ctrl+Shift+U` (`Cmd+Shift+U` on a Mac).
- Parts already played are kept, so jumping backwards replays instantly instead of re-synthesizing. The cache is capped so an hour-long transcript does not sit in memory in full.

### Changed
- Parts are 1,500 characters rather than 4,000. Parts are the unit you jump to, so large ones meant a coarse jump and a slow first word.
- The popup closes itself once a button has done its job. It opens under the toolbar icon, which is exactly where the reader panel sits, so it was covering the thing it had just opened. It stays open on an error, since then there is something to read.
- The voice list lives in one file shared by the popup and the panel, instead of being written out twice in markup. Voice names Microsoft has retired are mapped to what actually plays, so a saved preference does not leave the picker blank.
- The panel scrollbar is a thin unobtrusive track rather than the platform default.

### Fixed
- The panel and the floating button no longer use `innerHTML`. Pages that enforce Trusted Types, YouTube among them, reject it outright, which would have broken the panel on the exact page it matters most and was already breaking the floating button there.
- The panel renders in a shadow root, so page stylesheets cannot restyle it and its own styles cannot leak onto the page. Verified on a YouTube watch page.
- Line text is only ever inserted as text nodes, including while search rebuilds a line to highlight matches, so caption text that looks like markup stays text.
- Clicking a timestamp while an ad is playing says so rather than appearing to do nothing. Ads play through the same `<video>` element, so the seek was landing on the ad and clamping to its length. Confirmed against a pre-roll: a request for 20:33 stopped at the ad's 15-second mark.

## Chrome 1.1.0 - 2026-08-31

### Added
- **Listen to a YouTube video.** Right-click a video and choose "Read this video transcript", or press the button in the popup, and Varterm reads the transcript aloud. Timestamps and `[Music]`-style cues are dropped, and lines that auto-captions repeat while the speaker finishes them are collapsed. It reads the captions as they are and does not translate them.
- Long text is now read in parts instead of one request. An hour-long talk runs to about 46,000 characters, which no single request can carry, so text is split at sentence boundaries and the next part is fetched while the current one plays. Stopping now cancels the parts still queued rather than only the one being spoken.
- Tests, which the Chrome extension had none of: `tests/chunking.test.mjs` covers splitting long text without losing or repeating words, and `tests/wiring.test.mjs` checks that message actions, context menu ids, popup element ids, and packaged files still line up.

### Notes
- Captions cannot be fetched from YouTube's `timedtext` API any more. It requires a proof-of-origin token minted by the player and answers an unsigned request with an empty HTTP 200, which is why this reads the rendered transcript panel instead. Verified from inside the page with credentials: still empty.
- YouTube currently ships two different transcript panels and which one a session gets varies, so both are handled. The older selectors alone return nothing on the newer panel.
- No new permissions. `activeTab` already covers a video page when you invoke the extension.

## 0.1.40 - 2026-08-25

### Security
- `.vscodeignore` now excludes `.env*`, `*.pem` and `*.key`. `.gitignore` keeps credentials out of git but says nothing about the VSIX, and `vsce` packages the extension folder wholesale, so a publishing token stored next to `package.json` was being built into the extension. The publish script also refuses to upload a VSIX containing credential-looking files, and credentials should now live in `~/.varterm-publish.env`, outside the packaged folder.

### Added
- `npm run publish:ovsx` releases to Open VSX on its own. Credentials are now only required for the stores actually being published, so Cursor users can be shipped to without an Azure DevOps token, leaving the Marketplace listing to a manual VSIX upload.

### Fixed
- **Pause actually pauses.** Suspending `afplay` never stopped the sound, because the clip is already handed to CoreAudio, so audio kept playing and was lost. Pause now stops the player and remembers the position; resume picks up where it left off with a small rewind.

### Changed
- The playing meter is the logo mark itself now: five solid capsules growing out from a centre line, shipped as an icon font so the bars are solid strokes instead of braille dots.

## 0.1.39 - 2026-08-25

### Changed
- Playing meter sits between Play and Auto-read, and is now five bars in the logo's silhouette with a wave running through them. Install this VSIX and reload to see it.

## 0.1.38 - 2026-08-25

### Added
- A small animated meter in the status bar shows which window is playing. It sits between Play and Auto-read. Flat bar when paused, gone when idle, hover for the part number.

## 0.1.37 - 2026-08-25

### Fixed
- **Agent Auto-read runs in one window.** With several Cursor windows open, the focused window claims the reply and the rest stay quiet, so audio no longer echoes.
- Extra windows work without write access to user `settings.json`. Auto-read falls back to extension state when the file is locked.
- Jump forward advances one part per tap instead of skipping to the end.
- Long replies split into paragraph-sized parts, and playback starts on part one while the rest generates.

## 0.1.35 - 2026-08-25

### Added
- **Auto-read** for the agent window: when on, finished assistant replies play aloud.
- Status bar **play / pause / stop / replay** and **jump** back or forward through remaining parts.

### Fixed
- Auto-read hook uses an absolute path so Cursor finds it from any workspace.
- Status bar and Auto-read appear when the window loads.
- Play prefers the editor selection. Jump stays on the next remaining part.
- Auto-read on/off toast shows the full sentence.

## 0.1.27 - 2026-08-25

### Added
- MIT license file in the VS Code / Cursor VSIX for the Open VSX listing.

### Changed
- Editor extension is on Open VSX. Search **Varterm TTS** in the Extensions panel. GitHub Release `v0.1.27` also ships the `.vsix`.
- Marketplace icon matches the varterm.com mark.

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
