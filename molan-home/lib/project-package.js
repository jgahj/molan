'use strict';

const crypto = require('node:crypto');

const PACKAGE_FORMAT = 'molan-project-package';
const PACKAGE_VERSION = 1;
const PACKAGE_ENCODING = 'UTF-8';
const HASH_ALGORITHM = 'sha256';
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILE_COUNT = 10000;
const OMIT = Symbol('omit');

const MANIFEST_KEYS = new Set([
  'format',
  'packageVersion',
  'schemaVersion',
  'encoding',
  'hashAlgorithm',
  'scope',
  'createdBy',
  'fileCount',
  'totalByteLength',
  'files',
  'fileHashes',
  'bodyHashes',
  'collections',
  'packageId',
  'extensions'
]);

const DESCRIPTOR_KEYS = new Set([
  'path',
  'kind',
  'schema',
  'encoding',
  'hashAlgorithm',
  'sha256',
  'textSha256',
  'byteLength',
  'stableId',
  'createdBy',
  'collection',
  'collectionShape',
  'mapKey',
  'order',
  'sourceFile',
  'sourcePointer',
  'extensions'
]);

const BODY_KEYS = new Set([
  'body',
  'content',
  'draft',
  'manuscript',
  'markdown',
  'plainText',
  'prose',
  'rawText',
  'text',
  '正文',
  '正文内容'
]);

const ROOT_COLLECTION_KEYS = new Set([
  'assets',
  'characters',
  'character',
  'world',
  'worlds',
  'outline',
  'outlines',
  'relations',
  'relationships',
  'foreshadowing',
  'foreshadows',
  'timeline',
  'timelines',
  'materials',
  'creativeAssets',
  'creationAssets',
  'items',
  'records',
  'entries',
  'versions'
]);

const SENSITIVE_WORDS = new Set([
  'token',
  'password',
  'passwd',
  'secret',
  'session',
  'cookie',
  'authorization',
  'credential'
]);
const FOREIGN_CONTAINER_PATTERN = /^(?:other|foreign|cross|external)(?:project|projects|workspace|workspaces|data)$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

class ProjectPackageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProjectPackageError';
    this.code = code;
    this.details = details;
  }
}

/** 判断值是否为可安全处理的普通JSON对象。 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 以不触发原型 setter 的方式写入可枚举字段。 */
function setOwn(object, key, value) {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value
  });
  return object;
}

/** 判断字段名是否可能承载认证凭据或会话信息。 */
function isSensitiveKey(key) {
  const normalized = String(key)
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[-]/g, '_')
    .toLowerCase();
  const compact = normalized.replace(/_/g, '');
  const parts = normalized.split('_').filter(Boolean);
  return parts.some(part => SENSITIVE_WORDS.has(part)) ||
    ['apikey', 'privatekey', 'clientsecret', 'refreshtoken', 'accesstoken'].some(prefix => compact.startsWith(prefix));
}

/** 判断字段名是否明确表示其他项目或工作区数据集合。 */
function isForeignContainerKey(key) {
  const normalized = String(key).replace(/[_-]/g, '');
  return FOREIGN_CONTAINER_PATTERN.test(String(key)) ||
    normalized === 'allprojects' ||
    normalized === 'allworkspaces' ||
    normalized === 'otherprojectdata' ||
    normalized === 'foreignprojectdata' ||
    normalized === 'crossprojectdata';
}

/** 把输入值转换为不含凭据且可写入JSON包的副本。 */
function sanitizeForExport(value, path = '$', seen = new WeakSet(), depth = 0) {
  if (depth > 100) throw new ProjectPackageError('data_depth_exceeded', `数据层级超过限制：${path}`);
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ProjectPackageError('non_json_value', `数据包含不可序列化数字：${path}`);
    return value;
  }
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new ProjectPackageError('non_json_value', `数据包含不可序列化值：${path}`);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      type: 'binary',
      encoding: 'base64',
      data: Buffer.from(value).toString('base64')
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) throw new ProjectPackageError('cyclic_data', `数据包含循环引用：${path}`);
  if (Array.isArray(value)) {
    seen.add(value);
    const output = value.map((item, index) => sanitizeForExport(item, `${path}[${index}]`, seen, depth + 1));
    seen.delete(value);
    return output;
  }
  if (!isPlainObject(value)) throw new ProjectPackageError('non_json_value', `数据包含不支持的对象类型：${path}`);
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key) || isForeignContainerKey(key)) continue;
    const safeValue = sanitizeForExport(value[key], `${path}.${key}`, seen, depth + 1);
    if (safeValue !== OMIT) setOwn(output, key, safeValue);
  }
  seen.delete(value);
  return output;
}

/** 将JSON值按递归字段名排序，确保相同数据产生相同字节序列。 */
function canonicalizeJson(value, seen = new WeakSet(), depth = 0) {
  if (depth > 100) throw new ProjectPackageError('data_depth_exceeded', 'JSON层级超过限制');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ProjectPackageError('non_json_value', 'JSON包含不可序列化数字');
    return value;
  }
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      type: 'binary',
      encoding: 'base64',
      data: Buffer.from(value).toString('base64')
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new ProjectPackageError('non_json_value', 'JSON包含不可序列化值');
  }
  if (seen.has(value)) throw new ProjectPackageError('cyclic_data', 'JSON包含循环引用');
  if (Array.isArray(value)) {
    seen.add(value);
    const output = value.map(item => canonicalizeJson(item, seen, depth + 1));
    seen.delete(value);
    return output;
  }
  if (!isPlainObject(value)) throw new ProjectPackageError('non_json_value', 'JSON包含不支持的对象类型');
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    setOwn(output, key, canonicalizeJson(value[key], seen, depth + 1));
  }
  seen.delete(value);
  return output;
}

/** 生成固定UTF-8、末尾换行的规范JSON文本。 */
function canonicalJson(value) {
  return `${JSON.stringify(canonicalizeJson(value))}\n`;
}

/** 按固定SHA-256规则计算字符串、字节或JSON值的哈希。 */
function sha256(value) {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : Buffer.from(canonicalJson(value), 'utf8');
  return crypto.createHash(HASH_ALGORITHM).update(bytes).digest('hex');
}

/** 规范化并校验作用域ID，避免空值、控制字符和超长标识进入包。 */
function normalizeId(value, fieldName) {
  const normalized = typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
  if (!normalized) throw new ProjectPackageError('invalid_scope', `${fieldName}不能为空`);
  if (normalized.length > 256 || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new ProjectPackageError('invalid_scope', `${fieldName}格式无效`);
  }
  return normalized;
}

/** 创建导出包使用的多用户作用域摘要。 */
function normalizeScope(input) {
  if (!isPlainObject(input)) throw new ProjectPackageError('invalid_scope', 'scope必须是对象');
  return {
    projectId: normalizeId(input.projectId, 'projectId'),
    workspaceId: normalizeId(input.workspaceId, 'workspaceId'),
    ownerUserId: normalizeId(input.ownerUserId, 'ownerUserId')
  };
}

/** 把字段名归类为项目作用域或工作区作用域字段。 */
function classifyScopeKey(key) {
  const normalized = String(key).replace(/[_-]/g, '').toLowerCase();
  if (/^(?:source|target|from|to|related|linked|parent|root)?projectids?$/.test(normalized) ||
    normalized === 'projectref' ||
    normalized === 'projectrefs') return 'project';
  if (/^(?:source|target|from|to|related|linked|parent|root)?workspaceids?$/.test(normalized) ||
    normalized === 'workspaceref' ||
    normalized === 'workspacerefs') return 'workspace';
  return '';
}

/** 收集数据中不属于当前源项目的显式作用域引用。 */
function collectScopeIssues(value, expectedScope, path, issues, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectScopeIssues(item, expectedScope, `${path}[${index}]`, issues, seen));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    const childValue = value[key];
    const scopeKind = classifyScopeKey(key);
    if (scopeKind) {
      const expectedId = scopeKind === 'project' ? expectedScope.projectId : expectedScope.workspaceId;
      collectScopedValueIssues(childValue, expectedId, `${path}.${key}`, issues);
    }
    collectScopeIssues(childValue, expectedScope, `${path}.${key}`, issues, seen);
  }
}

