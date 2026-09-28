import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  anonymizeSample,
  candidateNameTerms,
  fixQuoteBoundary,
  isQaSample,
  isBrokenAnonymization,
  scanCorpusNameCombos,
  loadCharacterLibraryNames,
  buildIndex,
  WHITELIST
} from '../scripts/build-character-material-index.mjs';
import characterMaterial from '../lib/character-material.js';

const { retrieveCharacterMaterial } = characterMaterial;

const SAMPLE_RULES = [{ id: 'r1', archetype: '', dimension: 'action', rule: 'x', application: '', caution: '', scenes: [], signals: [], score: 1 }];

test('白名单常用词保留、词典人名被替换', () => {
  assert.ok(WHITELIST.has('温暖'), '温暖必须在白名单');
  assert.ok(WHITELIST.has('大哥'), '大哥必须在白名单');
  const dictionary = new Set(['林默']);
  const row = {
    title: '测试书', author: '某作者',
    archetype: '通用', dimension: 'action',
    text: '温暖的大哥林默站在门外，冷静地观察四周。'
  };
  const { text, forbiddenTerms } = anonymizeSample(row, dictionary);
  assert.ok(text.includes('温暖'), '温暖应保留');
  assert.ok(text.includes('大哥'), '大哥应保留');
  assert.ok(text.includes('[人物]'), '林默应被替换为[人物]');
  assert.ok(!forbiddenTerms.includes('温暖'), '温暖不得进入 forbiddenTerms');
  assert.ok(!forbiddenTerms.includes('大哥'), '大哥不得进入 forbiddenTerms');
  assert.ok(!forbiddenTerms.includes('[人物]'), '占位符本身不得作为禁用词');
});

test('[人物]占比超阈值判定为破碎', () => {
  assert.equal(isBrokenAnonymization('[人物]'.repeat(20)), true);
  assert.equal(isBrokenAnonymization('他握紧刀柄，指节发白，没有回头。'), false);
});

test('破碎组合模式 又[人物]又 / [人物]地 判定为破碎', () => {
  assert.equal(isBrokenAnonymization('他又[人物]又看'), true);
  assert.equal(isBrokenAnonymization('那个[人物]地走了'), true);
  assert.equal(isBrokenAnonymization('夜色里她站在门口静静看着[人物]慢慢远去，没有说话，只是把围巾又紧了紧，风从窗缝里漏进来，走廊的灯一盏盏暗下去，远处传来收摊的吆喝。'), false);
});

test('样本开头残留右引号被修复', () => {
  assert.equal(fixQuoteBoundary('」他转身离去，没有言语。'), '他转身离去，没有言语。');
  assert.equal(fixQuoteBoundary('“她说完这句话，便沉默了。'), '“她说完这句话，便沉默了。');
  assert.equal(fixQuoteBoundary('正常开头的句子。'), '正常开头的句子。');
});

test('问答体样本被识别', () => {
  assert.equal(isQaSample({ text: '请问这个怎么写？' }), true);
  assert.equal(isQaSample({ text: '求助：内容：该怎么办。' }), true);
  assert.equal(isQaSample({ text: '他握紧刀柄，没有回头。' }), false);
});

test('语料高频引号邻接组合被识别为人名候选', () => {
  const corpus = Array.from({ length: 5 }, () => '张三说：「今天天气真好」').join('');
  const combos = scanCorpusNameCombos(corpus);
  assert.ok(combos.has('张三'), '张三应被识别为人名候选');
  assert.ok(!combos.has('天气'), '天气不应被误判为人名');
});

test('loadCharacterLibraryNames 在无数据库环境安全返回空集合', () => {
  const names = loadCharacterLibraryNames();
  assert.ok(names instanceof Set);
});

test('buildIndex 过滤问答体并统计破碎剔除', () => {
  const md = [
    '## 豪爽侠义型',
    '### 动作',
    '**1. 测试样本 · 某作者**',
    '> 题材：武侠；规则信号：无',
    '> 他握紧刀柄，指节发白，没有回头。',
    '## 温柔内敛型',
    '### 心理',
    '**2. 问答样本 · 网友**',
    '> 题材：问答；规则信号：无',
    '> 请问这个关于人物描写的段落应该怎么写才自然？求助：内容：我总是写不好对话该怎么办。'
  ].join('\n');
  const result = buildIndex(md, { input: '', output: '' });
  const report = result.report;
  assert.ok(report.counts.qaFeature >= 1, '问答体应被统计');
  assert.equal(report.brokenDensity, 0, '无破碎样本时密度为 0');
  assert.equal(report.machineGate, true, '机器门禁应通过');
  assert.equal(result.index.published, false, '未人工审核不应发布');
});

test('strong 模式但索引未发布时降级为 auto 并记录原因', () => {
  const unpublishedIndex = {
    version: 'x', published: false,
    general: { rules: SAMPLE_RULES, samples: [{ id: 's1', archetype: '通用', dimension: 'action', text: '他握紧刀柄，先核对四周动静再决定是否前进。', sourceHash: 'h', signals: [], forbiddenTerms: [], residualTerms: [], score: 1 }] },
    mature: { rules: [], samples: [] },
    audit: { strongSamplesPublished: false }
  };
  const { request, audit, samples } = retrieveCharacterMaterial(null, { mode: 'strong' }, { index: unpublishedIndex });
  assert.equal(request.mode, 'auto', '应降级为 auto');
  assert.equal(audit.downgradeReason, 'corpus_not_published');
  assert.equal(samples.length, 0, '未发布不应返回 strong 样本');
});

test('索引已发布时 strong 模式不降级', () => {
  const publishedIndex = {
    version: 'x', published: true,
    general: { rules: SAMPLE_RULES, samples: [{ id: 's1', archetype: '通用', dimension: 'action', text: '他握紧刀柄，先核对四周动静再决定是否前进。', sourceHash: 'h', signals: [], forbiddenTerms: [], residualTerms: [], score: 1 }] },
    mature: { rules: [], samples: [] },
    audit: { strongSamplesPublished: true }
  };
  const { request, audit, samples } = retrieveCharacterMaterial(null, { mode: 'strong' }, { index: publishedIndex });
  assert.equal(request.mode, 'strong', '已发布不应降级');
  assert.equal(audit.downgradeReason, '');
  assert.equal(samples.length, 1, '应返回 strong 样本');
});
