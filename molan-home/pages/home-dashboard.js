(function () {
  'use strict';

  var API_BASE = location.protocol === 'file:' || location.protocol === 'about:' ? 'http://localhost:3000' : '';
  var NOVEL_KEY = 'molan_editor_novels';
  var mounted = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function user() {
    try { return JSON.parse(localStorage.getItem('ml_user') || 'null') || null; } catch (_) { return null; }
  }

  function storageKey() {
    var current = user();
    var identity = current && (current.userId || current.id || current.email) ? (current.userId || current.id || current.email) : 'guest';
    return NOVEL_KEY + ':' + encodeURIComponent(String(identity).trim().toLowerCase());
  }

  function readLocalNovels() {
    try {
      var parsed = JSON.parse(localStorage.getItem(storageKey()) || '{}');
      if (Array.isArray(parsed)) return parsed.map(function (item, index) { return { id: item.id || String(index), state: item }; });
      return Object.keys(parsed || {}).map(function (id) { return { id: id, state: parsed[id] || {} }; });
    } catch (_) { return []; }
  }

  function token() {
    try { return localStorage.getItem('ml_token') || ''; } catch (_) { return ''; }
  }

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatNumber(value) {
    return number(value).toLocaleString('zh-CN');
  }

  function formatDate(value) {
    var date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }

  function wordCount(state) {
    if (!state) return 0;
    if (number(state.wordCount)) return number(state.wordCount);
    var total = 0;
    (state.volumes || []).forEach(function (volume) {
      (volume.chapters || []).forEach(function (chapter) {
        (chapter.scenes || []).forEach(function (scene) {
          total += String(scene.content || '').replace(/<[^>]+>/g, '').replace(/\s/g, '').length;
        });
      });
    });
    return total;
  }

  function chapters(state) {
    var result = [];
    (state && state.volumes || []).forEach(function (volume) {
      (volume.chapters || []).forEach(function (chapter) {
        result.push({
          id: chapter.id,
          title: chapter.title || '未命名章节',
          scenes: chapter.scenes || [],
          volume: volume.title || '第一卷'
        });
      });
    });
    return result;
  }

  function normalizeLocal(item) {
    var state = item.state || {};
    var list = chapters(state);
    var current = list.find(function (chapter) { return chapter.id === state.currentChapterId; }) || list[list.length - 1];
    var updated = state.updatedAt || (state.history && state.history[0] && state.history[0].t) || 0;
    return {
      id: item.id,
      title: state.title || '未命名小说',
      description: state.description || (state.outline && state.outline.book && state.outline.book.oneLine) || '',
      words: wordCount(state),
      chapters: list.length,
      current: current,
      updatedAt: updated,
      state: state,
      source: 'local'
    };
  }

  function normalizeRemote(item) {
    var state = item && item.state && typeof item.state === 'object' ? item.state : item || {};
    var list = chapters(state);
    return {
      id: String(item && (item.id || item.nid) || state.id || ''),
      title: item && item.title || state.title || '未命名小说',
      description: item && (item.description || item.summary) || state.description || '',
      words: number(item && (item.wordCount || item.words)) || wordCount(state),
      chapters: number(item && item.chapterCount) || list.length,
      current: list[list.length - 1],
      updatedAt: item && (item.updatedAt || item.updated_at) || state.updatedAt || 0,
      state: state,
      source: 'cloud'
    };
  }

  async function readRemoteNovels() {
    var auth = token();
    if (!auth) return [];
    try {
      var response = await fetch(API_BASE + '/api/novels', { headers: { Authorization: 'Bearer ' + auth }, cache: 'no-store' });
      if (!response.ok) return [];
      var data = await response.json();
      var list = Array.isArray(data) ? data : (data.novels || data.items || []);
      return Array.isArray(list) ? list.map(normalizeRemote).filter(function (item) { return item.id; }) : [];
    } catch (_) { return []; }
  }

  function mergeNovels(local, remote) {
    var map = new Map();
    local.forEach(function (item) { map.set(String(item.id), item); });
    remote.forEach(function (item) {
      var current = map.get(String(item.id));
      if (!current) map.set(String(item.id), item);
      else if (number(item.updatedAt) > number(current.updatedAt)) map.set(String(item.id), Object.assign({}, current, item, { state: current.state || item.state }));
    });
    return Array.from(map.values()).sort(function (a, b) { return number(b.updatedAt) - number(a.updatedAt); });
  }

  function taskStatus(value, fallback) {
    var raw = String(value || fallback || '已记录');
    var labels = {
      completed: '已完成', complete: '已完成', done: '已完成',
      failed: '失败', error: '失败', cancelled: '已取消', canceled: '已取消',
      running: '进行中', streaming: '生成中', pending: '等待中', queued: '排队中'
    };
    return labels[raw.toLowerCase()] || raw;
  }

  function taskItems(novels) {
    var items = [];
    novels.forEach(function (novel) {
      var state = novel.state || {};
      (state.aiTasks || []).slice(0, 3).forEach(function (task) {
        items.push({ title: task.title || task.type || 'AI 创作任务', meta: novel.title, status: taskStatus(task.status, '已记录'), time: task.updatedAt || task.createdAt || novel.updatedAt });
      });
      (state.aiCallLog || []).slice(0, 2).forEach(function (call) {
        items.push({ title: call.label || call.action || 'AI 调用', meta: novel.title, status: taskStatus(call.status, '已完成'), time: call.t || call.createdAt || novel.updatedAt });
      });
    });
    return items.sort(function (a, b) { return number(b.time) - number(a.time); }).slice(0, 4);
  }

  function emptyTaskMarkup() {
    return '<div class="molan-task-row"><span class="molan-task-icon">—</span><div class="molan-task-copy"><strong>还没有最近任务</strong><span>开始一次创作后，任务状态会显示在这里</span></div></div>';
  }

  function createMarkup() {
    var node = document.createElement('section');
    node.id = 'molanHomeOverview';
    node.className = 'molan-home-overview';
    node.setAttribute('aria-labelledby', 'molanOverviewTitle');
    node.innerHTML = '<div class="molan-overview-head">' +
      '<div><div class="molan-overview-kicker">WORKSPACE</div><h1 id="molanOverviewTitle">你的创作工作台</h1><p id="molanOverviewSubtitle">从一本作品开始，逐步建立正文、设定与可复用的创作方法。</p></div>' +
      '<div class="molan-overview-head__actions"><a class="molan-overview-btn" href="./pages/novels.html" data-home-action="novels">我的小说</a><a class="molan-overview-btn molan-overview-btn--primary" href="./index.html#editor" data-home-action="new">开始创作</a></div>' +
      '</div>' +
      '<div class="molan-overview-hero">' +
        '<article class="molan-continue-card"><div class="molan-continue-card__copy"><div class="molan-continue-card__kicker" id="molanContinueKicker">RECENT WORK</div><h2 id="molanContinueTitle">还没有作品</h2><p id="molanContinueMeta">创建或导入一本小说，下一次打开时可以从这里继续。</p></div><div class="molan-continue-card__actions"><a href="./index.html#editor" data-home-action="continue" id="molanContinueBtn">继续创作</a><a href="./index.html#editor" data-home-action="import">导入正文</a></div></article>' +
        '<article class="molan-task-panel"><h2>最近任务</h2><div class="molan-task-list" id="molanTaskList">' + emptyTaskMarkup() + '</div></article>' +
      '</div>' +
      '<div class="molan-overview-stats"><article class="molan-stat"><span>作品</span><strong id="molanStatNovels">0</strong><small>本地与云端同步</small></article><article class="molan-stat"><span>正文总字数</span><strong id="molanStatWords">0</strong><small>按当前账户作品统计</small></article><article class="molan-stat"><span>已完成章节</span><strong id="molanStatChapters">0</strong><small>已有正文的章节</small></article><article class="molan-stat"><span>设定实体</span><strong id="molanStatEntities">0</strong><small>来自作品知识库</small></article></div>' +
      '<div class="molan-overview-lower"><article class="molan-section-panel"><div class="molan-section-panel__head"><h2>最近编辑</h2><a href="./pages/novels.html">查看全部</a></div><div id="molanRecentNovels"></div></article><article class="molan-section-panel"><div class="molan-section-panel__head"><h2>快速入口</h2></div><div class="molan-quick-grid"><button class="molan-quick-action" type="button" data-home-action="new"><span class="molan-quick-action__icon">＋</span><span><strong>新建小说</strong><span>从标题、简介和设定开始</span></span></button><button class="molan-quick-action" type="button" data-home-action="dissect"><span class="molan-quick-action__icon">拆</span><span><strong>拆书分析</strong><span>提炼结构、节奏与文风</span></span></button><button class="molan-quick-action" type="button" data-home-action="skills"><span class="molan-quick-action__icon">✦</span><span><strong>开放 Skill</strong><span>查看并复用创作工作流</span></span></button></div></article></div>';
    return node;
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function bindActions() {
    document.querySelectorAll('[data-home-action]').forEach(function (node) {
      if (node._molanHomeBound) return;
      node._molanHomeBound = true;
      node.addEventListener('click', function (event) {
        var action = node.getAttribute('data-home-action');
        if (action === 'new' && document.getElementById('ctaCreate')) {
          event.preventDefault();
          document.getElementById('ctaCreate').click();
          return;
        }
        if (action === 'continue') {
          var currentId = node.dataset.novelId;
          if (currentId) { event.preventDefault(); location.href = './index.html?nid=' + encodeURIComponent(currentId) + '#editor'; }
        }
        if (action === 'dissect') { event.preventDefault(); location.href = './pages/dissect.html'; }
        if (action === 'skills') { event.preventDefault(); location.href = './pages/skills.html'; }
      });
    });
  }

  function render(novels) {
    var primary = novels[0];
    var tasks = taskItems(novels);
    var totalWords = novels.reduce(function (sum, item) { return sum + item.words; }, 0);
    var totalChapters = novels.reduce(function (sum, item) { return sum + item.chapters; }, 0);
    var totalEntities = novels.reduce(function (sum, item) { return sum + Object.keys(item.state && item.state.knowledge && item.state.knowledge.entities || {}).length; }, 0);
    var currentUser = user();
    setText('molanOverviewTitle', currentUser && currentUser.name ? '欢迎回来，' + currentUser.name : '你的创作工作台');
    setText('molanOverviewSubtitle', novels.length ? '从最近编辑的作品继续，把正文、设定和 AI 协作放在同一个工作台里。' : '从一本作品开始，逐步建立正文、设定与可复用的创作方法。');
    setText('molanContinueTitle', primary ? '继续《' + primary.title + '》' : '还没有作品');
    setText('molanContinueMeta', primary ? ((primary.current ? primary.current.title : '未开始章节') + ' · ' + formatNumber(primary.words) + ' 字 · 最近编辑 ' + formatDate(primary.updatedAt)) : '创建或导入一本小说，下一次打开时可以从这里继续。');
    var continueButton = document.getElementById('molanContinueBtn');
    if (continueButton) { continueButton.dataset.novelId = primary ? primary.id : ''; continueButton.textContent = primary ? '继续编辑' : '创建第一本小说'; }
    setText('molanStatNovels', formatNumber(novels.length));
    setText('molanStatWords', formatNumber(totalWords));
    setText('molanStatChapters', formatNumber(totalChapters));
    setText('molanStatEntities', formatNumber(totalEntities));
    var taskList = document.getElementById('molanTaskList');
    if (taskList) taskList.innerHTML = tasks.length ? tasks.map(function (task) { return '<div class="molan-task-row"><span class="molan-task-icon">✦</span><div class="molan-task-copy"><strong>' + escapeHtml(task.title) + '</strong><span>' + escapeHtml(task.meta) + ' · ' + escapeHtml(formatDate(task.time)) + '</span></div><span class="molan-task-status">' + escapeHtml(task.status) + '</span></div>'; }).join('') : emptyTaskMarkup();
    var recent = document.getElementById('molanRecentNovels');
    if (recent) {
      recent.innerHTML = novels.length ? '<table class="molan-recent-table"><thead><tr><th>作品</th><th>章节</th><th>最近编辑</th></tr></thead><tbody>' + novels.slice(0, 5).map(function (item) { return '<tr><td><a href="./index.html?nid=' + encodeURIComponent(item.id) + '#editor">' + escapeHtml(item.title) + '</a></td><td>' + escapeHtml(item.current ? item.current.title : (item.chapters ? item.chapters + ' 章' : '未开始')) + '</td><td>' + escapeHtml(formatDate(item.updatedAt)) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="molan-task-row"><span class="molan-task-icon">—</span><div class="molan-task-copy"><strong>还没有最近编辑</strong><span>创建或导入作品后，会在这里显示</span></div></div>';
    }
    bindActions();
  }

  async function load() {
    var root = document.getElementById('molanHomeOverview');
    if (!root) {
      var legacyHero = document.querySelector('body.molan-home-page > main > section:not(#homeChatSection)');
      if (legacyHero) legacyHero.classList.add('molan-home-legacy-hero');
      var chat = document.getElementById('homeChatSection');
      if (!chat || !chat.parentNode) return;
      root = createMarkup();
      chat.parentNode.insertBefore(root, chat);
      mounted = true;
    }
    var local = readLocalNovels().map(normalizeLocal).filter(function (item) { return item.id; });
    var remote = await readRemoteNovels();
    render(mergeNovels(local, remote));
  }

  function init() {
    document.body.classList.add('molan-home-page');
    load();
    window.addEventListener('molan:auth-changed', load);
    window.addEventListener('storage', function (event) { if (event.key === 'ml_token' || event.key === 'ml_user' || event.key && event.key.indexOf(NOVEL_KEY + ':') === 0) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