/** 检查单个作用域字段中的字符串、数组和引用对象。 */
function collectScopedValueIssues(value, expectedId, path, issues) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectScopedValueIssues(item, expectedId, `${path}[${index}]`, issues));
    return;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    if (String(value) !== expectedId) {
      issues.push({
        code: 'scope_conflict',
        path,
        message: `作用域引用${String(value)}不属于${expectedId}`
      });
    }
    return;
  }
  if (value !== null && typeof value !== 'undefined') {
    issues.push({
      code: 'scope_conflict',
      path,
      message: '作用域引用必须是字符串或字符串数组'
    });
  }
}

/** 将已校验的项目和工作区字段重映射到导入目标作用域。 */
function rewriteScope(value, sourceScope, targetScope, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new ProjectPackageError('cyclic_data', '导入数据包含循环引用');
  if (Array.isArray(value)) {
    seen.add(value);
    const output = value.map(item => rewriteScope(item, sourceScope, targetScope, seen));
    seen.delete(value);
    return output;
  }
  if (!isPlainObject(value)) return value;
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value)) {
    const scopeKind = classifyScopeKey(key);
    const childValue = value[key];
    if (scopeKind === 'project') {
      setOwn(output, key, rewriteScopedValue(childValue, sourceScope.projectId, targetScope.projectId));
    } else if (scopeKind === 'workspace') {
      setOwn(output, key, rewriteScopedValue(childValue, sourceScope.workspaceId, targetScope.workspaceId));
    } else {
      setOwn(output, key, rewriteScope(childValue, sourceScope, targetScope, seen));
    }
  }
  seen.delete(value);
  return output;
}

/** 重写作用域字段中的单值或数组值。 */
function rewriteScopedValue(value, sourceId, targetId) {
  if (Array.isArray(value)) return value.map(item => rewriteScopedValue(item, sourceId, targetId));
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value) === sourceId ? targetId : String(value);
  }
  return value;
}

/** 从实体记录中取得用户提供的稳定ID，缺失时按内容生成确定性ID。 */
function getStableId(value, category, fallbackKey = '') {
  if (isPlainObject(value)) {
    for (const candidateKey of ['stableId', 'stableID', 'entityId', 'id', 'uid', 'uuid', 'key']) {
      const candidateValue = value[candidateKey];
      if (typeof candidateValue === 'string' || typeof candidateValue === 'number') {
        const normalized = String(candidateValue).trim();
        if (normalized) return normalized;
      }
    }
  }
  if (fallbackKey) return String(fallbackKey);
  return `${category}_${sha256(value).slice(0, 32)}`;
}

/** 判断集合对象应按数组、键值表还是单个根对象保存。 */
function detectCollectionShape(value, category) {
  if (Array.isArray(value) || value === undefined || value === null) return 'array';
  if (!isPlainObject(value)) return 'single';
  const keys = Object.keys(value);
  const hasStableId = ['stableId', 'stableID', 'entityId', 'id', 'uid', 'uuid', 'key'].some(key => Object.hasOwn(value, key));
  const hasRootCollection = keys.some(key => ROOT_COLLECTION_KEYS.has(key));
  if (hasStableId || hasRootCollection) return 'single';
  return 'map';
}

/** 将资产或版本输入统一为带稳定ID和集合形态的记录列表。 */
function normalizeCollection(value, category) {
  const shape = detectCollectionShape(value, category);
  if (shape === 'array') {
    const records = Array.isArray(value) ? value : [];
    return {
      shape,
      records: records.map((payload, index) => ({
        payload,
        stableId: getStableId(payload, category),
        order: index
      }))
    };
  }
  if (shape === 'single') {
    return {
      shape,
      records: [{
        payload: value,
        stableId: getStableId(value, category),
        order: 0
      }]
    };
  }
  return {
    shape,
    records: Object.keys(value).map((mapKey, index) => ({
      payload: value[mapKey],
      stableId: getStableId(value[mapKey], category, mapKey),
      mapKey,
      order: index
    }))
  };
}

/** 将稳定ID转换为不含目录语义的安全文件名片段。 */
function safePathSegment(value) {
  const normalized = String(value).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 96);
  if (!normalized || normalized === '.' || normalized === '..') return 'item';
  return normalized;
}

/** 为同一目录下的实体分配确定且不冲突的JSON路径。 */
function allocateEntityPaths(records, directory) {
  const usedPaths = new Set();
  return records.map(record => {
    const baseName = safePathSegment(record.stableId);
    let path = `${directory}/${baseName}.json`;
    if (usedPaths.has(path)) path = `${directory}/${baseName}-${sha256(record.stableId).slice(0, 12)}.json`;
    let suffix = 2;
    while (usedPaths.has(path)) {
      path = `${directory}/${baseName}-${suffix}.json`;
      suffix += 1;
    }
    usedPaths.add(path);
    return { ...record, path };
  });
}

/** 创建JSON文件条目及其不含正文数据的manifest描述。 */
function createJsonEntry(options) {
  const content = canonicalJson(options.payload);
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ProjectPackageError('file_too_large', `文件超过大小限制：${options.path}`);
  }
  const descriptor = {
    path: options.path,
    kind: options.kind,
    schema: options.schema,
    encoding: PACKAGE_ENCODING,
    hashAlgorithm: HASH_ALGORITHM,
    sha256: sha256(bytes),
    byteLength: bytes.length,
    stableId: options.stableId,
    createdBy: options.createdBy
  };
  if (options.collection) {
    descriptor.collection = options.collection;
    descriptor.collectionShape = options.collectionShape;
    descriptor.order = options.order;
    if (options.mapKey !== undefined) descriptor.mapKey = options.mapKey;
  }
  return {
    descriptor,
    file: {
      path: options.path,
      content,
      encoding: PACKAGE_ENCODING,
      byteLength: bytes.length,
      sha256: descriptor.sha256
    },
    parsed: options.payload
  };
}

/** 创建正文文本条目并记录其来源JSON路径和UTF-8哈希。 */
function createTextEntry(options) {
  const content = String(options.content);
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ProjectPackageError('file_too_large', `文件超过大小限制：${options.path}`);
  }
  const contentHash = sha256(bytes);
  const descriptor = {
    path: options.path,
    kind: 'manuscript-text',
    schema: 'molan.project.manuscript-text.v1',
    encoding: PACKAGE_ENCODING,
    hashAlgorithm: HASH_ALGORITHM,
    sha256: contentHash,
    textSha256: contentHash,
    byteLength: bytes.length,
    stableId: options.stableId,
    createdBy: options.createdBy,
    sourceFile: options.sourceFile,
    sourcePointer: options.sourcePointer
  };
  return {
    descriptor,
    file: {
      path: options.path,
      content,
      encoding: PACKAGE_ENCODING,
      byteLength: bytes.length,
      sha256: contentHash
    },
    parsed: null
  };
}

/** 将对象路径编码为稳定的JSON Pointer。 */
function appendJsonPointer(pointer, segment) {
  const escaped = String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
  return `${pointer}/${escaped}`;
}

/** 判断字段名是否是需要单独保留原始文本哈希的正文字段。 */
function isBodyKey(key) {
  return BODY_KEYS.has(key) || BODY_KEYS.has(String(key).toLowerCase());
}

/** 遍历结构化数据并收集正文、草稿和文本稿件字段。 */
function collectBodyNodes(value, pointer, visit, seen = new WeakSet()) {
  if (typeof value === 'string') return;
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectBodyNodes(item, appendJsonPointer(pointer, index), visit, seen));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value).sort()) {
    const childPointer = appendJsonPointer(pointer, key);
    if (typeof value[key] === 'string' && isBodyKey(key)) {
      visit(value[key], childPointer);
    } else {
      collectBodyNodes(value[key], childPointer, visit, seen);
    }
  }
}

