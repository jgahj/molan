(function () {
  'use strict';

  var body = document.body;
  if (!body || body.classList.contains('login-page') || body.classList.contains('admin-login-page') || document.getElementById('adminApp')) return;

  var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var isRoot = file === 'index.html' || file === '';
  var isEditor = file === 'editor.html';
  var pageKey = isRoot ? 'overview' : ({
    'novels.html': 'novels',
    'dissect.html': 'dissect',
    'skills.html': 'skills',
    'tools.html': 'tools',
    'pricing.html': 'billing',
    'docs.html': 'docs',
    'features.html': 'features',
    'blog.html': 'blog',
    'about.html': 'features',
    'contact.html': 'docs'
  }[file] || 'overview');

  var labels = {
    overview: ['创作总览', 'WORKSPACE'],
    novels: ['我的小说', 'LIBRARY'],
    editor: ['小说编辑器', 'EDITOR'],
    resources: ['资源中心', 'RESOURCE CENTER'],
    outline: ['大纲与时间线', 'STORY MAP'],
    dissect: ['拆书分析', 'STYLE LAB'],
    knowledge: ['设定集 / 知识库', 'KNOWLEDGE BASE'],
    skills: ['开放 Skill', 'OPEN SKILL'],
    tools: ['AI 工具', 'AI TOOLS'],
    billing: ['积分与套餐', 'BILLING'],
    docs: ['使用教程', 'DOCUMENTATION'],
    features: ['产品功能', 'PRODUCT'],
    blog: ['创作者手札', 'NOTES']
  };

  var rootHref = isRoot ? './index.html' : '../index.html';
  var route = function (target) {
    if (target === 'overview') return rootHref;
    if (isRoot) return './pages/' + target;
    return './' + target;
  };
  var navItems = [
    { group: '创作工作台', items: [
      ['overview', 'layout-dashboard', '创作总览'],
      ['novels', 'library', '我的小说'],
      ['editor', 'pen-line', '小说编辑器'],
      ['resources', 'folder-open', '资源中心'],
      ['outline', 'milestone', '大纲与时间线'],
      ['dissect', 'scan-text', '拆书分析']
    ]},
    { group: '资源与工具', items: [
      ['knowledge', 'network', '设定集 / 知识库'],
      ['skills', 'sparkles', '开放 Skill'],
      ['tools', 'wand-sparkles', 'AI 工具']
    ]},
    { group: '账户与服务', items: [
      ['billing', 'coins', '积分与套餐'],
      ['docs', 'book-open', '使用教程'],
      ['account', 'settings-2', '账户设置'],
      ['login', 'log-in', '普通用户登录']
    ]},
    { group: '平台内容', items: [
      ['features', 'blocks', '产品功能'],
      ['blog', 'notebook-pen', '创作者手札']
    ]},
    { group: '管理入口', items: [
      ['admin-login', 'shield-check', '管理员登录'],
      ['admin', 'panel-top', '管理后台']
    ]}
  ];

  function icon(name) {
    return '<i data-lucide="' + name + '" class="molan-shell-icon" aria-hidden="true"></i>';
  }

  function readUser() {
    try {
      var value = JSON.parse(localStorage.getItem('ml_user') || 'null');
      return value && value.email ? value : null;
    } catch (_) {
      return null;
    }
  }

  function credits(user) {
    if (!user) return '';
    if (user.isAdmin || user.role === 'admin') return '管理员 · 无限积分';
    var value = Number(user.credits);
    return (user.role === 'vip' ? 'VIP' : '普通用户') + ' · ' + (Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—') + ' 积分';
  }

  function makeHeader() {
    var header = document.createElement('header');
    header.className = 'molan-shell-header';
    header.innerHTML = '<button class="molan-shell-icon-button molan-shell-mobile-menu" type="button" aria-label="打开页面导航" title="打开页面导航">' + icon('menu') + '</button>' +
      '<a class="molan-shell-brand" href="' + rootHref + '" aria-label="返回墨阑首页"><span class="molan-shell-brand-mark">墨</span><span class="molan-shell-brand-name">墨阑</span><span class="molan-shell-brand-label">AI 小说创作</span></a>' +
      '<div class="molan-shell-crumb"><span>创作工作台</span>' + icon('chevron-right') + '<strong>' + (labels[pageKey] ? labels[pageKey][0] : '墨阑') + '</strong></div>' +
      '<div class="molan-shell-actions"><button class="molan-shell-icon-button" type="button" data-shell-notification aria-label="通知" title="通知">' + icon('bell') + '</button>' +
      (pageKey === 'overview' ? '<a class="molan-shell-header-cta" href="' + route('novels') + '">' + icon('plus') + '新建小说</a>' : '') +
      '<button class="molan-shell-icon-button" type="button" data-shell-theme aria-label="切换主题" title="切换主题">' + icon('sun') + '</button><button class="molan-shell-icon-button molan-shell-account" type="button" data-molan-account aria-label="登录" title="登录"></button></div>';
    return header;
  }

  function makeSidebar() {
    var sidebar = document.createElement('aside');
    sidebar.className = 'molan-shell-sidebar';
    sidebar.setAttribute('aria-label', '功能页面导航');
    var html = '<div class="molan-shell-sidebar-scroll">';
    navItems.forEach(function (section) {
      html += '<section class="molan-shell-nav-section"><div class="molan-shell-nav-label">' + section.group + '</div>';
      section.items.forEach(function (item) {
        var key = item[0];
        if (key === 'account') {
          html += '<button class="molan-shell-nav-link" type="button" data-shell-account><span>' + icon(item[1]) + item[2] + '</span></button>';
          return;
        }
        var target = key === 'overview' ? 'index.html' : key === 'editor' ? '../index.html#editor' : key === 'resources' ? '../index.html#resources' : key === 'outline' ? '../index.html#outline' : key === 'knowledge' ? '../index.html#knowledge' : key === 'billing' ? 'pricing.html' : key === 'login' ? 'login.html' : key === 'admin-login' ? 'admin-login.html' : key === 'admin' ? 'admin.html' : key + '.html';
        var href = key === 'overview' ? rootHref : (isRoot ? './pages/' + target : './' + target);
        var active = key === pageKey;
        html += '<a class="molan-shell-nav-link' + (active ? ' is-active' : '') + '" href="' + href + '" data-shell-page="' + key + '"><span>' + icon(item[1]) + item[2] + '</span>' + (key === 'novels' ? '<small data-shell-count="novels"></small>' : '') + (key === 'knowledge' ? '<small data-shell-count="entities"></small>' : '') + (key === 'admin-login' ? '<i class="molan-shell-admin-dot" aria-hidden="true"></i>' : '') + '</a>';
      });
      html += '</section>';
    });
    html += '</div><div class="molan-shell-sidebar-footer"><button class="molan-shell-profile" type="button" data-shell-account><span class="molan-shell-avatar" data-shell-avatar aria-hidden="true"></span><span class="molan-shell-profile-copy"><strong data-shell-user-name>未登录</strong><small data-shell-user-meta>点击登录</small></span>' + icon('more-horizontal') + '</button></div>';
    sidebar.innerHTML = html;
    return sidebar;
  }

  function updateAccount() {
    var user = readUser();
    document.querySelectorAll('[data-shell-account]').forEach(function (node) {
      var avatar = node.querySelector('[data-shell-avatar]');
      if (!avatar && node.classList.contains('molan-shell-account')) avatar = node;
      if (node.classList.contains('molan-shell-account')) {
        node.replaceChildren();
        avatar = document.createElement('span');
        avatar.className = 'molan-shell-avatar';
        node.appendChild(avatar);
      }
      if (avatar) {
        avatar.replaceChildren();
        if (user && user.avatar) {
          var image = document.createElement('img');
          image.alt = '';
          image.src = user.avatar;
          avatar.appendChild(image);
        }
      }
      node.setAttribute('aria-label', user ? '已登录，打开账户设置' : '登录');
      node.title = user ? (user.email + ' · 已登录') : '登录';
    });
    var name = document.querySelector('[data-shell-user-name]');
    var meta = document.querySelector('[data-shell-user-meta]');
    if (name) name.textContent = user ? (user.name || user.email) : '未登录';
    if (meta) meta.textContent = user ? credits(user) : '点击登录';
  }

  function bindShellEvents(frame) {
    var menu = document.querySelector('.molan-shell-mobile-menu');
    var close = function () { frame.classList.remove('is-nav-open'); };
    if (menu) menu.addEventListener('click', function () { frame.classList.toggle('is-nav-open'); });
    var scrim = frame.querySelector('.molan-shell-scrim');
    if (scrim) scrim.addEventListener('click', close);
    document.querySelectorAll('[data-shell-account]').forEach(function (node) {
      node.addEventListener('click', function () {
        var user = readUser();
        if (user && window.MolanAccount && typeof window.MolanAccount.open === 'function') window.MolanAccount.open();
        else if (!user) location.href = isRoot ? './pages/login.html' : './login.html';
      });
    });
    var theme = document.querySelector('[data-shell-theme]');
    if (theme) theme.addEventListener('click', function () {
      var dark = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('molan_theme', dark ? 'dark' : 'light'); } catch (_) {}
    });
    var notification = document.querySelector('[data-shell-notification]');
    if (notification) notification.addEventListener('click', function () {
      var notice = document.querySelector('.molan-shell-notice');
      if (!notice) {
        notice = document.createElement('div');
        notice.className = 'molan-shell-notice';
        document.body.appendChild(notice);
      }
      notice.textContent = '暂无新的平台通知';
      notice.classList.add('is-visible');
      window.clearTimeout(notification._molanTimer);
      notification._molanTimer = window.setTimeout(function () { notice.classList.remove('is-visible'); }, 2200);
    });
    window.addEventListener('molan:auth-changed', updateAccount);
  }

  function findContent() {
    if (isRoot) return document.getElementById('molanHomeOverview');
    if (file === 'dissect.html') return document.querySelector('.dissect-main');
    return document.querySelector('body > main');
  }

  function hideOriginalChrome(content) {
    document.querySelectorAll('body > header, body > footer, .novels-topbar, .skills-topbar, .dissect-header').forEach(function (node) {
      if (!node.classList.contains('molan-shell-header')) node.setAttribute('data-molan-shell-hidden', '');
    });
    document.querySelectorAll('body > .h-16').forEach(function (node) {
      node.setAttribute('data-molan-shell-hidden', '');
    });
    if (isRoot) {
      var main = document.querySelector('body > main');
      if (main) main.setAttribute('data-molan-shell-legacy', '');
    }
    if (content && content.id === 'molanHomeOverview') content.classList.add('molan-shell-content');
  }

  function updateCounts() {
    var novels = document.querySelector('[data-shell-count="novels"]');
    var entities = document.querySelector('[data-shell-count="entities"]');
    var novelValue = document.getElementById('molanStatNovels');
    var entityValue = document.getElementById('molanStatEntities');
    if (novels && novelValue) novels.textContent = novelValue.textContent;
    if (entities && entityValue) entities.textContent = entityValue.textContent;
  }

  function mount() {
    if (body.dataset.molanShellMounted === 'true') return;
    var content = findContent();
    if (!content && isRoot) {
      window.setTimeout(mount, 80);
      return;
    }
    if (!content) return;
    body.dataset.molanShellMounted = 'true';
    body.classList.add('molan-shell-enabled', 'molan-shell-' + pageKey);
    hideOriginalChrome(content);
    var header = makeHeader();
    var frame = document.createElement('div');
    frame.className = 'molan-shell-frame';
    var sidebar = makeSidebar();
    var page = document.createElement('main');
    page.className = 'molan-shell-page';
    var contentHost = document.createElement('div');
    contentHost.className = 'molan-shell-content';
    contentHost.appendChild(content);
    page.appendChild(contentHost);
    frame.appendChild(sidebar);
    frame.appendChild(page);
    var scrim = document.createElement('div');
    scrim.className = 'molan-shell-scrim';
    frame.appendChild(scrim);
    body.prepend(header);
    header.insertAdjacentElement('afterend', frame);
    bindShellEvents(frame);
    updateAccount();
    updateCounts();
    window.setTimeout(updateCounts, 500);
    window.setTimeout(updateCounts, 1600);
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
  }

  function applyEditorRoute() {
    if (!isEditor) return;
    var params = new URLSearchParams(location.search);
    var tab = params.get('tab');
    var panel = params.get('panel');
    window.setTimeout(function () {
      if (tab) {
        var tabButton = document.querySelector('.editor-tab[data-tab="' + CSS.escape(tab) + '"]');
        if (tabButton) tabButton.click();
      }
      if (panel) {
        var panelButton = document.querySelector('.sidebar-tab[data-tab="' + CSS.escape(panel) + '"]');
        if (panelButton) panelButton.click();
      }
    }, 360);
  }

  if (isEditor) {
    applyEditorRoute();
    return;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount(); });
  else mount();
}());
