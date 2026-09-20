// Dropbox integration using Authorization Code + PKCE (no client secret
// needed). Requests a long-lived refresh token (token_access_type=offline)
// so the app only needs the one-time consent screen once.
'use strict';

const DropboxAPI = {
  _accessToken: null,
  _expiresAt: 0,

  redirectUri() {
    return window.location.origin + window.location.pathname;
  },

  base64UrlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  generateVerifier() {
    const arr = new Uint8Array(64);
    crypto.getRandomValues(arr);
    return this.base64UrlEncode(arr.buffer);
  },

  async generateChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return this.base64UrlEncode(digest);
  },

  // Kicks off the OAuth redirect. Called from a user gesture (button tap).
  async startAuth(appKey) {
    const verifier = this.generateVerifier();
    const challenge = await this.generateChallenge(verifier);
    await IDB.set('dropbox_pkce_verifier', verifier);

    const params = new URLSearchParams({
      client_id: appKey,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      token_access_type: 'offline',
      redirect_uri: this.redirectUri()
    });
    window.location.assign(`https://www.dropbox.com/oauth2/authorize?${params.toString()}`);
  },

  // Call once on every page load. If the URL carries a Dropbox ?code=,
  // completes the token exchange and cleans the URL. Returns
  // 'connected' | 'error' | null (nothing to do).
  async handleRedirect(appKey) {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (!code) return null;

    const verifier = await IDB.get('dropbox_pkce_verifier');
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    window.history.replaceState({}, document.title, url.pathname + (url.search || '') + url.hash);

    if (!verifier) return null; // stray ?code (e.g. Google's, though GIS uses a popup, not redirect)

    try {
      const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: appKey,
          code_verifier: verifier,
          redirect_uri: this.redirectUri()
        })
      });
      if (!res.ok) throw new Error(`Dropbox token exchange failed: HTTP ${res.status}`);
      const data = await res.json();
      await IDB.set('dropbox_refresh_token', data.refresh_token);
      await IDB.del('dropbox_pkce_verifier');
      this._accessToken = data.access_token;
      this._expiresAt = Date.now() + (Number(data.expires_in || 14400) * 1000);
      return 'connected';
    } catch (err) {
      console.error(err);
      return 'error';
    }
  },

  async isConnected() {
    const rt = await IDB.get('dropbox_refresh_token');
    return !!rt;
  },

  async disconnect() {
    await IDB.del('dropbox_refresh_token');
    this._accessToken = null;
    this._expiresAt = 0;
  },

  async getAccessToken(appKey) {
    if (this._accessToken && Date.now() < this._expiresAt - 30000) {
      return this._accessToken;
    }
    const refreshToken = await IDB.get('dropbox_refresh_token');
    if (!refreshToken) throw new Error('Dropbox is not connected yet. Connect it in Settings.');

    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: appKey
      })
    });
    if (!res.ok) throw new Error(`Dropbox token refresh failed: HTTP ${res.status}`);
    const data = await res.json();
    this._accessToken = data.access_token;
    this._expiresAt = Date.now() + (Number(data.expires_in || 14400) * 1000);
    return this._accessToken;
  },

  // Returns an ArrayBuffer, or null if the file doesn't exist yet.
  async downloadFile(appKey, path) {
    const token = await this.getAccessToken(appKey);
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path })
      }
    });
    if (res.status === 409) return null; // path/not_found and similar
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Dropbox download failed (${res.status}): ${body.slice(0, 300)}`);
    }
    return res.arrayBuffer();
  },

  async uploadFile(appKey, path, data, { mode = 'overwrite' } = {}) {
    const token = await this.getAccessToken(appKey);
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path, mode, mute: true, autorename: false })
      },
      body: data
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Dropbox upload failed (${res.status}): ${body.slice(0, 300)}`);
    }
    return res.json();
  },

  async testConnection(appKey) {
    const token = await this.getAccessToken(appKey);
    const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Dropbox connection check failed: HTTP ${res.status}`);
    return res.json();
  }
};
