/**
 * Passes table data between extension pages (Data Export -> Data Editor -> Data Import).
 * URL parameters are too small for large results, so the payload is stored in IndexedDB
 * (shared by all pages of the extension) and only its key travels in the URL.
 * Entries older than one day are purged on each save.
 */
const DB_NAME = "sfir-data-editor";
const STORE_NAME = "handoff";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    let request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  let db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      let tx = db.transaction(STORE_NAME, mode);
      let request = action(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * @param {Object} payload Any structured-cloneable value
 * @returns {Promise<string>} The key to pass to the target page as the `handoff` URL parameter
 */
export async function saveHandoff(payload) {
  let now = Date.now();
  let key = now + "-" + Math.random().toString(36).slice(2, 10);
  await withStore("readwrite", store => {
    let keysRequest = store.getAllKeys();
    keysRequest.onsuccess = () => {
      for (let oldKey of keysRequest.result) {
        if (now - parseInt(oldKey, 10) > MAX_AGE_MS) {
          store.delete(oldKey);
        }
      }
    };
    store.put(payload, key);
    return null;
  });
  return key;
}

/**
 * @param {string} key
 * @returns {Promise<Object|undefined>} The stored payload, or undefined if it expired
 */
export function loadHandoff(key) {
  return withStore("readonly", store => store.get(key));
}
