'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  scanGenreBooks,
  extractThreeStages,
  compressToDualPrompts,
  GENRE_STYLE_DIRECTIVES
} = require('../lib/ground-truth-extractor');

const CORPUS_BASE_DIR = path.resolve(__dirname, '../../资源库/小说原本');

test('Ground Truth Extractor：扫描题材名家小说（每题材 >= 6 本）', () => {
  const xuanhuanDir = path.join(CORPUS_BASE_DIR, '玄幻');
  const books = scanGenreBooks(xuanhuanDir, 6);

  assert.equal(books.length, 6, '玄幻题材应成功筛选出 6 本代表作');
  for (const b of books) {
    assert.ok(b.title && b.title.length > 0, '书名必须有效');
    assert.ok(b.author && b.author.length > 0, '作者必须有效');
    assert.ok(b.sizeBytes > 200 * 1024, '文件大小需大于 200KB');
  }
});

test('Ground Truth Extractor：抽取前、中、后三阶段章节', () => {
  const xuanhuanDir = path.join(CORPUS_BASE_DIR, '玄幻');
  const books = scanGenreBooks(xuanhuanDir, 1);
  assert.ok(books.length > 0);

  const stages = extractThreeStages(books[0].fullPath);
  assert.ok(stages.totalChapters >= 10, '总章节数应正常解析');
  assert.equal(stages.early.stage, 'early');
  assert.equal(stages.middle.stage, 'middle');
  assert.equal(stages.late.stage, 'late');

  assert.ok(stages.early.bodyText.length > 200, '前期正文必须非空');
  assert.ok(stages.middle.bodyText.length > 200, '中期正文必须非空');
  assert.ok(stages.late.bodyText.length > 200, '后期正文必须非空');
});

test('Ground Truth Extractor：双粒度提示词压缩与文风绑定断言', () => {
  const mockStage = {
    stage: 'middle',
    chapterTitle: '第100章 惊天死局',
    bodyText: '神威如海，青石寸寸龟裂。张若尘倒退三步，冷冷看着面前的伪神。他擦去嘴角血迹，轻声笑道：“你怕了？”',
    paragraphs: [
      '神威如海，青石寸寸龟裂。',
      '张若尘倒退三步，冷冷看着面前的伪神。',
      '他擦去嘴角血迹，轻声笑道：“你怕了？”'
    ]
  };

  const prompts = compressToDualPrompts(mockStage, {
    title: '一世之尊',
    author: '爱潜水的乌贼',
    genre: '玄幻'
  });

  assert.ok(prompts.detailedPrompt.includes('【微观剧情节点与分镜'));
  assert.ok(prompts.detailedPrompt.includes('作品风格与语言特质'));
  assert.ok(prompts.detailedPrompt.includes('爱潜水的乌贼'));

  assert.ok(prompts.coarsePrompt.includes('【宏观核心冲突梗概】'));
  assert.ok(prompts.coarsePrompt.includes('作品风格与语言特质'));
  assert.ok(prompts.coarsePrompt.includes('爱潜水的乌贼'));
  // 粗略版不应包含逐段分镜细目
  assert.ok(!prompts.coarsePrompt.includes('【微观剧情节点与分镜'));
});
