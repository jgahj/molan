const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'completion-import.js'), 'utf8');
const serverSource = ['server.js', 'services/creation-book-service.js', 'services/creation-plan-service.js', 'services/creation-core-job-runtime.js', 'services/creation-core-job-http-service.js', 'services/model-call-service.js'].map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
const vm = require('node:vm');

test('审核响应丢失后复用持久化结果，不再调用模型', async () => {
  const stored = { baseVersion: 62, bibleVersion: 63, review: { status: 'blocked' }, cost: 2 };
  const current = { bibleId: 'bible', version: 63, payload: { qualityState: { planReviewResult: stored } } };
  const context = {
    Number,
    getAuthUser: () => ({ user: { email: 'test@example.com' } }),
    loadCreationBook: () => ({ id: 'book' }),
    readBody: async () => ({ baseVersion: 62 }),
    creationBibleForBook: () => current,
    getUserByEmail: () => ({}),
    resolveCreationModelId: () => 'model',
    reviewCreationPlan: () => ({}),
    json: (res, status, body) => ({ status, body })
  };
  vm.createContext(context);
  const start = serverSource.indexOf('async function runCreationBookPlanReview(');
  const end = serverSource.indexOf('function resolveCreationModelId(', start);
  vm.runInContext(serverSource.slice(start, end), context);
  const result = await context.runCreationBookPlanReview({}, {}, 'book');
  assert.equal(result.status, 200);
  assert.equal(result.body.reused, true);
  assert.equal(result.body.review.status, 'blocked');
  assert.equal(result.body.cost, 2);
  current.version = 64;
  const conflict = await context.runCreationBookPlanReview({}, {}, 'book');
  assert.equal(conflict.body.code, 'needs_rebase');
});

