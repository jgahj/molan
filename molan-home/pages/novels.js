(function () {
  'use strict';

  var API_BASE = location.protocol === 'file:' || location.protocol === 'about:' ? 'http://localhost:3000' : '';
  var state = { token: '', user: null, local: {}, remote: [], workspaces: [], items: [], query: '', status: 'all', sort: 'updated', group: 'none', view: 'grid', modalMode: 'create', editingId: '', busy: false, refreshSeq: 0 };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var TOKEN_KEY = 'ml_token';
  var USER_KEY = 'ml_user';
  var NOVELS_BASE = 'molan_editor_novels';
  var CURRENT_BASE = 'molan_editor_current';
  var VIEW_KEY = 'molan_novels_view';
  var STATUS_LABELS = { draft: '未开始', writing: '创作中', completed: '已完成' };
  var STATUS_ORDER = ['writing', 'draft', 'completed'];

  function readAuth() {
    try {
      state.token = localStorage.getItem(TOKEN_KEY) || '';
      state.user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch (_) { state.token = ''; state.user = null; }
    if (!state.user || !state.user.email) state.user = null;
  }
  function actorId() { return state.user && (state.user.userId || state.user.id) ? String(state.user.userId || state.user.id).trim() : ''; }
  function sessionKey() { return String(state.token || '') + '|' + (actorId() || (state.user && state.user.email ? String(state.user.email).trim().toLowerCase() : '')); }
  function sessionChangedError() { var error = new Error('登录账户已切换'); error.code = 'SESSION_CHANGED'; return error; }
  function isCurrentSession(key) { readAuth(); return sessionKey() === key; }
  function isCurrentRefresh(seq, key) { return seq === state.refreshSeq && isCurrentSession(key); }
  function identity() { return actorId() ? encodeURIComponent(actorId()) : state.user && state.user.email ? encodeURIComponent(String(state.user.email).trim().toLowerCase()) : 'guest'; }
  function novelsKey() { return NOVELS_BASE + ':' + identity(); }
  function currentKey() { return CURRENT_BASE + ':' + identity(); }
  function readLocal() {
    try { state.local = JSON.parse(localStorage.getItem(novelsKey()) || '{}') || {}; } catch (_) { state.local = {}; }
  }
  function saveLocal() {
    try { localStorage.setItem(novelsKey(), JSON.stringify(state.local)); } catch (error) { showToast('本地保存失败：空间不足'); }
  }
  function headers() {
    var result = { 'Content-Type': 'application/json' };
    if (state.token) result.Authorization = 'Bearer ' + state.token;
    return result;
  }
  function api(path, method, body) {
    return fetch(API_BASE + path, { method: method || 'GET', headers: headers(), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) { var error = new Error(data.error || '请求失败'); error.status = response.status; throw error; }
        return data;
      });
    });
  }
  function htmlToText(html) {
    var div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function countWords(html) {
    var text = htmlToText(html);
    var cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
    var latin = (text.replace(/[一-鿿㐀-䶿]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    return cjk + latin;
  }
  function stateStats(novel) {
    var volumes = novel && Array.isArray(novel.volumes) ? novel.volumes : [];
    var chapters = volumes.reduce(function (all, volume) { return all.concat(Array.isArray(volume.chapters) ? volume.chapters : []); }, []);
    var words = chapters.reduce(function (sum, chapter) {
      return sum + (Array.isArray(chapter.scenes) ? chapter.scenes.reduce(function (sceneSum, scene) { return sceneSum + countWords(scene.content || ''); }, 0) : Number(chapter.wordCount) || 0);
    }, 0);
    var book = novel.outline && novel.outline.book || {};
    var volume = novel.outline && novel.outline.volume || {};
    var description = book.oneLine || book.synopsis || volume.synopsis || novel.description || '';
    var hasFinished = novel.status === 'completed' || book.status === 'completed';
    return { chapters: chapters.length, words: words, description: description, status: hasFinished ? 'completed' : words > 0 ? 'writing' : 'draft', cover: novel.cover || novel.metadata && novel.metadata.cover || '' };
  }
  function hash(value) { var total = 0; String(value || '').split('').forEach(function (char) { total = ((total << 5) - total) + char.charCodeAt(0); total |= 0; }); return Math.abs(total); }
  function coverClass(title) { return ['novel-cover--moss', 'novel-cover--slate', 'novel-cover--clay', 'novel-cover--ink'][hash(title) % 4]; }
  function dateValue(value) { var number = Number(value) || 0; return number > 0 ? number : 0; }
  function dateText(value) {
    var time = dateValue(value);
    if (!time) return '尚未编辑';
    var date = new Date(time);
    var now = new Date();
    if (date.toDateString() === now.toDateString()) return '今天 ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
  }
  function monthText(value) { var date = new Date(dateValue(value) || Date.now()); return date.getFullYear() + '年' + (date.getMonth() + 1) + '月'; }
  function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; } }
  function mergeItems() {
    var remoteMap = {};
    state.remote.forEach(function (item) { remoteMap[item.id] = item; });
    var ids = Object.keys(state.local);
    state.remote.forEach(function (item) { if (ids.indexOf(item.id) < 0) ids.push(item.id); });
    state.items = ids.filter(function (id) { return id && (state.local[id] || remoteMap[id]); }).map(function (id) {
      var local = state.local[id] || null;
      var remote = remoteMap[id] || null;
      var localUpdated = dateValue(local && local.updatedAt);
      var remoteUpdated = dateValue(remote && remote.updated_at || remote && remote.updatedAt);
      var useLocal = !!local && localUpdated >= remoteUpdated;
      var source = useLocal ? local : remote || local;
      var stats = local ? stateStats(local) : { chapters: null, words: Number(remote && remote.word_count) || 0, description: '', status: Number(remote && remote.word_count) > 0 ? 'writing' : 'draft', cover: '' };
      var title = (useLocal && local.title) || (remote && remote.title) || (source && source.title) || '未命名小说';
      return { id: id, title: title, description: stats.description || '', chapters: stats.chapters, words: useLocal ? stats.words : Number(remote && remote.word_count) || stats.words, status: stats.status, cover: stats.cover, updatedAt: useLocal ? localUpdated : remoteUpdated, createdAt: Number(remote && remote.created_at) || Number(local && local.createdAt) || localUpdated, local: local, remote: remote, dirtyLocal: !!local && localUpdated > remoteUpdated };
    });
  }
  function filteredItems() {
    var query = state.query.trim().toLowerCase();
    var list = state.items.filter(function (item) {
      if (state.status !== 'all' && item.status !== state.status) return false;
      if (!query) return true;
      return (item.title + ' ' + item.description).toLowerCase().indexOf(query) >= 0;
    });
    list.sort(function (a, b) {
      if (state.sort === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      if (state.sort === 'created') return b.createdAt - a.createdAt;
      if (state.sort === 'words') return b.words - a.words;
      return b.updatedAt - a.updatedAt;
    });
    return list;
  }
  function icon(name) { return '<i data-lucide="' + name + '"></i>'; }
  function cardHtml(item) {
    var status = STATUS_LABELS[item.status] || STATUS_LABELS.draft;
    var chapterText = item.chapters == null ? '云端作品' : item.chapters + ' 章';
    var wordsText = item.words > 9999 ? (item.words / 10000).toFixed(1).replace(/\.0$/, '') + ' 万字' : item.words + ' 字';
    return '<article class="novel-card" data-id="' + esc(item.id) + '">' +
      '<div class="novel-card__main" data-action="open" role="button" tabindex="0" aria-label="打开《' + esc(item.title) + '》">' +
        '<div class="novel-cover ' + coverClass(item.title) + '">' + (item.cover ? '<img src="' + esc(item.cover) + '" alt="" />' : '<span class="novel-cover__title">' + esc(item.title) + '</span>') + '</div>' +
        '<div class="novel-card__body"><div class="novel-card__top"><h3>' + esc(item.title) + '</h3><span class="novel-status novel-status--' + esc(item.status) + '">' + status + '</span></div>' +
          '<p class="novel-card__desc">' + esc(item.description || '还没有简介') + '</p>' +
          '<div class="novel-card__meta"><span>' + icon('file-text') + esc(chapterText) + '</span><span>' + icon('type') + esc(wordsText) + '</span></div>' +
          '<div class="novel-card__date">' + esc(dateText(item.updatedAt)) + (item.dirtyLocal ? ' · 待同步' : '') + '</div></div></div>' +
      '<footer class="novel-card__footer"><span class="novel-card__footer-label">' + (item.id === currentNovelId() ? '当前编辑' : '墨阑作品') + '</span><div class="novel-card__actions">' +
        '<button type="button" data-action="open" aria-label="打开" title="打开">打开</button>' +
        '<button type="button" data-action="rename" aria-label="重命名" title="重命名">' + icon('pencil') + '</button>' +
        '<button type="button" data-action="delete" aria-label="删除" title="删除">' + icon('trash-2') + '</button>' +
      '</div></footer></article>';
  }
  function groupItems(list) {
    if (state.group === 'none') return [{ title: '', items: list }];
    var groups = [];
    var map = {};
    list.forEach(function (item) {
      var title = state.group === 'status' ? (STATUS_LABELS[item.status] || '未分类') : monthText(item.updatedAt);
      if (!map[title]) { map[title] = []; groups.push({ title: title, items: map[title] }); }
      map[title].push(item);
    });
    if (state.group === 'status') groups.sort(function (a, b) { return STATUS_ORDER.indexOf(a.items[0].status) - STATUS_ORDER.indexOf(b.items[0].status); });
    return groups;
  }
  function render() {
    mergeItems();
    var list = filteredItems();
    var results = $('novelResults');
    results.classList.toggle('is-list', state.view === 'list');
    document.querySelectorAll('[data-view]').forEach(function (button) {
      var active = button.dataset.view === state.view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    results.innerHTML = groupItems(list).map(function (group) {
      return '<section class="novel-group">' + (group.title ? '<h2 class="novel-group__title"><span>' + esc(group.title) + ' · ' + group.items.length + '</span></h2>' : '') + '<div class="novel-grid">' + group.items.map(cardHtml).join('') + '</div></section>';
    }).join('');
    $('resultMeta').textContent = list.length + ' / ' + state.items.length + ' 本作品';
    $('libraryMeta').textContent = state.items.length ? '共 ' + state.items.length + ' 本作品' : '从一个想法开始，建立你的创作空间';
    var empty = $('emptyState');
    empty.hidden = !!list.length;
    if (!list.length) {
      $('emptyTitle').textContent = state.items.length ? '没有匹配的小说' : '还没有小说';
      $('emptyText').textContent = state.items.length ? '换一个关键词或筛选条件试试。' : '创建你的第一部作品，写下一个故事的开头。';
    }
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }
  function currentNovelId() { try { return localStorage.getItem(currentKey()) || ''; } catch (_) { return ''; } }
  function showToast(message) {
    var toast = $('novelsToast'); toast.textContent = message; toast.classList.add('is-visible'); clearTimeout(toast._timer); toast._timer = setTimeout(function () { toast.classList.remove('is-visible'); }, 2600);
  }
  function setLoading(visible) { $('loadingState').hidden = !visible; if (visible) $('novelResults').innerHTML = ''; }
  function refreshList(silent) {
    var requestSeq = ++state.refreshSeq;
    readAuth(); readLocal();
    var requestSession = sessionKey();
    setLoading(true);
    if (!state.token) {
      if (!isCurrentRefresh(requestSeq, requestSession)) return Promise.resolve();
      state.remote = [];
      state.workspaces = [];
      $('syncMeta').textContent = Object.keys(state.local).length ? '本地作品 · 登录后可跨设备同步' : '未登录';
      setLoading(false); render(); return Promise.resolve();
    }
    return Promise.all([api('/api/novels'), api('/api/workspaces')]).then(function (responses) {
      if (!isCurrentRefresh(requestSeq, requestSession)) return;
      state.remote = Array.isArray(responses[0].novels) ? responses[0].novels : [];
      state.workspaces = Array.isArray(responses[1].workspaces) ? responses[1].workspaces : [];
      $('syncMeta').textContent = '云端 ' + state.remote.length + ' 本 · ' + state.workspaces.length + ' 个工作区 · 已同步';
    }).catch(function (error) {
      if (!isCurrentRefresh(requestSeq, requestSession)) return;
      state.remote = [];
      state.workspaces = [];
      $('syncMeta').textContent = Object.keys(state.local).length ? '云端暂不可用 · 显示本地作品' : '云端暂不可用';
      if (!silent) showToast(error.status === 401 ? '登录状态已失效，请重新登录' : '云端作品加载失败，已显示本地作品');
    }).finally(function () { if (isCurrentRefresh(requestSeq, requestSession)) { setLoading(false); render(); } });
  }
  function openDialog(mode, item) {
    state.modalMode = mode; state.editingId = item ? item.id : '';
    $('dialogTitle').textContent = mode === 'rename' ? '编辑作品信息' : '创建小说';
    $('dialogSubmitText').textContent = mode === 'rename' ? '保存更改' : '进入编辑器';
    $('novelTitleInput').value = item ? item.title : '';
    $('novelDescriptionInput').value = item ? item.description : '';
    var workspaceSelect = $('novelWorkspaceSelect');
    var workspaceField = $('novelWorkspaceField');
    if (workspaceSelect) {
      workspaceSelect.innerHTML = state.workspaces.length
        ? state.workspaces.map(function (workspace) { return '<option value="' + esc(workspace.id) + '">' + esc(workspace.name) + ' · ' + esc(workspace.role) + '</option>'; }).join('')
        : '<option value="">当前个人工作区</option>';
      workspaceSelect.value = item && item.workspaceId ? item.workspaceId : (state.workspaces[0] && state.workspaces[0].id || '');
    }
    if (workspaceField) workspaceField.hidden = mode === 'rename';
    $('dialogHint').textContent = mode === 'rename' ? '名称和简介会同步到作品正文的书籍信息。' : '创建后会进入编辑器，你可以继续补充大纲、人物和设定。';
    var dialog = $('novelDialog'); dialog.hidden = false; dialog.setAttribute('aria-hidden', 'false');
    setTimeout(function () { $('novelTitleInput').focus(); }, 0);
  }
  function closeDialog() { var dialog = $('novelDialog'); dialog.hidden = true; dialog.setAttribute('aria-hidden', 'true'); state.editingId = ''; }
  function goToNew(title, description, workspaceId) {
    var query = new URLSearchParams({ action: 'new' });
    if (title) query.set('title', title);
    if (description) query.set('description', description);
    if (workspaceId) query.set('workspaceId', workspaceId);
    location.href = '../index.html?' + query.toString() + '#editor';
  }
  function openNovel(item) { location.href = '../index.html?nid=' + encodeURIComponent(item.id) + '#editor'; }
  function readStateFor(item, requestSession) {
    if (requestSession && !isCurrentSession(requestSession)) return Promise.reject(sessionChangedError());
    if (item.local && (!item.remote || item.dirtyLocal)) return Promise.resolve({ state: clone(item.local), revision: item.remote && Number(item.remote.revision) || null });
    if (!state.token) return Promise.reject(new Error('未登录，无法读取云端作品')); 
    return api('/api/novels/' + encodeURIComponent(item.id)).then(function (data) {
      if (requestSession && !isCurrentSession(requestSession)) throw sessionChangedError();
      return { state: data.novel && data.novel.state, revision: data.novel && Number(data.novel.revision) || null };
    });
  }
  function renameNovel(item) {
    var title = $('novelTitleInput').value.trim();
    var description = $('novelDescriptionInput').value.trim();
    if (!title) { showToast('请输入小说名称'); return; }
    var requestSession = sessionKey();
    $('dialogSubmitText').textContent = '保存中…'; $('novelForm').querySelector('[type="submit"]').disabled = true;
    readStateFor(item, requestSession).then(function (result) {
      if (!isCurrentSession(requestSession)) throw sessionChangedError();
      var novel = result.state || {};
      novel.title = title; novel.updatedAt = Date.now();
      novel.outline = novel.outline || {}; novel.outline.book = novel.outline.book || {}; novel.outline.book.title = title; novel.outline.book.oneLine = description;
      state.local[item.id] = novel; saveLocal();
      if (state.token && item.remote) return api('/api/novels/' + encodeURIComponent(item.id), 'PUT', { state: novel, title: title, revision: result.revision }).then(function () { if (!isCurrentSession(requestSession)) throw sessionChangedError(); return true; });
      return true;
    }).then(function () { if (!isCurrentSession(requestSession)) return; closeDialog(); showToast('作品信息已保存'); return refreshList(true); }).catch(function (error) { if (error.code !== 'SESSION_CHANGED') showToast(error.message || '保存失败'); }).finally(function () { var submit = $('novelForm').querySelector('[type="submit"]'); submit.disabled = false; $('dialogSubmitText').textContent = '保存更改'; });
  }
  function deleteNovel(item) {
    if (!window.confirm('确定删除《' + item.title + '》吗？此操作不可撤销。')) return;
    var requestSession = sessionKey();
    var previousLocal = state.local[item.id];
    delete state.local[item.id];
    state.remote = state.remote.filter(function (entry) { return entry.id !== item.id; });
    saveLocal();
    if (currentNovelId() === item.id) { try { localStorage.removeItem(currentKey()); } catch (_) {} }
    render();
    var task = state.token && item.remote ? api('/api/novels/' + encodeURIComponent(item.id), 'DELETE') : Promise.resolve();
    task.then(function () {
      if (!isCurrentSession(requestSession)) return;
      showToast('已删除《' + item.title + '》'); return refreshList(true);
    }).catch(function (error) {
      if (!isCurrentSession(requestSession)) return;
      if (previousLocal) state.local[item.id] = previousLocal; saveLocal();
      render();
      showToast(error.message || '删除失败');
      return refreshList(true);
    });
  }
  function onResultsClick(event) {
    var card = event.target.closest('.novel-card'); if (!card) return;
    var item = state.items.find(function (entry) { return entry.id === card.dataset.id; }); if (!item) return;
    var action = event.target.closest('[data-action]');
    if (!action || action.dataset.action === 'open') openNovel(item);
    else if (action.dataset.action === 'rename') openDialog('rename', item);
    else if (action.dataset.action === 'delete') deleteNovel(item);
  }
  function onResultsKey(event) { if ((event.key === 'Enter' || event.key === ' ') && event.target.dataset.action === 'open') { event.preventDefault(); var card = event.target.closest('.novel-card'); var item = state.items.find(function (entry) { return entry.id === card.dataset.id; }); if (item) openNovel(item); } }
  function bind() {
    try { state.view = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch (_) {}
    $('searchInput').addEventListener('input', function (event) { state.query = event.target.value; render(); });
    $('statusFilter').addEventListener('change', function (event) { state.status = event.target.value; render(); });
    $('sortSelect').addEventListener('change', function (event) { state.sort = event.target.value; render(); });
    $('groupSelect').addEventListener('change', function (event) { state.group = event.target.value; render(); });
    document.querySelectorAll('[data-view]').forEach(function (button) { button.addEventListener('click', function () { state.view = button.dataset.view; document.querySelectorAll('[data-view]').forEach(function (other) { var active = other === button; other.classList.toggle('is-active', active); other.setAttribute('aria-pressed', active ? 'true' : 'false'); }); try { localStorage.setItem(VIEW_KEY, state.view); } catch (_) {} render(); }); });
    $('novelResults').addEventListener('click', onResultsClick); $('novelResults').addEventListener('keydown', onResultsKey);
    $('createNovelBtn').addEventListener('click', function () { openDialog('create'); }); $('emptyCreateBtn').addEventListener('click', function () { openDialog('create'); });
    $('refreshBtn').addEventListener('click', function () { refreshList(false); });
    $('dialogClose').addEventListener('click', closeDialog); $('dialogCancel').addEventListener('click', closeDialog); $('novelDialog').addEventListener('click', function (event) { if (event.target === $('novelDialog')) closeDialog(); });
    $('novelForm').addEventListener('submit', function (event) { event.preventDefault(); var title = $('novelTitleInput').value.trim(); var description = $('novelDescriptionInput').value.trim(); if (state.modalMode === 'rename') { var item = state.items.find(function (entry) { return entry.id === state.editingId; }); if (item) renameNovel(item); } else { if (!title) { showToast('请输入小说名称'); return; } goToNew(title, description, $('novelWorkspaceSelect') && $('novelWorkspaceSelect').value); } });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !$('novelDialog').hidden) closeDialog(); });
    window.addEventListener('molan:auth-changed', function () { refreshList(true); });
  }
  function init() { bind(); if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); refreshList(false); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}());
