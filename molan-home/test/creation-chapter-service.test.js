'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createCreationChapterService } = require('../services/creation-chapter-service');

function hash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function harness(options = {}) {
  const calls = { queries: [], writes: [], execs: [] };
  const rows = options.rows || [];
  let receipt = null;
  const database = {
    prepare(sql) {
      calls.queries.push(sql);
      return {
        all() { return rows; },
        get(...args) {
          if (sql.includes('creation_chapter_audits')) return options.auditRecord || null;
          if (sql.includes('benchmark_commit_receipts') && sql.includes('snapshot_id = ?')) return receipt;
          return null;
        },
        run(...args) {
          calls.writes.push({ sql, args });
          if (options.failWriteIncludes && sql.includes(options.failWriteIncludes)) throw new Error('database write failed');
          if (sql.includes('INSERT INTO benchmark_commit_receipts')) {
            receipt = { snapshot_id: args[0], book_id: args[1], chapter_no: args[2], state_version: args[3], content_hash: args[4], content: args[5], ledger_json: args[6], debt_status: 'pending_recovery' };
          } else if (sql.includes('UPDATE benchmark_commit_receipts')) {
            if (receipt) receipt.debt_status = 'committed';
          }
          return { changes: sql.includes('UPDATE creation_bibles') && Number.isFinite(options.casChanges) ? options.casChanges : 1 };
        }
      };
    },
    exec(sql) { calls.execs.push(sql); }
  };
  const book = {
    id: 'book-1', user_email: 'user@example.test', owner_user_id: 'user-1',
    current_state_version: 0, current_chapter_no: 0, spent_cost: 0, budget_limit: 20,
    workspace_id: 'workspace-1', project_id: 'project-1', source_brief_id: 'brief-1'
  };
  const content = '正文证据'.repeat(120);
  const bible = { bibleId: 'bible-1', version: 3, payload: { genre: '悬疑', taskConstraints: { chapterWordTarget: 2000 }, creationPlan: {} } };
  const audit = options.audit || {
    passed: true,
    status: 'passed',
    incompleteReasons: [],
    contentHash: hash(content),
    summary: '审计完成',
    issues: [],
    factLedgerDelta: { newRules: [], newPromises: [], byEntity: {}, updates: [] },
    usage: { creditCost: 1.25, billingStatus: 'exact', totalTokens: 200 }
  };
  let activeDatabase = database;
  const service = createCreationChapterService({
    benchmarkPipeline: { async evidenceAudit() { return audit; } },
    canSpendCreationBook: () => true,
    callMolanChat: async () => { throw new Error('unexpected direct model call'); },
    checkForbiddenTerms: () => [],
    computeRetentionCompliance: () => options.retentionCompliance || ({ items: [], violatedCount: 0 }),
    computeStructuralSimilarity: () => ({ blocked: false }),
    creationBibleForBook: () => structuredClone(bible),
    creationForbiddenTerms: () => [],
    creationOriginalityGate: () => ({ status: 'passed', issues: [] }),
    currentDefaultModel: () => 'model-1',
    dbReady: () => true,
    deterministicContractValidation: () => ({ findings: [] }),
    evaluateSomaticGate: () => ({ metrics: {} }),
    getAuthUser: () => ({ user: { userId: 'user-1', email: 'user@example.test' } }),
    getDatabase: () => activeDatabase,
    getUserByEmail: email => ({ email }),
    json: (res, status, body) => { res.status = status; res.body = body; return body; },
    loadCreationBookForAuth: () => book,
    loadCreationSnapshots: () => [],
    loadCurrentBiblePayload: () => bible,
    projectScope: { WRITE_ROLES: ['owner', 'admin', 'editor'], PROJECT_ROLES: ['owner', 'admin', 'editor', 'viewer'], stableUserId: email => email },
    readBody: async req => req.body || {},
    recordChapterCausalDebts: () => {},
    resolveModelForUser: () => 'model-1',
    runGenreNarrativeAudits: () => ({ issues: [] }),
    sha256Text: hash,
    logger: { error() {}, warn() {}, log() {} }
  });
  return {
    service, calls, database, content, book,
    setDatabase(value) { activeDatabase = value; }
  };
}

const request = (body = {}) => ({ body, headers: { authorization: 'Bearer test' } });

test('unknown chapter audit cost returns 502 with evidence and does not persist', async () => {
  const audit = {
    passed: true, status: 'passed', incompleteReasons: [],
    contentHash: hash('正文证据'.repeat(120)), issues: [],
    factLedgerDelta: { newRules: [], newPromises: [], byEntity: {}, updates: [] },
    usage: { totalTokens: 200, billingStatus: 'pending' }
  };
  const h = harness({ audit, retentionCompliance: {
    items: [{ key: 'opening', level: 'keep', status: 'violated', detail: 'opening retention violated' }],
    violatedCount: 1
  } });
  const response = {};
  await h.service.handleCreationBookChapterAudit(request({ content: h.content, chapterNo: 1 }), response, 'book-1');
  assert.equal(response.status, 502);
  assert.equal(response.body.code, 'PROVIDER_COST_UNKNOWN');
  assert.equal(response.body.audit.passed, false);
  assert.equal(response.body.audit.qualityGate, 'blocked');
  assert.equal(response.body.usage.billingStatus, 'pending');
  assert.equal(h.calls.writes.length, 0);
  assert.equal(h.calls.execs.length, 0);
});

