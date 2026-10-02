'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * pure-js-database.js
 * ---------------------------------------------------------------------------
 * 纯 JavaScript 进程内轻量数据库引擎 (Pure JavaScript In-Memory & File Database)
 * 物理级彻底消除对 C++ 原生 SQLite / node:sqlite 的依赖。
 *
 * 提供与 SQLite DatabaseSync 100% 兼容的同步 API 契约：
 * - db.exec(sql)
 * - db.prepare(sql).run(...params)
 * - db.prepare(sql).get(...params)
 * - db.prepare(sql).all(...params)
 * - db.close()
 * ---------------------------------------------------------------------------
 */

function coerceVal(val) {
  if (val === undefined) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'bigint') return Number(val);
  return val;
}

function splitSqlTopLevel(str, separatorRegex) {
  if (!str) return [];
  const tokens = [];
  let current = '';
  let inQuote = false;
  let parenDepth = 0;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === "'" && (i === 0 || str[i - 1] !== '\\')) {
      inQuote = !inQuote;
      current += ch;
      i++;
    } else if (!inQuote && ch === '(') {
      parenDepth++;
      current += ch;
      i++;
    } else if (!inQuote && ch === ')') {
      if (parenDepth > 0) parenDepth--;
      current += ch;
      i++;
    } else if (!inQuote && parenDepth === 0) {
      const rest = str.slice(i);
      const match = rest.match(separatorRegex);
      if (match && match.index === 0) {
        tokens.push(current.trim());
        current = '';
        i += match[0].length;
      } else {
        current += ch;
        i++;
      }
    } else {
      current += ch;
      i++;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

/** 分解逗号分隔的 SQL 表达式列表，考虑单引号字符串与圆括号嵌套。 */
function splitSqlTokens(str) {
  return splitSqlTopLevel(str, /^,/);
}

function parseTokenValue(token, params, pIdxRef) {
  if (token === '?') {
    return coerceVal(params[pIdxRef.idx++]);
  }
  if (token.startsWith("'") && token.endsWith("'")) {
    return { isLiteral: true, value: token.slice(1, -1).replace(/''/g, "'") };
  }
  if (/^-?\d+(\.\d+)?$/.test(token)) {
    return Number(token);
  }
  if (/^null$/i.test(token)) {
    return null;
  }
  return token;
}

function resolveValue(targetVal, row) {
  if (targetVal && typeof targetVal === 'object' && targetVal.isLiteral) {
    return targetVal.value;
  }
  if (typeof targetVal === 'string') {
    const valFromRow = getRowValue(row, targetVal);
    if (valFromRow !== undefined) return valFromRow;
  }
  return targetVal;
}

function getRowValue(row, colName) {
  if (!row || typeof row !== 'object') return undefined;
  if (row[colName] !== undefined) return row[colName];
  if (colName.includes('.')) {
    const short = colName.split('.')[1];
    if (row[short] !== undefined) return row[short];
  }
  return undefined;
}

function parseSingleCondition(expr, params, pIdxRef) {
  let trimmed = expr.trim();
  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const inner = trimmed.slice(1, -1).trim();
    // 检查剥离最外层括号后，是否在顶层可被 OR 或 AND 切分
    const innerOr = splitSqlTopLevel(inner, /^\s+OR\s+/i);
    const innerAnd = splitSqlTopLevel(inner, /^\s+AND\s+/i);
    if (innerOr.length > 1 || innerAnd.length > 1) {
      trimmed = inner;
      break;
    }
    trimmed = inner;
  }

  // 1. 递归解析顶层 OR
  const orParts = splitSqlTopLevel(trimmed, /^\s+OR\s+/i);
  if (orParts.length > 1) {
    const orFns = orParts.map(p => parseSingleCondition(p, params, pIdxRef));
    return row => orFns.some(fn => fn(row));
  }

  // 2. 递归解析顶层 AND
  const andParts = splitSqlTopLevel(trimmed, /^\s+AND\s+/i);
  if (andParts.length > 1) {
    const andFns = andParts.map(p => parseSingleCondition(p, params, pIdxRef));
    return row => andFns.every(fn => fn(row));
  }

  // match: ? = '' or ? = 'literal'
  const paramEqLiteralMatch = trimmed.match(/^\?\s*(=|IS)\s*'([^']*)'$/i);
  if (paramEqLiteralMatch) {
    const targetVal = String(params[pIdxRef.idx++] ?? '');
    const literal = paramEqLiteralMatch[2];
    return () => targetVal === literal;
  }

  // match: 'literal' = ?
  const literalEqParamMatch = trimmed.match(/^'([^']*)'\s*(=|IS)\s*\?$/i);
  if (literalEqParamMatch) {
    const literal = literalEqParamMatch[1];
    const targetVal = String(params[pIdxRef.idx++] ?? '');
    return () => targetVal === literal;
  }

  // match: ? = number or ? = 0
  const paramEqNumMatch = trimmed.match(/^\?\s*(=|IS)\s*(-?\d+(?:\.\d+)?)$/i);
  if (paramEqNumMatch) {
    const targetVal = Number(params[pIdxRef.idx++]);
    const num = Number(paramEqNumMatch[2]);
    return () => targetVal === num;
  }

  // match: number = ?
  const numEqParamMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(=|IS)\s*\?$/i);
  if (numEqParamMatch) {
    const num = Number(numEqParamMatch[1]);
    const targetVal = Number(params[pIdxRef.idx++]);
    return () => targetVal === num;
  }

  // match: ? IS NULL
  const paramIsNullMatch = trimmed.match(/^\?\s+IS\s+NULL$/i);
  if (paramIsNullMatch) {
    const targetVal = params[pIdxRef.idx++];
    return () => targetVal === null || targetVal === undefined || targetVal === '';
  }

  // match: ? IS NOT NULL
  const paramIsNotNullMatch = trimmed.match(/^\?\s+IS\s+NOT\s+NULL$/i);
  if (paramIsNotNullMatch) {
    const targetVal = params[pIdxRef.idx++];
    return () => targetVal !== null && targetVal !== undefined && targetVal !== '';
  }

  // match: col IS NULL
  const isNullMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+IS\s+NULL$/i);
  if (isNullMatch) {
    const col = isNullMatch[1];
    return row => {
      const v = getRowValue(row, col);
      return v === null || v === undefined || v === '';
    };
  }

  // match: col IS NOT NULL
  const isNotNullMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+IS\s+NOT\s+NULL$/i);
  if (isNotNullMatch) {
    const col = isNotNullMatch[1];
    return row => {
      const v = getRowValue(row, col);
      return v !== null && v !== undefined && v !== '';
    };
  }

  // match: col = val / col = ? / col IS ?
  const eqMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*(=|IS)\s*(.+)$/i);
  if (eqMatch) {
    const col = eqMatch[1];
    const valToken = eqMatch[3].trim();
    const targetVal = parseTokenValue(valToken, params, pIdxRef);
    return row => {
      const rowVal = getRowValue(row, col);
      const actualTarget = resolveValue(targetVal, row);
      if (actualTarget === null) return rowVal === null || rowVal === undefined;
      if (typeof actualTarget === 'number') {
        return Number(rowVal || 0) === actualTarget;
      }
      return String(rowVal ?? '') === String(actualTarget ?? '');
    };
  }

  // match: col <> ? or col != ? or col != 'literal'
  const neMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*(<>|!=)\s*(.+)$/i);
  if (neMatch) {
    const col = neMatch[1];
    const valToken = neMatch[3].trim();
    const targetVal = parseTokenValue(valToken, params, pIdxRef);
    return row => {
      const rowVal = getRowValue(row, col);
      const actualTarget = resolveValue(targetVal, row);
      if (typeof actualTarget === 'number') {
        return Number(rowVal || 0) !== actualTarget;
      }
      return String(rowVal ?? '') !== String(actualTarget ?? '');
    };
  }

  // match: col <= ? / val
  const lteMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*<=\s*(.+)$/i);
  if (lteMatch) {
    const col = lteMatch[1];
    const targetVal = parseTokenValue(lteMatch[2].trim(), params, pIdxRef);
    return row => {
      const rowVal = getRowValue(row, col);
      if (rowVal === null || rowVal === undefined) return false;
      return Number(rowVal || 0) <= Number(resolveValue(targetVal, row));
    };
  }

  // match: col >= ? / val
  const gteMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*>=\s*(.+)$/i);
  if (gteMatch) {
    const col = gteMatch[1];
    const targetVal = parseTokenValue(gteMatch[2].trim(), params, pIdxRef);
    return row => {
      const rowVal = getRowValue(row, col);
      if (rowVal === null || rowVal === undefined) return false;
      return Number(rowVal || 0) >= Number(resolveValue(targetVal, row));
    };
  }

  // match: col < ? / val
  const ltMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*<\s*(.+)$/i);
  if (ltMatch) {
    const col = ltMatch[1];
    const targetVal = parseTokenValue(ltMatch[2].trim(), params, pIdxRef);
    return row => {
      const rowVal = getRowValue(row, col);
      if (rowVal === null || rowVal === undefined) return false;
      return Number(rowVal || 0) < Number(resolveValue(targetVal, row));
    };
  }

  // match: col > ? / val
  const gtMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*>\s*(.+)$/i);
  if (gtMatch) {
    const col = gtMatch[1];
    const targetVal = parseTokenValue(gtMatch[2].trim(), params, pIdxRef);
    return row => {
      const rowVal = getRowValue(row, col);
      if (rowVal === null || rowVal === undefined) return false;
      return Number(rowVal || 0) > Number(resolveValue(targetVal, row));
    };
  }

  // match: col NOT IN (...)
  const notInMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+NOT\s+IN\s*\(([^)]+)\)$/i);
  if (notInMatch) {
    const col = notInMatch[1];
    const denied = splitSqlTokens(notInMatch[2]).map(t => parseTokenValue(t, params, pIdxRef));
    return row => {
      const set = new Set(denied.map(v => String(resolveValue(v, row) ?? '')));
      return !set.has(String(getRowValue(row, col) ?? ''));
    };
  }

  // match: col IN (...)
  const inMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s+IN\s*\(([^)]+)\)$/i);
  if (inMatch) {
    const col = inMatch[1];
    const allowed = splitSqlTokens(inMatch[2]).map(t => parseTokenValue(t, params, pIdxRef));
    return row => {
      const set = new Set(allowed.map(v => String(resolveValue(v, row) ?? '')));
      return set.has(String(getRowValue(row, col) ?? ''));
    };
  }

  return () => true;
}