/** 为JSON条目中的正文节点生成独立文本文件条目。 */
function createBodyEntries(jsonEntry, createdBy) {
  const bodyEntries = [];
  collectBodyNodes(jsonEntry.parsed, '', (content, sourcePointer) => {
    const stableId = `text_${sha256(`${jsonEntry.descriptor.path}#${sourcePointer}`).slice(0, 32)}`;
    const path = `manuscripts/${stableId}.txt`;
    bodyEntries.push(createTextEntry({
      path,
      content,
      stableId,
      createdBy,
      sourceFile: jsonEntry.descriptor.path,
      sourcePointer
    }));
  });
  return bodyEntries;
}

/** 计算不含自身packageId字段的确定性包指纹。 */
function calculatePackageId(manifest) {
  const basis = {};
  for (const key of Object.keys(manifest)) {
    if (key !== 'packageId') setOwn(basis, key, manifest[key]);
  }
  return sha256(canonicalJson(basis));
}

/** 以安全方式规范化目录抽象中的相对POSIX路径。 */
function normalizePackagePath(value) {
  if (typeof value !== 'string' || !value || value.length > 512) {
    throw new ProjectPackageError('invalid_path', '包路径必须是有限长度字符串');
  }
  if (value.includes('\\') || value.includes('\u0000') || value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) || value.includes('//')) {
    throw new ProjectPackageError('invalid_path', `包路径不是安全相对路径：${value}`);
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch (error) {
    throw new ProjectPackageError('invalid_path', `包路径编码无效：${value}`);
  }
  if (decoded !== value && (decoded.includes('\\') || decoded.startsWith('/') || decoded.includes('..'))) {
    throw new ProjectPackageError('invalid_path', `包路径包含编码后的目录穿越：${value}`);
  }
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new ProjectPackageError('invalid_path', `包路径包含目录穿越：${value}`);
  }
  const root = segments[0];
  if (!new Set(['data', 'assets', 'versions', 'manuscripts', 'legacy', 'extensions']).has(root)) {
    throw new ProjectPackageError('invalid_path', `包路径不在允许目录中：${value}`);
  }
  return value;
}

/** 根据目录路径判断文件条目允许的类型。 */
function expectedKindForPath(path) {
  if (path === 'data/state.json') return 'state';
  if (path.startsWith('assets/') && path.endsWith('.json')) return 'asset';
  if (path.startsWith('versions/') && path.endsWith('.json')) return 'version';
  if (path.startsWith('manuscripts/') && path.endsWith('.txt')) return 'manuscript-text';
  if ((path.startsWith('legacy/') || path.startsWith('extensions/')) &&
    (path.endsWith('.json') || path.endsWith('.txt'))) return 'legacy';
  return '';
}

/** 构造结构化校验错误，统一返回给调用方而不是修改输入。 */
function makeIssue(code, message, path = '', details = {}) {
  const issue = { code, message };
  if (path) issue.path = path;
  for (const key of Object.keys(details)) setOwn(issue, key, details[key]);
  return issue;
}

/** 在不暴露凭据值的前提下发现对象中的敏感字段名。 */
function findSensitiveKeys(value, path = '$', found = [], seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return found;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSensitiveKeys(item, `${path}[${index}]`, found, seen));
    return found;
  }
  if (!isPlainObject(value)) return found;
  for (const key of Object.keys(value)) {
    const childPath = `${path}.${key}`;
    if (isSensitiveKey(key)) found.push(childPath);
    findSensitiveKeys(value[key], childPath, found, seen);
  }
  return found;
}

/** 从对象中提取未知字段并放入extensions而不是静默丢弃。 */
function collectUnknownFields(value, knownKeys) {
  const extensions = {};
  if (!isPlainObject(value)) return extensions;
  for (const key of Object.keys(value)) {
    if (!knownKeys.has(key)) setOwn(extensions, key, value[key]);
  }
  return extensions;
}

/** 解析严格UTF-8文件内容，拒绝替换字符造成的正文静默变更。 */
function decodeUtf8(bytes, path) {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    const text = decoder.decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) {
      throw new ProjectPackageError('invalid_encoding', `文件含不允许的UTF-8 BOM：${path}`);
    }
    return text;
  } catch (error) {
    if (error instanceof ProjectPackageError) throw error;
    throw new ProjectPackageError('invalid_encoding', `文件不是有效UTF-8：${path}`);
  }
}

/** 将目录抽象中的文件值物化为UTF-8字节和文本。 */
function materializeFileValue(rawFile, path) {
  let bytes;
  let declaredEncoding = '';
  let declaredByteLength;
  let declaredHash = '';
  if (typeof rawFile === 'string') {
    bytes = Buffer.from(rawFile, 'utf8');
  } else if (Buffer.isBuffer(rawFile) || rawFile instanceof Uint8Array) {
    bytes = Buffer.from(rawFile);
  } else if (isPlainObject(rawFile)) {
    declaredEncoding = rawFile.encoding || '';
    declaredByteLength = rawFile.byteLength;
    declaredHash = rawFile.sha256 || '';
    if (Object.hasOwn(rawFile, 'content')) {
      if (typeof rawFile.content === 'string') bytes = Buffer.from(rawFile.content, 'utf8');
      else if (Buffer.isBuffer(rawFile.content) || rawFile.content instanceof Uint8Array) bytes = Buffer.from(rawFile.content);
    } else if (Object.hasOwn(rawFile, 'bytes')) {
      if (Buffer.isBuffer(rawFile.bytes) || rawFile.bytes instanceof Uint8Array) bytes = Buffer.from(rawFile.bytes);
      else if (typeof rawFile.bytes === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(rawFile.bytes)) {
        bytes = Buffer.from(rawFile.bytes, 'base64');
      }
    } else if (Object.hasOwn(rawFile, 'data') && rawFile.encoding === 'base64' && typeof rawFile.data === 'string') {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(rawFile.data)) {
        throw new ProjectPackageError('invalid_file', `base64文件内容无效：${path}`);
      }
      bytes = Buffer.from(rawFile.data, 'base64');
    } else if (path.endsWith('.json')) {
      bytes = Buffer.from(canonicalJson(rawFile), 'utf8');
    }
  }
  if (!bytes) throw new ProjectPackageError('invalid_file', `文件缺少可读取内容：${path}`);
  if (declaredEncoding && String(declaredEncoding).toUpperCase() !== PACKAGE_ENCODING) {
    throw new ProjectPackageError('invalid_encoding', `文件编码不是UTF-8：${path}`);
  }
  if (bytes.length > MAX_FILE_BYTES) throw new ProjectPackageError('file_too_large', `文件超过大小限制：${path}`);
  return {
    bytes,
    text: decodeUtf8(bytes, path),
    declaredByteLength,
    declaredHash
  };
}

/** 将package.files、fileObjects或entries统一成路径到文件值的映射。 */
function normalizeRawFiles(packageObject) {
  const rawFiles = packageObject.files ?? packageObject.fileObjects ?? packageObject.entries;
  if (rawFiles instanceof Map) {
    return Array.from(rawFiles.entries()).map(([path, rawFile]) => ({ path, rawFile }));
  }
  if (Array.isArray(rawFiles)) {
    return rawFiles.map(rawFile => ({
      path: rawFile && rawFile.path,
      rawFile
    }));
  }
  if (!isPlainObject(rawFiles)) throw new ProjectPackageError('invalid_files', 'package.files必须是对象或数组');
  return Object.keys(rawFiles).map(path => ({ path, rawFile: rawFiles[path] }));
}

