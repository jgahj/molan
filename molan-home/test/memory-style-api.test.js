'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');

const memorySystem = require('../lib/memory-system');
const styleSystem = require('../lib/style-system');
const memoryRoutes = require('../lib/memory-routes');
const projectScope = require('../lib/project-scope');

function createTestDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE accounts (user_id TEXT PRIMARY KEY);
    INSERT INTO accounts VALUES ('user-001'), ('viewer'), ('outsider')`);
  projectScope.initializeSchema(db);
  db.exec(`INSERT INTO workspaces VALUES ('workspace', 'user-001', 'fixture', 1, 1);
    INSERT INTO workspace_members VALUES ('workspace', 'user-001', 'owner', 1, 1, 1),
      ('workspace', 'viewer', 'member', 1, 1, 1), ('workspace', 'outsider', 'admin', 1, 1, 1);
    INSERT INTO novel_projects (workspace_id, project_id, owner_user_id, created_at, updated_at)
      VALUES ('workspace', 'novel_test_001', 'user-001', 1, 1);
    INSERT INTO project_members VALUES ('workspace', 'novel_test_001', 'user-001', 'owner', 1, 1, 1, 1, 1),
      ('workspace', 'novel_test_001', 'viewer', 'viewer', 1, 0, 0, 1, 1)`);
  memorySystem.initializeSchema(db);
  styleSystem.initializeSchema(db);
  return db;
}

function mockRequestResponse(method, url, body = null, user = { userId: 'user-001', email: 'author@molan.local' }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost' };

  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    finished: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(chunk) {
      if (chunk) this.body += chunk;
      this.finished = true;
      this.emit('finish');
    }
  };
  Object.setPrototypeOf(res, EventEmitter.prototype);

  process.nextTick(() => {
    if (body) {
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.emit('end');
  });

  const getAuthUser = () => (user ? { user, token: 'fake-token' } : null);

  return { req, res, getAuthUser };
}

async function invokeRoute(db, method, url, body = null, user = { userId: 'user-001', email: 'author@molan.local' }, options = {}) {
  const { req, res, getAuthUser } = mockRequestResponse(method, url, body, user);
  const u = url.split('?')[0];
  const handled = await memoryRoutes.dispatch(req, res, u, db, getAuthUser, options);
  if (!res.finished) {
    await new Promise(resolve => res.on('finish', resolve));
  }
  let parsed = null;
  try {
    parsed = JSON.parse(res.body);
  } catch (_) {}
  return { handled, status: res.statusCode, body: parsed, raw: res.body };
}

test('记忆文风路由适配回归（内存数据库与请求桩）', async () => {
  const db = createTestDatabase();
  const bookId = 'novel_test_001';

  // 1. POST /api/books/:bookId/memory/extract
  const extractRes = await invokeRoute(db, 'POST', `/api/books/${bookId}/memory/extract`, {
    text: '师妹按住青锋剑，沉声道：“此行凶险异常。” 主角暗想难道真有伏兵？他打算先行探路。'
  });
  assert.equal(extractRes.handled, true);
  assert.equal(extractRes.status, 200);
  assert.ok(extractRes.body.propositions.length >= 2);
  assert.ok(extractRes.body.evidence.length >= 2);

  const prop1 = extractRes.body.propositions[0];
  db.prepare(`INSERT INTO memory_propositions (id, book_id, display_text, created_at)
    VALUES (?, ?, ?, ?)`).run(prop1.id, bookId, prop1.displayText, Date.now());

  // 2. 变更集创建与接口审查: GET & POST /api/books/:bookId/memory/changesets/:id/approve & commit
  const changeset = memorySystem.createChangeset(db, {
    bookId,
    baseStateVersion: 1,
    operations: [
      {
        type: 'INSERT_FACT',
        payload: {
          id: 'dec_fact_001',
          bookId,
          propositionId: prop1.id,
          verdict: 'true',
          status: 'confirmed',
          decisionReason: '主线初显'
        }
      }
    ]
  });

  // GET /api/books/:bookId/memory/changesets/:id
  const csGetRes = await invokeRoute(db, 'GET', `/api/books/${bookId}/memory/changesets/${changeset.id}`);
  assert.equal(csGetRes.status, 200);
  assert.equal(csGetRes.body.changeset.id, changeset.id);

  // POST /api/books/:bookId/memory/changesets/:id/approve
  const csApproveRes = await invokeRoute(db, 'POST', `/api/books/${bookId}/memory/changesets/${changeset.id}/approve`, { status: 'approved' });
  assert.equal(csApproveRes.status, 200);
  assert.equal(csApproveRes.body.approvalStatus, 'approved');

  // POST /api/books/:bookId/memory/changesets/:id/commit
  const csCommitRes = await invokeRoute(db, 'POST', `/api/books/${bookId}/memory/changesets/${changeset.id}/commit`, {});
  assert.equal(csCommitRes.status, 200);
  assert.equal(csCommitRes.body.stateVersion, 2);

  // 3. GET /api/books/:bookId/memory
  const memGetRes = await invokeRoute(db, 'GET', `/api/books/${bookId}/memory`);
  assert.equal(memGetRes.status, 200);
  assert.equal(memGetRes.body.memory.length, 1);
  assert.equal(memGetRes.body.memory[0].id, 'dec_fact_001');

  // 4. POST /api/books/:bookId/memory/operations/:id/revert
  const opLog = db.prepare("SELECT id FROM memory_operations_log WHERE changeset_id = ?").get(changeset.id);
  assert.ok(opLog);
  const revertRes = await invokeRoute(db, 'POST', `/api/books/${bookId}/memory/operations/${opLog.id}/revert`, { reason: '调整剧情' });
  assert.equal(revertRes.status, 200);
  assert.equal(revertRes.body.ok, true);

  // 5. GET /api/books/:bookId/cognition
  memorySystem.recordCognition(db, {
    id: 'cog_test',
    bookId,
    holderEntityId: 'protagonist',
    targetExpressionId: prop1.id,
    attitude: 'knows'
  });
  const cogRes = await invokeRoute(db, 'GET', `/api/books/${bookId}/cognition?holderEntityId=protagonist`);
  assert.equal(cogRes.status, 200);
  assert.equal(cogRes.body.cognitions.length, 1);

  // 6. GET /api/books/:bookId/timeline
  db.prepare(`INSERT INTO story_events (id, book_id, timeline_id, title, created_at)
    VALUES ('ev_1', ?, 't0', '出发', 1000)`).run(bookId);
  const timelineRes = await invokeRoute(db, 'GET', `/api/books/${bookId}/timeline`);
  assert.equal(timelineRes.status, 200);
  assert.equal(timelineRes.body.timeline.events.length, 1);

  // 7. POST /api/books/:bookId/context/assemble
  const assembleRes = await invokeRoute(db, 'POST', `/api/books/${bookId}/context/assemble`, {
    povId: 'protagonist',
    budgetTokens: 3000
  });
  assert.equal(assembleRes.status, 200);
  assert.ok(assembleRes.body.manifest.id);

  // 8. GET /api/books/:bookId/context/:manifestId
  const manifestId = assembleRes.body.manifest.id;
  const manifestRes = await invokeRoute(db, 'GET', `/api/books/${bookId}/context/${manifestId}`);
  assert.equal(manifestRes.status, 200);
  assert.equal(manifestRes.body.manifest.id, manifestId);

  // 9. POST /api/books/:bookId/styles
  const styleCreateRes = await invokeRoute(db, 'POST', `/api/books/${bookId}/styles`, {
    name: '热血肃杀风',
    level: 'novel_narrative',
    hardRules: ['禁用词:恐怖如斯', '对白简短']
  });
  assert.equal(styleCreateRes.status, 200);

  // 10. GET /api/books/:bookId/styles
  const styleListRes = await invokeRoute(db, 'GET', `/api/books/${bookId}/styles`);
  assert.equal(styleListRes.status, 200);
  assert.equal(styleListRes.body.styles.length, 1);

  // 11. POST /api/books/:bookId/style-audits
  const styleAuditRes = await invokeRoute(db, 'POST', `/api/books/${bookId}/style-audits`, {
    text: '三尺长剑出鞘，带起漫天霜雪。他未多发一言，踏步向前。',
    options: {
      deterministicRules: { forbiddenTerms: ['恐怖如斯'] }
    }
  });
  assert.equal(styleAuditRes.status, 200);
  assert.equal(styleAuditRes.body.audit.passed, true);

  // 12. POST /api/books/:bookId/rewrite
  const contract = memorySystem.createRewriteContract(db, {
    bookId,
    lockedPropositions: ['天命之子出关'],
    disclosureBoundary: { forbiddenAnswers: ['师尊是魔头'] }
  });
  const rewriteRes = await invokeRoute(db, 'POST', `/api/books/${bookId}/rewrite`, {
    contract,
    candidateText: '天命之子出关，神光冲霄。天下震动。'
  });
  assert.equal(rewriteRes.status, 200, rewriteRes.raw);
  assert.equal(rewriteRes.body.compliant, true);
  assert.match(rewriteRes.body.candidateHash, /^[a-f0-9]{64}$/);
  assert.equal(rewriteRes.body.requiresHumanReview, true);
  assert.ok(rewriteRes.body.contractId);
  const missingContract = await invokeRoute(db, 'POST', `/api/books/${bookId}/rewrite`, { candidateText: '无约束候选' });
  assert.equal(missingContract.status, 422);
  assert.equal(missingContract.body.code, 'REWRITE_CONTRACT_REQUIRED');

  // 13. POST /api/books/:bookId/impact-analysis
  const impactRes = await invokeRoute(db, 'POST', `/api/books/${bookId}/impact-analysis`, {
    targetId: 'dec_fact_001',
    modifiedType: 'fact'
  });
  assert.equal(impactRes.status, 200);
  assert.ok(impactRes.body.impact.analysisTime);

  // 14. GET /api/books/:bookId/projections
  const projGetRes = await invokeRoute(db, 'GET', `/api/books/${bookId}/projections`);
  assert.equal(projGetRes.status, 200);
  assert.ok(projGetRes.body.projections.status);

  // 15. POST /api/books/:bookId/projections/verify
  const projVerifyRes = await invokeRoute(db, 'POST', `/api/books/${bookId}/projections/verify`, {});
  assert.equal(projVerifyRes.status, 200);
  assert.ok(projVerifyRes.body.verification.status);

  // 16. GET /api/runs/:runId
  const runRes = await invokeRoute(db, 'GET', `/api/runs/${changeset.id}`);
  assert.equal(runRes.status, 200);
  assert.equal(runRes.body.runId, changeset.id);
  assert.equal(runRes.body.status, 'queued');

  // 17. GET /api/runs/:runId/events
  const eventsRes = await invokeRoute(db, 'GET', `/api/runs/${changeset.id}/events`);
  assert.equal(eventsRes.status, 200);
  assert.equal(eventsRes.body.events[0].type, 'AUTHOR_APPROVED');
  assert.ok(eventsRes.body.events.some(event => event.type === 'MEMORY_COMMITTED'));
  assert.equal(eventsRes.body.eventHistoryAvailable, true);
  const continued = await invokeRoute(db, 'GET', `/api/runs/${changeset.id}/events?after=${eventsRes.body.nextCursor}`);
  assert.deepEqual(continued.body.events, []);
  assert.equal((await invokeRoute(db, 'GET', '/api/runs/test_run_123')).status, 404);
  assert.equal((await invokeRoute(db, 'GET', `/api/runs/${changeset.id}`, null, { userId: 'outsider' })).status, 404);
});

test('记忆路由验证项目成员与写权限，不让工作区管理员越权', async context => {
  const db = createTestDatabase();
  context.after(() => db.close());
  const path = '/api/books/novel_test_001/memory';
  assert.equal((await invokeRoute(db, 'GET', path, null, { userId: 'outsider' })).status, 404);
  assert.equal((await invokeRoute(db, 'GET', path, null, { userId: 'viewer' })).status, 200);
  assert.equal((await invokeRoute(db, 'POST', `${path}/extract`, { text: '秘密' }, { userId: 'viewer' })).status, 403);
  assert.equal((await invokeRoute(db, 'GET', path, null, null)).status, 401);
  db.exec("UPDATE workspace_members SET active = 0 WHERE user_id = 'viewer'");
  assert.equal((await invokeRoute(db, 'GET', path, null, { userId: 'viewer' })).status, 404);
});

test('PostgreSQL模式通过PG仓储桥接处理请求，不执行SQLite回退', async context => {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  let delegated = false;
  const response = await invokeRoute(db, 'GET', '/api/books/novel_test_001/memory', null,
    { userId: 'user-001', email: 'author@molan.local' }, {
      backend: 'postgres',
      postgresMemoryBridge: {
        async dispatch(_req, res) {
          delegated = true;
          memoryRoutes.sendJson(res, 200, { ok: true, memory: [] });
          return true;
        }
      }
    });
  assert.equal(delegated, true);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.memory, []);
});

test('畸形JSON不能变成默认审批，版本冲突返回409', async context => {
  const db = createTestDatabase();
  context.after(() => db.close());
  const candidate = memorySystem.createChangeset(db, { bookId: 'novel_test_001', baseStateVersion: 9 });
  const path = `/api/books/novel_test_001/memory/changesets/${candidate.id}`;
  assert.equal((await invokeRoute(db, 'POST', `${path}/approve`, '{')).status, 400);
  assert.equal(db.prepare('SELECT approval_status FROM memory_changesets WHERE id = ?').get(candidate.id).approval_status, 'pending');
  assert.equal((await invokeRoute(db, 'POST', `${path}/approve`, { status: 'approved' })).status, 200);
  const response = await invokeRoute(db, 'POST', `${path}/commit`, {});
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'MEMORY_VERSION_CONFLICT');
});
