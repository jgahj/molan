import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
const { readConfig, internalUuid } = require('../lib/postgres-repository.js');
const projectScope = require('../lib/project-scope.js');

const SOURCE_TABLES_FOR_LIVE = new Set([
  'character_library', 'dissection_batch_tasks', 'dissection_chapter_facts',
  'dissection_chapters', 'dissection_claims', 'dissection_entities',
  'dissection_entity_aliases', 'dissection_entity_mentions',
  'dissection_entity_states', 'dissection_event_edges', 'dissection_events',
  'dissection_foreshadows', 'dissection_runs', 'dissection_shares',
  'dissection_summaries', 'dissection_units', 'dissection_units_fts',
  'dissection_units_fts_config', 'dissection_units_fts_content',
  'dissection_units_fts_data', 'dissection_units_fts_docsize',
  'dissection_units_fts_idx', 'dissection_versions'
]);

function parseArguments(argv) {
  const result = { apply: false, archiveOnly: false, source: '', report: '', runId: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--apply') result.apply = true;
    else if (value === '--archive-only') result.archiveOnly = true;
    else if (value === '--source') result.source = argv[++i] || '';
    else if (value === '--report') result.report = argv[++i] || '';
    else if (value === '--run-id') result.runId = argv[++i] || '';
  }
  return result;
}

function q(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read) hash.update(buffer.subarray(0, read));
    } while (read);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function assertSource(sourcePath) {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) throw new Error('SQLite source does not exist: ' + resolved);
  const normalized = resolved.toLowerCase();
  for (const name of ['\\books\\', '\\raws\\', '\\deploy_tmp\\', '\\tmp-booktest\\', '/books/', '/raws/', '/deploy_tmp/', '/tmp-booktest/']) {
    if (normalized.includes(name)) throw new Error('SQLite source is in a protected content directory');
  }
  const walPath = resolved + '-wal';
  const shmPath = resolved + '-shm';
  const walBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  // SQLite 只读打开 WAL 模式数据库时可能创建 0 字节 WAL 与共享内存文件；只有非空 WAL 代表还有未合并数据。
  if (walBytes > 0 || (fs.existsSync(shmPath) && !fs.existsSync(walPath))) {
    throw new Error('SQLite source has WAL sidecars with possible uncheckpointed data; use a consistent clone/snapshot instead');
  }
  if (path.basename(resolved).toLowerCase() === 'molan.db' && process.env.MOLAN_ALLOW_LIVE_SQLITE_SOURCE !== '1') {
    throw new Error('live molan.db is not an allowed migration source; pass a consistent .sqlite snapshot');
  }
  return resolved;
}

function readIntegrity(database) {
  const integrity = String(database.prepare('PRAGMA integrity_check').get().integrity_check || '');
  if (integrity !== 'ok') throw new Error('SQLite integrity_check failed: ' + integrity.slice(0, 500));
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length) throw new Error('SQLite foreign_key_check found ' + foreignKeys.length + ' violations');
  return integrity;
}

function tableInfo(database, tableName) {
  return database.prepare('PRAGMA table_info(' + q(tableName) + ')').all().map(column => ({
    cid: Number(column.cid), name: String(column.name), type: String(column.type || ''),
    notnull: Number(column.notnull) || 0, dflt_value: column.dflt_value, pk: Number(column.pk) || 0
  }));
}

function objectCatalog(database) {
  const objects = database.prepare("SELECT name, type, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','view','index','trigger') ORDER BY type, name").all();
  return objects.map(object => ({
    name: String(object.name), type: String(object.type), tableName: String(object.tbl_name || object.name), sql: object.sql || null
  }));
}

function indexesFor(database, tableName) {
  const indexes = database.prepare('PRAGMA index_list(' + q(tableName) + ')').all();
  return indexes.map(index => ({
    name: String(index.name), unique: Number(index.unique) || 0, origin: String(index.origin || ''), partial: Number(index.partial) || 0,
    columns: database.prepare('PRAGMA index_info(' + q(index.name) + ')').all().map(column => ({ seqno: Number(column.seqno), cid: Number(column.cid), name: column.name }))
  }));
}

function triggersFor(catalog, tableName) {
  return catalog.filter(item => item.type === 'trigger' && item.tableName === tableName).map(item => ({ name: item.name, sql: item.sql }));
}

function scalarDocumentValue(value, type, rawBytes) {
  if (type === 'null') return null;
  if (type === 'integer') {
    const text = String(value);
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : text;
  }
  if (type === 'real') {
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }
  if (type === 'blob') {
    const bytes = Buffer.isBuffer(value) ? value : rawBytes;
    return bytes.toString('base64');
  }
  return String(value);
}

