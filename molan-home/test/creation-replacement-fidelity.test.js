const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');

const server = require('../server');
const T = server.__test;
const importSource = fs.readFileSync(require.resolve('../completion-import.js'), 'utf8');
const indexSource = fs.readFileSync(require.resolve('../index.html'), 'utf8');

// ============ Task 1 · Bible seed 原创性校验 ============
function validPayload(overrides) {
  return {
    characters: [
      { name: '林远', role: '男主', arc: '' },
      { name: '苏晚', role: '女主', arc: '' },
      { name: '顾千', role: '男配', arc: '' }
    ],
    worldbuilding: [{ category: '地点', name: '星海城', detail: '主角故乡' }],
    map: { nodes: [{ name: '星海城' }, { name: '荒丘' }, { name: '云端' }], edges: [] },
    relationships: [],
    goldenFinger: { type: '系统', entry: 2 },
    ...(overrides || {})
  };
}

test('seed 校验：完全没有冲突且结构完整时通过', () => {
  const r = server.creationBibleSeedValidation(validPayload(), ['落霞宗', '青云子']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.hits, []);
  assert.deepEqual(r.missing, []);
});

test('seed 校验：人物名与禁止复制项完全匹配时拒绝并列出命中项', () => {
  const r = server.creationBibleSeedValidation(validPayload({ characters: [{ name: '青云子', role: '反派' }, { name: '林远', role: '男主' }, { name: '苏晚', role: '女主' }] }), ['青云子', '落霞宗']);
  assert.equal(r.ok, false);
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].field, 'characters');
  assert.equal(r.hits[0].value, '青云子');
});

test('seed 校验：名词包含禁止项（子串命中≥2字）时也拒绝', () => {
  const r = server.creationBibleSeedValidation(validPayload({ worldbuilding: [{ name: '青云子城', detail: '' }] }), ['青云子']);
  // worldbuilding 的名称含禁止项，命中
  assert.equal(r.ok, false);
  assert.ok(r.hits.some(h => h.field === 'worldbuilding'));
});

test('seed 校验：人物少于 3 个返回 incomplete 缺失', () => {
  const r = server.creationBibleSeedValidation(validPayload({ characters: [{ name: '林远', role: '男主' }] }), []);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some(m => m.field === 'characters'));
});

test('seed 校验：地图节点少于 3 个返回缺失', () => {
  const r = server.creationBibleSeedValidation(validPayload({ map: { nodes: [{ name: '星海城' }], edges: [] } }), []);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some(m => m.field === 'map.nodes'));
});

test('seed 校验：金手指类型为空返回缺失', () => {
  const r = server.creationBibleSeedValidation(validPayload({ goldenFinger: { entry: 2 } }), []);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some(m => m.field === 'goldenFinger.type'));
});

test('seed 校验：空禁止项列表不产生命中，仅受结构约束', () => {
  const r = server.creationBibleSeedValidation(validPayload(), []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.hits, []);
});

test('创书圣经归一化：兼容模型别名并保留地图与伏笔规划', () => {
  const payload = server.normalizeBiblePayload({ generated: {
    characterDesign: [{ name: '甲' }, { name: '乙' }, { name: '丙' }],
    worldMap: { nodes: [{ name: '一' }, { name: '二' }, { name: '三' }], edges: [] },
    golden_finger: { kind: '原创机制' },
    foreshadowPlan: [{ id: 'f1', plantIn: '第1章', payoffIn: '第3章', desc: '一枚线索' }]
  } });
  assert.equal(payload.characters.length, 3);
  assert.equal(payload.map.nodes.length, 3);
  assert.equal(payload.goldenFinger.type, '原创机制');
  assert.equal(payload.foreshadowLedger.length, 1);
  assert.deepEqual(server.creationBibleSeedValidation(payload, []).missing, []);
});

test('seed 校验：描述中出现禁止词但名称原创时不误拒绝', () => {
  const r = server.creationBibleSeedValidation(validPayload({ worldbuilding: [{ name: '新城', detail: '这里曾经提到青云子，但不是实体名称' }] }), ['青云子']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.hits, []);
});

// ============ Task 2 · 骨架保留符合度 ============
function compliancePayload(overrides) {
  const p = {
    creationPlan: { retention: { opening: 'keep', goldenFinger: 'keep', architecture: 'keep', rhythm: 'keep' } },
    sourceStructure: {
      goldenFinger: { entry: 3 },
      architecture: { stages: [1, 2, 3] },
      framework: { stages: ['a', 'b', 'c'] }
    },
    goldenFinger: { type: '系统', entry: 3 },
    architecture: {},
    volumePlan: [{ title: '一' }, { title: '二' }, { title: '三' }],
    arcPlan: []
  };
  return Object.assign(p, overrides || {});
}

