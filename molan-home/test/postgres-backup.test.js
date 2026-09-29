'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildDumpArgs,
  buildRestoreArgs,
  createPostgresBackup,
  pgToolEnvironment,
  readBackupManifest,
  restorePostgresBackupDrill
} = require('../lib/postgres-backup');

test('pg tools receive connection credentials through environment, not arguments', () => {
  const config = { connectionString: 'postgres://writer:secret@db.example:5544/molan?sslmode=require' };
  const environment = pgToolEnvironment(config, {});
  const args = [...buildDumpArgs('backup.dump'), ...buildRestoreArgs('molan_restore_drill_1', 'backup.dump')];
  assert.equal(environment.PGHOST, 'db.example');
  assert.equal(environment.PGPORT, '5544');
  assert.equal(environment.PGUSER, 'writer');
  assert.equal(environment.PGDATABASE, 'molan');
  assert.equal(environment.PGPASSWORD, 'secret');
  assert.equal(environment.PGSSLMODE, 'require');
  assert.equal(args.some(value => String(value).includes('secret')), false);
});

test('backup writes an atomic archive and a verified SHA-256 manifest', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-backup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const result = await createPostgresBackup({
    config: { host: 'localhost', database: 'molan_test', user: 'test' },
    backupDirectory: directory,
    kind: 'predeploy',
    now: new Date('2026-09-29T10:00:00Z'),
    runTool: async (command, args) => {
      calls.push({ command, args });
      if (command === 'pg_dump') await fs.writeFile(args[args.indexOf('--file') + 1], 'test archive');
    },
    environment: {}
  });
  const verified = await readBackupManifest(result.outputPath);
  assert.equal(verified.manifest.sha256, result.manifest.sha256);
  assert.equal(verified.manifest.kind, 'predeploy');
  assert.deepEqual(calls.map(call => call.command), ['pg_dump', 'pg_restore']);
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.partial')), false);
});

test('backup refuses a checkout path before creating it', async () => {
  const checkoutPath = path.join(__dirname, '..', `.backup-rejected-${process.pid}-${Date.now()}`);
  await assert.rejects(createPostgresBackup({
    config: { host: 'localhost', database: 'molan_test' },
    backupDirectory: checkoutPath,
    runTool: async () => assert.fail('pg tools must not run for an unsafe path')
  }), /checkout 之外/);
  await assert.rejects(fs.stat(checkoutPath), { code: 'ENOENT' });
});

test('restore drill only targets isolated databases and verifies the backup first', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-restore-drill-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const backup = await createPostgresBackup({
    config: { host: 'localhost', database: 'molan_source', user: 'test' },
    backupDirectory: directory,
    runTool: async (command, args) => {
      if (command === 'pg_dump') await fs.writeFile(args[args.indexOf('--file') + 1], 'test archive');
    },
    environment: {}
  });
  let calls = 0;
  const runTool = async () => { calls += 1; };
  await assert.rejects(restorePostgresBackupDrill({
    dumpPath: backup.outputPath,
    targetConfig: { host: 'localhost', database: 'molan', user: 'test' },
    runTool
  }), /molan_restore_drill_/);
  assert.equal(calls, 0);
  const restored = await restorePostgresBackupDrill({
    dumpPath: backup.outputPath,
    targetConfig: { host: 'localhost', database: 'molan_restore_drill_20260929', user: 'test' },
    runTool,
    verifyDatabase: async () => { calls += 1; }
  });
  assert.equal(restored.ok, true);
  assert.equal(calls, 2);
});
