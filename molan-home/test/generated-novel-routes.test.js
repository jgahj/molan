'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

test('HTTP API：/api/benchmark/generated/list 与 preprocess 端点可用性校验', async () => {
  const { __test } = require('../server');
  // 确保 server 模块正常加载无语法异常
  assert.ok(__test, 'server 模块应正常导出 __test');

  const preprocessor = require('../lib/generated-novel-preprocessor');
  const packages = preprocessor.scanGeneratedNovels();
  assert.ok(packages.length >= 1);

  const profile = preprocessor.generateGeneratedNovelProfile(packages[0]);
  assert.equal(profile.metadata.feature, 'generation_metadata_and_provenance');
  assert.equal(profile.genre.value.primaryGenre, '玄幻');
  assert.ok(profile.granularity_tree);
});
