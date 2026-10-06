# Marketing

The listing is live and the copy below matches what ships. Send people to the
**Open VSX listing** for Cursor and the **VS Code Marketplace** for VS Code;
both install by searching "Varterm TTS" in the Extensions view. The `.vsix` on
GitHub Releases is a fallback, not the pitch.

- Open VSX (Cursor): https://open-vsx.org/extension/Varterm/varterm-cursor
- VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=Varterm.varterm-cursor
- Site: https://varterm.com/extensions/cursor

Before posting anywhere, run `npm run stores:status` in `extensions/vscode` and
make sure both stores are on the version the site links to. A post that lands
on a listing describing features the store build does not have is worse than
no post.

## The pitch (keep in step with `extensions/vscode/README.md`)

Store one-liner (this is `description` in `package.json`, shown under the title
on both stores):

> Text to speech for Cursor and VS Code. Hear agent replies read aloud as they
> finish, or highlight any text and listen. Speed, voice, and playback from the
> status bar. Free, MIT, no account.

Longer form:

Varterm reads Cursor and VS Code aloud. Turn on **Agent Auto-read** and
finished agent replies play while you keep working: send the prompt, go back
to your file, and the answer comes to you. Highlight text in any file and hear
it. Long replies split into parts you can jump through, so
you skip the preamble instead of scrolling the chat. Markdown is stripped
before speech. Open several projects and every window feeds one reading queue,
so parallel agents never talk over each other. 66 free neural voices across 29
languages, or bring your own ElevenLabs key. macOS and Windows need nothing
installed; Linux wants ffmpeg or another MP3 player. MIT licensed, no account.

Things not to claim:

- "Only the focused window speaks." That was 0.1.37–0.1.65. Since 0.1.66 it is
  a shared queue: whichever window is free reads the next reply, in order.
- Accounts, sign-in, or a library. There is none.
- Offline or on-device voices. Those are the web app (Piper), not the editor.
- A paid tier. ElevenLabs in the editor is your own key, billed by ElevenLabs.
- "No copy" / "nothing is copied". That contrasted with a clipboard step
  removed in 0.1.47. New readers have no idea what it means; lead with what the
  product does.

## Where to post

- [ ] **r/cursor: [Is there any way to use text to speech to have cursor read out the output?](https://www.reddit.com/r/cursor/comments/1ixzslm/is_there_any_way_to_use_text_to_speech_to_have/)**
      This is the one to hit first. The question is exactly Agent Auto-read:
      hear the agent's reply (not the code) so you can look at the code it just
      wrote instead of the chat. Reply with the pitch above, link to the Open
      VSX listing, and mention the one-user-install note for people running
      many windows.
- [ ] r/vscode and r/ChatGPTCoding once the r/cursor reply has been up a few
      days, same copy with the Marketplace link first.
- [ ] Cursor forum (forum.cursor.com) "Showcase" category.
- [ ] A short clip for the site and the store listing: select text, hear it;
      send a prompt, go back to the file, reply reads itself; jump past the
      preamble. Under 30 seconds, no narration.

## What a release post needs

Each release that changes behaviour gets a news post in the platform repo
(`varterm-plat/content/news/editor-X-Y-Z.md`). Give it a date later than the
previous post so it sorts to "Latest" on the home page; two posts on the same
date tie and the older one can win.
