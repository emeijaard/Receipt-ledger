// On-device OCR (Tesseract.js, loaded from a CDN in index.html as the
// global `Tesseract`) plus a light heuristic parser. This is a rough
// pre-fill, not a reliable extraction — the UI always shows the raw
// OCR text and lets the user correct every field before saving.
'use strict';

const OCR = {
  CURRENCY_SYMBOLS: { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', 'Rp': 'IDR', 'RM': 'MYR', 'S$': 'SGD' },

  _workerPromise: null,
  _progressCb: null,

  // Tesseract.js v5 dropped the old one-shot `Tesseract.recognize()`
  // helper in favour of an explicit worker — we create it once (it loads
  // ~a few MB of language/wasm data, cached by the browser after) and
  // reuse it for every receipt in this session.
  _getWorker() {
    if (!this._workerPromise) {
      if (!window.Tesseract || !Tesseract.createWorker) {
        throw new Error('OCR library did not load (are you offline?)');
      }
      this._workerPromise = Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (this._progressCb && m.status === 'recognizing text' && typeof m.progress === 'number') {
            this._progressCb(m.progress);
          }
        }
      }).catch((err) => {
        // Don't leave a permanently-rejected promise cached — e.g. the
        // first attempt was offline; let the next attempt try again.
        this._workerPromise = null;
        throw err;
      });
    }
    return this._workerPromise;
  },

  async recognize(imageBlobOrDataUrl, onProgress) {
    const worker = await this._getWorker();
    this._progressCb = onProgress || null;
    try {
      const { data } = await worker.recognize(imageBlobOrDataUrl);
      return data.text || '';
    } catch (err) {
      // A failed recognition can leave the worker unusable; drop it so
      // the next photo gets a fresh one instead of failing forever.
      this._workerPromise = null;
      throw err;
    } finally {
      this._progressCb = null;
    }
  },

  guessVendor(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    // The vendor name is usually one of the first few non-numeric lines.
    for (const line of lines.slice(0, 5)) {
      if (line.length >= 3 && !/^\d+$/.test(line) && !/receipt|invoice|tax/i.test(line)) {
        return line.slice(0, 60);
      }
    }
    return '';
  },

  guessDate(text) {
    const patterns = [
      /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, // 2026-09-20
      /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/, // 20/09/2026 or 20-09-2026
      /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})\b/ // 20/09/26
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      let y, mo, d;
      if (re === patterns[0]) { [, y, mo, d] = m; }
      else {
        [, d, mo, y] = m;
        if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y;
      }
      mo = String(mo).padStart(2, '0');
      d = String(d).padStart(2, '0');
      if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
        return `${y}-${mo}-${d}`;
      }
    }
    return '';
  },

  guessAmount(text) {
    const lines = text.split('\n');
    const numRe = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2}|\d+)/g;
    const keywordRe = /total|amount due|grand total|balance due|amount paid/i;

    let best = null;
    // Prefer a number on a line that looks like a total.
    for (const line of lines) {
      if (keywordRe.test(line)) {
        const nums = line.match(numRe);
        if (nums && nums.length) {
          const val = this._parseNumber(nums[nums.length - 1]);
          if (val != null) return val;
        }
      }
    }
    // Fall back to the largest plausible number anywhere on the receipt.
    const all = text.match(numRe) || [];
    for (const raw of all) {
      const val = this._parseNumber(raw);
      if (val != null && (best === null || val > best) && val < 1000000) best = val;
    }
    return best;
  },

  _parseNumber(raw) {
    let s = raw.trim();
    // Normalise "1.234,56" (EU) vs "1,234.56" (US) vs plain "12.34"
    if (/,\d{2}$/.test(s) && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/,\d{2}$/.test(s) && !s.includes('.')) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  },

  guessCurrency(text, knownCodes) {
    for (const code of knownCodes) {
      if (code === 'EUR') continue;
      const re = new RegExp(`\\b${code}\\b`, 'i');
      if (re.test(text)) return code;
    }
    for (const [sym, code] of Object.entries(this.CURRENCY_SYMBOLS)) {
      if (text.includes(sym)) return code;
    }
    if (/\bEUR\b|€/.test(text)) return 'EUR';
    return '';
  },

  extract(text, knownCurrencyCodes) {
    return {
      vendor: this.guessVendor(text),
      date: this.guessDate(text),
      amount: this.guessAmount(text),
      currency: this.guessCurrency(text, knownCurrencyCodes || [])
    };
  }
};