function typedCell(name, type, value, hexValue) {
  const normalizedType = String(type || 'null').toLowerCase();
  const rawBytes = Buffer.isBuffer(hexValue)
    ? hexValue
    : hexValue === null || hexValue === undefined || hexValue === ''
      ? normalizedType === 'blob' && Buffer.isBuffer(value)
        ? value
        : normalizedType === 'text'
          ? Buffer.from(String(value ?? ''), 'utf8')
          : Buffer.from(String(value ?? ''), 'utf8')
      : Buffer.from(String(hexValue), 'hex');
  const cell = { name, sqliteType: normalizedType };
  if (normalizedType === 'null') return cell;
  if (normalizedType === 'integer') {
    cell.value = String(value);
    cell.rawBase64 = rawBytes.toString('base64');
    return cell;
  }
  if (normalizedType === 'real') {
    const number = Number(value);
    const bits = Buffer.allocUnsafe(8);
    bits.writeDoubleLE(number, 0);
    cell.value = Number.isFinite(number) ? String(number) : String(value);
    cell.ieee754LeBase64 = bits.toString('base64');
    cell.rawBase64 = rawBytes.toString('base64');
    return cell;
  }
  if (normalizedType === 'blob') {
    const bytes = Buffer.isBuffer(value) ? value : rawBytes;
    cell.valueBase64 = bytes.toString('base64');
    cell.byteLength = bytes.length;
    return cell;
  }
  cell.value = String(value);
  cell.utf8Base64 = rawBytes.toString('base64');
  cell.byteLength = rawBytes.length;
  return cell;
}

function cellFingerprint(cell) {
  if (cell.sqliteType === 'null') return 'null';
  if (cell.sqliteType === 'integer') return 'integer:' + cell.value;
  if (cell.sqliteType === 'real') return 'real:' + cell.ieee754LeBase64;
  if (cell.sqliteType === 'blob') return 'blob:' + cell.valueBase64;
  return 'text:' + cell.utf8Base64;
}

function rowKey(cells, columns, rowNo) {
  const primary = columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk);
  if (!primary.length) return 'row-' + rowNo;
  const values = primary.map(column => {
    const cell = cells[column.cid];
    return [column.name, cell && cell.sqliteType, cell && (cell.value ?? cell.valueBase64 ?? '')];
  });
  return JSON.stringify(values);
}

function sourceRowStatement(database, tableName, columns) {
  const expressions = [];
  for (const column of columns) {
    const identifier = q(column.name);
    // BLOB 值已由 node:sqlite 直接返回 Buffer，避免再生成一份等大的 hex 字符串。
    // 大文本不再额外生成 2 倍长度的 hex 字符串；文本字节在 typedCell 中由 SQLite 返回的字符串重建。
    expressions.push('typeof(' + identifier + ')', identifier, 'CASE WHEN typeof(' + identifier + ') IN (\'integer\', \'real\') THEN hex(CAST(' + identifier + ' AS BLOB)) ELSE NULL END');
  }
  const statement = database.prepare('SELECT ' + expressions.join(', ') + ' FROM ' + q(tableName));
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  return statement;
}

// 265 MiB 级快照在低内存主机上不能使用默认 mmap/page cache；逐表扫描本身已经提供顺序访问。
function configureReadonlyDatabase(database) {
  database.exec('PRAGMA mmap_size = 0; PRAGMA cache_size = -1024; PRAGMA temp_store = FILE;');
}

function simpleOwnerId(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return { userId: '', actorId: null };
  const userId = projectScope.stableUserId(email);
  return { userId, actorId: internalUuid(userId) };
}

function buildOwnerMaps(database, tables) {
  const maps = { accounts: new Map(), dissections: new Map(), books: new Map() };
  const read = tableName => {
    if (!tables.has(tableName)) return [];
    return database.prepare('SELECT * FROM ' + q(tableName)).all();
  };
  for (const row of read('accounts')) {
    const owner = simpleOwnerId(row.email);
    if (row.email) maps.accounts.set(String(row.email).trim().toLowerCase(), owner);
  }
  for (const row of read('dissections')) {
    const owner = simpleOwnerId(row.user_email);
    if (row.id && owner.actorId) maps.dissections.set(String(row.id), owner);
  }
  for (const row of read('creation_books')) {
    const owner = simpleOwnerId(row.user_email || row.created_by);
    if (row.id && owner.actorId) maps.books.set(String(row.id), owner);
  }
  return maps;
}

