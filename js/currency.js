// Daily EUR conversion via the open.er-api.com endpoint (Open Exchange
// Rates' free tier — ~166 currencies incl. ones the ECB/Frankfurter feed
// doesn't publish, such as BND, free, no API key, CORS-enabled, rates
// refresh once a day). It returns every currency's rate against EUR in a
// single request, so we just cache the whole table once a day instead of
// requesting specific codes. Rates are cached in IndexedDB so the app
// works offline after the first fetch that day.
'use strict';

const FX_URL = 'https://open.er-api.com/v6/latest/EUR';

const Currency = {
  _memRates: null, // { date, rates:{USD:1.09,...}, stale:false }

  todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // Ensures today's rates are loaded (from cache or network). Returns
  // { date, rates, stale }. `currencyCodes` isn't needed to build the
  // request (the API hands back the full table either way) but is kept
  // as a parameter so callers don't need to change.
  async ensureRates(currencyCodes) {
    const today = this.todayKey();
    const cached = await IDB.get('fx_cache');

    if (cached && cached.date === today) {
      this._memRates = { ...cached, stale: false };
      return this._memRates;
    }

    try {
      const res = await fetch(FX_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
      const data = await res.json();
      if (data.result !== 'success' || !data.rates) throw new Error('FX response missing rates');
      const fresh = { date: today, rates: data.rates, source: 'network' };
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
