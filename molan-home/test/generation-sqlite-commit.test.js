'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const generationStore = require('../lib/generation/sqlite-store');
const projectResources = require('../lib/project-resources');
const { initializeCommitReceipts } = require('../lib/benchmark-commit');
const { commitSqliteChapter } = require('../lib/generation/sqlite-commit');

function hash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function commitDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE novel_projects (
    workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', acl_revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(workspace_id, project_id)
  )`);
  db.exec(`CREATE TABLE novels (
    id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT, state_json TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0
  )`);
  projectResources.initializeSchema(db);
  initializeCommitReceipts(db);
  db.exec(`CREATE TABLE creation_books (
    id TEXT PRIMARY KEY, user_email TEXT, title TEXT, current_state_version INTEGER NOT NULL,
    current_chapter_no INTEGER NOT NULL, budget_limit REAL NOT NULL, spent_cost REAL NOT NULL,
    owner_user_id TEXT, workspace_id TEXT, project_id TEXT, updated_at INTEGER NOT NULL DEFAULT 0
  )`);
  db.exec(`CREATE TABLE creation_bibles (id TEXT PRIMARY KEY, book_id TEXT, current_version INTEGER)`);
  db.exec(`CREATE TABLE creation_bible_versions (
    id TEXT PRIMARY KEY, bible_id TEXT, version INTEGER, payload_json TEXT
  )`);
  db.exec(`CREATE TABLE creation_chapter_audits (
    id TEXT PRIMARY KEY, book_id TEXT, user_email TEXT, chapter_no INTEGER, content_hash TEXT, passed INTEGER,
    quality_gate TEXT, originality_status TEXT, blocker_count INTEGER, audit_credit_cost REAL, result_json TEXT,
    created_at INTEGER, bible_version INTEGER, state_version INTEGER, context_hash TEXT, delta_hash TEXT,
    plan_hash TEXT, actor_user_id TEXT, workspace_id TEXT, project_id TEXT
  )`);
  db.exec(`CREATE TABLE creation_state_snapshots (
    id TEXT PRIMARY KEY, book_id TEXT, chapter_no INTEGER, bible_version INTEGER, state_version INTEGER,
    character_states_json TEXT, relationship_states_json TEXT, world_states_json TEXT, timeline_json TEXT,
    open_foreshadows_json TEXT, recent_facts_json TEXT, outline_impact_json TEXT NOT NULL DEFAULT '{}',
    content_ref TEXT, content_hash TEXT, audit_status TEXT,
    created_at INTEGER, actor_user_id TEXT, workspace_id TEXT, project_id TEXT
  )`);
  const scope = { workspace_id: 'ws-1', project_id: 'n-1', role: 'owner', active: true };
  const now = Date.now();
  db.prepare(`INSERT INTO novel_projects (workspace_id,project_id,owner_user_id,title,status,acl_revision,created_at,updated_at)
    VALUES (?,?,?,'Test','active',1,?,?)`).run('ws-1', 'n-1', 'user-1', now, now);
  const state = { volumes: [{ chapters: [{ id: 'chapter_1', scenes: [{ id: 'scene_1', content: '旧正文' }] }] }] };
  db.prepare(`INSERT INTO novels (id,workspace_id,project_id,state_json,word_count,updated_at,revision)
    VALUES (?,?,?,?,?,?,?)`).run('n-1', 'ws-1', 'n-1', JSON.stringify(state), 3, now, 4);
  db.prepare(`INSERT INTO creation_books
    (id,user_email,title,current_state_version,current_chapter_no,budget_limit,spent_cost,owner_user_id,workspace_id,project_id)
    VALUES ('book-1','writer@example.test','Test',0,0,3,0,'user-1','ws-1','n-1')`).run();
  db.prepare(`INSERT INTO creation_bibles (id,book_id,current_version) VALUES ('bible-1','book-1',1)`).run();
  db.prepare(`INSERT INTO creation_bible_versions (id,bible_id,version,payload_json) VALUES ('bible-v1','bible-1',1,'{}')`).run();
  return { db, scope };
}

function commitInput(text = '新正文') {
  const contentHash = hash(text);
  const delta = { newPromises: ['找到真相'], newRules: [], updates: [], byEntity: {} };
  return {
    actorUserId: 'user-1', userEmail: 'writer@example.test', projectAccess: {
      ...scopeForAccess, active: true, role: 'owner'
    },
    run: {
      id: 'run-1', projectId: 'n-1', workspaceId: 'ws-1', actualCostMinor: 50,
      result: {
        draft: text, outputHash: contentHash, contract: { chapterNo: 1 },
        audit: { passed: true, issues: [] },
        benchmark: { status: 'passed' },
        semanticAudit: { passed: true, audit: { passed: true, issues: [], factLedgerDelta: delta } },
        quality: { passed: true, qualityVector: { language: { value: 0.9, confidence: 0.9 } } }
      }
    },
    request: {
      creationBookId: 'book-1', novelId: 'n-1', chapterId: 'chapter_1', sceneId: 'scene_1',
      storyContext: { stateVersion: 0, baseRevision: 4, baseHash: hash('旧正文') }
    },
    payload: {
      projectId: 'n-1', expectedRevision: 4,
      payload: {
        chapterId: 'chapter_1', sceneId: 'scene_1', chapterNo: 1, baseStateVersion: 0,
        baseHash: hash('旧正文'), content: text, characterStates: { lead: 'present' }, recentFacts: ['找到真相']
      }
    },
    text,
    recordDebts() {}
  };
}

const scopeForAccess = { workspace_id: 'ws-1', project_id: 'n-1' };

test('SQLite generation commit atomically writes scene, manuscript, snapshot, budget, audit and receipt', () => {
  const { db, scope } = commitDatabase();
  try {
    const receipt = commitSqliteChapter(db, commitInput());
    assert.equal(receipt.committed, true);
    assert.equal(receipt.stateVersion, 1);
    assert.equal(receipt.projectRevision, 5);
    assert.equal(receipt.spentCost, 0.5);
    const state = JSON.parse(db.prepare('SELECT state_json FROM novels WHERE id = ?').get('n-1').state_json);
    assert.equal(state.volumes[0].chapters[0].scenes[0].content, '新正文');
    const manuscript = db.prepare(`SELECT payload_json FROM project_resources WHERE workspace_id = ? AND project_id = ? AND kind = 'manuscript'`)
      .get(scope.workspace_id, scope.project_id);
    assert.equal(JSON.parse(manuscript.payload_json).text, '新正文');
    assert.equal(Number(db.prepare('SELECT current_state_version FROM creation_books WHERE id = ?').get('book-1').current_state_version), 1);
    assert.equal(Number(db.prepare('SELECT spent_cost FROM creation_books WHERE id = ?').get('book-1').spent_cost), 0.5);
    assert.equal(Number(db.prepare('SELECT count(*) AS n FROM creation_chapter_audits').get().n), 1);
    assert.equal(Number(db.prepare('SELECT count(*) AS n FROM creation_state_snapshots').get().n), 1);
    assert.equal(Number(db.prepare('SELECT count(*) AS n FROM benchmark_commit_receipts').get().n), 1);
  } finally {
    db.close();
  }
});

test('same chapter and content replays idempotently; different content is rejected without another debit', () => {
  const { db } = commitDatabase();
  try {
    const first = commitInput();
    const initial = commitSqliteChapter(db, first);
    const replay = commitSqliteChapter(db, first);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.snapshotId, initial.snapshotId);
    assert.throws(() => commitSqliteChapter(db, commitInput('另一版')), { code: 'STATE_CONFLICT', status: 409 });
    assert.equal(Number(db.prepare('SELECT spent_cost FROM creation_books WHERE id = ?').get('book-1').spent_cost), 0.5);
    assert.equal(Number(db.prepare('SELECT revision FROM novels WHERE id = ?').get('n-1').revision), 5);
  } finally {
    db.close();
  }
});

test('SQLite commit rejects stale story state and project revisions before mutation', () => {
  const { db } = commitDatabase();
  try {
    const staleProject = commitInput();
    staleProject.payload.expectedRevision = 3;
    assert.throws(() => commitSqliteChapter(db, staleProject), { code: 'STATE_CONFLICT', status: 409 });
    assert.equal(Number(db.prepare('SELECT count(*) AS n FROM creation_state_snapshots').get().n), 0);
    const staleState = commitInput();
    staleState.payload.payload.baseStateVersion = 1;
    assert.throws(() => commitSqliteChapter(db, staleState), { code: 'STATE_CONFLICT', status: 409 });
    assert.equal(Number(db.prepare('SELECT revision FROM novels WHERE id = ?').get('n-1').revision), 4);
  } finally {
    db.close();
  }
});

test('SQLite commit rejects missing or failed semantic and quality evidence', () => {
  const { db } = commitDatabase();
  try {
    const missingQuality = commitInput();
    delete missingQuality.run.result.quality;
    assert.throws(() => commitSqliteChapter(db, missingQuality), { code: 'AUDIT_BLOCKED' });

    const failedSemantic = commitInput();
    failedSemantic.run.result.semanticAudit.passed = false;
    assert.throws(() => commitSqliteChapter(db, failedSemantic), { code: 'AUDIT_BLOCKED' });

    const failedQuality = commitInput();
    failedQuality.run.result.quality.passed = false;
    assert.throws(() => commitSqliteChapter(db, failedQuality), { code: 'AUDIT_BLOCKED' });
    assert.equal(Number(db.prepare('SELECT count(*) AS n FROM creation_state_snapshots').get().n), 0);
  } finally {
    db.close();
  }
});

test('SQLite worker pauses only before Provider; expired Provider work becomes unknown and cannot be reclaimed', () => {
  const db = new DatabaseSync(':memory:');
  const store = generationStore;
  store.ensureSqliteSchema(db);
  const input = {
    id: 'run-safe', workspaceId: 'ws-1', projectId: 'n-1', actorUserId: 'user-1', chapterId: 'chapter_1',
    idempotencyKey: 'safe-key', requestHash: hash('safe'), request: { projectId: 'n-1' }
  };
  try {
    const created = store.createRun(db, input).run;
    const owner = 'worker-1';
    const lease = store.acquireLease(db, { ...input, leaseOwner: owner, ttlMs: 20000 });
    assert.equal(lease.acquired, true);
    const scope = { ...input, leaseOwner: owner, fencingToken: lease.fencingToken };
    let run = created;
    for (const state of ['request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated', 'pre_generation_guard', 'scene_planning']) {
      run = store.updateRun(db, { ...scope, state });
    }
    assert.equal(store.requestPause(db, input).pauseRequested, true);
    const paused = store.beginProvider(db, { ...scope, id: input.id });
    assert.equal(paused.paused, true);
    assert.equal(paused.run.state, 'paused');
    store.releaseLease(db, { ...scope, id: input.id });
    const resumed = store.resumeRun(db, input);
    assert.equal(resumed.state, 'created');

    const secondInput = { ...input, id: 'run-provider', idempotencyKey: 'provider-key' };
    store.createRun(db, secondInput);
    const secondLease = store.acquireLease(db, { ...secondInput, leaseOwner: 'worker-2', ttlMs: 20000 });
    const secondScope = { ...secondInput, leaseOwner: 'worker-2', fencingToken: secondLease.fencingToken };
    for (const state of ['request_validated', 'genre_resolved', 'style_resolved', 'context_built', 'contract_validated', 'pre_generation_guard', 'scene_planning']) {
      store.updateRun(db, { ...secondScope, state });
    }
    assert.equal(store.beginProvider(db, { ...secondScope, id: secondInput.id }).paused, false);
    assert.throws(() => store.requestPause(db, secondInput), { code: 'STATE_CONFLICT', status: 409 });
    const recovered = store.recoverExpiredRuns(db, Date.now() + 30000);
    assert.equal(recovered.providerUnknown, 1);
    assert.equal(store.getRun(db, secondInput).state, 'provider_unknown');
    assert.equal(store.acquireLease(db, { ...secondInput, leaseOwner: 'worker-3' }).acquired, false);
  } finally {
    db.close();
  }
});
