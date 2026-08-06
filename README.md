# BREAKEX — Pause. Refresh. Continue.

A break-reminder browser extension. Two default alerts (Screen Break, Water
Break) ship out of the box, and you can add unlimited custom alerts with
their own name, interval, and optional image/GIF animation.

## What's inside

```
BREAKEX/
├── manifest.json      Manifest V3 config
├── background.js      Service worker — owns all timers via chrome.alarms
├── content.js          Injected into every page — renders the glass alert cards
├── content.css         Styling for the on-page cards
├── popup.html/.js/.css The toolbar popup — live "time left" per alert
├── options.html/.js/.css  Full settings page — add/edit/delete alerts, upload files
├── icons/               16 / 48 / 128 px toolbar icons
└── README.md
```

## How it works

- **background.js** is the single source of truth. It stores alerts in
  `chrome.storage.local` and schedules one `chrome.alarms` entry per alert
  based on an `endTime` timestamp. Alarms survive the popup closing, the
  browser restarting, etc.
- When an alarm fires, background.js finds your currently active tab and
  sends it a `BREAKEX_SHOW` message (injecting `content.js` on the fly if
  that tab was open before the extension loaded).
- **content.js** renders a small glass-style card stacked under the toolbar
  area (top-right of the page). If you attached an image, it fades in; if
  you attached a GIF, it just plays. Each card has its own **Done** and
  **Remind me in 5 min** buttons — multiple simultaneous alerts stack
  vertically, each with independent controls.
  - **Done** resets that alert's timer back to its full duration.
  - **Remind me in 5 min** pushes that alert's timer forward by 5 minutes.
- **popup.html** (click the toolbar icon) shows every alert with a live
  countdown, plus pause/resume, edit, and delete controls.
- **options.html** is the full editor: name, interval in minutes, and an
  optional image/GIF upload (best results with a transparent-background
  PNG or GIF).

## Install locally (unpacked) — Chrome or Edge

1. Unzip this folder somewhere permanent (don't delete it after loading —
   unpacked extensions load their files live from disk).
2. Open `edge://extensions` (or `chrome://extensions`).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `BREAKEX` folder.
5. Pin the BREAKEX icon to your toolbar for quick access.

## Publishing to the Microsoft Edge Add-ons store (free)

Unlike the Chrome Web Store's one-time developer fee, the **Microsoft Edge
Add-ons** program has no publisher fee.

1. Go to the [Microsoft Partner Center](https://partner.microsoft.com/) and
   register/sign in with a Microsoft account.
2. Under **Microsoft Edge Add-ons**, create a new submission.
3. Zip the `BREAKEX` folder's *contents* (not the folder itself — the zip
   should have `manifest.json` at its root) and upload it.
4. Fill in store listing details: description, screenshots (take a few of
   the popup and an on-page alert card), category ("Productivity"), and
   privacy info. Since BREAKEX only uses `chrome.storage.local` and never
   sends data anywhere, you can state it collects no user data.
5. Submit for review. Edge review is usually much faster than Chrome's.

You can technically submit the same package to the Chrome Web Store later
if you ever want to pay the one-time fee — the code is Manifest V3 and
Chromium-standard, so no changes needed.

## Ideas for what to add next

- **Sound/vibration cue** — a soft chime via the Web Audio API when a card
  appears, with a mute toggle in settings.
- **Snooze presets** — let each alert have its own configurable snooze
  length instead of a fixed 5 minutes.
- **Daily stats** — track how many breaks were completed vs. snoozed each
  day and show a small streak/heatmap in the popup.
- **Do Not Disturb / focus mode** — a quick toggle to pause all alerts for
  N hours (e.g. during meetings), auto-resuming afterward.
- **Working hours schedule** — only fire alerts between, say, 9am–6pm on
  weekdays.
- **Multiple animation frames / rotation** — let one alert cycle through
  several uploaded images instead of just one.
- **Sync across devices** — swap `chrome.storage.local` for
  `chrome.storage.sync` (with a size-aware fallback) so alerts follow you
  between machines.
- **Import/export settings** — a JSON export/import button in the options
  page for backing up or sharing your alert setup.
- **Smarter tab targeting** — currently the card appears on your single
  active tab; could optionally broadcast to all tabs in the current window.
- **Onboarding tour** — a first-run overlay explaining the two default
  alerts and how to add a custom one.
- **Break content variety** — bundle a small library of built-in
  stretch/eye-exercise GIFs so users without their own files still get
  something visual.
- **Keyboard shortcut** — a `chrome.commands` binding to instantly snooze
  or dismiss whatever card is currently showing.
