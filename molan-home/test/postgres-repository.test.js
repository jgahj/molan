const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  internalUuid,
  readConfig,
  createPostgresRepository
} = require('../lib/postgres-repository');

test('PostgreSQL内部ID映射稳定且符合UUID格式', () => {
  const first = internalUuid('n_stable_project');
  const second = internalUuid('n_stable_project');
  const other = internalUuid('n_other_project');
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(internalUuid(first), first);
});

test('PostgreSQL必须显式启用，连接密码可从项目外文件读取', () => {
  assert.equal(readConfig({}).enabled, false);
  const temporaryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pg-config-')), 'password.txt');
  fs.writeFileSync(temporaryPath, 'local-only-secret\n', 'utf8');
  const configuration = readConfig({
    MOLAN_PG_ENABLED: '1',
    MOLAN_PG_HOST: '127.0.0.1',
    MOLAN_PG_PORT: '55432',
    MOLAN_PG_DATABASE: 'molan_test',
    MOLAN_PG_USER: 'novel_runtime',
    MOLAN_PG_PASSWORD_FILE: temporaryPath
  });
  try {
    assert.equal(configuration.enabled, true);
    assert.equal(configuration.config.password, 'local-only-secret');
  } finally {
    fs.rmSync(path.dirname(temporaryPath), { recursive: true, force: true });
  }
});

test('未启用PostgreSQL时仓储不会创建连接池', async () => {
  const repository = createPostgresRepository({ env: {} });
  assert.equal(repository.enabled, false);
  assert.deepEqual(await repository.health(), { enabled: false, available: false });
  await repository.close();
});

test('普通仓储与worker事务使用隔离角色并在归还连接前重置角色', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(String(sql));
      if (String(sql).includes('luna.read_job_input')) return { rows: [{ payload: { bookId: 'book-a' } }] };
      return { rows: [] };
    },
    release() {}
  };
  class FakePool {
    constructor() {}
    async connect() { return client; }
    async end() {}
  }
  const repository = createPostgresRepository({
    env: {
      MOLAN_PG_ENABLED: '1',
      MOLAN_PG_RUNTIME_ROLE: 'novel_app',
      MOLAN_PG_WORKER_ROLE: 'novel_worker'
    },
    Pool: FakePool
  });

  assert.equal(await repository.getJob('author-a', 'job-a'), null);
  assert.deepEqual(await repository.getJobInput({
    workerId: 'worker-a', workspaceId: 'workspace-a', projectId: 'project-a', jobId: 'job-a'
  }), { bookId: 'book-a' });
  assert.deepEqual(statements.filter(sql => sql.startsWith('SET ROLE') || sql === 'RESET ROLE'), [
    'SET ROLE "novel_app"', 'RESET ROLE', 'SET ROLE "novel_worker"', 'RESET ROLE'
  ]);
  await repository.close();
});


test('PG 正文导出仓储复核 canExport 并在正文哈希不匹配时阻止读取', async t => {
  const workspaceId = internalUuid('export-workspace');
  const projectId = internalUuid('export-project');
  const statements = [];
  const client = {
    canExport: false,
    async query(sql) {
      const statement = String(sql).trim();
      statements.push(statement);
      if (['BEGIN', 'COMMIT', 'ROLLBACK', 'RESET ROLE', 'RESET ALL'].includes(statement) ||
          statement.startsWith('SELECT set_config') || statement.startsWith('SELECT luna.ensure_actor')) {
        return { rows: [], rowCount: 0 };
      }
      if (statement.includes('luna.project_access(')) {
        return { rows: [{
          workspace_uuid: workspaceId, project_uuid: projectId,
          role: 'editor', project_status: 'active', can_spend: true,
          can_export: this.canExport, project_revision: 1, acl_revision: 1
        }], rowCount: 1 };
      }
      if (statement.includes('FROM luna.commits c')) {
        return { rows: [{ chapter_no: 1, body: '正文', body_hash: '0'.repeat(64) }], rowCount: 1 };
      }
      throw new Error(`Unexpected PostgreSQL export query: ${statement.slice(0, 180)}`);
    },
    release() {}
  };
  class FakePool {
    async connect() { return client; }
    async end() {}
  }
  const repository = createPostgresRepository({
    env: { MOLAN_PG_ENABLED: '1', MOLAN_PG_RUNTIME_ROLE: 'none' },
    Pool: FakePool
  });
  t.after(() => repository.close());

  await assert.rejects(
    repository.listExportableChapters('export-user', 'export-project', 'export-workspace'),
    { code: 'export_forbidden', status: 404 }
  );
  assert.equal(statements.some(statement => statement.includes('FROM luna.commits c')), false);

  client.canExport = true;
  await assert.rejects(
    repository.listExportableChapters('export-user', 'export-project', 'export-workspace'),
    { code: 'export_content_blocked', status: 409 }
  );
  const exportQuery = statements.find(statement => statement.includes('FROM luna.commits c'));
  assert.match(exportQuery, /chapterNo.*\^\[1-9\]\[0-9\]/s);
});