/** 校验并物化导入包的manifest、路径、文件大小、schema和哈希。 */
function validateImportPackage(packageInput) {
  const errors = [];
  let packageObject;
  try {
    if (typeof packageInput === 'string') packageObject = JSON.parse(packageInput);
    else if (Buffer.isBuffer(packageInput) || packageInput instanceof Uint8Array) {
      packageObject = JSON.parse(decodeUtf8(Buffer.from(packageInput), '$package'));
    } else packageObject = packageInput;
  } catch (error) {
    return { errors: [makeIssue('invalid_package_json', 'package不是有效JSON')] };
  }
  if (!isPlainObject(packageObject)) {
    return { errors: [makeIssue('invalid_package', 'package必须是对象')] };
  }
  const manifest = packageObject.manifest;
  if (!isPlainObject(manifest)) {
    return { errors: [makeIssue('invalid_manifest', 'package.manifest必须是对象')] };
  }
  const sensitiveManifestKeys = findSensitiveKeys(manifest);
  for (const sensitivePath of sensitiveManifestKeys) {
    errors.push(makeIssue('sensitive_field', 'manifest包含禁止导入的敏感字段', sensitivePath));
  }
  const manifestDataKeys = Object.keys(manifest).filter(key => /^(?:state|assets|versions|content|payload|body|data)$/i.test(key));
  for (const dataKey of manifestDataKeys) {
    errors.push(makeIssue('manifest_contains_data', 'manifest不得承载项目正文或资料数据', `$.manifest.${dataKey}`));
  }
  if (manifest.format !== PACKAGE_FORMAT) errors.push(makeIssue('schema_mismatch', 'manifest.format不受支持', '$.manifest.format'));
  if (manifest.packageVersion !== PACKAGE_VERSION) errors.push(makeIssue('schema_mismatch', 'manifest.packageVersion不受支持', '$.manifest.packageVersion'));
  if (manifest.schemaVersion !== PACKAGE_VERSION) errors.push(makeIssue('schema_mismatch', 'manifest.schemaVersion不受支持', '$.manifest.schemaVersion'));
  if (String(manifest.encoding || '').toUpperCase() !== PACKAGE_ENCODING) {
    errors.push(makeIssue('invalid_encoding', 'manifest.encoding必须为UTF-8', '$.manifest.encoding'));
  }
  if (String(manifest.hashAlgorithm || '').toLowerCase() !== HASH_ALGORITHM) {
    errors.push(makeIssue('schema_mismatch', 'manifest.hashAlgorithm必须为sha256', '$.manifest.hashAlgorithm'));
  }
  let sourceScope;
  try {
    sourceScope = normalizeScope(manifest.scope);
  } catch (error) {
    errors.push(makeIssue(error.code || 'invalid_scope', error.message, '$.manifest.scope'));
  }
  if (typeof manifest.createdBy !== 'string' || !manifest.createdBy.trim()) {
    errors.push(makeIssue('invalid_schema', 'manifest.createdBy不能为空', '$.manifest.createdBy'));
  }
  if (!HASH_PATTERN.test(String(manifest.packageId || ''))) {
    errors.push(makeIssue('invalid_schema', 'manifest.packageId必须是SHA-256', '$.manifest.packageId'));
  } else if (calculatePackageId(manifest) !== manifest.packageId) {
    errors.push(makeIssue('package_hash_mismatch', 'manifest.packageId与manifest内容不一致', '$.manifest.packageId'));
  }
  if (!Array.isArray(manifest.files)) {
    errors.push(makeIssue('invalid_schema', 'manifest.files必须是数组', '$.manifest.files'));
  } else if (manifest.files.length > MAX_FILE_COUNT) {
    errors.push(makeIssue('file_count_exceeded', '文件数量超过限制', '$.manifest.files'));
  }
  if (!Number.isSafeInteger(manifest.fileCount) || manifest.fileCount < 1) {
    errors.push(makeIssue('invalid_schema', 'manifest.fileCount无效', '$.manifest.fileCount'));
  }
  if (!Number.isSafeInteger(manifest.totalByteLength) || manifest.totalByteLength < 0) {
    errors.push(makeIssue('invalid_schema', 'manifest.totalByteLength无效', '$.manifest.totalByteLength'));
  }
  if (!isPlainObject(manifest.fileHashes)) {
    errors.push(makeIssue('invalid_schema', 'manifest.fileHashes必须是对象', '$.manifest.fileHashes'));
  }
  const manifestExtensions = {
    ...((isPlainObject(manifest.extensions) && manifest.extensions) || {}),
    ...collectUnknownFields(manifest, MANIFEST_KEYS)
  };
  const packageExtensions = collectUnknownFields(packageObject, new Set(['manifest', 'files', 'fileObjects', 'entries']));
  if (findSensitiveKeys(manifestExtensions).length > 0 || findSensitiveKeys(packageExtensions).length > 0) {
    errors.push(makeIssue('sensitive_field', '扩展字段包含禁止导入的敏感字段'));
  }
  let rawFiles = [];
  try {
    rawFiles = normalizeRawFiles(packageObject);
  } catch (error) {
    errors.push(makeIssue(error.code || 'invalid_files', error.message, '$.files'));
  }
  const rawFileMap = new Map();
  for (const rawFileEntry of rawFiles) {
    try {
      const normalizedPath = normalizePackagePath(rawFileEntry.path);
      if (rawFileMap.has(normalizedPath)) {
        errors.push(makeIssue('duplicate_path', '包中存在重复路径', normalizedPath));
      } else {
        rawFileMap.set(normalizedPath, rawFileEntry.rawFile);
      }
    } catch (error) {
      errors.push(makeIssue(error.code || 'invalid_path', error.message, String(rawFileEntry.path || '')));
    }
  }
  const descriptors = [];
  const descriptorMap = new Map();
  const descriptorExtensions = {};
  if (Array.isArray(manifest.files)) {
    for (const rawDescriptor of manifest.files) {
      if (!isPlainObject(rawDescriptor)) {
        errors.push(makeIssue('invalid_schema', '文件描述必须是对象', '$.manifest.files'));
        continue;
      }
      let descriptorPath = '';
      try {
        descriptorPath = normalizePackagePath(rawDescriptor.path);
      } catch (error) {
        errors.push(makeIssue(error.code || 'invalid_path', error.message, '$.manifest.files.path'));
        continue;
      }
      if (descriptorMap.has(descriptorPath)) {
        errors.push(makeIssue('duplicate_path', 'manifest.files存在重复路径', descriptorPath));
        continue;
      }
      const descriptor = { ...rawDescriptor, path: descriptorPath };
      const unknownDescriptorFields = collectUnknownFields(rawDescriptor, DESCRIPTOR_KEYS);
      if (Object.keys(unknownDescriptorFields).length > 0) {
        setOwn(descriptorExtensions, descriptorPath, unknownDescriptorFields);
        setOwn(descriptor, 'extensions', {
          ...((isPlainObject(rawDescriptor.extensions) && rawDescriptor.extensions) || {}),
          ...unknownDescriptorFields
        });
      }
      const expectedKind = expectedKindForPath(descriptorPath);
      if (!expectedKind || descriptor.kind !== expectedKind) {
        errors.push(makeIssue('schema_mismatch', '文件路径与kind/schema不匹配', descriptorPath));
      }
      const expectedSchema = {
        state: 'molan.project.state.v1',
        asset: 'molan.project.asset.v1',
        version: 'molan.project.version.v1',
        'manuscript-text': 'molan.project.manuscript-text.v1',
        legacy: 'molan.project.legacy.v1'
      }[descriptor.kind];
      if (descriptor.schema !== expectedSchema) {
        errors.push(makeIssue('schema_mismatch', '文件schema不受支持', descriptorPath));
      }
      if (String(descriptor.encoding || '').toUpperCase() !== PACKAGE_ENCODING) {
        errors.push(makeIssue('invalid_encoding', '文件描述编码必须为UTF-8', descriptorPath));
      }
      if (String(descriptor.hashAlgorithm || '').toLowerCase() !== HASH_ALGORITHM ||
        !HASH_PATTERN.test(String(descriptor.sha256 || ''))) {
        errors.push(makeIssue('invalid_hash', '文件描述哈希算法或哈希值无效', descriptorPath));
      }
      if (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 0) {
        errors.push(makeIssue('invalid_size', '文件描述大小无效', descriptorPath));
      }
      if (descriptor.kind !== 'legacy' &&
        (typeof descriptor.stableId !== 'string' || !descriptor.stableId.trim())) {
        errors.push(makeIssue('invalid_stable_id', '结构化文件必须有稳定ID', descriptorPath));
      }
      if (typeof descriptor.createdBy !== 'string' || !descriptor.createdBy.trim()) {
        errors.push(makeIssue('invalid_schema', '文件描述必须有createdBy', descriptorPath));
      }
      if (descriptor.kind === 'asset' || descriptor.kind === 'version') {
        if (!['array', 'map', 'single'].includes(descriptor.collectionShape)) {
          errors.push(makeIssue('invalid_schema', '集合形态无效', descriptorPath));
        }
        if (!['assets', 'versions'].includes(descriptor.collection)) {
          errors.push(makeIssue('invalid_schema', '集合类别无效', descriptorPath));
        }
        if (!Number.isSafeInteger(descriptor.order) || descriptor.order < 0) {
          errors.push(makeIssue('invalid_schema', '集合顺序无效', descriptorPath));
        }
        if (descriptor.collectionShape === 'map' && typeof descriptor.mapKey !== 'string') {
          errors.push(makeIssue('invalid_schema', '键值集合缺少mapKey', descriptorPath));
        }
      }
      if (descriptor.kind === 'manuscript-text') {
        if (!HASH_PATTERN.test(String(descriptor.textSha256 || ''))) {
          errors.push(makeIssue('invalid_hash', '正文描述缺少textSha256', descriptorPath));
        }
        if (typeof descriptor.sourceFile !== 'string' || typeof descriptor.sourcePointer !== 'string') {
          errors.push(makeIssue('invalid_schema', '正文描述缺少来源JSON路径', descriptorPath));
        } else {
          try {
            normalizePackagePath(descriptor.sourceFile);
          } catch (error) {
            errors.push(makeIssue(error.code || 'invalid_path', error.message, descriptorPath));
          }
          if (descriptor.sourcePointer && !descriptor.sourcePointer.startsWith('/')) {
            errors.push(makeIssue('invalid_schema', '正文sourcePointer必须是JSON Pointer', descriptorPath));
          }
        }
      }
      if (sourceScope) {
        const scopeIssues = [];
        collectScopeIssues(descriptor, sourceScope, `$.manifest.files[${descriptors.length}]`, scopeIssues);
        errors.push(...scopeIssues);
      }
      descriptorMap.set(descriptorPath, descriptor);
      descriptors.push(descriptor);
    }
  }
  for (const rawPath of rawFileMap.keys()) {
    if (!descriptorMap.has(rawPath)) errors.push(makeIssue('unlisted_file', '文件未出现在manifest.files中', rawPath));
  }
  for (const descriptor of descriptors) {
    if (!rawFileMap.has(descriptor.path)) errors.push(makeIssue('missing_file', 'manifest列出的文件不存在', descriptor.path));
  }
  const fileRecords = [];
  let totalByteLength = 0;
  for (const descriptor of descriptors) {
    if (!rawFileMap.has(descriptor.path)) continue;
    try {
      const materialized = materializeFileValue(rawFileMap.get(descriptor.path), descriptor.path);
      if (materialized.declaredByteLength !== undefined && materialized.declaredByteLength !== materialized.bytes.length) {
        errors.push(makeIssue('size_mismatch', '文件对象大小与内容不一致', descriptor.path));
      }
      if (materialized.declaredHash && materialized.declaredHash !== sha256(materialized.bytes)) {
        errors.push(makeIssue('hash_mismatch', '文件对象哈希与内容不一致', descriptor.path));
      }
      if (materialized.bytes.length !== descriptor.byteLength) {
        errors.push(makeIssue('size_mismatch', '实际文件大小与manifest不一致', descriptor.path));
      }
      if (materialized.bytes.length > MAX_FILE_BYTES) {
        errors.push(makeIssue('file_too_large', '文件超过大小限制', descriptor.path));
      }
      const actualHash = sha256(materialized.bytes);
      if (actualHash !== descriptor.sha256) {
        errors.push(makeIssue('hash_mismatch', '实际文件哈希与manifest不一致', descriptor.path));
      }
      if (descriptor.textSha256 && actualHash !== descriptor.textSha256) {
        errors.push(makeIssue('hash_mismatch', '正文哈希与文件哈希不一致', descriptor.path));
      }
      if (manifest.fileHashes && manifest.fileHashes[descriptor.path] !== descriptor.sha256) {
        errors.push(makeIssue('hash_mismatch', 'manifest.fileHashes与文件描述不一致', descriptor.path));
      }
      totalByteLength += materialized.bytes.length;
      fileRecords.push({ descriptor, text: materialized.text, parsed: null });
    } catch (error) {
      errors.push(makeIssue(error.code || 'invalid_file', error.message, descriptor.path));
    }
  }
  if (totalByteLength > MAX_TOTAL_BYTES) errors.push(makeIssue('total_size_exceeded', '包总大小超过限制'));
  if (Number.isSafeInteger(manifest.fileCount) && manifest.fileCount !== descriptors.length) {
    errors.push(makeIssue('size_mismatch', 'manifest.fileCount与实际文件数量不一致'));
  }
  if (Number.isSafeInteger(manifest.totalByteLength) && manifest.totalByteLength !== totalByteLength) {
    errors.push(makeIssue('size_mismatch', 'manifest.totalByteLength与实际文件大小不一致'));
  }
  if (manifest.bodyHashes !== undefined && !Array.isArray(manifest.bodyHashes)) {
    errors.push(makeIssue('invalid_schema', 'manifest.bodyHashes必须是数组', '$.manifest.bodyHashes'));
  }
  const parsedRecords = new Map();
  const stableIds = new Set();
  let stateRecord;
  const collectionRecords = { assets: [], versions: [] };
  const legacyRecords = [];
  for (const fileRecord of fileRecords) {
    const { descriptor } = fileRecord;
    if (descriptor.kind === 'manuscript-text') continue;
    if (descriptor.kind === 'state' || descriptor.kind === 'asset' ||
      descriptor.kind === 'version' || descriptor.kind === 'legacy') {
      try {
        fileRecord.parsed = JSON.parse(fileRecord.text);
      } catch (error) {
        errors.push(makeIssue('invalid_json', 'JSON文件内容无效', descriptor.path));
        continue;
      }
      const sensitivePayloadKeys = findSensitiveKeys(fileRecord.parsed, `$files.${descriptor.path}`);
      for (const sensitivePath of sensitivePayloadKeys) {
        errors.push(makeIssue('sensitive_field', '项目包内容包含禁止导入的敏感字段', sensitivePath));
      }
      if (sourceScope) {
        const scopeIssues = [];
        collectScopeIssues(fileRecord.parsed, sourceScope, `$files.${descriptor.path}`, scopeIssues);
        errors.push(...scopeIssues);
      }
      parsedRecords.set(descriptor.path, fileRecord);
      if (descriptor.kind === 'state') {
        if (stateRecord) errors.push(makeIssue('duplicate_state', '包中只能有一个state文件'));
        stateRecord = fileRecord;
      } else if (descriptor.kind === 'asset' || descriptor.kind === 'version') {
        const stableKey = `${descriptor.kind}:${descriptor.stableId}`;
        if (stableIds.has(stableKey)) errors.push(makeIssue('duplicate_stable_id', '包中存在重复稳定ID', descriptor.path));
        stableIds.add(stableKey);
        collectionRecords[descriptor.collection].push(fileRecord);
      } else if (descriptor.kind === 'legacy') {
        legacyRecords.push(fileRecord);
      }
    }
  }
  if (!stateRecord) errors.push(makeIssue('missing_state', '包中缺少data/state.json'));
  if (sourceScope && stateRecord && stateRecord.descriptor.stableId !== sourceScope.projectId) {
    errors.push(makeIssue('scope_conflict', 'state稳定ID必须等于manifest.scope.projectId', stateRecord.descriptor.path));
  }
  for (const collectionName of ['assets', 'versions']) {
    const expectedCollection = manifest.collections && manifest.collections[collectionName];
    const actualRecords = collectionRecords[collectionName];
    if (!isPlainObject(expectedCollection)) {
      errors.push(makeIssue('invalid_schema', `manifest.collections.${collectionName}缺失`));
      continue;
    }
    if (!['array', 'map', 'single'].includes(expectedCollection.shape)) {
      errors.push(makeIssue('invalid_schema', `manifest.collections.${collectionName}.shape无效`));
    }
    if (!Number.isSafeInteger(expectedCollection.count) || expectedCollection.count !== actualRecords.length) {
      errors.push(makeIssue('size_mismatch', `manifest.collections.${collectionName}.count不一致`));
    }
    for (const record of actualRecords) {
      if (record.descriptor.collectionShape !== expectedCollection.shape) {
        errors.push(makeIssue('schema_mismatch', '文件集合形态与manifest不一致', record.descriptor.path));
      }
    }
  }
  if (Array.isArray(manifest.bodyHashes)) {
    const bodyHashMap = new Map();
    for (const bodyHash of manifest.bodyHashes) {
      if (!isPlainObject(bodyHash) || typeof bodyHash.path !== 'string' || !HASH_PATTERN.test(String(bodyHash.sha256 || ''))) {
        errors.push(makeIssue('invalid_schema', 'manifest.bodyHashes条目无效'));
        continue;
      }
      if (bodyHashMap.has(bodyHash.path)) errors.push(makeIssue('duplicate_path', 'manifest.bodyHashes存在重复路径', bodyHash.path));
      bodyHashMap.set(bodyHash.path, bodyHash.sha256);
    }
    for (const fileRecord of fileRecords.filter(record => record.descriptor.kind === 'manuscript-text')) {
      if (bodyHashMap.get(fileRecord.descriptor.path) !== fileRecord.descriptor.sha256) {
        errors.push(makeIssue('hash_mismatch', 'manifest.bodyHashes与正文文件不一致', fileRecord.descriptor.path));
      }
    }
  }
  for (const fileRecord of fileRecords.filter(record => record.descriptor.kind === 'manuscript-text')) {
    const sourceRecord = parsedRecords.get(fileRecord.descriptor.sourceFile);
    if (!sourceRecord || typeof sourceRecord.parsed === 'undefined') {
      errors.push(makeIssue('invalid_reference', '正文来源JSON文件不存在', fileRecord.descriptor.path));
      continue;
    }
    const sourceValue = readJsonPointer(sourceRecord.parsed, fileRecord.descriptor.sourcePointer);
    if (typeof sourceValue !== 'string' || sourceValue !== fileRecord.text) {
      errors.push(makeIssue('body_source_mismatch', '正文文件与来源JSON字段不一致', fileRecord.descriptor.path));
    }
  }
  for (const descriptor of descriptors) {
    if (descriptor.kind === 'asset' || descriptor.kind === 'version') {
      const matchingRecord = collectionRecords[descriptor.collection].find(record => record.descriptor.path === descriptor.path);
      if (!matchingRecord) errors.push(makeIssue('invalid_schema', '集合文件无法建立记录', descriptor.path));
    }
  }
  const manifestByteLength = Buffer.byteLength(canonicalJson(manifest), 'utf8');
  if (manifestByteLength > MAX_MANIFEST_BYTES) errors.push(makeIssue('manifest_too_large', 'manifest超过大小限制'));
  return {
    errors,
    packageObject,
    manifest,
    sourceScope,
    descriptors,
    fileRecords,
    stateRecord,
    collectionRecords,
    legacyRecords,
    manifestExtensions,
    descriptorExtensions,
    packageExtensions,
    parsedRecords
  };
}

