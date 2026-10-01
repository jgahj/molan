'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

const memoryRoutes = require('../lib/memory-routes');
const { createNativeMemoryFixture } = require('./helpers/native-memory-fixture');

const author = { userId: 'native-domain-author', email: 'native-domain@example.test' };

function mockRequestResponse(method, url, body, user) {
  const chunks = body === undefined || body === null ? [] : [typeof body === 'string' ? body : JSON.stringify(body)];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost' };

  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {},
    body: '',
    finished: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(chunk) {
      if (chunk) this.body += String(chunk);
      this.finished = true;
      this.emit('finish');
    }
  });

  const getAuthUser = async () => user ? { user, token: 'fake-token' } : null;
  return { req, res, getAuthUser };
}

async function invokeRoute(fixture, method, url, body, user = author, options = {}) {
  const { req, res, getAuthUser } = mockRequestResponse(method, url, body, user);
  const services = { ...options };
  if (fixture) {
    services.backend = 'json';
    services.memoryStore = fixture.store;
    services.styleProfileStore = fixture.style;
  }
  const handled = await memoryRoutes.dispatch(req, res, url.split('?')[0], null, getAuthUser, services);
  if (!res.finished) await new Promise(resolve => res.once('finish', resolve));
  let parsed = null;
  try {
    parsed = JSON.parse(res.body);
  } catch (_) {}
  return { handled, status: res.statusCode, body: parsed, raw: res.body };
}

