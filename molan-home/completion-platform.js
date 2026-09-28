(function () {
  'use strict';

  var done = false;
  var originalRenderPage;
  var s = {
    skill: { scope: 'public', q: '', sort: 'updated', page: 1, totalPages: 1, items: [], mine: [], private: [], edit: null, fileBusy: false, importFiles: [], importFilesTouched: false, requestVersion: 0, privateRequestVersion: 0, detailVersion: 0, editVersion: 0 },
    tool: { id: 'deai', text: '', original: '', result: '', accepted: false, busy: false, controller: null },
    bill: { filter: 'all', page: 1 },
    account: { tab: 'profile', avatar: '' },
    docs: { q: '', category: 'all', id: 'start' },
    auth: { mode: 'login', code: false, busy: false }
  };

  var tools = [
    ['deai', '去 AI 味', 'eraser', 'humanizer', '保留事实，让表达更自然。'],
    ['typo', '错别字检测', 'spell-check', 'writing', '检查错别字、标点和病句。'],
    ['score', 'AI 味浓度检测', 'scan-search', 'humanizer', '识别 AI 痕迹并给出分项评分。'],
    ['name', '小说命名生成器', 'badge', 'writing', '根据题材和冲突生成书名。'],
    ['format', '排版清洗', 'align-justify', 'writing', '清理段落、标点和 Markdown 残留。'],
    ['duplicate', '重复内容检测', 'copy-check', 'writing', '找出重复段落和相近表达。'],
    ['title', '章节标题', 'heading', 'writing', '根据正文生成多组标题。'],
    ['character', '角色设定生成', 'user-round', 'writing', '补齐人物目标、关系和行为证据。'],
    ['synopsis', '书籍简介生成', 'align-left', 'writing', '生成平台简介和一句话卖点。'],
    ['rhythm', '爽点节奏分析', 'activity', 'writing', '分析目标、冲突和信息增量。']
  ];

  var tutorials = [
    ['start', '入门', '第一次使用', '从登录、创建作品到第一次保存，建立墨阑工作区。', '登录后作品、Skill、对话和积分记录都会归属于当前账户。先在我的小说创建作品，再从当前章节目标开始创作。', 'novels'],
    ['novel', '入门', '创建一本小说', '理解作品、章节、场景和保存之间的关系。', '每本作品拥有独立正文、知识库、Skill 绑定、对话和任务记录。编辑正文后使用保存操作同步到后端。', 'editor'],
    ['import', '资源', '导入正文和设定', '批量导入正文、人物卡、地图和设定集。', '导入内容不会直接覆盖正文。先检查文件清单和抽取结果，再把实体写入知识库。', 'resources'],
    ['editor', '正文', '使用 AI 编辑器', '让 AI 先在对话中给出结果，再确认写入位置。', '说明当前场景目标、阻力和不能提前揭开的信息。续写进入对话区，角色和设定结果应保存到知识库。', 'editor'],
    ['knowledge', '知识库', '整理知识库', '用地点、势力、人物、物品和伏笔组织长篇设定。', '地点下可组织势力和人物，物品按类别和品级归类。发送 AI 前检查上下文预览，避免把全部资料重复发送。', 'knowledge'],
    ['skills', 'AI 协作', '拆书与 Skill', '提取可迁移的文风规则并管理 Skill。', '先保存到我的 Skill，再选择是否发布到开放区。公开 Skill 可以被其他用户查看、下载和同步。', 'skills'],
    ['billing', '账户', '积分和任务', '查看真实余额、Token、模型和结算状态。', '使用记录来自后端 Token 账本，显示任务阶段、模型、Token、积分和状态。本地额度按钮不代表正式支付。', 'billing']
  ];

  function e(v) {
    return typeof escapeBackendHtml === 'function' ? escapeBackendHtml(v) : String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function say(v) { if (typeof showToast === 'function') showToast(v); }
  function icons() { if (typeof mountIcons === 'function') mountIcons(); }
  function logged() { return !!(backendState.token && backendState.user); }
  function sessionKey() {
    var email = backendState.user && backendState.user.email ? encodeURIComponent(String(backendState.user.email).trim().toLowerCase()) : 'guest';
    return String(backendState.sessionVersion || 0) + ':' + email + ':' + String(backendState.token || '');
  }
  function currentSession(key) { return key === sessionKey(); }
  function model() { return typeof currentUnifiedModel === 'function' ? currentUnifiedModel() : String(backendState.modelAccess.defaultModel || ''); }
  function go(page) { if (window.renderPage) window.renderPage(page); }
  function key(name) { return 'molan_completion_' + name + '_' + encodeURIComponent(String(backendState.user && backendState.user.email || 'guest')); }
  function read(name, fallback) { try { return JSON.parse(localStorage.getItem(key(name)) || JSON.stringify(fallback)); } catch (_) { return fallback; } }
  function write(name, value) { try { localStorage.setItem(key(name), JSON.stringify(value)); } catch (_) {} }
  function shell(keyName, body, extra) {
    var meta = pages[keyName];
    return '<div class="page-shell ' + (extra || '') + '"><div class="page-header"><div><div class="eyebrow">' + e(meta.eyebrow) + '</div><h1 class="page-title">' + e(meta.title) + '</h1><p class="page-subtitle">' + e(meta.subtitle) + '</p></div><div class="header-tools">' + header(keyName) + '</div></div>' + body + '</div>';
  }
  function header(page) {
    if (page === 'skills') return '<div class="search-box">' + icon('search') + '<input data-c-search="skill" placeholder="搜索 Skill"></div><button class="button" data-c-action="skill-refresh">' + icon('refresh-cw') + '刷新</button><button class="button primary" data-c-action="skill-create">' + icon('plus') + '创建 Skill</button>';
    if (page === 'tools') return '<span class="badge green" data-c-model>模型加载中</span>';
    if (page === 'billing') return '<button class="button" data-c-action="bill-export">' + icon('download') + '导出记录</button><button class="button primary" data-c-action="bill-topup">' + icon('plus') + '增加额度</button>';
    if (page === 'account') return '<button class="button" data-c-action="account-logout">退出登录</button><button class="button primary" data-c-action="account-save">' + icon('save') + '保存修改</button>';
    if (page === 'docs') return '<div class="search-box">' + icon('search') + '<input data-c-search="docs" placeholder="搜索教程"></div>';
    return '';
  }
  function empty(node, title, copy) { if (node) node.innerHTML = '<div class="empty"><div class="empty-icon">—</div><h3>' + e(title) + '</h3><p>' + e(copy || '') + '</p></div>'; }
  function refreshChrome() {
    var user = backendState.user;
    var top = document.querySelector('.avatar-button');
    if (top) {
      top.replaceChildren();
      if (user && user.avatar) { var img = document.createElement('img'); img.src = user.avatar; img.alt = ''; img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%'; top.appendChild(img); }
      top.title = user ? user.email + ' · 已登录' : '登录';
    }
    var avatar = document.querySelector('.side-profile .profile-avatar');
    if (avatar) {
      avatar.replaceChildren();
      if (user && user.avatar) { var side = document.createElement('img'); side.src = user.avatar; side.alt = ''; side.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%'; avatar.appendChild(side); }
    }
    var name = document.querySelector('.side-profile .profile-name');
    var meta = document.querySelector('.side-profile .profile-meta');
    if (name) name.textContent = user ? (user.name || user.email) : '未登录';
    if (meta) meta.textContent = user ? ((user.role === 'admin' ? '管理员' : user.role === 'vip' ? 'VIP 用户' : '普通用户') + ' · ' + (user.credits == null ? '无限积分' : Number(user.credits).toLocaleString() + ' 积分')) : '登录后保存作品';
    var loginEntry = document.querySelector('[data-user-login-entry]');
    if (loginEntry) {
      var loginIcon = loginEntry.querySelector('.icon');
      if (loginIcon) loginEntry.replaceChildren(loginIcon);
      else loginEntry.replaceChildren();
      loginEntry.appendChild(document.createTextNode(user ? '已登录账户' : '普通用户登录'));
      loginEntry.setAttribute('aria-label', user ? '已登录账户，打开账户设置' : '普通用户登录');
      loginEntry.title = user ? '已登录 · 打开账户设置' : '普通用户登录';
    }
  }

  /* Skill */
  function skillsPage() {
    return shell('skills', '<div class="skills-layout c-page" data-c-page="skills"><section class="panel"><div class="skill-toolbar"><div class="skill-tabs"><button class="skill-tab active" data-c-scope="public">发现 Skill</button><button class="skill-tab" data-c-scope="mine">我的开放 Skill</button></div><div class="skill-toolbar-controls"><select class="select-control select-control--compact" data-c-skill-sort aria-label="Skill 排序"><option value="updated">最近更新</option><option value="downloads">下载最多</option></select><span class="badge blue" data-c-skill-count>加载中</span></div></div><div class="panel-body"><div class="grid grid-2" data-c-skill-list></div><div style="display:flex;justify-content:center;gap:8px;margin-top:12px"><button class="button" data-c-action="skill-prev">上一页</button><span class="section-note" data-c-skill-page>1 / 1</span><button class="button" data-c-action="skill-next">下一页</button></div></div></section><aside class="panel"><div class="panel-heading"><div><h2>我的 Skill</h2><p>保存后可同步到当前作品</p></div><button class="icon-button" data-c-action="skill-private-refresh" aria-label="刷新我的 Skill">' + icon('refresh-cw') + '</button></div><div class="panel-body"><div class="private-list" data-c-private-list></div><div class="divider"></div><button class="button primary full-width-action" data-c-action="skill-create">' + icon('plus') + '创建我的 Skill</button></div></aside></div>', 'skills-page');
  }
  function skillCard(item) {
    var id = e(item.id);
    return '<article class="skill-card"><div class="skill-card-head"><span class="skill-mark">' + icon('feather') + '</span><div><h3>' + e(item.name) + '</h3><div class="author">by ' + e(item.author || item.ownerEmail || '墨阑作者') + '</div></div></div><p>' + e(item.description || '暂无描述') + '</p><div class="skill-foot"><span>' + (Number(item.downloads) || 0).toLocaleString() + ' 次下载</span><div class="skill-card-actions"><button class="button" data-c-action="skill-detail" data-id="' + id + '">查看</button>' + (s.skill.scope === 'mine' ? '<button class="button" data-c-action="skill-edit" data-id="' + id + '">编辑</button><button class="button" data-c-action="skill-status" data-status="' + (item.status === 'withdrawn' ? 'published' : 'withdrawn') + '" data-id="' + id + '">' + (item.status === 'withdrawn' ? '重新发布' : '撤回') + '</button>' : '<button class="button" data-c-action="skill-download" data-id="' + id + '">下载</button>') + '</div></div></article>';
  }
  function renderSkills() {
    if (currentPage !== 'skills') return;
    var root = stage.querySelector('[data-c-page="skills"]'); if (!root) return;
    var list = s.skill.scope === 'mine' ? s.skill.items : s.skill.items;
    var grid = root.querySelector('[data-c-skill-list]');
    root.querySelector('[data-c-skill-count]').textContent = (s.skill.scope === 'mine' ? '我的开放 ' : '公开 ') + (s.skill.total || 0) + ' 个';
    root.querySelector('[data-c-skill-page]').textContent = s.skill.page + ' / ' + s.skill.totalPages;
    root.querySelector('[data-c-action="skill-prev"]').disabled = s.skill.page <= 1;
    root.querySelector('[data-c-action="skill-next"]').disabled = s.skill.page >= s.skill.totalPages;
    if (s.skill.loading) return empty(grid, '正在加载 Skill', '正在读取真实开放区数据。');
    if (!logged() && s.skill.scope === 'mine') return empty(grid, '请先登录', '登录后查看自己发布的开放 Skill。');
    if (!list.length) return empty(grid, s.skill.scope === 'mine' ? '还没有发布 Skill' : '还没有开放 Skill', '可以创建 Skill，或调整搜索条件。');
    grid.innerHTML = list.map(skillCard).join(''); icons();
  }
  function renderPrivateSkills() {
    if (currentPage !== 'skills') return;
    var box = stage.querySelector('[data-c-private-list]'); if (!box) return;
    if (!logged()) return empty(box, '登录后查看私有 Skill', '下载和创建的 Skill 会同步到当前账户。');
    if (!s.skill.private.length) return empty(box, '还没有私有 Skill', '从开放区下载，或创建自己的 Skill。');
    box.innerHTML = s.skill.private.map(function (item) { return '<div class="private-skill"><button class="private-skill-main" data-c-action="skill-private-detail" data-id="' + e(item.id) + '">' + icon('sparkles') + '<span class="private-skill-name">' + e(item.name) + '</span><span class="link-count">可使用</span></button><button class="button" data-c-action="skill-sync" data-id="' + e(item.id) + '">同步</button></div>'; }).join(''); icons();
  }
  async function loadSkills(privateOnly) {
    if (currentPage !== 'skills') return;
    if (!privateOnly) {
      var requestVersion = ++s.skill.requestVersion;
      var publicSession = sessionKey();
      s.skill.loading = true; renderSkills();
      try {
        if (s.skill.scope === 'mine' && !logged()) throw new Error('请先登录后查看自己的开放 Skill');
        var query = new URLSearchParams({ page: String(s.skill.page), pageSize: '12', q: s.skill.q, sort: s.skill.sort, scope: s.skill.scope });
        var result = await backendRequest('/api/open-skills?' + query.toString());
        if (requestVersion !== s.skill.requestVersion || !currentSession(publicSession) || currentPage !== 'skills') return;
        s.skill.items = Array.isArray(result.skills) ? result.skills : [];
        s.skill.total = Number(result.pagination && result.pagination.total) || s.skill.items.length;
        s.skill.page = Number(result.pagination && result.pagination.page) || s.skill.page;
        s.skill.totalPages = Math.max(1, Number(result.pagination && result.pagination.totalPages) || 1);
      } catch (error) {
        if (requestVersion !== s.skill.requestVersion || !currentSession(publicSession) || currentPage !== 'skills') return;
        s.skill.items = []; s.skill.total = 0; s.skill.totalPages = 1; say(error.message || '开放 Skill 加载失败');
      }
      if (requestVersion === s.skill.requestVersion && currentPage === 'skills') { s.skill.loading = false; renderSkills(); }
    }
    var privateVersion = ++s.skill.privateRequestVersion;
    var privateSession = sessionKey();
    try {
      var list = logged() ? await backendRequest('/api/skills') : [];
      if (privateVersion !== s.skill.privateRequestVersion || !currentSession(privateSession) || currentPage !== 'skills') return;
      s.skill.private = (Array.isArray(list) ? list : []).filter(function (item) { return item && item.source === 'user'; });
      backendState.privateSkills = Array.isArray(list) ? list : backendState.privateSkills;
    } catch (_) {
      if (privateVersion !== s.skill.privateRequestVersion || !currentSession(privateSession) || currentPage !== 'skills') return;
      s.skill.private = [];
    }
    if (privateVersion === s.skill.privateRequestVersion && currentPage === 'skills') renderPrivateSkills();
  }
  function parseSkill(raw) {
    var text = String(raw || '').replace(/^\uFEFF/, ''), name = '', description = '', body = text;
    var match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (match) { match[1].split(/\r?\n/).forEach(function (line) { var n = line.match(/^name:\s*(.+)$/i); var d = line.match(/^description:\s*(.+)$/i); if (n) name = n[1].trim(); if (d) description = d[1].trim(); }); body = text.slice(match[0].length).trim(); }
    return { name: name, description: description, instruction: body };
  }
  function skillPath(file) { return String(file && (file.webkitRelativePath || file.name) || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, ''); }
  function skillTextFile(path, file) {
    var binary = /\.(?:png|jpe?g|gif|bmp|webp|ico|pdf|zip|rar|7z|exe|dll|docx?|xlsx?|pptx?|mp3|mp4|wav|avi|mov|mkv|bin|dat|woff2?|ttf|eot|skp|psd)$/i.test(path);
    return !binary && (!file || !file.type || /^text\//i.test(file.type) || /\.(?:md|markdown|txt|json|ya?ml|xml|csv|toml|ini|cfg|html?|css|js|ts|py|sh|sql|prompt|template)$/i.test(path));
  }
  async function readSkillText(file) {
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
  function stripSkillCommonRoot(records) {
    var paths = records.map(function (item) { return item.path.split('/'); });
    if (!paths.length || paths.some(function (parts) { return parts.length < 2; })) return records;
    var root = paths[0][0];
    if (!root || paths.some(function (parts) { return parts[0] !== root; })) return records;
    return records.map(function (item) { return Object.assign({}, item, { path: item.path.slice(root.length + 1) }); });
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
  function updateSkillImportView(statusText, listText) {
    var status = document.getElementById('c-skill-import-status');
    var list = document.getElementById('c-skill-import-list');
    if (status && statusText) status.textContent = statusText;
    if (list) list.textContent = listText || '';
  }
  async function readSkillFiles(fileList) {
    var files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length + s.skill.importFiles.length > 500) { say('Skill 文件数量不能超过 500 个'); return; }
    var records = dedupeSkillRecords(stripSkillCommonRoot(files.map(function (file) { return { file: file, path: skillPath(file), size: Number(file.size) || 0, modified: Number(file.lastModified) || 0 }; }).filter(function (item) { return item.path; })));
    var entryFiles = records.filter(function (item) { return /(^|\/)SKILL\.md$/i.test(item.path); });
    if (!entryFiles.length && !s.skill.importFiles.some(function (item) { return /(^|\/)SKILL\.md$/i.test(item.path); })) { say('所选内容中未找到 SKILL.md'); return; }
    if (entryFiles.length > 1) { say('所选内容中存在多个 SKILL.md，请一次选择一个 Skill 文件夹'); return; }
    var previousFiles = s.skill.importFiles.slice();
    s.skill.fileBusy = true;
    updateSkillImportView('正在读取 Skill 文件…');
    var loaded = [], totalTextBytes = 0;
    try {
      for (var i = 0; i < records.length; i++) {
        var item = records[i];
        if (item.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB：' + item.path);
        if (!skillTextFile(item.path, item.file)) { loaded.push({ path: item.path, type: 'binary', size: item.size, content: null }); continue; }
        var content = await readSkillText(item.file);
        var bytes = new Blob([content]).size;
        totalTextBytes += bytes;
        if (totalTextBytes > 12 * 1024 * 1024) throw new Error('文本文件总大小超过 12 MB');
        loaded.push({ path: item.path, type: 'text', size: bytes, content: String(content || '') });
      }
      var entry = loaded.find(function (item) { return /(^|\/)SKILL\.md$/i.test(item.path); });
      if (entry) {
        var parsed = parseSkill(entry.content || '');
        var name = document.getElementById('c-skill-name');
        var description = document.getElementById('c-skill-description');
        var instruction = document.getElementById('c-skill-instruction');
        if (name && !name.value.trim() && parsed.name) name.value = parsed.name.slice(0, 120);
        if (description && !description.value.trim() && parsed.description) description.value = parsed.description.slice(0, 500);
        if (instruction) instruction.value = parsed.instruction.slice(0, 200000);
      }
      s.skill.importFiles = mergeSkillFiles(previousFiles, loaded); s.skill.importFilesTouched = true;
      updateSkillImportView('已追加 ' + loaded.length + ' 个文件，当前共 ' + s.skill.importFiles.length + ' 个文件，可继续编辑后保存。', s.skill.importFiles.map(function (item) { return item.path + (item.type === 'binary' ? '（资源清单）' : ''); }).join(' · '));
    } catch (error) {
      s.skill.importFiles = previousFiles;
      updateSkillImportView('读取失败，请重新选择文件或文件夹。');
      say(error.message || 'Skill 文件读取失败');
    } finally { s.skill.fileBusy = false; }
  }
  function skillFields() {
    var payload = { name: document.getElementById('c-skill-name')?.value.trim() || '', description: document.getElementById('c-skill-description')?.value.trim() || '', instruction: document.getElementById('c-skill-instruction')?.value.trim() || '' };
    if (s.skill.importFilesTouched || s.skill.importFiles.length) {
      payload.files = s.skill.importFiles.map(function (item) { return item.path; });
      payload.runtimeFiles = {};
      payload.fileManifest = s.skill.importFiles.map(function (item) { payload.runtimeFiles[item.path] = item.type === 'text' ? item.content : null; return { path: item.path, type: item.type, size: item.size }; });
    }
    return payload;
  }
  function editSkill(mode, item) {
    if (!logged()) { go('login'); say('请先登录后管理 Skill'); return; }
    item = item || {}; s.skill.edit = { mode: mode, id: item.id || '' }; s.skill.fileBusy = false; s.skill.importFiles = existingSkillFiles(item); s.skill.importFilesTouched = false;
    var importField = '<div class="field"><label>导入 Skill 文件</label><div style="display:flex;gap:8px;flex-wrap:wrap;"><label class="button" style="cursor:pointer;">选择多个文件<input type="file" data-c-skill-file multiple accept=".md,.markdown,.txt,.json,.yaml,.yml,.xml,.csv,.toml,.ini,.cfg,.html,.htm,.css,.js,.ts,.py,.sh,.sql,text/*,application/json" hidden></label><label class="button" style="cursor:pointer;">选择文件夹<input type="file" data-c-skill-folder webkitdirectory directory multiple hidden></label><button class="button" type="button" data-c-skill-clear>清空清单</button></div><small id="c-skill-import-status">可选择单个 SKILL.md、多选文件或包含 SKILL.md 的整个文件夹；重复选择会追加，附属文件按相对路径保存。</small><div id="c-skill-import-list" style="max-height:100px;overflow:auto;margin-top:6px;font-size:11px;color:var(--muted-light);"></div></div>';
    openActionModal({ title: mode === 'edit' ? '编辑开放 Skill' : '创建 Skill', body: '<div class="form-grid"><div class="field"><label>名称</label><input id="c-skill-name" maxlength="120" value="' + e(item.name || '') + '"></div><div class="field"><label>简介</label><input id="c-skill-description" maxlength="500" value="' + e(item.description || '') + '"></div><div class="field"><label>核心指令</label><textarea id="c-skill-instruction" maxlength="1000000">' + e(item.instruction || '') + '</textarea></div>' + importField + (mode === 'edit' ? '' : '<button class="button" data-c-action="skill-publish-draft">保存并发布</button>') + '</div>', confirmText: mode === 'edit' ? '保存修改' : '保存到我的 Skill', cancelText: '取消', onConfirm: function () { return saveSkill(false); } });
    if (s.skill.importFiles.length) updateSkillImportView('已保留现有 ' + s.skill.importFiles.length + ' 个文件；可以继续追加，或先清空清单。', s.skill.importFiles.map(function (file) { return file.path + (file.type === 'binary' ? '（资源清单）' : ''); }).join(' · '));
    icons();
    var instructionField = document.getElementById('c-skill-instruction');
    if (instructionField) {
      instructionField.setAttribute('maxlength', '1000000');
      instructionField.value = item.instruction || '';
    }
  }
  async function saveSkill(publish) {
    if (s.skill.fileBusy) { say('文件仍在读取，请稍候'); return false; }
    var item = skillFields(); if (!item.name || !item.instruction) { say('请填写 Skill 名称和核心指令'); return false; }
    var requestSession = sessionKey();
    var button = document.getElementById('confirmModal'); if (button) button.disabled = true;
    try {
      if (s.skill.edit && s.skill.edit.mode === 'edit') await backendRequest('/api/open-skills/' + encodeURIComponent(s.skill.edit.id), { method: 'PATCH', body: item });
      else { await backendRequest('/api/skills/import', { method: 'POST', body: item }); if (publish) await backendRequest('/api/open-skills', { method: 'POST', body: item }); }
      if (!currentSession(requestSession)) return false;
      closeModal(); say(publish ? 'Skill 已保存并发布' : 'Skill 已保存'); await loadSkills(); return true;
    } catch (error) { say(error.message || 'Skill 保存失败'); return false; } finally { if (button) button.disabled = false; }
  }
  async function skillDetail(id, privateOnly) {
    var detailVersion = ++s.skill.detailVersion;
    var detailSession = sessionKey();
    try {
      var item;
      if (privateOnly) item = s.skill.private.find(function (x) { return String(x.id) === String(id); });
      else { var data = await backendRequest('/api/open-skills/' + encodeURIComponent(id)); item = data.skill; }
      if (detailVersion !== s.skill.detailVersion || !currentSession(detailSession) || currentPage !== 'skills') return;
      if (!item) throw new Error('Skill 不存在');
      s.skill.detail = item;
      openActionModal({ title: item.name || 'Skill 详情', body: '<div class="notice">' + e(item.description || '暂无描述') + '</div><div class="field" style="margin-top:12px"><label>核心指令</label><textarea readonly style="min-height:210px">' + e(item.instruction || '') + '</textarea></div><div style="display:flex;gap:7px;margin-top:10px"><button class="button primary" data-c-action="' + (privateOnly ? 'skill-sync' : 'skill-download-detail') + '" data-id="' + e(item.id) + '">' + (privateOnly ? '同步到当前作品' : '下载到我的 Skill') + '</button></div>', confirmText: '关闭', onConfirm: closeModal });
    } catch (error) { say(error.message || 'Skill 详情读取失败'); }
  }
  async function downloadSkill(id) {
    if (!logged()) { go('login'); say('请先登录后下载 Skill'); return; }
    var requestSession = sessionKey();
    try { await backendRequest('/api/open-skills/' + encodeURIComponent(id) + '/download', { method: 'POST', body: {} }); if (!currentSession(requestSession)) return; await loadSkills(true); say('已下载到我的 Skill'); } catch (error) { if (currentSession(requestSession)) say(error.message || 'Skill 下载失败'); }
  }
  async function syncSkill(id) {
    var item = s.skill.private.find(function (x) { return String(x.id) === String(id); }) || s.skill.detail;
    if (!item || (!previewState.novelId && !previewState.novelState)) return say('请先打开一部作品，再同步 Skill');
    previewState.editorSkillId = item.id; previewState.novelState = previewState.novelState || {}; previewState.novelState.workspace = previewState.novelState.workspace || {}; previewState.novelState.workspace.skills = Array.from(new Set((previewState.novelState.workspace.skills || []).concat(item.id)));
    if (typeof saveWorkspaceList === 'function') saveWorkspaceList('skills', previewState.novelState.workspace.skills);
    if (typeof syncWorkspaceState === 'function') await syncWorkspaceState();
    say('已同步到当前作品：' + item.name);
  }

  /* AI tools */
  function toolsPage() {
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = './pages/tools.html';
    }
    var cards = tools.map(function (t) { return '<button class="tool-card ' + (t[0] === s.tool.id ? 'active' : '') + '" data-c-action="tool-select" data-id="' + t[0] + '"><span class="tool-icon">' + icon(t[2]) + '</span><h3>' + e(t[1]) + '</h3><p>' + e(t[4]) + '</p></button>'; }).join('');
    return shell('tools', '<section class="panel c-page" data-c-page="tools"><div class="panel-heading"><div><h2>选择 AI 工具</h2><p>所有工具使用当前模型，按后端实际 Token 统一结算。</p></div><span class="badge gray">10 款工具</span></div><div class="panel-body"><div class="tool-grid">' + cards + '</div></div></section><section class="tool-workspace" style="margin-top:14px"><div class="panel pad"><div style="display:flex;justify-content:space-between;gap:8px"><div><h2 data-c-tool-title>' + e(tools.find(function (x) { return x[0] === s.tool.id; })[1]) + '</h2><div class="section-note" data-c-tool-copy>结果会流式显示在对话框。</div></div><span class="badge amber" data-c-model>当前模型</span></div><textarea class="tool-editor" data-c-tool-input placeholder="粘贴或输入要处理的正文"></textarea><div style="display:flex;justify-content:space-between;margin-top:9px"><span class="section-note" data-c-tool-length>0 / 20,000 字</span><div><button class="button" data-c-action="tool-cancel" style="display:none">停止</button><button class="button primary" data-c-action="tool-run">开始分析</button></div></div></div><div class="panel pad"><div class="section-title">结果</div><div class="result-block" data-c-tool-result style="margin-top:11px"><strong>等待运行</strong></div><div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="button primary" data-c-action="tool-diff" style="display:none">进入对比工具</button><button class="button" data-c-action="tool-copy" disabled>复制</button><button class="button" data-c-action="tool-accept" disabled>接受</button><button class="button" data-c-action="tool-undo" disabled>撤销</button></div><div class="divider"></div><div class="section-title">历史任务</div><div data-c-tool-history class="section-note" style="margin-top:8px"></div></div></section>', 'tools-page');
  }
  function toolPrompt(t) { return '你是墨阑 AI 工具“' + t[1] + '”。请严格依据用户文本，不编造事实。' + ({ deai: '你的任务是依据 Stop AI Slop 准则消除中文 AI 写作痕迹，把机械生硬的文本改写成人话。严格执行：1. 拆排比三件套（「是…是…更是…」等仅保留最有力的一句）；2. 去名词化（「进行/实现/做出/采取/加以/给予 + 名词」换成本词动作）；3. 换抽象主语为具体的人或细节（不用时代/科技/AI等当主语）；4. 删金句收尾与抒情扩散（删「这，就是…的力量」「唯有…方能…」等）；5. 删虚词与程度副词（极大压低「非常/十分/其实/一种/某种」）；6. 删元评论与八股连接词（删「首先/其次/综上所述/值得注意的是」）；7. 价值判断替换为具体动作或场景。保持原意与事实，直接输出改写文本。', typo: '列出错别字、标点和病句。', score: '基于 Stop AI Slop 五维量规（直、实、变、散、真，每维1-10分，满分50分）评估文本的 AI 痕迹。输出五维评分、指出典型病灶（排比三件套、名词化、抽象主语、金句升华、八股连接词）并引用原文，最后给出修改建议。', name: '生成 12 个书名并说明依据。', format: '清洗排版但不改变剧情。', duplicate: '列出重复内容、位置和建议。', title: '生成 8 个章节标题并说明依据。', character: '提取目标、关系、冲突和行为证据。', synopsis: '生成 3 版简介和一句话卖点。', rhythm: '分析目标、冲突、信息增量和节奏。' }[t[0]]); }
  function renderTools() {
    if (currentPage !== 'tools') return;
    var t = tools.find(function (x) { return x[0] === s.tool.id; }) || tools[0], title = stage.querySelector('[data-c-tool-title]'), copy = stage.querySelector('[data-c-tool-copy]'), input = stage.querySelector('[data-c-tool-input]'), badge = stage.querySelector('[data-c-model]'), result = stage.querySelector('[data-c-tool-result]');
    stage.querySelectorAll('[data-c-action="tool-select"]').forEach(function (x) { x.classList.toggle('active', x.dataset.id === s.tool.id); });
    if (title) title.textContent = t[1]; if (copy) copy.textContent = t[4]; if (input && input.value !== s.tool.text) input.value = s.tool.text; if (badge) badge.textContent = '当前模型 · ' + (typeof modelName === 'function' ? modelName(model()) : model());
    var len = stage.querySelector('[data-c-tool-length]'); if (len) len.textContent = (input ? input.value.length : 0).toLocaleString() + ' / 20,000 字';
    if (result && s.tool.result && !result.querySelector('pre')) result.innerHTML = '<strong>最近结果</strong><pre style="white-space:pre-wrap;font:inherit;margin:8px 0\"></pre>';
    if (result && s.tool.result && result.querySelector('pre')) result.querySelector('pre').textContent = s.tool.result;
    var diffBtn = stage.querySelector('[data-c-action="tool-diff"]');
    if (diffBtn) {
      diffBtn.style.display = (s.tool.id === 'deai' && s.tool.result) ? 'inline-flex' : 'none';
      diffBtn.disabled = !s.tool.result || s.tool.busy;
    }
    stage.querySelector('[data-c-action="tool-copy"]').disabled = !s.tool.result; stage.querySelector('[data-c-action="tool-accept"]').disabled = !s.tool.result || s.tool.busy; stage.querySelector('[data-c-action="tool-undo"]').disabled = !s.tool.accepted;
    var usage = backendState.usage && backendState.usage.recent || [], history = stage.querySelector('[data-c-tool-history]');
    if (history) history.innerHTML = usage.filter(function (r) { return ['writing', 'humanizer', 'single'].indexOf(r.stage) >= 0; }).slice(0, 8).map(function (r) { return '<div class="task-row"><div class="task-copy"><div class="task-title">' + e(r.modelId || r.stage) + '</div><div class="task-meta">' + e(r.status || '处理中') + ' · ' + (r.totalTokens == null ? 'Token 待结算' : Number(r.totalTokens).toLocaleString() + ' Token') + '</div></div><span class="badge ' + (r.status === 'completed' ? 'green' : 'amber') + '">' + Number(r.creditCost || 0).toLocaleString() + ' 积分</span></div>'; }).join('') || '暂无工具记录。';
    icons();
  }
  async function runTool() {
    var input = stage.querySelector('[data-c-tool-input]'), result = stage.querySelector('[data-c-tool-result]'), t = tools.find(function (x) { return x[0] === s.tool.id; }) || tools[0], text = input && input.value.trim();
    if (!text) return say('请先输入要处理的正文'); if (text.length > 20000) return say('单次输入不能超过 20,000 字'); if (!logged()) { go('login'); return say('请先登录后使用 AI 工具'); }
    var requestSession = sessionKey();
    var requestController = new AbortController();
    s.tool.text = text; s.tool.original = text; s.tool.result = ''; s.tool.accepted = false; s.tool.busy = true; s.tool.controller = requestController;
    result.innerHTML = '<strong>正在流式生成</strong><pre style="white-space:pre-wrap;font:inherit;margin:8px 0\"></pre>';
    var cancelBtn = stage.querySelector('[data-c-action="tool-cancel"]');
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    try {
      var response = await fetch((typeof BACKEND_BASE === 'string' ? BACKEND_BASE : '') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + backendState.token }, body: JSON.stringify({ model: model(), stage: t[3], max_tokens: 1800, messages: [{ role: 'system', content: toolPrompt(t) }, { role: 'user', content: text }] }), signal: requestController.signal });
      if (!currentSession(requestSession)) return;
      if (!response.ok) { var bad = await response.json().catch(function () { return {}; }); throw new Error(bad.error || 'AI 请求失败'); }
      var reader = response.body.getReader(), decoder = new TextDecoder(), buffer = '', answer = '';
      while (true) {
        if (!currentSession(requestSession)) return;
        var part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        var lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        lines.forEach(function (line) {
          if (!line.startsWith('data:')) return;
          var raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') return;
          try {
            var item = JSON.parse(raw), delta = item.choices?.[0]?.delta?.content;
            if (typeof delta === 'string') { answer += delta; s.tool.result = answer; result.querySelector('pre').textContent = answer; }
          } catch (_) {}
        });
      }
      if (!currentSession(requestSession)) return;
      if (!answer.trim()) throw new Error('模型未返回可用内容');
      s.tool.result = answer.trim();
      if (typeof refreshBackendUser === 'function') await refreshBackendUser();
      if (!currentSession(requestSession)) return;
      if (typeof loadBackendUsage === 'function') await loadBackendUsage();
      if (!currentSession(requestSession)) return;
      say('处理完成，费用按后端实际 Token 结算');
    } catch (error) {
      if (!currentSession(requestSession)) return;
      if (error.name === 'AbortError') say('已停止本次生成');
      else { result.innerHTML = '<strong>请求失败</strong><p>' + e(error.message || 'AI 请求失败') + '</p>'; say(error.message || 'AI 工具请求失败'); }
    }
    finally {
      if (s.tool.controller === requestController && currentSession(requestSession)) {
        s.tool.busy = false; s.tool.controller = null;
        var cBtn = stage.querySelector('[data-c-action="tool-cancel"]');
        if (cBtn) cBtn.style.display = 'none';
        renderTools();
      }
    }
  }

  /* Billing */
  function billingPage() {
    return shell('billing', '<div class="billing-layout c-page" data-c-page="billing"><article class="balance-panel"><div class="eyebrow">CURRENT BALANCE</div><div class="balance-value" data-c-balance>—</div><div class="balance-copy" data-c-balance-copy>登录后显示真实余额。</div><button class="button" data-c-action="bill-topup">' + icon('plus') + '增加本地测试额度</button></article><article class="panel pad"><div class="section-title">近 7 日积分消耗</div><div class="usage-chart" data-c-chart></div><div class="metric-foot" data-c-chart-copy>登录后显示真实用量</div></article></div><section class="panel" style="margin-top:14px"><div class="panel-heading"><div><h2>使用记录</h2><p>显示当前账户后端账本中的真实 Token 和积分。</p></div><div class="segmented"><button class="segment active" data-c-filter="all">全部</button><button class="segment" data-c-filter="writing">生成</button><button class="segment" data-c-filter="humanizer">检测 / 改写</button><button class="segment" data-c-filter="single">其他</button></div></div><div class="panel-body table-wrap"><table class="data-table" data-c-table><thead><tr><th>时间</th><th>任务</th><th>模型</th><th>Token</th><th>积分</th><th>状态</th></tr></thead><tbody></tbody></table><div style="display:flex;justify-content:center;gap:8px;margin-top:12px"><button class="button" data-c-action="bill-prev">上一页</button><span class="section-note" data-c-bill-page>1 / 1</span><button class="button" data-c-action="bill-next">下一页</button></div></div></section>', 'billing-page');
  }
  function renderBilling() {
    if (currentPage !== 'billing') return;
    var user = backendState.user, rows = backendState.usage && backendState.usage.recent || [], root = stage.querySelector('[data-c-page="billing"]');
    if (!root) return;
    if (!root.querySelector('[data-c-balance]') || !root.querySelector('[data-c-balance-copy]') || !root.querySelector('[data-c-chart]') || !root.querySelector('[data-c-chart-copy]') || !root.querySelector('[data-c-table] tbody') || !root.querySelector('[data-c-bill-page]') || !root.querySelector('[data-c-action="bill-prev"]') || !root.querySelector('[data-c-action="bill-next"]')) return;
    root.querySelector('[data-c-balance]').textContent = !user ? '—' : (user.credits == null ? '∞' : Number(user.credits).toLocaleString());
    root.querySelector('[data-c-balance-copy]').textContent = !user ? '登录后显示真实余额。' : '账户等级：' + (user.role || 'normal') + ' · 后端统一结算';
    var chart = root.querySelector('[data-c-chart]');
    if (user) { var pts = Array.from({ length: 7 }, function (_, i) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6 + i); var n = d.getTime() + 86400000; return { d: d, v: rows.filter(function (r) { return Number(r.createdAt) >= d.getTime() && Number(r.createdAt) < n; }).reduce(function (a, r) { return a + Number(r.creditCost || 0); }, 0) }; }); var max = Math.max(1, ...pts.map(function (x) { return x.v; })); chart.innerHTML = pts.map(function (x) { return '<div class="usage-bar" style="--bar:' + Math.max(6, Math.round(x.v / max * 82)) + 'px\"><span></span><small>' + (x.d.getMonth() + 1) + '/' + x.d.getDate() + '</small></div>'; }).join(''); root.querySelector('[data-c-chart-copy]').textContent = '过去 7 天 · ' + pts.reduce(function (a, x) { return a + x.v; }, 0).toLocaleString() + ' 积分'; } else empty(chart, '登录后显示用量', '真实记录只属于当前账户。');
    var filter = root.querySelector('.segment.active')?.dataset.cFilter || 'all'; var filtered = filter === 'all' ? rows : rows.filter(function (r) { return r.stage === filter; }); var pages = Math.max(1, Math.ceil(filtered.length / 10)); s.bill.page = Math.min(s.bill.page, pages); var start = (s.bill.page - 1) * 10; var body = root.querySelector('[data-c-table] tbody');
    body.innerHTML = !user ? '<tr><td colspan="6">登录后显示真实使用记录</td></tr>' : filtered.slice(start, start + 10).map(function (r) { return '<tr><td>' + e(typeof backendDate === 'function' ? backendDate(r.createdAt) : '') + '</td><td><strong>' + e(r.stage || 'AI 任务') + '</strong></td><td>' + e(r.providerModel || r.modelId || '-') + '</td><td>' + (r.totalTokens == null ? '待结算' : Number(r.totalTokens).toLocaleString()) + '</td><td>' + Number(r.creditCost || 0).toLocaleString() + '</td><td><span class="badge ' + (r.status === 'completed' ? 'green' : 'amber') + '">' + e(r.status || '处理中') + '</span></td></tr>'; }).join('') || '<tr><td colspan="6">当前筛选没有记录</td></tr>';
    root.querySelector('[data-c-bill-page]').textContent = s.bill.page + ' / ' + pages; root.querySelector('[data-c-action="bill-prev"]').disabled = s.bill.page <= 1; root.querySelector('[data-c-action="bill-next"]').disabled = s.bill.page >= pages;
  }
  async function loadBilling() { if (logged()) { try { if (typeof refreshBackendUser === 'function') await refreshBackendUser(); if (typeof loadBackendUsage === 'function') await loadBackendUsage(); } catch (error) { say(error.message || '积分记录加载失败'); } } renderBilling(); }
  function exportBilling() { var rows = backendState.usage && backendState.usage.recent || []; if (!rows.length) return say('当前没有可导出的使用记录'); var csv = [['时间', '任务', '模型', 'Token', '积分', '状态']].concat(rows.map(function (r) { return [r.createdAt, r.stage, r.providerModel || r.modelId, r.totalTokens || '', r.creditCost || 0, r.status || '']; })).map(function (a) { return a.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n'); var link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); link.download = 'molan-usage.csv'; link.click(); URL.revokeObjectURL(link.href); say('使用记录已导出'); }
  function topup() { if (!logged()) { go('login'); return say('请先登录后增加额度'); } openActionModal({ title: '增加本地测试额度', body: '<div class="notice">支付功能尚未开放。本操作只增加本地测试额度，不产生真实订单。</div>', confirmText: '增加 1,000 积分', onConfirm: async function () { try { var data = await backendRequest('/api/billing/topup', { method: 'POST', body: { credits: 1000 } }); backendState.user = data.user || backendState.user; persistBackendAuth(); closeModal(); renderBilling(); refreshChrome(); say('已增加 1,000 积分'); } catch (error) { say(error.message || '增加额度失败'); } } }); }

  /* Docs */
  function docsPage() { return shell('docs', '<div class="docs-layout c-page" data-c-page="docs"><nav class="panel docs-nav"><select class="select-control docs-category-select" data-c-doc-category aria-label="教程分类"><option value="all">全部分类</option><option value="入门">入门</option><option value="资源">资源</option><option value="正文">正文</option><option value="知识库">知识库</option><option value="AI 协作">AI 协作</option><option value="账户">账户</option></select><div data-c-doc-links></div></nav><article class="panel article" data-c-doc-article></article></div>', 'docs-page'); }
  function renderDocs() {
    if (currentPage !== 'docs') return;
    var list = tutorials.filter(function (x) { return (s.docs.category === 'all' || x[1] === s.docs.category) && (!s.docs.q || (x[2] + x[3] + x[1]).toLowerCase().indexOf(s.docs.q.toLowerCase()) >= 0); }), root = stage.querySelector('[data-c-page="docs"]');
    if (!root) return; if (!list.some(function (x) { return x[0] === s.docs.id; })) s.docs.id = list[0]?.[0] || '';
    root.querySelector('[data-c-doc-links]').innerHTML = list.map(function (x) { return '<a href="#" class="' + (x[0] === s.docs.id ? 'active' : '') + '" data-c-doc-id="' + x[0] + '">' + e(x[2]) + '<small style="display:block;color:var(--muted-light)">' + e(x[1]) + '</small></a>'; }).join('') || '<p class="section-note">没有匹配的教程。</p>';
    var item = tutorials.find(function (x) { return x[0] === s.docs.id; }), article = root.querySelector('[data-c-doc-article]');
    if (!item) return empty(article, '没有匹配的教程', '请调整搜索条件。');
    article.innerHTML = '<div class="eyebrow">' + e(item[1].toUpperCase()) + '</div><h2>' + e(item[2]) + '</h2><p>' + e(item[3]) + '</p><div class="notice">' + icon('book-open') + '<span>' + e(item[4]) + '</span></div><h3>操作要点</h3><p>' + e(item[4]) + '</p><button class="button primary" data-c-action="docs-go" data-page-target="' + item[5] + '">前往相关功能 ' + icon('arrow-right') + '</button>'; icons();
  }

  /* Account */
  function accountPage() { return shell('account', '<div class="account-grid c-page" data-c-page="account"><nav class="panel account-nav"><button class="active" data-c-account-tab="profile">' + icon('user-round') + '个人资料</button><button data-c-account-tab="preferences">' + icon('sliders-horizontal') + '创作偏好</button><button data-c-account-tab="security">' + icon('shield-check') + '登录安全</button><button data-c-account-tab="usage">' + icon('history') + '使用记录</button></nav><section class="panel"><div class="panel-heading"><div><h2 data-c-account-title>个人资料</h2><p>管理当前账户资料和偏好。</p></div><span class="badge ' + (logged() ? 'green' : 'gray') + '">' + (logged() ? '已登录' : '未登录') + '</span></div><div class="panel-body" data-c-account-body></div></section></div>', 'account-page'); }
  function accountBody() {
    var u = backendState.user;
    if (s.account.tab === 'profile') return '<div class="profile-form"><div><span class="big-avatar" data-c-avatar>' + (s.account.avatar ? '<img src="' + e(s.account.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' : '') + '</span><label class="button" style="width:100%;margin-top:9px;text-align:center;cursor:pointer">上传头像<input type="file" data-c-avatar-file accept="image/png,image/jpeg,image/webp,image/gif" hidden></label><button class="button" style="width:100%;margin-top:7px" data-c-action="account-clear">清除头像</button></div><div class="form-grid"><div class="field"><label>登录邮箱</label><input value="' + e(u?.email || '') + '" disabled></div><div class="field"><label>显示名称</label><input id="c-account-name" maxlength="24" value="' + e(u?.name || '') + '" ' + (!u ? 'disabled' : '') + '></div><div class="field"><label>个人简介</label><textarea id="c-account-bio" maxlength="500" ' + (!u ? 'disabled' : '') + '>' + e(u?.bio || '') + '</textarea></div></div></div>' + (!u ? '<div class="notice" style="margin-top:14px">请先登录后编辑账户资料。</div>' : '');
    if (s.account.tab === 'preferences') return '<div class="form-grid"><div class="field"><label>默认创作模型</label><select data-c-model-select data-model-select ' + (!u ? 'disabled' : '') + '></select><small>普通用户使用平台默认模型，VIP 和管理员可选择模型。</small></div><div class="notice"><label class="check"><input type="checkbox" data-c-pref="autosave" ' + (read('prefs', {}).autosave !== false ? 'checked' : '') + '> 自动保存编辑内容</label></div><div class="notice"><label class="check"><input type="checkbox" data-c-pref="preview" ' + (read('prefs', {}).preview !== false ? 'checked' : '') + '> AI 发送前显示上下文预览</label></div></div>';
    if (s.account.tab === 'security') return '<div class="form-grid"><div class="notice">当前登录邮箱：<strong>' + e(u?.email || '未登录') + '</strong></div><button class="button" data-c-action="account-logout-all" ' + (!u ? 'disabled' : '') + '>退出所有设备</button><button class="button" disabled>修改密码（暂未开放）</button><p class="section-note">验证码登录、找回密码和修改密码接口当前未开放，页面不会伪造成功结果。</p></div>';
    var rows = backendState.usage && backendState.usage.recent || [];
    return '<div class="notice">请求次数：' + Number(backendState.usage?.requestCount || 0).toLocaleString() + ' · Token：' + Number(backendState.usage?.totalTokens || 0).toLocaleString() + '</div><div class="table-wrap" style="margin-top:12px\"><table class="data-table\"><thead><tr><th>时间</th><th>模型</th><th>Token</th><th>积分</th></tr></thead><tbody>' + (rows.map(function (r) { return '<tr><td>' + e(typeof backendDate === 'function' ? backendDate(r.createdAt) : '') + '</td><td>' + e(r.modelId || '-') + '</td><td>' + (r.totalTokens == null ? '待结算' : Number(r.totalTokens).toLocaleString()) + '</td><td>' + Number(r.creditCost || 0).toLocaleString() + '</td></tr>'; }).join('') || '<tr><td colspan="4">暂无使用记录</td></tr>') + '</tbody></table></div>';
  }
  function renderAccount() {
    if (currentPage !== 'account') return;
    var root = stage.querySelector('[data-c-page="account"]'); if (!root) return; root.querySelector('[data-c-account-body]').innerHTML = accountBody(); root.querySelectorAll('[data-c-account-tab]').forEach(function (x) { x.classList.toggle('active', x.dataset.cAccountTab === s.account.tab); }); var modelSelect = root.querySelector('[data-c-model-select]'); if (modelSelect && typeof populateModelSelect === 'function') populateModelSelect(modelSelect); icons();
  }
  async function saveAccount() {
    if (!logged()) { go('login'); return say('请先登录后保存账户资料'); }
    try { var data = await backendRequest('/api/auth/profile', { method: 'PATCH', body: { name: document.getElementById('c-account-name')?.value.trim() || '', bio: document.getElementById('c-account-bio')?.value.trim() || '', avatar: s.account.avatar || '', defaultModel: document.querySelector('[data-c-model-select]')?.value || '' } }); backendState.user = data.user || backendState.user; persistBackendAuth(); refreshChrome(); say('账户资料已保存'); } catch (error) { say(error.message || '账户资料保存失败'); }
  }
  async function avatar(file) {
    if (!/^image\/(?:png|jpe?g|webp|gif)$/i.test(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片');
    if (file.size > 5 * 1024 * 1024) throw new Error('图片不能超过 5 MB');
    return new Promise(function (resolve, reject) { var r = new FileReader(), image = new Image(); r.onerror = function () { reject(new Error('图片读取失败')); }; image.onerror = function () { reject(new Error('图片读取失败')); }; image.onload = function () { var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d'), scale = Math.max(256 / image.width, 256 / image.height); x.drawImage(image, (256 - image.width * scale) / 2, (256 - image.height * scale) / 2, image.width * scale, image.height * scale); resolve(c.toDataURL('image/jpeg', .8)); }; r.onload = function () { image.src = r.result; }; r.readAsDataURL(file); });
  }
  async function logout(all) { try { if (backendState.token) await backendRequest(all ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST', body: {} }); } catch (_) {} clearBackendAuth(); window.dispatchEvent(new CustomEvent('molan:auth-changed', { detail: null })); refreshChrome(); say(all ? '已退出所有设备' : '已退出登录'); go('overview'); }

  /* Login */
  function loginPage() { return shell('login', '<div class="user-login c-page" data-c-page="login"><section class="user-login-copy"><div><div style="display:flex;align-items:center;gap:9px"><span class="brand-mark">墨</span><strong style="font-family:var(--serif);font-size:16px">墨阑</strong></div><h2>让每一个故事，都有自己的工作台。</h2><p>保存你的作品、设定和 Skill，在任意设备继续创作。</p><div class="login-signal"><span></span>你的作品数据按账户独立保存</div></div></section><section class="user-login-form"><form class="user-login-inner" data-c-login><div class="login-tabs"><button type="button" class="login-tab active" data-c-auth-mode="login">登录</button><button type="button" class="login-tab" data-c-auth-mode="register">注册</button></div><h1 data-c-auth-title>欢迎回来</h1><p data-c-auth-copy>登录后继续最近编辑的小说和 AI 任务。</p><div class="form-grid"><div class="field"><label>邮箱</label><input id="c-login-email" type="email" required placeholder="you@example.com"></div><div class="field"><label>密码</label><div style="display:flex;gap:6px"><input id="c-login-password" type="password" required placeholder="请输入密码" style="flex:1"><button type="button" class="button" data-c-action="auth-password">显示</button></div></div><div class="field" data-c-code-field hidden><label>验证码</label><div style="display:flex;gap:6px"><input id="c-login-code" maxlength="6" style="flex:1"><button type="button" class="button" data-c-action="auth-code">获取验证码</button></div></div></div><div class="login-links"><label class="check"><input type="checkbox">记住我</label><button type="button" class="button" data-c-action="auth-forgot">忘记密码？</button></div><button class="button primary" type="submit" data-c-auth-submit style="width:100%;margin-top:20px">登录并进入工作台</button><div class="notice" style="margin-top:16px"><span data-c-auth-notice>本地服务模式：登录或注册后，作品和任务会保存到当前本地后端。</span></div><div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="button" data-c-action="auth-terms">服务条款</button><button type="button" class="button" data-c-action="auth-privacy">隐私政策</button></div></form></section></div>', 'login-page'); }
  function renderAuth() { if (currentPage !== 'login') return; var root = stage.querySelector('[data-c-page="login"]'); if (!root) return; root.querySelectorAll('[data-c-auth-mode]').forEach(function (x) { x.classList.toggle('active', x.dataset.cAuthMode === s.auth.mode); }); root.querySelector('[data-c-auth-title]').textContent = s.auth.mode === 'register' ? '创建账户' : '欢迎回来'; root.querySelector('[data-c-auth-copy]').textContent = s.auth.mode === 'register' ? '注册后保存作品、Skill 和 AI 任务。' : '登录后继续最近编辑的小说和 AI 任务。'; root.querySelector('[data-c-auth-submit]').textContent = s.auth.mode === 'register' ? '注册并进入工作台' : '登录并进入工作台'; root.querySelector('[data-c-code-field]').hidden = !s.auth.code; root.querySelector('#c-login-password').closest('.field').style.display = s.auth.code ? 'none' : ''; icons(); }
  async function authSubmit() {
    if (s.auth.busy) return; var email = document.getElementById('c-login-email').value.trim().toLowerCase(), password = document.getElementById('c-login-password').value, notice = stage.querySelector('[data-c-auth-notice]'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return notice.textContent = '请输入正确的邮箱地址。'; if (s.auth.code) return notice.textContent = '邮箱验证码登录暂未开放，请使用密码登录。'; if (s.auth.mode === 'register' && password.length < 6) return notice.textContent = '密码至少需要 6 位。'; s.auth.busy = true; try { var data = await backendRequest(s.auth.mode === 'register' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: { email: email, password: password, name: email.split('@')[0] } }); setBackendAuth(data); refreshChrome(); window.dispatchEvent(new CustomEvent('molan:auth-changed', { detail: data.user })); say('登录成功'); go('overview'); } catch (error) { notice.textContent = error.message || '登录失败'; say(error.message || '登录失败'); } finally { s.auth.busy = false; } }
  function legal(title, text) { openActionModal({ title: title, body: '<div class="article"><p>' + e(text) + '</p></div>', confirmText: '关闭', onConfirm: closeModal }); }

  function click(event) {
    var n = event.target.closest && event.target.closest('[data-c-action],[data-c-scope],[data-c-account-tab],[data-c-filter],[data-c-doc-id],[data-c-auth-mode],[data-c-skill-clear]');
    if (!n || (!stage.contains(n) && !n.closest('#modalBackdrop'))) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    var a = n.dataset.cAction;
    if (n.dataset.cScope) { s.skill.scope = n.dataset.cScope; s.skill.page = 1; n.parentElement.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === n); }); return loadSkills(); }
    if (n.dataset.cAccountTab) { s.account.tab = n.dataset.cAccountTab; renderAccount(); return; }
    if (n.dataset.cFilter) { n.parentElement.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === n); }); s.bill.page = 1; return renderBilling(); }
    if (n.dataset.cDocId) { s.docs.id = n.dataset.cDocId; return renderDocs(); }
    if (n.dataset.cAuthMode) { s.auth.mode = n.dataset.cAuthMode; s.auth.code = false; return renderAuth(); }
    if (n.dataset.cSkillClear !== undefined) { s.skill.importFiles = []; s.skill.importFilesTouched = true; return updateSkillImportView('已清空文件清单，可重新选择单个文件或文件夹。', ''); }
    if (a === 'skill-create') return editSkill('create'); if (a === 'skill-refresh' || a === 'skill-private-refresh') return loadSkills(a === 'skill-private-refresh'); if (a === 'skill-prev') { if (s.skill.page > 1) { s.skill.page--; loadSkills(); } return; } if (a === 'skill-next') { s.skill.page++; loadSkills(); return; } if (a === 'skill-detail') return skillDetail(n.dataset.id, false); if (a === 'skill-private-detail') return skillDetail(n.dataset.id, true); if (a === 'skill-download' || a === 'skill-download-detail') return downloadSkill(n.dataset.id); if (a === 'skill-edit') { var editVersion = ++s.skill.editVersion, editSession = sessionKey(); return backendRequest('/api/open-skills/' + encodeURIComponent(n.dataset.id)).then(function (x) { if (editVersion === s.skill.editVersion && currentSession(editSession)) editSkill('edit', x.skill); }).catch(function (x) { if (editVersion === s.skill.editVersion && currentSession(editSession)) say(x.message); }); } if (a === 'skill-status') { var statusSession = sessionKey(); return backendRequest('/api/open-skills/' + encodeURIComponent(n.dataset.id), { method: 'PATCH', body: { status: n.dataset.status } }).then(function () { if (!currentSession(statusSession)) return; return loadSkills(); }).then(function () { if (currentSession(statusSession)) say('Skill 状态已更新'); }).catch(function (x) { if (currentSession(statusSession)) say(x.message); }); } if (a === 'skill-sync') return syncSkill(n.dataset.id); if (a === 'skill-publish-draft') return saveSkill(true);
    if (a === 'tool-select') { s.tool.id = n.dataset.id; s.tool.result = ''; s.tool.accepted = false; return renderTools(); } if (a === 'tool-run') return runTool(); if (a === 'tool-cancel') { if (s.tool.controller) s.tool.controller.abort(); return; }
    if (a === 'tool-diff') {
      var origText = s.tool.original || s.tool.text || '';
      var revText = s.tool.result || '';
      var launchDiff = function () {
        if (typeof window.openDiffcheckerModal === 'function') {
          window.openDiffcheckerModal({ original: origText, revised: revText, title: '去 AI 味对比工具' });
        }
      };
      if (typeof window.openDiffcheckerModal === 'function') { launchDiff(); }
      else {
        var sTag = document.createElement('script');
        sTag.src = '/pages/diffchecker.js';
        sTag.onload = launchDiff;
        document.head.appendChild(sTag);
      }
      return;
    }
    if (a === 'tool-copy') return copyText(s.tool.result).then(function () { say(s.tool.id === 'deai' ? '已复制全文' : '结果已复制'); }); if (a === 'tool-accept') { var input = stage.querySelector('[data-c-tool-input]'); s.tool.original = s.tool.original || input.value; input.value = s.tool.result; s.tool.text = s.tool.result; s.tool.accepted = true; return renderTools(); } if (a === 'tool-undo') { var input2 = stage.querySelector('[data-c-tool-input]'); input2.value = s.tool.original; s.tool.text = s.tool.original; s.tool.accepted = false; return renderTools(); }
    if (a === 'bill-export') return exportBilling(); if (a === 'bill-topup') return topup(); if (a === 'bill-prev') { if (s.bill.page > 1) s.bill.page--; return renderBilling(); } if (a === 'bill-next') { s.bill.page++; return renderBilling(); }
    if (a === 'account-save') return saveAccount(); if (a === 'account-logout') return logout(false); if (a === 'account-logout-all') return logout(true); if (a === 'account-clear') { s.account.avatar = ''; return renderAccount(); }
    if (a === 'auth-password') { var p = document.getElementById('c-login-password'); p.type = p.type === 'password' ? 'text' : 'password'; n.textContent = p.type === 'password' ? '显示' : '隐藏'; return; } if (a === 'auth-code') { s.auth.code = true; renderAuth(); return say('邮箱验证码登录暂未开放，请使用密码登录'); } if (a === 'auth-forgot') return say('密码找回暂未开放，请使用已注册密码登录或联系管理员'); if (a === 'auth-terms') return legal('服务条款', '当前本地版本提供 AI 创作、积分记录和作品保存服务。请妥善保管账户凭证，充值按钮只提供测试额度，不产生真实支付。'); if (a === 'auth-privacy') return legal('隐私政策', '墨阑使用注册邮箱、登录记录、AI 使用记录和账户内作品数据来提供服务、结算积分并隔离不同用户的数据。私有作品不会被公开展示。'); if (a === 'docs-go') return go(n.dataset.pageTarget);
  }
  function input(event) { var n = event.target; if (n.dataset.cSearch === 'skill') { event.stopPropagation(); s.skill.q = n.value.trim(); clearTimeout(s.timer); s.timer = setTimeout(function () { s.skill.page = 1; loadSkills(); }, 220); } else if (n.dataset.cSearch === 'docs') { event.stopPropagation(); s.docs.q = n.value.trim(); renderDocs(); } else if (n.dataset.cToolInput !== undefined) { event.stopPropagation(); s.tool.text = n.value; var x = stage.querySelector('[data-c-tool-length]'); if (x) x.textContent = n.value.length.toLocaleString() + ' / 20,000 字'; } }
  function change(event) {
    var n = event.target;
    if (n.dataset.cSkillSort !== undefined) { event.stopPropagation(); s.skill.sort = n.value; s.skill.page = 1; loadSkills(); }
    else if (n.dataset.cDocCategory !== undefined) { event.stopPropagation(); s.docs.category = n.value; renderDocs(); }
    else if (n.dataset.cAvatarFile !== undefined && n.files[0]) { event.stopPropagation(); avatar(n.files[0]).then(function (x) { s.account.avatar = x; renderAccount(); say('头像已准备好，点击保存后生效'); }).catch(function (x) { say(x.message); }); }
    else if ((n.dataset.cSkillFile !== undefined || n.dataset.cSkillFolder !== undefined) && n.files && n.files.length) { event.stopPropagation(); void readSkillFiles(n.files); n.value = ''; }
  }
  function submit(event) { var f = event.target.closest && event.target.closest('[data-c-login]'); if (!f) return; event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); authSubmit(); }
  function after(page) {
    refreshChrome();
    if (page === 'skills') { renderSkills(); renderPrivateSkills(); loadSkills(); }
    if (page === 'tools') {
      if (typeof window !== 'undefined' && window.location) {
        window.location.href = './pages/tools.html';
        return;
      }
      renderTools();
      if (logged() && typeof loadBackendUsage === 'function') loadBackendUsage().then(renderTools);
    }
    if (page === 'billing') { renderBilling(); loadBilling(); } if (page === 'docs') renderDocs(); if (page === 'account') { s.account.avatar = backendState.user?.avatar || ''; renderAccount(); if (logged() && typeof loadBackendUsage === 'function') loadBackendUsage().then(renderAccount); } if (page === 'login') renderAuth(); icons(); }
  function install() {
    if (done) return; done = true;
    renderers.skills = skillsPage; renderers.tools = toolsPage; renderers.billing = billingPage; renderers.docs = docsPage; renderers.account = accountPage; renderers.login = loginPage;
    originalRenderPage = window.renderPage;
    window.renderPage = function (page, options) { var result = originalRenderPage(page, options); setTimeout(function () { after(currentPage); }, 0); return result; };
    document.addEventListener('click', click, true); document.addEventListener('input', input, true); document.addEventListener('change', change, true); document.addEventListener('submit', submit, true);
    window.addEventListener('molan:auth-changed', function () {
      s.skill.requestVersion += 1;
      s.skill.privateRequestVersion += 1;
      s.skill.detailVersion += 1;
      s.skill.editVersion += 1;
      s.skill.items = []; s.skill.private = []; s.skill.total = 0; s.skill.totalPages = 1; s.skill.loading = false;
      if (s.tool.controller) { try { s.tool.controller.abort(); } catch (_) {} }
      s.tool.busy = false; s.tool.controller = null; s.tool.result = ''; s.tool.accepted = false;
      refreshChrome(); after(currentPage);
    });
    window.renderPage(currentPage, { fromHistory: true });
  }
  window.MolanCompletionPlatform = { install: install };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
}());
