'use strict';

const { createHash } = require('node:crypto');

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new TypeError('Benchmark 数据必须是有限、可序列化的 JSON 值');
    }
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function hash(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function finiteMetricMap(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input)
    .filter(([key, value]) => /^[a-zA-Z][\w.-]{0,79}$/.test(key) && typeof value === 'number' && Number.isFinite(value)));
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower));
}

function normalizeSample(sample, genre) {
  const sampleIdValue = sample && (sample.sample_id || sample.id);
  const genreValue = sample && sample.genre;
  const artifactRefValue = sample && (sample.artifact_ref || sample.artifactRef || sample.evidence_ref);
  const sampleId = typeof sampleIdValue === 'string' ? sampleIdValue.trim() : '';
  const sampleGenre = typeof genreValue === 'string' ? genreValue.trim() : '';
  const artifactRef = typeof artifactRefValue === 'string' ? artifactRefValue.trim() : '';
  if (!sampleId || !artifactRef || sampleGenre !== genre) {
    throw new TypeError('每个 Benchmark 样本必须有唯一 ID、证据引用，并与目标题材完全一致');
  }
  return {
    sample_id: sampleId,
    artifact_ref: artifactRef,
    genre: sampleGenre,
    metrics: finiteMetricMap(sample.metrics)
  };
}

function summarizeMetric(samples, metric, minimumSampleSize) {
  const observations = samples.filter(sample => Object.hasOwn(sample.metrics, metric));
  const values = observations.map(sample => sample.metrics[metric]);
  const enough = values.length >= minimumSampleSize;
  return {
    sample_count: values.length,
    status: enough ? 'measured' : 'insufficient_sample',
    p25: enough ? percentile(values, 0.25) : null,
    p50: enough ? percentile(values, 0.5) : null,
    p75: enough ? percentile(values, 0.75) : null,
    sample_refs: observations.map(sample => sample.artifact_ref)
  };
}

/** Build a metric-wise reference pool. It deliberately returns no composite quality score. */
function buildGenreBenchmarkPool({ genre, samples = [], minimumSampleSize = 4, poolId = null } = {}) {
  const normalizedGenre = typeof genre === 'string' ? genre.trim() : '';
  if (!normalizedGenre) throw new TypeError('必须指定精确题材，Benchmark 池不跨题材混样');
  if (!Array.isArray(samples)) throw new TypeError('samples 必须是数组');
  if (!Number.isInteger(minimumSampleSize) || minimumSampleSize < 2) {
    throw new TypeError('minimumSampleSize 必须至少为 2');
  }

  const normalizedSamples = samples.map(sample => normalizeSample(sample, normalizedGenre));
  const ids = normalizedSamples.map(sample => sample.sample_id);
  if (new Set(ids).size !== ids.length) throw new TypeError('Benchmark 样本 ID 不可重复');
  const metrics = [...new Set(normalizedSamples.flatMap(sample => Object.keys(sample.metrics)))].sort();
  const summary = Object.fromEntries(metrics.map(metric => [metric, summarizeMetric(normalizedSamples, metric, minimumSampleSize)]));
  const payload = {
    schemaVersion: 'genre-benchmark-pool-v1',
    pool_id: poolId === null ? null : typeof poolId === 'string' && poolId.trim() ? poolId.trim() : null,
    genre: normalizedGenre,
    minimum_sample_size: minimumSampleSize,
    sample_count: normalizedSamples.length,
    status: normalizedSamples.length >= minimumSampleSize ? 'ready' : 'insufficient_sample',
    metrics: summary,
    samples: normalizedSamples
  };
  return { ...payload, pool_hash: hash(payload), quality_is_not_implied_by_similarity: true };
}

/** Compare only explicit scalar metrics against one exact-genre pool. */
function compareToGenreBenchmarkPool(subject = {}, pool = {}) {
  if (pool.schemaVersion !== 'genre-benchmark-pool-v1' || !Array.isArray(pool.samples)) {
    throw new TypeError('无效的题材 Benchmark 池');
  }
  const subjectGenre = typeof subject.genre === 'string' ? subject.genre.trim() : '';
  if (!subjectGenre || subjectGenre !== pool.genre) throw new TypeError('待测样本与 Benchmark 池题材不一致');
  const subjectMetrics = finiteMetricMap(subject.metrics);
  const subjectIdValue = subject.sample_id || subject.id;
  const subjectId = typeof subjectIdValue === 'string' ? subjectIdValue.trim() : '';
  const referenceSamples = pool.samples.filter(sample => !subjectId || sample.sample_id !== subjectId);
  const minimumSampleSize = pool.minimum_sample_size;
  const comparisons = {};

  for (const [metric, value] of Object.entries(subjectMetrics)) {
    const baseline = summarizeMetric(referenceSamples, metric, minimumSampleSize);
    if (baseline.status !== 'measured') {
      comparisons[metric] = { value, status: 'insufficient_sample', ...baseline };
      continue;
    }
    comparisons[metric] = {
      value,
      status: 'measured',
      sample_count: baseline.sample_count,
      p25: baseline.p25,
      p50: baseline.p50,
      p75: baseline.p75,
      delta_from_p50: Number((value - baseline.p50).toFixed(6)),
      quartile_position: value < baseline.p25 ? 'below_p25'
        : value > baseline.p75 ? 'above_p75' : 'within_iqr',
      sample_refs: baseline.sample_refs
    };
  }

  return {
    schemaVersion: 'genre-benchmark-comparison-v1',
    subject_id: subjectId || null,
    genre: subjectGenre,
    pool_id: pool.pool_id || null,
    pool_hash: pool.pool_hash || null,
    comparisons,
    composite_quality_score: null
  };
}

module.exports = {
  buildGenreBenchmarkPool,
  compareToGenreBenchmarkPool,
  percentile
};
