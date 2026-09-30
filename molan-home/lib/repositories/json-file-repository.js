'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'molan-json-repository-v1';
const DOMAINS = Object.freeze(['accounts', 'novels', 'memory', 'styles', 'generation', 'ledger']);
const copy = value => structuredClone(value);
function error(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status, statusCode: status });
}
function identifier(value) {
  const id = String(value || '');
  if (!id || id.length > 256) throw error('INVALID_ID', '记录标识无效', 422);
  return id;
}
function fileKey(value) {
  return crypto.createHash('sha256').update(identifier(value)).digest('hex');
}

/** 单进程原生 JSON 仓储。所有提交先记录完整 redo 日志，再替换文件。 */
class JsonFileRepository {
  constructor(directory, options = {}) {
    this.directory = path.resolve(directory);
    this.io = options.fs || fs;
    this.queue = Promise.resolve();
    this.closed = false;
    this.poisoned = false;
    this.lockPath = path.join(this.directory, '.writer.lock');
    this.journalPath = path.join(this.directory, '.commit.json');
    this.io.mkdirSync(this.directory, { recursive: true });
    this.token = crypto.randomUUID();
    this.acquireLock();
    try { this.recover(); } catch (failure) { this.releaseLock(); throw failure; }
    for (const domain of DOMAINS) this[domain] = this.domain(domain);
  }

