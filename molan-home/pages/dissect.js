(function () {
  'use strict';

  const API = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
  const token = () => { try { return localStorage.getItem('ml_token') || ''; } catch (_) { return ''; } };
  const user = () => { try { return JSON.parse(localStorage.getItem('ml_user') || 'null') || {}; } catch (_) { return {}; } };
  function storageIdentity() {
    const account = user();
    const identity = account.userId || account.id || account.email;
    return identity ? encodeURIComponent(String(identity).trim().toLowerCase()) : 'guest';
  }
  function storedSelectedModel() {
    try { return localStorage.getItem('molan_model:' + storageIdentity()) || ''; } catch (_) { return ''; }
  }
  function rememberSelectedModel(modelId) {
    try { localStorage.setItem('molan_model:' + storageIdentity(), String(modelId || '')); } catch (_) {}
  }
  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const number = value => Number(value || 0).toLocaleString('zh-CN');
  const phaseNames = { queued: '排队中', map: '全书地图', structure: '文章架构与金手指', entities: '人物与世界观', plot: '时间线与伏笔', style: '文风与技法', dna: '作者 DNA', validate: '证据校验', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '等待继续', running: '分析中' };
  const tabs = [
    ['overview', '概览'], ['architecture', '文章架构'], ['opening', '开篇节奏'], ['goldenFinger', '金手指'],
    ['characters', '人物'], ['worldbuilding', '世界观'], ['timeline', '时间线'],
    ['outline', '大纲'], ['foreshadowing', '伏笔'], ['styleProfile', '文风'], ['authorDna', '作者 DNA'], ['craftConstraints', '创作技法']
  ];
  const SOURCE_FILE_EXT = /\.(txt|md|markdown|text|log|srt|vtt|json)$/i;
  const MAX_SOURCE_FILES = 500;
  const MAX_SOURCE_CHARS = 20000000;
  let activeSource = 'text';
  let selectedFiles = [];
  let modelInfo = { models: [], access: {}, role: 'guest' };
  let tasks = [];
  let currentTask = null;
  let activeResultTab = 'overview';
  let pollTimer = null;
  let estimateTimer = null;
  let estimateRequest = 0;
  let toastTimer = null;

  async function api(path, options) {
    const headers = Object.assign({ Accept: 'application/json' }, options && options.headers || {});
    const t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    const response = await fetch(API + path, Object.assign({}, options || {}, { headers }));
    let body = null;
    try { body = await response.json(); } catch (_) {}
    if (response.status === 401) { location.href = './login.html?next=dissect'; throw new Error('请先登录'); }
    if (!response.ok) throw new Error(body && body.error || '请求失败');
    return body;
  }

  function notify(message, isError) {
    const node = $('toast');
    if (!node) return;
    node.textContent = String(message || '');
    node.classList.toggle('is-error', !!isError);
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2600);
  }

  function activeFiles() { return activeSource === 'text' ? [] : selectedFiles; }

  function setSourceTab(name) {
    activeSource = name;
    document.querySelectorAll('[data-source-tab]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.sourceTab === name));
    document.querySelectorAll('[data-source-pane]').forEach(pane => pane.classList.toggle('is-active', pane.dataset.sourcePane === name));
    updateEstimate();
  }

  function fileKey(file) {
    return [String(file.name || ''), Number(file.size) || 0, Number(file.lastModified) || 0].join('\u0000');
  }

  function normalizeImportedText(text) {
    return String(text || '').replace(/\uFEFF/g, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  }

  async function readTextFile(file) {
    if (!file) return { text: '', encoding: 'utf-8' };
    if (typeof file.arrayBuffer !== 'function' || typeof TextDecoder !== 'function') {
      return { text: normalizeImportedText(await file.text()), encoding: 'utf-8' };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let offset = 0;
    let encoding = 'utf-8';
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) offset = 3;
    else if (bytes[0] === 0xFF && bytes[1] === 0xFE) { offset = 2; encoding = 'utf-16le'; }
    else if (bytes[0] === 0xFE && bytes[1] === 0xFF) { offset = 2; encoding = 'utf-16be'; }
    const decode = label => {
      try { return new TextDecoder(label, { fatal: label === 'utf-8' }).decode(bytes.subarray(offset)); } catch (_) { return ''; }
    };
    let decoded = decode(encoding);
    if (!decoded && encoding === 'utf-8' && bytes.length > offset) {
      decoded = decode('gb18030') || decode('gbk');
      if (decoded) encoding = 'gb18030';
    }
    if (!decoded && bytes.length > offset) throw new Error('文本编码无法识别');
    return { text: normalizeImportedText(decoded), encoding };
  }

  async function readFiles(fileList, pathResolver) {
    const files = Array.from(fileList || []);
    let total = 0;
    const out = [];
    const skipped = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const name = String(typeof pathResolver === 'function' ? pathResolver(file, index) : file.webkitRelativePath || file.name || '');
      if (!SOURCE_FILE_EXT.test(file.name || name) || out.length >= MAX_SOURCE_FILES || total > MAX_SOURCE_CHARS) {
        skipped.push(name);
        continue;
      }
      let text = '';
      let encoding = 'utf-8';
      try {
        const decoded = await readTextFile(file);
        text = decoded.text;
        encoding = decoded.encoding;
      } catch (_) { skipped.push(name); continue; }
      total += text.length;
      out.push({ name, text, size: file.size, lastModified: Number(file.lastModified) || 0, encoding });
    }
    return { files: out, skipped };
  }

  function readDroppedEntry(entry, prefix) {
    if (entry.isFile) {
      return new Promise((resolve, reject) => entry.file(file => resolve([{ file, name: prefix || file.name }]), reject));
    }
    if (!entry.isDirectory) return Promise.resolve([]);
    return (async () => {
      const reader = entry.createReader();
      const entries = [];
      while (true) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        entries.push(...batch);
      }
      const files = [];
      for (const child of entries) {
        try { files.push(...await readDroppedEntry(child, prefix ? prefix + '/' + child.name : child.name)); } catch (_) {}
      }
      return files;
    })();
  }

  async function readDroppedHandle(handle, prefix) {
    if (!handle) return [];
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      return [{ file, name: prefix || file.name }];
    }
    if (handle.kind !== 'directory') return [];
    const files = [];
    for await (const child of handle.values()) {
      files.push(...await readDroppedHandle(child, prefix ? prefix + '/' + child.name : child.name));
    }
    return files;
  }

  async function readDroppedFiles(dataTransfer) {
    const items = Array.from(dataTransfer && dataTransfer.items || []);
    const records = [];
    for (const item of items) {
      if (item.kind !== 'file') continue;
      try {
        if (typeof item.getAsFileSystemHandle === 'function') {
          const handle = await item.getAsFileSystemHandle();
          if (handle) { records.push(...await readDroppedHandle(handle, handle.name)); continue; }
        }
      } catch (_) {}
      try {
        const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
        if (entry) { records.push(...await readDroppedEntry(entry, entry.name)); continue; }
      } catch (_) {}
      const file = item.getAsFile && item.getAsFile();
      if (file) records.push({ file, name: file.webkitRelativePath || file.name });
    }
    if (records.length) return records;
    return Array.from(dataTransfer && dataTransfer.files || []).map(file => ({ file, name: file.webkitRelativePath || file.name }));
  }

  function renderFiles(items, id) {
    const node = $(id);
    if (!node) return;
    node.innerHTML = items.length ? items.map(item => '<div class="file-item"><span title="' + esc(item.name) + '">' + esc(item.name) + '</span><em>' + number(item.size) + ' B</em></div>').join('') : '';
  }

  function renderQueue() {
    renderFiles(selectedFiles, 'fileList');
    renderFiles(selectedFiles, 'folderList');
  }

  function appendFiles(items) {
    const seen = new Set(selectedFiles.map(fileKey));
    const counts = { added: 0, duplicates: 0, limited: 0 };
    for (const item of items) {
      const key = fileKey(item);
      if (seen.has(key)) { counts.duplicates++; continue; }
      if (selectedFiles.length >= MAX_SOURCE_FILES) { counts.limited++; continue; }
      seen.add(key);
      selectedFiles.push(item);
      counts.added++;
    }
    renderQueue();
    updateEstimate();
    return counts;
  }

  function reportFileBatch(result, counts) {
    const details = [];
    if (counts.duplicates) details.push('重复 ' + counts.duplicates + ' 个');
    if (counts.limited) details.push('已达到最多 ' + MAX_SOURCE_FILES + ' 个文件');
    if (result.skipped.length) {
      const names = result.skipped.slice(0, 3).join('、');
      details.push('跳过 ' + result.skipped.length + ' 个不支持或无法读取的文件' + (names ? '：' + names + (result.skipped.length > 3 ? ' 等' : '') : ''));
    }
    if (counts.added) notify('已追加 ' + counts.added + ' 个文件' + (details.length ? '；' + details.join('；') : ''));
    else notify(details.join('；') || '没有可加入的文本文件', true);
  }

  async function addFileBatch(fileList, source, pathResolver) {
    setSourceTab(source);
    const result = await readFiles(fileList, pathResolver);
    reportFileBatch(result, appendFiles(result.files));
  }

  function currentChars() {
    if (activeSource === 'text') return ($('sourceText').value || '').length;
    return activeFiles().reduce((sum, item) => sum + String(item.text || '').length, 0);
  }

  function selectedModel() { return modelInfo.models.find(item => item.id === $('model').value) || modelInfo.models[0]; }

  function updateEstimate() {
    const chars = currentChars();
    const depth = document.querySelector('input[name="depth"]:checked')?.value || 'standard';
    const cap = depth === 'quick' ? 8 : depth === 'deep' ? 60 : 18;
    const sampleChars = Math.min(chars, cap * 90000);
    const output = $('estimateCredits');
    if (!chars) { if (output) output.textContent = '--'; return; }
    if (output) output.textContent = '计算中…';
    clearTimeout(estimateTimer);
    const requestId = ++estimateRequest;
    estimateTimer = setTimeout(async () => {
      try {
        const data = await api('/api/billing/estimate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: 'dissection', chars: sampleChars, depth, model: $('model').value })
        });
        if (requestId !== estimateRequest || !output) return;
        output.textContent = Number(data.estimatedCredits || 0).toFixed(2) + ' 积分';
      } catch (error) {
        if (requestId === estimateRequest && output) output.textContent = '暂无法预估';
      }
    }, 220);
  }

  async function loadModels() {
    const data = await api('/api/models');
    modelInfo = Object.assign(modelInfo, data, { role: data.access && data.access.role || 'guest' });
    const select = $('model');
    select.innerHTML = (data.models || []).map(item => '<option value="' + esc(item.id) + '">' + esc(item.name || item.id) + '</option>').join('');
    const stored = storedSelectedModel();
    if (data.access && data.access.canChooseModel && (data.models || []).some(item => item.id === stored)) select.value = stored;
    else if (data.access && data.access.defaultModel) select.value = data.access.defaultModel;
    if (!(data.access && data.access.canChooseModel)) select.disabled = true;
    rememberSelectedModel(select.value);
    updateEstimate();
  }

  function taskHasResult(task) {
    if (!task) return false;
    if (typeof task.hasResult === 'boolean') return task.hasResult;
    const result = task.result || {};
    const has = value => {
      if (Array.isArray(value)) return value.some(has);
      if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => !['version', 'schemaVersion', 'confidence'].includes(key) && has(item));
      return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim().length > 0);
    };
    return has(result.overview) && has(result.framework) && has(result.dissectionMap || result.timeline)
      && has(result.architecture || result.articleArchitecture) && has(result.opening || result.openingRhythm)
      && has(result.goldenFinger) && has(result.characters || result.worldbuilding)
      && has(result.evidenceLedger) && has(result.outline || result.foreshadowing)
      && has(result.styleProfile || result.craftConstraints) && has(result.validation);
  }

  function taskHasPartialResult(task) {
    if (!task) return false;
    if (typeof task.hasPartialResult === 'boolean') return task.hasPartialResult;
    const value = task.result;
    const has = item => {
      if (Array.isArray(item)) return item.some(has);
      if (item && typeof item === 'object') return Object.entries(item).some(([key, child]) => !['version', 'schemaVersion', 'confidence'].includes(key) && has(child));
      return (typeof item === 'string' && item.trim().length > 0) || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item));
    };
    return has(value);
  }

  function resultMissingFields(task) {
    if (Array.isArray(task && task.resultMissingFields) && task.resultMissingFields.length) return task.resultMissingFields;
    if (taskHasResult(task)) return [];
    return ['拆书阶段核心结果'];
  }

  function renderTaskList() {
    const node = $('taskList');
    if (!tasks.length) { node.innerHTML = '<div class="empty">还没有拆书任务，先导入一本书吧。</div>'; return; }
    node.innerHTML = tasks.map(task => {
      const status = task.status || 'queued';
      const emptyCompleted = status === 'completed' && !taskHasResult(task);
      const action = ['failed', 'cancelled', 'interrupted'].includes(status) || emptyCompleted ? '<button class="btn" data-retry="' + esc(task.id) + '" type="button">' + (emptyCompleted ? '重新分析' : '继续') + '</button>' : '';
      const remove = status === 'completed' || status === 'failed' || status === 'cancelled' ? '<button class="btn" data-delete="' + esc(task.id) + '" type="button">删除</button>' : '';
      return '<div class="task-row" data-task="' + esc(task.id) + '"><div class="task-top"><div style="min-width:0"><div class="task-title">' + esc(task.title) + '</div><div class="task-meta">' + esc(task.sourceName || task.sourceType || '') + ' · ' + number(task.wordCount) + ' 字 · 预计 ' + Number(task.estimatedCredits || 0).toFixed(2) + ' 积分</div></div><span class="task-status ' + esc(status) + '">' + esc(phaseNames[status] || status) + '</span></div><div class="task-progress"><i style="width:' + Math.max(0, Math.min(100, Number(task.progress) || 0)) + '%"></i></div><div class="task-meta" style="display:flex;justify-content:space-between;align-items:center"><span>' + esc(phaseNames[task.phase] || task.phase || '等待') + ' · 实际 ' + Number(task.actualCredits || 0).toFixed(2) + ' 积分</span><span>' + action + ' ' + remove + '</span></div></div>';
    }).join('');
  }

  function updateProgress(task) {
    if (!task) return;
    $('progressWrap').hidden = false;
    $('progressPhase').textContent = phaseNames[task.phase] || phaseNames[task.status] || '处理中';
    $('progressPercent').textContent = (Number(task.progress) || 0) + '%';
    $('progressBar').style.width = Math.max(0, Math.min(100, Number(task.progress) || 0)) + '%';
    $('progressMeta').textContent = task.status === 'interrupted'
      ? '服务曾重启，已保存到第 ' + number(task.phaseIndex || 0) + ' 个阶段；点击任务列表中的“继续”后恢复。'
      : '已处理 ' + number(task.sampleCount || 0) + ' 个样本片段 · 实际消耗 ' + Number(task.actualCredits || 0).toFixed(2) + ' 积分；阶段完成后会自动保存。';
    $('cancelBtn').hidden = !['queued', 'running'].includes(task.status);
    $('cancelBtn').disabled = !['queued', 'running'].includes(task.status);
  }

  function plain(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return JSON.stringify(value, null, 2);
  }

  function renderItems(items, emptyText) {
    if (!Array.isArray(items) || !items.length) return '<div class="empty">' + esc(emptyText || '暂无结果，可能需要更深的分析深度。') + '</div>';
    return '<div class="result-list">' + items.map(item => {
      const title = item.name || item.title || item.id || item.from || '分析条目';
      const summary = item.summary || item.description || item.function || item.change || item.goal || item.rule || item.text || '';
      const evidence = item.evidence || item.source || item.setupChapter || item.scope || '';
      return '<div class="result-item"><strong>' + esc(title) + '</strong><p>' + esc(plain(summary)) + '</p>' + (evidence ? '<small>证据/范围：' + esc(plain(evidence)) + '</small>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function renderResultContent() {
    const raw = currentTask && currentTask.result || {};
    const result = {
      ...raw,
      architecture: raw.architecture || raw.articleArchitecture || raw.article_architecture || {},
      opening: raw.opening || raw.openingRhythm || raw.opening_rhythm || {},
      goldenFinger: raw.goldenFinger || raw.golden_finger || {},
      styleProfile: raw.styleProfile || raw.style_profile || {},
      authorDna: raw.authorDna || raw.authorDNA || raw.author_dna || raw.dna || {},
      craftConstraints: raw.craftConstraints || raw.craft_constraints || []
    };
    const key = activeResultTab;
    let html = '';
    if (key === 'overview') {
      const overview = result.overview && Object.keys(result.overview).length ? result.overview : (result.dissectionMap || {});
      const framework = result.framework || {};
      const summary = overview.summary || overview.premise || overview.description || (!overview.positioning ? plain(overview) : '');
      html = '<div class="boundary">拆书结果分为“原书观察”和“可迁移规律”。开始仿写时只会带入后者，原书专属内容默认排除。</div><h3>' + esc(overview.positioning || '作品概览') + '</h3><p>' + esc(plain(summary)) + '</p><h4>目标读者与卖点</h4><p>' + esc(plain(overview.targetReader || overview.sellingPoints || '')) + '</p><h4>主线与节奏</h4><p>' + esc(plain(framework.mainline || framework.opening || '')) + '</p>';
    } else if (key === 'opening') {
      // ★ 开篇节奏：结构化展示
      const o = result.opening || {};
      const rows = [
        ['钩子出现区间', o.hookWindow || o.hook_range || o.position],
        ['开篇冲突/危机', o.openingConflict || o.firstCrisis || o.conflict || o.opening],
        ['背景交代控制', o.infoDumpControl || o.info_dump || o.backgroundControl],
        ['第一章目标', o.chapterOneGoal || o.firstChapterGoal || o.firstChapter],
        ['读者情绪曲线', o.readerTension || o.readerEmotion || o.tensionCurve],
        ['首个爆点', o.firstBreakout || o.firstMajorPayoff],
        ['节奏总结', o.summary || o.paceSummary || o.pacingSummary || o.recommendedCadence || '']
      ].filter(row => row[1]);
      html = '<div class="boundary">开篇节奏：从原作开篇提炼的钩子、冲突、背景交代与情绪曲线，可直接迁移到新作开篇。</div>';
      html += rows.length ? '<div class="result-list">' + rows.map(row => '<div class="result-item"><strong>' + esc(row[0]) + '</strong><p>' + esc(plain(row[1])) + '</p></div>').join('') + '</div>' : renderItems(null, '暂无开篇节奏结果');
      const beatList = o.beats || o.rhythmBeats || o.pacing || o.ats;
      if (Array.isArray(beatList) && beatList.length) html += '<h4>节奏节点</h4>' + renderItems(beatList, '暂无');
    } else if (key === 'goldenFinger') {
      // ★ 金手指：结构化展示
      const g = result.goldenFinger || {};
      const growthLoop = Array.isArray(g.growthCurve) && g.growthCurve.length ? g.growthCurve : g.growthLoop;
      const rows = [
        ['类型', g.type || g.kind || g.fingerType],
        ['入口与机制', g.entry || g.coreMechanism],
        ['激活条件', g.activation || g.activationCondition || g.trigger],
        ['成长曲线', Array.isArray(growthLoop) ? growthLoop.map(c => (c.stage || '') + '：' + (c.ability || '') + (c.reward ? '（回报：' + c.reward + '）' : '') + (c.cost ? '（代价：' + c.cost + '）' : '')).join('；') : (g.growthCurve || g.growthLoop || g.growth || '')],
        ['限制与约束', g.limitations || g.limits || g.restrictions || g.lim],
        ['揭示节奏', g.revealCadence],
        ['故事作用', g.storyFunction || g.function || g.role],
        ['读者预期', g.readerPromise]
      ].filter(row => row[1]);
      html = '<div class="boundary">金手指：原作中主角的核心能力/外挂机制。类型与成长曲线可迁移，具体名称与世界观绑定不迁移。</div>';
      html += rows.length ? '<div class="result-list">' + rows.map(row => '<div class="result-item"><strong>' + esc(row[0]) + '</strong><p>' + esc(plain(row[1])) + '</p></div>').join('') + '</div>' : renderItems(null, '暂无金手指结果');
      if (Array.isArray(growthLoop) && growthLoop.length) html += '<h4>成长曲线明细</h4>' + renderItems(growthLoop, '暂无');
    } else if (key === 'architecture') {
      // ★ 文章架构：结构化展示
      const a = result.architecture || {};
      const volumeMap = a.volumeMap || a.volumes || a.stages || [];
      html = '<div class="boundary">文章架构：原作的分卷/阶段布局与节奏模型，可作为新作的骨架参考。</div>';
      if (a.structuralPattern || a.pattern || a.summary) html += '<h4>结构骨架</h4><p>' + esc(plain(a.structuralPattern || a.pattern || a.summary)) + '</p>';
      if (a.pacingModel || a.pacing) html += '<h4>节奏模型</h4><p>' + esc(plain(a.pacingModel || a.pacing)) + '</p>';
      if (Array.isArray(volumeMap) && volumeMap.length) html += '<h4>分卷/阶段布局</h4>' + renderItems(volumeMap, '暂无');
      else html += renderItems(null, '暂无文章架构结果');
    } else if (key === 'styleProfile') {
      const style = result.styleProfile || {};
      html = '<h3>可迁移文风</h3><p>' + esc(plain(style.summary || '')) + '</p>' + renderItems(style.dimensions, '暂无文风维度') + '<h4>证据与置信度</h4>' + renderItems(style.evidence, '暂无证据');
    } else if (key === 'authorDna') {
      const dna = result.authorDna || {};
      const dimensions = Array.isArray(dna.dimensions) ? dna.dimensions : [];
      const rules = Array.isArray(dna.rules) ? dna.rules : [];
      const forbidden = Array.isArray(dna.forbiddenPatterns) ? dna.forbiddenPatterns : [];
      const unknowns = Array.isArray(dna.unknowns) ? dna.unknowns : [];
      html = '<div class="boundary">作者 DNA 只保留可迁移的作者方法，不带入原书人物、地点、事件或专有名词；candidate 规则需要在新作品中继续验证。</div>';
      html += '<h3>作者方法层</h3><p>' + esc(plain(dna.summary || '')) + '</p>';
      html += '<h4>方法维度</h4>' + renderItems(dimensions, '暂无方法维度');
      html += '<h4>可执行规则</h4>' + renderItems(rules, '暂无可执行规则');
      if (forbidden.length) html += '<h4>应避免的模式</h4>' + renderItems(forbidden, '暂无');
      if (unknowns.length) html += '<h4>仍需校准</h4>' + renderItems(unknowns, '暂无');
    } else if (key === 'craftConstraints') {
      html = '<h3>可复用创作技法</h3>' + renderItems(result.craftConstraints, '暂无已确认的创作技法') + '<h4>不确定项</h4>' + renderItems((result.validation || {}).uncertain, '暂无');
    } else {
      html = '<h3>' + esc(tabs.find(tab => tab[0] === key)?.[1] || '分析结果') + '</h3>' + renderItems(result[key], '暂无结果');
    }
    $('resultContent').innerHTML = html;
  }

  function renderResult(task) {
    currentTask = task;
    if (!task) { $('resultPanel').hidden = true; return; }
    updateProgress(task);
    const complete = taskHasResult(task);
    const partial = taskHasPartialResult(task);
    const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(String(task.status || '').toLowerCase());
    $('resultPanel').hidden = !(terminal && (complete || partial || task.status === 'failed'));
    if (!terminal) return;
    $('resultTitle').textContent = task.title + ' · 拆书结果';
    $('resultMeta').textContent = number(task.wordCount) + ' 字 · ' + number(task.chapterCount) + ' 个片段 · 实际消耗 ' + Number(task.actualCredits || 0).toFixed(2) + ' 积分';
    $('resultTabs').innerHTML = tabs.map(tab => '<button class="result-tab ' + (activeResultTab === tab[0] ? 'is-active' : '') + '" type="button" data-result-tab="' + tab[0] + '">' + tab[1] + '</button>').join('');
    renderResultContent();
    if (!complete) {
      const missing = resultMissingFields(task).join('、');
      $('resultContent').insertAdjacentHTML('afterbegin', '<div class="boundary">这条任务已结束，但拆书结果不完整；已保存的阶段结果仍可查看。缺少：' + esc(missing) + '。请点击左侧“继续”从缺失阶段重试。</div>');
    }
  }

  async function loadTasks(preferredId) {
    const data = await api('/api/dissections');
    tasks = data.tasks || [];
    renderTaskList();
    const chosen = preferredId ? tasks.find(item => item.id === preferredId) : (currentTask && tasks.find(item => item.id === currentTask.id)) || tasks[0];
    if (chosen) await selectTask(chosen.id);
  }

  async function selectTask(id) {
    const data = await api('/api/dissections/' + encodeURIComponent(id));
    renderResult(data.task);
    tasks = tasks.map(item => item.id === id ? data.task : item);
    renderTaskList();
    if (data.task && ['queued', 'running'].includes(data.task.status)) startPolling(id);
  }

  function startPolling(id) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const data = await api('/api/dissections/' + encodeURIComponent(id));
        renderResult(data.task);
        tasks = tasks.map(item => item.id === id ? data.task : item);
        renderTaskList();
        if (['completed', 'failed', 'cancelled'].includes(data.task.status)) { clearInterval(pollTimer); pollTimer = null; }
      } catch (_) {}
    }, 1600);
  }

  async function createTask() {
    const text = $('sourceText').value.trim();
    const files = activeFiles();
    if (activeSource === 'text' && !text) return notify('请先粘贴正文', true);
    if (activeSource !== 'text' && !files.length) return notify('请先选择文本文件', true);
    if (currentChars() > MAX_SOURCE_CHARS) return notify('当前文本超过 2000 万字符，请拆分后分批分析', true);
    $('startBtn').disabled = true;
    try {
      const data = await api('/api/dissections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        title: $('taskTitle').value.trim() || (files[0] && files[0].name) || '未命名拆书', sourceName: files.length ? files[0].name : '粘贴文本', sourceType: activeSource === 'text' ? 'text' : (files.some(item => /[\\/]/.test(item.name)) || files.length > 1 ? 'folder' : 'file'),
        text: activeSource === 'text' ? text : '', files: activeSource === 'text' ? [] : files.map(item => ({ name: item.name, text: item.text, size: item.size, lastModified: item.lastModified, encoding: item.encoding })),
        purpose: $('purpose').value, depth: document.querySelector('input[name="depth"]:checked')?.value || 'standard', model: $('model').value
      }) });
      await loadTasks(data.task && data.task.id);
      if (data.task) startPolling(data.task.id);
    } catch (error) { notify(error.message, true); } finally { $('startBtn').disabled = false; }
  }

  async function cancelCurrent() {
    if (!currentTask) return;
    try { const data = await api('/api/dissections/' + encodeURIComponent(currentTask.id) + '/cancel', { method: 'POST' }); renderResult(data.task); await loadTasks(currentTask.id); } catch (error) { notify(error.message, true); }
  }

  async function retryTask(id) {
    try { const data = await api('/api/dissections/' + encodeURIComponent(id) + '/retry', { method: 'POST' }); renderResult(data.task); await loadTasks(id); startPolling(id); } catch (error) { notify(error.message, true); }
  }

  async function deleteTask(id) {
    if (!window.confirm('删除这条拆书任务及其分析结果？')) return;
    try { await api('/api/dissections/' + encodeURIComponent(id), { method: 'DELETE' }); if (currentTask && currentTask.id === id) renderResult(null); await loadTasks(); } catch (error) { notify(error.message, true); }
  }

  async function download(format) {
    if (!currentTask) return;
    const response = await fetch(API + '/api/dissections/' + encodeURIComponent(currentTask.id) + '/export?format=' + format, { headers: { Authorization: 'Bearer ' + token() } });
    if (!response.ok) { notify('导出失败', true); return; }
    const blob = await response.blob();
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'dissection-' + currentTask.id + '.' + (format === 'markdown' ? 'md' : 'json'); link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function openRewrite() {
    if (!currentTask) return;
    try {
      const data = await api('/api/dissections/' + encodeURIComponent(currentTask.id) + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      $('rewritePreview').textContent = JSON.stringify({ styleProfile: data.styleProfile, craftConstraints: data.craftConstraints, boundary: data.sourceBoundary }, null, 2);
      $('rewriteModal').hidden = false;
      $('applyEditorBtn').onclick = () => {
        const account = user().email || 'guest';
        try { localStorage.setItem('molan_dissect_handoff:' + encodeURIComponent(account.toLowerCase()), JSON.stringify({ sourceId: currentTask.id, title: currentTask.title, styleProfile: data.styleProfile, craftConstraints: data.craftConstraints })); } catch (_) {}
        location.href = '../index.html?from=dissect#editor';
      };
    } catch (error) { notify(error.message, true); }
  }

  document.querySelectorAll('[data-source-tab]').forEach(btn => btn.addEventListener('click', () => setSourceTab(btn.dataset.sourceTab)));
  $('pickFilesBtn').addEventListener('click', () => $('fileInput').click());
  $('pickFolderBtn').addEventListener('click', () => $('folderInput').click());
  document.querySelectorAll('[data-clear-files]').forEach(btn => btn.addEventListener('click', () => { selectedFiles = []; renderQueue(); updateEstimate(); notify('已清空文件清单'); }));
  $('fileInput').addEventListener('change', async event => { try { await addFileBatch(event.target.files, 'file'); } catch (error) { notify(error.message || '文件读取失败', true); } finally { event.target.value = ''; } });
  $('folderInput').addEventListener('change', async event => { try { await addFileBatch(event.target.files, 'folder'); } catch (error) { notify(error.message || '文件夹读取失败', true); } finally { event.target.value = ''; } });
  document.querySelectorAll('.drop-zone').forEach(zone => {
    zone.addEventListener('dragenter', event => { event.preventDefault(); event.stopPropagation(); });
    zone.addEventListener('dragover', event => { event.preventDefault(); event.stopPropagation(); });
    zone.addEventListener('drop', async event => {
      event.preventDefault(); event.stopPropagation();
      try {
        const source = zone.dataset.dropSource || 'file';
        const records = await readDroppedFiles(event.dataTransfer);
        await addFileBatch(records.map(record => record.file), source, (_, index) => records[index].name);
      } catch (error) { notify(error.message || '拖放文件读取失败', true); }
    });
  });
  $('sourceText').addEventListener('input', updateEstimate);
  $('model').addEventListener('change', () => { rememberSelectedModel($('model').value); updateEstimate(); });
  document.querySelectorAll('input[name="depth"]').forEach(input => input.addEventListener('change', updateEstimate));
  $('startBtn').addEventListener('click', createTask);
  $('cancelBtn').addEventListener('click', cancelCurrent);
  $('refreshBtn').addEventListener('click', () => loadTasks().catch(error => notify(error.message, true)));
  $('taskList').addEventListener('click', event => {
    const retry = event.target.closest('[data-retry]'); if (retry) { event.stopPropagation(); retryTask(retry.dataset.retry); return; }
    const remove = event.target.closest('[data-delete]'); if (remove) { event.stopPropagation(); deleteTask(remove.dataset.delete); return; }
    const row = event.target.closest('[data-task]'); if (row) selectTask(row.dataset.task).catch(error => notify(error.message, true));
  });
  $('resultTabs').addEventListener('click', event => { const btn = event.target.closest('[data-result-tab]'); if (!btn) return; activeResultTab = btn.dataset.resultTab; renderResult(currentTask); });
  $('exportJsonBtn').addEventListener('click', () => download('json'));
  $('exportMdBtn').addEventListener('click', () => download('markdown'));
  $('rewriteBtn').addEventListener('click', openRewrite);
  $('closeRewriteBtn').addEventListener('click', () => { $('rewriteModal').hidden = true; });

  Promise.all([loadModels(), loadTasks()]).catch(error => { if (error.message !== '请先登录') notify(error.message, true); });
})();
