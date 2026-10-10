(function () {
  'use strict';

  var API_BASE = location.protocol === 'file:' || location.protocol === 'about:' ? 'http://localhost:3000' : '';
  var token = '';
  var projectId = '';
  var creationBookId = '';
  var workspaceId = '';
  var projectRevision = 0;
  var projectState = null;
  var activeZone = 'base';
  var activeKind = '';
  var activeRequirementId = '';
  var renderedFields = [];
  var materialSchema = window.MOLAN_PROJECT_MATERIAL_SCHEMA || { categories: [], requirements: [], requirementsForCategory: function () { return []; }, getRequirement: function () { return null; } };
  var currentResource = null;
  var resources = [];

  var structuredFields = {
    worldbuilding: [
      ['title', '世界名称', 'text'], ['era', '时代与文明', 'textarea'],
      ['fundamentalRules', '世界底层法则', 'textarea'], ['geography', '地理、距离与地貌（JSON）', 'json'],
      ['factions', '势力、阵营与组织关系（JSON）', 'json'], ['calendar', '历法与纪年（JSON）', 'json'],
      ['specialRules', '金手指、禁忌与特殊限制', 'textarea']
    ],
    place: [
      ['name', '地点名称', 'text'], ['parentId', '上级地点 ID', 'text'], ['region', '所属地域', 'text'],
      ['terrain', '地貌', 'textarea'], ['climate', '气候', 'textarea'], ['description', '地点描述', 'textarea'],
      ['coordinates', '坐标/范围（JSON）', 'json'], ['travelEdges', '交通与距离（JSON）', 'json']
    ],
    faction: [
      ['name', '势力名称', 'text'], ['goals', '目标（JSON）', 'json'], ['resources', '掌握资源（JSON）', 'json'],
      ['members', '成员 ID（JSON）', 'json'], ['description', '势力描述', 'textarea'], ['status', '状态', 'text']
    ],
    calendar: [
      ['name', '历法名称', 'text'], ['definition', '纪年规则（JSON）', 'json'], ['eras', '年代区间（JSON）', 'json'],
      ['units', '时间单位（JSON）', 'json'], ['origin', '纪年起点', 'textarea']
    ],
    culture: [
      ['title', '文化或制度名称', 'text'], ['customs', '风俗', 'textarea'], ['law', '律法', 'textarea'],
      ['currency', '货币与经济', 'textarea'], ['language', '语言', 'textarea'],
      ['religion', '信仰', 'textarea'], ['classSystem', '阶级', 'textarea']
    ],
    'history-event': [
      ['title', '历史事件', 'text'], ['storyTime', '发生时间', 'text'], ['description', '事件经过', 'textarea'],
      ['consequences', '历史影响与恩怨', 'textarea'], ['sourceRefs', '资料来源（JSON）', 'json']
    ],
    'power-system': [
      ['title', '能力体系名称', 'text'], ['levels', '境界与层级（JSON）', 'json'],
      ['ceiling', '能力上限', 'textarea'], ['limits', '限制', 'textarea'], ['costs', '使用代价', 'textarea'],
      ['progression', '升级规则', 'textarea'], ['applicability', '适用题材 / 不适用理由', 'textarea']
    ],
    storyline: [
      ['title', '故事线名称', 'text'], ['kind', '主线/辅线/情感/悬疑', 'text'],
      ['goal', '故事线目标', 'textarea'], ['milestones', '关键节点（JSON）', 'json'],
      ['ending', '结局', 'textarea'], ['continuityId', '正史/平行世界作用域', 'text']
    ],
    manuscript: [
      ['title', '正文/番外/后记标题', 'text'], ['kind', '文稿类别', 'select:chapter|extra|afterword'],
      ['chapterId', '关联章节 ID', 'text'], ['continuityId', '所属故事版本', 'text'],
      ['canonApplicability', '正史适用性（后记不应进入故事事实）', 'text'],
      ['numberingPolicy', '编号策略', 'text'], ['text', '完整正文', 'textarea']
    ],
    publication: [
      ['title', '发布方案名称', 'text'], ['coverCopy', '封面文案', 'textarea'],
      ['tags', '标签（每行一个）', 'array'], ['category', '平台分类', 'text'],
      ['chapterTitlePlan', '章节标题规划', 'textarea'], ['readerInteraction', '读者互动/评论预埋', 'textarea'],
      ['plotPreview', '剧情预告', 'textarea'], ['completionNote', '完结感言', 'textarea'],
      ['extrasPlan', '番外规划', 'textarea']
    ],
    character: [
      ['name', '姓名', 'text'], ['role', '角色定位', 'text'], ['age', '年龄/年龄范围', 'text'],
      ['appearance', '外貌', 'textarea'], ['personality', '性格与缺陷', 'textarea'],
      ['goals', '目标（可分层）', 'textarea'], ['arc', '人物弧光', 'textarea'],
      ['voice', '语言/习惯', 'textarea'], ['notes', '背景与备注', 'textarea']
      , ['identity', '身份', 'textarea'], ['strengths', '优点', 'textarea'], ['flaws', '缺点', 'textarea'],
      ['obsession', '执念', 'textarea'], ['boundary', '底线', 'textarea'], ['family', '原生家庭', 'textarea'],
      ['trauma', '过往创伤', 'textarea'], ['abilities', '能力与掌握关系（JSON）', 'json'],
      ['equipment', '装备（JSON）', 'json'], ['appearanceOrder', '出场顺序（JSON）', 'json']
    ],
    relation: [
      ['sourceId', '源实体 ID', 'text'], ['targetId', '目标实体 ID', 'text'],
      ['relationType', '关系类型', 'text'], ['status', '当前状态', 'text'],
      ['storyTime', '生效故事时间', 'text'], ['description', '关系描述', 'textarea']
    ],
    'world-rule': [
      ['name', '规则名称', 'text'], ['rule', '规则正文', 'textarea'],
      ['limit', '限制/代价', 'textarea'], ['consequence', '违反后果', 'textarea'],
      ['scope', '适用范围', 'text'], ['sourceRefs', '来源引用（每行一条）', 'array']
    ],
    foreshadow: [
      ['title', '伏笔标题', 'text'], ['plantPlan', '埋设计划', 'textarea'],
      ['payoffPlan', '回收计划', 'textarea'], ['status', '状态', 'select:planned|planted|reinforced|partial|resolved|abandoned'],
      ['setupChapter', '埋设章节', 'text'], ['targetChapter', '计划回收章节', 'text'],
      ['evidence', '证据引用（每行一条）', 'array'], ['deferralReason', '延期/放弃理由', 'textarea']
    ],
    timeline: [
      ['title', '事件标题', 'text'], ['storyTime', '故事时间', 'text'],
      ['narrativeOrder', '叙述顺序', 'number'], ['recordedAt', '系统记录时间', 'text'],
      ['timezone', '时区/历法', 'text'], ['description', '事件描述', 'textarea'],
      ['sourceRefs', '来源引用（每行一条）', 'array']
    ],
    'writing-task': [
      ['title', '任务标题', 'text'], ['status', '状态', 'select:planned|drafting|review|blocked|done'],
      ['chapterId', '章节 ID', 'text'], ['blocker', '卡点原因', 'textarea'],
      ['nextAction', '下一行动', 'textarea'], ['assigneeId', '负责人 ID', 'text']
    ],
    issue: [
      ['title', '问题标题', 'text'], ['severity', '严重性', 'select:info|warning|blocker'],
      ['status', '状态', 'select:open|in_review|resolved|wont_fix'],
      ['description', '问题描述', 'textarea'], ['evidenceRefs', '证据引用（每行一条）', 'array'],
      ['affectedRefs', '影响对象（每行一条）', 'array'], ['resolution', '修复/作者解释', 'textarea']
    ],
    item: [
      ['name', '名称', 'text'], ['ownerId', '所有者 ID', 'text'], ['placeId', '所在地点 ID', 'text'],
      ['state', '当前状态', 'text'], ['notes', '属性与事件备注', 'textarea']
    ],
    ability: [
      ['name', '技能名称', 'text'], ['effect', '效果', 'textarea'], ['preconditions', '前置条件', 'textarea'],
      ['cost', '代价', 'textarea'], ['limit', '限制', 'textarea'], ['systemId', '所属体系 ID', 'text']
    ],
    term: [
      ['canonicalName', '正名', 'text'], ['aliases', '别名（每行一条）', 'array'],
      ['definition', '定义', 'textarea'], ['scope', '适用世界/时期', 'text'], ['disambiguation', '歧义说明', 'textarea']
    ],
    material: [
      ['title', '素材标题', 'text'], ['placeId', '地点 ID', 'text'], ['weather', '天气', 'text'],
      ['timeCondition', '时间条件', 'text'], ['povCondition', '视角条件', 'text'], ['text', '表达素材', 'textarea']
    ],
    highlight: [
      ['title', '名场面标题', 'text'], ['text', '台词/片段', 'textarea'], ['speakerId', '说话者 ID', 'text'],
      ['sceneId', '场景 ID', 'text'], ['usageStatus', '使用状态', 'select:unused|planned|used'], ['source', '来源', 'text']
    ],
    scene: [
      ['title', '场景标题', 'text'], ['placeId', '地点 ID', 'text'], ['povId', 'POV 人物 ID', 'text'],
      ['storyTime', '故事时间', 'text'], ['goal', '场景目标', 'textarea'], ['conflict', '阻力/冲突', 'textarea'],
      ['stateChange', '状态变化', 'textarea']
    ],
    'plot-node': [
      ['title', '节点标题', 'text'], ['kind', '节点类型', 'text'], ['parentId', '父节点 ID', 'text'],
      ['goal', '目标', 'textarea'], ['obstacle', '阻力', 'textarea'], ['result', '结果', 'textarea'],
      ['chapterRange', '章节区间', 'text'], ['wordCount', '计划字数', 'number'],
      ['events', '主要事件（JSON）', 'json'], ['climax', '高潮', 'textarea'],
      ['highlights', '看点、爽点与情绪点（JSON）', 'json'], ['castIds', '出场人物 ID（每行一个）', 'array'],
      ['foreshadowActions', '伏笔埋设/回收计划（JSON）', 'json'], ['endingMode', '章末模式', 'text'],
      ['hook', '章末钩子', 'textarea'], ['transition', '下章引子', 'textarea']
    ],
    outline: [
      ['title', '纲要标题', 'text'], ['premise', '核心前提', 'textarea'], ['mainline', '主线', 'textarea'],
      ['endingPromise', '结局承诺', 'textarea']
    ]
  };

  var groups = {
    base: {
      label: '基础定位',
      kinds: [['profile', '作品定位'], ['publication', '发布文案']]
    },
    world: {
      label: '世界观',
      kinds: [['worldbuilding', '世界基础'], ['place', '地点与地理'], ['faction', '势力与阵营'], ['calendar', '历法与纪年'], ['world-rule', '世界规则'], ['culture', '文化制度'], ['history-event', '历史事件'], ['power-system', '能力体系']]
    },
    characters: {
      label: '人物与关系',
      kinds: [['character', '人物卡'], ['relation', '人物/势力关系']]
    },
    outline: {
      label: '总卷章纲',
      kinds: [['outline', '总纲/卷纲'], ['storyline', '故事线'], ['plot-node', '剧情节点'], ['scene', '场景卡'], ['event', '故事事件']]
    },
    materials: {
      label: '专项素材',
      kinds: [['item', '道具物品'], ['ability', '技能招式'], ['term', '术语名词'], ['material', '环境素材'], ['highlight', '名场面/台词'], ['foreshadow', '伏笔'], ['timeline', '时间线']]
    },
    management: {
      label: '写作管理',
      kinds: [['writing-task', '写作任务'], ['issue', '设定纠错'], ['manuscript', '正文版本']]
    },
    publication: {
      label: '发布与后期',
      kinds: [['publication', '封面文案、标签、互动与完结规划']]
    }
  };

  function $(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function toast(message) {
    var el = $('docsToast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.classList.remove('is-visible'); }, 2600);
  }
  function authHeaders(extra) {
    return Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, extra || {});
  }
  async function api(path, options) {
    var response = await fetch(API_BASE + path, Object.assign({ cache: 'no-store', headers: authHeaders() }, options || {}));
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(data.error || '请求失败');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }
  function resourcePath(kind, id) {
    var path = '/api/novels/' + encodeURIComponent(projectId) + '/resources/' + encodeURIComponent(kind);
    if (id) path += '/' + encodeURIComponent(id);
    for (var i = 2; i < arguments.length; i += 1) path += '/' + String(arguments[i]).split('/').map(encodeURIComponent).join('/');
    return path + '?workspaceId=' + encodeURIComponent(workspaceId);
  }
  function stateProfile() {
    projectState.projectProfile = projectState.projectProfile && typeof projectState.projectProfile === 'object'
      ? projectState.projectProfile
      : {};
    return projectState.projectProfile;
  }
  function baseValue(name) {
    var profile = stateProfile();
    if (name === 'title') return projectState.title || '';
    return profile[name] == null ? '' : profile[name];
  }
  function renderBase() {
    var form = $('baseForm');
    Array.prototype.forEach.call(form.elements, function (element) {
      if (!element.name) return;
      element.value = baseValue(element.name);
    });
    $('revisionBadge').textContent = '作品版本 ' + projectRevision;
  }
  function renderKinds() {
    var group = groups[activeZone] || groups.base;
    var category = materialSchema.categories.find(function (item) { return item.zone === activeZone; });
    if (!group || !category) return;
    var requirements = materialSchema.requirementsForCategory(category.id);
    if (activeRequirementId !== '__all__' && !requirements.some(function (item) { return item.id === activeRequirementId; })) {
      activeRequirementId = requirements.length ? requirements[0].id : '__all__';
    }
    $('requirementSelect').innerHTML = '<option value="__all__">按资料类型浏览</option>' + requirements.map(function (item) {
      return '<option value="' + esc(item.id) + '">' + esc(item.id + ' · ' + item.label) + '</option>';
    }).join('');
    $('requirementSelect').value = activeRequirementId;
    var requirement = activeRequirementId === '__all__' ? null : materialSchema.getRequirement(activeRequirementId);
    if (requirement) activeKind = requirement.kind;
    $('kindSelect').innerHTML = group.kinds.map(function (item) {
      return '<option value="' + esc(item[0]) + '">' + esc(item[1]) + '</option>';
    }).join('');
    if (!group.kinds.some(function (item) { return item[0] === activeKind; })) activeKind = group.kinds[0][0];
    $('kindSelect').value = activeKind;
    $('kindSelect').hidden = !!requirement;
    $('resourceEyebrow').textContent = category.label.toUpperCase();
    $('resourceTitle').textContent = requirement ? requirement.label : group.label;
  }
  function activeRequirement() {
    return activeRequirementId && activeRequirementId !== '__all__' ? materialSchema.getRequirement(activeRequirementId) : null;
  }
  function resourcePreview(resource) {
    try { return JSON.stringify(resource.payload || {}, null, 2).slice(0, 420); } catch (_) { return ''; }
  }
  function renderResources() {
    var query = String($('resourceSearch').value || '').trim().toLowerCase();
    var filtered = resources.filter(function (resource) {
      return !query || (String(resource.id) + ' ' + JSON.stringify(resource.payload || {})).toLowerCase().indexOf(query) >= 0;
    });
    $('resourceList').innerHTML = filtered.length ? filtered.map(function (resource) {
      return '<article class="resource-card">' +
        '<div class="resource-card__head"><strong>' + esc(resource.id) + '</strong><span>v' + esc(resource.revision) + '</span></div>' +
        '<div class="resource-card__meta">' + esc(resource.status || 'active') + ' · ' + esc(new Date(resource.updatedAt || Date.now()).toLocaleString('zh-CN')) + '</div>' +
        '<pre class="resource-card__preview">' + esc(resourcePreview(resource)) + '</pre>' +
        '<div class="resource-card__actions"><button type="button" data-cite-id="' + esc(resource.id) + '" style="color:var(--amber,#b45309);font-weight:600">📌 引用至 AI</button><button type="button" data-edit-id="' + esc(resource.id) + '">编辑</button><button type="button" data-history-id="' + esc(resource.id) + '">历史</button><button type="button" class="danger" data-delete-id="' + esc(resource.id) + '">归档</button></div>' +
      '</article>';
    }).join('') : '<div class="docs-status">当前类型暂无资料，可新建一条。</div>';
    $('resourceStatus').textContent = filtered.length + ' 条';
  }
  async function loadResources() {
    var data = await api(resourcePath(activeKind));
    resources = Array.isArray(data.resources) ? data.resources : [];
    renderResources();
  }
  async function loadProject() {
    var data = await api('/api/novels/' + encodeURIComponent(projectId));
    var novel = data.novel || {};
    workspaceId = String(novel.workspaceId || '');
    projectRevision = Number(novel.revision) || 0;
    projectState = novel.state && typeof novel.state === 'object' ? novel.state : { title: novel.title || '未命名小说', volumes: [] };
    creationBookId = String(projectState.creationBookId || new URLSearchParams(location.search).get('bookId') || '').trim();
    $('projectTitle').textContent = novel.title || projectState.title || '作品资料中心';
    $('backEditor').href = '../index.html?nid=' + encodeURIComponent(projectId) + '#editor';
    if (!$('backEditor').dataset.postHooked) {
      $('backEditor').dataset.postHooked = 'true';
      $('backEditor').addEventListener('click', function (event) {
        if (window.parent && window.parent !== window) {
          event.preventDefault();
          window.parent.postMessage({ type: 'molan:navigate', page: 'editor', novelId: projectId }, '*');
        }
      });
    }
    $('storyWorkbench').href = './story-workbench.html?nid=' + encodeURIComponent(projectId) +
      (creationBookId ? '&bookId=' + encodeURIComponent(creationBookId) : '');
    renderBase();
    switchZone(activeZone);
  }
  function switchZone(zone) {
    activeZone = zone;
    activeRequirementId = '';
    document.querySelectorAll('[data-zone]').forEach(function (button) { button.classList.toggle('is-active', button.dataset.zone === zone); });
    document.querySelectorAll('[data-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.panel === 'base' ? zone !== 'base' : false;
    });
    renderKinds();
    loadResources().catch(function (error) { toast(error.message || '资料读取失败'); });
  }
  function openResource(resource) {
    currentResource = resource || null;
    var requirement = activeRequirement();
    $('resourceDialogTitle').textContent = resource ? '编辑 ' + resource.id : '新建 ' + (requirement ? requirement.label : activeKind);
    $('resourceId').value = resource ? resource.id : activeKind + '_' + Date.now().toString(36);
    $('resourceId').disabled = !!resource;
    var payload = resource
      ? JSON.parse(JSON.stringify(resource.payload || {}))
      : { id: $('resourceId').value, title: '', notes: '', references: [] };
    if (requirement) {
      payload.requirementIds = Array.isArray(payload.requirementIds) ? payload.requirementIds : [];
      if (payload.requirementIds.indexOf(requirement.id) < 0) payload.requirementIds.push(requirement.id);
      payload.requirementData = payload.requirementData && typeof payload.requirementData === 'object' && !Array.isArray(payload.requirementData)
        ? payload.requirementData : {};
    }
    $('resourcePayload').value = JSON.stringify(payload, null, 2);
    renderStructuredFields(payload);
    $('resourceDeleteBtn').hidden = !resource;
    $('resourceHistoryPanel').hidden = true;
    $('resourceHistoryList').replaceChildren();
    $('resourceFormStatus').textContent = resource ? '当前版本 v' + resource.revision : '新建资料';
    $('resourceDialog').hidden = false;
  }
  async function loadResourceHistory(resource) {
    var result = await api(resourcePath(activeKind, resource.id, 'history'));
    $('resourceHistoryPanel').hidden = false;
    $('resourceHistoryList').innerHTML = (result.versions || []).map(function (version) {
      var preview = '';
      try { preview = JSON.stringify(version.payload, null, 2).slice(0, 280); } catch (_) {}
      return '<article class="resource-history__item"><div class="resource-card__head"><strong>v' + esc(version.revision) + '</strong><time>' +
        esc(version.createdAt ? new Date(version.createdAt).toLocaleString('zh-CN') : '') + '</time></div><p>' + esc(version.changeReason || '未填写变更原因') + '</p>' +
        '<pre>' + esc(preview) + '</pre><button type="button" data-restore-revision="' + esc(version.revision) + '">恢复为新版本</button></article>';
    }).join('') || '<p class="docs-status">暂无历史版本。</p>';
  }
  async function restoreResourceVersion(targetRevision) {
    if (!currentResource || !window.confirm('将 v' + targetRevision + ' 的内容恢复为新版本？现有历史不会被覆盖。')) return;
    var result = await api(resourcePath(activeKind, currentResource.id, 'history/' + targetRevision + '/restore'), {
      method: 'POST', headers: authHeaders({ 'If-Match': currentResource.etag }),
      body: JSON.stringify({ changeReason: '从资料中心恢复历史版本 v' + targetRevision })
    });
    currentResource = result.resource;
    $('resourcePayload').value = JSON.stringify(currentResource.payload || {}, null, 2);
    renderStructuredFields(currentResource.payload || {});
    $('resourceFormStatus').textContent = '已恢复为新版本 v' + currentResource.revision;
    await loadResources();
    await loadResourceHistory(currentResource);
    $('resourceDialog').querySelector('.docs-dialog__card').scrollTop = 0;
  }
  function fieldKey(field) { return Array.isArray(field) ? field[0] : field.path; }
  function fieldType(field) { return Array.isArray(field) ? field[2] : field.type; }
  function fieldLabel(field) { return Array.isArray(field) ? field[1] : field.label; }
  function requirementField(field) { return !Array.isArray(field); }
  function fieldValue(payload, field) {
    var key = fieldKey(field);
    var type = fieldType(field);
    var value;
    if (requirementField(field)) {
      value = payload && payload.requirementData && payload.requirementData[key];
      if (value === undefined) value = payload && payload[key.slice(key.lastIndexOf('.') + 1)];
    } else value = payload && payload[key];
    if (type === 'json' || value && typeof value === 'object' && !Array.isArray(value)) {
      return value === undefined ? '' : JSON.stringify(value, null, 2);
    }
    if (type === 'references' || type === 'array') {
      return Array.isArray(value) ? value.map(function (item) { return typeof item === 'string' ? item : JSON.stringify(item); }).join('\n') : String(value == null ? '' : value);
    }
    if (type === 'boolean') return value === true ? 'true' : value === false ? 'false' : '';
    if (type.indexOf('select:') === 0) return value == null ? '' : String(value);
    return value == null ? '' : String(value);
  }
  function renderStructuredFields(payload) {
    var requirement = activeRequirement();
    renderedFields = requirement
      ? requirement.fields.slice()
      : (structuredFields[activeKind] || []).slice();
    $('structuredFields').innerHTML = renderedFields.map(function (field) {
      var key = fieldKey(field);
      var type = fieldType(field);
      var value = fieldValue(payload, field);
      var control;
      if (type.indexOf('select:') === 0) {
        control = '<select class="structured-field" data-field="' + esc(key) + '"><option value=""></option>' +
          type.slice(7).split('|').map(function (option) { return '<option value="' + esc(option) + '">' + esc(option) + '</option>'; }).join('') +
          '</select>';
      } else if (type === 'boolean') {
        control = '<select class="structured-field" data-field="' + esc(key) + '"><option value=""></option><option value="true">是</option><option value="false">否</option></select>';
      } else if (['textarea', 'array', 'references', 'json'].includes(type)) {
        control = '<textarea class="structured-field" data-field="' + esc(key) + '" rows="' + (type === 'array' || type === 'references' ? 3 : 4) + '">' + esc(value) + '</textarea>';
      } else {
        control = '<input class="structured-field" data-field="' + esc(key) + '" type="' + (type === 'number' ? 'number' : 'text') + '"' +
          (type === 'reference' ? ' placeholder="项目内资料 ID"' : '') + ' value="' + esc(value) + '">';
      }
      var wide = ['textarea', 'array', 'references', 'json'].includes(type);
      return '<label class="' + (wide ? 'structured-field--wide' : '') + '"><span>' + esc(fieldLabel(field)) +
        (requirementField(field) ? ' <code>' + esc(key) + '</code>' : '') + '</span>' + control + '</label>';
    }).join('');
    renderedFields.forEach(function (field) {
      var key = fieldKey(field);
      var control = Array.from(document.querySelectorAll('.structured-field')).find(function (item) { return item.dataset.field === key; });
      if (control && (fieldType(field).indexOf('select:') === 0 || fieldType(field) === 'boolean')) control.value = fieldValue(payload, field);
    });
    document.querySelectorAll('.structured-field').forEach(function (control) {
      control.dataset.initialValue = control.value;
      control.addEventListener('input', syncPayloadFromFields);
      control.addEventListener('change', syncPayloadFromFields);
    });
  }
  function syncPayloadFromFields() {
    var payload;
    var requirement = activeRequirement();
    try {
      payload = JSON.parse($('resourcePayload').value || '{}');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('资料负载必须是对象');
      if (requirement) {
        payload.requirementIds = Array.isArray(payload.requirementIds) ? payload.requirementIds : [];
        if (payload.requirementIds.indexOf(requirement.id) < 0) payload.requirementIds.push(requirement.id);
        payload.requirementData = payload.requirementData && typeof payload.requirementData === 'object' && !Array.isArray(payload.requirementData)
          ? payload.requirementData : {};
      }
      renderedFields.forEach(function (field) {
        var key = fieldKey(field);
        var type = fieldType(field);
        var control = Array.from(document.querySelectorAll('.structured-field')).find(function (item) { return item.dataset.field === key; });
        if (!control || control.value === control.dataset.initialValue) return;
        var data = requirement ? payload.requirementData : payload;
        var original = data[key];
        var value = control.value;
        if (type === 'json') data[key] = value.trim() ? JSON.parse(value) : null;
        else if (type === 'references') data[key] = value.split(/\r?\n/).map(function (item) {
          var entry = item.trim();
          if (!entry) return null;
          return entry[0] === '{' ? JSON.parse(entry) : entry;
        }).filter(Boolean);
        else if (type === 'array') data[key] = value.split(/\r?\n/).map(function (item) { return item.trim(); }).filter(Boolean);
        else if (type === 'number') data[key] = value === '' ? null : Number(value);
        else if (type === 'boolean') data[key] = value === '' ? null : value === 'true';
        else if (type.indexOf('select:') === 0) data[key] = value;
        else data[key] = value;
        if (!requirement && original && typeof original === 'object' && type === 'array' && !Array.isArray(original)) data[key] = original;
      });
    } catch (error) {
      $('resourceFormStatus').textContent = 'JSON 尚未有效，已保留原文：' + error.message;
      return false;
    }
    $('resourcePayload').value = JSON.stringify(payload, null, 2);
    document.querySelectorAll('.structured-field').forEach(function (control) { control.dataset.initialValue = control.value; });
    return true;
  }
  function closeResource() {
    $('resourceDialog').hidden = true;
    currentResource = null;
  }
  async function saveBase(event) {
    event.preventDefault();
    var form = new FormData(event.currentTarget);
    var profile = Object.assign({}, stateProfile());
    ['subtitle', 'penName', 'genre', 'theme', 'tone', 'targetReader', 'sellingPoints', 'completionPlan', 'shortSynopsis', 'longSynopsis'].forEach(function (name) { profile[name] = String(form.get(name) || ''); });
    profile.targetWordCount = Number(form.get('targetWordCount')) || 0;
    profile.targetChapterCount = Number(form.get('targetChapterCount')) || 0;
    var nextState = Object.assign({}, projectState, { title: String(form.get('title') || '未命名小说'), projectProfile: profile });
    try {
      var saved = await api('/api/novels/' + encodeURIComponent(projectId), { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ state: nextState, title: nextState.title, revision: projectRevision }) });
      projectState = nextState;
      projectRevision = Number(saved.revision) || projectRevision + 1;
      renderBase();
      toast('基础定位已保存');
    } catch (error) {
      $('baseStatus').textContent = error.data && error.data.code === 'revision_conflict' ? '版本冲突，请刷新后重试' : (error.message || '保存失败');
    }
  }
  async function saveResource(event) {
    event.preventDefault();
    if (!syncPayloadFromFields()) return;
    var id = String($('resourceId').value || '').trim();
    var payload;
    try { payload = JSON.parse($('resourcePayload').value || '{}'); } catch (_) { $('resourceFormStatus').textContent = 'JSON 格式错误'; return; }
    try {
      var data;
      if (currentResource) {
        data = await api(resourcePath(activeKind, id), { method: 'PATCH', headers: authHeaders({ 'If-Match': currentResource.etag }), body: JSON.stringify({ payload }) });
      } else {
        data = await api(resourcePath(activeKind), { method: 'POST', headers: authHeaders(), body: JSON.stringify({ id, payload }) });
      }
      closeResource();
      await loadResources();
      toast(data && data.resource ? '资料已保存' : '资料保存完成');
    } catch (error) {
      $('resourceFormStatus').textContent = error.data && error.data.code === 'revision_conflict' ? '版本冲突，请重新读取' : (error.message || '保存失败');
    }
  }
  async function deleteResource(id) {
    var resource = resources.find(function (item) { return item.id === id; });
    if (!resource || !window.confirm('归档资料「' + id + '」？历史版本仍会保留。')) return;
    try {
      await api(resourcePath(activeKind, id), { method: 'DELETE', headers: authHeaders({ 'If-Match': resource.etag }) });
      await loadResources();
      toast('资料已归档');
    } catch (error) { toast(error.message || '归档失败'); }
  }
  async function exportPackage() {
    try {
      var data = await api('/api/novels/' + encodeURIComponent(projectId) + '/package');
      var blob = new Blob([JSON.stringify(data.package, null, 2)], { type: 'application/json' });
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = projectId + '-project-package.json';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) { toast(error.message || '导出失败'); }
  }
  async function restorePackage(file) {
    var packageValue;
    try { packageValue = JSON.parse(await file.text()); } catch (_) { toast('导入文件不是有效 JSON'); return; }
    try {
      var data = await api('/api/novels/' + encodeURIComponent(projectId));
      var restored = await api('/api/novels/' + encodeURIComponent(projectId) + '/package/restore', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ revision: Number(data.novel.revision) || projectRevision, package: packageValue })
      });
      projectRevision = Number(restored.revision) || projectRevision + 1;
      await loadProject();
      if (activeZone !== 'base') await loadResources();
      toast('资料包已恢复');
    } catch (error) { toast(error.message || '恢复失败'); }
  }
  function bind() {
    var params = new URLSearchParams(location.search);
    projectId = String(params.get('nid') || '').trim();
    creationBookId = String(params.get('bookId') || '').trim();
    token = localStorage.getItem('ml_token') || '';
    $('storyWorkbench').href = './story-workbench.html?nid=' + encodeURIComponent(projectId) +
      (creationBookId ? '&bookId=' + encodeURIComponent(creationBookId) : '');
    if (!projectId || !token) { document.body.innerHTML = '<main class="docs-shell"><section class="docs-panel"><h2>请从已登录的作品编辑器进入资料中心</h2></section></main>'; return; }
    document.querySelectorAll('[data-zone]').forEach(function (button) { button.addEventListener('click', function () { switchZone(button.dataset.zone); }); });
    $('requirementSelect').addEventListener('change', function (event) {
      activeRequirementId = event.target.value;
      var requirement = activeRequirement();
      if (requirement) activeKind = requirement.kind;
      renderKinds();
      loadResources().catch(function (error) { toast(error.message || '资料读取失败'); });
    });
    $('kindSelect').addEventListener('change', function (event) {
      activeKind = event.target.value;
      activeRequirementId = '__all__';
      renderKinds();
      loadResources().catch(function (error) { toast(error.message || '资料读取失败'); });
    });
    $('resourceSearch').addEventListener('input', renderResources);
  $('resourceList').addEventListener('click', function (event) {
    var citeBtn = event.target.closest('[data-cite-id]');
    if (citeBtn) {
      var resId = citeBtn.dataset.citeId;
      var res = resources.find(function (r) { return r && r.id === resId; });
      if (!res) return;
      var content = JSON.stringify(res.payload || {}, null, 2);
      var citeText = '【作品资料：' + resId + '】\n' + content;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'molan:cite-to-prompt',
          text: citeText,
          title: '资料 ' + resId
        }, '*');
        toast('已引用至 AI 编辑器提示词！');
      } else if (window.opener && window.opener !== window) {
        window.opener.postMessage({
          type: 'molan:cite-to-prompt',
          text: citeText,
          title: '资料 ' + resId
        }, '*');
        toast('已直传至 AI 编辑器提示词！');
      } else {
        localStorage.setItem('molan_external_cite', JSON.stringify({
          text: citeText,
          title: '资料 ' + resId,
          time: Date.now()
        }));
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(citeText).catch(function () {});
        }
        toast('已复制并暂存资料「' + resId + '」，切回编辑器即可载入！');
      }
    }
  });
    $('newResourceBtn').addEventListener('click', function () { openResource(null); });
    $('resourceCloseBtn').addEventListener('click', closeResource);
    $('resourceDialog').addEventListener('click', function (event) { if (event.target === $('resourceDialog')) closeResource(); });
    $('resourceForm').addEventListener('submit', saveResource);
    $('resourcePayload').addEventListener('change', function () {
      try { renderStructuredFields(JSON.parse($('resourcePayload').value)); }
      catch (error) { $('resourceFormStatus').textContent = 'JSON 尚未有效，已保留原文：' + error.message; }
    });
    $('resourceDeleteBtn').addEventListener('click', function () {
      if (!currentResource) return;
      var resourceId = currentResource.id;
      closeResource();
      deleteResource(resourceId);
    });
    $('resourceList').addEventListener('click', function (event) {
      var editId = event.target.dataset.editId;
      var historyId = event.target.dataset.historyId;
      var deleteId = event.target.dataset.deleteId;
      if (editId) openResource(resources.find(function (item) { return item.id === editId; }));
      if (historyId) {
        var resource = resources.find(function (item) { return item.id === historyId; });
        if (resource) {
          openResource(resource);
          loadResourceHistory(resource).catch(function (error) { toast(error.message || '历史版本读取失败'); });
        }
      }
      if (deleteId) deleteResource(deleteId);
    });
    $('resourceHistoryList').addEventListener('click', function (event) {
      var revision = event.target.dataset.restoreRevision;
      if (revision) restoreResourceVersion(Number(revision)).catch(function (error) { toast(error.message || '历史版本恢复失败'); });
    });
    $('baseForm').addEventListener('submit', saveBase);
    $('exportBtn').addEventListener('click', exportPackage);
    $('restoreInput').addEventListener('change', function (event) { if (event.target.files[0]) restorePackage(event.target.files[0]); event.target.value = ''; });
    loadProject().catch(function (error) { toast(error.message || '作品读取失败'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
}());
