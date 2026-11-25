'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const styleFingerprint = require('../lib/style-fingerprint');
const aiFlavorDetector = require('../lib/ai-flavor-detector');
const { isBrokenAnonymizedText } = require('../lib/character-material');
const { createHumanizePolicyService } = require('../services/humanize-policy-service');
const correctionPolicy = require('../correction-policy');

const DATA_DIR = path.join(__dirname, '..', 'data');

test('全库 1,279 本真实 style-fingerprints.json 完整覆盖且含扩展突发度指标', () => {
  const data = styleFingerprint.loadStyleFingerprints();
  assert.ok(data, 'style-fingerprints.json 应存在');
  assert.ok(data.bookCount >= 1279, `应覆盖至少 1279 本真实原书，实际 ${data.bookCount}`);
  assert.ok(data.totalChars >= 70000000, `全库有效字数应达 7000 万以上，实际 ${data.totalChars}`);

  const resolved = styleFingerprint.resolveFingerprintProfile('仙侠');
  assert.ok(resolved && resolved.bookCount >= 50, '仙侠题材应匹配至少 50 本原书');
  assert.ok(Number.isFinite(resolved.profile.sentenceLenCv) && resolved.profile.sentenceLenCv > 0.4, '句长突发度 CV 应真实可用');
  assert.ok(Number.isFinite(resolved.profile.paragraphLenCv) && resolved.profile.paragraphLenCv > 0.3, '段长参差度 CV 应真实可用');

  const block = styleFingerprint.buildDeaiStyleFingerprintBlock('仙侠');
  assert.match(block, /真实网文统计风格锚点/);
  assert.match(block, /纯统计基线、零原书段落拷贝/);
  assert.match(block, /句长突发度/);
  assert.match(block, /严禁靠造错别字/);
});

test('全库 1,279 本真实 ai-flavor-lexicon.json 已过滤正常高频词误伤', () => {
  const lexicon = aiFlavorDetector.loadAiFlavorLexicon();
  assert.ok(lexicon, 'ai-flavor-lexicon.json 应存在');
  assert.ok(lexicon.corpus && lexicon.corpus.bookCount >= 1279, '词表应基于全库至少 1279 本原书');
  assert.ok(lexicon.corpus.totalChars >= 80000000, '词表扫描总字数应达 8000 万以上');

  const blockTerms = new Set(lexicon.entries.filter(e => e.recommendation === 'block').map(e => e.term));
  for (const normalWord of ['还是', '一声', '一点', '一枚', '顺着', '停了']) {
    assert.equal(blockTerms.has(normalWord), false, `正常高频词「${normalWord}」不得误入 block 词表`);
  }
  assert.equal(blockTerms.has('空气仿佛凝固'), true, '真实低频 AI 套话应留在 block 词表');
});

test('strategy-knowledge-base 已清除 mock 假包并激活真实 1,279 本策略包', () => {
  const kbDir = path.join(DATA_DIR, 'strategy-knowledge-base');
  const mockDir = path.join(kbDir, 'packages', 'corpus_20261010_8327');
  assert.equal(fs.existsSync(mockDir), false, '历史临时目录 mock 假包必须已删除');

  const active = JSON.parse(fs.readFileSync(path.join(kbDir, 'active_package.json'), 'utf8'));
  assert.match(active.activeVersion, /^corpus_real_/);
  const pkgDir = path.join(kbDir, active.packageDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'manifest.json'), 'utf8'));
  assert.ok(manifest.booksTotal >= 1279, `策略包应基于真实 1279 本原书，实际 ${manifest.booksTotal}`);
  assert.equal(JSON.stringify(manifest).includes('molan-mock-corpus'), false, '策略包不得包含 mock 路径');
});

test('paragraph-samples.json 重建后零破碎匿名化占位符', () => {
  const samplesData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'paragraph-samples.json'), 'utf8'));
  let total = 0;
  let broken = 0;
  for (const bucket of samplesData.buckets || []) {
    for (const sample of bucket.samples || []) {
      total += 1;
      if (sample.anonymizedText && isBrokenAnonymizedText(sample.anonymizedText)) broken += 1;
    }
  }
  assert.ok(total >= 1000, `清洗后仍应保留足量真实样本，实际 ${total}`);
  assert.equal(broken, 0, `不得存在破碎匿名化占位符，实际 ${broken}`);
});

test('humanize-policy-service 在 styleOnly/includeLivingExemplars=false 下注入纯统计锚点且零原书段落', () => {
  const service = createHumanizePolicyService({
    buildHumanizeLexiconBlock: aiFlavorDetector.buildHumanizeLexiconBlock,
    UNIVERSAL_CORRECTION_MARKER: '<!-- molan-universal-correction-policy-v1 -->',
    UNIVERSAL_CORRECTION_POLICY_PROMPT: correctionPolicy.UNIVERSAL_CORRECTION_POLICY_PROMPT
  });
  const messages = service.buildHumanizePassMessages('林凡心里一紧，他知道自己不能再拖下去了。', {
    genre: '仙侠',
    includeLivingExemplars: false
  });
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /真实网文统计风格锚点/);
  assert.match(messages[0].content, /严禁低级机械降重破坏阅读体验/);
  assert.equal(messages[0].content.includes('同题材真人名作活人感参照'), false, '关闭原段注入时不得混入原书段落');
});
