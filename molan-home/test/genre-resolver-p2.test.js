'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveGenre, GENRE_ALIASES } = require('../lib/genre/resolver');
const { buildGenreProfile, BASE_PROFILES } = require('../lib/genre/profile');
const { detectNovelStyle } = require('../lib/style-detector');
const { globalRegistry } = require('../lib/novel-generate-registry');

test('P2: resolveGenre - 未知冷门/自设片段应输出 uncertain 或 universal，严禁回退玄幻', () => {
  const coldInput = {
    title: '钟表店的阴影',
    prompt: '老街钟表修理匠在雨夜遇到神秘古董商，两人就一块老怀表的发条和齿轮咬合展开交涉。',
    userInstruction: '写一篇写实风格的店铺对话。'
  };

  const result = resolveGenre(coldInput);
  assert.notEqual(result.genre, '玄幻', '未知题材严禁静默回退为玄幻');
  assert.ok(result.status === 'uncertain' || result.genre === '通用', `未知题材状态应为 uncertain 或 通用，实际为 ${result.status} / ${result.genre}`);
});

test('P2: resolveGenre - 显式通用与 universal 支持精确解析', () => {
  const universalResult = resolveGenre({ genre: 'universal' });
  assert.equal(universalResult.status, 'resolved');
  assert.equal(universalResult.genre, '通用');

  const tongyongResult = resolveGenre({ genre: '通用' });
  assert.equal(tongyongResult.status, 'resolved');
  assert.equal(tongyongResult.genre, '通用');
});

test('P2: buildGenreProfile - 支持通用叙事基座画像', () => {
  const profile = buildGenreProfile({ genre: '通用' });
  assert.equal(profile.status, 'resolved');
  assert.equal(profile.genre, '通用');
  assert.equal(profile.narrativeMode, '现实推进与戏剧交互');
  assert.equal(profile.auditPolicy.requireConflict, false);

  const unknownProfile = buildGenreProfile({ genre: '未知虚构流派' });
  assert.equal(unknownProfile.status, 'needs_choice');
  assert.ok(unknownProfile.candidates.includes('通用'));
  assert.ok(unknownProfile.candidates.includes('universal'));
});

test('P2: detectNovelStyle - 无题材特征文本降级为通用现实基座而非玄幻', () => {
  const neutralText = '今天下午开了一场项目复盘会议，大家讨论了产品交付周期的延误原因，并制定了下周的优化计划。';
  const detected = detectNovelStyle(neutralText, { bookTitle: '办公室日常' });

  assert.notEqual(detected.genreFamily, '玄幻修真', '无修真特征的文本不可推断为玄幻修真');
  assert.equal(detected.genreFamily, '通用现实', '应降级为通用现实');
  assert.equal(detected.subcategory, '通用');
  assert.notEqual(detected.styleArchetype, 'epic_grandeur', '文风不可推断为玄幻史诗');
});

test('P2: NovelGenerateRegistry - 未知小说规格默认通用现实', () => {
  const spec = globalRegistry.getNovelGenerateSpec('全新未登记的小说名', {
    prompt: '一个年轻人在小镇上开了一家杂货铺的故事。'
  });

  assert.notEqual(spec.category, '玄幻', '未指定题材时 category 不得为玄幻');
  assert.notEqual(spec.family, '玄幻修真', '未指定题材时 family 不得为玄幻修真');
  assert.equal(spec.category, '通用');
  assert.equal(spec.family, '通用现实');

  const genreSpec = globalRegistry.getGenreGenerateSpec();
  assert.equal(genreSpec.family, '通用现实');
  assert.equal(genreSpec.subcategory, '通用');
});
