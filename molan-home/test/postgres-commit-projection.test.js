'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createPostgresRepository, internalUuid } = require('../lib/postgres-repository');

const USER_ID = 'projection-author';
const BOOK_ID = 'projection-book';
const WORKSPACE_ID = internalUuid('projection-workspace');
const PROJECT_ID = internalUuid('projection-project');
const BOOK_UUID = internalUuid(BOOK_ID);
const AUDIT_ID = internalUuid('projection-audit');
const CONTENT = '经审计并提交的正文';
const CONTENT_HASH = crypto.createHash('sha256').update(CONTENT, 'utf8').digest('hex');

function clone(value) {
  return structuredClone(value);
}

class CommitClient {
  constructor() {
    this.queries = [];
    this.snapshot = null;
    this.snapshotPayload = null;
    this.snapshotHash = '';
    this.outboxPayload = null;
  }

  release() {}

  async query(sql, params = []) {
    const statement = String(sql).trim();
    this.queries.push({ statement, params: clone(params) });
    if (/^(SET ROLE|RESET ROLE|RESET ALL|SELECT set_config|SELECT luna\.ensure_actor)/i.test(statement)) return { rows: [], rowCount: 0 };
    if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (statement.includes('FROM luna.creation_books cb')) {
      return { rows: [{
        id: BOOK_UUID, legacy_id: BOOK_ID, workspace_id: WORKSPACE_ID, project_id: PROJECT_ID,
        owner_user_id: internalUuid(USER_ID), title: 'Projection Book', status: 'ready', plan: {},
        current_state_version: 4, current_chapter_no: 3, budget_limit: 20, spent_cost: 3,
        bible_revision: 7, project_legacy_id: 'projection-project', workspace_legacy_id: 'projection-workspace'
      }], rowCount: 1 };
    }
    if (statement.includes('luna.project_access(')) {
      return { rows: [{
        workspace_uuid: WORKSPACE_ID, project_uuid: PROJECT_ID, role: 'editor',
        project_status: 'active', can_spend: true, project_revision: 8, acl_revision: 2
      }], rowCount: 1 };
    }
    if (statement.includes('FROM luna.audits')) {
      return { rows: [{ id: AUDIT_ID, subject_hash: CONTENT_HASH, status: 'passed', result: { passed: true } }], rowCount: 1 };
    }
    if (statement.startsWith('SELECT revision FROM luna.manuscripts')) return { rows: [], rowCount: 0 };
    if (statement.startsWith('INSERT INTO luna.context_snapshots')) {
      this.snapshotHash = params[6];
      this.snapshotPayload = JSON.parse(params[7]);
      return { rows: [], rowCount: 1 };
    }
    if (statement.startsWith('INSERT INTO luna.outbox')) {
      this.outboxPayload = JSON.parse(params[5]);
      return { rows: [], rowCount: 1 };
    }
    if (statement.startsWith('UPDATE luna.creation_books')) return { rows: [{ current_state_version: 5 }], rowCount: 1 };
    if (statement.startsWith('UPDATE luna.projects')) return { rows: [], rowCount: 1 };
    if (/^(INSERT INTO|UPDATE luna\.)/.test(statement)) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected PostgreSQL contract query: ${statement.slice(0, 220)}`);
  }
}

test('PostgreSQL chapter commit persists only the server-derived projection in its snapshot and receipt', async t => {
  const client = new CommitClient();
  class FakePool {
    async connect() { return client; }
    async end() {}
  }
  const repository = createPostgresRepository({
    env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_RUNTIME_ROLE: 'none' },
    Pool: FakePool
  });
  t.after(() => repository.close());

  const projection = {
    characterStates: { lead: { location: 'archive' } },
    relationshipStates: { leadWitness: { trust: 2 } },
    worldStates: { waterLedger: { public: true } },
    timeline: [{ event: '账册公开', chapterNo: 4 }],
    openForeshadows: [{ id: 'promise-1', status: 'open' }],
    recentFacts: [{ fact: '账册已公开', quote: '账册已经贴在门上。' }],
    causalDebts: { status: 'pending_commit', items: [{ id: 'debt-1' }] },
    outlineImpact: { currentNode: 'node-4', status: 'advanced' },
    factLedgerDelta: { newRules: [], newPromises: [], byEntity: {}, updates: [] }
  };
  const receipt = await repository.commitChapter({
    userId: USER_ID,
    bookId: BOOK_ID,
    chapterNo: 4,
    content: CONTENT,
    contentHash: CONTENT_HASH,
    auditId: 'projection-audit',
    baseStateVersion: 4,
    expectedProjectRevision: 8,
    actualCost: 1.25,
    projection,
    characterStates: { forged: true },
    relationshipStates: { forged: true },
    worldStates: { forged: true },
    timeline: [{ event: 'client timeline' }],
    openForeshadows: [{ id: 'client foreshadow' }],
    recentFacts: [{ fact: 'client fact' }]
  });

  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.projection, projection);
  assert.equal(receipt.projectionHash, crypto.createHash('sha256').update(JSON.stringify(projection), 'utf8').digest('hex'));
  for (const key of Object.keys(projection)) assert.deepEqual(client.snapshotPayload[key], projection[key]);
  assert.deepEqual(client.snapshotPayload.characterStates, projection.characterStates);
  assert.equal(client.snapshotPayload.projectionHash, receipt.projectionHash);
  assert.equal(client.snapshotHash, crypto.createHash('sha256').update(JSON.stringify(client.snapshotPayload), 'utf8').digest('hex'));
  assert.equal(client.outboxPayload.projectionHash, receipt.projectionHash);
  assert.equal(client.outboxPayload.snapshotId, receipt.snapshotId);
  assert.equal(client.snapshotPayload.characterStates.forged, undefined);
  assert.equal(client.snapshotPayload.timeline[0].event, '账册公开');
});