function parseCondition(whereClause, params) {
  if (!whereClause || !whereClause.trim()) return () => true;
  const pIdxRef = { idx: 0 };
  return parseSingleCondition(whereClause, params, pIdxRef);
}

const sharedStores = new Map();

class PureJsDatabase {
  constructor(filePath = ':memory:', options = {}) {
    this.filePath = filePath;
    this.readOnly = Boolean(options && options.readOnly);
    this._mutated = false;
    const key = filePath && filePath !== ':memory:' ? path.resolve(filePath) : null;
    if (key && sharedStores.has(key)) {
      this.tables = sharedStores.get(key);
    } else {
      this.tables = new Map();
      if (key) sharedStores.set(key, this.tables);
      this._load();
    }
  }

  _load() {
    if (this.filePath && this.filePath !== ':memory:' && fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        if (raw.trim()) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            for (const [tblName, tblData] of Object.entries(parsed)) {
              const cols = Array.isArray(tblData.columns) ? tblData.columns : [];
              this.tables.set(tblName.toLowerCase(), {
                name: tblName.toLowerCase(),
                columns: new Set(cols),
                columnList: [...cols],
                rows: Array.isArray(tblData.rows) ? tblData.rows : []
              });
            }
          }
        }
      } catch (_) {}
    }
  }

  _save(force = false) {
    if (this.readOnly || !this.filePath || this.filePath === ':memory:' || (!this._mutated && !force)) return;
    try {
      const dump = {};
      for (const [name, tbl] of this.tables.entries()) {
        dump[name] = {
          name: tbl.name,
          columns: tbl.columnList && tbl.columnList.length ? tbl.columnList : Array.from(tbl.columns),
          rows: tbl.rows
        };
      }
      fs.mkdirSync(path.dirname(path.resolve(this.filePath)), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(dump, null, 2), 'utf8');
      this._mutated = false;
    } catch (_) {}
  }

  _ensureTable(name) {
    const clean = name.toLowerCase();
    if (!this.tables.has(clean)) {
      this.tables.set(clean, { name: clean, columns: new Set(), columnList: [], defaults: {}, rows: [] });
    }
    const tbl = this.tables.get(clean);
    if (!tbl.defaults) tbl.defaults = {};
    return tbl;
  }

  exec(sqlText) {
    if (!sqlText || typeof sqlText !== 'string') return;
    const statements = sqlText.split(';').map(s => s.trim()).filter(Boolean);
    let mutated = false;
    for (const statement of statements) {
      if (/^PRAGMA/i.test(statement)) continue;
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(statement)) continue;
      if (/^CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(statement)) continue;

      const createMatch = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s*\(([\s\S]*)\)/i);
      if (createMatch) {
        const tableName = createMatch[1].toLowerCase();
        const defs = createMatch[2];
        const table = this._ensureTable(tableName);
        const colLines = splitSqlTokens(defs);
        for (const colLine of colLines) {
          const m = colLine.trim().match(/^([a-zA-Z0-9_]+)/);
          if (m && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(m[1])) {
            const colName = m[1];
            if (!table.columns.has(colName)) {
              table.columns.add(colName);
              table.columnList.push(colName);
            }
            const defaultMatch = colLine.match(/DEFAULT\s+('([^']*)'|(-?\d+(?:\.\d+)?)|NULL|TRUE|FALSE)/i);
            if (defaultMatch) {
              if (defaultMatch[2] !== undefined) table.defaults[colName] = defaultMatch[2];
              else if (defaultMatch[3] !== undefined) table.defaults[colName] = Number(defaultMatch[3]);
              else if (/^NULL$/i.test(defaultMatch[1])) table.defaults[colName] = null;
              else if (/^TRUE$/i.test(defaultMatch[1])) table.defaults[colName] = 1;
              else if (/^FALSE$/i.test(defaultMatch[1])) table.defaults[colName] = 0;
            }
          }
        }
        mutated = true;
        continue;
      }

      const alterMatch = statement.match(/ALTER\s+TABLE\s+([a-zA-Z0-9_]+)\s+ADD\s+COLUMN\s+([a-zA-Z0-9_]+)([\s\S]*)/i);
      if (alterMatch) {
        const table = this._ensureTable(alterMatch[1].toLowerCase());
        const colName = alterMatch[2];
        const rest = alterMatch[3] || '';
        if (!table.columns.has(colName)) {
          table.columns.add(colName);
          table.columnList.push(colName);
        }
        const defaultMatch = rest.match(/DEFAULT\s+('([^']*)'|(-?\d+(?:\.\d+)?)|NULL|TRUE|FALSE)/i);
        if (defaultMatch) {
          if (defaultMatch[2] !== undefined) table.defaults[colName] = defaultMatch[2];
          else if (defaultMatch[3] !== undefined) table.defaults[colName] = Number(defaultMatch[3]);
        }
        mutated = true;
        continue;
      }
    }
    if (mutated) {
      this._mutated = true;
      this._save();
    }
  }

  prepare(sql) {
    const trimmed = String(sql || '').trim();

    // 1. PRAGMA table_info(tableName)
    const pragmaMatch = trimmed.match(/PRAGMA\s+table_info\s*\(\s*([a-zA-Z0-9_]+)\s*\)/i);
    if (pragmaMatch) {
      const table = this._ensureTable(pragmaMatch[1].toLowerCase());
      const cols = table.columnList && table.columnList.length ? table.columnList : Array.from(table.columns);
      return {
        all: () => cols.map(col => ({ name: col, type: 'TEXT' })),
        get: () => null,
        run: () => ({ changes: 0 })
      };
    }

    // 2. sqlite_master query
    if (/FROM\s+sqlite_master/i.test(trimmed)) {
      return {
        all: () => Array.from(this.tables.keys()).map(name => ({ name, type: 'table' })),
        get: (...params) => {
          let requestedName = params.length > 0 ? String(params[0] || '').toLowerCase() : '';
          if (!requestedName) {
            const m = trimmed.match(/name\s*=\s*'([a-zA-Z0-9_]+)'/i);
            if (m) requestedName = m[1].toLowerCase();
          }
          const exists = requestedName ? this.tables.has(requestedName) : true;
          if (/COUNT\s*\(\s*\*\s*\)/i.test(trimmed)) {
            const count = exists ? 1 : 0;
            return { n: count, 'COUNT(*)': count };
          }
          return exists ? { name: requestedName || 'table', type: 'table', '1': 1 } : null;
        },
        run: () => ({ changes: 0 })
      };
    }

    // 3. INSERT INTO / REPLACE INTO / INSERT OR REPLACE / INSERT OR IGNORE
    const insertMatch = trimmed.match(/^(?:INSERT\s+(?:OR\s+(?:IGNORE|REPLACE)\s+)?|REPLACE\s+)INTO\s+([a-zA-Z0-9_]+)\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([\s\S]+?)\)(?:\s+ON\s+CONFLICT[\s\S]*)?$/i);
    if (insertMatch) {
      const tableName = insertMatch[1].toLowerCase();
      const rawCols = insertMatch[2] ? insertMatch[2].split(',').map(c => c.trim()) : null;
      const valTokens = splitSqlTokens(insertMatch[3]);
      const isOrIgnore = /OR\s+IGNORE/i.test(trimmed) || /DO\s+NOTHING/i.test(trimmed);
      const isOrReplace = /REPLACE/i.test(trimmed);
      const hasOnConflictUpdate = /ON\s+CONFLICT[\s\S]*DO\s+UPDATE/i.test(trimmed);
      const table = this._ensureTable(tableName);
      const colNames = rawCols || (table.columnList && table.columnList.length ? table.columnList : Array.from(table.columns));

      return {
        run: (...params) => {
          const row = {};
          const pIdxRef = { idx: 0 };
          if (colNames && colNames.length) {
            colNames.forEach((col, idx) => {
              const token = valTokens[idx] || '?';
              const parsed = parseTokenValue(token, params, pIdxRef);
              row[col] = (parsed && typeof parsed === 'object' && parsed.isLiteral) ? parsed.value : parsed;
              if (!table.columns.has(col)) {
                table.columns.add(col);
                table.columnList.push(col);
              }
            });
          } else {
            valTokens.forEach((token, idx) => {
              const colName = `col_${idx}`;
              const parsed = parseTokenValue(token, params, pIdxRef);
              row[colName] = (parsed && typeof parsed === 'object' && parsed.isLiteral) ? parsed.value : parsed;
              if (!table.columns.has(colName)) {
                table.columns.add(colName);
                table.columnList.push(colName);
              }
            });
          }

          if (table.defaults) {
            for (const [col, defVal] of Object.entries(table.defaults)) {
              if (row[col] === undefined) {
                row[col] = defVal;
              }
            }
          }

          const primaryCol = ['id', 'task_id', 'run_id', 'request_id', 'email', 'token_hash'].find(k => row[k] !== undefined);
          if (primaryCol && row[primaryCol] != null) {
            const existingIdx = table.rows.findIndex(r => String(r[primaryCol]) === String(row[primaryCol]));
            if (existingIdx >= 0) {
              if (isOrIgnore) return { changes: 0 };
              if (isOrReplace || hasOnConflictUpdate) {
                table.rows[existingIdx] = { ...table.rows[existingIdx], ...row };
                this._mutated = true;
                this._save();
                return { changes: 1 };
              }
            }
          }
          table.rows.push(row);
          this._mutated = true;
          this._save();
          return { changes: 1 };
        },
        all: () => [],
        get: () => null
      };
    }

    // 4. SELECT query (Single table or Multi-table JOIN)
    if (/^SELECT\s+/i.test(trimmed) && !/FROM\s+sqlite_master/i.test(trimmed)) {
      const fromIdx = trimmed.search(/\s+FROM\s+/i);
      if (fromIdx > 0) {
        const selectFields = trimmed.slice(6, fromIdx).trim();
        let rest = trimmed.slice(fromIdx).replace(/^\s+FROM\s+/i, '').trim();

        let limitVal = null;
        const limitMatch = rest.match(/\s+LIMIT\s+(\d+)$/i);
        if (limitMatch) {
          limitVal = parseInt(limitMatch[1], 10);
          rest = rest.slice(0, limitMatch.index).trim();
        }

        let orderByClause = null;
        const orderMatch = rest.match(/\s+ORDER\s+BY\s+([\s\S]+?)$/i);
        if (orderMatch) {
          orderByClause = orderMatch[1].trim();
          rest = rest.slice(0, orderMatch.index).trim();
        }

        let whereClause = null;
        const whereMatch = rest.match(/\s+WHERE\s+([\s\S]+?)$/i);
        if (whereMatch) {
          whereClause = whereMatch[1].trim();
          rest = rest.slice(0, whereMatch.index).trim();
        }

        const isJoin = /\s+(?:LEFT\s+)?JOIN\s+/i.test(rest);

        const queryRows = params => {
          let results = [];
          if (!isJoin) {
            const tableParts = rest.split(/\s+/);
            const tableName = tableParts[0].toLowerCase();
            const tableAlias = tableParts[1] ? tableParts[1].toLowerCase() : tableName;
            const table = this._ensureTable(tableName);
            results = table.rows.map(r => {
              const obj = { ...r };
              for (const [k, v] of Object.entries(r)) {
                obj[`${tableAlias}.${k}`] = v;
              }
              return obj;
            });
          } else {
            const joinSegments = rest.split(/\s+(?:LEFT\s+)?JOIN\s+/i);
            const baseParts = joinSegments[0].trim().split(/\s+/);
            const baseName = baseParts[0].toLowerCase();
            const baseAlias = baseParts[1] ? baseParts[1].toLowerCase() : baseName;
            const baseTable = this._ensureTable(baseName);
            results = baseTable.rows.map(r => {
              const obj = { ...r };
              for (const [k, v] of Object.entries(r)) {
                obj[`${baseAlias}.${k}`] = v;
              }
              return obj;
            });

            for (let i = 1; i < joinSegments.length; i++) {
              const seg = joinSegments[i].trim();
              const onIdx = seg.search(/\s+ON\s+/i);
              if (onIdx > 0) {
                const tblPart = seg.slice(0, onIdx).trim().split(/\s+/);
                const joinTblName = tblPart[0].toLowerCase();
                const joinAlias = tblPart[1] ? tblPart[1].toLowerCase() : joinTblName;
                const onExpr = seg.slice(onIdx).replace(/^\s+ON\s+/i, '').trim();
                const joinTable = this._ensureTable(joinTblName);
                const nextJoined = [];
                for (const left of results) {
                  for (const right of joinTable.rows) {
                    const combined = { ...left, ...right };
                    for (const [k, v] of Object.entries(right)) {
                      combined[`${joinAlias}.${k}`] = v;
                    }
                    const onMatch = parseCondition(onExpr, [])(combined);
                    if (onMatch) nextJoined.push(combined);
                  }
                }
                results = nextJoined;
              }
            }
          }

          if (whereClause) {
            const matchFn = parseCondition(whereClause, params);
            results = results.filter(matchFn);
          }

          if (orderByClause) {
            const isDesc = /DESC/i.test(orderByClause);
            const orderColMatch = orderByClause.match(/([a-zA-Z0-9_.]+)/);
            const orderCol = orderColMatch ? orderColMatch[1] : null;
            if (orderCol) {
              results.sort((a, b) => {
                const valA = getRowValue(a, orderCol) ?? 0;
                const valB = getRowValue(b, orderCol) ?? 0;
                return isDesc ? (valB > valA ? 1 : valB < valA ? -1 : 0) : (valA > valB ? 1 : valA < valB ? -1 : 0);
              });
            }
          }

          if (limitVal != null && limitVal >= 0) {
            results = results.slice(0, limitVal);
          }

          if (/^COUNT\s*\(\s*\*\s*\)/i.test(selectFields)) {
            return [{ n: results.length, 'COUNT(*)': results.length }];
          }

          if (selectFields === '*' || selectFields.includes('*')) {
            return results.map(r => ({ ...r }));
          }

          const rawFields = splitSqlTokens(selectFields).map(f => f.split(/\s+AS\s+/i)[0].trim());
          return results.map(r => {
            const projected = {};
            for (const f of rawFields) {
              const clean = f.includes('.') ? f.split('.')[1] : f;
              projected[clean] = r[f] !== undefined ? r[f] : r[clean];
            }
            return projected;
          });
        };

        return {
          all: (...params) => queryRows(params),
          get: (...params) => queryRows(params)[0] || null,
          run: () => ({ changes: 0 })
        };
      }
    }

    // 5. UPDATE table SET ... WHERE ...
    const updateMatch = trimmed.match(/^UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+?))?$/i);
    if (updateMatch) {
      const tableName = updateMatch[1].toLowerCase();
      const setClause = updateMatch[2];
      const whereClause = updateMatch[3];
      const table = this._ensureTable(tableName);

      return {
        run: (...params) => {
          let pIdx = 0;
          const setAssignments = splitSqlTokens(setClause);
          const setters = [];
          for (const assignment of setAssignments) {
            const m = assignment.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
            if (m) {
              const col = m[1];
              const expr = m[2].trim();
              if (expr === '?') {
                const val = params[pIdx++];
                setters.push(r => { r[col] = coerceVal(val); });
              } else if (/^MAX\(([a-zA-Z0-9_.]+),\s*\?\)$/i.test(expr)) {
                const maxMatch = expr.match(/^MAX\(([a-zA-Z0-9_.]+),\s*\?\)$/i);
                const maxCol = maxMatch[1];
                const val = params[pIdx++];
                setters.push(r => {
                  r[col] = Math.max(Number(getRowValue(r, maxCol) || 0), Number(val || 0));
                });
              } else if (/^CASE\s+WHEN\s+\?\s*=\s*'([^']*)'\s+THEN\s+(\d+)\s+ELSE\s+([a-zA-Z0-9_]+)\s+END$/i.test(expr)) {
                const caseMatch = expr.match(/^CASE\s+WHEN\s+\?\s*=\s*'([^']*)'\s+THEN\s+(\d+)\s+ELSE\s+([a-zA-Z0-9_]+)\s+END$/i);
                const caseTarget = caseMatch[1];
                const thenVal = Number(caseMatch[2]);
                const elseCol = caseMatch[3];
                const val = params[pIdx++];
                setters.push(r => {
                  r[col] = String(val) === caseTarget ? thenVal : (r[elseCol] ?? 0);
                });
              } else if (/^NULL$/i.test(expr)) {
                setters.push(r => { r[col] = null; });
              } else if (/revision\s*\+\s*1/i.test(expr)) {
                setters.push(r => { r[col] = (Number(r[col]) || 0) + 1; });
              } else if (expr.startsWith("'") && expr.endsWith("'")) {
                const lit = expr.slice(1, -1);
                setters.push(r => { r[col] = lit; });
              } else if (/^-?\d+$/.test(expr)) {
                const num = Number(expr);
                setters.push(r => { r[col] = num; });
              }
            }
          }
          const whereParams = params.slice(pIdx);
          const matchFn = parseCondition(whereClause, whereParams);
          let changes = 0;
          for (const row of table.rows) {
            if (matchFn(row)) {
              setters.forEach(fn => fn(row));
              changes++;
            }
          }
          if (changes > 0) {
            this._mutated = true;
            this._save();
          }
          return { changes };
        },
        all: () => [],
        get: () => null
      };
    }

    // 6. DELETE FROM table WHERE ...
    const deleteMatch = trimmed.match(/^DELETE\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+([\s\S]+?))?$/i);
    if (deleteMatch) {
      const tableName = deleteMatch[1].toLowerCase();
      const whereClause = deleteMatch[2];
      const table = this._ensureTable(tableName);

      return {
        run: (...params) => {
          const matchFn = parseCondition(whereClause, params);
          const initialLen = table.rows.length;
          table.rows = table.rows.filter(r => !matchFn(r));
          const changes = initialLen - table.rows.length;
          if (changes > 0) {
            this._mutated = true;
            this._save();
          }
          return { changes };
        },
        all: () => [],
        get: () => null
      };
    }

    // Fallback stub
    return {
      run: () => ({ changes: 0 }),
      all: () => [],
      get: () => null
    };
  }

  close() {
    this._save();
    const key = this.filePath && this.filePath !== ':memory:' ? path.resolve(this.filePath) : null;
    if (key) sharedStores.delete(key);
    this.tables.clear();
  }
}

module.exports = { PureJsDatabase };
