const assert = require('node:assert/strict');
const { test } = require('node:test');
const material = require('../lib/character-material');

function publishedIndex() {
  return {
    version: 'v31-runtime-test',
    published: true,
    profileGenreMap: {},
    general: {
      rules: [
        { id: 'r-scene', archetype: '冷静理智型', dimension: 'dialogue', scene: '试探', relationships: ['暧昧对象'], intent: '确认对方态度', rule: '先处理一个可观察的小动作，再回答核心问题。' },
        { id: 'r-other', archetype: '冷静理智型', dimension: 'action', scene: '战斗', rule: '动作必须改变场面。' }
      ],
      samples: [
        { id: 's-same', archetype: '冷静理智型', dimension: 'dialogue', text: '她先避开视线，指尖在杯沿停了一下，才问他到底想说什么。', scene: '试探', relationship: '暧昧对象', emotionalState: ['紧张'], intent: '确认对方态度', humanTextureSignals: ['avoidance', 'pause'], canonicalWorkId: 'work-a', sourceWorkId: 'work-a', authorHash: 'author-a', residualTerms: [], forbiddenTerms: [] },
        { id: 's-other', archetype: '冷静理智型', dimension: 'dialogue', text: '她把文件按顺序收好，才抬头问对方是否还有别的事。', scene: '日常', relationship: '同僚', emotionalState: ['平静'], intent: '解释', humanTextureSignals: ['object_habit'], canonicalWorkId: 'work-b', sourceWorkId: 'work-b', authorHash: 'author-b', residualTerms: [], forbiddenTerms: [] },
        { id: 's-third', archetype: '冷静理智型', dimension: 'dialogue', text: '她没有立刻回答，只把手机扣在桌面上，等屋里安静下来。', scene: '试探', relationship: '暧昧对象', emotionalState: ['嘴硬'], intent: '掩饰情绪', humanTextureSignals: ['silent_response'], canonicalWorkId: 'work-c', sourceWorkId: 'work-c', authorHash: 'author-c', residualTerms: [], forbiddenTerms: [] }
      ]
    },
    mature: { rules: [], samples: [] },
    audit: { strongSamplesPublished: true }
  };
}

test('请求上下文按白名单提取并在无证据时回退', () => {
  const request = material.normalizeCharacterMaterialRequest({
    mode: 'strong',
    archetypes: ['冷静理智型'],
    query: '她受伤后仍然试探对方的态度，想确认他是否在说谎',
    dimensions: ['dialogue']
  });
  assert.equal(request.scene, '试探');
  assert.equal(request.intent, '确认对方态度');
  assert.ok(request.emotionalState.includes('担忧'));
  assert.equal(request.contextFallback, false);
  const fallback = material.normalizeCharacterMaterialRequest({ archetypes: ['冷静理智型'] });
  assert.equal(fallback.contextFallback, true);
});

test('情境检索优先命中 scene、relationship 和 intent，普通模式只取一条规则', () => {
  const result = material.retrieveCharacterMaterial({}, {
    mode: 'auto', archetypes: ['冷静理智型'], dimensions: ['dialogue'],
    scene: '试探', relationship: '暧昧对象', intent: '确认对方态度',
    query: '确认对方态度', proseTask: true
  }, { index: publishedIndex() });
  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0].id, 'r-scene');
  assert.equal(result.samples.length, 0);
  assert.equal(result.audit.scene, '试探');
});

test('strong 模式最多注入两条样本，并对连续同来源降权', () => {
  const result = material.retrieveCharacterMaterial({}, {
    mode: 'strong', archetypes: ['冷静理智型'], dimensions: ['dialogue'],
    scene: '试探', relationship: '暧昧对象', intent: '确认对方态度', proseTask: true,
    recentHistory: Array.from({ length: 5 }, () => ({ canonicalWorkId: 'work-a', authorHash: 'author-a', microPatterns: ['mp-a'] }))
  }, { index: publishedIndex() });
  assert.equal(result.samples.length, 2);
  assert.ok(result.samples.every(item => item.retrieval && Array.isArray(item.retrieval.matchReasons)));
  const repeated = result.samples.find(item => item.id === 's-same');
  assert.ok(repeated);
  assert.ok(repeated.retrieval.diversityPenalty > 0);
  assert.equal(repeated.retrieval.sameRecentWork, 5);
});

test('runtime block明确禁止把素材当答案并保留上下文边界', () => {
  const result = material.buildCharacterMaterialBlock({}, {
    mode: 'strong', archetypes: ['冷静理智型'], dimensions: ['dialogue'],
    scene: '试探', relationship: '暧昧对象', intent: '确认对方态度', proseTask: true
  }, { index: publishedIndex() });
  assert.equal(result.messages.length, 2);
  assert.match(result.messages[0].content, /禁止照抄措辞/);
  assert.match(result.messages[0].content, /当前情境：场景：试探/);
  assert.match(result.messages[1].content, /不是答案/);
});
