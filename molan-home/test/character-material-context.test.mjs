import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTEXT_WHITELIST,
  SCORE_WEIGHTS,
  extractGenerationContext,
  injectTop,
  rankMaterialCandidates
} from '../lib/character-material-context.mjs';

test('情境 extractor 只返回白名单字段，并支持结构化输入', () => {
  const result = extractGenerationContext({
    scene: '试探',
    relationship: '暧昧对象',
    emotionalState: ['紧张', '嘴硬', '未知情绪'],
    intent: '确认对方态度',
    dimension: '对白',
    humanTextureSignals: ['回避', 'unfinished_thought', 'unknown-signal']
  });

  assert.deepEqual(result, {
    scene: '试探',
    relationship: '暧昧对象',
    emotionalState: ['紧张', '嘴硬'],
    intent: '确认对方态度',
    dimension: 'dialogue',
    humanTextureSignals: ['avoidance', 'unfinished_thought'],
    fallback: false
  });
  assert.ok(result.scene === CONTEXT_WHITELIST.scene[8]);
  assert.equal(SCORE_WEIGHTS.scene + SCORE_WEIGHTS.relationship + SCORE_WEIGHTS.dimension
    + SCORE_WEIGHTS.texture + SCORE_WEIGHTS.archetype + SCORE_WEIGHTS.diversity, 1);
});

test('extractor 用轻量规则识别当前剧情，rawText 不作为输入来源', () => {
  const result = extractGenerationContext({
    currentPlot: '雨夜里两人试探彼此，想确认对方态度，关系暧昧。他移开视线，指尖捏着杯沿，半晌才补了一句。'
  });

  assert.equal(result.scene, '试探');
  assert.equal(result.relationship, '暧昧对象');
  assert.equal(result.intent, '确认对方态度');
  assert.equal(result.dimension, 'dialogue');
  assert.deepEqual(result.emotionalState, []);
  assert.ok(result.humanTextureSignals.includes('avoidance'));
  assert.ok(result.humanTextureSignals.includes('object_habit'));
  assert.ok(result.humanTextureSignals.includes('pause'));
  assert.equal(extractGenerationContext({ rawText: '试探 暧昧 紧张' }).fallback, true);
});

test('没有白名单命中时返回安全 fallback', () => {
  assert.deepEqual(extractGenerationContext({ query: '写一个没有具体情境的段落' }), {
    scene: '',
    relationship: '',
    emotionalState: [],
    intent: '',
    dimension: '',
    humanTextureSignals: [],
    fallback: true
  });
});

test('排序按固定权重返回分项贡献和命中原因', () => {
  const context = {
    scene: '试探',
    relationship: '暧昧对象',
    dimension: 'dialogue',
    humanTextureSignals: ['avoidance'],
    archetype: '冷静理智型'
  };
  const ranked = rankMaterialCandidates([
    {
      id: 'match', scene: ['试探'], relationship: ['暧昧对象'], dimension: 'dialogue',
      humanTextureSignals: ['avoidance'], archetype: '冷静理智型', sourceWorkId: 'book-a'
    },
    { id: 'miss', scene: ['战斗'], relationship: ['敌对'], dimension: 'action', archetype: '热血冲动型', sourceWorkId: 'book-b' }
  ], context);

  assert.deepEqual(ranked.map(item => item.id), ['match', 'miss']);
  assert.equal(ranked[0].score, 1);
  assert.equal(ranked[0].scoreBreakdown.scene.contribution, 0.35);
  assert.equal(ranked[0].scoreBreakdown.relationship.contribution, 0.2);
  assert.equal(ranked[0].scoreBreakdown.diversity.contribution, 0.1);
  assert.ok(ranked[0].reasons.some(reason => reason.startsWith('scene:matched')));
  assert.deepEqual(ranked[0].diversityMatches, {
    sameBook: false,
    sameAuthor: false,
    sameMicroPattern: false
  });
});

test('排序只使用最近五次记录，并对同书、作者和 microPattern 降权', () => {
  const context = { scene: '试探', dimension: 'dialogue' };
  const candidates = [
    { id: 'reused', scene: '试探', dimension: 'dialogue', sourceWorkId: 'book-a', author: 'author-a', microPatterns: ['mp-1'] },
    { id: 'fresh', scene: '试探', dimension: 'dialogue', sourceWorkId: 'book-b', author: 'author-b', microPatterns: ['mp-2'] }
  ];
  const history = [
    { sourceWorkId: 'stale-book', author: 'stale-author', microPatterns: ['stale-pattern'] },
    { sourceWorkId: 'book-a', author: 'author-a', microPatterns: ['mp-1'] },
    { sourceWorkId: 'book-a', author: 'author-a', microPatterns: ['mp-1'] },
    { sourceWorkId: 'book-a', author: 'author-a', microPatterns: ['mp-1'] },
    { sourceWorkId: 'book-a', author: 'author-a', microPatterns: ['mp-1'] },
    { sourceWorkId: 'book-a', author: 'author-a', microPatterns: ['mp-1'] }
  ];
  const ranked = rankMaterialCandidates(candidates, context, { recentHistory: history });

  assert.deepEqual(ranked.map(item => item.id), ['fresh', 'reused']);
  assert.equal(ranked.find(item => item.id === 'reused').diversityPenalty, 1);
  assert.equal(ranked.find(item => item.id === 'reused').scoreBreakdown.diversity.recentWindow, 5);
  assert.equal(ranked.find(item => item.id === 'fresh').diversityPenalty, 0);
});

test('injectTop 按模式限制样本数量，并剔除 rawText', () => {
  const candidates = [
    { id: 'sample-1', kind: 'sample', text: '安全样本一', rawText: '不得进入运行时' },
    { id: 'sample-2', kind: 'sample', text: '安全样本二' },
    { id: 'sample-3', kind: 'sample', text: '安全样本三' },
    { id: 'rule-1', kind: 'rule', rule: '一条规则' }
  ];

  assert.deepEqual(injectTop(candidates, 'normal').map(item => item.id), ['rule-1']);
  assert.deepEqual(injectTop(candidates, 'auto').map(item => item.id), ['rule-1']);
  assert.deepEqual(injectTop(candidates, 'strong').map(item => item.id), ['sample-1', 'sample-2']);
  assert.deepEqual(injectTop(candidates).map(item => item.id), ['sample-1']);
  assert.equal(Object.prototype.hasOwnProperty.call(injectTop(candidates, 'strong')[0], 'rawText'), false);
});
