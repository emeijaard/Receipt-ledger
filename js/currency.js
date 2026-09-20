// Daily EUR conversion via the Frankfurter API (ECB reference rates,
// free, no API key, CORS-enabled). Rates are cached once per day in
// IndexedDB so the app works offline after the first fetch that day.
'use strict';

const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';

const Currency = {
  _memRates: null, // { date, base:'EUR', rates:{USD:1.09,...}, stale:false }

  todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // The full set of codes Frankfurter/ECB actually publishes. Cached
  // indefinitely so one unsupported/typo'd currency the user added in
  // Settings can't take down the rates for every other currency in the
  // same batched request.
  async _supportedCodes() {
    if (this._supportedCache) return this._supportedCache;
    const cached = await IDB.get('fx_supported');
    if (cached && cached.length) { this._supportedCache = cached; return cached; }
    try {
      const res = await fetch(`${FRANKFURTER_BASE}/currencies`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const codes = Object.keys(data);
      await IDB.set('fx_supported', codes);
      this._supportedCache = codes;
      return codes;
    } catch (err) {
      return null; // unknown — caller should not filter in this case
    }
  },

  // Ensures today's rates are loaded (from cache or network) for the given
  // list of currency codes. Returns { date, rates, stale }.
  async ensureRates(currencyCodes) {
    const today = this.todayKey();
    const cached = await IDB.get('fx_cache');

    let codes = Array.from(new Set(currencyCodes.filter((c) => c && c !== 'EUR')));
    const supported = await this._supportedCodes();
    if (supported) codes = codes.filter((c) => supported.includes(c));

    if (!codes.length) {
      this._memRates = cached && cached.date === today ? { ...cached, stale: false } : { date: today, rates: {}, stale: false };
      return this._memRates;
    }

    if (cached && cached.date === today && codes.every((c) => c in cached.rates)) {
      this._memRates = { ...cached, stale: false };
      return this._memRates;
    }

    try {
      const url = `${FRANKFURTER_BASE}/latest?to=${encodeURIComponent(codes.join(','))}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
      const data = await res.json();
      const fresh = {
        date: today,
        rates: Object.assign({}, cached ? cached.rates : {}, data.rates || {}),
        source: 'network'
      };
      await IDB.set('fx_cache', fresh);
      this._memRates = { ...fresh, stale: false };
      return this._memRates;
    } catch (err) {
      if (cached) {
        this._memRates = { ...cached, stale: true };
        return this._memRates;
      }
      this._memRates = { date: today, rates: {}, stale: true, error: true };
      return this._memRates;
    }
  },

  // Converts `amount` in `code` to EUR using the currently loaded rates.
  // Returns null if the rate isn't known (caller should let the user
  // enter the EUR amount manually).
  toEUR(amount, code, ratesState) {
    const rs = ratesState || this._memRates;
    if (!rs || amount == null || isNaN(amount)) return null;
    if (code === 'EUR') return amount;
    const rate = rs.rates && rs.rates[code];
    if (!rate) return null;
    return amount / rate; // rates are "units of code per 1 EUR"
  },

  rateFor(code, ratesState) {
    const rs = ratesState || this._memRates;
    if (code === 'EUR') return 1;
    return rs && rs.rates ? rs.rates[code] : undefined;
  }
};