/** 从JSON Pointer读取正文来源字段，失败时返回undefined。 */
function readJsonPointer(value, pointer) {
  if (pointer === '') return value;
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined;
  let current = value;
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/** 将任意existingIds输入规范化为只读的项目、实体、哈希和包索引。 */
function normalizeExistingIds(input) {
  const index = {
    ids: new Set(),
    projectIds: new Set(),
    hashes: new Map(),
    packages: new Map()
  };
  const seen = new WeakSet();
  const addGenericId = value => {
    if (typeof value === 'string' || typeof value === 'number') {
      const normalized = String(value).trim();
      if (normalized) index.ids.add(normalized);
    }
  };
  const addHash = (key, value) => {
    if ((typeof key === 'string' || typeof key === 'number') && typeof value === 'string' && HASH_PATTERN.test(value)) {
      index.hashes.set(String(key), value);
    }
  };
  const addPackage = (packageId, metadata = {}) => {
    if (!HASH_PATTERN.test(String(packageId || ''))) return;
    const current = index.packages.get(String(packageId)) || [];
    current.push({
      projectId: typeof metadata.projectId === 'string' ? metadata.projectId : '',
      workspaceId: typeof metadata.workspaceId === 'string' ? metadata.workspaceId : ''
    });
    index.packages.set(String(packageId), current);
  };
  const visit = (value, context = '') => {
    if (value instanceof Set) {
      for (const item of value) addGenericId(item);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isPlainObject(item) && item.packageId) addPackage(item.packageId, item);
        else if (isPlainObject(item) && (item.id || item.stableId)) addGenericId(item.id || item.stableId);
        else addGenericId(item);
      }
      return;
    }
    if (!isPlainObject(value) || seen.has(value)) return;
    seen.add(value);
    if (context === 'projectIds' || context === 'project_id') {
      if (Array.isArray(value)) value.forEach(addGenericId);
      else addGenericId(value);
    }
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (key === 'projectIds' || key === 'project_id' || key === 'projectIds') {
        if (Array.isArray(child)) child.forEach(item => {
          addGenericId(item);
          if (typeof item === 'string') index.projectIds.add(item);
        });
        else {
          addGenericId(child);
          if (typeof child === 'string') index.projectIds.add(child);
        }
      } else if (key === 'packages' || key === 'packageIds') {
        if (Array.isArray(child)) child.forEach(item => {
          if (isPlainObject(item)) addPackage(item.packageId, item);
          else addPackage(item);
        });
        else if (isPlainObject(child)) {
          for (const packageId of Object.keys(child)) addPackage(packageId, child[packageId]);
        } else addPackage(child);
      } else if (key === 'hashes' || key === 'entityHashes') {
        if (isPlainObject(child)) for (const hashKey of Object.keys(child)) addHash(hashKey, child[hashKey]);
      } else if (['ids', 'entityIds', 'existingIds'].includes(key)) {
        visit(child, key);
      } else if (['assets', 'assetIds', 'versions', 'versionIds', 'records'].includes(key)) {
        if (Array.isArray(child)) child.forEach(item => {
          if (isPlainObject(item)) {
            const itemId = item.stableId || item.id || item.entityId;
            if (itemId !== undefined) addGenericId(itemId);
            if (itemId !== undefined && item.sha256) addHash(`${key.replace(/Ids$/, '').replace(/s$/, '')}:${itemId}`, item.sha256);
          } else addGenericId(item);
        });
        else visit(child, key);
      } else if (key === 'projectId' && typeof child === 'string') {
        index.projectIds.add(child);
        index.ids.add(child);
      } else {
        visit(child, key);
      }
    }
  };
  visit(input);
  return index;
}

