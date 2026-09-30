(function () {
  'use strict';

  var API_BASE = location.protocol === 'file:' || location.protocol === 'about:' ? 'http://localhost:3000' : '';
  var state = {
    token: '', user: null, scope: 'public', query: '', sort: 'updated', page: 1, totalPages: 1,
    openSkills: [], privateSkills: [], editorMode: 'create', editorSourcePrivate: false, editingId: '', detailSkill: null, busy: false, fileBusy: false, importedFiles: [], importFilesTouched: false,
    requestSeq: { open: 0, private: 0, auth: 0, detail: 0, editor: 0, action: 0 }
  };
  var searchTimer = null;
  var toastTimer = null;
  var pendingDownloads = new Map();
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };

  function getToken() {
    try { return localStorage.getItem('ml_token') || ''; } catch (_) { return ''; }
  }

  function readLocalUser() {
    try {
      var raw = JSON.parse(localStorage.getItem('ml_user') || 'null');
      state.user = raw && raw.email ? raw : null;
    } catch (_) { state.user = null; }
    state.token = getToken();
  }

  function sessionKey() { return String(state.token || '') + '|' + (state.user && state.user.email ? String(state.user.email).trim().toLowerCase() : ''); }
  function sessionChangedError() { var error = new Error('登录账户已切换'); error.code = 'SESSION_CHANGED'; return error; }
  function isCurrentSession(key) { readLocalUser(); return sessionKey() === key; }

  function saveLocalUser(user) {
    try {
      if (user) localStorage.setItem('ml_user', JSON.stringify(user));
      else localStorage.removeItem('ml_user');
    } catch (_) {}
  }

  function parseResponse(response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (!response.ok) {
        var error = new Error(data.error || ('请求失败（' + response.status + '）'));
        error.status = response.status;
        throw error;
      }
      return data;
    });
  }

  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, state.token ? { Authorization: 'Bearer ' + state.token } : {}, options.headers || {});
    return fetch(API_BASE + path, Object.assign({}, options, { headers: headers, cache: 'no-store' })).then(parseResponse);
  }

  function formatDate(value) {
    if (!value) return '暂无时间';
    var date = new Date(Number(value));
    return isNaN(date.getTime()) ? '暂无时间' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function formatNumber(value) { return Number(value || 0).toLocaleString('zh-CN'); }

  function renderIcons() {
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }

  function showToast(message) {
    var el = $('skillsToast');
    if (!el) return;
    el.textContent = message || '';
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 2600);
  }

  function setAuthHint() {
    var hint = $('skillsAuthHint');
    var guest = $('privateSkillsGuest');
    if (state.user) {
      if (hint) hint.textContent = '已登录：可下载和发布';
      if (guest) guest.hidden = true;
    } else {
      if (hint) hint.textContent = '登录后可下载到我的 Skill';
      if (guest) guest.hidden = false;
    }
  }

  function setLoading(loading) {
    $('skillsLoading').hidden = !loading;
    if (loading) {
      $('skillsGrid').innerHTML = '';
      $('skillsEmpty').hidden = true;
    }
  }

  function cardMarkup(skill, scope) {
    var withdrawn = skill.status === 'withdrawn';
    var actions = '<button type="button" data-action="detail" data-id="' + esc(skill.id) + '">查看详情</button>';
    if (scope === 'public') {
      actions += '<button type="button" data-action="download" data-id="' + esc(skill.id) + '">下载</button>';
    } else {
      actions += '<button type="button" data-action="edit" data-id="' + esc(skill.id) + '">编辑</button>';
      actions += '<button type="button" data-action="' + (withdrawn ? 'republish' : 'withdraw') + '" data-id="' + esc(skill.id) + '">' + (withdrawn ? '重新发布' : '撤回') + '</button>';
    }
    var status = withdrawn ? '<span class="skill-status skill-status--withdrawn">已撤回</span>' : '<span class="skill-status">已发布</span>';
    return '<article class="skill-card" data-open-id="' + esc(skill.id) + '"><div class="skill-card__body"><div class="skill-card__top"><h3 title="' + esc(skill.name) + '">' + esc(skill.name) + '</h3>' + status + '</div><p class="skill-card__description">' + esc(skill.description || '暂无描述') + '</p><div class="skill-card__meta"><span><i data-lucide="user-round"></i>' + esc(skill.author || '墨阑作者') + '</span><span><i data-lucide="download"></i>' + formatNumber(skill.downloads) + ' 次下载</span><span><i data-lucide="clock-3"></i>' + esc(formatDate(skill.updatedAt)) + '</span></div></div><footer class="skill-card__footer"><small>' + (scope === 'mine' ? '我的公开资源' : '社区共享资源') + '</small><div class="skill-card__actions">' + actions + '</div></footer></article>';
  }

  function renderOpenSkills() {
    var grid = $('skillsGrid');
    var list = Array.isArray(state.openSkills) ? state.openSkills : [];
    $('skillsResultMeta').textContent = '显示 ' + list.length + ' / ' + (state.total || 0) + ' 个 Skill';
    $('skillsEmptyTitle').textContent = state.scope === 'mine' ? '你还没有发布 Skill' : '还没有开放 Skill';
    $('skillsEmptyText').textContent = state.scope === 'mine' ? '创建一个 Skill 并发布，它会出现在这里。' : '创建一个 Skill，和其他作者分享你的写作方法。';
    $('emptyCreateSkillBtn').hidden = state.scope !== 'mine';
    $('skillsEmpty').hidden = list.length > 0;
    grid.innerHTML = list.map(function (skill) { return cardMarkup(skill, state.scope); }).join('');
    var pagination = $('skillsPagination');
    pagination.hidden = state.totalPages <= 1;
    $('skillPageLabel').textContent = state.page + ' / ' + state.totalPages;
    $('prevSkillPage').disabled = state.page <= 1;
    $('nextSkillPage').disabled = state.page >= state.totalPages;
    renderIcons();
  }

  function loadOpenSkills() {
    var requestId = ++state.requestSeq.open;
    readLocalUser();
    var requestSession = sessionKey();
    var isCurrent = function () { return requestId === state.requestSeq.open && isCurrentSession(requestSession); };
    if (state.scope === 'mine' && !state.token) {
      if (!isCurrent()) return Promise.resolve();
      state.openSkills = []; state.total = 0; state.page = 1; state.totalPages = 1;
      setLoading(false); renderOpenSkills(); return Promise.resolve();
    }
    setLoading(true);
    var params = new URLSearchParams({ page: String(state.page), pageSize: '12', q: state.query, sort: state.sort, scope: state.scope });
    return api('/api/open-skills?' + params.toString()).then(function (data) {
      if (!isCurrent()) return;
      var pagination = data.pagination || {};
      state.openSkills = Array.isArray(data.skills) ? data.skills : [];
      state.total = Number(pagination.total) || 0;
      state.page = Number(pagination.page) || 1;
      state.totalPages = Math.max(1, Number(pagination.totalPages) || 1);
      setLoading(false); renderOpenSkills();
    }).catch(function (error) {
      if (!isCurrent()) return;
      setLoading(false);
      state.openSkills = []; state.total = 0; state.totalPages = 1;
      renderOpenSkills();
      if (error.status === 401) showToast('请先登录后查看自己的开放 Skill');
      else showToast(error.message || '开放 Skill 加载失败');
    });
  }

  function renderPrivateSkills() {
    var list = $('privateSkillsList');
    if (!state.user) { list.innerHTML = ''; return; }
    if (!state.privateSkills.length) {
      list.innerHTML = '<div class="skills-aside__guest"><p>还没有私有 Skill。</p><a href="#" data-private-create>创建一个</a></div>';
      return;
    }
    list.innerHTML = state.privateSkills.map(function (skill) {
      return '<div class="private-skill"><div><div class="private-skill__name" title="' + esc(skill.name || skill.id) + '">' + esc(skill.name || skill.id) + '</div><div class="private-skill__description">' + esc(skill.description || '暂无描述') + '</div></div><button type="button" data-private-publish="' + esc(skill.id) + '">发布</button></div>';
    }).join('');
  }

  function loadPrivateSkills() {
    var requestId = ++state.requestSeq.private;
    readLocalUser();
    var requestSession = sessionKey();
    var isCurrent = function () { return requestId === state.requestSeq.private && isCurrentSession(requestSession); };
    if (!state.token) { if (isCurrent()) { state.privateSkills = []; renderPrivateSkills(); } return Promise.resolve(); }
    return api('/api/skills').then(function (list) {
      if (!isCurrent()) return;
      state.privateSkills = (Array.isArray(list) ? list : []).filter(function (skill) { return skill && skill.source === 'user'; });
      renderPrivateSkills();
    }).catch(function () { if (isCurrent()) { state.privateSkills = []; renderPrivateSkills(); } });
  }

  function refreshAuth() {
    var requestId = ++state.requestSeq.auth;
    readLocalUser(); setAuthHint();
    var requestSession = sessionKey();
    var isCurrent = function () { return requestId === state.requestSeq.auth && isCurrentSession(requestSession); };
    if (!state.token) return Promise.all([loadOpenSkills(), loadPrivateSkills()]);
    return api('/api/auth/me').then(function (data) {
      if (!isCurrent()) return;
      state.user = data.user || null; saveLocalUser(state.user); setAuthHint();
    }).catch(function (error) {
      if (!isCurrent()) return;
      if (error.status === 401) { state.token = ''; state.user = null; try { localStorage.removeItem('ml_token'); } catch (_) {} saveLocalUser(null); setAuthHint(); }
    }).then(function () { if (!isCurrent()) return; return Promise.all([loadOpenSkills(), loadPrivateSkills()]); });
  }

  function setModal(modal, open) {
    modal.hidden = !open;
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function resetEditor() {
    state.editorMode = 'create'; state.editorSourcePrivate = false; state.editingId = ''; state.fileBusy = false; state.importedFiles = []; state.importFilesTouched = false;
    $('skillEditorTitle').textContent = '创建 Skill';
    $('skillNameInput').value = '';
    $('skillDescriptionInput').value = '';
    $('skillInstructionInput').value = '';
    $('skillFileInput').value = '';
    $('skillFolderInput').value = '';
    $('skillImportStatus').textContent = '可选择单个 SKILL.md、多选文件或包含 SKILL.md 的整个文件夹；重复选择会追加，附属文件按相对路径保存。';
    $('skillImportList').textContent = '';
    $('savePrivateSkillBtn').hidden = false;
    $('savePrivateSkillBtn').disabled = false;
    $('publishSkillBtn').disabled = false;
    $('publishSkillBtn').innerHTML = '<i data-lucide="upload"></i><span>保存并发布</span>';
    $('skillEditorHint').textContent = '保存到我的 Skill 后，可在编辑器中选择使用；发布后所有人都能查看并下载。';
    renderIcons();
  }

  function openEditor(mode, source) {
    if (!state.token) { showToast('请先登录后创建或发布 Skill'); return; }
    source = source || {};
    state.editorMode = mode || 'create';
    state.editorSourcePrivate = !!(mode === 'publish-private');
    state.editingId = mode === 'edit' ? String(source.id || '') : '';
    $('skillEditorTitle').textContent = mode === 'edit' ? '编辑开放 Skill' : (state.editorSourcePrivate ? '发布我的 Skill' : '创建 Skill');
    $('skillNameInput').value = source.name || '';
    $('skillDescriptionInput').value = source.description || '';
    $('skillInstructionInput').value = source.instruction || '';
    $('skillFileInput').value = '';
    $('skillFolderInput').value = '';
    state.fileBusy = false; state.importedFiles = existingSkillFiles(source); state.importFilesTouched = false;
    $('skillImportStatus').textContent = state.importedFiles.length ? '已保留现有 ' + state.importedFiles.length + ' 个文件；可以继续追加，或先清空清单。' : '可选择单个 SKILL.md、多选文件或包含 SKILL.md 的整个文件夹；重复选择会追加。';
    $('skillImportList').textContent = state.importedFiles.map(function (item) { return item.path + (item.type === 'binary' ? '（资源清单）' : ''); }).join(' · ');
    $('savePrivateSkillBtn').hidden = mode === 'edit';
    $('publishSkillBtn').innerHTML = mode === 'edit' ? '<i data-lucide="check"></i><span>保存修改</span>' : '<i data-lucide="upload"></i><span>保存并发布</span>';
    $('skillEditorHint').textContent = mode === 'edit' ? '保存后会立即同步到开放区；撤回后其他人将无法查看或下载。' : '发布后所有人都能查看和下载，下载内容会复制到对方的私有 Skill。';
    setModal($('skillEditorModal'), true); renderIcons(); $('skillNameInput').focus();
  }

  function closeEditor() { setModal($('skillEditorModal'), false); }

  function parseSkillMarkdown(raw) {
    var text = String(raw || '').replace(/^\uFEFF/, '');
    var name = '', description = '', body = text;
    var match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (match) {
      match[1].split(/\r?\n/).forEach(function (line) {
        var pair = line.match(/^name:\s*(.+)$/i); if (pair) name = pair[1].trim();
        var desc = line.match(/^description:\s*(.+)$/i); if (desc) description = desc[1].trim();
      });
      body = text.slice(match[0].length).trim();
    }
    return { name: name, description: description, instruction: body };
  }

  function existingSkillFiles(source) {
    source = source || {};
    var runtime = source.runtimeFiles && typeof source.runtimeFiles === 'object' ? source.runtimeFiles : {};
    var names = Array.isArray(source.files) && source.files.length ? source.files : Object.keys(runtime);
    var manifest = Array.isArray(source.fileManifest) ? source.fileManifest : [];
    return names.map(function (path) {
      var meta = manifest.find(function (item) { return item && item.path === path; });
      var value = runtime[path];
      var binary = meta && meta.type === 'binary' || value === null || value === undefined;
      return { path: path, type: binary ? 'binary' : 'text', size: Number(meta && meta.size) || (binary ? 0 : new Blob([String(value)]).size), content: binary ? null : String(value) };
    }).filter(function (item) { return item.path; });
  }

  function skillPath(file) { return String(file && (file.webkitRelativePath || file.name) || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, ''); }

  function skillTextFile(path, file) {
    var binary = /\.(?:png|jpe?g|gif|bmp|webp|ico|pdf|zip|rar|7z|exe|dll|docx?|xlsx?|pptx?|mp3|mp4|wav|avi|mov|mkv|bin|dat|woff2?|ttf|eot|skp|psd)$/i.test(path);
    return !binary && (!file || !file.type || /^text\//i.test(file.type) || /\.(?:md|markdown|txt|json|ya?ml|xml|csv|toml|ini|cfg|html?|css|js|ts|py|sh|sql|prompt|template)$/i.test(path));
  }

  async function readText(file) {
    if (file && typeof file.arrayBuffer === 'function' && typeof TextDecoder !== 'undefined') {
      var bytes = new Uint8Array(await file.arrayBuffer()), offset = 0, encoding = 'utf-8';
      if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) offset = 3;
      else if (bytes[0] === 0xFF && bytes[1] === 0xFE) { offset = 2; encoding = 'utf-16le'; }
      else if (bytes[0] === 0xFE && bytes[1] === 0xFF) { offset = 2; encoding = 'utf-16be'; }
      var decode = function (label) { try { return new TextDecoder(label, { fatal: label === 'utf-8' }).decode(bytes.subarray(offset)); } catch (_) { return ''; } };
      var decoded = decode(encoding);
      if (!decoded && encoding === 'utf-8' && bytes.length > offset) decoded = decode('gb18030') || decode('gbk');
      if (!decoded && bytes.length > offset) throw new Error('文本编码无法识别');
      return String(decoded || '').replace(/\uFEFF/g, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
    }
    if (file && typeof file.text === 'function') return String(await file.text()).replace(/\uFEFF/g, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
    return new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { resolve(String(reader.result || '').replace(/\uFEFF/g, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim()); }; reader.onerror = function () { reject(new Error('文件读取失败')); }; reader.readAsText(file); });
  }

  function stripCommonRoot(records) {
    var paths = records.map(function (item) { return item.path.split('/'); });
    if (!paths.length || paths.some(function (parts) { return parts.length < 2; })) return records;
    var root = paths[0][0];
    if (!root || paths.some(function (parts) { return parts[0] !== root; })) return records;
    return records.map(function (item) { return Object.assign({}, item, { path: item.path.slice(root.length + 1) }); });
  }

  function dedupeSkillRecords(records) {
    var seen = Object.create(null);
    return records.filter(function (item) {
      var key = item.path + ':' + item.size + ':' + item.modified;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function mergeSkillFiles(existing, incoming) {
    var byPath = Object.create(null);
    (existing || []).forEach(function (item) { if (item && item.path) byPath[item.path] = item; });
    (incoming || []).forEach(function (item) { if (item && item.path) byPath[item.path] = item; });
    return Object.keys(byPath).map(function (path) { return byPath[path]; });
  }

  async function readSkillFiles(fileList) {
    var files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length + state.importedFiles.length > 500) { showToast('Skill 文件数量不能超过 500 个'); return; }
    var records = dedupeSkillRecords(stripCommonRoot(files.map(function (file) { return { file: file, path: skillPath(file), size: Number(file.size) || 0, modified: Number(file.lastModified) || 0 }; }).filter(function (item) { return item.path; })));
    var entryFiles = records.filter(function (item) { return /(^|\/)SKILL\.md$/i.test(item.path); });
    if (!entryFiles.length && !state.importedFiles.some(function (item) { return /(^|\/)SKILL\.md$/i.test(item.path); })) { showToast('所选内容中未找到 SKILL.md'); return; }
    if (entryFiles.length > 1) { showToast('所选内容中存在多个 SKILL.md，请一次选择一个 Skill 文件夹'); return; }
    var previousFiles = state.importedFiles.slice();
    var totalTextBytes = 0;
    var loaded = [];
    state.fileBusy = true;
    $('skillImportStatus').textContent = '正在读取 Skill 文件…';
    try {
      for (var i = 0; i < records.length; i++) {
        var item = records[i];
        if (item.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB：' + item.path);
        if (!skillTextFile(item.path, item.file)) { loaded.push({ path: item.path, type: 'binary', size: item.size, content: null }); continue; }
        var content = await readText(item.file);
        var bytes = new Blob([content]).size;
        totalTextBytes += bytes;
        if (totalTextBytes > 12 * 1024 * 1024) throw new Error('文本文件总大小超过 12 MB');
        loaded.push({ path: item.path, type: 'text', size: bytes, content: String(content || '') });
      }
      var entry = loaded.find(function (item) { return /(^|\/)SKILL\.md$/i.test(item.path); });
      if (entry) {
        var parsed = parseSkillMarkdown(entry.content || '');
        if (!$('skillNameInput').value.trim() && parsed.name) $('skillNameInput').value = parsed.name.slice(0, 120);
        if (!$('skillDescriptionInput').value.trim() && parsed.description) $('skillDescriptionInput').value = parsed.description.slice(0, 500);
        $('skillInstructionInput').value = parsed.instruction.slice(0, 200000);
      }
      state.importedFiles = mergeSkillFiles(previousFiles, loaded); state.importFilesTouched = true;
      $('skillImportStatus').textContent = '已追加 ' + loaded.length + ' 个文件，当前共 ' + state.importedFiles.length + ' 个文件，可继续编辑后保存。';
      $('skillImportList').textContent = state.importedFiles.map(function (item) { return item.path + (item.type === 'binary' ? '（资源清单）' : ''); }).join(' · ');
    } catch (error) {
      state.importedFiles = previousFiles;
      $('skillImportStatus').textContent = '读取失败，请重新选择文件或文件夹。';
      $('skillImportList').textContent = state.importedFiles.map(function (item) { return item.path + (item.type === 'binary' ? '（资源清单）' : ''); }).join(' · ');
      showToast(error.message || 'Skill 文件读取失败');
    } finally { state.fileBusy = false; }
  }

  function skillPayload() {
    var payload = { name: $('skillNameInput').value.trim(), description: $('skillDescriptionInput').value.trim(), instruction: $('skillInstructionInput').value.trim() };
    if (state.importFilesTouched || state.importedFiles.length) {
      payload.files = state.importedFiles.map(function (item) { return item.path; });
      payload.runtimeFiles = {};
      payload.fileManifest = state.importedFiles.map(function (item) { payload.runtimeFiles[item.path] = item.type === 'text' ? item.content : null; return { path: item.path, type: item.type, size: item.size }; });
    }
    return payload;
  }

  function submitEditor(event) {
    event.preventDefault();
    if (state.busy) return;
    if (state.fileBusy) { showToast('文件仍在读取，请稍候'); return; }
    var payload = skillPayload();
    if (!payload.name || !payload.instruction) { showToast('请填写 Skill 名称和指令内容'); return; }
    var action = event.submitter && event.submitter.getAttribute('data-submit-action') || 'publish';
    var requestSession = sessionKey();
    var ensureSession = function (value) { if (!isCurrentSession(requestSession)) throw sessionChangedError(); return value; };
    state.busy = true;
    $('savePrivateSkillBtn').disabled = true; $('publishSkillBtn').disabled = true;
    var request;
    if (state.editorMode === 'edit') {
      request = api('/api/open-skills/' + encodeURIComponent(state.editingId), { method: 'PATCH', body: JSON.stringify(payload) }).then(ensureSession);
    } else if (action === 'private') {
      request = api('/api/skills/import', { method: 'POST', body: JSON.stringify(payload) }).then(ensureSession);
    } else {
      var savePrivate = state.editorSourcePrivate ? Promise.resolve() : api('/api/skills/import', { method: 'POST', body: JSON.stringify(payload) }).then(ensureSession);
      request = savePrivate.then(function () { return api('/api/open-skills', { method: 'POST', body: JSON.stringify(payload) }); }).then(ensureSession);
    }
    request.then(function () {
      if (!isCurrentSession(requestSession)) throw sessionChangedError();
      showToast(state.editorMode === 'edit' ? '开放 Skill 已更新' : (action === 'private' ? 'Skill 已保存到我的库' : 'Skill 已发布到开放区'));
      closeEditor();
      return Promise.all([loadOpenSkills(), loadPrivateSkills()]);
    }).catch(function (error) { if (error.code !== 'SESSION_CHANGED') showToast(error.message || '保存失败'); }).finally(function () {
      state.busy = false; $('savePrivateSkillBtn').disabled = false; $('publishSkillBtn').disabled = false;
    });
  }

  function openDetail(id) {
    var requestId = ++state.requestSeq.detail;
    readLocalUser();
    var requestSession = sessionKey();
    api('/api/open-skills/' + encodeURIComponent(id)).then(function (data) {
      if (requestId !== state.requestSeq.detail || !isCurrentSession(requestSession)) return;
      var skill = data.skill || {};
      state.detailSkill = skill;
      $('skillDetailTitle').textContent = skill.name || 'Skill 详情';
      $('skillDetailMeta').textContent = (skill.author || '墨阑作者') + ' · ' + formatNumber(skill.downloads) + ' 次下载 · 更新于 ' + formatDate(skill.updatedAt);
      $('skillDetailDescription').textContent = skill.description || '暂无描述';
      $('skillDetailInstruction').textContent = skill.instruction || '';
      $('downloadDetailSkillBtn').textContent = state.user ? '下载到我的 Skill' : '登录后下载';
      setModal($('skillDetailModal'), true); renderIcons();
    }).catch(function (error) { if (requestId === state.requestSeq.detail && error.code !== 'SESSION_CHANGED') showToast(error.message || 'Skill 详情加载失败'); });
  }

  function closeDetail() { state.requestSeq.detail += 1; setModal($('skillDetailModal'), false); state.detailSkill = null; }

  function downloadSkill(id) {
    if (!state.token) { showToast('请先登录后下载，下载内容会保存到你的私有 Skill'); return; }
    var requestSession = sessionKey();
    var key = requestSession + ':' + id;
    if (!pendingDownloads.has(key)) pendingDownloads.set(key, Array.from(crypto.getRandomValues(new Uint8Array(16)), function (byte) { return byte.toString(16).padStart(2, '0'); }).join(''));
    api('/api/open-skills/' + encodeURIComponent(id) + '/download', { method: 'POST', body: JSON.stringify({ requestId: pendingDownloads.get(key) }) }).then(function () {
      pendingDownloads.delete(key);
      if (!isCurrentSession(requestSession)) throw sessionChangedError();
      showToast('已下载到我的 Skill'); closeDetail(); return Promise.all([loadOpenSkills(), loadPrivateSkills()]);
    }).catch(function (error) { if (error.code !== 'SESSION_CHANGED') showToast(error.message || '下载失败'); });
  }

  function updateOpenStatus(id, status) {
    var requestSession = sessionKey();
    api('/api/open-skills/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status: status }) }).then(function () {
      if (!isCurrentSession(requestSession)) throw sessionChangedError();
      showToast(status === 'withdrawn' ? 'Skill 已撤回' : 'Skill 已重新发布'); return loadOpenSkills();
    }).catch(function (error) { if (error.code !== 'SESSION_CHANGED') showToast(error.message || '状态更新失败'); });
  }

  function handleGridClick(event) {
    var button = event.target.closest('[data-action]');
    if (!button) return;
    var id = button.getAttribute('data-id');
    var action = button.getAttribute('data-action');
    if (action === 'detail') openDetail(id);
    else if (action === 'download') downloadSkill(id);
    else if (action === 'edit') {
      var item = state.openSkills.find(function (skill) { return skill.id === id; });
      if (item) {
        var requestId = ++state.requestSeq.editor;
        var requestSession = sessionKey();
        api('/api/open-skills/' + encodeURIComponent(id)).then(function (data) { if (requestId === state.requestSeq.editor && isCurrentSession(requestSession)) openEditor('edit', data.skill); }).catch(function (error) { if (requestId === state.requestSeq.editor && error.code !== 'SESSION_CHANGED') showToast(error.message); });
      }
    } else if (action === 'withdraw' || action === 'republish') {
      updateOpenStatus(id, action === 'withdraw' ? 'withdrawn' : 'published');
    }
  }

  function switchScope(scope) {
    if (scope === 'mine' && !state.token) { showToast('请先登录后查看自己的开放 Skill'); return; }
    state.scope = scope; state.page = 1;
    document.querySelectorAll('[data-scope]').forEach(function (button) { var active = button.getAttribute('data-scope') === scope; button.classList.toggle('is-active', active); button.setAttribute('aria-selected', active ? 'true' : 'false'); });
    loadOpenSkills();
  }

  function bind() {
    $('createSkillBtn').addEventListener('click', function () { openEditor('create'); });
    $('emptyCreateSkillBtn').addEventListener('click', function () { openEditor('create'); });
    $('skillEditorForm').addEventListener('submit', submitEditor);
    $('skillFileInput').addEventListener('change', function (event) { void readSkillFiles(event.target.files); event.target.value = ''; });
    $('skillFolderInput').addEventListener('change', function (event) { void readSkillFiles(event.target.files); event.target.value = ''; });
    $('skillImportClear').addEventListener('click', function () { state.importedFiles = []; state.importFilesTouched = true; $('skillImportStatus').textContent = '已清空文件清单，可重新选择单个文件或文件夹。'; $('skillImportList').textContent = ''; });
    $('closeSkillEditorBtn').addEventListener('click', closeEditor); $('cancelSkillEditorBtn').addEventListener('click', closeEditor);
    $('skillEditorModal').addEventListener('click', function (event) { if (event.target === $('skillEditorModal')) closeEditor(); });
    $('closeSkillDetailBtn').addEventListener('click', closeDetail); $('closeSkillDetailBtn2').addEventListener('click', closeDetail);
    $('skillDetailModal').addEventListener('click', function (event) { if (event.target === $('skillDetailModal')) closeDetail(); });
    $('downloadDetailSkillBtn').addEventListener('click', function () { if (state.detailSkill) downloadSkill(state.detailSkill.id); });
    $('skillsGrid').addEventListener('click', handleGridClick);
    $('privateSkillsList').addEventListener('click', function (event) {
      var create = event.target.closest('[data-private-create]');
      if (create) { event.preventDefault(); openEditor('create'); return; }
      var button = event.target.closest('[data-private-publish]');
      if (!button) return;
      var skill = state.privateSkills.find(function (item) { return item.id === button.getAttribute('data-private-publish'); });
      if (skill) openEditor('publish-private', skill);
    });
    document.querySelectorAll('[data-scope]').forEach(function (button) { button.addEventListener('click', function () { switchScope(button.getAttribute('data-scope')); }); });
    $('skillSearch').addEventListener('input', function (event) { state.query = event.target.value.trim(); clearTimeout(searchTimer); searchTimer = setTimeout(function () { state.page = 1; loadOpenSkills(); }, 240); });
    $('skillSort').addEventListener('change', function (event) { state.sort = event.target.value; state.page = 1; loadOpenSkills(); });
    $('refreshSkillsBtn').addEventListener('click', loadOpenSkills); $('refreshPrivateBtn').addEventListener('click', loadPrivateSkills);
    $('prevSkillPage').addEventListener('click', function () { if (state.page > 1) { state.page -= 1; loadOpenSkills(); } });
    $('nextSkillPage').addEventListener('click', function () { if (state.page < state.totalPages) { state.page += 1; loadOpenSkills(); } });
    document.addEventListener('keydown', function (event) { if (event.key !== 'Escape') return; if (!$('skillEditorModal').hidden) closeEditor(); else if (!$('skillDetailModal').hidden) closeDetail(); });
    window.addEventListener('molan:auth-changed', function () { refreshAuth(); if (state.scope === 'mine' && !getToken()) switchScope('public'); });
    window.addEventListener('storage', function (event) { if (event.key === 'ml_token' || event.key === 'ml_user') refreshAuth(); });
  }

  function init() { bind(); renderIcons(); refreshAuth(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
