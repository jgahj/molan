import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error('SQLite migration tests require Node.js >=22.5.0 (node:sqlite).');
  process.exit(1);
}

const tests = ['generation-sqlite-store.test.js', 'generation-sqlite-commit.test.js', 'lab-jobs-migration.test.mjs', 'benchmark-commit-receipts.test.js']
  .map(name => fileURLToPath(new URL(`./test/${name}`, import.meta.url)));
const result = spawnSync(process.execPath, [
  '--no-warnings', '--test', '--test-reporter=spec', ...tests
], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
