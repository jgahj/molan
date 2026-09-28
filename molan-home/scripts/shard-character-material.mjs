// 将 115MB 的整体人物素材索引按题材桶切分成多个分片，并生成一个轻量主索引。
// 目的：EC2 小内存实例无法一次 JSON.parse+驻留 115MB；分片后单分片仅数十~数百 KB，
//       服务端可按请求题材只加载命中分片，彻底避免 OOM 断连。本脚本幂等、可逆。
//
// 用法：
//   node scripts/shard-character-material.mjs [--source lib/character-material/index.json]
//                                            [--outDir lib/character-material/sharded]
//
// 产物：
//   outDir/index.json        元数据（分片清单 + 每片条数/字节 + corpus 版本）
//   outDir/buckets/<bucket>.json   每个题材桶一个分片，含 rules + 该桶 samples

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT), '..');
const DEFAULT_SOURCE = path.join(REPO_ROOT, 'lib', 'character-material', 'index.json');
const DEFAULT_OUT = path.join(REPO_ROOT, 'lib', 'character-material', 'sharded');

/** 解析 --key=value 或 --key 参数，返回配置对象。 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const value = (name, fb) => {
    const hit = args.find(a => a.startsWith(name + '='));
    return hit ? hit.slice(name.length + 1) : fb;
  };
  return {
    source: value('--source', DEFAULT_SOURCE),
    outDir: value('--outDir', DEFAULT_OUT),
    dry: args.includes('--dry')
  };
}

/** 依据样本的题材桶切分 samples：无桶的归到"其他"。 */
function bucketSamples(samples) {
  const buckets = new Map();
  for (const s of Array.isArray(samples) ? samples : []) {
    const bucket = String(s && (s.genreBucket || s.primaryGenre || '其他')).trim() || '其他';
    const list = buckets.get(bucket) || [];
    list.push(s);
    buckets.set(bucket, list);
  }
  return buckets;
}

/** 清洗某个字段到安全范围（暂不做默认值清理，原样保留）。 */
function shallowSample({ id, archetype, dimension, text, genre, rawGenres, primaryGenre, genreBucket, scene, scenes, relationship, emotionalState, intent, subtext, microPatterns, signals, humanTextureSignals, forbiddenTerms, residualTerms, score, audience, platform }) {
  return {
    id, archetype, dimension, text,
    genre, rawGenres, primaryGenre, genreBucket,
    scene, scenes, relationship, emotionalState,
    intent, subtext, microPatterns, signals,
    humanTextureSignals, forbiddenTerms, residualTerms,
    score, audience, platform
  };
}

/** 对每个分片写入 {rules, samples}，返回分片清单条目。 */
function writeBucketFile(outDir, bucket, rules, samples) {
  const fileName = bucket.replace(/[\\/:*?"<>|# ]+/g, '_').replace(/^_+|_+$/g, '') || '其他';
  const filePath = path.join(outDir, 'buckets', fileName + '.json');
  const payload = JSON.stringify({ bucket, rules, samples: samples.map(shallowSample) }, null, 0);
  fs.writeFileSync(filePath, payload, 'utf8');
  const bytes = Buffer.byteLength(payload);
  return { bucket, file: 'buckets/' + fileName + '.json', sampleCount: samples.length, ruleCount: rules.length, bytes, fileName };
}

/** 主流程：读 source → 切分 samples → 写分片与元索引 → 打印报告。 */
function run(options) {
  const sourcePath = options.source || DEFAULT_SOURCE;
  if (!fs.existsSync(sourcePath)) throw new Error('源索引不存在: ' + sourcePath);
  const index = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const general = index && index.general || {};
  const rules = Array.isArray(general.rules) ? general.rules : [];
  const byBucket = bucketSamples(general.samples);
  const bucketNames = [...byBucket.keys()].sort();

  if (options.dry) {
    console.log('[dry] 桶分布:');
    for (const b of bucketNames) console.log(`  - ${b}: ${byBucket.get(b).length} 条`);
    console.log('  预期分片数:', bucketNames.length, '· 总样本:', general.samples.length);
    return;
  }

  // 每个分片都带通用 rules（规则是跨题材共享的），题材桶只带本桶 samples。
  fs.mkdirSync(path.join(options.outDir, 'buckets'), { recursive: true });
  const shards = bucketNames.map(bucket =>
    writeBucketFile(options.outDir, bucket, rules, byBucket.get(bucket)));

  const meta = {
    schemaVersion: 'character-material-sharded-v1',
    version: index.version || '',
    published: index.published === true,
    shardCount: shards.length,
    totalSamples: shards.reduce((n, s) => n + s.sampleCount, 0),
    totalShardBytes: shards.reduce((n, s) => n + s.bytes, 0),
    created: new Date().toISOString(),
    buckets: shards
  };
  fs.mkdirSync(path.join(options.outDir, 'buckets'), { recursive: true });
  fs.writeFileSync(path.join(options.outDir, 'index.json'), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

const cfg = parseArgs(process.argv);
if (cfg.dry) {
  run({ ...cfg, dry: true });
} else {
  const meta = run(cfg);
  console.log(JSON.stringify({ ok: true, shardCount: meta.shardCount, totalSamples: meta.totalSamples, totalShardMB: (meta.totalShardBytes / 1024 / 1024).toFixed(1), outDir: DEFAULT_OUT }, null, 2));
}