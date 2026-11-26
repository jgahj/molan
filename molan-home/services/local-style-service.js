'use strict';

const { debugWarn } = require('./json-persistence-service');

const LOCAL_BASELINE_FIELDS = [
  'sentenceLenMean', 'sentenceLenStd', 'sentenceLenCv',
  'paragraphLenMean', 'paragraphLenStd', 'paragraphLenCv',
  'shortSentenceRatio', 'longSentenceRatio',
  'dialogueRatio', 'dialogueTurnMean', 'commaPeriodRatio',
  'ttr', 'similePerKilo',
  'directPsychPerKilo', 'aiGluePerKilo', 'modalParticlePerKilo'
];

function createLocalStyleService({ fs, path, assetDirectory, json }) {
  const STAT_CHECK_INTERVAL_MS = 5000;
  const localStyleCache = {
    samples: { value: null, mtimeMs: -1, checkedAt: 0 },
    fingerprints: { value: null, mtimeMs: -1, checkedAt: 0 }
  };

  function loadJsonByMtime(slot, filePath, validator) {
    const now = Date.now();
    if (slot.value !== null && now - slot.checkedAt < STAT_CHECK_INTERVAL_MS) {
      return slot.value;
    }
    slot.checkedAt = now;
    try {
      const stat = typeof fs.statSync === 'function' ? fs.statSync(filePath) : null;
      const mtimeMs = stat ? Number(stat.mtimeMs) : -1;
      if (slot.value !== null && mtimeMs >= 0 && mtimeMs === slot.mtimeMs) {
        return slot.value;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      slot.value = validator(parsed) ? parsed : null;
      slot.mtimeMs = mtimeMs;
    } catch (err) {
      debugWarn('local-style', 'failed to load ' + path.basename(filePath), err);
      slot.value = null;
      slot.mtimeMs = -1;
    }
    return slot.value;
  }

  function loadLocalStyleData(kind) {
    if (kind === 'samples') {
      return loadJsonByMtime(
        localStyleCache.samples,
        path.join(assetDirectory, 'data', 'paragraph-samples.json'),
        parsed => Boolean(parsed && Array.isArray(parsed.buckets))
      );
    }
    return loadJsonByMtime(
      localStyleCache.fingerprints,
      path.join(assetDirectory, 'data', 'style-fingerprints.json'),
      parsed => Boolean(parsed && Array.isArray(parsed.books))
    );
  }

  function handleLocalStyleSamples(req, res, params) {
    // 本地试用：浏览器会话在云端签发，本地不做鉴权（只读数据，来自用户自己的语料库）
    const data = loadLocalStyleData('samples');
    if (!data) return json(res, 200, { ok: true, samples: [], buckets: [] });
    const bucketParam = String(params.get('bucket') || '').trim();
    const sceneType = String(params.get('sceneType') || '').trim();
    const dimension = String(params.get('dimension') || '').trim();
    const limit = Math.min(6, Math.max(1, Number(params.get('limit')) || 3));
    const buckets = data.buckets || [];
    const matchedBucket = bucketParam
      ? buckets.find(b => b.bucket === bucketParam) || buckets.find(b => bucketParam.includes(b.bucket) || b.bucket.includes(bucketParam))
      : null;
    const pool = [];
    (matchedBucket ? [matchedBucket] : buckets.slice(0, 6)).forEach(b => {
      (b.samples || []).forEach(sample => pool.push({ ...sample, bucket: b.bucket }));
    });
    const filtered = pool.filter(sample => {
      if (sceneType && String(sample.sceneType || '') !== sceneType) return false;
      if (dimension && String(sample.dimension || '') !== dimension) return false;
      return true;
    });
    // 保底：过滤后不足时放宽场景类型
    const finalPool = filtered.length >= limit ? filtered : (sceneType || dimension ? pool : filtered);
    // 均匀抽取，保证多次请求拿到不同样本（按 limit 分段轮转）
    const offset = Math.floor(Math.random() * Math.max(1, finalPool.length - limit));
    const picked = finalPool.slice(offset, offset + limit);
    while (picked.length < limit && finalPool.length) picked.push(finalPool[(offset + picked.length) % finalPool.length]);
    json(res, 200, {
      ok: true,
      bucket: matchedBucket ? matchedBucket.bucket : '',
      total: finalPool.length,
      samples: picked.map(sample => ({
        id: sample.id, bucket: sample.bucket, dimension: sample.dimension, sceneType: sample.sceneType || '日常',
        dialogueRatio: sample.dialogueRatio, flavorScore: sample.flavorScore ?? null,
        sourceTitle: sample.anonymizedText ? '匿名样本' : sample.sourceTitle,
        anonymized: Boolean(sample.anonymizedText),
        text: String(sample.anonymizedText || sample.text || '').slice(0, 600)
      }))
    });
  }

  /**
   * 范文对标管线路由：
   * GET  /api/benchmark/baseline?genre=  题材基线与节奏目标块
   * POST /api/benchmark/audit             证据审稿（quote 逐字回查 + 确定性硬约束 + 题材纠错）
   * POST /api/benchmark/revise-loop       审稿→局部修订→复核闭环（≤2 轮，未过保留 needs_review）
   */

  function handleLocalStyleBaseline(req, res, params) {
    // 本地试用：同上，不鉴权
    const data = loadLocalStyleData('fingerprints');
    if (!data) return json(res, 200, { ok: true, baseline: null, bucket: '', matchedBooks: 0 });
    const bucketParam = String(params.get('bucket') || '').trim();
    const books = (data.books || []).filter(book => {
      if (!bucketParam) return true;
      const genre = String(book.primaryGenre || '') + ' ' + String(book.bucket || '');
      return genre.includes(bucketParam) || bucketParam.includes(String(book.bucket || ''));
    });
    const fields = LOCAL_BASELINE_FIELDS.filter(f => books.some(book => book.fingerprint && Number.isFinite(Number(book.fingerprint[f]))));
    const baseline = {};
    fields.forEach(field => {
      const values = books.map(book => Number(book.fingerprint[field])).filter(Number.isFinite);
      if (!values.length) return;
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const stdDev = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length);
      baseline[field] = { mean: Number(mean.toFixed(4)), stdDev: Number(stdDev.toFixed(4)), sampleBooks: values.length };
    });
    json(res, 200, { ok: true, bucket: bucketParam, matchedBooks: books.length, baseline, availableBuckets: [...new Set((data.books || []).map(book => String(book.bucket || '')).filter(Boolean))].slice(0, 60) });
  }

  return { handleLocalStyleSamples, handleLocalStyleBaseline };
}
module.exports = { createLocalStyleService, LOCAL_BASELINE_FIELDS };
