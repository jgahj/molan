'use strict';
const { assertPlatformConfigPromotion, canonicalGlobalPrompts } = require('../lib/evolution/platform-config-gate');

function createAdminService({
  ACCOUNT_ROLES,
  ADMIN_DATA_TYPES,
  CORRECTION_INBOX_FILE,
  MAX_NOVEL_STATE_BYTES,
  SKILL_TARGETS,
  appendAdminAudit,
  builtinSkillsForAdmin,
  buildUsageSummary,
  calcWordCount,
  contextWindowTokensForModel,
  correctionLibraryLib,
  correctionLibrarySummary,
  currentDefaultModel,
  decodePathParam,
  dissectionRecordFromDb,
  emptyCorrectionAudit,
  findPlatformModel,
  getAuthUser,
  getCorrectionLibrary,
  getPostgresUsageSummary,
  isAdminUser,
  isConfiguredAdminEmail,
  json,
  loadCorrectionHits,
  makeGlobalSkill,
  normalizeAvatar,
  normalizeUserRole,
  postgresRepository,
  postgresRuntimeUserFromRow,
  postgresRuntimeSkillFromRow,
  readBody,
  reasoningEffortsForModel,
  requestError,
  respondError,
  roundCreditValue,
  sanitizeNovelStateForStorage,
  saveModelPolicy,
  savePlatformModelRate,
  savePlatformModelRates,
  serializeSkillFiles,
  skillIdsFromAudit,
  storedAvatar,
  storedSkillAudit,
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
    return readBody(req).then(async body => {
      if (body && Object.prototype.hasOwnProperty.call(body, 'rates')) {
        const updates = savePlatformModelRates(body.rates);
        for (const item of updates.filter(item => item.previousCreditsPer1k !== item.creditsPer1k)) {
          await appendAdminAudit(auth.user.email, 'model.rate.update', item.modelId, {
            modelId: item.modelId,
            previousCreditsPer1k: item.previousCreditsPer1k,
            creditsPer1k: item.creditsPer1k,
            source: 'bulk'
          });
        }
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
        await appendAdminAudit(auth.user.email, 'model.rate.update', modelId, {
          modelId,
          previousCreditsPer1k,
          creditsPer1k: updated.creditsPer1k
        });
        return json(res, 200, { ok: true, model: { id: modelId, creditsPer1k: updated.creditsPer1k } });
      }
      const requested = String(body && body.defaultModel || '').trim();
      if (!requested || !findPlatformModel(requested)) throw new Error('默认模型不存在或未配置');
      assertPlatformConfigPromotion({ kind: 'default-model', proposed: requested, evidence: body.qualityEvidence });
      const defaultModel = saveModelPolicy(requested, body.qualityEvidence);
      await appendAdminAudit(auth.user.email, 'model.update', defaultModel, { defaultModel });
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
    if (!isAdminUser(auth.user)) {
      json(res, 403, { error: '仅管理员可以访问管理后台' });
      return null;
    }
    return auth;
  }
  
  function adminUserView(user, usageOverride) {
    const role = normalizeUserRole(user);
    const usage = usageOverride;
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
  
  async function handleAdminOverview(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    let page = 1, pageSize = 100, query = '', roleFilter = 'all';
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
      pageSize = Math.min(200, Math.max(20, Math.floor(Number(params.get('pageSize')) || 100)));
      query = String(params.get('q') || '').trim().slice(0, 120);
      roleFilter = String(params.get('role') || 'all').trim().toLowerCase();
      if (!ACCOUNT_ROLES.has(roleFilter) && roleFilter !== 'all') roleFilter = 'all';
    } catch (_) {}
      const [accounts, documents, globals, audit] = await Promise.all([
        postgresRepository.runtimeListAccounts(auth.user.userId),
        postgresRepository.runtimeListAllTokenUsage(auth.user.userId),
        postgresRepository.runtimeListGlobalSkills(auth.user.userId),
        postgresRepository.runtimeListAdminAudit(auth.user.userId, 8)
      ]);
      const rows = documents.map(document => {
        const row = { ...document };
        for (const [key, value] of Object.entries(document)) {
          row[key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase())] = value;
        }
        return row;
      });
      const grouped = new Map();
      for (const row of rows) {
        const email = String(row.userEmail || '').toLowerCase();
        if (!grouped.has(email)) grouped.set(email, []);
        grouped.get(email).push(row);
      }
      const counts = { admin: 0, vip: 0, normal: 0 };
      const users = accounts.map(postgresRuntimeUserFromRow);
      users.forEach(user => { counts[normalizeUserRole(user)]++; });
      const filtered = users.filter(user => (roleFilter === 'all' || normalizeUserRole(user) === roleFilter)
        && (!query || `${user.email} ${user.name}`.toLowerCase().includes(query.toLowerCase())));
      filtered.sort((first, second) => String(first.createdAt).localeCompare(String(second.createdAt)) || first.email.localeCompare(second.email));
      const usage = buildUsageSummary(rows);
      return json(res, 200, { ok: true,
        stats: { totalUsers: users.length, adminUsers: counts.admin, vipUsers: counts.vip, normalUsers: counts.normal,
          totalTokens: usage.totalTokens, requestCount: usage.requestCount, creditSpent: usage.creditSpent, cacheHitRate: usage.cacheHitRate },
        pagination: { page, pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)), query, role: roleFilter },
        usage, users: filtered.slice((page - 1) * pageSize, page * pageSize)
          .map(user => adminUserView(user, buildUsageSummary(grouped.get(user.email) || []))),
        skills: { global: globals.length, enabled: globals.filter(skill => skill.enabled !== false).length, builtin: builtinSkillsForAdmin().length },
        audit
      });
  }
  
  async function handleAdminUserPatch(req, res, email) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    let targetEmail;
    try { targetEmail = decodePathParam(email).trim().toLowerCase(); }
    catch (e) { return respondError(res, e); }
    const users = (await postgresRepository.runtimeListAccounts(auth.user.userId)).map(postgresRuntimeUserFromRow);
    const user = users.find(u => String(u.email || '').toLowerCase() === targetEmail);
    if (!user) return json(res, 404, { error: '用户不存在' });
    return readBody(req).then(async body => {
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
          preserveSpent: true,
          preserveFinancials: body.credits === undefined
        });
        const saved = postgresRuntimeUserFromRow(row);
        if (saved && saved !== user) Object.assign(user, saved);
      await appendAdminAudit(auth.user.email, 'user.update', user.email, { role: nextRole, name: user.name, credits: user.credits });
      const usage = await getPostgresUsageSummary(user.userId, false);
      json(res, 200, { ok: true, user: adminUserView(user, usage) });
    }).catch(e => respondError(res, e));
  }
  
  async function handleAdminSkills(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    const records = (await postgresRepository.runtimeListGlobalSkills(auth.user.userId)).map(row => postgresRuntimeSkillFromRow(row, global));
    const globals = records.map(s => ({ ...s, editable: true, source: 'global', global: true }));
    json(res, 200, { ok: true, skills: [...globals, ...builtinSkillsForAdmin()], targets: [...SKILL_TARGETS] });
  }
  
  function handleAdminSkillCreate(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    return readBody(req).then(async body => {
      const skill = makeGlobalSkill(body || {});
      const rows = await postgresRepository.runtimeListGlobalSkills(auth.user.userId);
      const skills = rows.map(row => postgresRuntimeSkillFromRow(row, global));
      if (skills.some(record => record.id === skill.id)) throw requestError(409, '全局 Skill 已存在');
      skills.unshift(skill);
      assertPlatformConfigPromotion({ kind: 'global-prompts', proposed: canonicalGlobalPrompts(skills), evidence: body.qualityEvidence });
      await postgresRepository.runtimeReplaceGlobalSkills(auth.user.userId,
        skills.map(record => ({ ...record, files_json: serializeSkillFiles(record) })), rows);
      await appendAdminAudit(auth.user.email, 'skill.create', skill.id, { name: skill.name, targets: skill.targets });
      json(res, 200, { ok: true, skill });
    }).catch(e => respondError(res, e));
  }
  
  async function handleAdminSkillPatch(req, res, id) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    let skillId;
    try { skillId = decodePathParam(id); }
    catch (e) { return respondError(res, e); }
    const rows = await postgresRepository.runtimeListGlobalSkills(auth.user.userId);
    const skills = rows.map(row => postgresRuntimeSkillFromRow(row, global));
    const index = skills.findIndex(s => s.id === skillId);
    if (index < 0) return json(res, 404, { error: '全局 Skill 不存在或不可编辑' });
    return readBody(req).then(async body => {
      const skill = makeGlobalSkill(body || {}, skills[index]);
      skills[index] = skill;
      assertPlatformConfigPromotion({ kind: 'global-prompts', proposed: canonicalGlobalPrompts(skills), evidence: body.qualityEvidence });
      await postgresRepository.runtimeReplaceGlobalSkills(auth.user.userId,
        skills.map(record => ({ ...record, files_json: serializeSkillFiles(record) })), rows);
      await appendAdminAudit(auth.user.email, 'skill.update', skill.id, { name: skill.name, enabled: skill.enabled, targets: skill.targets });
      json(res, 200, { ok: true, skill });
    }).catch(e => respondError(res, e));
  }
  
  async function handleAdminSkillDelete(req, res, id) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    let skillId;
    try { skillId = decodePathParam(id); }
    catch (e) { return respondError(res, e); }
    const rows = await postgresRepository.runtimeListGlobalSkills(auth.user.userId);
    const skills = rows.map(row => postgresRuntimeSkillFromRow(row, global));
    const index = skills.findIndex(s => s.id === skillId);
    if (index < 0) return json(res, 404, { error: '全局 Skill 不存在或不可编辑' });
    return readBody(req).then(async body => {
      const [removed] = skills.splice(index, 1);
      assertPlatformConfigPromotion({ kind: 'global-prompts', proposed: canonicalGlobalPrompts(skills), evidence: body.qualityEvidence });
      await postgresRepository.runtimeReplaceGlobalSkills(auth.user.userId,
        skills.map(record => ({ ...record, files_json: serializeSkillFiles(record) })), rows);
      await appendAdminAudit(auth.user.email, 'skill.delete', skillId, { name: removed.name });
      json(res, 200, { ok: true, id: skillId });
    }).catch(e => respondError(res, e));
  }
  
  async function handleAdminAudit(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    let limit = 50;
    try { limit = Number(new URL(req.url, 'http://localhost').searchParams.get('limit')) || 50; } catch (_) {}
    const audit = await postgresRepository.runtimeListAdminAudit(auth.user.userId, limit);
    json(res, 200, { ok: true, audit });
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
    const user = row && row.email ? row : null;
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
      creditCost: row.credit_cost == null ? null : roundCreditValue(row.credit_cost),
      reservedCost: row.reserved_cost == null ? null : roundCreditValue(row.reserved_cost),
      skillIds: skillIdsFromAudit(row.skill_ids_json || skillAudit),
      skillAudit,
      correctionAudit: skillAudit.correctionAudit || emptyCorrectionAudit(false),
      messagesHash: String(row.messages_sha256 || skillAudit.promptHash || '').slice(0, 64)
    };
  }
  
  async function adminDataList(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    if (!postgresRepository.enabled) return json(res, 503, { error: '云端数据库不可用' });
    let type, page = 1, pageSize = 50, query = '';
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      type = adminDataType(params.get('type'));
      page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
      pageSize = Math.min(100, Math.max(10, Math.floor(Number(params.get('pageSize')) || 50)));
      query = String(params.get('q') || '').trim().slice(0, 120);
    } catch (error) { return respondError(res, error); }
    if (type !== 'builtin-skills') {
      try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        if (params.get('id')) {
          const id = String(params.get('skillId') || params.get('id'));
          if (type === 'novels') {
            const novel = await postgresRepository.runtimeAdminGetNovel(auth.user.userId, id);
            if (!novel) return json(res, 404, { error: '数据记录不存在' });
            const record = {
              id: novel.id,
              userEmail: novel.userEmail,
              title: novel.title,
              wordCount: calcWordCount(novel.state || {}),
              createdAt: novel.createdAt,
              updatedAt: novel.updatedAt,
              revision: novel.revision,
              state: novel.state
            };
            return json(res, 200, { ok: true, type, record });
          }
          const source = await postgresRepository.runtimeAdminDataRows(auth.user.userId, type);
          const owner = String(params.get('owner') || params.get('email') || '').trim().toLowerCase();
          const skillId = String(params.get('skillId') || id);
          const row = source.find(item => String(type === 'accounts' ? item.email : type === 'token-usage' ? item.request_id : item.id) === (type === 'user-skills' ? skillId : id)
            && (type !== 'user-skills' || String(item.user_email || item.owner_email || '').toLowerCase() === owner));
          if (!row) return json(res, 404, { error: '数据记录不存在' });
          let record;
          if (type === 'accounts') record = adminAccountRecord(postgresRuntimeUserFromRow(row));
          else if (type === 'token-usage') record = adminUsageRecord(row);
          else if (type === 'dissections') record = dissectionRecordFromDb({
            ...row,
            result_json: typeof row.result_json === 'string' ? row.result_json : JSON.stringify(row.result_json || {}),
            meta_json: typeof row.meta_json === 'string' ? row.meta_json : JSON.stringify(row.meta_json || {})
          });
          else {
            record = postgresRuntimeSkillFromRow(row, type === 'global-skills' ? 'global' : type === 'open-skills' ? 'open' : 'user');
            record = { ...record, owner: row.user_email || row.owner_email };
          }
          return json(res, 200, { ok: true, type, record });
        }
        const source = await postgresRepository.runtimeAdminDataRows(auth.user.userId, type);
        const matched = source.filter(row => !query || [row.email, row.user_email, row.owner_email, row.name, row.title, row.id, row.request_id, row.model_id]
          .some(value => String(value || '').toLowerCase().includes(query.toLowerCase())));
        matched.sort((left, right) => Number(right.updated_at || right.created_at || 0) - Number(left.updated_at || left.created_at || 0));
        const rows = matched.slice((page - 1) * pageSize, page * pageSize).map(row => ({
          id: type === 'accounts' ? row.email : type === 'token-usage' ? row.request_id : row.id,
          owner: row.user_email || row.owner_email || row.email,
          title: row.title || row.name || row.model_id || row.email || row.id,
          status: type === 'accounts' ? normalizeUserRole(row) : type === 'global-skills' ? (row.enabled ? '启用' : '停用') : type === 'novels' ? ('revision ' + (Number(row.revision) || 0)) : row.status || '用户 Skill',
          summary: type === 'token-usage'
            ? (row.total_tokens == null ? 'Token 待结算' : Number(row.total_tokens) + ' Token') + ' · ' + (row.credit_cost == null ? '费用未知' : roundCreditValue(row.credit_cost) + ' 积分')
            : (type === 'novels'
              ? (calcWordCount(row.state || {}) + ' 字')
              : (row.description || (type === 'accounts' ? '积分 ' + (normalizeUserRole(row) === 'admin' ? '无限' : roundCreditValue(row.credits)) : row.phase || ''))),
          updatedAt: row.updated_at || row.created_at || null,
          createdAt: row.created_at,
          size: type === 'novels' ? (row.state ? JSON.stringify(row.state).length : 0) : (Number(row.size) || String(row.instruction || row.source_text || '').length),
          model: row.selected_model,
          ...(type === 'token-usage' ? { skillCount: skillIdsFromAudit(row.skill_ids_json).length } : {})
        }));
        return json(res, 200, { ok: true, type, rows, pagination: { page, pageSize, total: matched.length, totalPages: Math.max(1, Math.ceil(matched.length / pageSize)) } });
      } catch (error) { return respondError(res, error); }
    }
  }
  
  async function adminDataGetRecord(type, params, res, actorUserId = '') {
    const id = String(params.get('id') || '');
    if (type !== 'builtin-skills') {
      try {
        if (type === 'novels') {
          const novel = await postgresRepository.runtimeAdminGetNovel(actorUserId, id);
          if (!novel) return json(res, 404, { error: '数据记录不存在' });
          const record = {
            id: novel.id,
            userEmail: novel.userEmail,
            title: novel.title,
            wordCount: calcWordCount(novel.state || {}),
            createdAt: novel.createdAt,
            updatedAt: novel.updatedAt,
            revision: novel.revision,
            state: novel.state
          };
          return json(res, 200, { ok: true, type, record });
        }
        const source = await postgresRepository.runtimeAdminDataRows(actorUserId, type);
        const owner = String(params.get('owner') || params.get('email') || '').trim().toLowerCase();
        const skillId = String(params.get('skillId') || id);
        const row = source.find(item => String(type === 'accounts' ? item.email : type === 'token-usage' ? item.request_id : item.id) === (type === 'user-skills' ? skillId : id)
          && (type !== 'user-skills' || String(item.user_email || item.owner_email || '').toLowerCase() === owner));
        if (!row) return json(res, 404, { error: '数据记录不存在' });
        let record;
        if (type === 'accounts') record = adminAccountRecord(postgresRuntimeUserFromRow(row));
        else if (type === 'token-usage') record = adminUsageRecord(row);
        else if (type === 'dissections') record = dissectionRecordFromDb({
          ...row,
          result_json: typeof row.result_json === 'string' ? row.result_json : JSON.stringify(row.result_json || {}),
          meta_json: typeof row.meta_json === 'string' ? row.meta_json : JSON.stringify(row.meta_json || {})
        });
        else {
          record = postgresRuntimeSkillFromRow(row, type === 'global-skills' ? 'global' : type === 'open-skills' ? 'open' : 'user');
          record = { ...record, owner: row.user_email || row.owner_email };
        }
        return json(res, 200, { ok: true, type, record });
      } catch (error) { return respondError(res, error); }
    }
    let record = null;
    if (type === 'builtin-skills') {
      record = builtinSkillsForAdmin().find(skill => skill.id === id) || null;
    }
    if (!record) return json(res, 404, { error: '数据记录不存在' });
    json(res, 200, { ok: true, type, record });
  }
  
  function adminDataPatch(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    if (!postgresRepository.enabled) return json(res, 503, { error: '云端数据库不可用' });
    return readBody(req).then(async body => {
      const type = adminDataType(body && body.type);
      const record = body && body.record && typeof body.record === 'object' ? body.record : body;
      const id = String(body && body.id || record && (record.id || record.requestId || record.email) || '').trim();
      let saved;
      if (type === 'accounts') {
        const current = postgresRuntimeUserFromRow(await postgresRepository.runtimeAccountByEmail(id));
        if (!current) throw requestError(404, '账户不存在');
        const nextRole = record.role === undefined ? normalizeUserRole(current) : String(record.role).trim().toLowerCase();
        if (!ACCOUNT_ROLES.has(nextRole)) throw new Error('账户等级不合法');
        if (isConfiguredAdminEmail(current.email) && nextRole !== 'admin') throw new Error('系统管理员不能降级');
        if (record.name !== undefined) { current.name = String(record.name).trim().slice(0, 24); if (!current.name) throw new Error('用户名不能为空'); }
        if (record.avatar !== undefined) current.avatar = normalizeAvatar(record.avatar, current.avatar);
        if (record.credits !== undefined && nextRole !== 'admin') current.credits = roundCreditValue(record.credits);
        if (record.spent !== undefined) current.spent = roundCreditValue(record.spent);
        current.role = nextRole; current.level = nextRole; current.plan = nextRole;
          const row = await postgresRepository.runtimeAdminUpdateAccount({
            ...current, actorUserId: auth.user.userId, userId: current.userId,
            createdAtText: current.createdAt,
            preserveFinancials: record.credits === undefined && record.spent === undefined,
            preserveSpent: record.spent === undefined,
            audit: {
              actorEmail: auth.user.email,
              action: 'data.accounts.update',
              target: id,
              details: { type, id }
            }
          });
          saved = adminAccountRecord(postgresRuntimeUserFromRow(row));
      } else if (type === 'novels') {
          const state = record.state;
          if (!state || typeof state !== 'object' || !Array.isArray(state.volumes)) throw new Error('作品 state 不合法');
          const clean = sanitizeNovelStateForStorage(state);
          const title = String(record.title || clean.title || '未命名小说').trim().slice(0, 200);
          const owner = record.userEmail ? String(record.userEmail).trim().toLowerCase() : undefined;
          const expectedRevision = body.expectedRevision !== undefined ? body.expectedRevision : (record.revision !== undefined ? record.revision : body.revision);
          const writeRes = await postgresRepository.runtimeAdminWriteNovel({
            actorUserId: auth.user.userId,
            id,
            title,
            state: clean,
            userEmail: owner,
            expectedRevision,
            audit: {
              actorEmail: auth.user.email,
              action: 'data.novels.update',
              target: id,
              details: { type, id }
            }
          });
          const novel = await postgresRepository.runtimeAdminGetNovel(auth.user.userId, id);
          saved = {
            id,
            userEmail: novel.userEmail,
            title: novel.title,
            wordCount: calcWordCount(clean),
            createdAt: novel.createdAt,
            updatedAt: novel.updatedAt,
            revision: writeRes.revision,
            state: novel.state
          };
      } else if (type === 'user-skills') {
        const owner = String(body.owner || record.owner || '').trim().toLowerCase();
        const skillId = String(body.skillId || record.id || id).trim();
        if (!owner || !skillId) throw new Error('用户 Skill 缺少所属账户或 id');
          const expectedUpdatedAt = body.expectedUpdatedAt !== undefined ? body.expectedUpdatedAt : record.updatedAt;
          const row = await postgresRepository.runtimeAdminWriteUserSkill({
            actorUserId: auth.user.userId,
            ownerEmail: owner,
            skillId,
            skill: record,
            expectedUpdatedAt,
            audit: {
              actorEmail: auth.user.email,
              action: 'data.user-skills.update',
              target: skillId,
              details: { type, id: skillId, owner }
            }
          });
          const parsed = postgresRuntimeSkillFromRow(row, 'user');
          saved = { owner, ...parsed };
      } else if (type === 'global-skills') {
        const expectedRows = await postgresRepository.runtimeListGlobalSkills(auth.user.userId);
        const skills = expectedRows.map(row => postgresRuntimeSkillFromRow(row, global));
        const index = skills.findIndex(skill => skill.id === id);
        if (index < 0) throw requestError(404, '全局 Skill 不存在');
        const updated = makeGlobalSkill(record, skills[index]);
        skills[index] = updated;
        assertPlatformConfigPromotion({ kind: 'global-prompts', proposed: canonicalGlobalPrompts(skills), evidence: body.qualityEvidence });
          await postgresRepository.runtimeReplaceGlobalSkills(auth.user.userId, skills, expectedRows, {
            actorEmail: auth.user.email,
            action: 'data.global-skills.update',
            target: id,
            details: { type, id }
          });
        saved = updated;
      } else if (type === 'open-skills') {
          const expectedUpdatedAt = body.expectedUpdatedAt !== undefined ? body.expectedUpdatedAt : record.updatedAt;
          const row = await postgresRepository.runtimeAdminWriteOpenSkill({
            actorUserId: auth.user.userId,
            skillId: id,
            record,
            expectedUpdatedAt,
            audit: {
              actorEmail: auth.user.email,
              action: 'data.open-skills.update',
              target: id,
              details: { type, id }
            }
          });
          const parsed = postgresRuntimeSkillFromRow(row, 'open');
          saved = { ...parsed, owner: row.owner_email, ownerEmail: row.owner_email };
      } else if (type === 'builtin-skills') {
        throw requestError(409, '内置 Skill 源文件只读，请复制为全局 Skill 后修改');
      } else if (type === 'token-usage') {
          const doc = await postgresRepository.runtimeAdminWriteTokenUsage({
            actorUserId: auth.user.userId,
            requestId: id,
            patch: record,
            audit: {
              actorEmail: auth.user.email,
              action: 'data.token-usage.update',
              target: id,
              details: { type, id }
            }
          });
          saved = adminUsageRecord(doc);
      } else if (type === 'dissections') {
          const selectedModel = record.selectedModel !== undefined ? String(record.selectedModel).trim() : undefined;
          if (selectedModel && !findPlatformModel(selectedModel)) throw new Error('拆书任务模型不存在');
          const sourceText = record.sourceText !== undefined ? String(record.sourceText).replace(/\u0000/g, '') : undefined;
          if (sourceText !== undefined && Buffer.byteLength(sourceText, 'utf8') > 5 * 1024 * 1024) throw requestError(413, '拆书原文不能超过 5 MB');
          const row = await postgresRepository.runtimeAdminWriteDissection({
            actorUserId: auth.user.userId,
            id,
            record,
            expectedRevision: body.expectedRevision !== undefined ? body.expectedRevision : record.revision,
            audit: {
              actorEmail: auth.user.email,
              action: 'data.dissections.update',
              target: id,
              details: { type, id }
            }
          });
          saved = dissectionRecordFromDb({
            ...row,
            result_json: typeof row.result_json === 'string' ? row.result_json : JSON.stringify(row.result_json || {}),
            meta_json: typeof row.meta_json === 'string' ? row.meta_json : JSON.stringify(row.meta_json || {})
          });
      }
      json(res, 200, { ok: true, type, record: saved });
    }).catch(e => respondError(res, e));
  }
  
  function adminDataDelete(req, res) {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    if (!postgresRepository.enabled) return json(res, 503, { error: '云端数据库不可用' });
    return readBody(req).then(async body => {
      const type = adminDataType(body && body.type);
      const id = String(body && body.id || '').trim();
      if (!id) throw new Error('缺少数据 id');
      let changes = 0, detail = { type, id };
      if (type === 'accounts' || type === 'token-usage' || type === 'builtin-skills') {
        throw requestError(409, '该数据类型不允许删除');
      }
      if (type === 'novels') {
          changes = await postgresRepository.runtimeAdminWriteNovel({
            actorUserId: auth.user.userId,
            id,
            delete: true,
            expectedRevision: body && body.expectedRevision,
            audit: {
              actorEmail: auth.user.email,
              action: 'data.novels.delete',
              target: id,
              details: { type, id }
            }
          });
      } else if (type === 'global-skills') {
        const expectedRows = await postgresRepository.runtimeListGlobalSkills(auth.user.userId);
        const skills = expectedRows.map(row => postgresRuntimeSkillFromRow(row, global));
        const next = skills.filter(skill => skill.id !== id);
        changes = skills.length - next.length;
        if (changes) {
          assertPlatformConfigPromotion({ kind: 'global-prompts', proposed: canonicalGlobalPrompts(next), evidence: body.qualityEvidence });
            await postgresRepository.runtimeReplaceGlobalSkills(auth.user.userId, next, expectedRows, {
              actorEmail: auth.user.email,
              action: 'data.global-skills.delete',
              target: id,
              details: { type, id }
            });
        }
      } else if (type === 'open-skills') {
          changes = await postgresRepository.runtimeAdminDeleteOpenSkill({
            actorUserId: auth.user.userId,
            skillId: id,
            audit: {
              actorEmail: auth.user.email,
              action: 'data.open-skills.delete',
              target: id,
              details: { type, id }
            }
          });
      } else if (type === 'user-skills') {
        const owner = String(body.owner || '').trim().toLowerCase();
        const skillId = String(body.skillId || id).trim();
          changes = await postgresRepository.runtimeAdminDeleteUserSkill({
            actorUserId: auth.user.userId,
            ownerEmail: owner,
            skillId,
            audit: {
              actorEmail: auth.user.email,
              action: 'data.user-skills.delete',
              target: skillId,
              details: { type, id: skillId, owner }
            }
          });
      } else if (type === 'dissections') {
          changes = await postgresRepository.runtimeAdminDeleteDissection({
            actorUserId: auth.user.userId,
            id,
            audit: {
              actorEmail: auth.user.email,
              action: 'data.dissections.delete',
              target: id,
              details: { type, id }
            }
          });
      }
      if (!changes) return json(res, 404, { error: '数据记录不存在' });
      json(res, 200, { ok: true, type, id, deleted: changes });
    }).catch(e => respondError(res, e));
  }
  return { handleAdminModels, handleAdminModelsPatch, handleAdminCorrectionLibrary, requireAdmin, adminUserView, handleAdminOverview, handleAdminUserPatch, handleAdminSkills, handleAdminSkillCreate, handleAdminSkillPatch, handleAdminSkillDelete, handleAdminAudit, adminDataType, adminDataJson, adminAccountRecord, adminUsageRecord, adminDataList, adminDataGetRecord, adminDataPatch, adminDataDelete };
}
module.exports = { createAdminService };
