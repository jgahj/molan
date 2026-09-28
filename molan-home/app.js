/* ===================== 墨阑 · 落地页交互逻辑 ===================== */
'use strict';

const $ = id => document.getElementById(id);

/* ---------- 运行环境 ---------- */
// file:// 打开时相对 fetch 会失败，自动回退到本地服务地址
const API_BASE = (location.protocol === 'file:' || location.protocol === 'about:') ? 'http://localhost:3000' : '';
const isFileProtocol = location.protocol === 'file:';

/* ---------- i18n（中 / EN） ---------- */
const I18N = {
  zh: {
    nav_product: '产品功能', nav_home: '首页', nav_sub: '订阅', nav_kb: '文档',
    nav_tools: '免费工具', nav_doc: '文档', nav_blog: '博客', login: '登录', start: '开始创作',
    announce: 'AI 引擎 V4.0 全新上线',
    hero_title: '最是人间留不住，\n朱颜辞镜花辞树。',
    heroSub: '基于多智能体协作的高级小说创作平台。从设定推演到正文生成，将您的灵感化为传世之作。以书香之韵，驭现代之智。',
    pill_skill: '技能模式·动态装载', pill_adv: '高级', agent: '智能体', skill: '技能', skill_none: '无（默认）', skill_none_sub: '不使用额外技能', skill_active: '技能：{name}', chat_title: '创作对话', clear: '清空', stop: '■ 停止', length_limit: '（生成已达当前长度上限，可要求继续）',
    cta_create: '快速创建小说', cta_register: '免费注册', cta_mine: '我的小说', cta_import: '导入小说',
    footer_tag: '墨阑 · 以书香之韵，驭现代之智', footer_about: '关于我们', footer_tos: '服务条款', footer_privacy: '隐私政策',
    save: '保存', cancel: '取消', reg_note: '演示环境，不会真实提交信息。', chatPh: '帮我构思一个悬疑推理的开头...',
    thinking: '正在思考…', conn_ok: '创作服务已连接', conn_fail: '创作服务未连接',
    service_hint: 'AI 创作功能需要本地服务支持。请在项目目录运行 node server.js 后刷新页面。',
    network_err: '无法连接到创作服务，请确保已运行 node server.js。',
    file_protocol_err: '当前以文件协议打开页面，AI 功能需要 http://localhost:3000 服务支持。',
    empty_input: '请输入内容后再发送。',
    copy_output: '复制', copy_all: '复制全部', copied: '已复制', copy_fail: '复制失败',
    no_output: '暂无可复制的输出',
    model: '模型', think_mode: '思考',
    model_auto: '自动切换', model_auto_sub: '按任务复杂度自动选 Flash / Pro',
    model_flash: 'V4-Flash', model_flash_sub: '极速生成 · 日常写作',
    model_pro: 'V4-Pro', model_pro_sub: '深度推理 · 复杂长文',
    think_on: '已开启思考模式：使用深度推理模型并展示思考过程', think_off: '已关闭思考模式',
    think_label: '思考过程', auto_pick: '自动选择', fallback_note: '（Pro 调用失败，已自动切换 Flash 重试）'
  },
  en: {
    nav_product: 'Features', nav_home: 'Home', nav_sub: 'Pricing', nav_kb: 'Knowledge',
    nav_tools: 'Free Tools', nav_doc: 'Docs', nav_blog: 'Blog', login: 'Login', start: 'Start Writing',
    announce: 'AI Engine V4.0 is live',
    hero_title: 'What man most fails to keep,\nIs the face that leaves the glass, the flower that leaves the tree.',
    heroSub: 'An advanced novel-writing platform powered by multi-agent collaboration. From worldbuilding to full drafts — turn your inspiration into a masterpiece.',
    pill_skill: 'Skill mode · dynamic', pill_adv: 'Advanced', agent: 'Agent', skill: 'Skill', skill_none: 'None', skill_none_sub: 'No extra skill', skill_active: 'Skill: {name}', chat_title: 'Writing Chat', clear: 'Clear', stop: '■ Stop', length_limit: ' (reached length limit; ask to continue)',
    cta_create: 'Quick Create', cta_register: 'Sign Up Free', cta_mine: 'My Novels', cta_import: 'Import',
    footer_tag: 'Molan · Where classics meet modern intelligence', footer_about: 'About', footer_tos: 'Terms', footer_privacy: 'Privacy',
    save: 'Save', cancel: 'Cancel', reg_note: 'Demo only — nothing is submitted.', chatPh: 'Help me outline a mystery opening...',
    thinking: 'Thinking…', conn_ok: 'Service connected', conn_fail: 'Service unavailable',
    service_hint: 'AI writing requires the local server. Please run node server.js in the project folder and refresh.',
    network_err: 'Cannot connect to the writing service. Make sure node server.js is running.',
    file_protocol_err: 'This page is opened via file://. AI features require http://localhost:3000.',
    empty_input: 'Please type something before sending.',
    copy_output: 'Copy', copy_all: 'Copy all', copied: 'Copied', copy_fail: 'Copy failed',
    no_output: 'No output to copy',
    model: 'Model', think_mode: 'Think',
    model_auto: 'Auto', model_auto_sub: 'Pick Flash / Pro by task complexity',
    model_flash: 'V4-Flash', model_flash_sub: 'Fast · everyday writing',
    model_pro: 'V4-Pro', model_pro_sub: 'Deep reasoning · complex drafts',
    think_on: 'Thinking mode ON: deep-reasoning model with visible thoughts', think_off: 'Thinking mode OFF',
    think_label: 'Thoughts', auto_pick: 'auto', fallback_note: ' (Pro failed; auto-retried with Flash)'
  }
};
let lang = localStorage.getItem('molan_lang') || 'zh';

function applyI18n() {
  const dict = I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    if (dict[k] != null) {
      // 多行标题用 <br> 保留换行
      if (k === 'hero_title') el.innerHTML = escapeHtml(dict[k]).replace(/\n/g, '<br>');
      else el.textContent = dict[k];
    }
  });
  const chatInput = $('chatInput');
  if (chatInput) chatInput.setAttribute('placeholder', dict.chatPh);
  updateServiceBanner();
  buildModelMenu(); // 语言切换时刷新模型下拉文案
}

/* ---------- 主题切换 ---------- */
function applyTheme(t) {
  const root = document.getElementById('htmlRoot');
  if (root) root.setAttribute('data-theme', t);
  localStorage.setItem('molan_theme', t);
}
const themeToggle = $('themeToggle');
if (themeToggle) {
  themeToggle.onclick = () => {
    const root = document.getElementById('htmlRoot');
    const cur = root ? root.getAttribute('data-theme') : 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  };
}

/* ---------- 语言切换 ---------- */
const langToggle = $('langToggle');
if (langToggle) {
  langToggle.onclick = () => {
    lang = lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('molan_lang', lang);
    langToggle.textContent = lang === 'zh' ? '中' : 'EN';
    applyI18n();
  };
}

