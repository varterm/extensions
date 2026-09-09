# Submitting to the community marketplace

Everything the submission needs is written out below. Two steps need you rather
than a script, and they are marked.

## The process changed

The plan assumed a pull request against `anthropics/claude-plugins-community`.
That repository is now a read-only mirror, synced nightly from an internal
review pipeline, and it closes pull requests automatically. Submissions go
through a form instead:

- Console, for individual authors: `platform.claude.com/plugins/submit`
- claude.ai, needs a Team or Enterprise org with directory management access:
  `claude.ai/admin-settings/directory/submissions/plugins/new`

Approved plugins are pinned to a commit SHA, and CI moves the pin forward as you
push. The public catalogue syncs nightly, so there is a lag between approval and
the plugin appearing.

## Before submitting

**Update Claude Code.** The installed CLI is 0.2.53, which has no `plugin`
subcommand at all, so `claude plugin validate` cannot run and instead opens an
interactive session with the command as its prompt. Run `claude update` first.

Then, from the repository root:

```bash
claude plugin validate ./plugins/claude-code
```

The review pipeline runs this same check, so a local pass is worth having before
you submit. `node plugins/claude-code/tests/plugin.test.mjs` already covers the
manifest, hook, and marketplace wiring, but it is our test, not theirs.

**You need to commit and push.** Submissions are pinned to a commit SHA, so the
plugin has to exist on `main` at `github.com/varterm/extensions` before the form
will resolve it. The repository is already public, which is the other
prerequisite.

## Form answers

**Repository:** `https://github.com/varterm/extensions`

**Source type:** `git-subdir`, since the plugin is not at the repository root.
Around 400 of the approved entries use this form.

```json
{
  "source": "git-subdir",
  "url": "varterm/extensions",
  "path": "plugins/claude-code",
  "ref": "main"
}
```

**Plugin name:** `varterm`

**Homepage:** `https://varterm.com`

**Description:**

> Reads Claude's replies aloud as they finish, in a natural neural voice. No
> model download, no Python, and no API key: the text goes to Varterm's hosted
> synthesis and the audio comes straight back, so it works the moment it is
> installed. Over a hundred languages through Microsoft neural voices, set with
> `/varterm:voice`. Code blocks are dropped rather than spoken, reading happens
> in a detached process so the Stop hook never holds up your turn, and two
> sessions finishing at once will not talk over each other. The same voice reads
> for you in Cursor, VS Code, and the browser.

## What the reviewer will look at, and the honest answers

**It sends text to a server.** Each reply goes to
`https://www.varterm.com/api/edge-tts`, which returns MP3 bytes. Nothing is
stored and nothing trains a model. The audio is never executed. `/varterm:off`
stops it entirely, and the README says all of this plainly.

**It runs a hook on every turn.** The `Stop` hook parses stdin, decides in a few
milliseconds, and hands off to a detached process. It is wrapped so that no
input can make it throw, and `tests/plugin.test.mjs` runs it against malformed
payloads to prove that. A hook that crashes would interrupt the session, which
is the worst thing a plugin like this can do.

**It writes outside the plugin directory.** Two places, both explained in the
code: `~/.varterm/claude-code.json` for settings, because `/varterm:on` and
`:off` run through Bash and do not receive the plugin's own environment; and
`~/.varterm/claude-code-playing.json` as the cross-session lock.

## Positioning

`voice-bridge` is already in the catalogue and is the closest thing to this: a
`Stop` hook, edge-tts, free, no key. There are also `claude-voice-cue`,
`tts-attention-alert`, and `bells-and-whistles`, though those announce rather
than read.

So this is not an empty niche, and the submission should not pretend otherwise.
What is actually different:

- One voice across Cursor, VS Code, Chrome, and the CLI. The others are CLI only.
- Nothing to install. `voice-bridge` is free by default too, but its better
  engines want a key or a local model.
- Two sessions cannot talk over each other. Worth checking whether the others
  handle this; it is a real problem once you run more than one session.
- The `Stop` hook returns immediately rather than blocking while audio plays.
