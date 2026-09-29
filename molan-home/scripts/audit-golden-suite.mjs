import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildGoldenSuite, validateGoldenSuite } = require('../lib/evolution/golden-suite.js');

const suite = buildGoldenSuite();
const result = validateGoldenSuite(suite);
process.stdout.write(`GOLDEN INPUT SUITE ${result.valid ? 'PASS' : 'FAIL'} tasks=${result.taskCount}\n`);
for (const [genre, count] of Object.entries(result.genreCounts || {})) {
  process.stdout.write(`${genre} ${count}\n`);
}
for (const failure of result.failures) process.stderr.write(`FAIL ${failure}\n`);
if (suite.fixtureStatus !== 'test_fixture' || suite.dataStatus !== 'inputs_only') {
  process.stderr.write('FAIL fixture_status: model output or evaluation labels must not be fabricated\n');
  process.exitCode = 1;
}
if (!result.valid) process.exitCode = 1;
