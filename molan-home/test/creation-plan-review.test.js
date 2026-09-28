const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const server = require('../server');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const importSource = fs.readFileSync(path.join(__dirname, '..', 'completion-import.js'), 'utf8');
const dissectSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dissect.js'), 'utf8');

const completePayload = {
  schemaVersion: '1.1',
  creationPlan: { totalChapters: 2, volumeCount: 1, chapterWordTarget: 1800, lines: [{ id: 'growth', label: '成长线', role: 'primary', weight: 1 }] },
  taskConstraints: { genre: '都市悬疑' },
  bookPremise: { title: '雾港回声', oneLine: '调查员追查一段被删去的录音。' },
  authorDna: { summary: '用具体行动承载情绪。', rules: [{ axis: '对白', rule: '对白必须推动目标或信息变化。' }] },
  architecture: { volumes: [{ title: '第一卷', goal: '建立调查目标', chapters: [{ title: '雨夜录音', synopsis: '发现第一条线索。' }, { title: '空置房间', synopsis: '确认线索代价。' }] }] },
  opening: { hook: '一段不该存在的录音。' },
  goldenFinger: { type: '证据回溯', limitations: ['每次只能回溯一段声音'] },
  worldbuilding: [{ category: 'location', name: '雾港', detail: '潮湿的临海城市。' }],
  worldRules: [{ rule: '证据必须可验证', limit: '不能凭空改变事实', consequence: '错误判断会失去线索' }],
  map: { nodes: [{ name: '旧码头' }, { name: '档案馆' }, { name: '空置房' }], edges: [] },
  characters: [{ name: '沈砚' }, { name: '林澄' }, { name: '顾闻' }],
  characterLibrary: [{ name: '沈砚', role: '调查者', goal: '找出录音来源', flaw: '过度依赖证据' }],
  mainline: { premise: '追查录音', goal: '找出幕后删改者', escalation: '证据指向身边人', endingPromise: '真相必须付出代价' },
  storyTree: [{ node: '发现录音', parent: '', goal: '建立调查目标', conflict: '证据被追踪', result: '获得地址', chapterRange: '1-1' }],
  conflictChain: [{ stage: '第一轮', source: '删改者', pressure: '销毁证据', choice: '公开片段', cost: '暴露身份', chapterRange: '1-1' }],
  rewardChain: [{ stage: '第一轮', setup: '录音留下时间码', payoff: '锁定档案馆', cost: '失去匿名', chapterRange: '1-1' }],
  relationships: [{ from: '沈砚', to: '林澄', type: '合作' }],
  volumePlan: [{ volume: '第一卷', goal: '建立调查目标', turningPoint: '发现删改者在内部', endingHook: '收到下一段录音' }],
  arcPlan: [{ arc: '起查', goal: '找到第一处证据', opposition: '证据被销毁', turn: '同伴提供备份', payoff: '获得关键地址', chapterRange: '1-2' }],
  chapterPlan: [{ chapterNo: 1, title: '雨夜录音', goal: '确认录音真实性', protagonistAction: '追查时间码', opposition: '有人跟踪', informationChange: '锁定档案馆', result: '拿到地址', hook: '录音出现第二个声音', line: '成长线' }],
  scenePlan: [{ chapterNo: 1, sceneNo: 1, purpose: '发现线索', viewpoint: '沈砚', goal: '确认录音', conflict: '证据即将被毁', turn: '找到备份', exitHook: '收到警告' }],
  foreshadowLedger: [{ id: 'F001', plantIn: '第1章', payoffIn: '第2章', desc: '第二个声音的身份', strength: 'medium', status: 'planned' }],
  reviewPlan: { layers: ['structure', 'worldbuilding', 'characters', 'mainline', 'conflict', 'reward', 'chapter', 'originality'], checks: [{ layer: 'structure', check: '故事树能落到章节', passCriteria: '每个主要阶段有目标与结果' }] },
  forbiddenCopy: { entities: [], events: [], quotedText: [], sequencePatterns: [], roleCombinations: [] },
  sourceStructure: { rawText: '原书正文不应进入审核投影' }
};

