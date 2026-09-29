import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationBaseline } from '../scripts/build-generation-baseline.mjs';

test('generation baseline pins code, schema, prompt, style, and UI hashes from the declared commit', async () => {
  const manifest = await buildGenerationBaseline({ ref: 'ac483e3', generatedAt: '2026-09-29T00:00:00.000Z' });
  assert.equal(manifest.sourceCommit, 'ac483e39359445d6fb6c2ba5d86410a7a6f6abae');
  assert.ok(manifest.files.code['server.js']);
  assert.ok(manifest.files.schema['db/migrations/0038_luna_worker_actual_cost.sql']);
  assert.ok(manifest.files.prompt['lib/style-system.js']);
  assert.ok(manifest.uiManifest.files['completion-editor.js']);
  assert.deepEqual(manifest.notPresentAtBaseline, ['pages/tokens.css']);
  assert.deepEqual(manifest.missing, []);
  assert.equal(manifest.protectedDataRead, false);
});
