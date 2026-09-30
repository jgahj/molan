'use strict';

function createNativeSkillService({ repository, getAuthUser, readBody, json, respondError, crypto,
  decorateSkillPrompt, normalizeSkillRuntimeFiles, skillFileNames, skillRuntimeFilesComplete,
  makeOpenSkill, makeGlobalSkill, loadBuiltinSkills, uniqueSkillsById, openSkillListView, openSkillDetailView,
  parseOpenSkillListParams, decodePathParam, isAdminUser }) {
  const guarded = action => (req, res, id) => Promise.resolve().then(() => action(req, res, id))
    .catch(error => respondError(res, error));
  function actor(req, res) {
    const auth = getAuthUser(req);
    if (!auth) json(res, 401, { error: '请先登录' });
    return auth;
  }
  const identity = auth => ({ actorUserId: auth.user.userId, ownerEmail: auth.user.email });
  function summary(skill) {
    const { instruction, runtimeFiles, ...publicFields } = skill;
    return publicFields;
  }

  const list = guarded(async (req, res) => {
    const auth = getAuthUser(req);
    const out = loadBuiltinSkills().slice();
    if (auth) {
      const [globals, users] = await Promise.all([repository.listGlobal(), repository.listUser(identity(auth))]);
      out.push(...globals.skills.filter(s => s.enabled !== false).map(s => ({ ...s, source: 'global', global: true, autoApply: true })));
      out.push(...users.skills.map(s => ({ ...decorateSkillPrompt(s), source: 'user', global: false, autoApply: false })));
    }
    json(res, 200, uniqueSkillsById(auth ? out : out.map(summary)));
  });
  const importSkill = guarded(async (req, res) => {
    const auth = actor(req, res); if (!auth) return;
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 120);
    const instruction = String(body.instruction || '').trim().slice(0, 1000000);
    if (!name || !instruction) return json(res, 400, { error: '缺少 name 或 instruction' });
    const slug = String(body.slug || name).replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g, '').slice(0, 60) || 'skill';
    const id = 'user-' + crypto.createHash('sha256').update(auth.user.email.toLowerCase()).digest('hex').slice(0, 12) + '-' + slug;
    const runtimeFiles = normalizeSkillRuntimeFiles(body.runtimeFiles, body.files, { strict: true });
    const files = skillFileNames(runtimeFiles, body.files);
    const fileManifest = Array.isArray(body.fileManifest) ? body.fileManifest : [];
    const record = decorateSkillPrompt({ id, name, instruction, description: String(body.description || '').slice(0, 500),
      runtimeFiles, files, fileManifest, complete: skillRuntimeFilesComplete(files, runtimeFiles, fileManifest),
      size: instruction.length, updatedAt: Date.now() });
    const current = await repository.listUser(identity(auth));
    const skills = current.skills.filter(skill => skill.id !== id).concat(record);
    const saved = await repository.saveUserRecords({ ...identity(auth), skills,
      expectedRevision: body.expectedRevision ?? current.revision });
    json(res, 200, { ok: true, id, skill: record, revision: saved.revision });
  });
  const openList = guarded(async (req, res) => {
    const auth = getAuthUser(req);
    const params = parseOpenSkillListParams(req);
    if (params.scope === 'mine' && !auth) return json(res, 401, { error: '请先登录' });
    let skills = await repository.listOpen({ actorUserId: auth?.user.userId });
    skills = skills.filter(skill => params.scope === 'mine' ? skill.ownerEmail === auth.user.email.toLowerCase() : skill.status === 'published');
    if (params.query) skills = skills.filter(skill => `${skill.name} ${skill.description} ${skill.id}`.toLowerCase().includes(params.query.toLowerCase()));
    skills.sort((a, b) => (params.sort === 'downloads' ? b.downloads - a.downloads : 0) || b.updatedAt - a.updatedAt);
    const total = skills.length;
    const start = (params.page - 1) * params.pageSize;
    json(res, 200, { ok: true, skills: skills.slice(start, start + params.pageSize).map(s => openSkillListView(s, auth)),
      pagination: { page: params.page, pageSize: params.pageSize, total, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) } });
  });
  const openGet = guarded(async (req, res, id) => {
    const auth = getAuthUser(req);
    const skill = await repository.getOpen({ actorUserId: auth?.user.userId, id: decodePathParam(id) });
    if (!skill) return json(res, 404, { error: '开放 Skill 不存在或已撤回' });
    json(res, 200, { ok: true, skill: openSkillDetailView(skill, auth) });
  });
  const openCreate = guarded(async (req, res) => {
    const auth = actor(req, res); if (!auth) return;
    const body = await readBody(req);
    const skill = makeOpenSkill(body, null, auth.user.email);
    const saved = await repository.saveOpen({ actorUserId: auth.user.userId, skill, expectedRevision: 0 });
    json(res, 200, { ok: true, skill: { ...openSkillDetailView(saved, auth), revision: saved.revision } });
  });
  const openPatch = guarded(async (req, res, id) => {
    const auth = actor(req, res); if (!auth) return;
    const existing = await repository.getOpen({ actorUserId: auth.user.userId, id: decodePathParam(id) });
    if (!existing) return json(res, 404, { error: '开放 Skill 不存在' });
    const body = await readBody(req);
    const saved = await repository.saveOpen({ actorUserId: auth.user.userId,
      skill: makeOpenSkill(body, existing, existing.ownerEmail), expectedRevision: body.expectedRevision ?? existing.revision });
    json(res, 200, { ok: true, skill: { ...openSkillDetailView(saved, auth), revision: saved.revision } });
  });
  const openDelete = guarded(async (req, res, id) => {
    const auth = actor(req, res); if (!auth) return;
    const skillId = decodePathParam(id);
    const existing = await repository.getOpen({ actorUserId: auth.user.userId, id: skillId });
    if (!existing) return json(res, 404, { error: '开放 Skill 不存在' });
    const body = await readBody(req);
    await repository.deleteOpen({ actorUserId: auth.user.userId, id: skillId, expectedRevision: body.expectedRevision ?? existing.revision });
    json(res, 200, { ok: true, id: skillId });
  });
  const openDownload = guarded(async (req, res, id) => {
    const auth = actor(req, res); if (!auth) return;
    const body = await readBody(req);
    const requestId = body.requestId || req.headers['idempotency-key'];
    if (!requestId) return json(res, 400, { error: '下载需要幂等键', code: 'IDEMPOTENCY_KEY_REQUIRED' });
    const skill = await repository.downloadOpen({ actorUserId: auth.user.userId,
      id: decodePathParam(id), requestId });
    json(res, 200, { ok: true, skill: decorateSkillPrompt(skill) });
  });
  const adminGuard = action => guarded(async (req, res, id) => {
    const auth = getAuthUser(req, 'admin');
    if (!auth) return json(res, 401, { error: '请先登录管理后台' });
    if (!isAdminUser(auth.user)) return json(res, 403, { error: '需要管理员权限' });
    return action(req, res, id, auth);
  });
  const adminSkills = adminGuard(async (req, res) => {
    const global = await repository.listGlobal();
    json(res, 200, { ok: true, skills: global.skills, targets: ['all', 'generate', 'continue', 'rewrite', 'polish', 'chat', 'extract'], revision: global.revision });
  });
  const adminSkillCreate = adminGuard(async (req, res, id, auth) => {
    const body = await readBody(req); const current = await repository.listGlobal();
    if (!body.id) return json(res, 400, { error: '平台 Skill 晋级需要固定 id' });
    const skill = makeGlobalSkill(body || {}); const saved = await repository.saveGlobal({ actorUserId: auth.user.userId, skills: [skill, ...current.skills], expectedRevision: body.expectedRevision ?? current.revision, qualityEvidence: body.qualityEvidence });
    json(res, 200, { ok: true, skill, revision: saved.revision });
  });
  const adminSkillPatch = adminGuard(async (req, res, id, auth) => {
    const body = await readBody(req); const current = await repository.listGlobal();
    const skillId = decodePathParam(id); const existing = current.skills.find(s => s.id === skillId);
    if (!existing) return json(res, 404, { error: '全局 Skill 不存在' });
    const skill = makeGlobalSkill(body, existing);
    const saved = await repository.saveGlobal({ actorUserId: auth.user.userId,
      skills: current.skills.map(s => s.id === skillId ? skill : s), expectedRevision: body.expectedRevision ?? current.revision, qualityEvidence: body.qualityEvidence });
    json(res, 200, { ok: true, skill, revision: saved.revision });
  });
  const adminSkillDelete = adminGuard(async (req, res, id, auth) => {
    const body = await readBody(req); const current = await repository.listGlobal(); const skillId = decodePathParam(id);
    if (!current.skills.some(s => s.id === skillId)) return json(res, 404, { error: '全局 Skill 不存在' });
    const saved = await repository.saveGlobal({ actorUserId: auth.user.userId,
      skills: current.skills.filter(s => s.id !== skillId), expectedRevision: body.expectedRevision ?? current.revision, qualityEvidence: body.qualityEvidence });
    json(res, 200, { ok: true, id: skillId, revision: saved.revision });
  });
  return { list, import: importSkill, openList, openGet, openCreate, openPatch, openDelete, openDownload,
    adminSkills, adminSkillCreate, adminSkillPatch, adminSkillDelete };
}

module.exports = { createNativeSkillService };
