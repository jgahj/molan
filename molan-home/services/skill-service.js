'use strict';
const path = require('node:path');

function createSkillService({
  DATA_DIR,
  DEFAULT_WRITING_SKILL_ID,
  EDITOR_ONLY_BUNDLED_SKILL_DIR,
  EDITOR_ONLY_LOCAL_SKILL_DIR,
  EDITOR_ONLY_SKILL_DIR_DEFAULT,
  EDITOR_ONLY_SKILL_ID,
  EDITOR_SKILL_BLOCK_PATTERN,
  GENRE_WRITING_SKILL_RULES,
  GLOBAL_SKILLS_FILE,
  OPEN_SKILLS_FILE,
  POSTGRES_MODE,
  SKILL_AUDIT_VERSION,
  SKILL_BINARY_EXT,
  SKILL_BLOCK_PATTERN,
  SKILL_CACHE_TTL_MS,
  SKILL_DIRS_FALLBACK,
  SKILL_IGNORED_DIRS,
  SKILL_MAX_FILES,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_TOTAL_BYTES,
  SKILL_PROMPT_EXCLUDE_DIRS,
  SKILL_PROMPT_EXCLUDE_EXACT,
  SKILL_PROMPT_EXCLUDE_NAMES,
  SKILL_TARGETS,
  USER_SKILLS_FILE,
  appendAdminAudit,
  auditFilesMatch,
  auditManifestMatch,
  copyPromptMessageFlags,
  crypto,
  dbReady,
  decodePathParam,
  enqueuePostgresRuntimeWrite,
  firstExistingEditorSource,
  fs,
  getAuthUser,
  getUserByEmail,
  isAdminUser,
  json,
  normalizeAuditManifest,
  postgresRepository,
  postgresRuntimeState,
  projectScope,
  readBody,
  readJsonFile,
  requestError,
  requireSqliteForPublic,
  respondError,
  sha256Text,
  stableMessageHash,
  uniqueAuditStrings,
  validateChatMessages,
  writeJsonFile,
  assetDirectory,
  getDatabase
}) {
  const __dirname = assetDirectory;
  let builtinSkillsCache = null;
  let globalSkillsCache = null;
  let globalSkillsCacheAt = 0;
  let openSkillsCache = null;
  let openSkillsCacheAt = 0;
  let userSkillRecordsCache = null;
  let userSkillRecordsCacheAt = 0;

  function resolveSkillDirs() {
    const env = (process.env.MOLAN_SKILL_DIRS || '').split(',').map(s => s.trim()).filter(Boolean);
    const dirs = [];
    if (env.length) dirs.push(...env);
    // 应用自身的 skills 目录：编辑器「固化」的永久技能写入这里，始终参与扫描
    const local = path.join(__dirname, 'skills');
    const localNames = new Set();
    if (fs.existsSync(local) && fs.statSync(local).isDirectory()) {
      for (const n of fs.readdirSync(local)) {
        const p = path.join(local, n);
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
          localNames.add(String(n).toLowerCase());
          dirs.push(p);
        }
      }
    }
    // 公网部署包会把可用 Skill 放在 ./skills；本机开发时补充用户明确要求的
    // 默认写作/润色 Skill。显式设置 MOLAN_SKILL_DIRS 时保留其隔离语义。
    if (!env.length) {
      SKILL_DIRS_FALLBACK.forEach(dir => {
        if (!localNames.has(path.basename(dir).toLowerCase())) dirs.push(dir);
      });
    }
    return [...new Set(dirs.map(value => path.resolve(value)))].filter(dir => {
      try { return fs.existsSync(dir) && fs.statSync(dir).isDirectory(); } catch (_) { return false; }
    });
  }
  
  function readSkillDirectoryFiles(dir) {
    const files = [];
    let totalBytes = 0;
    const visit = current => {
      const entries = fs.readdirSync(current, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.isDirectory() && SKILL_IGNORED_DIRS.has(entry.name)) continue;
        if (entry.isSymbolicLink()) continue;
        const abs = path.join(current, entry.name);
        const rel = path.relative(dir, abs).replace(/\\/g, '/');
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
        if (entry.isDirectory()) {
          visit(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        if (files.length >= SKILL_MAX_FILES) throw new Error('Skill 文件数量超过上限');
        const size = Number(fs.statSync(abs).size) || 0;
        totalBytes += size;
        if (totalBytes > SKILL_MAX_TOTAL_BYTES) throw new Error('Skill 文件总大小超过上限');
        if (size > SKILL_MAX_FILE_BYTES || SKILL_BINARY_EXT.test(rel)) {
          files.push({ path: rel, type: 'binary', size, content: null });
          continue;
        }
        const buffer = fs.readFileSync(abs);
        files.push(buffer.includes(0)
          ? { path: rel, type: 'binary', size, content: null }
          : { path: rel, type: 'text', size, content: buffer.toString('utf8') });
      }
    };
    visit(dir);
    return files;
  }
  
  function parseSkillMd(raw) {
    const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    let name = '', description = '', body = raw;
    if (fmMatch) {
      const fm = fmMatch[1];
      const nameM = fm.match(/^name:\s*(.+)$/m);
      if (nameM) name = nameM[1].trim();
      const descM = fm.match(/^description:\s*(\||>)?\s*(.*)$/m);
      if (descM) {
        if (descM[2].trim() === '' && descM[1]) {
          const after = fm.slice(fm.indexOf('description:') + 'description:'.length);
          const block = [];
          for (const ln of after.split('\n')) {
            if (/^[A-Za-z_]/.test(ln)) break;
            const t = ln.trim();
            if (t === '|' || t === '>') continue;
            if (t) block.push(t);
          }
          description = block.join(' ').trim();
        } else {
          description = descM[2].trim();
        }
      }
      const secondDash = raw.indexOf('---', raw.indexOf('---') + 3);
      if (secondDash >= 0) body = raw.slice(secondDash + 3).trim();
    }
    return { name, description, body };
  }
  
  function isSkillPromptExcluded(filePath) {
    const p = String(filePath || '');
    if (!p) return true;
    if (SKILL_PROMPT_EXCLUDE_EXACT.has(p)) return true;
    if (SKILL_PROMPT_EXCLUDE_NAMES.some(re => re.test(p))) return true;
    const top = p.split('/')[0];
    return SKILL_PROMPT_EXCLUDE_DIRS.has(top);
  }
  
  function skillPromptFiles(skill) {
    const runtimeFiles = skill && skill.runtimeFiles && typeof skill.runtimeFiles === 'object' ? skill.runtimeFiles : {};
    const listed = Array.isArray(skill && skill.files) && skill.files.length
      ? skill.files
      : Object.keys(runtimeFiles);
    const files = [...new Set(listed.map(value => normalizeSkillFilePath(value)).filter(Boolean))];
    const textFiles = files.filter(filePath => typeof runtimeFiles[filePath] === 'string' && !isSkillPromptExcluded(filePath));
    return textFiles.sort((left, right) => {
      if (left === 'SKILL.md') return -1;
      if (right === 'SKILL.md') return 1;
      return left.localeCompare(right);
    });
  }
  
  function skillPromptInstruction(skill, promptFiles) {
    const runtimeFiles = skill && skill.runtimeFiles && typeof skill.runtimeFiles === 'object' ? skill.runtimeFiles : {};
    const raw = typeof runtimeFiles['SKILL.md'] === 'string' ? runtimeFiles['SKILL.md'] : '';
    if (!raw) return String(skill && (skill.promptInstruction || skill.instruction) || '').trim();
    const parsed = parseSkillMd(raw);
    const files = Array.isArray(promptFiles) ? promptFiles : skillPromptFiles(skill);
    const parts = [parsed.body];
    files.forEach(filePath => {
      if (filePath === 'SKILL.md') return;
      const content = runtimeFiles[filePath];
      if (typeof content !== 'string' || !content.trim()) return;
      parts.push('### Skill file: `' + filePath + '`\n\n' + content);
    });
    const output = parts.filter(Boolean).join('\n\n').trim();
    return output || String(skill && (skill.promptInstruction || skill.instruction) || '').trim();
  }
  
  function decorateSkillPrompt(skill) {
    const value = skill && typeof skill === 'object' ? skill : {};
    const promptFiles = skillPromptFiles(value);
    return {
      ...value,
      promptFiles,
      promptInstruction: skillPromptInstruction(value, promptFiles)
    };
  }
  
  function composeSkill(dir) {
    const raw = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    const { name, description, body } = parseSkillMd(raw);
    const entries = readSkillDirectoryFiles(dir);
    const runtimeFiles = Object.create(null);
    const composedParts = [body];
    for (const entry of entries) {
      if (entry.type === 'text') runtimeFiles[entry.path] = entry.content;
      if (entry.path === 'SKILL.md') continue;
      if (entry.type === 'text') {
        composedParts.push('\n\n### Skill file: `' + entry.path + '`\n\n' + entry.content);
      } else {
        composedParts.push('\n\n### Skill asset: `' + entry.path + '`\n\n[Non-text asset retained in the Skill manifest; it is not inserted into the text prompt.]');
      }
    }
    runtimeFiles['SKILL.md'] = raw;
    const instruction = composedParts.join('');
    return decorateSkillPrompt({
      id: path.basename(dir),
      name: name || path.basename(dir),
      description,
      instruction,
      files: entries.map(entry => entry.path),
      runtimeFiles,
      fileManifest: entries.map(entry => ({ path: entry.path, type: entry.type, size: entry.size })),
      complete: true,
      size: instruction.length,
      source: 'builtin',
      editable: false,
      global: false
    });
  }
  
  function resolveEditorOnlySkillDir(options = {}) {
    const configured = String(options.skillDir || process.env.MOLAN_EDITOR_WRITING_SKILL_DIR || '').trim();
    return firstExistingEditorSource([
      configured,
      EDITOR_ONLY_SKILL_DIR_DEFAULT,
      EDITOR_ONLY_LOCAL_SKILL_DIR,
      EDITOR_ONLY_BUNDLED_SKILL_DIR
    ], value => fs.statSync(value).isDirectory() && fs.existsSync(path.join(value, 'SKILL.md')));
  }
  
  function loadEditorOnlyWritingSkill(options = {}) {
    const dir = resolveEditorOnlySkillDir(options);
    if (!dir) {
      throw requestError(503, '编辑器固定写作 Skill 不可用，请检查指定的 write-high-tension-fiction 目录');
    }
    let skill;
    try {
      skill = composeSkill(dir);
    } catch (error) {
      throw requestError(503, '编辑器固定写作 Skill 加载失败：' + String(error && error.message || error));
    }
    if (!skill || !String(skill.instruction || '').trim()) {
      throw requestError(503, '编辑器固定写作 Skill 内容为空');
    }
    return {
      ...skill,
      id: EDITOR_ONLY_SKILL_ID,
      source: 'editor-canonical',
      canonicalPath: dir,
      complete: true,
      editable: false,
      global: false
    };
  }
  
  function editorOnlySkillAuditRequest(skill) {
    const value = skill && typeof skill === 'object' ? skill : loadEditorOnlyWritingSkill();
    return {
      version: SKILL_AUDIT_VERSION,
      skills: [{
        id: EDITOR_ONLY_SKILL_ID,
        name: value.name || EDITOR_ONLY_SKILL_ID,
        files: Array.isArray(value.files) ? value.files.slice() : [],
        fileManifest: Array.isArray(value.fileManifest) ? value.fileManifest.map(item => ({ ...item })) : []
      }]
    };
  }
  
  function ensureEditorOnlyWritingSkill(messages, skill) {
    const canonical = skill && typeof skill === 'object' ? skill : loadEditorOnlyWritingSkill();
    // 先清除客户端带来的所有可审计 Skill block，再注入唯一 canonical block。
    const source = stripEditorSkillBlocks(Array.isArray(messages) ? messages : []);
    const output = source.map(message => copyPromptMessageFlags(message, { ...message }));
    const block = wrapSkillBlock(EDITOR_ONLY_SKILL_ID, canonical.instruction);
    const systemIndex = output.findIndex(message => message && message.role === 'system');
    if (systemIndex < 0) output.unshift({ role: 'system', content: block });
    else output[systemIndex].content = String(output[systemIndex].content || '') + '\n\n' + block;
    return { messages: validateChatMessages(output), skill: canonical };
  }
  
  function stripEditorSkillBlocks(messages) {
    const source = Array.isArray(messages) ? messages : [];
    return source.map(message => {
      if (!message || typeof message !== 'object') return message;
      const stripText = value => {
        if (typeof value !== 'string') return value;
        EDITOR_SKILL_BLOCK_PATTERN.lastIndex = 0;
        return value.replace(EDITOR_SKILL_BLOCK_PATTERN, '');
      };
      let content = message.content;
      if (typeof content === 'string') {
        content = stripText(content);
      } else if (Array.isArray(content)) {
        content = content.map(part => {
          if (!part || typeof part !== 'object' || Array.isArray(part) || typeof part.text !== 'string') return part;
          return { ...part, text: stripText(part.text) };
        });
      }
      if (content === message.content) return message;
      return copyPromptMessageFlags(message, { ...message, content });
    });
  }
  
  function skillPriority(skill) {
    const source = String(skill && skill.source || '').toLowerCase();
    if (source === 'user') return 3;
    if (source === 'global') return 2;
    if (source === 'builtin') return 1;
    return 0;
  }
  
  function skillIdentityKey(skill) {
    const name = String(skill && skill.name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (name) return 'name:' + name;
    const id = String(skill && skill.id || '')
      .trim()
      .toLowerCase()
      .replace(/^user-[0-9a-f]{12}-/, '')
      .replace(/^local-/, '')
      .replace(/-copy-\d+$/, '');
    return 'id:' + id;
  }
  
  function uniqueSkillsById(list) {
    const byId = new Map();
    (Array.isArray(list) ? list : []).forEach(skill => {
      if (!skill || !String(skill.id || '').trim()) return;
      const identity = skillIdentityKey(skill);
      const previous = byId.get(identity);
      if (!previous || skillPriority(skill) > skillPriority(previous)) byId.set(identity, skill);
    });
    return [...byId.values()];
  }
  
  function publicSkillSummary(skill) {
    const value = skill && typeof skill === 'object' ? skill : {};
    const payload = {
      id: value.id,
      name: value.name,
      description: value.description,
      source: value.source,
      global: !!value.global,
      enabled: value.enabled !== false,
      editable: false,
      autoApply: false,
      files: Array.isArray(value.files) ? value.files : [],
      fileManifest: Array.isArray(value.fileManifest) ? value.fileManifest : [],
      complete: value.complete !== false,
      targets: Array.isArray(value.targets) ? value.targets : ['all'],
      updatedAt: value.updatedAt || 0
    };
  }
  
  function handleSkills(req, res) {
    if (!requireSqliteForPublic(req, res)) return;
    const out = loadBuiltinSkills().slice();
    const auth = getAuthUser(req);
    if (auth) {
      loadGlobalSkills().filter(s => s.enabled !== false).forEach(s => {
        out.push({ ...s, source: 'global', editable: false, global: true, autoApply: true });
      });
      out.push(...loadUserSkills(auth.user.email).map(s => ({ ...s, source: 'user', global: false, autoApply: false })));
    }
    // 未登录用户只需要看到可用 Skill 的名称和简介，不能匿名下载完整提示词。
    json(res, 200, uniqueSkillsById(auth ? out : out.map(publicSkillSummary)));
  }
  
  function handleSkillImport(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录后保存个人 Skill' });
    if (!requireSqliteForPublic(req, res)) return;
    readBody(req).then(body => {
      const name = String(body.name || '').trim();
      const description = String(body.description || '').trim().slice(0, 500);
      const instruction = String(body.instruction || '').trim().slice(0, 1000000);
      if (!name || !instruction) return json(res, 400, { error: '缺少 name 或 instruction' });
      // slug 仅保留字母/数字/下划线/中文/连字符，杜绝目录穿越
      const slug = String(body.slug || name)
        .trim()
        .replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, '')
        .slice(0, 60) ||
        'skill';
      const userHash = crypto.createHash('sha256').update(String(auth.user.email).toLowerCase()).digest('hex').slice(0, 12);
      const id = 'user-' + userHash + '-' + slug;
      const skills = loadAllUserSkillRecords();
      const key = String(auth.user.email).trim().toLowerCase();
      const existing = Array.isArray(skills[key]) ? skills[key] : [];
      const runtimeFiles = normalizeSkillRuntimeFiles(body.runtimeFiles, body.files, { strict: true });
      const files = skillFileNames(runtimeFiles, body.files);
      const fileManifest = Array.isArray(body.fileManifest) ? body.fileManifest : [];
      const record = decorateSkillPrompt({ id, name: name.slice(0, 120), description, instruction, files, runtimeFiles, fileManifest, complete: skillRuntimeFilesComplete(files, runtimeFiles, fileManifest), size: instruction.length, updatedAt: Date.now() });
      const index = existing.findIndex(item => item && item.id === id);
      if (index >= 0) existing[index] = record; else existing.push(record);
      skills[key] = existing;
      saveAllUserSkillRecords(skills);
      json(res, 200, { ok: true, id, skill: record });
    }).catch(e => respondError(res, e));
  }
  
  function loadAllUserSkillRecords() {
    if (userSkillRecordsCache && Date.now() - userSkillRecordsCacheAt < SKILL_CACHE_TTL_MS) return userSkillRecordsCache;
    if (POSTGRES_MODE) {
      const out = {};
      postgresRuntimeState.userSkills.forEach((skills, email) => { out[email] = skills.slice(); });
      userSkillRecordsCache = out;
      userSkillRecordsCacheAt = Date.now();
      return userSkillRecordsCache;
    }
    if (dbReady()) {
      const out = {};
      getDatabase().prepare(`SELECT user_email, id, name, description, instruction, files_json, size, updated_at
        FROM user_skills ORDER BY updated_at DESC`).all().forEach(row => {
        const key = String(row.user_email || '').toLowerCase();
        if (!out[key]) out[key] = [];
        const storedFiles = parseStoredSkillFiles(row.files_json);
        out[key].push(decorateSkillPrompt({ id: row.id, name: row.name, description: row.description, instruction: row.instruction, files: storedFiles.files, runtimeFiles: storedFiles.runtimeFiles, fileManifest: storedFiles.fileManifest, complete: storedFiles.complete, size: Number(row.size) || 0, updatedAt: Number(row.updated_at) || 0 }));
      });
      userSkillRecordsCache = out;
      userSkillRecordsCacheAt = Date.now();
      return userSkillRecordsCache;
    }
    try {
      const data = JSON.parse(fs.readFileSync(USER_SKILLS_FILE, 'utf-8'));
      userSkillRecordsCache = data && typeof data === 'object' && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).map(([email, list]) => [email, Array.isArray(list) ? list.filter(Boolean).map(item => {
        const storedFiles = parseStoredSkillFiles(item.files_json || { files: item.files, runtimeFiles: item.runtimeFiles, fileManifest: item.fileManifest });
        return decorateSkillPrompt({ ...item, files: storedFiles.files, runtimeFiles: storedFiles.runtimeFiles, fileManifest: storedFiles.fileManifest, complete: storedFiles.complete });
      }) : []])) : {};
    } catch (_) { return {}; }
    userSkillRecordsCacheAt = Date.now();
    return userSkillRecordsCache;
  }
  
  function saveAllUserSkillRecords(data, actorUserId = '') {
    if (POSTGRES_MODE) {
      const next = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      const previousOwners = new Set(postgresRuntimeState.userSkills.keys());
      userSkillRecordsCache = next;
      userSkillRecordsCacheAt = Date.now();
      postgresRuntimeState.userSkills.clear();
      for (const [email, list] of Object.entries(next)) {
        postgresRuntimeState.userSkills.set(String(email).trim().toLowerCase(), Array.isArray(list) ? list : []);
      }
      const write = enqueuePostgresRuntimeWrite('user-skills', async () => {
        const ownerEmails = new Set([...previousOwners, ...Object.keys(next).map(email => String(email).trim().toLowerCase())]);
        for (const email of ownerEmails) {
          const list = next[email] || [];
          const owner = postgresRuntimeState.accountsByEmail.get(String(email).trim().toLowerCase());
          const ownerUserId = String(owner && owner.userId || projectScope.stableUserId(email));
          await postgresRepository.runtimeReplaceUserSkills({
            actorUserId: actorUserId || ownerUserId,
            ownerUserId,
            ownerEmail: String(email).trim().toLowerCase(),
            skills: Array.isArray(list) ? list : []
          });
        }
      });
      return write;
    }
    if (dbReady()) {
      getDatabase().exec('BEGIN IMMEDIATE');
      try {
        const upsert = getDatabase().prepare(`INSERT INTO user_skills
          (user_email, id, name, description, instruction, files_json, size, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_email, id) DO UPDATE SET
            name = excluded.name, description = excluded.description, instruction = excluded.instruction,
            files_json = excluded.files_json, size = excluded.size, updated_at = excluded.updated_at`);
        const emails = Object.keys(data && typeof data === 'object' ? data : {});
        for (const email of emails) {
          const rows = Array.isArray(data[email]) ? data[email] : [];
          getDatabase().prepare('DELETE FROM user_skills WHERE user_email = ?').run(email);
          for (const item of rows) {
            if (!item || !item.id || !item.instruction) continue;
            upsert.run(String(email).toLowerCase(), String(item.id), String(item.name || item.id).slice(0, 120), String(item.description || '').slice(0, 500), String(item.instruction).slice(0, 1000000), serializeSkillFiles(item), Math.max(0, Number(item.size) || String(item.instruction).length), Number(item.updatedAt) || Date.now());
          }
        }
        getDatabase().exec('COMMIT');
      } catch (error) {
        try { getDatabase().exec('ROLLBACK'); } catch (_) {}
        throw error;
      }
      userSkillRecordsCache = data && typeof data === 'object' ? data : {};
      userSkillRecordsCacheAt = Date.now();
      return;
    }
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = USER_SKILLS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, USER_SKILLS_FILE);
    userSkillRecordsCache = data;
    userSkillRecordsCacheAt = Date.now();
  }
  
  function loadUserSkills(email) {
    const all = loadAllUserSkillRecords();
    const key = String(email || '').trim().toLowerCase();
    return Array.isArray(all[key]) ? all[key].filter(item => item && item.id && item.instruction) : [];
  }
  
  function loadGlobalSkills() {
    if (globalSkillsCache && Date.now() - globalSkillsCacheAt < SKILL_CACHE_TTL_MS) return globalSkillsCache;
    if (dbReady()) {
      const skills = getDatabase().prepare(`SELECT id, name, description, instruction, files_json, targets_json, enabled, created_at, updated_at
        FROM global_skills ORDER BY updated_at DESC`).all().map(row => {
        let targets = [];
        try { targets = JSON.parse(row.targets_json || '["all"]'); } catch (_) {}
        const storedFiles = parseStoredSkillFiles(row.files_json);
        return decorateSkillPrompt({ id: row.id, name: row.name, description: row.description, instruction: row.instruction, files: storedFiles.files, runtimeFiles: storedFiles.runtimeFiles, fileManifest: storedFiles.fileManifest, complete: storedFiles.complete, targets: Array.isArray(targets) ? targets : ['all'], enabled: !!row.enabled, global: true, createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0 });
      });
      globalSkillsCache = skills;
      globalSkillsCacheAt = Date.now();
      return skills;
    }
    const data = readJsonFile(GLOBAL_SKILLS_FILE, []);
    globalSkillsCache = Array.isArray(data) ? data.filter(s => s && s.id && s.name && s.instruction).map(s => {
      const runtimeFiles = normalizeSkillRuntimeFiles(s.runtimeFiles, s.files);
      const files = skillFileNames(runtimeFiles, s.files);
      const fileManifest = Array.isArray(s.fileManifest) ? s.fileManifest : [];
      return decorateSkillPrompt({ ...s, files, runtimeFiles, fileManifest, complete: skillRuntimeFilesComplete(files, runtimeFiles, fileManifest) });
    }) : [];
    globalSkillsCacheAt = Date.now();
    return globalSkillsCache;
  }
  
  function saveGlobalSkills(skills) {
    if (dbReady()) {
      getDatabase().exec('BEGIN IMMEDIATE');
      try {
        getDatabase().exec('DELETE FROM global_skills');
        const insert = getDatabase().prepare(`INSERT INTO global_skills
          (id, name, description, instruction, files_json, targets_json, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        (Array.isArray(skills) ? skills : []).forEach(skill => {
          if (!skill || !skill.id || !skill.name || !skill.instruction) return;
          insert.run(String(skill.id), String(skill.name).slice(0, 120), String(skill.description || '').slice(0, 500), String(skill.instruction).slice(0, 1000000), serializeSkillFiles(skill), JSON.stringify(Array.isArray(skill.targets) && skill.targets.length ? skill.targets : ['all']), skill.enabled === false ? 0 : 1, Number(skill.createdAt) || Date.now(), Number(skill.updatedAt) || Date.now());
        });
        getDatabase().exec('COMMIT');
      } catch (error) {
        try { getDatabase().exec('ROLLBACK'); } catch (_) {}
        throw error;
      }
      globalSkillsCache = Array.isArray(skills) ? skills : [];
      globalSkillsCacheAt = Date.now();
      return;
    }
    writeJsonFile(GLOBAL_SKILLS_FILE, skills);
    globalSkillsCache = skills;
    globalSkillsCacheAt = Date.now();
  }
  
  function loadBuiltinSkills() {
    if (builtinSkillsCache) return builtinSkillsCache;
    const out = [];
    resolveSkillDirs().forEach(dir => {
      try { out.push(composeSkill(dir)); }
      catch (_) { /* 读取失败时跳过该技能，绝不修改原文件 */ }
    });
    builtinSkillsCache = out;
    return builtinSkillsCache;
  }
  
  function normalizeSkillFilePath(value) {
    const rel = String(value == null ? '' : value).replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!rel || rel.length > 500 || rel.startsWith('/') || /^[A-Za-z]:\//.test(rel)) return '';
    const parts = rel.split('/');
    if (parts.some(part => !part || part === '..' || part === '.')) return '';
    return parts.join('/');
  }
  
  function normalizeSkillRuntimeFiles(value, legacyNames, options = {}) {
    const strict = options.strict === true;
    const files = Object.create(null);
    let totalBytes = 0;
    const add = (rawPath, rawContent, hasContent) => {
      const filePath = normalizeSkillFilePath(rawPath);
      if (!filePath || Object.prototype.hasOwnProperty.call(files, filePath)) return;
      if (Object.keys(files).length >= SKILL_MAX_FILES) {
        if (strict) throw requestError(413, 'Skill 文件数量超过上限');
        return;
      }
      if (!hasContent || rawContent === null || rawContent === undefined) {
        files[filePath] = null;
        return;
      }
      const content = String(rawContent).replace(/\u0000/g, '');
      const size = Buffer.byteLength(content, 'utf8');
      if (size > SKILL_MAX_FILE_BYTES || totalBytes + size > SKILL_MAX_TOTAL_BYTES) {
        if (strict) throw requestError(413, 'Skill 文件内容超过上限');
        return;
      }
      totalBytes += size;
      files[filePath] = content;
    };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const source = value.runtimeFiles && typeof value.runtimeFiles === 'object' ? value.runtimeFiles : value.files && typeof value.files === 'object' && !Array.isArray(value.files) ? value.files : value;
      Object.entries(source).forEach(([filePath, content]) => add(filePath, content, true));
    } else if (Array.isArray(value)) {
      value.forEach(item => {
        if (typeof item === 'string') add(item, null, false);
        else if (item && typeof item === 'object') add(item.path || item.relPath || item.name, item.content, Object.prototype.hasOwnProperty.call(item, 'content'));
      });
    }
    if (Array.isArray(legacyNames)) legacyNames.forEach(filePath => add(filePath, null, false));
    return files;
  }
  
  function skillFileNames(runtimeFiles, legacyNames) {
    return [...new Set([
      ...Object.keys(runtimeFiles && typeof runtimeFiles === 'object' ? runtimeFiles : {}),
      ...(Array.isArray(legacyNames) ? legacyNames : [])
    ].map(normalizeSkillFilePath).filter(Boolean))].slice(0, SKILL_MAX_FILES);
  }
  
  function parseStoredSkillFiles(value) {
    let stored = value;
    if (typeof stored === 'string') {
      try { stored = JSON.parse(stored || '[]'); } catch (_) { stored = []; }
    }
    if (Array.isArray(stored)) {
      const runtimeFiles = normalizeSkillRuntimeFiles(stored);
      return { files: skillFileNames(runtimeFiles, stored), runtimeFiles, fileManifest: [], complete: stored.length === 0 };
    }
    if (!stored || typeof stored !== 'object') return { files: [], runtimeFiles: {}, fileManifest: [] };
    const legacyNames = Array.isArray(stored.files) ? stored.files : Array.isArray(stored.names) ? stored.names : [];
    const runtimeFiles = normalizeSkillRuntimeFiles(stored.runtimeFiles || (stored.files && !Array.isArray(stored.files) ? stored.files : {}), legacyNames);
    const fileManifest = Array.isArray(stored.fileManifest) ? stored.fileManifest.slice(0, SKILL_MAX_FILES).map(item => ({
      path: normalizeSkillFilePath(item && item.path),
      type: item && item.type === 'binary' ? 'binary' : 'text',
      size: Math.max(0, Number(item && item.size) || 0)
    })).filter(item => item.path) : [];
    const names = skillFileNames(runtimeFiles, legacyNames);
    const complete = skillRuntimeFilesComplete(names, runtimeFiles, fileManifest);
    return { files: names, runtimeFiles, fileManifest, complete };
  }
  
  function skillRuntimeFilesComplete(files, runtimeFiles, fileManifest) {
    const manifestByPath = new Map((Array.isArray(fileManifest) ? fileManifest : []).map(item => [item.path, item]));
    return !files.length || files.every(filePath => typeof (runtimeFiles || {})[filePath] === 'string' || manifestByPath.get(filePath)?.type === 'binary');
  }
  
  function serializeSkillFiles(skill) {
    const runtimeFiles = normalizeSkillRuntimeFiles(skill && skill.runtimeFiles, skill && skill.files, { strict: true });
    const files = skillFileNames(runtimeFiles, skill && skill.files);
    const fileManifest = Array.isArray(skill && skill.fileManifest) && skill.fileManifest.length ? skill.fileManifest : files.map(filePath => ({ path: filePath, type: runtimeFiles[filePath] === null ? 'unknown' : 'text', size: runtimeFiles[filePath] == null ? 0 : Buffer.byteLength(runtimeFiles[filePath], 'utf8') }));
    return JSON.stringify({ version: 2, files, runtimeFiles, fileManifest });
  }
  
  function makeOpenSkill(body, existing, ownerEmail) {
    const source = body && typeof body === 'object' ? body : {};
    const name = String(source.name !== undefined ? source.name : (existing && existing.name) || '').replace(/\u0000/g, '').trim().slice(0, 120);
    const description = String(source.description !== undefined ? source.description : (existing && existing.description) || '').replace(/\u0000/g, '').trim().slice(0, 500);
    const instruction = String(source.instruction !== undefined ? source.instruction : (existing && existing.instruction) || '').replace(/\u0000/g, '').trim().slice(0, 1000000);
    const owner = String(existing && existing.ownerEmail || ownerEmail || '').trim().toLowerCase();
    if (!owner) throw requestError(400, '缺少 Skill 所属账户');
    if (!name || !instruction) throw requestError(400, 'Skill 名称和指令内容不能为空');
    const rawStatus = String(source.status !== undefined ? source.status : (existing && existing.status) || 'published').trim().toLowerCase();
    const status = rawStatus === 'withdrawn' ? 'withdrawn' : 'published';
    const runtimeFiles = normalizeSkillRuntimeFiles(source.runtimeFiles !== undefined ? source.runtimeFiles : (existing && existing.runtimeFiles), source.files !== undefined ? source.files : (existing && existing.files), { strict: true });
    const files = skillFileNames(runtimeFiles, source.files !== undefined ? source.files : (existing && existing.files));
    const fileManifest = Array.isArray(source.fileManifest) ? source.fileManifest : (existing && existing.fileManifest) || [];
    return decorateSkillPrompt({
      id: existing ? existing.id : 'open-' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
      ownerEmail: owner,
      name,
      description,
      instruction,
      files,
      runtimeFiles,
      fileManifest,
      complete: skillRuntimeFilesComplete(files, runtimeFiles, fileManifest),
      status,
      downloads: Math.max(0, Math.floor(Number(existing && existing.downloads) || 0)),
      createdAt: existing ? Number(existing.createdAt) || Date.now() : Date.now(),
      updatedAt: Date.now()
    });
  }
  
  function openSkillFromDbRow(row) {
    const storedFiles = parseStoredSkillFiles(row.files_json);
    return decorateSkillPrompt({
      id: row.id,
      ownerEmail: row.owner_email,
      name: row.name,
      description: row.description,
      instruction: row.instruction,
      files: storedFiles.files,
      runtimeFiles: storedFiles.runtimeFiles,
      fileManifest: storedFiles.fileManifest,
      complete: storedFiles.complete,
      status: row.status === 'withdrawn' ? 'withdrawn' : 'published',
      downloads: Math.max(0, Number(row.downloads) || 0),
      createdAt: Number(row.created_at) || 0,
      updatedAt: Number(row.updated_at) || 0
    });
  }
  
  function loadOpenSkills() {
    if (openSkillsCache && Date.now() - openSkillsCacheAt < SKILL_CACHE_TTL_MS) return openSkillsCache;
    if (dbReady()) {
      openSkillsCache = getDatabase().prepare(`SELECT id, owner_email, name, description, instruction, files_json, status, downloads, created_at, updated_at
        FROM open_skills ORDER BY updated_at DESC`).all().map(openSkillFromDbRow);
      openSkillsCacheAt = Date.now();
      return openSkillsCache;
    }
    const data = readJsonFile(OPEN_SKILLS_FILE, []);
    openSkillsCache = Array.isArray(data) ? data.filter(skill => skill && skill.id && skill.ownerEmail && skill.name && skill.instruction).map(skill => {
      const runtimeFiles = normalizeSkillRuntimeFiles(skill.runtimeFiles, skill.files);
      const files = skillFileNames(runtimeFiles, skill.files);
      const fileManifest = Array.isArray(skill.fileManifest) ? skill.fileManifest : [];
      return decorateSkillPrompt({
        id: String(skill.id), ownerEmail: String(skill.ownerEmail).toLowerCase(), name: String(skill.name), description: String(skill.description || ''), instruction: String(skill.instruction), files, runtimeFiles, fileManifest,
        complete: skillRuntimeFilesComplete(files, runtimeFiles, fileManifest), status: skill.status === 'withdrawn' ? 'withdrawn' : 'published', downloads: Math.max(0, Number(skill.downloads) || 0), createdAt: Number(skill.createdAt) || 0, updatedAt: Number(skill.updatedAt) || 0
      });
    }) : [];
    openSkillsCacheAt = Date.now();
    return openSkillsCache;
  }
  
  function saveOpenSkills(skills) {
    const list = Array.isArray(skills) ? skills : [];
    if (dbReady()) {
      getDatabase().exec('BEGIN IMMEDIATE');
      try {
        getDatabase().exec('DELETE FROM open_skills');
        const insert = getDatabase().prepare(`INSERT INTO open_skills
          (id, owner_email, name, description, instruction, files_json, status, downloads, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        list.forEach(skill => {
          if (!skill || !skill.id || !skill.ownerEmail || !skill.name || !skill.instruction) return;
          insert.run(String(skill.id), String(skill.ownerEmail).toLowerCase(), String(skill.name).slice(0, 120), String(skill.description || '').slice(0, 500), String(skill.instruction).slice(0, 1000000), serializeSkillFiles(skill), skill.status === 'withdrawn' ? 'withdrawn' : 'published', Math.max(0, Math.floor(Number(skill.downloads) || 0)), Number(skill.createdAt) || Date.now(), Number(skill.updatedAt) || Date.now());
        });
        getDatabase().exec('COMMIT');
      } catch (error) {
        try { getDatabase().exec('ROLLBACK'); } catch (_) {}
        throw error;
      }
      openSkillsCache = list;
      openSkillsCacheAt = Date.now();
      return;
    }
    writeJsonFile(OPEN_SKILLS_FILE, list);
    openSkillsCache = list;
    openSkillsCacheAt = Date.now();
  }
  
  function invalidateOpenSkillsCache() {
    openSkillsCache = null;
    openSkillsCacheAt = 0;
  }
  
  function findOpenSkill(id) {
    const key = String(id || '');
    if (!key) return null;
    if (dbReady()) {
      const row = getDatabase().prepare(`SELECT id, owner_email, name, description, instruction, files_json, status, downloads, created_at, updated_at
        FROM open_skills WHERE id = ?`).get(key);
      return row ? openSkillFromDbRow(row) : null;
    }
    return loadOpenSkills().find(skill => skill.id === key) || null;
  }
  
  function openSkillAuthorName(email) {
    const user = getUserByEmail(email);
    const name = String(user && user.name || '').trim();
    return name ? name.slice(0, 24) : '墨阑作者';
  }
  
  function openSkillListView(skill, auth) {
    const isOwner = !!(auth && auth.user && String(auth.user.email || '').toLowerCase() === String(skill.ownerEmail || '').toLowerCase());
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      author: openSkillAuthorName(skill.ownerEmail),
      downloads: skill.downloads,
      status: skill.status,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
      isOwner,
      editable: isOwner || !!(auth && isAdminUser(auth.user))
    };
  }
  
  function openSkillDetailView(skill, auth) {
    const isOwner = !!(auth && auth.user && String(auth.user.email || '').toLowerCase() === String(skill.ownerEmail || '').toLowerCase());
    const canReadInstruction = isOwner || !!(auth && isAdminUser(auth.user));
    const detail = {
      ...openSkillListView(skill, auth),
      files: skillFileNames(skill.runtimeFiles, skill.files),
      fileManifest: Array.isArray(skill.fileManifest) ? skill.fileManifest : [],
      complete: skill.complete !== false
    };
    // Published Skill content is intentionally public; withdrawn/private Skill
    // details remain restricted to the owner/administrator.
    if (skill.status === 'published' || canReadInstruction) {
      detail.instruction = skill.instruction;
      detail.runtimeFiles = normalizeSkillRuntimeFiles(skill.runtimeFiles, skill.files);
    }
    return detail;
  }
  
  function canViewOpenSkill(skill, auth) {
    if (!skill) return false;
    if (skill.status === 'published') return true;
    return !!(auth && auth.user && (String(auth.user.email || '').toLowerCase() === String(skill.ownerEmail || '').toLowerCase() || isAdminUser(auth.user)));
  }
  
  function openSkillRecordValues(skill) {
    return [skill.id, skill.ownerEmail, skill.name, skill.description, skill.instruction, serializeSkillFiles(skill), skill.status === 'withdrawn' ? 'withdrawn' : 'published', Math.max(0, Math.floor(Number(skill.downloads) || 0)), Number(skill.createdAt) || Date.now(), Number(skill.updatedAt) || Date.now()];
  }
  
  function insertOpenSkill(skill) {
    if (dbReady()) {
      getDatabase().prepare(`INSERT INTO open_skills
        (id, owner_email, name, description, instruction, files_json, status, downloads, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...openSkillRecordValues(skill));
      invalidateOpenSkillsCache();
      return;
    }
    const list = loadOpenSkills();
    list.unshift(skill);
    saveOpenSkills(list);
  }
  
  function updateOpenSkill(skill) {
    if (dbReady()) {
      getDatabase().prepare(`UPDATE open_skills SET name = ?, description = ?, instruction = ?, files_json = ?, status = ?, updated_at = ? WHERE id = ?`).run(
      skill.name, skill.description, skill.instruction, serializeSkillFiles(skill), skill.status, skill.updatedAt, skill.id
      );
      invalidateOpenSkillsCache();
      return;
    }
    const list = loadOpenSkills();
    const index = list.findIndex(item => item.id === skill.id);
    if (index >= 0) list[index] = skill;
    saveOpenSkills(list);
  }
  
  function deleteOpenSkill(id) {
    if (dbReady()) {
      const result = getDatabase().prepare('DELETE FROM open_skills WHERE id = ?').run(String(id));
      invalidateOpenSkillsCache();
      return Number(result.changes || 0);
    }
    const list = loadOpenSkills();
    const next = list.filter(skill => skill.id !== String(id));
    if (next.length !== list.length) saveOpenSkills(next);
    return list.length - next.length;
  }
  
  function makeDownloadedSkillId(email, name, exists) {
    const userHash = crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 12);
    const slug = String(name || 'skill').trim().replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, '').slice(0, 60) || 'skill';
    const base = 'user-' + userHash + '-' + slug;
    let id = base;
    let index = 0;
    while (exists(id)) {
      index += 1;
      id = base + '-copy-' + index;
    }
    return id;
  }
  
  function downloadOpenSkillForUser(skill, email) {
    const owner = String(email || '').trim().toLowerCase();
    const now = Date.now();
    const description = String(skill.description || '').slice(0, 500);
    const instruction = String(skill.instruction || '').slice(0, 1000000);
    if (dbReady()) {
      getDatabase().exec('BEGIN IMMEDIATE');
      try {
        const id = makeDownloadedSkillId(owner, skill.name, value => !!getDatabase().prepare('SELECT 1 FROM user_skills WHERE user_email = ? AND id = ?').get(owner, value));
        getDatabase().prepare(`INSERT INTO user_skills (user_email, id, name, description, instruction, files_json, size, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(owner, id, skill.name, description, instruction, serializeSkillFiles(skill), instruction.length, now);
        getDatabase().prepare('UPDATE open_skills SET downloads = downloads + 1 WHERE id = ?').run(skill.id);
        getDatabase().exec('COMMIT');
        userSkillRecordsCache = null; userSkillRecordsCacheAt = 0; invalidateOpenSkillsCache();
        const copiedFiles = skillFileNames(skill.runtimeFiles, skill.files);
        const copiedRuntimeFiles = normalizeSkillRuntimeFiles(skill.runtimeFiles, skill.files);
        const copiedManifest = skill.fileManifest || [];
        return decorateSkillPrompt({ id, name: skill.name, description, instruction, files: copiedFiles, runtimeFiles: copiedRuntimeFiles, fileManifest: copiedManifest, complete: skillRuntimeFilesComplete(copiedFiles, copiedRuntimeFiles, copiedManifest), size: instruction.length, updatedAt: now });
      } catch (error) {
        try { getDatabase().exec('ROLLBACK'); } catch (_) {}
        throw error;
      }
    }
    const all = loadAllUserSkillRecords();
    const list = Array.isArray(all[owner]) ? all[owner] : [];
    const id = makeDownloadedSkillId(owner, skill.name, value => list.some(item => item && item.id === value));
    const runtimeFiles = normalizeSkillRuntimeFiles(skill.runtimeFiles, skill.files);
    const files = skillFileNames(runtimeFiles, skill.files);
    const fileManifest = skill.fileManifest || [];
    const record = decorateSkillPrompt({ id, name: skill.name, description, instruction, files, runtimeFiles, fileManifest, complete: skillRuntimeFilesComplete(files, runtimeFiles, fileManifest), size: instruction.length, updatedAt: now });
    list.push(record); all[owner] = list; saveAllUserSkillRecords(all);
    const openList = loadOpenSkills();
    const source = openList.find(item => item.id === skill.id);
    if (source) source.downloads += 1;
    saveOpenSkills(openList);
    return record;
  }
  
  function parseOpenSkillListParams(req) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(params.get('pageSize')) || 12)));
    const query = String(params.get('q') || '').trim().slice(0, 120);
    const sort = params.get('sort') === 'downloads' ? 'downloads' : 'updated';
    const scope = params.get('scope') === 'mine' ? 'mine' : 'public';
    return { page, pageSize, query, sort, scope };
  }
  
  function handleOpenSkillList(req, res) {
    if (!requireSqliteForPublic(req, res)) return;
    const auth = getAuthUser(req);
    let params;
    try { params = parseOpenSkillListParams(req); } catch (error) { return respondError(res, error); }
    if (params.scope === 'mine' && !auth) return json(res, 401, { error: '请先登录后查看自己的开放 Skill' });
    const owner = auth && auth.user ? String(auth.user.email || '').trim().toLowerCase() : '';
    if (dbReady()) {
      const conditions = [params.scope === 'mine' ? 'owner_email = ?' : "status = 'published'"];
      const args = [ ...(params.scope === 'mine' ? [owner] : []) ];
      if (params.query) {
        const like = '%' + params.query.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%';
        conditions.push("(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(description) LIKE ? ESCAPE '\\' OR LOWER(id) LIKE ? ESCAPE '\\')");
        args.push(like, like, like);
      }
      const where = 'WHERE ' + conditions.join(' AND ');
      const total = Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM open_skills ' + where).get(...args).n) || 0;
      const order = params.sort === 'downloads' ? 'downloads DESC, updated_at DESC' : 'updated_at DESC';
      const rows = getDatabase().prepare(`SELECT id, owner_email, name, description, status, downloads, created_at, updated_at
        FROM open_skills ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, params.pageSize, (params.page - 1) * params.pageSize);
      return json(res, 200, { ok: true, skills: rows.map(row => openSkillListView({ id: row.id, ownerEmail: row.owner_email, name: row.name, description: row.description, status: row.status, downloads: Number(row.downloads) || 0, createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0 }, auth)), pagination: { page: params.page, pageSize: params.pageSize, total, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) } });
    }
    let list = loadOpenSkills().filter(skill => params.scope === 'mine' ? skill.ownerEmail === owner : skill.status === 'published');
    if (params.query) {
      const q = params.query.toLowerCase();
      list = list.filter(skill => (skill.name + ' ' + skill.description + ' ' + skill.id).toLowerCase().includes(q));
    }
    list.sort((a, b) => params.sort === 'downloads' ? (b.downloads - a.downloads || b.updatedAt - a.updatedAt) : b.updatedAt - a.updatedAt);
    const total = list.length;
    const start = (params.page - 1) * params.pageSize;
    json(res, 200, { ok: true, skills: list.slice(start, start + params.pageSize).map(skill => openSkillListView(skill, auth)), pagination: { page: params.page, pageSize: params.pageSize, total, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) } });
  }
  
  function handleOpenSkillGet(req, res, id) {
    if (!requireSqliteForPublic(req, res)) return;
    const auth = getAuthUser(req);
    let skillId;
    try { skillId = decodePathParam(id); } catch (error) { return respondError(res, error); }
    const skill = findOpenSkill(skillId);
    if (!canViewOpenSkill(skill, auth)) return json(res, 404, { error: '开放 Skill 不存在或已撤回' });
    json(res, 200, { ok: true, skill: openSkillDetailView(skill, auth) });
  }
  
  function handleOpenSkillCreate(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录后发布开放 Skill' });
    if (!requireSqliteForPublic(req, res)) return;
    readBody(req).then(body => {
      const skill = makeOpenSkill(body, null, auth.user.email);
      insertOpenSkill(skill);
      if (isAdminUser(auth.user)) appendAdminAudit(auth.user.email, 'open-skill.create', skill.id, { owner: skill.ownerEmail, name: skill.name });
      json(res, 200, { ok: true, skill: openSkillDetailView(skill, auth) });
    }).catch(error => respondError(res, error));
  }
  
  function handleOpenSkillPatch(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录后修改开放 Skill' });
    if (!requireSqliteForPublic(req, res)) return;
    let skillId;
    try { skillId = decodePathParam(id); } catch (error) { return respondError(res, error); }
    const existing = findOpenSkill(skillId);
    if (!existing) return json(res, 404, { error: '开放 Skill 不存在' });
    const owner = String(auth.user.email || '').toLowerCase() === String(existing.ownerEmail || '').toLowerCase();
    if (!owner && !isAdminUser(auth.user)) return json(res, 403, { error: '只有 Skill 创建者或管理员可以修改' });
    readBody(req).then(body => {
      const skill = makeOpenSkill(body, existing, existing.ownerEmail);
      updateOpenSkill(skill);
      if (isAdminUser(auth.user)) appendAdminAudit(auth.user.email, 'open-skill.update', skill.id, { owner: skill.ownerEmail, name: skill.name, status: skill.status });
      json(res, 200, { ok: true, skill: openSkillDetailView(skill, auth) });
    }).catch(error => respondError(res, error));
  }
  
  function handleOpenSkillDelete(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录后撤回开放 Skill' });
    if (!requireSqliteForPublic(req, res)) return;
    let skillId;
    try { skillId = decodePathParam(id); } catch (error) { return respondError(res, error); }
    const existing = findOpenSkill(skillId);
    if (!existing) return json(res, 404, { error: '开放 Skill 不存在' });
    const owner = String(auth.user.email || '').toLowerCase() === String(existing.ownerEmail || '').toLowerCase();
    if (!owner && !isAdminUser(auth.user)) return json(res, 403, { error: '只有 Skill 创建者或管理员可以撤回' });
    const changes = deleteOpenSkill(skillId);
    if (!changes) return json(res, 404, { error: '开放 Skill 不存在' });
    if (isAdminUser(auth.user)) appendAdminAudit(auth.user.email, 'open-skill.delete', skillId, { owner: existing.ownerEmail, name: existing.name });
    json(res, 200, { ok: true, id: skillId });
  }
  
  function handleOpenSkillDownload(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录后下载 Skill' });
    if (!requireSqliteForPublic(req, res)) return;
    let skillId;
    try { skillId = decodePathParam(id); } catch (error) { return respondError(res, error); }
    const source = findOpenSkill(skillId);
    if (!canViewOpenSkill(source, auth)) return json(res, 404, { error: '开放 Skill 不存在或已撤回' });
    try {
      const skill = downloadOpenSkillForUser(source, auth.user.email);
      json(res, 200, { ok: true, skill, source: { id: source.id, name: source.name, downloads: source.downloads + 1 } });
    } catch (error) { respondError(res, error); }
  }
  
  function normalizeSkillTargets(value) {
    const list = Array.isArray(value) ? value.map(v => String(v)) : [];
    if (!list.length || list.includes('all')) return ['all'];
    const out = [...new Set(list.filter(v => SKILL_TARGETS.has(v) && v !== 'all'))];
    return out.length ? out : ['all'];
  }
  
  function makeGlobalSkill(body, existing) {
    const name = String(body.name !== undefined ? body.name : (existing && existing.name) || '').trim().slice(0, 120);
    const description = String(body.description !== undefined ? body.description : (existing && existing.description) || '').trim().slice(0, 500);
    const instruction = String(body.instruction !== undefined ? body.instruction : (existing && existing.instruction) || '').trim().slice(0, 1000000);
    if (!name || !instruction) throw new Error('Skill 名称和指令不能为空');
    const runtimeFiles = normalizeSkillRuntimeFiles(body.runtimeFiles !== undefined ? body.runtimeFiles : (existing && existing.runtimeFiles), body.files !== undefined ? body.files : (existing && existing.files), { strict: true });
    const files = skillFileNames(runtimeFiles, body.files !== undefined ? body.files : (existing && existing.files));
    const fileManifest = Array.isArray(body.fileManifest) ? body.fileManifest : (existing && existing.fileManifest) || [];
    return decorateSkillPrompt({
      id: existing ? existing.id : 'global-' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
      name, description, instruction, files, runtimeFiles, fileManifest, complete: skillRuntimeFilesComplete(files, runtimeFiles, fileManifest),
      targets: normalizeSkillTargets(body.targets !== undefined ? body.targets : (existing && existing.targets)),
      enabled: body.enabled === undefined ? (existing ? existing.enabled !== false : true) : body.enabled !== false,
      global: true,
      createdAt: existing ? existing.createdAt : Date.now(),
      updatedAt: Date.now()
    });
  }
  
  function builtinSkillsForAdmin() {
    return loadBuiltinSkills().map(skill => ({ ...skill, editable: false, global: false, source: 'builtin' }));
  }
  
  function migrateSkillsToDb() {
    if (!dbReady() || Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM user_skills').get().n) > 0) return;
    const data = readJsonFile(USER_SKILLS_FILE, {});
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length) saveAllUserSkillRecords(data);
  }
  
  function migrateGlobalSkillsToDb() {
    if (!dbReady() || Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM global_skills').get().n) > 0) return;
    const data = readJsonFile(GLOBAL_SKILLS_FILE, []);
    if (Array.isArray(data) && data.length) saveGlobalSkills(data);
  }
  
  function migrateOpenSkillsToDb() {
    if (!dbReady() || Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM open_skills').get().n) > 0) return;
    const data = readJsonFile(OPEN_SKILLS_FILE, []);
    if (Array.isArray(data) && data.length) saveOpenSkills(data);
  }
  
  function decodeSkillAuditId(value) {
    try { return decodeURIComponent(String(value || '')).slice(0, 240); }
    catch (_) { return ''; }
  }
  
  function skillAuditRequest(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const skills = [];
    const seen = new Set();
    (Array.isArray(input.skills) ? input.skills : []).slice(0, 100).forEach(item => {
      if (!item || typeof item !== 'object') return;
      const id = String(item.id || '').trim().slice(0, 240);
      if (!id || seen.has(id)) return;
      seen.add(id);
      const files = uniqueAuditStrings(item.files, 500, 500);
      const promptFilesProvided = Object.prototype.hasOwnProperty.call(item, 'promptFiles');
      skills.push({
        id,
        name: String(item.name || id).trim().slice(0, 160),
        files,
        fileManifest: normalizeAuditManifest(item.fileManifest, files),
        promptFiles: uniqueAuditStrings(item.promptFiles, 500, 500),
        promptFilesProvided
      });
    });
    return { version: SKILL_AUDIT_VERSION, skills };
  }
  
  function extractSkillBlocks(messages) {
    const blocks = new Map();
    (Array.isArray(messages) ? messages : []).forEach(message => {
      if (!message || message.role !== 'system') return;
      const content = String(message.content || '');
      SKILL_BLOCK_PATTERN.lastIndex = 0;
      let match;
      while ((match = SKILL_BLOCK_PATTERN.exec(content))) {
        const encodedStart = match[1];
        const encodedEnd = match[3];
        if (encodedStart !== encodedEnd) continue;
        const id = decodeSkillAuditId(encodedStart);
        if (!id) continue;
        const current = blocks.get(id) || { id, instruction: String(match[2] || '').trim(), occurrences: 0 };
        current.occurrences += 1;
        if (!current.instruction) current.instruction = String(match[2] || '').trim();
        blocks.set(id, current);
      }
    });
    return blocks;
  }
  
  function stripSkillBlocks(messages) {
    return (Array.isArray(messages) ? messages : []).map(message => {
      if (!message || message.role !== 'system') return message;
      return copyPromptMessageFlags(message, {
        ...message,
        content: String(message.content || '')
          .replace(/\[MOLAN_SKILL_BLOCK_BEGIN id=[^\]\r\n]+\]\r?\n/g, '')
          .replace(/\r?\n\[MOLAN_SKILL_BLOCK_END id=[^\]\r\n]+\]/g, '')
      });
    });
  }
  
  function prepareSkillMessagesForUpstream(auth, messages, skillAudit, options = {}) {
    const upstreamMessages = stripSkillBlocks(messages);
    const audit = skillAudit && typeof skillAudit === 'object' ? skillAudit : { status: 'none', skills: [] };
    const requestedSkills = Array.isArray(audit.skills) ? audit.skills : [];
    if (!requestedSkills.length) {
      return {
        messages: upstreamMessages,
        skillAudit: { ...audit, forwarding: { status: 'none', skills: [] } }
      };
    }
    if (audit.status !== 'verified') {
      throw requestError(422, 'Skill 审计未通过，无法转发到模型');
    }
  
    const blocks = extractSkillBlocks(messages);
    const normalizePromptText = value => String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const systemText = normalizePromptText(upstreamMessages
      .filter(message => message && message.role === 'system')
      .map(message => String(message.content || ''))
      .join('\n'));
    const forwardingSkills = [];
  
    requestedSkills.forEach(declared => {
      const id = String(declared && declared.id || '').trim();
      const block = blocks.get(id);
      const known = knownSkillForAudit(auth, id, options);
      if (!block || !String(block.instruction || '').trim()) {
        throw requestError(422, 'Skill「' + id + '」未将完整指令注入上游请求');
      }
      if (!known || !known.skill || known.skill.complete === false) {
        throw requestError(422, 'Skill「' + id + '」运行文件不完整，无法转发');
      }
      const instruction = normalizePromptText(block.instruction);
      if (!systemText.includes(instruction)) {
        throw requestError(422, 'Skill「' + id + '」在去除审计标记后未保留指令正文');
      }
  
      const runtimeFiles = known.skill.runtimeFiles && typeof known.skill.runtimeFiles === 'object'
        ? known.skill.runtimeFiles : {};
      const manifest = Array.isArray(known.skill.fileManifest) ? known.skill.fileManifest : [];
      const manifestByPath = new Map(manifest.map(item => [String(item && item.path || ''), item]));
      const files = Array.isArray(known.skill.files) ? known.skill.files : Object.keys(runtimeFiles);
      const promptFilesProvided = declared.promptFilesProvided === true;
      const promptFiles = promptFilesProvided ? declared.promptFiles : files;
      const promptFileSet = new Set(promptFiles);
      const forwardedTextFiles = [];
      const omittedTextFiles = [];
      const omittedBinaryFiles = [];
      files.forEach(filePath => {
        const path = String(filePath || '');
        const content = runtimeFiles[path];
        const manifestItem = manifestByPath.get(path);
        const isBinary = manifestItem && manifestItem.type === 'binary';
        if (isBinary || content === null || content === undefined) {
          omittedBinaryFiles.push(path);
          return;
        }
        // SKILL.md 的 frontmatter 是元数据，运行指令使用其正文；未选入本次任务的文本文件仍由完整目录审计覆盖，但不进入提示词。
        if (!promptFileSet.has(path)) {
          omittedTextFiles.push(path);
          return;
        }
        if (path === 'SKILL.md') return;
        const text = String(content);
        const normalizedFileText = normalizePromptText(text).trimEnd();
        if (normalizedFileText && !instruction.includes(normalizedFileText)) {
          throw requestError(422, 'Skill「' + id + '」的文件「' + path + '」未被完整注入');
        }
        forwardedTextFiles.push(path);
      });
      forwardingSkills.push({
        id,
        status: 'verified',
        instructionForwarded: true,
        promptFiles,
        promptFilesProvided,
        auditedFiles: files,
        forwardedTextFiles,
        omittedTextFiles,
        omittedBinaryFiles
      });
    });
  
    return {
      messages: upstreamMessages,
      skillAudit: {
        ...audit,
        forwarding: {
          status: 'verified',
          skills: forwardingSkills
        }
      }
    };
  }
  
  function wrapSkillBlock(id, instruction) {
    const encodedId = encodeURIComponent(String(id || ''));
    return '[MOLAN_SKILL_BLOCK_BEGIN id=' + encodedId + ']\n' + String(instruction || '') + '\n[MOLAN_SKILL_BLOCK_END id=' + encodedId + ']';
  }
  
  function defaultWritingSkillRecord() {
    const skill = loadBuiltinSkills().find(item => item && item.id === DEFAULT_WRITING_SKILL_ID);
    if (!skill || skill.complete === false || !String(skill.instruction || '').trim()) {
      throw requestError(503, '默认写作 Skill 未完整加载，请检查 skills/' + DEFAULT_WRITING_SKILL_ID + '');
    }
    return skill;
  }
  
  function resolveGenreWritingSkill(genre) {
    const text = String(genre || '').trim();
    const rule = text ? GENRE_WRITING_SKILL_RULES.find(item => item.pattern.test(text)) : null;
    if (rule) {
      const skill = loadBuiltinSkills().find(item => item && item.id === rule.skillId);
      if (skill && skill.complete !== false && String(skill.instruction || '').trim()) return { skill, genreMatched: true };
    }
    return { skill: defaultWritingSkillRecord(), genreMatched: false };
  }
  
  function resolveHumanizerSkill() {
    const builtin = loadBuiltinSkills().find(item => item && item.id === 'humanizer');
    if (builtin && builtin.complete !== false && String(builtin.instruction || '').trim()) {
      return builtin;
    }
    return defaultWritingSkillRecord();
  }
  
  function ensureDefaultWritingSkill(messages, stage, genre) {
    const source = Array.isArray(messages) ? messages : [];
    const normalizedStage = String(stage || '').toLowerCase();
    if (!['writing', 'humanizer'].includes(normalizedStage)) {
      return { messages: source, skill: null, injected: false };
    }
    const skill = normalizedStage === 'humanizer'
      ? resolveHumanizerSkill()
      : resolveGenreWritingSkill(genre).skill;
    const blocks = extractSkillBlocks(source);
    // 消息中已存在任何 skill block 时，视为用户显式选择了 skill，不再叠加默认写作 skill
    if (blocks.size > 0) {
      return { messages: source, skill, injected: false };
    }
    const output = source.map(message => copyPromptMessageFlags(message, { ...message }));
    const block = wrapSkillBlock(skill.id, skill.instruction);
    const systemIndex = output.findIndex(message => message && message.role === 'system');
    if (systemIndex < 0) output.unshift({ role: 'system', content: block });
    else output[systemIndex].content = String(output[systemIndex].content || '') + '\n\n' + block;
    return { messages: validateChatMessages(output), skill, injected: true };
  }
  
  function addDefaultWritingSkillAudit(value, skill) {
    if (!skill || !skill.id) return value;
    const requested = skillAuditRequest(value);
    if (requested.skills.some(item => item && item.id === skill.id)) return requested;
    requested.skills.push({
      id: skill.id,
      name: skill.name || skill.id,
      files: Array.isArray(skill.files) ? skill.files.slice(0, 500) : [],
      fileManifest: Array.isArray(skill.fileManifest) ? skill.fileManifest.slice(0, 500) : []
    });
    return requested;
  }
  
  function skillAuditSnapshot(skill, requestedPromptFiles) {
    if (!skill || typeof skill !== 'object') return null;
    const runtimeFiles = skill.runtimeFiles && typeof skill.runtimeFiles === 'object' ? skill.runtimeFiles : {};
    const files = uniqueAuditStrings(
      Array.isArray(skill.files) && skill.files.length ? skill.files : Object.keys(runtimeFiles),
      500,
      500
    );
    const fileManifest = normalizeAuditManifest(skill.fileManifest, files);
    const fileHashes = files.filter(path => Object.prototype.hasOwnProperty.call(runtimeFiles, path)).map(path => ({
      path,
      sha256: sha256Text(runtimeFiles[path]),
      size: String(runtimeFiles[path] == null ? '' : runtimeFiles[path]).length
    }));
    const availablePromptFiles = skillPromptFiles(skill);
    const promptFiles = Array.isArray(requestedPromptFiles)
      ? uniqueAuditStrings(requestedPromptFiles, 500, 500).filter(filePath => availablePromptFiles.includes(filePath))
      : availablePromptFiles;
    const promptInstruction = skillPromptInstruction(skill, promptFiles);
    return {
      files,
      fileManifest,
      fileHashes,
      instructionHash: sha256Text(String(skill.instruction || '').trim()),
      promptFiles,
      promptInstructionHash: sha256Text(promptInstruction)
    };
  }
  
  function knownSkillForAudit(auth, id, options = {}) {
    if (options && options.editorOnly === true) {
      if (String(id || '').trim() !== EDITOR_ONLY_SKILL_ID) return null;
      const canonical = options.canonicalSkill || loadEditorOnlyWritingSkill();
      return { source: 'editor-canonical', skill: canonical };
    }
    const email = String(auth && auth.user && auth.user.email || '').trim().toLowerCase();
    const userSkill = email ? loadUserSkills(email).find(skill => skill && skill.id === id) : null;
    if (userSkill) return { source: 'user', skill: userSkill };
    const globalSkill = loadGlobalSkills().find(skill => skill && skill.id === id);
    if (globalSkill) return { source: 'global', skill: globalSkill };
    const builtinSkill = loadBuiltinSkills().find(skill => skill && skill.id === id);
    if (builtinSkill) return { source: 'builtin', skill: builtinSkill };
    return null;
  }
  
  function buildSkillAudit(auth, messages, requestedValue, options = {}) {
    const requested = skillAuditRequest(requestedValue);
    const declared = new Map(requested.skills.map(skill => [skill.id, skill]));
    const blocks = extractSkillBlocks(messages);
    const actualIds = [...blocks.keys()];
    const ids = [...new Set([...actualIds, ...requested.skills.map(skill => skill.id)])];
    const skills = ids.map(id => {
      const block = blocks.get(id);
      const declaredSkill = declared.get(id);
      const known = knownSkillForAudit(auth, id, options);
      const expected = known
        ? skillAuditSnapshot(known.skill, declaredSkill && declaredSkill.promptFilesProvided ? declaredSkill.promptFiles : undefined)
        : null;
      const actualInstructionHash = block ? sha256Text(block.instruction) : '';
      const declaredFiles = declaredSkill ? declaredSkill.files : [];
      const declaredManifest = declaredSkill ? declaredSkill.fileManifest : [];
      const declaredPromptFiles = declaredSkill ? declaredSkill.promptFiles : [];
      const instructionMatch = !!(expected && block && actualInstructionHash === (declaredSkill && declaredSkill.promptFilesProvided ? expected.promptInstructionHash : expected.instructionHash));
      const filesProvided = !!declaredSkill && declaredFiles.length > 0;
      const filesMatch = !!(expected && filesProvided && auditFilesMatch(declaredFiles, expected.files));
      const manifestProvided = !!declaredSkill && declaredManifest.length > 0;
      const manifestMatch = !!(expected && manifestProvided && auditManifestMatch(declaredManifest, expected.fileManifest));
      const promptFilesMatch = !!(expected && declaredSkill && declaredSkill.promptFilesProvided && auditFilesMatch(declaredPromptFiles, expected.promptFiles));
      const promptFilesOk = declaredSkill && declaredSkill.promptFilesProvided ? promptFilesMatch : true;
      let verification = 'prompt-only';
      if (!block && declaredSkill) verification = 'declared-not-in-prompt';
      else if (!known) verification = block ? 'unverified-skill' : 'declared-not-in-prompt';
      else if (known.skill.complete === false) verification = 'incomplete-skill';
      else if (instructionMatch && filesMatch && manifestMatch && promptFilesOk) verification = 'server-match';
      else if (instructionMatch && declaredSkill && declaredSkill.promptFilesProvided && !promptFilesMatch) verification = 'prompt-files-mismatch';
      else if (instructionMatch) verification = 'instruction-match-files-unverified';
      else if (block) verification = 'instruction-mismatch';
      const snapshot = expected || {
        files: declaredFiles,
        fileManifest: declaredManifest,
        fileHashes: [],
        instructionHash: '',
        promptFiles: declaredPromptFiles,
        promptInstructionHash: ''
      };
      return {
        id,
        name: (known && known.skill.name) || (declaredSkill && declaredSkill.name) || id,
        source: known ? known.source : (block ? 'prompt' : 'client'),
        occurrences: block ? block.occurrences : 0,
        files: snapshot.files,
        fileManifest: snapshot.fileManifest,
        fileHashes: snapshot.fileHashes,
        instructionHash: actualInstructionHash,
        expectedInstructionHash: snapshot.instructionHash,
        promptFiles: snapshot.promptFiles,
        promptInstructionHash: snapshot.promptInstructionHash,
        promptFilesProvided: !!(declaredSkill && declaredSkill.promptFilesProvided),
        declaredPromptFiles,
        declaredFiles,
        declaredFileManifest: declaredManifest,
        verification
      };
    });
    const strippedMessages = stripSkillBlocks(messages);
    let status = 'none';
    if (ids.length) {
      const verifications = skills.map(skill => skill.verification);
      status = verifications.length && verifications.every(value => value === 'server-match')
        ? 'verified'
        : verifications.some(value => ['instruction-mismatch', 'incomplete-skill', 'unverified-skill', 'declared-not-in-prompt', 'prompt-files-mismatch'].includes(value))
          ? 'unverified'
          : 'partial';
    }
    return {
      version: SKILL_AUDIT_VERSION,
      audited: true,
      status,
      promptHash: stableMessageHash(strippedMessages),
      actualSkillIds: actualIds,
      declaredSkillIds: requested.skills.map(skill => skill.id),
      skills
    };
  }
  
  function legacySkillAudit() {
    return { version: SKILL_AUDIT_VERSION, status: 'legacy-unavailable', audited: false, promptHash: '', actualSkillIds: [], declaredSkillIds: [], skills: [] };
  }
  
  function storedSkillAudit(value) {
    if (!value) return legacySkillAudit();
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : legacySkillAudit();
    } catch (_) { return legacySkillAudit(); }
  }
  
  function skillIdsFromAudit(value) {
    if (Array.isArray(value)) return uniqueAuditStrings(value, 100, 240);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return uniqueAuditStrings(parsed, 100, 240);
      } catch (_) {}
    }
    const audit = storedSkillAudit(value);
    return uniqueAuditStrings(audit.actualSkillIds, 100, 240);
  }

  return { resolveSkillDirs, readSkillDirectoryFiles, parseSkillMd, isSkillPromptExcluded, skillPromptFiles, skillPromptInstruction, decorateSkillPrompt, composeSkill, resolveEditorOnlySkillDir, loadEditorOnlyWritingSkill, editorOnlySkillAuditRequest, ensureEditorOnlyWritingSkill, stripEditorSkillBlocks, skillPriority, skillIdentityKey, uniqueSkillsById, publicSkillSummary, handleSkills, handleSkillImport, loadAllUserSkillRecords, saveAllUserSkillRecords, loadUserSkills, loadGlobalSkills, saveGlobalSkills, loadBuiltinSkills, normalizeSkillFilePath, normalizeSkillRuntimeFiles, skillFileNames, parseStoredSkillFiles, skillRuntimeFilesComplete, serializeSkillFiles, makeOpenSkill, openSkillFromDbRow, loadOpenSkills, saveOpenSkills, invalidateOpenSkillsCache, findOpenSkill, openSkillAuthorName, openSkillListView, openSkillDetailView, canViewOpenSkill, openSkillRecordValues, insertOpenSkill, updateOpenSkill, deleteOpenSkill, makeDownloadedSkillId, downloadOpenSkillForUser, parseOpenSkillListParams, handleOpenSkillList, handleOpenSkillGet, handleOpenSkillCreate, handleOpenSkillPatch, handleOpenSkillDelete, handleOpenSkillDownload, normalizeSkillTargets, makeGlobalSkill, builtinSkillsForAdmin, migrateSkillsToDb, migrateGlobalSkillsToDb, migrateOpenSkillsToDb, decodeSkillAuditId, skillAuditRequest, extractSkillBlocks, stripSkillBlocks, prepareSkillMessagesForUpstream, wrapSkillBlock, defaultWritingSkillRecord, resolveGenreWritingSkill, resolveHumanizerSkill, ensureDefaultWritingSkill, addDefaultWritingSkillAudit, skillAuditSnapshot, knownSkillForAudit, buildSkillAudit, legacySkillAudit, storedSkillAudit, skillIdsFromAudit, resetCaches: () => { userSkillRecordsCache = null; userSkillRecordsCacheAt = 0; globalSkillsCache = null; globalSkillsCacheAt = 0; openSkillsCache = null; openSkillsCacheAt = 0; } };
}

module.exports = { createSkillService };