test('retention CAS conflicts and storage failures stop the audit response', async () => {
  const retentionCompliance = {
    items: [{ key: 'opening', level: 'keep', status: 'violated', detail: 'opening retention violated' }],
    violatedCount: 1
  };
  const stale = harness({ retentionCompliance, casChanges: 0 });
  const staleResponse = {};
  await stale.service.handleCreationBookChapterAudit(request({ content: stale.content, chapterNo: 1 }), staleResponse, 'book-1');
  assert.equal(staleResponse.status, 409);
  assert.equal(staleResponse.body.code, 'audit_baseline_stale');
  assert.deepEqual(stale.calls.execs, ['BEGIN', 'ROLLBACK']);
  assert.equal(stale.calls.writes.some(write => write.sql.includes('creation_chapter_audits')), false);

  const retentionWriteFailure = harness({ retentionCompliance, failWriteIncludes: 'INSERT INTO creation_bible_versions' });
  const retentionFailureResponse = {};
  await retentionWriteFailure.service.handleCreationBookChapterAudit(request({ content: retentionWriteFailure.content, chapterNo: 1 }), retentionFailureResponse, 'book-1');
  assert.equal(retentionFailureResponse.status, 500);
  assert.equal(retentionFailureResponse.body.code, 'audit_persist_failed');
  assert.deepEqual(retentionWriteFailure.calls.execs, ['BEGIN', 'ROLLBACK']);
  assert.equal(retentionWriteFailure.calls.writes.some(write => write.sql.includes('creation_chapter_audits')), false);

  const auditWriteFailure = harness({ failWriteIncludes: 'INSERT INTO creation_chapter_audits' });
  const auditFailureResponse = {};
  await auditWriteFailure.service.handleCreationBookChapterAudit(request({ content: auditWriteFailure.content, chapterNo: 1 }), auditFailureResponse, 'book-1');
  assert.equal(auditFailureResponse.status, 500);
  assert.equal(auditFailureResponse.body.code, 'audit_persist_failed');
});

test('settled legacy audit remains benchmark-local evidence and incomplete evidence cannot pass', async () => {
  const h = harness();
  const response = {};
  await h.service.handleCreationBookChapterAudit(request({ content: h.content, chapterNo: 1 }), response, 'book-1');
  assert.equal(response.status, 200);
  assert.equal(response.body.audit.passed, true);
  assert.equal(response.body.audit.protocol, 'benchmark-local-v2');
  assert.equal(Object.hasOwn(response.body.audit, 'generationId'), false);
  assert.equal(Object.hasOwn(response.body.audit, 'quality'), false);
  assert.equal(h.calls.writes.length, 1);
  const incomplete = harness({ audit: {
    passed: true, status: 'passed', incompleteReasons: [], contentHash: hash('正文证据'.repeat(120)), issues: [],
    usage: { creditCost: 1.25, billingStatus: 'settled' }
  } });
  const incompleteResponse = {};
  await incomplete.service.handleCreationBookChapterAudit(request({ content: incomplete.content, chapterNo: 1 }), incompleteResponse, 'book-1');
  assert.equal(incompleteResponse.status, 200);
  assert.equal(incompleteResponse.body.audit.passed, false);
  assert.equal(incompleteResponse.body.audit.status, 'needs_review');
});

test('quality report uses measured generation evidence and leaves legacy audits unmeasured', async () => {
  const contentHash = 'hash-generation';
  const h = harness({ rows: [
    { id: 'legacy-audit', chapter_no: 1, content_hash: 'legacy-hash', result_json: JSON.stringify({ protocol: 'benchmark-local-v2', passed: true, issues: [] }), created_at: 1 },
    { id: 'generation-audit', chapter_no: 2, content_hash: contentHash, created_at: 2, result_json: JSON.stringify({
      protocol: 'generation-v2-audit-v1', generationId: 'run-2', chapterNo: 2, contentHash, passed: true,
      deterministicAudit: { passed: true, blockerCount: 0 }, semanticAudit: { passed: true, issues: [] },
      quality: { passed: true, qualityVector: { language: { value: 0.9, status: 'MEASURED' } } }
    }) }
  ] });
  const response = {};
  await h.service.handleCreationBookQualityReport(request(), response, 'book-1');
  assert.equal(response.status, 200);
  assert.equal(response.body.summary.chapterCount, 2);
  assert.equal(response.body.summary.passedCount, 1);
  assert.equal(response.body.summary.unmeasuredCount, 1);
  assert.equal(response.body.chapters[0].passed, null);
  assert.equal(response.body.chapters[0].evidenceStatus, 'NOT_MEASURED');
  assert.equal(response.body.chapters[1].evidenceStatus, 'JUDGED');
});