function ownerForRow(tableName, document, maps) {
  const directFields = tableName === 'accounts'
    ? ['email', 'user_email', 'owner_email', 'admin_email']
    : tableName === 'open_skills' ? ['owner_email'] : ['user_email', 'owner_email', 'admin_email'];
  for (const field of directFields) {
    const owner = maps.accounts.get(String(document[field] || '').trim().toLowerCase());
    if (owner) return owner;
  }
  if (document.dissection_id && maps.dissections.has(String(document.dissection_id))) return maps.dissections.get(String(document.dissection_id));
  if (document.id && maps.dissections.has(String(document.id))) return maps.dissections.get(String(document.id));
  if (document.book_id && maps.books.has(String(document.book_id))) return maps.books.get(String(document.book_id));
  if (document.novel_id && maps.accounts.has(String(document.user_email || '').toLowerCase())) return maps.accounts.get(String(document.user_email).toLowerCase());
  return { userId: '', actorId: null };
}

function pgDocumentText(document, key, fallback = '') {
  const value = document && Object.prototype.hasOwnProperty.call(document, key) ? document[key] : fallback;
  return value === null || value === undefined ? fallback : String(value);
}

function pgInteger(document, key) {
  const value = document && Object.prototype.hasOwnProperty.call(document, key) ? document[key] : null;
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  if (!/^-?\d+$/.test(text)) return null;
  return text;
}

function pgNumber(document, key) {
  const value = document && Object.prototype.hasOwnProperty.call(document, key) ? document[key] : 0;
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '0';
}

function pgBoolean(document, key) {
  const value = document && document[key];
  return value === true || value === 1 || value === '1' || value === 'true';
}

function accountProjection(row) {
  const document = row.document;
  const owner = row.owner;
  const userId = owner.userId;
  return [
    row.rowNo, owner.actorId, userId, pgDocumentText(document, 'email'), pgDocumentText(document, 'name'),
    pgDocumentText(document, 'avatar'), pgDocumentText(document, 'bio'), pgDocumentText(document, 'default_model'),
    pgDocumentText(document, 'salt'), pgDocumentText(document, 'pwd'), pgDocumentText(document, 'role', 'normal'),
    pgDocumentText(document, 'level', 'normal'), pgDocumentText(document, 'plan', 'normal'), pgNumber(document, 'credits'),
    pgNumber(document, 'spent'), pgDocumentText(document, 'created_at'), row.documentJson || JSON.stringify(document), row.cellsJson || JSON.stringify(row.cells), row.rowHash
  ];
}

function projectDissectionRow(row) {
  const d = row.document;
  const owner = row.owner;
  return [
    row.rowNo, owner.actorId, owner.userId, pgDocumentText(d, 'user_email'), pgDocumentText(d, 'id'), pgDocumentText(d, 'title'),
    pgDocumentText(d, 'source_type'), pgDocumentText(d, 'source_name'), pgDocumentText(d, 'source_text'), pgDocumentText(d, 'depth', 'standard'),
    pgDocumentText(d, 'purpose', 'new-writer'), pgDocumentText(d, 'selected_model'), pgDocumentText(d, 'status', 'queued'), pgDocumentText(d, 'phase', 'queued'),
    Number(pgInteger(d, 'phase_index') || 0), Number(pgInteger(d, 'progress') || 0), pgNumber(d, 'estimated_credits'), pgNumber(d, 'actual_credits'),
    pgDocumentText(d, 'result_json', '{}'), pgDocumentText(d, 'meta_json', '{}'), pgDocumentText(d, 'error'), pgBoolean(d, 'cancel_requested'),
    pgInteger(d, 'created_at'), pgInteger(d, 'updated_at'), row.documentJson || JSON.stringify(d), row.cellsJson || JSON.stringify(row.cells), row.rowHash
  ];
}

function projectUserSkillRow(row) {
  const d = row.document;
  const owner = row.owner;
  return [row.rowNo, owner.actorId, owner.userId, pgDocumentText(d, 'user_email').toLowerCase(), pgDocumentText(d, 'id'),
    pgDocumentText(d, 'name'), pgDocumentText(d, 'description'), pgDocumentText(d, 'instruction'), pgDocumentText(d, 'files_json', '[]'),
    Number(pgInteger(d, 'size') || 0), pgInteger(d, 'updated_at'), row.documentJson || JSON.stringify(d), row.cellsJson || JSON.stringify(row.cells), row.rowHash];
}

function projectGlobalSkillRow(row) {
  const d = row.document;
  return [row.rowNo, pgDocumentText(d, 'id'), pgDocumentText(d, 'name'), pgDocumentText(d, 'description'), pgDocumentText(d, 'instruction'),
    pgDocumentText(d, 'targets_json', '["all"]'), pgBoolean(d, 'enabled'), pgInteger(d, 'created_at'), pgInteger(d, 'updated_at'),
    pgDocumentText(d, 'files_json', '{}'), row.documentJson || JSON.stringify(d), row.cellsJson || JSON.stringify(row.cells), row.rowHash];
}