test('创作规划投影保留完整链路且排除原书结构正文', () => {
  const projection = server.creationPlanProjection(completePayload);
  for (const key of ['authorDna', 'mainline', 'storyTree', 'conflictChain', 'rewardChain', 'volumePlan', 'arcPlan', 'chapterPlan', 'scenePlan', 'foreshadowLedger', 'reviewPlan']) {
    assert.ok(Object.prototype.hasOwnProperty.call(projection, key), key + ' 未进入审核投影');
  }
  assert.equal(Object.prototype.hasOwnProperty.call(projection, 'sourceStructure'), false);
  assert.equal(projection.sourceBoundary.originalContentExcluded, true);
});

test('创作圣经归一化保留稳定资料、状态、时间线和全部故事线', () => {
  const normalized = server.normalizeBiblePayload({
    title: '归一化保真测试',
    plan: {
      totalChapters: 8,
      volumeCount: 2,
      lines: [
        { id: 'growth', label: '成长线', role: 'primary', weight: 1, customField: '保留' },
        { id: 'mystery', label: '悬疑线', weight: 0.8 },
        { id: 'romance', label: '感情线', weight: 0.6 },
        { id: 'family', label: '家庭线', weight: 0.4 }
      ]
    },
    generated: {
      projectProfile: {
        subtitle: '副标题',
        penName: '测试笔名',
        theme: '关于选择的主题',
        tone: '克制温暖',
        sellingPoints: ['卖点一', '卖点二']
      },
      characters: [{
        id: 'character-original',
        name: '沈砚',
        age: 17,
        appearance: '黑发',
        background: '来自旧档案馆',
        abilities: ['辨认时间码'],
        voice: { samples: ['先看证据再说。'], taboo: '不承认害怕', habit: '先问依据' },
        relationships: [{ targetId: 'character-other', type: '互相试探' }]
      }],
      worldbuilding: [{ id: 'place-original', category: 'location', name: '雾港', terrain: '临海旧城', detail: '潮汐会改变道路' }],
      foreshadowLedger: [{ id: 'foreshadow-original', plantIn: '第1章', payoffIn: '第8章', desc: '第二个声音', status: 'deferred', clues: ['时间码'], relatedEntityIds: ['character-original'] }],
      timeline: [{ id: 'event-original', title: '旧档案馆失火', storyDate: '纪年12年春', narrativeOrder: 3, participants: ['沈砚'] }],
      chapterPlan: [{ chapterNo: 1, title: '第一章', characterStateChanges: Array.from({ length: 13 }, (_, index) => ({ name: `人物${index}`, state: '变化' })), foreshadowActions: Array.from({ length: 13 }, (_, index) => ({ id: `f${index}`, action: 'plant' })) }]
    }
  });
  assert.equal(normalized.projectProfile.subtitle, '副标题');
  assert.equal(normalized.projectProfile.penName, '测试笔名');
  assert.equal(normalized.projectProfile.sellingPoints.length, 2);
  assert.equal(normalized.creationPlan.lines.length, 4);
  assert.equal(normalized.creationPlan.lines[0].customField, '保留');
  assert.equal(normalized.characters[0].id, 'character-original');
  assert.equal(normalized.characters[0].age, 17);
  assert.equal(normalized.characters[0].abilities[0], '辨认时间码');
  assert.equal(normalized.worldbuilding[0].id, 'place-original');
  assert.equal(normalized.foreshadowLedger[0].id, 'foreshadow-original');
  assert.equal(normalized.foreshadowLedger[0].status, 'deferred');
  assert.deepEqual(normalized.foreshadowLedger[0].clues, ['时间码']);
  assert.equal(normalized.timeline[0].id, 'event-original');
  assert.equal(normalized.timeline[0].storyTime, '纪年12年春');
  assert.equal(normalized.chapterPlan[0].characterStateChanges.length, 13);
  assert.equal(normalized.chapterPlan[0].foreshadowActions.length, 13);
});

test('规划审核提示明确区分章纲节选与真实覆盖计数', () => {
  assert.match(serverSource, /章节与场景数组为了控制输入长度只展示首尾节选/);
  assert.match(serverSource, /coverage\.missingChapterCount、coverage\.invalidChapterCount、coverage\.duplicateChapterCount/);
});

