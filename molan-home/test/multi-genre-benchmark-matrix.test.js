'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  CORE_BENCHMARK_GENRES,
  buildMultiGenreBenchmarkMatrix,
  generateMultiGenreReportMarkdown
} = require('../lib/multi-genre-benchmark-matrix');

test('Multi-Genre Benchmark Matrix：多题材大样本覆盖（每题材 >= 6 本）', async () => {
  // 测试运行 2 个核心题材，每题材测试 6 本书
  const testGenres = CORE_BENCHMARK_GENRES.slice(0, 2); // 玄幻与都市
  const matrix = await buildMultiGenreBenchmarkMatrix({
    corpusDir: path.resolve(__dirname, '../../资源库/小说原本'),
    booksPerGenre: 6,
    genres: testGenres
  });

  assert.equal(matrix.meta.totalGenres, 2);
  assert.equal(matrix.meta.totalBooksTested, 12, '2个题材必须各测满 6 本，共 12 本书');
  assert.ok(matrix.meta.totalChapterStageComparisons >= 36, '12本书每本3阶段应至少有36组对照');

  for (const gName of ['玄幻', '都市']) {
    const summary = matrix.genreSummaries[gName];
    assert.ok(summary);
    assert.equal(summary.booksCount, 6, `题材 ${gName} 必须有 6 部作品`);
    assert.ok(summary.avgDistDetailedToOriginal <= summary.avgDistCoarseToOriginal);
    assert.ok(summary.avgPromptSensitivityIndex > 0);
  }

  const markdown = generateMultiGenreReportMarkdown(matrix);
  assert.ok(markdown.includes('网络小说原本全题材三阶段双粒度对照评测全景白皮书'));
  assert.ok(markdown.includes('详细版距原著距离'));
  assert.ok(markdown.includes('提示词敏感度 (PSI)'));
});
