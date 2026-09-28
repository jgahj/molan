'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const material = require('../lib/character-material');
const server = require('../server');

const ARCHETYPES = material.CHARACTER_ARCHETYPES;

test('支持素材库全部十类人物类型，并优先采用显式类型', () => {
  for (const archetype of ARCHETYPES) {
    const result = material.inferCharacterArchetype({ archetype });
    assert.equal(result.archetype, archetype);
    assert.equal(result.source, 'explicit');
    assert.equal(result.confidence, 1);
  }
  const explicit = material.inferCharacterArchetype({ archetype: '冷静理智型', tags: ['热血', '冲动'] });
  assert.equal(explicit.archetype, '冷静理智型');
  assert.equal(explicit.source, 'explicit');
});

test('标签和人物卡说明可以确定类型，模糊输入回退通用规则', () => {
  const tagged = material.inferCharacterArchetype({ tags: ['冷静'], notes: '会先核对证据再行动' });
  assert.equal(tagged.archetype, '冷静理智型');
  assert.equal(tagged.source, 'inferred');
  const personality = material.inferCharacterArchetype({ personality: '温柔体贴，习惯先照顾身边的人' });
  assert.equal(personality.archetype, '温柔内敛型');
  const attrs = material.inferCharacterArchetype({ attrs: [{ k: '处事方式', v: '热血好战，遇到冲突会立即行动' }] });
  assert.equal(attrs.archetype, '热血冲动型');
  const ambiguous = material.inferCharacterArchetype({ tags: ['冷静', '热血'], notes: '性格复杂' });
  assert.equal(ambiguous.archetype, '');
  assert.equal(ambiguous.source, 'none');
});

test('推断类型在请求级去重提示中仍保留 inferred 来源', () => {
  const resolved = material.resolveCharacterArchetypes({
    characters: [{ id: 'c1', name: '角色', archetype: '冷静理智型', archetypeSource: 'inferred' }],
    archetypes: ['冷静理智型']
  });
  assert.deepEqual(resolved.archetypes, ['冷静理智型']);
  assert.equal(resolved.primaryArchetype, '冷静理智型');
  assert.equal(resolved.primarySource, 'inferred');
  const disabled = material.normalizeCharacterMaterialRequest({ mode: 'off', proseTask: true });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.mode, 'off');
});

test('auto 只取类型规则，strong 才取少量匿名样本', () => {
  const index = {
    version: 'test-v1',
    published: true,
    general: {
      rules: [
        { id: 'cold-rule', archetype: '冷静理智型', dimension: 'psychology', rule: '先核对证据，再决定动作。', application: '把判断落在可观察细节上。', score: 4 },
        { id: 'generic-rule', archetype: '', dimension: 'psychology', rule: '用具体感受支撑心理变化。', application: '', score: 1 }
      ],
      samples: [{ id: 'sample-1', archetype: '冷静理智型', dimension: 'psychology', text: '匿名样本只用于观察信息过滤和动作节奏。', sourceHash: 'source-a', forbiddenTerms: ['原名'] }]
    },
    mature: { rules: [], samples: [] },
    audit: { strongSamplesPublished: true }
  };
  const request = { mode: 'auto', characters: [{ tags: ['冷静'] }], dimensions: ['psychology'], query: '雨夜试探', proseTask: true };
  const auto = material.retrieveCharacterMaterial({}, request, { index });
  assert.equal(auto.audit.archetype, '冷静理智型');
  assert.equal(auto.audit.fallback, false);
  assert.equal(auto.samples.length, 0);
  const strong = material.retrieveCharacterMaterial({}, { ...request, mode: 'strong' }, { index });
  assert.equal(strong.samples.length, 1);
  assert.equal(strong.audit.sampleCount, 1);
  const filtered = material.retrieveCharacterMaterial({}, { ...request, mode: 'strong' }, { index, sampleIds: [] });
  assert.equal(filtered.samples.length, 0);
  assert.equal(filtered.audit.sampleCount, 0);
});

