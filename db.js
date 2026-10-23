// IndexedDB（仕様書 4章）
// DB名はリリース後に変更しない。スキーマを変えるときは DB_VERSION を上げ、onupgradeneeded で移行する。
import { normalizeName } from './util.js';

const DB_NAME = 'shoppinglist-db';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) {
          const items = db.createObjectStore('items', { keyPath: 'id' });
          items.createIndex('list', 'list');
        }
        if (!db.objectStoreNames.contains('history')) {
          db.createObjectStore('history', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // 別タブで新しい版がDBを更新しようとしたら、こちらは閉じて道を譲る
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

// fn(t) の中でリクエストを発行する。トランザクション完了時に fn の戻り値で解決する。
async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('トランザクションが中断されました'));
    try {
      result = fn(t);
    } catch (e) {
      t.abort();
      reject(e);
    }
  });
}

// 品名履歴の更新（仕様書 4-3）
function changeHistory(store, name, delta, now) {
  const key = normalizeName(name);
  store.get(key).onsuccess = (e) => {
    const h = e.target.result;
    if (delta > 0) {
      store.put(h
        ? { ...h, name, count: h.count + 1, lastBoughtAt: now }
        : { key, name, count: 1, lastBoughtAt: now });
    } else if (h) {
      if (h.count <= 1) store.delete(key);
      else store.put({ ...h, count: h.count - 1 });
    }
  };
}

export function loadAll() {
  return tx(['items', 'history'], 'readonly', (t) => {
    const out = { items: [], history: [] };
    t.objectStore('items').getAll().onsuccess = (e) => { out.items = e.target.result; };
    t.objectStore('history').getAll().onsuccess = (e) => { out.history = e.target.result; };
    return out;
  });
}

// アイテムの保存。購入済みだったものが未購入になる場合は、品名履歴を1減らす。
export function saveItem(next, prev = null) {
  return tx(['items', 'history'], 'readwrite', (t) => {
    t.objectStore('items').put(next);
    if (prev && prev.done && !next.done) {
      changeHistory(t.objectStore('history'), prev.name, -1, next.updatedAt);
    }
  });
}

// 購入済み／未購入の切り替え
export function setDone(id, done) {
  return tx(['items', 'history'], 'readwrite', (t) => {
    const items = t.objectStore('items');
    items.get(id).onsuccess = (e) => {
      const item = e.target.result;
      if (!item || item.list !== 'now' || item.done === done) return;
      const now = new Date().toISOString();
      item.done = done;
      item.doneAt = done ? now : null;
      item.updatedAt = now;
      items.put(item);
      changeHistory(t.objectStore('history'), item.name, done ? 1 : -1, now);
    };
  });
}

// 削除（品名履歴は変更しない）
export function deleteItems(ids) {
  return tx(['items'], 'readwrite', (t) => {
    const store = t.objectStore('items');
    for (const id of ids) store.delete(id);
  });
}

// 「まとめて消す」の取り消し用（品名履歴は変更しない）
export function restoreItems(items) {
  return tx(['items'], 'readwrite', (t) => {
    const store = t.objectStore('items');
    for (const item of items) store.put(item);
  });
}

// インポート：全置換を1つのトランザクションで行う
export function replaceAll(items, history) {
  return tx(['items', 'history'], 'readwrite', (t) => {
    const itemStore = t.objectStore('items');
    const historyStore = t.objectStore('history');
    itemStore.clear();
    historyStore.clear();
    for (const item of items) itemStore.put(item);
    for (const h of history) historyStore.put(h);
  });
}
