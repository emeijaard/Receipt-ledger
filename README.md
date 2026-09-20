# Receipt Ledger

A mobile web app (installable on Android as a home-screen app) for capturing
receipts and routing them to two places:

- **Personal** expenses → a row appended to a Google Sheet.
- **Business** expenses → a row appended to an Excel workbook kept in
  Dropbox, plus the receipt photo uploaded under a generated unique ID.

Every amount is converted to EUR using the European Central Bank's daily
reference rate. Receipts are read with on-device OCR to pre-fill the form,
which you always review before saving. Entries made offline are queued and
sync automatically once you're back online.

**No backend, no server, no data collection.** It's a folder of static
files that talks directly, from your phone's browser, to Google Sheets,
Dropbox, and a free public currency-rate API.

## Setup

See **[SETUP.md](SETUP.md)** for the full one-time setup (about 15–20
minutes): deploying the app to a free GitHub Pages URL, creating a Google
OAuth Client ID, creating a Dropbox app, and connecting both from the app's
Settings tab.

## Project layout

```
index.html          App shell / all screens
manifest.json        PWA manifest (name, icons, install behaviour)
sw.js                 Service worker (offline app shell caching)
css/style.css         Styling (light + dark mode)
js/idb.js              IndexedDB wrapper (settings + offline queue)
js/config.js            Settings schema/defaults, categories, currencies
js/currency.js            Daily EUR rates (Frankfurter API, cached)
js/google.js               Google Identity Services + Sheets API
js/dropbox.js                Dropbox OAuth (PKCE) + file upload/download
js/xlsxHelper.js               In-browser Excel read/write (SheetJS)
js/ocr.js                       On-device receipt OCR + field guessing
js/app.js                        Screen logic, wiring, sync
icons/                            App icons
```

## Editing later

Everything is plain HTML/CSS/JS — no build step. Edit a file, re-upload it
to your GitHub repo (or `git push` if you cloned it), and GitHub Pages
redeploys automatically within a minute.