test('审核断线与服务端进行中使用同一版本恢复，保留真实阻断结果', async () => {
  const calls = [];
  const result = { review: { status: 'blocked', issues: [{ severity: 'blocker' }] }, bible: { payload: {} } };
  const context = {
    Date, Error, Object, Promise, encodeURIComponent,
    state: { creation: {} },
    isCurrentImportSession: () => true,
    creationCancelledError: () => new Error('cancelled'),
    updateCreationTask: () => {},
    window: { setTimeout: resolve => resolve() },
    isCreationTransientBackendError: error => error.code === 'NETWORK_UNREACHABLE',
    requestCreationBackend: async (url, options) => {
      calls.push(options.body);
      if (calls.length < 3) throw Object.assign(new Error('disconnected'), { code: calls.length === 1 ? 'NETWORK_UNREACHABLE' : 'creation_review_pending' });
      return result;
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  async function requestCreationPlanReview('), source.indexOf('  function isCreationTransientBackendError(')), context);
  assert.equal(await context.requestCreationPlanReview('book', 62, 'model', 'task', {}), result);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(body => body.baseVersion === 62));
});

test('审核并发请求不重复运行，结束后释放锁', async () => {
  let finish;
  let runs = 0;
  const context = {
    Set,
    getAuthUser: () => ({ user: { email: 'test@example.com' } }),
    json: (res, status, body) => ({ status, body }),
    runCreationBookPlanReview: async () => { runs += 1; await new Promise(resolve => { finish = resolve; }); }
  };
  vm.createContext(context);
  vm.runInContext(serverSource.slice(serverSource.indexOf('const creationPlanReviewsInFlight ='), serverSource.indexOf('async function runCreationBookPlanReview(')), context);
  const first = context.handleCreationBookPlanReview({}, {}, 'book');
  const second = await context.handleCreationBookPlanReview({}, {}, 'book');
  assert.equal(second.body.code, 'creation_review_pending');
  assert.equal(runs, 1);
  finish();
  await first;
  const third = context.handleCreationBookPlanReview({}, {}, 'book');
  assert.equal(runs, 2);
  finish();
  await third;
});

test('失败的创书任务在列表和详情面板都提供可继续的重试入口', () => {
  assert.match(source, /data-import-action="creation-retry" data-creation-task-id=/);
  assert.match(source, /creation-progress-actions/);
  assert.match(source, /creationTaskHasRetryConfig\(task\) \? '重试' : '再次配置'/);
  assert.match(source, /function retryCreationTask\(id, sourceDissectionId\)/);
  assert.match(source, /void openCreateFromDissection\(\{ sourceDissectionId: sourceId, retryConfig, directRetry: canRetry \}\)/);
});

test('创书失败重试会保留并恢复本次表单配置，旧任务仍可手动配置', () => {
  assert.match(source, /const retryConfig = value\.retryConfig/);
  assert.match(source, /retryConfig: \{ sourceDissectionId: taskId, title, genre, innovation, plan \}/);
  assert.match(source, /function applyCreationRetryConfig\(config\)/);
  assert.match(source, /autoStart: true/);
  assert.match(source, /activeCreationRetryConfig\.autoStart/);
  assert.match(source, /const directRetry = options\.directRetry === true/);
  assert.match(source, /if \(directRetry\) document\.getElementById\('modalBackdrop'\)/);
});

test('创书重试复用原任务和服务端 Bible 断点，不重新生成核心包', () => {
  assert.match(source, /creationBookId: String\(value\.creationBookId \|\| ''\)/);
  assert.match(source, /creationBibleVersion: Math\.max\(0, Number\(value\.creationBibleVersion\) \|\| 0\)/);
  assert.match(source, /function resumeCreationTask\(id, input = \{\}\)/);
  assert.match(source, /function restartCreationTask\(id, input = \{\}\)/);
  assert.match(source, /let resumeFromCheckpoint = !!\(resumeTaskId && resumeCreationBookId\)/);
  assert.match(source, /creationTaskHasRetryConfig\(task\)/);
  assert.match(source, /creationRequestId: task\.creationRequestId/);
  assert.match(source, /creation_checkpoint_pending/);
  assert.match(source, /resumeCreationTask\(resumeTaskId, \{/);
  assert.match(source, /requestCreationBackend\(`\/api\/creation-books\/\$\{encodeURIComponent\(resumeCreationBookId\)\}\/bible`/);
  assert.match(source, /body: \{ creationBookId: creationRun\.creationRequestId/);
  assert.match(source, /checkpoint: expansionData\.done \|\| progress\.ready === true \? 'planned'/);
  assert.match(source, /checkpoint: reviewSummary\.status === 'blocked' \? 'review' : 'reviewed'/);
  assert.match(source, /\['planned', 'reviewed', 'novel'\]\.includes\(String\(creationRun\.checkpoint \|\| ''\)\)/);
  assert.match(source, /if \(!reviewCompleted\)/);
});

test('创作书首版保存使用稳定请求 id，重复请求返回原 Bible', () => {
  assert.match(serverSource, /const requestedBookId = String\(body\.creationBookId \|\| ''\)\.trim\(\)/);
  assert.match(serverSource, /const existingBook = loadCreationBookForAuth\(bookId, auth, projectScope\.WRITE_ROLES\)/);
  assert.match(serverSource, /reused: true/);
  assert.match(serverSource, /creation_checkpoint_pending/);
});

test('刷新后未完成的任务给出可执行的重试指引而不是要求重新配置', () => {
  assert.match(source, /点击「重试」会沿用原配置自动续跑/);
  assert.doesNotMatch(source, /可再次配置并发起任务/);
  assert.match(source, /已有创书任务在进行中，请等待完成或先取消/);
  assert.match(source, /本地存储空间不足，创书断点可能无法保存/);
});

test('多标签页场景：心跳判活防止误判中断与双重生成', () => {
  assert.match(source, /function startCreationHeartbeat\(taskId\)/);
  assert.match(source, /function creationHeartbeatAlive\(taskId\)/);
  assert.match(source, /Date\.now\(\) - at < 90000/);
  assert.match(source, /任务正在另一个页面中生成，本页面实时只读/);
  assert.match(source, /window\.addEventListener\('pagehide'/);
  assert.match(source, /function reconcileCreationHeartbeats\(\)/);
  assert.match(source, /if \(!directRetry && loadCreationTasks\(\)\.some\(item => item\.status === 'running'/);
  assert.match(source, /if \(next\.status !== 'running' && next\.status !== 'queued' && creationHeartbeatTaskId === next\.id\) stopCreationHeartbeat\(\)/);
});

test('已完成的创书任务提供打开作品入口', () => {
  assert.match(source, /data-import-action="creation-open-novel" data-creation-novel-id/);
  assert.match(source, /if \(action === 'creation-open-novel'\)/);
});

test('跨标签页远程取消：非持有页写意图，持有页心跳消费并中止', () => {
  assert.match(source, /function creationCancelIntentKey\(taskId\)/);
  assert.match(source, /已请求取消，正在通知生成页面停止/);
  assert.match(source, /localStorage\.removeItem\(intentKey\);\s*\n\s*cancelCreationTask\(creationHeartbeatTaskId\)/);
  assert.match(source, /if \(creationHeartbeatTaskId !== taskId\) \{/);
});

test('失败或中断的任务不显示误导性 0.00 费用', () => {
  assert.match(source, /function creationTaskCostText\(task\)/);
  assert.match(source, /费用以账单为准/);
});

test('拆书创书长任务不设超时：内部调用、代理与浏览器三层一致', () => {
  assert.match(serverSource, /const UPSTREAM_IDLE_TIMEOUT_MS = envPositiveInt\('MOLAN_UPSTREAM_IDLE_TIMEOUT_MS', 0, 0, 600000\)/);
  assert.match(serverSource, /const timeoutMs = Number\.isFinite\(Number\(o\.timeoutMs\)\) && Number\(o\.timeoutMs\) > 0 \? Number\(o\.timeoutMs\) : 0;/);
  assert.match(source, /const hasTimeout = Number\(timeoutMs\) > 0;/);
  assert.match(source, /}, 0, null\);/);
});

test('章纲扩展带节奏合同与可选前三章策略', () => {
  assert.match(serverSource, /hookType ∈ 悬念\|危机\|期待\|反转/);
  assert.match(serverSource, /emotionIntensity 为 0-10 整数/);
  assert.match(serverSource, /payoffGap 为距上一次主要爽点兑现的章数/);
  assert.match(serverSource, /openingStrategy/);
  assert.match(serverSource, /默认建议，非强制/);
  assert.match(serverSource, /严格执行/);
  assert.match(serverSource, /不因未采用“黄金三章”套路而阻断/);
  assert.match(source, /creationOpeningStrategy/);
  assert.match(serverSource, /在 reward 与 conflict 层必须额外检查跨批节奏连续性/);
});

test('创作圣经携带文风工坊资产，审计输出事实账本增量', () => {
  assert.match(serverSource, /sentenceFingerprint: asObject\(sourceProfile\.sentenceFingerprint/);
  assert.match(serverSource, /reusableTemplates: asObject\(sourceProfile\.reusableTemplates/);
  assert.match(serverSource, /factLedgerDelta/);
  assert.match(serverSource, /\/quality-report\$/);
  assert.match(serverSource, /\/regenerate-asset\$/);
});