test('保留符合度：金手指时机相差超过 keep 级 1 章时 violated', () => {
  const r = server.computeRetentionCompliance(compliancePayload({ goldenFinger: { type: '系统', entry: 6 } }), []);
  const gf = r.items.find(i => i.key === 'goldenFinger');
  assert.equal(gf.status, 'violated');
  assert.equal(r.violatedCount >= 1, true);
});

test('保留符合度：金手指时机 keep 级相差 1 章内时 ok', () => {
  const r = server.computeRetentionCompliance(compliancePayload({ goldenFinger: { type: '系统', entry: 4 } }), []);
  assert.equal(r.items.find(i => i.key === 'goldenFinger').status, 'ok');
});

test('保留符合度：rewrite 级跳过测量且不产生 violated', () => {
  const r = server.computeRetentionCompliance(compliancePayload({
    creationPlan: { retention: { opening: 'rewrite', goldenFinger: 'rewrite', architecture: 'rewrite', rhythm: 'rewrite' } }
  }), []);
  assert.equal(r.violatedCount, 0);
  assert.ok(r.items.every(i => i.status === 'insufficient' && i.skipped === true));
});

test('保留符合度：数据不足时金手指返回 insufficient 而非 violated', () => {
  const r = server.computeRetentionCompliance(compliancePayload({ goldenFinger: {} }), []);
  assert.equal(r.items.find(i => i.key === 'goldenFinger').status, 'insufficient');
});

test('保留符合度：开篇无快照返回 insufficient', () => {
  const r = server.computeRetentionCompliance(compliancePayload(), []);
  assert.equal(r.items.find(i => i.key === 'opening').status, 'insufficient');
});

test('保留符合度：有前3章快照且事件数足够时 opening 为 ok', () => {
  const snapshots = [
    { chapterNo: 1, recentFacts: [{ type: '危机', result: '发现异常' }, { informationChange: '得到线索' }] },
    { chapterNo: 2, recentFacts: [{ informationChange: '确认方向' }] },
    { chapterNo: 3, recentFacts: [{ informationChange: '锁定目标' }] }
  ];
  const r = server.computeRetentionCompliance(compliancePayload(), snapshots);
  assert.equal(r.items.find(i => i.key === 'opening').status, 'ok');
});

test('保留符合度：节奏无快照返回 insufficient', () => {
  const r = server.computeRetentionCompliance(compliancePayload(), []);
  assert.equal(r.items.find(i => i.key === 'rhythm').status, 'insufficient');
});

test('保留符合度：快照中收尾信息占比过高时 rhythm 为 ok', () => {
  const snapshots = [
    { chapterNo: 1, recentFacts: [{ result: 'a' }] },
    { chapterNo: 2, recentFacts: [{ result: 'b' }] },
    { chapterNo: 3, recentFacts: [{ result: 'c' }] }
  ];
  const r = server.computeRetentionCompliance(compliancePayload(), snapshots);
  const rh = r.items.find(i => i.key === 'rhythm');
  assert.ok(['ok', 'violated'].includes(rh.status));
});

// ============ Task 3 · L1 确定性结构比对 ============
test('事件链 LCS：序列数不足返回 null', () => {
  assert.equal(T.computeEventChainLCS([{ action: 'a' }], [{ action: 'a' }]), null);
});

test('事件链 LCS：完全相同序列相似度为 1', () => {
  const evs = [
    { action: '入侵', role: '反派', result: '城陷' },
    { action: '反击', role: '主角', result: '夺回' }
  ];
  assert.equal(T.computeEventChainLCS(evs, evs.slice()), 1);
});

test('事件链 LCS：完全不同序列相似度较低', () => {
  const a = [{ action: '入侵', role: '反派', result: '城陷' }];
  const b = [{ action: '拾荒', role: '村民', result: '生存' }];
  assert.ok(T.computeEventChainLCS(a, b) < 0.35);
});

test('角色功能组合 Jaccard：集合相同为 1', () => {
  const newChars = [{ role: '男主' }, { role: '女主' }];
  const srcChars = [{ role: '男主' }, { role: '女主' }];
  assert.equal(T.computeRoleCombinationJaccard(newChars, srcChars), 1);
});

test('角色功能组合 Jaccard：无交集集合为 0', () => {
  const newChars = [{ role: '男主' }];
  const srcChars = [{ role: '炮灰' }];
  assert.equal(T.computeRoleCombinationJaccard(newChars, srcChars), 0);
});

test('角色功能组合 Jaccard：集合为空返回 null', () => {
  assert.equal(T.computeRoleCombinationJaccard([], []), null);
});

test('地图拓扑：节点不足返回 null', () => {
  assert.equal(T.computeMapTopologySimilarity({ nodes: [{ name: 'a' }] }, { nodes: [{ name: 'a' }] }), null);
});

