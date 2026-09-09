# Chrome Web Store Submission Copy

Use this content in the Chrome Web Store listing for `Varterm TTS - Text to Speech`.

Version this package: **1.4.2**

**Do not paste brand catalogs into the public description.** Draft 1.4.0
was rejected (Yellow Argon / Spam and Placement) for listing
`ChatGPT, Claude, Kimi, Gemini, Grok, Perplexity, DeepSeek` as keywords.
Product names belong in the reviewer notes and permission boxes only.

## Short Description

Read pages, YouTube transcripts, and AI chats aloud. Search, jump, change speed, and hear new replies as they arrive.

(117 characters. Chrome’s limit is 132. The manifest description matches this.)

## Detailed Description

Paste only this block into the store **Description** field. Do not append
the permission or review-notes sections.

Varterm TTS helps you listen instead of reading walls of text.

Use it to read selected text, full web pages, long-form articles, docs, markdown-heavy AI output, a video transcript, and replies in an AI chat, directly in Chrome.

### Why users install Varterm

- Listen to a video's transcript instead of watching it, then search that transcript and jump to the moment you need
- Hear AI chat replies read out in a voice you picked, as each new reply finishes
- Follow the words in a reader panel, search them, and jump to any line
- Jump back or ahead, and change voice or speed, without stopping
- Markdown-friendly reading for cleaner speech output
- Natural cloud voices plus browser built-in voice support
- One-click selection reading with floating button and context menu
- Keyboard shortcuts for fast read, pause, and stop

### Core Features

- Read selected text aloud instantly
- Read full page content
- Read the transcript of the YouTube video you are watching, with timestamps and sound cues removed
- Search that transcript in the reader panel: type a phrase, skip to the hit, click its timestamp to jump the video
- Optionally read AI chat replies in your own voice, automatically as each one lands, or from a button on a reply. Off until you turn it on for that site
- Reader panel showing the text as it is spoken, with the current passage highlighted
- Search the text and jump straight to any line instead of listening through to it
- Pause, resume, jump back or ahead, or scrub within the passage being read — from the popup or the panel
- Voice and speaking-speed controls in the popup (preset chips from 0.75× to 2×) and behind the panel gear
- Context menu action: "Read with Varterm"
- Keyboard shortcuts for read, pause, and stop
- Markdown stripping for cleaner audio
- Long text is read in parts, with no pause between them

### Best for

- Talks, lectures, and long videos you would rather hear than watch
- Finding one moment in a long transcript without scrubbing the video
- Listening to AI answers while you keep working
- Docs and technical articles
- Accessibility and focus workflows
- Hands-free review while multitasking

### About video transcripts

Varterm reads the transcript YouTube already publishes for the video you are watching, in the language the captions are in. It does not translate, and a video without captions has no transcript to read.

The transcript opens in the reader panel so you can:

- Follow the words as they are spoken
- Search the whole transcript, not just the part currently playing
- Click a line to hear from that sentence
- Click a timestamp to jump the video to that moment (the video is not started or stopped, so it will not talk over the voice)

It does not use YouTube's API, does not download the video, and does not capture audio. It reads the transcript text already shown on the page.

### About reading AI chat replies

This is off until you switch it on for a site, and Chrome asks for access to that site at that moment rather than at install. Varterm reads the reply text already on screen and speaks it in the voice you picked. Code blocks are skipped, since listening to code is rarely useful. Revoking the site access in Chrome turns that site's feature off again.

Replies already on screen stay silent when you enable it — only new replies are read.

## Category

Productivity

## Support URL

https://varterm.com/extensions

## Website

https://varterm.com

## Privacy Policy URL

https://varterm.com/privacy

## Data Disclosure

Undeclared data transmission is the most common reason an extension is
rejected, and this extension does send text off the device, so answer the
Privacy practices tab carefully.

**Privacy policy URL:** `https://varterm.com/privacy`

**Data collected — tick "Website content" and nothing else.** When you ask for
something to be read, the text of that selection, page, transcript, or chat
reply is sent to `https://www.varterm.com/api/edge-tts`, which returns audio.
Nothing is sent until you ask for something to be read, or until you switch on
reading a site's replies and grant access to that site.

Do not tick any other category. The extension collects no personally
identifiable information, no authentication information, no location, no
financial data, no health data, no personal communications, and no activity
history. It contains no analytics and no tracking code of any kind.

**Certifications — all three can be affirmed truthfully:**

- Data is not sold or transferred to third parties outside approved use cases.
- Data is not used or transferred for purposes unrelated to the single purpose.
- Data is not used or transferred to determine creditworthiness or for lending.

**Worth stating plainly in the listing:** text is used only to generate the
audio you asked for, it is not stored afterwards, and it is not used to train
models. Selecting the browser voice tier keeps synthesis on the device, so
nothing is transmitted at all.

