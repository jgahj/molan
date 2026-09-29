(function () {
  'use strict';

  var token = null;
  var currentUser = null;
  var overview = null;
  var modelData = null;
  var skillData = [];
  var selectedSkillId = '';
  var userPage = 1;
  var userPageSize = 100;
  var userLoadSeq = 0;
  var userReloadTimer = null;
  var toastTimer = null;
  var adminDataPage = 1;
  var adminDataPageSize = 30;
  var adminDataCurrent = null;
  var adminDataLoadSeq = 0;
  var adminDataDetailLoadSeq = 0;
  var adminDataSnapshot = '';
  var adminDataDirty = false;
  var modelLoadSeq = 0;
  var modelLoadError = '';
  var modelRateDraft = Object.create(null);
  var modelDefaultDraft = '';
  var skillLoadSeq = 0;
  var skillLoadError = '';
  var skillFormSnapshot = '';
  var skillFormDirty = false;
  var characterMaterialAudit = { loaded: false, loading: false, error: '', version: '', sampleCount: 0, threshold: 0.02, samples: [], published: false, approval: null };
  var characterMaterialAuditDraft = null;
  var characterMaterialAuditLoadSeq = 0;
  var characterMaterialAuditSaving = false;
  var confirmResolver = null;
  var sidebarScrim = null;
  var adminDataLabels = { accounts: '账户数据', novels: '作品数据', 'user-skills': '用户 Skill', 'global-skills': '全局 Skill', 'open-skills': '开放 Skill', 'builtin-skills': '内置 Skill', 'token-usage': 'Token 记录', dissections: '拆书任务' };
  var roleLabels = { admin: '管理员', vip: 'VIP 用户', normal: '普通用户' };
  var auditLabels = { 'user.update': '更新用户账户', 'model.update': '更新模型策略', 'model.rate.update': '更新模型积分费率', 'skill.create': '创建全局 Skill', 'skill.update': '更新全局 Skill', 'skill.delete': '删除全局 Skill', 'open-skill.create': '发布开放 Skill', 'open-skill.update': '更新开放 Skill', 'open-skill.delete': '撤回开放 Skill', 'character-material.approve': '发布人物素材 strong', 'character-material.review': '保存人物素材抽检', 'data.accounts.update': '更新账户数据', 'data.novels.update': '更新作品数据', 'data.novels.delete': '删除作品数据', 'data.user-skills.update': '更新用户 Skill', 'data.user-skills.delete': '删除用户 Skill', 'data.global-skills.update': '更新全局 Skill 数据', 'data.global-skills.delete': '删除全局 Skill 数据', 'data.open-skills.update': '更新开放 Skill 数据', 'data.open-skills.delete': '删除开放 Skill 数据', 'data.token-usage.update': '修正 Token 记录', 'data.dissections.update': '更新拆书任务', 'data.dissections.delete': '删除拆书任务' };
  var iconPaths = {
    'search': '<circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4.2 4.2"></path>',
    'chevron-left': '<path d="m15 18-6-6 6-6"></path>',
    'layout-dashboard': '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>',
    'users': '<path d="M16 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 19.5V21"></path><circle cx="10" cy="7" r="3.5"></circle><path d="M17 11a3.2 3.2 0 0 0 0-6.2M20 21v-1.5a4.5 4.5 0 0 0-3.1-4.3"></path>',
    'sparkles': '<path d="m12 3-1.1 3.2A4 4 0 0 1 8.4 8.7L5 10l3.4 1.3a4 4 0 0 1 2.5 2.5L12 17l1.1-3.2a4 4 0 0 1 2.5-2.5L19 10l-3.4-1.3a4 4 0 0 1-2.5-2.5L12 3Z"></path><path d="m19 16-.5 1.5L17 18l1.5.5L19 20l.5-1.5L21 18l-1.5-.5L19 16Z"></path>',
    'clock': '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3 2"></path>',
    'menu': '<path d="M4 6h16M4 12h16M4 18h16"></path>',
    'refresh': '<path d="M20 11a8 8 0 0 0-14.7-4L4 9"></path><path d="M4 4v5h5"></path><path d="M4 13a8 8 0 0 0 14.7 4L20 15"></path><path d="M20 20v-5h-5"></path>',
    'chart': '<path d="M4 19V5"></path><path d="M4 19h16"></path><path d="m7 15 3-4 3 2 5-6"></path>',
    'coins': '<circle cx="8" cy="8" r="4"></circle><path d="M8 4v8M4 8h8"></path><path d="M13 9.5a4 4 0 1 1-1.2 7.8"></path><path d="M15 13.5h5"></path>',
    'arrow-up-right': '<path d="M7 17 17 7"></path><path d="M7 7h10v10"></path>',
    'plus': '<path d="M12 5v14M5 12h14"></path>',
    'check': '<path d="m5 12 4 4L19 6"></path>',
    'x': '<path d="m6 6 12 12M18 6 6 18"></path>',
    'book-open': '<path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11v17H5.5A2.5 2.5 0 0 0 3 22V5.5Z"></path><path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H13v17h5.5a2.5 2.5 0 0 1 2.5 2V5.5Z"></path>',
    'database': '<ellipse cx="12" cy="5" rx="7.5" ry="3"></ellipse><path d="M4.5 5v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5"></path><path d="M4.5 12v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-7"></path>'
  };

  function $(id) { return document.getElementById(id); }
  function all(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function iconMarkup(name, extraClass) { return '<svg class="ui-icon' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (iconPaths[name] || iconPaths.sparkles) + '</svg>'; }
  function hydrateIcons() { all('[data-icon]').forEach(function (el) { el.innerHTML = iconMarkup(el.dataset.icon); }); }
  function esc(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function formatNumber(value) { return Number(value || 0).toLocaleString('zh-CN'); }
  function formatCredits(value) { return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function formatRateInput(value) { return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : ''; }
  function formatDate(value) { if (!value) return '—'; var d = new Date(value); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
  function formatRelative(value) {
    if (!value) return '—';
    var diff = Math.max(0, Date.now() - Number(value));
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / 86400000) + ' 天前';
  }
  function avatarMarkup(user, extraClass) { return '<div class="avatar' + (extraClass ? ' ' + extraClass : '') + '">' + (user && user.avatar ? '<img src="' + esc(user.avatar) + '" alt="">' : '') + '</div>'; }
  function getToken() { try { return localStorage.getItem('molan_admin_token'); } catch (_) { return null; } }
  function persistAdminUser(user) { try { localStorage.setItem('molan_admin_user', JSON.stringify(user)); } catch (_) {} }
  function showToast(message) {
    var el = $('toast'); if (!el) return;
    el.textContent = message; el.classList.add('is-visible'); clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 2400);
  }
  function closeConfirm(result) {
    var dialog = $('adminConfirmDialog');
    if (confirmResolver) { var resolve = confirmResolver; confirmResolver = null; resolve(result); }
    if (dialog && dialog.open) dialog.close(result ? 'confirm' : 'cancel');
  }
  function confirmAction(title, message, confirmText, danger) {
    var dialog = $('adminConfirmDialog');
    if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(message));
    $('adminConfirmTitle').textContent = title || '确认操作';
    $('adminConfirmMessage').textContent = message || '';
    $('adminConfirmAccept').textContent = confirmText || '确认';
    $('adminConfirmAccept').classList.toggle('data-danger-btn', !!danger);
    $('adminConfirmAccept').classList.toggle('primary-btn', !danger);
    $('adminConfirmAccept').classList.toggle('confirm-danger-btn', !!danger);
    return new Promise(function (resolve) {
      confirmResolver = resolve;
      dialog.showModal();
    });
  }
  function stableJson(value) {
    try { return JSON.stringify(value); } catch (_) { return ''; }
  }
  function summarizeJsonChanges(beforeText, afterText) {
    var before, after;
    try { before = JSON.parse(beforeText || '{}'); after = JSON.parse(afterText || '{}'); }
    catch (_) { return { valid: false, text: 'JSON 格式不正确，修正后才能保存。' }; }
    if (!before || typeof before !== 'object' || Array.isArray(before) || !after || typeof after !== 'object' || Array.isArray(after)) {
      return { valid: true, changed: stableJson(before) !== stableJson(after), text: stableJson(before) === stableJson(after) ? '没有检测到变更。' : '已修改整条记录。' };
    }
    var keys = Array.from(new Set(Object.keys(before).concat(Object.keys(after))));
    var changed = keys.filter(function (key) { return stableJson(before[key]) !== stableJson(after[key]); });
    return { valid: true, changed: changed.length > 0, text: changed.length ? '已修改 ' + changed.length + ' 项：' + changed.slice(0, 8).join('、') + (changed.length > 8 ? '…' : '') : '没有检测到变更。' };
  }
  function setAdminDataEditorState(state, summary) {
    var stateEl = $('adminDataEditorState');
    var summaryEl = $('adminDataChangeSummary');
    var editor = $('adminDataEditor');
    var save = $('adminDataSaveBtn');
    if (stateEl) { stateEl.textContent = state || '未选择'; stateEl.classList.toggle('is-dirty', state === '未保存'); }
    adminDataDirty = !!(summary && summary.valid && summary.changed);
    if (summaryEl) {
      summaryEl.hidden = !summary || (!summary.text && !adminDataDirty);
      summaryEl.textContent = summary && summary.text ? summary.text : '';
      summaryEl.classList.toggle('is-invalid', !!(summary && !summary.valid));
      summaryEl.classList.toggle('is-dirty', adminDataDirty);
    }
    if (save) save.disabled = !adminDataDirty || (editor && editor.disabled);
  }
  function updateAdminDataEditorState() {
    if (!adminDataCurrent || $('adminDataEditor').disabled) return;
    var summary = summarizeJsonChanges(adminDataSnapshot, $('adminDataEditor').value);
    setAdminDataEditorState(summary.valid ? (summary.changed ? '未保存' : '已保存') : 'JSON 有误', summary);
  }
  function getSkillFormState() {
    return stableJson({ id: $('skillId').value, name: $('skillName').value, description: $('skillDescription').value, instruction: $('skillInstruction').value, targets: getTargets(), enabled: $('skillEnabled').checked });
  }
  function updateSkillFormState() {
    var current = getSkillFormState();
    skillFormDirty = current !== skillFormSnapshot;
    var state = $('skillEditorState');
    if (state && skillFormDirty) state.textContent = '未保存';
    var count = $('skillInstructionCount');
    if (count) count.textContent = String($('skillInstruction').value.length).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' / 200,000';
  }
  function commitSkillFormSnapshot() {
    skillFormSnapshot = getSkillFormState();
    skillFormDirty = false;
    updateSkillFormState();
  }
  function confirmDiscardSkillForm(callback) {
    if (!skillFormDirty) { callback(); return; }
    confirmAction('放弃未保存的 Skill 修改？', '当前编辑内容尚未保存，继续操作会丢失这些修改。', '放弃修改', true).then(function (ok) { if (ok) callback(); });
  }
  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, options.headers || {});
    return fetch(path, Object.assign({}, options, { headers: headers, cache: 'no-store' })).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var error = new Error(data.error || ('请求失败（' + res.status + '）')); error.status = res.status; throw error; }
        return data;
      });
    });
  }
  function setLoading(text) { if ($('loadingText')) $('loadingText').textContent = text; }
  function hideLoading() { $('loadingScreen').style.display = 'none'; $('adminApp').hidden = false; }

  function switchView(view) {
    var target = $('view-' + view); if (!target) return;
    all('.admin-view').forEach(function (el) { el.classList.toggle('is-active', el === target); });
    all('.nav-item').forEach(function (el) { el.classList.toggle('is-active', el.dataset.view === view); });
    $('pageTitle').textContent = target.dataset.title || '';
    $('pageSubtitle').textContent = target.dataset.subtitle || '';
    if (view === 'users') renderUsers();
    if (view === 'models') renderModels();
    if (view === 'skills') renderSkills();
    if (view === 'character-material') {
      renderCharacterMaterialAudit();
      if (!characterMaterialAudit.loaded && !characterMaterialAudit.loading) loadCharacterMaterialAudit();
    }
    if (view === 'data') loadAdminData(1);
    if (view === 'audit') renderAudit($('auditList'), overview && overview.audit);
    closeSidebar();
  }

  function renderHeader() {
    var u = currentUser || {};
    $('adminName').textContent = u.name || '管理员';
    $('adminEmail').textContent = u.email || '—';
    var avatar = $('adminAvatar');
    avatar.textContent = '';
    if (u.avatar) {
      var image = document.createElement('img');
      image.src = u.avatar;
      image.alt = '';
      avatar.appendChild(image);
    }
  }

  function renderOverview() {
    var stats = overview.stats || {}, usage = overview.usage || {};
    $('metricUsers').textContent = formatNumber(stats.totalUsers);
    $('metricUsersHint').textContent = formatNumber(stats.normalUsers) + ' 位普通用户';
    $('metricVip').textContent = formatNumber(stats.vipUsers);
    $('metricTokens').textContent = formatNumber(stats.totalTokens);
    $('metricTokensHint').textContent = formatNumber(stats.requestCount) + ' 次模型请求';
    $('metricCredits').textContent = formatCredits(stats.creditSpent);
    $('metricCreditsHint').textContent = '实际扣费账本累计';
    $('cacheRate').textContent = Math.round(Number(stats.cacheHitRate || 0) * 100) + '%';
    $('inputTokens').textContent = formatNumber(usage.promptTokens);
    $('outputTokens').textContent = formatNumber(usage.completionTokens);
    $('preciseRequests').textContent = formatNumber(usage.preciseRequestCount);
    $('roleTotal').textContent = formatNumber(stats.totalUsers);
    $('roleAdmin').textContent = formatNumber(stats.adminUsers);
    $('roleVip').textContent = formatNumber(stats.vipUsers);
    $('roleNormal').textContent = formatNumber(stats.normalUsers);
    var total = Math.max(1, Number(stats.totalUsers) || 0);
    $('roleTrack').querySelector('.admin').style.flex = String(Number(stats.adminUsers) || 0);
    $('roleTrack').querySelector('.vip').style.flex = String(Number(stats.vipUsers) || 0);
    $('roleTrack').querySelector('.normal').style.flex = String(Number(stats.normalUsers) || 0);
    $('navUserCount').textContent = formatNumber(stats.totalUsers);
    $('navSkillCount').textContent = formatNumber((overview.skills && overview.skills.enabled) || 0);
    renderAudit($('overviewAudit'), overview.audit);
  }

  function renderRoleBadge(role) { return '<span class="role-badge ' + esc(role) + '"><i class="role-dot ' + esc(role) + '"></i>' + esc(roleLabels[role] || role) + '</span>'; }
  function renderModels() {
    var select = $('defaultModelSelect');
    var list = $('modelList');
    var policyButton = $('saveModelPolicyBtn');
    var ratesButton = $('saveModelRatesBtn');
    if (modelLoadError) {
      if (select) { select.innerHTML = ''; select.disabled = true; }
      if (policyButton) policyButton.disabled = true;
      if (ratesButton) ratesButton.disabled = true;
      $('modelCountLabel').textContent = '读取失败';
      list.innerHTML = '<div class="empty-state admin-load-error"><strong>模型配置读取失败</strong><small>' + esc(modelLoadError) + '</small><button class="ghost-btn" id="retryModelLoadBtn" type="button">重新读取</button></div>';
      $('retryModelLoadBtn').onclick = function () { loadModelData(); };
      return;
    }
    if (!modelData) {
      if (select) { select.innerHTML = ''; select.disabled = true; }
      if (policyButton) policyButton.disabled = true;
      if (ratesButton) ratesButton.disabled = true;
      $('modelCountLabel').textContent = '读取中';
      list.innerHTML = '<div class="empty-state">正在加载模型</div>';
      return;
    }
    var models = Array.isArray(modelData.models) ? modelData.models : [];
    if (select) {
      select.disabled = false;
      select.innerHTML = models.map(function (model) { return '<option value="' + esc(model.id) + '">' + esc(model.name || model.id) + '</option>'; }).join('');
      select.value = modelDefaultDraft || modelData.defaultModel || (models[0] && models[0].id) || '';
    }
    if (policyButton) policyButton.disabled = false;
    if (ratesButton) ratesButton.disabled = false;
    $('modelCountLabel').textContent = models.length + ' 个模型';
    list.innerHTML = models.length ? models.map(function (model) {
      var group = model.group === 'deepseek' ? 'DeepSeek' : (model.group === 'gpt' ? 'GPT 中转' : (model.group || '平台模型'));
      var current = model.id === (modelDefaultDraft || modelData.defaultModel);
      var rate = Object.prototype.hasOwnProperty.call(modelRateDraft, model.id) ? modelRateDraft[model.id] : formatRateInput(model.creditsPer1k);
      return '<div class="model-row"><div class="model-symbol">' + iconMarkup('sparkles') + '</div><div class="model-row-copy"><strong>' + esc(model.name || model.id) + '</strong><small>' + esc(group + (current ? ' · 普通用户默认' : '')) + '</small></div><label class="model-rate-editor"><span>积分费率</span><input class="model-rate-input" data-model-rate="' + esc(model.id) + '" type="number" min="0.01" max="1000" step="0.01" value="' + esc(rate) + '" aria-label="模型积分费率"><small>积分 / 千 Token</small></label></div>';
    }).join('') : '<div class="empty-state">暂无平台模型</div>';
    var saveButton = ratesButton;
    if (saveButton) saveButton.onclick = saveModelRates;
    hydrateIcons();
  }
  function loadModelData() {
    var sequence = ++modelLoadSeq;
    modelLoadError = '';
    modelData = null;
    renderModels();
    return api('/api/admin/models').then(function (data) {
      if (sequence !== modelLoadSeq) return null;
      modelData = data;
      modelDefaultDraft = data.defaultModel || ((data.models || [])[0] && data.models[0].id) || '';
      modelRateDraft = Object.create(null);
      (Array.isArray(data.models) ? data.models : []).forEach(function (model) { modelRateDraft[model.id] = formatRateInput(model.creditsPer1k); });
      modelLoadError = '';
      renderModels();
      return data;
    }).catch(function (err) {
      if (sequence !== modelLoadSeq) return null;
      modelData = null;
      modelLoadError = err.message || '模型配置读取失败';
      renderModels();
      showToast(modelLoadError);
      if (err.status === 401 || err.status === 403) throw err;
      return null;
    });
  }
  function saveModelPolicy() {
    var select = $('defaultModelSelect');
    var button = $('saveModelPolicyBtn');
    if (!select || !select.value) return;
    if (button) button.disabled = true;
    modelDefaultDraft = select.value;
    api('/api/admin/models', { method: 'PATCH', body: JSON.stringify({ defaultModel: modelDefaultDraft }) }).then(function (data) {
      if (modelData) modelData.defaultModel = data.defaultModel;
      modelDefaultDraft = data.defaultModel;
      renderModels();
      showToast('普通用户默认模型已更新');
      return loadOverview();
    }).catch(function (err) { showToast(err.message); }).finally(function () { if (button) button.disabled = false; });
  }
  function saveModelRates() {
    var inputs = all('[data-model-rate]');
    if (!inputs.length) return;
    var invalidInput = inputs.find(function (input) {
      var rate = Number(input.value);
      return !Number.isFinite(rate) || rate < 0.01 || rate > 1000;
    });
    if (invalidInput) {
      invalidInput.focus();
      showToast('积分费率需为 0.01 到 1000 之间的数字');
      return;
    }
    var rates = inputs.map(function (input) {
      modelRateDraft[input.dataset.modelRate] = input.value;
      return { modelId: input.dataset.modelRate, creditsPer1k: Number(input.value) };
    });
    var button = $('saveModelRatesBtn');
    inputs.forEach(function (input) { input.disabled = true; });
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    api('/api/admin/models', { method: 'PATCH', body: JSON.stringify({ rates: rates }) }).then(function (data) {
      return loadModelData().then(function (loaded) {
        if (loaded) showToast((data.changedCount || 0) + ' 个模型积分费率已更新，后续请求立即生效');
      });
    }).catch(function (err) { showToast(err.message); }).finally(function () {
      if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
      all('[data-model-rate]').forEach(function (input) { input.disabled = false; });
    });
  }
  function renderUsers() {
    if (!overview) return;
    var users = Array.isArray(overview.users) ? overview.users : [];
    var pagination = overview.pagination || { page: userPage, pageSize: userPageSize, total: users.length, totalPages: 1 };
    userPage = Number(pagination.page) || 1;
    userPageSize = Number(pagination.pageSize) || userPageSize;
    $('userResultCount').textContent = '显示 ' + users.length + ' / ' + (pagination.total || 0);
    $('userEmpty').hidden = users.length > 0;
    $('userTableBody').innerHTML = users.map(function (u) {
      var tokenCount = u.tokenUsage && u.tokenUsage.totalTokens || 0;
      var requestCount = u.tokenUsage && u.tokenUsage.requestCount || 0;
      var credit = u.unlimitedCredits ? '<span class="credits-value unlimited">∞ 无限</span>' : '<span class="credits-value">' + formatCredits(u.credits) + '</span>';
      return '<tr><td><div class="user-cell">' + avatarMarkup(u) + '<div><strong>' + esc(u.name || '未命名用户') + '</strong><small>' + esc(u.email) + '</small></div></div></td><td>' + renderRoleBadge(u.role) + '</td><td>' + credit + '</td><td><strong>' + formatNumber(tokenCount) + '</strong><small class="muted-value">' + formatNumber(requestCount) + ' 次请求</small></td><td>' + formatCredits(u.creditSpent) + '</td><td class="muted-value">' + formatDate(u.createdAt) + '</td><td><button class="row-edit" type="button" data-edit-user="' + esc(u.email) + '">编辑</button></td></tr>';
    }).join('');
    all('[data-edit-user]').forEach(function (btn) { btn.addEventListener('click', function () { openUserDialog(btn.dataset.editUser); }); });
    var pager = $('userPagination');
    if (pager) {
      pager.hidden = !(Number(pagination.totalPages) > 1);
      pager.innerHTML = '<button type="button" data-user-page="prev"' + (userPage <= 1 ? ' disabled' : '') + '>上一页</button><span>第 ' + userPage + ' / ' + (pagination.totalPages || 1) + ' 页</span><button type="button" data-user-page="next"' + (userPage >= (pagination.totalPages || 1) ? ' disabled' : '') + '>下一页</button>';
      pager.querySelectorAll('[data-user-page]').forEach(function (button) {
        button.addEventListener('click', function () {
          if (button.disabled) return;
          loadOverview(userPage + (button.dataset.userPage === 'next' ? 1 : -1));
        });
      });
    }
  }

  function renderAudit(container, rows) {
    if (!container) return;
    rows = Array.isArray(rows) ? rows : [];
    if (!rows.length) { container.innerHTML = '<div class="empty-state">暂无操作记录</div>'; return; }
    container.innerHTML = rows.map(function (row) {
      var detail = row.detail || {};
      var target = detail.name || row.target || '—';
      return '<div class="' + (container.id === 'overviewAudit' ? 'activity-row' : 'audit-row') + '"><div class="' + (container.id === 'overviewAudit' ? 'activity-badge' : 'audit-symbol') + '">' + iconMarkup(row.action.indexOf('user') === 0 ? 'users' : 'sparkles') + '</div><div class="' + (container.id === 'overviewAudit' ? 'activity-copy' : 'audit-copy') + '"><strong>' + esc(auditLabels[row.action] || row.action) + '</strong><small>' + esc(target) + ' · ' + esc(row.adminEmail || '管理员') + '</small></div>' + (container.id === 'overviewAudit' ? '<span class="activity-time">' + formatRelative(row.createdAt) + '</span>' : '<span class="audit-detail">' + formatDate(row.createdAt) + '</span>') + '</div>';
    }).join('');
  }

  function skillScopeText(skill) {
    var targets = Array.isArray(skill.targets) ? skill.targets : ['all'];
    if (targets.indexOf('all') >= 0) return '全部入口';
    var labels = { generate: '正文生成', continue: '续写', rewrite: '改写', polish: '润色', chat: 'AI 对话', extract: '设定抽取' };
    return targets.map(function (t) { return labels[t] || t; }).slice(0, 2).join('、') + (targets.length > 2 ? '…' : '');
  }
  function renderSkills() {
    var list = $('skillList');
    if (skillLoadError) {
      list.innerHTML = '<div class="empty-state admin-load-error"><strong>Skill 配置读取失败</strong><small>' + esc(skillLoadError) + '</small><button class="ghost-btn" id="retrySkillLoadBtn" type="button">重新读取</button></div>';
      $('retrySkillLoadBtn').onclick = function () { loadSkillData(); };
      return;
    }
    var globals = skillData.filter(function (s) { return s.global; });
    var builtins = skillData.filter(function (s) { return !s.global; });
    if (!skillData.length) { list.innerHTML = '<div class="empty-state">暂无 Skill 数据</div>'; return; }
    list.innerHTML = globals.concat(builtins).map(function (skill) {
      var editable = skill.editable === true;
      var status = skill.enabled === false ? '<span class="skill-status off">已停用</span>' : '<span class="skill-status">' + (skill.global ? '自动生效' : '内置只读') + '</span>';
      var action = editable
        ? '<button class="skill-edit" type="button" data-edit-skill="' + esc(skill.id) + '">编辑</button>'
        : '<button class="skill-edit" type="button" data-copy-skill="' + esc(skill.id) + '">复制并编辑</button>';
      return '<div class="skill-row ' + (selectedSkillId === skill.id ? 'is-selected' : '') + '" data-skill-row="' + esc(skill.id) + '"><div class="skill-symbol">' + iconMarkup(skill.global ? 'sparkles' : 'book-open') + '</div><div class="skill-row-copy"><strong>' + esc(skill.name || skill.id) + '</strong><small>' + esc(skill.description || '暂无描述') + '</small><div class="skill-meta"><span class="skill-source ' + (editable ? '' : 'builtin') + '">' + (editable ? '全局 Skill' : '内置 Skill') + '</span>' + status + '<span class="skill-source builtin">' + esc(skillScopeText(skill)) + '</span></div></div>' + action + '</div>';
    }).join('');
    all('[data-edit-skill], [data-copy-skill]').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        event.stopPropagation();
        activateSkill(btn.dataset.editSkill || btn.dataset.copySkill);
      });
    });
    all('[data-skill-row]').forEach(function (row) {
      row.addEventListener('click', function () { activateSkill(row.dataset.skillRow); });
    });
  }

  function setTargets(targets) {
    var list = Array.isArray(targets) && targets.length ? targets : ['all'];
    all('input[name="target"]').forEach(function (input) { input.checked = list.indexOf(input.value) >= 0 || (list.indexOf('all') >= 0 && input.value === 'all'); });
  }
  function getTargets() {
    var checked = all('input[name="target"]:checked').map(function (input) { return input.value; });
    return checked.indexOf('all') >= 0 || !checked.length ? ['all'] : checked;
  }
  function resetSkillForm(options) {
    options = options || {};
    if (!options.force && skillFormDirty) {
      confirmDiscardSkillForm(function () { resetSkillForm({ force: true }); });
      return;
    }
    selectedSkillId = '';
    $('skillId').value = '';
    $('skillName').value = '';
    $('skillDescription').value = '';
    $('skillInstruction').value = '';
    $('skillEnabled').checked = true;
    setTargets(['all']);
    $('skillEditorTitle').textContent = '新建全局 Skill';
    $('skillEditorHint').textContent = '将写作规范同步到多个创作入口';
    $('skillEditorState').textContent = '新建';
    $('resetSkillBtn').textContent = '清空';
    commitSkillFormSnapshot();
    renderSkills();
  }
  function selectSkill(id) {
    var skill = skillData.find(function (item) { return item.id === id && item.editable; });
    if (!skill) return;
    selectedSkillId = id;
    $('skillId').value = id;
    $('skillName').value = skill.name || '';
    $('skillDescription').value = skill.description || '';
    $('skillInstruction').value = skill.instruction || '';
    $('skillEnabled').checked = skill.enabled !== false;
    setTargets(skill.targets);
    $('skillEditorTitle').textContent = '编辑全局 Skill';
    $('skillEditorHint').textContent = '修改后会同步到启用的创作入口';
    $('skillEditorState').textContent = '编辑中';
    $('resetSkillBtn').textContent = '取消编辑';
    commitSkillFormSnapshot();
    renderSkills();
  }
  function copySkill(id) {
    var skill = skillData.find(function (item) { return item.id === id; });
    if (!skill) return;
    selectedSkillId = id;
    $('skillId').value = '';
    var sourceName = String(skill.name || skill.id || 'Skill');
    $('skillName').value = (sourceName.slice(0, 115) + '（副本）').slice(0, 120);
    $('skillDescription').value = skill.description || '';
    $('skillInstruction').value = skill.instruction || '';
    $('skillEnabled').checked = true;
    setTargets(skill.targets);
    $('skillEditorTitle').textContent = '编辑 Skill 副本';
    $('skillEditorHint').textContent = '已从内置 Skill 复制，保存后会生成可修改的全局 Skill。';
    $('skillEditorState').textContent = '副本';
    $('resetSkillBtn').textContent = '取消复制';
    commitSkillFormSnapshot();
    renderSkills();
  }
  function activateSkill(id) {
    var skill = skillData.find(function (item) { return item.id === id; });
    if (!skill) return;
    confirmDiscardSkillForm(function () { if (skill.editable) selectSkill(id); else copySkill(id); });
  }
  function loadSkillData() {
    var sequence = ++skillLoadSeq;
    skillLoadError = '';
    renderSkills();
    return api('/api/admin/skills').then(function (data) {
      if (sequence !== skillLoadSeq) return null;
      skillData = data.skills || [];
      skillLoadError = '';
      renderSkills();
      return data;
    }).catch(function (err) {
      if (sequence !== skillLoadSeq) return null;
      skillLoadError = err.message || 'Skill 配置读取失败';
      renderSkills();
      showToast(skillLoadError);
      if (err.status === 401 || err.status === 403) throw err;
      return null;
    });
  }

  /** Convert the server's audit term field into a displayable list. */
  function materialAuditTerms(sample, field) {
    var value = sample && sample[field];
    if (Array.isArray(value)) return value.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
    return String(value || '').split(/\s+/).map(function (item) { return item.trim(); }).filter(Boolean);
  }

  /** Read the current administrator checklist from the visible sample cards. */
  function readCharacterMaterialAuditDraft() {
    var list = $('materialAuditList');
    return {
      reviewedIds: list ? all('[data-material-reviewed-id]:checked', list).map(function (input) { return input.dataset.materialReviewedId; }) : [],
      residualIds: list ? all('[data-material-residual-id]:checked', list).map(function (input) { return input.dataset.materialResidualId; }) : []
    };
  }

  /** Return the draft checklist or the last checklist saved by the server. */
  function characterMaterialAuditSelection() {
    if (characterMaterialAuditDraft) return characterMaterialAuditDraft;
    var approval = characterMaterialAudit.approval || {};
    return {
      reviewedIds: Array.isArray(approval.reviewedIds) ? approval.reviewedIds.map(String) : [],
      residualIds: Array.isArray(approval.excludedIds) ? approval.excludedIds.map(String) : (Array.isArray(approval.residualIds) ? approval.residualIds.map(String) : [])
    };
  }

  /** Update the standalone administrator page's audit counters and action states. */
  function updateCharacterMaterialAuditSummary() {
    var samples = Array.isArray(characterMaterialAudit.samples) ? characterMaterialAudit.samples : [];
    var selection = readCharacterMaterialAuditDraft();
    characterMaterialAuditDraft = selection;
    var reviewed = new Set(selection.reviewedIds.map(String));
    var residual = new Set(selection.residualIds.map(String));
    var threshold = Number(characterMaterialAudit.threshold) || 0.02;
    var reviewedCount = samples.filter(function (sample) { return reviewed.has(String(sample.id)); }).length;
    var residualCount = samples.filter(function (sample) { return residual.has(String(sample.id)); }).length;
    var publishableCount = samples.length - residualCount;
    var unresolvedResidualCount = samples.filter(function (sample) { return !residual.has(String(sample.id)) && sample.residualTerms && sample.residualTerms.length; }).length;
    var rate = publishableCount ? unresolvedResidualCount / publishableCount : 1;
    var reviewedEl = $('materialAuditReviewedCount');
    var residualEl = $('materialAuditResidualCount');
    var rateEl = $('materialAuditResidualRate');
    if (reviewedEl) reviewedEl.textContent = reviewedCount + ' / ' + samples.length;
    if (residualEl) residualEl.textContent = residualCount + ' 条已剔除';
    if (rateEl) rateEl.textContent = (rate * 100).toFixed(1) + '%';
    all('[data-material-residual-id]', $('materialAuditList')).forEach(function (input) {
      var card = input.closest('.material-audit-card');
      if (card) card.classList.toggle('is-residual', input.checked);
    });
    var approve = $('materialAuditApproveBtn');
    if (approve) approve.disabled = characterMaterialAuditSaving || characterMaterialAudit.published || !samples.length;
    var busy = characterMaterialAuditSaving || characterMaterialAudit.published;
    ['materialAuditMarkAllBtn', 'materialAuditClearBtn', 'materialAuditSaveBtn'].forEach(function (id) {
      var button = $(id);
      if (button) button.disabled = busy || !samples.length;
    });
    var revoke = $('materialAuditRevokeBtn');
    if (revoke) { revoke.hidden = !characterMaterialAudit.published; revoke.disabled = characterMaterialAuditSaving; }
  }

  /** Render the standalone administrator checklist and its 100 sample cards. */
  function renderCharacterMaterialAudit() {
    var summary = $('materialAuditSummary');
    var list = $('materialAuditList');
    var state = $('materialAuditState');
    if (!summary || !list || !state) return;
    updateCharacterMaterialAuditNav();
    if (characterMaterialAudit.loading && !characterMaterialAudit.loaded) {
      state.textContent = '读取中';
      summary.innerHTML = '<div class="empty-state">正在读取抽检清单…</div>';
      list.innerHTML = '<div class="empty-state">正在读取抽检样本</div>';
      updateCharacterMaterialAuditSummary();
      return;
    }
    if (characterMaterialAudit.error) {
      state.textContent = '读取失败';
      summary.innerHTML = '<div class="empty-state admin-load-error"><strong>审批清单读取失败</strong><small>' + esc(characterMaterialAudit.error) + '</small></div>';
      list.innerHTML = '<div class="empty-state">请点击右上角“刷新清单”重试。</div>';
      updateCharacterMaterialAuditSummary();
      return;
    }
    var samples = Array.isArray(characterMaterialAudit.samples) ? characterMaterialAudit.samples : [];
    var selection = characterMaterialAuditSelection();
    var reviewed = new Set(selection.reviewedIds.map(String));
    var residual = new Set(selection.residualIds.map(String));
    var threshold = Number(characterMaterialAudit.threshold) || 0.02;
    var reviewedCount = samples.filter(function (sample) { return reviewed.has(String(sample.id)); }).length;
    var residualCount = samples.filter(function (sample) { return residual.has(String(sample.id)); }).length;
    var publishableCount = samples.length - residualCount;
    var unresolvedResidualCount = samples.filter(function (sample) { return !residual.has(String(sample.id)) && sample.residualTerms && sample.residualTerms.length; }).length;
    var rate = Number.isFinite(Number(characterMaterialAudit.residualRate)) ? Number(characterMaterialAudit.residualRate) : (publishableCount ? unresolvedResidualCount / publishableCount : 1);
    var autoReviewed = (characterMaterialAudit.approval || {}).approvalMode === 'agent';
    state.textContent = characterMaterialAudit.published ? 'strong 已发布' + (autoReviewed ? ' · 自动复核' : '') : '待复核';
    state.classList.toggle('is-published', characterMaterialAudit.published);
    state.classList.toggle('is-dirty', !characterMaterialAudit.published && reviewedCount > 0);
    summary.innerHTML = '<div class="material-audit-stat"><span>索引版本</span><strong>' + esc(characterMaterialAudit.version || '—') + '</strong></div><div class="material-audit-stat"><span>已检查</span><strong id="materialAuditReviewedCount">' + reviewedCount + ' / ' + samples.length + '</strong></div><div class="material-audit-stat"><span>已剔除</span><strong id="materialAuditResidualCount">' + residualCount + ' 条</strong></div><div class="material-audit-stat"><span>可发布样本</span><strong>' + publishableCount + ' 条</strong><small id="materialAuditResidualRate">剩余残留率 ' + (rate * 100).toFixed(1) + '% · 要求低于 ' + (threshold * 100).toFixed(0) + '%</small></div>';
    if (!samples.length) {
      list.innerHTML = '<div class="empty-state">当前版本没有可供抽检的样本，请先重新构建素材索引。</div>';
      updateCharacterMaterialAuditSummary();
      return;
    }
    var disabled = characterMaterialAudit.published ? ' disabled' : '';
    list.innerHTML = samples.map(function (sample) {
      var id = String(sample.id || '');
      var terms = materialAuditTerms(sample, 'forbiddenTerms');
      var residualTerms = materialAuditTerms(sample, 'residualTerms');
      var hints = [];
      if (residualTerms.length) hints.push('自动检测到残留：' + residualTerms.join('、'));
      if (terms.length) hints.push('已替换专名候选：' + terms.join('、'));
      return '<article class="material-audit-card' + (residual.has(id) ? ' is-residual' : '') + '"><div class="material-audit-card-head"><div class="material-audit-card-title"><strong>' + esc(id) + '</strong><small>' + esc(sample.archetype || '通用') + ' · ' + esc(sample.dimension || '未分类') + ' · ' + (sample.corpus === 'mature' ? '成熟索引' : '通用索引') + '</small></div><div class="material-audit-checks"><label><input type="checkbox" data-material-reviewed-id="' + esc(id) + '"' + (reviewed.has(id) ? ' checked' : '') + disabled + '>已检查</label><label><input type="checkbox" data-material-residual-id="' + esc(id) + '"' + (residual.has(id) ? ' checked' : '') + disabled + '>有专名残留</label></div></div><p>' + esc(sample.text || '') + '</p>' + (hints.length ? '<small class="material-audit-warning">' + esc(hints.join('；')) + '</small>' : '') + '<small class="material-audit-hash">来源哈希：' + esc(sample.sourceHash || '—') + '</small></article>';
    }).join('');
    all('[data-material-reviewed-id], [data-material-residual-id]', list).forEach(function (input) {
      input.addEventListener('change', function () {
        if (input.dataset.materialResidualId && input.checked) {
          var reviewedInput = all('[data-material-reviewed-id]', list).find(function (item) { return item.dataset.materialReviewedId === input.dataset.materialResidualId; });
          if (reviewedInput) reviewedInput.checked = true;
        }
        updateCharacterMaterialAuditSummary();
      });
    });
    updateCharacterMaterialAuditSummary();
  }

  /** Update the sidebar badge so an administrator can see whether approval is pending. */
  function updateCharacterMaterialAuditNav() {
    var badge = $('navMaterialAuditCount');
    if (!badge) return;
    if (characterMaterialAudit.loading && !characterMaterialAudit.loaded) badge.textContent = '读取中';
    else if (characterMaterialAudit.error) badge.textContent = '异常';
    else if (characterMaterialAudit.published) badge.textContent = '已发布';
    else badge.textContent = characterMaterialAudit.samples.length ? '待审' : '—';
  }

  /** Load the server-side character-material checklist for the standalone administrator page. */
  function loadCharacterMaterialAudit() {
    var sequence = ++characterMaterialAuditLoadSeq;
    characterMaterialAudit.loading = true;
    characterMaterialAudit.error = '';
    renderCharacterMaterialAudit();
    return api('/api/admin/character-material/audit').then(function (data) {
      if (sequence !== characterMaterialAuditLoadSeq) return null;
      characterMaterialAudit = Object.assign(characterMaterialAudit, data, { loaded: true, loading: false, error: '' });
      characterMaterialAuditDraft = null;
      renderCharacterMaterialAudit();
      return data;
    }).catch(function (err) {
      if (sequence !== characterMaterialAuditLoadSeq) return null;
      characterMaterialAudit.loading = false;
      characterMaterialAudit.loaded = true;
      characterMaterialAudit.error = err.message || '人物素材审批清单读取失败';
      renderCharacterMaterialAudit();
      showToast(characterMaterialAudit.error);
      if (err.status === 401 || err.status === 403) throw err;
      return null;
    });
  }

  /** Save checklist marks or publish/revoke strong samples through the admin API. */
  function submitCharacterMaterialAudit(approved, actionLabel) {
    var samples = Array.isArray(characterMaterialAudit.samples) ? characterMaterialAudit.samples : [];
    var selection = readCharacterMaterialAuditDraft();
    characterMaterialAuditDraft = selection;
    var reviewed = new Set(selection.reviewedIds.map(String));
    var residual = new Set(selection.residualIds.map(String));
    var missing = samples.filter(function (sample) { return !reviewed.has(String(sample.id)); }).length;
    var publishableCount = samples.filter(function (sample) { return !residual.has(String(sample.id)); }).length;
    var unresolvedResidualCount = samples.filter(function (sample) { return !residual.has(String(sample.id)) && sample.residualTerms && sample.residualTerms.length; }).length;
    var residualRate = publishableCount ? unresolvedResidualCount / publishableCount : 1;
    if (approved && missing) { showToast('还有 ' + missing + ' 条抽检样本未标记为已检查'); return; }
    if (approved && residualRate >= (Number(characterMaterialAudit.threshold) || 0.02)) { showToast('专名残留率必须低于 2% 才能发布'); return; }
    characterMaterialAuditSaving = true;
    renderCharacterMaterialAudit();
    return api('/api/admin/character-material/audit', { method: 'PATCH', body: JSON.stringify({ approved: approved, reviewedIds: selection.reviewedIds, residualIds: selection.residualIds, excludedIds: selection.residualIds }) }).then(function (data) {
      characterMaterialAudit = Object.assign(characterMaterialAudit, data, { loaded: true, loading: false, error: '' });
      characterMaterialAuditDraft = null;
      showToast(approved ? 'strong 人物素材已审批并发布' : (actionLabel === 'revoke' ? 'strong 人物素材已撤销' : '抽检结果已保存'));
    }).catch(function (err) {
      showToast(err.message || (approved ? 'strong 发布失败' : '抽检结果保存失败'));
      if (err.status === 401 || err.status === 403) throw err;
    }).finally(function () {
      characterMaterialAuditSaving = false;
      renderCharacterMaterialAudit();
    });
  }

  function formatBytes(value) {
    var bytes = Number(value) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (Math.round(bytes / 1024 / 1024 * 10) / 10) + ' MB';
  }
  function adminDataQuery(meta) {
    var params = new URLSearchParams({ type: meta.type, id: meta.id });
    if (meta.owner) params.set('owner', meta.owner);
    if (meta.skillId) params.set('skillId', meta.skillId);
    return params.toString();
  }
  function clearAdminDataEditor() {
    adminDataCurrent = null;
    adminDataSnapshot = '';
    adminDataDirty = false;
    $('adminDataEditorTitle').textContent = '选择一条记录';
    $('adminDataEditorState').textContent = '未选择';
    $('adminDataEditorState').classList.remove('is-dirty');
    $('adminDataRecordMeta').textContent = '从左侧列表选择记录';
    $('adminDataChangeSummary').hidden = true;
    $('adminDataChangeSummary').textContent = '';
    $('adminDataChangeSummary').classList.remove('is-dirty', 'is-invalid');
    $('adminDataEditor').value = '';
    $('adminDataEditor').disabled = true;
    $('adminDataSaveBtn').disabled = true;
    $('adminDataResetBtn').disabled = true;
    $('adminDataCloneBtn').disabled = true;
    $('adminDataDeleteBtn').disabled = true;
  }
  function renderAdminData(data) {
    var type = data.type;
    var rows = Array.isArray(data.rows) ? data.rows : [];
    $('adminDataListTitle').textContent = adminDataLabels[type] || type;
    $('adminDataResultCount').textContent = '显示 ' + rows.length + ' / ' + (data.pagination && data.pagination.total || 0);
    $('adminDataPageLabel').textContent = '第 ' + (data.pagination && data.pagination.page || 1) + ' / ' + (data.pagination && data.pagination.totalPages || 1) + ' 页';
    $('adminDataEmpty').hidden = rows.length > 0;
    $('adminDataTableBody').innerHTML = rows.map(function (row) {
      var owner = row.owner || '—';
      var id = row.id || '';
      var skillAttr = type === 'user-skills' ? ' data-data-skill-id="' + esc(id) + '"' : '';
      return '<tr><td><strong class="data-row-title">' + esc(row.title || id) + '</strong><small class="data-row-id">' + esc(id) + '</small></td><td class="muted-value">' + esc(owner) + '</td><td><span class="data-status">' + esc(row.status || '—') + '</span><small class="data-row-summary">' + esc(row.summary || '') + '</small></td><td class="muted-value">' + formatBytes(row.size) + '</td><td class="muted-value">' + esc(formatDate(row.updatedAt)) + '</td><td><button class="row-edit data-view-record" type="button" data-data-id="' + esc(id) + '" data-data-owner="' + esc(owner) + '"' + skillAttr + '>查看</button></td></tr>';
    }).join('');
    all('.data-view-record').forEach(function (button) { button.addEventListener('click', function () { selectAdminDataRecord({ type: type, id: button.dataset.dataId, owner: button.dataset.dataOwner, skillId: button.dataset.dataSkillId }); }); });
    var pagination = data.pagination || {};
    var pager = $('adminDataPagination');
    pager.hidden = !(Number(pagination.totalPages) > 1);
    pager.innerHTML = '<button type="button" data-admin-data-page="prev"' + (Number(pagination.page) <= 1 ? ' disabled' : '') + '>上一页</button><span>第 ' + (pagination.page || 1) + ' / ' + (pagination.totalPages || 1) + ' 页</span><button type="button" data-admin-data-page="next"' + (Number(pagination.page) >= (pagination.totalPages || 1) ? ' disabled' : '') + '>下一页</button>';
    pager.querySelectorAll('[data-admin-data-page]').forEach(function (button) { button.addEventListener('click', function () { if (button.disabled) return; loadAdminData(adminDataPage + (button.dataset.adminDataPage === 'next' ? 1 : -1)); }); });
  }
  function loadAdminData(page) {
    adminDataPage = Math.max(1, Number(page) || 1);
    var type = $('adminDataType').value;
    var query = String($('adminDataSearch').value || '').trim();
    clearAdminDataEditor();
    var sequence = ++adminDataLoadSeq;
    var params = new URLSearchParams({ type: type, page: String(adminDataPage), pageSize: String(adminDataPageSize), q: query });
    return api('/api/admin/data?' + params.toString()).then(function (data) { if (sequence === adminDataLoadSeq) renderAdminData(data); return data; });
  }
  async function selectAdminDataRecord(meta, options) {
    options = options || {};
    if (!options.force && adminDataDirty) {
      var proceed = await confirmAction('放弃未保存的数据修改？', '切换记录会丢失当前 JSON 编辑内容，请先保存或确认放弃。', '放弃修改', true);
      if (!proceed) return;
    }
    adminDataCurrent = meta;
    $('adminDataEditorTitle').textContent = '正在加载…';
    $('adminDataEditorState').textContent = '读取中';
    $('adminDataEditorState').classList.remove('is-dirty');
    $('adminDataChangeSummary').hidden = true;
    $('adminDataEditor').disabled = true;
    return api('/api/admin/data?' + adminDataQuery(meta)).then(function (data) {
      var record = data.record || {};
      adminDataCurrent.record = record;
      $('adminDataEditorTitle').textContent = record.title || record.name || record.email || record.id || meta.id;
      $('adminDataEditorState').textContent = meta.type === 'builtin-skills' ? '只读' : '可编辑';
      $('adminDataRecordMeta').textContent = (record.userEmail || record.owner || record.email || '') + (record.updatedAt ? ' · ' + formatDate(record.updatedAt) : '') + ' · ' + meta.type;
      $('adminDataEditor').value = JSON.stringify(record, null, 2);
      adminDataSnapshot = $('adminDataEditor').value;
      adminDataDirty = false;
      $('adminDataEditor').disabled = meta.type === 'builtin-skills';
      $('adminDataSaveBtn').disabled = true;
      $('adminDataResetBtn').disabled = meta.type === 'builtin-skills';
      $('adminDataCloneBtn').disabled = meta.type !== 'builtin-skills';
      $('adminDataDeleteBtn').disabled = ['accounts', 'token-usage', 'builtin-skills'].indexOf(meta.type) >= 0;
      setAdminDataEditorState(meta.type === 'builtin-skills' ? '只读' : '已保存', { valid: true, changed: false, text: meta.type === 'builtin-skills' ? '内置 Skill 源文件只读，可复制为全局 Skill 后编辑。' : '未检测到修改。' });
    }).catch(function (err) { clearAdminDataEditor(); showToast(err.message); });
  }
  function resetAdminDataEditor() {
    if (!adminDataCurrent || !adminDataCurrent.record) return;
    $('adminDataEditor').value = JSON.stringify(adminDataCurrent.record, null, 2);
    adminDataSnapshot = $('adminDataEditor').value;
    setAdminDataEditorState('已保存', { valid: true, changed: false, text: '已撤销本地修改。' });
  }
  function saveAdminData() {
    if (!adminDataCurrent) return;
    var record;
    try { record = JSON.parse($('adminDataEditor').value); } catch (_) { showToast('JSON 格式不正确'); return; }
    var summary = summarizeJsonChanges(adminDataSnapshot, $('adminDataEditor').value);
    if (!summary.valid || !summary.changed) { updateAdminDataEditorState(); return; }
    var payload = { type: adminDataCurrent.type, id: adminDataCurrent.id, owner: adminDataCurrent.owner, skillId: adminDataCurrent.skillId, record: record };
    var selectedMeta = Object.assign({}, adminDataCurrent);
    $('adminDataSaveBtn').disabled = true;
    $('adminDataEditorState').textContent = '保存中…';
    api('/api/admin/data', { method: 'PATCH', body: JSON.stringify(payload) }).then(function (data) {
      showToast('数据已保存并写入审计记录');
      return loadAdminData(adminDataPage).then(function () { return selectAdminDataRecord(selectedMeta, { force: true }); });
    }).catch(function (err) { showToast(err.message); }).finally(function () { if (adminDataCurrent && adminDataCurrent.type !== 'builtin-skills') $('adminDataSaveBtn').disabled = false; });
  }
  async function deleteAdminData() {
    if (!adminDataCurrent || ['accounts', 'token-usage', 'builtin-skills'].indexOf(adminDataCurrent.type) >= 0) return;
    var confirmed = await confirmAction('确认删除这条记录？', '将删除这条 ' + (adminDataLabels[adminDataCurrent.type] || '数据') + ' 及其可关联内容，此操作不可撤销。', '删除记录', true);
    if (!confirmed) return;
    var payload = { type: adminDataCurrent.type, id: adminDataCurrent.id, owner: adminDataCurrent.owner, skillId: adminDataCurrent.skillId };
    $('adminDataDeleteBtn').disabled = true;
    api('/api/admin/data', { method: 'DELETE', body: JSON.stringify(payload) }).then(function () { showToast('数据已删除'); clearAdminDataEditor(); return loadAdminData(adminDataPage); }).catch(function (err) { showToast(err.message); $('adminDataDeleteBtn').disabled = false; });
  }
  function cloneAdminBuiltinSkill() {
    if (!adminDataCurrent || adminDataCurrent.type !== 'builtin-skills' || !adminDataCurrent.record) return;
    var source = adminDataCurrent.record;
    var payload = { name: String(source.name || source.id || '内置 Skill').slice(0, 120) + '（全局副本）', description: source.description || '', instruction: source.instruction || '', targets: ['all'], enabled: true };
    if (!payload.instruction) { showToast('该内置 Skill 没有可复制的指令内容'); return; }
    $('adminDataCloneBtn').disabled = true;
    api('/api/admin/skills', { method: 'POST', body: JSON.stringify(payload) }).then(function () { showToast('已复制为全局 Skill，可继续编辑'); return Promise.all([loadSkillData(), loadAdminData(adminDataPage)]); }).catch(function (err) { showToast(err.message); }).finally(function () { if (adminDataCurrent && adminDataCurrent.type === 'builtin-skills') $('adminDataCloneBtn').disabled = false; });
  }
  function submitSkill(event) {
    event.preventDefault();
    var id = $('skillId').value;
    var payload = { name: $('skillName').value.trim(), description: $('skillDescription').value.trim(), instruction: $('skillInstruction').value.trim(), targets: getTargets(), enabled: $('skillEnabled').checked };
    if (!payload.name || !payload.instruction) { showToast('请填写 Skill 名称和指令内容'); return; }
    var path = id ? '/api/admin/skills/' + encodeURIComponent(id) : '/api/admin/skills';
    api(path, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) }).then(function () {
      showToast(id ? 'Skill 已更新并同步' : 'Skill 已创建并同步');
      return Promise.all([loadSkillData(), loadOverview()]);
    }).then(function () { resetSkillForm({ force: true }); }).catch(function (err) { showToast(err.message); });
  }

  function openUserDialog(email) {
    var user = (overview.users || []).find(function (item) { return item.email === email; });
    if (!user) return;
    $('dialogEmail').textContent = user.email;
    $('editUserName').value = user.name || '';
    $('editUserRole').value = user.role;
    $('editUserCredits').value = user.unlimitedCredits ? '' : String(user.credits == null ? 0 : user.credits);
    $('editUserCredits').disabled = user.unlimitedCredits;
    $('editUserRole').dataset.current = user.role;
    $('userDialog').showModal();
  }
  function submitUser(event) {
    if (event.submitter && event.submitter.value === 'cancel') return;
    event.preventDefault();
    var email = $('dialogEmail').textContent;
    var role = $('editUserRole').value;
    var payload = { name: $('editUserName').value.trim(), role: role };
    if (role !== 'admin') payload.credits = Number($('editUserCredits').value);
    api('/api/admin/users/' + encodeURIComponent(email), { method: 'PATCH', body: JSON.stringify(payload) }).then(function (data) {
      var index = overview.users.findIndex(function (item) { return item.email === email; });
      if (index >= 0) overview.users[index] = data.user;
      renderOverview(); renderUsers(); $('userDialog').close(); showToast('用户信息已更新');
      loadOverview(userPage);
    }).catch(function (err) { showToast(err.message); });
  }
  function loadOverview(page) {
    if (page != null) userPage = Math.max(1, Number(page) || 1);
    var params = new URLSearchParams({ page: String(userPage), pageSize: String(userPageSize), q: String($('userSearch').value || '').trim(), role: $('roleFilter').value || 'all' });
    return api('/api/admin/overview?' + params.toString()).then(function (data) { overview = data; renderOverview(); if (document.querySelector('#view-users.is-active')) renderUsers(); });
  }
  function queueUserReload() {
    clearTimeout(userReloadTimer);
    userReloadTimer = setTimeout(function () { loadOverview(1).catch(function (err) { showToast(err.message); }); }, 220);
  }
  function refreshAll() { setLoading('正在同步平台数据...'); var jobs = [loadOverview(), loadModelData(), loadSkillData(), loadCharacterMaterialAudit()]; if (document.querySelector('#view-data.is-active')) jobs.push(loadAdminData(adminDataPage)); return Promise.all(jobs).then(function () { hideLoading(); showToast('数据已刷新'); }).catch(function (err) { hideLoading(); showToast(err.message); }); }
  function closeSidebar() { var sidebar = document.querySelector('.admin-sidebar'); if (sidebar) sidebar.classList.remove('is-open'); }

  function boot() {
    token = getToken();
    if (!token) { location.href = './admin-login.html'; return; }
    api('/api/admin/auth/me').then(function (data) {
      if (!data.user || !data.user.isAdmin) throw Object.assign(new Error('当前账户不是管理员'), { status: 403 });
      currentUser = data.user; persistAdminUser(currentUser); renderHeader();
      return Promise.all([loadOverview(), loadModelData(), loadSkillData(), loadCharacterMaterialAudit()]);
    }).then(function () { hideLoading(); }).catch(function (err) {
      setLoading(err.status === 403 ? '当前账户没有管理员权限' : (err.message || '后台载入失败'));
      setTimeout(function () { location.href = './admin-login.html'; }, 1300);
    });
  }

  all('.nav-item, [data-view]').forEach(function (el) { el.addEventListener('click', function () { if (el.dataset.view) switchView(el.dataset.view); }); });
  $('userSearch').addEventListener('input', queueUserReload); $('roleFilter').addEventListener('change', queueUserReload);
  var adminDataSearchTimer = null;
  $('adminDataType').addEventListener('change', function () { loadAdminData(1).catch(function (err) { showToast(err.message); }); });
  $('adminDataSearch').addEventListener('input', function () { clearTimeout(adminDataSearchTimer); adminDataSearchTimer = setTimeout(function () { loadAdminData(1).catch(function (err) { showToast(err.message); }); }, 220); });
  $('adminDataRefreshBtn').addEventListener('click', function () { loadAdminData(adminDataPage).then(function () { showToast('数据中心已刷新'); }).catch(function (err) { showToast(err.message); }); });
  $('adminDataResetBtn').addEventListener('click', resetAdminDataEditor); $('adminDataCloneBtn').addEventListener('click', cloneAdminBuiltinSkill); $('adminDataSaveBtn').addEventListener('click', saveAdminData); $('adminDataDeleteBtn').addEventListener('click', deleteAdminData);
  $('adminDataEditor').addEventListener('input', updateAdminDataEditorState);
  $('saveModelPolicyBtn').addEventListener('click', saveModelPolicy);
  $('materialAuditMarkAllBtn').addEventListener('click', function () { all('[data-material-reviewed-id]', $('materialAuditList')).forEach(function (input) { input.checked = true; }); updateCharacterMaterialAuditSummary(); });
  $('materialAuditClearBtn').addEventListener('click', function () { all('[data-material-reviewed-id], [data-material-residual-id]', $('materialAuditList')).forEach(function (input) { input.checked = false; }); updateCharacterMaterialAuditSummary(); });
  $('materialAuditSaveBtn').addEventListener('click', function () { submitCharacterMaterialAudit(false); });
  $('materialAuditApproveBtn').addEventListener('click', function () { submitCharacterMaterialAudit(true, 'approve'); });
  $('materialAuditRevokeBtn').addEventListener('click', function () { submitCharacterMaterialAudit(false, 'revoke'); });
  $('materialAuditRefreshBtn').addEventListener('click', function () { loadCharacterMaterialAudit(); });
  $('refreshBtn').addEventListener('click', refreshAll); $('refreshAuditBtn').addEventListener('click', function () { loadOverview().then(function () { renderAudit($('auditList'), overview.audit); showToast('操作记录已刷新'); }).catch(function (err) { showToast(err.message); }); });
  $('newSkillBtn').addEventListener('click', function () { resetSkillForm(); }); $('resetSkillBtn').addEventListener('click', function () { resetSkillForm(); }); $('skillForm').addEventListener('submit', submitSkill); $('userForm').addEventListener('submit', submitUser);
  all('#skillForm input, #skillForm textarea').forEach(function (input) { input.addEventListener('input', updateSkillFormState); input.addEventListener('change', updateSkillFormState); });
  var confirmDialog = $('adminConfirmDialog');
  if (confirmDialog) {
    confirmDialog.querySelector('#adminConfirmForm').addEventListener('submit', function (event) { event.preventDefault(); closeConfirm(event.submitter && event.submitter.value !== 'cancel'); });
    confirmDialog.addEventListener('cancel', function (event) { event.preventDefault(); closeConfirm(false); });
  }
  $('logoutBtn').addEventListener('click', function () { api('/api/admin/auth/logout', { method: 'POST', body: '{}' }).catch(function () {}).finally(function () { try { localStorage.removeItem('molan_admin_token'); localStorage.removeItem('molan_admin_user'); } catch (_) {} location.href = './admin-login.html'; }); });
  $('sidebarToggle').addEventListener('click', closeSidebar); $('mobileMenuBtn').addEventListener('click', function () { document.querySelector('.admin-sidebar').classList.toggle('is-open'); });
  $('navSearch').addEventListener('input', function () { var q = $('navSearch').value.trim().toLowerCase(); all('.nav-item').forEach(function (item) { item.hidden = q && item.textContent.toLowerCase().indexOf(q) < 0; }); });
  all('input[name="target"]').forEach(function (input) { input.addEventListener('change', function () { if (input.value === 'all' && input.checked) all('input[name="target"]').forEach(function (other) { if (other !== input) other.checked = false; }); else if (input.value !== 'all' && input.checked) $('skillForm').querySelector('input[value="all"]').checked = false; }); });
  commitSkillFormSnapshot();
  hydrateIcons();
  boot();
}());
