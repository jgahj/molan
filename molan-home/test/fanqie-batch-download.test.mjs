import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  normalizeWork,
  readOptions,
  usageText,
  validateWorkList
} from '../scripts/fanqie-batch-download.mjs';

const resourceRoot = path.resolve(import.meta.dirname, '..', '..', '资源库');
const quotaConfigFile = path.join(resourceRoot, 'quota-config.json');
const quotaConfig = fs.existsSync(quotaConfigFile) ? JSON.parse(fs.readFileSync(quotaConfigFile, 'utf8')) : null;

test('番茄批处理默认启用完整配额并强制两秒间隔', () => {
  const options = readOptions([]);
  assert.equal(options.delayMs, 2000);
  assert.equal(options.requireQuota, true);
  assert.throws(() => readOptions(['--delay', '1.9']), /至少 2 秒/);
  assert.equal(readOptions(['--allow-incomplete']).requireQuota, false);
});

test('番茄作品清单拒绝没有授权、完结、全文和榜单证据的记录', (t) => {
  if (!quotaConfig) { t.skip('缺少配额配置文件，跳过测试'); return; }
  const normalized = normalizeWork({
    workId: '123',
    title: '测试作品',
    author: '测试作者',
    genres: ['玄幻'],
    primaryGenre: '玄幻',
    completionStatus: '已完结',
    contentScope: 'full_work'
  }, 0, quotaConfig);
  assert.equal(normalized.work, null);
  assert.ok(normalized.issues.some(issue => issue.includes('授权')));
  assert.ok(normalized.issues.some(issue => issue.includes('证据')));
});

test('空清单的配额报告明确列出 18 类缺口和 360 本总目标', (t) => {
  if (!quotaConfig) { t.skip('缺少配额配置文件，跳过测试'); return; }
  const result = validateWorkList([], quotaConfig);
  assert.equal(result.works.length, 0);
  assert.equal(result.quota.targetUniqueWorks, 360);
  assert.equal(Object.keys(result.quota.missingByGenre).length, 18);
  assert.equal(result.quota.complete, false);
});

test('帮助文本明确要求真实授权清单而非自动生成正文', () => {
  assert.match(usageText(), /授权证据/);
  assert.match(usageText(), /ranking/);
});
