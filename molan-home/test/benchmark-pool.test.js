'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGenreBenchmarkPool, compareToGenreBenchmarkPool } = require('../lib/quality/benchmark-pool');

function samples(genre = '玄幻修真') {
  return [1, 2, 3, 4].map((value, index) => ({
    sample_id: `ref-${index + 1}`,
    artifact_ref: `artifact-${index + 1}`,
    genre,
    metrics: { dialogueRatio: value, pacingDeviation: value * 2 }
  }));
}

test('genre benchmark pool computes metric-wise P25/P50/P75 and keeps metrics independent', () => {
  const pool = buildGenreBenchmarkPool({ genre: '玄幻修真', samples: samples() });
  assert.equal(pool.status, 'ready');
  assert.deepEqual(
    [pool.metrics.dialogueRatio.p25, pool.metrics.dialogueRatio.p50, pool.metrics.dialogueRatio.p75],
    [1.75, 2.5, 3.25]
  );
  assert.equal(pool.metrics.pacingDeviation.p50, 5);
  assert.equal(pool.composite_quality_score, undefined);
  assert.deepEqual(Object.keys(pool.samples[0]), ['sample_id', 'artifact_ref', 'genre', 'metrics']);
});

test('comparison excludes the subject itself and reports its distance from the same-genre median', () => {
  const pool = buildGenreBenchmarkPool({ genre: '玄幻修真', samples: samples(), minimumSampleSize: 3 });
  const result = compareToGenreBenchmarkPool({
    sample_id: 'ref-1', genre: '玄幻修真', metrics: { dialogueRatio: 0.1, pacingDeviation: 9 }
  }, pool);

  assert.equal(result.comparisons.dialogueRatio.sample_count, 3);
  assert.equal(result.comparisons.dialogueRatio.quartile_position, 'below_p25');
  assert.equal(result.comparisons.dialogueRatio.delta_from_p50, -2.9);
  assert.equal(result.composite_quality_score, null);
});

test('benchmark pools reject mixed genres, duplicate references, and undersized comparison metrics', () => {
  assert.throws(() => buildGenreBenchmarkPool({ genre: '玄幻修真', samples: [...samples(), { ...samples('都市')[0], sample_id: 'urban' }] }), /题材/);
  assert.throws(() => buildGenreBenchmarkPool({ genre: '玄幻修真', samples: [...samples(), samples()[0]] }), /重复/);

  const pool = buildGenreBenchmarkPool({ genre: '玄幻修真', samples: samples().slice(0, 2), minimumSampleSize: 3 });
  const result = compareToGenreBenchmarkPool({ genre: '玄幻修真', metrics: { dialogueRatio: 0.2 } }, pool);
  assert.equal(result.comparisons.dialogueRatio.status, 'insufficient_sample');
  assert.throws(() => compareToGenreBenchmarkPool({ genre: '都市' }, pool), /题材/);
});
