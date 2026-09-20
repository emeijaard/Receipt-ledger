# Receipt Ledger — setup guide

This app is a set of static files (no server, no backend). It runs entirely
in your phone's browser and talks directly to Google Sheets, Dropbox, and a
free currency-rate API. Nothing passes through any server of mine — that's
also why it needs a one-time setup: Google and Dropbox both require *you*
to register the app under *your own* account before it's allowed to touch
your Sheet / Dropbox.

Total one-time setup time: roughly 15–20 minutes. You only do this once.

There are four stages, **in this order**:

1. Put the app online (GitHub Pages) so it has a real URL.
2. Create a Google OAuth Client ID, pointed at that URL.
3. Create a Dropbox app, pointed at that URL.
4. Open the app on your phone and paste those credentials into Settings.

---

## 1. Put the app online (GitHub Pages)

You need a free GitHub account for this (github.com/join if you don't have one).

1. Go to github.com → **New repository**. Name it e.g. `receipt-ledger`. Public is fine — the files contain no secrets, only IDs that are *meant* to be embedded in a client-side app (the same way every website's Google Sign-In button works).
2. Upload every file and folder from this project into the repository, keeping the folder structure exactly (`index.html`, `manifest.json`, `sw.js`, `css/`, `js/`, `icons/`). The easiest way: on the repo page, click **Add file → Upload files**, then drag the whole folder in.
3. Go to the repo's **Settings → Pages**. Under "Build and deployment", set **Source: Deploy from a branch**, branch **main**, folder **/(root)**. Save.
4. Wait about a minute, then refresh — GitHub shows your live URL, something like:
   `https://YOUR-USERNAME.github.io/receipt-ledger/`
5. Open that URL once in a phone or desktop browser, just to confirm the app loads (it'll show the "New" screen — that's expected, nothing is configured yet).

Keep that URL handy — you'll paste pieces of it into Google and Dropbox next.

---

## 2. Google Sheet + OAuth Client ID

**a. Prepare the Sheet**

1. Create (or pick) a Google Sheet for personal expenses. Note its tab name at the bottom (e.g. `Expenses` — or rename a tab to that).
2. Copy the Sheet's URL from the address bar — you'll paste the whole thing into the app later, it extracts the ID itself.
3. Share the Sheet with anyone else who needs access (spouse, accountant, etc.) the normal Google Sheets way — the app doesn't affect sharing.

**b. Create the OAuth Client ID**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a new project (any name, e.g. "Receipt Ledger").
2. **APIs & Services → Library** → search "Google Sheets API" → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - Fill in app name (e.g. "Receipt Ledger"), your email as support email and developer contact.
   - Scopes: add `.../auth/spreadsheets` (search "Sheets" in the scope picker).
   - Test users: add your own Google account email. This keeps the app in "Testing" mode, which is all you need for personal use — you never need to submit it for Google's verification review.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized JavaScript origins: add your GitHub Pages **origin only** — no path, no trailing slash, e.g. `https://YOUR-USERNAME.github.io`.
   - Save.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`). You'll paste this into the app's Settings.

**A note on the "unverified app" warning:** the first time you connect, Google will show a scary interstitial ("Google hasn't verified this app"). This is normal and expected for a personal project — click **Advanced → Go to Receipt Ledger (unsafe)**, then approve. Because you added yourself as a test user, this works indefinitely; it's just Google's standard friction for apps that haven't gone through their (lengthy, unnecessary-for-personal-use) verification program.

---

## 3. Dropbox app

1. Go to [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) → **Create app**.
2. Choose **Scoped access**, then **App folder** access (recommended — the app can only see its own dedicated folder inside your Dropbox, nothing else). Name it e.g. `receipt-ledger`.
3. Once created, open the **Permissions** tab and enable:
   - `files.content.write`
   - `files.content.read`
   Click **Submit** at the bottom of that tab to save.
4. Open the **Settings** tab:
   - Under **OAuth 2 → Redirect URIs**, add your app's exact URL as shown in the app itself: open your deployed app, go to **Settings tab → Dropbox section**, and copy the value shown next to "Redirect URI to register" (it'll be something like `https://YOUR-USERNAME.github.io/receipt-ledger/index.html`). Paste that exact string into Dropbox.
   - Copy the **App key** shown near the top of the Settings tab.

Because you chose "App folder" access, all paths you use inside the app (Excel file path, receipts folder) are relative to that dedicated app folder — Dropbox creates it automatically the first time the app writes to it. So in the app's Settings you can simply use:
- Excel ledger path: `/business_expenses.xlsx`
- Receipts folder: `/Receipts`

(If you chose Full Dropbox access instead, use whatever absolute path you like within your Dropbox.)

---

## 4. First run on your phone

1. Open your GitHub Pages URL in Chrome on your Android phone.
2. Tap the Chrome menu (⋮) → **Add to Home screen** / **Install app**. It now opens full-screen like a normal app.
3. Go to the **Settings** tab and fill in:
   - Google: paste the Client ID, paste the Sheet URL, set the tab name.
   - Dropbox: paste the App key, set the Excel path and receipts folder (see above), then tap **Connect** — this sends you through Dropbox's login/approval screen and back.
   - Categories: your personal and business categories are pre-filled from what you gave me; add, remove, or rename any of them right there — tap the **×** on a chip to remove one, or type a new one and press enter to add it.
   - Currencies: the common ones are pre-loaded; add any others you need (3-letter codes, e.g. `IDR`).
4. Tap **Test** next to Google Sheets to confirm the connection (you'll see the consent screen described above the first time).
5. You're set up. Go to the **New** tab, pick Personal or Business, snap a receipt, check the pre-filled fields, and save.

---

## How it behaves day to day

- **Personal** receipts append a row to your Google Sheet: Date, Vendor, Category, Currency, Amount, EUR Rate, Amount (EUR), Notes.
- **Business** receipts get a generated unique ID (e.g. `20260920-K3F9`), append a row to the Excel ledger in Dropbox with the same columns plus the Unique ID and the receipt's filename, and the photo itself is uploaded to your Dropbox receipts folder as `<uniqueID>.jpg`.
- The EUR conversion uses the European Central Bank's daily reference rate (via the free Frankfurter API), cached once a day so it still works if you're offline later that day.
- Receipt reading (vendor/date/amount pre-fill) runs entirely on your phone using an on-device OCR library — no receipt image or text is ever sent anywhere for this step. It's a rough pre-fill on clean printed receipts and often needs a correction; you always see and can edit every field before saving, and there's a "Enter details manually instead" link if you'd rather skip it.
- If you save a receipt with no signal, it's queued on the phone and syncs automatically next time you're online (or tap **Sync now** in the Queue tab). Nothing is lost.

## Troubleshooting

- **"Sync failed" / Google errors after being fine for a while**: your Google access token expired (they last ~1 hour) and the browser blocked the silent refresh popup. Just open the app and tap **Sync now** — that's a real tap (a "user gesture"), which Google's popup is allowed to piggyback on.
- **`redirect_uri_mismatch` from Dropbox**: the Redirect URI registered in the Dropbox App Console must match the value shown in the app's Settings **exactly**, including `https://`, capitalization, and trailing path. Copy-paste it rather than retyping.
- **Google shows "This app is blocked"**: you likely haven't added yourself as a Test User on the OAuth consent screen, or you're signed into a different Google account than the one you added.
- **OCR is consistently wrong on your receipts**: it's a lightweight on-device library — crumpled thermal receipts, handwriting, and small fonts will trip it up. Use "Enter details manually instead" for those; it's not slower than fixing several wrong fields.

## What this app does *not* do

- It doesn't run any server or store your data anywhere except your phone (temporarily, for offline queueing), your Google Sheet, and your Dropbox.
- It doesn't share your Google or Dropbox access with anyone — the OAuth tokens live only in your phone's browser storage.
