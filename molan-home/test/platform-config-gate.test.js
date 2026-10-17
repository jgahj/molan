'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compareQualityVectors } = require('../lib/evolution/quality-vector-ab');
const { validatePlatformConfigPromotion, assertPlatformConfigPromotion } = require('../lib/evolution/platform-config-gate');
const { canonicalGlobalPrompts } = require('../lib/evolution/platform-config-gate');
const os = require('node:os');
const { createPlatformModelConfigService } = require('../services/platform-model-config-service');
const { createSkillService } = require('../services/skill-service');

// PG-only 收敛（2026-10-17，HANDOVER 阶段二十九）：skill-service 的本地 global prompt
// 写入路径（saveGlobalSkills/persistGlobalSkills，写 JSON 文件）已整体移除；quality gate
// （assertPlatformConfigPromotion）随写入路径迁入 admin-service 的
// handleAdminSkillCreate/Patch/Delete，经 postgresRepository.runtimeReplaceGlobalSkills 落库。
// 本用例由"守住本地写入 gate"反转为"守住移除事实 + gate 迁移事实"，防回潮。
test('PG-only 收敛：skill-service 不再暴露本地 global prompt 写入，quality gate 迁至 admin-service', () => {
  const service = createSkillService({ dbReady: () => false, writeJsonFile: () => { throw new Error('本地写入不得回潮'); } });
  assert.equal(service.saveGlobalSkills, undefined, 'saveGlobalSkills 不得回潮');
  assert.equal(service.persistGlobalSkills, undefined, 'persistGlobalSkills 不得回潮');
  const adminSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'admin-service.js'), 'utf8');
  const gateCalls = adminSource.match(/assertPlatformConfigPromotion\(\{ kind: 'global-prompts'/g) || [];
  assert.ok(gateCalls.length >= 3, `admin-service 应至少在 create/patch/delete 三处守护 global-prompts gate，实际 ${gateCalls.length} 处`);
  assert.match(adminSource, /runtimeReplaceGlobalSkills/, 'global prompt 写入必须走 PG 仓储');
});

test('direct default model writes cannot bypass quality evidence or mutate disk and runtime', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-model-policy-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'config.json');
  const original = JSON.stringify({ modelPolicy: { defaultModel: 'baseline' }, platformModels: [] });
  fs.writeFileSync(filename, original);
  let policy = { defaultModel: 'baseline' };
  const service = createPlatformModelConfigService({ fs, path, PLATFORM_CONFIG_FILE: filename,
    normalizeConfiguredModel: value => value, findPlatformModel: () => null,
    normalizeModelCreditRate: value => value, getModelPolicy: () => policy,
    setModelPolicy: value => { policy = value; } });
  assert.throws(() => service.saveModelPolicy('candidate'), error => error.code === 'QUALITY_PROMOTION_BLOCKED');
  assert.throws(() => service.saveModelPolicy('candidate', { report: { status: 'PROMOTION_READY' } }),
    error => error.code === 'QUALITY_PROMOTION_BLOCKED');
  assert.equal(fs.readFileSync(filename, 'utf8'), original);
  assert.deepEqual(policy, { defaultModel: 'baseline' });
  assert.equal(service.writePlatformConfig, undefined);
});

test('global prompt canonicalization ignores only timestamps and downloads without mutation', () => {
  const runtime = { id: 'one', instruction: 'draft', files: ['SKILL.md'], runtimeFiles: { 'SKILL.md': 'draft' }, targets: ['writer'], enabled: true };
  const source = [{ ...runtime, createdAt: 1, updatedAt: 2, downloads: 3 }];
  assert.deepEqual(canonicalGlobalPrompts(source), [runtime]);
  assert.equal(source[0].updatedAt, 2);
  for (const field of ['id', 'instruction', 'files', 'targets', 'enabled']) {
    assert.notDeepEqual(canonicalGlobalPrompts([{ ...source[0], [field]: null }]), [runtime]);
  }
});

test('platform config writes require complete source evidence', () => {
  for (const kind of ['default-model', 'global-prompts', 'genre-profile', 'style-profile', 'pipeline']) {
    const options = { kind, proposed: kind === 'default-model' ? 'test-model' : {} };
    assert.equal(validatePlatformConfigPromotion(options).status, 'BLOCKED');
    assert.throws(() => assertPlatformConfigPromotion(options), error => error.code === 'QUALITY_PROMOTION_BLOCKED' && error.statusCode === 409);
  }
});

test('an invented READY report cannot bypass recomputation and approved Golden provenance', () => {
  const input = {};
  const report = { ...compareQualityVectors(input), status: 'PROMOTION_READY', promotionEligible: true };
  const result = validatePlatformConfigPromotion({ kind: 'default-model', proposed: 'test-model', evidence: { report, input, artifactRoot: __dirname, target: {} } });
  assert.equal(result.accepted, false);
  assert.ok(result.blockingReasons.includes('platform_source_report_mismatch'));
});
