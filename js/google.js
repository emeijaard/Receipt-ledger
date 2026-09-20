// Google Sheets integration using Google Identity Services (GIS) token
// client — a pure client-side OAuth flow with no client secret. Access
// tokens are short-lived (~1hr) and kept in memory only; when expired we
// silently re-request one (Google will skip the consent screen as long as
// the browser still has an active Google session and the user already
// granted this app the Sheets scope once).
'use strict';

const GoogleSheets = {
  _tokenClient: null,
  _accessToken: null,
  _expiresAt: 0,
  _gisLoaded: null,

  SCOPE: 'https://www.googleapis.com/auth/spreadsheets',

  loadGis() {
    if (this._gisLoaded) return this._gisLoaded;
    this._gisLoaded = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        this._gisLoaded = null; // let a later call retry instead of failing forever
        reject(new Error('Could not load Google Identity Services script (are you offline?)'));
      };
      document.head.appendChild(script);
    });
    return this._gisLoaded;
  },

  async _ensureTokenClient(clientId) {
    await this.loadGis();
    if (!this._tokenClient || this._tokenClientId !== clientId) {
      this._tokenClientId = clientId;
      this._tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: this.SCOPE,
        callback: () => {} // overridden per-call below
      });
    }
    return this._tokenClient;
  },

  // True when we already hold an access token in memory that isn't about
  // to expire — i.e. a caller could get one right now with zero prompting.
  hasValidToken() {
    return !!(this._accessToken && Date.now() < this._expiresAt - 30000);
  },

  // Resolves a valid access token. When `interactive` is true this may pop
  // up Google's sign-in window — but ONLY do that from inside a genuine
  // user click, since browsers silently block popups opened without one.
  // When `interactive` is false we ask Google for a token with no prompt
  // at all (`prompt: 'none'`); that can succeed silently if the browser
  // still has an active Google session and consent from before, but it
  // will not show anything to the user.
  //
  // Either way this is guaranteed to settle within `timeoutMs`. That
  // matters because when a popup request has no user gesture to attach
  // to, the browser blocks it and Google's library just logs a console
  // warning — it never calls our callback, so without this timeout the
  // returned promise would hang forever. That used to happen on every
  // page load (App.init() auto-syncs), permanently wedging the app's
  // in-memory "syncing" flag and making the real "Sync now" button
  // appear to do nothing on the next click.
  async getAccessToken(clientId, { interactive = true, timeoutMs } = {}) {
    if (this.hasValidToken()) return this._accessToken;
    const effectiveTimeout = timeoutMs != null ? timeoutMs : (interactive ? 90000 : 6000);
    const client = await this._ensureTokenClient(clientId);

    const tokenPromise = new Promise((resolve, reject) => {
      client.callback = (resp) => {
        if (resp.error) {
          reject(new Error(`Google sign-in failed: ${resp.error}`));
          return;
        }
        this._accessToken = resp.access_token;
        this._expiresAt = Date.now() + (Number(resp.expires_in || 3600) * 1000);
        resolve(this._accessToken);
      };
      try {
        client.requestAccessToken({ prompt: interactive ? '' : 'none' });
      } catch (err) {
        reject(err);
      }
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(interactive
          ? 'Google sign-in timed out or was blocked — tap "Sync now" again.'
          : 'No existing Google session to sync with automatically — tap "Sync now" to sign in.'));
      }, effectiveTimeout);
    });

    return Promise.race([tokenPromise, timeoutPromise]);
  },

  async _sheetsFetch(clientId, path, options = {}, interactive = true) {
    const token = await this.getAccessToken(clientId, { interactive });
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Google Sheets API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
  },

  // This sheet's own layout (the user's, not this app's): it's a
  // category-per-column ledger, not a flat table.
  //   A = Date
  //   B = Amount (now EUR, going forward)
  //   C = Description / vendor
  //   D = Other currency (left blank — not used by this app)
  //   E onward = one column PER PERSONAL CATEGORY, in the exact order of
  //              cfg.personalCategories (Car→E, Staff/Services→F, ...,
  //              Medical→P). The amount is written a second time into
  //              whichever of those columns matches the expense's
  //              category, mirroring how every historical row already
  //              does it (that's how the sheet tallies spend per category).
  // Row 1 (headers) is never written or modified by us.
  CATEGORY_COLUMNS_START: 4, // 0-based column index of the first category column (E)

  columnLetter(index) {
    let letter = '';
    let n = index + 1; // 1-based
    while (n > 0) {
      const rem = (n - 1) % 26;
      letter = String.fromCharCode(65 + rem) + letter;
      n = Math.floor((n - 1) / 26);
    }
    return letter;
  },

  async appendExpense(cfg, entry, interactive = true) {
    const eurAmount = entry.eurAmount != null ? Number(entry.eurAmount.toFixed(2)) : '';
    const categories = cfg.personalCategories || [];
    const catIndex = categories.indexOf(entry.category);

    const row = ['', '', '', ''];
    row[0] = entry.date || '';
    row[1] = eurAmount;
    row[2] = entry.vendor || '';
    // row[3] ("Other currency") intentionally left blank

    if (catIndex >= 0) {
      const col = this.CATEGORY_COLUMNS_START + catIndex;
      while (row.length <= col) row.push('');
      row[col] = eurAmount;
    }

    const lastCol = this.columnLetter(row.length - 1);
    const range = encodeURIComponent(`${cfg.googleSheetTab}!A:${lastCol}`);
    return this._sheetsFetch(
      cfg.googleClientId,
      `${cfg.googleSheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: [row] }) },
      interactive
    );
  },

  // Simple connectivity check used by the Settings screen.
  async testConnection(cfg) {
    await this._sheetsFetch(cfg.googleClientId, `${cfg.googleSheetId}?fields=properties.title`, {}, true);
  },

  signOut() {
    if (this._accessToken && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(this._accessToken, () => {}); } catch (e) { /* ignore */ }
    }
    this._accessToken = null;
    this._expiresAt = 0;
  }
};

// Extracts a spreadsheet ID from either a bare ID or a full Google
// Sheets URL, so users can just paste the link.
function parseGoogleSheetId(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}
