// Settings schema, defaults, and load/save helpers.
'use strict';

const DEFAULT_PERSONAL_CATEGORIES = [
  'Car', 'Staff/Services', 'Utilities', 'Day to Day', 'Emily',
  'Eat Out', 'Miscellaneous', 'Travel', 'House', 'Erik', 'Rona', 'Medical'
];

const DEFAULT_BUSINESS_CATEGORIES = [
  'Travel', 'Accommodation', 'Meals & Entertainment', 'Office Supplies',
  'Software/Subscriptions', 'Professional Fees', 'Other'
];

const DEFAULT_CURRENCIES = [
  'EUR', 'USD', 'GBP', 'SGD', 'IDR', 'MYR', 'AUD', 'JPY', 'CHF', 'CNY', 'HKD', 'THB'
];

const DEFAULT_SETTINGS = {
  // Google
  googleClientId: '',
  googleSheetId: '',
  googleSheetTab: 'Expenses',

  // Dropbox
  dropboxAppKey: '',
  dropboxExcelPath: '/Business Expenses/business_expenses.xlsx',
  dropboxReceiptsFolder: '/Business Expenses/Receipts',

  // categories / currencies
  personalCategories: DEFAULT_PERSONAL_CATEGORIES,
  businessCategories: DEFAULT_BUSINESS_CATEGORIES,
  currencies: DEFAULT_CURRENCIES,
  defaultCurrency: 'EUR',

  // misc
  lastUsedCurrency: 'EUR',
  theme: 'auto' // 'auto' | 'light' | 'dark'
};

const Config = {
  _cache: null,

  async load() {
    if (this._cache) return this._cache;
    const stored = await IDB.get('settings');
    this._cache = Object.assign({}, DEFAULT_SETTINGS, stored || {});
    return this._cache;
  },

  async save(patch) {
    const current = await this.load();
    this._cache = Object.assign({}, current, patch);
    await IDB.set('settings', this._cache);
    return this._cache;
  },

  async get(key) {
    const cfg = await this.load();
    return cfg[key];
  },

  isGoogleConfigured(cfg) {
    return !!(cfg.googleClientId && cfg.googleSheetId);
  },
  isDropboxConfigured(cfg) {
    return !!(cfg.dropboxAppKey && cfg.dropboxExcelPath);
  }
};

