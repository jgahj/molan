const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const walApi = require('../lib/client/local-wal');
const editorSource = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');

class FakeRequest {}

class FakeStore {
  constructor(database, name) {
    this.database = database;
    this.name = name;
  }

  get(key) {
    return this._request(() => this.database.data.get(this.name).get(key));
  }

  put(value) {
    return this._request(() => {
      const key = this.name === 'heads' ? value.docKey : value.opId;
      this.database.data.get(this.name).set(key, structuredClone(value));
      return key;
    });
  }

  delete(key) {
    return this._request(() => this.database.data.get(this.name).delete(key));
  }

  index(name) {
    assert.equal(name, 'projectId');
    return {
      getAll: projectId => this._request(() => [...this.database.data.get(this.name).values()]
        .filter(record => record.projectId === projectId).map(record => structuredClone(record)))
    };
  }

  createIndex() {}

  _request(run) {
    const request = new FakeRequest();
    this.transaction.enqueue(() => {
      try {
        request.result = run();
        if (request.onsuccess) request.onsuccess({ target: request });
      } catch (error) {
        request.error = error;
        if (request.onerror) request.onerror({ target: request });
        this.transaction.error = error;
      }
    });
    return request;
  }

  get transaction() {
    return this.database.activeTransaction;
  }
}

class FakeTransaction {
  constructor(database, names) {
    this.database = database;
    this.names = names;
    this.pending = 0;
    this.completed = false;
    this.completionScheduled = false;
    this.error = null;
  }

  objectStore(name) {
    assert.ok(this.names.includes(name));
    return new FakeStore(this.database, name);
  }

  enqueue(run) {
    this.pending += 1;
    setTimeout(() => {
      if (this.completed) return;
      run();
      this.pending -= 1;
      this._scheduleCompletion();
    }, 0);
  }

  abort() {
    this.completed = true;
    if (this.onabort) this.onabort();
  }

  _scheduleCompletion() {
    if (this.pending || this.completed || this.completionScheduled) return;
    this.completionScheduled = true;
    setTimeout(() => {
      this.completionScheduled = false;
      if (this.pending || this.completed) return;
      this.completed = true;
      if (this.error && this.onerror) this.onerror();
      else if (this.oncomplete) this.oncomplete();
    }, 0);
  }
}

class FakeDatabase {
  constructor() {
    this.data = new Map();
    this.objectStoreNames = { contains: name => this.data.has(name) };
    this.activeTransaction = null;
  }

  createObjectStore(name) {
    this.data.set(name, new Map());
    return new FakeStore(this, name);
  }

  transaction(names) {
    const transaction = new FakeTransaction(this, Array.isArray(names) ? names : [names]);
    this.activeTransaction = transaction;
    return transaction;
  }

  close() {}
}

class FakeIndexedDB {
  constructor() {
    this.databases = new Map();
  }

  open(name) {
    const request = new FakeRequest();
    setTimeout(() => {
      let database = this.databases.get(name);
      if (!database) {
        database = new FakeDatabase();
        this.databases.set(name, database);
        request.result = database;
        if (request.onupgradeneeded) request.onupgradeneeded({ target: request });
      }
      request.result = database;
      if (request.onsuccess) request.onsuccess({ target: request });
    }, 0);
    return request;
  }
}

const channels = new Map();
class FakeBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.peers = channels.get(name) || new Set();
    this.peers.add(this);
    channels.set(name, this.peers);
  }

  postMessage(data) {
    for (const peer of this.peers) {
      if (peer !== this && peer.onmessage) setTimeout(() => peer.onmessage({ data: structuredClone(data) }), 0);
    }
  }

  close() { this.peers.delete(this); }
}

function record(opId, tabId, projectId, docKey, operation) {
  return { opId, tabId, projectId, docKey, chapterId: 'chapter-1', sceneId: 'scene-1', baseRevision: 7, baseHash: 'base', operations: [operation] };
}

test('text splice round-trips insertions, replacements, deletions, and UTF-16 surrogate pairs', () => {
  const cases = [
    ['', '新正文'],
    ['甲乙丙', '甲丁丙'],
    ['甲乙丙', '甲丙'],
    ['甲😀乙', '甲🌙乙']
  ];
  for (const [before, after] of cases) {
    const operation = walApi.makeSplice(before, after);
    assert.equal(walApi.applySplices(before, [operation]), after);
  }
  assert.equal(walApi.makeSplice('相同', '相同'), null);
});

test('SHA-256 matches the endpoint baseHash contract', async () => {
  assert.equal(await walApi.hashText('章内正文'), createHash('sha256').update('章内正文').digest('hex'));
});

test('IndexedDB WAL detects cross-tab version conflicts and conditionally clears acknowledged operations', async () => {
  const indexedDB = new FakeIndexedDB();
  const first = walApi.create({ indexedDB, BroadcastChannel: FakeBroadcastChannel });
  const second = walApi.create({ indexedDB, BroadcastChannel: FakeBroadcastChannel });
  const observed = [];
  second.subscribe(message => observed.push(message));
  const projectId = 'writer:novel-1';
  const docKey = `${projectId}|chapter-1|scene-1`;
  const initialHead = await first.getHead(docKey);
  assert.equal(initialHead.version, 0);
  const firstWrite = await first.put(record('tab-a:scene-1', 'tab-a', projectId, docKey, { type: 'splice', index: 0, deleteCount: 0, text: 'A' }), initialHead.version);
  assert.equal(firstWrite.conflict, false);
  const staleWrite = await second.put(record('tab-b:scene-1', 'tab-b', projectId, docKey, { type: 'splice', index: 0, deleteCount: 0, text: 'B' }), initialHead.version);
  assert.equal(staleWrite.conflict, true);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(observed.some(message => message.type === 'changed' && message.tabId === 'tab-a'));
  const records = await first.readProject(projectId);
  assert.equal(records.length, 2);
  assert.equal(records.find(item => item.opId === staleWrite.record.opId).conflicted, true);
  assert.equal(await first.remove(firstWrite.record.opId, firstWrite.record.operationVersion + 1), false);
  assert.equal(await first.remove(firstWrite.record.opId, firstWrite.record.operationVersion), true);
  assert.equal((await first.readProject(projectId)).length, 1);
});

test('editor persists scene body through IndexedDB before a CAS PATCH and keeps WAL on failure', () => {
  assert.match(editorSource, /function scheduleEditorWalSave\(sceneRef\)/);
  assert.match(editorSource, /}, 250\);/);
  assert.match(editorSource, /async function persistNovelScenePatch\(options\)/);
  assert.match(editorSource, /method: 'PATCH',[\s\S]*?chapterId: doc\.chapterId,[\s\S]*?revision: savedWal\.record\.baseRevision,[\s\S]*?baseHash: savedWal\.record\.baseHash,[\s\S]*?operations: savedWal\.record\.operations/);
  assert.match(editorSource, /editorWal\.remove\(savedWal\.record\.opId, savedWal\.record\.operationVersion/);
  assert.match(editorSource, /if \(options && options\.patchSave && !options\.snapshot && backend\.token/);
  assert.match(editorSource, /if \(pending\.length !== 1 \|\| latest\.conflicted\)/);
  assert.match(editorSource, /runtime\.editorWalConflicts\.add\(message\.docKey\)/);
});
