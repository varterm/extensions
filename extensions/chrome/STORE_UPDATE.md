# Chrome Web Store resubmit — 1.4.2

1.4.0 was rejected (Yellow Argon): the public description listed
third-party chat product names as keywords. This draft removes those
lists from every public field and narrows the install-time host to
`https://www.varterm.com/api/*`.

Package: `extensions/extensions/chrome/varterm-tts-chrome.zip`

## Submit steps

1. Open https://chrome.google.com/webstore/devconsole
2. Open the existing **Varterm TTS - Text to Speech** item
3. Upload `varterm-tts-chrome.zip` (must show version **1.4.2**)
4. Replace the **Short description** and **Description** from
   `STORE_LISTING.md` — paste the Detailed Description block only
5. Replace **What's new** from that file (no product-name list)
6. Leave Privacy practices as **Website content** only
7. Paste review notes into the reviewer box (they explain Yellow Argon)
8. Host justification: install-time API paragraph plus the one optional-host
   sentence. Do not list every chat origin or product name in that box.
9. Submit for review

## What changed vs 1.4.0

- Public listing no longer names third-party chat products
- Install-time host is only `https://www.varterm.com/api/*`
- Optional chat origins are unchanged; they stay out of the Description
- Read shortcut is Alt+Shift+R (Ctrl+Shift+R is Chrome hard-reload)