function projectOpenSkillRow(row) {
  const d = row.document;
  const owner = row.owner;
  return [row.rowNo, owner.actorId, owner.userId, pgDocumentText(d, 'owner_email').toLowerCase(), pgDocumentText(d, 'id'),
    pgDocumentText(d, 'name'), pgDocumentText(d, 'description'), pgDocumentText(d, 'instruction'), pgDocumentText(d, 'files_json', '[]'),
    pgDocumentText(d, 'status', 'published'), Number(pgInteger(d, 'downloads') || 0), pgInteger(d, 'created_at'), pgInteger(d, 'updated_at'),
    row.documentJson || JSON.stringify(d), row.cellsJson || JSON.stringify(row.cells), row.rowHash];
}

function queryValues(tableName, row) {
  return [row.tableName, row.rowNo, row.rowKey, row.rowHash, row.valueHash, row.cellsJson || JSON.stringify(row.cells), row.documentJson || JSON.stringify(row.document),
    row.owner.actorId, row.owner.userId];
}

function createTablePlan(database, catalog, tableName) {
  const columns = tableInfo(database, tableName);
  return {
    tableName,
    columns,
    indexes: indexesFor(database, tableName),
    triggers: triggersFor(catalog, tableName),
    createSql: catalog.find(item => item.type === 'table' && item.name === tableName)?.sql || null
  };
}

function sourceRowFromValues(tableName, columns, values, rowNo, ownerMaps, seenRowKeys = null) {
  const cells = [];
  const document = {};
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex];
    const type = values[columnIndex * 3];
    const value = values[columnIndex * 3 + 1];
    const hexValue = values[columnIndex * 3 + 2];
    const cell = typedCell(column.name, type, value, hexValue);
    cells.push(cell);
    const normalizedType = String(type).toLowerCase();
    const rawBytes = normalizedType === 'blob' && Buffer.isBuffer(value)
      ? value
      : Buffer.from(String(hexValue || ''), 'hex');
    document[column.name] = scalarDocumentValue(value, normalizedType, rawBytes);
  }
  const cellsJson = JSON.stringify(cells);
  const documentJson = JSON.stringify(document);
  const rowHash = sha256(cellsJson);
  const valueHash = sha256(cells.map(cellFingerprint).join('\n'));
  let stableRowKey = rowKey(cells, columns, rowNo);
  if (seenRowKeys) {
    const baseKey = stableRowKey;
    if (seenRowKeys.has(stableRowKey)) stableRowKey = baseKey + '|source-row-' + rowNo;
    while (seenRowKeys.has(stableRowKey)) stableRowKey += '-duplicate';
    seenRowKeys.add(stableRowKey);
  }
  return {
    tableName, rowNo, rowKey: stableRowKey, rowHash, valueHash, cells, document, cellsJson, documentJson,
    owner: ownerForRow(tableName, document, ownerMaps)
  };
}

/** 扫描单表；默认保留行以兼容测试，生产 dry-run/reconcile 可关闭行缓存。 */
function scanTable(database, plan, ownerMaps, includeRows = true) {
  const rowStatement = sourceRowStatement(database, plan.tableName, plan.columns);
  let rowNo = 0;
  const rowHashAccumulator = crypto.createHash('sha256');
  const valueHashAccumulator = crypto.createHash('sha256');
  const columnHashAccumulators = plan.columns.map(() => crypto.createHash('sha256'));
  const typeCounts = {};
  const rows = includeRows ? [] : null;
  const seenRowKeys = new Set();
  for (const values of rowStatement.iterate()) {
    rowNo += 1;
    const row = sourceRowFromValues(plan.tableName, plan.columns, values, rowNo, ownerMaps, seenRowKeys);
    for (let columnIndex = 0; columnIndex < plan.columns.length; columnIndex += 1) {
      const cell = row.cells[columnIndex];
      const fingerprint = cellFingerprint(cell);
      columnHashAccumulators[columnIndex].update(fingerprint + '\n', 'utf8');
      const columnName = plan.columns[columnIndex].name;
      typeCounts[columnName] = typeCounts[columnName] || {};
      typeCounts[columnName][cell.sqliteType] = (typeCounts[columnName][cell.sqliteType] || 0) + 1;
    }
    if (rows) rows.push(row);
    rowHashAccumulator.update(row.rowHash + '\n', 'utf8');
    valueHashAccumulator.update(row.valueHash + '\n', 'utf8');
  }
  const columnHashes = {};
  for (let columnIndex = 0; columnIndex < plan.columns.length; columnIndex += 1) {
    columnHashes[plan.columns[columnIndex].name] = columnHashAccumulators[columnIndex].digest('hex');
  }
  return {
    ...plan, rowCount: rowNo,
    rowSha256: rowHashAccumulator.digest('hex'), valueSha256: valueHashAccumulator.digest('hex'), columnHashes, typeCounts,
    ...(rows ? { rows } : {})
  };
}

