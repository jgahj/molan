'use strict';

function createLocalStyleService({ fs, path, assetDirectory, json }) {
  let localStyleCache = { samples: null, samplesAt: 0, fingerprints: null, fingerprintsAt: 0 };
  function loadLocalStyleData(kind) {
    const now = Date.now();
    const cacheMs = 30000;
    if (kind === 'samples') {
      if (!localStyleCache.samples || now - localStyleCache.samplesAt > cacheMs) {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(assetDirectory, 'data', 'paragraph-samples.json'), 'utf8'));
          localStyleCache.samples = parsed && Array.isArray(parsed.buckets) ? parsed : null;
        } catch (_) { localStyleCache.samples = null; }
        localStyleCache.samplesAt = now;
      }
      return localStyleCache.samples;
    }
    if (!localStyleCache.fingerprints || now - localStyleCache.fingerprintsAt > cacheMs) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(assetDirectory, 'data', 'style-fingerprints.json'), 'utf8'));
        localStyleCache.fingerprints = parsed && Array.isArray(parsed.books) ? parsed : null;
      } catch (_) { localStyleCache.fingerprints = null; }
      localStyleCache.fingerprintsAt = now;
    }
    return localStyleCache.fingerprints;
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
    const fields = ['sentenceLenMean', 'sentenceLenStd', 'paragraphLenMean', 'paragraphLenStd', 'dialogueRatio', 'dialogueTurnMean', 'commaPeriodRatio', 'ttr', 'similePerKilo'].filter(f => books.some(book => book.fingerprint && Number.isFinite(Number(book.fingerprint[f]))));
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
module.exports = { createLocalStyleService };

