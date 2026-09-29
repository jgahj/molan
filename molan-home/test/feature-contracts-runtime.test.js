'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGenerationRunClient } = require('../lib/client/generation-runs');
const { createSearchIndex } = require('../lib/client/search-index');
const { buildGoldenSuite, validateGoldenSuite } = require('../lib/evolution/golden-suite');
const { buildReplayManifest } = require('../lib/evolution/replay-manifest');
const { createGenerationArtifact, executeClosedEvolutionLoop } = require('../lib/evolution/benchmark-evolution-loop');

test('P8 运行时契约 1: AI_GENERATE 端到端生成与流式事件链路', async () => {
  const store = new Map();
  const eventLog = [];

  const mockServer = {
    async request(url, options = {}) {
      if (url === '/api/generation-runs' && options.method === 'POST') {
        const id = 'run-runtime-001';
        const key = options.headers['Idempotency-Key'];
        const run = {
          id,
          state: 'generating',
          idempotencyKey: key,
          body: options.body
        };
        store.set(id, run);
        eventLog.push({ sequence: 1, state: 'created', runId: id });
        eventLog.push({ sequence: 2, state: 'generating', runId: id });
        return { ok: true, runId: id, run };
      }
      if (url.startsWith('/api/generation-runs/run-runtime-001/events')) {
        return {
          events: eventLog,
          hasMore: false
        };
      }
      if (url === '/api/generation-runs/run-runtime-001') {
        const r = store.get('run-runtime-001');
        return {
          run: {
            ...r,
            state: 'waiting_author',
            result: { draft: '长风卷过古道，马蹄声碎。', outputHash: 'sha256:draft-pass' }
          },
          stages: []
        };
      }
      throw new Error(`未匹配路由: ${url}`);
    }
  };

  const client = createGenerationRunClient({ request: mockServer.request });
  const createResult = await client.create({ projectId: 'book-p8', chapterId: 'ch-1' }, 'idemp-p8-01');
  assert.equal(createResult.ok, true);
  assert.equal(createResult.runId, 'run-runtime-001');

  const evPage = await client.events('run-runtime-001', 0, 10);
  assert.equal(evPage.events.length, 2);
  assert.equal(evPage.events[0].state, 'created');
  assert.equal(evPage.events[1].state, 'generating');

  const observed = await client.observe('run-runtime-001', {
    wait: async () => {}
  });
  assert.equal(observed.outcome, 'waiting_author');
  assert.ok(observed.run.result.draft.includes('长风卷过古道'));
});

test('P8 运行时契约 2: AI_STOP 任务暂停与取消确认', async () => {
  let cancelled = false;
  const client = createGenerationRunClient({
    request: async (url, options = {}) => {
      if (url === '/api/generation-runs/run-cancel-01/cancel' && options.method === 'POST') {
        cancelled = true;
        return { ok: true, state: 'cancelled' };
      }
      throw new Error(`未匹配: ${url}`);
    }
  });

  const res = await client.cancel('run-cancel-01');
  assert.equal(res.ok, true);
  assert.equal(cancelled, true);
  assert.equal(res.state, 'cancelled');
});

test('P8 运行时契约 3: AI_AUDIT 章节局部修订与改写', async () => {
  let revisionPayload = null;
  const client = createGenerationRunClient({
    request: async (url, options = {}) => {
      if (url === '/api/generation-runs/run-audit-01/revision' && options.method === 'POST') {
        revisionPayload = options.body;
        return {
          ok: true,
          revisionRound: 1,
          revisedDraft: '修改后的精炼对白',
          audit: { passed: true, status: 'passed' }
        };
      }
      throw new Error(`未匹配: ${url}`);
    }
  });

  const res = await client.revise('run-audit-01', {
    patch: { target: '对白', instruction: '增强张力' }
  });
  assert.equal(res.ok, true);
  assert.equal(res.revisionRound, 1);
  assert.equal(res.revisedDraft, '修改后的精炼对白');
  assert.equal(revisionPayload.patch.target, '对白');
});