test('本地八层审核能识别完整规划与结构缺口', () => {
  const passed = server.reviewCreationPlan(completePayload);
  assert.equal(passed.status, 'passed');
  const missing = server.reviewCreationPlan({ creationPlan: {}, characters: [], map: { nodes: [] } });
  assert.equal(missing.status, 'blocked');
  assert.ok(missing.issues.some(issue => issue.layer === 'structure'));
  assert.ok(missing.issues.some(issue => issue.layer === 'mainline'));
});

test('只有分批规划完成后才启用严格资源和章纲覆盖门禁', () => {
  const completedButSmall = server.reviewCreationPlan({ ...completePayload, planningState: { status: 'completed' } });
  assert.equal(completedButSmall.status, 'blocked');
  assert.ok(completedButSmall.issues.some(issue => issue.code === 'resource_coverage_shortfall'));
  assert.ok(completedButSmall.issues.some(issue => issue.code === 'chapter_coverage_incomplete'));
  const projection = server.creationPlanProjection({
    ...completePayload,
    creationPlan: { totalChapters: 1000, volumeCount: 10 },
    chapterPlan: Array.from({ length: 1000 }, (_, index) => ({ chapterNo: index + 1, title: `章节${index + 1}` }))
  });
  assert.equal(projection.chapterPlan.length, 24);
  assert.equal(projection.coverage.targets.chapters, 1000);
});

test('模型审核结果可归一化并保留 unavailable 状态', () => {
  const normalized = server.normalizeCreationPlanReviewModel({ status: 'needs_revision', summary: '需要补充场景', issues: [{ layer: 'chapter', severity: 'warning', message: '场景出口不明确', field: 'scenePlan' }], patches: [{ op: 'replace', path: '/scenePlan/0/exitHook', value: '留下新的证据' }] });
  assert.equal(normalized.status, 'needs_revision');
  assert.equal(normalized.issues[0].layer, 'chapter');
  assert.equal(normalized.patches.length, 1);
  assert.equal(server.normalizeCreationPlanReviewModel({ status: 'unavailable' }).status, 'unavailable');
});

test('规划审核补丁只允许修改白名单字段', () => {
  const rejected = server.applyCreationPlanPatches(completePayload, [{ op: 'replace', path: '/sourceStructure/rawText', value: '越权内容' }]);
  assert.equal(rejected.applied.length, 0);
  assert.equal(rejected.rejected.length, 1);
  const applied = server.applyCreationPlanPatches(completePayload, [{ op: 'replace', path: '/bookPremise/title', value: '新标题' }]);
  assert.equal(applied.applied.length, 1);
  assert.equal(applied.payload.bookPremise.title, '新标题');
});

test('规划审核补丁不允许数组或对象字段被错误类型覆盖', () => {
  const arrayRejected = server.applyCreationPlanPatches(completePayload, [{ op: 'replace', path: '/chapterPlan', value: '补齐缺失章节' }]);
  assert.equal(arrayRejected.applied.length, 0);
  assert.equal(arrayRejected.payload.chapterPlan.length, 1);
  assert.match(arrayRejected.rejected[0].reason, /类型不匹配/);
  const objectRejected = server.applyCreationPlanPatches(completePayload, [{ op: 'replace', path: '/bookPremise', value: '改写主线' }]);
  assert.equal(objectRejected.applied.length, 0);
  assert.equal(objectRejected.payload.bookPremise.title, '雾港回声');
  const itemRejected = server.applyCreationPlanPatches(completePayload, [{ op: 'replace', path: '/chapterPlan/0', value: '章节提示' }]);
  assert.equal(itemRejected.applied.length, 0);
  assert.equal(typeof itemRejected.payload.chapterPlan[0], 'object');
});

test('规划审核补丁不能缩减已有规划数组', () => {
  const rejected = server.applyCreationPlanPatches(completePayload, [{ op: 'replace', path: '/chapterPlan', value: [] }]);
  assert.equal(rejected.applied.length, 0);
  assert.equal(rejected.payload.chapterPlan.length, 1);
  assert.match(rejected.rejected[0].reason, /不能用更短数组/);
});