/** 从existingIds索引中读取实体哈希，兼容带类别和不带类别的键。 */
function findExistingHash(index, kind, stableId) {
  return index.hashes.get(`${kind}:${stableId}`) || index.hashes.get(stableId) || '';
}

/** 判断同一包是否已在同一目标作用域成功导入。 */
function hasImportedPackage(index, packageId, targetScope) {
  const markers = index.packages.get(packageId) || [];
  return markers.some(marker => {
    const projectMatches = !marker.projectId || marker.projectId === targetScope.projectId;
    const workspaceMatches = !marker.workspaceId || marker.workspaceId === targetScope.workspaceId;
    return projectMatches && workspaceMatches;
  });
}

/** 将existingIds索引导出为不共享可变集合的普通对象。 */
function formatExistingIds(index) {
  const hashes = {};
  for (const key of Array.from(index.hashes.keys()).sort()) setOwn(hashes, key, index.hashes.get(key));
  const packages = [];
  for (const packageId of Array.from(index.packages.keys()).sort()) {
    for (const marker of index.packages.get(packageId)) {
      packages.push({
        packageId,
        projectId: marker.projectId,
        workspaceId: marker.workspaceId
      });
    }
  }
  return {
    projectIds: Array.from(index.projectIds).sort(),
    entityIds: Array.from(index.ids).sort(),
    ids: Array.from(index.ids).sort(),
    hashes,
    packages
  };
}

