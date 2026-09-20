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

  // Resolves a valid access token, prompting the user with the Google
  // consent popup only if we don't already have one cached in memory.
  async getAccessToken(clientId, { interactive = true } = {}) {
    if (this._accessToken && Date.now() < this._expiresAt - 30000) {
      return this._accessToken;
    }
    const client = await this._ensureTokenClient(clientId);
    return new Promise((resolve, reject) => {
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
  },

  async _sheetsFetch(clientId, path, options = {}) {
    const token = await this.getAccessToken(clientId);
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

  HEADER_ROW: ['Date', 'Vendor', 'Category', 'Currency', 'Amount', 'EUR Rate', 'Amount (EUR)', 'Notes'],

  // Writes the header row only if row 1 of the tab is currently empty.
  async ensureHeaderRow(cfg) {
    const range = encodeURIComponent(`${cfg.googleSheetTab}!A1:H1`);
    const existing = await this._sheetsFetch(cfg.googleClientId, `${cfg.googleSheetId}/values/${range}`);
    if (existing.values && existing.values.length) return; // already has content
    await this._sheetsFetch(
      cfg.googleClientId,
      `${cfg.googleSheetId}/values/${range}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', body: JSON.stringify({ range: `${cfg.googleSheetTab}!A1:H1`, values: [this.HEADER_ROW] }) }
    );
  },

  async appendExpense(cfg, entry) {
    const range = encodeURIComponent(`${cfg.googleSheetTab}!A:H`);
    const row = [
      entry.date,
      entry.vendor || '',
      entry.category || '',
      entry.currency,
      entry.amount,
      entry.eurRate != null ? entry.eurRate : '',
      entry.eurAmount != null ? Number(entry.eurAmount.toFixed(2)) : '',
      entry.notes || ''
    ];
    return this._sheetsFetch(
      cfg.googleClientId,
      `${cfg.googleSheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: [row] }) }
    );
  },

  // Simple connectivity check used by the Settings screen.
  async testConnection(cfg) {
    await this._sheetsFetch(cfg.googleClientId, `${cfg.googleSheetId}?fields=properties.title`);
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
