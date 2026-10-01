'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareQualityVectors } = require('../lib/evolution/quality-vector-ab');
const { validatePlatformConfigPromotion, assertPlatformConfigPromotion } = require('../lib/evolution/platform-config-gate');
const { canonicalGlobalPrompts } = require('../lib/evolution/platform-config-gate');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPlatformModelConfigService } = require('../services/platform-model-config-service');

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