## Host permission justification — paste this

This is the only text for the **Host permission** input. Copy the block
as-is. Do not add site names or URLs.

```
www.varterm.com/api is the extension's own text-to-speech endpoint. It turns the text the user asked to hear into audio. That is the only host contacted at install.

Optional hosts are requested later, only if the user turns on auto-read for an AI chat they already have open. Each grant is that one site. The extension reads reply text already on screen and sends it to the same endpoint. Revoking Site access turns that site off.
```

If the console shows a second host box for an optional origin, paste only
the second paragraph again. Do not list products or domains.

## Other permission justifications

- `activeTab`: Grants access to the current tab only at the moment the user
  invokes the extension - clicking the toolbar icon, choosing a context menu
  item, or pressing a shortcut. Used to read the selection, the page, or the
  transcript the user asked for. Chosen deliberately in place of broad host
  permissions, so the extension has no standing access to any site.
- `scripting`: Injects the content script that reads the requested text, plays
  the audio, and draws the reader panel showing what is being spoken. The
  extension declares no static content scripts, so nothing is injected into any
  page until the user asks for something to be read (or until they turn on
  optional auto-read for a chat site they granted).
- `contextMenus`: Adds the right-click actions "Read with Varterm", "Read entire
  page", "Read this video transcript" on a YouTube video, and "Read the last
  reply" on a supported AI chat.
- `storage`: Saves the user's own preferences - voice tier, voice, speaking
  speed, whether to strip markdown, and which chat sites should auto-read. No
  browsing data is stored.

**Remotely hosted code: No.** All logic ships inside the package. The only
network response consumed is audio bytes, which are never executed. There is no
`eval`, no `new Function`, and no injected remote script.

## Review Notes

Paste this into the notes for the reviewer only. Do not put it in Description.

> This resubmission addresses Yellow Argon (excessive keywords in the item
> description). The public description no longer lists third-party product
> names. Those names appeared in 1.4.0 as a feature catalog; they are not
> needed to explain what the extension does.
>
> Varterm reads text aloud. Everything it does serves that one purpose.
>
> Nothing is injected into any page until the user explicitly asks for something
> to be read, which is why the extension uses `activeTab` rather than host
> permissions. The only install-time remote host is its own synthesis endpoint
> at `https://www.varterm.com/api/*`, which returns audio. No code is ever
> loaded remotely.
>
> Regarding the video transcript feature: this reads the transcript panel that
> YouTube itself renders on the watch page, after the user explicitly asks for
> it. It does not use YouTube's API, does not download or capture media, and
> does not circumvent any access control — it reads text that is already
> displayed to the user, in order to speak it aloud and let them search it.
> Search stays in the reader panel; clicking a caption timestamp seeks the
> in-page video element the user can already control.
>
> Regarding optional AI-chat auto-read: each origin in
> `optional_host_permissions` is a site the user can opt into, one at a time.
> Chrome asks for that site only when they switch the feature on, and the
> extension unregisters itself if access is later revoked. It reads assistant
> replies already displayed in the user's own conversation and speaks them
> aloud. It reads nothing else on the page, sends no conversation anywhere
> except the synthesis endpoint, and uses no third-party chat API. The public
> listing describes this as “AI chat replies” without naming the products,
> because the feature is the same on each site.

## What's new (1.4.2)

Use this in the Chrome Web Store "What's new" field if it is offered. Do not
list product names here either.

> Jump back and ahead from the popup, pick a speaking speed, and optionally
> hear new AI chat replies as they finish. Read selection is Alt+Shift+R —
> Chrome uses Ctrl+Shift+R to reload. YouTube transcripts open a searchable
> panel: find a moment, then click its timestamp to jump the video.

## Final Pre-Submit Checklist

- Zip built with `./package.sh` — `varterm-tts-chrome.zip` is version **1.4.2**
- Confirm `sites.js` and `chats.js` are inside the zip
- Public Description pasted from the Detailed Description section only
- Short description matches the manifest (no product-name lists)
- What's new has no product-name list
- Review notes pasted in the reviewer box, not the Description
- Host justification is the two short paragraphs above — no product-name list
- All icons present and correct
- Screenshots at 1280x800 from `store-screenshots/` (regenerate with
  `node store-screenshots/capture-store.mjs`). Upload, in this order:
  `shot1-select.png`, `shot1-video-transcript.png`, `shot2-search.png`,
  `shot4-popup.png`, `shot5-claude.png`. Optional extras:
  `shot2-markdown.png`, `shot3-workflow.png`. Do not upload the Aug 25
  `varterm-store-*.png` files or any image that lists third-party chat names.
- Privacy policy URL set to `https://varterm.com/privacy`
- Privacy practices: "Website content" ticked, nothing else
- All three data-use certifications affirmed
- "Uses remotely hosted code" answered No
- Visibility set to Public