test('历史章纲缺少节奏字段时归一化补齐并保留已有合法值', () => {
  const legacy = [
    { chapterNo: 1, title: '第一章', goal: '确认第一条线索' },
    { chapterNo: 2, title: '第二章', goal: '追查线索去向' },
    { chapterNo: 3, title: '第三章', goal: '反转旧有判断', hookType: '反转', emotionIntensity: 9, payoffGap: 2 }
  ];
  const normalized = server.normalizeCreationChapterPlanRhythm(legacy);
  assert.equal(normalized.length, legacy.length);
  normalized.forEach(item => {
    assert.ok(['悬念', '危机', '期待', '反转'].includes(item.hookType));
    assert.ok(Number.isInteger(item.emotionIntensity) && item.emotionIntensity >= 0 && item.emotionIntensity <= 10);
    assert.ok(Number.isInteger(item.payoffGap) && item.payoffGap >= 0);
  });
  assert.notEqual(normalized[0].hookType, normalized[1].hookType);
  assert.equal(normalized[2].hookType, '反转');
  assert.equal(normalized[2].emotionIntensity, 9);
  assert.equal(normalized[2].payoffGap, 2);
});

test('1000章历史章纲投影首尾节选均带齐节奏字段', () => {
  const chapters = Array.from({ length: 1000 }, (_, index) => ({
    chapterNo: index + 1,
    title: '章节' + (index + 1),
    goal: '推进当前调查目标'
  }));
  chapters[999].hookType = '悬念';
  chapters[999].emotionIntensity = 8;
  chapters[999].payoffGap = 1;
  const projection = server.creationPlanProjection({
    creationPlan: { totalChapters: 1000, volumeCount: 5 },
    chapterPlan: chapters
  });
  assert.equal(projection.chapterPlan.length, 24);
  projection.chapterPlan.forEach(item => {
    assert.ok(item.hookType);
    assert.ok(Number.isInteger(item.emotionIntensity));
    assert.ok(Number.isInteger(item.payoffGap));
  });
  assert.equal(projection.chapterPlan.at(-1).hookType, '悬念');
  assert.equal(projection.chapterPlan.at(-1).emotionIntensity, 8);
  assert.equal(projection.chapterPlan.at(-1).payoffGap, 1);
});

test('节奏字段补齐不会放宽章节核心字段门禁', () => {
  const payload = {
    creationPlan: { totalChapters: 1, volumeCount: 1 },
    chapterPlan: [{ chapterNo: 1, title: '只有标题', goal: '有明确目标', protagonistAction: '执行具体行动', opposition: '遭遇具体阻力', informationChange: '获得新的信息', hook: '留下新的问题' }]
  };
  const normalized = server.normalizeCreationChapterPlanRhythm(payload.chapterPlan);
  const coverage = server.creationPlanCoverage({ ...payload, chapterPlan: normalized });
  assert.deepEqual(coverage.invalidChapters, [1]);
  assert.equal(coverage.chaptersReady, false);
});

test('拆书导出、带入接口和两个前端入口均包含作者 DNA', () => {
  assert.match(serverSource, /add\('作者 DNA', result\.authorDna\)/);
  assert.match(serverSource, /authorDna:\s*result\.authorDna/);
  assert.match(serverSource, /characterLibrary:\s*result\.characterLibrary/);
  assert.match(importSource, /authorDna:\s*1/);
  assert.match(importSource, /authorDna:\s*'作者 DNA'/);
  assert.match(importSource, /authorDnaMarkup\(value\)/);
  assert.match(dissectSource, /\['authorDna', '作者 DNA'\]/);
  assert.match(dissectSource, /key === 'authorDna'/);
});

test('创书生成后调用规划审核并使用审核后的 Bible payload', () => {
  assert.match(importSource, /requestCreationPlanReview\(creationBook\.id, baseBibleVersion/);
  assert.match(importSource, /\/api\/creation-books\/\$\{encodeURIComponent\(bookId\)\}\/plan-review/);
  assert.match(importSource, /autoRevise:\s*true/);
  assert.match(importSource, /biblePayload:\s*creationPayload/);
  assert.match(importSource, /reviewSummary\.status === 'blocked'/);
  assert.match(importSource, /renderCreationPlanReviewNotice\(/);
  assert.match(serverSource, /async function handleCreationBookPlanReview[\s\S]*?readBody\(req\)/);
});
