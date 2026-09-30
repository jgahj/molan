import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { scanSource } from './migrate-sqlite-full.mjs';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { readConfig } = require('../../lib/postgres-repository.js');

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]));
  }
  return value;
}

function optionArgument(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || '' : '';
}

async function main() {
  const argv = process.argv.slice(2);
  const sourcePath = path.resolve(optionArgument(argv, '--source') || process.env.MOLAN_SQLITE_PATH || '');
  const runId = optionArgument(argv, '--run-id');
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('SQLite reconcile source does not exist');
  const scan = scanSource(sourcePath, { includeRows: false });
  const environment = { ...process.env, MOLAN_PG_ENABLED: '1' };
  if (environment.MOLAN_PG_PASSWORD_FILE && !environment.MOLAN_PG_PASSWORD) environment.MOLAN_PG_PASSWORD = fs.readFileSync(environment.MOLAN_PG_PASSWORD_FILE, 'utf8').trim();
  const settings = readConfig(environment);
  if (!settings.enabled) throw new Error('PostgreSQL is not configured');
  const pool = new Pool(settings.config);
  try {
    const runResult = runId
      ? await pool.query(`SELECT id, source_bytes, source_sha256, source_integrity, status, active, table_count, row_count, metadata
          FROM luna.sqlite_migration_runs WHERE id = $1::uuid AND status = 'completed'`, [runId])
      : await pool.query(`SELECT id, source_bytes, source_sha256, source_integrity, status, active, table_count, row_count, metadata
          FROM luna.sqlite_migration_runs WHERE status = 'completed' AND active ORDER BY completed_at DESC LIMIT 1`);
    if (!runResult.rows.length) throw new Error(runId ? 'no completed SQLite migration run matches --run-id' : 'no completed active SQLite migration run');
    const run = runResult.rows[0];
    const metadata = typeof run.metadata === 'string' ? JSON.parse(run.metadata) : (run.metadata || {});
    const archiveOnly = metadata.activationPolicy === 'archive-only';
    const targetCatalog = await pool.query(`SELECT table_name, row_count, row_sha256, value_sha256, column_hashes, type_counts
      FROM luna.sqlite_table_catalog WHERE run_id = $1::uuid ORDER BY ordinal`, [run.id]);
    const mismatches = [];
    if (Number(run.source_bytes) !== scan.sourceBytes) mismatches.push({ type: 'source_bytes', expected: scan.sourceBytes, actual: Number(run.source_bytes) });
    if (String(run.source_sha256) !== scan.sourceSha256) mismatches.push({ type: 'source_sha256' });
    if (String(run.source_integrity) !== scan.integrity) mismatches.push({ type: 'source_integrity' });
    if (archiveOnly && run.active) mismatches.push({ type: 'archive_run_active' });
    if (Number(run.table_count) !== scan.tableCount) mismatches.push({ type: 'table_count', expected: scan.tableCount, actual: Number(run.table_count) });
    if (Number(run.row_count) !== scan.totalRows) mismatches.push({ type: 'row_count', expected: scan.totalRows, actual: Number(run.row_count) });
    const byName = new Map(targetCatalog.rows.map(row => [String(row.table_name), row]));
    for (const table of scan.tables) {
      const target = byName.get(table.tableName);
      if (!target) { mismatches.push({ table: table.tableName, type: 'missing_catalog' }); continue; }
      if (Number(target.row_count) !== table.rowCount || String(target.row_sha256) !== table.rowSha256 || String(target.value_sha256) !== table.valueSha256 || JSON.stringify(stableJson(target.column_hashes)) !== JSON.stringify(stableJson(table.columnHashes)) || JSON.stringify(stableJson(target.type_counts)) !== JSON.stringify(stableJson(table.typeCounts))) {
        mismatches.push({ table: table.tableName, type: 'catalog_hash_or_count' });
      }
      const countResult = await pool.query('SELECT COUNT(*)::bigint AS n FROM luna.sqlite_legacy_rows WHERE run_id = $1::uuid AND table_name = $2::text', [run.id, table.tableName]);
      if (Number(countResult.rows[0].n) !== table.rowCount) mismatches.push({ table: table.tableName, type: 'row_count_target', expected: table.rowCount, actual: Number(countResult.rows[0].n) });
      const rowHashResult = await pool.query(`SELECT COALESCE(string_agg(row_sha256, E'\\n' ORDER BY row_no) || E'\\n', '') AS value
        FROM luna.sqlite_legacy_rows WHERE run_id = $1::uuid AND table_name = $2::text`, [run.id, table.tableName]);
      const valueHash = require('node:crypto').createHash('sha256').update(String(rowHashResult.rows[0].value || '')).digest('hex');
      if (valueHash !== table.rowSha256) mismatches.push({ table: table.tableName, type: 'row_hash_target' });
      const cellValueHashResult = await pool.query(`SELECT COALESCE(string_agg(value_sha256, E'\\n' ORDER BY row_no) || E'\\n', '') AS value
        FROM luna.sqlite_legacy_rows WHERE run_id = $1::uuid AND table_name = $2::text`, [run.id, table.tableName]);
      const cellValueHash = require('node:crypto').createHash('sha256').update(String(cellValueHashResult.rows[0].value || '')).digest('hex');
      if (cellValueHash !== table.valueSha256) mismatches.push({ table: table.tableName, type: 'value_hash_target' });
    }
    const projectionCounts = {};
    if (!archiveOnly) {
      for (const [key, table] of [['accounts', 'sqlite_accounts'], ['dissections', 'sqlite_dissections'], ['userSkills', 'sqlite_user_skills'], ['globalSkills', 'sqlite_global_skills'], ['openSkills', 'sqlite_open_skills']]) {
        projectionCounts[key] = Number((await pool.query(`SELECT COUNT(*)::bigint AS n FROM luna.${table} WHERE source_run_id = $1::uuid`, [run.id])).rows[0].n);
      }
      const expectedProjectionCounts = {
        accounts: scan.tables.find(t => t.tableName === 'accounts')?.rowCount || 0,
        dissections: scan.tables.find(t => t.tableName === 'dissections')?.rowCount || 0,
        userSkills: scan.tables.find(t => t.tableName === 'user_skills')?.rowCount || 0,
        globalSkills: scan.tables.find(t => t.tableName === 'global_skills')?.rowCount || 0,
        openSkills: scan.tables.find(t => t.tableName === 'open_skills')?.rowCount || 0
      };
      for (const key of Object.keys(expectedProjectionCounts)) if (projectionCounts[key] !== expectedProjectionCounts[key]) mismatches.push({ type: 'projection_count', key, expected: expectedProjectionCounts[key], actual: projectionCounts[key] });
    }
    const result = { ok: mismatches.length === 0, runId: String(run.id), active: Boolean(run.active), archiveOnly, sourceSha256: scan.sourceSha256, tableCount: scan.tableCount, rowCount: scan.totalRows, projectionCounts, mismatches };
    process.stdout.write(JSON.stringify(result) + '\n');
    if (!result.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: 'sqlite_full_reconcile_failed', error: String(error && error.message || error) }) + '\n');
  process.exitCode = 1;
});
