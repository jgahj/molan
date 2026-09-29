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

  /** 计算用于正文基线校验的 SHA-256。 */
  async function hashText(value, cryptoApi) {
    const bytes = new TextEncoder().encode(String(value == null ? '' : value));
    const cryptoSource = cryptoApi || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (cryptoSource && cryptoSource.subtle && typeof cryptoSource.subtle.digest === 'function') {
      const digest = await cryptoSource.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), item => item.toString(16).padStart(2, '0')).join('');
    }
    if (typeof require === 'function') return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    throw new Error('当前环境不支持 SHA-256，未能安全保存正文差量');
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