test('strong 样本按原题材、维度、受众和逻辑作品去重后再调用', () => {
  const index = {
    version: 'test-v2',
    published: true,
    profilesPublished: true,
    profileGenreMap: { 都市: '都市', 玄幻: '男频玄幻' },
    profiles: {
      '冷静理智型|都市': { available: true, reliable: true, sampleCount: 12, charCount: 12000 },
      '冷静理智型|raw:都市': { available: true, reliable: true, sampleCount: 12, charCount: 12000 }
    },
    general: {
      rules: [],
      samples: [
        { id: 'wanted-a', archetype: '冷静理智型', dimension: 'psychology', text: '她先看了一眼门锁，再决定是否开门。', sourceHash: 'hash-a', canonicalWorkId: 'canon-a', sourceWorkId: 'novel-a', rawGenres: ['都市'], primaryGenre: '都市', genreBucket: '都市', audience: '女频', score: 5 },
        { id: 'duplicate-a', archetype: '冷静理智型', dimension: 'psychology', text: '她又核对了一遍时间，才拿起手机。', sourceHash: 'hash-a2', canonicalWorkId: 'canon-a', sourceWorkId: 'novel-a-copy', rawGenres: ['都市'], primaryGenre: '都市', genreBucket: '都市', audience: '女频', score: 1 },
        { id: 'wrong-dimension', archetype: '冷静理智型', dimension: 'action', text: '她转身走到窗边，动作没有一丝迟疑。', sourceHash: 'hash-d', canonicalWorkId: 'canon-d', sourceWorkId: 'novel-d', rawGenres: ['都市'], primaryGenre: '都市', genreBucket: '都市', audience: '女频', score: 9 },
        { id: 'wrong-audience', archetype: '冷静理智型', dimension: 'psychology', text: '他默默计算着每一种可能的代价。', sourceHash: 'hash-m', canonicalWorkId: 'canon-m', sourceWorkId: 'novel-m', rawGenres: ['都市'], primaryGenre: '都市', genreBucket: '都市', audience: '男频', score: 9 },
        { id: 'wrong-genre', archetype: '冷静理智型', dimension: 'psychology', text: '她检查阵法纹路，确认灵力没有外泄。', sourceHash: 'hash-x', canonicalWorkId: 'canon-x', sourceWorkId: 'novel-x', rawGenres: ['玄幻'], primaryGenre: '玄幻', genreBucket: '男频玄幻', audience: '女频', score: 9 },
        { id: 'wanted-b', archetype: '冷静理智型', dimension: 'psychology', text: '她把证据按时间顺序排好，才开口回答。', sourceHash: 'hash-b', canonicalWorkId: 'canon-b', sourceWorkId: 'novel-b', rawGenres: ['都市'], primaryGenre: '都市', genreBucket: '都市', audience: '女频', score: 4 }
      ]
    },
    mature: { rules: [], samples: [] },
    audit: { strongSamplesPublished: true }
  };
  const result = material.retrieveCharacterMaterial({}, {
    mode: 'strong',
    archetypes: ['冷静理智型'],
    dimensions: ['psychology'],
    genres: ['都市'],
    audience: '女频',
    proseTask: true
  }, { index });
  assert.equal(result.audit.profileKey, '冷静理智型|raw:都市');
  assert.deepEqual(result.samples.map(item => item.id), ['wanted-a', 'wanted-b']);
  assert.equal(result.samples.every(item => item.dimension === 'psychology'), true);
  assert.equal(result.samples.every(item => item.primaryGenre === '都市'), true);
});

test('发布索引使用原文运行样本，自动审计完成后保持 raw 契约', () => {
  const index = material.loadCharacterMaterialIndex();
  assert.equal(index.general.rules.length, 0);
  assert.equal(index.audit.strongSamplesPublished, true);
  assert.equal(index.audit.rawTextRuntime, true);
  assert.equal(index.general.samples.length > 0, true);
  const result = material.retrieveCharacterMaterial({}, {
    mode: 'raw',
    scene: '试探',
    dimensions: ['dialogue'],
    proseTask: true
  }, { index });
  assert.equal(result.rules.length, 0);
  assert.equal(result.samples.length <= 2, true);
  assert.equal(result.audit.mode, 'raw');
});

test('默认索引无题材时只加载一个分片，避免读入全量原文索引', () => {
  const index = material.loadCharacterMaterialIndex();
  assert.equal(index.version, 'character-material-raw-v3.1-1');
  assert.equal(index.general.samples.length > 0, true);
  assert.equal(index.general.samples.length < 20000, true);
});