/** 复制existingIds索引并登记一次导入产生的实体和包标记。 */
function extendExistingIndex(index, targetScope, packageId, entries) {
  const output = {
    ids: new Set(index.ids),
    projectIds: new Set(index.projectIds),
    hashes: new Map(index.hashes),
    packages: new Map(Array.from(index.packages.entries()).map(([key, markers]) => [
      key,
      markers.map(marker => ({ ...marker }))
    ]))
  };
  output.ids.add(targetScope.projectId);
  output.projectIds.add(targetScope.projectId);
  const packageMarkers = output.packages.get(packageId) || [];
  if (!packageMarkers.some(marker => marker.projectId === targetScope.projectId && marker.workspaceId === targetScope.workspaceId)) {
    packageMarkers.push({ projectId: targetScope.projectId, workspaceId: targetScope.workspaceId });
  }
  output.packages.set(packageId, packageMarkers);
  for (const entry of entries) {
    output.ids.add(entry.descriptor.stableId);
    output.hashes.set(`${entry.descriptor.kind}:${entry.descriptor.stableId}`, entry.descriptor.sha256);
    if (!output.hashes.has(entry.descriptor.stableId)) output.hashes.set(entry.descriptor.stableId, entry.descriptor.sha256);
  }
  return output;
}

/** 规划资产和版本按稳定ID合并时的新增、幂等和冲突项。 */
function planEntityMerge(entries, index) {
  const accepted = [];
  const addedIds = [];
  const skippedIds = [];
  const conflicts = [];
  for (const entry of entries) {
    const stableId = entry.descriptor.stableId;
    if (!index.ids.has(stableId)) {
      accepted.push(entry);
      addedIds.push(stableId);
      continue;
    }
    const existingHash = findExistingHash(index, entry.descriptor.kind, stableId);
    if (existingHash && existingHash === entry.descriptor.sha256) {
      skippedIds.push(stableId);
      continue;
    }
    conflicts.push({
      code: 'stable_id_conflict',
      kind: entry.descriptor.kind,
      stableId,
      path: entry.descriptor.path,
      existingHash: existingHash || null,
      incomingHash: entry.descriptor.sha256,
      action: 'preserve-existing'
    });
  }
  return { accepted, addedIds, skippedIds, conflicts };
}

/** 按manifest集合形态把合并后的文件记录恢复为数组、对象或根值。 */
function assembleCollection(entries, collectionMetadata) {
  const shape = collectionMetadata && collectionMetadata.shape || 'array';
  const ordered = [...entries].sort((left, right) => left.descriptor.order - right.descriptor.order);
  const getPayload = entry => Object.hasOwn(entry, 'payload') ? entry.payload : entry.parsed;
  if (shape === 'single') return ordered.length ? getPayload(ordered[0]) : null;
  if (shape === 'map') {
    const output = {};
    for (const entry of ordered) {
      const key = entry.descriptor.mapKey;
      if (typeof key === 'string') setOwn(output, key, getPayload(entry));
    }
    return output;
  }
  return ordered.map(getPayload);
}

/** 把未知扩展字段和legacy文件组织到导入结果中。 */
function assembleExtensions(validation, legacyRecords, sourceScope, targetScope) {
  const extensions = { ...validation.manifestExtensions };
  if (Object.keys(validation.descriptorExtensions).length > 0) {
    setOwn(extensions, 'files', validation.descriptorExtensions);
  }
  if (Object.keys(validation.packageExtensions).length > 0) {
    setOwn(extensions, 'package', validation.packageExtensions);
  }
  const rawLegacy = legacyRecords.map(record => ({
    path: record.descriptor.path,
    stableId: record.descriptor.stableId || null,
    createdBy: record.descriptor.createdBy,
    schema: record.descriptor.schema,
    content: record.text,
    value: record.parsed === null ? null : rewriteScope(record.parsed, sourceScope, targetScope)
  }));
  return { extensions, rawLegacy };
}

/** 创建导入成功后统一的项目结果结构。 */
function assembleImportResult(validation, targetScope, sourceScope, acceptedByCollection, legacyRecords) {
  const state = validation.stateRecord
    ? rewriteScope(validation.stateRecord.parsed, sourceScope, targetScope)
    : null;
  const assets = assembleCollection(
    acceptedByCollection.assets,
    validation.manifest.collections.assets
  );
  const versions = assembleCollection(
    acceptedByCollection.versions,
    validation.manifest.collections.versions
  );
  const extensionData = assembleExtensions(validation, legacyRecords, sourceScope, targetScope);
  const project = {
    projectId: targetScope.projectId,
    workspaceId: targetScope.workspaceId,
    ownerUserId: sourceScope.ownerUserId,
    sourceProjectId: sourceScope.projectId,
    sourceWorkspaceId: sourceScope.workspaceId,
    createdBy: validation.manifest.createdBy
  };
  return {
    project,
    scope: {
      projectId: targetScope.projectId,
      workspaceId: targetScope.workspaceId,
      ownerUserId: sourceScope.ownerUserId
    },
    state,
    assets,
    versions,
    extensions: extensionData.extensions,
    rawLegacy: extensionData.rawLegacy
  };
}

/** 导出本地小说项目的结构化资料包，不访问数据库、文件系统或模型服务。 */
function exportProjectPackage(input = {}) {
  if (!isPlainObject(input)) throw new ProjectPackageError('invalid_input', 'exportProjectPackage参数必须是对象');
  const sourceScope = normalizeScope({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId
  });
  const state = sanitizeForExport(input.state === undefined ? {} : input.state);
  const assets = sanitizeForExport(input.assets === undefined ? [] : input.assets);
  const versions = sanitizeForExport(input.versions === undefined ? [] : input.versions);
  const scopeIssues = [];
  collectScopeIssues(state, sourceScope, '$.state', scopeIssues);
  collectScopeIssues(assets, sourceScope, '$.assets', scopeIssues);
  collectScopeIssues(versions, sourceScope, '$.versions', scopeIssues);
  if (scopeIssues.length > 0) {
    throw new ProjectPackageError('scope_conflict', scopeIssues[0].message, { issues: scopeIssues });
  }
  const normalizedAssets = normalizeCollection(assets, 'asset');
  const normalizedVersions = normalizeCollection(versions, 'version');
  const assetRecords = allocateEntityPaths(normalizedAssets.records, 'assets');
  const versionRecords = allocateEntityPaths(normalizedVersions.records, 'versions');
  const jsonEntries = [];
  const stateEntry = createJsonEntry({
    path: 'data/state.json',
    kind: 'state',
    schema: 'molan.project.state.v1',
    stableId: sourceScope.projectId,
    createdBy: sourceScope.ownerUserId,
    payload: state
  });
  jsonEntries.push(stateEntry);
  for (const record of assetRecords) {
    jsonEntries.push(createJsonEntry({
      path: record.path,
      kind: 'asset',
      schema: 'molan.project.asset.v1',
      stableId: record.stableId,
      createdBy: isPlainObject(record.payload) && typeof record.payload.createdBy === 'string'
        ? record.payload.createdBy
        : sourceScope.ownerUserId,
      payload: record.payload,
      collection: 'assets',
      collectionShape: normalizedAssets.shape,
      mapKey: record.mapKey,
      order: record.order
    }));
  }
  for (const record of versionRecords) {
    jsonEntries.push(createJsonEntry({
      path: record.path,
      kind: 'version',
      schema: 'molan.project.version.v1',
      stableId: record.stableId,
      createdBy: isPlainObject(record.payload) && typeof record.payload.createdBy === 'string'
        ? record.payload.createdBy
        : sourceScope.ownerUserId,
      payload: record.payload,
      collection: 'versions',
      collectionShape: normalizedVersions.shape,
      mapKey: record.mapKey,
      order: record.order
    }));
  }
  const textEntries = jsonEntries.flatMap(entry => createBodyEntries(entry, sourceScope.ownerUserId));
  const allEntries = [...jsonEntries, ...textEntries].sort((left, right) => left.descriptor.path.localeCompare(right.descriptor.path));
  if (allEntries.length > MAX_FILE_COUNT) {
    throw new ProjectPackageError('file_count_exceeded', '导出文件数量超过限制');
  }
  const totalByteLength = allEntries.reduce((sum, entry) => sum + entry.descriptor.byteLength, 0);
  if (totalByteLength > MAX_TOTAL_BYTES) {
    throw new ProjectPackageError('total_size_exceeded', '导出包总大小超过限制');
  }
  const descriptors = allEntries.map(entry => entry.descriptor);
  const fileHashes = {};
  descriptors.forEach(descriptor => setOwn(fileHashes, descriptor.path, descriptor.sha256));
  const bodyHashes = descriptors
    .filter(descriptor => descriptor.kind === 'manuscript-text')
    .map(descriptor => ({
      path: descriptor.path,
      sourceFile: descriptor.sourceFile,
      sourcePointer: descriptor.sourcePointer,
      sha256: descriptor.sha256,
      byteLength: descriptor.byteLength
    }));
  const manifest = {
    format: PACKAGE_FORMAT,
    packageVersion: PACKAGE_VERSION,
    schemaVersion: PACKAGE_VERSION,
    encoding: PACKAGE_ENCODING,
    hashAlgorithm: HASH_ALGORITHM,
    scope: sourceScope,
    createdBy: sourceScope.ownerUserId,
    fileCount: descriptors.length,
    totalByteLength,
    files: descriptors,
    fileHashes,
    bodyHashes,
    collections: {
      assets: {
        shape: normalizedAssets.shape,
        count: assetRecords.length
      },
      versions: {
        shape: normalizedVersions.shape,
        count: versionRecords.length
      }
    }
  };
  manifest.packageId = calculatePackageId(manifest);
  const files = {};
  for (const entry of allEntries) setOwn(files, entry.descriptor.path, entry.file);
  return { manifest, files };
}

