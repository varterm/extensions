# Varterm for Claude Code

Reads Claude's replies aloud as they finish.

Claude Code has no read-aloud of its own, and the alternatives run a local model
you have to download first. This posts the reply to Varterm's hosted synthesis
and plays what comes back, so there is nothing to install beyond the plugin, no
Python, no model weights, and no GPU. It is the same voice Varterm uses in the
editor extension and the browser extension.

## Install

```bash
claude plugin marketplace add varterm/extensions
claude plugin install varterm@varterm
```

Or point Claude Code at a local checkout:

```bash
claude --plugin-dir /path/to/varterm/extensions/plugins/claude-code
```

You need Node 18 or later, and something that can play an MP3. macOS already
has `afplay`. On Linux, any of `ffplay`, `mpv`, `paplay`, or `aplay` will do.
Run `/varterm:status` to see which one was found.

## Use

Reading is on once the plugin is enabled. The commands are there to change that:

| Command | What it does |
| --- | --- |
| `/varterm:on` | Read replies aloud |
| `/varterm:off` | Stop reading replies |
| `/varterm:stop` | Silence what is being read right now, without switching off |
| `/varterm:voice` | Show or set the voice, for example `/varterm:voice en-GB-RyanNeural` |
| `/varterm:status` | What everything is set to, and whether audio can play at all |

Voice, speaking rate, and the length past which a reply is skipped can also be
set through the plugin's own configuration, which `/plugin` will prompt for. Any
Microsoft neural voice id works, which covers over a hundred languages.

## What gets read

Code blocks are dropped, because listening to brackets and punctuation is not
useful. So are heading marks and link URLs; the link text is kept. Replies over
4,000 characters are skipped by default rather than read at length, which is
adjustable.

Two Claude Code sessions finishing at the same moment would talk over each
other, so a session that finds another one already speaking stays quiet instead
of interrupting. The lock is checked against the process, not a timeout, so a
session that was killed mid-sentence does not leave everything muted.

Reading happens in a detached process, so the reply is still being read while
you type the next prompt. The `Stop` hook itself returns immediately and holds
nothing up.

## Privacy

The reply text is posted to `https://www.varterm.com/api/edge-tts`, which
returns audio. It is not stored and not used to train anything. Nothing else
leaves the machine, and the plugin has no analytics. Turn it off with
`/varterm:off` and nothing is sent at all.

## Tests

```bash
node tests/plugin.test.mjs
```

No network and no Claude Code needed. The `Stop` hook is run for real against
fabricated payloads, with the player replaced by a stub, so the checks cover
what it actually does rather than what the code looks like: that it reads a
finished reply, stays silent when switched off or looping, skips a reply that is
only code, and survives malformed input without throwing. A hook that crashes
would interrupt the session, so that last one matters most.