test('成熟索引只能由服务端管理员授权使用', () => {
  const index = { version: 'test-v1', published: true, general: { rules: [{ id: 'general', archetype: '', dimension: 'psychology', rule: '通用规则' }], samples: [] }, mature: { rules: [{ id: 'mature', archetype: '冷静理智型', dimension: 'psychology', rule: '成熟索引规则' }], samples: [] } };
  const request = { index: 'mature', matureEnabled: true, novelId: 'n_demo', archetypes: ['冷静理智型'], proseTask: true };
  assert.equal(material.retrieveCharacterMaterial({ user: { role: 'user' } }, request, { index }).audit.corpus, 'general');
  assert.equal(material.retrieveCharacterMaterial({ user: { role: 'admin' } }, request, { index }).audit.corpus, 'general');
  assert.equal(material.retrieveCharacterMaterial({ user: { role: 'admin' }, characterMaterialAdmin: true, characterMaterialMatureAllowed: true }, request, { index }).audit.corpus, 'mature');
  const sampleOnlyIndex = {
    ...index,
    mature: { rules: [], samples: [{ id: 'mature-sample', dimension: 'psychology', archetype: '冷静理智型', text: '她先核对门锁，再决定是否开门。' }] },
    audit: { strongSamplesPublished: true }
  };
  assert.equal(material.retrieveCharacterMaterial({ characterMaterialAdmin: true, characterMaterialMatureAllowed: true }, { ...request, mode: 'strong' }, { index: sampleOnlyIndex }).audit.corpus, 'mature');
});

test('上下文不足时先移除样本，再收紧规则，不触碰受保护消息', () => {
  const rules = material.markCharacterMaterialMessage({ role: 'system', content: 'r'.repeat(1600) }, 'rules');
  const sample = material.markCharacterMaterialMessage({ role: 'system', content: 's'.repeat(1600) }, 'sample');
  const protectedMessage = { role: 'system', content: 'skill、纠错库和作品事实必须保留' };
  const plan = server.planContextWindow('gpt-luna', [rules, sample, protectedMessage, { role: 'user', content: '当前任务' }], 32000);
  assert.equal(plan.ok, true);
  assert.equal(plan.characterMaterialSamplesRemovedByBudget, true);
  assert.equal(plan.characterMaterialRulesReducedByBudget, true);
  assert.equal(plan.messages.some(item => item.content === protectedMessage.content), true);
});

test('结构化请求不会构建人物素材消息，原创性审计能阻止连续复用和专名泄漏', () => {
  assert.equal(material.buildCharacterMaterialBlock({}, { proseTask: false }).messages.length, 0);
  const overlap = material.scanCharacterMaterialOverlap('这是匿名样本只用于观察信息过滤和动作节奏。', [{ text: '匿名样本只用于观察信息过滤和动作节奏。' }], ['原名']);
  assert.equal(overlap.blocked, true);
  assert.equal(overlap.overlapFragments.length > 0, true);
});

test('两个管理员入口都暴露人物素材审批操作和服务端门禁', () => {
  const standaloneHtml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'admin.html'), 'utf8');
  const standaloneScript = fs.readFileSync(path.join(__dirname, '..', 'pages', 'admin.js'), 'utf8');
  const dynamicScript = fs.readFileSync(path.join(__dirname, '..', 'completion-admin.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(standaloneHtml, /data-view="character-material"/);
  assert.match(standaloneHtml, /id="materialAuditApproveBtn"/);
  assert.match(standaloneScript, /\/api\/admin\/character-material\/audit/);
  assert.match(standaloneScript, /materialAuditSaveBtn/);
  assert.match(dynamicScript, /data-admin-material-action="approve"/);
  assert.match(dynamicScript, /data-admin-view="character-material"/);
  assert.match(dynamicScript, /node\.dataset\.adminMaterialAction === 'revoke'/);
  assert.match(serverSource, /PATCH.*\/api\/admin\/character-material\/audit/);
  assert.match(serverSource, /readBody\(req\)/);
  assert.match(serverSource, /evaluateCharacterMaterialApprovalGates/);
  assert.match(serverSource, /publicationApprovalReady/);
  assert.match(serverSource, /residualRate >= 0\.02/);
});