/** 导入本地小说项目包并执行只读预检或稳定ID合并，绝不覆盖已有项目。 */
function importProjectPackage(packageInput, options = {}) {
  const mode = options && options.mode ? options.mode : 'preflight';
  if (!['preflight', 'apply'].includes(mode)) {
    return {
      ok: false,
      valid: false,
      mode,
      errors: [makeIssue('invalid_mode', 'mode必须为preflight或apply')],
      conflicts: []
    };
  }
  const validation = validateImportPackage(packageInput);
  if (!validation.sourceScope) {
    return {
      ok: false,
      valid: false,
      mode,
      errors: validation.errors,
      conflicts: [],
      extensions: validation.manifestExtensions || {}
    };
  }
  const sourceScope = validation.sourceScope;
  let targetScope;
  try {
    targetScope = {
      projectId: options.targetProjectId === undefined
        ? sourceScope.projectId
        : normalizeId(options.targetProjectId, 'targetProjectId'),
      workspaceId: options.targetWorkspaceId === undefined
        ? sourceScope.workspaceId
        : normalizeId(options.targetWorkspaceId, 'targetWorkspaceId')
    };
  } catch (error) {
    return {
      ok: false,
      valid: false,
      mode,
      sourceScope,
      errors: [...validation.errors, makeIssue(error.code || 'invalid_scope', error.message)],
      conflicts: []
    };
  }
  let existingIndex;
  try {
    existingIndex = normalizeExistingIds(options.existingIds);
  } catch (error) {
    return {
      ok: false,
      valid: false,
      mode,
      sourceScope,
      targetScope,
      errors: [...validation.errors, makeIssue('invalid_existing_ids', error.message)],
      conflicts: []
    };
  }
  const projectOccupied = existingIndex.projectIds.has(targetScope.projectId) ||
    existingIndex.ids.has(targetScope.projectId);
  const packageAlreadyImported = hasImportedPackage(existingIndex, validation.manifest.packageId, targetScope);
  const entityEntries = [
    ...validation.collectionRecords.assets,
    ...validation.collectionRecords.versions
  ];
  const mergePlan = planEntityMerge(entityEntries, existingIndex);
  const conflicts = [...mergePlan.conflicts];
  const errors = [...validation.errors];
  if (projectOccupied && !packageAlreadyImported) {
    const projectConflict = {
      code: 'project_exists',
      stableId: targetScope.projectId,
      action: 'preserve-existing',
      message: '目标项目已存在，禁止覆盖'
    };
    conflicts.unshift(projectConflict);
    errors.push(projectConflict);
  }
  const extensionData = assembleExtensions(
    validation,
    validation.legacyRecords,
    sourceScope,
    targetScope
  );
  const preview = {
    sourceScope,
    targetScope,
    scopeRemapped: sourceScope.projectId !== targetScope.projectId ||
      sourceScope.workspaceId !== targetScope.workspaceId,
    wouldCreateProject: !projectOccupied,
    addedIds: [...mergePlan.addedIds],
    skippedIds: [...mergePlan.skippedIds],
    conflictCount: conflicts.length,
    fileCount: validation.descriptors.length,
    totalByteLength: validation.manifest.totalByteLength
  };
  const common = {
    mode,
    valid: errors.length === 0,
    packageId: validation.manifest.packageId,
    sourceScope,
    targetScope,
    scope: {
      projectId: targetScope.projectId,
      workspaceId: targetScope.workspaceId,
      ownerUserId: sourceScope.ownerUserId
    },
    manifest: sanitizeForExport(validation.manifest),
    extensions: extensionData.extensions,
    rawLegacy: extensionData.rawLegacy,
    errors,
    conflicts,
    preview,
    existingIds: formatExistingIds(existingIndex)
  };
  if (mode === 'preflight') {
    return {
      ...common,
      ok: errors.length === 0
    };
  }
  if (errors.length > 0) {
    return {
      ...common,
      ok: false
    };
  }
  if (packageAlreadyImported) {
    const emptyResult = {
      project: {
        projectId: targetScope.projectId,
        workspaceId: targetScope.workspaceId,
        ownerUserId: sourceScope.ownerUserId,
        sourceProjectId: sourceScope.projectId,
        sourceWorkspaceId: sourceScope.workspaceId,
        createdBy: validation.manifest.createdBy
      },
      scope: common.scope,
      state: null,
      assets: assembleCollection([], validation.manifest.collections.assets),
      versions: assembleCollection([], validation.manifest.collections.versions),
      extensions: extensionData.extensions,
      rawLegacy: extensionData.rawLegacy
    };
    return {
      ...common,
      ok: true,
      idempotent: true,
      result: emptyResult,
      state: emptyResult.state,
      assets: emptyResult.assets,
      versions: emptyResult.versions,
      addedIds: [],
      skippedIds: entityEntries.map(entry => entry.descriptor.stableId),
      existingIds: formatExistingIds(existingIndex)
    };
  }
  const acceptedByCollection = {
    assets: mergePlan.accepted.filter(entry => entry.descriptor.collection === 'assets'),
    versions: mergePlan.accepted.filter(entry => entry.descriptor.collection === 'versions')
  };
  const acceptedEntries = [...acceptedByCollection.assets, ...acceptedByCollection.versions];
  const result = assembleImportResult(
    validation,
    targetScope,
    sourceScope,
    acceptedByCollection,
    validation.legacyRecords
  );
  const nextExistingIndex = extendExistingIndex(
    existingIndex,
    targetScope,
    validation.manifest.packageId,
    acceptedEntries
  );
  return {
    ...common,
    ok: true,
    result,
    state: result.state,
    assets: result.assets,
    versions: result.versions,
    addedIds: mergePlan.addedIds,
    skippedIds: mergePlan.skippedIds,
    existingIds: formatExistingIds(nextExistingIndex)
  };
}

module.exports = {
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  PACKAGE_ENCODING,
  HASH_ALGORITHM,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  ProjectPackageError,
  canonicalJson,
  sha256,
  calculatePackageId,
  exportProjectPackage,
  importProjectPackage
};