  acquireLock() {
    const tryLock = () => {
      const fd = this.io.openSync(this.lockPath, 'wx');
      try { this.io.writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.token }), 'utf8'); this.io.fsyncSync(fd); }
      finally { this.io.closeSync(fd); }
    };
    try { tryLock(); } catch (failure) {
      if (failure.code !== 'EEXIST') throw failure;
      let owner;
      try { owner = JSON.parse(this.io.readFileSync(this.lockPath, 'utf8')); }
      catch (_) { throw error('REPOSITORY_LOCKED', '锁文件损坏，需人工检查'); }
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw error('REPOSITORY_LOCKED', '锁文件无效，需人工检查');
      try { process.kill(owner.pid, 0); throw error('REPOSITORY_LOCKED', '本地仓储已被其他实例占用'); }
      catch (check) { if (check.code !== 'ESRCH') throw check; }
      // 仅清理已确认死亡的进程锁；wx 仍负责竞争仲裁。
      this.io.unlinkSync(this.lockPath);
      tryLock();
    }
  }

  releaseLock() {
    const owner = JSON.parse(this.io.readFileSync(this.lockPath, 'utf8'));
    if (owner.token !== this.token) throw error('REPOSITORY_LOCK_LOST', '本地仓储锁已改变');
    this.io.unlinkSync(this.lockPath);
  }

  check() {
    if (this.closed) throw error('REPOSITORY_CLOSED', '仓储已关闭');
    if (this.poisoned) throw error('REPOSITORY_RECOVERY_REQUIRED', '提交中断，须重启恢复后继续');
  }

  relative(scope) { return scope === null ? 'accounts.json' : `novels/${fileKey(scope)}.json`; }
  blank(scope) { return { schemaVersion: VERSION, scope, revision: 0, domains: {} }; }
  read(scope) {
    this.check();
    const filename = path.join(this.directory, this.relative(scope));
    let text;
    try { text = this.io.readFileSync(filename, 'utf8'); }
    catch (failure) { if (failure.code === 'ENOENT') return this.blank(scope); throw failure; }
    let document;
    try { document = JSON.parse(text); }
    catch (_) { throw error('REPOSITORY_CORRUPT', `JSON 文件损坏：${filename}`, 500); }
    if (!document || document.schemaVersion !== VERSION || document.scope !== scope ||
        !Number.isSafeInteger(document.revision) || document.revision < 0 || !document.domains ||
        typeof document.domains !== 'object' || Array.isArray(document.domains)) {
      throw error('REPOSITORY_CORRUPT', `仓储文件结构无效：${filename}`, 500);
    }
    return document;
  }

  atomicWrite(filename, content) {
    this.io.mkdirSync(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
    const fd = this.io.openSync(temporary, 'wx');
    try {
      this.io.writeFileSync(fd, content, 'utf8');
      this.io.fsyncSync(fd);
    } finally { this.io.closeSync(fd); }
    try { this.io.renameSync(temporary, filename); }
    catch (failure) { try { this.io.unlinkSync(temporary); } catch (_) {} throw failure; }
  }

  validateJournal(journal) {
    if (!journal || journal.schemaVersion !== VERSION || !Array.isArray(journal.writes) || !journal.writes.length) {
      throw error('REPOSITORY_JOURNAL_CORRUPT', '提交日志无效', 500);
    }
    const names = new Set();
    for (const item of journal.writes) {
      if (!item || !/^(accounts\.json|novels\/[a-f0-9]{64}\.json)$/.test(item.path) || names.has(item.path)) {
        throw error('REPOSITORY_JOURNAL_CORRUPT', '提交日志路径无效', 500);
      }
      names.add(item.path);
      const document = item.document;
      if (!document || document.schemaVersion !== VERSION || this.relative(document.scope) !== item.path ||
          !Number.isSafeInteger(document.revision) || document.revision < 1 || !document.domains ||
          typeof document.domains !== 'object' || Array.isArray(document.domains)) {
        throw error('REPOSITORY_JOURNAL_CORRUPT', '提交日志数据无效', 500);
      }
    }
  }

  recover() {
    let journal;
    try { journal = JSON.parse(this.io.readFileSync(this.journalPath, 'utf8')); }
    catch (failure) { if (failure.code === 'ENOENT') return; throw error('REPOSITORY_JOURNAL_CORRUPT', '提交日志不可读', 500); }
    this.validateJournal(journal);
    for (const item of journal.writes) this.atomicWrite(path.join(this.directory, item.path), JSON.stringify(item.document));
    this.io.unlinkSync(this.journalPath);
  }

  /** callback 返回前所有更改只存在隔离副本中；日志落盘后失败必须启动恢复。 */
  transaction(scopes, callback, expectedRevisions = {}) {
    const work = async () => {
      this.check();
      const keys = [...new Set(scopes.map(scope => scope === null ? null : identifier(scope)))];
      if (!keys.length) throw error('INVALID_TRANSACTION', '事务必须指定作用域', 422);
      const documents = new Map(keys.map(scope => [scope, this.read(scope)]));
      const dirty = new Set();
      for (const [scope, document] of documents) {
        const key = scope === null ? 'accounts' : scope;
        if (Object.hasOwn(expectedRevisions, key) && document.revision !== expectedRevisions[key]) {
          throw error('REVISION_CONFLICT', '仓储版本已改变');
        }
      }
      const table = (scope, domain) => {
        if (!DOMAINS.includes(domain) || !documents.has(scope) || (domain === 'accounts') !== (scope === null)) {
          throw error('INVALID_SCOPE', '记录不属于事务作用域', 422);
        }
        const document = documents.get(scope);
        return document.domains[domain] || (document.domains[domain] = {});
      };
      const tx = {
        get: (scope, domain, id) => copy(table(scope, domain)[fileKey(id)] || null),
        list: (scope, domain) => copy(Object.values(table(scope, domain))),
        put: (scope, domain, value, expectedRevision) => {
          const id = identifier(value && value.id);
          const records = table(scope, domain);
          const old = records[fileKey(id)];
          if (expectedRevision !== undefined && Number(old && old.revision || 0) !== expectedRevision) throw error('REVISION_CONFLICT', '记录版本已改变');
          if (domain === 'ledger' && old) throw error('IMMUTABLE_LEDGER', '账本记录不可修改');
          const next = { ...copy(value), id, revision: Number(old && old.revision || 0) + 1 };
          records[fileKey(id)] = next;
          dirty.add(scope);
          return copy(next);
        },
        remove: (scope, domain, id, expectedRevision) => {
          if (domain === 'ledger') throw error('IMMUTABLE_LEDGER', '账本记录不可删除');
          const records = table(scope, domain);
          const old = records[fileKey(id)];
          if (!old) return null;
          return tx.put(scope, domain, { ...old, deleted: true }, expectedRevision);
        }
      };
      const result = copy(await callback(tx));
      if (!dirty.size) return result;
      const writes = [...dirty].map(scope => {
        const document = documents.get(scope);
        document.revision++;
        return { path: this.relative(scope), document };
      });
      const journal = { schemaVersion: VERSION, transactionId: crypto.randomUUID(), writes };
      this.validateJournal(journal);
      try {
        this.atomicWrite(this.journalPath, JSON.stringify(journal));
        for (const item of writes) this.atomicWrite(path.join(this.directory, item.path), JSON.stringify(item.document));
        this.io.unlinkSync(this.journalPath);
      } catch (failure) {
        this.poisoned = this.io.existsSync(this.journalPath);
        throw failure;
      }
      return result;
    };
    const pending = this.queue.then(work);
    this.queue = pending.catch(() => {});
    return pending;
  }

  domain(name) {
    const scopeFor = projectId => name === 'accounts' ? null : identifier(projectId);
    return Object.freeze({
      get: async (projectId, id) => {
        await this.queue; const scope = scopeFor(projectId);
        return copy(this.read(scope).domains[name]?.[fileKey(id)] || null);
      },
      list: async projectId => {
        await this.queue;
        return copy(Object.values(this.read(scopeFor(projectId)).domains[name] || {}));
      },
      put: (projectId, record, revision) => {
        const scope = scopeFor(projectId);
        return this.transaction([scope], tx => tx.put(scope, name, record, revision));
      },
      remove: (projectId, id, revision) => {
        const scope = scopeFor(projectId);
        return this.transaction([scope], tx => tx.remove(scope, name, id, revision));
      }
    });
  }

  async close() {
    await this.queue;
    if (this.closed) return;
    this.releaseLock();
    this.closed = true;
  }
}

module.exports = { JsonFileRepository, DOMAINS, VERSION };