function scanSource(sourcePath, options = {}) {
  const database = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    configureReadonlyDatabase(database);
    const integrity = readIntegrity(database);
    const objects = objectCatalog(database);
    const tableNames = objects.filter(item => item.type === 'table').map(item => item.name);
    const tableSet = new Set(tableNames);
    const ownerMaps = buildOwnerMaps(database, tableSet);
    const includeRows = options.includeRows !== false;
    const tables = [];
    let totalRows = 0;
    for (let ordinal = 0; ordinal < tableNames.length; ordinal += 1) {
      const tableName = tableNames[ordinal];
      const plan = { ...createTablePlan(database, objects, tableName), ordinal: ordinal + 1 };
      const table = scanTable(database, plan, ownerMaps, includeRows);
      totalRows += table.rowCount;
      tables.push(table);
    }
    const stat = fs.statSync(sourcePath);
    return {
      sourcePath, sourceBytes: stat.size, sourceSha256: fileSha256(sourcePath), integrity,
      objects, tableCount: tables.length, totalRows, tables
    };
  } finally {
    database.close();
  }
}

function activeEnvironment() {
  const environment = { ...process.env, MOLAN_PG_ENABLED: '1' };
  if (environment.MOLAN_PG_PASSWORD_FILE && !environment.MOLAN_PG_PASSWORD) {
    environment.MOLAN_PG_PASSWORD = fs.readFileSync(environment.MOLAN_PG_PASSWORD_FILE, 'utf8').trim();
  }
  return environment;
}

function assertLocalTarget(settings) {
  if (process.env.MOLAN_ALLOW_LOCAL_DATA_MIGRATION !== '1') throw new Error('set MOLAN_ALLOW_LOCAL_DATA_MIGRATION=1 to apply a migration');
  const connectionString = String(settings.config.connectionString || '').trim();
  const host = connectionString ? new URL(connectionString).hostname : String(settings.config.host || '127.0.0.1');
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!new Set(['localhost', '127.0.0.1', '::1', '/var/run/postgresql']).has(normalized)) throw new Error('full migration only accepts a local PostgreSQL target');
}

async function insertBatch(client, table, columns, rows, batchSize = 50) {
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const values = [];
    const groups = batch.map((row, rowIndex) => {
      const placeholders = columns.map((_, columnIndex) => {
        values.push(row[columnIndex]);
        return '$' + (rowIndex * columns.length + columnIndex + 1);
      });
      return '(' + placeholders.join(', ') + ')';
    });
    await client.query('INSERT INTO ' + table + ' (' + columns.join(', ') + ') VALUES ' + groups.join(', '), values);
  }
}

function migrationBatchSize(tableName) {
  const parseBatch = (name, fallback, maximum) => {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, parsed)) : fallback;
  };
  // 拆书正文和 FTS 行可能带有超大文本，单行提交可控峰值内存；claims/events
  // 通常较小，使用小批量减少低配服务器上的网络往返和 WAL 压力。
  if (tableName === 'dissections' || tableName.includes('_fts')) return 1;
  if (['dissection_claims', 'dissection_events'].includes(tableName)) {
    return parseBatch('MOLAN_PG_MIGRATION_LARGE_BATCH_SIZE', 8, 25);
  }
  return parseBatch('MOLAN_PG_MIGRATION_BATCH_SIZE', 10, 40);
}

function projectionOwner(row) {
  if (row.owner && row.owner.actorId) return row;
  // 极少数历史孤儿行仍需落入可审计投影，使用固定未分配主体而不改原始行。
  return { ...row, owner: simpleOwnerId('sqlite-unassigned@local.invalid') };
}

