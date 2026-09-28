import pg from 'pg';
import fs from 'fs';

const password = fs.readFileSync(process.env.LOCALAPPDATA + '/molan-postgresql/novel-runtime-password.txt', 'utf8').trim();

const client = new pg.Client({
  host: '127.0.0.1',
  port: 55432,
  user: 'novel_runtime',
  password,
  database: 'molan_v2_dev_20260915'
});

await client.connect();
await client.query('SET ROLE novel_app');
const count = await client.query('SELECT count(*) FROM luna.sqlite_accounts');
console.log('sqlite_accounts count in PG:', count.rows[0].count);

const runs = await client.query('SELECT id, status, active FROM luna.sqlite_migration_runs');
console.log('Migration runs:', runs.rows);

await client.end();
