// 扩容构建脚本：在 build-paragraph-samples.mjs 基础上加
// 1) CLI 扩量（--books-per-bucket / --groups-per-book）
// 2) AI 味质量闸（lib/ai-flavor-detector，分数超过阈值丢弃）
// 3) 场景类型标注（sceneType：对峙/打脸/危机/修炼/情感/日常）
// 4) 跨桶去重（同一段文本只保留一次）
// 用法：node scripts/build-paragraph-samples-pro.mjs --books-per-bucket 10 --groups-per-book 10
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import flavorDetector from '../lib/ai-flavor-detector.js';
import { buildParagraphSamples } from './build-paragraph-samples.mjs';

const SCRIPT_PATH = path.resolve(fileURLToPath(import.meta.url));

const SCENE_TYPE_RULES = [
  { type: '打脸', pattern: /打脸|震惊|哗然|倒吸|不敢相信|目瞪口呆|鸦雀无声/g, hits: 2 },
  { type: '对峙', pattern: /冷笑|讽刺|嘲讽|不屑|质问|怒|呵斥|针锋相对|寸步不让/g, hits: 2 },
  { type: '危机', pattern: /危险|爆炸|攻来|血|杀|袭|崩塌|毒|逃生|命悬/g, hits: 3 },
  { type: '修炼', pattern: /修炼|灵气|真气|吐纳|经脉|突破|境界|功法|丹药|炼化/g, hits: 2 },
  { type: '情感', pattern: /温柔|泪水|思念|心动|愧疚|牵挂|拥抱|鼻尖一酸/g, hits: 2 }
];

/** 规则启发式场景类型标注：命中优先级从上到下，无命中归入日常。 */
function classifySceneType(text, dialogueRatio) {
  for (const rule of SCENE_TYPE_RULES) {
    const hits = (text.match(rule.pattern) || []).length;
    if (hits >= rule.hits) return rule.type;
  }
  if (dialogueRatio > 0.45) return '对峙';
  return '日常';
}

const args = process.argv.slice(2);
const readOption = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? Number(args[index + 1]) || fallback : fallback;
};
const booksPerBucket = readOption('--books-per-bucket', 10);
const groupsPerBook = readOption('--groups-per-book', 10);
const maxFlavorScore = readOption('--max-flavor-score', 55);

console.log(`[pro] 参数：books-per-bucket=${booksPerBucket} groups-per-book=${groupsPerBook} max-flavor-score=${maxFlavorScore}`);

// 规模通过 rules 参数直通原脚本（已参数化）
const result = buildParagraphSamples({ rules: { booksPerBucket, groupsPerBook } });

if (result.status !== 'ready' && result.status !== 'ok') {
  console.error(`[pro] 构建失败：${JSON.stringify(result)}`);
  process.exit(2);
}

const outputPath = result.outputPath;
const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
let total = 0;
let gated = 0;
const seenTexts = new Set();
const buckets = [];
Object.values(payload.buckets).forEach((bucket) => {
  const kept = [];
  (bucket.samples || []).forEach(sample => {
    total += 1;
    if (/^小说名[:：]/.test(sample.text || '') || /^内容简介[:：]/m.test((sample.text || '').slice(0, 120))) { gated += 1; return; }
    const textKey = (sample.text || '').slice(0, 80);
    if (seenTexts.has(textKey)) return;
    const flavor = flavorDetector.computeAiFlavorScore(sample.text || '');
    const score = Number(flavor && flavor.score) || 0;
    if (score > maxFlavorScore) { gated += 1; return; }
    seenTexts.add(textKey);
    kept.push({ ...sample, flavorScore: score, sceneType: classifySceneType(sample.text || '', Number(sample.dialogueRatio) || 0) });
  });
  if (kept.length) buckets.push({ bucket: bucket.bucket, sampleCount: kept.length, samples: kept });
});
const enriched = {
  ...payload,
  schemaVersion: 'paragraph-samples-2',
  generatedAt: Date.now(),
  proOptions: { booksPerBucket, groupsPerBook, maxFlavorScore },
  totalSamples: Object.values(buckets).reduce((sum, b) => sum + b.sampleCount, 0),
  sceneTypes: {},
  buckets
};
Object.values(buckets).forEach(b => (b.samples || []).forEach(s => { enriched.sceneTypes[s.sceneType] = (enriched.sceneTypes[s.sceneType] || 0) + 1; }));
fs.writeFileSync(outputPath, JSON.stringify(enriched, null, 2));
console.log(`[pro] 原始 ${total} 段 → AI 味闸过滤 ${gated} 段 → 保留 ${enriched.totalSamples} 段`);
console.log(`[pro] 场景类型分布：${JSON.stringify(enriched.sceneTypes)}`);
console.log(`[pro] 已写回 ${outputPath}`);
