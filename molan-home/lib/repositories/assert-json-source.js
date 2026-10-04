'use strict';
const fs = require('node:fs');

/** 旧兼容缓存打开前的只读检查，防止把真实旧库或损坏文件覆盖为空 JSON。 */
function assertJsonSource(filename, options = {}) {
  if (!filename || filename === ':memory:') return;
  let fd;
  try { fd = fs.openSync(filename, 'r'); }
  catch (failure) { if (failure.code === 'ENOENT') return; throw failure; }
  let header;
  try {
    header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
  } finally { fs.closeSync(fd); }
  if (header.toString('utf8') === 'SQLite format 3\0') {
    if (options.resetLegacy) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.rmSync(filename + suffix, { force: true }); } catch (_) {}
      }
      return;
    }
    throw Object.assign(new Error('检测到旧 SQLite 库；请先使用隔离迁移工具导出，禁止直接覆盖'), { code: 'LEGACY_SQLITE_REQUIRES_MIGRATION' });
  }
  let document;
  try { document = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (failure) {
    if (failure.code && failure.code !== 'ENOENT') throw failure;
    throw Object.assign(new Error('本地 JSON 缓存文件损坏，拒绝以空库启动'), { code: 'JSON_STORE_CORRUPT' });
  }
  if (!document || typeof document !== 'object' || Array.isArray(document) ||
      Object.values(document).some(table => !table || typeof table !== 'object' ||
        !Array.isArray(table.columns) || !Array.isArray(table.rows))) {
    throw Object.assign(new Error('本地 JSON 缓存结构无效，拒绝以空库启动'), { code: 'JSON_STORE_CORRUPT' });
  }
}

module.exports = { assertJsonSource };
