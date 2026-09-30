'use strict';
const { assertPlatformConfigPromotion, canonicalGlobalPrompts } = require('../lib/evolution/platform-config-gate');

function createAdminService({
  ACCOUNT_ROLES,
  ADMIN_DATA_TYPES,
  CORRECTION_INBOX_FILE,
  MAX_NOVEL_STATE_BYTES,
  POSTGRES_MODE,
  SKILL_TARGETS,
  appendAdminAudit,
  builtinSkillsForAdmin,
  cachePostgresRuntimeUser,
  calcWordCount,
  contextWindowTokensForModel,
  correctionLibraryLib,
  correctionLibrarySummary,
  currentDefaultModel,
  dbReady,
  decodePathParam,
  deleteDissectionCascade,
  deleteOpenSkill,
  dissectionRecordFromDb,
  emptyCorrectionAudit,
  findOpenSkill,
  findPlatformModel,
  getAuthUser,
  getCorrectionLibrary,
  getUsageSummariesByUser,
  getUsageSummary,
  getUserByEmail,
  globalUsageSummary,
  isAdminUser,
  isConfiguredAdminEmail,
  json,
  loadAdminAudit,
  loadAllUserSkillRecords,
  loadCorrectionHits,
  loadGlobalSkills,
  loadUsers,
  makeGlobalSkill,
  makeOpenSkill,
  normalizeAvatar,
  normalizeSkillRuntimeFiles,
  normalizeUserRole,
  parseStoredSkillFiles,
  postgresRepository,
  postgresRuntimeUserFromRow,
  readBody,
  reasoningEffortsForModel,
  requestError,
  requireSqliteForPublic,
  respondError,
  roundCreditValue,
  safeJsonParse,
  sanitizeNovelStateForStorage,
  saveAllUserSkillRecords,
  saveGlobalSkills,
  saveModelPolicy,
  savePlatformModelRate,
  savePlatformModelRates,
  saveUser,
  skillFileNames,
  skillIdsFromAudit,
  skillRuntimeFilesComplete,
  storedAvatar,
  storedSkillAudit,
  updateOpenSkill,
  userFromDbRow,
  getDatabase,
  getPlatformModels
}) {
  function handleAdminModels(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const safe = getPlatformModels().map(m => ({
      id: m.id, name: m.name, group: m.group, provider: m.provider,
      model: m.model, supportsThinking: m.supportsThinking, supportsReasoning: m.supportsReasoning,
      reasoningEfforts: reasoningEffortsForModel(m), promptCaching: !!m.promptCaching,
      creditsPer1k: m.creditsPer1k,
      contextWindowTokens: contextWindowTokensForModel(m)
    }));
    json(res, 200, { ok: true, models: safe, defaultModel: currentDefaultModel(), vipCanChooseModel: true });
  }
  
  function handleAdminModelsPatch(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    readBody(req).then(async body => {
      if (body && Object.prototype.hasOwnProperty.call(body, 'rates')) {
        const updates = savePlatformModelRates(body.rates);
        updates.filter(item => item.previousCreditsPer1k !== item.creditsPer1k).forEach(item => {
          appendAdminAudit(auth.user.email, 'model.rate.update', item.modelId, {
            modelId: item.modelId,
            previousCreditsPer1k: item.previousCreditsPer1k,
            creditsPer1k: item.creditsPer1k,
            source: 'bulk'
          });
        });
        return json(res, 200, {
          ok: true,
          changedCount: updates.filter(item => item.previousCreditsPer1k !== item.creditsPer1k).length,
          models: updates.map(item => ({ id: item.modelId, creditsPer1k: item.creditsPer1k }))
        });
      }
      const modelId = String(body && body.modelId || '').trim();
      if (modelId || (body && Object.prototype.hasOwnProperty.call(body, 'creditsPer1k'))) {
        const model = findPlatformModel(modelId);
        if (!model) throw new Error('模型不存在或未配置');
        const previousCreditsPer1k = model.creditsPer1k;
        const updated = savePlatformModelRate(modelId, body.creditsPer1k);
        appendAdminAudit(auth.user.email, 'model.rate.update', modelId, {
          modelId,
          previousCreditsPer1k,
          creditsPer1k: updated.creditsPer1k
        });
        return json(res, 200, { ok: true, model: { id: modelId, creditsPer1k: updated.creditsPer1k } });
      }
      const requested = String(body && body.defaultModel || '').trim();
      if (!requested || !findPlatformModel(requested)) throw new Error('默认模型不存在或未配置');
      assertPlatformConfigPromotion({ kind: 'default-model', proposed: requested, evidence: body.qualityEvidence });
      const defaultModel = saveModelPolicy(requested);
      appendAdminAudit(auth.user.email, 'model.update', defaultModel, { defaultModel });
      json(res, 200, { ok: true, defaultModel });
    }).catch(e => respondError(res, e));
  }
  
  function handleAdminCorrectionLibrary(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const library = getCorrectionLibrary();
    const hits = loadCorrectionHits();
    const rules = Object.entries(hits.rules || {}).map(([id, entry]) => ({ id, ...entry })).sort((a, b) => b.hits - a.hits);
    json(res, 200, {
      ok: true,
      library: correctionLibrarySummary(library),
      hits: { totalRequests: hits.totalRequests || 0, passedRequests: hits.passedRequests || 0, updatedAt: hits.updatedAt || 0, rules },
      inbox: correctionLibraryLib.readInbox(CORRECTION_INBOX_FILE).slice(-200)
    });
  }
  
  function requireAdmin(req, res) {
    const auth = getAuthUser(req, 'admin');
    if (!auth) {
      json(res, 401, { error: '请先登录' });
      return null;
    }
    if (!requireSqliteForPublic(req, res)) return null;
    if (!isAdminUser(auth.user)) {
      json(res, 403, { error: '仅管理员可以访问管理后台' });
      return null;
    }
    return auth;
  }
  
  function adminUserView(user, usageOverride) {
    const role = normalizeUserRole(user);
    const usage = usageOverride || getUsageSummary(user.email, false);
    return {
      email: user.email,
      name: user.name || '',
      role,
      level: role,
      credits: role === 'admin' ? null : Math.round((Number(user.credits) || 0) * 100) / 100,
      unlimitedCredits: role === 'admin',
      costMultiplier: role === 'admin' ? 0 : (role === 'vip' ? 1 : 2),
      creditSpent: Math.round((Number(user.spent) || 0) * 100) / 100,
      tokenUsage: usage,
      createdAt: user.createdAt || null
    };
  }
  
  function handleAdminOverview(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    if (!requireSqliteForPublic(req, res)) return;
    let page = 1, pageSize = 100, query = '', roleFilter = 'all';
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
      pageSize = Math.min(200, Math.max(20, Math.floor(Number(params.get('pageSize')) || 100)));
      query = String(params.get('q') || '').trim().slice(0, 120);
      roleFilter = String(params.get('role') || 'all').trim().toLowerCase();
      if (!ACCOUNT_ROLES.has(roleFilter) && roleFilter !== 'all') roleFilter = 'all';
    } catch (_) {}
    const usageByUser = getUsageSummariesByUser();
    let users = [];
    let totalUsers = 0;
    const counts = { admin: 0, vip: 0, normal: 0 };
    if (dbReady()) {
      const rows = getDatabase().prepare('SELECT role, COUNT(*) AS n FROM accounts GROUP BY role').all();
      rows.forEach(row => { const key = ACCOUNT_ROLES.has(String(row.role)) ? String(row.role) : 'normal'; counts[key] += Number(row.n) || 0; });
      const where = [], args = [];
      if (roleFilter !== 'all') { where.push('role = ?'); args.push(roleFilter); }
      if (query) { where.push("(LOWER(email) LIKE ? ESCAPE '\\' OR LOWER(name) LIKE ? ESCAPE '\\')"); const like = '%' + query.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%'; args.push(like, like); }
      const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
      totalUsers = Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM accounts' + whereSql).get(...args).n) || 0;
      const rowsPage = getDatabase().prepare(`SELECT email, name, avatar, salt, pwd, role, level, plan, credits, spent, created_at AS createdAt
        FROM accounts${whereSql} ORDER BY created_at ASC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
      users = rowsPage.map(user => adminUserView(userFromDbRow(user), usageByUser.get(user.email)));
    } else {
      const allUsers = loadUsers().filter(Boolean);
      allUsers.forEach(user => { const key = normalizeUserRole(user); counts[key] = (counts[key] || 0) + 1; });
      const filtered = allUsers.filter(user => {
        const matchesRole = roleFilter === 'all' || normalizeUserRole(user) === roleFilter;
        const value = String(user.email || '') + ' ' + String(user.name || '');
        return matchesRole && (!query || value.toLowerCase().includes(query.toLowerCase()));
      });
      totalUsers = filtered.length;
      users = filtered.slice((page - 1) * pageSize, page * pageSize).map(user => adminUserView(user, usageByUser.get(user.email)));
    }
    const usage = globalUsageSummary();
    const globals = loadGlobalSkills();
    json(res, 200, {
      ok: true,
      stats: {
        totalUsers: counts.admin + counts.vip + counts.normal,
        adminUsers: counts.admin,
        vipUsers: counts.vip,
        normalUsers: counts.normal,
        totalTokens: usage.totalTokens,
        requestCount: usage.requestCount,
        creditSpent: usage.creditSpent,
        cacheHitRate: usage.cacheHitRate
      },
      pagination: { page, pageSize, total: totalUsers, totalPages: Math.max(1, Math.ceil(totalUsers / pageSize)), query, role: roleFilter },
      usage,
      users,
      skills: { global: globals.length, enabled: globals.filter(s => s.enabled !== false).length, builtin: builtinSkillsForAdmin().length },
      audit: loadAdminAudit(8)
    });
  }
  
  function handleAdminUserPatch(req, res, email) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    let targetEmail;
    try { targetEmail = decodePathParam(email).trim().toLowerCase(); }
    catch (e) { return respondError(res, e); }
    const users = loadUsers();
    const user = users.find(u => String(u.email || '').toLowerCase() === targetEmail);
    if (!user) return json(res, 404, { error: '用户不存在' });
    readBody(req).then(async body => {
      const currentRole = normalizeUserRole(user);
      const nextRole = body.role === undefined ? currentRole : String(body.role).trim().toLowerCase();
      if (!ACCOUNT_ROLES.has(nextRole)) throw new Error('用户等级只能是 admin、vip 或 normal');
      if (isConfiguredAdminEmail(user.email) && nextRole !== 'admin') throw new Error('系统管理员邮箱不能降级');
      if (currentRole === 'admin' && nextRole !== 'admin') {
        const adminCount = users.filter(u => normalizeUserRole(u) === 'admin').length;
        if (adminCount <= 1) throw new Error('不能删除最后一个管理员');
      }
      if (body.name !== undefined) {
        const name = String(body.name).trim().slice(0, 24);
        if (!name) throw new Error('用户名称不能为空');
        user.name = name;
      }
      if (body.credits !== undefined) {
        const credits = Number(body.credits);
        if (!Number.isFinite(credits) || credits < 0 || credits > 1000000000000) throw new Error('积分必须是 0 到 1e12 之间的数字');
        user.credits = Math.round(credits * 100) / 100;
      } else if (currentRole === 'admin' && nextRole !== 'admin' && !Number.isFinite(Number(user.credits))) {
        user.credits = 500;
      }
      user.role = nextRole;
      user.level = nextRole;
      user.plan = nextRole;
      // Persist only the edited account so a concurrent AI settlement cannot
      // be overwritten by a stale full-user snapshot.
      if (POSTGRES_MODE) {
        const row = await postgresRepository.runtimeUpdateAccount({
          actorUserId: auth.user.userId,
          userId: user.userId,
          name: user.name,
          avatar: user.avatar,
          bio: user.bio,
          defaultModel: user.defaultModel,
          salt: user.salt,
          pwd: user.pwd,
          role: user.role,
          level: user.level,
          plan: user.plan,
          credits: user.credits,
          spent: user.spent,
          createdAtText: user.createdAt,
          preserveFinancials: body.credits === undefined
        });
        const saved = cachePostgresRuntimeUser(postgresRuntimeUserFromRow(row));
        if (saved && saved !== user) Object.assign(user, saved);
      } else {
        saveUser(user, auth.user.userId);
      }
      appendAdminAudit(auth.user.email, 'user.update', user.email, { role: nextRole, name: user.name, credits: user.credits });
      json(res, 200, { ok: true, user: adminUserView(user) });
    }).catch(e => respondError(res, e));
  }
  
  function handleAdminSkills(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const globals = loadGlobalSkills().map(s => ({ ...s, editable: true, source: 'global', global: true }));
    json(res, 200, { ok: true, skills: [...globals, ...builtinSkillsForAdmin()], targets: [...SKILL_TARGETS] });
  }
  
  function handleAdminSkillCreate(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    readBody(req).then(body => {
      const skill = makeGlobalSkill(body || {});
      const skills = loadGlobalSkills().slice();
      skills.unshift(skill);
      assertPlatformConfigPromotion({ kind: 'global-prompts', proposed: canonicalGlobalPrompts(skills), evidence: body.qualityEvidence });
      saveGlobalSkills(skills);
      appendAdminAudit(auth.user.email, 'skill.create', skill.id, { name: skill.name, targets: skill.targets });
      json(res, 200, { ok: true, skill });
    }).catch(e => respondError(res, e));
  }
  
  function handleAdminSkillPatch(req, res, id) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    let skillId;
    try { skillId = decodePathParam(id); }
    catch (e) { return respondError(res, e); }
    const skills = loadGlobalSkills().slice();
    const index = skills.findIndex(s => s.id === skillId);
    if (index < 0) return json(res, 404, { error: '全局 Skill 不存在或不可编辑' });
    readBody(req).then(body => {
      const skill = makeGlobalSkill(body || {}, skills[index]);
      skills[index] = skill;
      assertPlatformConfigPromotion({ kind: 'global-prompts', proposed: canonicalGlobalPrompts(skills), evidence: body.qualityEvidence });
      saveGlobalSkills(skills);
      appendAdminAudit(auth.user.email, 'skill.update', skill.id, { name: skill.name, enabled: skill.enabled, targets: skill.targets });
      json(res, 200, { ok: true, skill });
    }).catch(e => respondError(res, e));
  }
  
  function handleAdminSkillDelete(req, res, id) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    let skillId;
    try { skillId = decodePathParam(id); }
    catch (e) { return respondError(res, e); }
    const skills = loadGlobalSkills().slice();
    const index = skills.findIndex(s => s.id === skillId);
    if (index < 0) return json(res, 404, { error: '全局 Skill 不存在或不可编辑' });
    readBody(req).then(body => {
      const [removed] = skills.splice(index, 1);
      assertPlatformConfigPromotion({ kind: 'global-prompts', proposed: canonicalGlobalPrompts(skills), evidence: body.qualityEvidence });
      saveGlobalSkills(skills);
      appendAdminAudit(auth.user.email, 'skill.delete', skillId, { name: removed.name });
      json(res, 200, { ok: true, id: skillId });
    }).catch(e => respondError(res, e));
  }
  
  function handleAdminAudit(req, res) {
    if (!requireAdmin(req, res)) return;
    let limit = 50;
    try { limit = Number(new URL(req.url, 'http://localhost').searchParams.get('limit')) || 50; } catch (_) {}
    json(res, 200, { ok: true, audit: loadAdminAudit(limit) });
  }
  
  function adminDataType(value) {
    const type = String(value || '').trim().toLowerCase();
    if (!ADMIN_DATA_TYPES.has(type)) throw requestError(400, '不支持的数据类型');
    return type;
  }
  
  function adminDataJson(value, label, maxBytes = 5 * 1024 * 1024) {
    const text = JSON.stringify(value == null ? {} : value);
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw requestError(413, label + '数据过大');
    return text;
  }
  
  function adminAccountRecord(row) {
    const user = row && row.email ? row : getUserByEmail(row);
    if (!user) return null;
    const role = normalizeUserRole(user);
    return {
      email: user.email,
      name: user.name || '',
      avatar: storedAvatar(user.avatar),
      role,
      level: role,
      plan: role,
      credits: role === 'admin' ? null : roundCreditValue(user.credits),
      spent: roundCreditValue(user.spent),
      createdAt: user.createdAt || null,
      unlimitedCredits: role === 'admin'
    };
  }
  
  function adminUsageRecord(row) {
    const skillAudit = storedSkillAudit(row.skill_audit_json);
    return {
      requestId: row.request_id,
      userEmail: row.user_email,
      modelId: row.model_id,
      providerModel: row.provider_model,
      promptTokens: row.prompt_tokens == null ? null : Number(row.prompt_tokens),
      completionTokens: row.completion_tokens == null ? null : Number(row.completion_tokens),
      reasoningTokens: row.reasoning_tokens == null ? null : Number(row.reasoning_tokens),
      totalTokens: row.total_tokens == null ? null : Number(row.total_tokens),
      cachedTokens: row.cached_tokens == null ? null : Number(row.cached_tokens),
      cacheWriteTokens: row.cache_write_tokens == null ? null : Number(row.cache_write_tokens),
      usageSource: row.usage_source,
      status: row.status,
      createdAt: Number(row.created_at) || 0,
      durationMs: Number(row.duration_ms) || 0,
      creditCost: roundCreditValue(row.credit_cost),
      reservedCost: roundCreditValue(row.reserved_cost),
      skillIds: skillIdsFromAudit(row.skill_ids_json || skillAudit),
      skillAudit,
      correctionAudit: skillAudit.correctionAudit || emptyCorrectionAudit(false),
      messagesHash: String(row.messages_sha256 || skillAudit.promptHash || '').slice(0, 64)
    };
  }
  
  function adminDataList(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    if (!dbReady()) return json(res, 503, { error: '云端数据库不可用' });
    let type, page = 1, pageSize = 50, query = '';
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      type = adminDataType(params.get('type'));
      page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
      pageSize = Math.min(100, Math.max(10, Math.floor(Number(params.get('pageSize')) || 50)));
      query = String(params.get('q') || '').trim().slice(0, 120);
    } catch (error) { return respondError(res, error); }
    const like = '%' + query.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%';
    let rows = [], total = 0;
    const offset = (page - 1) * pageSize;
    if (type === 'accounts') {
      const condition = query ? "WHERE LOWER(email) LIKE ? ESCAPE '\\' OR LOWER(name) LIKE ? ESCAPE '\\'" : '';
      const args = query ? [like, like] : [];
      total = Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM accounts ' + condition).get(...args).n) || 0;
      rows = getDatabase().prepare(`SELECT email, name, role, credits, spent, created_at AS createdAt
        FROM accounts ${condition} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset).map(row => ({
        id: row.email, owner: row.email, title: row.name || row.email, status: normalizeUserRole(row),
        summary: '积分 ' + (normalizeUserRole(row) === 'admin' ? '无限' : roundCreditValue(row.credits)),
        updatedAt: row.createdAt, size: 0
      }));
    } else if (type === 'novels') {
      const condition = query ? "WHERE LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(user_email) LIKE ? ESCAPE '\\'" : '';
      const args = query ? [like, like] : [];
      total = Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM novels ' + condition).get(...args).n) || 0;
      rows = getDatabase().prepare(`SELECT id, user_email, title, word_count, revision, created_at, updated_at, LENGTH(state_json) AS size
        FROM novels ${condition} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset).map(row => ({
        id: row.id, owner: row.user_email, title: row.title, status: 'revision ' + (Number(row.revision) || 0),
        summary: (Number(row.word_count) || 0) + ' 字', updatedAt: row.updated_at, createdAt: row.created_at, size: Number(row.size) || 0
      }));
    } else if (type === 'user-skills') {
      const condition = query ? "WHERE LOWER(user_email) LIKE ? ESCAPE '\\' OR LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(id) LIKE ? ESCAPE '\\'" : '';
      const args = query ? [like, like, like] : [];
      total = Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM user_skills ' + condition).get(...args).n) || 0;
      rows = getDatabase().prepare(`SELECT user_email, id, name, description, size, updated_at
        FROM user_skills ${condition} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset).map(row => ({
        id: row.id, owner: row.user_email, title: row.name, status: '用户 Skill', summary: row.description || '无描述',
        updatedAt: row.updated_at, size: Number(row.size) || 0
      }));
    } else if (type === 'global-skills') {
      const condition = query ? "WHERE LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(id) LIKE ? ESCAPE '\\'" : '';
      const args = query ? [like, like] : [];
      total = Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM global_skills ' + condition).get(...args).n) || 0;
      rows = getDatabase().prepare(`SELECT id, name, description, enabled, created_at, updated_at, LENGTH(instruction) AS size
        FROM global_skills ${condition} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset).map(row => ({
        id: row.id, title: row.name, status: row.enabled ? '启用' : '停用', summary: row.description || '无描述',
        updatedAt: row.updated_at, createdAt: row.created_at, size: Number(row.size) || 0
      }));
    } else if (type === 'open-skills') {
      const condition = query ? "WHERE LOWER(owner_email) LIKE ? ESCAPE '\\' OR LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(id) LIKE ? ESCAPE '\\'" : '';
      const args = query ? [like, like, like] : [];
      total = Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM open_skills ' + condition).get(...args).n) || 0;
      rows = getDatabase().prepare(`SELECT id, owner_email, name, status, downloads, updated_at, LENGTH(instruction) AS size
        FROM open_skills ${condition} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset).map(row => ({
        id: row.id, owner: row.owner_email, title: row.name, status: row.status === 'published' ? '已发布' : '已撤回', summary: (Number(row.downloads) || 0) + ' 次下载',
        updatedAt: row.updated_at, size: Number(row.size) || 0
      }));
    } else if (type === 'builtin-skills') {
      const builtins = builtinSkillsForAdmin().filter(skill => !query || String(skill.name + ' ' + skill.id + ' ' + skill.description).toLowerCase().includes(query.toLowerCase()));
      total = builtins.length;
      rows = builtins.slice(offset, offset + pageSize).map(skill => ({
        id: skill.id, title: skill.name, status: '源文件只读', summary: skill.description || '无描述',
        updatedAt: null, size: Number(skill.size) || 0
      }));
    } else if (type === 'token-usage') {
      const condition = query ? "WHERE LOWER(request_id) LIKE ? ESCAPE '\\' OR LOWER(user_email) LIKE ? ESCAPE '\\' OR LOWER(model_id) LIKE ? ESCAPE '\\'" : '';
      const args = query ? [like, like, like] : [];
      total = Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM token_usage ' + condition).get(...args).n) || 0;
      rows = getDatabase().prepare(`SELECT request_id, user_email, model_id, status, total_tokens, credit_cost, skill_ids_json, created_at
        FROM token_usage ${condition} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset).map(row => ({
        skillCount: skillIdsFromAudit(row.skill_ids_json).length,
        id: row.request_id, owner: row.user_email, title: row.model_id, status: row.status,
        summary: (row.total_tokens == null ? 'Token 待结算' : Number(row.total_tokens) + ' Token') + ' · ' + roundCreditValue(row.credit_cost) + ' 积分' + (skillIdsFromAudit(row.skill_ids_json).length ? ' · Skill ' + skillIdsFromAudit(row.skill_ids_json).length : ''),
        updatedAt: row.created_at, size: 0
      }));
    } else if (type === 'dissections') {
      const condition = query ? "WHERE LOWER(id) LIKE ? ESCAPE '\\' OR LOWER(user_email) LIKE ? ESCAPE '\\' OR LOWER(title) LIKE ? ESCAPE '\\'" : '';
      const args = query ? [like, like, like] : [];
      total = Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM dissections ' + condition).get(...args).n) || 0;
      rows = getDatabase().prepare(`SELECT id, user_email, title, status, phase, progress, selected_model, actual_credits, created_at, updated_at, LENGTH(source_text) AS size
        FROM dissections ${condition} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset).map(row => ({
        id: row.id, owner: row.user_email, title: row.title, status: row.status, summary: row.phase + ' · ' + (Number(row.progress) || 0) + '% · ' + roundCreditValue(row.actual_credits) + ' 积分',
        updatedAt: row.updated_at, createdAt: row.created_at, size: Number(row.size) || 0, model: row.selected_model
      }));
    }
    const params = new URL(req.url, 'http://localhost').searchParams;
    const detailId = params.get('id');
    if (detailId) {
      return adminDataGetRecord(type, params, res);
    }
    json(res, 200, { ok: true, type, rows, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  }
  
  function adminDataGetRecord(type, params, res) {
    let record = null;
    const id = String(params.get('id') || '');
    if (type === 'accounts') record = adminAccountRecord(getUserByEmail(id));
    else if (type === 'novels') {
      const row = getDatabase().prepare('SELECT id, user_email, title, state_json, word_count, created_at, updated_at, revision FROM novels WHERE id = ?').get(id);
      if (row) { let state = {}; try { state = JSON.parse(row.state_json); } catch (_) { state = {}; } record = { id: row.id, userEmail: row.user_email, title: row.title, wordCount: Number(row.word_count) || 0, createdAt: row.created_at, updatedAt: row.updated_at, revision: Number(row.revision) || 0, state }; }
    } else if (type === 'user-skills') {
      const owner = String(params.get('owner') || params.get('email') || '').trim().toLowerCase();
      const skillId = String(params.get('skillId') || id);
      const row = getDatabase().prepare('SELECT user_email, id, name, description, instruction, files_json, size, updated_at FROM user_skills WHERE user_email = ? AND id = ?').get(owner, skillId);
      if (row) { const storedFiles = parseStoredSkillFiles(row.files_json); record = { owner: row.user_email, id: row.id, name: row.name, description: row.description, instruction: row.instruction, files: storedFiles.files, runtimeFiles: storedFiles.runtimeFiles, fileManifest: storedFiles.fileManifest, size: Number(row.size) || 0, updatedAt: row.updated_at }; }
    } else if (type === 'global-skills') {
      record = loadGlobalSkills().find(skill => skill.id === id) || null;
    } else if (type === 'open-skills') {
      const skill = findOpenSkill(id);
      if (skill) record = { ...skill, owner: skill.ownerEmail, ownerEmail: skill.ownerEmail };
    } else if (type === 'builtin-skills') {
      record = builtinSkillsForAdmin().find(skill => skill.id === id) || null;
    } else if (type === 'token-usage') {
      const row = getDatabase().prepare('SELECT * FROM token_usage WHERE request_id = ?').get(id);
      if (row) record = adminUsageRecord(row);
    } else if (type === 'dissections') {
      const row = getDatabase().prepare('SELECT * FROM dissections WHERE id = ?').get(id);
      if (row) record = dissectionRecordFromDb(row);
    }
    if (!record) return json(res, 404, { error: '数据记录不存在' });
    json(res, 200, { ok: true, type, record });
  }
  
  function adminDataPatch(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    if (!dbReady()) return json(res, 503, { error: '云端数据库不可用' });
    readBody(req).then(body => {
      const type = adminDataType(body && body.type);
      const record = body && body.record && typeof body.record === 'object' ? body.record : body;
      const id = String(body && body.id || record && (record.id || record.requestId || record.email) || '').trim();
      let saved;
      if (type === 'accounts') {
        const current = getUserByEmail(id);
        if (!current) throw requestError(404, '账户不存在');
        const nextRole = record.role === undefined ? normalizeUserRole(current) : String(record.role).trim().toLowerCase();
        if (!ACCOUNT_ROLES.has(nextRole)) throw new Error('账户等级不合法');
        if (isConfiguredAdminEmail(current.email) && nextRole !== 'admin') throw new Error('系统管理员不能降级');
        if (normalizeUserRole(current) === 'admin' && nextRole !== 'admin' && loadUsers().filter(item => normalizeUserRole(item) === 'admin').length <= 1) throw new Error('不能删除最后一个管理员');
        if (record.name !== undefined) { current.name = String(record.name).trim().slice(0, 24); if (!current.name) throw new Error('用户名不能为空'); }
        if (record.avatar !== undefined) current.avatar = normalizeAvatar(record.avatar, current.avatar);
        if (record.credits !== undefined && nextRole !== 'admin') current.credits = roundCreditValue(record.credits);
        if (record.spent !== undefined) current.spent = roundCreditValue(record.spent);
        current.role = nextRole; current.level = nextRole; current.plan = nextRole;
        saveUser(current); saved = adminAccountRecord(current);
      } else if (type === 'novels') {
        const current = getDatabase().prepare('SELECT * FROM novels WHERE id = ?').get(id);
        if (!current) throw requestError(404, '作品不存在');
        const state = record.state;
        if (!state || typeof state !== 'object' || !Array.isArray(state.volumes)) throw new Error('作品 state 不合法');
        const clean = sanitizeNovelStateForStorage(state);
        const title = String(record.title || clean.title || '未命名小说').trim().slice(0, 200);
        const owner = String(record.userEmail || current.user_email).trim().toLowerCase();
        if (!getUserByEmail(owner)) throw new Error('作品所属账户不存在');
        const stateJson = adminDataJson(clean, '作品', MAX_NOVEL_STATE_BYTES);
        const now = Date.now();
        const revision = Math.max(Number(current.revision) || 0, Number(record.revision) || 0) + 1;
        getDatabase().prepare('UPDATE novels SET user_email = ?, title = ?, state_json = ?, word_count = ?, updated_at = ?, revision = ? WHERE id = ?').run(owner, title, stateJson, calcWordCount(clean), now, revision, id);
        saved = { id, userEmail: owner, title, wordCount: calcWordCount(clean), createdAt: current.created_at, updatedAt: now, revision, state: clean };
      } else if (type === 'user-skills') {
        const owner = String(body.owner || record.owner || '').trim().toLowerCase();
        const skillId = String(body.skillId || record.id || id).trim();
        if (!owner || !skillId) throw new Error('用户 Skill 缺少所属账户或 id');
        if (!getUserByEmail(owner)) throw new Error('Skill 所属账户不存在');
        const allSkills = loadAllUserSkillRecords();
        const list = Array.isArray(allSkills[owner]) ? allSkills[owner] : [];
        const index = list.findIndex(item => item && item.id === skillId);
        if (index < 0) throw requestError(404, '用户 Skill 不存在');
        const current = list[index];
        const instruction = String(record.instruction !== undefined ? record.instruction : current.instruction).replace(/\u0000/g, '').trim().slice(0, 200000);
        if (!instruction) throw new Error('Skill 指令内容不能为空');
        const runtimeFiles = normalizeSkillRuntimeFiles(record.runtimeFiles !== undefined ? record.runtimeFiles : current.runtimeFiles, record.files !== undefined ? record.files : current.files, { strict: true });
        const files = skillFileNames(runtimeFiles, record.files !== undefined ? record.files : current.files);
        const fileManifest = Array.isArray(record.fileManifest) ? record.fileManifest : current.fileManifest || [];
        const updated = { ...current, id: skillId, name: String(record.name !== undefined ? record.name : current.name || skillId).trim().slice(0, 120), description: String(record.description !== undefined ? record.description : current.description || '').trim().slice(0, 500), instruction, files, runtimeFiles, fileManifest, complete: skillRuntimeFilesComplete(files, runtimeFiles, fileManifest), size: instruction.length, updatedAt: Date.now() };
        if (!updated.name) throw new Error('Skill 名称不能为空');
        list[index] = updated; allSkills[owner] = list; saveAllUserSkillRecords(allSkills); saved = { owner, ...updated };
      } else if (type === 'global-skills') {
        const skills = loadGlobalSkills().slice();
        const index = skills.findIndex(skill => skill.id === id);
        if (index < 0) throw requestError(404, '全局 Skill 不存在');
        const updated = makeGlobalSkill(record, skills[index]);
        skills[index] = updated;
        assertPlatformConfigPromotion({ kind: 'global-prompts', proposed: canonicalGlobalPrompts(skills), evidence: body.qualityEvidence });
        saveGlobalSkills(skills); saved = updated;
      } else if (type === 'open-skills') {
        const current = findOpenSkill(id);
        if (!current) throw requestError(404, '开放 Skill 不存在');
        const updated = makeOpenSkill(record, current, current.ownerEmail);
        updateOpenSkill(updated);
        saved = { ...updated, owner: updated.ownerEmail };
      } else if (type === 'builtin-skills') {
        throw requestError(409, '内置 Skill 源文件只读，请复制为全局 Skill 后修改');
      } else if (type === 'token-usage') {
        const current = getDatabase().prepare('SELECT * FROM token_usage WHERE request_id = ?').get(id);
        if (!current) throw requestError(404, 'Token 记录不存在');
        const nextCost = roundCreditValue(record.creditCost === undefined ? current.credit_cost : record.creditCost);
        const delta = Math.round((nextCost - (Number(current.credit_cost) || 0)) * 100) / 100;
        getDatabase().exec('BEGIN IMMEDIATE');
        try {
          if (delta > 0) {
            const debit = getDatabase().prepare('UPDATE accounts SET credits = credits - ?, spent = spent + ? WHERE email = ? AND role <> \'admin\' AND credits >= ?').run(delta, delta, current.user_email, delta);
            if (Number(debit.changes || 0) !== 1) throw new Error('账户积分不足，无法增加该记录的扣费');
          } else if (delta < 0) {
            getDatabase().prepare('UPDATE accounts SET credits = credits + ?, spent = MAX(0, spent - ?) WHERE email = ? AND role <> \'admin\'').run(-delta, -delta, current.user_email);
          }
          const tokenColumns = { promptTokens: 'prompt_tokens', completionTokens: 'completion_tokens', reasoningTokens: 'reasoning_tokens', totalTokens: 'total_tokens', cachedTokens: 'cached_tokens', cacheWriteTokens: 'cache_write_tokens' };
          const numberOrNull = key => record[key] === null ? null : (record[key] === undefined ? current[tokenColumns[key]] : Math.max(0, Math.floor(Number(record[key]) || 0)));
          getDatabase().prepare(`UPDATE token_usage SET model_id = ?, provider_model = ?, prompt_tokens = ?, completion_tokens = ?, reasoning_tokens = ?, total_tokens = ?, cached_tokens = ?, cache_write_tokens = ?, usage_source = ?, status = ?, duration_ms = ?, credit_cost = ? WHERE request_id = ?`).run(
            String(record.modelId === undefined ? current.model_id : record.modelId).slice(0, 160), String(record.providerModel === undefined ? current.provider_model : record.providerModel).slice(0, 200),
            numberOrNull('promptTokens'), numberOrNull('completionTokens'), numberOrNull('reasoningTokens'), numberOrNull('totalTokens'), numberOrNull('cachedTokens'), numberOrNull('cacheWriteTokens'),
            String(record.usageSource === undefined ? current.usage_source : record.usageSource).slice(0, 40), String(record.status === undefined ? current.status : record.status).slice(0, 40), Math.max(0, Math.floor(Number(record.durationMs === undefined ? current.duration_ms : record.durationMs) || 0)), nextCost, id
          );
          getDatabase().exec('COMMIT');
        } catch (error) { try { getDatabase().exec('ROLLBACK'); } catch (_) {} throw error; }
        saved = adminUsageRecord(getDatabase().prepare('SELECT * FROM token_usage WHERE request_id = ?').get(id));
      } else if (type === 'dissections') {
        const current = getDatabase().prepare('SELECT * FROM dissections WHERE id = ?').get(id);
        if (!current) throw requestError(404, '拆书任务不存在');
        const selectedModel = String(record.selectedModel === undefined ? current.selected_model : record.selectedModel).trim();
        if (selectedModel && !findPlatformModel(selectedModel)) throw new Error('拆书任务模型不存在');
        const resultJson = adminDataJson(record.result === undefined ? safeJsonParse(current.result_json) || {} : record.result, '拆书结果');
        const metaJson = adminDataJson(record.meta === undefined ? safeJsonParse(current.meta_json) || {} : record.meta, '拆书元数据');
        const sourceText = String(record.sourceText === undefined ? current.source_text : record.sourceText).replace(/\u0000/g, '');
        if (Buffer.byteLength(sourceText, 'utf8') > 5 * 1024 * 1024) throw requestError(413, '拆书原文不能超过 5 MB');
        const now = Date.now();
        getDatabase().prepare(`UPDATE dissections SET title = ?, source_type = ?, source_name = ?, source_text = ?, depth = ?, purpose = ?, selected_model = ?, status = ?, phase = ?, phase_index = ?, progress = ?, estimated_credits = ?, actual_credits = ?, result_json = ?, meta_json = ?, error = ?, cancel_requested = ?, updated_at = ? WHERE id = ?`).run(
          String(record.title === undefined ? current.title : record.title).trim().slice(0, 200), String(record.sourceType === undefined ? current.source_type : record.sourceType).slice(0, 40), String(record.sourceName === undefined ? current.source_name : record.sourceName).slice(0, 200), sourceText,
          String(record.depth === undefined ? current.depth : record.depth).slice(0, 40), String(record.purpose === undefined ? current.purpose : record.purpose).slice(0, 80), selectedModel,
          String(record.status === undefined ? current.status : record.status).slice(0, 40), String(record.phase === undefined ? current.phase : record.phase).slice(0, 40), Math.max(0, Math.floor(Number(record.phaseIndex === undefined ? current.phase_index : record.phaseIndex) || 0)), Math.min(100, Math.max(0, Math.floor(Number(record.progress === undefined ? current.progress : record.progress) || 0))), Math.max(0, Number(record.estimatedCredits === undefined ? current.estimated_credits : record.estimatedCredits) || 0), Math.max(0, Number(record.actualCredits === undefined ? current.actual_credits : record.actualCredits) || 0), resultJson, metaJson, String(record.error === undefined ? current.error : record.error).slice(0, 5000), record.cancelRequested === undefined ? current.cancel_requested : (record.cancelRequested ? 1 : 0), now, id
        );
        saved = dissectionRecordFromDb(getDatabase().prepare('SELECT * FROM dissections WHERE id = ?').get(id));
      }
      appendAdminAudit(auth.user.email, 'data.' + type + '.update', id, { type, id });
      json(res, 200, { ok: true, type, record: saved });
    }).catch(e => respondError(res, e));
  }
  
  function adminDataDelete(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    if (!dbReady()) return json(res, 503, { error: '云端数据库不可用' });
    readBody(req).then(body => {
      const type = adminDataType(body && body.type);
      const id = String(body && body.id || '').trim();
      if (!id) throw new Error('缺少数据 id');
      let changes = 0, detail = { type, id };
      if (type === 'novels') changes = Number(getDatabase().prepare('DELETE FROM novels WHERE id = ?').run(id).changes || 0);
      else if (type === 'global-skills') { const skills = loadGlobalSkills(); const next = skills.filter(skill => skill.id !== id); changes = skills.length - next.length; if (changes) { assertPlatformConfigPromotion({ kind: 'global-prompts', proposed: canonicalGlobalPrompts(next), evidence: body.qualityEvidence }); saveGlobalSkills(next); } }
      else if (type === 'open-skills') changes = deleteOpenSkill(id);
      else if (type === 'user-skills') {
        const owner = String(body.owner || '').trim().toLowerCase();
        const allSkills = loadAllUserSkillRecords(); const list = Array.isArray(allSkills[owner]) ? allSkills[owner] : []; const next = list.filter(skill => skill.id !== String(body.skillId || id));
        changes = list.length - next.length; if (changes) { allSkills[owner] = next; saveAllUserSkillRecords(allSkills); }
      } else if (type === 'dissections') changes = deleteDissectionCascade(id);
      else if (type === 'accounts' || type === 'token-usage' || type === 'builtin-skills') throw requestError(409, '该数据类型不允许删除');
      if (!changes) return json(res, 404, { error: '数据记录不存在' });
      appendAdminAudit(auth.user.email, 'data.' + type + '.delete', id, { type, id });
      json(res, 200, { ok: true, type, id, deleted: changes });
    }).catch(e => respondError(res, e));
  }
  return { handleAdminModels, handleAdminModelsPatch, handleAdminCorrectionLibrary, requireAdmin, adminUserView, handleAdminOverview, handleAdminUserPatch, handleAdminSkills, handleAdminSkillCreate, handleAdminSkillPatch, handleAdminSkillDelete, handleAdminAudit, adminDataType, adminDataJson, adminAccountRecord, adminUsageRecord, adminDataList, adminDataGetRecord, adminDataPatch, adminDataDelete };
}
module.exports = { createAdminService };
