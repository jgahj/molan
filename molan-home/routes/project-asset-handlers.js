'use strict';

/**
 * 项目资产、工程整包与提示词编译业务处理函数工厂
 * @param {object} deps - 显式依赖注入表
 * @returns {object} 包含工程资产与整包恢复核心处理函数的工厂实例
 */
function createProjectAssetHandlers(deps) {
  const {
    json,
    readBody,
    respondError,
    respondPostgresError,
    getAuthUser,
    postgresActor,
    postgresRepository,
    projectScope,
    projectPackage,
    parseNovelExportRange,
    sendNovelExport,
    sanitizeNovelStateForStorage,
    MAX_NOVEL_STATE_BYTES = 16 * 1024 * 1024
  } = deps;

  /** PG 模式下按导出 capability 读取项目状态和已提交正文。 */
  async function handlePostgresNovelExport(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const userId = typeof postgresActor === 'function' ? postgresActor(auth) : (auth.user && auth.user.userId);
    const profile = await postgresRepository.getProfile(userId, id);
    if (!profile || !projectScope.canAccess(profile.access, projectScope.PROJECT_ROLES, 'export')) {
      return json(res, 404, { error: '小说不存在或无权导出' });
    }
    const parsedRange = parseNovelExportRange(req);
    if (!parsedRange.ok) return json(res, 400, { error: '章节范围必须是有效的正整数区间', code: 'export_range_invalid' });
    let committedChapters;
    try {
      committedChapters = await postgresRepository.listExportableChapters(userId, id, profile.access.workspace_id);
    } catch (error) {
      if (error && error.code === 'export_forbidden') return json(res, 404, { error: '小说不存在或无权导出' });
      return json(res, 409, { error: '无法读取已提交章节正文，已阻止导出', code: 'export_content_blocked', blocked: true });
    }
    const state = sanitizeNovelStateForStorage(profile.state || {});
    const format = new URL(req.url, 'http://localhost').searchParams.get('format');
    return sendNovelExport(res, id, { ...state, title: profile.title || state.title }, committedChapters, format, parsedRange.range);
  }

  /** PG 模式下导出项目 state、结构化资料和历史，所有内容先按当前权限读取。 */
  async function handlePostgresPackageExport(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const userId = typeof postgresActor === 'function' ? postgresActor(auth) : (auth.user && auth.user.userId);
    const profile = await postgresRepository.getProfile(userId, id);
    if (!profile || !projectScope.canAccess(profile.access, new Set(['owner', 'admin', 'editor']), 'export')) {
      return json(res, 404, { error: '小说不存在或无权导出' });
    }
    const resources = await postgresRepository.listAllResources(userId, id, profile.access.workspace_id, true);
    const creation = await postgresRepository.getCreationPackageData(userId, id, profile.access.workspace_id);
    const state = sanitizeNovelStateForStorage(profile.state || {});
    const packageValue = projectPackage.exportProjectPackage({
      projectId: id,
      workspaceId: profile.access.workspace_id,
      ownerUserId: profile.access.owner_user_id,
      state,
      assets: { creationAssets: state.creationAssets || {}, projectResources: resources || [], creationData: creation || {} },
      versions: Array.isArray(state.history) ? state.history : []
    });
    return json(res, 200, { ok: true, package: packageValue });
  }

  /** PG 模式下只做资料包预检，不在预检阶段覆盖已有项目。 */
  async function handlePostgresPackageImport(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const userId = typeof postgresActor === 'function' ? postgresActor(auth) : (auth.user && auth.user.userId);
    const profile = await postgresRepository.getProfile(userId, id);
    if (!profile || !projectScope.canAccess(profile.access, projectScope.WRITE_ROLES)) {
      return json(res, 404, { error: '小说不存在或无权导入' });
    }
    const body = await readBody(req).catch(() => ({}));
    const packageInput = body && body.package ? body.package : body;
    const result = projectPackage.importProjectPackage(packageInput, {
      mode: 'preflight',
      targetProjectId: id,
      targetWorkspaceId: profile.access.workspace_id,
      existingIds: { projectIds: [id] }
    });
    return json(res, result.ok ? 200 : 409, { ok: result.ok, preflight: result });
  }

  /** PG 模式下以一个数据库事务恢复作品 state 和结构化资料，避免半恢复。 */
  async function handlePostgresPackageRestore(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '未登录' });
    const userId = typeof postgresActor === 'function' ? postgresActor(auth) : (auth.user && auth.user.userId);
    const profile = await postgresRepository.getProfile(userId, id);
    if (!profile || !projectScope.canAccess(profile.access, new Set(['owner', 'admin']))) {
      return json(res, 403, { error: '只有项目管理员可以恢复整包资料' });
    }
    const body = await readBody(req).catch(() => ({}));
    const expectedRevision = Number(body && body.revision);
    const packageInput = body && body.package ? body.package : body;
    const imported = projectPackage.importProjectPackage(packageInput, {
      mode: 'apply',
      targetProjectId: id,
      targetWorkspaceId: profile.access.workspace_id,
      existingIds: { projectIds: [] }
    });
    if (!imported.ok || !imported.state || typeof imported.state !== 'object' || !Array.isArray(imported.state.volumes)) {
      return json(res, 422, { error: '资料包预检未通过，未修改当前作品', code: 'package_restore_preflight_failed', details: imported.errors || imported.conflicts || [] });
    }
    const state = sanitizeNovelStateForStorage(imported.state);
    const stateJson = JSON.stringify(state);
    if (Buffer.byteLength(stateJson, 'utf8') > MAX_NOVEL_STATE_BYTES) return json(res, 413, { error: '恢复后的作品数据过大' });
    const resources = imported.assets && typeof imported.assets === 'object' && Array.isArray(imported.assets.projectResources)
      ? imported.assets.projectResources
      : [];
    const creation = imported.assets && typeof imported.assets === 'object' && imported.assets.creationData &&
      typeof imported.assets.creationData === 'object' && !Array.isArray(imported.assets.creationData)
      ? imported.assets.creationData
      : null;
    const restored = await postgresRepository.restorePackage({
      userId,
      workspaceId: profile.access.workspace_id,
      projectId: id,
      expectedRevision,
      title: String(state.title || state.outline && state.outline.book && state.outline.book.title || '未命名小说'),
      state,
      resources,
      creation
    });
    return json(res, 200, restored);
  }

  async function handleNovelPromptCompilation(req, res) {
    try {
      const { compileFullWritingSpecification, getAtomicPromptBlocks } = require('../lib/generation/corpus-archetypes');
      if (req.method === 'GET') {
        return json(res, 200, { ok: true, blocks: getAtomicPromptBlocks() });
      }
      const body = await readBody(req);
      const input = body && typeof body === 'object' ? body : {};
      const compiled = compileFullWritingSpecification({
        genre: input.genre || input.novelGenre,
        writingStyle: input.writingStyle || input.styleArchetype,
        chapterFunction: input.chapterFunction,
        chapterFocus: input.chapterFocus,
        endingHook: input.endingHook,
        characters: input.characters,
        userPrompt: input.userPrompt || input.prompt || '',
        wordBudget: input.wordBudget
      });
      return json(res, 200, {
        ok: true,
        success: true,
        finalPrompt: compiled.directive,
        wordBudget: compiled.wordBudget
      });
    } catch (err) {
      return json(res, 500, { error: err.message || '编译提示词异常' });
    }
  }

  return {
    // 动作短名别名 (供 routes/projects.js 使用)
    postgresNovelExport: handlePostgresNovelExport,
    postgresPackageExport: handlePostgresPackageExport,
    postgresPackageImport: handlePostgresPackageImport,
    postgresPackageRestore: handlePostgresPackageRestore,
    novelPromptCompilation: handleNovelPromptCompilation,

    // 具名全称
    handlePostgresNovelExport,
    handlePostgresPackageExport,
    handlePostgresPackageImport,
    handlePostgresPackageRestore,
    handleNovelPromptCompilation
  };
}

module.exports = {
  createProjectAssetHandlers
};