test('记忆文风原生 JSON routes 保持提取、审查、上下文与运行记录流程', async context => {
  const fixture = await createNativeMemoryFixture(context);
  const { bookId } = fixture.scope;

  const extractRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/memory/extract`, {
    text: '师妹按住青锋剑，沉声道：“此行凶险异常。” 主角暗想难道真有伏兵？他打算先行探路。'
  });
  assert.equal(extractRes.handled, true);
  assert.equal(extractRes.status, 200);
  assert.ok(extractRes.body.propositions.length >= 2);
  assert.ok(extractRes.body.evidence.length >= 2);

  const proposition = extractRes.body.propositions[0];
  const evidence = extractRes.body.evidence.find(item => item.propositionId === proposition.id);
  assert.ok(evidence);
  const changesetRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/memory/changesets`, {
    operations: [
      { type: 'INSERT_EVENT', payload: { id: 'ev_1', title: '出发', timelineId: 't0', cycleId: 'c0' } },
      { type: 'INSERT_FACT', payload: {
        id: 'dec_fact_001', propositionId: proposition.id, supportingEvidenceIds: [evidence.id],
        verdict: 'true', status: 'confirmed', decisionReason: '主线初显'
      } },
      { type: 'INSERT_COGNITION', payload: {
        id: 'cog_test', holderEntityId: 'protagonist', targetExpressionId: proposition.id,
        attitude: 'knows', sourceEventId: 'ev_1', timelineId: 't0', cycleId: 'c0'
      } }
    ]
  });
  assert.equal(changesetRes.status, 201);
  const changesetId = changesetRes.body.changeset.id;

  const csGetRes = await invokeRoute(fixture, 'GET', `/api/books/${bookId}/memory/changesets/${changesetId}`);
  assert.equal(csGetRes.status, 200);
  assert.equal(csGetRes.body.changeset.id, changesetId);
  const csApproveRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/memory/changesets/${changesetId}/approve`, { status: 'approved' });
  assert.equal(csApproveRes.status, 200);
  assert.equal(csApproveRes.body.approvalStatus, 'approved');
  const csCommitRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/memory/changesets/${changesetId}/commit`, {});
  assert.equal(csCommitRes.status, 200);
  assert.equal(csCommitRes.body.stateVersion, 2);

  const memGetRes = await invokeRoute(fixture, 'GET', `/api/books/${bookId}/memory`);
  assert.equal(memGetRes.status, 200);
  assert.equal(memGetRes.body.memory.length, 1);
  assert.equal(memGetRes.body.memory[0].id, 'dec_fact_001');

  const operationsRes = await invokeRoute(fixture, 'GET', `/api/books/${bookId}/memory/operations`);
  assert.equal(operationsRes.status, 200);
  const factOperation = operationsRes.body.operations.find(operation => operation.recordId === 'dec_fact_001');
  assert.ok(factOperation);
  assert.equal(factOperation.operation_type, 'INSERT_FACT');
  assert.equal(factOperation.record_id, 'dec_fact_001');
  assert.equal(JSON.parse(factOperation.after_state_json).id, 'dec_fact_001');
  const revertRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/memory/operations/${factOperation.id}/revert`, { reason: '调整剧情' });
  assert.equal(revertRes.status, 200);
  assert.equal(revertRes.body.ok, true);

  const cogRes = await invokeRoute(fixture, 'GET', `/api/books/${bookId}/cognition?holderEntityId=protagonist`);
  assert.equal(cogRes.status, 200);
  assert.equal(cogRes.body.cognitions.length, 1);
  const timelineRes = await invokeRoute(fixture, 'GET', `/api/books/${bookId}/timeline`);
  assert.equal(timelineRes.status, 200);
  assert.equal(timelineRes.body.timeline.events.length, 1);
  assert.equal(timelineRes.body.timeline.events[0].id, 'ev_1');

  const assembleRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/context/assemble`, {
    povId: 'protagonist', budgetTokens: 3000
  });
  assert.equal(assembleRes.status, 200);
  assert.ok(assembleRes.body.manifest.id);
  const manifestId = assembleRes.body.manifest.id;
  const manifestRes = await invokeRoute(fixture, 'GET', `/api/books/${bookId}/context/${manifestId}`);
  assert.equal(manifestRes.status, 200);
  assert.equal(manifestRes.body.manifest.id, manifestId);

  const styleCreateRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/styles`, {
    name: '热血肃杀风', level: 'novel_narrative', hardRules: ['禁用词:恐怖如斯', '对白简短']
  });
  assert.equal(styleCreateRes.status, 200);
  const styleListRes = await invokeRoute(fixture, 'GET', `/api/books/${bookId}/styles`);
  assert.equal(styleListRes.status, 200);
  assert.equal(styleListRes.body.styles.length, 1);

  const styleAuditRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/style-audits`, {
    text: '三尺长剑出鞘，带起漫天霜雪。他未多发一言，踏步向前。',
    options: { deterministicRules: { forbiddenTerms: ['恐怖如斯'] } }
  });
  assert.equal(styleAuditRes.status, 200);
  assert.equal(styleAuditRes.body.audit.passed, true);

  const contract = {
    id: 'rewrite_test', lockedPropositions: ['天命之子出关'],
    disclosureBoundary: { forbiddenAnswers: ['师尊是魔头'] }
  };
  const rewriteRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/rewrite`, {
    contract, candidateText: '天命之子出关，神光冲霄。天下震动。'
  });
  assert.equal(rewriteRes.status, 200, rewriteRes.raw);
  assert.equal(rewriteRes.body.compliant, true);
  assert.match(rewriteRes.body.candidateHash, /^[a-f0-9]{64}$/);
  assert.equal(rewriteRes.body.requiresHumanReview, true);
  assert.ok(rewriteRes.body.contractId);
  const missingContract = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/rewrite`, { candidateText: '无约束候选' });
  assert.equal(missingContract.status, 422);
  assert.equal(missingContract.body.code, 'REWRITE_CONTRACT_REQUIRED');

  const impactRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/impact-analysis`, {
    targetId: 'dec_fact_001', modifiedType: 'fact'
  });
  assert.equal(impactRes.status, 200);
  assert.equal(impactRes.body.impact.targetId, 'dec_fact_001');
  assert.equal(impactRes.body.impact.modifiedType, 'fact');
  assert.ok(impactRes.body.impact.analysisTime);
  assert.ok(Number.isInteger(impactRes.body.impact.totalImpactCount));
  assert.equal(impactRes.body.impact.coverage.semanticDependencies, 'not_checked');

  const projGetRes = await invokeRoute(fixture, 'GET', `/api/books/${bookId}/projections`);
  assert.equal(projGetRes.status, 200);
  assert.ok(projGetRes.body.projections.status);
  const projVerifyRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/projections/verify`, {});
  assert.equal(projVerifyRes.status, 200);
  assert.ok(projVerifyRes.body.verification.status);

  const runRes = await invokeRoute(fixture, 'GET', `/api/runs/${changesetId}`);
  assert.equal(runRes.status, 200);
  assert.equal(runRes.body.runId, changesetId);
  assert.equal(runRes.body.status, 'queued');
  const eventsRes = await invokeRoute(fixture, 'GET', `/api/runs/${changesetId}/events`);
  assert.equal(eventsRes.status, 200);
  assert.ok(eventsRes.body.events.some(event => event.type === 'AUTHOR_APPROVED'));
  assert.ok(eventsRes.body.events.some(event => event.type === 'MEMORY_COMMITTED'));
  assert.equal(eventsRes.body.eventHistoryAvailable, true);
  const continued = await invokeRoute(fixture, 'GET', `/api/runs/${changesetId}/events?after=${eventsRes.body.nextCursor}`);
  assert.deepEqual(continued.body.events, []);
  await assert.rejects(fixture.store.getRun({ userId: 'outsider', runId: changesetId }), { code: 'RUN_NOT_FOUND' });
});

