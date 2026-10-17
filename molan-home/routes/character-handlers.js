'use strict';

/**
 * 角色库与角色导入业务处理函数工厂
 * @param {object} deps - 显式依赖注入表
 * @returns {object} 包含角色领域核心处理函数的工厂实例
 */
function createCharacterHandlers(deps) {
  const {
    json,
    readBody,
    respondError,
    requestError,
    getAuthUser,
    requireSqliteForPublic,
    dbReady,
    postgresRepository,
    projectScope,
    sanitizeNovelStateForStorage,
    responseCors,
    crypto
  } = deps;

  const getDb = () => (typeof deps.getDatabase === 'function' ? deps.getDatabase() : deps.db);

  function postgresCharacterView(row) {
    const document = typeof row.document === 'string' ? JSON.parse(row.document) : row.document;
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw (requestError ? requestError(500, '人物库文档损坏') : new Error('人物库文档损坏'));
    }
    return {
      id: document.id || row.row_key,
      name: document.name,
      function: document.function,
      goal: document.goal,
      conflict: document.conflict,
      arc: document.arc,
      firstAppearance: document.first_appearance ?? document.firstAppearance,
      notes: document.notes || '',
      dissectionId: document.dissection_id || row.dissection_id,
      createdAt: Number(document.created_at ?? document.createdAt) || 0
    };
  }

  async function handleCharactersList(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const rows = await postgresRepository.runtimeListCharacterLibrary(auth.user.userId);
    return json(res, 200, { ok: true, characters: rows.map(postgresCharacterView) });
  }

  async function handleCharactersPatch(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const body = await readBody(req);
    const row = await postgresRepository.runtimePatchCharacter(auth.user.userId, id, body);
    return json(res, 200, { ok: true, character: postgresCharacterView(row) });
  }

  async function handleCharactersMerge(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const body = await readBody(req);
    const merged = await postgresRepository.runtimeMergeCharacters(auth.user.userId, body.fromNames, body.intoName);
    return json(res, 200, { ok: true, merged });
  }

  async function handleCharactersExport(req, res) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    const format = new URL(req.url, 'http://localhost').searchParams.get('format') || 'json';
    const rows = await postgresRepository.runtimeListCharacterLibrary(auth.user.userId);
    const chars = rows.map(row => {
    const character = postgresCharacterView(row);
      return {
        name: character.name, function: character.function, goal: character.goal, conflict: character.conflict,
        arc: character.arc, firstAppearance: character.firstAppearance ?? character.first_appearance, notes: character.notes || ''
      };
    });
    if (format === 'csv') {
      const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const head = ['name', 'function', 'goal', 'conflict', 'arc', 'firstAppearance', 'notes'];
      const body = [head.join(',')].concat(chars.map(c => head.map(k => esc(c[k])).join(','))).join('\n');
      const corsHeaders = typeof responseCors === 'function' ? responseCors(res) : {};
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="character-library.csv"',
        'Content-Length': Buffer.byteLength('\uFEFF' + body),
        ...corsHeaders
      });
      return res.end('\uFEFF' + body);
    }
    const body = JSON.stringify(chars, null, 2);
    const corsHeaders = typeof responseCors === 'function' ? responseCors(res) : {};
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="character-library.json"',
      'Content-Length': Buffer.byteLength(body),
      ...corsHeaders
    });
    return res.end(body);
  }

  function handleNovelImportCharacters(req, res, id) {
    const auth = getAuthUser(req);
    if (!auth) return json(res, 401, { error: '请先登录' });
    if (typeof requireSqliteForPublic === 'function' && !requireSqliteForPublic(req, res)) return;
    if (typeof dbReady === 'function' && !dbReady()) return json(res, 503, { error: '云端存储不可用' });
    if (!id || !/^n_[A-Za-z0-9]{1,30}$/.test(id)) return json(res, 400, { error: '小说 id 非法' });
    const db = getDb();
    return readBody(req).then(p => {
      const chars = Array.isArray(p.characters) ? p.characters : [];
      if (!chars.length) return json(res, 400, { error: '请提供角色' });
      const row = db.prepare('SELECT id,user_email,owner_user_id,workspace_id,project_id,state_json,revision FROM novels WHERE id = ?').get(id);
      if (!row) return json(res, 404, { error: '小说不存在' });
      const access = projectScope ? projectScope.getNovelAccess(db, id, auth.user.userId) : null;
      if (projectScope && !projectScope.canAccess(access, projectScope.WRITE_ROLES)) return json(res, 404, { error: '小说不存在或无权访问' });
      let state;
      try {
        state = typeof sanitizeNovelStateForStorage === 'function'
          ? sanitizeNovelStateForStorage(JSON.parse(row.state_json))
          : JSON.parse(row.state_json);
      } catch (_) {
        return json(res, 500, { error: 'state 解析失败' });
      }
      if (!state.knowledge || typeof state.knowledge !== 'object') state.knowledge = {};
      let entities = state.knowledge.entities;
      if (!entities || Array.isArray(entities)) entities = {};
      let added = 0;
      const c = crypto || require('node:crypto');
      chars.forEach(ch => {
        const name = String((ch && ch.name) || '').trim();
        if (!name) return;
        const eid = 'ent_' + c.createHash('sha1').update(id + '|' + name).digest('hex').slice(0, 14);
        if (entities[eid]) return;
        entities[eid] = {
          id: eid, name, type: 'character',
          description: [String(ch.function || ''), String(ch.goal || ''), String(ch.conflict || ''), String(ch.arc || '')].filter(Boolean).join('；'),
          source: 'dissection', createdAt: Date.now()
        };
        added += 1;
      });
      state.knowledge.entities = entities;
      const stateJson = JSON.stringify(state);
      const expectedRevision = p.revision == null ? Number(row.revision || 0) : Number(p.revision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return json(res, 400, { error: 'revision 非法' });
      const nextRevision = expectedRevision + 1;
      const result = db.prepare(`UPDATE novels
        SET state_json = ?, updated_at = ?, revision = ?, owner_user_id = ?
        WHERE id = ? AND workspace_id = ? AND project_id = ? AND revision = ?`)
        .run(stateJson, Date.now(), nextRevision, auth.user.userId, id, access ? access.workspace_id : '', access ? access.project_id : '', expectedRevision);
      if (Number(result.changes || 0) !== 1) return json(res, 409, { error: '小说已在其他设备更新，请重新读取后导入', code: 'revision_conflict' });
      return json(res, 200, { ok: true, added, total: Object.keys(entities).length, revision: nextRevision });
    }).catch(e => respondError(res, e));
  }

  return {
    // 动作短名别名 (供 routes/projects.js 使用)
    charactersList: handleCharactersList,
    charactersPatch: handleCharactersPatch,
    charactersMerge: handleCharactersMerge,
    charactersExport: handleCharactersExport,
    novelImportCharacters: handleNovelImportCharacters,

    // 具名全称
    handleCharactersList,
    handleCharactersPatch,
    handleCharactersMerge,
    handleCharactersExport,
    handleNovelImportCharacters,
    postgresCharacterView
  };
}

module.exports = {
  createCharacterHandlers
};
