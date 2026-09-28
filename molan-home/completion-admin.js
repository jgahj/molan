(function () {
  'use strict';

  const state = {
    installed: false,
    view: 'overview',
    overview: null,
    overviewLoading: false,
    overviewError: '',
    overviewLoadSeq: 0,
    models: [],
    modelsLoaded: false,
    modelsError: '',
    modelsLoadSeq: 0,
    modelDraft: new Map(),
    defaultModel: '',
    defaultModelDraft: '',
    skills: [],
    skillsLoaded: false,
    skillsError: '',
    skillsLoadSeq: 0,
    skillTargets: ['all', 'generate', 'continue', 'rewrite', 'polish', 'chat', 'extract'],
    skillDraft: null,
    skillSnapshot: '',
    skillDirty: false,
    characterMaterialAudit: { loaded: false, loading: false, error: '', version: '', sampleCount: 0, threshold: 0.02, samples: [], published: false, approval: null },
    usersPage: 1,
    usersQuery: '',
    usersRole: 'all',
    data: {
      type: 'novels',
      page: 1,
      query: '',
      rows: [],
      pagination: null,
      loading: false,
      recordMeta: null,
      record: null,
      snapshot: '',
      editorText: ''
    },
    audit: [],
    auditLoaded: false,
    auditQuery: '',
    auditPage: 1,
    auditPageSize: 20,
    auditSearchTimer: null,
    dataSearchTimer: null,
    userSearchTimer: null,
    dataLoadSeq: 0,
    dataDetailSeq: 0
  };

  const viewTitles = {
    overview: '平台总览',
    users: '用户管理',
    models: '模型配置',
    skills: '全局 Skill',
    'character-material': '人物素材审批',
    data: '数据中心',
    audit: '审计日志'
  };

  const dataLabels = {
    novels: '作品',
    accounts: '账户',
    'user-skills': '用户 Skill',
    'global-skills': '全局 Skill',
    'open-skills': '开放 Skill',
    'builtin-skills': '内置 Skill',
    'token-usage': 'Token 记录',
    dissections: '拆书任务'
  };

  const roleLabels = { admin: '管理员', vip: 'VIP 用户', normal: '普通用户' };
  const auditActionLabels = { 'character-material.approve': '发布人物素材 strong', 'character-material.review': '保存人物素材抽检' };
  const targetLabels = {
    all: '全部入口',
    generate: '正文生成',
    continue: '续写',
    rewrite: '改写',
    polish: '润色',
    chat: 'AI 对话',
    extract: '设定抽取'
  };

  function html(value) {
    return escapeBackendHtml(value == null ? '' : value);
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function count(value) {
    return Math.max(0, number(value)).toLocaleString('zh-CN');
  }

  function credits(value) {
    if (value == null || value === '') return '无限';
    return Math.max(0, number(value)).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
  }

  function date(value) {
    if (!value) return '—';
    const parsed = new Date(Number(value) || value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
  }

  function percent(value) {
    const raw = number(value);
    const normalized = raw <= 1 ? raw * 100 : raw;
    return `${normalized.toFixed(1)}%`;
  }

  function clone(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }

  function jsonText(value) {
    try { return JSON.stringify(value == null ? {} : value, null, 2); } catch (_) { return '{}'; }
  }

  function skillFormFingerprint(value) {
    const source = value || {};
    const targets = Array.isArray(source.targets) && source.targets.length ? source.targets : ['all'];
    return JSON.stringify({
      id: String(source.id || ''),
      name: String(source.name || ''),
      description: String(source.description || ''),
      instruction: String(source.instruction || ''),
      targets: [...new Set(targets.map(target => String(target)))].sort(),
      enabled: source.enabled !== false
    });
  }

  function captureSkillForm() {
    const form = stage && stage.querySelector('[data-admin-skill-form]');
    if (!form) return null;
    const current = collectSkillForm(form);
    const fingerprint = skillFormFingerprint(current);
    if (!state.skillSnapshot) state.skillSnapshot = fingerprint;
    state.skillDirty = fingerprint !== state.skillSnapshot;
    if (state.skillDirty) state.skillDraft = current;
    return current;
  }

  function confirmDiscardSkillChanges(callback) {
    captureSkillForm();
    if (!state.skillDirty) return callback();
    openActionModal({
      title: '放弃未保存的 Skill 修改？',
      body: '<p class="section-note">当前 Skill 有未保存修改，继续操作会丢失这些内容。</p>',
      confirmText: '放弃修改',
      cancelText: '继续编辑',
      onConfirm: () => {
        state.skillDirty = false;
        state.skillSnapshot = '';
        closeModal();
        callback();
      }
    });
  }

  function adminShell(body, extra = '') {
    return `<div class="page-shell ${extra}">
      <div class="page-header">
        <div><div class="eyebrow">ADMIN CONSOLE</div><h1 class="page-title">${html(viewTitles[state.view] || '管理后台')}</h1><p class="page-subtitle">管理员专属数据与策略管理。</p></div>
        <div class="header-tools"><span class="badge amber">管理员权限</span></div>
      </div>${body}
    </div>`;
  }

  function adminLoginPage() {
    return `<div class="page-shell admin-login-page">
      <div class="page-header"><div><div class="eyebrow">ADMIN CONSOLE</div><h1 class="page-title">管理员登录</h1><p class="page-subtitle">独立的管理入口，用于平台账户、模型倍率和全局 Skill 的管理。</p></div></div>
      <div class="admin-login">
        <section class="admin-login-aside"><div><div style="display:flex;align-items:center;gap:9px"><span class="brand-mark">墨</span><strong style="font-family:var(--serif);font-size:16px">墨阑管理台</strong></div><h2>管理创作平台。</h2><p>集中管理账户、模型倍率与全局 Skill，让每一次创作服务都可控、可追踪。</p></div><footer>ADMIN CONSOLE · INTERNAL USE ONLY</footer></section>
        <section class="admin-login-form"><form class="admin-login-form-inner" data-admin-login-form>
          <span class="admin-lock">${icon('shield-check')}</span><h1>登录管理后台</h1><p>只有管理员账户可以访问平台管理数据。</p>
          <div class="form-grid"><div class="field"><label for="completionAdminEmail">管理员邮箱</label><input id="completionAdminEmail" type="email" autocomplete="username" placeholder="admin@example.com" required></div><div class="field"><label for="completionAdminPassword">管理密码</label><input id="completionAdminPassword" type="password" autocomplete="current-password" placeholder="请输入管理密码" required></div></div>
          <div class="admin-form-footer"><label class="check"><input type="checkbox" checked> 保持登录</label><span>服务端权限校验</span></div>
          <button class="button primary" style="width:100%;margin-top:22px" type="submit" data-admin-login-submit>进入管理后台 ${icon('arrow-right')}</button>
          <div class="notice" style="margin-top:18px">${icon('info')}<span data-admin-login-notice>登录请求会发送到当前后端，并只接受管理员账户。</span></div>
        </form></section>
      </div>
    </div>`;
  }

  function navButton(view, label, iconName) {
    return `<button type="button" class="${state.view === view ? 'active' : ''}" data-admin-view="${view}">${icon(iconName)}${label}</button>`;
  }

  function adminPage() {
    return adminShell(`<div class="admin-dashboard">
      <aside class="admin-nav">
        <div class="admin-nav-brand"><span class="brand-mark">墨</span><strong>墨阑管理台</strong></div>
        <div class="admin-nav-group"><div class="admin-nav-label">平台</div>${navButton('overview', '总览', 'layout-dashboard')}${navButton('users', '用户管理', 'users')}${navButton('models', '模型配置', 'cpu')}</div>
        <div class="admin-nav-group"><div class="admin-nav-label">内容</div>${navButton('skills', '全局 Skill', 'sparkles')}${navButton('character-material', '人物素材审批', 'shield-check')}${navButton('data', '数据中心', 'database')}${navButton('audit', '审计日志', 'scroll-text')}</div>
        <div class="admin-nav-group"><div class="admin-nav-label">会话</div><button type="button" data-admin-refresh>${icon('refresh-cw')}刷新数据</button><button type="button" data-admin-logout>${icon('log-out')}退出后台</button></div>
      </aside>
      <section class="admin-main"><div class="admin-top"><div><div class="eyebrow">ADMIN CONSOLE</div><h2>${html(viewTitles[state.view] || '管理后台')}</h2></div><span class="badge green">服务端数据</span></div><div id="completion-admin-content">${renderViewBody()}</div></section>
    </div>`, 'admin-page');
  }

  function loadingPanel(text = '正在读取服务端数据…') {
    return `<section class="panel"><div class="panel-body"><div class="empty"><div class="empty-icon">…</div><h3>${html(text)}</h3><p>数据返回后会显示在当前管理模块。</p></div></div></section>`;
  }

  function errorPanel(message, action = 'admin-refresh') {
    return `<section class="panel"><div class="panel-body"><div class="empty"><div class="empty-icon">!</div><h3>数据读取失败</h3><p>${html(message || '服务端暂时不可用')}</p><button type="button" class="button" data-admin-action="${action}">${icon('refresh-cw')}重新读取</button></div></div></section>`;
  }

  function metric(label, value, foot, tone = '') {
    return `<div class="metric"><div class="metric-label">${html(label)}</div><div class="metric-value">${html(value)}</div><div class="metric-foot ${tone}">${html(foot)}</div></div>`;
  }

  function renderOverview() {
    if (state.overviewLoading && !state.overview) return loadingPanel();
    if (!state.overview && state.overviewError) return errorPanel(state.overviewError);
    if (!state.overview) return errorPanel('尚未加载概览数据。');
    const data = state.overview;
    const stats = data.stats || {};
    const usage = data.usage || {};
    const material = state.characterMaterialAudit || {};
    const materialApproval = material.approval || {};
    const materialReviewedCount = Array.isArray(materialApproval.reviewedIds) ? new Set(materialApproval.reviewedIds.map(String)).size : 0;
    const materialAutoReviewed = materialApproval.approvalMode === 'agent';
    const materialStatus = material.published ? (materialAutoReviewed ? 'strong 已发布 · 自动复核' : 'strong 已发布') : material.loaded && !material.loading && !material.error ? `${count(materialReviewedCount)} / ${count(material.sampleCount)} 条已检查` : '打开审批清单查看';
    const materialCopy = material.error ? material.error : material.published ? 'strong 样本已完成逐条复核；每次引用前仍会由当前模型再次检查语境和文本错误。' : material.loaded && !material.loading ? '完成样本检查并剔除问题样本后，才能发布 strong 原文样本。' : 'strong 原文样本需要完成复核后才能启用。';
    const total = Math.max(1, number(stats.totalUsers));
    const roleRows = [
      ['普通用户', number(stats.normalUsers), 'normal'],
      ['VIP 用户', number(stats.vipUsers), 'vip'],
      ['管理员', number(stats.adminUsers), 'admin']
    ];
    const audit = Array.isArray(data.audit) ? data.audit.slice(0, 8) : [];
    return `<div class="grid grid-4">
      ${metric('注册用户', count(stats.totalUsers), '当前账户总数')}
      ${metric('VIP 用户', count(stats.vipUsers), '按当前权限统计')}
      ${metric('累计 Token', count(stats.totalTokens), `${count(stats.requestCount)} 次模型请求`)}
      ${metric('累计积分消耗', credits(stats.creditSpent), `缓存命中 ${percent(stats.cacheHitRate)}`, 'good')}
    </div>
    <section class="panel" style="margin-top:14px"><div class="panel-heading"><div><h2>strong 原文样本审批</h2><p>${html(materialCopy)}</p></div><span class="badge ${material.published ? 'green' : 'amber'}">${html(materialStatus)}</span></div><div class="panel-body" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap"><span class="section-note">审批清单只展示匿名化样本和来源哈希，不会把原始来源发送给模型。</span><button type="button" class="button primary" data-admin-view="character-material">进入审批清单 ${icon('arrow-up-right')}</button></div></section>
    <div class="grid grid-2" style="margin-top:14px">
      <section class="panel"><div class="panel-heading"><div><h2>平台用量</h2><p>来自服务端 Token 使用记录的累计汇总。</p></div><span class="badge blue">实时读取</span></div><div class="panel-body"><div class="mini-list" style="margin-top:0"><div class="mini-list-row"><span>输入 Token</span><strong>${count(usage.promptTokens)}</strong></div><div class="mini-list-row"><span>输出 Token</span><strong>${count(usage.completionTokens)}</strong></div><div class="mini-list-row"><span>推理 Token</span><strong>${count(usage.reasoningTokens)}</strong></div><div class="mini-list-row"><span>缓存 Token</span><strong>${count(usage.cachedTokens)}</strong></div><div class="mini-list-row"><span>精确计费请求</span><strong>${count(usage.preciseRequestCount)}</strong></div><div class="mini-list-row"><span>待结算请求</span><strong>${count(usage.usageUnavailableCount)}</strong></div></div></div></section>
      <section class="panel"><div class="panel-heading"><div><h2>账户分布</h2><p>等级决定模型权限和积分倍率。</p></div><span class="panel-kicker">${count(stats.totalUsers)} 个账户</span></div><div class="panel-body"><div class="mini-list" style="margin-top:0">${roleRows.map(([label, value, tone]) => `<div class="mini-list-row"><span>${label}</span><strong>${count(value)} · ${(value / total * 100).toFixed(1)}%</strong></div><div class="progress"><span style="width:${Math.min(100, value / total * 100)}%;${tone === 'vip' ? 'background:#6885a7' : tone === 'admin' ? 'background:#a86b20' : ''}"></span></div>`).join('')}</div></div></section>
    </div>
    <section class="panel" style="margin-top:14px"><div class="panel-heading"><div><h2>最近操作</h2><p>管理员对平台数据和策略的真实变更记录。</p></div><button type="button" class="button" data-admin-view="audit">查看全部 ${icon('arrow-up-right')}</button></div><div class="panel-body table-wrap"><table class="data-table"><thead><tr><th>时间</th><th>管理员</th><th>操作</th><th>目标</th><th></th></tr></thead><tbody>${audit.length ? audit.map(auditRow).join('') : '<tr><td colspan="5">暂无审计记录</td></tr>'}</tbody></table></div></section>`;
  }

  function auditRow(item) {
    return `<tr><td>${html(date(item.createdAt))}</td><td>${html(item.adminEmail || '—')}</td><td><strong>${html(auditActionLabels[item.action] || item.action || '—')}</strong></td><td>${html(item.target || '—')}</td><td><button type="button" class="button" data-admin-audit-detail="${html(item.id)}">查看</button></td></tr>`;
  }

  function pagination(page, totalPages, attr) {
    const current = Math.max(1, number(page, 1));
    const total = Math.max(1, number(totalPages, 1));
    if (total <= 1) return '';
    return `<div class="section-toolbar" style="justify-content:flex-end"><button type="button" class="button" data-${attr}-page="prev" ${current <= 1 ? 'disabled' : ''}>上一页</button><span class="toolbar-result">第 ${current} / ${total} 页</span><button type="button" class="button" data-${attr}-page="next" ${current >= total ? 'disabled' : ''}>下一页</button></div>`;
  }

  function renderUsers() {
    const data = state.overview;
    if (state.overviewLoading && !data) return loadingPanel();
    if (!data) return errorPanel('尚未加载用户数据。');
    const rows = Array.isArray(data.users) ? data.users : [];
    const pageInfo = data.pagination || {};
    return `<div class="section-toolbar"><div class="search-box">${icon('search')}<input type="search" value="${html(state.usersQuery)}" placeholder="搜索邮箱或用户名称" data-admin-users-search></div><select data-admin-users-role aria-label="筛选用户等级"><option value="all" ${state.usersRole === 'all' ? 'selected' : ''}>全部等级</option><option value="admin" ${state.usersRole === 'admin' ? 'selected' : ''}>管理员</option><option value="vip" ${state.usersRole === 'vip' ? 'selected' : ''}>VIP 用户</option><option value="normal" ${state.usersRole === 'normal' ? 'selected' : ''}>普通用户</option></select><span class="toolbar-result">共 ${count(pageInfo.total)} 个账户</span></div>
      <section class="panel"><div class="panel-heading"><div><h2>账户列表</h2><p>可查看 Token、积分消耗，并修改名称、等级和积分余额。</p></div><span class="badge blue">第 ${number(pageInfo.page, 1)} 页</span></div><div class="panel-body table-wrap"><table class="data-table"><thead><tr><th>账户</th><th>等级</th><th>积分余额</th><th>Token 使用</th><th>积分消耗</th><th>注册时间</th><th></th></tr></thead><tbody>${rows.length ? rows.map(userRow).join('') : '<tr><td colspan="7">没有匹配的账户</td></tr>'}</tbody></table></div></section>${pagination(pageInfo.page, pageInfo.totalPages, 'admin-users')}`;
  }

  function userRow(user) {
    const usage = user.tokenUsage || {};
    return `<tr><td><strong>${html(user.email)}</strong><small>${html(user.name || '未设置名称')}</small></td><td><span class="badge ${user.role === 'admin' ? 'amber' : user.role === 'vip' ? 'blue' : 'gray'}">${html(roleLabels[user.role] || user.role || '普通用户')}</span></td><td>${html(credits(user.credits))}</td><td>${count(usage.totalTokens)}<small>${count(usage.requestCount)} 次请求</small></td><td>${html(credits(user.creditSpent))}</td><td>${html(date(user.createdAt))}</td><td><button type="button" class="button" data-admin-user-edit="${html(user.email)}">编辑</button></td></tr>`;
  }

  function modelRate(model) {
    const draft = state.modelDraft.get(model.id);
    return draft == null ? number(model.creditsPer1k).toFixed(4) : String(draft);
  }

  function renderModels() {
    if (state.modelsError) return errorPanel(state.modelsError);
    if (!state.modelsLoaded) return loadingPanel('正在读取模型配置…');
    if (!state.models.length) return errorPanel('服务端没有返回可用模型。');
    const selectedDefault = state.defaultModelDraft || state.defaultModel;
    const groups = [];
    const byGroup = new Map();
    state.models.forEach(model => {
      const group = String(model.group || model.provider || '未分组');
      if (!byGroup.has(group)) { byGroup.set(group, []); groups.push([group, byGroup.get(group)]); }
      byGroup.get(group).push(model);
    });
    return `<div class="grid grid-2"><section class="panel"><div class="panel-heading"><div><h2>普通用户默认模型</h2><p>只影响普通用户；VIP 和管理员仍可在创作空间中自行选择。</p></div><span class="badge blue">平台策略</span></div><div class="panel-body"><div class="field"><label for="completionAdminDefaultModel">默认模型</label><select id="completionAdminDefaultModel" data-admin-default-model>${state.models.map(model => `<option value="${html(model.id)}" ${model.id === selectedDefault ? 'selected' : ''}>${html(model.name || model.id)} · ${html(model.provider || '')}</option>`).join('')}</select></div><div class="notice" style="margin-top:14px">${icon('info')}<span>模型密钥只保留在后端，当前页面只读取模型元数据和倍率。</span></div></div></section><section class="panel"><div class="panel-heading"><div><h2>批量保存策略</h2><p>所有模型倍率会先在浏览器端完整校验，再一次性提交到服务端。</p></div><button type="button" class="button primary" data-admin-model-save>${icon('save')}保存全部配置</button></div><div class="panel-body"><div class="mini-list" style="margin-top:0"><div class="mini-list-row"><span>模型数量</span><strong>${count(state.models.length)}</strong></div><div class="mini-list-row"><span>默认模型</span><strong>${html(state.models.find(model => model.id === selectedDefault)?.name || selectedDefault || '未设置')}</strong></div><div class="mini-list-row"><span>计价单位</span><strong>每 1,000 Token</strong></div></div></div></section></div><div class="grid grid-2" style="margin-top:14px">${groups.map(([group, models]) => `<section class="panel"><div class="panel-heading"><div><h2>${html(group)}</h2><p>${count(models.length)} 个模型 · ${html(models[0]?.provider || '平台')}</p></div><span class="badge green">服务端配置</span></div><div class="panel-body table-wrap"><table class="data-table"><thead><tr><th>模型</th><th>模型 ID</th><th>积分倍率</th><th>能力</th></tr></thead><tbody>${models.map(model => `<tr><td><strong>${html(model.name || model.id)}</strong></td><td><small>${html(model.id)}</small></td><td><input class="table-input" type="number" min="0.01" max="1000" step="0.0001" value="${html(modelRate(model))}" data-model-rate data-model-id="${html(model.id)}" aria-label="${html(model.name || model.id)} 积分倍率"></td><td>${model.supportsReasoning ? '<span class="badge blue">支持推理</span>' : '<span class="badge gray">标准对话</span>'}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>`;
  }

  function skillTargets(skill) {
    const targets = Array.isArray(skill && skill.targets) && skill.targets.length ? skill.targets : ['all'];
    return targets.includes('all') ? ['all'] : targets;
  }

  function renderSkills() {
    if (state.skillsError) return errorPanel(state.skillsError);
    if (!state.skillsLoaded) return loadingPanel('正在读取全局 Skill…');
    const draft = state.skillDraft || { name: '', description: '', instruction: '', targets: ['all'], enabled: true, source: 'global', editable: true };
    const builtin = draft.source === 'builtin' || draft.editable === false;
    const selected = skillTargets(draft);
    return `<div class="grid grid-2"><section class="panel"><div class="panel-heading"><div><h2>Skill 库</h2><p>全局 Skill 会同步到匹配的创作入口，内置 Skill 仅可复制。</p></div><button type="button" class="button primary" data-admin-skill-new>${icon('plus')}新建 Skill</button></div><div class="panel-body"><div class="private-list">${state.skills.length ? state.skills.map(skill => `<button type="button" class="private-skill" data-admin-skill-select="${html(skill.id)}"><span>${icon('sparkles')}</span><span>${html(skill.name || skill.id)}<small>${html(skill.source === 'builtin' ? '内置 Skill · 只读' : `全局 Skill · ${skill.enabled === false ? '已停用' : '已启用'}`)}</small></span></button>`).join('') : '<div class="empty"><div class="empty-icon">—</div><p>暂无全局或内置 Skill。</p></div>'}</div></div></section><section class="panel"><div class="panel-heading"><div><h2>${html(builtin ? '查看内置 Skill' : (draft.id ? '编辑全局 Skill' : '新建全局 Skill'))}</h2><p>${html(builtin ? '内置 Skill 为只读内容，可复制为全局 Skill 后修改。' : '编辑名称、指令、适用入口和启用状态。')}</p></div><span class="badge ${builtin ? 'gray' : 'blue'}">${builtin ? '只读' : (draft.id ? '编辑' : '新建')}</span></div><form class="panel-body" data-admin-skill-form><input type="hidden" value="${html(draft.id || '')}" data-skill-id><div class="field"><label>Skill 名称</label><input type="text" maxlength="120" value="${html(draft.name || '')}" data-skill-name ${builtin ? 'readonly' : ''} required></div><div class="field"><label>描述</label><input type="text" maxlength="500" value="${html(draft.description || '')}" data-skill-description ${builtin ? 'readonly' : ''}></div><div class="field"><label>指令内容</label><textarea rows="13" maxlength="200000" data-skill-instruction ${builtin ? 'readonly' : ''} required>${html(draft.instruction || '')}</textarea></div><fieldset><legend>适用入口</legend><div class="target-grid">${state.skillTargets.map(target => `<label><input type="checkbox" name="completion-skill-target" value="${html(target)}" ${selected.includes(target) ? 'checked' : ''} ${builtin ? 'disabled' : ''}>${html(targetLabels[target] || target)}</label>`).join('')}</div></fieldset><label class="switch-row"><span><strong>启用 Skill</strong><small>停用后不会注入新的 AI 请求。</small></span><input type="checkbox" data-skill-enabled ${draft.enabled !== false ? 'checked' : ''} ${builtin ? 'disabled' : ''}><i class="switch-ui"></i></label><div class="form-actions">${builtin ? `<button type="button" class="button" data-admin-skill-clone>${icon('copy')}复制为全局 Skill</button>` : `<button type="button" class="button" data-admin-skill-reset>重置</button><button type="submit" class="button primary" data-admin-skill-save>${icon('save')}保存 Skill</button>`}</div></form></section></div>`;
  }

  /** Render the administrator checklist for publishing strong character samples. */
  function renderCharacterMaterialAudit() {
    const audit = state.characterMaterialAudit;
    if (audit.loading && !audit.loaded) return loadingPanel('正在读取人物素材抽检清单…');
    if (audit.error) return errorPanel(audit.error, 'admin-material-refresh');
    const samples = Array.isArray(audit.samples) ? audit.samples : [];
    if (!samples.length) return errorPanel('当前版本没有可供抽检的人物素材样本，请先重新构建索引。', 'admin-material-refresh');
    const approval = audit.approval || {};
    const reviewed = new Set(Array.isArray(approval.reviewedIds) ? approval.reviewedIds.map(String) : []);
    const residual = new Set(Array.isArray(approval.excludedIds) ? approval.excludedIds.map(String) : (Array.isArray(approval.residualIds) ? approval.residualIds.map(String) : []));
    const reviewedCount = samples.filter(sample => reviewed.has(String(sample.id))).length;
    const residualCount = samples.filter(sample => residual.has(String(sample.id))).length;
    const publishableCount = samples.length - residualCount;
    const unresolvedResidualCount = Number.isFinite(Number(audit.residualCount)) ? Number(audit.residualCount) : samples.filter(sample => !residual.has(String(sample.id)) && sample.residualTerms && sample.residualTerms.length).length;
    const rate = Number.isFinite(Number(audit.residualRate)) ? Number(audit.residualRate) : (publishableCount ? unresolvedResidualCount / publishableCount : 1);
    const autoReviewed = approval.approvalMode === 'agent';
    const status = audit.published ? `<span class="badge green">strong 已发布${autoReviewed ? ' · 自动复核' : ''}</span>` : '<span class="badge amber">待复核</span>';
    const guidance = audit.published
      ? '当前发布集已完成逐条复核；每次引用前仍会由当前选定模型再次检查语境和文本错误。'
      : '已剔除的问题样本不会进入发布集，剩余样本完成检查后才会启用 strong。';
    return `<div class="character-material-audit"><section class="panel"><div class="panel-heading"><div><h2>strong 原文样本审批</h2><p>${guidance}</p></div>${status}</div><div class="grid grid-4 character-material-audit-stats"><div class="mini-list-row"><span>索引版本</span><strong>${html(audit.version)}</strong></div><div class="mini-list-row"><span>已检查</span><strong data-material-reviewed-count>${reviewedCount} / ${samples.length}</strong></div><div class="mini-list-row"><span>已剔除</span><strong data-material-residual-count>${residualCount} 条已剔除</strong></div><div class="mini-list-row"><span>可发布</span><strong data-material-publishable-count>${publishableCount} 条</strong><small data-material-residual-rate>剩余残留率 ${(rate * 100).toFixed(1)}%</small></div></div><div class="notice" style="margin-top:14px">${icon('shield-check')}<span>已剔除样本不计入发布集残留率；每次 strong 引用仍会逐条调用当前模型做语境与错误复核，复核不通过就不会注入。</span></div><div class="form-actions character-material-audit-actions"><button type="button" class="button" data-admin-material-action="mark-all">全部标记为已检查</button><button type="button" class="button" data-admin-material-action="clear">清除本页标记</button><button type="button" class="button" data-admin-material-action="save">保存抽检结果</button>${audit.published ? '<button type="button" class="button data-danger-btn" data-admin-material-action="revoke">撤销 strong 发布</button>' : '<button type="button" class="button primary" data-admin-material-action="approve">复核通过并发布 strong</button>'}</div></section><section class="panel"><div class="panel-heading"><div><h2>抽检清单</h2><p>来源仅保留内部哈希，不会传给模型。</p></div><span class="badge blue">${samples.length} 条</span></div><div class="character-material-audit-list">${samples.map(sample => { const id = String(sample.id); const isReviewed = reviewed.has(id); const hasResidual = residual.has(id); return `<article class="character-material-audit-card ${hasResidual ? 'is-residual' : ''}"><div class="character-material-audit-card-head"><div><strong>${html(id)}</strong><small>${html(sample.archetype || '通用')} · ${html(sample.dimension || '未分类')} · ${sample.corpus === 'mature' ? '成熟索引' : '通用索引'}</small></div><div class="character-material-audit-checks"><label><input type="checkbox" data-material-reviewed-id="${html(id)}" ${isReviewed ? 'checked' : ''}>已检查</label><label><input type="checkbox" data-material-residual-id="${html(id)}" ${hasResidual ? 'checked' : ''}>有专名残留</label></div></div><p>${html(sample.text)}</p>${sample.residualTerms && sample.residualTerms.length ? `<small class="character-material-audit-hint">自动检测提示：${html(sample.residualTerms.join('、'))}</small>` : ''}<small class="character-material-audit-source">来源哈希：${html(sample.sourceHash || '—')}</small></article>`; }).join('')}</div></section></div>`;
  }

  /** Update approval counters without discarding the administrator's checklist state. */
  function updateCharacterMaterialAuditSummary() {
    const samples = state.characterMaterialAudit.samples || [];
    const reviewed = new Set([...stage.querySelectorAll('[data-material-reviewed-id]:checked')].map(input => input.dataset.materialReviewedId));
    const residual = new Set([...stage.querySelectorAll('[data-material-residual-id]:checked')].map(input => input.dataset.materialResidualId));
    const publishableCount = samples.filter(sample => !residual.has(String(sample.id))).length;
    const unresolvedResidualCount = samples.filter(sample => !residual.has(String(sample.id)) && sample.residualTerms && sample.residualTerms.length).length;
    const rate = publishableCount ? unresolvedResidualCount / publishableCount : 1;
    const reviewedEl = stage.querySelector('[data-material-reviewed-count]');
    const residualEl = stage.querySelector('[data-material-residual-count]');
    const publishableEl = stage.querySelector('[data-material-publishable-count]');
    const rateEl = stage.querySelector('[data-material-residual-rate]');
    if (reviewedEl) reviewedEl.textContent = `${reviewed.size} / ${samples.length}`;
    if (residualEl) residualEl.textContent = `${residual.size} 条已剔除`;
    if (publishableEl) publishableEl.textContent = `${publishableCount} 条`;
    if (rateEl) rateEl.textContent = `剩余残留率 ${(rate * 100).toFixed(1)}%`;
    stage.querySelectorAll('[data-material-residual-id]').forEach(input => input.closest('.character-material-audit-card')?.classList.toggle('is-residual', input.checked));
  }

  /** Load the current server-side character-material approval checklist. */
  async function loadCharacterMaterialAudit() {
    if (!backendState.adminToken) return showLogin();
    const audit = state.characterMaterialAudit;
    audit.loading = true;
    audit.error = '';
    if (isAdminPageVisible()) rerenderContent();
    try {
      const response = await adminRequest('/api/admin/character-material/audit');
      Object.assign(audit, response, { loaded: true, loading: false, error: '' });
      if (isAdminPageVisible()) rerenderContent();
    } catch (error) {
      audit.loading = false;
      audit.loaded = true;
      audit.error = error?.message || '人物素材审批清单读取失败';
      handleAdminError(error, '人物素材审批清单读取失败');
      if (isAdminPageVisible()) rerenderContent();
    }
  }

  /** Save review marks or publish/revoke the strong corpus through the admin API. */
  async function submitCharacterMaterialAudit(approved) {
    const samples = state.characterMaterialAudit.samples || [];
    const reviewedIds = [...stage.querySelectorAll('[data-material-reviewed-id]:checked')].map(input => input.dataset.materialReviewedId);
    const residualIds = [...stage.querySelectorAll('[data-material-residual-id]:checked')].map(input => input.dataset.materialResidualId);
    if (approved && reviewedIds.length !== samples.length) return showToast(`还有 ${samples.length - reviewedIds.length} 条样本未标记为已检查`);
    const button = stage.querySelector(`[data-admin-material-action="${approved ? 'approve' : 'save'}"]`);
    if (button) button.disabled = true;
    try {
      const response = await adminRequest('/api/admin/character-material/audit', { method: 'PATCH', body: { approved, reviewedIds, residualIds } });
      Object.assign(state.characterMaterialAudit, response, { loaded: true, loading: false, error: '' });
      rerenderContent();
      showToast(approved ? 'strong 人物素材已审批并发布' : '抽检结果已保存');
    } catch (error) { handleAdminError(error, approved ? 'strong 发布失败' : '抽检结果保存失败'); }
    finally { if (button) button.disabled = false; }
  }

  function renderData() {
    const type = state.data.type;
    const rows = state.data.rows || [];
    const pageInfo = state.data.pagination || {};
    const meta = state.data.recordMeta;
    const record = state.data.record;
    const readonly = type === 'builtin-skills';
    const editorText = state.data.editorText || (record ? jsonText(record) : '');
    const dirty = Boolean(meta && editorText !== state.data.snapshot);
    let editorState = meta ? (readonly ? '只读' : dirty ? '有未保存修改' : '已加载') : '未选择';
    if (meta && editorText && !parseJson(editorText)) editorState = 'JSON 无效';
    return `<div class="section-toolbar data-toolbar"><label class="field" style="margin:0;min-width:150px"><span>数据类型</span><select data-admin-data-type>${Object.keys(dataLabels).map(key => `<option value="${key}" ${key === type ? 'selected' : ''}>${dataLabels[key]}</option>`).join('')}</select></label><div class="search-box">${icon('search')}<input type="search" value="${html(state.data.query)}" placeholder="搜索名称、邮箱或记录 ID" data-admin-data-search></div><button type="button" class="button" data-admin-data-refresh>${icon('refresh-cw')}刷新</button><span class="toolbar-result">共 ${count(pageInfo.total)} 条</span></div><div class="grid grid-2"><section class="panel"><div class="panel-heading"><div><h2>${html(dataLabels[type])}数据</h2><p>选择记录后读取完整 JSON，保存和删除均由服务端校验。</p></div><span class="badge blue">第 ${number(pageInfo.page, 1)} 页</span></div><div class="panel-body table-wrap"><table class="data-table"><thead><tr><th>名称 / ID</th><th>所属账户</th><th>状态</th><th>更新时间</th><th></th></tr></thead><tbody>${state.data.loading ? '<tr><td colspan="5">正在读取…</td></tr>' : rows.length ? rows.map(dataRow).join('') : '<tr><td colspan="5">暂无匹配数据</td></tr>'}</tbody></table></div>${pagination(pageInfo.page, pageInfo.totalPages, 'admin-data')}</section><section class="panel"><div class="panel-heading"><div><h2>${html(meta ? (record?.title || record?.name || record?.email || record?.id || '记录详情') : '记录详情')}</h2><p>${html(meta ? `${dataLabels[type]} · ${record?.owner || record?.userEmail || record?.email || meta.owner || ''}` : '从左侧选择一条记录')}</p></div><span class="badge ${readonly ? 'gray' : dirty ? 'amber' : 'blue'}">${html(editorState)}</span></div><div class="panel-body"><div class="data-change-summary" data-admin-data-summary ${!meta ? 'hidden' : ''}>${html(editorState)}</div><textarea class="data-json-editor" spellcheck="false" data-admin-data-editor ${!meta || readonly ? 'disabled' : ''} placeholder="选择记录后显示 JSON">${html(editorText)}</textarea><div class="form-actions"><button type="button" class="button" data-admin-data-reset ${!meta || readonly ? 'disabled' : ''}>撤销修改</button><button type="button" class="button" data-admin-data-clone ${!meta || !readonly ? 'disabled' : ''}>复制为全局 Skill</button><button type="button" class="button" data-admin-data-delete ${!meta || readonly || ['accounts', 'token-usage'].includes(type) ? 'disabled' : ''}>删除记录</button><button type="button" class="button primary" data-admin-data-save ${!meta || readonly || !dirty || !parseJson(editorText) ? 'disabled' : ''}>${icon('save')}保存数据</button></div></div></section></div>`;
  }

  function dataRow(row) {
    const skillId = state.data.type === 'user-skills' ? row.id : '';
    return `<tr><td><strong>${html(row.title || row.id)}</strong><small>${html(row.id)}</small></td><td>${html(row.owner || '—')}</td><td><span class="badge ${/启用|published|completed|可用/.test(String(row.status || '')) ? 'green' : 'gray'}">${html(row.status || '—')}</span><small>${html(row.summary || '')}</small></td><td>${html(date(row.updatedAt))}</td><td><button type="button" class="button" data-admin-data-select="${html(row.id)}" data-admin-data-owner="${html(row.owner || '')}" data-admin-data-skill-id="${html(skillId)}">查看</button></td></tr>`;
  }

  function filteredAudit() {
    const query = state.auditQuery.trim().toLowerCase();
    if (!query) return state.audit;
    return state.audit.filter(item => [item.adminEmail, item.action, item.target, item.id, JSON.stringify(item.detail || {})].join(' ').toLowerCase().includes(query));
  }

  function renderAudit() {
    if (!state.auditLoaded) return loadingPanel('正在读取审计日志…');
    const rows = filteredAudit();
    const totalPages = Math.max(1, Math.ceil(rows.length / state.auditPageSize));
    state.auditPage = Math.min(Math.max(1, state.auditPage), totalPages);
    const pageRows = rows.slice((state.auditPage - 1) * state.auditPageSize, state.auditPage * state.auditPageSize);
    return `<div class="section-toolbar"><div class="search-box">${icon('search')}<input type="search" value="${html(state.auditQuery)}" placeholder="筛选管理员、操作或目标" data-admin-audit-search></div><button type="button" class="button" data-admin-audit-refresh>${icon('refresh-cw')}刷新</button><button type="button" class="button" data-admin-audit-export>${icon('download')}导出当前结果</button><span class="toolbar-result">共 ${count(rows.length)} 条</span></div><section class="panel"><div class="panel-heading"><div><h2>管理员操作记录</h2><p>审计接口返回的真实记录，详情可展开查看。</p></div><span class="badge blue">最多保留 200 条</span></div><div class="panel-body table-wrap"><table class="data-table"><thead><tr><th>时间</th><th>管理员</th><th>操作</th><th>目标</th><th></th></tr></thead><tbody>${pageRows.length ? pageRows.map(auditRow).join('') : '<tr><td colspan="5">没有匹配的审计记录</td></tr>'}</tbody></table></div></section>${pagination(state.auditPage, totalPages, 'admin-audit')}`;
  }

  function renderViewBody() {
    if (state.view === 'overview') return renderOverview();
    if (state.view === 'users') return renderUsers();
    if (state.view === 'models') return renderModels();
    if (state.view === 'skills') return renderSkills();
    if (state.view === 'character-material') return renderCharacterMaterialAudit();
    if (state.view === 'data') return renderData();
    if (state.view === 'audit') return renderAudit();
    return errorPanel('未知管理模块。');
  }

  function rerenderContent() {
    const content = document.getElementById('completion-admin-content');
    if (!content || !stage.contains(content)) return;
    if (state.view === 'skills') captureSkillForm();
    content.innerHTML = renderViewBody();
    if (state.view === 'skills') {
      const form = stage.querySelector('[data-admin-skill-form]');
      if (form) {
        const fingerprint = skillFormFingerprint(collectSkillForm(form));
        if (!state.skillSnapshot || !state.skillDirty) {
          state.skillSnapshot = fingerprint;
          state.skillDirty = false;
        } else {
          state.skillDirty = fingerprint !== state.skillSnapshot;
        }
      }
    }
    const title = stage.querySelector('.admin-top h2');
    if (title) title.textContent = viewTitles[state.view] || '管理后台';
    mountIcons();
  }

  function isAdminPageVisible() {
    return Boolean(stage && stage.querySelector('.admin-page'));
  }

  function showLogin() {
    state.view = 'overview';
    if (typeof renderPage === 'function') renderPage('admin-login');
  }

  function handleAdminError(error, fallback) {
    if (error && (error.status === 401 || error.status === 403)) {
      clearAdminAuth();
      showLogin();
      showToast(error.message || '管理员会话已失效');
      return;
    }
    showToast((error && error.message) || fallback || '管理请求失败');
  }

  async function restoreAdminSession() {
    if (!backendState.adminToken) return;
    try {
      const response = await adminRequest('/api/admin/auth/me');
      if (!response.user || response.user.isAdmin !== true) throw Object.assign(new Error('当前账户没有管理员权限'), { status: 403 });
      backendState.adminUser = response.user;
      persistAdminAuth();
      if (location.hash.slice(1) === 'admin-login' || document.querySelector('.admin-login-page')) {
        state.view = 'overview';
        renderPage('admin', { fromHistory: true });
        await loadOverview();
        await loadCharacterMaterialAudit();
      } else if (location.hash.slice(1) === 'admin' || document.querySelector('.admin-page')) {
        await loadOverview();
        await loadCharacterMaterialAudit();
      }
    } catch (error) {
      clearAdminAuth();
      if (location.hash.slice(1) === 'admin' || document.querySelector('.admin-page')) showLogin();
    }
  }

  async function submitAdminLogin(form) {
    const emailInput = form.querySelector('#completionAdminEmail');
    const passwordInput = form.querySelector('#completionAdminPassword');
    const button = form.querySelector('[data-admin-login-submit]');
    const notice = form.querySelector('[data-admin-login-notice]');
    const email = String(emailInput?.value || '').trim();
    const password = String(passwordInput?.value || '');
    if (!email || !password) { if (notice) notice.textContent = '请填写管理员邮箱和密码。'; return; }
    if (button) button.disabled = true;
    if (notice) notice.textContent = '正在校验管理员账户…';
    try {
      const response = await adminRequest('/api/admin/auth/login', { method: 'POST', body: { email, password } });
      if (!response.token || !response.user || response.user.isAdmin !== true) throw new Error('服务端未返回有效管理员会话');
      backendState.adminToken = String(response.token);
      backendState.adminUser = response.user;
      persistAdminAuth();
      state.view = 'overview';
      renderPage('admin');
      showToast('管理员登录成功');
      await loadOverview();
      await loadCharacterMaterialAudit();
    } catch (error) {
      if (notice) notice.textContent = error.message || '管理员登录失败。';
      handleAdminError(error, '管理员登录失败');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function logout() {
    let serverLogout = true;
    try { await adminRequest('/api/admin/auth/logout', { method: 'POST', body: {} }); } catch (_) { serverLogout = false; }
    clearAdminAuth();
    showLogin();
    showToast(serverLogout ? '已退出管理后台' : '本地管理员会话已清除，服务端退出请求失败');
  }

  async function loadOverview() {
    if (!backendState.adminToken) return showLogin();
    const sequence = ++state.overviewLoadSeq;
    state.overviewLoading = true;
    state.overviewError = '';
    if (isAdminPageVisible()) rerenderContent();
    const params = new URLSearchParams({ page: String(state.usersPage), pageSize: '20', q: state.usersQuery, role: state.usersRole });
    try {
      const response = await adminRequest('/api/admin/overview?' + params.toString());
      if (sequence !== state.overviewLoadSeq) return;
      state.overview = response;
      backendState.adminOverview = response;
      state.overviewError = '';
      state.overviewLoading = false;
      if (isAdminPageVisible()) rerenderContent();
    } catch (error) {
      if (sequence !== state.overviewLoadSeq) return;
      state.overviewLoading = false;
      state.overviewError = error?.message || '概览数据读取失败';
      handleAdminError(error, '概览数据读取失败');
      if (isAdminPageVisible()) rerenderContent();
    }
  }

  async function loadModels() {
    if (!backendState.adminToken) return showLogin();
    const sequence = ++state.modelsLoadSeq;
    state.modelsLoaded = false;
    state.modelsError = '';
    if (isAdminPageVisible()) rerenderContent();
    try {
      const response = await adminRequest('/api/admin/models');
      if (sequence !== state.modelsLoadSeq) return;
      state.models = Array.isArray(response.models) ? response.models : [];
      state.defaultModel = String(response.defaultModel || '');
      state.defaultModelDraft = state.defaultModel || String(state.models[0]?.id || '');
      state.modelDraft = new Map(state.models.map(model => [model.id, number(model.creditsPer1k).toFixed(4)]));
      backendState.adminModels = state.models;
      backendState.adminDefaultModel = state.defaultModel;
      state.modelsError = '';
      state.modelsLoaded = true;
      if (isAdminPageVisible()) rerenderContent();
    } catch (error) {
      if (sequence !== state.modelsLoadSeq) return;
      state.modelsLoaded = true;
      state.modelsError = error?.message || '模型配置读取失败';
      handleAdminError(error, '模型配置读取失败');
      if (isAdminPageVisible()) rerenderContent();
    }
  }

  async function loadSkills() {
    if (!backendState.adminToken) return showLogin();
    const sequence = ++state.skillsLoadSeq;
    state.skillsLoaded = false;
    state.skillsError = '';
    if (isAdminPageVisible()) rerenderContent();
    try {
      const response = await adminRequest('/api/admin/skills');
      if (sequence !== state.skillsLoadSeq) return;
      state.skills = Array.isArray(response.skills) ? response.skills : [];
      if (Array.isArray(response.targets) && response.targets.length) state.skillTargets = response.targets;
      state.skillsError = '';
      state.skillsLoaded = true;
      if (!state.skillDraft || (state.skillDraft.source !== 'builtin' && !state.skills.some(skill => skill.id === state.skillDraft.id))) state.skillDraft = null;
      if (isAdminPageVisible()) rerenderContent();
    } catch (error) {
      if (sequence !== state.skillsLoadSeq) return;
      state.skillsLoaded = true;
      state.skillsError = error?.message || '全局 Skill 读取失败';
      handleAdminError(error, '全局 Skill 读取失败');
      if (isAdminPageVisible()) rerenderContent();
    }
  }

  async function loadData(page = state.data.page) {
    if (!backendState.adminToken) return showLogin();
    state.data.page = Math.max(1, number(page, 1));
    const requestType = state.data.type;
    const requestPage = state.data.page;
    const requestQuery = state.data.query;
    const sequence = ++state.dataLoadSeq;
    state.data.loading = true;
    if (isAdminPageVisible()) rerenderContent();
    const params = new URLSearchParams({ type: requestType, page: String(requestPage), pageSize: '20', q: requestQuery });
    try {
      const response = await adminRequest('/api/admin/data?' + params.toString());
      if (sequence !== state.dataLoadSeq || state.data.type !== requestType || state.data.page !== requestPage || state.data.query !== requestQuery) return;
      state.data.rows = Array.isArray(response.rows) ? response.rows : [];
      state.data.pagination = response.pagination || { page: state.data.page, total: state.data.rows.length, totalPages: 1 };
      state.data.loading = false;
      if (isAdminPageVisible()) rerenderContent();
    } catch (error) {
      if (sequence !== state.dataLoadSeq || state.data.type !== requestType || state.data.page !== requestPage || state.data.query !== requestQuery) return;
      state.data.loading = false;
      state.data.rows = [];
      state.data.pagination = null;
      handleAdminError(error, '数据中心读取失败');
      if (isAdminPageVisible()) rerenderContent();
    }
  }

  async function selectDataRecord(meta) {
    const sequence = ++state.dataDetailSeq;
    const requestKey = [meta.type, meta.id, meta.owner || '', meta.skillId || ''].join('\u001f');
    state.data.recordMeta = meta;
    state.data.record = null;
    state.data.snapshot = '';
    state.data.editorText = '';
    rerenderContent();
    const params = new URLSearchParams({ type: meta.type, id: meta.id });
    if (meta.owner) params.set('owner', meta.owner);
    if (meta.skillId) params.set('skillId', meta.skillId);
    try {
      const response = await adminRequest('/api/admin/data?' + params.toString());
      if (sequence !== state.dataDetailSeq || !state.data.recordMeta || [state.data.recordMeta.type, state.data.recordMeta.id, state.data.recordMeta.owner || '', state.data.recordMeta.skillId || ''].join('\u001f') !== requestKey) return;
      state.data.record = response.record || {};
      state.data.snapshot = jsonText(state.data.record);
      state.data.editorText = state.data.snapshot;
      rerenderContent();
    } catch (error) {
      if (sequence !== state.dataDetailSeq) return;
      state.data.recordMeta = null;
      state.data.record = null;
      handleAdminError(error, '数据详情读取失败');
      rerenderContent();
    }
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  async function saveModelConfiguration() {
    if (!state.models.length) return;
    const inputs = [...stage.querySelectorAll('[data-model-rate]')];
    const rates = [];
    const seen = new Set();
    for (const input of inputs) {
      const modelId = String(input.dataset.modelId || '').trim();
      const value = Number(input.value);
      if (!modelId || seen.has(modelId) || !Number.isFinite(value) || value < 0.01 || value > 1000) {
        showToast('所有模型倍率必须是 0.01 到 1000 之间的有效数字');
        input.focus();
        return;
      }
      seen.add(modelId);
      rates.push({ modelId, creditsPer1k: value });
    }
    if (rates.length !== state.models.length) return showToast('模型倍率列表不完整，请刷新后重试');
    const defaultModel = stage.querySelector('[data-admin-default-model]')?.value || state.defaultModelDraft || state.defaultModel;
    if (!state.models.some(model => model.id === defaultModel)) return showToast('请选择有效的默认模型');
    const button = stage.querySelector('[data-admin-model-save]');
    if (button) button.disabled = true;
    try {
      await adminRequest('/api/admin/models', { method: 'PATCH', body: { rates } });
      if (defaultModel !== state.defaultModel) await adminRequest('/api/admin/models', { method: 'PATCH', body: { defaultModel } });
      state.defaultModel = defaultModel;
      state.defaultModelDraft = defaultModel;
      state.models = state.models.map(model => ({ ...model, creditsPer1k: rates.find(rate => rate.modelId === model.id)?.creditsPer1k ?? model.creditsPer1k }));
      state.modelDraft = new Map(rates.map(rate => [rate.modelId, Number(rate.creditsPer1k).toFixed(4)]));
      backendState.adminModels = state.models;
      backendState.adminDefaultModel = state.defaultModel;
      rerenderContent();
      showToast('模型默认策略和全部倍率已保存');
    } catch (error) {
      handleAdminError(error, '模型配置保存失败');
      if (!(error && (error.status === 401 || error.status === 403))) await loadModels();
    }
    finally { if (button) button.disabled = false; }
  }

  function collectSkillForm(form) {
    const targets = [...form.querySelectorAll('input[name="completion-skill-target"]:checked')].map(input => input.value);
    return {
      id: form.querySelector('[data-skill-id]')?.value || '',
      name: form.querySelector('[data-skill-name]')?.value.trim() || '',
      description: form.querySelector('[data-skill-description]')?.value.trim() || '',
      instruction: form.querySelector('[data-skill-instruction]')?.value.trim() || '',
      targets: targets.includes('all') || !targets.length ? ['all'] : targets,
      enabled: form.querySelector('[data-skill-enabled]')?.checked !== false
    };
  }

  async function saveSkillForm(form) {
    const draft = collectSkillForm(form);
    state.skillDirty = skillFormFingerprint(draft) !== state.skillSnapshot;
    if (!draft.name || !draft.instruction) return showToast('请填写 Skill 名称和指令内容');
    const button = form.querySelector('[data-admin-skill-save]');
    if (button) button.disabled = true;
    try {
      const path = draft.id ? '/api/admin/skills/' + encodeURIComponent(draft.id) : '/api/admin/skills';
      const response = await adminRequest(path, { method: draft.id ? 'PATCH' : 'POST', body: draft });
      state.skillDraft = response.skill || draft;
      state.skillSnapshot = skillFormFingerprint(state.skillDraft);
      state.skillDirty = false;
      await loadSkills();
      showToast(draft.id ? '全局 Skill 已更新' : '全局 Skill 已创建');
    } catch (error) { handleAdminError(error, '全局 Skill 保存失败'); }
    finally { if (button) button.disabled = false; }
  }

  async function cloneSkill(skill) {
    if (!skill || skill.source !== 'builtin') return;
    try {
      const response = await adminRequest('/api/admin/skills', { method: 'POST', body: { name: `${skill.name || skill.id}（全局副本）`, description: skill.description || '', instruction: skill.instruction || '', targets: ['all'], enabled: true } });
      state.skillDraft = response.skill || null;
      state.skillSnapshot = state.skillDraft ? skillFormFingerprint(state.skillDraft) : '';
      state.skillDirty = false;
      await loadSkills();
      showToast('内置 Skill 已复制为全局 Skill');
    } catch (error) { handleAdminError(error, '复制内置 Skill 失败'); }
  }

  function openUserEditor(email) {
    const user = (state.overview?.users || []).find(item => item.email === email);
    if (!user) return showToast('用户详情已过期，请刷新列表');
    openActionModal({
      title: '编辑用户',
      body: `<div data-admin-user-form><p class="section-note">${html(user.email)}</p><div class="field"><label>用户名称</label><input type="text" maxlength="24" value="${html(user.name || '')}" data-admin-edit-name></div><div class="field"><label>用户等级</label><select data-admin-edit-role><option value="normal" ${user.role === 'normal' ? 'selected' : ''}>普通用户 · 2× 消耗</option><option value="vip" ${user.role === 'vip' ? 'selected' : ''}>VIP 用户 · 1× 消耗</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员 · 无限积分</option></select></div><div class="field"><label>积分余额</label><input type="number" min="0" step="0.01" value="${user.credits == null ? '' : html(user.credits)}" data-admin-edit-credits ${user.role === 'admin' ? 'disabled' : ''}><small>管理员账户不参与积分扣减。</small></div></div>`,
      confirmText: '保存修改',
      cancelText: '取消',
      onConfirm: async () => {
        const form = document.querySelector('[data-admin-user-form]');
        if (!form) return false;
        const role = form.querySelector('[data-admin-edit-role]').value;
        const name = form.querySelector('[data-admin-edit-name]').value.trim();
        const payload = { name, role };
        if (role !== 'admin') {
          const value = Number(form.querySelector('[data-admin-edit-credits]').value);
          if (!Number.isFinite(value) || value < 0) { showToast('积分必须是非负数字'); return false; }
          payload.credits = value;
        }
        try {
          await adminRequest('/api/admin/users/' + encodeURIComponent(email), { method: 'PATCH', body: payload });
          closeModal();
          await loadOverview();
          showToast('用户信息已保存');
        } catch (error) { handleAdminError(error, '用户信息保存失败'); }
        return false;
      }
    });
  }

  function showAuditDetail(id) {
    const item = state.audit.find(entry => entry.id === id) || (state.overview?.audit || []).find(entry => entry.id === id);
    if (!item) return showToast('审计记录不存在');
    openActionModal({ title: '审计记录详情', body: `<div class="notice">${icon('shield-check')}<span>${html(auditActionLabels[item.action] || item.action || '平台操作')} · ${html(item.adminEmail || '未知管理员')}</span></div><pre style="white-space:pre-wrap;overflow:auto;max-height:360px;margin:14px 0 0">${html(jsonText(item))}</pre>`, confirmText: '关闭', onConfirm: closeModal });
  }

  function exportAudit() {
    const rows = filteredAudit();
    if (!rows.length) return showToast('当前没有可导出的审计记录');
    const csv = [['时间', '管理员', '操作', '目标', '详情'], ...rows.map(item => [date(item.createdAt), item.adminEmail || '', item.action || '', item.target || '', jsonText(item.detail || {})])].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `molan-admin-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('审计记录已导出');
  }

  async function loadAudit() {
    if (!backendState.adminToken) return showLogin();
    state.auditLoaded = false;
    if (isAdminPageVisible()) rerenderContent();
    try {
      const response = await adminRequest('/api/admin/audit?limit=200');
      state.audit = Array.isArray(response.audit) ? response.audit : [];
      state.auditLoaded = true;
      if (isAdminPageVisible()) rerenderContent();
    } catch (error) {
      state.auditLoaded = true;
      handleAdminError(error, '审计日志读取失败');
      if (isAdminPageVisible()) rerenderContent();
    }
  }

  async function saveDataRecord() {
    const meta = state.data.recordMeta;
    const text = document.querySelector('[data-admin-data-editor]')?.value || state.data.editorText;
    if (!meta) return;
    const record = parseJson(text);
    if (!record) return showToast('JSON 格式不正确');
    const payload = { type: meta.type, id: meta.id, owner: meta.owner, skillId: meta.skillId, record };
    try {
      const response = await adminRequest('/api/admin/data', { method: 'PATCH', body: payload });
      state.data.record = response.record || record;
      state.data.snapshot = jsonText(state.data.record);
      state.data.editorText = state.data.snapshot;
      await loadData(state.data.page);
      showToast('数据已保存并写入审计记录');
    } catch (error) { handleAdminError(error, '数据保存失败'); }
  }

  async function deleteDataRecord() {
    const meta = state.data.recordMeta;
    if (!meta || meta.type === 'builtin-skills' || ['accounts', 'token-usage'].includes(meta.type)) return;
    openActionModal({
      title: '确认删除记录',
      body: `<div class="notice">${icon('alert-triangle')}<span>将删除 ${html(dataLabels[meta.type])}「${html(meta.id)}」，此操作不可撤销。</span></div>`,
      confirmText: '确认删除',
      cancelText: '取消',
      onConfirm: async () => {
        try {
          await adminRequest('/api/admin/data', { method: 'DELETE', body: { type: meta.type, id: meta.id, owner: meta.owner, skillId: meta.skillId } });
          closeModal();
          state.data.recordMeta = null;
          state.data.record = null;
          state.data.snapshot = '';
          state.data.editorText = '';
          await loadData(state.data.page);
          showToast('记录已删除');
        } catch (error) { handleAdminError(error, '记录删除失败'); }
        return false;
      }
    });
  }

  async function cloneDataBuiltin() {
    const record = state.data.record;
    if (!record || state.data.type !== 'builtin-skills') return;
    await cloneSkill({ ...record, source: 'builtin' });
    state.view = 'skills';
    rerenderContent();
  }

  function handleClick(event) {
    const node = event.target.closest('[data-admin-view], [data-admin-logout], [data-admin-refresh], [data-admin-users-page], [data-admin-user-edit], [data-admin-model-save], [data-admin-skill-new], [data-admin-skill-select], [data-admin-skill-reset], [data-admin-skill-clone], [data-admin-material-action], [data-admin-data-page], [data-admin-data-refresh], [data-admin-data-select], [data-admin-data-reset], [data-admin-data-clone], [data-admin-data-delete], [data-admin-data-save], [data-admin-audit-page], [data-admin-audit-refresh], [data-admin-audit-detail], [data-admin-audit-export], [data-admin-action]');
    if (!node || !stage.contains(node)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (node.dataset.adminView) return navigate(node.dataset.adminView);
    if (node.dataset.adminLogout !== undefined) return logout();
    if (node.dataset.adminRefresh !== undefined || node.dataset.adminAction === 'admin-refresh') return refreshCurrentView();
    if (node.dataset.adminUsersPage) { if (!node.disabled) { state.usersPage += node.dataset.adminUsersPage === 'next' ? 1 : -1; loadOverview(); } return; }
    if (node.dataset.adminUserEdit) return openUserEditor(node.dataset.adminUserEdit);
    if (node.dataset.adminModelSave !== undefined) return saveModelConfiguration();
    if (node.dataset.adminSkillNew !== undefined) return confirmDiscardSkillChanges(() => { state.skillDraft = null; state.skillDirty = false; state.skillSnapshot = ''; rerenderContent(); });
    if (node.dataset.adminSkillSelect) return confirmDiscardSkillChanges(() => { state.skillDraft = clone(state.skills.find(skill => skill.id === node.dataset.adminSkillSelect) || null); state.skillDirty = false; state.skillSnapshot = ''; rerenderContent(); });
    if (node.dataset.adminSkillReset !== undefined) return confirmDiscardSkillChanges(() => { state.skillDraft = state.skillDraft?.id ? clone(state.skills.find(skill => skill.id === state.skillDraft.id) || null) : null; state.skillDirty = false; state.skillSnapshot = ''; rerenderContent(); });
    if (node.dataset.adminSkillClone !== undefined) return confirmDiscardSkillChanges(() => cloneSkill(state.skillDraft));
    if (node.dataset.adminMaterialAction === 'refresh') return loadCharacterMaterialAudit();
    if (node.dataset.adminMaterialAction === 'mark-all') { stage.querySelectorAll('[data-material-reviewed-id]').forEach(input => { input.checked = true; }); updateCharacterMaterialAuditSummary(); return; }
    if (node.dataset.adminMaterialAction === 'clear') { stage.querySelectorAll('[data-material-reviewed-id], [data-material-residual-id]').forEach(input => { input.checked = false; }); updateCharacterMaterialAuditSummary(); return; }
    if (node.dataset.adminMaterialAction === 'save') return submitCharacterMaterialAudit(false);
    if (node.dataset.adminMaterialAction === 'approve') return submitCharacterMaterialAudit(true);
    if (node.dataset.adminMaterialAction === 'revoke') return submitCharacterMaterialAudit(false);
    if (node.dataset.adminDataPage) { if (!node.disabled) loadData(state.data.page + (node.dataset.adminDataPage === 'next' ? 1 : -1)); return; }
    if (node.dataset.adminDataRefresh !== undefined) return loadData(state.data.page);
    if (node.dataset.adminDataSelect) return selectDataRecord({ type: state.data.type, id: node.dataset.adminDataSelect, owner: node.dataset.adminDataOwner || '', skillId: node.dataset.adminDataSkillId || '' });
    if (node.dataset.adminDataReset !== undefined) { state.data.editorText = state.data.snapshot; rerenderContent(); return; }
    if (node.dataset.adminDataClone !== undefined) return cloneDataBuiltin();
    if (node.dataset.adminDataDelete !== undefined) return deleteDataRecord();
    if (node.dataset.adminDataSave !== undefined) return saveDataRecord();
    if (node.dataset.adminAuditPage) { if (!node.disabled) { state.auditPage += node.dataset.adminAuditPage === 'next' ? 1 : -1; rerenderContent(); } return; }
    if (node.dataset.adminAuditRefresh !== undefined) return loadAudit();
    if (node.dataset.adminAuditDetail) return showAuditDetail(node.dataset.adminAuditDetail);
    if (node.dataset.adminAuditExport !== undefined) return exportAudit();
  }

  function handleSubmit(event) {
    const form = event.target.closest('[data-admin-login-form], [data-admin-skill-form]');
    if (!form || !stage.contains(form)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (form.matches('[data-admin-login-form]')) return submitAdminLogin(form);
    if (form.matches('[data-admin-skill-form]')) return saveSkillForm(form);
  }

  function handleInput(event) {
    const node = event.target;
    if (!stage.contains(node)) return;
    if (node.matches('[data-model-rate]')) { state.modelDraft.set(node.dataset.modelId, node.value); return; }
    if (node.matches('[data-admin-data-editor]')) {
      state.data.editorText = node.value;
      const valid = Boolean(parseJson(node.value));
      const panel = node.closest('.panel-body');
      const changed = node.value !== state.data.snapshot;
      const summary = panel?.querySelector('[data-admin-data-summary]');
      const save = panel?.querySelector('[data-admin-data-save]');
      const reset = panel?.querySelector('[data-admin-data-reset]');
      if (summary) { summary.hidden = false; summary.textContent = valid ? (changed ? '检测到本地 JSON 修改' : '没有待保存修改') : 'JSON 格式不正确'; }
      if (save) save.disabled = !valid || !changed;
      if (reset) reset.disabled = !changed;
      return;
    }
    if (node.matches('[data-skill-name], [data-skill-description], [data-skill-instruction], [data-skill-enabled], input[name="completion-skill-target"]')) {
      const form = node.closest('[data-admin-skill-form]');
      if (form) state.skillDirty = skillFormFingerprint(collectSkillForm(form)) !== state.skillSnapshot;
      return;
    }
    if (node.matches('[data-admin-users-search]')) {
      state.usersQuery = node.value;
      state.overviewLoadSeq += 1;
      clearTimeout(state.userSearchTimer);
      state.userSearchTimer = setTimeout(() => { state.usersPage = 1; loadOverview(); }, 260);
      return;
    }
    if (node.matches('[data-admin-data-search]')) {
      state.data.query = node.value;
      state.dataLoadSeq += 1;
      clearTimeout(state.dataSearchTimer);
      state.dataSearchTimer = setTimeout(() => loadData(1), 260);
      return;
    }
    if (node.matches('[data-admin-audit-search]')) {
      state.auditQuery = node.value;
      state.auditPage = 1;
      clearTimeout(state.auditSearchTimer);
      state.auditSearchTimer = setTimeout(() => rerenderContent(), 220);
    }
  }

  function handleChange(event) {
    const node = event.target;
    if (!stage.contains(node)) return;
    if (node.matches('[data-admin-default-model]')) { state.defaultModelDraft = node.value; return; }
    if (node.matches('[data-skill-enabled], input[name="completion-skill-target"]')) {
      const form = node.closest('[data-admin-skill-form]');
      if (form) state.skillDirty = skillFormFingerprint(collectSkillForm(form)) !== state.skillSnapshot;
      return;
    }
      if (node.matches('[data-material-reviewed-id], [data-material-residual-id]')) {
        if (node.matches('[data-material-residual-id]') && node.checked) {
        const reviewed = [...stage.querySelectorAll('[data-material-reviewed-id]')].find(input => input.dataset.materialReviewedId === node.dataset.materialResidualId);
        if (reviewed) reviewed.checked = true;
      }
      updateCharacterMaterialAuditSummary();
      return;
    }
    if (node.matches('[data-admin-users-role]')) { state.usersRole = node.value; state.usersPage = 1; loadOverview(); return; }
    if (node.matches('[data-admin-data-type]')) {
      state.data.type = node.value;
      state.data.page = 1;
      state.data.query = '';
      state.dataLoadSeq += 1;
      state.dataDetailSeq += 1;
      state.data.recordMeta = null;
      state.data.record = null;
      state.data.snapshot = '';
      state.data.editorText = '';
      loadData(1);
    }
  }

  function navigateView(view) {
    if (!viewTitles[view]) return;
    state.view = view;
    rerenderContent();
    if (view === 'overview' || view === 'users') {
      if (!state.overview) loadOverview();
    } else if (view === 'models') {
      if (!state.modelsLoaded) loadModels();
    } else if (view === 'skills') {
      if (!state.skillsLoaded) loadSkills();
    } else if (view === 'character-material') {
      if (!state.characterMaterialAudit.loaded && !state.characterMaterialAudit.loading) loadCharacterMaterialAudit();
    } else if (view === 'data') {
      if (!state.data.pagination && !state.data.loading) loadData(1);
    } else if (view === 'audit') {
      if (!state.auditLoaded) loadAudit();
    }
  }

  function navigate(view) {
    if (!viewTitles[view]) return;
    if (view !== state.view && state.view === 'skills') return confirmDiscardSkillChanges(() => navigateView(view));
    navigateView(view);
  }

  function refreshCurrentView() {
    if (state.view === 'overview' || state.view === 'users') return loadOverview();
    if (state.view === 'models') return loadModels();
    if (state.view === 'skills') return confirmDiscardSkillChanges(() => loadSkills());
    if (state.view === 'character-material') return loadCharacterMaterialAudit();
    if (state.view === 'data') return loadData(state.data.page);
    if (state.view === 'audit') return loadAudit();
  }

  function bind() {
    document.addEventListener('click', handleClick, true);
    document.addEventListener('submit', handleSubmit, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleChange, true);
  }

  function install() {
    if (state.installed) return;
    state.installed = true;
    renderers['admin-login'] = adminLoginPage;
    renderers.admin = adminPage;
    bind();
    if (backendState.adminToken) restoreAdminSession();
  }

  window.MolanCompletionAdmin = { install };
}());