test('记忆路由验证项目成员与写权限，不让工作区管理员越权', async context => {
  const fixture = await createNativeMemoryFixture(context);
  const { app, scope } = fixture;
  const viewer = { userId: 'viewer', email: 'viewer@native-domain.test' };
  const outsider = { userId: 'outsider', email: 'outsider@native-domain.test' };
  await app.saveAccount(viewer);
  await app.saveAccount(outsider);
  const project = await app.repository.novels.get(scope.bookId, scope.bookId);
  await app.upsertWorkspaceMember(author.userId, project.workspaceId, viewer.userId, 'member');
  await app.upsertWorkspaceMember(author.userId, project.workspaceId, outsider.userId, 'admin');
  await app.upsertProjectMember({ userId: author.userId, projectId: scope.bookId,
    targetUserId: viewer.userId, role: 'viewer', expectedAclRevision: 1 });

  const path = `/api/books/${scope.bookId}/memory`;
  assert.equal((await invokeRoute(fixture, 'GET', path, undefined, outsider)).status, 404);
  assert.equal((await invokeRoute(fixture, 'GET', path, undefined, viewer)).status, 200);
  assert.equal((await invokeRoute(fixture, 'POST', `${path}/extract`, { text: '秘密' }, viewer)).status, 403);
  assert.equal((await invokeRoute(fixture, 'GET', path, undefined, null)).status, 401);
  await app.deactivateProjectMember({ userId: author.userId, projectId: scope.bookId, targetUserId: viewer.userId });
  assert.equal((await invokeRoute(fixture, 'GET', path, undefined, viewer)).status, 404);
});

test('PostgreSQL模式通过PG仓储桥接处理请求，不执行SQLite回退', async () => {
  let delegated = false;
  const response = await invokeRoute(null, 'GET', '/api/books/nativedomain/memory', undefined, author, {
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
  const fixture = await createNativeMemoryFixture(context);
  const { bookId } = fixture.scope;
  const candidateRes = await invokeRoute(fixture, 'POST', `/api/books/${bookId}/memory/changesets`, { baseStateVersion: 9 });
  assert.equal(candidateRes.status, 201);
  const candidate = candidateRes.body.changeset;
  const path = `/api/books/${bookId}/memory/changesets/${candidate.id}`;

  assert.equal((await invokeRoute(fixture, 'POST', `${path}/approve`, '{')).status, 400);
  const pending = await invokeRoute(fixture, 'GET', path);
  assert.equal(pending.body.changeset.approvalStatus, 'pending');
  assert.equal((await invokeRoute(fixture, 'POST', `${path}/approve`, { status: 'approved' })).status, 200);
  const response = await invokeRoute(fixture, 'POST', `${path}/commit`, {});
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'MEMORY_VERSION_CONFLICT');
});