test('commit gets the current database through the injected getter', async () => {
  const h = harness();
  const oldDatabase = h.database;
  const currentCalls = [];
  h.setDatabase({
    prepare(sql) {
      currentCalls.push(sql);
      return { get() { return null; } };
    }
  });
  const response = {};
  await h.service.handleCreationBookCommit(request({ chapterNo: 1, auditStatus: 'passed' }), response, 'book-1');
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'audit_missing');
  assert.equal(currentCalls.length, 2);
  assert.equal(h.calls.queries.length, 0);
  assert.ok(oldDatabase);
});

test('commit requires settled server audit cost and preserves the receipt transaction', async () => {
  const content = '已通过审计的正文'.repeat(80);
  const factLedgerDelta = { newRules: [], newPromises: [], byEntity: {}, updates: [] };
  const planHash = hash(JSON.stringify({}));
  const deltaHash = hash(JSON.stringify(factLedgerDelta));
  const audit = {
    protocol: 'benchmark-local-v2', passed: true, contentHash: hash(content),
    qualityGate: 'passed', bibleVersion: 3, stateVersion: 0, planHash,
    contextHash: 'context-hash', deltaHash, factLedgerDelta,
    semanticAudit: {
      passed: true, status: 'passed', incompleteReasons: [], contentHash: hash(content), factLedgerDelta,
      usage: { creditCost: 1.25, billingStatus: 'settled' }
    }
  };
  const h = harness({ auditRecord: {
    content_hash: hash(content), passed: 1, quality_gate: 'passed', originality_status: 'passed',
    blocker_count: 0, audit_credit_cost: 1.25, bible_version: 3, state_version: 0,
    context_hash: 'context-hash', delta_hash: deltaHash, plan_hash: planHash, result_json: JSON.stringify(audit)
  } });
  const response = {};
  await h.service.handleCreationBookCommit(request({
    chapterNo: 1, auditStatus: 'passed', baseStateVersion: 0,
    content, contentHash: hash(content), actualCost: 0,
    bibleVersion: 3, stateVersion: 0, planHash, contextHash: 'context-hash', deltaHash
  }), response, 'book-1');
  assert.equal(response.status, 200);
  assert.equal(response.body.stateVersion, 1);
  assert.equal(response.body.spentCost, 1.25);
  assert.equal(response.body.debtStatus, 'committed');
  assert.deepEqual(h.calls.execs, ['BEGIN', 'COMMIT']);
  assert.equal(h.calls.writes.some(write => write.sql.includes('INSERT INTO benchmark_commit_receipts')), true);

  const unknownCost = structuredClone(audit);
  unknownCost.semanticAudit.usage = { totalTokens: 200, billingStatus: 'pending' };
  const blocked = harness({ auditRecord: {
    content_hash: hash(content), passed: 1, quality_gate: 'passed', originality_status: 'passed',
    blocker_count: 0, audit_credit_cost: 0, bible_version: 3, state_version: 0,
    context_hash: 'context-hash', delta_hash: deltaHash, plan_hash: planHash, result_json: JSON.stringify(unknownCost)
  } });
  const blockedResponse = {};
  await blocked.service.handleCreationBookCommit(request({
    chapterNo: 1, auditStatus: 'passed', baseStateVersion: 0,
    content, contentHash: hash(content), bibleVersion: 3, stateVersion: 0,
    planHash, contextHash: 'context-hash', deltaHash
  }), blockedResponse, 'book-1');
  assert.equal(blockedResponse.status, 409);
  assert.equal(blockedResponse.body.code, 'audit_blocked');
  assert.equal(blocked.calls.execs.length, 0);

  const missingPersistedCost = harness({ auditRecord: {
    content_hash: hash(content), passed: 1, quality_gate: 'passed', originality_status: 'passed',
    blocker_count: 0, bible_version: 3, state_version: 0,
    context_hash: 'context-hash', delta_hash: deltaHash, plan_hash: planHash, result_json: JSON.stringify(audit)
  } });
  const missingPersistedCostResponse = {};
  await missingPersistedCost.service.handleCreationBookCommit(request({
    chapterNo: 1, auditStatus: 'passed', baseStateVersion: 0,
    content, contentHash: hash(content), bibleVersion: 3, stateVersion: 0,
    planHash, contextHash: 'context-hash', deltaHash
  }), missingPersistedCostResponse, 'book-1');
  assert.equal(missingPersistedCostResponse.status, 409);
  assert.equal(missingPersistedCostResponse.body.code, 'audit_blocked');
  assert.equal(missingPersistedCost.calls.execs.length, 0);
});