test('未审批时 strong 样本不进入运行时，管理员审批文件生效后才进入', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-character-material-audit-'));
  const indexPath = path.join(root, 'lib', 'character-material', 'index.json');
  const reportPath = path.join(root, 'lib', 'character-material', 'quality-report.json');
  const approvalPath = path.join(root, 'data', 'character-material-audit.json');
  const sample = { id: 'sample-1', sourceHash: 'hash-1', corpus: 'general', archetype: '冷静理智型', dimension: 'psychology', text: '匿名样本', forbiddenTerms: [], residualTerms: [], score: 1 };
  try {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.mkdirSync(path.dirname(approvalPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify({ version: 'audit-test', published: true, sourceHash: 'report-hash', general: { rules: [], samples: [] }, mature: { rules: [], samples: [] }, audit: { strongSamplesPublished: false } }));
    fs.writeFileSync(reportPath, JSON.stringify({
      version: 'audit-test',
      sourceHash: 'report-hash',
      profileRelease: { pass: true },
      publicationGate: { pass: false, reasons: ['strong_samples_not_published'] },
      manualReview: { samples: [sample] }
    }));
    const pending = material.loadCharacterMaterialIndex({ indexPath });
    assert.equal(pending.general.samples.length, 0);
    fs.writeFileSync(approvalPath, JSON.stringify({ version: 'audit-test', sourceHash: 'wrong-hash', approved: true, residualRate: 0, reviewedIds: ['sample-1'], residualIds: [], approvedBy: 'admin@example.com' }));
    material.resetCharacterMaterialIndexCache();
    const mismatched = material.loadCharacterMaterialIndex({ indexPath });
    assert.equal(mismatched.general.samples.length, 0);
    fs.writeFileSync(approvalPath, JSON.stringify({ version: 'audit-test', sourceHash: 'report-hash', approved: true, residualRate: 0, reviewedIds: ['sample-1'], residualIds: [], approvedBy: 'admin@example.com' }));
    material.resetCharacterMaterialIndexCache();
    const approved = material.loadCharacterMaterialIndex({ indexPath });
    assert.equal(approved.general.samples.length, 1);
    assert.equal(approved.audit.strongSamplesPublished, true);
    assert.equal(approved.markdownPublished, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('strong 审批不能绕过画像或 Markdown 发布门禁', () => {
  assert.equal(material.evaluateCharacterMaterialApprovalGates({}).publicationApprovalReady, false);
  assert.equal(material.evaluateCharacterMaterialApprovalGates({
    profileRelease: { pass: false },
    publicationGate: { pass: false, reasons: ['strong_samples_not_published'] }
  }).publicationApprovalReady, false);
  assert.equal(material.evaluateCharacterMaterialApprovalGates({
    profileRelease: { pass: true },
    publicationGate: { pass: false, reasons: ['strong_samples_not_published', 'published_unique_works'] }
  }).publicationApprovalReady, false);
  assert.equal(material.evaluateCharacterMaterialApprovalGates({
    profileRelease: { pass: true },
    publicationGate: { pass: false, reasons: ['strong_samples_not_published'] }
  }).publicationApprovalReady, true);
});

test('旧索引缺少 strongSamplesPublished 时默认不暴露原文样本', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-character-material-legacy-'));
  const indexPath = path.join(root, 'lib', 'character-material', 'index.json');
  try {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify({
      version: 'legacy-test', published: true,
      general: { rules: [], samples: [{ id: 'legacy-1', text: '旧索引原文样本', archetype: '冷静理智型', dimension: 'psychology' }] },
      mature: { rules: [], samples: [] }, audit: {}
    }));
    const loaded = material.loadCharacterMaterialIndex({ indexPath });
    assert.equal(loaded.general.samples.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('审批残留率只计算剔除后的发布集', () => {
  const metrics = server.characterMaterialAuditMetrics([
    { id: 'good', residualTerms: [] },
    { id: 'bad', residualTerms: ['专名'] },
    { id: 'excluded', residualTerms: ['专名'] }
  ], ['excluded']);
  assert.equal(metrics.excludedCount, 1);
  assert.equal(metrics.publishableCount, 2);
  assert.equal(metrics.residualCount, 1);
  assert.equal(metrics.residualRate, 0.5);
  assert.equal(server.characterMaterialAuditMetrics([
    { id: 'good', residualTerms: [] },
    { id: 'bad', residualTerms: ['专名'] }
  ], ['bad']).residualRate, 0);
});

test('strong 样本模型复核必须同时确认适配且无错误', () => {
  assert.equal(server.parseCharacterMaterialSampleReview({ json: { review: { pass: true, suitable: true, errorFree: true, issues: [], reason: '通过' } } }).passed, true);
  assert.equal(server.parseCharacterMaterialSampleReview({ json: { review: { pass: true, suitable: true, errorFree: true, issues: ['语境不符'], reason: '拒绝' } } }).passed, false);
  assert.equal(server.parseCharacterMaterialSampleReview({ json: { review: { pass: true, suitable: true, errorFree: false, issues: [], reason: '存在病句' } } }).passed, false);
  const context = server.characterMaterialReviewContext([{ role: 'user', content: '<!-- molan-dynamic-context-v2 -->雨夜试探对手' }], {
    primaryArchetype: '冷静理智型', dimensions: ['psychology'], query: '压住情绪确认真假', characters: [{ name: '主角', archetype: '冷静理智型', archetypeSource: 'explicit' }]
  });
  assert.match(context, /冷静理智型/);
  assert.match(context, /雨夜试探对手/);
});

test('写作请求在 strong 样本注入前包含逐条模型复核链路', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /await reviewCharacterMaterialSamples\(/);
  assert.match(serverSource, /promptVersion: 'character-material-review-v1'/);
  assert.match(serverSource, /request\.mode !== 'strong'/);
});
