# Varterm TTS Chrome Extension

Read any web page, YouTube transcript, or AI chat aloud with natural AI voices. Select text and listen instantly.

## Features

- **Floating Button** - Select text and click the 🔊 button to read
- **Context Menu** - Right-click to "Read with Varterm"
- **Keyboard Shortcuts** - `Alt+Shift+R` to read selection (Chrome uses Ctrl+Shift+R to reload)
- **Read Entire Page** - Right-click on page → "Read entire page"
- **Listen To A Video** - On a YouTube video, read the transcript, search it, and jump to any moment
- **Listen To AI Chats** - Optionally auto-read assistant replies on the chat sites you grant
- **Jump and speed** - Skip a part, pick 0.75×–2×, and change voice from the popup or the panel
- **Reader Panel** - Follow the words as they are spoken, search them, and jump anywhere

## The reader panel

Anything longer than a short selection opens a panel beside the page showing the
text being read. The part being spoken is highlighted and scrolls itself into
view, so you can follow along.

- **Search** - type to filter to matching lines, with hits highlighted. This
  searches the whole text, not just the part being read: results stay grouped
  under the part they came from, and the counter says how many parts matched.
  On a YouTube transcript the box says "Search this transcript". `Enter` moves
  to the next hit, `Shift+Enter` to the previous.
- **Jump** - click any line to read from there. Handy for skipping the
  introduction of a long talk.
- **Jump the video** - on a video page, click a line's timestamp to move the
  player to that moment. Search for a phrase, then press its timestamp to go
  straight to that point in the video. The video is not started or stopped, so
  it will not talk over the voice.
- **Skip and scrub** - step a part at a time, or drag the bar to move within the
  part being spoken. Parts are drawn as dividers in the list, so you can see
  what the skip buttons are stepping through, and clicking a divider jumps to it.
- **Pause** - in the panel, in the popup, or `Ctrl+Shift+U`.
- **Voice and speed** - behind the gear in the panel header, so you do not have
  to reopen the popup. Changing either re-reads the current part.
- **Collapse and resize** - collapse to a compact player with the `-` button, or
  drag the panel's left edge. Both are remembered.

Parts you have already heard are kept, so jumping back replays immediately
rather than generating the audio again.

One caveat on timestamps: while an ad is playing it uses the same video element,
so the panel will say to wait for the ad rather than wind the ad forward.

## Listening to a video

On any YouTube video that has captions, right-click the page and choose
**Read this video transcript**, or open the extension and press **Read Video
Transcript**. Varterm opens the transcript YouTube already provides, strips the
`[Music]`-style cues, and reads the words. The reader panel stays open so you
can search the whole transcript, click a line to hear from there, or click a
timestamp to jump the video to that moment.

Two things are worth knowing:

- **It reads, it does not translate.** You hear the transcript in whatever
  language the captions are in. If you want another language, switch the
  transcript language in YouTube's own panel first.
- **No captions means no transcript.** YouTube only offers a transcript when the
  video has captions, so a video without them cannot be read.

Long videos are read in parts. An hour-long talk is roughly 46,000 characters,
which is split at sentence boundaries and fetched a part ahead so playback does
not pause between them. `Ctrl+Shift+S` stops the whole thing, not just the part
currently playing.

## Listening to AI chats

Tick a site under **Read AI replies** in the extension popup to hear each
assistant reply in a Varterm voice as it finishes. Chrome asks for access to
that site at that point, not at install. Untick it, or revoke the site access
in Chrome, and it stops.

The popup lists each site you can grant. Without turning auto-read on, there
is still a small Varterm button on each
reply for reading one on demand. Right-clicking the page and choosing
**Read the last reply** does the same thing.

Some details worth knowing:

- **Code blocks are skipped.** Hearing punctuation and brackets read out is
  rarely useful, so only the prose is spoken.
- **Extended thinking is skipped**, along with tool-use chrome. You hear the
  reply, not the machinery behind it.
- **Replies already on screen stay silent.** Switching the feature on mid
  conversation does not read the backlog, only what arrives next.
- **Long replies open the reader panel**, so search, jump, and scrubbing all
  work the same way they do for a page or a transcript.

## Installation

### From Chrome Web Store
Install from the Chrome Web Store (listing URL when published).

### Manual Installation (Developer Mode)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `extensions/chrome` folder

## Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Read selection | `Alt+Shift+R` | `Option+Shift+R` |
| Pause / resume | `Ctrl+Shift+U` | `Cmd+Shift+U` |
| Stop speaking | `Ctrl+Shift+S` | `Cmd+Shift+S` |

## Settings

Click the extension icon to access settings:

- **Voice Tier** - Cloud (best quality) or Browser (offline)
- **Voice** - Choose from multiple neural voices
- **Speed** - 0.75×–2× chips, or drag 0.5×–2×
- **Jump** - Back / ahead one part while something is playing
- **Strip Markdown** - Remove formatting for cleaner speech
- **Read AI replies** - Per-site auto-speak, off until you grant that site

## Voice Options

| Voice | Accent | Style |
|-------|--------|-------|
| Aria | US | Friendly, natural |
| Jenny | US | Warm, clear |
| Guy | US | Casual |
| Davis | US | Calm, professional |
| Sonia | UK | Warm |
| Ryan | UK | Professional |
| Natasha | AU | Friendly |

## Privacy

- Text you choose to read is sent to `varterm.com` to be turned into audio, and
  is not stored afterwards
- Nothing is sent anywhere until you ask for something to be read
- The extension contains no analytics and no tracking of any kind
- Browser voice mode never sends your text off the machine

## Building for Store

```bash
cd extensions/chrome
./package.sh
```

## Tests

The first two need no browser and run in milliseconds.

```bash
node tests/chunking.test.mjs     # long text splits without losing or repeating words
node tests/wiring.test.mjs       # message actions, menu ids, popup ids, packaged files
node tests/claude-dom.test.mjs   # the claude.ai reader, against a real DOM
node tests/chats-dom.test.mjs    # ChatGPT / Kimi / Gemini extractors, against fixtures
node tests/isolation.test.mjs    # one site's helper cannot disturb another's
```

`isolation.test.mjs` exists because YouTube and claude.ai each get their own
helper file but share the whole of `content.js`. A page only ever receives the
helper for the site it is on, so every reference `content.js` makes to the other
site's helper has to be inert rather than throwing. It loads each page's exact
injection list into a real browser and checks that, including that the Claude
button poll never starts anywhere but claude.ai.

`claude-dom.test.mjs` drives headless Chrome over the DevTools protocol, using
the WebSocket built into Node, so it still needs no dependencies. claude.ai
requires a login and cannot be visited by a test, so it rebuilds the page shapes
claude.ai is known to serve and runs the extractor against those. It skips
itself if no Chrome is installed; set `CHROME` to point at a specific binary.

## Links

- [Varterm Web App](https://varterm.com)
- [Extensions Setup Guide](https://varterm.com/extensions)
- [GitHub](https://github.com/cntrlne/varterm)

## License

MIT
