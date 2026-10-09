(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MolanLocalWal = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DB_NAME = 'molan-editor-wal';
  const DB_VERSION = 1;
  const CHANNEL_NAME = 'molan-editor-wal-v1';

  /** 生成从已确认正文到当前正文的单个 UTF-16 splice 操作。 */
  function makeSplice(beforeValue, afterValue) {
    const before = String(beforeValue == null ? '' : beforeValue);
    const after = String(afterValue == null ? '' : afterValue);
    if (before === after) return null;
    let prefix = 0;
    const limit = Math.min(before.length, after.length);
    while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
    if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix -= 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix &&
      before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)) suffix += 1;
    if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) suffix -= 1;
    return {
      type: 'splice',
      index: prefix,
      deleteCount: before.length - prefix - suffix,
      text: after.slice(prefix, after.length - suffix)
    };
  }

  function isHighSurrogate(code) {
    return Number.isInteger(code) && code >= 0xd800 && code <= 0xdbff;
  }

  function isLowSurrogate(code) {
    return Number.isInteger(code) && code >= 0xdc00 && code <= 0xdfff;
  }

  /** 按服务端采用的 UTF-16 索引顺序应用正文 splice 操作。 */
  function applySplices(value, operations) {
    let content = String(value == null ? '' : value);
    if (!Array.isArray(operations)) throw new TypeError('正文操作必须为数组');
    for (const operation of operations) {
      if (!operation || operation.type !== 'splice') throw new TypeError('正文操作类型无效');
      const index = Number(operation.index);
      const deleteCount = Number(operation.deleteCount);
      if (!Number.isInteger(index) || !Number.isInteger(deleteCount) || index < 0 || deleteCount < 0 || index + deleteCount > content.length) {
        throw new RangeError('正文操作位置无效');
      }
      content = content.slice(0, index) + String(operation.text == null ? '' : operation.text) + content.slice(index + deleteCount);
    }
    return content;
  }

  /** 纯 JavaScript SHA-256 兜底实现，保障非安全上下文（如公网 HTTP IP）下正文差量 WAL 正确计算。 */
  function sha256Fallback(bytes) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const len = bytes.length;
    const bitLen = len * 8;
    const padLen = ((len + 8) >> 6 << 6) + 64;
    const msg = new Uint8Array(padLen);
    msg.set(bytes);
    msg[len] = 0x80;
    const view = new DataView(msg.buffer);
    view.setUint32(padLen - 4, bitLen >>> 0);
    view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));

    const W = new Uint32Array(64);
    for (let i = 0; i < padLen; i += 64) {
      for (let j = 0; j < 16; j++) W[j] = view.getUint32(i + j * 4);
      for (let j = 16; j < 64; j++) {
        const s0 = (W[j - 15] >>> 7 | W[j - 15] << 25) ^ (W[j - 15] >>> 18 | W[j - 15] << 14) ^ (W[j - 15] >>> 3);
        const s1 = (W[j - 2] >>> 17 | W[j - 2] << 15) ^ (W[j - 2] >>> 19 | W[j - 2] << 13) ^ (W[j - 2] >>> 10);
        W[j] = (W[j - 16] + s0 + W[j - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let j = 0; j < 64; j++) {
        const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[j] + W[j]) >>> 0;
        const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H = [
        (H[0] + a) >>> 0, (H[1] + b) >>> 0, (H[2] + c) >>> 0, (H[3] + d) >>> 0,
        (H[4] + e) >>> 0, (H[5] + f) >>> 0, (H[6] + g) >>> 0, (H[7] + h) >>> 0
      ];
    }
    return H.map(val => val.toString(16).padStart(8, '0')).join('');
  }

  /** 计算用于正文基线校验的 SHA-256。 */
  async function hashText(value, cryptoApi) {
    const bytes = new TextEncoder().encode(String(value == null ? '' : value));
    const cryptoSource = cryptoApi || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (cryptoSource && cryptoSource.subtle && typeof cryptoSource.subtle.digest === 'function') {
      try {
        const digest = await cryptoSource.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), item => item.toString(16).padStart(2, '0')).join('');
      } catch (_) {
        // 安全上下文不可用或算法被拦截时平滑降级到纯 JS 计算
      }
    }
    if (typeof require === 'function') {
      try {
        return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
      } catch (_) {
        // 继续回退
      }
    }
    return sha256Fallback(bytes);
  }

  /** 创建 IndexedDB WAL 存储与跨标签通知通道。 */
  function create(options) {
    const config = options || {};
    const idb = config.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    const channelFactory = config.BroadcastChannel || (typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null);
    if (!idb) throw new Error('当前浏览器不支持 IndexedDB');
    let databasePromise = null;
    let channel = null;
    const listeners = new Set();

    function openDatabase() {
      if (databasePromise) return databasePromise;
      const opening = new Promise((resolve, reject) => {
        const request = idb.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('operations')) {
            const store = db.createObjectStore('operations', { keyPath: 'opId' });
            store.createIndex('projectId', 'projectId', { unique: false });
          }
          if (!db.objectStoreNames.contains('heads')) db.createObjectStore('heads', { keyPath: 'docKey' });
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => db.close();
          resolve(db);
        };
        request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
        request.onblocked = () => reject(new Error('IndexedDB 正被其他页面升级，请关闭旧页面后重试'));
      });
      databasePromise = opening.catch(error => {
        databasePromise = null;
        throw error;
      });
      return databasePromise;
    }

    function ensureChannel() {
      if (!channel && channelFactory) {
        try {
          channel = new channelFactory(CHANNEL_NAME);
          channel.onmessage = event => notify(event && event.data);
        } catch (_) { channel = null; }
      }
      return channel;
    }

    function notify(message) {
      if (!message || typeof message !== 'object') return;
      listeners.forEach(listener => {
        try { listener(message); } catch (_) {}
      });
    }

    function publish(message) {
      const target = ensureChannel();
      if (target) target.postMessage(message);
    }

    async function getHead(docKey) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('heads', 'readonly');
        const request = tx.objectStore('heads').get(String(docKey));
        let head = { docKey: String(docKey), version: 0 };
        request.onsuccess = () => { if (request.result) head = request.result; };
        tx.oncomplete = () => resolve(head);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB 版本读取失败'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB 版本读取已中断'));
      });
    }

    /** 原子写入 WAL 操作并递增同一场景的本地版本。 */
    async function put(recordValue, expectedVersion) {
      const record = Object.assign({}, recordValue || {});
      if (!record.opId || !record.projectId || !record.docKey || !record.chapterId || !record.sceneId) {
        throw new TypeError('WAL 操作缺少稳定作品、章节或场景标识');
      }
      const db = await openDatabase();
      const outcome = await new Promise((resolve, reject) => {
        const tx = db.transaction(['operations', 'heads'], 'readwrite');
        const operations = tx.objectStore('operations');
        const heads = tx.objectStore('heads');
        const existingHeadRequest = heads.get(record.docKey);
        let result = null;
        existingHeadRequest.onsuccess = () => {
          const head = existingHeadRequest.result || { docKey: record.docKey, version: 0 };
          const currentVersion = Number(head.version) || 0;
          const stale = expectedVersion != null && Number(expectedVersion) !== currentVersion;
          const existingOperationRequest = operations.get(record.opId);
          existingOperationRequest.onsuccess = () => {
            const existing = existingOperationRequest.result;
            const version = currentVersion + 1;
            const saved = Object.assign({}, record, {
              localVersion: version,
              operationVersion: (Number(existing && existing.operationVersion) || 0) + 1,
              conflicted: Boolean(record.conflicted || stale),
              updatedAt: Number(record.updatedAt) || Date.now()
            });
            heads.put({ docKey: record.docKey, projectId: record.projectId, version, updatedAt: saved.updatedAt });
            operations.put(saved);
            result = { record: saved, version, conflict: saved.conflicted, previousVersion: currentVersion };
          };
          existingOperationRequest.onerror = () => { tx.abort(); };
        };
        existingHeadRequest.onerror = () => { tx.abort(); };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB WAL 写入失败'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB WAL 写入已中断'));
      });
      publish({ type: 'changed', projectId: outcome.record.projectId, docKey: outcome.record.docKey,
        opId: outcome.record.opId, tabId: outcome.record.tabId, localVersion: outcome.version,
        conflicted: outcome.conflict });
      return outcome;
    }

    /** 读取作品内尚未被服务端确认的全部正文操作。 */
    async function readProject(projectId) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('operations', 'readonly');
        const request = tx.objectStore('operations').index('projectId').getAll(String(projectId));
        let records = [];
        request.onsuccess = () => { records = Array.isArray(request.result) ? request.result : []; };
        tx.oncomplete = () => resolve(records.sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || Number(a.localVersion) - Number(b.localVersion)));
        tx.onerror = () => reject(tx.error || new Error('IndexedDB WAL 读取失败'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB WAL 读取已中断'));
      });
    }

    /** 仅在服务端确认的操作版本仍是最新时删除 WAL。 */
    async function remove(opId, expectedOperationVersion, message) {
      const db = await openDatabase();
      const removed = await new Promise((resolve, reject) => {
        const tx = db.transaction('operations', 'readwrite');
        const store = tx.objectStore('operations');
        const request = store.get(String(opId));
        let didRemove = false;
        request.onsuccess = () => {
          const current = request.result;
          if (current && Number(current.operationVersion) === Number(expectedOperationVersion)) {
            store.delete(String(opId));
            didRemove = true;
          }
        };
        request.onerror = () => { tx.abort(); };
        tx.oncomplete = () => resolve(didRemove);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB WAL 清理失败'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB WAL 清理已中断'));
      });
      if (removed && message) publish(Object.assign({ type: 'synced', opId }, message));
      return removed;
    }

    return {
      getHead,
      put,
      readProject,
      remove,
      hashText,
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        ensureChannel();
        return () => listeners.delete(listener);
      },
      close() {
        if (channel) channel.close();
        channel = null;
        const pending = databasePromise;
        databasePromise = null;
        if (pending) pending.then(db => { if (db) db.close(); }).catch(() => {});
        listeners.clear();
      }
    };
  }

  return { create, makeSplice, applySplices, hashText };
}));