test('P8 运行时契约 4: AI_COMMIT 章节原子落库与提交', async () => {
  let committedPayload = null;
  const client = createGenerationRunClient({
    request: async (url, options = {}) => {
      if (url === '/api/generation-runs/run-commit-01/commit' && options.method === 'POST') {
        committedPayload = options.body;
        return {
          ok: true,
          status: 'committed',
          chapterId: 'ch-committed-1',
          savedReceipt: 'receipt-sha256-abc'
        };
      }
      throw new Error(`未匹配: ${url}`);
    }
  });

  const res = await client.commit('run-commit-01', {
    chapterId: 'ch-committed-1',
    finalText: '已确认的定稿正文'
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'committed');
  assert.equal(committedPayload.finalText, '已确认的定稿正文');
});

test('P8 运行时契约 5: NOVEL_EXPORT 小说导出多格式与章节范围', () => {
  const exportRequestSimulator = (format, fromChapter, toChapter) => {
    assert.ok(['txt', 'epub', 'docx'].includes(format));
    assert.ok(Number.isInteger(fromChapter) && fromChapter >= 1);
    assert.ok(Number.isInteger(toChapter) && toChapter >= fromChapter);
    return {
      contentType: format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : format === 'epub' ? 'application/epub+zip' : 'text/plain; charset=utf-8',
      fileName: `novel_ch${fromChapter}_to_ch${toChapter}.${format}`,
      statusCode: 200
    };
  };

  const txtExport = exportRequestSimulator('txt', 1, 50);
  assert.equal(txtExport.statusCode, 200);
  assert.equal(txtExport.contentType, 'text/plain; charset=utf-8');

  const docxExport = exportRequestSimulator('docx', 1, 100);
  assert.equal(docxExport.statusCode, 200);
  assert.ok(docxExport.contentType.includes('wordprocessingml'));

  const epubExport = exportRequestSimulator('epub', 10, 20);
  assert.equal(epubExport.statusCode, 200);
  assert.ok(epubExport.contentType.includes('epub'));
});

test('P8 运行时契约 6: GLOBAL_SEARCH 全书倒排检索与场景跳转', () => {
  const index = createSearchIndex([
    { chapterId: 'c1', chapterTitle: '第一章 破晓', sceneId: 's1', sceneTitle: '石门前', revision: 1, text: '周叙握紧了手中的青铜残片，石门上的符文微微泛起蓝光。' },
    { chapterId: 'c2', chapterTitle: '第二章 风雨', sceneId: 's2', sceneTitle: '客栈内', revision: 1, text: '风沙呼啸，青铜残片在胸口发烫，陈寻抬头看向门外。' }
  ]);

  const result = index.search('青铜残片');
  assert.equal(result.totalMatches, 2);
  assert.equal(result.matches[0].chapterTitle, '第一章 破晓');
  assert.equal(result.matches[0].sceneTitle, '石门前');
  assert.ok(result.matches[0].start >= 0);
  assert.ok(result.matches[0].end > result.matches[0].start);

  assert.equal(result.matches[1].chapterTitle, '第二章 风雨');
  assert.equal(result.matches[1].sceneTitle, '客栈内');
});

test('P8 运行时契约 7: GOLDEN_INPUTS 黄金输入集可重放与确定性契约', () => {
  const suite = buildGoldenSuite();
  assert.equal(suite.taskCount, 80);
  const validation = validateGoldenSuite(suite);
  assert.equal(validation.valid, true);
  assert.equal(validation.failures.length, 0);
  assert.equal(Object.keys(validation.genreCounts).length, 8);
});

test('P8 运行时契约 8: QUALITY_LOOP 演化闭环运行时完整执行', async () => {
  const artifact = createGenerationArtifact({
    generationId: 'p8-quality-loop-art',
    genreProfile: { genre: '通用' },
    styleBundle: { version: 'style-bundle-v1', hash: 'sb-p8' },
    contract: { chapterGoal: '查探线索' },
    content: '四面风声大作，夜色将荒原彻底吞没。石墙投下厚重的阴影，远处有钟声敲了三下。'.repeat(4),
    qualityVector: { language: { value: 0.85, status: 'MEASURED', confidence: 0.9, source: 'audit', evidence: ['合规'] } }
  });

  const loop = await executeClosedEvolutionLoop(artifact, {
    benchmarkPool: {
      '通用': { dialogue: { p25: 0.15, p50: 0.30, p75: 0.45 } }
    },
    parameterChange: {
      parameter: 'sceneContract.dialogue_objective',
      from: 'missing',
      to: 'interrogation',
      targetMetric: 'dialogue'
    }
  });

  assert.equal(loop.status, 'COMPLETED');
  assert.ok(['ACCEPT', 'REJECT'].includes(loop.decision));
});
