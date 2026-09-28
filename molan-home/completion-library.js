(function () {
  'use strict';

  var NOVELS_KEY = 'molan_editor_novels';
  var CURRENT_KEY = 'molan_editor_current';
  var VIEW_KEY = 'molan_novels_view';
  var STATUS_LABELS = { draft: '草稿', writing: '创作中', paused: '暂停', completed: '已完成' };
  var STATUS_ORDER = ['writing', 'paused', 'draft', 'completed'];
  var state = {
    query: '',
    status: 'all',
    sort: 'updated',
    group: 'none',
    view: 'list',
    items: [],
    refreshing: false,
    busy: false,
    localMap: {}
  };
  var installed = false;
  var observer = null;
  var reconcileQueued = false;
  var writingDom = false;
  var localSaveTimer = null;
  var lastRefreshAt = 0;
  var refreshQueued = false;
  var refreshVersion = 0;
  var activeRefreshKey = '';
  var lastAccountKey = '';

  function escape(value) {
    if (typeof escapeBackendHtml === 'function') return escapeBackendHtml(value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function number(value) {
    var result = Number(value);
    return Number.isFinite(result) ? result : 0;
  }

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  }

  function pageName() {
    var page = String(window.location.hash || '').replace(/^#/, '');
    return page || 'overview';
  }

  function identity() {
    var user = backendState && backendState.user;
    var email = user && user.email ? String(user.email).trim().toLowerCase() : 'guest';
    return encodeURIComponent(email);
  }

  function sessionKey() {
    var version = backendState && Number(backendState.sessionVersion) || 0;
    var token = backendState && backendState.token || '';
    return version + ':' + identity() + ':' + token;
  }

  function currentAccountKey() {
    return identity();
  }

  function isCurrentSession(key) {
    return key === sessionKey();
  }

  function localNovelsKey() { return NOVELS_KEY + ':' + identity(); }
  function localCurrentKey() { return CURRENT_KEY + ':' + identity(); }

  function readLocalMap() {
    var result = {};
    try {
      var parsed = JSON.parse(localStorage.getItem(localNovelsKey()) || '{}');
      if (Array.isArray(parsed)) {
        parsed.forEach(function (item, index) {
          var value = item && item.state && typeof item.state === 'object' ? item.state : item;
          var id = String(item && (item.id || item.nid) || value && value.id || 'n_local_' + index);
          if (value && typeof value === 'object') result[id] = value;
        });
      } else if (parsed && typeof parsed === 'object') {
        Object.keys(parsed).forEach(function (id) {
          var value = parsed[id];
          result[id] = value && value.state && typeof value.state === 'object' ? value.state : value;
        });
      }
    } catch (_) {}

    if (!Object.keys(result).length && identity() === 'guest') {
      try {
        var guest = JSON.parse(localStorage.getItem('molan_guest_novel_state') || 'null');
        if (guest && guest.state && typeof guest.state === 'object') {
          result[String(guest.id || guest.state.id || 'n_guest_draft')] = guest.state;
        }
      } catch (_) {}
    }
    return result;
  }

  function writeLocalMap(map) {
    try {
      localStorage.setItem(localNovelsKey(), JSON.stringify(map || {}));
      return true;
    } catch (_) {
      showToast('本地保存失败，浏览器存储空间不足');
      return false;
    }
  }

  function setCurrentNovel(id) {
    try { localStorage.setItem(localCurrentKey(), String(id || '')); } catch (_) {}
  }

  function currentNovelId() {
    try { return localStorage.getItem(localCurrentKey()) || ''; } catch (_) { return ''; }
  }

  function htmlText(value) {
    var node = document.createElement('div');
    node.innerHTML = String(value || '');
    return String(node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function wordCount(value) {
    var text = htmlText(value);
    var cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
    var latin = (text.replace(/[一-鿿㐀-䶿]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    return cjk + latin;
  }

  function chaptersOf(novelState) {
    var chapters = [];
    (novelState && Array.isArray(novelState.volumes) ? novelState.volumes : []).forEach(function (volume) {
      (volume && Array.isArray(volume.chapters) ? volume.chapters : []).forEach(function (chapter) {
        if (chapter && typeof chapter === 'object') chapters.push({ chapter: chapter, volume: volume });
      });
    });
    return chapters;
  }

  function wordsOf(novelState) {
    if (!novelState || typeof novelState !== 'object') return 0;
    if (number(novelState.wordCount) > 0) return number(novelState.wordCount);
    return chaptersOf(novelState).reduce(function (total, item) {
      var scenes = Array.isArray(item.chapter.scenes) ? item.chapter.scenes : [];
      return total + scenes.reduce(function (sum, scene) { return sum + wordCount(scene && scene.content); }, 0);
    }, 0);
  }

  function entitiesOf(novelState) {
    if (!novelState || typeof novelState !== 'object') return 0;
    var knowledge = novelState.knowledge || {};
    var entities = knowledge.entities;
    if (Array.isArray(entities)) return entities.length;
    if (entities && typeof entities === 'object') return Object.keys(entities).length;
    if (Array.isArray(novelState.workspace && novelState.workspace.knowledge)) return novelState.workspace.knowledge.length;
    return Array.isArray(novelState.knowledgeEntities) ? novelState.knowledgeEntities.length : 0;
  }

  function statusOf(novelState, words) {
    var book = novelState && novelState.outline && novelState.outline.book || {};
    var raw = String(novelState && (novelState.status || novelState.progressStatus) || book.status || '').toLowerCase();
    if (['completed', 'complete', 'finished', 'done', '已完成', '完成'].indexOf(raw) >= 0) return 'completed';
    if (['paused', 'pause', 'on_hold', 'suspended', '停更', '暂停'].indexOf(raw) >= 0) return 'paused';
    if (['writing', 'ongoing', 'serial', 'in_progress', '连载中', '创作中'].indexOf(raw) >= 0) return 'writing';
    return words > 0 ? 'writing' : 'draft';
  }

  function remoteStatusOf(novel, words) {
    var raw = String(novel && novel.status || '').toLowerCase();
    if (['completed', 'complete', 'finished', 'done', '已完成', '完成'].indexOf(raw) >= 0) return 'completed';
    if (['paused', 'pause', 'on_hold', 'suspended', '停更', '暂停'].indexOf(raw) >= 0) return 'paused';
    if (['writing', 'ongoing', 'serial', 'in_progress', '连载中', '创作中'].indexOf(raw) >= 0) return 'writing';
    return words > 0 ? 'writing' : 'draft';
  }

  function descriptionOf(novelState) {
    var book = novelState && novelState.outline && novelState.outline.book || {};
    return String(novelState && (novelState.description || novelState.intro) || book.oneLine || book.synopsis || '').trim();
  }

  function typeOf(novelState) {
    var book = novelState && novelState.outline && novelState.outline.book || {};
    return String(novelState && novelState.type || Array.isArray(book.themes) && book.themes[0] || '未分类');
  }

  function updatedOf(value) {
    var parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    var date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function dateLabel(value) {
    if (!value) return '尚未编辑';
    if (typeof backendDate === 'function') return backendDate(value);
    return new Date(value).toLocaleDateString('zh-CN');
  }

  function normalizeLocal(id, novelState) {
    var source = novelState && typeof novelState === 'object' ? novelState : {};
    var words = wordsOf(source);
    var chapters = chaptersOf(source);
    var current = chapters.filter(function (item) { return item.chapter.id === source.currentChapterId; })[0] || chapters[chapters.length - 1];
    return {
      id: String(id),
      title: String(source.title || source.name || source.outline && source.outline.book && source.outline.book.title || '未命名小说'),
      description: descriptionOf(source),
      type: typeOf(source),
      words: words,
      chapters: chapters.length,
      entities: entitiesOf(source),
      status: statusOf(source, words),
      updatedAt: updatedOf(source.updatedAt || source.updated_at),
      createdAt: updatedOf(source.createdAt || source.created_at || source.updatedAt),
      currentChapter: current && (current.chapter.title || current.chapter.name || '未命名章节'),
      local: source,
      remote: null,
      useLocal: true,
      pendingSync: true,
      localOnly: true
    };
  }

  function normalizeRemote(novel) {
    var source = novel && novel.state && typeof novel.state === 'object' ? novel.state : null;
    var words = source ? wordsOf(source) : number(novel && (novel.word_count == null ? novel.wordCount : novel.word_count));
    var chapters = source ? chaptersOf(source) : number(novel && (novel.chapter_count == null ? novel.chapterCount : novel.chapter_count));
    var current = source && chaptersOf(source).filter(function (item) { return item.chapter.id === source.currentChapterId; })[0];
    return {
      id: String(novel && (novel.id || novel.nid) || ''),
      title: String(novel && (novel.title || novel.name) || source && source.title || '未命名小说'),
      description: String(novel && (novel.description || novel.summary) || source && descriptionOf(source) || ''),
      type: source ? typeOf(source) : String(novel && (novel.type || novel.category) || '未分类'),
      words: words,
      chapters: chapters,
      entities: source ? entitiesOf(source) : number(novel && (novel.entity_count == null ? novel.entityCount : novel.entity_count)),
      status: source ? statusOf(source, words) : remoteStatusOf(novel, words),
      updatedAt: updatedOf(novel && (novel.updated_at == null ? novel.updatedAt : novel.updated_at)),
      createdAt: updatedOf(novel && (novel.created_at == null ? novel.createdAt : novel.created_at)),
      currentChapter: current && (current.chapter.title || current.chapter.name || '未命名章节'),
      local: null,
      remote: novel,
      useLocal: false,
      pendingSync: false,
      localOnly: false
    };
  }

  function mergeItems() {
    var localMap = readLocalMap();
    var remoteMap = {};
    (Array.isArray(backendState.novels) ? backendState.novels : []).forEach(function (novel) {
      var id = String(novel && (novel.id || novel.nid) || '');
      if (id) remoteMap[id] = normalizeRemote(novel);
    });

    var ids = Object.keys(localMap);
    Object.keys(remoteMap).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    var items = ids.map(function (id) {
      var local = localMap[id] ? normalizeLocal(id, localMap[id]) : null;
      var remote = remoteMap[id] || null;
      if (!local) return remote;
      if (!remote) return local;
      var localUpdated = local.updatedAt;
      var remoteUpdated = remote.updatedAt;
      var useLocal = localUpdated >= remoteUpdated || !remoteUpdated;
      var source = useLocal ? local : remote;
      return Object.assign({}, source, {
        id: id,
        local: local.local,
        remote: remote.remote,
        useLocal: useLocal,
        pendingSync: useLocal && localUpdated > remoteUpdated,
        localOnly: false,
        createdAt: Math.min(local.createdAt || remote.createdAt || 0, remote.createdAt || local.createdAt || 0) || local.createdAt || remote.createdAt
      });
    }).filter(function (item) { return item && item.id; });
    items.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    state.localMap = localMap;
    state.items = items;
    return items;
  }

  function statusText(status) { return STATUS_LABELS[status] || '草稿'; }
  function statusBadge(status) { return status === 'completed' ? 'green' : status === 'writing' ? 'blue' : status === 'paused' ? 'amber' : 'gray'; }

  function filteredItems() {
    var query = state.query.trim().toLowerCase();
    return state.items.filter(function (item) {
      if (state.status !== 'all' && item.status !== state.status) return false;
      if (!query) return true;
      return [item.title, item.description, item.type, statusText(item.status)].join(' ').toLowerCase().indexOf(query) >= 0;
    }).sort(function (a, b) {
      if (state.sort === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      if (state.sort === 'created') return b.createdAt - a.createdAt;
      if (state.sort === 'words') return b.words - a.words;
      return b.updatedAt - a.updatedAt;
    });
  }

  function monthLabel(value) {
    var date = new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? '未标记时间' : date.getFullYear() + '年' + (date.getMonth() + 1) + '月';
  }

  function grouped(items) {
    if (state.group === 'none') return [{ title: '', items: items }];
    var groups = [];
    var map = {};
    items.forEach(function (item) {
      var title = state.group === 'status' ? statusText(item.status) : monthLabel(item.updatedAt);
      if (!map[title]) { map[title] = []; groups.push({ title: title, items: map[title] }); }
      map[title].push(item);
    });
    if (state.group === 'status') groups.sort(function (a, b) { return STATUS_ORDER.indexOf(a.items[0].status) - STATUS_ORDER.indexOf(b.items[0].status); });
    return groups;
  }

  function coverClass(item, index) {
    if (item.status === 'completed') return 'light';
    if (item.status === 'draft') return 'blue';
    return index % 3 === 1 ? 'light' : index % 3 === 2 ? 'blue' : '';
  }

  function sourceBadge(item) {
    if (item.pendingSync) return '<span class="badge amber">待同步</span>';
    if (item.localOnly) return '<span class="badge gray">本地</span>';
    return '<span class="badge green">云端</span>';
  }

  function itemCard(item, index) {
    var chapters = item.chapters ? item.chapters + ' 章' : item.useLocal ? '未开始' : '云端作品';
    var words = item.words.toLocaleString('zh-CN') + ' 字';
    var current = item.currentChapter ? '当前 · ' + item.currentChapter : '最近编辑';
    var currentMark = item.id === currentNovelId() || String(previewState && (previewState.novelId || previewState._libraryLocalId) || '') === item.id;
    var search = escape([item.title, item.description, item.type, statusText(item.status)].join(' ')).toLowerCase();
    return '<article class="novel-row" data-library-novel-id="' + escape(item.id) + '" data-search="' + search + '">' +
      '<div class="novel-cover ' + coverClass(item, index) + '">' + escape(item.title.slice(0, 4)) + '</div>' +
      '<div><div class="novel-name">' + escape(item.title) + '</div><div class="novel-desc">' + escape(item.description || '还没有简介') + '</div><div class="novel-stats"><span>' + escape(item.type) + '</span><span>' + escape(chapters) + '</span><span>' + escape(current) + ' · ' + escape(dateLabel(item.updatedAt)) + '</span></div></div>' +
      '<div class="novel-actions">' + (currentMark ? '<span class="badge blue">当前编辑</span>' : '') + sourceBadge(item) + '<span class="badge ' + statusBadge(item.status) + '">' + statusText(item.status) + '</span><button class="button" data-library-action="open" data-library-id="' + escape(item.id) + '">打开</button><button class="button" aria-label="重命名" title="重命名" data-library-action="rename" data-library-id="' + escape(item.id) + '">' + icon('pencil') + '</button><button class="button danger" aria-label="删除" title="删除" data-library-action="delete" data-library-id="' + escape(item.id) + '">' + icon('trash-2') + '</button></div>' +
      '</article>';
  }

  function emptyMarkup(title, text, action, actionText) {
    return '<div class="empty" data-library-empty><div class="empty-icon">—</div><h3>' + escape(title) + '</h3><p>' + escape(text) + '</p>' + (action ? '<button class="button primary" data-library-action="' + escape(action) + '">' + escape(actionText || '开始') + '</button>' : '') + '</div>';
  }

  function syncNote() {
    if (state.refreshing) return '<div class="notice" data-library-sync-note>' + icon('refresh-cw') + '<span>正在同步当前账户的云端作品和任务。</span></div>';
    if (backendState.novelsError) return '<div class="notice" data-library-sync-note>' + icon('triangle-alert') + '<span>云端作品读取失败：' + escape(backendState.novelsError) + '。当前仍显示本地作品。 <button class="button" style="min-height:27px;padding:0 8px;font-size:10px" data-library-action="refresh">重试</button></span></div>';
    if (!backendState.token) return '<div class="notice" data-library-sync-note>' + icon('hard-drive') + '<span>当前为本地模式。登录后可将本地草稿同步到云端。</span></div>';
    var pending = state.items.filter(function (item) { return item.pendingSync || item.localOnly; }).length;
    return '<div class="notice" data-library-sync-note>' + icon('cloud') + '<span>云端 ' + state.items.filter(function (item) { return !item.localOnly; }).length + ' 本 · ' + (pending ? pending + ' 本待同步' : '本地与云端已同步') + '</span></div>';
  }

  function libraryControls() {
    return '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:7px;margin-top:10px">' +
      '<select class="table-input" style="width:auto;min-width:86px;height:31px" aria-label="状态筛选" data-library-control="status"><option value="all">全部状态</option><option value="draft">草稿</option><option value="writing">创作中</option><option value="paused">暂停</option><option value="completed">已完成</option></select>' +
      '<select class="table-input" style="width:auto;min-width:96px;height:31px" aria-label="排序方式" data-library-control="sort"><option value="updated">最近编辑</option><option value="created">创建时间</option><option value="title">标题</option><option value="words">字数</option></select>' +
      '<select class="table-input" style="width:auto;min-width:86px;height:31px" aria-label="分组方式" data-library-control="group"><option value="none">不分组</option><option value="status">按状态</option><option value="month">按月份</option></select>' +
      '</div>';
  }

  function pageShell(title, subtitle, tools, body, extra) {
    return '<div class="page-shell ' + (extra || '') + '"><div class="page-header"><div><div class="eyebrow">' + escape(title === '我的小说' ? 'LIBRARY' : 'WORKSPACE') + '</div><h1 class="page-title">' + escape(title) + '</h1><p class="page-subtitle">' + escape(subtitle) + '</p></div><div class="header-tools">' + tools + '</div></div>' + body + '</div>';
  }

  function renderOverview() {
    return pageShell('创作总览', '从最近编辑的作品继续，把正文、设定和 AI 协作放在同一个工作台里。',
      '<button class="button" data-library-action="refresh">' + icon('refresh-cw') + '刷新数据</button><button class="button primary" data-library-action="create">' + icon('plus') + '新建小说</button>',
      '<section class="overview-hero" data-library-root="overview"><article class="continue-panel"><div class="eyebrow">继续创作</div><h2 data-library-continue-title>还没有作品</h2><p data-library-continue-copy>创建或导入一本小说，下一次打开时可以从这里继续。</p><div class="continue-actions"><button class="button primary" data-library-action="create-or-open">' + icon('pen-line') + '创建第一本小说</button><button class="button" data-library-action="knowledge">查看设定集</button></div></article><article class="panel task-panel"><h3>最近任务</h3><div data-library-task-list></div></article></section>' +
      '<section class="grid grid-4" style="margin-top:14px"><div class="metric"><div class="metric-label" data-library-metric-label="novels">作品总数</div><div class="metric-value" data-library-metric="novels">0</div><div class="metric-foot" data-library-metric-foot="novels">当前账户作品</div></div><div class="metric"><div class="metric-label" data-library-metric-label="words">正文总字数</div><div class="metric-value" data-library-metric="words">0</div><div class="metric-foot" data-library-metric-foot="words">按当前账户作品统计</div></div><div class="metric"><div class="metric-label" data-library-metric-label="chapters">章节总数</div><div class="metric-value" data-library-metric="chapters">0</div><div class="metric-foot" data-library-metric-foot="chapters">已有正文或章节结构</div></div><div class="metric"><div class="metric-label" data-library-metric-label="entities">设定实体</div><div class="metric-value" data-library-metric="entities">0</div><div class="metric-foot" data-library-metric-foot="entities">来自本地已加载知识库</div></div></section>' +
      '<section class="grid grid-2" style="margin-top:14px"><article class="panel"><div class="panel-heading"><div><h2>快速开始</h2><p>把常用动作放在创作入口附近</p></div></div><div class="panel-body grid grid-2"><button class="quick-action" data-library-action="create"><span class="icon-wrap">' + icon('plus') + '</span><span><strong>新建小说</strong><span>从标题、简介和类型开始</span></span></button><button class="quick-action" data-library-action="dissect"><span class="icon-wrap">' + icon('scan-text') + '</span><span><strong>拆解样文</strong><span>提取可复用的写作规律</span></span></button><button class="quick-action" data-library-action="knowledge"><span class="icon-wrap">' + icon('network') + '</span><span><strong>整理设定</strong><span>查看当前作品知识库</span></span></button><button class="quick-action" data-library-action="skills"><span class="icon-wrap">' + icon('sparkles') + '</span><span><strong>浏览 Skill</strong><span>选择适合当前作品的写作方法</span></span></button></div></article><article class="panel"><div class="panel-heading"><div><h2>最近编辑</h2><p>从上次停留位置继续</p></div><button class="icon-button" aria-label="查看全部小说" data-library-action="novels">' + icon('arrow-up-right') + '</button></div><div class="panel-body" style="padding-top:4px"><table class="recent-table"><thead><tr><th>作品</th><th>章节</th><th>更新时间</th></tr></thead><tbody data-library-recent-list></tbody></table></div></article></section>' +
      '<div style="margin-top:14px">' + syncNote() + '</div>', 'overview-page');
  }

  function renderNovels() {
    return pageShell('我的小说', '集中管理当前账户的本地草稿与云端作品，打开后继续编辑正文。',
      '<div class="search-box">' + icon('search') + '<input id="librarySearch" data-library-search placeholder="搜索标题、简介或类型" value="' + escape(state.query) + '"></div><button class="button" data-library-action="refresh">' + icon('refresh-cw') + '刷新</button><button class="button primary" data-library-action="create">' + icon('plus') + '新建小说</button>',
      '<div class="library-layout" data-library-root="novels"><section class="panel"><div class="panel-heading"><div><h2>作品库</h2><p id="libraryMeta">正在读取作品</p>' + libraryControls() + '</div><div class="segmented" role="group" aria-label="作品视图"><button class="segment ' + (state.view === 'list' ? 'active' : '') + '" data-library-control="view" data-value="list" aria-pressed="' + (state.view === 'list') + '">列表</button><button class="segment ' + (state.view === 'grid' ? 'active' : '') + '" data-library-control="view" data-value="grid" aria-pressed="' + (state.view === 'grid') + '">网格</button></div></div><div class="novel-list ' + (state.view === 'grid' ? 'grid-view' : '') + '" id="novelList" data-library-list></div></section><aside class="panel side-summary"><div class="panel-heading"><div><h2>作品统计</h2><p>所有作品的整体进度</p></div></div><div class="panel-body"><div class="summary-number" data-library-summary-value>0</div><div class="summary-label" data-library-summary-label>总字数</div><div class="mini-bar"><span data-library-summary-bar style="width:0%"></span></div><div class="mini-list"><div class="mini-list-row"><span>作品数量</span><strong data-library-summary="novels">0</strong></div><div class="mini-list-row"><span>有正文作品</span><strong data-library-summary="writing">0</strong></div><div class="mini-list-row"><span>草稿作品</span><strong data-library-summary="draft">0</strong></div><div class="mini-list-row"><span>待同步作品</span><strong data-library-summary="pending">0</strong></div></div><div class="divider"></div><button class="button" style="width:100%" data-library-action="resources">' + icon('upload') + '导入已有小说</button></div></aside></div><div style="margin-top:14px">' + syncNote() + '</div>', 'novels-page');
  }

  function setText(selector, value) {
    var node = document.querySelector(selector);
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  }

  function taskStatus(value) {
    var raw = String(value || '').toLowerCase();
    return { completed: '已完成', complete: '已完成', done: '已完成', running: '进行中', streaming: '生成中', queued: '排队中', pending: '等待中', failed: '失败', error: '失败', cancelled: '已取消', canceled: '已取消', credit_exhausted: '积分不足', interrupted: '已中断' }[raw] || (value ? String(value) : '已记录');
  }

  function taskBadge(value) {
    var raw = String(value || '').toLowerCase();
    return raw === 'completed' || raw === 'complete' || raw === 'done' ? 'green' : raw === 'failed' || raw === 'error' || raw === 'credit_exhausted' ? 'danger' : raw === 'cancelled' || raw === 'canceled' ? 'gray' : 'amber';
  }

  function taskIcon(value) {
    var raw = String(value || '').toLowerCase();
    if (raw.indexOf('dissect') >= 0 || raw.indexOf('extract') >= 0 || raw.indexOf('import') >= 0) return 'scan-text';
    if (raw.indexOf('human') >= 0 || raw.indexOf('polish') >= 0 || raw.indexOf('rewrite') >= 0) return 'wand-sparkles';
    return 'sparkles';
  }

  function collectTasks() {
    var tasks = [];
    (Array.isArray(backendState.tasks) ? backendState.tasks : []).forEach(function (task) {
      tasks.push({ id: String(task.id || 'task-' + tasks.length), title: task.title || task.sourceName || '拆书任务', stage: task.stage || task.type || 'dissect', status: task.status, progress: number(task.progress), credits: number(task.actualCredits || task.estimatedCredits), time: updatedOf(task.updatedAt || task.createdAt), meta: task.sourceName || '当前账户任务' });
    });
    (Array.isArray(backendState.usage && backendState.usage.recent) ? backendState.usage.recent : []).forEach(function (row, index) {
      tasks.push({ id: String(row.requestId || row.id || 'usage-' + index), title: row.label || row.action || row.stage || row.modelId || 'AI 调用', stage: row.stage || 'writing', status: row.status || 'completed', progress: 100, credits: number(row.creditCost), time: updatedOf(row.createdAt || row.updatedAt), meta: row.totalTokens == null ? 'Token 待结算' : number(row.totalTokens).toLocaleString('zh-CN') + ' Token' });
    });
    state.items.forEach(function (item) {
      var source = item.local;
      if (!source) return;
      (Array.isArray(source.aiTasks) ? source.aiTasks : []).slice(-4).forEach(function (task, index) {
        tasks.push({ id: String(task.id || 'local-' + item.id + '-' + index), title: task.title || task.type || 'AI 创作任务', stage: task.type || task.stage || 'writing', status: task.status || 'completed', progress: number(task.progress), credits: number(task.actualCredits || task.creditCost), time: updatedOf(task.updatedAt || task.createdAt || source.updatedAt), meta: item.title });
      });
      (Array.isArray(source.aiCallLog) ? source.aiCallLog : []).slice(-3).forEach(function (call, index) {
        tasks.push({ id: String(call.requestId || 'local-call-' + item.id + '-' + index), title: call.label || call.action || 'AI 调用', stage: call.stage || 'writing', status: call.status || 'completed', progress: 100, credits: number(call.creditCost), time: updatedOf(call.t || call.createdAt || source.updatedAt), meta: item.title });
      });
    });
    var seen = {};
    return tasks.filter(function (task) {
      if (seen[task.id]) return false;
      seen[task.id] = true;
      return true;
    }).sort(function (a, b) { return b.time - a.time; }).slice(0, 5);
  }

  function taskMarkup(tasks) {
    if (state.refreshing && !tasks.length) return '<div class="empty" data-library-empty><div class="empty-icon">…</div><p>正在读取当前账户任务。</p></div>';
    if (!tasks.length) return emptyMarkup(backendState.token ? '还没有最近任务' : '登录后显示真实任务', backendState.token ? '开始一次创作、拆书或 AI 工具任务后，状态会显示在这里。' : '登录后，作品和 AI 任务会绑定到当前账户。');
    return tasks.map(function (task) {
      var meta = task.meta + (task.progress > 0 && task.progress < 100 ? ' · ' + task.progress + '%' : '') + (task.credits ? ' · ' + task.credits.toLocaleString('zh-CN') + ' 积分' : '');
      return '<div class="task-row" data-library-task="' + escape(task.id) + '"><span class="task-icon">' + icon(taskIcon(task.stage)) + '</span><div class="task-copy"><div class="task-title">' + escape(task.title) + '</div><div class="task-meta">' + escape(meta) + ' · ' + escape(dateLabel(task.time)) + '</div></div><span class="badge ' + taskBadge(task.status) + '">' + escape(taskStatus(task.status)) + '</span></div>';
    }).join('');
  }

  function overviewData() {
    mergeItems();
    var items = state.items;
    var primaryId = currentNovelId();
    var primary = items.filter(function (item) { return item.id === primaryId; })[0] || items[0];
    var totalWords = items.reduce(function (sum, item) { return sum + item.words; }, 0);
    var totalChapters = items.reduce(function (sum, item) { return sum + item.chapters; }, 0);
    var totalEntities = items.reduce(function (sum, item) { return sum + item.entities; }, 0);
    var tasks = collectTasks();
    var title = backendState.user && (backendState.user.name || backendState.user.email) ? '欢迎回来，' + (backendState.user.name || backendState.user.email) : '你的创作工作台';
    setText('[data-library-continue-title]', primary ? primary.title : '还没有作品');
    setText('[data-library-continue-copy]', primary ? ((primary.currentChapter || '未开始章节') + ' · ' + primary.words.toLocaleString('zh-CN') + ' 字 · 最近编辑 ' + dateLabel(primary.updatedAt) + '。打开作品继续编辑正文和设定。') : '创建或导入一本小说，下一次打开时可以从这里继续。');
    setText('[data-library-metric="novels"]', items.length.toLocaleString('zh-CN'));
    setText('[data-library-metric="words"]', totalWords.toLocaleString('zh-CN'));
    setText('[data-library-metric="chapters"]', totalChapters.toLocaleString('zh-CN'));
    setText('[data-library-metric="entities"]', totalEntities.toLocaleString('zh-CN'));
    setText('[data-library-metric-label="novels"]', '作品总数');
    setText('[data-library-metric-label="words"]', '正文总字数');
    setText('[data-library-metric-label="chapters"]', '章节总数');
    setText('[data-library-metric-label="entities"]', '设定实体');
    setText('[data-library-metric-foot="novels"]', items.length ? '来自当前账户' : '等待创建作品');
    setText('[data-library-metric-foot="words"]', totalWords ? '本地与云端作品合计' : '当前还没有正文');
    setText('[data-library-metric-foot="chapters"]', totalChapters ? '已有章节结构' : '当前还没有章节');
    setText('[data-library-metric-foot="entities"]', totalEntities ? '来自已加载知识库' : '当前还没有已保存设定');

    var continueButton = document.querySelector('[data-library-action="create-or-open"]');
    if (continueButton) {
      continueButton.dataset.libraryAction = primary ? 'open' : 'create';
      if (primary) continueButton.dataset.libraryId = primary.id; else delete continueButton.dataset.libraryId;
      continueButton.innerHTML = icon(primary ? 'pen-line' : 'plus') + (primary ? '继续编辑' : '创建第一本小说');
    }
    var taskPanel = document.querySelector('.task-panel');
    if (taskPanel) {
      var taskList = taskPanel.querySelector('[data-library-task-list]');
      var taskHtml = '<h3>最近任务</h3><div data-library-task-list>' + taskMarkup(tasks) + '</div>';
      if (taskPanel.innerHTML !== taskHtml) {
        writingDom = true;
        taskPanel.innerHTML = taskHtml;
        if (observer) observer.takeRecords();
        writingDom = false;
      }
    }
    var recent = document.querySelector('[data-library-recent-list]');
    if (recent) {
      var recentItems = items.slice(0, 5);
      var recentHtml = recentItems.length ? recentItems.map(function (item) {
        return '<tr data-library-novel="' + escape(item.id) + '"><td><button class="button" style="border:0;padding:0;min-height:0;background:transparent;font-weight:600" data-library-action="open" data-library-id="' + escape(item.id) + '">' + escape(item.title) + '</button></td><td>' + escape(item.currentChapter || (item.chapters ? item.chapters + ' 章' : '未开始')) + '</td><td>' + escape(dateLabel(item.updatedAt)) + '</td></tr>';
      }).join('') : '<tr data-library-empty><td colspan="3">还没有最近编辑</td></tr>';
      if (recent.innerHTML !== recentHtml) {
        writingDom = true;
        recent.innerHTML = recentHtml;
        if (observer) observer.takeRecords();
        writingDom = false;
      }
    }
    var root = document.querySelector('[data-library-root="overview"]');
    var note = root && root.parentElement && root.parentElement.querySelector('[data-library-sync-note]');
    if (note) {
      var nextNote = syncNote();
      if (note.outerHTML !== nextNote) {
        writingDom = true;
        note.outerHTML = nextNote;
        if (observer) observer.takeRecords();
        writingDom = false;
      }
    }
    mountIcons();
    return title;
  }

  function renderNovelSummary() {
    var totalWords = state.items.reduce(function (sum, item) { return sum + item.words; }, 0);
    var bodyCount = state.items.filter(function (item) { return item.words > 0; }).length;
    var pendingCount = state.items.filter(function (item) { return item.pendingSync || item.localOnly; }).length;
    setText('[data-library-summary-value]', totalWords.toLocaleString('zh-CN'));
    setText('[data-library-summary-label]', '总字数');
    setText('[data-library-summary="novels"]', state.items.length);
    setText('[data-library-summary="writing"]', bodyCount);
    setText('[data-library-summary="draft"]', Math.max(0, state.items.length - bodyCount));
    setText('[data-library-summary="pending"]', pendingCount);
    var bar = document.querySelector('[data-library-summary-bar]');
    if (bar) bar.style.width = state.items.length ? Math.round(bodyCount / state.items.length * 100) + '%' : '0%';
  }

  function renderNovelResults() {
    mergeItems();
    var list = document.querySelector('[data-library-list]');
    if (!list) return;
    var result = filteredItems();
    var message = '';
    if (state.refreshing && !state.items.length) message = emptyMarkup('正在读取作品', '正在同步当前账户的云端作品。');
    else if (backendState.novelsError && !state.items.length) message = emptyMarkup('作品数据读取失败', backendState.novelsError, 'refresh', '重新读取');
    else if (!result.length) message = emptyMarkup(state.items.length ? '没有匹配的小说' : '还没有作品', state.items.length ? '换一个关键词或筛选条件试试。' : '创建第一本小说，开始建立自己的创作空间。', 'create', '创建小说');
    var html = message || grouped(result).map(function (group) {
      return (group.title ? '<div class="section-note" style="padding:14px 13px 4px;font-weight:600">' + escape(group.title) + ' · ' + group.items.length + '</div>' : '') + group.items.map(function (item) { return itemCard(item, state.items.indexOf(item)); }).join('');
    }).join('');
    if (list.innerHTML !== html) {
      writingDom = true;
      list.innerHTML = html;
      if (observer) observer.takeRecords();
      writingDom = false;
    }
    list.classList.toggle('grid-view', state.view === 'grid');
    var meta = document.getElementById('libraryMeta');
    if (meta) meta.textContent = result.length + ' / ' + state.items.length + ' 本作品 · ' + (state.sort === 'updated' ? '最近编辑优先' : '已按当前条件排序');
    document.querySelectorAll('[data-library-control]').forEach(function (control) {
      if (control.dataset.libraryControl === 'view') {
        var active = control.dataset.value === state.view;
        control.classList.toggle('active', active);
        control.setAttribute('aria-pressed', String(active));
      } else if (control.dataset.libraryControl === 'status') control.value = state.status;
      else if (control.dataset.libraryControl === 'sort') control.value = state.sort;
      else if (control.dataset.libraryControl === 'group') control.value = state.group;
    });
    renderNovelSummary();
    var root = document.querySelector('[data-library-root="novels"]');
    var note = root && root.parentElement && root.parentElement.querySelector('[data-library-sync-note]');
    if (note) {
      var nextNote = syncNote();
      if (note.outerHTML !== nextNote) {
        writingDom = true;
        note.outerHTML = nextNote;
        if (observer) observer.takeRecords();
        writingDom = false;
      }
    }
    mountIcons();
  }

  function renderActiveData() {
    if (pageName() === 'overview' && document.querySelector('[data-library-root="overview"]')) overviewData();
    if (pageName() === 'novels' && document.querySelector('[data-library-root="novels"]')) renderNovelResults();
  }

  function scheduleReconcile() {
    if (reconcileQueued) return;
    reconcileQueued = true;
    window.setTimeout(function () {
      reconcileQueued = false;
      if (writingDom) return;
      renderActiveData();
    }, 0);
  }

  function observeStage() {
    if (!stage || typeof MutationObserver !== 'function' || observer) return;
    observer = new MutationObserver(function () {
      if (!writingDom) scheduleReconcile();
    });
    // Only reconcile when renderPage replaces the page root. The library's own
    // list/text/icon updates must not trigger another full render cycle.
    observer.observe(stage, { childList: true });
  }

  function stateBody(novelState) {
    var chapters = chaptersOf(novelState);
    var current = chapters.filter(function (item) { return item.chapter.id === novelState.currentChapterId; })[0] || chapters[0];
    if (!current) return '';
    var scenes = Array.isArray(current.chapter.scenes) ? current.chapter.scenes : [];
    var scene = scenes.filter(function (item) { return item && item.id === novelState.currentSceneId; })[0] || scenes[0];
    return scene && typeof scene.content === 'string' ? scene.content : scenes.map(function (item) { return item && item.content || ''; }).join('');
  }

  function setPreview(id, novelState, revision, localId) {
    var source = clone(novelState) || {};
    var book = source.outline && source.outline.book || {};
    previewState.novelId = String(id || '');
    previewState._libraryLocalId = String(localId || '');
    previewState.novelRevision = Number.isInteger(Number(revision)) ? Number(revision) : null;
    previewState.novel = { title: String(source.title || book.title || '未命名小说'), intro: descriptionOf(source), type: typeOf(source) };
    previewState.novelState = source;
    previewState.editorBody = stateBody(source);
    previewState.editorChat = null;
    previewState.editorChatSessionId = '';
    previewState.editorSkillId = '';
    previewState.editorHistory = null;
    previewState._libraryAccountKey = currentAccountKey();
    setCurrentNovel(localId || id);
  }

  function validServerId(id) { return /^n_[A-Za-z0-9]{1,30}$/.test(String(id || '')); }

  async function openItem(item) {
    if (!item || state.busy) return;
    state.busy = true;
    var requestKey = sessionKey();
    try {
      if (item.useLocal && item.local) {
        setPreview(item.id, item.local, item.remote && item.remote.revision, item.id);
        renderPage('editor');
        showToast(item.localOnly ? '已打开本地草稿' : item.pendingSync ? '已打开本地待同步版本' : '已打开作品');
        return;
      }
      if (!backendState.token || !item.remote) {
        showToast('请先登录后打开云端作品');
        renderPage('login');
        return;
      }
      var data = await backendRequest('/api/novels/' + encodeURIComponent(item.id));
      if (!isCurrentSession(requestKey)) return;
      var novel = data && data.novel;
      if (!novel || !novel.state) throw new Error('作品正文数据为空');
      setPreview(novel.id, novel.state, novel.revision, '');
      renderPage('editor');
    } catch (error) {
      showToast(error.message || '打开作品失败');
    } finally {
      state.busy = false;
    }
  }

  function ensureEditorItem() {
    if (pageName() !== 'editor') return;
    try {
      if (previewState.novelId || previewState.novelState || previewState._libraryLocalId) return;
    } catch (_) { return; }
    mergeItems();
    if (state.items.length) void openItem(state.items[0]);
  }

  function createState(title, intro, type) {
    var chapterId = 'c_' + Date.now().toString(36);
    var sceneId = 's_' + Math.random().toString(36).slice(2, 8);
    return {
      _formatVersion: 3,
      title: title,
      description: intro,
      updatedAt: Date.now(),
      currentChapterId: chapterId,
      currentSceneId: sceneId,
      outline: { book: { title: title, oneLine: intro, themes: type ? [type] : [] }, chapters: [{ num: '第1章', status: 'todo', title: '第1章', synopsis: '', wordCount: 0 }] },
      volumes: [{ id: 'v1', title: '第一卷', chapters: [{ id: chapterId, title: '第1章', scenes: [{ id: sceneId, name: '正文', content: '' }] }] }],
      knowledge: { entities: {}, edges: [], version: 1 },
      aiTasks: [],
      aiCallLog: [],
      foreshadows: [],
      referenceMaterials: [],
      workspace: { outline: [], knowledge: [], resources: [] },
      chapterContracts: {},
      generationRuns: []
    };
  }

  function localId() { return 'n_local_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function openCreateModal() {
    openActionModal({
      title: '创建小说',
      body: '<div class="form-grid"><div class="field"><label for="libraryCreateTitle">小说标题</label><input id="libraryCreateTitle" placeholder="请输入小说标题"></div><div class="field"><label for="libraryCreateType">类型</label><select id="libraryCreateType"><option>玄幻</option><option>都市</option><option>悬疑</option><option>科幻</option></select></div><div class="field"><label for="libraryCreateIntro">一句话简介</label><textarea id="libraryCreateIntro" placeholder="写下主角、目标和最大的冲突"></textarea></div></div>',
      confirmText: '创建并进入编辑器',
      cancelText: '取消',
      onConfirm: async function () {
        var titleNode = document.getElementById('libraryCreateTitle');
        var introNode = document.getElementById('libraryCreateIntro');
        var typeNode = document.getElementById('libraryCreateType');
        var title = titleNode && titleNode.value.trim();
        var intro = introNode && introNode.value.trim() || '';
        var type = typeNode && typeNode.value || '玄幻';
        if (!title) { showToast('请先填写小说标题'); if (titleNode) titleNode.focus(); return false; }
        if (state.busy) return false;
         state.busy = true;
         closeModal();
         var novelState = createState(title, intro, type);
         var id = localId();
         var requestKey = sessionKey();
         setPreview(id, novelState, null, id);
         try {
           if (backendState.token) {
             var data = await backendRequest('/api/novels', { method: 'POST', body: { state: novelState, title: title } });
             if (!isCurrentSession(requestKey)) return;
             var remoteId = String(data && data.id || id);
            previewState.novelId = remoteId;
            previewState._libraryLocalId = '';
            previewState.novelRevision = Number.isInteger(Number(data && data.revision)) ? Number(data.revision) : null;
            setCurrentNovel(remoteId);
            await refreshData(false);
            renderPage('editor');
            showToast('已创建《' + title + '》并保存到云端');
           } else {
            var map = readLocalMap();
            map[id] = novelState;
            writeLocalMap(map);
            try { localStorage.setItem('molan_guest_novel_state', JSON.stringify({ id: id, novel: { title: title, intro: intro, type: type }, state: novelState })); } catch (_) {}
            renderPage('editor');
            showToast('已创建《' + title + '》本地草稿');
           }
         } catch (error) {
           if (!isCurrentSession(requestKey)) return;
          var fallback = readLocalMap();
          fallback[id] = novelState;
          writeLocalMap(fallback);
          if (!backendState.token) {
            try { localStorage.setItem('molan_guest_novel_state', JSON.stringify({ id: id, novel: { title: title, intro: intro, type: type }, state: novelState })); } catch (_) {}
          }
          previewState._libraryLocalId = id;
          previewState.novelId = id;
          renderPage('editor');
          showToast('云端创建失败，已保留本地草稿：' + (error.message || '请求失败'));
        } finally {
          state.busy = false;
        }
      }
    });
    window.setTimeout(function () { document.getElementById('libraryCreateTitle')?.focus(); }, 0);
  }

  function localStateForItem(item) {
    return item && item.local ? clone(item.local) : null;
  }

  async function stateForRename(item) {
    if (item.useLocal && item.local) return { state: localStateForItem(item), revision: item.remote && item.remote.revision };
    if (!item.remote || !backendState.token) throw new Error('请先登录后编辑云端作品');
    var data = await backendRequest('/api/novels/' + encodeURIComponent(item.id));
    if (!data.novel || !data.novel.state) throw new Error('作品正文数据为空');
    return { state: clone(data.novel.state), revision: data.novel.revision };
  }

  function updateStateTitle(novelState, title, description) {
    var source = novelState || {};
    source.title = title;
    source.description = description;
    source.updatedAt = Date.now();
    source.outline = source.outline || {};
    source.outline.book = source.outline.book || {};
    source.outline.book.title = title;
    source.outline.book.oneLine = description;
    return source;
  }

  function openRenameModal(item) {
    openActionModal({
      title: '编辑作品信息',
      body: '<div class="form-grid"><div class="field"><label for="libraryRenameTitle">小说标题</label><input id="libraryRenameTitle" value="' + escape(item.title) + '"></div><div class="field"><label for="libraryRenameIntro">一句话简介</label><textarea id="libraryRenameIntro" placeholder="补充作品简介">' + escape(item.description) + '</textarea></div></div>',
      confirmText: '保存更改',
      cancelText: '取消',
      onConfirm: async function () {
        var titleNode = document.getElementById('libraryRenameTitle');
        var introNode = document.getElementById('libraryRenameIntro');
        var title = titleNode && titleNode.value.trim();
        var description = introNode && introNode.value.trim() || '';
        if (!title) { showToast('请输入小说标题'); if (titleNode) titleNode.focus(); return false; }
        if (state.busy) return false;
         state.busy = true;
         var requestKey = sessionKey();
         try {
           var result = await stateForRename(item);
           if (!isCurrentSession(requestKey)) return;
          var nextState = updateStateTitle(result.state, title, description);
          var response = null;
           if (backendState.token && item.remote) {
             response = await backendRequest('/api/novels/' + encodeURIComponent(item.id), { method: 'PUT', body: { state: nextState, title: title, revision: Number.isInteger(Number(result.revision)) ? Number(result.revision) : undefined } });
             if (!isCurrentSession(requestKey)) return;
           } else if (backendState.token && validServerId(item.id)) {
             response = await backendRequest('/api/novels', { method: 'POST', body: { id: item.id, state: nextState, title: title } });
             if (!isCurrentSession(requestKey)) return;
           }
          var map = readLocalMap();
          if (response && response.updatedAt) nextState.updatedAt = response.updatedAt;
          map[item.id] = nextState;
          writeLocalMap(map);
          if (response && response.id && response.id !== item.id) {
            map[response.id] = map[item.id];
            delete map[item.id];
            writeLocalMap(map);
            setCurrentNovel(response.id);
          }
          closeModal();
          await refreshData(false);
          showToast('作品信息已保存');
        } catch (error) {
          showToast(error.message || '作品信息保存失败');
        } finally {
          state.busy = false;
        }
      }
    });
    window.setTimeout(function () { document.getElementById('libraryRenameTitle')?.focus(); }, 0);
  }

  async function deleteItem(item) {
    if (!item || state.busy) return;
    openActionModal({
      title: '删除作品',
      body: '<div class="notice">' + icon('triangle-alert') + '<span>确定删除《' + escape(item.title) + '》吗？云端作品删除后不可恢复，本地待同步草稿也会从当前浏览器移除。</span></div>',
      confirmText: '确认删除',
      cancelText: '取消',
      onConfirm: async function () {
        if (state.busy) return false;
         state.busy = true;
         var requestKey = sessionKey();
         try {
           if (item.remote && backendState.token) await backendRequest('/api/novels/' + encodeURIComponent(item.id), { method: 'DELETE' });
           if (!isCurrentSession(requestKey)) return;
          if (item.remote && Array.isArray(backendState.novels)) {
            backendState.novels = backendState.novels.filter(function (novel) {
              return String(novel && (novel.id || novel.nid) || '') !== String(item.id);
            });
          }
          var map = readLocalMap();
          delete map[item.id];
          writeLocalMap(map);
          if (identity() === 'guest') {
            try {
              var guest = JSON.parse(localStorage.getItem('molan_guest_novel_state') || 'null');
              if (guest && String(guest.id || '') === item.id) localStorage.removeItem('molan_guest_novel_state');
            } catch (_) {}
          }
          if (currentNovelId() === item.id) {
            try { localStorage.removeItem(localCurrentKey()); } catch (_) {}
          }
          closeModal();
          mergeItems();
          renderPage('novels', { fromHistory: true });
          showToast('已删除《' + item.title + '》');
          if (item.remote && backendState.token) void refreshData(false, true);
        } catch (error) {
          showToast(error.message || '删除失败');
        } finally {
          state.busy = false;
        }
      }
    });
  }

  function scheduleQueuedRefresh() {
    if (!refreshQueued) return;
    refreshQueued = false;
    window.setTimeout(function () { void refreshData(false, true); }, 0);
  }

  async function refreshData(notify, force) {
    var requestKey = sessionKey();
    if (state.refreshing && activeRefreshKey === requestKey) {
      refreshQueued = true;
      return;
    }
    if (state.refreshing && activeRefreshKey !== requestKey) {
      refreshVersion += 1;
      state.refreshing = false;
    }
    var now = Date.now();
    if (!notify && !force && now - lastRefreshAt < 1500) return;
    lastRefreshAt = now;
    var requestVersion = ++refreshVersion;
    activeRefreshKey = requestKey;
    state.refreshing = true;
    renderActiveData();
    if (!backendState.token) {
      backendState.novelsLoaded = true;
      backendState.novelsError = '';
      backendState.tasksLoaded = true;
      state.refreshing = false;
      renderPage(pageName(), { fromHistory: true });
      if (notify) showToast('已刷新本地作品');
      scheduleQueuedRefresh();
      return;
    }
    try {
      var results = await Promise.allSettled([
        backendRequest('/api/novels'),
        backendRequest('/api/dissections'),
        backendRequest('/api/usage?limit=20')
      ]);
      var novelsResult = results[0];
      var tasksResult = results[1];
      var usageResult = results[2];
      if (requestVersion !== refreshVersion || !isCurrentSession(requestKey)) return;
      if (novelsResult.status === 'fulfilled') {
        backendState.novels = Array.isArray(novelsResult.value && novelsResult.value.novels) ? novelsResult.value.novels : [];
        backendState.novelsLoaded = true;
        backendState.novelsError = '';
        if (typeof window !== 'undefined' && typeof window.updateSidebarCounts === 'function') window.updateSidebarCounts();
      } else {
        backendState.novelsLoaded = true;
        backendState.novelsError = novelsResult.reason && novelsResult.reason.message || '作品数据读取失败';
      }
      if (tasksResult.status === 'fulfilled') {
        backendState.tasks = Array.isArray(tasksResult.value && tasksResult.value.tasks) ? tasksResult.value.tasks : [];
        backendState.tasksLoaded = true;
        backendState.tasksError = '';
      } else {
        backendState.tasksLoaded = true;
        backendState.tasksError = tasksResult.reason && tasksResult.reason.message || '任务数据读取失败';
      }
      if (usageResult.status === 'fulfilled') backendState.usage = usageResult.value && usageResult.value.usage || null;
      else backendState.usage = null;
      if (notify) showToast('作品、任务和使用记录已刷新');
    } finally {
      if (requestVersion === refreshVersion && isCurrentSession(requestKey)) {
        state.refreshing = false;
        activeRefreshKey = '';
        renderPage(pageName(), { fromHistory: true });
        scheduleQueuedRefresh();
      }
    }
  }

  function activeLocalItem() {
    if (previewState && previewState._libraryAccountKey && previewState._libraryAccountKey !== currentAccountKey()) return null;
    var id = String(previewState && previewState._libraryLocalId || '');
    if (!id) return null;
    mergeItems();
    return state.items.filter(function (item) { return item.id === id; })[0] || { id: id, local: previewState.novelState };
  }

  function persistActiveLocalDraft() {
    var item = activeLocalItem();
    if (!item) return false;
    var source = clone(previewState.novelState) || createState(previewState.novel && previewState.novel.title || '未命名小说', previewState.novel && previewState.novel.intro || '', previewState.novel && previewState.novel.type || '玄幻');
    var body = String(previewState.editorBody || '');
    var chapters = chaptersOf(source);
    var current = chapters.filter(function (entry) { return entry.chapter.id === source.currentChapterId; })[0] || chapters[0];
    if (current) {
      var scenes = Array.isArray(current.chapter.scenes) ? current.chapter.scenes : [];
      var scene = scenes.filter(function (entry) { return entry && entry.id === source.currentSceneId; })[0] || scenes[0];
      if (scene) scene.content = body;
    }
    source.updatedAt = Date.now();
    var map = readLocalMap();
    map[item.id] = source;
    if (!writeLocalMap(map)) return false;
    if (!backendState.token || identity() === 'guest') {
      try { localStorage.setItem('molan_guest_novel_state', JSON.stringify({ id: item.id, novel: previewState.novel, state: source })); } catch (_) {}
    }
    previewState.novelState = source;
    previewState._libraryAccountKey = currentAccountKey();
    return true;
  }

  async function saveLocalFromEditor(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!persistActiveLocalDraft()) return;
    showToast('本地草稿已保存');
  }

  function onInput(event) {
    if (pageName() !== 'editor' || !previewState._libraryLocalId) return;
    if (!event.target.closest || !event.target.closest('.editor-paper')) return;
    window.clearTimeout(localSaveTimer);
    localSaveTimer = window.setTimeout(function () { persistActiveLocalDraft(); }, 260);
  }

  function onClick(event) {
    var saveButton = event.target.closest && event.target.closest('[data-backend-save]');
    if (saveButton && previewState._libraryLocalId) {
      void saveLocalFromEditor(event);
      return;
    }
    var node = event.target.closest && event.target.closest('[data-library-action]');
    if (!node) return;
    event.preventDefault();
    var action = node.dataset.libraryAction;
    var id = node.dataset.libraryId;
    if (action === 'create' || action === 'create-or-open' && !id) return openCreateModal();
    if (action === 'open' || action === 'create-or-open') return void openItem(state.items.filter(function (item) { return item.id === id; })[0]);
    if (action === 'rename') return openRenameModal(state.items.filter(function (item) { return item.id === id; })[0]);
    if (action === 'delete') return void deleteItem(state.items.filter(function (item) { return item.id === id; })[0]);
    if (action === 'refresh') return void refreshData(true);
    if (action === 'novels') return renderPage('novels');
    if (action === 'resources') return renderPage('resources');
    if (action === 'knowledge') return renderPage('knowledge');
    if (action === 'skills') return renderPage('skills');
    if (action === 'dissect') return renderPage('dissect');
  }

  function onInputControl(event) {
    var search = event.target.closest && event.target.closest('[data-library-search]');
    if (search) {
      state.query = search.value || '';
      renderNovelResults();
    }
  }

  function onChange(event) {
    var control = event.target.closest && event.target.closest('[data-library-control]');
    if (!control) return;
    var kind = control.dataset.libraryControl;
    if (kind === 'view') {
      state.view = control.dataset.value === 'grid' ? 'grid' : 'list';
      try { localStorage.setItem(VIEW_KEY, state.view); } catch (_) {}
    } else if (kind === 'status') state.status = control.value || 'all';
    else if (kind === 'sort') state.sort = control.value || 'updated';
    else if (kind === 'group') state.group = control.value || 'none';
    renderNovelResults();
  }

  function onStorage(event) {
    if (!event.key || event.key === 'ml_token' || event.key === 'ml_user' || event.key.indexOf(NOVELS_KEY + ':') === 0 || event.key.indexOf(CURRENT_KEY + ':') === 0) {
      if (pageName() === 'overview' || pageName() === 'novels') void refreshData(false);
    }
  }

  function onPageChanged(event) {
    var page = event && event.detail && event.detail.page;
    if (page === 'editor') return ensureEditorItem();
    if (page === 'overview' || page === 'novels') void refreshData(false);
  }

  function onVisibilityChange() {
    if (!document.hidden && (pageName() === 'overview' || pageName() === 'novels')) void refreshData(false);
  }

  function install() {
    if (installed) return;
    installed = true;
    lastAccountKey = currentAccountKey();
    try { state.view = localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch (_) {}
    renderers.overview = renderOverview;
    renderers.novels = renderNovels;
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInputControl);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('molan:page-changed', onPageChanged);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('molan:auth-changed', function () {
      refreshVersion += 1;
      state.refreshing = false;
      activeRefreshKey = '';
      var previewKey = previewState && previewState._libraryAccountKey;
      var nextAccountKey = currentAccountKey();
      if ((previewKey && previewKey !== nextAccountKey) || (lastAccountKey && lastAccountKey !== nextAccountKey)) {
        previewState.novelId = '';
        previewState.novelState = null;
        previewState.novel = { title: '未命名小说', intro: '', type: '玄幻' };
        previewState.editorBody = '';
        previewState.editorChat = null;
        previewState.editorChatSessionId = '';
        previewState._libraryLocalId = '';
        previewState._libraryAccountKey = nextAccountKey;
      }
      lastAccountKey = nextAccountKey;
      if (pageName() === 'overview' || pageName() === 'novels' || pageName() === 'editor') void refreshData(false, true);
    });
    window.addEventListener('molan:novel-saved', function (event) {
      var detail = event && event.detail || {};
      if (!isCurrentSession(detail.sessionKey || sessionKey())) return;
      var localId = String(detail.localId || '');
      var remoteId = String(detail.remoteId || '');
      if (localId && remoteId && localId !== remoteId) {
        var map = readLocalMap();
        delete map[localId];
        writeLocalMap(map);
        if (currentNovelId() === localId) setCurrentNovel(remoteId);
      } else if (localId && !remoteId && previewState && previewState._libraryLocalId === localId) {
        persistActiveLocalDraft();
      }
      if (pageName() === 'overview' || pageName() === 'novels') void refreshData(false, true);
    });
    window.addEventListener('molan:tasks-updated', function () { if (pageName() === 'overview' || pageName() === 'novels') renderActiveData(); });
    observeStage();
    renderPage(pageName(), { fromHistory: true });
    ensureEditorItem();
    scheduleReconcile();
    // 初始加载走稳健的数据拉取路径（规避 bootstrapBackend 在脚本解析期的竞态），
    // 确保刷新页面后云端小说列表能正确加载。
    if (backendState && backendState.token) void refreshData(false, true);
  }

  window.MolanCompletionLibrary = { install: install };
}());