async function importTableRows(database, table, ownerMaps, client, run, options = {}) {
  const statement = sourceRowStatement(database, table.tableName, table.columns);
  const rowHashAccumulator = crypto.createHash('sha256');
  const valueHashAccumulator = crypto.createHash('sha256');
  const columnHashAccumulators = table.columns.map(() => crypto.createHash('sha256'));
  const typeCounts = {};
  const seenRowKeys = new Set();
  let rowNo = 0;
  let legacyRows = [];
  let projectionRows = [];
  let liveRows = [];
  const batchSize = migrationBatchSize(table.tableName);

  const flush = async () => {
    await insertBatch(client, 'luna.sqlite_legacy_rows',
      ['run_id', 'table_name', 'row_no', 'row_key', 'row_sha256', 'value_sha256', 'cells', 'document', 'owner_actor_id', 'owner_user_id'],
      legacyRows, batchSize);
    if (options.archiveOnly) {
      legacyRows = [];
      return;
    }
    if (table.tableName === 'accounts') {
      await insertBatch(client, 'luna.sqlite_accounts',
        ['source_run_id', 'source_row_no', 'actor_id', 'user_id', 'email', 'name', 'avatar', 'bio', 'default_model', 'salt', 'pwd', 'role', 'level', 'plan', 'credits', 'spent', 'created_at_text', 'document', 'cells', 'source_row_sha256'], projectionRows, 40);
    } else if (table.tableName === 'dissections') {
      await insertBatch(client, 'luna.sqlite_dissections',
        ['source_run_id', 'source_row_no', 'owner_actor_id', 'owner_user_id', 'user_email', 'id', 'title', 'source_type', 'source_name', 'source_text', 'depth', 'purpose', 'selected_model', 'status', 'phase', 'phase_index', 'progress', 'estimated_credits', 'actual_credits', 'result_json', 'meta_json', 'error', 'cancel_requested', 'created_at_value', 'updated_at_value', 'document', 'cells', 'source_row_sha256'], projectionRows, 40);
    } else if (table.tableName === 'user_skills') {
      await insertBatch(client, 'luna.sqlite_user_skills',
        ['source_run_id', 'source_row_no', 'owner_actor_id', 'owner_user_id', 'user_email', 'id', 'name', 'description', 'instruction', 'files_json', 'size', 'updated_at_value', 'document', 'cells', 'source_row_sha256'], projectionRows, 40);
    } else if (table.tableName === 'global_skills') {
      await insertBatch(client, 'luna.sqlite_global_skills',
        ['source_run_id', 'source_row_no', 'id', 'name', 'description', 'instruction', 'targets_json', 'enabled', 'created_at_value', 'updated_at_value', 'files_json', 'document', 'cells', 'source_row_sha256'], projectionRows, 40);
    } else if (table.tableName === 'open_skills') {
      await insertBatch(client, 'luna.sqlite_open_skills',
        ['source_run_id', 'source_row_no', 'owner_actor_id', 'owner_user_id', 'owner_email', 'id', 'name', 'description', 'instruction', 'files_json', 'status', 'downloads', 'created_at_value', 'updated_at_value', 'document', 'cells', 'source_row_sha256'], projectionRows, 40);
    }
    if (SOURCE_TABLES_FOR_LIVE.has(table.tableName)) {
      await insertBatch(client, 'luna.sqlite_dissection_live_rows',
        ['source_run_id', 'source_table', 'row_key', 'owner_actor_id', 'owner_user_id', 'document', 'cells', 'row_sha256', 'value_sha256', 'source_row_no'], liveRows, batchSize);
    }
    legacyRows = [];
    projectionRows = [];
    liveRows = [];
  };

  for (const values of statement.iterate()) {
    rowNo += 1;
    const row = sourceRowFromValues(table.tableName, table.columns, values, rowNo, ownerMaps, seenRowKeys);
    for (let columnIndex = 0; columnIndex < table.columns.length; columnIndex += 1) {
      const cell = row.cells[columnIndex];
      columnHashAccumulators[columnIndex].update(cellFingerprint(cell) + '\n', 'utf8');
      const columnName = table.columns[columnIndex].name;
      typeCounts[columnName] = typeCounts[columnName] || {};
      typeCounts[columnName][cell.sqliteType] = (typeCounts[columnName][cell.sqliteType] || 0) + 1;
    }
    rowHashAccumulator.update(row.rowHash + '\n', 'utf8');
    valueHashAccumulator.update(row.valueHash + '\n', 'utf8');
    legacyRows.push([run, ...queryValues(table.tableName, row)]);
    if (!options.archiveOnly) {
      if (table.tableName === 'accounts') {
        const owner = row.owner;
        if (owner.actorId) {
          await client.query(`INSERT INTO luna.users(id, legacy_id)
            VALUES ($1::uuid, $2::text)
            ON CONFLICT (id) DO UPDATE SET legacy_id = COALESCE(luna.users.legacy_id, EXCLUDED.legacy_id)`, [owner.actorId, owner.userId]);
          const email = String(row.document.email || '').trim().toLowerCase();
          if (email) {
            await client.query(`INSERT INTO luna.auth_identities(issuer, subject, user_id)
              VALUES ('molan', $1::text, $2::uuid)
              ON CONFLICT (issuer, subject) DO UPDATE SET user_id = EXCLUDED.user_id`, [email, owner.actorId]);
          }
        }
        projectionRows.push([run, ...accountProjection(row)]);
      } else if (table.tableName === 'dissections') {
        const projectedRow = projectionOwner(row);
        const owner = projectedRow.owner;
        await client.query(`INSERT INTO luna.users(id, legacy_id)
          VALUES ($1::uuid, $2::text)
          ON CONFLICT (id) DO UPDATE SET legacy_id = COALESCE(luna.users.legacy_id, EXCLUDED.legacy_id)`, [owner.actorId, owner.userId]);
        projectionRows.push([run, ...projectDissectionRow(projectedRow)]);
      } else if (table.tableName === 'user_skills') {
        const projectedRow = projectionOwner(row);
        const owner = projectedRow.owner;
        await client.query(`INSERT INTO luna.users(id, legacy_id)
          VALUES ($1::uuid, $2::text)
          ON CONFLICT (id) DO UPDATE SET legacy_id = COALESCE(luna.users.legacy_id, EXCLUDED.legacy_id)`, [owner.actorId, owner.userId]);
        projectionRows.push([run, ...projectUserSkillRow(projectedRow)]);
      } else if (table.tableName === 'global_skills') {
        projectionRows.push([run, ...projectGlobalSkillRow(row)]);
      } else if (table.tableName === 'open_skills') {
        const projectedRow = projectionOwner(row);
        const owner = projectedRow.owner;
        await client.query(`INSERT INTO luna.users(id, legacy_id)
          VALUES ($1::uuid, $2::text)
          ON CONFLICT (id) DO UPDATE SET legacy_id = COALESCE(luna.users.legacy_id, EXCLUDED.legacy_id)`, [owner.actorId, owner.userId]);
        projectionRows.push([run, ...projectOpenSkillRow(projectedRow)]);
      }
      if (SOURCE_TABLES_FOR_LIVE.has(table.tableName)) {
        liveRows.push([run, row.tableName, row.rowKey, row.owner.actorId, row.owner.userId,
          row.documentJson, row.cellsJson, row.rowHash, row.valueHash, row.rowNo]);
      }
    }
    // PostgreSQL 参数数组已保留序列化结果，释放当前行的对象图，避免大拆书结果累积。
    row.cells = null;
    row.document = null;
    if (legacyRows.length >= batchSize) {
      await flush();
      // The source contains very large text fields. Reclaim transient JSON/PG
      // buffers on constrained migration hosts before reading the next batch.
      if (global.gc && (rowNo % 100 === 0 || batchSize === 1)) global.gc();
    }
  }
  await flush();
  const columnHashes = {};
  for (let columnIndex = 0; columnIndex < table.columns.length; columnIndex += 1) {
    columnHashes[table.columns[columnIndex].name] = columnHashAccumulators[columnIndex].digest('hex');
  }
  if (rowNo !== table.rowCount || rowHashAccumulator.digest('hex') !== table.rowSha256 || valueHashAccumulator.digest('hex') !== table.valueSha256 || JSON.stringify(columnHashes) !== JSON.stringify(table.columnHashes) || JSON.stringify(typeCounts) !== JSON.stringify(table.typeCounts)) {
    throw new Error('source changed while importing table ' + table.tableName);
  }
}

