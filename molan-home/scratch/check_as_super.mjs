import pg from 'pg';
import fs from 'fs';

const password = fs.readFileSync(process.env.LOCALAPPDATA + '/molan-postgresql/postgres-password.txt', 'utf8').trim();

const client = new pg.Client({
  host: '127.0.0.1',
  port: 55432,
  user: 'postgres',
  password,
  database: 'molan_v2_dev_20260915'
});

try {
  await client.connect();
  const res = await client.query('SELECT count(*) FROM luna.sqlite_accounts');
  console.log('sqlite_accounts count as postgres:', res.rows[0].count);
  const runtimeAcc = await client.query('SELECT count(*) FROM luna.runtime_accounts');
  console.log('runtime_accounts count as postgres:', runtimeAcc.rows[0].count);
  const legacyRows = await client.query('SELECT count(*) FROM luna.sqlite_legacy_rows');
  console.log('sqlite_legacy_rows count as postgres:', legacyRows.rows[0].count);
  const runs = await client.query('SELECT * FROM luna.sqlite_migration_runs');
  console.log('sqlite_migration_runs:', runs.rows);
  await client.end();
} catch (e) {
  console.error('Error with postgres superuser:', e);
}
