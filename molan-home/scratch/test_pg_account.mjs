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
const res = await client.query('SELECT email, salt, pwd, role FROM luna.runtime_accounts WHERE email = $1', ['1271055010@qq.com']);
console.log('Admin in PG runtime_accounts:', res.rows);
const count = await client.query('SELECT count(*) FROM luna.runtime_accounts');
console.log('Total accounts count:', count.rows[0].count);
await client.end();