async function applyScan(scan, settings, runId, reportPath, options = {}) {
  const pool = new Pool(settings.config);
  const client = await pool.connect();
  const run = runId || crypto.randomUUID();
  let currentTable = '';
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO luna.sqlite_migration_runs
       (id, source_path, source_bytes, source_sha256, source_integrity, status, table_count, row_count, metadata)
       VALUES ($1::uuid, $2::text, $3::bigint, $4::text, $5::text, 'running', $6::bigint, $7::bigint, $8::jsonb)`,
      [run, scan.sourcePath, scan.sourceBytes, scan.sourceSha256, scan.integrity, scan.tableCount, scan.totalRows,
        JSON.stringify({
          objectCount: scan.objects.length,
          nodeVersion: process.version,
          activationPolicy: options.archiveOnly ? 'archive-only' : 'activate'
        })]
    );
    await client.query('COMMIT');
    const database = new DatabaseSync(scan.sourcePath, { readOnly: true });
    try {
      configureReadonlyDatabase(database);
      readIntegrity(database);
      const objects = objectCatalog(database);
      const tableNames = objects.filter(item => item.type === 'table').map(item => item.name);
      const ownerMaps = buildOwnerMaps(database, new Set(tableNames));
      for (const table of scan.tables) {
      currentTable = table.tableName;
      await client.query('BEGIN');
      await insertBatch(client, 'luna.sqlite_table_catalog',
        ['run_id', 'ordinal', 'object_type', 'table_name', 'create_sql', 'columns', 'indexes', 'triggers', 'row_count', 'row_sha256', 'value_sha256', 'column_hashes', 'type_counts'],
        [[run, table.ordinal, 'table', table.tableName, table.createSql, JSON.stringify(table.columns), JSON.stringify(table.indexes), JSON.stringify(table.triggers), table.rowCount, table.rowSha256, table.valueSha256, JSON.stringify(table.columnHashes), JSON.stringify(table.typeCounts)]], 1);
      await importTableRows(database, table, ownerMaps, client, run, options);
      await client.query('COMMIT');
      }
    } finally {
      database.close();
    }
    await client.query('BEGIN');
    await client.query(`UPDATE luna.sqlite_legacy_rows child
      SET owner_actor_id = d.owner_actor_id, owner_user_id = d.owner_user_id
      FROM luna.sqlite_dissections d
      WHERE child.run_id = $1::uuid AND d.source_run_id = child.run_id
        AND child.document ? 'dissection_id'
        AND child.document ->> 'dissection_id' = d.id
        AND child.owner_actor_id IS NULL`, [run]);
    await client.query(`UPDATE luna.sqlite_dissection_live_rows child
      SET owner_actor_id = d.owner_actor_id, owner_user_id = d.owner_user_id
      FROM luna.sqlite_dissections d
      WHERE child.source_run_id = $1::uuid AND d.source_run_id = child.source_run_id
        AND child.document ? 'dissection_id'
        AND child.document ->> 'dissection_id' = d.id
        AND child.owner_actor_id IS NULL`, [run]);
    await client.query(`UPDATE luna.sqlite_migration_runs SET status = 'completed', active = false, completed_at = now() WHERE id = $1::uuid`, [run]);
    if (!options.archiveOnly) {
      await client.query(`UPDATE luna.sqlite_migration_runs SET active = false WHERE active AND id <> $1::uuid`, [run]);
      await client.query(`UPDATE luna.sqlite_migration_runs SET active = true WHERE id = $1::uuid`, [run]);
    }
    await client.query('COMMIT');
    const result = { ok: true, runId: run, status: 'completed', active: !options.archiveOnly, archiveOnly: Boolean(options.archiveOnly), sourceSha256: scan.sourceSha256, tableCount: scan.tableCount, rowCount: scan.totalRows, currentTable: '' };
    fs.writeFileSync(reportPath, JSON.stringify({ ...result, source: { path: scan.sourcePath, bytes: scan.sourceBytes, integrity: scan.integrity }, tables: scan.tables.map(table => ({ name: table.tableName, rowCount: table.rowCount, rowSha256: table.rowSha256, valueSha256: table.valueSha256, columnHashes: table.columnHashes, typeCounts: table.typeCounts })) }, null, 2), 'utf8');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    try { await client.query(`UPDATE luna.sqlite_migration_runs SET status = 'failed', active = false, error = $2::text, completed_at = now() WHERE id = $1::uuid`, [run, String(error && error.message || error).slice(0, 2000)]); } catch (_) {}
    throw new Error('full SQLite migration failed at ' + currentTable + ': ' + String(error && error.message || error));
  } finally {
    client.release();
    await pool.end();
  }
}

function dryRunReport(scan, reportPath) {
  const report = {
    ok: true, mode: 'dry-run', source: { path: scan.sourcePath, bytes: scan.sourceBytes, sha256: scan.sourceSha256, integrity: scan.integrity },
    tableCount: scan.tableCount, rowCount: scan.totalRows,
    tables: scan.tables.map(table => ({ name: table.tableName, columns: table.columns, rowCount: table.rowCount, rowSha256: table.rowSha256, valueSha256: table.valueSha256, columnHashes: table.columnHashes, typeCounts: table.typeCounts }))
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const sourcePath = assertSource(options.source || process.env.MOLAN_SQLITE_PATH || path.join(process.cwd(), 'data', 'molan.db.sqlite'));
  // 生产迁移先只保留表级元数据，导入阶段逐表流式读取。
  const scan = scanSource(sourcePath, { includeRows: false });
  const reportPath = path.resolve(options.report || path.join(os.tmpdir(), 'molan-sqlite-full-' + Date.now() + '.json'));
  if (!options.apply) {
    process.stdout.write(JSON.stringify(dryRunReport(scan, reportPath)) + '\n');
    return;
  }
  const settings = readConfig(activeEnvironment());
  if (!settings.enabled) throw new Error('PostgreSQL is not configured');
  assertLocalTarget(settings);
  const result = await applyScan(scan, settings, options.runId || '', reportPath, options);
  process.stdout.write(JSON.stringify({ ...result, reportPath }) + '\n');
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('migrate-sqlite-full.mjs')) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ ok: false, code: 'sqlite_full_migration_failed', error: String(error && error.message || error) }) + '\n');
    process.exitCode = 1;
  });
}

export { scanSource, typedCell, cellFingerprint, rowKey };
