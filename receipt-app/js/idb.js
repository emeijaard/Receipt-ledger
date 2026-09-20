// Minimal IndexedDB wrapper. Two object stores:
//   kv     - single-value settings (key/value)
//   queue  - offline queue of receipts not yet synced
'use strict';

const IDB = (() => {
  const DB_NAME = 'receipt-ledger';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('queue')) {
          const store = db.createObjectStore('queue', { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  return {
    async get(key) {
      const store = await tx('kv', 'readonly');
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, value) {
      const store = await tx('kv', 'readwrite');
      return new Promise((resolve, reject) => {
        const req = store.put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async del(key) {
      const store = await tx('kv', 'readwrite');
      return new Promise((resolve, reject) => {
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },

    // --- offline queue ---
    async queueAdd(item) {
      const store = await tx('queue', 'readwrite');
      return new Promise((resolve, reject) => {
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async queueUpdate(item) {
      return this.queueAdd(item);
    },
    async queueRemove(id) {
      const store = await tx('queue', 'readwrite');
      return new Promise((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
    async queueAll() {
      const store = await tx('queue', 'readonly');
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
        req.onerror = () => reject(req.error);
      });
    }
  };
})();
