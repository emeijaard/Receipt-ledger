// Main application controller: wires the UI to config/currency/google/
// dropbox/xlsx/ocr. Every save goes through the offline queue first, then
// gets synced — so nothing is lost if the connection drops mid-save.
'use strict';

const App = {
  cfg: null,
  captureId: 0,
  currentType: null,
  photoBlob: null,
  photoDataUrl: null,
  currentRates: null,
  syncing: false,

  el(id) { return document.getElementById(id); },

  async init() {
    this.cfg = await Config.load();
    this.applyTheme(this.cfg.theme);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
    }

    // Complete a Dropbox OAuth redirect if we just came back from one.
    if (this.cfg.dropboxAppKey) {
      const result = await DropboxAPI.handleRedirect(this.cfg.dropboxAppKey);
      if (result === 'connected') this.toast('Dropbox connected.');
      else if (result === 'error') this.toast('Dropbox connection failed. Please try again in Settings.');
    }

    this.wireNav();
    this.wireNewFlow();
    this.wireSettings();
    await this.renderSettings();
    await this.refreshQueueBadge();
    await this.renderQueue();
    await this.renderHistory();

    window.addEventListener('online', () => { this.updateOfflineBanner(); this.trySyncQueue(); });
    window.addEventListener('offline', () => this.updateOfflineBanner());
    this.updateOfflineBanner();

    if (navigator.onLine) this.trySyncQueue();
  },

  toast(msg, ms = 3200) {
    const t = this.el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  },

  applyTheme(theme) {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  },

  updateOfflineBanner() {
    this.el('offline-banner').style.display = navigator.onLine ? 'none' : 'block';
  },

  // ---------------- Navigation ----------------
  wireNav() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.showView(btn.dataset.view));
    });
    this.el('theme-toggle').addEventListener('click', async () => {
      const order = ['auto', 'dark', 'light'];
      const next = order[(order.indexOf(this.cfg.theme) + 1) % order.length];
      this.cfg = await Config.save({ theme: next });
      this.applyTheme(next);
      this.el('s-theme').value = next;
      this.toast(`Theme: ${next}`);
    });
  },

  activateView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    this.el(`view-${name}`).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  },

  async showView(name) {
    this.activateView(name);
    if (name === 'queue') { await this.renderQueue(); await this.renderHistory(); }
    if (name === 'new') this.resetFormOnly();
  },

  // ---------------- New receipt flow ----------------
  wireNewFlow() {
    document.querySelectorAll('.choice-card').forEach((card) => {
      card.addEventListener('click', () => this.chooseType(card.dataset.type));
    });
    this.el('back-to-choose-btn').addEventListener('click', () => this.resetNewFlow());
    this.el('cancel-btn').addEventListener('click', () => this.resetNewFlow());

    this.el('photo-capture-label').addEventListener('click', (e) => {
      // let the native file input handle the tap
    });
    this.el('photo-input').addEventListener('change', (e) => this.onPhotoSelected(e));
    this.el('skip-ocr-btn').addEventListener('click', () => this.goToForm({}));
    // Lets the user log an expense with no receipt photo at all (e.g. cash
    // tips, a verbal split, a lost receipt) — skips straight to the form
    // with nothing pre-filled and no photo attached to the saved item.
    this.el('no-receipt-btn').addEventListener('click', () => this.goToForm({}));

    this.el('f-amount').addEventListener('input', () => this.updateEurPreview());
    this.el('f-currency').addEventListener('change', async () => {
      await Config.save({ lastUsedCurrency: this.el('f-currency').value });
      this.updateEurPreview();
    });

    this.el('save-btn').addEventListener('click', () => this.saveExpense());
  },

  resetFormOnly() {
    this.currentType = null;
    this.photoBlob = null;
    this.photoDataUrl = null;
    this.captureId++;
    this.el('step-choose').style.display = '';
    this.el('step-capture').style.display = 'none';
    this.el('step-form').style.display = 'none';
    this.el('photo-input').value = '';
    this.el('photo-preview').style.display = 'none';
    this.el('photo-placeholder').style.display = '';
    this.el('ocr-status').style.display = 'none';
    this.el('skip-ocr-btn').style.display = 'none';
  },

  // Resets the in-progress entry AND makes sure the "New" tab is the one
  // showing (used after Cancel / Save, where we aren't necessarily
  // already on that tab's click handler).
  resetNewFlow() {
    this.resetFormOnly();
    this.activateView('new');
  },

  chooseType(type) {
    this.currentType = type;
    this.el('type-badge').textContent = type === 'personal' ? 'Personal → Google Sheet' : 'Business → Dropbox Excel';
    this.el('type-badge').className = `badge ${type}`;
    this.el('step-choose').style.display = 'none';
    this.el('step-capture').style.display = '';
  },

  async onPhotoSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    this.photoBlob = file;
    const myCapture = ++this.captureId;

    const reader = new FileReader();
    reader.onload = () => {
      this.photoDataUrl = reader.result;
      this.el('photo-preview').src = this.photoDataUrl;
      this.el('photo-preview').style.display = '';
      this.el('photo-placeholder').style.display = 'none';
    };
    reader.readAsDataURL(file);

    this.el('ocr-status').style.display = 'flex';
    this.el('ocr-status-text').textContent = 'Reading receipt…';
    this.el('skip-ocr-btn').style.display = '';

    try {
      const text = await OCR.recognize(file, (progress) => {
        if (myCapture === this.captureId) {
          this.el('ocr-status-text').textContent = `Reading receipt… ${Math.round(progress * 100)}%`;
        }
      });
      if (myCapture !== this.captureId) return; // user moved on already
      const knownCurrencies = this.cfg.currencies;
      const guess = OCR.extract(text, knownCurrencies);
      this.goToForm(guess);
    } catch (err) {
      console.warn('OCR failed', err);
      if (myCapture !== this.captureId) return;
      this.toast('Could not read the receipt automatically — fill it in manually.');
      this.goToForm({});
    }
  },

  async goToForm(guess) {
    this.el('step-capture').style.display = 'none';
    this.el('step-form').style.display = '';
    this.el('type-badge-2').textContent = this.currentType === 'personal' ? 'Personal → Google Sheet' : 'Business → Dropbox Excel';
    this.el('type-badge-2').className = `badge ${this.currentType}`;

    this.el('f-date').value = guess.date || this.todayISO();
    this.el('f-vendor').value = guess.vendor || '';
    this.el('f-notes').value = '';

    const categories = this.currentType === 'personal' ? this.cfg.personalCategories : this.cfg.businessCategories;
    this.el('f-category').innerHTML = categories.map((c) => `<option value="${this.escape(c)}">${this.escape(c)}</option>`).join('');

    this.el('f-currency').innerHTML = this.cfg.currencies.map((c) => `<option value="${c}">${c}</option>`).join('');
    const preferredCurrency = guess.currency || this.cfg.lastUsedCurrency || this.cfg.defaultCurrency;
    if (this.cfg.currencies.includes(preferredCurrency)) this.el('f-currency').value = preferredCurrency;

    this.el('f-amount').value = guess.amount != null ? guess.amount : '';

    this.currentRates = await Currency.ensureRates(this.cfg.currencies);
    this.updateEurPreview();
  },

  updateEurPreview() {
    const amount = parseFloat(this.el('f-amount').value);
    const currency = this.el('f-currency').value;
    const preview = this.el('eur-preview');
    if (!amount || isNaN(amount)) { preview.textContent = ''; return; }
    const eur = Currency.toEUR(amount, currency, this.currentRates);
    if (eur == null) {
      preview.textContent = currency === 'EUR' ? '' : `Rate for ${currency} unavailable right now — it'll be converted when you sync.`;
      return;
    }
    const staleNote = this.currentRates && this.currentRates.stale ? ' (rate may be a day old — offline)' : '';
    preview.innerHTML = `&#8776; <strong>€${eur.toFixed(2)}</strong>${staleNote}`;
  },

  todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  genUniqueId(dateStr) {
    const compact = (dateStr || this.todayISO()).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${compact}-${rand}`;
  },

  async saveExpense() {
    const date = this.el('f-date').value || this.todayISO();
    const vendor = this.el('f-vendor').value.trim();
    const category = this.el('f-category').value;
    const currency = this.el('f-currency').value;
    const amount = parseFloat(this.el('f-amount').value);
    const notes = this.el('f-notes').value.trim();

    if (!amount || isNaN(amount) || amount <= 0) {
      this.toast('Enter a valid amount first.');
      return;
    }

    const payload = { date, vendor, category, currency, amount, notes };
    if (this.currentType === 'business') payload.uniqueId = this.genUniqueId(date);

    const item = {
      id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      type: this.currentType,
      payload,
      photoBlob: this.photoBlob || null,
      photoDataUrl: this.photoDataUrl || null,
      createdAt: Date.now(),
      status: 'pending',
      error: null
    };

    await IDB.queueAdd(item);
    this.toast('Saved — syncing…');
    this.resetNewFlow();
    await this.refreshQueueBadge();
    this.trySyncQueue();
  },

  escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // ---------------- Sync ----------------
  async trySyncQueue() {
    if (this.syncing || !navigator.onLine) return;
    this.syncing = true;
    try {
      const items = await IDB.queueAll();
      for (const item of items) {
        item.status = 'sending';
        await IDB.queueUpdate(item);
        await this.renderQueue();
        try {
          if (item.type === 'personal') await this.syncPersonal(item);
          else await this.syncBusiness(item);
          await IDB.queueRemove(item.id);
          await this.addHistory(item);
        } catch (err) {
          console.error('Sync failed for item', item.id, err);
          item.status = 'error';
          item.error = err.message || String(err);
          await IDB.queueUpdate(item);
        }
      }
    } finally {
      this.syncing = false;
      await this.refreshQueueBadge();
      await this.renderQueue();
      await this.renderHistory();
    }
  },

  async syncPersonal(item) {
    const cfg = await Config.load();
    if (!Config.isGoogleConfigured(cfg)) throw new Error("Google Sheets isn't set up yet — check Settings.");
    const rates = await Currency.ensureRates(cfg.currencies);
    const eurAmount = Currency.toEUR(item.payload.amount, item.payload.currency, rates);
    const eurRate = Currency.rateFor(item.payload.currency, rates);

    const headerKey = `${cfg.googleSheetId}|${cfg.googleSheetTab}`;
    if (cfg._googleHeaderEnsuredFor !== headerKey) {
      await GoogleSheets.ensureHeaderRow(cfg);
      cfg._googleHeaderEnsuredFor = headerKey;
      await Config.save({ _googleHeaderEnsuredFor: headerKey });
    }

    await GoogleSheets.appendExpense(cfg, { ...item.payload, eurAmount, eurRate });
  },

  async syncBusiness(item) {
    const cfg = await Config.load();
    if (!Config.isDropboxConfigured(cfg)) throw new Error("Dropbox isn't set up yet — check Settings.");
    if (!(await DropboxAPI.isConnected())) throw new Error("Dropbox isn't connected yet — check Settings.");

    const rates = await Currency.ensureRates(cfg.currencies);
    const eurAmount = Currency.toEUR(item.payload.amount, item.payload.currency, rates);
    const eurRate = Currency.rateFor(item.payload.currency, rates);

    const existing = await DropboxAPI.downloadFile(cfg.dropboxAppKey, cfg.dropboxExcelPath);
    const receiptFile = item.photoBlob ? `${item.payload.uniqueId}.jpg` : '';
    const newBuf = XlsxHelper.appendRow(existing, { ...item.payload, eurAmount, eurRate, receiptFile });
    await DropboxAPI.uploadFile(cfg.dropboxAppKey, cfg.dropboxExcelPath, newBuf);

    if (item.photoBlob) {
      const folder = cfg.dropboxReceiptsFolder.replace(/\/+$/, '');
      const path = `${folder}/${item.payload.uniqueId}.jpg`;
      await DropboxAPI.uploadFile(cfg.dropboxAppKey, path, item.photoBlob);
    }
  },

  async addHistory(item) {
    const history = (await IDB.get('history')) || [];
    history.unshift({
      type: item.type,
      date: item.payload.date,
      vendor: item.payload.vendor,
      category: item.payload.category,
      currency: item.payload.currency,
      amount: item.payload.amount,
      uniqueId: item.payload.uniqueId,
      syncedAt: Date.now()
    });
    await IDB.set('history', history.slice(0, 20));
  },

  async refreshQueueBadge() {
    const items = await IDB.queueAll();
    const badge = this.el('queue-badge');
    badge.textContent = items.length ? ` (${items.length})` : '';
  },

  async renderQueue() {
    const items = await IDB.queueAll();
    const list = this.el('queue-list');
    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><span class="glyph">&#10003;</span>Nothing waiting to sync.</div>';
      return;
    }
    list.innerHTML = items.map((item) => {
      const thumb = item.photoDataUrl ? `<img src="${item.photoDataUrl}">` : '';
      const statusText = item.status === 'error' ? `Failed: ${this.escape(item.error || 'unknown error')}`
        : item.status === 'sending' ? 'Syncing…' : 'Waiting to sync';
      return `<div class="queue-item" data-id="${item.id}">
        ${thumb}
        <div class="meta">
          <div class="title">${this.escape(item.payload.vendor || item.payload.category || '(untitled)')} — ${item.payload.amount} ${item.payload.currency}</div>
          <div class="sub">${item.payload.date} · ${item.type === 'personal' ? 'Personal' : 'Business'}${item.payload.uniqueId ? ' · ' + item.payload.uniqueId : ''}</div>
        </div>
        <div>
          <div class="status ${item.status}">${statusText}</div>
          <button class="link-btn" data-remove="${item.id}" style="padding:2px 0;">Remove</button>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await IDB.queueRemove(btn.dataset.remove);
        await this.renderQueue();
        await this.refreshQueueBadge();
      });
    });

    this.el('sync-btn').onclick = () => this.syncNowFromClick();
  },

  // "Sync now" is a direct click, which is the one moment Google's sign-in
  // popup is allowed to open. trySyncQueue() normally fetches FX rates over
  // the network before it ever touches Google — that network wait is often
  // enough for the browser to decide the click's "user gesture" has expired,
  // so the popup gets silently blocked even though a real person clicked.
  // Requesting the Google token FIRST, right inside the click handler,
  // keeps the request inside the gesture window; trySyncQueue() then reuses
  // the already-fetched token instead of asking again.
  async syncNowFromClick() {
    try {
      const cfg = await Config.load();
      if (Config.isGoogleConfigured(cfg)) {
        await GoogleSheets.getAccessToken(cfg.googleClientId);
      }
    } catch (err) {
      console.warn('Pre-auth before sync failed (sync will retry the sign-in itself)', err);
    }
    this.trySyncQueue();
  },

  async renderHistory() {
    const history = (await IDB.get('history')) || [];
    const list = this.el('history-list');
    if (!history.length) {
      list.innerHTML = '<div class="empty-state">No receipts saved yet.</div>';
      return;
    }
    list.innerHTML = history.map((h) => `<div class="queue-item">
      <div class="meta">
        <div class="title">${this.escape(h.vendor || h.category || '(untitled)')} — ${h.amount} ${h.currency}</div>
        <div class="sub">${h.date} · ${h.type === 'personal' ? 'Personal' : 'Business'}${h.uniqueId ? ' · ' + h.uniqueId : ''}</div>
      </div>
      <div class="status" style="color:var(--success);">Synced</div>
    </div>`).join('');
  },

  // ---------------- Settings ----------------
  wireSettings() {
    const saveField = async (id, key, transform) => {
      this.el(id).addEventListener('change', async () => {
        let val = this.el(id).value.trim();
        if (transform) val = transform(val);
        this.el(id).value = val;
        this.cfg = await Config.save({ [key]: val });
      });
    };

    saveField('s-google-client-id', 'googleClientId');
    saveField('s-google-sheet-id', 'googleSheetId', (v) => parseGoogleSheetId(v));
    saveField('s-google-sheet-tab', 'googleSheetTab');
    saveField('s-dropbox-app-key', 'dropboxAppKey');
    saveField('s-dropbox-excel-path', 'dropboxExcelPath');
    saveField('s-dropbox-receipts-folder', 'dropboxReceiptsFolder');

    this.el('s-theme').addEventListener('change', async () => {
      const val = this.el('s-theme').value;
      this.cfg = await Config.save({ theme: val });
      this.applyTheme(val);
    });

    this.el('s-default-currency').addEventListener('change', async () => {
      this.cfg = await Config.save({ defaultCurrency: this.el('s-default-currency').value });
    });

    this.el('google-test-btn').addEventListener('click', async () => {
      this.el('google-status').textContent = 'Testing…';
      try {
        const cfg = await Config.load();
        if (!Config.isGoogleConfigured(cfg)) throw new Error('Fill in the Client ID and Sheet first.');
        await GoogleSheets.testConnection(cfg);
        this.el('google-dot').className = 'dot ok';
        this.el('google-status').textContent = 'Connected';
        this.toast('Google Sheets connection OK.');
      } catch (err) {
        this.el('google-dot').className = 'dot off';
        this.el('google-status').textContent = 'Not connected';
        this.toast(`Google test failed: ${err.message}`);
      }
    });

    this.el('dropbox-connect-btn').addEventListener('click', async () => {
      const cfg = await Config.load();
      if (!cfg.dropboxAppKey) { this.toast('Enter your Dropbox app key first.'); return; }
      if (await DropboxAPI.isConnected()) {
        await DropboxAPI.disconnect();
        this.el('dropbox-dot').className = 'dot off';
        this.el('dropbox-status').textContent = 'Not connected';
        this.el('dropbox-connect-btn').textContent = 'Connect';
        this.toast('Dropbox disconnected.');
        return;
      }
      await DropboxAPI.startAuth(cfg.dropboxAppKey);
    });

    this.wireTagList('personal-categories-list', 'personal-category-input', 'personalCategories');
    this.wireTagList('business-categories-list', 'business-category-input', 'businessCategories');
    this.wireTagList('currency-list', 'currency-input', 'currencies', { upper: true, maxLen: 3 });
  },

  wireTagList(listId, inputId, configKey, opts = {}) {
    this.el(inputId).addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      let val = this.el(inputId).value.trim();
      if (!val) return;
      if (opts.upper) val = val.toUpperCase();
      if (opts.maxLen) val = val.slice(0, opts.maxLen);
      const cfg = await Config.load();
      const arr = cfg[configKey].slice();
      if (!arr.includes(val)) arr.push(val);
      this.cfg = await Config.save({ [configKey]: arr });
      this.el(inputId).value = '';
      await this.renderSettings();
    });
  },

  async renderTagList(listId, configKey, arr) {
    const list = this.el(listId);
    list.innerHTML = arr.map((v) => `<span class="tag-chip">${this.escape(v)}<button data-key="${configKey}" data-val="${this.escape(v)}">&times;</button></span>`).join('');
    list.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cfg = await Config.load();
        const arr2 = cfg[btn.dataset.key].filter((v) => v !== btn.dataset.val);
        this.cfg = await Config.save({ [btn.dataset.key]: arr2 });
        await this.renderSettings();
      });
    });
  },

  async renderSettings() {
    const cfg = await Config.load();
    this.el('s-google-client-id').value = cfg.googleClientId;
    this.el('s-google-sheet-id').value = cfg.googleSheetId;
    this.el('s-google-sheet-tab').value = cfg.googleSheetTab;
    this.el('s-dropbox-app-key').value = cfg.dropboxAppKey;
    this.el('s-dropbox-excel-path').value = cfg.dropboxExcelPath;
    this.el('s-dropbox-receipts-folder').value = cfg.dropboxReceiptsFolder;
    this.el('s-theme').value = cfg.theme;

    this.el('google-origin-hint').textContent = window.location.origin;
    this.el('dropbox-redirect-hint').textContent = DropboxAPI.redirectUri();

    const dropboxConnected = await DropboxAPI.isConnected();
    this.el('dropbox-dot').className = dropboxConnected ? 'dot ok' : 'dot off';
    this.el('dropbox-status').textContent = dropboxConnected ? 'Connected' : 'Not connected';
    this.el('dropbox-connect-btn').textContent = dropboxConnected ? 'Disconnect' : 'Connect';

    await this.renderTagList('personal-categories-list', 'personalCategories', cfg.personalCategories);
    await this.renderTagList('business-categories-list', 'businessCategories', cfg.businessCategories);
    await this.renderTagList('currency-list', 'currencies', cfg.currencies);

    this.el('s-default-currency').innerHTML = cfg.currencies.map((c) => `<option value="${c}">${c}</option>`).join('');
    this.el('s-default-currency').value = cfg.defaultCurrency;
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