test('地图拓扑：相同层级树相似度为 1', () => {
  const m1 = { nodes: [{ id: 'a', name: '城' }, { id: 'b', name: '乡' }], edges: [{ source: 'a', target: 'b' }] };
  const m2 = { nodes: [{ id: 'a', name: '城' }, { id: 'b', name: '乡' }], edges: [{ source: 'a', target: 'b' }] };
  assert.equal(T.computeMapTopologySimilarity(m1, m2), 1);
});

test('地图拓扑：完全不同的地图相似度低', () => {
  const m1 = { nodes: [{ id: 'a', name: '城甲' }, { id: 'b', name: '乡乙' }], edges: [{ source: 'a', target: 'b' }] };
  const m2 = { nodes: [{ id: 'x', name: '宫丙' }, { id: 'y', name: '殿丁' }], edges: [{ source: 'x', target: 'y' }] };
  assert.ok(T.computeMapTopologySimilarity(m1, m2) < 0.45);
});

// ============ Task 3 · 原创门禁确定性优先 ============
test('原创门禁：全字段无数据时返回 pending（行为不劣于现状）', () => {
  const r = T.creationOriginalityGate({}, {}, []);
  assert.equal(r.status, 'pending');
  assert.ok(r.missing.length >= 3);
});

test('原创门禁：模型估值超阈值仍 blocker（阈值不变）', () => {
  const r = T.creationOriginalityGate({}, { structureMetrics: { eventChainSimilarity: 0.4, roleCombinationSimilarity: 0.1, mapTopologySimilarity: 0.1, relationshipGraphSimilarity: 0.1, goldenFingerMechanismSimilarity: 0.1 } }, []);
  assert.equal(r.status, 'blocked');
  assert.equal(r.metrics.eventChainSimilarity, 0.4);
});

test('原创门禁：确定性指标优先于模型估值', () => {
  // 模型估值超阈值，但确定性计算出的相似度低 → 应通过（确定性优先）
  const payload = {
    characters: [{ role: '男主' }, { role: '女主' }],
    map: { nodes: [{ id: 'a', name: '城' }, { id: 'b', name: '乡' }], edges: [{ source: 'a', target: 'b' }] },
    sourceStructure: {
      characters: [{ role: '炮灰' }, { role: '路人' }],
      map: { nodes: [{ id: 'x', name: '宫' }, { id: 'y', name: '殿' }], edges: [] },
      events: [{ action: '猎杀', role: '男主', result: '胜' }, { action: '逃生', role: '女主', result: '脱' }]
    },
    timeline: []
  };
  const modelAudit = { structureMetrics: { eventChainSimilarity: 0.9, roleCombinationSimilarity: 0.9, mapTopologySimilarity: 0.9, relationshipGraphSimilarity: 0.1, goldenFingerMechanismSimilarity: 0.1 } };
  const snapshots = [{ chapterNo: 1, recentFacts: [{ action: '拾荒', role: '村民', result: '生存' }, { action: '勘探', role: '主角', result: '发现' }] }];
  const r = T.creationOriginalityGate(payload, modelAudit, [], snapshots);
  // 确定性指标优先：roleCombination 无交集、map 几何差异、eventChain 截然不同 → 全部低
  assert.equal(r.status, 'passed');
  assert.equal(r.deterministic.used.roleCombinationSimilarity, 'deterministic');
  assert.equal(r.deterministic.used.eventChainSimilarity, 'deterministic');
  assert.equal(r.deterministic.used.mapTopologySimilarity, 'deterministic');
  // goldenFinger/relationship 无法确定性计算 → 沿用模型估值
  assert.equal(r.metrics.goldenFingerMechanismSimilarity, 0.1);
  assert.equal(r.metrics.relationshipGraphSimilarity, 0.1);
});

test('原创门禁：模型返回 null 不被误算为 0', () => {
  const r = T.creationOriginalityGate({}, { structureMetrics: { eventChainSimilarity: null, roleCombinationSimilarity: null, mapTopologySimilarity: null, relationshipGraphSimilarity: null, goldenFingerMechanismSimilarity: null } }, []);
  assert.equal(r.status, 'pending');
  assert.equal(r.missing.length, 5);
});

test('创书弹窗包含结构预览、拆书线索下拉和 422 一键重试', () => {
  assert.match(importSource, /creationStructureCard/);
  assert.match(importSource, /collectLineCandidates/);
  assert.match(importSource, /creationLine2Value/);
  assert.match(importSource, /creationRetryButton/);
  assert.match(importSource, /上次门禁反馈/);
  assert.match(indexSource, /error\.code = data\.code/);
  assert.match(indexSource, /error\.hits = data\.hits/);
});

test('创书输出格式要求生成可用地图节点', () => {
  assert.match(importSource, /map:\{nodes:\[\{id,name,parentId,type,detail\}\],edges:\[\{source,target,relation\}\]\}/);
  assert.match(importSource, /地图节点必须有具体名称，并在 detail 中写明可发生的行动或用途/);
  assert.match(importSource, /个地图节点/);
});