/* ---------- 智能体下拉（写作风格预设，与模型选择解耦） ---------- */
const AGENTS = [
  { label: '通用写作', sub: '默认创作助手', persona: '' },
  { label: '悬疑推理', sub: '布局伏笔 · 反转控制', persona: '你当前扮演悬疑推理写作专家，擅长伏笔布局、线索管理与结局反转。' },
  { label: '爆款仿写', sub: '网文爆点 · 黄金三章', persona: '你当前扮演网文爆款写手，擅长黄金三章、强钩子开头与情绪节奏。' },
  { label: '古风雅言', sub: '典雅文风 · 诗词意象', persona: '你当前扮演古典文学功底深厚的写作者，行文典雅、善用诗词意象。' }
];
let currentPersona = '';
const agentMenu = $('agentMenu');
const agentLabel = $('agentLabel');
const agentBtn = $('agentBtn');
if (agentMenu && agentLabel) {
  AGENTS.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span class="ml-text-sm">${a.label}</span><span class="sub">${a.sub}</span>`;
    b.onclick = () => {
      currentPersona = a.persona;
      agentLabel.textContent = a.label;
      agentMenu.hidden = true;
    };
    agentMenu.appendChild(b);
  });
  if (agentBtn) {
    agentBtn.onclick = e => { e.stopPropagation(); agentMenu.hidden = !agentMenu.hidden; };
  }
  document.addEventListener('click', () => { agentMenu.hidden = true; });
}

/* ---------- 模型选择（V4-Flash / V4-Pro / 自动切换） ---------- */
// 模型选择按账户隔离；普通用户由服务端下发默认模型，VIP 保留独立选择权。
let modelChoice = localStorage.getItem(accountStorageKey('molan_model')) || 'auto';
let HOME_CAN_CHOOSE_MODEL = false;
let HOME_DEFAULT_MODEL = 'gpt-5.6-luna';
let HOME_DEFAULT_MODEL_LABEL = '';
let HOME_MODELS = [];
let thinkMode = localStorage.getItem('molan_think') === '1';
const modelMenu = $('modelMenu');
const modelLabel = $('modelLabel');
const modelBtn = $('modelBtn');

function homeModelById(id) {
  return HOME_MODELS.find(m => m && m.id === String(id)) || null;
}

function homeModelSubtitle(model) {
  if (!model) return '';
  const group = model.group === 'deepseek' ? 'DeepSeek' : (model.group === 'gpt' ? 'GPT 中转' : (model.group || '平台模型'));
  return group + (model.supportsReasoning ? ' · 支持推理' : '');
}

function modelDisplayName(choice) {
  const d = I18N[lang];
  if (!HOME_CAN_CHOOSE_MODEL && HOME_DEFAULT_MODEL_LABEL) return HOME_DEFAULT_MODEL_LABEL;
  if (choice === 'auto') return d.model_auto;
  const model = homeModelById(choice);
  return model ? model.name : d.model_auto;
}

function buildModelMenu() {
  if (!modelMenu) return;
  if (!HOME_CAN_CHOOSE_MODEL) {
    modelMenu.innerHTML = '';
    modelMenu.hidden = true;
    if (modelLabel) modelLabel.textContent = HOME_DEFAULT_MODEL_LABEL || '平台默认模型';
    if (modelBtn) {
      modelBtn.disabled = true;
      modelBtn.classList.add('is-locked');
      modelBtn.title = '普通用户使用平台默认模型';
    }
    return;
  }
  if (modelBtn) {
    modelBtn.disabled = false;
    modelBtn.classList.remove('is-locked');
    modelBtn.title = '选择模型';
  }
  const d = I18N[lang];
  const items = [{ id: 'auto', label: d.model_auto, sub: d.model_auto_sub }].concat(HOME_MODELS.map(model => ({
    id: model.id,
    label: model.name || model.id,
    sub: homeModelSubtitle(model)
  })));
  modelMenu.innerHTML = '';
  items.forEach(it => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.modelId = it.id;
    b.innerHTML = `<span class="ml-text-sm skill-name">${it.label}</span><span class="sub">${it.sub}</span>`;
    b.classList.toggle('checked', modelChoice === it.id);
    b.onclick = () => {
      modelChoice = it.id;
      localStorage.setItem(accountStorageKey('molan_model'), modelChoice);
      if (modelLabel) modelLabel.textContent = it.label;
      modelMenu.querySelectorAll('button').forEach(x => x.classList.toggle('checked', x.dataset.modelId === modelChoice));
      modelMenu.hidden = true;
    };
    modelMenu.appendChild(b);
  });
  if (modelLabel) modelLabel.textContent = modelDisplayName(modelChoice);
}
if (modelBtn && modelMenu) {
  modelBtn.onclick = e => { e.stopPropagation(); modelMenu.hidden = !modelMenu.hidden; };
  document.addEventListener('click', () => { modelMenu.hidden = true; });
}
buildModelMenu();

async function loadHomeModelAccess() {
  try {
    const headers = {};
    const token = localStorage.getItem('ml_token');
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(API_BASE + '/api/models', { headers, cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const access = data && data.access;
    HOME_MODELS = data && Array.isArray(data.models) ? data.models : [];
    HOME_CAN_CHOOSE_MODEL = !!(access && access.canChooseModel);
    HOME_DEFAULT_MODEL = String((access && access.defaultModel) || HOME_DEFAULT_MODEL);
    const defaultModel = homeModelById(HOME_DEFAULT_MODEL) || HOME_MODELS[0];
    HOME_DEFAULT_MODEL_LABEL = defaultModel && defaultModel.name ? defaultModel.name : '';
    if (HOME_CAN_CHOOSE_MODEL && modelChoice !== 'auto' && !homeModelById(modelChoice)) modelChoice = 'auto';
    buildModelMenu();
  } catch (_) {}
}
loadHomeModelAccess();

/* 自动切换：按任务复杂度启发式选择模型 */
const PRO_HINTS = /(大纲|世界观|设定|长篇|全文|整章|多线|伏笔|复盘|逻辑|推理|架构|复杂|细纲|分卷|人物弧|时间线|续写.{0,6}章|outline|worldbuild|plot|logic|complex)/i;
function pickModel(text) {
  if (!HOME_CAN_CHOOSE_MODEL) return HOME_DEFAULT_MODEL;
  if (modelChoice !== 'auto' && homeModelById(modelChoice)) return modelChoice;
  // 长需求或含复杂创作关键词 → Pro（深度推理）；否则 Flash（极速）
  const preferred = (text.length > 120 || PRO_HINTS.test(text))
    ? HOME_MODELS.find(m => /pro|reason|gpt-5\.6/i.test(String(m.id) + ' ' + String(m.model || '')))
    : HOME_MODELS.find(m => /flash|mini/i.test(String(m.id) + ' ' + String(m.model || '')));
  return (preferred && preferred.id) || HOME_DEFAULT_MODEL;
}

/* 思考模式开关 */
const thinkBtn = $('thinkBtn');
function syncThinkBtn() { if (thinkBtn) thinkBtn.classList.toggle('think-active', thinkMode); }
if (thinkBtn) {
  thinkBtn.onclick = () => {
    thinkMode = !thinkMode;
    localStorage.setItem('molan_think', thinkMode ? '1' : '0');
    syncThinkBtn();
    toast(thinkMode ? I18N[lang].think_on : I18N[lang].think_off);
  };
  syncThinkBtn();
}

/* ---------- 写作技能装载（后端只读 .codex/skills，原文件不改） ---------- */
// 多选：保存已选技能 id 数组，下拉中显示技能原名
let selectedSkillIds = [];
let globalSkillIds = [];
const DEFAULT_WRITING_SKILL_ID = 'write-high-tension-fiction';
const skillsMap = {};
let skillsLoadError = null;
let skillsReady = Promise.resolve([]);
let skillSyncReady = Promise.resolve();
const skillMenu = $('skillMenu');
const skillLabel = $('skillLabel');
const skillBtn = $('skillBtn');

function skillIdentityKey(skill) {
  const name = String(skill && skill.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (name) return 'name:' + name;
  const id = String(skill && skill.id || '')
    .trim()
    .toLowerCase()
    .replace(/^user-[0-9a-f]{12}-/, '')
    .replace(/^local-/, '')
    .replace(/-copy-\d+$/, '');
  return 'id:' + id;
}

function isAutoAppliedSkill(skill) {
  return !!(skill && ((skill.global && skill.autoApply) || skill.id === DEFAULT_WRITING_SKILL_ID));
}

function uniqueSkillsById(list) {
  const byId = new Map();
  (Array.isArray(list) ? list : []).forEach(skill => {
    if (!skill || !String(skill.id || '').trim()) return;
    const identity = skillIdentityKey(skill);
    const source = String(skill.source || '').toLowerCase();
    const priority = source === 'user' ? 3 : source === 'global' ? 2 : source === 'builtin' ? 1 : 0;
    const previous = byId.get(identity);
    const previousSource = String(previous && previous.source || '').toLowerCase();
    const previousPriority = previousSource === 'user' ? 3 : previousSource === 'global' ? 2 : previousSource === 'builtin' ? 1 : 0;
    if (!previous || priority > previousPriority) byId.set(identity, skill);
  });
  return [...byId.values()];
}

// 统一的技能菜单项构造（服务端技能与本地载入技能共用）
function makeSkillMenuItem(s) {
  const name = s.name || s.id;
  const desc = (s.description || '').slice(0, 60) + ((s.description || '').length > 60 ? '…' : '');
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.skillId = s.id;
  if (isAutoAppliedSkill(s)) {
    b.classList.add('global-skill');
    b.title = s.id === DEFAULT_WRITING_SKILL_ID ? '默认写作 Skill：正文生成时自动应用' : '全局 Skill：已自动应用';
  }
  const files = (s.files || []).map(f => f.replace(/\\/g, '/'));
  const fileInfo = files.length
    ? (s.local ? '本地载入 · ' : '已加载 ') + files.length + ' 个文件：' + files.join('、')
    : (s.local ? '本地载入 · SKILL.md 自包含' : '单一文件（SKILL.md 自包含）');
  b.innerHTML = `<span class="ml-text-sm skill-name">${escapeHtml(name)}</span><span class="sub">${escapeHtml(desc)}</span><span class="sub" style="color:var(--ml-green,#1a8a4f);margin-top:2px;">${escapeHtml(fileInfo)}</span>`;
  b.onclick = (e) => {
    e.stopPropagation();
    if (isAutoAppliedSkill(s)) return;
    const i = selectedSkillIds.indexOf(s.id);
    if (i >= 0) selectedSkillIds.splice(i, 1); else selectedSkillIds.push(s.id);
    updateSkillLabel(); syncSkillMenuChecked(); updateSkillTag();
  };
  return b;
}

function renderSkillMenu() {
  if (!skillMenu) return;
  skillMenu.innerHTML = '';

  const none = document.createElement('button');
  none.type = 'button';
  none.innerHTML = `<span class="ml-text-sm">${I18N[lang].skill_none}</span><span class="sub">${I18N[lang].skill_none_sub}</span>`;
  none.onclick = () => {
    selectedSkillIds = [];
    updateSkillLabel();
    syncSkillMenuChecked();
    skillMenu.hidden = true;
    updateSkillTag();
  };
  skillMenu.appendChild(none);

  if (Array.isArray(localSkills)) {
    localSkills.forEach(skill => {
      skillsMap[skill.id] = skill;
      skillMenu.appendChild(makeSkillMenuItem(skill));
    });
  }

  if (skillsLoadError) {
    const status = document.createElement('div');
    status.className = 'skill-menu__status';
    status.textContent = localSkills && localSkills.length
      ? '在线 Skill 暂时不可用，已保留本地技能'
      : 'Skill 服务暂时不可用，请稍后重试';
    skillMenu.appendChild(status);
  }
}

async function loadSkills() {
  skillsLoadError = null;
  try {
    const requestIdentity = currentAccountStorageSuffix();
    const headers = {};
    try { const token = localStorage.getItem('ml_token'); if (token) headers.Authorization = 'Bearer ' + token; } catch (_) {}
    const previousSkills = { ...skillsMap };
    const previousSelectedSkillIds = selectedSkillIds.slice();
    Object.keys(skillsMap).forEach(id => { if (id.indexOf('local-') !== 0) delete skillsMap[id]; });
    const res = await fetch(API_BASE + '/api/skills', { headers, cache: 'no-store' });
    if (!res.ok) throw new Error('Skill service returned HTTP ' + res.status);
    const list = await res.json();
    if (currentAccountStorageSuffix() !== requestIdentity) return;
    if (!Array.isArray(list) || !skillMenu) return;
    const uniqueList = uniqueSkillsById(list);
    const autoIds = uniqueList.filter(s => s && s.global && s.autoApply && s.enabled !== false).map(s => s.id);
    if (uniqueList.some(s => s && s.id === DEFAULT_WRITING_SKILL_ID && s.enabled !== false)) autoIds.push(DEFAULT_WRITING_SKILL_ID);
    globalSkillIds = [...new Set(autoIds)];
    skillMenu.innerHTML = '';
    // 「无（默认）」：清空所有已选技能
    const none = document.createElement('button');
    none.type = 'button';
    none.innerHTML = `<span class="ml-text-sm">${I18N[lang].skill_none}</span><span class="sub">${I18N[lang].skill_none_sub}</span>`;
    none.onclick = () => {
      selectedSkillIds = [];
      updateSkillLabel();
      syncSkillMenuChecked();
      skillMenu.hidden = true;
      updateSkillTag();
    };
    skillMenu.appendChild(none);
    // 各写作技能：显示原名（s.name），可多选
    const winners = new Map();
    uniqueList.forEach(s => {
      skillsMap[s.id] = s;
      winners.set(skillIdentityKey(s), s.id);
      skillMenu.appendChild(makeSkillMenuItem(s));
    });
    selectedSkillIds = previousSelectedSkillIds.map(id => {
      const oldSkill = previousSkills[id] || { id };
      return winners.get(skillIdentityKey(oldSkill)) || id;
    });
    selectedSkillIds = [...new Set(selectedSkillIds.filter(id => skillsMap[id] || globalSkillIds.includes(id)))];
    updateSkillLabel();
    syncSkillMenuChecked();
  } catch (error) {
    skillsLoadError = error;
    renderSkillMenu();
    updateSkillTag();
    return [];
  }
}

function syncSkillMenuChecked() {
  if (!skillMenu) return;
  skillMenu.querySelectorAll('button[data-skill-id]').forEach(b => {
    b.classList.toggle('checked', effectiveSkillIds().includes(b.dataset.skillId));
  });
}

function effectiveSkillIds() {
  return [...new Set(globalSkillIds.concat(selectedSkillIds))];
}

function skillModesForSkill(skill) {
  if (!skill) return ['all'];
  if (skill.source === 'dissection' || String(skill.id || '').startsWith('dissect-')) return ['write'];
  const raw = [skill.id, skill.name, skill.description, ...(Array.isArray(skill.targets) ? skill.targets : [])].filter(Boolean).join(' ').toLowerCase();
  const modes = [];
  if (/humanizer|去\s*ai|去ai味|人味|校正|润色/.test(raw)) modes.push('humanize');
  if (/extract|dissect|抽取|拆书|资料分析|文风提取/.test(raw)) modes.push('extract');
  if (/analy|consisten|审核|一致性|检测/.test(raw)) modes.push('analyze');
  if (/write|writing|xuanhuan|玄幻|创作|文风|仿写|续写|generation/.test(raw)) modes.push('write');
  return modes.length ? [...new Set(modes)] : ['all'];
}

function activeSkillsForMode(mode) {
  const orderedIds = [...new Set(selectedSkillIds.concat(globalSkillIds))];
  const candidates = orderedIds.map(id => skillsMap[id]).filter(Boolean);
  // Keep universal Skills alongside mode-specific Skills.
  return candidates.filter(skill => {
    const modes = skillModesForSkill(skill);
    return modes.includes(mode) || modes.includes('all');
  });
}

function skillModeForTask(base) {
  const text = String(base || '');
  if (/去\s*AI|去ai味|人味|校正|润色|降低模板化|改写正文/.test(text)) return 'humanize';
  if (/资料抽取|抽取引擎|抽取可被|拆书|文风提取/.test(text)) return 'extract';
  if (/一致性|审核引擎|检测助手|AI 文本检测/.test(text)) return 'analyze';
  return 'write';
}

function skillModeForMessages(messages) {
  const system = (Array.isArray(messages) ? messages : []).find(message => message && message.role === 'system');
  const content = String(system && system.content || '');
  const base = content.split('【墨阑 Skill 运行状态】')[0].split('[MOLAN_SKILL_BLOCK_BEGIN')[0];
  return skillModeForTask(base);
}

function renderSelectedSkillBlock(skill) {
  if (!skill) return '';
  const instruction = promptInstructionForSkill(skill);
  if (!instruction) return '';
  const auditId = encodeURIComponent(String(skill.id || ''));
  return '\n--- Skill ' + (skill.name || skill.id) + ' ---\n' +
    '[MOLAN_SKILL_BLOCK_BEGIN id=' + auditId + ']\n' + instruction +
    '\n[MOLAN_SKILL_BLOCK_END id=' + auditId + ']';
}

function injectSelectedSkillBlocks(messages, mode) {
  const selected = activeSkillsForMode(mode || 'write');
  if (!selected.length) return Array.isArray(messages) ? messages : [];
  const source = Array.isArray(messages) ? messages : [];
  const systemMessages = source.filter(message => message && message.role === 'system');
  const missing = selected.filter(skill => {
    const marker = '[MOLAN_SKILL_BLOCK_BEGIN id=' + encodeURIComponent(String(skill.id || '')) + ']';
    return !systemMessages.some(message => String(message.content || '').includes(marker));
  });
  if (!missing.length) return source;
  const extra = '\n\nActive Skills:\n' + missing.map(renderSelectedSkillBlock).join('');
  const output = source.map(message => ({ ...message }));
  const systemIndex = output.findIndex(message => message && message.role === 'system');
  if (systemIndex >= 0) {
    output[systemIndex].content = String(output[systemIndex].content || '') + extra;
  } else {
    output.unshift({ role: 'system', content: extra.trim() });
  }
  return output;
}

function buildSkillAuditPayload(mode) {
  const selected = activeSkillsForMode(mode || 'write');
  return {
    version: 1,
    skills: selected.map(skill => {
      return {
        id: skill.id,
        name: skill.name || skill.id,
        files: Array.isArray(skill.files) ? skill.files.slice(0, 500) : [],
        fileManifest: Array.isArray(skill.fileManifest) ? skill.fileManifest.slice(0, 500) : [],
        promptFiles: promptFilesForSkill(skill).slice(0, 500)
      };
    })
  };
}

function updateSkillLabel() {
  if (!skillLabel) return;
  const ids = effectiveSkillIds();
  if (!ids.length) { skillLabel.textContent = I18N[lang].skill_none; return; }
  const names = ids.map(id => (skillsMap[id] ? (skillsMap[id].name || id) : id));
  skillLabel.textContent = names.length === 1 ? names[0] : `已选 ${names.length} 项`;
}

if (skillBtn && skillMenu) {
  skillBtn.onclick = e => { e.stopPropagation(); skillMenu.hidden = !skillMenu.hidden; };
  document.addEventListener('click', () => { skillMenu.hidden = true; });
}

/* ---------- 本地文件夹载入：按钮与弹窗接线 ---------- */
const loadFolderBtn = $('loadFolderBtn');
if (loadFolderBtn) loadFolderBtn.onclick = () => loadLocalFolder();
const localTagBtn = $('localTag');
if (localTagBtn) localTagBtn.onclick = () => { renderLocalPanel(); openModal('localModal'); };
const localClearBtn = $('localClearBtn');
if (localClearBtn) localClearBtn.onclick = () => {
  localSkills = []; localMaterial = [];
  if (skillMenu) skillMenu.querySelectorAll('button[data-skill-id^="local-"]').forEach(b => b.remove());
  Object.keys(skillsMap).forEach(k => { if (k.indexOf('local-') === 0) delete skillsMap[k]; });
  selectedSkillIds = selectedSkillIds.filter(id => id.indexOf('local-') !== 0);
  renderLocalPanel(); updateLocalTag(); updateSkillLabel(); syncSkillMenuChecked(); updateSkillTag();
  toast('已清空本地载入的技能与素材');
};

function buildSkillBlock(mode) {
  let sys = SYSTEM_PROMPT;
  if (currentPersona) sys += '\n' + currentPersona;
  const selected = activeSkillsForMode(mode || 'write');
  if (selected.length) {
    const names = selected.map(s => s.name || s.id).join('、');
    sys += '\n\n【你当前已启用 Skill：' + names + '】\n当前阶段为「' + (mode || 'write') + '」，请按列表顺序综合执行全部已启用 Skill 的规则；用户最新指令和当前作品设定优先。\n';
    selected.forEach(s => {
      const instruction = promptInstructionForSkill(s);
      const auditId = encodeURIComponent(String(s.id || ''));
      sys += '\n--- 技能「' + (s.name || s.id) + '」规范 ---\n' +
        '[MOLAN_SKILL_BLOCK_BEGIN id=' + auditId + ']\n' + instruction +
        '\n[MOLAN_SKILL_BLOCK_END id=' + auditId + ']';
    });
  }
  return sys;
}

function buildSystem(mode) {
  let sys = buildSkillBlock(mode || 'write');
  const mat = buildMaterialBlock();
  if (mat) sys += '\n\n' + mat;
  return sys;
}

/* ---------- 本地文件夹载入（统一版：本地技能 + 素材库） ---------- */
// 说明：浏览器文件夹选择器不暴露绝对路径，故由前端直接读取文件内容。
// 含 SKILL.md 的子目录 → 注册为可选技能（复用 skillsMap / 技能下拉）；
// 其余文本文件 → 汇成「本地素材库」，注入 system prompt 作为写作参考。
let localSkills = [];          // [{ id, name, description, instruction, files, local:true }]
let localMaterial = [];        // [{ relPath, name, size, text, include }]
let localMaterialEnabled = true;
const TEXT_EXT = /\.(txt|md|markdown|json|csv|yaml|yml|text|log|srt|ass|vtt|xml|toml|html?)$/i;
const BINARY_EXT = /\.(png|jpe?g|gif|bmp|webp|ico|pdf|zip|rar|7z|exe|dll|docx?|xlsx?|pptx?|mp3|mp4|wav|avi|mov|mkv|bin|dat|woff2?|ttf|eot|skp|psd)$/i;
const SKIP_DIR = /^(__MACOSX|node_modules|\.git|\.svn|dist|build|\.DS_Store)$/;

// 解析 SKILL.md frontmatter（与 server.js composeSkill 保持一致）
function parseLocalFrontmatter(raw) {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  let name = '', description = '', body = raw;
  if (fmMatch) {
    const fm = fmMatch[1];
    const nameM = fm.match(/^name:\s*(.+)$/m); if (nameM) name = nameM[1].trim();
    const descM = fm.match(/^description:\s*(\||>)?\s*(.*)$/m);
    if (descM) {
      if (descM[2].trim() === '' && descM[1]) {
        const after = fm.slice(fm.indexOf('description:') + 'description:'.length);
        const block = [];
        for (const ln of after.split('\n')) { if (/^[A-Za-z_]/.test(ln)) break; const t = ln.trim(); if (t === '|' || t === '>') continue; if (t) block.push(t); }
        description = block.join(' ').trim();
      } else description = descM[2].trim();
    }
    const secondDash = raw.indexOf('---', raw.indexOf('---') + 3);
    if (secondDash >= 0) body = raw.slice(secondDash + 3).trim();
  }
  return { name, description, body };
}

function normalizeLocalSkillPath(value) {
  const rel = String(value == null ? '' : value).replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:\//.test(rel)) return '';
  const parts = rel.split('/');
  if (parts.some(part => !part || part === '..' || part === '.')) return '';
  return parts.join('/');
}

function promptFilesForSkill(skill) {
  const runtimeFiles = skill && skill.runtimeFiles && typeof skill.runtimeFiles === 'object' ? skill.runtimeFiles : {};
  const listed = Array.isArray(skill && skill.files) && skill.files.length ? skill.files : Object.keys(runtimeFiles);
  const files = [...new Set(listed.map(normalizeLocalSkillPath).filter(Boolean))];
  const textFiles = files.filter(path => typeof runtimeFiles[path] === 'string');
  return textFiles.sort((left, right) => {
    if (left === 'SKILL.md') return -1;
    if (right === 'SKILL.md') return 1;
    return left.localeCompare(right);
  });
}

function promptInstructionForSkill(skill) {
  if (skill && String(skill.promptInstruction || '').trim()) return String(skill.promptInstruction).trim();
  const runtimeFiles = skill && skill.runtimeFiles && typeof skill.runtimeFiles === 'object' ? skill.runtimeFiles : {};
  const raw = typeof runtimeFiles['SKILL.md'] === 'string' ? runtimeFiles['SKILL.md'] : '';
  if (!raw) return String(skill && (skill.runtimeInstruction || skill.instruction) || '').trim();
  const parts = [parseLocalFrontmatter(raw).body];
  promptFilesForSkill(skill).forEach(path => {
    if (path === 'SKILL.md') return;
    const content = runtimeFiles[path];
    if (typeof content === 'string' && content.trim()) parts.push('### Skill file: `' + path + '`\n\n' + content);
  });
  const output = parts.filter(Boolean).join('\n\n').trim();
  return output || String(skill && (skill.runtimeInstruction || skill.instruction) || '').trim();
}

// 由 SKILL.md 文本 + 该技能目录内的文件映射，复刻 server 的完整调用。
function composeLocalSkill(id, raw, fileMap, fileMeta) {
  const { name, description, body } = parseLocalFrontmatter(raw);
  const loadedFiles = Object.keys(fileMap || {}).sort();
  const runtimeFiles = {};
  const parts = [body];
  loadedFiles.forEach(key => {
    const content = String(fileMap[key] == null ? '' : fileMap[key]);
    runtimeFiles[key] = content;
    if (key === 'SKILL.md') return;
    parts.push('\n\n### Skill file: `' + key + '`\n\n' + content);
  });
  runtimeFiles['SKILL.md'] = raw;
  if (!loadedFiles.includes('SKILL.md')) loadedFiles.unshift('SKILL.md');
  const instruction = parts.join('');
  const truncatedFiles = loadedFiles.filter(filePath => fileMeta && fileMeta[filePath] && fileMeta[filePath].truncated);
  const skill = {
    id, name: name || id, description, instruction, runtimeInstruction: instruction,
    runtimeFiles, files: loadedFiles,
    fileManifest: loadedFiles.map(path => {
      const meta = fileMeta && fileMeta[path];
      return {
        path,
        type: 'text',
        size: String(runtimeFiles[path] || '').length,
        originalSize: Number(meta && meta.size) || String(runtimeFiles[path] || '').length,
        loadedBytes: Number(meta && meta.loadedBytes) || localUtf8ByteLength(runtimeFiles[path] || ''),
        truncated: !!(meta && meta.truncated)
      };
    }),
    truncatedFiles,
    complete: true, local: true, size: instruction.length
  };
  return { ...skill, promptFiles: promptFilesForSkill(skill), promptInstruction: promptInstructionForSkill(skill) };
}

const LOCAL_TEXT_READ_LIMIT_BYTES = 2 * 1024 * 1024;
const LOCAL_TRUNCATION_MARKER = '\n\n[墨阑提示：文件内容超过读取限制，已保留前部内容。]';
const LOCAL_MATERIAL_PROMPT_LIMIT_BYTES = 2 * 1024 * 1024;

function localUtf8ByteLength(value) {
  const text = String(value == null ? '' : value);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  return unescape(encodeURIComponent(text)).length;
}

function truncateLocalUtf8Head(value, maxBytes, marker) {
  const source = String(value == null ? '' : value);
  const limit = Math.max(0, Math.floor(Number(maxBytes) || 0));
  if (localUtf8ByteLength(source) <= limit) return { text: source, truncated: false, bytes: localUtf8ByteLength(source) };
  const suffix = String(marker == null ? LOCAL_TRUNCATION_MARKER : marker);
  const suffixBytes = localUtf8ByteLength(suffix);
  const codePoints = Array.from(source);
  let low = 0;
  let high = codePoints.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const head = codePoints.slice(0, middle).join('');
    if (localUtf8ByteLength(head) <= Math.max(0, limit - suffixBytes)) low = middle;
    else high = middle - 1;
  }
  const text = codePoints.slice(0, low).join('') + (suffixBytes <= limit ? suffix : '');
  return { text, truncated: true, bytes: localUtf8ByteLength(text) };
}

async function readLocalTextHead(file) {
  const originalSize = Number(file && file.size) || 0;
  const limit = LOCAL_TEXT_READ_LIMIT_BYTES;
  const readSize = Math.min(originalSize, limit + 3);
  const buffer = await file.slice(0, readSize).arrayBuffer();
  let text = '';
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let end = buffer.byteLength;
    for (; end >= Math.max(0, buffer.byteLength - 3); end -= 1) {
      try { text = decoder.decode(buffer.slice(0, end)); break; } catch (_) {}
    }
    if (!text && buffer.byteLength) text = new TextDecoder().decode(buffer);
  } catch (_) {
    text = new TextDecoder().decode(buffer);
  }
  const bounded = truncateLocalUtf8Head(text, limit);
  return {
    text: bounded.text,
    size: originalSize,
    loadedBytes: bounded.bytes,
    truncated: originalSize > limit || bounded.truncated
  };
}

// 递归读取 showDirectoryPicker 返回的目录句柄
async function readDirHandle(handle, prefix) {
  const out = [];
  for await (const [name, entry] of handle.entries()) {
    if (SKIP_DIR.test(name)) continue;
    const rel = prefix ? prefix + '/' + name : name;
    if (entry.kind === 'file') {
      if (BINARY_EXT.test(name)) continue;
      let loaded = null;
      try { const file = await entry.getFile(); loaded = await readLocalTextHead(file); }
      catch (_) { continue; }
      if (loaded && loaded.text && loaded.text.trim()) out.push({ relPath: rel, name, ...loaded });
    } else if (entry.kind === 'directory') {
      const sub = await readDirHandle(entry, rel);
      out.push(...sub);
    }
  }
  return out;
}

// 兜底：用隐藏的 <input webkitdirectory> 多选文件
function pickViaInput() {
  return new Promise(resolve => {
    const inp = $('folderInput');
    if (!inp) return resolve([]);
    const handler = async () => {
      inp.removeEventListener('change', handler);
      const files = [];
      for (const f of inp.files) {
        const rel = f.webkitRelativePath || f.name;
        if (BINARY_EXT.test(rel)) continue;
        let loaded = null; try { loaded = await readLocalTextHead(f); } catch (_) { continue; }
        if (loaded && loaded.text && loaded.text.trim()) files.push({ relPath: rel, name: f.name, ...loaded });
      }
      resolve(files);
    };
    inp.value = '';
    inp.addEventListener('change', handler);
    inp.click();
  });
}

async function loadLocalFolder() {
  let files = [];
  if (window.showDirectoryPicker) {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      files = await readDirHandle(dirHandle, '');
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 用户取消
      files = await pickViaInput();
    }
  } else {
    files = await pickViaInput();
  }
  if (!files || !files.length) { toast('未选择文件或文件夹为空'); return; }
  ingestFiles(files);
}

// 把读到的文件分成「本地技能」与「素材」，并注册进现有技能体系
function ingestFiles(files) {
  const skillRoots = [];
  const skillDirs = [];
  const material = [];
  const importedSkills = [];
  for (const f of files) {
    if (!f.text || !f.text.trim()) continue;
    if (/(^|\/)SKILL\.md$/i.test(f.relPath)) {
      skillRoots.push(f);
      skillDirs.push(f.relPath.replace(/SKILL\.md$/i, '').replace(/\/$/, ''));
    } else if (TEXT_EXT.test(f.relPath)) {
      // 技能目录内的子文件（references/agents 等）已并入技能，不再当作素材重复注入
      const inSkill = skillDirs.some(d => d === '' ? !f.relPath.includes('/') : f.relPath.startsWith(d + '/'));
      if (!inSkill) material.push(f);
    }
  }
  // 本地技能：每个含 SKILL.md 的目录注册为一个技能
  for (const sf of skillRoots) {
    const dir = sf.relPath.replace(/SKILL\.md$/i, '').replace(/\/$/, '');
    const id = 'local-' + (dir || 'root').replace(/[^\w一-龥-]/g, '_');
    const fileMap = { 'SKILL.md': sf.text };
    const fileMeta = { 'SKILL.md': sf };
    for (const f of files) {
      if (f === sf) continue;
      const under = dir === '' ? !f.relPath.includes('/') : f.relPath.startsWith(dir + '/');
      if (under) {
        const rel = dir === '' ? f.relPath : f.relPath.slice(dir.length + 1);
        if (fileMap[rel] == null) { fileMap[rel] = f.text; fileMeta[rel] = f; }
      }
    }
    const sk = composeLocalSkill(id, sf.text, fileMap, fileMeta);
    skillsMap[id] = sk;
    importedSkills.push(sk);
    const ex = localSkills.findIndex(x => x.id === id);
    if (ex >= 0) localSkills[ex] = sk; else localSkills.push(sk);
    if (skillMenu) {
      const old = skillMenu.querySelector('button[data-skill-id="' + (window.CSS ? CSS.escape(id) : id) + '"]');
      if (old) old.remove();
      skillMenu.appendChild(makeSkillMenuItem(sk));
    }
  }
  // 素材：去重后汇入本地素材库
  const seen = new Set(localMaterial.map(m => m.relPath));
  for (const f of material) {
    if (seen.has(f.relPath)) continue;
    seen.add(f.relPath);
    localMaterial.push({ relPath: f.relPath, name: f.name, size: f.size, loadedBytes: f.loadedBytes, truncated: !!f.truncated, text: f.text, include: true });
  }
  if (!skillRoots.length && !material.length) { toast('该文件夹没有可载入的 SKILL.md 或文本文件'); return; }
  renderLocalPanel();
  updateLocalTag();
  updateSkillTag();
  toast('已载入 ' + localSkills.length + ' 个本地技能、' + localMaterial.length + ' 个素材文件');
  if (importedSkills.length) {
    const syncIdentity = accountStorageSuffix();
    skillSyncReady = skillSyncReady.then(() => syncLocalSkillsToCloud(importedSkills, syncIdentity));
  }
}

// 把素材库完整汇成可注入的上下文；模型或服务端达到自身上下文上限
// 时返回明确错误，不在前端静默丢弃用户资料。
function buildMaterialBlock() {
  const included = localMaterial.filter(m => m.include && m.text && m.text.trim());
  if (!included.length) return '';
  const parts = included.map(m => '### 文件：' + m.relPath + '\n\n' + String(m.text));
  let header = '以下是用户载入的本地素材库内容（作为写作参考与背景知识，请优先遵循其中的设定、人物与世界观）：';
  return truncateLocalUtf8Head(header + '\n\n' + parts.join('\n\n'), LOCAL_MATERIAL_PROMPT_LIMIT_BYTES, '\n\n[墨阑提示：本地素材合计超过单条消息限制，已按文件顺序保留前部内容。]').text;
}

function hasLocalContext() {
  return localMaterialEnabled && localMaterial.some(m => m.include && m.text && m.text.trim());
}

function updateLocalTag() {
  const tag = $('localTag');
  if (!tag) return;
  if (!localMaterial.length && !localSkills.length) { tag.classList.add('hidden'); return; }
  const bits = [];
  if (localSkills.length) bits.push('本地技能 ' + localSkills.length);
  const nMat = localMaterial.filter(m => m.include).length;
  if (nMat) bits.push('素材 ' + nMat + ' 文件');
  tag.textContent = '📁 ' + bits.join(' · ');
  tag.classList.remove('hidden');
}

function renderLocalPanel() {
  const body = $('localModalBody');
  if (!body) return;
  let html = '';
  if (localSkills.length) {
    html += '<div class="ml-text-sm ml-font-semibold ml-text-ink" style="margin:4px 0 8px;">本地技能（在「技能」下拉中勾选启用）</div>';
    localSkills.forEach(s => {
      const on = selectedSkillIds.includes(s.id);
      html += '<div class="novel-item"><div style="min-width:0;"><div class="ml-text-sm ml-text-ink truncate">' + escapeHtml(s.name || s.id) + '</div><div class="ml-text-xs ml-text-gray-2 truncate">' + escapeHtml((s.description || '').slice(0, 50)) + '</div></div><button class="ml-btn ml-btn-sm" data-local-skill="' + escapeHtml(s.id) + '">' + (on ? '已选 ✓' : '选择') + '</button></div>';
    });
  }
  if (localMaterial.length) {
    html += '<div class="flex items-center justify-between" style="margin:12px 0 8px;"><span class="ml-text-sm ml-font-semibold ml-text-ink">本地素材库（注入 system prompt）</span><label class="ml-text-xs ml-text-gray-2" style="display:inline-flex;gap:4px;align-items:center;cursor:pointer;"><input type="checkbox" id="localMatToggle" ' + (localMaterialEnabled ? 'checked' : '') + '> 启用注入</label></div>';
    localMaterial.forEach((m, i) => {
      html += '<div class="novel-item"><label style="display:flex;gap:8px;align-items:flex-start;min-width:0;cursor:pointer;"><input type="checkbox" data-local-mat="' + i + '" ' + (m.include ? 'checked' : '') + '><span style="min-width:0;"><span class="ml-text-sm ml-text-ink" style="display:block;word-break:break-all;">' + escapeHtml(m.relPath) + '</span><span class="ml-text-xs ml-text-gray-2">' + (m.size / 1024).toFixed(1) + ' KB' + (m.truncated ? ' · 已读取前部' : '') + '</span></span></label><button class="ml-btn ml-btn-sm" data-local-del="' + i + '">移除</button></div>';
    });
  }
  if (!localSkills.length && !localMaterial.length) {
    html = '<div class="ml-text-sm ml-text-gray" style="padding:12px 0;">尚未载入本地文件夹。点击「📁 载入本地」选择包含技能（含 SKILL.md）或素材（txt/md/json…）的目录。</div>';
  }
  body.innerHTML = html;
  body.querySelectorAll('[data-local-skill]').forEach(b => b.onclick = () => {
    const id = b.getAttribute('data-local-skill');
    const i = selectedSkillIds.indexOf(id);
    if (i >= 0) selectedSkillIds.splice(i, 1); else selectedSkillIds.push(id);
    syncSkillMenuChecked(); updateSkillLabel(); updateSkillTag(); renderLocalPanel();
  });
  body.querySelectorAll('[data-local-mat]').forEach(c => c.onchange = () => {
    localMaterial[+c.getAttribute('data-local-mat')].include = c.checked; updateLocalTag();
  });
  body.querySelectorAll('[data-local-del]').forEach(b => b.onclick = () => {
    localMaterial.splice(+b.getAttribute('data-local-del'), 1); renderLocalPanel(); updateLocalTag();
  });
  const tog = $('localMatToggle');
  if (tog) tog.onchange = () => { localMaterialEnabled = tog.checked; updateLocalTag(); };
}

// 暴露测试钩子（供自动化校验；不影响正常使用）
async function syncLocalSkillsToCloud(skills, expectedIdentity) {
  if (!Array.isArray(skills) || !skills.length) return;
  const requestIdentity = expectedIdentity || accountStorageSuffix();
  if (accountStorageSuffix() !== requestIdentity || !auth.token) return;
  let failed = 0;
  for (const skill of skills) {
    if (accountStorageSuffix() !== requestIdentity) return;
    try {
      const data = await api('/api/skills/import', {
        name: skill.name || skill.id,
        description: skill.description || '',
        instruction: skill.runtimeInstruction || skill.instruction || '',
        files: Array.isArray(skill.files) ? skill.files : [],
        runtimeFiles: skill.runtimeFiles || {},
        fileManifest: Array.isArray(skill.fileManifest) ? skill.fileManifest : [],
        slug: skill.id || skill.name || 'skill'
      }, 'POST');
      const cloudSkill = data && data.skill;
      if (!cloudSkill || !cloudSkill.id) throw new Error('invalid cloud Skill response');
      const selected = selectedSkillIds.includes(skill.id);
      delete skillsMap[skill.id];
      localSkills = localSkills.filter(item => item.id !== skill.id);
      skillsMap[cloudSkill.id] = { ...cloudSkill, source: 'user', local: false, global: false, autoApply: false };
      if (selected) {
        selectedSkillIds = selectedSkillIds.filter(id => id !== skill.id);
        if (!selectedSkillIds.includes(cloudSkill.id)) selectedSkillIds.push(cloudSkill.id);
      }
    } catch (_) {
      failed += 1;
    }
  }
  if (failed) throw new Error('Skill 云端同步失败，请在服务恢复后重新加载');
  skillsReady = loadSkills();
  await skillsReady;
  syncSkillMenuChecked();
  updateSkillLabel();
  updateSkillTag();
  toast('已将 Skill 完整保存到云端');
}

window.MolanLocal = {
  ingestFiles, buildSystem, buildMaterialBlock, composeLocalSkill,
  getState: () => ({ localSkills: localSkills.length, localMaterial: localMaterial.length, sysLen: buildSystem().length })
};

/* ---------- 服务健康检查与状态提示 ---------- */
const serviceBanner = $('serviceBanner');
const serviceBannerText = $('serviceBannerText');
const connDot = $('connDot');

function setConnStatus(ok) {
  if (!connDot) return;
  connDot.style.background = ok ? 'var(--ml-success)' : 'var(--ml-gray-3)';
  connDot.title = I18N[lang][ok ? 'conn_ok' : 'conn_fail'];
}

function showServiceBanner(msg) {
  if (!serviceBanner || !serviceBannerText) return;
  serviceBannerText.textContent = msg;
  serviceBanner.classList.remove('hidden');
}

function hideServiceBanner() {
  if (serviceBanner) serviceBanner.classList.add('hidden');
}

function updateServiceBanner() {
  if (!serviceBanner || serviceBanner.classList.contains('hidden')) return;
  serviceBannerText.textContent = isFileProtocol ? I18N[lang].file_protocol_err : I18N[lang].service_hint;
}

async function checkHealth() {
  if (isFileProtocol) {
    setConnStatus(false);
    showServiceBanner(I18N[lang].file_protocol_err);
    return false;
  }
  try {
    const res = await fetch(API_BASE + '/api/health', { method: 'GET', cache: 'no-store' });
    if (res.ok) { setConnStatus(true); hideServiceBanner(); return true; }
    throw new Error('HTTP ' + res.status);
  } catch (e) {
    setConnStatus(false);
    showServiceBanner(I18N[lang].service_hint);
    return false;
  }
}

/* ---------- 聊天：流式调用 DeepSeek ---------- */
const SYSTEM_PROMPT = '你是一位专业的中文网络小说写作助手，擅长构思情节、生成正文与设定。回答简洁、有画面感、贴合网文节奏。';
let activeController = null;

async function safeErrorText(res) {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return json.error || json.message || ('HTTP ' + res.status);
  } catch (_) {
    return text || ('HTTP ' + res.status);
  }
}

async function streamChat(payload, handlers) {
  const stopBtn = $('stopBtn');
  if (stopBtn) stopBtn.hidden = false;
  const controller = new AbortController();
  activeController = controller;
  if (handlers.onController) handlers.onController(controller);
  let usage = null;
  let finishReason = null;
  try {
    await skillsReady;
    await skillSyncReady;
    const body = { ...payload, max_tokens: payload.max_tokens || 8192 };
    const requestedSkillMode = ['write', 'humanize', 'extract', 'analyze'].includes(String(body.skillMode || ''))
      ? String(body.skillMode)
      : '';
    const skillMode = requestedSkillMode || skillModeForMessages(body.messages);
    body.stage = body.stage || (skillMode === 'humanize' ? 'humanizer' : skillMode === 'write' ? 'writing' : 'single');
    if (body.correction === false) body.correctionPolicy = false;
    delete body.correction;
    delete body.skillMode;
    delete body.humanize;
    const activeSkillIds = activeSkillsForMode(skillMode).map(skill => skill.id);
    const missingSkills = activeSkillIds.filter(id => !skillsMap[id] || skillsMap[id].complete === false || !promptInstructionForSkill(skillsMap[id]));
    if (activeSkillIds.length && (skillsLoadError || missingSkills.length)) {
      throw new Error('Skill is not fully loaded; reload the Skill before generating');
    }
    body.messages = injectSelectedSkillBlocks(body.messages, skillMode);
    body.skillAudit = buildSkillAuditPayload(skillMode);
    const chatHeaders = { 'Content-Type': 'application/json' };
    try {
      const chatToken = localStorage.getItem('ml_token');
      if (chatToken) chatHeaders.Authorization = 'Bearer ' + chatToken;
    } catch (_) {}
    const res = await fetch(API_BASE + '/api/chat', {
      method: 'POST', headers: chatHeaders,
      body: JSON.stringify(body), signal: controller.signal
    });
    if (!res.ok) {
      let em = await safeErrorText(res);
      if (res.status === 401) em = '请先登录后再使用 AI 功能';
      else if (res.status === 402) em = em || '积分不足，请前往价格页充值或升级套餐';
      throw new Error(em);
    }
    setConnStatus(true);
    hideServiceBanner();
    const usedModel = res.headers.get('X-Molan-Model');
    if (usedModel && handlers.onModel) handlers.onModel(usedModel);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
      let buf = '';
      const setFinishReason = value => {
        const reason = String(value || '');
        if (!reason || reason === 'stop') return;
        if (reason === 'credit_exhausted' || finishReason !== 'credit_exhausted') finishReason = reason;
      };
      const handleLine = rawLine => {
        const line = String(rawLine || '').trim();
        if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          if (json && json.molan_usage) {
            usage = json.molan_usage;
            setFinishReason(usage.finishReason);
            if (usage.status === 'credit_exhausted') setFinishReason('credit_exhausted');
            else if (usage.status === 'truncated') setFinishReason('length');
          }
          if (json && json.molan_billing) {
          if (json.molan_billing.status === 'credit_exhausted') setFinishReason('credit_exhausted');
          if (handlers.onBilling) handlers.onBilling(json.molan_billing);
          }
          const choice = json && json.choices && json.choices[0];
          setFinishReason(choice && choice.finish_reason);
          const delta = choice && choice.delta && choice.delta.content || '';
          const think = choice && choice.delta && (choice.delta.reasoning_content || choice.delta.reasoning || choice.delta.thinking) || '';
        if (think && handlers.onThink) handlers.onThink(think);
        if (delta && handlers.onDelta) handlers.onDelta(delta);
      } catch (_) {}
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        handleLine(line);
      }
    }
    buf += decoder.decode();
    if (buf.trim()) handleLine(buf);
    handlers.onDone && handlers.onDone(finishReason, usage);
  } catch (e) {
    if (e.name === 'AbortError') { handlers.onDone && handlers.onDone('abort', usage); }
    else {
      setConnStatus(false);
      const msg = isFileProtocol ? I18N[lang].file_protocol_err : (e.message.includes('fetch') || e.message.includes('Failed')) ? I18N[lang].network_err : e.message;
      handlers.onError && handlers.onError(msg, { code: 'network' });
    }
  } finally {
    activeController = null;
    if (stopBtn) stopBtn.hidden = true;
  }

function mergePipelineUsage(stages, finalReason) {
  const list = (stages || []).filter(Boolean);
  const sumExact = key => {
    if (!list.length || list.some(item => item[key] == null || !Number.isFinite(Number(item[key])))) return null;
    return list.reduce((total, item) => total + Number(item[key]), 0);
  };
  const last = list[list.length - 1] || {};
  const merged = { ...last };
  ['promptTokens', 'completionTokens', 'reasoningTokens', 'cachedTokens', 'cacheWriteTokens', 'totalTokens'].forEach(key => {
    merged[key] = sumExact(key);
  });
  if (list.some(item => item.creditCost != null && Number.isFinite(Number(item.creditCost)))) {
    merged.creditCost = Math.round(list.reduce((total, item) => total + (Number(item.creditCost) || 0), 0) * 100) / 100;
  }
  if (list.some(item => item.reservedCost != null && Number.isFinite(Number(item.reservedCost)))) {
    merged.reservedCost = Math.round(list.reduce((total, item) => total + (Number(item.reservedCost) || 0), 0) * 100) / 100;
  }
  merged.status = finalReason === 'credit_exhausted' ? 'credit_exhausted' : finalReason === 'abort' ? 'aborted' : finalReason === 'length' ? 'truncated' : (finalReason ? finalReason : 'completed');
  merged.usageSource = merged.totalTokens == null ? 'unavailable' : 'upstream';
  merged.requestIds = list.map(item => item.requestId).filter(Boolean);
  merged.skillStages = list.map(item => ({ stage: item.skillAudit && item.skillAudit.stage || 'single', usage: item }));
  return merged;
}

// Writing can run an explicit Skill planning pass before the正文 pass. Keep
// this switch explicit so non-writing tools do not unexpectedly pay for a
// second model request.
async function streamSkillPipeline(payload, handlers, options) {
  const opts = options || {};
  const mode = opts.mode || payload.skillMode || skillModeForMessages(payload.messages);
  const shouldAnalyzeSkill = opts.analyzeSkill === true && mode === 'write' && activeSkillsForMode('write').length > 0;
  const shouldHumanize = (opts.humanize === true || payload.humanize === true) && mode === 'write' && activeSkillsForMode('humanize').length > 0;
  // All正文 output gets the universal correction pass, including requests
  // without an additionally selected writing Skill.
  const shouldCorrection = mode === 'write' && opts.correction !== false && payload.correction !== false;
  if (!shouldAnalyzeSkill && !shouldHumanize && !shouldCorrection) {
    return streamChat({ ...payload, skillMode: mode, stage: opts.stage || (mode === 'write' ? 'writing' : 'single') }, handlers);
  }
  const stages = [];
  let skillAnalysis = '';
  let analysisResult = null;
  if (shouldAnalyzeSkill) {
    const analysisMessages = (Array.isArray(payload.messages) ? payload.messages : []).map(message => ({ ...message }));
    const analysisInstruction = '\n\n\u3010\u58a8\u9611 Skill \u524d\u7f6e\u5206\u6790\u9636\u6bb5\u3011\n' +
      '\u4f60\u73b0\u5728\u53ea\u8d1f\u8d23\u5206\u6790\u672c\u6b21\u8bf7\u6c42\u5c06\u6267\u884c\u7684\u5168\u90e8 Skill\u3002\u8bf7\u5148\u8bfb\u53d6\u6240\u6709\u5df2\u6ce8\u5165\u7684 Skill \u6587\u4ef6\u4e0e\u5f53\u524d\u4f5c\u54c1\u8bbe\u5b9a\uff0c\u7136\u540e\u8f93\u51fa\u7ed9\u540e\u7eed\u6b63\u6587\u751f\u6210\u4f7f\u7528\u7684\u6267\u884c\u6e05\u5355\u3002\n' +
      '1. \u5fc5\u987b\u9075\u5b88\u7684 Skill \u89c4\u5219\uff1a\u6587\u98ce\u3001\u53d9\u4e8b\u3001\u4eba\u7269\u4e0e\u4e16\u754c\u89c2\u7ea6\u675f\u3002\n' +
      '2. \u672c\u6b21\u8bf7\u6c42\u5fc5\u987b\u4fdd\u6301\u7684\u4f5c\u54c1\u8bbe\u5b9a\u4e0e\u4e8b\u5b9e\u3002\n' +
      '3. \u672c\u6b21\u6b63\u6587\u7684\u521b\u4f5c\u91cd\u70b9\u4e0e\u5fc5\u987b\u56de\u6536\u7684\u8fde\u7eed\u6027\u3002\n' +
      '4. \u7981\u6b62\u4e8b\u9879\uff1a\u4e0d\u80fd\u51b2\u7a81\u7684\u89c4\u5219\u3001\u4e0d\u80fd\u65e0\u6839\u636e\u65b0\u589e\u7684\u8bbe\u5b9a\u3002\n' +
      '\u8fd9\u4e00\u9636\u6bb5\u4e0d\u8981\u5199\u5c0f\u8bf4\u6b63\u6587\uff0c\u53ea\u8f93\u51fa\u53ef\u6267\u884c\u7684 Skill \u5206\u6790\u3002';
    const analysisSystem = analysisMessages.find(message => message && message.role === 'system');
    if (analysisSystem) analysisSystem.content = String(analysisSystem.content || '') + analysisInstruction;
    else analysisMessages.unshift({ role: 'system', content: analysisInstruction.trim() });
    await new Promise(resolve => {
      handlers.onStage && handlers.onStage('skill_analysis');
      streamChat({ ...payload, skillMode: 'write', stage: 'skill_analysis', messages: analysisMessages }, {
        onController: controller => handlers.onController && handlers.onController(controller),
        onModel: model => handlers.onModel && handlers.onModel(model),
        onThink: text => {
          const onThink = handlers.onModelThink || handlers.onThink;
          if (onThink) onThink(text);
        },
        onBilling: billing => handlers.onBilling && handlers.onBilling({ ...billing, pipelineStage: 'skill_analysis' }),
        onDelta: text => { skillAnalysis += text; handlers.onSkillAnalysisDelta && handlers.onSkillAnalysisDelta(text); },
        onDone: (reason, usage) => { analysisResult = { reason: reason || null, usage: usage || null }; resolve(); },
        onError: (error, meta) => { analysisResult = { reason: meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', error, meta }; resolve(); }
      });
    });
    if (analysisResult && analysisResult.usage) stages.push(analysisResult.usage);
    const analysisReason = analysisResult && analysisResult.reason;
    const analysisFailed = !analysisResult || analysisResult.error || ['abort', 'credit_exhausted', 'length'].includes(analysisReason) || !skillAnalysis.trim();
    if (analysisFailed) {
      const aggregate = mergePipelineUsage(stages, analysisReason || 'error');
      if (analysisResult && analysisResult.error) handlers.onError && handlers.onError(analysisResult.error, { ...(analysisResult.meta || {}), code: analysisResult.meta && analysisResult.meta.code || 'skill_analysis_failed', skillAnalysis });
      else if (['abort', 'credit_exhausted'].includes(analysisReason)) handlers.onDone && handlers.onDone(analysisReason, aggregate);
      else handlers.onError && handlers.onError('Skill \u5206\u6790\u672a\u8fd4\u56de\u6709\u6548\u5185\u5bb9\uff0c\u5df2\u505c\u6b62\u6b63\u6587\u751f\u6210', { code: 'skill_analysis_failed', skillAnalysis });
      return aggregate;
    }
  }
  const appendAnalysisContext = messages => {
    if (!skillAnalysis.trim()) return messages;
    const output = (Array.isArray(messages) ? messages : []).map(message => ({ ...message }));
    const userIndex = [...output].map(message => message && message.role).lastIndexOf('user');
    const context = '\n\n\u3010\u58a8\u9611 Skill \u6267\u884c\u5206\u6790\uff08\u672c\u6b21\u8bf7\u6c42\uff09\u3011\n' + skillAnalysis.trim() + '\n\u3010Skill \u6267\u884c\u5206\u6790\u7ed3\u675f\u3011';
    if (userIndex >= 0) output[userIndex].content = String(output[userIndex].content || '') + context;
    else output.push({ role: 'user', content: context.trim() });
    return output;
  };
  let draft = '';
  let firstResult = null;
  await new Promise(resolve => {
    streamChat({ ...payload, skillMode: 'write', stage: 'writing', messages: appendAnalysisContext(payload.messages) }, {
      onController: controller => { handlers.onController && handlers.onController(controller); handlers.onStage && handlers.onStage('writing'); },
      onModel: model => handlers.onModel && handlers.onModel(model),
      onThink: text => handlers.onThink && handlers.onThink(text),
      onBilling: billing => handlers.onBilling && handlers.onBilling({ ...billing, pipelineStage: 'writing' }),
      onDelta: text => { draft += text; handlers.onDraftDelta && handlers.onDraftDelta(text); },
      onDone: (reason, usage) => { firstResult = { reason: reason || null, usage: usage || null }; resolve(); },
      onError: (error, meta) => { firstResult = { reason: meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', error, meta }; resolve(); }
    });
  });
  if (firstResult && firstResult.usage) stages.push(firstResult.usage);
  const firstReason = firstResult && firstResult.reason;
  if (!firstResult || firstResult.error || firstReason === 'abort' || firstReason === 'credit_exhausted' || firstReason === 'length' || !draft.trim()) {
    if (draft && handlers.onReplaceText) handlers.onReplaceText(draft);
    else if (draft && handlers.onDelta) handlers.onDelta(draft);
    const aggregate = mergePipelineUsage(stages, firstReason || 'error');
    if (firstResult && firstResult.error) handlers.onError && handlers.onError(firstResult.error, { ...(firstResult.meta || {}), partialText: draft });
    else handlers.onDone && handlers.onDone(firstReason || 'error', aggregate);
    return aggregate;
  }
  const humanizerSystem = opts.humanizerSystem || buildSystem('humanize') + '\n\n请只对用户提供的写作初稿执行二次润色与去 AI 味，不要解释或总结。';
  let finalText = '';
  let finalResult = null;
  await new Promise(resolve => {
    streamChat({
      model: payload.model,
      thinking: payload.thinking,
      max_tokens: payload.max_tokens || 8192,
      correction: true,
      skillMode: 'humanize',
      stage: 'humanizer',
      characterMaterial: payload.characterMaterial,
      messages: [{ role: 'system', content: humanizerSystem }, { role: 'user', content: '请对以下写作初稿执行二次润色与去 AI 味。不得删减事实，不得新增未给出的设定，不要标题、解释或总结。\n\n【写作初稿】\n' + draft }]
    }, {
      onController: controller => { handlers.onController && handlers.onController(controller); handlers.onStage && handlers.onStage('humanizer'); },
      onModel: model => handlers.onModel && handlers.onModel(model),
      onThink: text => handlers.onThink && handlers.onThink(text),
      onBilling: billing => handlers.onBilling && handlers.onBilling({ ...billing, pipelineStage: 'humanizer' }),
      onDelta: text => { finalText += text; handlers.onDelta && handlers.onDelta(text); },
      onDone: (reason, usage) => { finalResult = { reason: reason || null, usage: usage || null }; resolve(); },
      onError: (error, meta) => { finalResult = { reason: meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', error, meta }; resolve(); }
    });
  });
  if (finalResult && finalResult.usage) stages.push(finalResult.usage);
  const finalReason = finalResult && finalResult.reason;
  const aggregate = mergePipelineUsage(stages, finalReason || 'error');
  if (finalResult && finalResult.error) {
    if (draft && handlers.onReplaceText) handlers.onReplaceText(draft);
    else if (!finalText && draft && handlers.onDelta) handlers.onDelta(draft);
    if (finalResult.meta && finalResult.meta.code === 'credit_exhausted') handlers.onDone && handlers.onDone('credit_exhausted', aggregate);
    else handlers.onError && handlers.onError(finalResult.error, { ...(finalResult.meta || {}), partialText: draft || finalText });
  } else {
    if (!finalText && draft && handlers.onDelta) handlers.onDelta(draft);
    handlers.onDone && handlers.onDone(finalReason, aggregate);
  }
  return aggregate;
}
}

const stopBtn = $('stopBtn');
if (stopBtn) stopBtn.onclick = () => { if (activeController) activeController.abort(); };

const COPY_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

function addMsg(role, text) {
  const messages = $('messages');
  const wrap = $('messagesWrap');
  if (!messages || !wrap) return null;
  wrap.classList.remove('hidden');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  div.appendChild(bubble);
  // 单条复制按钮（悬停显示）
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'copy-btn';
  copyBtn.title = I18N[lang].copy_output;
  copyBtn.setAttribute('aria-label', I18N[lang].copy_output);
  copyBtn.innerHTML = COPY_ICON;
  copyBtn.onclick = async () => {
    const ok = await copyText(bubble.textContent);
    toast(ok ? I18N[lang].copied : I18N[lang].copy_fail);
  };
  div.appendChild(copyBtn);
  messages.appendChild(div);
  scrollToBottom();
  return bubble;
}

function scrollToBottom() {
  const messages = $('messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
}

function clearChat() {
  const messages = $('messages');
  const wrap = $('messagesWrap');
  if (messages) messages.innerHTML = '';
  if (wrap) wrap.classList.add('hidden');
}

function updateSkillTag() {
  const tag = $('skillTag');
  if (!tag) return;
  const selected = effectiveSkillIds().map(id => skillsMap[id]).filter(Boolean);
  if (selected.length) {
    const names = selected.map(s => s.name || s.id);
    const joined = names.length <= 2 ? names.join(' · ') : (names.slice(0, 2).join(' · ') + ` 等 ${names.length} 项`);
    tag.textContent = I18N[lang].skill_active.replace('{name}', joined);
    // 悬停提示：列出每个技能实际加载到的文件，证明是按技能"读取顺序"完整调用
    const tip = selected.map(s => {
      const fs2 = (s.files || []).map(f => f.replace(/\\/g, '/'));
      return `• ${s.name || s.id}\n  加载 ${fs2.length} 个文件：${fs2.join('、') || '（SKILL.md 自包含）'}`;
    }).join('\n');
    tag.title = tip;
    tag.classList.remove('hidden');
  } else {
    tag.classList.add('hidden');
  }
}

async function sendChat() {
  const input = $('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { toast(I18N[lang].empty_input); return; }

  // 如果服务未就绪，先尝试一次健康检查
  const ready = await checkHealth();
  if (!ready && isFileProtocol) { toast(I18N[lang].file_protocol_err); return; }

  input.value = ''; autoGrow();
  updateSkillTag();
  addMsg('user', text);
  const bubble = addMsg('assistant', I18N[lang].thinking);
  if (!bubble) return;
  bubble.classList.add('thinking');

  // 模型决策：手动选择优先；「自动切换」按任务复杂度选 Flash / Pro
  // 思考模式与模型正交：V4 Flash / Pro 均支持 thinking 参数，开启后自动携带推理链
  const chosen = pickModel(text);
  const msgEl = bubble.closest('.msg');

  // 消息底部标注实际使用的模型（自动模式下注明"自动选择"）
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  if (msgEl) msgEl.appendChild(meta);
  const setMeta = (name, extra) => {
    const autoTag = modelChoice === 'auto' ? ` · ${I18N[lang].auto_pick}` : '';
    const thinkTag = thinkMode ? ' · 🧠' : '';
    meta.textContent = name + autoTag + thinkTag + (extra || '');
  };
  setMeta(modelDisplayName(chosen));

  // Skill 前置分析单独展示；模型原始 reasoning 默认折叠
  let skillAnalysisBody = null;
  const ensureSkillAnalysisPanel = () => {
    if (skillAnalysisBody || !msgEl) return;
    const det = document.createElement('details');
    det.className = 'skill-analysis';
    det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = 'Skill 分析';
    skillAnalysisBody = document.createElement('div');
    skillAnalysisBody.className = 'skill-analysis-body';
    det.appendChild(sum); det.appendChild(skillAnalysisBody);
    msgEl.insertBefore(det, bubble);
  };
  let thinkBody = null;
  const ensureThinkPanel = () => {
    if (thinkBody || !msgEl) return;
    const det = document.createElement('details');
    det.className = 'think';
    det.open = false;
    const sum = document.createElement('summary');
    sum.textContent = '模型推理';
    thinkBody = document.createElement('div');
    thinkBody.className = 'think-body';
    det.appendChild(sum); det.appendChild(thinkBody);
    msgEl.insertBefore(det, bubble);
  };

  let started = false;
  const full = { text: '', analysis: '', think: '' };
  const run = (modelId, isRetry) => streamSkillPipeline({
    model: modelId,
    thinking: thinkMode,
    skillMode: 'write',
    analyzeSkill: true,
    humanize: false,
    max_tokens: 8192,
    messages: [{ role: 'system', content: buildSystem() }, { role: 'user', content: text }]
  }, {
    onModel: m => {
      const name = /pro/i.test(m || '') ? I18N[lang].model_pro : /flash/i.test(m || '') ? I18N[lang].model_flash : m;
      setMeta(name, isRetry ? I18N[lang].fallback_note : '');
    },
    onStage: stage => {
      if (stage === 'skill_analysis') setMeta(modelDisplayName(modelId), ' · 正在分析 Skill');
      else if (stage === 'writing') setMeta(modelDisplayName(modelId), ' · 正在生成正文');
      else if (stage === 'humanizer') setMeta(modelDisplayName(modelId), ' · 正在执行 humanizer 后处理');
    },
    onSkillAnalysisDelta: t => {
      ensureSkillAnalysisPanel();
      full.analysis += t;
      skillAnalysisBody.textContent = full.analysis;
      scrollToBottom();
    },
    onThink: t => {
      ensureThinkPanel();
      full.think += t; thinkBody.textContent = full.think; scrollToBottom();
    },
    onDelta: d => {
      if (!started) { bubble.classList.remove('thinking'); bubble.textContent = ''; started = true; }
      full.text += d; bubble.textContent = full.text; scrollToBottom();
    },
    onReplaceText: text => {
      full.text = String(text || '');
      started = true;
      bubble.classList.remove('thinking');
      bubble.textContent = full.text;
      setMeta(modelDisplayName(modelId), ' · humanizer 后处理失败，已保留写作初稿');
      scrollToBottom();
    },
    onDone: reason => {
      bubble.classList.remove('thinking');
      if (reason === 'length') { full.text += '\n\n' + I18N[lang].length_limit; bubble.textContent = full.text; scrollToBottom(); }
      // 正文生成完毕后自动收起思考过程
      const det = msgEl && msgEl.querySelector('details.think');
      if (det && full.text) det.open = false;
      const analysis = msgEl && msgEl.querySelector('details.skill-analysis');
      if (analysis && full.text) analysis.open = false;
    },
    onError: (e, meta) => {
      if (meta && meta.partialText) {
        full.text = String(meta.partialText);
        started = true;
        bubble.classList.remove('thinking');
        bubble.textContent = full.text;
        setMeta(modelDisplayName(modelId), ' · humanizer 后处理失败，已保留写作初稿');
        scrollToBottom();
        return;
      }
      // 自动切换的另一层保障：Pro 侧调用失败且尚未输出时，自动降级 Flash 重试一次
      if (!isRetry && !started && /pro|reason/i.test(String(modelId || '')) && modelChoice === 'auto') {
        const fallback = HOME_MODELS.find(m => /flash|mini/i.test(String(m.id) + ' ' + String(m.model || '')));
        run(fallback ? fallback.id : HOME_DEFAULT_MODEL, true);
        return;
      }
      bubble.classList.remove('thinking'); bubble.textContent = '⚠️ ' + e; scrollToBottom();
    }
  }, { humanize: /续写|创作|正文|润色|改写|扩写|仿写/.test(text) });
  run(chosen, false);
}

/* 主页对话框：输入创作意图后跳转到编辑器继续创作 */
function redirectToEditor(prompt) {
  const text = (prompt || '').trim();
  if (!text) { toast(I18N[lang].empty_input); return; }
  try {
    const model = modelChoice === 'auto' ? pickModel(text) : modelChoice;
    localStorage.setItem(accountStorageKey('molan_editor_handoff'), JSON.stringify({
      model: model,
      think: thinkMode,
      persona: currentPersona || '',
      skills: selectedSkillIds.filter(id => id.indexOf('local-') !== 0)
    }));
  } catch (_) {}
  location.href = './index.html?prompt=' + encodeURIComponent(text) + '#editor';
}
const sendBtn = $('sendBtn');
if (sendBtn) sendBtn.onclick = () => redirectToEditor($('chatInput').value);
const chatInput = $('chatInput');
if (chatInput) {
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); redirectToEditor(chatInput.value); }
  });
}
const clearBtn = $('clearBtn');
if (clearBtn) clearBtn.onclick = clearChat;

/* 复制全部输出（仅助手消息拼接） */
const copyAllBtn = $('copyAllBtn');
if (copyAllBtn) copyAllBtn.onclick = async () => {
  const messages = $('messages');
  if (!messages || !messages.children.length) { toast(I18N[lang].empty_input); return; }
  const out = Array.from(messages.children)
    .filter(m => m.classList.contains('assistant'))
    .map(m => m.querySelector('.bubble')?.textContent || '')
    .join('\n\n');
  if (!out.trim()) { toast(I18N[lang].no_output); return; }
  const ok = await copyText(out);
  toast(ok ? I18N[lang].copied : I18N[lang].copy_fail);
};

/* 文本框自适应高度 + 火花按钮插示例 */
function autoGrow() {
  const el = $('chatInput');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}
if (chatInput) chatInput.addEventListener('input', autoGrow);
const sparkBtn = $('sparkBtn');
if (sparkBtn) {
  sparkBtn.onclick = () => {
    if (!chatInput) return;
    chatInput.value = lang === 'zh'
      ? '以「朱颜辞镜花辞树」为意象，写一段古风离别开场。'
      : 'Write a classical Chinese parting scene using the image of a face leaving the mirror and flowers falling from the tree.';
    autoGrow(); chatInput.focus();
  };
}

/* ---------- 我的小说（与完整编辑器共用 molan_editor_novels 书架，数据互通） ---------- */
const NS_KEY = 'molan_editor_novels';
function currentAccountStorageSuffix() {
  try {
    const user = JSON.parse(localStorage.getItem('ml_user') || 'null');
    return user && user.email ? encodeURIComponent(String(user.email).trim().toLowerCase()) : 'guest';
  } catch (_) { return 'guest'; }
}
function accountStorageKey(base) { return base + ':' + currentAccountStorageSuffix(); }
function loadNovelMap() {
  try { return JSON.parse(localStorage.getItem(accountStorageKey(NS_KEY))) || {}; } catch (_) { return {}; }
}
function saveNovelMap(m) { try { localStorage.setItem(accountStorageKey(NS_KEY), JSON.stringify(m)); } catch (_) {} }
function novelWords(st) {
  let w = 0;
  (st.volumes || []).forEach(v => (v.chapters || []).forEach(ch => (ch.scenes || []).forEach(sc => {
    w += (sc.content || '').replace(/<[^>]+>/g, '').replace(/\s/g, '').length;
  })));
  return w;
}
function novelUpdated(st) {
  const t = (st && st.updatedAt) || (st && st.history && st.history[0] && st.history[0].t) || 0;
  return t ? new Date(t).toLocaleDateString() : '';
}
function renderNovelList() {
  const list = $('novelList');
  if (!list) return;
  list.innerHTML = '';
  const map = loadNovelMap();
  const ids = Object.keys(map);
  if (!ids.length) {
    list.innerHTML = `<p class="ml-text-sm ml-text-gray-2" style="text-align:center;padding:24px 0;">${lang === 'zh' ? '还没有作品，点击「新建小说」开始吧。' : 'No novels yet. Create one to begin.'}</p>`;
    return;
  }
  ids.sort((a, b) => (map[b].updatedAt || 0) - (map[a].updatedAt || 0));
  ids.forEach(id => {
    const st = map[id] || {};
    const title = st.title || (lang === 'zh' ? '未命名小说' : 'Untitled');
    const words = novelWords(st);
    const date = novelUpdated(st);
    const item = document.createElement('div');
    item.className = 'novel-item';
    item.innerHTML = `<div style="min-width:0;">
        <div class="ml-text-base ml-font-semibold ml-text-ink truncate">${escapeHtml(title)}</div>
        <div class="ml-text-xs ml-text-gray-2">${words} 字 · ${date || (lang === 'zh' ? '刚刚' : 'just now')}</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="ml-btn ml-btn-sm" data-act="open">${lang === 'zh' ? '打开' : 'Open'}</button>
        <button class="ml-btn ml-btn-sm" data-act="del">${lang === 'zh' ? '删除' : 'Delete'}</button>
      </div>`;
    item.querySelector('[data-act="open"]').onclick = () => { closeModal('novelModal'); location.href = './index.html?nid=' + encodeURIComponent(id) + '#editor'; };
    item.querySelector('[data-act="del"]').onclick = () => {
      if (confirm(lang === 'zh' ? '确定删除该小说？' : 'Delete this novel?')) {
        const m = loadNovelMap(); delete m[id]; saveNovelMap(m); renderNovelList();
      }
    };
    list.appendChild(item);
  });
}
function openNovels() { renderNovelList(); openModal('novelModal'); }

/* 导入 txt/md → 构建为完整编辑器兼容的小说结构（而非孤立的纯文本） */
function buildImportedState(title, text) {
  const c1 = 'c1', s1 = 'c1s1', v1 = 'v1';
  const paras = String(text || '').split(/\n{2,}|\r\n{2,}/).map(p => p.trim()).filter(Boolean);
  const content = paras.length
    ? paras.map(p => '<p>' + escapeHtml(p) + '</p>').join('')
    : '<p>' + escapeHtml(String(text || '')) + '</p>';
  return {
    title: title || (lang === 'zh' ? '未命名小说' : 'Untitled'),
    volumes: [{ id: v1, title: (lang === 'zh' ? '第一卷' : 'Vol.1'), chapters: [{ id: c1, title: (lang === 'zh' ? '第1章' : 'Ch.1'), sub: '', scenes: [{ id: s1, name: (lang === 'zh' ? '场景一' : 'Scene 1'), content: content }] }] }],
    currentChapterId: c1, currentSceneId: s1,
    outline: { book: { title: title || (lang === 'zh' ? '未命名小说' : 'Untitled'), oneLine: '', themes: [] }, volume: { title: (lang === 'zh' ? '第一卷' : 'Vol.1'), synopsis: '', target: '', done: 0, total: 0 }, chapters: [{ num: (lang === 'zh' ? '第1章' : 'Ch.1'), status: 'todo', title: (lang === 'zh' ? '第1章' : 'Ch.1'), synopsis: '', wordCount: 0, mark: '', storyline: '主线' }] },
    sceneProps: { summary: '', elements: { characters: [], locations: [], items: [], plot: [] } },
    history: [], aiMessages: [], recycleBin: [], aiCallLog: [], chatSessions: [],
    knowledge: { entities: {}, edges: [], version: 1 }, inspirations: [], aiRole: 'generation', aiStyle: '',
    modelSources: [], settings: { fontSize: 16, lineHeight: 1.8, theme: 'light', fontFamily: 'system', autosave: true, exportFormat: 'txt', think: false, reasoningEffort: '', models: { default: 'v4-flash', continuation: 'v4-flash', polish: 'v4-flash' } },
    updatedAt: Date.now()
  };
}

const newNovelBtn = $('newNovelBtn');
if (newNovelBtn) newNovelBtn.onclick = () => { location.href = './index.html?action=new#editor'; };

const importBtn = $('importBtn');
const importFile = $('importFile');
if (importBtn && importFile) {
  importFile.multiple = true;
  importFile.accept = '.txt,.md,.markdown,.text,text/plain,text/markdown';
  importBtn.onclick = () => importFile.click();
  importFile.onchange = e => {
    const files = Array.from(e.target.files || []).filter(file => /\.(txt|md|markdown|text)$/i.test(file.name || ''));
    if (!files.length) return;
    const m = loadNovelMap();
    let completed = 0;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const id = 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const title = file.name.replace(/\.(txt|md|markdown|text)$/i, '');
        m[id] = buildImportedState(title, String(reader.result || ''));
        completed += 1;
        if (completed === files.length) {
          saveNovelMap(m); renderNovelList();
          toast(lang === 'zh' ? `成功导入 ${files.length} 个文件` : `Imported ${files.length} files`);
        }
      };
      reader.readAsText(file, 'utf-8');
    });
    e.target.value = '';
  };
}

/* ---------- 弹窗通用 ---------- */
function openModal(id) { const el = $(id); if (el) el.hidden = false; }
function closeModal(id) { const el = $(id); if (el) el.hidden = true; }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => {
  const modal = b.closest('.ml-modal'); if (modal) modal.hidden = true;
});
document.querySelectorAll('.ml-modal').forEach(m => m.addEventListener('click', e => {
  if (e.target !== m) return;
  if (m.id === 'quickCreateModal') closeQuickCreate();
  else m.hidden = true;
}));

/* ---------- 快速创建小说 ---------- */
const QUICK_GENRES = ['玄幻', '仙侠', '都市', '末世', '古言', '科幻', '悬疑', '灵异', '武侠', '历史'];
const QUICK_STYLES = ['爽点强燃', '黄金法则', '起点正剧', '知乎盐选'];
let quickCreateActiveController = null;
let quickCreateTitleResult = '';
let quickCreateBlurbResult = '';

function quickReadableModel(modelId) {
  const model = homeModelById(modelId);
  if (model && model.name) return model.name;
  if (/pro|reason/i.test(String(modelId))) return 'V4-Pro';
  if (/flash|mini/i.test(String(modelId))) return 'V4-Flash';
  return modelId || HOME_DEFAULT_MODEL_LABEL || '平台默认模型';
}

function quickCreateModelFor(text) {
  return pickModel(String(text || ''));
}

function quickSetStatus(kind, message, state) {
  const el = $('quick' + kind + 'Status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('is-error', state === 'error');
  el.classList.toggle('is-ok', state === 'ok');
}

function updateQuickModelBadge(prompt) {
  const el = $('quickModelName');
  if (!el) return;
  const model = quickCreateModelFor(prompt || '');
  el.textContent = quickReadableModel(model);
  el.title = '实际请求会沿用当前账户的模型权限与选择';
}

function quickContext() {
  const title = (($('quickTitle') && $('quickTitle').value) || '').trim();
  const genre = (($('quickGenre') && $('quickGenre').value) || '').trim();
  const description = (($('quickDescription') && $('quickDescription').value) || '').trim();
  return { title, genre, description };
}

function quickCleanCandidate(value) {
  return String(value || '')
    .replace(/^\s*(?:候选(?:书名|简介)?\s*)?(?:\d+|[一二三四五六七八九十]+)[、.)．:]?\s*/i, '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^\s*["“](.*)["”]\s*$/, '$1')
    .trim();
}

function quickParseTitles(raw) {
  return [...new Set(String(raw || '').split(/\r?\n+/).map(quickCleanCandidate)
    .filter(v => v && !/^(书名候选|候选结果|以下是|好的[，,。]?)/.test(v)))]
    .slice(0, 8);
}

function quickParseBlurbs(raw) {
  const text = String(raw || '').replace(/\r/g, '').trim();
  let chunks = text.split(/\n\s*\n+/).map(quickCleanCandidate).filter(Boolean);
  if (chunks.length < 2) chunks = text.split(/\n+/).map(quickCleanCandidate).filter(Boolean);
  return [...new Set(chunks.filter(v => !/^(简介候选|候选结果|以下是)/.test(v)))].slice(0, 3);
}

function quickRenderCandidates(targetId, values, type) {
  const box = $(targetId);
  if (!box) return;
  box.innerHTML = '';
  if (!values.length) {
    const empty = document.createElement('div');
    empty.className = 'ml-quick-result-empty';
    empty.textContent = '模型没有返回可用候选，请调整提示词后重试。';
    box.appendChild(empty);
    return;
  }
  values.forEach((value, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ml-quick-candidate';
    button.textContent = value;
    const hint = document.createElement('small');
    hint.textContent = type === 'title' ? '点击填入左侧小说标题' : '点击填入左侧小说简介';
    button.appendChild(hint);
    button.onclick = () => {
      const target = type === 'title' ? $('quickTitle') : $('quickDescription');
      if (target) {
        target.value = value;
        target.focus();
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      toast(type === 'title' ? '已填入小说标题' : '已填入小说简介');
    };
    box.appendChild(button);
  });
}

function quickSetGenerating(generating) {
  ['quickTitleGenerate', 'quickBlurbGenerate', 'quickCreateSubmit'].forEach(id => {
    const el = $(id);
    if (el) el.disabled = !!generating;
  });
}

async function runQuickTitleGeneration() {
  if (quickCreateActiveController) { toast('请等待当前生成完成'); return; }
  const context = quickContext();
  const prompt = (($('quickTitlePrompt') && $('quickTitlePrompt').value) || '').trim();
  if (!context.genre && !context.description && !prompt) {
    quickSetStatus('Title', '请先填写题材、简介或提示词', 'error');
    return;
  }
  const requestText = `生成小说书名：题材 ${context.genre || '未指定'}；已有简介 ${context.description || '未提供'}；要求 ${prompt || '简洁、有辨识度、适合连载'}`;
  const model = quickCreateModelFor(requestText);
  updateQuickModelBadge(requestText);
  quickSetGenerating(true);
  quickSetStatus('Title', '生成中 · 使用 ' + quickReadableModel(model), '');
  const result = $('quickTitleResults');
  if (result) result.innerHTML = '<div class="ml-quick-result-empty">正在生成候选，请稍候…</div>';
  quickCreateTitleResult = '';
  let latestBilling = null;
  await streamChat({
    model,
    thinking: thinkMode,
    max_tokens: 256,
    messages: [
      { role: 'system', content: '你是中文网文编辑。只输出 5 个小说书名候选，每行一个，不要编号、解释、引号或 Markdown。书名要有辨识度，贴合题材。' },
      { role: 'user', content: requestText }
    ]
  }, {
    onController: controller => { quickCreateActiveController = controller; },
    onModel: used => { quickSetStatus('Title', '生成中 · 使用 ' + quickReadableModel(used), ''); },
    onBilling: billing => {
      latestBilling = billing;
      if (billing && billing.status === 'credit_exhausted') quickSetStatus('Title', '积分不足，生成已中断', 'error');
      else if (billing && billing.estimatedCreditCost != null) quickSetStatus('Title', '生成中 · 已消耗约 ' + billing.estimatedCreditCost + ' 积分', '');
    },
    onDelta: delta => { quickCreateTitleResult += delta; },
    onDone: reason => {
      if (reason === 'abort') { quickSetStatus('Title', '已取消生成', ''); return; }
      if (reason === 'credit_exhausted') { quickSetStatus('Title', '积分不足，生成已中断', 'error'); return; }
      const values = quickParseTitles(quickCreateTitleResult);
      quickRenderCandidates('quickTitleResults', values, 'title');
      if (values.length) quickSetStatus('Title', latestBilling && latestBilling.estimatedCreditCost != null ? '已完成 · 消耗约 ' + latestBilling.estimatedCreditCost + ' 积分' : '已完成', 'ok');
    },
    onError: message => { quickSetStatus('Title', message || '生成失败，请重试', 'error'); quickRenderCandidates('quickTitleResults', [], 'title'); }
  });
  quickCreateActiveController = null;
  quickSetGenerating(false);
}

async function runQuickBlurbGeneration() {
  if (quickCreateActiveController) { toast('请等待当前生成完成'); return; }
  const context = quickContext();
  const prompt = (($('quickBlurbPrompt') && $('quickBlurbPrompt').value) || '').trim();
  const style = (($('quickBlurbPrompt') && $('quickBlurbPrompt').dataset.style) || '').trim();
  if (!context.genre && !context.description && !prompt) {
    quickSetStatus('Blurb', '请先填写题材、简介或提示词', 'error');
    return;
  }
  const requestText = `生成 3 版中文网文小说简介：题材 ${context.genre || '未指定'}；已有设定 ${context.description || '未提供'}；风格 ${style || '自然、抓人'}；补充要求 ${prompt || '突出主角困境、核心冲突和后续期待'}`;
  const model = quickCreateModelFor(requestText);
  updateQuickModelBadge(requestText);
  quickSetGenerating(true);
  quickSetStatus('Blurb', '生成中 · 使用 ' + quickReadableModel(model), '');
  const result = $('quickBlurbResults');
  if (result) result.innerHTML = '<div class="ml-quick-result-empty">正在生成 3 版简介，请稍候…</div>';
  quickCreateBlurbResult = '';
  let latestBilling = null;
  await streamChat({
    model,
    thinking: thinkMode,
    max_tokens: 720,
    messages: [
      { role: 'system', content: '你是中文网文简介编辑。只输出 3 段可直接使用的小说简介，每段 80 至 150 字，段落之间空一行，不要编号、标题、解释或 Markdown。' },
      { role: 'user', content: requestText }
    ]
  }, {
    onController: controller => { quickCreateActiveController = controller; },
    onModel: used => { quickSetStatus('Blurb', '生成中 · 使用 ' + quickReadableModel(used), ''); },
    onBilling: billing => {
      latestBilling = billing;
      if (billing && billing.status === 'credit_exhausted') quickSetStatus('Blurb', '积分不足，生成已中断', 'error');
      else if (billing && billing.estimatedCreditCost != null) quickSetStatus('Blurb', '生成中 · 已消耗约 ' + billing.estimatedCreditCost + ' 积分', '');
    },
    onDelta: delta => { quickCreateBlurbResult += delta; },
    onDone: reason => {
      if (reason === 'abort') { quickSetStatus('Blurb', '已取消生成', ''); return; }
      if (reason === 'credit_exhausted') { quickSetStatus('Blurb', '积分不足，生成已中断', 'error'); return; }
      const values = quickParseBlurbs(quickCreateBlurbResult);
      quickRenderCandidates('quickBlurbResults', values, 'blurb');
      if (values.length) quickSetStatus('Blurb', latestBilling && latestBilling.estimatedCreditCost != null ? '已完成 · 消耗约 ' + latestBilling.estimatedCreditCost + ' 积分' : '已完成', 'ok');
    },
    onError: message => { quickSetStatus('Blurb', message || '生成失败，请重试', 'error'); quickRenderCandidates('quickBlurbResults', [], 'blurb'); }
  });
  quickCreateActiveController = null;
  quickSetGenerating(false);
}

function closeQuickCreate() {
  if (quickCreateActiveController) quickCreateActiveController.abort();
  quickCreateActiveController = null;
  const modal = $('quickCreateModal');
  if (modal) modal.hidden = true;
}

function openQuickCreate() {
  const modal = $('quickCreateModal');
  if (!modal) return;
  modal.hidden = false;
  updateQuickModelBadge();
  const title = $('quickTitle');
  if (title) setTimeout(() => title.focus(), 0);
}

function createQuickNovel() {
  const context = quickContext();
  if (!context.title) {
    const title = $('quickTitle');
    if (title) title.focus();
    toast('请先填写小说标题');
    return;
  }
  const description = [context.genre ? '题材：' + context.genre : '', context.description].filter(Boolean).join('\n');
  const fast = $('quickFastMode') && $('quickFastMode').checked;
  closeQuickCreate();
  location.href = './index.html?action=new&title=' + encodeURIComponent(context.title)
    + '&description=' + encodeURIComponent(description)
    + (context.genre ? '&genre=' + encodeURIComponent(context.genre) : '')
    + (fast ? '&quick=1' : '') + '#editor';
}

function buildQuickChips(id, values, onSelect) {
  const box = $(id);
  if (!box) return;
  box.innerHTML = '';
  values.forEach(value => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ml-quick-chip'; button.textContent = value;
    button.onclick = () => onSelect(value, button);
    box.appendChild(button);
  });
}

buildQuickChips('quickGenreChips', QUICK_GENRES, (value, button) => {
  const input = $('quickGenre'); if (input) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }
  button.parentElement.querySelectorAll('.ml-quick-chip').forEach(el => el.classList.toggle('is-active', el === button));
  updateQuickModelBadge();
});
buildQuickChips('quickStyleChips', QUICK_STYLES, (value, button) => {
  const input = $('quickBlurbPrompt');
  if (input) { input.dataset.style = value; input.placeholder = '当前风格：' + value + '。补充主角身份、开局困境、金手指、反派或世界观…'; }
  button.parentElement.querySelectorAll('.ml-quick-chip').forEach(el => el.classList.toggle('is-active', el === button));
});
const quickTitlePrompt = $('quickTitlePrompt');
const quickBlurbPrompt = $('quickBlurbPrompt');
if (quickTitlePrompt) quickTitlePrompt.addEventListener('input', () => updateQuickModelBadge(quickTitlePrompt.value));
if (quickBlurbPrompt) quickBlurbPrompt.addEventListener('input', () => updateQuickModelBadge(quickBlurbPrompt.value));
const quickTitleGenerate = $('quickTitleGenerate');
if (quickTitleGenerate) quickTitleGenerate.onclick = runQuickTitleGeneration;
const quickBlurbGenerate = $('quickBlurbGenerate');
if (quickBlurbGenerate) quickBlurbGenerate.onclick = runQuickBlurbGeneration;
const quickCreateSubmit = $('quickCreateSubmit');
if (quickCreateSubmit) quickCreateSubmit.onclick = createQuickNovel;
const quickCancel = $('quickCancel');
if (quickCancel) quickCancel.onclick = closeQuickCreate;
const quickClose = $('quickClose');
if (quickClose) quickClose.onclick = closeQuickCreate;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('quickCreateModal') && !$('quickCreateModal').hidden) closeQuickCreate();
});

/* ---------- CTA 接线 ---------- */
const navCreate = $('navCreate');
if (navCreate) navCreate.onclick = e => { e.preventDefault(); location.href = './index.html#editor'; };

const ctaCreate = $('ctaCreate');
if (ctaCreate) ctaCreate.onclick = e => { e.preventDefault(); openQuickCreate(); };

const ctaRegister = $('ctaRegister');
if (ctaRegister) ctaRegister.onclick = e => { e.preventDefault(); openModal('registerModal'); };

const ctaMyNovels = $('ctaMyNovels');
if (ctaMyNovels) ctaMyNovels.onclick = e => { e.preventDefault(); location.href = './pages/novels.html'; };

const ctaImport = $('ctaImport');
if (ctaImport) ctaImport.onclick = e => { e.preventDefault(); location.href = './index.html#editor'; };

const regSubmit = $('regSubmit');
if (regSubmit) regSubmit.onclick = async () => {
  const name = (($('regName') && $('regName').value) || '').trim();
  const email = (($('regEmail') && $('regEmail').value) || '').trim();
  const pwd = (($('regPwd') && $('regPwd').value) || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast(lang === 'zh' ? '请输入有效的邮箱' : 'Enter a valid email'); return; }
  if (pwd.length < 6) { toast(lang === 'zh' ? '密码至少 6 位' : 'Password needs 6+ chars'); return; }
  const label = regSubmit.textContent;
  regSubmit.disabled = true; regSubmit.textContent = lang === 'zh' ? '注册中…' : 'Signing up…';
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pwd, name: name || undefined })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || (lang === 'zh' ? '注册失败' : 'Sign up failed'));
    try { localStorage.setItem('ml_token', d.token); localStorage.setItem('ml_user', JSON.stringify(d.user)); } catch (_) {}
    closeModal('registerModal');
    toast(lang === 'zh' ? '注册成功，已自动登录' : 'Signed up & logged in');
    if (navLogin) location.reload();
  } catch (e) {
    toast(e.message || (lang === 'zh' ? '注册失败' : 'Sign up failed'));
  } finally {
    regSubmit.disabled = false; regSubmit.textContent = label;
  }
};

const navLogin = $('navLogin');
if (navLogin) {
  /* 登录态：pages/login.html 登录成功后写入 ml_user，首页导航显示用户名并支持退出 */
  let mlUser = null;
  try { mlUser = JSON.parse(localStorage.getItem('ml_user') || 'null'); } catch (_) {}
  if (mlUser && mlUser.email) {
    const span = navLogin.querySelector('span') || navLogin;
    const name = mlUser.name || mlUser.email;
    span.textContent = name.length > 10 ? name.slice(0, 10) + '…' : name;
    navLogin.title = mlUser.email + '（点击退出登录）';
    navLogin.onclick = e => {
      e.preventDefault();
      if (confirm('确定退出登录（' + mlUser.email + '）吗？')) {
        try { localStorage.removeItem('ml_token'); localStorage.removeItem('ml_user'); } catch (_) {}
        location.reload();
      }
    };
  } else {
    navLogin.onclick = e => { e.preventDefault(); location.href = './pages/login.html'; };
  }
}

/* 会话有效性自检：服务端重启会清空旧会话，遗留的 stale token 需清理后重新登录，
   否则导航栏显示已登录、AI 却报「请先登录」。仅在确实存在 token 时校验，未登录用户不受影响。 */
(function verifySession() {
  let tk = null;
  try { tk = localStorage.getItem('ml_token'); } catch (_) {}
  if (!tk) return;
  fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + tk }, cache: 'no-store' })
    .then(function (r) {
      if (r.status === 401) {
        try { localStorage.removeItem('ml_token'); localStorage.removeItem('ml_user'); } catch (_) {}
        toast(lang === 'zh' ? '登录状态已失效，请重新登录' : 'Session expired, please log in again');
        setTimeout(function () { location.reload(); }, 1200);
      }
    }).catch(function () {});
})();

/* ---------- 用户 / 分享 图标 ---------- */
const userBtn = $('userBtn');
if (userBtn) userBtn.onclick = () => { openModal('registerModal'); };

const shareBtn = $('shareBtn');
if (shareBtn) {
  shareBtn.onclick = async () => {
    const messages = $('messages');
    if (!messages || !messages.children.length) {
      toast(lang === 'zh' ? '暂无可分享的内容' : 'Nothing to share yet'); return;
    }
    const text = Array.from(messages.children).map(m => {
      const role = m.classList.contains('user') ? (lang === 'zh' ? '我' : 'Me') : '墨阑';
      return role + '：' + (m.querySelector('.bubble')?.textContent || '');
    }).join('\n\n');
    const ok = await copyText(text);
    toast(ok
      ? (lang === 'zh' ? '对话已复制到剪贴板' : 'Chat copied to clipboard')
      : (lang === 'zh' ? '复制失败，请手动选择' : 'Copy failed'));
  };
}

/* ---------- 导航 / 页脚 真实路由 ---------- */
function toastDemo() { toast(lang === 'zh' ? '该模块演示中，敬请期待' : 'Module in demo — coming soon'); }
const NAV_ACTION = {
  home: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  features: () => { location.href = './pages/features.html'; },
  pricing: () => { location.href = './pages/pricing.html'; },
  kb: () => { location.href = './pages/docs.html'; },
  tools: () => { location.href = './pages/tools.html'; },
  docs: () => { location.href = './pages/docs.html'; },
  blog: () => { location.href = './pages/blog.html'; }
};
document.querySelectorAll('[data-nav]').forEach(a => {
  a.onclick = e => { e.preventDefault(); const fn = NAV_ACTION[a.getAttribute('data-nav')]; if (fn) fn(); };
});

/* ---------- 移动端主导航 ---------- */
const mobileNavToggle = $('mobileNavToggle');
const mobileNavMenu = $('mobileNavMenu');
if (mobileNavToggle && mobileNavMenu) {
  const setMobileNavOpen = open => {
    mobileNavToggle.setAttribute('aria-expanded', String(open));
    mobileNavToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    mobileNavMenu.hidden = !open;
    mobileNavMenu.classList.toggle('is-open', open);
  };
  mobileNavToggle.onclick = () => setMobileNavOpen(mobileNavMenu.hidden);
  mobileNavMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMobileNavOpen(false)));
  window.addEventListener('resize', () => { if (window.innerWidth >= 768) setMobileNavOpen(false); });
}
const FOOT_ACTION = {
  about: () => { location.href = './pages/about.html'; },
  contact: () => { location.href = './pages/contact.html'; },
  tos: () => openLegal('tos'),
  privacy: () => openLegal('privacy')
};
document.querySelectorAll('[data-foot]').forEach(a => {
  a.onclick = e => {
    e.preventDefault();
    const fn = FOOT_ACTION[a.getAttribute('data-foot')];
    if (fn) fn(); else toastDemo();
  };
});

/* 服务条款 / 隐私政策（首页专用，内容与子页 site.js 保持一致） */
const LEGAL = {
  tos: {
    title: '服务条款',
    body: '<h2>1. 服务说明</h2><p>马良写作（由上海欧克安文化传媒有限公司运营）为用户提供 AI 辅助小说创作服务，包括但不限于大纲生成、正文创作、设定管理与免费工具。</p>'
        + '<h2>2. 账号与安全</h2><p>用户注册后应妥善保管账号凭据。因用户自身原因导致的账号泄露，平台不承担相应损失。</p>'
        + '<h2>3. 内容权属</h2><p>用户通过本平台创作的作品，其著作权归用户本人所有。平台不会将用户的私有作品内容用于模型训练或对外披露。</p>'
        + '<h2>4. 使用规范</h2><p>用户不得利用本服务生成违反法律法规的内容。平台有权对违规账号采取警告、限制或封禁措施。</p>'
        + '<h2>5. 积分与订阅</h2><p>积分消耗规则以价格页公示为准。已消耗积分不予退还；未使用的付费积分按购买协议处理。</p>'
        + '<h2>6. 服务变更</h2><p>平台保留调整功能与资费的权利，重大变更将提前在官网公告。</p>'
  },
  privacy: {
    title: '隐私政策',
    body: '<h2>1. 我们收集什么</h2><p>注册邮箱、登录记录、创作行为数据（用于积分结算与产品优化）。作品正文仅存储于你的账号空间。</p>'
        + '<h2>2. 我们如何使用</h2><p>提供并改进创作服务；积分结算与账单；安全风控与违规检测。</p>'
        + '<h2>3. 我们不会做什么</h2><p>不出售你的个人信息；不将你的私有作品用于训练公开模型；不向无关第三方披露你的创作内容。</p>'
        + '<h2>4. 数据安全</h2><p>传输采用 HTTPS 加密，密码经加盐哈希存储，核心数据定期备份。</p>'
        + '<h2>5. 你的权利</h2><p>你可以随时导出全部作品、注销账号并要求删除数据。联系 postmaster@maliangwriter.com 处理。</p>'
  }
};
function openLegal(key) {
  const d = LEGAL[key]; if (!d) return;
  const t = $('legalTitle'), b = $('legalBody');
  if (t) t.textContent = d.title;
  if (b) b.innerHTML = d.body;
  openModal('legalModal');
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 1800);
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 复制文本（兼容 file:// 等非安全上下文） */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) { return false; }
}

/* ---------- 启动 ---------- */
applyTheme(localStorage.getItem('molan_theme') || 'light');
if (langToggle) langToggle.textContent = lang === 'zh' ? '中' : 'EN';
applyI18n();
autoGrow();
checkHealth();
skillsReady = loadSkills();
