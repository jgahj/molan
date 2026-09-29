/* =========================================================================
 * 墨阑 · 创作工作台功能实现
 * 自包含：不依赖 app.js。所有交互均接通真实数据与 /api/chat 流式接口。
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const qa = sel => Array.from(document.querySelectorAll(sel));
  const API_BASE = (location.protocol === 'file:' || location.protocol === 'about:') ? 'http://localhost:3000' : '';
  const CLOUD_REQUEST_TIMEOUT_MS = 30000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const CHARACTER_ARCHETYPES = Object.freeze([
    '豪爽侠义型', '冷静理智型', '温柔内敛型', '活泼开朗型', '阴郁腹黑型',
    '霸道强势型', '天真烂漫型', '市侩圆滑型', '高傲冷峻型', '热血冲动型'
  ]);
  const CHARACTER_ARCHETYPE_KEYWORDS = Object.freeze({
    '豪爽侠义型': ['豪爽', '侠义', '仗义', '直爽', '洒脱', '义气', '大方'],
    '冷静理智型': ['冷静', '理智', '克制', '淡漠', '审慎'],
    '温柔内敛型': ['温柔', '含蓄', '内敛', '体贴', '柔和'],
    '活泼开朗型': ['活泼', '开朗', '乐观', '跳脱', '爱笑'],
    '阴郁腹黑型': ['阴沉', '腹黑', '算计', '偏执', '危险'],
    '霸道强势型': ['霸道', '强势', '掌控', '专横', '命令', '果断'],
    '天真烂漫型': ['天真', '单纯', '烂漫', '懵懂', '好奇'],
    '市侩圆滑型': ['市侩', '圆滑', '精明', '世故', '会算', '逐利'],
    '高傲冷峻型': ['高傲', '冷峻', '孤傲', '骄傲', '不屑', '疏离'],
    '热血冲动型': ['热血', '冲动', '直率', '暴躁', '好战']
  });

  /** Normalize a character archetype before it is shown or persisted locally. */
  function normalizeCharacterArchetype(value) {
    const normalized = String(value || '').trim();
    return CHARACTER_ARCHETYPES.includes(normalized) ? normalized : '';
  }

  /** Infer a standard archetype from exact tags and bounded character-card text. */
  function inferCharacterArchetype(entity) {
    const source = entity && typeof entity === 'object' ? entity : {};
    const explicit = normalizeCharacterArchetype(source.archetype);
    if (explicit) {
      const explicitSource = source.archetypeSource === 'inferred' ? 'inferred' : 'explicit';
      return { archetype: explicit, source: explicitSource, confidence: explicitSource === 'explicit' ? 1 : Number(source.archetypeConfidence) || 0.65 };
    }
    const tags = Array.isArray(source.tags) ? source.tags.map(value => String(value || '').trim().toLowerCase()) : [];
    const attrs = Array.isArray(source.attrs) ? source.attrs.map(item => typeof item === 'string' ? item : String((item && (item.k || item.key || item.name || '')) + ' ' + (item && (item.v || item.value || item.text || '')))) : [];
    const body = [source.personality, source.notes, source.intro, source.description, ...attrs].filter(Boolean).join(' ').toLowerCase();
    const scores = CHARACTER_ARCHETYPES.map(archetype => {
      let score = 0;
      (CHARACTER_ARCHETYPE_KEYWORDS[archetype] || []).forEach(keyword => {
        const normalized = keyword.toLowerCase();
        if (tags.some(tag => tag === normalized)) score += 6;
        else if (tags.some(tag => tag.includes(normalized))) score += 4;
        let at = 0;
        let count = 0;
        while ((at = body.indexOf(normalized, at)) >= 0 && count < 3) { count += 1; at += normalized.length; }
        score += count * 1.25;
      });
      return { archetype, score };
    }).sort((left, right) => right.score - left.score);
    const top = scores[0];
    const second = scores[1];
    if (!top || top.score < 2 || (second && second.score > 0 && top.score - second.score < 1.5)) return { archetype: '', source: 'none', confidence: 0 };
    return { archetype: top.archetype, source: 'inferred', confidence: Number(Math.min(0.94, Math.max(0.5, top.score / (top.score + (second ? second.score : 0) + 1))).toFixed(2)) };
  }

  /** Resolve the display value and provenance without mutating an existing character card. */
  function characterArchetypeDisplay(entity) {
    const result = inferCharacterArchetype(entity);
    return { ...result, sourceLabel: result.source === 'explicit' ? '用户指定' : result.source === 'inferred' ? '根据人物卡关键词推断' : '未能判断，使用通用规则' };
  }

  /** Persist a selected or inferred archetype after a character card is saved. */
  function applyCharacterArchetype(entity, explicitValue, sourceHint) {
    if (!entity || entity.type !== 'character') return;
    const explicit = normalizeCharacterArchetype(explicitValue);
    if (explicit && sourceHint === 'inferred') {
      entity.archetype = explicit;
      entity.archetypeSource = 'inferred';
      entity.archetypeConfidence = Number(entity.archetypeConfidence) || 0.65;
      return;
    }
    if (explicit) {
      entity.archetype = explicit;
      entity.archetypeSource = 'explicit';
      entity.archetypeConfidence = 1;
      return;
    }
    const inferred = inferCharacterArchetype({ ...entity, archetype: '' });
    if (inferred.archetype) {
      entity.archetype = inferred.archetype;
      entity.archetypeSource = 'inferred';
      entity.archetypeConfidence = inferred.confidence;
    } else {
      delete entity.archetype;
      entity.archetypeSource = 'none';
      entity.archetypeConfidence = 0;
    }
  }

  /* ---------------- 云端小说库（SQLite） ----------------
   * 设计原则：localStorage 是第一层（同步保证即时可用），登录后异步 PUT 远端作为第二层。
   * 未登录：纯本地，跟之前一样；登录后：每次 persist 后 fire-and-forget 同步。
   * 首次同步：登录后遍历本地 novels 全部 POST 到云端。同步按钮：从云端拉取覆盖本地。
   */
  const TOKEN_KEY = 'ml_token';
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } }
  function getStoredUserIdentity() {
    try {
      const user = JSON.parse(localStorage.getItem('ml_user') || 'null');
      if (user && (user.userId || user.id)) return String(user.userId || user.id).trim();
      return user && user.email ? String(user.email).trim().toLowerCase() : '';
    } catch (_) { return ''; }
  }
  function storageIdentity() {
    const identity = getStoredUserIdentity();
    return identity ? encodeURIComponent(identity) : 'guest';
  }
  function sessionIdentity() { return storageIdentity() + '|' + getToken(); }
  function rememberSelectedModel(modelId) {
    try { localStorage.setItem('molan_model:' + storageIdentity(), String(modelId || '')); } catch (_) {}
  }
  function cloudEnabled() {
    // 同源（API_BASE 空）或 API_BASE 已设且有 token 即视为已登录且云端可用
    if (!getToken()) return false;
    if (API_BASE) return true;
    return location.protocol === 'http:' || location.protocol === 'https:';
  }
  async function api(path, method, body) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = getToken(); if (tok) headers['Authorization'] = 'Bearer ' + tok;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS) : null;
    try {
      const res = await fetch(API_BASE + path, {
        method: method || (body ? 'POST' : 'GET'),
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller ? controller.signal : undefined
      });
      let data; try { data = await res.json(); } catch (_) { data = {}; }
      if (!res.ok) { const e = new Error(data.error || ('请求失败 ' + res.status)); e.status = res.status; throw e; }
      return data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const novelApi = {
    list: () => api('/api/novels', 'GET'),
    get: (id) => api('/api/novels/' + id, 'GET'),
    save: (id, state, title, revision) => api('/api/novels/' + id, 'PUT', { state, title, ...(Number.isInteger(revision) ? { revision } : {}) }),
    create: (id, state, title) => api('/api/novels', 'POST', { id, state, title }),
    remove: (id) => api('/api/novels/' + id, 'DELETE')
  };
  // fire-and-forget 远端保存；失败静默（用户已看到本地「已保存」），但收集到 syncQueue 供 UI 显示
  const syncQueue = new Map(); // id -> 'pending' | 'ok' | 'error'
  const cloudWriteQueues = new Map(); // id -> { identity, latest, removeRequested, running }
  const cloudRevisions = new Map(); // id -> server revision
  const cloudConflicts = new Map(); // id -> { local, remoteRevision, detectedAt }
  function runCloudWriteQueue(id, queue) {
    if (queue.running) return;
    queue.running = true;
    (async () => {
      let failed = false;
      try {
        while (queue.removeRequested || queue.latest) {
          if (sessionIdentity() !== queue.identity) { queue.latest = null; queue.removeRequested = false; break; }
          if (queue.removeRequested) {
            queue.removeRequested = false;
            queue.latest = null;
            try {
              await novelApi.remove(id);
            } catch (error) {
              syncQueue.set(id, 'error');
              if (typeof renderSyncBadge === 'function') renderSyncBadge();
              console.warn('[云端删除失败]', id, error.message);
              break;
            }
            syncQueue.delete(id);
            cloudRevisions.delete(id);
            if (typeof renderSyncBadge === 'function') renderSyncBadge();
            continue;
          }
          const job = queue.latest;
          queue.latest = null;
          try {
            const result = job.op === 'create'
              ? await novelApi.create(id, job.state, job.title)
              : await novelApi.save(id, job.state, job.title, job.revision);
            if (result && Number.isInteger(result.revision)) cloudRevisions.set(id, result.revision);
            cloudConflicts.delete(id);
          } catch (error) {
            if (error && error.status === 409) {
              queue.latest = null;
              failed = true;
              cloudConflicts.set(id, { local: job, detectedAt: Date.now() });
              syncQueue.set(id, 'error');
              if (typeof renderSyncBadge === 'function') renderSyncBadge();
              toast('《' + ((novels[id] && novels[id].title) || '小说') + '》云端有新版本，请处理同步冲突');
              break;
            }
            // 保留最后一个快照，下一次本地保存时自动重试，避免旧请求覆盖新内容。
            queue.latest = job;
            failed = true;
            syncQueue.set(id, 'error');
            if (typeof renderSyncBadge === 'function') renderSyncBadge();
            console.warn('[云端同步失败]', id, error.message);
            break;
          }
          if (queue.removeRequested || queue.latest) continue;
          syncQueue.set(id, 'ok');
          if (typeof renderSyncBadge === 'function') renderSyncBadge();
        }
      } finally {
        queue.running = false;
        const isCurrentQueue = cloudWriteQueues.get(id) === queue;
        if (isCurrentQueue && !queue.latest && !queue.removeRequested) cloudWriteQueues.delete(id);
        else if (isCurrentQueue && !failed && sessionIdentity() === queue.identity) runCloudWriteQueue(id, queue);
        else if (isCurrentQueue && failed && queue.removeRequested && sessionIdentity() === queue.identity) runCloudWriteQueue(id, queue);
      }
    })();
  }
  function pushCloud(id, op, state, title, revision) {
    if (!cloudEnabled() || !id) return;
    const identity = sessionIdentity();
    const queue = cloudWriteQueues.get(id) || { identity, latest: null, removeRequested: false, running: false };
    queue.identity = identity;
    queue.removeRequested = false;
    queue.latest = { op: op === 'create' ? 'create' : 'save', state, title: title || '', revision: Number.isInteger(revision) ? revision : undefined };
    cloudWriteQueues.set(id, queue);
    syncQueue.set(id, 'pending');
    if (typeof renderSyncBadge === 'function') renderSyncBadge();
    runCloudWriteQueue(id, queue);
  }
  function removeCloud(id) {
    if (!cloudEnabled() || !id) return;
    const identity = sessionIdentity();
    const queue = cloudWriteQueues.get(id) || { identity, latest: null, removeRequested: false, running: false };
    queue.identity = identity;
    queue.latest = null;
    queue.removeRequested = true;
    cloudWriteQueues.set(id, queue);
    syncQueue.set(id, 'pending');
    if (typeof renderSyncBadge === 'function') renderSyncBadge();
    runCloudWriteQueue(id, queue);
  }
  // 云端状态徽章：显示「本地 / 已登录 / 同步中 / 已同步 / 同步失败」
  function renderSyncBadge() {
    const el = $('cloudStatusText'); if (!el) return;
    if (!cloudEnabled()) { el.textContent = '本地'; el.parentElement.title = '未登录，仅本地保存（登录后自动同步云端）'; return; }
    let hasPending = false, hasError = false, hasOk = false;
    syncQueue.forEach(v => { if (v === 'pending') hasPending = true; else if (v === 'error') hasError = true; else hasOk = true; });
    if (cloudConflicts.size) { el.textContent = '需处理冲突'; el.parentElement.title = '本地与云端版本不同，点击此处选择保留本地或使用云端版本。'; }
    else if (hasError) { el.textContent = '同步失败'; el.parentElement.title = '云端同步出错，本地已保存。点击「⟳ 同步」重试。'; }
    else if (hasPending) { el.textContent = '同步中…'; el.parentElement.title = '正在向云端推送本次修改'; }
    else if (hasOk) { el.textContent = '已同步'; el.parentElement.title = '云端已同步（最近一次保存）'; }
    else { el.textContent = '已登录'; el.parentElement.title = '已登录 · 云端存储可用'; }
  }

  async function openCloudConflict(id) {
    const conflict = cloudConflicts.get(id);
    if (!conflict) return;
    let detail;
    try {
      detail = await novelApi.get(id);
    } catch (error) {
      toast('无法读取云端版本：' + error.message);
      return;
    }
    const remote = detail && detail.novel;
    if (!remote || !remote.state) { toast('云端版本不存在，下一次保存会重新创建'); cloudConflicts.delete(id); renderSyncBadge(); return; }
    const localJob = conflict.local || { state: novels[id], title: (novels[id] && novels[id].title) || '未命名小说' };
    const localState = localJob.state || novels[id] || {};
    const localText = JSON.stringify(localState, null, 2).slice(0, 5000);
    const remoteText = JSON.stringify(remote.state, null, 2).slice(0, 5000);
    const modal = openModal(
      '<h3 class="ml-modal__title">处理云端版本冲突</h3>' +
      '<p class="ml-modal__hint">《' + esc(localJob.title || remote.title || '小说') + '》在其他设备有更新。请选择一个版本，当前不会自动覆盖任何一方。</p>' +
      '<div class="cloud-conflict-meta"><span>本地版本：' + esc(new Date(conflict.detectedAt || Date.now()).toLocaleString('zh-CN')) + '</span><span>云端版本：' + esc(new Date(remote.updatedAt || Date.now()).toLocaleString('zh-CN')) + ' · 修订 ' + esc(remote.revision) + '</span></div>' +
      '<div class="cloud-conflict-diff"><div><strong>本地快照</strong><pre>' + esc(localText) + '</pre></div><div><strong>云端快照</strong><pre>' + esc(remoteText) + '</pre></div></div>' +
      '<div class="ml-modal__actions"><button class="tv-btn tv-btn--ghost" data-cloud-action="remote" type="button">使用云端版本</button><button class="tv-btn tv-btn--primary" data-cloud-action="local" type="button">保留本地并覆盖云端</button><button class="tv-btn tv-btn--ghost" data-cloud-action="close" type="button">稍后处理</button></div>',
      { wide: true }
    );
    const action = modal.querySelector('[data-cloud-action]');
    modal.querySelectorAll('[data-cloud-action]').forEach(button => button.onclick = async () => {
      const choice = button.dataset.cloudAction;
      if (choice === 'close') return closeModal();
      if (choice === 'remote') {
        novels[id] = remote.state;
        normalizeNovelState(novels[id]);
        cloudRevisions.set(id, Number(remote.revision) || 0);
        cloudConflicts.delete(id); syncQueue.delete(id);
        try { localStorage.setItem(LS_NOVELS, JSON.stringify(novels)); } catch (_) {}
        if (currentId === id) { state = novels[id]; renderTree(); renderEditor(); }
        renderSyncBadge(); closeModal(); toast('已使用云端版本，本地草稿已替换');
      } else if (choice === 'local') {
        cloudRevisions.set(id, Number(remote.revision) || 0);
        cloudConflicts.delete(id); syncQueue.set(id, 'pending');
        const queue = cloudWriteQueues.get(id) || { identity: storageIdentity(), latest: null, removeRequested: false, running: false };
        queue.latest = { op: 'save', state: localState, title: localJob.title || localState.title || '', revision: Number(remote.revision) || 0 };
        queue.removeRequested = false; cloudWriteQueues.set(id, queue); runCloudWriteQueue(id, queue);
        renderSyncBadge(); closeModal(); toast('已提交本地版本覆盖云端');
      }
    });
    if (action) action.focus();
  }

  // 首次同步：登录后调用，把所有本地小说 POST 到云端
  async function firstSyncToCloud() {
    if (!cloudEnabled()) return { ok: false, count: 0 };
    const requestIdentity = sessionIdentity();
    const ids = Object.keys(novels).filter(id => novels[id]);
    if (!ids.length) return { ok: true, count: 0 };
    let ok = 0, fail = 0;
    for (const id of ids) {
      if (sessionIdentity() !== requestIdentity) return { ok: false, count: ok, fail, cancelled: true };
      const st = novels[id];
      try {
        const result = await novelApi.create(id, st, st.title || '未命名小说');
        if (result && Number.isInteger(result.revision)) cloudRevisions.set(id, result.revision);
        ok++;
      }
      catch (e) { fail++; }
    }
    if (sessionIdentity() !== requestIdentity) return { ok: false, count: ok, fail, cancelled: true };
    return { ok: true, count: ok, fail };
  }
  // 从云端拉取覆盖本地：用于「☁️ 同步」按钮
  async function pullFromCloud() {
    if (!cloudEnabled()) return { ok: false, error: '未登录' };
    const requestIdentity = sessionIdentity();
    const r = await novelApi.list();
    if (sessionIdentity() !== requestIdentity) return { ok: false, cancelled: true };
    if (!r.ok) throw new Error('列表拉取失败');
    const remote = r.novels || [];
    let loaded = 0;
    const nextNovels = { ...novels };
    for (const meta of remote) {
      if (sessionIdentity() !== requestIdentity) return { ok: false, cancelled: true };
      try {
        const detail = await novelApi.get(meta.id);
        if (sessionIdentity() !== requestIdentity) return { ok: false, cancelled: true };
        if (detail && detail.ok && detail.novel && detail.novel.state) {
          if (Number.isInteger(detail.novel.revision)) cloudRevisions.set(meta.id, detail.novel.revision);
          // 以远端为权威；若本地有更新（updatedAt 更晚），跳过覆盖
          const local = nextNovels[meta.id];
          const remoteUpdated = detail.novel.updatedAt || 0;
          if (!local || (local.updatedAt || 0) <= remoteUpdated) {
            nextNovels[meta.id] = detail.novel.state;
            loaded++;
          }
        }
      } catch (_) {}
    }
    if (sessionIdentity() !== requestIdentity) return { ok: false, cancelled: true };
    novels = nextNovels;
    try { localStorage.setItem(LS_NOVELS, JSON.stringify(novels)); } catch (_) {}
    return { ok: true, loaded, total: remote.length };
  }

  function toast(msg) {
    let t = $('mlToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'mlToast';
      t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,.25);opacity:0;transition:opacity .2s;pointer-events:none;max-width:80vw;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity = '0'; }, 2200);
  }

  let importProgressTimer = null;
  function setImportProgress(percent, title, detail) {
    const box = $('importProgress');
    if (!box) return;
    const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
    const bar = box.querySelector('.ml-import-progress__bar');
    const pct = box.querySelector('.ml-import-progress__pct');
    const titleEl = box.querySelector('.ml-import-progress__title');
    const detailEl = box.querySelector('.ml-import-progress__detail');
    box.hidden = false;
    box.classList.remove('is-error', 'is-done');
    if (bar) bar.style.width = value + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(value));
    if (pct) pct.textContent = value + '%';
    if (titleEl) titleEl.textContent = title || '正在导入';
    if (detailEl) detailEl.textContent = detail || '';
    clearTimeout(importProgressTimer);
  }
  function startImportProgress(title) {
    clearTimeout(importProgressTimer);
    setImportProgress(0, title || '正在导入', '准备读取文件…');
  }
  function finishImportProgress(title, detail, isError) {
    const box = $('importProgress');
    if (!box) return;
    setImportProgress(isError ? 100 : 100, title || (isError ? '导入失败' : '导入完成'), detail || '');
    box.classList.toggle('is-error', !!isError);
    box.classList.toggle('is-done', !isError);
    importProgressTimer = setTimeout(() => { box.hidden = true; }, isError ? 6000 : 3600);
  }
  function importProgressStep(base, span, current, total, title, detail) {
    const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 1;
    setImportProgress(base + span * ratio, title, detail);
  }

  // 字数统计：CJK 按字计，拉丁按词计
  function countWords(html) {
    const text = (html || '').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ');
    const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
    const latin = (text.replace(/[一-鿿㐀-䶿]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    return cjk + latin;
  }
  function htmlToText(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\n{2,}/g, '\n').trim();
  }
  const SAFE_EDITOR_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'CODE', 'A', 'IMG', 'HR', 'DIV', 'SPAN']);
  const BLOCKED_EDITOR_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'META', 'LINK', 'SVG', 'MATH']);
  function isSafeEditorUrl(value, kind) {
    const url = String(value || '').trim();
    if (!url || /^(?:javascript|vbscript|data):/i.test(url)) return false;
    if (kind === 'image') return /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|avif);base64,)/i.test(url) && !/^\/\//.test(url);
    return /^(?:https?:\/\/|mailto:|#|\/(?!\/)|\.\.?\/)/i.test(url) && !/^\/\//.test(url);
  }
  function sanitizeEditorHtml(html) {
    const source = document.createElement('template');
    source.innerHTML = String(html || '');
    const output = document.createElement('template');
    const append = (parent, node) => {
      if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.nodeValue || '')); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toUpperCase();
      if (BLOCKED_EDITOR_TAGS.has(tag)) return;
      if (!SAFE_EDITOR_TAGS.has(tag)) {
        Array.from(node.childNodes).forEach(child => append(parent, child));
        return;
      }
      if (tag === 'IMG' && !isSafeEditorUrl(node.getAttribute('src'), 'image')) return;
      if (tag === 'A' && !isSafeEditorUrl(node.getAttribute('href'), 'link')) {
        Array.from(node.childNodes).forEach(child => append(parent, child));
        return;
      }
      const clean = document.createElement(tag.toLowerCase());
      if (tag === 'A') {
        clean.setAttribute('href', node.getAttribute('href').trim());
        clean.setAttribute('target', '_blank');
        clean.setAttribute('rel', 'noopener noreferrer');
      } else if (tag === 'IMG') {
        clean.setAttribute('src', node.getAttribute('src').trim());
        clean.setAttribute('alt', String(node.getAttribute('alt') || '插图').slice(0, 200));
        if (node.classList.contains('scene-img')) clean.className = 'scene-img';
      } else if (tag === 'P' && node.classList.contains('scene-sep')) {
        clean.className = 'scene-sep';
      }
      Array.from(node.childNodes).forEach(child => append(clean, child));
      parent.appendChild(clean);
    };
    Array.from(source.content.childNodes).forEach(node => append(output.content, node));
    return output.innerHTML;
  }
  function markdownInlineToHtml(value) {
    let source = String(value || '');
    const code = [];
    source = source.replace(/`([^`\n]+)`/g, (_, text) => {
      const id = code.push('<code>' + esc(text) + '</code>') - 1;
      return '\u0000CODE' + id + '\u0000';
    });
    source = esc(source);
    source = source.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
      return isSafeEditorUrl(url, 'image') ? '<img src="' + esc(url) + '" alt="' + alt + '">' : alt;
    });
    source = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      return isSafeEditorUrl(url, 'link') ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label;
    });
    source = source.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    source = source.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    source = source.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    source = source.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    source = source.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    return source.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)] || '');
  }
  function markdownToSafeHtml(markdown) {
    let raw = String(markdown || '').replace(/\r\n?/g, '\n').trim();
    raw = raw.replace(/^```(?:markdown|md|text|txt)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    if (!raw) return '';
    const lines = raw.split('\n');
    const out = [];
    let paragraph = [];
    let listType = '';
    let quote = [];
    const closeList = () => {
      if (!listType) return;
      out.push('<' + listType + '>' + paragraph.join('') + '</' + listType + '>');
      paragraph = [];
      listType = '';
    };
    const closeParagraph = () => {
      if (!paragraph.length) return;
      out.push('<p>' + paragraph.map(markdownInlineToHtml).join('<br>') + '</p>');
      paragraph = [];
    };
    const closeQuote = () => {
      if (!quote.length) return;
      out.push('<blockquote>' + quote.map(markdownInlineToHtml).join('<br>') + '</blockquote>');
      quote = [];
    };
    lines.forEach(line => {
      const text = String(line || '').trim();
      const heading = text.match(/^(#{1,4})\s+(.+)$/);
      const unordered = text.match(/^[-*+]\s+(.+)$/);
      const ordered = text.match(/^\d+[.)]\s+(.+)$/);
      const quoteLine = text.match(/^>\s?(.*)$/);
      if (!text) { closeList(); closeParagraph(); closeQuote(); return; }
      if (heading) {
        closeList(); closeParagraph(); closeQuote();
        const level = Math.min(4, heading[1].length);
        out.push('<h' + level + '>' + markdownInlineToHtml(heading[2]) + '</h' + level + '>');
        return;
      }
      if (/^(?:---+|\*\*\*+|___+)$/.test(text)) { closeList(); closeParagraph(); closeQuote(); out.push('<hr>'); return; }
      if (quoteLine) { closeList(); closeParagraph(); quote.push(quoteLine[1]); return; }
      closeQuote();
      if (unordered || ordered) {
        const nextType = unordered ? 'ul' : 'ol';
        if (listType && listType !== nextType) closeList();
        if (!listType) closeParagraph();
        listType = nextType;
        paragraph.push('<li>' + markdownInlineToHtml((unordered || ordered)[1]) + '</li>');
        return;
      }
      closeList();
      paragraph.push(text);
    });
    closeList(); closeParagraph(); closeQuote();
    return sanitizeEditorHtml(out.join(''));
  }
  function looksLikeEditorHtml(value) {
    return /<(?:p|br|strong|b|em|i|u|s|h[1-4]|blockquote|ul|ol|li|pre|code|a|img|hr|div|span)\b/i.test(String(value || ''));
  }
  function containsMarkdownSyntax(value) {
    const text = String(value || '');
    return /(?:^|\n)\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\x60[^\x60\n]+\x60/.test(text);
  }
  function editorMarkupText(value) {
    const holder = document.createElement('div');
    holder.innerHTML = String(value || '');
    holder.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode('\n')));
    holder.querySelectorAll('p,div,h1,h2,h3,h4,blockquote,li,pre').forEach(node => {
      node.appendChild(document.createTextNode('\n'));
    });
    return String(holder.textContent || '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  function usableTitle(value) {
    const text = String(value || '').trim();
    return text && !/^[\s、，。.!！?？…·—_\-]+$/.test(text) ? text : '';
  }
  function normalizeSceneContent(content) {
    const raw = String(content || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return '';
    if (!looksLikeEditorHtml(raw)) return markdownToSafeHtml(raw);
    const safe = sanitizeEditorHtml(raw);
    // Older imports sometimes wrapped Markdown in <p> tags, so checking only
    // for HTML would leave headings and emphasis visible in the manuscript.
    const plain = editorMarkupText(safe);
    return containsMarkdownSyntax(plain) ? markdownToSafeHtml(plain) : safe;
  }
  function normalizeNovelState(novel) {
    if (!novel || typeof novel !== 'object') return false;
    let changed = false;
    if (!usableTitle(novel.title)) { novel.title = '未命名小说'; changed = true; }
    if (!novel.outline || typeof novel.outline !== 'object') { novel.outline = {}; changed = true; }
    if (!novel.outline.book || typeof novel.outline.book !== 'object') { novel.outline.book = {}; changed = true; }
    if (!usableTitle(novel.outline.book.title)) { novel.outline.book.title = novel.title; changed = true; }
    if (!Array.isArray(novel.volumes)) { novel.volumes = []; changed = true; }
    novel.volumes.forEach((volume, volumeIndex) => {
      if (!volume || typeof volume !== 'object') return;
      if (!usableTitle(volume.title)) { volume.title = '第' + (volumeIndex + 1) + '卷'; changed = true; }
      if (!Array.isArray(volume.chapters)) { volume.chapters = []; changed = true; }
      volume.chapters.forEach((chapter, chapterIndex) => {
        if (!chapter || typeof chapter !== 'object') return;
        if (!usableTitle(chapter.title)) { chapter.title = '第' + (chapterIndex + 1) + '章'; changed = true; }
        if (!Array.isArray(chapter.scenes)) { chapter.scenes = []; changed = true; }
        chapter.scenes.forEach((scene, sceneIndex) => {
          if (!scene || typeof scene !== 'object') return;
          if (!usableTitle(scene.name)) { scene.name = '场景' + (sceneIndex + 1); changed = true; }
          const next = normalizeSceneContent(scene.content);
          if (next !== String(scene.content || '')) { scene.content = next; changed = true; }
        });
        if (!chapter.scenes.length) { chapter.scenes.push({ id: uid('s'), name: '场景一', content: '' }); changed = true; }
      });
    });
    if (novel._formatVersion !== 3) { novel._formatVersion = 3; changed = true; }
    return changed;
  }
  function nowTime() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------------- 平台模型（SaaS 统一托管，密钥仅服务端） ---------------- */
  let PLATFORM_MODELS = [];
  let SERVER_USER_ROLE = 'guest';
  let SERVER_DEFAULT_MODEL = 'gpt-5.6-luna';
  let SERVER_CAN_CHOOSE_MODEL = false;
  function platformModelById(id) { return PLATFORM_MODELS.find(m => m.id === String(id)) || null; }
  function effectiveModel(id) {
    const requested = SERVER_CAN_CHOOSE_MODEL ? id : SERVER_DEFAULT_MODEL;
    return mapModel(requested || 'gpt-5.6-luna');
  }
  const EDITOR_OUTPUT_RESERVE_TOKENS = 8192;
  const EDITOR_FIXED_CONTEXT_RESERVE_TOKENS = 12000;
  const EDITOR_CONTEXT_SAFETY_TOKENS = 512;
  const EDITOR_CORRECTION_POLICY_RESERVE_TOKENS = 1200;
  const EDITOR_DEFAULT_CONTEXT_WINDOW_TOKENS = 32768;
  function contextWindowForModel(modelId) {
    const pm = platformModelById(modelId);
    const value = Number(pm && pm.contextWindowTokens);
    return Number.isFinite(value) && value >= 4096 ? Math.floor(value) : EDITOR_DEFAULT_CONTEXT_WINDOW_TOKENS;
  }
  function editorTextTokenUpperBound(value) {
    const text = String(value == null ? '' : value);
    let tokens = 0;
    let asciiRun = 0;
    const flushAscii = () => {
      if (!asciiRun) return;
      tokens += Math.ceil(asciiRun / 2);
      asciiRun = 0;
    };
    for (const ch of text) {
      const code = ch.codePointAt(0) || 0;
      if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
        asciiRun += 1;
        continue;
      }
      flushAscii();
      if (/\s/u.test(ch)) tokens += 0.5;
      else if ((code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xf900 && code <= 0xfaff) || (code >= 0x3040 && code <= 0x30ff) ||
        (code >= 0xac00 && code <= 0xd7af)) tokens += 1.5;
      else if (code > 0xffff) tokens += 2;
      else tokens += 1;
    }
    flushAscii();
    return Math.max(0, Math.ceil(tokens));
  }
  function editorPromptTokenUpperBound(value) {
    return 16 + editorTextTokenUpperBound(value);
  }
  function fixedPromptTokenEstimate(base) {
    const fallback = EDITOR_FIXED_CONTEXT_RESERVE_TOKENS + EDITOR_CORRECTION_POLICY_RESERVE_TOKENS;
    if (!String(base || '').trim() || typeof buildSkillBlock !== 'function' || typeof buildMaterialBlock !== 'function') return fallback;
    const skill = buildSkillBlock(base);
    const material = buildMaterialBlock();
    const role = typeof rolePrefix === 'function' ? rolePrefix() : '';
    return editorPromptTokenUpperBound(role + '\n' + skill + (material ? '\n\n' + material : '')) + EDITOR_CORRECTION_POLICY_RESERVE_TOKENS;
  }
  function contextBudgetLimitForModel(modelId, base) {
    const dynamicTailTokens = typeof inspirationBlock === 'function' ? editorPromptTokenUpperBound(inspirationBlock()) : 0;
    const availableTokens = contextWindowForModel(modelId) - EDITOR_OUTPUT_RESERVE_TOKENS -
      fixedPromptTokenEstimate(base) - dynamicTailTokens - EDITOR_CONTEXT_SAFETY_TOKENS;
    return Math.max(0, Math.floor(availableTokens / 1.5));
  }
  function formatContextWindow(tokens) {
    const value = Number(tokens);
    if (!Number.isFinite(value) || value <= 0) return '未知';
    return value >= 1000 ? (Math.round(value / 100) / 10) + 'K token' : Math.floor(value) + ' token';
  }
  function currentUnifiedModel() {
    const configured = state && state.settings && state.settings.models && state.settings.models.default;
    return effectiveModel(configured || SERVER_DEFAULT_MODEL || 'gpt-5.6-luna');
  }
  function currentAIPanelModel() {
    return currentUnifiedModel();
  }
  function reasoningOptionsForModel(pm) {
    if (!pm || !pm.supportsReasoning) return [];
    const official = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    if (Array.isArray(pm.reasoningEfforts) && pm.reasoningEfforts.length) return pm.reasoningEfforts.filter(v => official.includes(v));
    const model = String(pm.model || pm.id || '').toLowerCase();
    if (/gpt-5\.6/.test(model)) return official;
    if (/gpt-5\.(2|4|5)/.test(model)) return ['none', 'low', 'medium', 'high', 'xhigh'];
    return ['none', 'low', 'medium', 'high'];
  }
  async function loadPlatformModels() {
    try {
      const headers = {};
      const token = getToken();
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch(API_BASE + '/api/models', { method: 'GET', headers, cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        if (j && Array.isArray(j.models)) PLATFORM_MODELS = j.models;
        if (j && j.access) {
          SERVER_USER_ROLE = String(j.access.role || 'guest');
          SERVER_DEFAULT_MODEL = String(j.access.defaultModel || SERVER_DEFAULT_MODEL);
          SERVER_CAN_CHOOSE_MODEL = j.access.canChooseModel === true;
        }
      }
    } catch (_) {}
    if (!PLATFORM_MODELS.length) {
      // UI 兜底（不含任何密钥信息）
      PLATFORM_MODELS = [
        {id:'deepseek-v4-flash',name:'DeepSeek V4 极速',group:'deepseek',provider:'deepseek',supportsThinking:true,contextWindowTokens:65536},
        {id:'deepseek-v4-pro',name:'DeepSeek V4 深度思考',group:'deepseek',provider:'deepseek',supportsThinking:true,contextWindowTokens:65536},
        {id:'gpt-5.6-sol',name:'GPT-5.6 Sol',group:'gpt',provider:'openai-compat',supportsReasoning:true,contextWindowTokens:32768},
        {id:'gpt-5.6-terra',name:'GPT-5.6 Terra',group:'gpt',provider:'openai-compat',supportsReasoning:true,contextWindowTokens:32768},
        {id:'gpt-5.6-luna',name:'GPT-5.6 Luna',group:'gpt',provider:'openai-compat',supportsReasoning:true,contextWindowTokens:32768},
        {id:'gpt-5.5',name:'GPT-5.5',group:'gpt',provider:'openai-compat',supportsReasoning:true,contextWindowTokens:32768},
        {id:'gpt-5.4',name:'GPT-5.4',group:'gpt',provider:'openai-compat',supportsReasoning:true,contextWindowTokens:32768},
        {id:'gpt-5.4-mini',name:'GPT-5.4 Mini',group:'gpt',provider:'openai-compat',supportsReasoning:true,contextWindowTokens:32768},
        {id:'gpt-5.2',name:'GPT-5.2',group:'gpt',provider:'openai-compat',supportsReasoning:true,contextWindowTokens:32768}
      ];
    }
    renderModelSelectOptions();
    applyModelAccessUI();
  }
  let modelAccessRefreshPromise = null;
  function refreshModelAccessList() {
    if (modelAccessRefreshPromise) return modelAccessRefreshPromise;
    modelAccessRefreshPromise = loadPlatformModels().finally(() => { modelAccessRefreshPromise = null; });
    return modelAccessRefreshPromise;
  }
  // 服务端积分（权威）；客户端仅作展示
  let SERVER_CREDITS = null;
  let SERVER_IS_ADMIN = false;
  let LIVE_BILLING = null;
  let CONTEXT_NOTICE_SHOWN = false;
  function updateLiveBilling(billing) {
    if (!billing || typeof billing !== 'object') return;
    const previousStatus = LIVE_BILLING && LIVE_BILLING.status;
    LIVE_BILLING = billing;
    if (typeof billing.remainingCredits === 'number') SERVER_CREDITS = billing.remainingCredits;
    updateCreditBadge();
    if (billing.status === 'credit_exhausted' && previousStatus !== 'credit_exhausted') toast('\u79ef\u5206\u5df2\u8017\u5c3d\uff0c\u5df2\u4e2d\u65ad\u672c\u6b21\u751f\u6210');
    if (billing.dynamicPromptTruncated && !CONTEXT_NOTICE_SHOWN) {
      CONTEXT_NOTICE_SHOWN = true;
      toast('当前模型窗口有限，已保留完整 Skill 和素材，并压缩作品动态上下文');
    }
  }
  function clearLiveBilling() { LIVE_BILLING = null; CONTEXT_NOTICE_SHOWN = false; updateCreditBadge(); }
  function normalizeClientUserRole(user) {
    if (!user || typeof user !== 'object') return 'normal';
    if (user.isAdmin === true) return 'admin';
    const roles = [user.role, user.level, user.plan].map(value => String(value || '').trim().toLowerCase());
    if (roles.some(value => value === 'admin' || value === 'administrator')) return 'admin';
    if (roles.some(value => value === 'vip' || value === 'premium')) return 'vip';
    return 'normal';
  }
  async function refreshServerCredits() {
    const tk = getToken();
    if (!tk) {
      const accessChanged = SERVER_USER_ROLE !== 'guest' || SERVER_CAN_CHOOSE_MODEL;
      SERVER_USER_ROLE = 'guest';
      SERVER_CAN_CHOOSE_MODEL = false;
      SERVER_CREDITS = null;
      SERVER_IS_ADMIN = false;
      applyModelAccessUI();
      updateCreditBadge();
      if (accessChanged) refreshModelAccessList();
      return;
    }
    const requestIdentity = storageIdentity();
    try {
      const res = await fetch(API_BASE + '/api/auth/me', { headers: { 'Authorization': 'Bearer ' + tk }, cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        if (storageIdentity() !== requestIdentity) return;
        if (j && j.user) {
          const previousRole = SERVER_USER_ROLE;
          const previousCanChooseModel = SERVER_CAN_CHOOSE_MODEL;
          SERVER_USER_ROLE = normalizeClientUserRole(j.user);
          SERVER_CAN_CHOOSE_MODEL = SERVER_USER_ROLE === 'vip' || SERVER_USER_ROLE === 'admin';
          SERVER_IS_ADMIN = SERVER_USER_ROLE === 'admin';
          SERVER_CREDITS = (typeof j.user.credits === 'number') ? j.user.credits : null;
          applyModelAccessUI();
          updateCreditBadge();
          if (previousRole !== SERVER_USER_ROLE || previousCanChooseModel !== SERVER_CAN_CHOOSE_MODEL) refreshModelAccessList();
        }
      } else if (res.status === 401) {
        // 令牌失效（如本次部署前遗留的旧会话，或 token 被服务端清除）→ 清理本地态并引导重新登录
        try { localStorage.removeItem('ml_token'); localStorage.removeItem('ml_user'); } catch (_) {}
        toast('登录状态已失效，即将返回首页重新登录…');
        setTimeout(function () { location.href = '../index.html'; }, 1500);
      }
    } catch (_) {}
  }
  function updateCreditBadge() {
    const el = document.getElementById('creditText');
    if (!el) return;
    if (SERVER_IS_ADMIN) { el.textContent = '\u221e \u79ef\u5206'; return; }
    if (SERVER_CREDITS == null) { el.textContent = '\u2014'; return; }
    if (LIVE_BILLING && Number.isFinite(Number(LIVE_BILLING.estimatedCreditCost))) {
      el.textContent = '\u4f59\u989d ' + SERVER_CREDITS.toFixed(2) + ' \u00b7 \u672c\u6b21 ' + Number(LIVE_BILLING.estimatedCreditCost).toFixed(2);
      el.title = LIVE_BILLING.status === 'credit_exhausted' ? '\u672c\u6b21\u751f\u6210\u5df2\u8fbe\u5230\u79ef\u5206\u9884\u7b97\u4e0a\u9650' : '\u672c\u6b21\u751f\u6210\u6b63\u5728\u5b9e\u65f6\u8ba1\u91cf';
    } else {
      el.textContent = SERVER_CREDITS.toFixed(2) + ' \u79ef\u5206';
      el.title = '';
    }
  }
  function selectablePlatformModels() {
    const models = PLATFORM_MODELS.filter(model => model && model.id);
    if (SERVER_CAN_CHOOSE_MODEL) return models;
    const defaultModel = models.find(model => String(model.id) === String(SERVER_DEFAULT_MODEL));
    return defaultModel ? [defaultModel] : models.slice(0, 1);
  }
  function renderModelSelectOptions() {
    const models = selectablePlatformModels();
    const current = currentUnifiedModel();
    const selected = models.some(model => String(model.id) === String(current))
      ? current
      : (models[0] && models[0].id) || current;
    document.querySelectorAll('#aiModelSelectInner, [data-model-role]').forEach(select => {
      select.innerHTML = models.map(model => '<option value="' + esc(model.id) + '" title="上下文窗口约 ' + esc(formatContextWindow(contextWindowForModel(model.id))) + '">' + esc(model.name || model.id) + '</option>').join('');
      select.value = selected;
      select.disabled = !SERVER_CAN_CHOOSE_MODEL;
      select.setAttribute('aria-disabled', SERVER_CAN_CHOOSE_MODEL ? 'false' : 'true');
    });
  }
  function applyModelAccessUI() {
    const locked = !SERVER_CAN_CHOOSE_MODEL;
    const modelBtn = $('aiModelSelect');
    if (modelBtn) {
      modelBtn.disabled = locked;
      modelBtn.setAttribute('aria-disabled', locked ? 'true' : 'false');
      modelBtn.classList.toggle('is-locked', locked);
      const arrow = modelBtn.querySelector('svg');
      if (arrow) arrow.hidden = locked;
    }
    document.querySelectorAll('[data-model-role]').forEach(select => {
      select.disabled = locked;
      select.title = locked ? '普通用户使用平台默认模型' : '为当前账户设置模型';
    });
    const innerModelSelect = $('aiModelSelectInner');
    if (innerModelSelect) {
      innerModelSelect.disabled = locked;
      innerModelSelect.setAttribute('aria-disabled', locked ? 'true' : 'false');
      innerModelSelect.title = locked ? '普通用户使用平台默认模型' : '为当前账户设置模型';
    }
    renderModelSelectOptions();
    const hint = $('modelAccessHint');
      if (hint) hint.textContent = (locked ? '普通用户使用平台默认模型，VIP 用户可独立选择模型。' : '当前账户可以独立选择模型，选择只影响当前账户。') + ' 当前窗口约 ' + formatContextWindow(contextWindowForModel(currentUnifiedModel())) + '。';
  }
  function switchUnifiedModel(modelId) {
    if (!SERVER_CAN_CHOOSE_MODEL) {
      renderModelSelectOptions();
      toast('普通用户使用平台默认模型');
      return;
    }
    const next = platformModelById(modelId) ? String(modelId) : String(SERVER_DEFAULT_MODEL);
    state.settings = state.settings || {};
    state.settings.models = state.settings.models || {};
    state.settings.models.default = next;
    state.settings.models.continuation = next;
    state.settings.models.polish = next;
    rememberSelectedModel(next);
    save();
    renderModelSelectOptions();
    updateModelBadges();
    renderThinkControl();
    renderPlotContext();
    const requestedBudget = Number(state.settings.contextBudget);
    const effectiveBudget = currentContextBudget();
    if (Number.isFinite(requestedBudget) && requestedBudget > effectiveBudget) {
      toast('已按 ' + formatContextWindow(contextWindowForModel(next)) + ' 上下文窗口，将作品动态上下文限制为约 ' + effectiveBudget + ' 字');
    }
  }
  function mapModel(m) {
    m = (m || '').toLowerCase();
    if (platformModelById(m)) return m;   // 平台 ID 直接透传，避免 deepseek-v4-pro 被误判为 Flash
    if (!m) return 'gpt-5.6-luna';
    if (m === 'v4-flash' || m.includes('flash') || m.includes('deepseek') || m.includes('chat')) return 'deepseek-v4-flash';
    if (m === 'v4-pro' || m.includes('pro') || m.includes('r1') || m.includes('reason')) return 'deepseek-v4-pro';
    return 'gpt-5.6-luna';
  }

  async function copyTextToClipboard(value) {
    const text = String(value || '');
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    let textarea;
    let selection;
    let selectedRange;
    try {
      textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      selection = document.getSelection ? document.getSelection() : null;
      selectedRange = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      return document.execCommand('copy');
    } catch (_) {
      return false;
    } finally {
      if (textarea && textarea.parentNode) textarea.parentNode.removeChild(textarea);
      if (selection && selectedRange) {
        try { selection.removeAllRanges(); selection.addRange(selectedRange); } catch (_) {}
      }
    }
  }

  /* ---------------- SSE 流式调用（与 app.js 一致） ---------------- */
  async function streamChat(payload, handlers) {
    let controller;
    let usage = null;
    let finishReason = null;
    let streamedText = '';
    const requestIdentity = sessionIdentity();
    const isCurrentAccount = () => sessionIdentity() === requestIdentity;
    const readableNetworkError = error => {
      const raw = String(error && error.message || error || '').trim();
      if (location.protocol === 'file:') return '本地页面无法连接创作服务，请先启动 node server.js 后重试';
      if (/failed to fetch|networkerror|load failed|fetch/i.test(raw)) return 'AI 服务连接中断，请检查网络或稍后重试';
      return raw || 'AI 服务连接失败，请稍后重试';
    };
    try {
      controller = new AbortController();
      if (handlers && handlers.onStart) handlers.onStart(controller);
      await skillsReady;
      if (!isCurrentAccount()) return;
      await skillSyncReady;
      if (!isCurrentAccount()) return;
      const body = Object.assign({}, payload, { max_tokens: payload.max_tokens || 8192 });
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
      const incompleteSkills = activeSkillIds.filter(id => {
        const skill = skillsMap[id];
        return !skill || skill.complete === false || !promptInstructionForSkill(skill);
      });
      if (activeSkillIds.length && (skillsLoadError || incompleteSkills.length)) {
        throw new Error('Skill 尚未完整加载或云端同步未完成，请稍后重试');
      }
      // SaaS：只传 model（平台 id），不传 source/apiKey（密钥在服务端统一托管，用户无法自带 key 绕过计费）
      body.messages = injectSelectedSkillBlocks(body.messages, skillMode);
      body.skillAudit = buildSkillAuditPayload(skillMode);
      // 所有 AI 入口共用右侧栏当前模型，避免续写、抽取、检测等功能与对话模型分叉。
      body.model = currentUnifiedModel();
      const modelMeta = platformModelById(body.model);
      if (modelMeta && modelMeta.supportsReasoning) {
        if (body.reasoningEffort == null) {
          body.reasoningEffort = (state.settings && state.settings.reasoningEffort) || (skillMode === 'write' ? 'high' : '');
        }
        delete body.thinking;
      } else if (body.thinking == null && modelMeta && modelMeta.supportsThinking) {
        body.thinking = !!(state.settings && state.settings.think);
      }
      const chatHeaders = { 'Content-Type': 'application/json' };
      const chatTok = getToken(); if (chatTok) chatHeaders['Authorization'] = 'Bearer ' + chatTok;
      if (!isCurrentAccount()) return;
      const res = await fetch(API_BASE + '/api/chat', {
        method: 'POST', headers: chatHeaders,
        body: JSON.stringify(body), signal: controller.signal
      });
      if (!res.ok) {
        let em = '服务错误 ' + res.status;
        let errorCode = '';
        let errorMeta = {};
        try {
          const j = await res.json();
          if (j && j.error) em = j.error;
          if (j && j.code) errorCode = String(j.code);
          if (j && typeof j === 'object') errorMeta = j;
        } catch (_) {}
        if (res.status === 401) { em = '请先登录后再使用 AI 功能'; }
        else if (res.status === 402) { em = em || '积分不足，请前往价格页充值或升级套餐'; }
        if (errorCode === 'context_window_exceeded' || res.status === 413 && /上下文|context/i.test(em)) {
          em = '当前模型上下文窗口不足，请减少作品上下文或切换模型后重试';
          if (handlers && handlers.onError) return handlers.onError(em, {
            status: res.status,
            code: 'context_window_exceeded',
            contextWindowTokens: errorMeta.contextWindowTokens,
            promptTokens: errorMeta.promptTokens,
            fixedPromptTokens: errorMeta.fixedPromptTokens,
            dynamicPromptTokens: errorMeta.dynamicPromptTokens,
            requiredOutputTokens: errorMeta.requiredOutputTokens,
            fixedPromptExceeded: !!errorMeta.fixedPromptExceeded
          });
          toast(em); return;
        }
        if (res.status === 401 || res.status === 402) {
          if (handlers && handlers.onError) return handlers.onError(em, { status: res.status, code: res.status === 402 ? 'credit_exhausted' : 'unauthorized' });
          toast(em); return;
        }
        throw new Error(em);
      }
      if (!res.body || typeof res.body.getReader !== 'function') throw new Error('AI 服务未返回流式响应');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
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
          const j = JSON.parse(data);
          if (j && j.molan_usage) {
            usage = j.molan_usage;
            setFinishReason(usage.finishReason);
            if (usage.status === 'credit_exhausted') setFinishReason('credit_exhausted');
            else if (usage.status === 'truncated') setFinishReason('length');
            else if (usage.status === 'material_overlap') setFinishReason('material_overlap');
          }
          if (j && j.molan_billing) {
            if (isCurrentAccount()) {
              updateLiveBilling(j.molan_billing);
              // Billing lifecycle values such as reserved/streaming are not
              // model finish reasons. Only an exhausted budget ends generation.
              if (j.molan_billing.status === 'credit_exhausted') finishReason = 'credit_exhausted';
              if (handlers && handlers.onBilling) handlers.onBilling(j.molan_billing);
            }
          }
          const c = j && j.choices && j.choices[0];
          setFinishReason(c && c.finish_reason);
          const d = (c && c.delta && c.delta.content) || '';
          const reasoning = c && c.delta && (c.delta.reasoning_content || c.delta.reasoning || c.delta.thinking);
          const t = typeof reasoning === 'string' ? reasoning : '';
          if (typeof d === 'string' && d) streamedText += d;
          if (isCurrentAccount() && t && handlers && handlers.onThink) handlers.onThink(t);
          if (isCurrentAccount() && d && handlers && handlers.onDelta) handlers.onDelta(d);
        } catch (_) {}
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          handleLine(line);
        }
      }
      buf += dec.decode();
      if (buf.trim()) handleLine(buf);
      if (!isCurrentAccount()) return;
      clearLiveBilling();
      refreshServerCredits();
      if (handlers.onDone) handlers.onDone(finishReason, usage);
    } catch (e) {
      if (!isCurrentAccount()) return;
      clearLiveBilling();
      refreshServerCredits();
      if (e.name === 'AbortError') { if (handlers.onDone) handlers.onDone('abort', usage); }
      else if (handlers.onError) handlers.onError(readableNetworkError(e), { code: 'network', partialText: streamedText });
      else throw e;
    }
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

  // 写作任务可先执行一次 Skill 规划，再把规划带入正文请求。分析开关
  // 由调用方明确传入，避免设定/检测类工具意外增加一轮模型调用。
  async function streamSkillPipeline(payload, handlers, options) {
    const opts = options || {};
    const mode = opts.mode || payload.skillMode || skillModeForMessages(payload.messages);
    const shouldAnalyzeSkill = opts.analyzeSkill === true && mode === 'write' && activeSkillsForMode('write').length > 0;
    const shouldHumanize = (opts.humanize === true || payload.humanize === true) && mode === 'write' && activeSkillsForMode('humanize').length > 0;
    // Every正文 task gets one universal correction pass, even when the user
    // has not selected an additional writing Skill. Non-body targets opt out.
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
        '\u8fd9\u4e00\u9636\u6bb5\u4e0d\u8981\u5199\u5c0f\u8bf4\u6b63\u6587\uff0c\u4e0d\u8981\u8f93\u51fa\u901a\u7528\u82f1\u6587\u63a8\u7406\u6458\u8981\uff0c\u53ea\u8f93\u51fa\u53ef\u6267\u884c\u7684 Skill \u5206\u6790\u3002';
      const analysisSystem = analysisMessages.find(message => message && message.role === 'system');
      if (analysisSystem) analysisSystem.content = String(analysisSystem.content || '') + analysisInstruction;
      else analysisMessages.unshift({ role: 'system', content: analysisInstruction.trim() });
      await new Promise(resolve => {
        streamChat({ ...payload, skillMode: 'write', stage: 'skill_analysis', messages: analysisMessages }, {
          onStart: controller => { handlers.onStart && handlers.onStart(controller); handlers.onStage && handlers.onStage('skill_analysis'); },
          onModel: model => handlers.onModel && handlers.onModel(model),
          onBilling: billing => handlers.onBilling && handlers.onBilling({ ...billing, pipelineStage: 'skill_analysis' }),
          onThink: text => {
            const onThink = handlers.onModelThink || handlers.onThink;
            if (onThink) onThink(text);
          },
          onDelta: text => { skillAnalysis += text; handlers.onSkillAnalysisDelta && handlers.onSkillAnalysisDelta(text); },
          onDone: (reason, usage) => { analysisResult = { reason: reason || null, usage: usage || null }; resolve(); },
          onError: (error, meta) => { analysisResult = { reason: meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', usage: null, error, meta }; resolve(); }
        });
      });
      if (analysisResult && analysisResult.usage) stages.push(analysisResult.usage);
      const analysisReason = analysisResult && analysisResult.reason;
      const analysisFailed = !analysisResult || analysisResult.error || ['abort', 'credit_exhausted', 'length'].includes(analysisReason) || !skillAnalysis.trim();
      if (analysisFailed) {
        const aggregate = mergePipelineUsage(stages, analysisReason || 'error');
        if (analysisResult && analysisResult.error) {
          handlers.onError && handlers.onError(analysisResult.error, { ...(analysisResult.meta || {}), code: analysisResult.meta && analysisResult.meta.code || 'skill_analysis_failed', skillAnalysis });
        } else if (['abort', 'credit_exhausted'].includes(analysisReason)) {
          handlers.onDone && handlers.onDone(analysisReason, aggregate);
        } else {
          handlers.onError && handlers.onError('\u0053\u006b\u0069\u006c\u006c \u5206\u6790\u672a\u8fd4\u56de\u6709\u6548\u5185\u5bb9\uff0c\u5df2\u505c\u6b62\u6b63\u6587\u751f\u6210', { code: 'skill_analysis_failed', skillAnalysis });
        }
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
        onStart: controller => { handlers.onStart && handlers.onStart(controller); handlers.onStage && handlers.onStage('writing'); },
        onModel: model => handlers.onModel && handlers.onModel(model),
        onBilling: billing => handlers.onBilling && handlers.onBilling({ ...billing, pipelineStage: 'writing' }),
        onThink: text => handlers.onThink && handlers.onThink(text),
        onDraftDelta: text => handlers.onDraftDelta && handlers.onDraftDelta(text),
        onDelta: text => { draft += text; handlers.onDraftDelta && handlers.onDraftDelta(text); },
        onDone: (reason, usage) => { firstResult = { reason: reason || null, usage: usage || null }; resolve(); },
        onError: (error, meta) => { firstResult = { reason: meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', usage: null, error, meta }; resolve(); }
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

    const humanizerSystem = opts.humanizerSystem || await buildSystemReady('你是中文小说责任编辑，执行 humanizer 去 AI 味后处理。保留事实、人物关系、情节顺序和作者原意，只输出最终正文，不要解释。');
    if (!humanizerSystem) {
      if (draft && handlers.onReplaceText) handlers.onReplaceText(draft);
      else if (draft && handlers.onDelta) handlers.onDelta(draft);
      const aggregate = mergePipelineUsage(stages, 'error');
      handlers.onError && handlers.onError('humanizer Skill 尚未完整加载，已保留写作初稿', { code: 'skill_audit_failed', partialText: draft });
      return aggregate;
    }
    let finalText = '';
    let finalResult = null;
    await new Promise(resolve => {
      streamChat({
        model: payload.model,
        thinking: payload.thinking,
        reasoningEffort: payload.reasoningEffort,
        max_tokens: payload.max_tokens || 8192,
        correction: true,
        skillMode: 'humanize',
        stage: 'humanizer',
        characterMaterial: payload.characterMaterial,
        messages: [{ role: 'system', content: humanizerSystem }, { role: 'user', content: '请对以下写作初稿执行二次润色与去 AI 味。不得删减事实，不得新增未给出的设定，不要标题、解释或总结。\n\n【写作初稿】\n' + draft }]
      }, {
        onStart: controller => { handlers.onStart && handlers.onStart(controller); handlers.onStage && handlers.onStage('humanizer'); },
        onBilling: billing => handlers.onBilling && handlers.onBilling({ ...billing, pipelineStage: 'humanizer' }),
        onThink: text => handlers.onThink && handlers.onThink(text),
        onDelta: text => { finalText += text; handlers.onDelta && handlers.onDelta(text); },
        onDone: (reason, usage) => { finalResult = { reason: reason || null, usage: usage || null }; resolve(); },
        onError: (error, meta) => { finalResult = { reason: meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', usage: null, error, meta }; resolve(); }
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
    const materialBlocked = finalResult && finalResult.usage && finalResult.usage.characterMaterial && finalResult.usage.characterMaterial.blocked;
    if (!finalResult?.error && materialBlocked && payload.characterMaterial && payload.characterMaterial.proseTask === true && opts.allowMaterialRepair !== false) {
      // 强模式命中连续原句或专名时，只用规则卡再改写一次；第二次仍命中则交给调用方阻止写入。
      let repairedText = '';
      let repairResult = null;
      const repairMaterial = { ...payload.characterMaterial, mode: 'auto', enabled: true, proseTask: true };
      handlers.onStage && handlers.onStage('material_repair');
      handlers.onReplaceText && handlers.onReplaceText('');
      await new Promise(resolve => {
        streamChat({
          model: payload.model,
          thinking: payload.thinking,
          reasoningEffort: payload.reasoningEffort,
          max_tokens: payload.max_tokens || 8192,
          correction: true,
          skillMode: 'humanize',
          stage: 'humanizer',
          characterMaterial: repairMaterial,
          messages: [
            { role: 'system', content: humanizerSystem + '\n\n素材原创性审计未通过。只重写可能与参考素材重合的表达，保留事实、人物关系、情节顺序和原任务。' },
            { role: 'user', content: '请输出完整修订正文，不要解释、标题或审计报告。\n\n【待修订正文】\n' + (finalText || draft) }
          ]
        }, {
          onStart: controller => { handlers.onStart && handlers.onStart(controller); },
          onModel: model => handlers.onModel && handlers.onModel(model),
          onBilling: billing => handlers.onBilling && handlers.onBilling({ ...billing, pipelineStage: 'material_repair' }),
          onThink: text => handlers.onThink && handlers.onThink(text),
          onDelta: text => { repairedText += text; handlers.onDelta && handlers.onDelta(text); },
          onDone: (reason, usage) => { repairResult = { reason: reason || null, usage: usage || null }; resolve(); },
          onError: (error, meta) => { repairResult = { reason: 'error', usage: null, error, meta }; resolve(); }
        });
      });
      if (repairResult && repairResult.usage) stages.push(repairResult.usage);
      const repairBlocked = repairResult && repairResult.usage && repairResult.usage.characterMaterial && repairResult.usage.characterMaterial.blocked;
      const repairedAggregate = mergePipelineUsage(stages, repairBlocked ? 'material_overlap' : (repairResult && repairResult.reason) || 'error');
      if (repairResult && !repairResult.error && repairedText.trim() && !repairBlocked) {
        handlers.onDone && handlers.onDone(repairResult.reason, repairedAggregate);
        return repairedAggregate;
      }
      const blockedAggregate = mergePipelineUsage(stages, 'material_overlap');
      handlers.onDone && handlers.onDone('material_overlap', blockedAggregate);
      return blockedAggregate;
    }
    return aggregate;
  }

  /* ---------------- 状态（localStorage 持久化） ---------------- */
  const LS_NOVELS_BASE = 'molan_editor_novels';
  const LS_CURRENT_BASE = 'molan_editor_current';
  let LS_NOVELS = LS_NOVELS_BASE + ':' + storageIdentity();
  let LS_CURRENT = LS_CURRENT_BASE + ':' + storageIdentity();
  let LS_CLOUD_SYNCED = 'molan_cloud_synced:' + storageIdentity();
  let activeStorageIdentity = storageIdentity();
  let activeSessionIdentity = sessionIdentity();
  const LS_LEGACY = 'molan_editor_v1';
  function refreshStorageKeys() {
    LS_NOVELS = LS_NOVELS_BASE + ':' + activeStorageIdentity;
    LS_CURRENT = LS_CURRENT_BASE + ':' + activeStorageIdentity;
    LS_CLOUD_SYNCED = 'molan_cloud_synced:' + activeStorageIdentity;
  }
  let novels = {};
  let currentId = '';
  let pendingNovelId = '';
  let state;
  const CH3 = '<p>幽暗古老的秘境深处，浓郁的灵气如雾霭般弥漫，遮蔽了视线。参天古林的枝桠相互纠缠，形成一道道天然的屏障，脚下是腐朽的落叶和湿滑的苔藓，韩立身形鬼魅般穿梭其间，每一步都轻若无物，双眸却锐利如鹰，警惕地扫视着四周。</p>' +
    '<p>前方忽有异香扑鼻而来，那香气清冽如冰，又夹杂着一缕若有若无的甜腥。韩立脚步一顿，神识悄然外放，瞬间锁定了三十丈外一株通体幽蓝的奇草——正是传闻中只生于万年寒潭之畔的玄冥冰魄草。</p>' +
    '<p class="sys-line">「叮！检测到高阶灵材玄冥冰魄草，品阶：天阶下品。建议宿主谨慎采集，此草周围潜藏三阶妖兽寒蟒一条。」</p>' +
    '<p>韩立心头一凛，掌心悄然凝聚起一道淡金色的灵力护罩。他屏住呼吸，借着古木的遮掩缓缓靠近。就在指尖将触未触之际，身后枯叶堆猛然炸开，一道银白色的寒芒破空而至，正是一头丈许长的寒蟒，竖瞳中满是嗜血的红光。</p>' +
    '<p class="dialogue">「果然来了。」韩立低喝一声，身形未退反进，袖中飞出三道符箓，于半空化作炽烈的火墙挡下寒蟒的第一击。热浪与寒气相撞，发出刺耳的嘶鸣。</p>' +
    '<p>寒蟒吃痛，身躯一摆卷起漫天冰晶。韩立借着火墙的遮蔽，指尖掐诀，识海中那枚黑色轮回印记骤然亮起。一道无形的轮回之力顺着他的指尖注入玄冥冰魄草，那株奇草竟自行脱离泥土，悬浮于半空。</p>' +
    '<p class="sys-line">「叮！\'轮回之道\'系统能量积蓄完成，首次升级成功！当前轮回印记封印解除进度：<span class="pct">12%</span>。新技能解锁——\'灵息敛踪\'，可于三息内完全隐匿自身灵力波动。」</p>' +
    '<p>冰冷的机械音落下的刹那，寒蟒的第二次攻击已至。韩立嘴角勾起一抹冷笑，身形骤然虚化，仿佛融入了这片幽暗的森林。寒蟒的巨尾狠狠砸在他方才站立之处，将地面砸出一个数尺深坑，却只卷起一片残影。</p>' +
    '<p class="dialogue">「轮到我了。」少年的声音在寒蟒身后响起，掌中玄冥冰魄草的寒气已被他借轮回之力尽数炼化，化作一柄三尺长的冰魄剑，剑身流转着幽蓝的寒光。</p>' +
    '<p>一剑斩落，寒蟒的头颅冲天而起。腥热的蛇血洒在冰魄剑上，瞬间凝结成霜。韩立收剑而立，目光投向秘境更深处——那里，一道更加深邃的气息正在缓缓苏醒。他知道，这场轮回之路上的考验，才刚刚开始</p>';

  function defaultState() {
    const v1 = 'v1', c1 = 'c1', c2 = 'c2', c3 = 'c3';
    const s31 = 's31', s32 = 's32';
    return {
      title: '未命名小说',
      volumes: [{
        id: v1, title: '第一卷',
        chapters: [
          { id: c1, title: '第1章', sub: '', scenes: [{ id: 'c1s1', name: '场景一', content: '' }] }
        ]
      }],
      currentChapterId: c1,
      currentSceneId: 'c1s1',
      outline: {
        book: { title: '未命名小说', oneLine: '', themes: [] },
        volume: { title: '第一卷', synopsis: '', target: '', done: 0, total: 0 },
        chapters: [
          { num: '第1章', status: 'todo', title: '第1章', synopsis: '', wordCount: 0, mark: '', storyline: '主线' }
        ]
      },
      sceneProps: {
        summary: '',
        elements: { characters: [], locations: [], items: [], plot: [] }
      },
      history: [],
      aiMessages: [],
      aiTasks: [],        // AI任务时间线：queued/running/completed/cancelled/failed/credit_exhausted
      aiOutputTarget: 'chat', // 普通对话结果落点：chat/body/setting/outline/foreshadow
      recycleBin: [],      // 回收站：存储已删除的卷/章节
      aiCallLog: [],       // AI检测历史：存储AI调用记录
      aiReports: [],       // 章节级 AI 检测 / 去 AI 味报告
      chapterCalls: [],    // 章节调用表：记录 Skill、校验和状态同步结果
      chatSessions: [],    // 会话历史（为后续Task 5预留）
      knowledge: { entities: {}, edges: [], version: 1 }, // 知识图谱：结构化实体(角色/地点/物品/事件)+关系边
      foreshadows: [],     // 伏笔生命周期：planned/planted/developing/resolved/abandoned
      dissectionSource: null, // 拆书来源：{title, dissectionId, createdAt}（基于拆书创书时写入）
      creationBookId: null,   // Q1 · 服务端创作圣经关联：创建后绑定 creationBookId/bibleId
      dissectionContext: null, // 拆书动态上下文快照：{arcs,currentArc,characterStates,timeline,foreshadows,volume,bookMap,upTo}
      referenceMaterials: [], // 导入的正文辅助资料：人物卡、地图、设定、大纲等
      inspirations: [],    // 灵感/素材卡片：{id,title,content,tag,enabled}
      aiRole: 'generation', // 当前智能体角色
      aiStyle: '',         // 当前仿写风格标签
      modelSources: [],    // 自定义模型源（OpenAI兼容）：{id,name,baseURL,apiKey,model}
      aiSkillDefinitions: {},
      settings: { fontSize: 16, lineHeight: 1.8, paragraphSpacing: 12, contentWidth: 720, readingMode: false, theme: 'light', fontFamily: 'system', autosave: true, exportFormat: 'txt', think: false, reasoningEffort: '', contextBudget: 12000, characterMaterialMode: 'auto', models: { default: 'v4-flash', continuation: 'v4-flash', polish: 'v4-flash' }, dailyGoal: 2000, todayWords: 0, todayDate: '' }
    };
  }

  function chapterWordCount(ch) { return ch.scenes.reduce((a, s) => a + countWords(s.content), 0); }
  function totalWords() { return state.volumes.reduce((sum, v) => sum + v.chapters.reduce((cSum, ch) => cSum + chapterWordCount(ch), 0), 0); }

  function migrateLegacy() {
    try {
      const legacy = localStorage.getItem(LS_LEGACY);
      if (legacy && !localStorage.getItem(LS_NOVELS)) {
        const s = JSON.parse(legacy);
        if (s && s.volumes) {
          const id = 'n_' + Date.now().toString(36);
          novels = { [id]: s };
          currentId = id;
          localStorage.setItem(LS_NOVELS, JSON.stringify(novels));
          localStorage.setItem(LS_CURRENT, currentId);
        }
      }
    } catch (_) {}
  }
  function loadLibrary() {
    migrateLegacy();
    try { novels = JSON.parse(localStorage.getItem(LS_NOVELS)) || {}; } catch (_) { novels = {}; }
    currentId = localStorage.getItem(LS_CURRENT) || '';
    if (!currentId || !novels[currentId]) {
      const ids = Object.keys(novels);
      currentId = ids[0] || '';
    }
  }
  function switchAccountNamespaceIfNeeded() {
    const next = storageIdentity();
    const nextSession = sessionIdentity();
    const storageChanged = next !== activeStorageIdentity;
    const sessionChanged = nextSession !== activeSessionIdentity;
    if (!storageChanged && !sessionChanged) return false;
    invalidateAIRequests();
    syncQueue.clear();
    cloudWriteQueues.clear();
    cloudRevisions.clear();
    cloudConflicts.clear();
    activeSessionIdentity = nextSession;
    if (!storageChanged) return true;
    activeStorageIdentity = next;
    refreshStorageKeys();
    novels = {};
    currentId = '';
    selectedSkillIds = [];
    globalSkillIds = [];
    localSkills = [];
    localMaterial = [];
    skillSyncReady = Promise.resolve();
    Object.keys(skillsMap).forEach(id => {
      if (/^(user-|global-|local-|dissect-)/.test(id)) delete skillsMap[id];
    });
    kgSelectedIds.clear();
    loadLibrary();
    state = currentId && novels[currentId] ? novels[currentId] : defaultState();
    state.aiSkills = [];
    skillsReady = loadSkills();
    renderTree();
    renderEditor();
    renderSkillMenu();
    updateSkillTag();
    return true;
  }
  function persist() {
    if (currentId && state) { state.updatedAt = Date.now(); novels[currentId] = state; }
    try {
      localStorage.setItem(LS_NOVELS, JSON.stringify(novels));
      if (currentId) localStorage.setItem(LS_CURRENT, currentId);
      // 云端同步（fire-and-forget；登录后才生效；失败不影响本地）
      if (currentId && state) pushCloud(currentId, 'save', state, state.title || '', cloudRevisions.get(currentId));
      return true;
    } catch (e) {
      // localStorage 配额满 / 序列化失败：必须上报，否则用户会误以为已保存
      console.error('[墨阑] 保存失败：', e);
      return false;
    }
  }

  function createNovelFromPrompt(prompt) {
    const id = 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const s = defaultState(); // 已是干净的空模板，不携带任何 demo 内容
    const title = (prompt.slice(0, 18) + (prompt.length > 18 ? '…' : '')) || '未命名小说';
    s.title = title;
    s.outline.book.title = title;
    s.outline.book.oneLine = prompt;
    s.outline.volume.synopsis = '创作意图：' + prompt;
    if (s.outline.chapters[0]) { s.outline.chapters[0].synopsis = prompt; s.outline.chapters[0].status = 'writing'; }
    s.sceneProps.summary = prompt;
    s.currentChapterId = s.volumes[0].chapters[0].id;
    s.currentSceneId = s.volumes[0].chapters[0].scenes[0].id;
    s.history = [];
    s.aiMessages = [];
    // 云端同步：登录后立即 POST 创建（不等 debouncedSave）
    if (cloudEnabled()) pushCloud(id, 'create', s, title);
    return { id, state: s };
  }

  const HANDOFF_BASE = 'molan_editor_handoff';
  function handoffKey() { return HANDOFF_BASE + ':' + storageIdentity(); }
  function readHandoff() {
    try { const key = handoffKey(); const raw = localStorage.getItem(key); if (!raw) return null; localStorage.removeItem(key); return JSON.parse(raw); } catch (_) { return null; }
  }
  function readDissectionHandoff() {
    try {
      const key = 'molan_dissect_handoff:' + storageIdentity();
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      localStorage.removeItem(key);
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function applyHandoff(s, h) {
    if (!h) return;
    if (h.model) s.settings.models.default = mapModel(h.model);
    if (typeof h.think === 'boolean') s.settings.think = h.think;
    if (h.persona) s.aiPersona = h.persona;
    if (Array.isArray(h.skills)) s.aiSkills = h.skills.slice();
  }
  function applyDissectionHandoff(s, h) {
    if (!s || !h || (!h.styleProfile && !Array.isArray(h.craftConstraints))) return null;
    const skill = composeDissectionSkill(h);
    if (!skill) return null;
    s.aiSkillDefinitions = s.aiSkillDefinitions && typeof s.aiSkillDefinitions === 'object' ? s.aiSkillDefinitions : {};
    s.aiSkillDefinitions[skill.id] = skill;
    s.aiSkills = [...new Set([...(Array.isArray(s.aiSkills) ? s.aiSkills : []), skill.id])];
    skillsMap[skill.id] = skill;
    dissectionHandoffApplied = skill;
    return skill;
  }

  function initFromURL() {
    loadLibrary();
    const params = new URLSearchParams(location.search);
    const prompt = params.get('prompt');
    const nid = params.get('nid');
    pendingNovelId = nid || '';
    const action = params.get('action');
    const dissectionHandoff = params.get('from') === 'dissect' ? readDissectionHandoff() : null;
    if (prompt) {
      const created = createNovelFromPrompt(prompt);
      currentId = created.id;
      const h = readHandoff();
      if (h) applyHandoff(created.state, h);
      if (dissectionHandoff) applyDissectionHandoff(created.state, dissectionHandoff);
      novels[currentId] = created.state;
      persist();
      toast('已根据你的想法创建新小说');
      try { if (history.replaceState) history.replaceState({}, '', location.pathname + location.hash); } catch (_) {}
      return created.state;
    }
    if (nid && novels[nid]) {
      currentId = nid;
      pendingNovelId = '';
      if (dissectionHandoff) applyDissectionHandoff(novels[nid], dissectionHandoff);
      persist();
      toast('已切换到指定小说');
      return novels[nid];
    }
    // 处理 ?action=new：显式新建一本空白小说（忽略 currentId，避免加载已有小说）
    if (action === 'new') {
      const newId = 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      currentId = newId;
      novels[newId] = defaultState();
      const newTitle = (params.get('title') || '').trim();
      const newDescription = (params.get('description') || '').trim();
      const newGenre = (params.get('genre') || '').trim();
      const quickMode = params.get('quick') === '1';
      if (newTitle) { novels[newId].title = newTitle; novels[newId].outline.book.title = newTitle; }
      if (newDescription) { novels[newId].outline.book.oneLine = newDescription; novels[newId].outline.volume.synopsis = newDescription; }
      if (newGenre) novels[newId].outline.book.themes = [newGenre];
      if (quickMode) {
        novels[newId].settings = novels[newId].settings || {};
        novels[newId].settings.quickCreate = true;
      }
      if (dissectionHandoff) applyDissectionHandoff(novels[newId], dissectionHandoff);
      persist();
      toast('已新建小说');
      try { if (history.replaceState) history.replaceState({}, '', location.pathname + location.hash); } catch (_) {}
      return novels[newId];
    }
    if (currentId && novels[currentId]) {
      if (dissectionHandoff) applyDissectionHandoff(novels[currentId], dissectionHandoff);
      if (dissectionHandoff) persist();
      return novels[currentId];
    }
    // 作品库从云端打开指定小说时，先保留目标 id，等待启动阶段拉取远端 state，避免把空白模板覆盖到云端。
    if (nid) {
      currentId = nid;
      return defaultState();
    }
    const id = 'n_' + Date.now().toString(36);
    currentId = id;
    novels[id] = defaultState();
    if (dissectionHandoff) applyDissectionHandoff(novels[id], dissectionHandoff);
    persist();
    return novels[id];
  }

  function setSaveState(s, t) {
    const el = $('saveStatus'); if (!el) return;
    el.classList.remove('saving', 'error');
    const txt = el.querySelector('.save-text');
    if (s === 'saving') { el.classList.add('saving'); if (txt) txt.textContent = '保存中…'; }
    else if (s === 'error') { el.classList.add('error'); if (txt) txt.textContent = '保存失败 · 点击重试'; }
    else { if (txt) txt.textContent = '已保存' + (t ? (' ' + t) : ''); }
  }

  let saveTimer = null;
  function save(opts) {
    if (persist()) setSaveState('saved', nowTime());
    else setSaveState('error');
    if (opts && opts.snapshot) pushHistory();
  }
  function debouncedSave() {
    setSaveState('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save({ snapshot: true }), 800);
  }

  function pushHistory() {
    const ch = currentChapter();
    if (!ch) return;
    state.history = state.history || [];
    const fullText = htmlToText(currentSceneContent());
    state.history.unshift({ t: nowTime(), chapter: ch.title, scene: (currentScene() || {}).name || '', words: countWords(currentSceneContent()), excerpt: fullText.slice(0, 40), text: fullText });
    if (state.history.length > 30) state.history = state.history.slice(0, 30);
  }

  /* ---------------- 数据访问 ---------------- */
  function currentChapter() {
    for (const v of state.volumes) for (const c of v.chapters) if (c.id === state.currentChapterId) return c;
    return state.volumes[0].chapters[0];
  }
  function currentScene() {
    const ch = currentChapter();
    return (ch.scenes.find(s => s.id === state.currentSceneId)) || ch.scenes[0];
  }
  function currentSceneContent() { return currentScene().content || ''; }
  function gotoChapter(chapterId) {
    if (!chapterId) return;
    const vol = state.volumes.find(volume => (volume.chapters || []).some(chapter => chapter.id === chapterId));
    const ch = vol && vol.chapters.find(chapter => chapter.id === chapterId);
    if (!ch) return;
    invalidateAIRequests();
    state.currentChapterId = chapterId;
    state.currentSceneId = (ch.scenes[0] || {}).id;
    save();
    switchTab('writing');
    renderTree(); renderEditor();
    refreshDissectionContext(); // ★ 阶段3 · 章节切换时刷新拆书动态上下文快照
  }
  function setSceneContent(html) {
    const safe = normalizeSceneContent(html);
    currentScene().content = safe;
    recomputeChapterWords();
    return safe;
  }
  function recomputeChapterWords() {
    const ch = currentChapter();
    ch._words = ch.scenes.reduce((a, s) => a + countWords(s.content), 0);
  }

  /* ---------------- DOM 引用 ---------------- */
  const sidebar = $('sidebar');
  const rightPanel = $('rightPanel');
  const tabViews = qa('.tab-view');
  const editorContent = $('editorContent');
  const immersiveEditor = q('.immersive-editor');

  /* ---------------- 渲染：章节树 ---------------- */
  // 节流：多次同步调用（如每个按键触发 updateWordCount→renderTree）合并到下一帧只重建一次 DOM
  let _renderTreeScheduled = false;
  var cursorMap = {};  // 场景光标位置记忆：{ sceneId: { offset } }
  function renderTree() {
    if (_renderTreeScheduled) return;
    _renderTreeScheduled = true;
    requestAnimationFrame(() => {
      _renderTreeScheduled = false;
      renderTreeNow();
    });
  }
  function renderTreeNow() {
    const vol = state.volumes[0];
    const list = $('chapterList');
    list.innerHTML = '';
    vol.chapters.forEach((ch, idx) => {
      const li = document.createElement('li');
      li.className = 'chapter-item' + (ch.id === state.currentChapterId ? ' is-current' : '');
      li.setAttribute('data-chapter', ch.id);
      const words = ch.scenes.reduce((a, s) => a + countWords(s.content), 0);
      const scenes = ch.scenes.map((s, i) =>
        '<li class="scene-row' + (s.id === state.currentSceneId && ch.id === state.currentChapterId ? ' is-active' : '') + '" data-scene="' + s.id + '">' +
        '<span class="scene-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></span>' +
        '<span class="scene-name">' + esc(s.name) + '</span>' +
        '<button type="button" class="tree-del" data-del-scene="' + s.id + '" data-chapter="' + ch.id + '" title="删除场景" aria-label="删除场景">×</button>' +
        '</li>'
      ).join('');
      li.innerHTML =
        '<div class="chapter-row">' +
        '<svg class="ch-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
        '<svg class="ch-doc" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
        '<span class="chapter-title">' + esc(ch.title) + (ch.sub ? ' — ' + esc(ch.sub) : '') + '</span>' +
        '<span class="chapter-meta">' + words + '字</span>' +
        '<button type="button" class="tree-del tree-del--ch" data-del-chapter="' + ch.id + '" title="删除章节" aria-label="删除章节">×</button>' +
        '</div>' +
        '<ul class="chapter-scenes">' + scenes + '</ul>';
      list.appendChild(li);
    });
    // 侧栏标题 / 大纲章节蓝图字数
    const sh = q('.sidebar-header__title'); if (sh) sh.textContent = state.title + ' · 总 ' + totalWords() + ' 字';
    const tt = q('.editor-topbar__title'); if (tt) tt.textContent = state.title;
  }

  /* ---------------- 渲染：写作区 ---------------- */
  function renderEditor() {
    const ch = currentChapter();
    // 无章节时仅刷新空状态，避免访问空对象属性
    if (!ch) { checkEmptyState(); return; }
    const sc = currentScene();
    const safeContent = normalizeSceneContent(sc.content || '');
    if (safeContent !== sc.content) sc.content = safeContent;
    if (editorContent) {
      editorContent.innerHTML = safeContent;
      applyEditorStyle();
      // 恢复光标位置
      var saved = cursorMap[sc.id];
      if (saved && saved.offset != null) {
        try {
          var range = document.createRange();
          var sel = window.getSelection();
          // 遍历文本节点找到偏移位置
          var walker = document.createTreeWalker(editorContent, NodeFilter.SHOW_TEXT, null, false);
          var curOff = 0;
          var found = false;
          while (walker.nextNode()) {
            var node = walker.currentNode;
            var nodeLen = (node.textContent || '').length;
            if (curOff + nodeLen >= saved.offset) {
              range.setStart(node, saved.offset - curOff);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
              found = true;
              break;
            }
            curOff += nodeLen;
          }
          if (!found) {
            // 没找到精确位置，光标放末尾
            range.selectNodeContents(editorContent);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch(e) {}
      }
    }
    const t = q('.editor-chapter-title'); if (t) t.textContent = ch.title;
    const sl = q('.editor-scene-label'); if (sl) {
      const span = sl.querySelector('span:last-child'); if (span) span.textContent = sc.name;
    }
    const ist = q('.immersive-title'); if (ist) ist.textContent = ch.title;
    const iss = q('.immersive-scene'); if (iss) iss.textContent = sc.name;
    if (immersiveEditor) immersiveEditor.innerHTML = safeContent;
    updateWordCount();
    renderOutline();
    renderRightPanel();
    renderStatusBar();
    renderPlotContext();
    checkEmptyState();
  }

  /* 记录当前场景的编辑器光标位置 */
  function saveCursor() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if (!editorContent || !editorContent.contains(range.startContainer)) return;
    // 计算光标在编辑器中的字符偏移
    var preRange = document.createRange();
    preRange.selectNodeContents(editorContent);
    preRange.setEnd(range.startContainer, range.startOffset);
    var offset = preRange.toString().length;
    var sc = currentScene();
    if (sc) cursorMap[sc.id] = { offset: offset };
  }

  /* 获取编辑器中光标位置之前的所有文本
   * @returns {string} 光标前的文本，若光标不在编辑器中则返回全文
   */
  function getTextBeforeCursor() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return htmlToText(currentSceneContent());
    var range = sel.getRangeAt(0);
    if (!editorContent || !editorContent.contains(range.startContainer)) return htmlToText(currentSceneContent());
    var preRange = document.createRange();
    preRange.selectNodeContents(editorContent);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString();
  }

  function updateWordCount() {
    const w = countWords(currentSceneContent());
    const wc = q('.editor-wordcount'); if (wc) wc.textContent = w + '字';
    const imf = q('.immersive-foot'); if (imf) imf.textContent = w + ' 字';
    // 状态栏写作目标：显示今日字数 / 每日目标，跨天时自动重置
    var ch = currentChapter();
    var chWords = ch._words || 0;
    var goal = (state.settings && state.settings.dailyGoal) || 2000;
    // 今日字数统计：跨天则重置为当前章节字数，同日则取高水位（避免删字回退）
    var today = new Date().toISOString().slice(0, 10);
    var dirty = false;
    if (state.settings.todayDate !== today) {
      state.settings.todayDate = today;
      state.settings.todayWords = chWords;
      dirty = true;
    } else if (chWords > state.settings.todayWords) {
      state.settings.todayWords = chWords;
      dirty = true;
    }
    if (dirty) save();
    var todayWords = state.settings.todayWords || 0;
    var goalEl = q('.statusbar__goal');
    if (goalEl) {
      var pct = Math.min(100, Math.round(todayWords / goal * 100));
      goalEl.innerHTML = '<span class="goal-text">今日 ' + todayWords + ' / ' + goal + ' 字</span><div class="goal-bar"><div class="goal-bar__fill" style="width:' + pct + '%"></div></div>';
      goalEl.classList.toggle('is-done', todayWords >= goal);
    }
    renderTree();
  }

  function renderStatusBar() {
    const sb = q('.editor-statusbar');
    if (!sb) return;
    const ch = currentChapter(); const sc = currentScene();
    const items = sb.querySelectorAll('.editor-statusbar__item');
    if (items[0]) items[0].innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ' + esc(ch.title) + ' · ' + esc(sc.name);
    if (items[1]) items[1].textContent = countWords(currentSceneContent()) + ' 字';
    updateModelBadges();
  }
  function updateModelBadges() {
    const m = currentUnifiedModel();
    const label = modelLabel(m);
    const contextLabel = formatContextWindow(contextWindowForModel(m));
    const a = $('chatModelBadge'); if (a) a.textContent = label;
    const b = $('aiModelBadge'); if (b) b.textContent = label;
    const c = $('statusModelBadge'); if (c) c.textContent = label;
    const rp = $('aiModelSelect'); if (rp) rp.title = '当前模型：' + label + '；上下文窗口约 ' + contextLabel + '（点击切换）';
    renderPlotModel();
  }
  function renderPlotModel() {
    const el = $('plotCurrentModel');
    if (!el) return;
    const model = currentAIPanelModel();
    el.textContent = modelLabel(model);
    el.title = model + '；上下文窗口约 ' + formatContextWindow(contextWindowForModel(model));
  }
  // 思考强度控制：随当前模型动态切换（DeepSeek=开关；GPT=关闭/低/中/高）
  function renderThinkControl() {
    const seg = $('aiThinkSeg');
    if (!seg) return;
    const curModel = currentUnifiedModel();
    const pm = platformModelById(curModel);
    const modelKey = String(curModel || '').toLowerCase();
    const isGpt = !!(pm && pm.supportsReasoning) || /gpt-5\.(2|4|5|6)/.test(modelKey);
    const dsRow = $('thinkRowDs');
    if (dsRow) dsRow.style.display = isGpt ? 'none' : '';
    let opts, cur;
    if (isGpt) {
      seg.setAttribute('data-mode', 'gpt');
      const efforts = reasoningOptionsForModel(pm || { id: curModel, model: curModel, supportsReasoning: true });
      const saved = String(state.settings.reasoningEffort || '').toLowerCase();
      const fallback = efforts.includes('medium') ? 'medium' : (efforts[0] || '');
      cur = efforts.includes(saved) ? saved : fallback;
      state.settings.reasoningEffort = cur;
      const labels = { none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大' };
      opts = efforts.map(v => ({ v, l: labels[v] || v }));
    } else {
      seg.setAttribute('data-mode', 'deepseek');
      opts = [{ v: 'off', l: '关闭' }, { v: 'on', l: '开启' }];
      cur = state.settings.think ? 'on' : 'off';
    }
    seg.innerHTML = opts.map(o => '<button type="button" data-v="' + o.v + '" class="' + (String(o.v) === String(cur) ? 'is-active' : '') + '">' + o.l + '</button>').join('');
    seg.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.v;
        if (isGpt) {
          state.settings.reasoningEffort = v;
        } else {
          state.settings.think = (v === 'on');
        }
        save();
        renderThinkControl();
      };
    });
  }

  /* ---------------- 渲染：右侧AI助手面板 ---------------- */
  // 更新右侧面板的会话标题显示
  // 快速开始区域：开始对话后收缩，避免挤占对话框；点击标题可再次展开
  function collapseQuickStart() { const el = document.querySelector('.rp-quick-start'); if (el) el.classList.add('is-collapsed'); }
  function expandQuickStart() { const el = document.querySelector('.rp-quick-start'); if (el) el.classList.remove('is-collapsed'); }
  function syncQuickStart() {
    const el = document.querySelector('.rp-quick-start');
    if (!el) return;
    const n = (state && state.aiMessages ? state.aiMessages.length : 0);
    el.classList.toggle('is-collapsed', n > 0);
  }

  function renderRightPanel() {
    const titleEl = $('aiSessionTitle');
    if (titleEl) {
      const sess = getCurrentSession();
      titleEl.textContent = sess ? sess.title : '默认会话';
    }
    syncQuickStart();
  }

  /* ---------------- 渲染：大纲 ---------------- */
  function renderOutline() {
    ensureOutlineChapters();
    const o = state.outline;
    // 总纲
    const bookTitle = q('.outline-node__title'); if (bookTitle) bookTitle.textContent = o.book.title;
    const fields = qa('.tv-card .outline-field');
    if (fields[0]) { const v = fields[0].querySelector('.outline-value'); if (v) v.textContent = o.book.title; }
    if (fields[1]) { const v = fields[1].querySelector('.outline-value'); if (v) v.textContent = o.book.oneLine; }
    const tagRow = q('.tv-card .tag-row');
    if (tagRow && Array.isArray(o.book.themes)) tagRow.innerHTML = o.book.themes.map(t => '<span class="rp-tag">' + esc(t) + '</span>').join('');
    // 卷纲
    const volTitle = qa('.outline-node__title')[1]; if (volTitle) volTitle.textContent = o.volume.title;
    const volFields = qa('.tv-card')[1] ? qa('.tv-card')[1].querySelectorAll('.outline-field') : [];
    if (volFields[0]) { const v = volFields[0].querySelector('.outline-value'); if (v) v.textContent = o.volume.synopsis; }
    if (volFields[1]) { const v = volFields[1].querySelector('.outline-value'); if (v) v.textContent = o.volume.target; }
    if (volFields[2]) { const v = volFields[2].querySelector('.outline-value'); if (v) v.textContent = o.volume.done + ' / ' + o.volume.total + ' 章'; }
    // 章节蓝图
    const grid = q('.ch-grid');
    if (grid) {
      const statusCls = { done: 'ch-status--done', writing: 'ch-status--writing', todo: 'ch-status--todo' };
      const statusTxt = { done: '✓ 已完成', writing: '⏳ 写作中', todo: '📋 待写' };
      grid.innerHTML = o.chapters.map((c, idx) => {
        const realCh = state.volumes[0].chapters[idx];
        const w = realCh ? chapterWordCount(realCh) : 0;
        c.wordCount = w;
        const active = (c.num === currentChapter().title) ? ' ch-card--active' : '';
        const up = idx === 0 ? ' disabled' : '';
        const down = idx === o.chapters.length - 1 ? ' disabled' : '';
        const mk = MARK_TYPES[c.mark] || MARK_TYPES[''];
        const markBadge = c.mark ? '<span class="ch-mark" style="background:' + mk.color + '" title="' + mk.label + '">' + mk.short + '</span>' : '';
        return '<div class="ch-card' + active + '" draggable="true" data-idx="' + idx + '">' +
          '<span class="ch-drag" title="拖拽排序">⠿</span>' +
          '<div class="ch-card__head"><span class="ch-card__num">' + esc(c.num) + '</span>' + markBadge + '<span class="ch-status ' + (statusCls[c.status] || '') + '">' + (statusTxt[c.status] || '') + '</span>' +
          '<span class="ch-move"><button type="button" data-move="up"' + up + ' aria-label="上移">↑</button><button type="button" data-move="down"' + down + ' aria-label="下移">↓</button></span></div>' +
          '<div class="ch-card__title" contenteditable="true" style="cursor:text;">' + esc(c.title) + '</div>' +
          '<div class="ch-card__synopsis" contenteditable="true" style="cursor:text;">' + esc(c.synopsis) + '</div>' +
          '<div class="ch-card__meta">' + w + '字</div></div>';
      }).join('');
    }
  }

  /* ---------------- 设置应用 ---------------- */
  function applyEditorStyle() {
    if (!editorContent) return;
    const s = state.settings;
    editorContent.style.fontSize = s.fontSize + 'px';
    editorContent.style.lineHeight = String(s.lineHeight);
    const ff = s.fontFamily === 'song' ? '"Noto Serif SC","Songti SC",serif' :
      s.fontFamily === 'hei' ? '"PingFang SC","Microsoft YaHei",sans-serif' : 'var(--ml-font-sans)';
    editorContent.style.fontFamily = ff;
    const gap = Math.max(4, Math.min(36, Number(s.paragraphSpacing) || 12));
    const width = Math.max(560, Math.min(960, Number(s.contentWidth) || 720));
    editorContent.style.setProperty('--editor-paragraph-gap', gap + 'px');
    editorContent.style.setProperty('--editor-content-width', width + 'px');
    document.documentElement.style.setProperty('--editor-paragraph-gap', gap + 'px');
    document.documentElement.style.setProperty('--editor-content-width', width + 'px');
    const page = document.querySelector('.editor-page');
    if (page) page.classList.toggle('is-reading-mode', !!s.readingMode);
    if (immersiveEditor) { immersiveEditor.style.fontSize = s.fontSize + 'px'; immersiveEditor.style.lineHeight = String(s.lineHeight); immersiveEditor.style.fontFamily = ff; }
  }
  function applyTheme(theme) {
    const html = document.documentElement;
    const dark = theme === 'dark' || (theme === 'follow' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    html.classList.toggle('dark', dark);
    html.classList.toggle('light', !dark);
    html.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  /* ---------------- 通用弹窗 ---------------- */
  function openModal(html, opts) {
    let m = $('mlModal');
    if (!m) { m = document.createElement('div'); m.id = 'mlModal'; document.body.appendChild(m); }
    m.className = 'ml-modal-mask';
    m.innerHTML = '<div class="ml-modal' + (opts && opts.wide ? ' ml-modal--wide' : '') + '"><button class="ml-modal__close" aria-label="关闭">×</button>' + html + '</div>';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:10000;';
    m.querySelector('.ml-modal__close').onclick = closeModal;
    m.onclick = e => { if (e.target === m) closeModal(); };
    const modal = m.querySelector('.ml-modal');
    modal.style.cssText = 'position:relative;background:#fff;border-radius:14px;max-width:520px;width:90vw;max-height:82vh;overflow:auto;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.3);';
    return modal;
  }
  function closeModal() { const m = $('mlModal'); if (m) { m.remove(); } }
  // 自定义确认 / 输入对话框（替代原生 confirm/prompt，兼容嵌入式 webview）
  function confirmModal(message) {
    return new Promise(resolve => {
      const html = '<div class="confirm-box"><p class="confirm-msg">' + esc(message) + '</p><div class="confirm-actions"><button class="tv-btn" data-act="cancel">取消</button><button class="tv-btn tv-btn--primary" data-act="ok">确定</button></div></div>';
      const modal = openModal(html);
      const done = val => { closeModal(); resolve(val); };
      modal.onclick = e => { const act = e.target.closest('[data-act]'); if (act) done(act.dataset.act === 'ok'); };
      const x = modal.querySelector('.ml-modal__close'); if (x) x.onclick = () => done(false);
      const mask = $('mlModal'); if (mask) mask.onclick = e => { if (e.target === mask) done(false); };
    });
  }
  function promptModal(message, def) {
    return new Promise(resolve => {
      const html = '<div class="confirm-box"><p class="confirm-msg">' + esc(message) + '</p><input class="confirm-input" id="promptInput" value="' + esc(def || '') + '"><div class="confirm-actions"><button class="tv-btn" data-act="cancel">取消</button><button class="tv-btn tv-btn--primary" data-act="ok">确定</button></div></div>';
      const modal = openModal(html);
      const inp = modal.querySelector('#promptInput');
      const done = val => { closeModal(); resolve(val); };
      if (inp) inp.focus();
      modal.onclick = e => { const act = e.target.closest('[data-act]'); if (act) done(act.dataset.act === 'ok' ? (inp ? inp.value.trim() : '') : ''); };
      const x = modal.querySelector('.ml-modal__close'); if (x) x.onclick = () => done('');
      const mask = $('mlModal'); if (mask) mask.onclick = e => { if (e.target === mask) done(''); };
      if (inp) inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); done(inp.value.trim()); }
        else if (e.key === 'Escape') { e.preventDefault(); done(''); }
      });
    });
  }

  /* ---------------- 导出 ---------------- */
  function buildExportText(format) {
    let out = '';
    state.volumes.forEach(v => {
      if (format === 'md') out += '# ' + v.title + '\n\n';
      v.chapters.forEach(c => {
        if (format === 'md') out += '## ' + c.title + (c.sub ? '（' + c.sub + '）' : '') + '\n\n';
        else out += '【' + c.title + (c.sub ? '·' + c.sub : '') + '】\n\n';
        c.scenes.forEach(s => {
          if (format === 'md') out += '### ' + s.name + '\n\n';
          out += htmlToText(s.content) + '\n\n';
        });
      });
    });
    return out;
  }
  function buildExportHTML() {
    let out = '';
    state.volumes.forEach(v => {
      out += '<h2>' + esc(v.title) + '</h2>';
      v.chapters.forEach(c => {
        out += '<h3>' + esc(c.title) + (c.sub ? '（' + esc(c.sub) + '）' : '') + '</h3>';
        c.scenes.forEach(s => { out += (s.content || ''); });
      });
    });
    return out;
  }
  function exportNovel() {
    const fmt = state.settings.exportFormat;
    if (fmt === 'pdf') {
      const body = buildExportHTML();
      const ff = state.settings.fontFamily === 'song' ? '"Noto Serif SC","Songti SC",serif' : state.settings.fontFamily === 'hei' ? '"PingFang SC","Microsoft YaHei",sans-serif' : 'system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif';
      const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(state.title) + '</title>' +
        '<style>body{font-family:' + ff + ';font-size:' + state.settings.fontSize + 'px;line-height:' + state.settings.lineHeight + ';color:#222;max-width:720px;margin:48px auto;padding:0 24px;}h1{font-size:24px;margin-bottom:8px;}h2{font-size:18px;margin-top:32px;margin-bottom:8px;color:#444;}h3{font-size:15px;margin-top:20px;margin-bottom:6px;color:#666;}p{margin:0 0 12px;text-indent:2em;}p.sys-line,p.dialogue{text-indent:0;background:#f8f5ee;padding:10px 14px;border-left:3px solid #d4a574;border-radius:6px;}p.dialogue{background:#f3f4f6;border-left-color:#666;}p.scene-sep{text-align:center;color:#bbb;letter-spacing:.4em;text-indent:0;margin:18px 0;}img{max-width:100%;height:auto;border-radius:8px;margin:8px 0;}.meta{color:#888;font-size:12px;margin-bottom:24px;}</style></head>' +
        '<body><h1>' + esc(state.title) + '</h1><div class="meta">总 ' + totalWords() + ' 字 · 由墨阑导出</div>' + body + '</body></html>';
      const w = window.open('', '_blank');
      w.document.write(html); w.document.close(); w.focus();
      setTimeout(() => w.print(), 350);
      toast('PDF：请在打印对话框中选择「另存为 PDF」');
      return;
    }
    const text = buildExportText(fmt);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.title + (fmt === 'md' ? '.md' : '.txt');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已导出正文（' + (fmt === 'md' ? 'Markdown' : 'TXT') + '）');
  }

  /* ---------------- AI 助手上下文 ---------------- */
  // 当前章节在「章节蓝图」中的对应项（与 renderOutline 的 1:1 索引映射保持一致）
  function currentOutlineChapter() {
    const ch = currentChapter();
    const idx = state.volumes[0].chapters.indexOf(ch);
    const o = state.outline;
    if (idx >= 0 && o.chapters[idx]) return o.chapters[idx];
    return o.chapters.find(c => c.title === ch.sub || c.num === ch.title) || null;
  }
  // 上一章（跨卷），用于剧情连贯性
  function prevChapter() {
    const all = [];
    state.volumes.forEach(v => v.chapters.forEach(c => all.push(c)));
    const idx = all.findIndex(c => c.id === state.currentChapterId);
    return idx > 0 ? all[idx - 1] : null;
  }
  let lastContextMeta = { budget: 12000, used: 0, blocks: [], entities: [], references: [], foreshadows: [], ignoredEntities: 0, ignoredReferences: 0, truncated: false, full: false };
  function currentContextBudget(taskText, base) {
    ensureAdvancedState();
    const value = Number(state.settings.contextBudget);
    const requested = [8000, 12000, 18000, 24000].includes(value) ? value : 12000;
    return Math.min(requested, contextBudgetLimitForModel(currentUnifiedModel(), base));
  }
  function contextSeedText(taskText) {
    const ch = currentChapter() || { title: '', sub: '', scenes: [] };
    const oc = currentOutlineChapter();
    const sp = state.sceneProps || {};
    const el = sp.elements || {};
    const body = (ch.scenes || []).map(scene => htmlToText(scene.content || '')).join('\n');
    return [taskText, state.title, ch.title, ch.sub, oc && oc.title, oc && oc.synopsis, sp.summary,
      ...(el.characters || []), ...(el.locations || []), ...(el.items || []), ...(el.plot || []),
      ...(Array.isArray(state.projectResources) ? state.projectResources.slice(0, 24).map(resource => [resource.kind, resource.id, resource.payload && JSON.stringify(resource.payload)].filter(Boolean).join(' ')) : []),
      body.slice(-5000)]
      .filter(Boolean).join('\n');
  }
  function contextTerms(text) {
    const source = String(text || '').toLowerCase();
    const terms = [];
    const add = value => { const term = String(value || '').trim(); if (term.length >= 2 && !terms.includes(term)) terms.push(term); };
    (source.match(/[a-z][a-z0-9_-]{2,}/g) || []).forEach(add);
    (source.match(/[\u4e00-\u9fff]{2,12}/g) || []).forEach(add);
    return terms.slice(0, 160);
  }
  function entityContextText(entity) {
    const parent = entity.parentId && state.knowledge.entities[entity.parentId];
    return [entity.name, ...(entity.aliases || []), ...(entity.tags || []), entity.currentLocation, entity.owner,
      entity.personality, entity.notes, parent && parent.name, ...(entity.attrs || []).flatMap(attr => [attr.k, attr.v])]
      .filter(Boolean).join(' ').toLowerCase();
  }
  function scoreContextEntity(entity, seed, terms, explicit) {
    const name = String(entity.name || '').toLowerCase();
    const aliases = (entity.aliases || []).map(value => String(value).toLowerCase());
    const searchable = entityContextText(entity);
    let score = 0;
    if (explicit.some(value => value === entity.name || aliases.includes(String(value).toLowerCase()))) score += 180;
    if (name && seed.includes(name)) score += 120;
    aliases.forEach(alias => { if (alias && seed.includes(alias)) score += 70; });
    terms.forEach(term => { if (term.length >= 3 && searchable.includes(term)) score += Math.min(18, term.length); });
    if (entity.status && /未出场|待定|归档|废弃/.test(entity.status)) score -= 8;
    return score;
  }
  function formatContextEntity(entity) {
    let line = '· ' + entityTypeMeta(entity.type).label + '《' + entity.name + '》';
    if (entity.aliases && entity.aliases.length) line += '（别名：' + entity.aliases.slice(0, 5).join('、') + '）';
    if (entity.parentId && state.knowledge.entities[entity.parentId]) line += '【归属：' + entityPath(entity) + '】';
    if (entity.attrs && entity.attrs.length) line += '：' + entity.attrs.slice(0, 8).map(attr => attr.k + (attr.v ? '=' + attr.v : '')).join('、');
    if (entity.type === 'character') {
      const archetype = characterArchetypeDisplay(entity);
      if (archetype.archetype) line += '【人物类型：' + archetype.archetype + '（' + archetype.sourceLabel + '）】';
    }
    if (entity.type === 'character' && entity.personality) line += '【性格：' + entity.personality.slice(0, 120) + '】';
    if (entity.status) line += '【状态：' + entity.status + '】';
    if (entity.currentLocation) line += '【当前位置：' + entity.currentLocation + '】';
    if (entity.owner) line += '【持有者：' + entity.owner + '】';
    if (entity.tags && entity.tags.length) line += '【标签：' + entity.tags.slice(0, 6).join('、') + '】';
    if (entity.notes) line += '（' + entity.notes.slice(0, 180) + '）';
    return line;
  }
  function scoreContextReference(item, seed, terms) {
    const name = String(item.name || '').toLowerCase();
    const text = String(item.text || '').toLowerCase();
    let score = name && seed.includes(name) ? 90 : 0;
    terms.slice(0, 50).forEach(term => { if (term.length >= 3 && (name.includes(term) || text.includes(term))) score += 2; });
    return score + ({ setting: 30, character: 26, map: 20, outline: 18, manuscript: 12, reference: 4 }[item.type] || 0);
  }
  function buildDynamicContext(taskText) {
    ensureKnowledge(); ensureReferenceMaterials(); ensureAdvancedState(); ensureOutlineChapters();
    const base = arguments[1];
    const budget = currentContextBudget(taskText, base);
    const outline = state.outline;
    const chapter = currentChapter();
    const outlineChapter = currentOutlineChapter();
    const seed = contextSeedText(taskText);
    const seedLower = seed.toLowerCase();
    const terms = contextTerms(seed);
    const sceneProps = state.sceneProps || {};
    const elements = sceneProps.elements || {};
    const explicit = [...(elements.characters || []), ...(elements.locations || []), ...(elements.items || []), ...(elements.plot || [])]
      .map(value => String(value).trim()).filter(Boolean);
    const entities = entList();
    const ranked = entities.map(entity => ({ entity, score: scoreContextEntity(entity, seedLower, terms, explicit) }))
      .sort((left, right) => right.score - left.score || (right.entity.updatedAt || 0) - (left.entity.updatedAt || 0));
    const selected = [];
    const selectedIds = new Set();
    const select = entity => { if (entity && !selectedIds.has(entity.id)) { selectedIds.add(entity.id); selected.push(entity); } };
    ranked.filter(item => item.score >= 80).slice(0, 28).forEach(item => select(item.entity));
    ranked.slice(0, Math.min(12, ranked.length)).forEach(item => select(item.entity));
    selected.slice().forEach(entity => {
      let parent = entity.parentId && state.knowledge.entities[entity.parentId];
      while (parent && selected.length < 42) { select(parent); parent = parent.parentId && state.knowledge.entities[parent.parentId]; }
    });
    const selectedEdges = (state.knowledge.edges || []).filter(edge => selectedIds.has(edge.from) || selectedIds.has(edge.to)).slice(0, 48);
    const chapterIndex = state.volumes[0].chapters.indexOf(chapter);
    const nearBlueprint = (outline.chapters || []).map((item, index) => ({ item, index }))
      .filter(entry => Math.abs(entry.index - chapterIndex) <= 2).slice(0, 6);
    const activeForeshadows = (state.foreshadows || []).filter(item => item && !['resolved', 'abandoned'].includes(item.status));
    const rankedForeshadows = activeForeshadows.map(item => {
      const source = [item.title, item.description, item.notes, ...(item.clues || []), ...(item.relatedEntityIds || []).map(id => state.knowledge.entities[id] && state.knowledge.entities[id].name)]
        .filter(Boolean).join(' ').toLowerCase();
      let score = item.title && seedLower.includes(String(item.title).toLowerCase()) ? 100 : 0;
      terms.slice(0, 40).forEach(term => { if (source.includes(term)) score += 2; });
      if (item.targetChapterId === chapter.id || item.plantedChapterId === chapter.id) score += 60;
      return { item, score };
    }).sort((left, right) => right.score - left.score || (right.item.updatedAt || 0) - (left.item.updatedAt || 0)).slice(0, 12).map(entry => entry.item);
    const references = ensureReferenceMaterials().map(item => ({ item, score: scoreContextReference(item, seedLower, terms) }))
      .sort((left, right) => right.score - left.score || (left.item.name || '').localeCompare(right.item.name || ''));
    const blocks = [];
    const meta = { budget, used: 0, blocks: [], entities: selected, references: [], foreshadows: rankedForeshadows, ignoredEntities: Math.max(0, entities.length - selected.length), ignoredReferences: 0, truncated: false, full: false };
    const addBlock = (label, text, cap) => {
      const value = String(text || '').trim();
      if (!value || meta.used >= budget - 80) return;
      const block = '【' + label + '】\n' + value.slice(0, cap || value.length);
      const room = budget - meta.used;
      if (room <= 80) return;
      if (block.length > room) { blocks.push(block.slice(0, room) + '\n[上下文已按预算截断]'); meta.used = budget; meta.truncated = true; return; }
      blocks.push(block); meta.used += block.length; meta.blocks.push(label);
    };
    const projectProfile = state.projectProfile && typeof state.projectProfile === 'object' ? state.projectProfile : {};
    addBlock('作品基础定位', [
      projectProfile.subtitle ? '副标题：' + projectProfile.subtitle : '',
      projectProfile.penName ? '笔名：' + projectProfile.penName : '',
      projectProfile.genre ? '题材：' + projectProfile.genre : (projectProfile.primaryGenre ? '题材：' + projectProfile.primaryGenre : ''),
      projectProfile.theme ? '主题立意：' + projectProfile.theme : '',
      projectProfile.tone ? '作品基调：' + projectProfile.tone : '',
      projectProfile.targetReader ? '目标读者：' + projectProfile.targetReader : '',
      projectProfile.shortSynopsis ? '短简介：' + projectProfile.shortSynopsis : '',
      projectProfile.longSynopsis ? '长简介：' + projectProfile.longSynopsis : ''
    ].filter(Boolean).join('\n'), 2200);
    addBlock('作品信息', ['书名：《' + (state.title || '未命名小说') + '》', outline.book.oneLine ? '简介：' + outline.book.oneLine : '',
      outline.book.themes && outline.book.themes.length ? '主题：' + outline.book.themes.join('、') : '',
      '卷纲：' + (outline.volume.title || '第一卷') + (outline.volume.synopsis ? '\n' + outline.volume.synopsis : '')].filter(Boolean).join('\n'), 1200);
    const currentText = chapter.scenes.map(scene => htmlToText(scene.content || '')).join('\n\n');
    addBlock('当前章节', [chapter.title + (chapter.sub ? '（' + chapter.sub + '）' : ''), outlineChapter && outlineChapter.synopsis ? '本章规划：' + outlineChapter.synopsis : '',
      '本章已写正文（' + countWords(currentText) + ' 字）：', currentText.slice(-4200)].filter(Boolean).join('\n'), 5200);
    addBlock('场景属性', [sceneProps.summary ? '当前场景摘要：' + sceneProps.summary : '', explicit.length ? '场景显式关联：' + explicit.join('、') : ''].filter(Boolean).join('\n'), 1200);
    if (nearBlueprint.length) addBlock('邻近章节蓝图', nearBlueprint.map(entry => (entry.index + 1) + '. ' + entry.item.num + ' ' + (entry.item.title || '') + ' [' + (entry.item.status || 'todo') + ']' + (entry.item.synopsis ? ' ' + entry.item.synopsis : '')).join('\n'), 2800);
    const portableBlueprint = outline.portableBlueprint && typeof outline.portableBlueprint === 'object' ? outline.portableBlueprint : null;
    const volumePlan = Array.isArray(outline.volumePlan) ? outline.volumePlan : [];
    if (portableBlueprint || volumePlan.length) {
      const blueprintText = portableBlueprint ? [
        portableBlueprint.targetGenre ? '目标题材：' + portableBlueprint.targetGenre : '',
        portableBlueprint.targetReader ? '目标读者：' + portableBlueprint.targetReader : '',
        portableBlueprint.pacingModel ? '节奏模型：' + portableBlueprint.pacingModel : '',
        portableBlueprint.openingApproach ? '开篇方式：' + portableBlueprint.openingApproach : '',
        portableBlueprint.conflictEscalation ? '冲突升级：' + portableBlueprint.conflictEscalation : '',
        portableBlueprint.growthReward ? '成长回报：' + portableBlueprint.growthReward : '',
        Array.isArray(portableBlueprint.transferableStyle) && portableBlueprint.transferableStyle.length ? '可迁移技法：' + portableBlueprint.transferableStyle.join('；') : ''
      ].filter(Boolean).join('\n') : '';
      const planText = volumePlan.slice(0, 8).map((volume, index) => [
        '第' + (index + 1) + '卷 ' + (volume.volume || ''),
        volume.goal ? '目标：' + volume.goal : '',
        volume.turningPoint ? '转折：' + volume.turningPoint : '',
        volume.endingHook ? '卷末钩子：' + volume.endingHook : ''
      ].filter(Boolean).join('；')).join('\n');
      addBlock('可迁移创作蓝图', [blueprintText, planText ? '分卷规划：\n' + planText : ''].filter(Boolean).join('\n'), 3600);
    }
    const previous = prevChapter();
    if (previous) addBlock('上一章回顾', '《' + previous.title + (previous.sub ? '（' + previous.sub + '）' : '') + '》\n' + previous.scenes.map(scene => htmlToText(scene.content || '')).join('\n\n').slice(-2400), 2800);
    // ★ 阶段3 · 拆书动态上下文：当前故事弧 / 人物状态快照 / 事件时间线 / 未回收伏笔（截至当前章）
    const dc = state.dissectionContext;
    if (dc) {
      const arcText = (dc.currentArc ? ('当前故事弧（第' + (dc.currentArc.range || '') + '章）：' + [dc.currentArc.coreConflict, dc.currentArc.protagonistGoal, Array.isArray(dc.currentArc.turningPoints) ? dc.currentArc.turningPoints.join('、') : '', dc.currentArc.endingHook].filter(Boolean).join('；')) : '');
      const charText = (Array.isArray(dc.characterStates) && dc.characterStates.length ? '人物当前状态：' + dc.characterStates.slice(0, 10).map(c => '·' + (c.name || '') + '（' + (c.stage || '') + '，' + (c.at || '') + '）：' + (c.state && Array.isArray(c.state.statusChanges) ? c.state.statusChanges.slice(0, 4).join('；') : '')).join('\n') : '');
      const tlText = (Array.isArray(dc.timeline) && dc.timeline.length ? '近期事件时间线：' + dc.timeline.slice(-10).map(t => '第' + t.chapterNo + '章·' + (t.title || '')).join('；') : '');
      const fsText = (Array.isArray(dc.foreshadows) && dc.foreshadows.length ? '未回收伏笔：' + dc.foreshadows.slice(0, 12).map(f => '·' + (f.title || '') + '[' + (f.status || '') + (f.payoffChapter ? ' 预定第' + f.payoffChapter + '章回收' : '') + ']' + (f.description ? '：' + f.description : '')).join('\n') : '');
      const volText = (dc.volume && (dc.volume.goal || dc.volume.endingHook)) ? '当前分卷：' + (dc.volume.volume || '') + '，目标 ' + (dc.volume.goal || '') + '，卷末钩子 ' + (dc.volume.endingHook || '') : '';
      addBlock('拆书动态上下文', [arcText, volText, charText, tlText, fsText].filter(Boolean).join('\n'), 4200);
    }
    if (selected.length) addBlock('相关知识库设定', selected.map(formatContextEntity).join('\n'), 7200);
    const projectResourceText = (Array.isArray(state.projectResources) ? state.projectResources : []).slice(0, 36).map(resource => {
      const payload = resource && resource.payload && typeof resource.payload === 'object' ? JSON.stringify(resource.payload) : '';
      return '· ' + (resource.kind || '资料') + '《' + (resource.id || '未命名') + '》' + (payload ? '：' + payload.slice(0, 360) : '');
    }).join('\n');
    if (projectResourceText) addBlock('资料中心补充资料', projectResourceText, 5200);
    if (selectedEdges.length) addBlock('相关关系', selectedEdges.map(edge => {
      const from = state.knowledge.entities[edge.from], to = state.knowledge.entities[edge.to];
      return from && to ? '· ' + from.name + ' —' + relationTypeMeta(edge.relationType).label + (edge.label ? '：' + edge.label : '') + '→ ' + to.name : '';
    }).filter(Boolean).join('\n'), 2200);
    if (rankedForeshadows.length) addBlock('当前伏笔', rankedForeshadows.map(item => '· ' + (item.title || '未命名伏笔') + ' [' + (item.status || 'planned') + ']' + (item.description ? '：' + item.description : '')).join('\n'), 2200);
    const recentChapterCalls = (state.chapterCalls || []).filter(item => item && ['committed', 'committed_with_warnings'].includes(item.status)).slice(0, 3);
    if (recentChapterCalls.length) addBlock('章节调用表（最近结果）', recentChapterCalls.map(item => {
      const sync = item.stateSync || {};
      return '· ' + (item.chapterTitle || '未命名章节') + '：' + (item.result && item.result.excerpt ? item.result.excerpt : '已完成') +
        '；已同步人物/设定 ' + (Array.isArray(sync.entityIds) ? sync.entityIds.length : 0) + ' 条，伏笔 ' + (Array.isArray(sync.foreshadowIds) ? sync.foreshadowIds.length : 0) + ' 条；下章承接：' + (item.result && item.result.continuationPoint ? item.result.continuationPoint : '未记录');
    }).join('\n'), 2400);
    const refsToUse = references.filter(entry => String(entry.item.text || '').trim() && entry.score > 4).slice(0, 6);
    meta.ignoredReferences = Math.max(0, references.length - refsToUse.length);
    refsToUse.forEach(({ item }) => {
      const before = meta.used;
      addBlock('参考资料 · ' + (item.type || 'reference') + ' · ' + item.name, item.text, 2600);
      if (meta.used > before) meta.references.push(item);
    });
    if (state.knowledge.summary) addBlock('抽取事实摘要', state.knowledge.summary, 1600);
    if (state.knowledge.style && typeof state.knowledge.style === 'object') addBlock('抽取文风', Object.entries(state.knowledge.style).filter(entry => entry[1]).map(entry => entry[0] + '=' + entry[1]).join('；'), 900);
    lastContextMeta = meta;
    return { text: blocks.join('\n\n'), meta };
  }
  const CHARACTER_DIMENSION_HINTS = [
    ['appearance', /外貌|长相|衣着|身形|容貌|外形/u],
    ['expression', /神态|表情|目光|眼神|情绪|脸色/u],
    ['action', /动作|行为|抬手|转身|战斗|出手|反应/u],
    ['dialogue', /语言|对白|说话|台词|口吻|称呼/u],
    ['catchphrase', /口头禅|语气|说话习惯|口癖/u],
    ['psychology', /心理|内心|想法|情绪|犹豫|恐惧|压抑|试探/u]
  ];

  /** Build the server-authoritative character-material request for prose tasks. */
  function buildCharacterMaterialRequest(taskText, options) {
    ensureAdvancedState();
    ensureKnowledge();
    const opts = typeof options === 'string' ? { mode: options } : (options || {});
    const mode = ['auto', 'strong', 'off'].includes(opts.mode) ? opts.mode : (state.settings.characterMaterialMode || 'auto');
    const dynamic = buildDynamicContext(taskText);
    const selectedEntities = dynamic && dynamic.meta && Array.isArray(dynamic.meta.entities) ? dynamic.meta.entities : [];
    const characters = selectedEntities.filter(entity => entity && entity.type === 'character').slice(0, 20).map(entity => {
      const resolved = characterArchetypeDisplay(entity);
      return {
        id: String(entity.id || ''),
        name: String(entity.name || ''),
        tags: Array.isArray(entity.tags) ? entity.tags.slice(0, 20) : [],
        notes: String(entity.notes || '').slice(0, 2000),
        personality: String(entity.personality || '').slice(0, 1200),
        attrs: Array.isArray(entity.attrs) ? entity.attrs.slice(0, 12) : [],
        archetype: resolved.archetype,
        archetypeSource: resolved.source,
        archetypeConfidence: resolved.confidence
      };
    });
    const chapter = currentChapter() || {};
    const outlineChapter = currentOutlineChapter() || {};
    const scene = currentScene() || {};
    const dimensions = CHARACTER_DIMENSION_HINTS.filter(([, pattern]) => pattern.test(String(taskText || ''))).map(([id]) => id);
    const query = [taskText, chapter.title, chapter.sub, scene.name, outlineChapter.title, outlineChapter.synopsis, state.sceneProps && state.sceneProps.summary].filter(Boolean).join('；');
    const themes = state.outline && state.outline.book && Array.isArray(state.outline.book.themes) ? state.outline.book.themes : [];
    return {
      enabled: mode !== 'off',
      mode: mode === 'strong' ? 'strong' : 'auto',
      novelId: String(currentId || ''),
      characters,
      archetypes: characters.filter(item => item.archetypeSource === 'explicit').map(item => item.archetype).filter(Boolean).filter((value, index, list) => list.indexOf(value) === index),
      dimensions,
      query: query.slice(0, 1800),
      genre: [state.genre, ...themes].filter(Boolean).join('、').slice(0, 160),
      proseTask: mode !== 'off' && opts.proseTask !== false
    };
  }

  function novelContext(taskText, base) {
    return buildDynamicContext(taskText, base).text;
  }
  // ★ S4：采集本次 AI 调用实际注入的上下文规模（节点级上下文隔离可视化）
  // 复用 buildDynamicContext 的 meta（used=已注入字符数 / blocks=块列表 / ignoredEntities=被相关度过滤的设定数）
  function captureCtxMeta() {
    try {
      const dynamic = buildDynamicContext();
      const meta = (dynamic && dynamic.meta) || lastContextMeta || null;
      if (!meta) return null;
      return {
        chars: Number(meta.used) || 0,
        blocks: Array.isArray(meta.blocks) ? meta.blocks.length : 0,
        ignoredEntities: Number(meta.ignoredEntities) || 0
      };
    } catch (_) { return null; }
  }
  function ctxRow(label, value, last) {
    return '<div class="ctx-row' + (last ? ' ctx-row--last' : '') + '"><span class="ctx-label">' + esc(label) + '</span><span class="ctx-value">' + esc(value || '—') + '</span></div>';
  }
  // 把「当前上下文」卡片渲染为实时数据（剧情推演面板）
  function renderPlotContext() {
    const card = $('plotCtxCard'); if (!card) return;
    const dynamic = buildDynamicContext();
    const contextMeta = dynamic.meta || lastContextMeta;
    const o = state.outline;
    const ch = currentChapter();
    const sc = currentScene();
    const scIdx = ch.scenes.indexOf(sc) + 1;
    const oc = currentOutlineChapter();
    const el = (state.sceneProps && state.sceneProps.elements) || {};
    const summary = (state.sceneProps && state.sceneProps.summary) || (htmlToText(currentSceneContent()).slice(0, 80) + (currentSceneContent().length > 80 ? '…' : '')) || '（暂无）';
    const ocIdx = state.volumes[0].chapters.indexOf(ch);
    let html = '<h3 class="tv-card__title">当前上下文（实时）</h3>';
    html += ctxRow('当前章节', ch.title + (ch.sub ? (' · ' + ch.sub) : '') + ' · 场景 ' + scIdx + '/' + ch.scenes.length + ' · ' + countWords(ch.scenes.reduce((a, s) => a + s.content, '')) + ' 字');
    html += ctxRow('本章规划', (oc && oc.synopsis) ? oc.synopsis : '（无）');
    html += ctxRow('已写内容摘要', summary);
    html += ctxRow('本书简介', o.book.oneLine || '（无）');
    html += ctxRow('卷纲', o.volume.title + (o.volume.synopsis ? (' — ' + o.volume.synopsis) : ''));
    html += ctxRow('章节蓝图', '共 ' + o.chapters.length + ' 章，当前第 ' + ((ocIdx >= 0 ? ocIdx + 1 : '?')) + ' 章 [' + (oc ? oc.status : '') + ']');
    const recalledCharacters = (contextMeta.entities || []).filter(e => e.type === 'character');
    const recalledSettings = (contextMeta.entities || []).filter(e => ['location', 'faction', 'itemCategory', 'itemRank', 'item', 'event'].includes(e.type));
    html += ctxRow('动态召回', '人物 ' + recalledCharacters.length + ' 条；设定 ' + recalledSettings.length + ' 条；实体共 ' + (contextMeta.entities || []).length + ' 条');
    html += ctxRow('上下文', String(contextMeta.used || 0) + ' / ' + contextMeta.budget + ' 字；模型窗口约 ' + formatContextWindow(contextWindowForModel(currentUnifiedModel())) + (contextMeta.truncated ? '（已按预算截断）' : ''));
    html += ctxRow('关联伏笔', (contextMeta.foreshadows || []).length + ' 条', true);
    card.innerHTML = html;
  }

  /* ---------------- 写作技能 / 本地素材（与首页同源能力） ---------------- */
  // 服务端技能 + 本地文件夹载入的技能/素材，统一注入 AI system prompt
  const skillsMap = {};
  let selectedSkillIds = [];
  let globalSkillIds = [];
  const DEFAULT_WRITING_SKILL_ID = 'write-high-tension-fiction';
  let localSkills = [];
  let localMaterial = [];
  let skillsReady = Promise.resolve();
  let skillSyncReady = Promise.resolve();
  let skillsLoadError = null;
  let dissectionHandoffApplied = null;
  let localMaterialEnabled = true;
  const TEXT_EXT = /\.(txt|md|markdown|json|csv|yaml|yml|text|log|srt|ass|vtt|xml|toml|html?)$/i;
  const BINARY_EXT = /\.(png|jpe?g|gif|bmp|webp|ico|pdf|zip|rar|7z|exe|dll|docx?|xlsx?|pptx?|mp3|mp4|wav|avi|mov|mkv|bin|dat|woff2?|ttf|eot|skp|psd)$/i;
  const SKIP_DIR = /^(__MACOSX|node_modules|\.git|\.svn|dist|build|\.DS_Store)$/;

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

  function dissectionTraitLine(item, index, key) {
    if (typeof item === 'string') return item.trim();
    if (!item || typeof item !== 'object') return '';
    const label = item.feature_id || item.axis || item.name || item.title || key || ('trait-' + (index + 1));
    const rule = item.rule || item.text || item.summary || item.description || '';
    const parts = [String(label) + (rule ? ': ' + String(rule) : '')];
    if (Array.isArray(item.scope) && item.scope.length) parts.push('scope=' + item.scope.join(', '));
    if (Array.isArray(item.exceptions) && item.exceptions.length) parts.push('exceptions=' + item.exceptions.join('; '));
    if (item.confidence != null) parts.push('confidence=' + item.confidence);
    if (item.status) parts.push('status=' + item.status);
    if (item.positive_example) parts.push('positive=' + item.positive_example);
    if (item.counterexample) parts.push('counter=' + item.counterexample);
    return parts.join(' | ').trim();
  }

  function dissectionRuleLines(value) {
    if (Array.isArray(value)) return value.map((item, index) => dissectionTraitLine(item, index, '')).filter(Boolean);
    if (!value || typeof value !== 'object') return value ? [String(value)] : [];
    return Object.entries(value).flatMap(([key, item], index) => {
      if (Array.isArray(item)) return item.map((child, childIndex) => dissectionTraitLine(child, childIndex, key)).filter(Boolean);
      return [dissectionTraitLine(item, index, key)].filter(Boolean);
    });
  }

  function composeDissectionSkill(handoff) {
    const style = handoff && handoff.styleProfile && typeof handoff.styleProfile === 'object' ? handoff.styleProfile : {};
    const styleSummary = String(style.summary || style.identity || '').trim();
    const dimensions = dissectionRuleLines(style.dimensions || style.axes || {});
    const craft = dissectionRuleLines(handoff && handoff.craftConstraints);
    const sections = [
      '\u3010Scope\u3011Apply only the transferable prose behavior and general storytelling craft extracted from a completed book dissection.',
      '\u3010Boundary\u3011Never import the source book\'s names, places, factions, items, events, terminology, plot order, signature phrasing, or canon. Follow the current novel\'s knowledge base and user instructions when they differ.',
      styleSummary ? '\u3010Style summary\u3011\n' + styleSummary.slice(0, 1800) : '',
      dimensions.length ? '\u3010Transferable style dimensions\u3011\n' + dimensions.slice(0, 80).map(line => '- ' + line.slice(0, 900)).join('\n') : '',
      craft.length ? '\u3010Transferable craft constraints\u3011\n' + craft.slice(0, 80).map(line => '- ' + line.slice(0, 900)).join('\n') : '',
      '\u3010Execution\u3011Treat unsupported or low-confidence observations as preferences, not hard rules. Preserve causality, viewpoint, current-novel canon, and the requested output target. Return fiction or requested content only; do not put analysis into the novel text.'
    ].filter(Boolean).join('\n\n');
    if (!styleSummary && !dimensions.length && !craft.length) return null;
    const sourceId = String(handoff.sourceId || 'style').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 48) || 'style';
    const id = 'dissect-' + sourceId;
    return {
      id,
      name: '\u62c6\u4e66\u6587\u98ce\u4e0e\u521b\u4f5c\u6280\u6cd5',
      description: '\u4ec5\u5305\u542b\u53ef\u8fc1\u79fb\u7684\u6587\u98ce\u4e0e\u521b\u4f5c\u6280\u6cd5\uff0c\u4e0d\u5e26\u5165\u539f\u4e66\u8bbe\u5b9a',
      instruction: sections.slice(0, 16000),
      local: true,
      source: 'dissection',
      sourceId,
      updatedAt: Date.now()
    };
  }

  function loadNovelSkillDefinitions(novelState) {
    const definitions = novelState && novelState.aiSkillDefinitions;
    if (!definitions || typeof definitions !== 'object') return;
    const pending = [];
    Object.values(definitions).forEach(skill => {
      if (skill && skill.id && skill.instruction) {
        skillsMap[skill.id] = skill;
        if (skill.local || skill.source === 'dissection' || String(skill.id).startsWith('dissect-')) pending.push(skill);
      }
    });
    if (pending.length) {
      const syncIdentity = storageIdentity();
      skillSyncReady = skillSyncReady.then(() => syncLocalSkillsToCloud(pending, syncIdentity));
    }
  }

  async function loadSkills() {
    skillsLoadError = null;
    try {
      const requestIdentity = storageIdentity();
      const headers = {};
      const token = getToken();
      if (token) headers.Authorization = 'Bearer ' + token;
      Object.keys(skillsMap).forEach(id => { if (id.indexOf('user-') === 0 || id.indexOf('global-') === 0) delete skillsMap[id]; });
      const res = await fetch(API_BASE + '/api/skills', { headers, cache: 'no-store' });
      if (!res.ok) throw new Error('Skill 服务返回 HTTP ' + res.status);
      const list = await res.json();
      if (storageIdentity() !== requestIdentity) return;
      if (!Array.isArray(list)) throw new Error('Skill 服务返回格式无效');
      const previousSkills = { ...skillsMap };
      const previousSelectedSkillIds = selectedSkillIds.slice();
      Object.keys(skillsMap).forEach(id => { if (id.indexOf('local-') !== 0 && id.indexOf('dissect-') !== 0) delete skillsMap[id]; });
      const uniqueList = uniqueSkillsById(list);
      const autoIds = uniqueList.filter(s => s && s.global && s.autoApply && s.enabled !== false).map(s => s.id);
      if (uniqueList.some(s => s && s.id === DEFAULT_WRITING_SKILL_ID && s.enabled !== false)) autoIds.push(DEFAULT_WRITING_SKILL_ID);
      globalSkillIds = [...new Set(autoIds)];
      const winners = new Map();
      uniqueList.forEach(s => {
        if (!s || !s.id) return;
        skillsMap[s.id] = s;
        winners.set(skillIdentityKey(s), s.id);
      });
      selectedSkillIds = previousSelectedSkillIds.map(id => {
        const oldSkill = previousSkills[id] || { id };
        return winners.get(skillIdentityKey(oldSkill)) || id;
      });
      const availableIds = new Set(Object.keys(skillsMap));
      selectedSkillIds = selectedSkillIds.filter(id => availableIds.has(id) || globalSkillIds.includes(id));
      if (state && Array.isArray(selectedSkillIds)) state.aiSkills = selectedSkillIds.slice();
      renderSkillMenu(); updateSkillTag();
      return uniqueList;
    } catch (error) {
      skillsLoadError = error;
      renderSkillMenu();
      updateSkillTag();
      return [];
    }
  }
  function makeSkillMenuItem(s) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'skill-menu__item'; b.dataset.skillId = s.id;
    if (isAutoAppliedSkill(s)) { b.classList.add('global-skill'); b.title = s.id === DEFAULT_WRITING_SKILL_ID ? '默认写作 Skill：正文生成时自动应用' : '全局 Skill：已自动应用'; }
    b.innerHTML = '<span class="skill-menu__name">' + esc(s.name || s.id) + '</span>' + (s.description ? '<span class="skill-menu__sub">' + esc(String(s.description).slice(0, 60)) + '</span>' : '');
    b.onclick = () => {
      if (isAutoAppliedSkill(s)) return;
      const i = selectedSkillIds.indexOf(s.id);
      if (i >= 0) selectedSkillIds.splice(i, 1); else selectedSkillIds.push(s.id);
      syncSkillMenuChecked(); updateSkillTag(); state.aiSkills = selectedSkillIds.slice(); save();
    };
    return b;
  }
  function renderSkillMenu() {
    const menus = ['skillMenu', 'skillMenu2', 'skillMenuR'].map(id => $(id)).filter(Boolean);
    if (!menus.length) return;
    menus.forEach(menu => {
      menu.innerHTML = ''; menu.onclick = e => e.stopPropagation();
      // 阻止 wheel 事件冒泡到右栏 .rp-messages（它有 overflow-y:auto，会抢走滚轮）
      menu.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
      if (skillsLoadError) {
        menu.innerHTML = '<div class="skill-menu__empty">技能加载失败，请稍后重试</div>';
        return;
      }
      const ids = Object.keys(skillsMap);
      if (!ids.length) { menu.innerHTML = '<div class="skill-menu__empty">暂无可用技能（可在服务端 skills 目录放入 SKILL.md）</div>'; return; }
      const none = document.createElement('button');
      none.type = 'button'; none.className = 'skill-menu__item';
      none.innerHTML = '<span class="skill-menu__name">无（默认）</span><span class="skill-menu__sub">不使用额外技能</span>';
      none.onclick = () => { selectedSkillIds = []; syncSkillMenuChecked(); updateSkillTag(); state.aiSkills = []; save(); menu.hidden = true; };
      menu.appendChild(none);
      ids.forEach(id => menu.appendChild(makeSkillMenuItem(skillsMap[id])));
      syncSkillMenuChecked();
    });
  }
  function syncSkillMenuChecked() {
    ['skillMenu', 'skillMenu2', 'skillMenuR'].forEach(id => {
      const menu = $(id); if (!menu) return;
      menu.querySelectorAll('button[data-skill-id]').forEach(b => b.classList.toggle('checked', effectiveSkillIds().includes(b.dataset.skillId)));
    });
  }
  function effectiveSkillIds() { return [...new Set(globalSkillIds.concat(selectedSkillIds))]; }
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
  function skillModeForMessages(messages) {
    const system = (Array.isArray(messages) ? messages : []).find(message => message && message.role === 'system');
    const content = String(system && system.content || '');
    const base = content.split('【墨阑 Skill 运行状态】')[0].split('[MOLAN_SKILL_BLOCK_BEGIN')[0];
    return skillModeForTask(base);
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
  async function buildSystemReady(base, taskText) {
    await skillsReady;
    const mode = skillModeForTask(base);
    const missing = activeSkillsForMode(mode).filter(skill => {
      return !skill || !promptInstructionForSkill(skill) || skill.complete === false;
    }).map(skill => skill.id);
    if (skillsLoadError || missing.length) {
      const incomplete = missing.some(id => skillsMap[id] && skillsMap[id].complete === false);
      toast(skillsLoadError ? 'Skill 服务暂不可用，请稍后重试' : incomplete ? '检测到旧版 Skill 只有文件名，无法完整恢复；请重新上传整个 Skill 文件夹' : '已选 Skill 尚未完整加载，请稍后重试');
      return '';
    }
    return buildSystem(base, taskText);
  }
  function updateSkillTag() {
    const nS = effectiveSkillIds().length, nL = localMaterial.filter(m => m.include && m.text && m.text.trim()).length;
    const txt = ((nS ? '技能 ' + nS + ' · 已加载' : '') + (nS && nL ? ' · ' : '') + (nL ? '素材 ' + nL : '')) || '无技能';
    const on = !!(nS || nL);
    ['localTag', 'localTag2', 'localTagR'].forEach(id => {
      const tag = $(id); if (!tag) return;
      tag.textContent = tag.classList.contains('rp-skill-mode') ? ('技能模式 · ' + txt) : txt;
      tag.classList.toggle('is-on', on);
    });
  }
  function skillModeForTask(base) {
    const text = String(base || '');
    if (/去\s*AI|去ai味|人味|校正|润色|降低模板化|改写正文/.test(text)) return 'humanize';
    if (/资料抽取|抽取引擎|抽取可被|拆书|文风提取/.test(text)) return 'extract';
    if (/一致性|审核引擎|检测助手|AI 文本检测/.test(text)) return 'analyze';
    return 'write';
  }
  function buildSkillBlock(base) {
    let sys = base || '你是一位专业的中文网络小说写作助手。';
    const mode = skillModeForTask(base);
    const selected = activeSkillsForMode(mode);
    if (selected.length) {
      const names = selected.map(s => s.name || s.id).join('、');
      const mode = skillModeForTask(base);
      sys += '\n\n【墨阑 Skill 运行状态】\n已加载：' + names + '\n当前模式：' + mode + '\n请只执行与当前模式对应的技能规则；技能规则不能覆盖用户最新指令、当前作品设定或事实约束。\n';
      selected.forEach(s => {
        const instruction = promptInstructionForSkill(s);
        const auditId = encodeURIComponent(String(s.id || ''));
        sys += '\n--- 技能「' + (s.name || s.id) + '」(' + s.id + ') 规范 ---\n' +
          '[MOLAN_SKILL_BLOCK_BEGIN id=' + auditId + ']\n' + instruction +
          '\n[MOLAN_SKILL_BLOCK_END id=' + auditId + ']';
      });
    }
    return sys;
  }
  function buildMaterialBlock() {
    const included = localMaterial.filter(m => m.include && m.text && m.text.trim());
    if (!included.length) return '';
    const parts = included.map(m => '### 文件：' + m.relPath + '\n\n' + String(m.text));
    let header = '以下是用户载入的本地素材库内容（作为写作参考与背景知识，请优先遵循其中的设定、人物与世界观）：';
    return truncateEditorLocalUtf8Head(header + '\n\n' + parts.join('\n\n'), EDITOR_LOCAL_MATERIAL_PROMPT_LIMIT_BYTES, '\n\n[墨阑提示：本地素材合计超过单条消息限制，已按文件顺序保留前部内容。]').text;
  }
  function buildSystem(base, taskText) {
    let sys = rolePrefix() + '\n' + buildSkillBlock(base);
    const mat = buildMaterialBlock();
    if (mat) sys += '\n\n' + mat;
    // Reusable skills/material stay before the cache breakpoint. Novel state,
    // current chapter and inspiration cards change frequently and follow it.
    sys += '\n\n<!-- molan-dynamic-context-v2 -->\n' + novelContext(taskText, base);
    sys += inspirationBlock();
    return sys;
  }
  /* ---------- 本地文件夹载入（含 SKILL.md 的子目录 → 技能；其余文本 → 素材库） ---------- */
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

function composeLocalSkill(id, raw, fileMap, fileMeta) {
    const { name, description, body } = parseLocalFrontmatter(raw);
    const runtimeFiles = Object.create(null);
    const loadedFiles = Object.keys(fileMap || {}).sort();
    const parts = [body];
    loadedFiles.forEach(filePath => {
      const content = String(fileMap[filePath] == null ? '' : fileMap[filePath]);
      runtimeFiles[filePath] = content;
      if (filePath === 'SKILL.md') return;
      parts.push('\n\n### Skill file: `' + filePath + '`\n\n' + content);
    });
    if (!Object.prototype.hasOwnProperty.call(runtimeFiles, 'SKILL.md')) runtimeFiles['SKILL.md'] = raw;
    const instruction = parts.join('');
    const truncatedFiles = loadedFiles.filter(filePath => fileMeta && fileMeta[filePath] && fileMeta[filePath].truncated);
    const skill = { id, name: name || id, description, instruction, runtimeInstruction: instruction, runtimeFiles, files: loadedFiles, fileManifest: loadedFiles.map(path => {
      const meta = fileMeta && fileMeta[path];
      return { path, type: 'text', size: String(runtimeFiles[path] || '').length, originalSize: Number(meta && meta.size) || String(runtimeFiles[path] || '').length, loadedBytes: Number(meta && meta.loadedBytes) || editorLocalUtf8ByteLength(runtimeFiles[path] || ''), truncated: !!(meta && meta.truncated) };
    }), truncatedFiles, complete: true, local: true, size: instruction.length };
    return { ...skill, promptFiles: promptFilesForSkill(skill), promptInstruction: promptInstructionForSkill(skill) };
  }

  const EDITOR_LOCAL_TEXT_READ_LIMIT_BYTES = 2 * 1024 * 1024;
  const EDITOR_LOCAL_TRUNCATION_MARKER = '\n\n[墨阑提示：文件内容超过读取限制，已保留前部内容。]';
  const EDITOR_LOCAL_MATERIAL_PROMPT_LIMIT_BYTES = 2 * 1024 * 1024;

  function editorLocalUtf8ByteLength(value) {
    const text = String(value == null ? '' : value);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
    return unescape(encodeURIComponent(text)).length;
  }

  function decodeEditorTextBuffer(buffer) {
    if (typeof TextDecoder === 'undefined') return { text: '', encoding: 'utf-8' };
    const bytes = new Uint8Array(buffer || 0);
    let offset = 0;
    let encoding = 'utf-8';
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) offset = 3;
    else if (bytes[0] === 0xFF && bytes[1] === 0xFE) { offset = 2; encoding = 'utf-16le'; }
    else if (bytes[0] === 0xFE && bytes[1] === 0xFF) { offset = 2; encoding = 'utf-16be'; }
    const decode = label => {
      try { return new TextDecoder(label, { fatal: label === 'utf-8' }).decode(bytes.subarray(offset)); } catch (_) { return ''; }
    };
    let text = decode(encoding);
    if (!text && encoding === 'utf-8' && bytes.length > offset) {
      text = decode('gb18030') || decode('gbk');
      if (text) encoding = 'gb18030';
    }
    return { text: String(text || '').replace(/\uFEFF/g, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n'), encoding };
  }

  async function readEditorTextFile(file) {
    if (file && typeof file.arrayBuffer === 'function') {
      const decoded = decodeEditorTextBuffer(await file.arrayBuffer());
      return decoded.text.trim();
    }
    return String(file && typeof file.text === 'function' ? await file.text() : '').replace(/\uFEFF/g, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  }

  function truncateEditorLocalUtf8Head(value, maxBytes, marker) {
    const source = String(value == null ? '' : value);
    const limit = Math.max(0, Math.floor(Number(maxBytes) || 0));
    if (editorLocalUtf8ByteLength(source) <= limit) return { text: source, truncated: false, bytes: editorLocalUtf8ByteLength(source) };
    const suffix = String(marker == null ? EDITOR_LOCAL_TRUNCATION_MARKER : marker);
    const suffixBytes = editorLocalUtf8ByteLength(suffix);
    const codePoints = Array.from(source);
    let low = 0;
    let high = codePoints.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const head = codePoints.slice(0, middle).join('');
      if (editorLocalUtf8ByteLength(head) <= Math.max(0, limit - suffixBytes)) low = middle;
      else high = middle - 1;
    }
    const text = codePoints.slice(0, low).join('') + (suffixBytes <= limit ? suffix : '');
    return { text, truncated: true, bytes: editorLocalUtf8ByteLength(text) };
  }

  async function readEditorLocalTextHead(file) {
    const originalSize = Number(file && file.size) || 0;
    const limit = EDITOR_LOCAL_TEXT_READ_LIMIT_BYTES;
    const readSize = Math.min(originalSize, limit + 3);
    const buffer = await file.slice(0, readSize).arrayBuffer();
    const decoded = decodeEditorTextBuffer(buffer);
    const text = decoded.text;
    const bounded = truncateEditorLocalUtf8Head(text, limit);
    return { text: bounded.text, size: originalSize, loadedBytes: bounded.bytes, truncated: originalSize > limit || bounded.truncated };
  }

  async function readDirHandle(handle, prefix) {
    const out = [];
    for await (const [name, entry] of handle.entries()) {
      if (SKIP_DIR.test(name)) continue;
      const rel = prefix ? prefix + '/' + name : name;
      if (entry.kind === 'file') {
        if (BINARY_EXT.test(name)) continue;
        let loaded = null;
        try { const file = await entry.getFile(); loaded = await readEditorLocalTextHead(file); }
        catch (_) { continue; }
        if (loaded && loaded.text && loaded.text.trim()) out.push({ relPath: rel, name, ...loaded });
      } else if (entry.kind === 'directory') {
        const sub = await readDirHandle(entry, rel);
        out.push(...sub);
      }
    }
    return out;
  }
  function pickViaInput(inputId) {
    return new Promise(resolve => {
      const textOnly = inputId === 'textFilesInputR' || inputId === 'textFilesInput';
      const inp = $(inputId || 'folderInputR') || $('folderInput');
      if (!inp) return resolve([]);
      const handler = async () => {
        inp.removeEventListener('change', handler);
        const files = [];
        for (const f of inp.files) {
          const rel = f.webkitRelativePath || f.name;
          if (BINARY_EXT.test(rel) || (textOnly && !TEXT_EXT.test(rel))) continue;
          let loaded = null; try { loaded = await readEditorLocalTextHead(f); } catch (_) { continue; }
          if (loaded && loaded.text && loaded.text.trim()) files.push({ relPath: rel, name: f.name, ...loaded });
        }
        resolve(files);
      };
      inp.value = ''; inp.addEventListener('change', handler); inp.click();
    });
  }
  async function loadLocalFolder() {
    let files = [];
    if (window.showDirectoryPicker) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        files = await readDirHandle(dirHandle, '');
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        files = await pickViaInput();
      }
    } else {
      files = await pickViaInput();
    }
    if (!files || !files.length) { toast('未选择文件或文件夹为空'); return; }
    ingestFiles(files);
  }
  async function loadLocalTextFiles() {
    const files = await pickViaInput('textFilesInputR');
    if (!files || !files.length) { toast('未选择可读取的文本文件'); return; }
    ingestFiles(files);
  }
  function openLocalImportChooser() {
    const modal = openModal(
      '<h3 class="ml-modal__title">载入技能 / 素材</h3>' +
      '<p class="ml-modal__hint">可以导入包含 <code>SKILL.md</code> 的技能文件夹，也可以直接选择一个或多个 <code>.txt</code>、<code>.md</code> 等文本文件作为素材。</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;">' +
        '<button class="tv-btn tv-btn--primary" id="chooseLocalFolder" type="button">📁 选择文件夹</button>' +
        '<button class="tv-btn" id="chooseLocalTextFiles" type="button">📄 选择文本文件</button>' +
      '</div>',
      { wide: true }
    );
    const folderBtn = modal && modal.querySelector('#chooseLocalFolder');
    const textBtn = modal && modal.querySelector('#chooseLocalTextFiles');
    if (folderBtn) folderBtn.onclick = () => { closeModal(); loadLocalFolder(); };
    if (textBtn) textBtn.onclick = () => { closeModal(); loadLocalTextFiles(); };
  }
  function ingestFiles(files) {
    const skillRoots = [], skillDirs = [], material = [];
    for (const f of files) {
      if (!f.text || !f.text.trim()) continue;
      if (/(^|\/)SKILL\.md$/i.test(f.relPath)) {
        skillRoots.push(f);
        skillDirs.push(f.relPath.replace(/SKILL\.md$/i, '').replace(/\/$/, ''));
      }
    }
    for (const f of files) {
      if (!f.text || !f.text.trim() || !TEXT_EXT.test(f.relPath)) continue;
      const inSkill = skillDirs.some(d => d === '' ? !f.relPath.includes('/') : f.relPath.startsWith(d + '/'));
      if (!inSkill) material.push(f);
    }
    const importedSkills = [];
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
      const ex = localSkills.findIndex(x => x.id === id);
      if (ex >= 0) localSkills[ex] = sk; else localSkills.push(sk);
      importedSkills.push(sk);
    }
    const seen = new Set(localMaterial.map(m => m.relPath));
    for (const f of material) {
      if (seen.has(f.relPath)) continue;
      seen.add(f.relPath);
      localMaterial.push({ relPath: f.relPath, name: f.name, size: f.size, loadedBytes: f.loadedBytes, truncated: !!f.truncated, text: f.text, include: true });
    }
    if (!skillRoots.length && !material.length) { toast('所选来源没有可载入的 SKILL.md 或文本文件'); return; }
    importedSkills.forEach(skill => {
      if (skill && skill.id && !selectedSkillIds.includes(skill.id)) selectedSkillIds.push(skill.id);
    });
    state.aiSkills = selectedSkillIds.slice();
    save();
    renderSkillMenu(); updateSkillTag();
    toast('已载入 ' + localSkills.length + ' 个本地技能、' + localMaterial.length + ' 个素材文件');
    if (importedSkills.length) {
      const syncIdentity = storageIdentity();
      skillSyncReady = skillSyncReady.then(() => syncLocalSkillsToCloud(importedSkills, syncIdentity));
    }
  }
  function renderLocalPanel() {
    const nS = localSkills.length, nMat = localMaterial.length;
    let html = '<h3 class="ml-modal__title">本地技能 / 素材库</h3>';
    html += '<p class="ml-modal__hint">登录后，上传的 Skill 会自动保存到当前账户的云端并可持续调用；同步失败的 Skill 可在这里重试。素材文件仍只在本次会话使用。</p>';
    if (nS) {
      html += '<div style="margin:10px 0 6px;font-weight:600;">本地技能（' + nS + '）</div>';
      html += localSkills.map(s => '<div class="lib-row"><div class="lib-row__main"><div class="lib-name">' + esc(s.name || s.id) + '</div><div class="lib-meta">' + (s.description ? esc(String(s.description).slice(0, 40)) : '') + '</div></div><button class="lib-btn lib-btn--primary" type="button" data-solidify="' + esc(s.id) + '">重试同步</button></div>').join('');
    }
    html += '<div style="margin:12px 0 8px;font-weight:600;">本地素材库（' + nMat + ' 文件）</div>';
    if (nMat) {
      html += '<label class="ml-text-xs" style="display:inline-flex;gap:4px;align-items:center;cursor:pointer;margin-bottom:8px;"><input type="checkbox" id="localMatToggle"' + (localMaterialEnabled ? ' checked' : '') + '> 启用注入 system prompt</label>';
      html += localMaterial.map((m, i) => '<label class="lib-row__main" style="cursor:pointer;display:flex;gap:8px;align-items:center;margin:4px 0;"><input type="checkbox" data-mat="' + i + '"' + (m.include ? ' checked' : '') + '><div style="min-width:0;"><div class="lib-name truncate">' + esc(m.relPath) + '</div><div class="lib-meta">' + (m.size || 0) + ' 字节' + (m.truncated ? ' · 已读取前部' : '') + '</div></div></label>').join('');
    } else {
      html += '<div class="lib-empty">尚未载入本地内容。可以选择包含技能（含 SKILL.md）的文件夹，也可以直接选择 txt、md 等文本文件。</div>';
    }
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;"><button class="tv-btn tv-btn--primary" id="localLoadBtn" type="button" style="flex:1;min-width:150px;">📁 载入文件夹</button><button class="tv-btn" id="localTextLoadBtn" type="button" style="flex:1;min-width:150px;">📄 载入文本文件</button>' + (nS || nMat ? '<button class="tv-btn" id="localClearBtn" type="button">清空</button>' : '') + '</div>';
    const modal = openModal(html, { wide: true });
    const lm = modal.querySelector('#localMatToggle'); if (lm) lm.onchange = () => { localMaterialEnabled = lm.checked; updateSkillTag(); };
    modal.querySelectorAll('[data-mat]').forEach(c => c.onchange = () => { const i = +c.getAttribute('data-mat'); if (localMaterial[i]) { localMaterial[i].include = c.checked; updateSkillTag(); } });
    const lb = modal.querySelector('#localLoadBtn'); if (lb) lb.onclick = () => { closeModal(); loadLocalFolder(); };
    const ltb = modal.querySelector('#localTextLoadBtn'); if (ltb) ltb.onclick = () => { closeModal(); loadLocalTextFiles(); };
    modal.querySelectorAll('[data-solidify]').forEach(b => b.onclick = () => solidifySkill(b.getAttribute('data-solidify')));
    const lc = modal.querySelector('#localClearBtn'); if (lc) lc.onclick = () => {
      localSkills = []; localMaterial = [];
      Object.keys(skillsMap).forEach(k => { if (k.indexOf('local-') === 0) delete skillsMap[k]; });
      selectedSkillIds = selectedSkillIds.filter(id => id.indexOf('local-') !== 0);
      state.aiSkills = selectedSkillIds.slice(); save();
      renderSkillMenu(); updateSkillTag(); renderLocalPanel(); toast('已清空本地技能与素材');
    };
  }
  async function uploadSkillToCloud(skill) {
    const token = getToken();
    if (!token) throw new Error('请先登录，登录后上传的 Skill 才会保存到云端');
    const res = await fetch(API_BASE + '/api/skills/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        name: skill.name || skill.id,
        description: skill.description || '',
        instruction: skill.instruction || '',
        files: Array.isArray(skill.files) ? skill.files : [],
        runtimeFiles: skill.runtimeFiles && typeof skill.runtimeFiles === 'object' ? skill.runtimeFiles : {},
        fileManifest: Array.isArray(skill.fileManifest) ? skill.fileManifest : [],
        slug: skill.id || skill.name || 'skill'
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.skill) throw new Error(data.error || ('HTTP ' + res.status));
    return { ...data.skill, source: 'user', global: false, autoApply: false };
  }
  function replaceLocalSkillWithCloud(localId, cloudSkill) {
    const wasSelected = selectedSkillIds.includes(localId);
    delete skillsMap[localId];
    localSkills = localSkills.filter(item => item.id !== localId);
    skillsMap[cloudSkill.id] = cloudSkill;
    if (state && state.aiSkillDefinitions && state.aiSkillDefinitions[localId]) {
      delete state.aiSkillDefinitions[localId];
      state.aiSkillDefinitions[cloudSkill.id] = cloudSkill;
    }
    if (wasSelected) {
      selectedSkillIds = selectedSkillIds.filter(id => id !== localId);
      if (!selectedSkillIds.includes(cloudSkill.id)) selectedSkillIds.push(cloudSkill.id);
    }
  }
  async function syncLocalSkillsToCloud(skills, expectedIdentity) {
    if (!getToken()) {
      toast('未登录：Skill 暂时仅本地可用；登录后重新上传即可自动保存到云端');
      return;
    }
    const requestIdentity = expectedIdentity || storageIdentity();
    if (storageIdentity() !== requestIdentity) return;
    let synced = 0, failed = 0;
    for (const skill of skills || []) {
      if (storageIdentity() !== requestIdentity) return;
      try {
        const cloudSkill = await uploadSkillToCloud(skill);
        replaceLocalSkillWithCloud(skill.id, cloudSkill);
        synced++;
      } catch (_) {
        failed++;
      }
      renderSkillMenu(); updateSkillTag();
    }
    state.aiSkills = selectedSkillIds.slice(); save();
    if (failed) toast('已同步 ' + synced + ' 个 Skill，' + failed + ' 个失败，可在本地技能面板重试');
    else if (synced) toast('已自动保存 ' + synced + ' 个 Skill 到云端');
  }
  async function solidifySkill(id) {
    const s = skillsMap[id]; if (!s) return;
    const requestIdentity = storageIdentity();
    const wasSelected = selectedSkillIds.includes(id);
    toast('正在固化技能「' + (s.name || id) + '」到服务器…');
    try {
      const cloudSkill = await uploadSkillToCloud(s);
      if (storageIdentity() !== requestIdentity) return;
      // 移除本次会话的 local 副本，转为服务器永久技能
      replaceLocalSkillWithCloud(id, cloudSkill);
      skillsReady = loadSkills();
      await skillsReady;
      syncSkillMenuChecked(); updateSkillTag(); state.aiSkills = selectedSkillIds.slice(); save();
      renderLocalPanel();
      toast('已固化为永久技能：' + (s.name || id));
    } catch (e) { toast('固化失败：' + (e && e.message ? e.message : e)); }
  }
  function switchTab(tab) {
    qa('.editor-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === tab));
    tabViews.forEach(v => v.classList.toggle('is-active', v.dataset.view === tab));
    const immersive = (tab === 'immersive');
    if (immersive && editorContent && immersiveEditor) immersiveEditor.innerHTML = editorContent.innerHTML;
    if (sidebar) sidebar.style.display = immersive ? 'none' : '';
    if (rightPanel) rightPanel.style.display = immersive ? 'none' : '';
    const sb = q('.editor-statusbar'); if (sb) sb.style.display = immersive ? 'none' : '';
    if (tab === 'outline') renderOutline();
    if (tab === 'timeline') renderTimeline();
    if (tab === 'plot') renderPlotContext();
    if (tab === 'ai') { const box = q('#aiToolResult'); if (box) box.scrollIntoView({ behavior: 'instant', block: 'nearest' }); }
  }

  /* ---------------- 侧栏视图切换（设定集 / 资源 / 伏笔 / 大纲 / 章节目录 / AI续写 / AI检测 / 回收站 / 搜索替换） ---------------- */
  const SIDEBAR_VIEW_MAP = { sheji: 'sbSheji', resources: 'sbResources', foreshadow: 'sbForeshadow', dagang: 'sbDagang', xigang: 'sbXigang', ai: 'sbAI', aidetect: 'sbAIDetect', recycle: 'sbRecycle', search: 'sbSearch' };
  // 切换侧栏标签：根据 data-tab 切换视图，并触发对应渲染
  function switchSidebarTab(tab) {
    qa('.sidebar-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === tab));
    qa('.sidebar-view').forEach(v => v.classList.toggle('is-active', v.id === SIDEBAR_VIEW_MAP[tab]));
    if (tab === 'dagang') renderSidebarOutline();
    else if (tab === 'sheji') renderSidebarSheji();
    else if (tab === 'resources') renderSidebarResources();
    else if (tab === 'foreshadow') renderSidebarForeshadow();
    else if (tab === 'ai') renderSidebarAI();
    else if (tab === 'aidetect') renderAIDetect();
    else if (tab === 'recycle') renderRecycle();
    // search 标签为静态面板，无需渲染
  }
  function renderSidebarOutline() {
    const body = $('sbDagangBody'); if (!body) return;
    ensureOutlineChapters();
    const o = state.outline;
    let html = '<div class="sb-sec-title">大纲概览</div><div class="sb-line"><b>' + esc(o.book.title) + '</b></div><div class="sb-text">' + esc(o.book.oneLine) + '</div>';
    html += '<div class="sb-sec-title" style="margin-top:14px;">卷纲</div><div class="sb-line">' + esc(o.volume.title) + '</div><div class="sb-text">' + esc(o.volume.synopsis) + '</div>';
    html += '<div class="sb-sec-title" style="margin-top:14px;">章节蓝图（' + o.chapters.length + '）</div>';
    html += o.chapters.map(c => '<div class="sb-ch"><span class="sb-ch__num">' + esc(c.num) + '</span><span class="sb-ch__title">' + esc(c.title) + '</span><span class="sb-ch__status sb-ch__status--' + (c.status || 'todo') + '"></span></div>').join('');
    html += '<button class="tv-btn tv-btn--ghost tv-btn--block" id="sidebarOutlineEdit" type="button" style="margin-top:14px;">打开大纲编辑</button>';
    body.innerHTML = html;
    const edit = $('sidebarOutlineEdit'); if (edit) edit.onclick = () => switchTab('outline');
  }
  function renderSidebarResources() {
    const body = $('sbResourcesBody'); if (!body) return;
    ensureKnowledge(); ensureReferenceMaterials(); ensureAdvancedState();
    const query = String(($('resourceSearch') && $('resourceSearch').value) || '').trim().toLowerCase();
    const type = ($('resourceTypeFilter') && $('resourceTypeFilter').value) || '';
    const resources = [];
    state.volumes.forEach(volume => (volume.chapters || []).forEach(chapter => {
      const text = (chapter.scenes || []).map(scene => htmlToText(scene.content || '')).join('\n\n');
      resources.push({
        kind: 'manuscript',
        id: chapter.id,
        name: chapter.title + (chapter.sub ? ' · ' + chapter.sub : ''),
        type: '正文',
        text: text || '（空章节）',
        meta: (volume.title || '未命名卷') + ' · ' + countWords(text) + ' 字'
      });
    }));
    ensureReferenceMaterials().forEach(item => resources.push({ kind: 'reference', id: item.id, name: item.name || '未命名资料', type: item.type || 'reference', text: item.text || '', meta: (item.text || '').length + ' 字' }));
    entList().forEach(item => resources.push({ kind: 'entity', id: item.id, name: item.name, type: entityTypeMeta(item.type).label, text: [item.notes, (item.attrs || []).map(a => a.k + '：' + a.v).join('；')].filter(Boolean).join('\n'), meta: entityPath(item) || '设定集' }));
    (state.inspirations || []).forEach(item => resources.push({ kind: 'inspiration', id: item.id, name: item.title || '未命名灵感', type: '灵感卡片', text: item.content || '', meta: item.tag || '灵感' }));
    (state.aiReports || []).forEach(item => resources.push({ kind: 'report', id: item.id, name: item.chapterTitle || '章节检测报告', type: 'AI报告', text: item.summary || '', meta: item.status || '未完成' }));
    const filtered = resources.filter(item => (!type || item.kind === type || item.type === type) && (!query || (item.name + ' ' + item.type + ' ' + item.text + ' ' + item.meta).toLowerCase().includes(query)));
    let html = '<div class="sb-sec-title">作品资源中心</div><div class="sb-text">正文、设定、资料、灵感和 AI 报告统一从这里查找。</div>';
    html += '<div class="resource-toolbar"><input id="resourceSearch" placeholder="搜索资源…" value="' + esc(query) + '"/><select id="resourceTypeFilter" aria-label="资源类型"><option value="">全部</option><option value="manuscript">正文</option><option value="reference">资料</option><option value="entity">设定</option><option value="inspiration">灵感</option><option value="report">AI报告</option></select></div>';
    html += '<div class="resource-actions"><button class="kg-mini-btn" id="resourceOpenDocs" type="button">打开资料中心</button><button class="kg-mini-btn" id="resourceImportBody" type="button">导入正文/资料</button><button class="kg-mini-btn" id="resourceImportSetting" type="button">导入设定集</button></div>';
    html += '<div class="kg-search-summary">共 ' + filtered.length + ' 项资源</div>';
    html += filtered.length ? filtered.slice(0, 120).map(item => '<div class="resource-card" data-resource-kind="' + esc(item.kind) + '" data-resource-id="' + esc(item.id) + '"><div class="resource-card__head"><span class="resource-card__name">' + esc(item.name) + '</span><span class="resource-card__type">' + esc(item.type) + '</span></div><div class="resource-card__meta">' + esc(item.meta) + '</div>' + (item.text ? '<div class="resource-card__meta">' + esc(item.text.slice(0, 100).replace(/[\r\n]+/g, ' ')) + '</div>' : '') + '</div>').join('') : '<div class="kg-empty">暂无匹配资源。导入资料或在设定集、灵感卡片中创建内容。</div>';
    if (filtered.length > 120) html += '<div class="sb-text">仅显示前 120 项，请继续缩小搜索范围。</div>';
    body.innerHTML = html;
    const search = $('resourceSearch'); if (search) search.oninput = () => renderSidebarResources();
    const filter = $('resourceTypeFilter'); if (filter) { filter.value = type; filter.onchange = () => renderSidebarResources(); }
    const bodyBtn = $('resourceImportBody'); if (bodyBtn) bodyBtn.onclick = importNovel;
    const settingBtn = $('resourceImportSetting'); if (settingBtn) settingBtn.onclick = () => { switchSidebarTab('sheji'); setTimeout(() => { const btn = $('shejiImport'); if (btn) btn.click(); }, 0); };
    const docsBtn = $('resourceOpenDocs'); if (docsBtn) docsBtn.onclick = () => {
      if (!currentId) return;
      const target = location.pathname.includes('/pages/') ? 'project-docs.html' : 'pages/project-docs.html';
      location.href = target + '?nid=' + encodeURIComponent(currentId);
    };
    body.querySelectorAll('[data-resource-kind]').forEach(card => card.onclick = () => {
      const item = resources.find(x => x.kind === card.dataset.resourceKind && x.id === card.dataset.resourceId); if (!item) return;
      if (item.kind === 'manuscript') gotoChapter(item.id);
      else if (item.kind === 'entity') openEntityModal(item.id);
      else if (item.kind === 'report') { const report = (state.aiReports || []).find(x => x.id === item.id); if (report) openAIReportModal(report); }
      else openModal('<h3 class="ml-modal__title">' + esc(item.name) + '</h3><p class="ml-modal__hint">' + esc(item.type + ' · ' + item.meta) + '</p><div class="resource-preview">' + esc(item.text || '暂无内容') + '</div>', { wide: true });
    });
  }
  let shejiSearchQuery = '';
  let shejiTypeFilter = '';
  let shejiView = 'tree';              // tree | tags | unused | recent | cards | compact
  const kgExpanded = new Set();        // 已展开的树节点 id
  const kgSelectedIds = new Set();     // 当前设定视图中的批量选择
  let usageStats = null;
  let usageStatsKey = '';

  // B3 引用统计：扫描正文+大纲，统计每个实体被提及次数与末次章节（未引用=从未出现）
  function computeEntityUsage() {
    const ents = entList();
    const usageKey = [
      state.updatedAt || '',
      ents.map(e => [e.id, e.updatedAt || '', e.name, e.status || '', (e.aliases || []).join('|')].join(':')).join('~'),
      state.volumes.map(v => (v.chapters || []).map(ch => [ch.id, ch.title, ch.sub, chapterWordCount(ch)].join(':')).join('~')).join('||'),
      state.outline && state.outline.chapters ? state.outline.chapters.map(c => [c.num, c.title, c.synopsis].join(':')).join('~') : ''
    ].join('||');
    if (usageStats && usageStatsKey === usageKey) return usageStats;
    const stats = { byId: {}, byType: {}, statusCounts: { '未出场': 0, '待定': 0, '已废弃': 0, '已归档': 0, '未标注': 0 }, total: 0, usedCount: 0, unusedCount: 0, characterCount: 0, locationCount: 0, factionCount: 0, itemCount: 0 };
    stats.total = ents.length;
    ents.forEach(e => {
      stats.byType[e.type] = (stats.byType[e.type] || 0) + 1;
      if (e.type === 'character') stats.characterCount++;
      if (e.type === 'location') stats.locationCount++;
      if (e.type === 'faction') stats.factionCount++;
      if (e.type === 'item') stats.itemCount++;
      const status = e.status && stats.statusCounts[e.status] != null ? e.status : '未标注';
      stats.statusCounts[status]++;
    });
    const chapters = state.volumes.flatMap(v => (v.chapters || []).map(ch => ch));
    const texts = chapters.map((ch, idx) => {
      const body = (ch.scenes || []).map(s => htmlToText(s.content || '')).join('\n\n');
      const synopsis = (state.outline && state.outline.chapters && state.outline.chapters[idx] && state.outline.chapters[idx].synopsis) || '';
      return { idx, title: ch.title + (ch.sub ? '·' + ch.sub : ''), text: (body + '\n' + synopsis).toLowerCase() };
    });
    ents.forEach(e => {
      const names = Array.from(new Set([e.name, ...(e.aliases || [])].filter(Boolean).map(s => String(s).trim().toLowerCase()).filter(Boolean)));
      if (!names.length) { stats.byId[e.id] = { count: 0, lastIdx: -1, lastTitle: '', status: e.status || '未标注' }; if (!['已归档', '已废弃'].includes(e.status)) stats.unusedCount++; return; }
      let count = 0, lastIdx = -1, lastTitle = '';
      texts.forEach(t => {
        let c = 0;
        names.forEach(nm => { let i = 0; while ((i = t.text.indexOf(nm, i)) >= 0) { c++; i += nm.length; } });
        if (c > 0) { count += c; if (t.idx > lastIdx) { lastIdx = t.idx; lastTitle = t.title; } }
      });
      stats.byId[e.id] = { count, lastIdx, lastTitle, status: e.status || '未标注' };
      if (!count) { if (!['已归档', '已废弃'].includes(e.status)) stats.unusedCount++; } else stats.usedCount++;
    });
    usageStats = stats;
    usageStatsKey = usageKey;
    return stats;
  }
  const TAXONOMY_PARENT_TYPES = {
    location: ['location'],
    faction: ['location', 'faction'],
    character: ['faction', 'location'],
    itemCategory: ['itemCategory'],
    itemRank: ['itemCategory', 'itemRank'],
    item: ['itemRank', 'itemCategory']
  };
  function taxonomyParentTypes(type) { return TAXONOMY_PARENT_TYPES[type] || []; }
  function entityPath(e) {
    const byId = state.knowledge.entities || {};
    const path = [], seen = {};
    let cur = e;
    while (cur && !seen[cur.id]) {
      seen[cur.id] = true;
      path.unshift(cur.name);
      cur = cur.parentId ? byId[cur.parentId] : null;
    }
    return path.join(' / ');
  }
  function entityRelationText(e) {
    const byId = state.knowledge.entities || {};
    return (state.knowledge.edges || []).filter(ed => ed.from === e.id || ed.to === e.id).map(ed => {
      const otherId = ed.from === e.id ? ed.to : ed.from;
      const other = byId[otherId];
      return (other ? other.name : '') + ' ' + relationTypeMeta(ed.relationType).label + ' ' + (ed.label || '');
    }).join(' ');
  }
  function entitySearchText(e) {
    const attrs = (e.attrs || []).map(a => a.k + ' ' + a.v).join(' ');
    const tags = (e.tags || []).join(' ');
    return [e.name, ...(e.aliases || []), tags, e.status, e.currentLocation, e.owner, attrs, e.personality, e.notes, entityPath(e), entityRelationText(e)].filter(Boolean).join(' ').toLowerCase();
  }
  function entityMatchesSearch(e, query, typeFilter) {
    if (typeFilter && e.type !== typeFilter) return false;
    const tokens = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const text = entitySearchText(e);
    return tokens.every(token => text.includes(token));
  }
  function parentCreatesCycle(childId, parentId) {
    const byId = state.knowledge.entities || {};
    const seen = {};
    let cur = parentId ? byId[parentId] : null;
    while (cur && !seen[cur.id]) {
      if (cur.id === childId) return true;
      seen[cur.id] = true;
      cur = cur.parentId ? byId[cur.parentId] : null;
    }
    return false;
  }
  function taxonomyParentCandidates(type, currentId) {
    const allowed = taxonomyParentTypes(type);
    return entList().filter(x => x.id !== currentId && allowed.includes(x.type) && !parentCreatesCycle(currentId, x.id)).sort((a, b) => entityPath(a).localeCompare(entityPath(b)) || a.name.localeCompare(b.name));
  }
  function entityRowHtml(e, level, showPath) {
    const meta = entityTypeMeta(e.type);
    const attrs = (e.attrs || []).slice(0, 2).map(a => esc(a.k) + (a.v ? '：' + esc(a.v) : '')).join(' · ');
    const path = showPath ? esc(entityPath(e)) : '';
    const relCount = (state.knowledge.edges || []).filter(ed => ed.from === e.id || ed.to === e.id).length;
    const statusChip = e.status ? '<span class="kg-status-chip">' + esc(e.status) + '</span>' : '';
    const tags = (e.tags || []).slice(0, 2).map(t => '<span class="kg-tag-chip">' + esc(t) + '</span>').join('');
    const use = (usageStats && usageStats.byId[e.id]) || null;
    const useTxt = use ? (use.count > 0 ? ('用过' + use.count + '次' + (use.lastTitle ? '·' + esc(use.lastTitle) : '')) : '<span class="kg-unused">未引用</span>') : '';
    const sub = [path, attrs, tags, useTxt, relCount ? ('关系 ' + relCount) : ''].filter(Boolean).join(' · ');
    return '<div class="kg-tree-row' + (kgSelectedIds.has(e.id) ? ' is-selected' : '') + '" data-id="' + e.id + '" style="--kg-level:' + (level || 0) + '">' +
      '<input class="kg-select" type="checkbox" data-select-id="' + e.id + '"' + (kgSelectedIds.has(e.id) ? ' checked' : '') + ' aria-label="选择' + esc(e.name) + '"/>' +
      '<span class="kg-dot" style="background:' + meta.color + '"></span>' +
      '<div class="kg-tree-main"><div class="kg-tree-name">' + esc(e.name) + statusChip + '</div>' + (sub ? '<div class="kg-tree-sub">' + sub + '</div>' : '') + '</div>' +
      '<span class="kg-tree-type">' + esc(meta.label) + '</span></div>';
  }
  function entityCardHtml(e, compact) {
    const meta = entityTypeMeta(e.type);
    const use = (usageStats && usageStats.byId[e.id]) || { count: 0 };
    const rel = (state.knowledge.edges || []).filter(ed => ed.from === e.id || ed.to === e.id).length;
    const detail = compact ? (entityPath(e) || meta.label) : [entityPath(e), e.notes, (e.tags || []).join(' · ')].filter(Boolean).join(' · ');
    return '<div class="kg-entity-card' + (compact ? ' kg-entity-card--compact' : '') + (kgSelectedIds.has(e.id) ? ' is-selected' : '') + '" data-id="' + esc(e.id) + '">' +
      '<input class="kg-select" type="checkbox" data-select-id="' + esc(e.id) + '"' + (kgSelectedIds.has(e.id) ? ' checked' : '') + ' aria-label="选择' + esc(e.name) + '"/>' +
      '<span class="kg-dot" style="background:' + meta.color + '"></span><div class="kg-entity-card__main"><div class="kg-entity-card__head"><strong>' + esc(e.name) + '</strong><span>' + esc(meta.label) + '</span></div>' + (detail ? '<div class="kg-entity-card__detail">' + esc(detail).slice(0, compact ? 100 : 180) + '</div>' : '') + '<div class="kg-entity-card__meta">' + esc(e.status || '未标注') + ' · 引用 ' + use.count + ' · 关系 ' + rel + '</div></div></div>';
  }
  function treeSubtreeCount(list, id, childrenOf, cache, trail) {
    const children = childrenOf || list.reduce((map, e) => { (map[e.parentId] = map[e.parentId] || []).push(e); return map; }, {});
    const memo = cache || {};
    if (Object.prototype.hasOwnProperty.call(memo, id)) return memo[id];
    const path = trail || new Set();
    if (path.has(id)) return 0;
    path.add(id);
    let count = 0;
    (children[id] || []).forEach(child => {
      if (path.has(child.id)) return;
      count += 1 + treeSubtreeCount(list, child.id, children, memo, path);
    });
    path.delete(id);
    memo[id] = count;
    return count;
  }
  function treeRowHtml(e, level, kids, subtreeCount) {
    const meta = entityTypeMeta(e.type);
    const attrs = (e.attrs || []).slice(0, 2).map(a => esc(a.k) + (a.v ? '：' + esc(a.v) : '')).join(' · ');
    const relCount = (state.knowledge.edges || []).filter(ed => ed.from === e.id || ed.to === e.id).length;
    const statusChip = e.status ? '<span class="kg-status-chip">' + esc(e.status) + '</span>' : '';
    const tags = (e.tags || []).slice(0, 2).map(t => '<span class="kg-tag-chip">' + esc(t) + '</span>').join('');
    const use = (usageStats && usageStats.byId[e.id]) || null;
    const useTxt = use ? (use.count > 0 ? ('用过' + use.count + '次') : '<span class="kg-unused">未引用</span>') : '';
    const sub = [attrs, tags, useTxt, relCount ? ('关系 ' + relCount) : ''].filter(Boolean).join(' · ');
    const hasKids = kids && kids.length > 0;
    const expanded = kgExpanded.has(e.id);
    const chev = hasKids
      ? '<button class="kg-expand" data-toggle="' + e.id + '" type="button" aria-label="' + (expanded ? '收起' : '展开') + esc(e.name) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + (expanded ? '▾' : '▸') + '</button>'
      : '<span class="kg-expand kg-expand--empty"></span>';
    const count = hasKids ? '<span class="kg-count" title="包含 ' + subtreeCount + ' 个子设定">' + subtreeCount + '</span>' : '';
    const toggleAttrs = hasKids ? ' data-tree-toggle="' + e.id + '" role="button" tabindex="0" aria-expanded="' + (expanded ? 'true' : 'false') + '" title="点击展开或收起子设定"' : '';
    return '<div class="kg-tree-row' + (kgSelectedIds.has(e.id) ? ' is-selected' : '') + '" data-id="' + e.id + '" data-has-children="' + (hasKids ? 'true' : 'false') + '" style="--kg-level:' + (level || 0) + '">' + chev +
      '<input class="kg-select" type="checkbox" data-select-id="' + e.id + '"' + (kgSelectedIds.has(e.id) ? ' checked' : '') + ' aria-label="选择' + esc(e.name) + '"/>' +
      '<span class="kg-dot" style="background:' + meta.color + '"></span>' +
      '<div class="kg-tree-main"' + toggleAttrs + '><div class="kg-tree-name">' + esc(e.name) + statusChip + count + '</div>' + (sub ? '<div class="kg-tree-sub">' + sub + '</div>' : '') + '</div>' +
      '<span class="kg-tree-type">' + esc(meta.label) + '</span></div>';
  }
  function renderTaxonomyTree(list) {
    const byId = {}; list.forEach(e => { byId[e.id] = e; });
    const childrenOf = {};
    list.forEach(e => { (childrenOf[e.parentId] = childrenOf[e.parentId] || []).push(e); });
    Object.values(childrenOf).forEach(arr => arr.sort((a, b) => a.name.localeCompare(b.name)));
    const subtreeCounts = {};
    list.forEach(e => treeSubtreeCount(list, e.id, childrenOf, subtreeCounts));
    const used = {};
    function markSubtree(id) {
      if (used[id]) return;
      used[id] = true;
      (childrenOf[id] || []).forEach(c => markSubtree(c.id));
    }
    function isVisible(e) {
      let cur = e.parentId ? byId[e.parentId] : null;
      while (cur) { if (!kgExpanded.has(cur.id)) return false; cur = cur.parentId ? byId[cur.parentId] : null; }
      return true;
    }
    function roots(types) {
      return list.filter(e => types.includes(e.type) && (!e.parentId || !byId[e.parentId])).sort((a, b) => a.name.localeCompare(b.name));
    }
    function node(e, level, trail) {
      if (!e || trail[e.id]) return '';
      const nextTrail = Object.assign({}, trail, { [e.id]: true });
      used[e.id] = true;
      if (!isVisible(e) && level > 0) return '';
      const kids = childrenOf[e.id] || [];
      return treeRowHtml(e, level, kids, subtreeCounts[e.id] || 0) + (kgExpanded.has(e.id) ? kids.map(x => node(x, level + 1, nextTrail)).join('') : '');
    }
    const locationCount = list.filter(e => ['location', 'faction', 'character'].includes(e.type)).length;
    const itemCount = list.filter(e => ['itemCategory', 'itemRank', 'item'].includes(e.type)).length;
    let html = '<div class="kg-tree-group"><div class="kg-tree-heading">地点 → 势力 → 人物（' + locationCount + '）</div>';
    roots(['location', 'faction', 'character']).forEach(e => { markSubtree(e.id); html += node(e, 0, {}); });
    html += '</div>';
    html += '<div class="kg-tree-group"><div class="kg-tree-heading">物品类别 → 品级 → 物品（' + itemCount + '）</div>';
    roots(['itemCategory', 'itemRank', 'item']).forEach(e => { markSubtree(e.id); html += node(e, 0, {}); });
    html += '</div>';
    const unplaced = list.filter(e => !used[e.id]).sort((a, b) => entityTypeMeta(a.type).label.localeCompare(entityTypeMeta(b.type).label) || a.name.localeCompare(b.name));
    if (unplaced.length) {
      html += '<div class="kg-tree-group"><div class="kg-tree-heading">未归类设定</div>';
      unplaced.forEach(e => { html += node(e, 0, {}); });
      html += '</div>';
    }
    return html;
  }
  // 渲染设定集视图：统计条 + 多视图（分类树/标签/未引用/最近）+ 搜索分组定位
  function renderSidebarSheji() {
    const body = $('sbShejiBody'); if (!body) return;
    ensureKnowledge();
    const ents = entList();
    usageStats = computeEntityUsage();
    const tagSet = Array.from(new Set(ents.flatMap(e => (e.tags || []).map(t => t.trim())).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    let html = '<div class="sb-sec-title">设定集 · 知识库</div>';
    html += '<div class="kg-mini-actions"><button class="kg-mini-btn" id="shejiNew" type="button">+ 新建</button><button class="kg-mini-btn" id="shejiExtract" type="button">抽取</button><button class="kg-mini-btn" id="shejiImport" type="button">导入</button><button class="kg-mini-btn" id="shejiGraph" type="button">图谱</button><button class="kg-mini-btn" id="shejiDedup" type="button">查重</button><button class="kg-mini-btn" id="shejiAudit" type="button">梳理</button></div>';
    html += '<div class="kg-stats"><span class="kg-stats__item">共 <b>' + ents.length + '</b> 条</span><span class="kg-stats__item">已引用 <b>' + usageStats.usedCount + '</b></span><span class="kg-stats__item">人物 <b>' + usageStats.characterCount + '</b></span><span class="kg-stats__item">地点 <b>' + usageStats.locationCount + '</b></span><span class="kg-stats__item">势力 <b>' + usageStats.factionCount + '</b></span><span class="kg-stats__item">物品 <b>' + usageStats.itemCount + '</b></span><button class="kg-stats__item kg-stats__item--btn kg-stats__item--warn" id="shejiStatUnused" type="button">未引用 <b>' + usageStats.unusedCount + '</b></button></div>';
    html += '<div class="kg-status-summary">未出场 ' + usageStats.statusCounts['未出场'] + ' · 待定 ' + usageStats.statusCounts['待定'] + ' · 已归档 ' + usageStats.statusCounts['已归档'] + ' · 已废弃 ' + usageStats.statusCounts['已废弃'] + '</div>';
    html += '<div class="kg-viewtabs"><button class="kg-viewtab' + (shejiView === 'tree' ? ' is-active' : '') + '" data-view="tree" type="button">树</button><button class="kg-viewtab' + (shejiView === 'cards' ? ' is-active' : '') + '" data-view="cards" type="button">卡片</button><button class="kg-viewtab' + (shejiView === 'compact' ? ' is-active' : '') + '" data-view="compact" type="button">紧凑</button><button class="kg-viewtab' + (shejiView === 'tags' ? ' is-active' : '') + '" data-view="tags" type="button">标签</button><button class="kg-viewtab' + (shejiView === 'unused' ? ' is-active' : '') + '" data-view="unused" type="button">未引用</button><button class="kg-viewtab' + (shejiView === 'recent' ? ' is-active' : '') + '" data-view="recent" type="button">最近</button></div>';
    html += '<div class="kg-search-tools"><input id="shejiSearch" aria-label="搜索设定" autocomplete="off" placeholder="搜索名称、标签、状态、位置…" value="' + esc(shejiSearchQuery) + '"/><select id="shejiTypeFilter" aria-label="按类型筛选"><option value="">全部类型</option>' + ENTITY_TYPES.map(t => '<option value="' + t.type + '"' + (shejiTypeFilter === t.type ? ' selected' : '') + '>' + t.label + '</option>').join('') + '</select></div>';
    html += '<div class="kg-batchbar"><span id="kgSelectedCount">已选 0 条</span><button class="kg-mini-btn" id="kgBatchTag" type="button">批量打标签</button><select id="kgBatchStatus" aria-label="批量修改状态"><option value="">修改状态…</option><option value="已登场">已登场</option><option value="未出场">未出场</option><option value="待定">待定</option><option value="已归档">已归档</option><option value="已废弃">已废弃</option></select><button class="kg-mini-btn" id="kgBatchClear" type="button">清空选择</button></div>';
    html += '<div class="kg-search-hint">支持多关键词；路径、别名、属性、备注、状态、当前位置和持有者都会参与搜索</div><div class="kg-results-scroll"><div id="shejiResults"></div>';
    html += '<div class="kg-scene-summary"><div class="sb-sec-title" style="margin-top:12px;">当前场景摘要</div>';
    html += '<textarea id="shejiSummaryInput" placeholder="添加场景摘要..." style="width:100%;min-height:54px;background:rgba(255,255,255,.05);color:#e6e8eb;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:8px 10px;font-size:12px;line-height:1.6;resize:vertical;outline:none;font-family:inherit;">' + esc((state.sceneProps || {}).summary || '') + '</textarea>';
    html += '</div></div>';
    body.innerHTML = html;
    function updateBatchCount() {
      const count = $('kgSelectedCount');
      if (count) count.textContent = '已选 ' + kgSelectedIds.size + ' 条';
      const clear = $('kgBatchClear');
      if (clear) clear.disabled = kgSelectedIds.size === 0;
    }
    function applyBatch(patch) {
      if (!kgSelectedIds.size) { toast('请先勾选设定'); return; }
      kgSelectedIds.forEach(id => {
        const entity = state.knowledge.entities[id];
        if (!entity) return;
        if (patch.tags) entity.tags = normalizeAliasList([...(entity.tags || []), ...patch.tags]).slice(0, 20);
        if (patch.status != null) entity.status = patch.status;
        entity.updatedAt = Date.now();
      });
      save(); renderSidebarSheji(); toast('已更新 ' + kgSelectedIds.size + ' 条设定');
    }
    const batchTag = $('kgBatchTag');
    if (batchTag) batchTag.onclick = () => {
      const value = window.prompt('输入标签，多个标签用顿号或逗号分隔');
      if (value && value.trim()) applyBatch({ tags: normalizeAliasList(value) });
    };
    const batchStatus = $('kgBatchStatus');
    if (batchStatus) batchStatus.onchange = () => {
      if (batchStatus.value) { applyBatch({ status: batchStatus.value }); batchStatus.value = ''; }
    };
    const batchClear = $('kgBatchClear');
    if (batchClear) batchClear.onclick = () => { kgSelectedIds.clear(); renderResults(); updateBatchCount(); };
    function groupedRows(list) {
      const groups = {};
      list.forEach(e => { const t = entityTypeMeta(e.type).label; (groups[t] = groups[t] || []).push(e); });
      let h = '';
      Object.keys(groups).forEach(label => {
        groups[label].sort((a, b) => a.name.localeCompare(b.name));
        h += '<div class="kg-tree-heading">' + label + '（' + groups[label].length + '）</div>' + groups[label].map(e => entityRowHtml(e, 0, true)).join('');
      });
      return h;
    }
    function renderResults() {
      const holder = $('shejiResults'); if (!holder) return;
      const query = shejiSearchQuery.trim();
      const filtered = ents.filter(e => entityMatchesSearch(e, query, shejiTypeFilter));
      if (query || shejiTypeFilter) {
        holder.innerHTML = '<div class="kg-search-summary">找到 ' + filtered.length + ' 条设定</div>' + (filtered.length ? groupedRows(filtered) : '<div class="kg-empty">没有匹配的设定</div>');
      } else if (shejiView === 'tags') {
        if (!tagSet.length) { holder.innerHTML = '<div class="kg-empty">还没有标签。编辑实体时给设定打上「主线 / 第三卷」等标签，即可按标签浏览。</div>'; }
        else {
          let h = '';
          tagSet.forEach(tag => {
            const list = ents.filter(e => (e.tags || []).map(x => x.trim()).includes(tag));
            h += '<div class="kg-tree-heading">#' + esc(tag) + '（' + list.length + '）</div>' + list.map(e => entityRowHtml(e, 0, false)).join('');
          });
          const untagged = ents.filter(e => !(e.tags || []).length);
          if (untagged.length) h += '<div class="kg-tree-heading">未打标（' + untagged.length + '）</div>' + untagged.map(e => entityRowHtml(e, 0, false)).join('');
          holder.innerHTML = h;
        }
      } else if (shejiView === 'unused') {
        const list = ents.filter(e => usageStats.byId[e.id] && usageStats.byId[e.id].count === 0 && !['已归档', '已废弃'].includes(e.status));
        const statusGroups = {};
        list.forEach(e => { const s = e.status || '未标注'; (statusGroups[s] = statusGroups[s] || []).push(e); });
        holder.innerHTML = list.length
          ? '<div class="kg-tree-heading">尚未在正文/大纲出现（已排除归档与废弃，共 ' + list.length + '）</div>' + Object.keys(statusGroups).map(s => '<div class="kg-tree-heading">' + esc(s) + '（' + statusGroups[s].length + '）</div>' + groupedRows(statusGroups[s])).join('')
          : '<div class="kg-empty">所有设定都至少在正文中出现过，很干净。</div>';
      } else if (shejiView === 'recent') {
        const list = ents.filter(e => e.updatedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 40);
        holder.innerHTML = list.length
          ? '<div class="kg-tree-heading">最近编辑（最多 40 条）</div>' + list.map(e => entityRowHtml(e, 0, false)).join('')
          : '<div class="kg-empty">暂无编辑记录。保存实体后这里会按时间倒序展示。</div>';
      } else if (shejiView === 'cards' || shejiView === 'compact') {
        const list = query ? filtered : ents.slice().sort((a, b) => a.name.localeCompare(b.name));
        holder.innerHTML = list.length ? '<div class="kg-card-grid kg-card-grid--' + shejiView + '">' + list.map(e => entityCardHtml(e, shejiView === 'compact')).join('') + '</div>' : '<div class="kg-empty">暂无匹配的设定</div>';
      } else {
        holder.innerHTML = ents.length ? renderTaxonomyTree(ents) : '<div class="kg-empty">暂无设定，点「+ 新建」或「导入」</div>';
      }
      const toggleTreeNode = id => { if (kgExpanded.has(id)) kgExpanded.delete(id); else kgExpanded.add(id); renderResults(); };
      holder.querySelectorAll('[data-id]').forEach(row => row.onclick = () => openEntityModal(row.dataset.id));
      holder.querySelectorAll('[data-tree-toggle]').forEach(target => {
        const toggle = ev => { ev.stopPropagation(); toggleTreeNode(target.dataset.treeToggle); };
        target.onclick = toggle;
        target.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(ev); } };
      });
      holder.querySelectorAll('[data-select-id]').forEach(box => {
        box.onclick = ev => ev.stopPropagation();
        box.onchange = () => {
          if (box.checked) kgSelectedIds.add(box.dataset.selectId); else kgSelectedIds.delete(box.dataset.selectId);
          const row = box.closest('[data-id]');
          if (row) row.classList.toggle('is-selected', box.checked);
          updateBatchCount();
        };
      });
      holder.querySelectorAll('[data-toggle]').forEach(btn => btn.onclick = ev => { ev.stopPropagation(); toggleTreeNode(btn.dataset.toggle); });
      updateBatchCount();
    }
    renderResults();
    const scb = $('sceneConsistencyBtn'); if (scb) scb.onclick = () => openConsistencyModal();
    function renderSceneBody() {
      const bodyEl = $('kgSceneBody'); if (!bodyEl) return;
      const items = currentSceneEntities();
      if (!items.length) { bodyEl.innerHTML = '<div class="kg-scene-empty">当前章节正文未提到任何设定。写正文或点「抽取」后，这里会自动显示在场实体。</div>'; return; }
      bodyEl.innerHTML = items.map(x => {
        const e = x.e;
        const meta = entityTypeMeta(e.type);
        const status = e.status || '未标注';
        return '<button class="kg-scene-chip" data-id="' + e.id + '" type="button" title="点击切换状态"><span class="kg-dot" style="background:' + meta.color + '"></span><b>' + esc(e.name) + '</b>' + (e.core ? '<span class="kg-core-star" title="主线核心">★</span>' : '') + '<span class="kg-scene-status">' + esc(status) + '</span></button>';
      }).join('');
      bodyEl.querySelectorAll('.kg-scene-chip').forEach(chip => chip.onclick = () => {
        const entity = state.knowledge.entities[chip.dataset.id]; if (!entity) return;
        const next = cycleEntityStatus(entity);
        renderSceneBody();
        if (TERMINAL_STATUSES.indexOf(next) >= 0) toast('已将「' + entity.name + '」改为「' + next + '」——后续章节若仍写其活跃，建议点「吃书检测」');
      });
    }
    renderSceneBody();
    const sum = $('shejiSummaryInput'); if (sum) sum.oninput = () => { state.sceneProps = state.sceneProps || { summary: '', elements: { characters: [], locations: [], items: [], plot: [] } }; state.sceneProps.summary = sum.value; debouncedSave(); };
    const nb = $('shejiNew'); if (nb) nb.onclick = () => openEntityModal(null);
    const ex = $('shejiExtract'); if (ex) ex.onclick = () => extractKnowledge();
    const im = $('shejiImport'); if (im) im.onclick = () => openImportSettingsModal();
    const gp = $('shejiGraph'); if (gp) gp.onclick = () => openKnowledgeGraphModal();
    const dd = $('shejiDedup'); if (dd) dd.onclick = () => openDedupModal();
    const au = $('shejiAudit'); if (au) au.onclick = () => openAiAuditModal();
    const wb = $('shejiWorkbench'); if (wb) wb.onclick = () => openShejiWorkbench();
    const search = $('shejiSearch'); if (search) search.oninput = e => { shejiSearchQuery = e.target.value; renderResults(); };
    const typeFilter = $('shejiTypeFilter'); if (typeFilter) typeFilter.onchange = e => { shejiTypeFilter = e.target.value; renderResults(); };
    body.querySelectorAll('.kg-viewtab').forEach(t => t.onclick = () => { shejiView = t.dataset.view; renderSidebarSheji(); });
    const statUnused = $('shejiStatUnused'); if (statUnused) statUnused.onclick = () => { shejiView = 'unused'; renderSidebarSheji(); };
  }
  function renderSidebarAI() {
    const body = $('sbAIBody'); if (!body) return;
    body.innerHTML = '<div class="sb-sec-title">AI 续写</div><div class="sb-text">基于当前场景末尾，让 AI 接着写下去。续写模型可在「设置 → AI 模型设置」中选择。</div><button class="tv-btn tv-btn--primary tv-btn--block" id="sbContinueBtn" style="margin-top:12px;">在光标处续写</button>';
    const btn = $('sbContinueBtn'); if (btn) btn.onclick = aiContinue;
  }
  const FORESHADOW_STATUSES = [
    { value: 'planned', label: '计划' },
    { value: 'planted', label: '已埋下' },
    { value: 'developing', label: '推进中' },
    { value: 'resolved', label: '已回收' },
    { value: 'abandoned', label: '已废弃' }
  ];
  const FORESHADOW_STRENGTHS = [
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' }
  ];
  let foreshadowFilter = '';
  function normalizeForeshadow(f) {
    if (!f || typeof f !== 'object') return;
    f.id = String(f.id || uid('fs'));
    f.title = String(f.title || '').trim().slice(0, 160) || '未命名伏笔';
    f.description = String(f.description || '').trim().slice(0, 4000);
    f.status = FORESHADOW_STATUSES.some(x => x.value === f.status) ? f.status : 'planned';
    f.strength = FORESHADOW_STRENGTHS.some(x => x.value === f.strength) ? f.strength : 'medium';
    f.plantedChapterId = String(f.plantedChapterId || '');
    f.targetChapterId = String(f.targetChapterId || '');
    f.resolvedChapterId = String(f.resolvedChapterId || '');
    f.clues = normalizeAliasList(f.clues).slice(0, 20);
    f.relatedEntityIds = Array.isArray(f.relatedEntityIds) ? f.relatedEntityIds.map(String).filter(id => state.knowledge && state.knowledge.entities && state.knowledge.entities[id]).slice(0, 20) : [];
    f.notes = String(f.notes || '').trim().slice(0, 4000);
    if (!Number.isFinite(Number(f.createdAt))) f.createdAt = Date.now();
    if (!Number.isFinite(Number(f.updatedAt))) f.updatedAt = f.createdAt;
  }
  function chapterById(id) {
    return state.volumes.flatMap(v => v.chapters || []).find(ch => ch.id === id) || null;
  }
  function chapterOptionHtml(selected) {
    const chapters = state.volumes.flatMap(v => v.chapters || []);
    return '<option value="">未关联</option>' + chapters.map(ch => '<option value="' + esc(ch.id) + '"' + (ch.id === selected ? ' selected' : '') + '>' + esc(ch.title + (ch.sub ? ' · ' + ch.sub : '')) + '</option>').join('');
  }
  function renderSidebarForeshadow() {
    const body = $('sbForeshadowBody'); if (!body) return;
    ensureAdvancedState();
    state.foreshadows.forEach(normalizeForeshadow);
    const list = state.foreshadows.filter(f => !foreshadowFilter || f.status === foreshadowFilter);
    const openCount = state.foreshadows.filter(f => ['planned', 'planted', 'developing'].includes(f.status)).length;
    let html = '<div class="sb-sec-title">伏笔台账</div>';
    html += '<div class="foreshadow-summary"><span>总计 <b>' + state.foreshadows.length + '</b></span><span>待回收 <b>' + openCount + '</b></span><button class="kg-mini-btn" id="foreshadowNew" type="button">+ 新建</button></div>';
    html += '<div class="foreshadow-filter"><select id="foreshadowStatusFilter" aria-label="筛选伏笔状态"><option value="">全部状态</option>' + FORESHADOW_STATUSES.map(s => '<option value="' + s.value + '"' + (foreshadowFilter === s.value ? ' selected' : '') + '>' + s.label + '</option>').join('') + '</select></div>';
    if (!list.length) html += '<div class="kg-empty">还没有伏笔。把需要后续回收的线索记录在这里，写作时会自动召回。</div>';
    else html += '<div class="foreshadow-list">' + list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(f => {
      const planted = chapterById(f.plantedChapterId);
      const target = chapterById(f.targetChapterId);
      const status = FORESHADOW_STATUSES.find(x => x.value === f.status);
      return '<div class="foreshadow-card" data-fid="' + esc(f.id) + '">' +
        '<div class="foreshadow-card__head"><strong>' + esc(f.title) + '</strong><span class="foreshadow-status foreshadow-status--' + f.status + '">' + esc(status ? status.label : f.status) + '</span></div>' +
        '<div class="foreshadow-card__desc">' + esc(f.description || '暂无描述') + '</div>' +
        '<div class="foreshadow-card__meta"><span>强度 ' + esc((FORESHADOW_STRENGTHS.find(x => x.value === f.strength) || {}).label || '中') + '</span><span>' + (planted ? '埋于 ' + esc(planted.title) : '未关联埋点') + '</span><span>' + (target ? '目标 ' + esc(target.title) : '未设置回收章') + '</span></div>' +
        '<div class="foreshadow-card__actions"><button type="button" data-fs-edit="' + esc(f.id) + '">编辑</button><button type="button" data-fs-resolve="' + esc(f.id) + '">' + (f.status === 'resolved' ? '已回收' : '标记回收') + '</button></div>' +
        '</div>';
    }).join('') + '</div>';
    body.innerHTML = html;
    const newBtn = $('foreshadowNew'); if (newBtn) newBtn.onclick = () => openForeshadowModal(null);
    const filter = $('foreshadowStatusFilter'); if (filter) filter.onchange = () => { foreshadowFilter = filter.value; renderSidebarForeshadow(); };
    body.querySelectorAll('[data-fs-edit]').forEach(btn => btn.onclick = () => openForeshadowModal(btn.dataset.fsEdit));
    body.querySelectorAll('[data-fs-resolve]').forEach(btn => btn.onclick = () => {
      const f = state.foreshadows.find(x => x.id === btn.dataset.fsResolve); if (!f) return;
      f.status = f.status === 'resolved' ? 'developing' : 'resolved'; f.resolvedChapterId = f.status === 'resolved' ? state.currentChapterId : ''; f.updatedAt = Date.now();
      save(); renderSidebarForeshadow();
    });
    body.querySelectorAll('[data-fid]').forEach(card => card.onclick = ev => { if (!ev.target.closest('button')) openForeshadowModal(card.dataset.fid); });
  }
  function openForeshadowModal(id) {
    ensureAdvancedState();
    const existing = id && state.foreshadows.find(f => f.id === id);
    const f = existing ? Object.assign({}, existing) : { id: uid('fs'), title: '', description: '', status: 'planned', strength: 'medium', plantedChapterId: state.currentChapterId || '', targetChapterId: '', resolvedChapterId: '', clues: [], relatedEntityIds: [], notes: '' };
    normalizeForeshadow(f);
    const html = '<h3 class="ml-modal__title">' + (existing ? '编辑伏笔' : '新建伏笔') + '</h3><div class="kg-form">' +
      '<label class="kg-field"><span>标题</span><input id="fsTitle" value="' + esc(f.title === '未命名伏笔' ? '' : f.title) + '" placeholder="例如：轮回印记的真正来历"/></label>' +
      '<label class="kg-field kg-field--col"><span>线索描述</span><textarea id="fsDescription" placeholder="读者当前能看到什么，后续要揭示什么…">' + esc(f.description) + '</textarea></label>' +
      '<div class="kg-meta-grid"><label class="kg-field"><span>状态</span><select id="fsStatus">' + FORESHADOW_STATUSES.map(s => '<option value="' + s.value + '"' + (f.status === s.value ? ' selected' : '') + '>' + s.label + '</option>').join('') + '</select></label><label class="kg-field"><span>强度</span><select id="fsStrength">' + FORESHADOW_STRENGTHS.map(s => '<option value="' + s.value + '"' + (f.strength === s.value ? ' selected' : '') + '>' + s.label + '</option>').join('') + '</select></label></div>' +
      '<div class="kg-meta-grid"><label class="kg-field"><span>埋下章节</span><select id="fsPlanted">' + chapterOptionHtml(f.plantedChapterId) + '</select></label><label class="kg-field"><span>目标回收章节</span><select id="fsTarget">' + chapterOptionHtml(f.targetChapterId) + '</select></label></div>' +
      '<label class="kg-field"><span>关联设定</span><input id="fsEntities" value="' + esc(f.relatedEntityIds.map(eid => state.knowledge.entities[eid] && state.knowledge.entities[eid].name).filter(Boolean).join('、')) + '" placeholder="输入人物/地点/物品名称，多个用顿号分隔"/></label>' +
      '<label class="kg-field kg-field--col"><span>回收提示与备注</span><textarea id="fsNotes" placeholder="回收条件、证据、写作提醒…">' + esc(f.notes) + '</textarea></label></div>' +
      '<div class="ml-modal__actions"><button class="tv-btn tv-btn--ghost" id="fsCancel" type="button">取消</button>' + (existing ? '<button class="tv-btn tv-btn--ghost" id="fsDelete" type="button">删除</button>' : '') + '<button class="tv-btn tv-btn--primary" id="fsSave" type="button">保存</button></div>';
    const modal = openModal(html, { wide: true });
    modal.querySelector('#fsCancel').onclick = closeModal;
    const del = modal.querySelector('#fsDelete'); if (del) del.onclick = () => { state.foreshadows = state.foreshadows.filter(x => x.id !== f.id); save(); closeModal(); renderSidebarForeshadow(); };
    modal.querySelector('#fsSave').onclick = () => {
      const entityNames = normalizeAliasList(modal.querySelector('#fsEntities').value);
      const entityIds = entityNames.map(name => findEntIdByName(entList(), name)).filter(Boolean);
      const next = Object.assign(f, {
        title: modal.querySelector('#fsTitle').value.trim() || '未命名伏笔',
        description: modal.querySelector('#fsDescription').value.trim(),
        status: modal.querySelector('#fsStatus').value,
        strength: modal.querySelector('#fsStrength').value,
        plantedChapterId: modal.querySelector('#fsPlanted').value,
        targetChapterId: modal.querySelector('#fsTarget').value,
        relatedEntityIds: entityIds,
        notes: modal.querySelector('#fsNotes').value.trim(),
        updatedAt: Date.now()
      });
      normalizeForeshadow(next);
      if (!existing) state.foreshadows.unshift(next);
      save(); closeModal(); renderSidebarForeshadow(); toast('伏笔已保存');
    };
  }
  async function aiContinue() {
    const instruction = AI_ACTION_PROMPTS['AI续写'] || '请在当前正文之后继续创作，保持文风与视角一致，直接输出续写内容，不要解释。';
    const userText = htmlToText(currentSceneContent());
    const sys = await buildSystemReady('你是一位专业的中文网络小说写作助手，擅长构思情节、生成正文与设定。回答简洁、有画面感、贴合网文节奏。');
    if (!sys) return;
    const userMsg = instruction + '\n\n【原文/上下文】\n' + userText;
    const model = currentUnifiedModel();
    switchTab('ai');
    showAIToolResult('AI续写', sys, userMsg, model);
  }

  /* ===================== 故事画布 / 时间线 ===================== */
  // 章节蓝图对应的真实字数（与 volumes[0].chapters 1:1 对齐）
  function outlineChapterWords(idx) {
    const ch = state.volumes[0] && state.volumes[0].chapters[idx];
    return ch ? chapterWordCount(ch) : 0;
  }
  function currentOutlineIndex() {
    return state.volumes[0].chapters.findIndex(c => c.id === state.currentChapterId);
  }
  function uniqueStorylines() {
    const seen = ['主线', '支线'];
    state.outline.chapters.forEach(c => { if (c.storyline && seen.indexOf(c.storyline) < 0) seen.push(c.storyline); });
    return seen;
  }
  function renderTimeline() {
    ensureOutlineChapters();
    const canvas = $('tlCanvas'); if (!canvas) return;
    const o = state.outline;
    const lanes = uniqueStorylines();
    const curIdx = currentOutlineIndex();
    const maxWords = Math.max(1, ...o.chapters.map((_, i) => outlineChapterWords(i)));
    // 图例
    const legend = $('tlLegend');
    if (legend) {
      legend.innerHTML = lanes.map((ln, i) =>
        '<span class="tl-legend__chip"><span class="tl-legend__dot" style="background:' + storylineColor(ln, i) + '"></span>' + esc(ln) + '</span>'
      ).join('');
    }
    // 泳道
    let html = '';
    lanes.forEach((ln, li) => {
      const idxs = o.chapters.map((c, i) => ({ c, i })).filter(x => x.c.storyline === ln).map(x => x.i);
      const color = storylineColor(ln, li);
      const nodes = idxs.map(idx => {
        const c = o.chapters[idx];
        const volCh = state.volumes[0].chapters[idx];
        const cid = volCh ? volCh.id : '';
        const w = outlineChapterWords(idx);
        const h = Math.max(26, Math.round(26 + (w / maxWords) * 140));
        const mk = MARK_TYPES[c.mark] || MARK_TYPES[''];
        const pin = c.mark ? '<div class="tl-pin" style="background:' + mk.color + '" title="' + mk.label + '">' + mk.short + '</div>' : '';
        const active = (idx === curIdx) ? ' is-current' : '';
        return '<div class="tl-node' + active + '" data-idx="' + idx + '" data-cid="' + (cid || '') + '" title="' + esc(c.num + ' ' + c.title + (c.synopsis ? '：' + c.synopsis : '')) + '">' +
          pin +
          '<div class="tl-bar-slot"><div class="tl-bar" style="height:' + h + 'px;background:linear-gradient(180deg,' + color + ',' + shade(color, -28) + ');"><span class="tl-bar__peak" style="border-bottom-color:' + color + '"></span></div></div>' +
          '<div class="tl-node__foot"><div class="tl-node__num">' + esc(c.num) + '</div><div class="tl-node__title">' + esc(c.title) + '</div></div>' +
          '</div>';
      }).join('');
      html += '<div class="tl-lane"><div class="tl-lane__label" style="background:' + color + '">' + esc(ln) + '</div><div class="tl-lane__track">' + (nodes || '<span class="tl-axis">（暂无章节）</span>') + '</div></div>';
    });
    canvas.innerHTML = html;
    canvas.querySelectorAll('.tl-node').forEach(n => n.onclick = () => {
      const cid = n.getAttribute('data-cid'); if (cid) gotoChapter(cid);
    });
    // 同步工具栏下拉为「当前章」
    const markSel = $('tlMarkSelect'), storySel = $('tlStorySelect');
    if (markSel && curIdx >= 0) markSel.value = o.chapters[curIdx].mark || '';
    if (storySel) {
      const curLane = (curIdx >= 0) ? o.chapters[curIdx].storyline : '主线';
      // 确保下拉含当前故事线
      if (curLane && !Array.from(storySel.options).some(op => op.value === curLane)) {
        const op = document.createElement('option'); op.value = curLane; op.textContent = curLane; storySel.appendChild(op);
      }
      storySel.value = curLane || '主线';
    }
    renderImpact($('tlImpactBody'));
  }
  // 颜色加深/提亮（hex）
  function shade(hex, amt) {
    let h = (hex || '#7c9cff').replace('#', '');
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    r = Math.max(0, Math.min(255, r + amt)); g = Math.max(0, Math.min(255, g + amt)); b = Math.max(0, Math.min(255, b + amt));
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function setChapterMark(idx, mark) {
    ensureOutlineChapters();
    const c = state.outline.chapters[idx]; if (!c) return;
    c.mark = mark || '';
    save(); renderTimeline(); toast(mark ? ('已将「' + (MARK_TYPES[mark] || {}).label + '」标记到第' + (idx + 1) + '章') : '已清除标记');
  }
  function setChapterStoryline(idx, lane) {
    ensureOutlineChapters();
    const c = state.outline.chapters[idx]; if (!c) return;
    c.storyline = lane || '主线';
    save(); renderTimeline(); toast('已将第' + (idx + 1) + '章归入「' + lane + '」故事线');
  }
  function addStoryline() {
    const idx = currentOutlineIndex(); if (idx < 0) return;
    promptModal('新建故事线名称（如「感情线」「复仇线」）：', '支线' + (uniqueStorylines().length - 1)).then(name => {
      name = (name || '').trim(); if (!name) return;
      const sel = $('tlStorySelect');
      if (sel && !Array.from(sel.options).some(op => op.value === name)) {
        const op = document.createElement('option'); op.value = name; op.textContent = name; sel.appendChild(op);
      }
      setChapterStoryline(idx, name);
    });
  }
  // 大纲影响分析：卷纲/总纲 关键词与各章蓝图的相关度
  function tokenize(text) {
    const t = (text || '').toLowerCase();
    const toks = new Set();
    const en = t.match(/[a-z0-9]+/g); if (en) en.forEach(w => { if (w.length > 1) toks.add(w); });
    const cjkStr = (t.match(/[\u4e00-\u9fff]+/g) || []).join('');
    for (let i = 0; i < cjkStr.length - 1; i++) toks.add(cjkStr.slice(i, i + 2));
    return toks;
  }
  function outlineImpact() {
    const o = state.outline;
    const srcText = [o.book.title, o.book.oneLine, (o.book.themes || []).join(' '), o.volume.title, o.volume.synopsis].join(' ');
    const srcToks = tokenize(srcText);
    if (!srcToks.size) return [];
    const rows = o.chapters.map((c, i) => {
      const tgt = tokenize([c.title, c.synopsis].join(' '));
      const shared = [];
      srcToks.forEach(tk => { if (tgt.has(tk) && tk.length > 1) shared.push(tk); });
      return { idx: i, chapter: c, score: shared.length, shared: shared.slice(0, 6) };
    });
    // 章节标题命中权重更高
    rows.forEach(r => { if (tokenize(r.chapter.title).size && srcToks.has(tokenize(r.chapter.title).values().next().value)) r.score += 0; });
    return rows.sort((a, b) => b.score - a.score);
  }
  function renderImpact(body) {
    if (!body) return;
    const rows = outlineImpact();
    const curIdx = currentOutlineIndex();
    if (!rows.length || !rows.some(r => r.score > 0)) {
      body.innerHTML = '<div class="tl-impact__row"><div class="tl-impact__meta"><div class="tl-impact__ch">暂无强相关章节</div><div class="tl-impact__share">在「大纲」页完善卷纲 / 总纲后，这里会列出受影响的章节蓝图</div></div></div>';
      return;
    }
    const max = Math.max(1, rows[0].score);
    body.innerHTML = rows.filter(r => r.score > 0).map(r => {
      const active = (r.idx === curIdx) ? ' is-active' : '';
      const pct = Math.round((r.score / max) * 100);
      return '<div class="tl-impact__row' + active + '" data-idx="' + r.idx + '">' +
        '<div class="tl-impact__bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="tl-impact__meta"><div class="tl-impact__ch">' + esc(r.chapter.num + ' ' + r.chapter.title) + '</div><div class="tl-impact__share">共有关键词：' + esc(r.shared.join('、') || '—') + '</div></div>' +
        '<div class="tl-impact__score">' + r.score + '</div></div>';
    }).join('');
    body.querySelectorAll('.tl-impact__row').forEach(row => row.onclick = () => {
      const idx = +row.getAttribute('data-idx');
      const cid = state.volumes[0].chapters[idx] && state.volumes[0].chapters[idx].id;
      if (cid) gotoChapter(cid);
    });
  }

  /* ===================== P3/P4 高级 AI 能力 ===================== */
  // 多智能体角色分工
  const AGENT_ROLES = {
    supervisor: { label: '总监', desc: '统筹规划，分解任务、把控全局节奏', prefix: '你现在是「总监」智能体：负责统筹整个创作流程，分解任务、把控全局节奏与一致性，输出结构化的执行计划。' },
    blueprint: { label: '蓝图', desc: '设计剧情蓝图与章节结构', prefix: '你现在是「蓝图」智能体：专注设计剧情蓝图、章节结构与情节转折，输出清晰的大纲与节点设计。' },
    generation: { label: '生成', desc: '正文创作，画面感与网文节奏', prefix: '你现在是「生成」智能体：专注正文创作，文风贴合网文节奏、画面感强，直接输出可用的正文。' },
    setting: { label: '设定', desc: '世界观/角色/物品设定', prefix: '你现在是「设定」智能体：专注世界观、角色、物品与体系设定，输出结构化、可复用的设定条目。' },
    consistency: { label: '一致性', desc: '校验吃书/矛盾', prefix: '你现在是「一致性」智能体：负责校验正文与已有设定是否矛盾、是否存在吃书，输出问题清单与修正建议。' },
    correction: { label: '校正', desc: '润色纠错', prefix: '你现在是「校正」智能体：负责润色、纠错与文笔提升，仅输出修改后的文本。' },
    structure: { label: '结构', desc: '节奏与结构优化', prefix: '你现在是「结构」智能体：专注节奏、伏笔与结构优化，输出结构分析与调整建议。' }
  };
  // 仿写风格标签
  const STYLE_TAGS = [
    { id: 'gufeng', label: '古风' }, { id: 'youmo', label: '幽默' }, { id: 'rexue', label: '热血' },
    { id: 'xuaning', label: '悬疑' }, { id: 'xini', label: '细腻' }, { id: 'baoli', label: '爆裂' }
  ];
  // 平台模型由 /api/models 提供，前端只保留模型 id，不保存连接地址或密钥。
  const GPT_MODEL_LABELS = {
    'gpt-5.6-sol': '5.6 Sol', 'gpt-5.6-terra': '5.6 Terra', 'gpt-5.6-luna': '5.6 Luna',
    'gpt-5.5': '5.5', 'gpt-5.4': '5.4', 'gpt-5.4-mini': '5.4 Mini', 'gpt-5.2': '5.2'
  };
  function modelLabel(id) { const pm = platformModelById(id); if (pm) return pm.name; return GPT_MODEL_LABELS[id] || id; }
  function ensureAdvancedState() {
    if (!Array.isArray(state.inspirations)) state.inspirations = [];
    if (!state.aiRole) state.aiRole = 'generation';
    if (typeof state.aiStyle === 'undefined') state.aiStyle = '';
    // ★ S5：自定义智能体资产（人设 + 专属知识库）
    if (!Array.isArray(state.aiProfiles)) state.aiProfiles = [];
    if (typeof state.aiProfileId === 'undefined') state.aiProfileId = '';
    if (!state.aiSkillDefinitions || typeof state.aiSkillDefinitions !== 'object' || Array.isArray(state.aiSkillDefinitions)) state.aiSkillDefinitions = {};
    if (!Array.isArray(state.modelSources)) state.modelSources = [];
    if (!Array.isArray(state.aiTasks)) state.aiTasks = [];
    if (!state.aiOutputTarget) state.aiOutputTarget = 'chat';
    if (!state.settings) state.settings = { fontSize: 16, lineHeight: 1.8, paragraphSpacing: 12, contentWidth: 720, readingMode: false, theme: 'light', fontFamily: 'system', autosave: true, exportFormat: 'txt', think: false, reasoningEffort: '', contextBudget: 12000, characterMaterialMode: 'auto', models: { default: 'v4-flash', continuation: 'v4-flash', polish: 'v4-flash' } };
    if (typeof state.settings.paragraphSpacing !== 'number') state.settings.paragraphSpacing = 12;
    if (typeof state.settings.contentWidth !== 'number') state.settings.contentWidth = 720;
    if (typeof state.settings.readingMode !== 'boolean') state.settings.readingMode = false;
    if (typeof state.settings.reasoningEffort === 'undefined') state.settings.reasoningEffort = '';
    if (!['auto', 'strong', 'off'].includes(state.settings.characterMaterialMode)) state.settings.characterMaterialMode = 'auto';
    if (![8000, 12000, 18000, 24000].includes(Number(state.settings.contextBudget))) state.settings.contextBudget = 12000;
    if (typeof state.settings.dailyGoal !== 'number') state.settings.dailyGoal = 2000;
    if (typeof state.settings.todayWords !== 'number') state.settings.todayWords = 0;
    if (typeof state.settings.todayDate !== 'string') state.settings.todayDate = '';
    if (!Array.isArray(state.foreshadows)) state.foreshadows = [];
    if (!Array.isArray(state.aiReports)) state.aiReports = [];
    if (!Array.isArray(state.chapterCalls)) state.chapterCalls = [];
    if (state.chapterCalls.length > 60) state.chapterCalls = state.chapterCalls.slice(0, 60);
    if (state.knowledge && state.knowledge.entities) state.foreshadows.forEach(normalizeForeshadow);
  }

  const CHAPTER_WORKFLOW_LABELS = {
    prepare: '前置核对',
    core: '章节核心',
    skill: 'Skill 执行分析',
    writing: '正文初稿',
    review: '连续性与禁用模式检查',
    sync: '章节状态同步',
    finish: '完成确认'
  };
  const CHAPTER_MODERN_TERMS = [
    '手机', '微信', '短信', '电话', '电脑', '键盘', '代码', '服务器', '网络', '直播', '视频',
    '外卖', '地铁', '高铁', '汽车', '电梯', '摄像头', '银行卡', '身份证', '空调', '芯片', 'GPS', 'WiFi'
  ];
  const CHAPTER_CORRECTION_PATTERNS = [
    { key: 'binary_reasoning', label: '工整二分或完整利弊推理', pattern: /不是[^。！？\n]{0,40}而是|若[^。！？\n]{0,30}则|本想[^。！？\n]{0,50}(?:因为|看到|发现)[^。！？\n]{0,50}(?:于是|改为|转而)/g },
    { key: 'template_contrast', label: '无真实反差的模板句', pattern: /(?:却|但|反而)[^。！？\n]{0,2}(?:轻轻|淡淡|平静|猛然|骤然)/g },
    { key: 'mechanical_body', label: '机械化身体状态说明', pattern: /还能(?:走|动|站|战斗)|声音(?:飘|漏|渗)入|所有人都愣住|全场死寂/g },
    { key: 'empty_adverb', label: '高风险空泛副词', pattern: /淡淡地|平静地|轻轻地|猛然间|骤然间|竟然发现/g }
  ];
  // Browser-side mirror of the platform correction scan. The server remains
  // authoritative; this mirror gives chapter review immediate feedback.
  const UNIVERSAL_CORRECTION_PATTERNS = [
    { key: 'R-01-sensory-personification', label: '感官传播不准确/实体化', pattern: /(?:声音|低笑|冷笑|话音|叹息)(?:从|自)[^。！？\n]{0,24}(?:漏(?:出|来)?|飘(?:出|来)?|渗(?:入|出)?|飘忽不定|挤出)/g },
    { key: 'R-02-fragmented-verb', label: '动词缩写生硬', pattern: /(?:颤|抖|顿|颤栗|抽搐)一下/g },
    { key: 'R-03-incomplete-phrase', label: '语句可能不完整', pattern: /(?:哄笑一片|力量是真实的|是哥最大牵挂|在回应着他决心|喘得说不出整句)/g },
    { key: 'R-04-redundant-emotion', label: '动作后的情绪重复说明', pattern: /[^。！？\n]{0,28}(?:满是|充满了|带着|写满)(?:心疼|无奈|紧张|忐忑|恐惧|愤怒|悲伤|担忧|决然|柔情)[^。！？\n]{0,18}/g },
    { key: 'R-05-formulaic-metaphor', label: '高风险套话比喻', pattern: /(?:如刀|如水|如渊|如纸|如雷|如电|如风|如雨|如林|如熊|如死灰|如重锤|如野火|如鬼魅|如断线风筝|如惊雷|如雷霆|如暴雨|如鸿毛|如泰山|如长河|如钉子钉进心头|如散落的棋子|如萤火|一柄出鞘的刀|月光如水|声淡如水|面沉如水|目光如刀|目光锐利如刀|冷硬如刀削|目光沉静如渊|深邃如渊|声音平静如水|泪如断线的珠子|像一潭死水|像谈天气|眉如刀削|目若寒星|寒星般的眸子|像一阵风|声音淡得像一阵风|像一头被逼到绝境的疯狗|像一条受了惊的丧家之犬|语气平得像在谈天气|如铁箍|如牛皮糖|凝练如铁|线条如铁|身形如风|快如风|如同鬼魅般|如鬼魅般|如断线风筝般|落在耳中如重锤|宛如重锤|如暴雨倾泻|如野火般蔓延|苍白如纸|惨白如纸|细密如砂|声音低沉如砂|声音低沉如鼓|像一柄钉子钉进心头|像一根钉子钉进心头|像一盘散落的棋子)/g },
    { key: 'R-06-postposed-state', label: '状态后置表达不自然', pattern: /(?:笑|说|声音|语气|问)[^。！？\n]{0,8}得很(?:轻|淡|平静|冷)/g },
    { key: 'R-07-formulaic-crowd', label: '同步群体反应模板', pattern: /(?:所有人|全场|众人|整个大厅)[^。！？\n]{0,10}(?:都)?(?:愣住|沉默|哑然|死寂|倒吸一口凉气|惊呆)/g },
    { key: 'R-08-formulaic-reasoning', label: '工整二分或完整心理链', pattern: /(?:不是[^。！？\n]{0,50}而是|若[^。！？\n]{0,35}则|本想[^。！？\n]{0,60}(?:因为|看到|发现)[^。！？\n]{0,60}(?:于是|便|转而|改为))/g },
    { key: 'R-09-mechanical-body', label: '机械化身体状态说明', pattern: /(?:双腿|手臂|身体|嗓子|声音)[^。！？\n]{0,12}(?:还能|依旧可以)(?:走|动|站|战斗|说话|发声)/g },
    { key: 'R-10-empty-adverb', label: '高风险空泛修饰', pattern: /淡淡地|平静地|轻轻地|猛然间|骤然间|竟然发现|幽深的|深邃的/g },
    { key: 'R-11-evidence-overclaim', label: '结论超过证据', pattern: /(?:已经证明|事实证明|显然就是|必然是|一定是|绝对是|无疑是|唯一真相|铁证如山|太恐怖了)/g },
    { key: 'R-12-decorative-quantity', label: '装饰性数量词', pattern: /(?:一丝|一股|一种|一缕)(?:[^。！？\n]{0,8})(?:杀意|冷意|寒意|阴鸷|复杂|贪婪|深沉|威压|疲惫|玩味|挣扎|狠厉|心疼|无奈|疯狂|精芒|茫然|释然|温文尔雅|颤抖|惊惶|慌乱)/g },
    { key: 'R-13-artificial-body-subject', label: '局部替代人物主体', pattern: /(?:笔尖|目光|声音|指尖|唇角)[^。！？\n]{0,12}(?:停在|顿在|扫过|落在|做出|决定|勾起)/g },
    { key: 'R-14-template-smile', label: '模板化笑意动作', pattern: /(?:嘴角|唇角)[^。！？\n]{0,14}(?:勾起|微微勾起|缓缓勾起)[^。！？\n]{0,12}(?:一抹)?[^。！？\n]{0,10}(?:弧度|笑意|笑容|冷笑|阴狠|自得|意味难明)/g },
    { key: 'R-15-redundant-transition', label: '无功能转场或能力复述', pattern: /(?:双腿还能用|赶在[^。！？\n]{0,24}(?:之前|前)离开|终于明白|没有人敢说话|心里已经有了决定|脸上早已没了[^。！？\n]{0,10}不耐)/g },
    { key: 'R-16-lip-corner', label: '不自然用词“唇角”应改“嘴角”', pattern: /唇角/g },
    { key: 'R-17-dead-simile', label: '“死一般的”套话', pattern: /死一般的|死一般/g },
    { key: 'R-18-sound-personification', label: '声音实体化变体', pattern: /(?:从齿缝里挤出|声音[^。！？\n]{0,10}飘忽不定|化作冰冷的凝重|化作[^。！？\n]{0,8}的(?:凝重|决绝))/g },
    { key: 'R-19-narrator-value-judgment', label: '旁白越权价值判断与过度惊叹', pattern: /(?:实在不值当|敷衍至极|成长速度太恐怖了|何其恐怖|何其骇人|是的，[^。！？\n]{0,20}太恐怖了)/g },
    { key: 'R-20-contrast-cliche', label: 'AI典型对比句装逼框架', pattern: /(?:普通人|常人|寻常人|旁人|外人)(?:未必能|根本无法|很难|难以)[^。！？\n]{0,20}(?:却太熟悉|却一眼看穿|却再熟悉不过|却心知肚明|却再清楚不过)/g },
    { key: 'R-21-abstract-wound-cliche', label: '伤势与感知抽象比喻套话', pattern: /(?:像被重新凿了一遍|像被撕裂开来|像要炸开一般|像被万蚁噬咬|像一柄利刃直插)/g },
    { key: 'R-22-micro-timing-cliche', label: '微反应过度刻意计时', pattern: /(?:停了|顿了|僵了)(?:半息|一息|两息|数息)/g },
    { key: 'R-23-modern-legal-bureaucracy', label: '现代法务与行政职场黑话', pattern: /(?:证物链|涉案物|违规操作|流程闭环|顶层设计|颗粒度|KPI|打通底层|赋能)/g },
    { key: 'R-24-standup-comedy-quote', label: '现代段子与脱口秀感悟腔', pattern: /(?:坏事总能精准地|所谓的[^。！？\n]{0,10}不过是|这世上最[^。！？\n]{0,10}莫过于|或许这就是[^。！？\n]{0,10}的意义)/g },
    { key: 'R-25-tail-accounting-summary', label: '章尾账目盘点式机械复盘', pattern: /(?:他损了|他赔了)[^。！？\n]{0,30}(?:毁了|折了)[^。！？\n]{0,30}(?:重铠|法器|银两)/g },
    { key: 'R-27-turn-taking-brawl', label: '动作戏回合制点名排队', pattern: /(?:最前一人|第一名|第二名|第三名|第四名|第五名)[^，。\n]{0,15}(?:横刀|砍向|冲来|逼近|趁隙|拔刀)/g },
    { key: 'R-28-binary-symmetry', label: '工整对称二分句式', pattern: /(?:一枚[^，。！？\n]{1,15}，一枚|第一步[^，。！？\n]{1,15}，第二步|只剩半边[^，。！？\n]{0,10}另一半|三只[^，。！？\n]{1,15}只有(?:靠|一))/g },
    { key: 'R-29-slogan-dialogue', label: '角色口号复读与标签台词', pattern: /(?:老子护账|护账不护脑袋|别见血[^，。！？\n]{0,8}见了血|捅死了算你家祖坟)/g },
    { key: 'R-30-lore-announcement', label: '旁白招式报幕与设定弹窗', pattern: /(?:杀步。|那是[^，。\n]{2,12}常用的(?:引煞线|押煞器|法器)|那是押煞器|是押煞器)/g },
    { key: 'R-31-sensory-checklist-loop', label: '生理痛觉指标循环播报', pattern: /(?:砂粒便往发白的脚掌肉里磨|脚掌被靴底砂石磨开|撕裂的皮肉被靴内积水浸透)/g },
    { key: 'R-32-stacked-explanation', label: '说明文式多层因果堆砌', pattern: /(?:大概是|或许是)[^。！？\n]{0,30}(?:又有|又有.*在附近)[^。！？\n]{0,30}(?:才一直没有|才一直没)/g },
    { key: 'R-33-pseudo-precision', label: '伪精确数字与死板步数', pattern: /(?:每隔[三四五六七八九十]步|北偏东\d+度|下降超过\d+丈|长约[七八九]尺|宽不到半尺)/g },
    { key: 'R-34-formulaic-wound-tight', label: '套路化伤势感知（旧伤发紧）', pattern: /(?:旧伤[^。！？\n]{0,10}发紧|旧伤在寒气里发紧|疼痛沿着骨缝往上爬)/g },
    { key: 'R-35-breath-countdown', label: '战斗动作戏秒表倒数', pattern: /第[一二三四五六七八九十]息[，、]/g },
    { key: 'R-36-pupil-dilation-cliche', label: '套路化瞳孔反应', pattern: /瞳孔(?:放大|收缩|猛然收缩|骤缩)/g },
    { key: 'R-37-mechanical-reflex-impact', label: '神经反射式受击震颤套话', pattern: /(?:震得|震得那?)(?:脚底|双脚|双腿|脚掌|虎口|手臂|手腕|指尖|指节|胸口|内脏|五脏|耳膜|耳角|脑仁|浑身|全身|整个人)(?:发麻|发木|发颤|生疼|剧痛|发酸|酸麻|刺痛|嗡嗡|翻涌|发紧)|喉头一甜|气血翻涌|只觉得一股凉气从脚底/g },
    { key: 'R-38-game-meter-ticking', label: '战斗中机械数值打卡/跳字', pattern: /(?:气血|战力|力量|敏捷|体质)(?:测试仪|测试器|数值|读数|指标)?(?:连续)?(?:跳动|暴涨|飙升|停在|从|在)[^。！？\n]{0,20}[0-9\d一二三四五六七八九十百]+(?:卡|点|%)?(?:[，、\s]{0,5}(?:跳到|跳至|升到|达到|破了|飙到)\s*[0-9\d一二三四五六七八九十百]+(?:卡|点|%)?)?/g },
    { key: 'R-39-staccato-subject-monotony', label: '主角名连续主语发报机句式', pattern: /(?:^|\n)\s*([^\s，。！？\n]{2,4})[^\n。！？]{1,20}[。！？]\s*\1[^\n。！？]{1,20}[。！？]\s*\1[^\n。！？]{1,20}[。！？]/g },
    { key: 'R-40-somatic-reflex-cliche', label: '植物神经/微小肌群痉挛套路', pattern: /(?:喉咙|喉头)(?:发紧|一阵发紧)|指节(?:泛白|捏得发白|发白)|呼吸(?:骤然|猛然|不由得)?一滞|心跳(?:猛然|骤然)?漏了一拍|心跳漏了半拍|下颌(?:线)?(?:骤然)?(?:绷紧|收紧)|后颈(?:发凉|汗毛倒竖)|手心(?:沁出|全是)?(?:黏腻的)?冷汗|牙关紧咬|牙关咬得咯咯作响/g },
    { key: 'R-41-hidden-translationese', label: '隐形翻译腔与假深沉修饰链', pattern: /在这一刻显得(?:格外|尤为)|无不在昭示着|带着一种不容置疑的|仿佛只要轻轻一碰(?:，)?就会|与其说是[^，。\n]{1,15}(?:，)?倒不如说是/g },
    { key: 'R-42-bone-whitening-mutation', label: '变种指骨/骨节泛白套路', pattern: /(?:指节|指骨|骨节|关节|指尖|指头|手指|手背|手面)[^，。\n]{0,8}(?:泛白|发白|变白|毫无血色|失去血色|硌得发白|捏得发白|攥得发白)/g },
    { key: 'R-43-rhythmic-pulsing-cliche', label: '机械节律脉动与抽动套路', pattern: /(?:一下一下地?)(?:收紧|抽痛|跳动|刺痛|挤压)|(?:顺着|随着)脉搏[^，。\n]{0,10}(?:收紧|跳动|抽搐|缩紧)/g },
    { key: 'R-44-quest-penalty-staccato', label: '网游任务惩罚弹窗式四字通告', pattern: /(?:若违约|违约者|如若违背|违契者)[，,]?(?:抽取生魂|当为矿奴|抹杀|扣除|炼入煞矿)/g },
    { key: 'R-45-chapter-length-standard', label: '商业单章篇幅硬标准（2000~3000字）', pattern: /(?:[\s\S]{3001,})/g },
    { key: 'R-46-excessive-staring-cliche', label: '滥用盯/盯住制造虚假紧张感', pattern: /(?:死死盯住?|冷冷盯住?|重新盯住?|眼神盯住?|目光盯住?|双眼盯住?|两眼盯住?|蹲在[^，。\n]{0,10}盯[着住]|低头盯[着住]|抬眼盯[着住]|坐着盯[着住]|站着盯[着住])/g }
  ];
  const CHAPTER_EVIDENCE_PATTERNS = [
    { key: 'overclaim', label: '证据过度下结论', pattern: /(?:必然|一定|绝对|无疑|注定|铁证如山|唯一真相|已经证明|事实证明|显然就是)/g },
    { key: 'costless_power', label: '力量或能力无代价越界', pattern: /瞬间恢复|毫无代价|凭空出现|无需付出代价|直接跨越大境界|一眼看穿全部真相/g }
  ];

  function chapterWorkflowStage(message, call, key, text, status) {
    const workflow = message && Array.isArray(message.workflow)
      ? message.workflow
      : call && Array.isArray(call.workflow) ? call.workflow : [];
    if (message) message.workflow = workflow;
    if (call) call.workflow = workflow;
    let item = workflow.find(entry => entry && entry.key === key);
    if (!item) {
      item = { key, label: CHAPTER_WORKFLOW_LABELS[key] || key, status: 'running', text: '', updatedAt: Date.now() };
      workflow.push(item);
    }
    if (status) item.status = status;
    if (text !== undefined) item.text = String(text || '');
    item.updatedAt = Date.now();
    if (message) {
      message.workflowUpdatedAt = item.updatedAt;
      renderAILog();
    }
    return item;
  }

  function chapterSkillSnapshot() {
    const audit = buildSkillAuditPayload('write');
    return {
      version: audit.version,
      skills: audit.skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        files: Array.isArray(skill.files) ? skill.files.slice() : [],
        promptFiles: Array.isArray(skill.promptFiles) ? skill.promptFiles.slice() : [],
        fileManifest: Array.isArray(skill.fileManifest) ? skill.fileManifest.slice() : []
      }))
    };
  }

  function createChapterCallRecord(target, model, taskId, previous) {
    ensureAdvancedState();
    const call = {
      id: uid('chapter-call'),
      chapterId: target && target.chapterId ? target.chapterId : '',
      chapterIndex: target && Number.isFinite(Number(target.index)) ? Number(target.index) : 0,
      chapterTitle: target && target.title ? target.title : '未命名章节',
      model: model || '',
      taskId: taskId || '',
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      previousChapterId: previous && previous.id ? previous.id : '',
      previousChapterTitle: previous && previous.title ? previous.title : '',
      skillAudit: chapterSkillSnapshot(),
      workflow: [],
      stateSync: null,
      review: null,
      result: null
    };
    state.chapterCalls.unshift(call);
    if (state.chapterCalls.length > 60) state.chapterCalls = state.chapterCalls.slice(0, 60);
    return call;
  }

  function chapterPatternMatches(text, definitions) {
    const source = String(text || '');
    return definitions.flatMap(definition => {
      definition.pattern.lastIndex = 0;
      return Array.from(source.matchAll(definition.pattern)).slice(0, 8).map(match => ({
        key: definition.key,
        label: definition.label,
        index: Number(match.index) || 0,
        text: String(match[0] || '').slice(0, 80)
      }));
    });
  }

  function validateChapterDraft(text, target, previousText) {
    const source = String(text || '').trim();
    const words = countWords(source);
    const terms = CHAPTER_MODERN_TERMS.filter(term => source.toLowerCase().includes(term.toLowerCase()));
    const correctionRisks = chapterPatternMatches(source, CHAPTER_CORRECTION_PATTERNS.concat(UNIVERSAL_CORRECTION_PATTERNS));
    const evidenceRisks = chapterPatternMatches(source, CHAPTER_EVIDENCE_PATTERNS);
    const previousTail = String(previousText || '').trim().slice(-420);
    const previousTerms = previousTail ? contextTerms(previousTail).filter(term => term.length >= 2).slice(0, 30) : [];
    const carryTerms = previousTerms.filter(term => source.includes(term)).slice(0, 8);
    const continuity = {
      hasPrevious: !!previousTail,
      carryTerms,
      status: !previousTail || carryTerms.length ? 'passed' : 'manual_review',
      note: !previousTail ? '无上一章正文，按当前章节蓝图起笔' : carryTerms.length ? '检测到上一章结尾的承接词或实体' : '未检测到明显承接词，建议回读章首'
    };
    const fileName = '正文/' + String((target && target.title) || '未命名章节').replace(/[\\/:*?"<>|]/g, '_') + '.html';

    // 全章量化指标
    const simileMatches = source.match(/(?:仿佛|宛如|犹如|好似|像是|如|般)/g) || [];
    const decMatches = source.match(/(?:一丝|一股|一种|一缕)/g) || [];
    const paragraphs = source.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const shortParas = paragraphs.filter(p => p.length <= 8 && !/^[“"「『]/.test(p));
    const exceeded = [];
    if (simileMatches.length > 4) exceeded.push('比喻词超标(' + simileMatches.length + '/4)');
    if (decMatches.length > 2) exceeded.push('装饰词超标(' + decMatches.length + '/2)');
    if (shortParas.length > 3) exceeded.push('单句独立段超标(' + shortParas.length + '/3)');
    if (words > 3000) exceeded.push('篇幅超标(' + words + '/3000)');
    else if (words < 2000 && words > 0) exceeded.push('篇幅不足(' + words + '/2000)');

    const metrics = {
      chars: words,
      similes: simileMatches.length,
      decorativeQuantities: decMatches.length,
      singleSentenceParagraphs: shortParas.length,
      exceeded
    };

    const result = {
      version: 1,
      fileName,
      wordCount: words,
      modernTerms: terms,
      correctionRisks,
      evidenceRisks,
      continuity,
      metrics,
      status: terms.length || correctionRisks.length || evidenceRisks.length || exceeded.length || continuity.status !== 'passed' ? 'needs_review' : 'passed',
      checkedAt: Date.now()
    };
    return result;
  }

  function chapterResultExcerpt(text) {
    const sentences = String(text || '').split(/[。！？!?\n]+/).map(item => item.trim()).filter(Boolean);
    return sentences.slice(-3).join('。').slice(0, 360);
  }

  function syncChapterStateAfterCommit(chapter, target, text, review, call) {
    ensureKnowledge();
    ensureAdvancedState();
    const now = Date.now();
    const plain = String(text || '').trim();
    const entityIds = [];
    const entitySnapshots = [];
    entList().forEach(entity => {
      const refs = [entity.name, ...(entity.aliases || [])].filter(Boolean).map(String);
      if (!refs.some(ref => plain.includes(ref))) return;
      entity.lastMentionedChapterId = chapter.id;
      entity.lastMentionedAt = now;
      entity.chapterState = {
        chapterId: chapter.id,
        status: entity.status || '',
        currentLocation: entity.currentLocation || '',
        owner: entity.owner || '',
        updatedAt: now
      };
      recordEntityHistory(entity);
      entityIds.push(entity.id);
      entitySnapshots.push({ id: entity.id, name: entity.name, status: entity.status || '', currentLocation: entity.currentLocation || '' });
    });
    const foreshadowIds = [];
    const resolvedForeshadowIds = [];
    state.foreshadows.forEach(item => {
      normalizeForeshadow(item);
      const relatedNames = (item.relatedEntityIds || []).map(id => state.knowledge.entities[id] && state.knowledge.entities[id].name).filter(Boolean);
      const refs = [item.title, ...(item.clues || []), ...relatedNames].filter(Boolean).map(String);
      if (!refs.some(ref => ref && plain.includes(ref))) return;
      item.lastMentionedChapterId = chapter.id;
      item.lastMentionedAt = now;
      item.updatedAt = now;
      if (item.status === 'planned') item.status = 'planted';
      else if (item.status === 'planted') item.status = 'developing';
      const canResolve = item.targetChapterId === chapter.id && /揭示|回收|真相|证实|破解|承认|供出|揭开/.test(plain);
      if (canResolve) {
        item.status = 'resolved';
        item.resolvedChapterId = chapter.id;
        resolvedForeshadowIds.push(item.id);
      }
      foreshadowIds.push(item.id);
    });
    const outline = state.outline && state.outline.chapters && state.outline.chapters[target.outlineIndex == null ? target.index : target.outlineIndex];
    if (outline) {
      outline.status = 'done';
      outline.wordCount = review.wordCount;
      outline.result = chapterResultExcerpt(plain);
      outline.continuation = String(plain).slice(-360);
    }
    chapter.fileName = review.fileName;
    chapter.chapterCallId = call ? call.id : '';
    chapter.lastResult = chapterResultExcerpt(plain);
    chapter.continuationPoint = String(plain).slice(-360);
    if (call) {
      call.status = review && review.status === 'passed' ? 'committed' : 'committed_with_warnings';
      call.updatedAt = now;
      call.review = review;
      call.result = {
        excerpt: chapterResultExcerpt(plain),
        continuationPoint: chapter.continuationPoint,
        wordCount: review.wordCount
      };
      call.stateSync = {
        entityIds,
        entitySnapshots,
        foreshadowIds,
        resolvedForeshadowIds,
        outlineChapter: outline ? outline.num || outline.title || '' : '',
        syncedAt: now
      };
    }
    return { entityIds, entitySnapshots, foreshadowIds, resolvedForeshadowIds, outline };
  }
  function rolePrefix() {
    // ★ S5：自定义智能体优先——命中 aiProfileId 且 systemPrompt 非空时，用它替换内置角色前缀
    const profile = findActiveProfile();
    if (profile && profile.systemPrompt) return profile.systemPrompt;
    const r = AGENT_ROLES[state.aiRole] || AGENT_ROLES.generation;
    return r.prefix;
  }
  // ★ S5：查找当前启用的自定义智能体
  function findActiveProfile() {
    ensureAdvancedState();
    if (!state.aiProfileId) return null;
    return (state.aiProfiles || []).find(p => p && p.id === state.aiProfileId && p.systemPrompt) || null;
  }
  // ★ S5：把当前角色+风格保存为可复用智能体模板
  function saveCurrentAsProfile(name) {
    ensureAdvancedState();
    const clean = String(name || '').trim().slice(0, 30);
    if (!clean) { toast('请输入智能体名称'); return null; }
    const r = AGENT_ROLES[state.aiRole] || AGENT_ROLES.generation;
    const style = STYLE_TAGS.find(s => s.id === state.aiStyle);
    const base = (findActiveProfile() && findActiveProfile().systemPrompt) || r.prefix;
    const sys = base + (style ? '\n\n【仿写风格】' + style.label + '：请在不破坏结构的前提下，让正文表达贴合「' + style.label + '」的风格特征。' : '');
    const p = { id: uid('ap'), name: clean, systemPrompt: sys, aiRole: state.aiRole, aiStyle: state.aiStyle || '', createdAt: Date.now(), updatedAt: Date.now() };
    state.aiProfiles.unshift(p);
    if (state.aiProfiles.length > 30) state.aiProfiles = state.aiProfiles.slice(0, 30);
    state.aiProfileId = p.id;
    save();
    renderRoleSelectOptions();
    updateRoleDisplay();
    renderRightPanel();
    toast('已保存自定义智能体「' + clean + '」并启用');
    return p;
  }
  function deleteProfile(id) {
    ensureAdvancedState();
    const idx = (state.aiProfiles || []).findIndex(p => p && p.id === id);
    if (idx < 0) return;
    const name = state.aiProfiles[idx].name;
    state.aiProfiles.splice(idx, 1);
    if (state.aiProfileId === id) state.aiProfileId = '';
    save();
    renderRoleSelectOptions();
    updateRoleDisplay();
    renderRightPanel();
    toast('已删除智能体「' + (name || id) + '」');
  }
  // ★ S5：渲染角色下拉——内置 7 角色 + 分隔线 + 自定义智能体列表
  function renderRoleSelectOptions() {
    ensureAdvancedState();
    const roleSel = $('aiRoleSelect');
    if (!roleSel) return;
    const cur = roleSel.value;
    let html = Object.keys(AGENT_ROLES).map(key => '<option value="' + key + '">' + AGENT_ROLES[key].label + '</option>').join('');
    const profiles = state.aiProfiles || [];
    if (profiles.length) html += '<option disabled>── 自定义 ──</option>' + profiles.map(p => '<option value="ap:' + p.id + '">' + esc(p.name) + '（自定义）</option>').join('');
    roleSel.innerHTML = html;
    if (state.aiProfileId) { const hit = profiles.some(p => p.id === state.aiProfileId); roleSel.value = hit ? ('ap:' + state.aiProfileId) : cur; }
    else roleSel.value = state.aiRole && AGENT_ROLES[state.aiRole] ? state.aiRole : 'generation';
  }
  // ★ S5：顶部智能体名称显示同步（顶层函数，供角色切换/保存模板后刷新）
  function updateRoleDisplay() {
    const roleDisplay = $('aiRoleDisplay');
    if (!roleDisplay) return;
    const roleSel = $('aiRoleSelect');
    const v = roleSel ? roleSel.value : '';
    const roleMap = { supervisor: '总监智能体', blueprint: '蓝图智能体', generation: '默认智能体', setting: '设定专家', consistency: '一致性校验', correction: '校正助手', structure: '结构分析师' };
    if (String(v).startsWith('ap:')) {
      const p = (state.aiProfiles || []).find(x => x.id === String(v).slice(3));
      roleDisplay.textContent = p ? p.name + '（自定义）' : '自定义智能体';
      return;
    }
    roleDisplay.textContent = roleMap[v] || v || '默认智能体';
  }
  // ★ S5：管理自定义智能体弹窗（列表 / 启用 / 删除）
  function openProfileManager() {
    ensureAdvancedState();
    const profiles = state.aiProfiles || [];
    let html = '<h3 class="ml-modal__title">自定义智能体</h3><p class="ml-modal__hint">把角色、风格与人设 Prompt 保存为可复用模板，随时切换。</p>';
    if (!profiles.length) {
      html += '<div class="kg-empty">还没有自定义智能体。点右侧 AI 面板「设置 → 保存为自定义智能体」创建。</div>';
    } else {
      html += '<div class="kg-list">' + profiles.map(p => {
        const active = state.aiProfileId === p.id;
        return '<div class="kg-rel-row" data-ap-id="' + esc(p.id) + '">' +
          '<div style="flex:1;min-width:0"><strong>' + esc(p.name) + '</strong>' + (active ? ' <span class="ai-msg-approval ai-msg-approval--accepted">使用中</span>' : '') +
          '<div class="kg-search-hint">' + esc((p.systemPrompt || '').slice(0, 90)) + '…</div></div>' +
          '<button type="button" data-ap-act="use" data-ap-id="' + esc(p.id) + '">' + (active ? '已启用' : '启用') + '</button>' +
          '<button type="button" data-ap-act="del" data-ap-id="' + esc(p.id) + '">删除</button>' +
          '</div>';
      }).join('') + '</div>';
    }
    const modal = openModal(html, { wide: true });
    modal.querySelectorAll('[data-ap-act]').forEach(btn => btn.onclick = () => {
      const id = btn.dataset.apId;
      if (btn.dataset.apAct === 'use') { state.aiProfileId = id; save(); renderRoleSelectOptions(); updateRoleDisplay(); renderRightPanel(); closeModal(); toast('已启用自定义智能体'); }
      else if (btn.dataset.apAct === 'del') { if (confirm('确认删除该智能体？')) { deleteProfile(id); openProfileManager(); } }
    });
  }
  // 灵感卡片注入 buildSystem
  function inspirationBlock() {
    ensureAdvancedState();
    const on = state.inspirations.filter(i => i.enabled && (i.content || i.title));
    if (!on.length) return '';
    return '\n\n【灵感/素材卡片（作者整理，创作时可参考融入）】\n' + on.map(i => '· 《' + (i.title || '无题') + '》' + (i.tag ? '[' + i.tag + ']' : '') + '：' + (i.content || '')).join('\n');
  }

  // ---- P3a 流式直插续写 ----
  let streamInsertCtl = null;
  let streamInsertActive = false;
  let chatCtl = null;  // AI聊天/快捷指令的 AbortController
  let aiTargetVersion = 0;
  function captureAITarget() {
    return {
      version: aiTargetVersion,
      account: sessionIdentity(),
      novelId: currentId,
      stateRef: state,
      chapterId: state && state.currentChapterId || '',
      sceneId: state && state.currentSceneId || '',
      sessionId: state && state.currentSessionId || ''
    };
  }
  function isCurrentAITarget(target) {
    return !!target && target.version === aiTargetVersion && target.account === sessionIdentity() && target.novelId === currentId && target.stateRef === state && target.chapterId === (state && state.currentChapterId || '') && target.sceneId === (state && state.currentSceneId || '') && target.sessionId === (state && state.currentSessionId || '');
  }
  function invalidateAIRequests() {
    aiTargetVersion += 1;
    [chatCtl, genNextCtl, streamInsertCtl].forEach(ctl => {
      if (ctl && typeof ctl.abort === 'function') { try { ctl.abort(); } catch (_) {} }
    });
    chatCtl = null;
    genNextCtl = null;
    streamInsertCtl = null;
    genNextActive = false;
    streamInsertActive = false;
    setAIStopState(false);
    setGenNextUI(false);
    setStreamInsertUI(false);
  }
  async function streamInsertContinue() {
    if (streamInsertActive) { toast('正在生成中，请稍候'); return; }
    if (!editorContent) { toast('编辑器未就绪'); return; }
    switchTab('writing');
    editorContent.focus();
    // 光标移到末尾
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editorContent);
    range.collapse(false);
    sel.removeAllRanges(); sel.addRange(range);
    const userText = getTextBeforeCursor();
    const requestTarget = captureAITarget();
    const initialEditorHTML = editorContent.innerHTML;
    const sys = await buildSystemReady('你是正文生成智能体。请在当前正文之后直接续写，保持文风与视角一致，只输出续写正文，不要解释、不要重复原文。');
    if (!sys || !isCurrentAITarget(requestTarget)) return;
    const userMsg = '请紧接上文继续创作约300-600字：\n\n【当前正文】\n' + userText;
    const streamModel = currentUnifiedModel();
    const characterMaterial = buildCharacterMaterialRequest(userMsg, { proseTask: true });
    const task = createAITask('流式续写', streamModel, 'body', { kind: 'streamInsert', text: userMsg });
    // ★ S4：记录本次注入的上下文规模（节点级上下文隔离可视化）
    const ctxMeta = captureCtxMeta();
    streamInsertActive = true;
    setStreamInsertUI(true);
    try {
      await streamSkillPipeline({ model: streamModel, thinking: false, skillMode: 'write', analyzeSkill: true, humanize: false, characterMaterial, messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] }, {
      onStage: stage => { if (isCurrentAITarget(requestTarget)) updateAITask(task, { stage: stage === 'skill_analysis' ? '正在分析已选 Skill' : stage === 'humanizer' ? '正在执行 humanizer 后处理' : '正在流式续写' }); },
      onStart: c => { if (!isCurrentAITarget(requestTarget)) return; streamInsertCtl = c; bindAITaskController(task, c); updateAITask(task, { stage: '正在流式续写', progress: 8 }); },
      onBilling: billing => { if (isCurrentAITarget(requestTarget)) updateAITaskBilling(task, billing); },
      onReplaceText: text => {
        if (!streamInsertActive || !isCurrentAITarget(requestTarget)) return;
        editorContent.innerHTML = initialEditorHTML + textToParas(text);
        setSceneContent(editorContent.innerHTML);
        updateWordCount();
      },
      onDelta: d => {
        if (!streamInsertActive || !isCurrentAITarget(requestTarget)) return;
        document.execCommand('insertText', false, d);
        updateWordCount();
      },
      onDone: (reason, usage) => {
        if (!isCurrentAITarget(requestTarget)) return;
        streamInsertActive = false; streamInsertCtl = null; setStreamInsertUI(false);
        const materialBlocked = reason === 'material_overlap' || !!(usage && usage.characterMaterial && usage.characterMaterial.blocked);
        if (materialBlocked) {
          editorContent.innerHTML = initialEditorHTML;
          setSceneContent(editorContent.innerHTML);
          updateWordCount();
          if (immersiveEditor) immersiveEditor.innerHTML = editorContent.innerHTML;
          save();
          finishAITask(task, 'material_overlap', usage, { resultExcerpt: '素材原创性审计未通过，已阻止写入' });
          logAICall('流式续写', streamModel, usage, '素材原创性审计未通过，已阻止写入', ctxMeta);
          toast('人物素材原创性审计未通过，已恢复原文，未写入章节');
          return;
        }
        setSceneContent(editorContent.innerHTML);
        if (immersiveEditor) immersiveEditor.innerHTML = editorContent.innerHTML;
        save({ snapshot: true });
        finishAITask(task, reason, usage, { resultExcerpt: '流式续写已写入正文' });
        logAICall('流式续写', streamModel, usage, '流式续写', ctxMeta);
        toast(reason === 'credit_exhausted' ? '积分已耗尽，续写已停止，已生成内容保留在正文中' : reason === 'length' ? '已达到输出长度上限，续写已插入正文，可再次点击继续' : reason === 'abort' ? '已停止续写，已生成内容保留在正文中' : '续写已插入正文');
      },
      onError: (e, meta) => {
        if (!isCurrentAITarget(requestTarget)) return;
        streamInsertActive = false; streamInsertCtl = null; setStreamInsertUI(false);
        if (meta && meta.partialText) {
          editorContent.innerHTML = initialEditorHTML + textToParas(meta.partialText);
          setSceneContent(editorContent.innerHTML);
          updateWordCount();
        }
        finishAITask(task, meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', null, { error: String(e) });
        toast(meta && meta.partialText ? 'humanizer 后处理失败，已保留写作初稿' : '续写失败：' + e);
      }
      });
    } catch (error) {
      if (!isCurrentAITarget(requestTarget)) return;
      streamInsertActive = false; streamInsertCtl = null; setStreamInsertUI(false);
      finishAITask(task, 'error', null, { error: String(error && error.message || error) });
      toast('续写失败：' + (error && error.message || error));
    } finally {
      if (isCurrentAITarget(requestTarget) && streamInsertActive) {
        streamInsertActive = false; streamInsertCtl = null; setStreamInsertUI(false);
      }
    }
  }
  function stopStreamInsert() {
    streamInsertActive = false;
    if (streamInsertCtl) { try { streamInsertCtl.abort(); } catch (_) {} streamInsertCtl = null; }
    setStreamInsertUI(false);
    setSceneContent(editorContent.innerHTML);
    save();
    toast('已停止生成');
  }
  function setStreamInsertUI(active) {
    const btn = $('streamInsertBtn'); if (btn) { btn.textContent = active ? '停止' : '流式续写'; btn.classList.toggle('is-active', active); }
    const stopBtn = $('streamInsertStop'); if (stopBtn) stopBtn.style.display = active ? '' : 'none';
  }

  // ---- 生成下一章：按大纲蓝图 + 已有内容，AI 创作新章节 ----
  let genNextActive = false, genNextCtl = null;
  // 将 AI 返回的纯文本（可能带 markdown 围栏/标题行）转为安全段落 HTML
  function textToParas(text) {
    return normalizeSceneContent(text) || '<p></p>';
  }
  function dissectionSourceId() {
    const source = state && state.dissectionSource;
    return source && source.dissectionId ? String(source.dissectionId) : '';
  }
  function chapterContentFingerprint(text) {
    const value = String(text || '');
    return value.length + ':' + value.slice(0, 80) + ':' + value.slice(-80);
  }
  // ★ Q0 · 禁止复制清单：从新书 Bible/outline 提取原创禁止复制项（方案 9.5 原创审计的确定性第一层）。
  function forbiddenCopyTerms() {
    const list = [];
    const fc = state && state.outline && state.outline.forbiddenCopy;
    if (Array.isArray(fc)) {
      fc.forEach(item => {
        if (typeof item === 'string') { const v = item.trim(); if (v) list.push(v); }
        else if (item && typeof item === 'object') {
          const v = String(item.term || item.name || item.entity || item.desc || '').trim();
          if (v) list.push(v);
        }
      });
    }
    // 兼容旧数据：portableBlueprint 若含 forbiddenCopy 字段
    const pb = state && state.outline && state.outline.portableBlueprint;
    if (pb && Array.isArray(pb.forbiddenCopy)) pb.forbiddenCopy.forEach(v => { const t = String(v || '').trim(); if (t) list.push(t); });
    return [...new Set(list)].filter(Boolean).slice(0, 300);
  }
  // ★ Q0 · 本地最小章节合同：无 dissectionId 的新书也必须有可执行合同，禁止返回 null 静默跳过（方案 11.3-1.1）。
  function localChapterContract(target) {
    const idx = target && (target.outlineIndex != null ? target.outlineIndex : target.index);
    const plan = (idx != null && state.outline && state.outline.chapters) ? (state.outline.chapters[idx] || {}) : {};
    const goal = String(plan && plan.synopsis || (target && target.synopsis) || '').slice(0, 1000);
    const forbidden = forbiddenCopyTerms();
    const foreshadowPlan = (state.foreshadows || []).filter(f => !['resolved', 'abandoned'].includes(f.status)).slice(0, 8)
      .map(f => ({ id: String(f.id || ''), action: 'advance', desc: String(f.description || f.title || '').slice(0, 80) }));
    return {
      chapterNo: Number(idx != null ? idx : 0) + 1,
      arcId: '',
      goal,
      protagonistAction: '',
      opposition: '',
      informationChange: '',
      escalation: '',
      irreversibleResult: '',
      characterStateChanges: [],
      foreshadowActions: foreshadowPlan,
      continuityInputs: [],
      continuityOutputs: [],
      mustAvoid: forbidden.slice(0, 30).map(term => ({ term, reason: '原创禁止复制项（来自创作简报）' })),
      endHook: '',
      source: 'local' // 标记本地生成合同；有 dissectionId 时由服务端生成
    };
  }
  // ★ Q0 · 本地确定性审计：无 dissectionId 的新书必须运行真实检查，禁止 skipped + passed 假通过（方案 11.3-1.1 / 9.1）。
  function localChapterAudit(content, target, contract) {
    const issues = [];
    const text = String(content || '').trim();
    const words = countWords(text);
    if (!text) issues.push({ severity: 'blocker', category: 'other', position: '', description: '正文为空，无法审计', suggestion: '请先生成或填写本章正文。' });
    else if (words < 30) issues.push({ severity: 'blocker', category: 'other', position: '', description: '本章正文过短（' + words + ' 字），不足以兑现章节目标', suggestion: '请补充正文后再提交。' });
    // 原创性：禁止复制项出现即阻断
    if (text) forbiddenCopyTerms().forEach(term => {
      if (term && term.length >= 2 && text.includes(term)) {
        issues.push({ severity: 'blocker', category: 'originality', position: '', description: '正文出现禁止复制项「' + term.slice(0, 40) + '」', suggestion: '替换为原创表述，避免复刻原书专属内容。' });
      }
    });
    // 合同目标核对：只做 info 提示，不阻断（防止关键词误报）
    if (contract && String(contract.goal || '').trim() && text) {
      issues.push({ severity: 'info', category: 'continuity', position: '', description: '已生成正文，建议人工核对是否兑现本章合同目标：' + String(contract.goal).slice(0, 40), suggestion: '' });
    }
    const blockers = issues.filter(i => i.severity === 'blocker');
    const ran = text.length > 0;
    return {
      passed: ran && blockers.length === 0,
      skipped: false,
      notRun: !ran,
      issues: issues.slice(0, 40),
      blockerCount: blockers.length,
      summary: ran ? ('本地确定性审计完成：' + issues.length + ' 项发现，' + blockers.length + ' 项阻断' + (blockers.length ? '（请修正后重试）' : '。')) : '审计未运行：正文为空',
      source: 'local',
      contentFingerprint: chapterContentFingerprint(content)
    };
  }
  async function requestChapterContract(target, previousChapter) {
    const sourceId = dissectionSourceId();
    const outline = target && state.outline && state.outline.chapters
      ? state.outline.chapters[target.outlineIndex == null ? target.index : target.outlineIndex] || {}
      : {};
    // ★ Q0 · 新书无 dissectionId：生成本地最小合同，禁止静默跳过
    if (!sourceId) return localChapterContract(target, outline);
    const previousText = previousChapter
      ? previousChapter.scenes.map(scene => htmlToText(scene.content || '')).join('\n\n')
      : '';
    const data = await api('/api/dissections/' + encodeURIComponent(sourceId) + '/chapter-contract', 'POST', {
      chapterNo: Number(target && target.index || 0) + 1,
      goal: String(outline.synopsis || target && target.synopsis || '').slice(0, 1000),
      direction: String(outline.storyline || '').slice(0, 300),
      prevEnding: previousText.slice(-1800)
    });
    if (!data || !data.ok || !data.contract) throw new Error('章节合同生成失败，请重试');
    return data.contract;
  }
  async function requestChapterAudit(content, target, contract) {
    const sourceId = dissectionSourceId();
    // ★ Q0 · 新书无 dissectionId：运行本地确定性审计，禁止返回 { skipped, passed: true } 假通过
    if (!sourceId) return localChapterAudit(content, target, contract);
    const data = await api('/api/dissections/' + encodeURIComponent(sourceId) + '/audit', 'POST', {
      chapterNo: Number(target && target.index || 0) + 1,
      content: String(content || ''),
      contract: contract && typeof contract === 'object' ? contract : {},
      upTo: Number(target && target.index || 0) + 1
    });
    if (!data || !data.ok || !data.audit) throw new Error('连续性审计失败，未允许提交章节');
    return { ...data.audit, contentFingerprint: chapterContentFingerprint(content) };
  }
  function startDirectedChapterRewrite(options) {
    const o = options || {};
    let buf = '';
    const characterMaterial = buildCharacterMaterialRequest(o.user || '', { proseTask: true });
    genNextActive = true;
    setGenNextUI(true);
    chapterWorkflowStage(o.message, o.call, 'review', '服务端连续性审计发现 blocker，正在执行一次定向返工。', 'running');
    return streamSkillPipeline({
      model: o.model,
      thinking: state.settings.think,
      skillMode: 'write',
      analyzeSkill: true,
      humanize: false,
      characterMaterial,
      messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.user }]
    }, {
      onStage: stage => updateAITask(o.task, { stage: stage === 'skill_analysis' ? '重写：正在分析已选 Skill' : '正在按连续性审计返工' }),
      onStart: controller => { genNextCtl = controller; bindAITaskController(o.task, controller); },
      onBilling: billing => updateAITaskBilling(o.task, billing),
      onReplaceText: text => { buf = String(text || ''); if (o.message) { o.message.text = buf; renderAILog(); } },
      onThink: text => { if (o.message) { o.message.thinking = (o.message.thinking || '') + text; renderAILog(); } },
      onSkillAnalysisDelta: text => { if (o.message) { o.message.skillAnalysis = (o.message.skillAnalysis || '') + text; renderAILog(); } },
      onDelta: text => { buf += text; if (o.message) { o.message.text = buf; renderAILog(); } },
      onDone: (reason, usage) => {
        genNextActive = false; genNextCtl = null; setGenNextUI(false);
        if (o.message) {
          o.message.pending = false;
          o.message.finishReason = reason || '';
          o.message.partial = ['abort', 'length', 'credit_exhausted', 'material_overlap'].includes(reason);
          o.message.status = reason === 'material_overlap' ? 'material_overlap' : o.message.status;
          o.message.text = buf || (reason === 'material_overlap' ? '素材原创性审计未通过，已阻止写入' : 'AI 未返回重写正文');
          o.message.chapterAudit = buf ? validateChapterDraft(buf, { index: o.index, title: o.title, outlineIndex: o.index }, o.previousText) : null;
        }
        if (reason === 'material_overlap' || (usage && usage.characterMaterial && usage.characterMaterial.blocked)) {
          chapterWorkflowStage(o.message, o.call, 'review', '人物素材原创性审计未通过，已阻止本次返工结果写入。', 'failed');
          attachUsageToMessage(o.messageIndex, usage);
          finishAITask(o.task, 'material_overlap', usage, { resultExcerpt: '素材原创性审计未通过，已阻止写入' });
          save(); renderAILogNow();
          toast('人物素材原创性审计未通过，定向返工结果未写入');
          return;
        }
        o.call.review = o.message && o.message.chapterAudit;
        if (buf && o.contract) {
          requestChapterAudit(buf, { index: o.index }, o.contract).then(audit => {
            o.call.serverAudit = audit;
            if (o.message) o.message.serverAudit = audit;
            save(); renderAILogNow();
          }).catch(() => {});
        }
        attachUsageToMessage(o.messageIndex, usage);
        finishAITask(o.task, reason, usage, { resultExcerpt: (o.message && o.message.text || '').slice(0, 180) });
        save(); renderAILogNow();
        toast(reason === 'credit_exhausted' ? '积分已耗尽，定向返工已停止' : '定向返工完成，请重新提交前确认审计结果');
      },
      onError: (error, meta) => {
        genNextActive = false; genNextCtl = null; setGenNextUI(false);
        if (o.message) {
          o.message.pending = false;
          o.message.status = 'failed';
          o.message.text = meta && meta.partialText ? String(meta.partialText) : '⚠️ 定向返工失败：' + error;
        }
        finishAITask(o.task, 'error', null, { error: String(error) });
        save(); renderAILogNow();
      }
    });
  }
  async function generateNextChapter() {
    if (genNextActive) { toast('正在生成下一章，请稍候'); return; }
    const requestSession = sessionIdentity();
    // 必须在第一个 await 之前加锁，否则 buildSystemReady 等异步准备阶段会允许重复请求。
    genNextActive = true;
    setGenNextUI(true);
    let task = null;
    let chapterCall = null;
    let botMessage = null;
    let botMsgIndex = -1;
    let requestTarget = null;
    try {
      if (!state || !state.volumes || !state.volumes[0]) { toast('小说数据异常'); return; }
      ensureOutlineChapters();
      const vol = state.volumes[0];
      const ch = currentChapter();
      if (!ch) { toast('当前没有可承接的章节'); return; }
      requestTarget = captureAITarget();
      let curIdx = vol.chapters.indexOf(ch);
      if (curIdx < 0) curIdx = vol.chapters.length - 1;
      const nextIdx = curIdx + 1;
      const targetOutline = state.outline.chapters[nextIdx] || null;
      const existingCh = vol.chapters[nextIdx] || null;
      const chNum = nextIdx + 1;
      const title = (targetOutline && targetOutline.num) ? targetOutline.num : ((existingCh && existingCh.title) || ('第' + chNum + '章'));
      const sub = (targetOutline && targetOutline.title) ? targetOutline.title : ((existingCh && existingCh.sub) || '');
      const nextModel = currentUnifiedModel();
      const characterMaterial = buildCharacterMaterialRequest(
        '承接上一章并完成本章正文：' + [title, sub, targetOutline && targetOutline.synopsis].filter(Boolean).join('；'),
        { proseTask: true }
      );
      chapterCall = createChapterCallRecord({ index: nextIdx, title, sub, chapterId: existingCh ? existingCh.id : '' }, nextModel, '', ch);
      task = createAITask('生成下一章', nextModel, 'body', { kind: 'nextChapter' });
      chapterCall.taskId = task.id;
      getCurrentSession();
      state.aiMessages = state.aiMessages || [];
      state.aiMessages.push({ role: 'user', text: '【生成下一章】' + title + (sub ? (' · ' + sub) : '') });
      botMessage = {
        role: 'bot',
        text: '思考中…',
        thinking: '',
        skillAnalysis: '',
        workflow: [],
        action: 'nextChapter',
        pending: true,
        taskId: task.id,
        outputTarget: 'body',
        nextChapter: {
          index: nextIdx,
          outlineIndex: nextIdx,
          title: title,
          sub: sub,
          chapterId: existingCh ? existingCh.id : '',
          callId: chapterCall.id
        }
      };
      state.aiMessages.push(botMessage);
      botMsgIndex = state.aiMessages.length - 1;
      chapterWorkflowStage(botMessage, chapterCall, 'prepare', '我会承接上一章末尾，先核对写作 Skill、纠错库、上一章和章节调用表。', 'running');
      renderAILog();

      // 系统提示：强调遵循蓝图 + 已有内容，杜绝随意发挥
      const target = targetOutline || state.outline.chapters[nextIdx];
      const targetSeed = [title, sub, target && target.synopsis, target && target.storyline].filter(Boolean).join('\n');
      let chapterContract = null;
      // ★ Q0 · 无论是否有 dissectionId 都生成章节合同：有源走服务端，无源走本地最小合同（不再静默跳过）
      chapterWorkflowStage(botMessage, chapterCall, 'core', '正在生成本章结构合同，并核对上一章结尾、人物状态与未回收伏笔。', 'running');
      chapterContract = await requestChapterContract({ ...target, index: nextIdx, outlineIndex: nextIdx }, ch);
      chapterCall.contract = chapterContract;
      chapterWorkflowStage(botMessage, chapterCall, 'core', '章节合同已生成：本章必须产生明确的信息变化、升级压力和不可逆结果。', 'completed');
      const contractBlock = chapterContract ? '\n\n【章节合同】\n' + JSON.stringify(chapterContract) : '';
      const sys = await buildSystemReady('你是正文生成智能体，负责创作「下一章」。必须严格依据下方【章节蓝图】中的「目标章节」规划与【已有内容回顾】承接剧情、自然推进；保持文风、叙事视角与人物设定前后一致；不要随意引入与规划冲突的新主线、新设定或突兀转折；只输出该章正文（按场景/情节自然分段为多个段落），不要章节标题、不要解释、不要重复前文。' + (contractBlock ? '章节合同是硬约束，必须逐项兑现，不得无证据回收伏笔或改变既有事实。' : ''), targetSeed + contractBlock);
      if (sessionIdentity() !== requestSession || !isCurrentAITarget(requestTarget)) return;
      if (!sys) {
        botMessage.pending = false;
        botMessage.status = 'failed';
        botMessage.text = '⚠️ Skill 尚未完整加载，已停止本章生成';
        chapterCall.status = 'failed';
        chapterWorkflowStage(botMessage, chapterCall, 'prepare', 'Skill 未完整加载，未进入正文生成。', 'failed');
        finishAITask(task, 'error', null, { error: 'Skill 尚未完整加载' });
        renderAILogNow();
        save();
        return;
      }
      chapterCall.skillAudit = chapterSkillSnapshot();
      const skillNames = chapterCall.skillAudit.skills.map(skill => skill.name).filter(Boolean);
      chapterWorkflowStage(botMessage, chapterCall, 'prepare', '已核对 Skill：' + (skillNames.join('、') || '当前未选择额外 Skill') + '；纠错库随 Skill 文件一并载入；上一章结尾与章节调用表已加入本次上下文。', 'completed');
      chapterWorkflowStage(botMessage, chapterCall, 'core', '第' + chNum + '章的核心为：' + (target && target.synopsis ? target.synopsis : '承接上一章结尾，推进当前章节蓝图并固定一个不可逆结果。'), 'completed');
      // 用户消息：目标蓝图 + 前文回顾（显式给出，进一步锚定）
      let userMsg = '【目标章节蓝图】\n';
      userMsg += '章节：' + title + (sub ? (' ' + sub) : '') + '\n';
      if (target && target.synopsis) userMsg += '本章规划：' + target.synopsis + '\n';
      if (target && target.mark && MARK_TYPES[target.mark]) userMsg += '本章标记：' + MARK_TYPES[target.mark].label + '\n';
      if (target && target.storyline) userMsg += '故事线：' + target.storyline + '\n';
      userMsg += '\n【已有内容回顾（用于承接剧情，保持连贯）】\n';
      const earlierOutlines = (state.outline.chapters || []).slice(0, Math.max(0, nextIdx - 2)).filter(item => item && item.synopsis);
      if (earlierOutlines.length) {
        userMsg += '\n【更早剧情摘要】\n' + earlierOutlines.slice(-12).map((item, index) => (Math.max(1, nextIdx - earlierOutlines.slice(-12).length) + index) + '. ' + (item.title || item.num || '未命名章节') + '：' + item.synopsis).join('\n') + '\n';
      }
      const prevChapters = vol.chapters.slice(Math.max(0, nextIdx - 2), nextIdx);
      prevChapters.forEach(c => {
        const t = c.scenes.map(s => htmlToText(s.content)).join('\n\n');
        userMsg += '\n《' + c.title + (c.sub ? ('·' + c.sub) : '') + '》（' + countWords(c.scenes.reduce((a, s) => a + s.content, '')) + ' 字，保留结尾用于衔接）：\n' + t.slice(-5000);
      });
      userMsg += '\n\n请依据上述蓝图与前文，创作《' + title + '》的完整正文（建议 1500–3000 字，按场景/情节自然分段）。';
      if (contractBlock) userMsg += contractBlock;

      let buf = '';
      await streamSkillPipeline({ model: nextModel, thinking: state.settings.think, skillMode: 'write', analyzeSkill: true, humanize: false, characterMaterial, messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] }, {
      onStage: stage => {
        if (!isCurrentAITarget(requestTarget)) return;
        updateAITask(task, { stage: stage === 'skill_analysis' ? '正在分析已选 Skill' : stage === 'humanizer' ? '正在执行 humanizer 后处理' : '正在生成下一章' });
        if (stage === 'skill_analysis') chapterWorkflowStage(botMessage, chapterCall, 'skill', '正在逐项核对 Skill 主规则、引用文件、纠错库和本章调用约束。', 'running');
        if (stage === 'writing') {
          chapterWorkflowStage(botMessage, chapterCall, 'skill', 'Skill 执行清单已生成，并已注入正文请求。', 'completed');
          chapterWorkflowStage(botMessage, chapterCall, 'writing', '第' + chNum + '章的核心已固定，接下来写入正文并同步必要的章节状态。', 'running');
        }
      },
      onStart: c => { if (!isCurrentAITarget(requestTarget)) return; genNextCtl = c; bindAITaskController(task, c); updateAITask(task, { stage: '正在生成下一章', progress: 8 }); },
      onBilling: billing => { if (isCurrentAITarget(requestTarget)) updateAITaskBilling(task, billing); },
      onReplaceText: text => {
        if (!genNextActive || !isCurrentAITarget(requestTarget)) return;
        buf = String(text || '');
        botMessage.text = buf;
        renderAILog();
      },
      onThink: t => {
        if (!genNextActive || !isCurrentAITarget(requestTarget)) return;
        botMessage.thinking = (botMessage.thinking || '') + t;
        renderAILog();
      },
      onSkillAnalysisDelta: t => {
        if (!genNextActive || !isCurrentAITarget(requestTarget)) return;
        botMessage.skillAnalysis = (botMessage.skillAnalysis || '') + t;
        chapterWorkflowStage(botMessage, chapterCall, 'skill', 'Skill 分析进行中：已输出约 ' + botMessage.skillAnalysis.length + ' 个字符。', 'running');
        renderAILog();
      },
      onDelta: d => {
        if (!genNextActive || !isCurrentAITarget(requestTarget)) return;
        buf += d;
        botMessage.text = buf;
        renderAILog();
      },
      onDone: (reason, usage) => {
        if (!isCurrentAITarget(requestTarget)) return;
        genNextActive = false; genNextCtl = null; setGenNextUI(false);
        botMessage.pending = false;
        botMessage.finishReason = reason || '';
        botMessage.partial = ['abort', 'length', 'credit_exhausted', 'material_overlap'].includes(reason);
        botMessage.text = buf || (reason === 'abort' ? '已停止生成' : 'AI 未返回正文');
        if (reason === 'material_overlap' || (usage && usage.characterMaterial && usage.characterMaterial.blocked)) {
          botMessage.status = 'material_overlap';
          botMessage.text = buf || '素材原创性审计未通过，已阻止写入';
          chapterWorkflowStage(botMessage, chapterCall, 'review', '人物素材原创性审计未通过，已阻止下一章写入。', 'failed');
          attachUsageToMessage(botMsgIndex, usage);
          finishAITask(task, 'material_overlap', usage, { resultExcerpt: '素材原创性审计未通过，已阻止写入' });
          save();
          logAICall('生成下一章', nextModel, usage, '素材原创性审计未通过，已阻止写入', captureCtxMeta());
          renderAILogNow();
          toast('人物素材原创性审计未通过，下一章未写入');
          return;
        }
        const previousText = ch.scenes.map(scene => htmlToText(scene.content || '')).join('\n\n');
        const review = buf ? validateChapterDraft(buf, { index: nextIdx, title, outlineIndex: nextIdx }, previousText) : null;
        chapterCall.review = review;
        if (buf && chapterContract) {
          requestChapterAudit(buf, { index: nextIdx }, chapterContract).then(audit => {
            chapterCall.serverAudit = audit;
            botMessage.serverAudit = audit;
            if (!audit.passed && !botMessage.autoRewritten && !['abort', 'length', 'credit_exhausted'].includes(reason)) {
              botMessage.autoRewritten = true;
              const serverProblems = (Array.isArray(audit.issues) ? audit.issues : [])
                .filter(item => String(item && item.severity || '') === 'blocker')
                .map(item => String(item.description || item.suggestion || '连续性 blocker'))
                .slice(0, 6);
              startDirectedChapterRewrite({
                message: botMessage,
                call: chapterCall,
                task,
                messageIndex: botMsgIndex,
                model: nextModel,
                system: sys,
                user: userMsg + '\n\n【服务端连续性审计反馈】' + (serverProblems.join('；') || '请修复审计发现的连续性问题') + '。只修正这些问题，保留本章目标与已有事实。',
                index: nextIdx,
                title,
                previousText,
                contract: chapterContract
              });
            }
            chapterWorkflowStage(botMessage, chapterCall, 'review', audit.passed
              ? '服务端连续性审计通过：合同、人物状态、时间线和伏笔证据未发现 blocker。'
              : '服务端连续性审计未通过：存在 ' + Number(audit.blockerCount || 0) + ' 个 blocker，提交前必须返工。', audit.passed ? 'completed' : 'warning');
            save(); renderAILogNow();
          }).catch(error => {
            const audit = { passed: false, blockerCount: 1, issues: [{ severity: 'blocker', category: 'other', description: String(error && error.message || error), suggestion: '重新生成审计或修正正文后再提交' }], summary: '服务端连续性审计失败' };
            chapterCall.serverAudit = audit;
            botMessage.serverAudit = audit;
            chapterWorkflowStage(botMessage, chapterCall, 'review', '服务端连续性审计失败，已禁止提交，需重试审计。', 'failed');
            save(); renderAILogNow();
          });
        }
        // ★ S2：校验不过 → 自动重写一次（DeterminFlow 借鉴：下游拒绝让上游定向返工）
        if (buf && review && review.status === 'needs_review' && !botMessage.autoRewritten && !['abort', 'length', 'credit_exhausted'].includes(reason)) {
          const problems = [
            ...(review.modernTerms || []).map(term => '现代词「' + term + '」'),
            ...(review.correctionRisks || []).map(item => '纠错风险' + (item && item.term ? '「' + item.term + '」' : '')),
            ...(review.evidenceRisks || []).map(item => '过度下结论' + (item && item.term ? '「' + item.term + '」' : '')),
            review.continuity && review.continuity.status !== 'passed' ? '衔接问题：' + review.continuity.note : ''
          ].filter(Boolean).slice(0, 6);
          if (problems.length) {
            botMessage.autoRewritten = true;
            genNextActive = true; setGenNextUI(true);
            const rewriteMark = '\n\n【自动校验发现 ' + problems.length + ' 项问题，正在重写一次】' + problems.join('；');
            botMessage.text = buf + rewriteMark;
            chapterWorkflowStage(botMessage, chapterCall, 'review', '自动校验未通过（' + problems.join('；') + '），正在按问题清单定向重写一次。', 'running');
            renderAILog();
            const rewriteUserMsg = userMsg + '\n\n【校验反馈】以下问题需修正后重写本段正文：' + problems.join('；') + '。请保留整体剧情推进与结构，仅修正上述问题，其余内容维持不变。';
            buf = '';
            streamSkillPipeline({ model: nextModel, thinking: state.settings.think, skillMode: 'write', analyzeSkill: true, humanize: false, characterMaterial: { ...characterMaterial, mode: 'auto' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: rewriteUserMsg }] }, {
              onStage: stage => {
                if (!isCurrentAITarget(requestTarget)) return;
                updateAITask(task, { stage: stage === 'skill_analysis' ? '重写：正在分析已选 Skill' : stage === 'humanizer' ? '重写：正在执行 humanizer 后处理' : '正在按校验反馈重写下一章' });
              },
              onStart: c => { if (!isCurrentAITarget(requestTarget)) return; genNextCtl = c; bindAITaskController(task, c); updateAITask(task, { stage: '正在按校验反馈重写下一章', progress: 8 }); },
              onBilling: billing => { if (isCurrentAITarget(requestTarget)) updateAITaskBilling(task, billing); },
              onReplaceText: text => { if (genNextActive && isCurrentAITarget(requestTarget)) { buf = String(text || ''); botMessage.text = buf; renderAILog(); } },
              onThink: t => { if (genNextActive && isCurrentAITarget(requestTarget)) { botMessage.thinking = (botMessage.thinking || '') + t; renderAILog(); } },
              onSkillAnalysisDelta: t => { if (genNextActive && isCurrentAITarget(requestTarget)) { botMessage.skillAnalysis = (botMessage.skillAnalysis || '') + t; chapterWorkflowStage(botMessage, chapterCall, 'skill', '重写 Skill 分析进行中：已输出约 ' + botMessage.skillAnalysis.length + ' 个字符。', 'running'); renderAILog(); } },
              onDelta: d => { if (genNextActive && isCurrentAITarget(requestTarget)) { buf += d; botMessage.text = buf; renderAILog(); } },
              onDone: (r2, u2) => {
                if (!isCurrentAITarget(requestTarget)) return;
                genNextActive = false; genNextCtl = null; setGenNextUI(false);
                botMessage.pending = false;
                botMessage.finishReason = r2 || '';
                botMessage.partial = ['abort', 'length', 'credit_exhausted', 'material_overlap'].includes(r2);
                botMessage.text = buf || (r2 === 'abort' ? '已停止重写' : 'AI 未返回重写正文');
                if (r2 === 'material_overlap' || (u2 && u2.characterMaterial && u2.characterMaterial.blocked)) {
                  botMessage.status = 'material_overlap';
                  botMessage.text = buf || '素材原创性审计未通过，已阻止写入';
                  chapterWorkflowStage(botMessage, chapterCall, 'review', '人物素材原创性审计未通过，自动重写结果仍被阻止写入。', 'failed');
                  attachUsageToMessage(botMsgIndex, u2);
                  finishAITask(task, 'material_overlap', u2, { resultExcerpt: '素材原创性审计未通过，已阻止写入' });
                  save();
                  logAICall('生成下一章（自动重写）', nextModel, u2, '素材原创性审计未通过，已阻止写入', captureCtxMeta());
                  renderAILogNow();
                  toast('素材原创性审计仍未通过，自动重写结果未写入');
                  return;
                }
                const review2 = buf ? validateChapterDraft(buf, { index: nextIdx, title, outlineIndex: nextIdx }, previousText) : null;
                chapterCall.review = review2;
                if (buf && chapterContract) {
                  requestChapterAudit(buf, { index: nextIdx }, chapterContract).then(audit => {
                    chapterCall.serverAudit = audit;
                    botMessage.serverAudit = audit;
                    save(); renderAILogNow();
                  }).catch(error => {
                    chapterCall.serverAudit = { passed: false, blockerCount: 1, issues: [{ severity: 'blocker', category: 'other', description: String(error && error.message || error), suggestion: '重新生成审计或修正正文后再提交' }] };
                    botMessage.serverAudit = chapterCall.serverAudit;
                    save(); renderAILogNow();
                  });
                }
                if (buf) {
                  chapterWorkflowStage(botMessage, chapterCall, 'writing', '重写初稿已暂存于对话，约 ' + (review2 ? review2.wordCount : 0) + ' 字；用户确认后才落盘到章节文件。', 'completed');
                  chapterWorkflowStage(botMessage, chapterCall, 'review', review2 && review2.status === 'passed' ? '重写后回读检查通过：高风险句式、现代词、证据与承接扫描均为零。' : '重写后仍存在 ' + ((review2 ? review2.correctionRisks.length + review2.modernTerms.length + review2.evidenceRisks.length : 0)) + ' 项需复核，可手动修改后写入。', review2 && review2.status === 'passed' ? 'completed' : 'warning');
                  botMessage.chapterAudit = review2;
                }
                attachUsageToMessage(botMsgIndex, u2);
                finishAITask(task, r2, u2, { resultExcerpt: botMessage.text.slice(0, 180) });
                save();
                logAICall('生成下一章（自动重写）', nextModel, u2, botMessage.text, captureCtxMeta());
                renderAILogNow();
                toast(r2 === 'abort' ? '重写已停止，初稿仍保留在对话中' : r2 === 'credit_exhausted' ? '积分已耗尽，重写已停止，初稿仍保留在对话中' : r2 === 'length' ? '重写达到输出上限，初稿仍保留在对话中' : '重写完成，请在对话中确认写入');
              },
              onError: (e2, meta2) => {
                if (!isCurrentAITarget(requestTarget)) return;
                genNextActive = false; genNextCtl = null; setGenNextUI(false);
                botMessage.pending = false;
                const fallbackText2 = meta2 && meta2.partialText ? String(meta2.partialText) : '';
                if (fallbackText2) { buf = fallbackText2; botMessage.text = fallbackText2; botMessage.status = 'completed_with_fallback'; }
                else botMessage.text = '⚠️ 重写失败：' + (e2 && e2.message ? e2.message : e2);
                attachUsageToMessage(botMsgIndex, null);
                finishAITask(task, 'error', null, { error: String(e2) });
                renderAILog(); save();
              }
            });
            return;
          }
        }
        if (buf) {
          chapterWorkflowStage(botMessage, chapterCall, 'writing', '正文初稿已暂存于对话，约 ' + review.wordCount + ' 字；用户确认后才落盘到章节文件。', 'completed');
          chapterWorkflowStage(botMessage, chapterCall, 'review', review.status === 'passed' ? '回读检查通过：纠错库高风险句式、现代词、证据过度下结论和上一章承接扫描均为零。' : '回读检查完成：' + (review.correctionRisks.length + review.modernTerms.length + review.evidenceRisks.length) + ' 项需复核；未绕过用户确认写入。', review.status === 'passed' ? 'completed' : 'warning');
          botMessage.chapterAudit = review;
        }
        attachUsageToMessage(botMsgIndex, usage);
        finishAITask(task, reason, usage, { resultExcerpt: botMessage.text.slice(0, 180) });
        save();
        logAICall('生成下一章', nextModel, usage, botMessage.text, captureCtxMeta());
        renderAILogNow();
        toast(reason === 'abort' ? '已停止生成下一章，已生成内容仍保留在对话中' : reason === 'credit_exhausted' ? '积分已耗尽，下一章生成已停止，已生成内容仍保留在对话中' : reason === 'length' ? '已达到输出长度上限，已生成内容仍保留在对话中，可点击继续生成' : '下一章已生成，请在对话中确认写入');
      },
      onError: (e, meta) => {
        if (!isCurrentAITarget(requestTarget)) return;
        genNextActive = false; genNextCtl = null; setGenNextUI(false);
        botMessage.pending = false;
        const fallbackText = meta && meta.partialText ? String(meta.partialText) : '';
        if (fallbackText) {
          buf = fallbackText;
          botMessage.text = fallbackText;
          botMessage.status = 'completed_with_fallback';
        } else {
          botMessage.text = '⚠️ ' + e;
        }
        attachUsageToMessage(botMsgIndex, null);
        const creditExhausted = !!(meta && (meta.code === 'credit_exhausted' || meta.status === 402));
        if (!fallbackText) botMessage.status = creditExhausted ? 'credit_exhausted' : 'failed';
        finishAITask(task, creditExhausted ? 'credit_exhausted' : 'error', null, { error: String(e) });
        renderAILog();
        save();
        toast(fallbackText ? 'humanizer 后处理失败，已保留下一章写作初稿' : (creditExhausted ? '积分不足，已停止生成下一章：' : '生成失败：') + (e && e.message ? e.message : e));
      }
      });
    } catch (error) {
      // 异步准备或回调异常也必须结束占位消息，不能留下永久“思考中…”。
      if (requestTarget && !isCurrentAITarget(requestTarget)) return;
      if (botMessage && botMessage.pending) {
        botMessage.pending = false;
        botMessage.status = 'failed';
        botMessage.text = '⚠️ 生成失败：' + (error && error.message ? error.message : String(error));
        if (task) finishAITask(task, 'error', null, { error: String(error) });
        renderAILog();
        save();
      } else if (!botMessage) {
        toast('生成失败：' + (error && error.message ? error.message : String(error)));
      }
    } finally {
      if (!requestTarget || isCurrentAITarget(requestTarget)) {
        genNextActive = false;
        genNextCtl = null;
        setGenNextUI(false);
      }
    }
  }
  async function commitGeneratedChapter(text, target, message) {
    const content = String(text || '').trim();
    if (!content || !target || !state || !state.volumes || !state.volumes[0]) {
      toast('没有可写入的章节内容');
      return false;
    }
    ensureOutlineChapters();
    const chapterCall = target.callId && state.chapterCalls
      ? state.chapterCalls.find(item => item && item.id === target.callId)
      : null;
    const previousChapterBeforeCommit = prevChapter();
    const previousTextBeforeCommit = previousChapterBeforeCommit
      ? previousChapterBeforeCommit.scenes.map(item => htmlToText(item.content || '')).join('\n\n')
      : '';
    if (dissectionSourceId()) {
      try {
        const contract = chapterCall && chapterCall.contract
          ? chapterCall.contract
          : await requestChapterContract(target, previousChapterBeforeCommit);
        if (chapterCall && !chapterCall.contract) chapterCall.contract = contract;
        const fingerprint = chapterContentFingerprint(content);
        const cachedAudit = chapterCall && chapterCall.serverAudit && chapterCall.serverAudit.contentFingerprint === fingerprint
          ? chapterCall.serverAudit
          : await requestChapterAudit(content, target, contract);
        if (chapterCall) chapterCall.serverAudit = cachedAudit;
        if (!cachedAudit || cachedAudit.passed !== true || Number(cachedAudit.blockerCount) > 0) {
          if (chapterCall) chapterWorkflowStage(null, chapterCall, 'review', '服务端连续性审计未通过，存在 blocker，正文未写入章节状态。', 'warning');
          save();
          toast('连续性审计未通过，已阻止提交；请先返工正文');
          return false;
        }
      } catch (error) {
        if (chapterCall) chapterWorkflowStage(null, chapterCall, 'review', '服务端连续性审计失败，正文未写入章节状态。', 'failed');
        save();
        toast(error && error.message ? error.message : '连续性审计失败，已阻止提交');
        return false;
      }
    }
    const vol = state.volumes[0];
    let chapter = target.chapterId ? vol.chapters.find(c => c.id === target.chapterId) : null;
    if (!chapter) chapter = vol.chapters[target.index] || null;
    if (chapter && chapter.scenes && chapter.scenes.some(s => htmlToText(s.content || '').trim())) {
      if (!(await confirmModal('《' + (chapter.title || target.title || '下一章') + '》已有正文，写入将覆盖第一场景内容，是否继续？'))) return false;
    }
    if (!chapter) {
      const id = 'c' + Date.now();
      chapter = { id: id, title: target.title || ('第' + (target.index + 1) + '章'), sub: target.sub || '', scenes: [{ id: id + 's1', name: '场景一', content: '<p></p>' }] };
      vol.chapters.push(chapter);
    }
    if (!chapter.scenes || !chapter.scenes.length) chapter.scenes = [{ id: chapter.id + 's1', name: '场景一', content: '<p></p>' }];
    const scene = chapter.scenes[0];
    scene.content = textToParas(content);
    const outline = state.outline.chapters[target.outlineIndex || target.index];
    if (outline) {
      outline.status = 'writing';
      outline.wordCount = countWords(scene.content);
    } else {
      state.outline.chapters.push({ num: chapter.title, status: 'writing', title: chapter.sub || '', synopsis: '', wordCount: countWords(scene.content), mark: '', storyline: '主线' });
    }
    state.currentChapterId = chapter.id;
    state.currentSceneId = scene.id;
    const previousText = previousChapterBeforeCommit && previousChapterBeforeCommit.id !== chapter.id
      ? previousTextBeforeCommit
      : '';
    const review = validateChapterDraft(htmlToText(scene.content), target, previousText);
    if (message) message.chapterAudit = review;
    if (chapterCall) chapterWorkflowStage(message, chapterCall, 'review', review.status === 'passed'
      ? '正文回读完成：高风险句式和现代词扫描为零，上一章承接检查通过。'
      : '正文回读完成：发现 ' + (review.correctionRisks.length + review.modernTerms.length + review.evidenceRisks.length) + ' 项需要收紧的内容，已保留复核结果。', review.status === 'passed' ? 'completed' : 'warning');
    const stateSync = syncChapterStateAfterCommit(chapter, target, htmlToText(scene.content), review, chapterCall);
    if (chapterCall) {
      chapterWorkflowStage(message, chapterCall, 'sync', '现在同步这些结果到章节调用表、伏笔表和人物当前状态，避免下一章继续使用旧状态。已更新 ' + stateSync.entityIds.length + ' 个设定实体、' + stateSync.foreshadowIds.length + ' 条伏笔记录。', 'completed');
      chapterWorkflowStage(message, chapterCall, 'finish', target.title + ' 的关键结果已固定：' + (chapter.lastResult || '已写入正文') + '；下章承接点：' + (chapter.continuationPoint || '见本章末尾') + '。文件名与扩展名、正文回读、纠错库高风险模式、现代词、证据边界及临时状态均已检查。', 'completed');
    }
    recomputeChapterWords();
    renderTree();
    renderEditor();
    checkEmptyState();
    switchTab('writing');
    if (immersiveEditor) immersiveEditor.innerHTML = scene.content;
    save({ snapshot: true });
    return true;
  }
  function stopGenNext() {
    genNextActive = false;
    if (genNextCtl) { try { genNextCtl.abort(); } catch (_) {} genNextCtl = null; }
    setGenNextUI(false);
    save();
    toast('已停止生成下一章');
  }
  function setGenNextUI(active) {
    const btn = $('genNextChapterBtn');
    if (btn) { btn.textContent = active ? '⏳ 生成中…' : '📖 生成下一章'; btn.classList.toggle('is-active', active); btn.disabled = active; }
    const qa = $('qaGenNext');
    if (qa) { qa.style.opacity = active ? '.55' : ''; qa.style.pointerEvents = active ? 'none' : ''; }
  }

  // ---- P3b 一致性校验（吃书检测，AI 驱动）----
  async function runConsistencyCheck() {
    const requestSession = sessionIdentity();
    ensureKnowledge();
    const ents = entList();
    const chapterText = htmlToText(currentSceneContent());
    if (!chapterText.trim()) { toast('当前章节正文为空'); return; }
    const facts = ents.map(e => {
      const t = entityTypeMeta(e.type).label;
      const attrs = (e.attrs || []).map(a => a.k + (a.v ? '=' + a.v : '')).join('、');
      return '· ' + t + '《' + e.name + '》' + (attrs ? '：' + attrs : '') + (e.notes ? '（' + e.notes + '）' : '');
    }).join('\n');
    const sys = await buildSystemReady(rolePrefix() + '\n你是「一致性」智能体。对比「当前章节正文」与「知识库设定事实」，找出矛盾、吃书（前后设定冲突）、遗漏关键设定之处。只输出 JSON，不要解释：\n{"issues":[{"type":"矛盾|吃书|遗漏","entity":"实体名","desc":"具体问题","fix":"修正建议"}]}');
    if (!sys || sessionIdentity() !== requestSession) return;
    const userMsg = '【知识库设定事实】\n' + (facts || '（暂无结构化设定）') + '\n\n【当前章节正文】\n' + chapterText;
    openConsistencyModal();
    const out = $('consistencyBody');
    if (out) out.innerHTML = '<div class="cs-loading">正在校验一致性…</div>';
    let buf = '';
    const consistencyModel = currentUnifiedModel();
    const task = createAITask('一致性校验', consistencyModel, 'chat', { kind: 'consistency' });
    streamChat({ model: consistencyModel, thinking: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] }, {
      onStart: c => { bindAITaskController(task, c); updateAITask(task, { stage: '正在校验正文与设定', progress: 8 }); },
      onBilling: billing => updateAITaskBilling(task, billing),
      onDelta: d => { buf += d; const ld = out && out.querySelector('.cs-loading'); if (ld) ld.textContent = '正在校验一致性… ' + buf.length + '字'; },
      onDone: (reason, usage) => {
        finishAITask(task, reason, usage, { resultExcerpt: buf.slice(0, 180) });
        logAICall('一致性校验', consistencyModel, usage, buf);
        if (reason === 'credit_exhausted') {
          if (out) out.innerHTML = '<div class="cs-empty">积分已耗尽，校验已中断，未完成的结果不会写入。</div>';
        } else if (reason === 'abort') {
          if (out) out.innerHTML = '<div class="cs-empty">校验已中断。</div>';
        } else {
          renderConsistencyResult(buf);
        }
      },
      onError: (e, meta) => { finishAITask(task, meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', null, { error: String(e) }); if (out) out.innerHTML = '<div class="cs-empty">校验失败：' + esc(String(e)) + '</div>'; }
    });
  }
  function openConsistencyModal() {
    const html = '<div class="cs-head"><h3 class="ml-modal__title">一致性校验 · 吃书检测</h3><p class="ml-modal__hint">基于知识库设定事实，AI 检测当前章节的矛盾 / 吃书 / 遗漏</p></div><div id="consistencyBody"></div>';
    openModal(html, { wide: true });
  }
  function renderConsistencyResult(text) {
    const out = $('consistencyBody'); if (!out) return;
    const data = parseJSONSafe(text);
    const issues = (data && Array.isArray(data.issues)) ? data.issues : null;
    if (!issues || !issues.length) {
      out.innerHTML = '<div class="cs-empty">未发现明显矛盾或吃书问题 ✅（建议仍人工复核）</div>';
      return;
    }
    const typeCls = { '矛盾': 'cs-type--conflict', '吃书': 'cs-type--eatbook', '遗漏': 'cs-type--miss' };
    out.innerHTML = '<div class="cs-summary">发现 ' + issues.length + ' 处需关注：</div>' + issues.map(i => {
      const tc = typeCls[i.type] || '';
      return '<div class="cs-row"><span class="cs-type ' + tc + '">' + esc(i.type || '问题') + '</span><div class="cs-row__main"><div class="cs-row__entity">' + esc(i.entity || '') + '</div><div class="cs-row__desc">' + esc(i.desc || '') + '</div>' + (i.fix ? '<div class="cs-row__fix">💡 ' + esc(i.fix) + '</div>' : '') + '</div></div>';
    }).join('');
  }

  /* ==================== 纠错库审校面板与用户纠错回流 ==================== */

  /** 用户纠错回流弹窗：将用户手动纠正记录提交至 /api/correction-library/inbox */
  function openCorrectionInboxModal(initialBefore) {
    const ch = currentChapter();
    const currentChapterNum = ch ? (state.volumes[0].chapters.findIndex(c => c.id === ch.id) + 1) : 1;
    const cleanBefore = String(initialBefore || '').trim();

    const html = '<div class="cs-head"><h3 class="ml-modal__title">记入纠错库</h3>' +
      '<p class="ml-modal__hint">将用户手动纠正的原句与修正句记入待审回流队列，构建时自动合入通用纠错库。</p></div>' +
      '<div style="display:flex;flex-direction:column;gap:12px;margin-top:10px;">' +
        '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">原句（违规/AI套话表达）：</label>' +
        '<textarea id="ciBefore" class="insp-content" style="min-height:54px;width:100%;box-sizing:border-box;">' + esc(cleanBefore) + '</textarea></div>' +
        '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">修正句（白描/修改后表达）：</label>' +
        '<textarea id="ciAfter" class="insp-content" style="min-height:54px;width:100%;box-sizing:border-box;" placeholder="例如：删除，或写出具体物理动作"></textarea></div>' +
        '<div style="display:flex;gap:10px;">' +
          '<div style="flex:1;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">错误类型：</label>' +
          '<input id="ciType" class="insp-tag" list="ciTypeList" value="套话比喻" style="margin-top:0;">' +
          '<datalist id="ciTypeList">' +
            '<option value="套话比喻"><option value="声音实体化"><option value="动词缩写生硬"><option value="情绪二次解释">' +
            '<option value="模板化笑意神态"><option value="装饰性数量词"><option value="局部替代人物主体"><option value="受击震颤套话">' +
            '<option value="现代职场黑话"><option value="伪精确数字"><option value="植物神经微肌群痉挛"><option value="隐形翻译腔">' +
            '<option value="变种指骨泛白"><option value="节律抽动套路"><option value="任务弹窗四字通告"><option value="盯字滥用">' +
          '</datalist></div>' +
          '<div style="width:110px;"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">所属章节：</label>' +
          '<input id="ciChapter" class="insp-tag" type="number" value="' + currentChapterNum + '" style="margin-top:0;"></div>' +
        '</div>' +
        '<div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">纠正原则（选填）：</label>' +
        '<input id="ciPrinciple" class="insp-tag" placeholder="如：写外部环境破损，不写套路化生理反射" style="margin-top:0;"></div>' +
      '</div>' +
      '<div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">' +
        '<button class="tv-btn" id="ciCancel" type="button">取消</button>' +
        '<button class="tv-btn tv-btn--primary" id="ciSubmit" type="button">提交回流</button>' +
      '</div>';

    const modal = openModal(html, { wide: true });
    const cancelBtn = modal.querySelector('#ciCancel');
    if (cancelBtn) cancelBtn.onclick = closeModal;
    const submitBtn = modal.querySelector('#ciSubmit');
    if (submitBtn) {
      submitBtn.onclick = async () => {
        const before = (modal.querySelector('#ciBefore').value || '').trim();
        const after = (modal.querySelector('#ciAfter').value || '').trim() || '删除';
        const type = (modal.querySelector('#ciType').value || '').trim() || '通用表达违规';
        const chapter = parseInt(modal.querySelector('#ciChapter').value) || currentChapterNum;
        const principle = (modal.querySelector('#ciPrinciple').value || '').trim();
        if (!before) { toast('原句不能为空'); return; }
        submitBtn.disabled = true;
        submitBtn.textContent = '提交中…';
        try {
          const token = localStorage.getItem('molan_token') || '';
          const res = await fetch('/api/correction-library/inbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
            body: JSON.stringify({ before, after, type, chapter, principle, novelId: state.id || '' })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || '提交失败');
          closeModal();
          toast('✅ 纠错记录已记入回流队列（当前待合并 ' + json.pending + ' 条）');
        } catch (e) {
          submitBtn.disabled = false;
          submitBtn.textContent = '提交回流';
          toast('提交失败：' + (e.message || e));
        }
      };
    }
  }

  /** 审校面板：全章指标（比喻词/装饰词/独立段/篇幅）、逐条规则详情与 cases 对照、定位高亮与局部修订 */
  async function openChapterCorrectionModal(customText, existingAudit) {
    const sourceText = customText != null ? String(customText) : htmlToText(currentSceneContent());
    if (!sourceText.trim()) { toast('当前章节正文为空'); return; }

    const loadingHtml = '<div class="cs-head"><h3 class="ml-modal__title">纠错库深度审校面板</h3>' +
      '<p class="ml-modal__hint">正在对照通用纠错库 46 条硬规则与全章指标进行扫描…</p></div>' +
      '<div id="correctionPanelBody"><div class="cs-loading">正在扫描风险项…</div></div>';
    const modal = openModal(loadingHtml, { wide: true });
    const body = modal.querySelector('#correctionPanelBody');

    let audit = existingAudit;
    if (!audit) {
      try {
        const token = localStorage.getItem('molan_token') || '';
        const res = await fetch('/api/correction-library/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
          body: JSON.stringify({ text: sourceText, genre: state.genre || '' })
        });
        const json = await res.json();
        if (json.ok && json.audit) audit = json.audit;
      } catch (_) {}
    }
    if (!audit) {
      audit = validateChapterDraft(sourceText, currentChapter(), '');
    }

    const metrics = audit.metrics || {
      chars: countWords(sourceText),
      similes: (sourceText.match(/(?:仿佛|宛如|犹如|好似|像是|如|般)/g) || []).length,
      decorativeQuantities: (sourceText.match(/(?:一丝|一股|一种|一缕)/g) || []).length,
      singleSentenceParagraphs: (sourceText.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0 && p.length <= 8 && !/^[“"「『]/.test(p))).length,
      exceeded: []
    };

    const simileOk = metrics.similes <= 4;
    const decOk = metrics.decorativeQuantities <= 2;
    const paraOk = metrics.singleSentenceParagraphs <= 3;
    const lengthOk = metrics.chars >= 2000 && metrics.chars <= 3000;

    let html = '<div style="display:flex;flex-direction:column;gap:14px;">';

    // 1. 全章健康度指标条
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;">' +
      '<div style="padding:10px;border-radius:8px;border:1px solid ' + (simileOk ? '#86efac' : '#fca5a5') + ';background:' + (simileOk ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)') + ';">' +
        '<div style="font-size:11px;color:#6b7280;">比喻词数量 (≤4)</div>' +
        '<div style="font-size:18px;font-weight:700;color:' + (simileOk ? '#16a34a' : '#dc2626') + ';">' + metrics.similes + ' 处 ' + (simileOk ? '✅' : '⚠️超标') + '</div>' +
      '</div>' +
      '<div style="padding:10px;border-radius:8px;border:1px solid ' + (decOk ? '#86efac' : '#fca5a5') + ';background:' + (decOk ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)') + ';">' +
        '<div style="font-size:11px;color:#6b7280;">装饰数量词 (≤2)</div>' +
        '<div style="font-size:18px;font-weight:700;color:' + (decOk ? '#16a34a' : '#dc2626') + ';">' + metrics.decorativeQuantities + ' 处 ' + (decOk ? '✅' : '⚠️超标') + '</div>' +
      '</div>' +
      '<div style="padding:10px;border-radius:8px;border:1px solid ' + (paraOk ? '#86efac' : '#fca5a5') + ';background:' + (paraOk ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)') + ';">' +
        '<div style="font-size:11px;color:#6b7280;">单句独立段 (≤3)</div>' +
        '<div style="font-size:18px;font-weight:700;color:' + (paraOk ? '#16a34a' : '#dc2626') + ';">' + metrics.singleSentenceParagraphs + ' 处 ' + (paraOk ? '✅' : '⚠️超标') + '</div>' +
      '</div>' +
      '<div style="padding:10px;border-radius:8px;border:1px solid ' + (lengthOk ? '#86efac' : '#fca5a5') + ';background:' + (lengthOk ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)') + ';">' +
        '<div style="font-size:11px;color:#6b7280;">单章汉字篇幅 (2k~3k)</div>' +
        '<div style="font-size:18px;font-weight:700;color:' + (lengthOk ? '#16a34a' : '#dc2626') + ';">' + metrics.chars + ' 字 ' + (lengthOk ? '✅' : (metrics.chars > 3000 ? '⚠️超标' : '⚠️不足')) + '</div>' +
      '</div>' +
    '</div>';

    // 2. 风险项明细列表
    const findings = audit.findings || audit.correctionRisks || [];
    if (!findings.length && !metrics.exceeded.length) {
      html += '<div class="cs-empty" style="padding:24px;text-align:center;color:#16a34a;font-weight:600;">🎉 恭喜！当前正文未检测到明显纠错风险，各项指标均在安全区间。</div>';
    } else {
      html += '<div style="font-size:13px;font-weight:600;margin-top:6px;">命中风险清单（共 ' + findings.length + ' 处）：</div>';
      html += '<div style="display:flex;flex-direction:column;gap:8px;max-height:48vh;overflow-y:auto;padding-right:4px;">';

      findings.forEach((f) => {
        const ruleId = f.ruleId || f.key || 'R-xx';
        const label = f.label || '表达风险';
        const matchedText = f.text || '';
        const suggestion = f.suggestion || null;
        const severity = f.severity || 'medium';
        const sevColor = severity === 'high' ? '#dc2626' : severity === 'medium' ? '#d97706' : '#6b7280';

        html += '<div style="padding:10px 12px;border-radius:8px;border:1px solid #e5e7eb;background:rgba(0,0,0,.02);display:flex;flex-direction:column;gap:6px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
              '<span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700;color:#fff;background:' + sevColor + ';">' + esc(ruleId) + '</span>' +
              '<strong style="font-size:13px;">' + esc(label) + '</strong>' +
            '</div>' +
            '<div style="display:flex;gap:6px;">' +
              '<button class="tv-btn tv-btn--xs cp-locate-btn" data-text="' + esc(matchedText) + '" type="button">🔍 定位</button>' +
              '<button class="tv-btn tv-btn--xs cp-inbox-btn" data-text="' + esc(matchedText) + '" data-rule="' + esc(label) + '" type="button">📥 记入纠错库</button>' +
            '</div>' +
          '</div>' +
          '<div style="font-size:12px;color:#374151;background:#fff;padding:6px 8px;border-radius:4px;border:1px dashed #d1d5db;word-break:break-all;">' +
            '<span style="color:#ef4444;font-weight:600;">命中原句：</span>' + esc(matchedText) +
          '</div>';

        if (suggestion && (suggestion.must || suggestion.after)) {
          html += '<div style="font-size:12px;color:#059669;background:rgba(5,150,105,.06);padding:6px 8px;border-radius:4px;">' +
            '<div><strong>纠正建议：</strong>' + esc(suggestion.must || suggestion.principle || '') + '</div>' +
            (suggestion.before && suggestion.after ? '<div style="margin-top:3px;color:#4b5563;">对照示例：<del style="color:#9ca3af;">' + esc(suggestion.before) + '</del> → <span style="color:#059669;font-weight:600;">' + esc(suggestion.after) + '</span></div>' : '') +
          '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    // 3. 底部快捷操作
    html += '<div style="margin-top:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;border-top:1px solid #e5e7eb;padding-top:12px;">' +
      '<button class="tv-btn" id="cpAddCustomBtn" type="button">➕ 手动记入一条纠错</button>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="tv-btn" id="cpCloseBtn" type="button">关闭</button>' +
        '<button class="tv-btn tv-btn--primary" id="cpPolishBtn" type="button">✨ 按纠错库润色全章</button>' +
      '</div>' +
    '</div></div>';

    body.innerHTML = html;

    modal.querySelector('#cpCloseBtn').onclick = closeModal;
    modal.querySelector('#cpAddCustomBtn').onclick = () => { closeModal(); openCorrectionInboxModal(); };
    modal.querySelector('#cpPolishBtn').onclick = () => {
      closeModal();
      submitAIMessage('请对照墨阑通用纠错库（R-01~R-46），对当前章节正文进行深度精修与润色，清零套话比喻、声音实体化、模板神态与空泛修饰，保持字数在2000~3000字，只返回修订后的完整正文。', 'body');
    };

    body.querySelectorAll('.cp-locate-btn').forEach(btn => {
      btn.onclick = () => {
        const textToFind = btn.dataset.text;
        closeModal();
        if (textToFind) locateAndHighlightText(textToFind);
      };
    });

    body.querySelectorAll('.cp-inbox-btn').forEach(btn => {
      btn.onclick = () => {
        const textToFind = btn.dataset.text;
        closeModal();
        openCorrectionInboxModal(textToFind);
      };
    });
  }

  /** 在编辑器正文中定位并选中指定文本 */
  function locateAndHighlightText(str) {
    if (!str) return;
    const editor = $('editorContent') || q('.editor-content');
    if (!editor) return;
    const plain = editor.innerText || editor.textContent || '';
    const idx = plain.indexOf(str);
    if (idx < 0) { toast('未在当前视图直接匹配到该文本'); return; }
    try {
      if (window.find && window.find(str, false, false, true)) {
        toast('已定位到目标片段');
        return;
      }
    } catch (_) {}
    toast('目标片段位于正文字符第 ' + idx + ' 位');
  }

  // ---- P3d AI 仿写（风格标签）----
  async function runStyleImitation() {
    const styleId = state.aiStyle;
    const style = STYLE_TAGS.find(s => s.id === styleId);
    if (!style) { toast('请先选择仿写风格'); return; }
    const selObj = window.getSelection();
    let userText = (selObj && selObj.toString().trim()) || htmlToText(currentSceneContent());
    if (!userText.trim()) { toast('正文为空'); return; }
    const sys = await buildSystemReady('你是「校正」智能体。请按指定风格改写文本，保留核心情节与信息，仅输出改写后的文本。');
    if (!sys) return;
    const userMsg = '请用【' + style.label + '】风格改写以下文本：\n\n' + userText;
    showAIToolResult('仿写·' + style.label, sys, userMsg, currentUnifiedModel());
  }

  // ---- P4a 版本 DIFF ----
  function diffLines(a, b) {
    const split = s => (s || '').split(/(?<=[。！？\n])/).map(x => x).filter(x => x.trim());
    const A = split(a), B = split(b);
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ t: 'eq', s: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'del', s: A[i] }); i++; }
      else { out.push({ t: 'add', s: B[j] }); j++; }
    }
    while (i < n) { out.push({ t: 'del', s: A[i++] }); }
    while (j < m) { out.push({ t: 'add', s: B[j++] }); }
    return out;
  }
  function openVersionDiff(idx) {
    const h = state.history || [];
    const snap = h[idx];
    if (!snap) return;
    const cur = htmlToText(currentSceneContent());
    const oldText = snap.text || snap.excerpt || '';
    const d = diffLines(oldText, cur);
    const html = '<div class="diff-head"><h3 class="ml-modal__title">版本对比</h3><p class="ml-modal__hint">' + esc(snap.t || '') + ' 《' + esc(snap.chapter || '') + (snap.scene ? ' · ' + esc(snap.scene) : '') + '》 · ' + (snap.words || 0) + '字 → 当前 ' + countWords(currentSceneContent()) + '字</p></div>' +
      '<div class="diff-legend"><span class="diff-add">新增</span><span class="diff-del">删除</span><span class="diff-eq">保留</span></div>' +
      '<div class="diff-body">' + d.map(x => {
        if (x.t === 'add') return '<div class="diff-l diff-add">+ ' + esc(x.s) + '</div>';
        if (x.t === 'del') return '<div class="diff-l diff-del">- ' + esc(x.s) + '</div>';
        return '<div class="diff-l diff-eq">  ' + esc(x.s) + '</div>';
      }).join('') + '</div>' +
      '<div style="margin-top:12px;display:flex;gap:8px;"><button class="tv-btn" id="diffClose">关闭</button><button class="tv-btn tv-btn--primary" id="diffRestore">恢复到此版本（覆盖当前场景）</button></div>';
    openModal(html, { wide: true });
    const dc = $('diffClose'); if (dc) dc.onclick = closeModal;
    const dr = $('diffRestore');
    if (dr) dr.onclick = async () => {
      if (!(await confirmModal('确定用该版本覆盖当前场景正文？此操作不可撤销。'))) return;
      const scene = currentScene();
      scene.content = '<p>' + esc(oldText).replace(/\n/g, '</p><p>') + '</p>';
      save({ snapshot: true }); renderEditor(); closeModal(); toast('已恢复到该版本');
    };
  }

  // ---- P4b 灵感卡片 ----
  function openInspirationsModal() {
    ensureAdvancedState();
    renderInspirations();
  }
  function renderInspirations() {
    const list = state.inspirations || [];
    const html = '<div class="insp-head"><h3 class="ml-modal__title">灵感卡片</h3><p class="ml-modal__hint">记录灵感/素材，启用后注入 AI 提示词</p><button class="tv-btn tv-btn--primary" id="inspAdd">+ 新建卡片</button></div>' +
      '<div class="insp-list" id="inspList">' + (list.length ? list.map(i => inspCardHtml(i)).join('') : '<div class="insp-empty">暂无卡片，点「新建卡片」记录灵感</div>') + '</div>';
    openModal(html, { wide: true });
    const addBtn = $('inspAdd'); if (addBtn) addBtn.onclick = () => { addInspiration(); };
    bindInspirationEvents();
  }
  function inspCardHtml(i) {
    return '<div class="insp-card" data-id="' + i.id + '">' +
      '<div class="insp-card__top"><input class="insp-title" value="' + esc(i.title || '') + '" placeholder="标题"><div class="insp-card__tools">' +
      '<label class="insp-toggle"><input type="checkbox" class="insp-enabled"' + (i.enabled ? ' checked' : '') + '>注入</label>' +
      '<select class="insp-tag">' + STYLE_TAGS.map(s => '<option value="' + s.id + '"' + (i.tag === s.label ? ' selected' : '') + '>' + s.label + '</option>').join('') + '<option value=""' + (!i.tag ? ' selected' : '') + '>无</option></select>' +
      '<button class="insp-del" data-del="' + i.id + '">删除</button></div></div>' +
      '<textarea class="insp-content" placeholder="灵感/素材内容…">' + esc(i.content || '') + '</textarea></div>';
  }
  function bindInspirationEvents() {
    const list = $('inspList'); if (!list) return;
    list.querySelectorAll('.insp-card').forEach(card => {
      const id = card.dataset.id;
      const titleEl = card.querySelector('.insp-title');
      const contentEl = card.querySelector('.insp-content');
      const enabledEl = card.querySelector('.insp-enabled');
      const tagEl = card.querySelector('.insp-tag');
      if (titleEl) titleEl.oninput = () => { const it = state.inspirations.find(x => x.id === id); if (it) { it.title = titleEl.value; debouncedSave(); } };
      if (contentEl) contentEl.oninput = () => { const it = state.inspirations.find(x => x.id === id); if (it) { it.content = contentEl.value; debouncedSave(); } };
      if (enabledEl) enabledEl.onchange = () => { const it = state.inspirations.find(x => x.id === id); if (it) { it.enabled = enabledEl.checked; save(); } };
      if (tagEl) tagEl.onchange = () => { const it = state.inspirations.find(x => x.id === id); if (it) { it.tag = tagEl.value; save(); } };
    });
    list.querySelectorAll('.insp-del').forEach(btn => btn.onclick = () => {
      const id = btn.dataset.del;
      state.inspirations = state.inspirations.filter(x => x.id !== id);
      save(); renderInspirations();
    });
  }
  function addInspiration() {
    ensureAdvancedState();
    const it = { id: uid('insp'), title: '', content: '', tag: '', enabled: true };
    state.inspirations.unshift(it); save(); renderInspirations();
    setTimeout(() => { const el = document.querySelector('.insp-card[data-id="' + it.id + '"] .insp-title'); if (el) el.focus(); }, 50);
  }

  // ---- P4c 模型多源 ----
  function openModelSourcesModal() {
    ensureAdvancedState();
    const list = state.modelSources || [];
    const html = '<div class="ms-head"><h3 class="ml-modal__title">模型多源</h3><p class="ml-modal__hint">添加 OpenAI 兼容的自定义模型源（baseURL + apiKey + 模型名），发送时优先使用选中的源</p><button class="tv-btn tv-btn--primary" id="msAdd">+ 添加源</button></div>' +
      '<div class="ms-list" id="msList">' + (list.length ? list.map(msCardHtml).join('') : '<div class="insp-empty">暂无自定义源，默认使用 DeepSeek</div>') + '</div>';
    openModal(html, { wide: true });
    const addBtn = $('msAdd'); if (addBtn) addBtn.onclick = () => addModelSource();
    bindModelSourceEvents();
  }
  function msCardHtml(ms) {
    return '<div class="ms-card" data-id="' + ms.id + '">' +
      '<div class="ms-card__top"><input class="ms-name" value="' + esc(ms.name || '') + '" placeholder="源名称（如 我的GPT）">' +
      '<label class="insp-toggle"><input type="radio" name="msActive" class="ms-active"' + (ms.active ? ' checked' : '') + '>启用</label>' +
      '<button class="insp-del" data-del="' + ms.id + '">删除</button></div>' +
      '<input class="ms-base" value="' + esc(ms.baseURL || '') + '" placeholder="baseURL（如 https://api.openai.com/v1）">' +
      '<input class="ms-key" type="password" value="' + esc(ms.apiKey || '') + '" placeholder="apiKey（sk-...）">' +
      '<input class="ms-model" value="' + esc(ms.model || '') + '" placeholder="模型名（如 gpt-4o-mini）"></div>';
  }
  function bindModelSourceEvents() {
    const list = $('msList'); if (!list) return;
    list.querySelectorAll('.ms-card').forEach(card => {
      const id = card.dataset.id;
      const upd = (sel, key) => { const el = card.querySelector(sel); if (el) el.oninput = () => { const ms = state.modelSources.find(x => x.id === id); if (ms) { ms[key] = el.value; debouncedSave(); } }; };
      upd('.ms-name', 'name'); upd('.ms-base', 'baseURL'); upd('.ms-key', 'apiKey'); upd('.ms-model', 'model');
      const actEl = card.querySelector('.ms-active');
      if (actEl) actEl.onchange = () => { state.modelSources.forEach(x => x.active = (x.id === id)); save(); };
    });
    list.querySelectorAll('.insp-del').forEach(btn => btn.onclick = () => {
      const id = btn.dataset.del;
      state.modelSources = state.modelSources.filter(x => x.id !== id); save(); openModelSourcesModal();
    });
  }
  function addModelSource() {
    ensureAdvancedState();
    const ms = { id: uid('ms'), name: '新源', baseURL: '', apiKey: '', model: '', active: state.modelSources.length === 0 };
    state.modelSources.push(ms); save(); openModelSourcesModal();
  }
  function activeModelSource() {
    ensureAdvancedState();
    return state.modelSources.find(s => s.active) || null;
  }

  /* ===================== 知识图谱（角色卡 / 世界观图谱） ===================== */
  const ENTITY_TYPES = [
    { type: 'location', label: '地点', color: '#5fd0a8' },
    { type: 'faction', label: '势力', color: '#8b7cf6' },
    { type: 'character', label: '人物', color: '#7c9cff' },
    { type: 'itemCategory', label: '物品类别', color: '#d08b5f' },
    { type: 'itemRank', label: '物品品级', color: '#e0b15f' },
    { type: 'item', label: '物品', color: '#f0b35a' },
    { type: 'event', label: '事件', color: '#e07ad0' }
  ];
  const RELATION_TYPES = [
    { type: 'member_of', label: '隶属' },
    { type: 'located_at', label: '位于' },
    { type: 'controls', label: '控制' },
    { type: 'owns', label: '持有' },
    { type: 'uses', label: '使用' },
    { type: 'appears_at', label: '出现于' },
    { type: 'related', label: '相关' }
  ];
  function entityTypeMeta(t) { return ENTITY_TYPES.find(x => x.type === t) || ENTITY_TYPES[0]; }
  function relationTypeMeta(t) { return RELATION_TYPES.find(x => x.type === t) || RELATION_TYPES[RELATION_TYPES.length - 1]; }
  function normalizeEntityType(value) {
    const raw = String(value || '').trim();
    const map = {
      character: 'character', role: 'character', person: 'character', 人物: 'character', 角色: 'character', 人物卡: 'character', 角色卡: 'character',
      location: 'location', place: 'location', 地点: 'location', 场所: 'location',
      faction: 'faction', organization: 'faction', sect: 'faction', 势力: 'faction', 宗门: 'faction', 组织: 'faction',
      itemCategory: 'itemCategory', itemcategory: 'itemCategory', item_category: 'itemCategory', 物品类别: 'itemCategory', 物品分类: 'itemCategory',
      itemRank: 'itemRank', itemrank: 'itemRank', item_rank: 'itemRank', rank: 'itemRank', 品级: 'itemRank', 物品品级: 'itemRank',
      item: 'item', object: 'item', 物品: 'item',
      event: 'event', incident: 'event', 事件: 'event'
    };
    return map[raw] || map[raw.toLowerCase()] || (ENTITY_TYPES.some(x => x.type === raw) ? raw : 'item');
  }
  function inferEntityType(source) {
    const raw = String(source && source.type || '').trim();
    if (raw) return normalizeEntityType(raw);
    const name = String(source && (source.name || source.title) || '').trim();
    if (/(宗门|宗派|门派|教派|联盟|组织|商会|佣兵团|家族|皇朝|王朝|帝国|帮派|门|殿|阁|院|宫|府|司|会)$/.test(name)) return 'faction';
    if (/(大陆|城|镇|村|山脉|山|河|湖|海|岛|秘境|遗迹|平原|森林|峡谷|洞府|关|郡|州|域)$/.test(name)) return 'location';
    if (/(凡品|下品|中品|上品|极品|黄阶|玄阶|地阶|天阶|仙阶|神阶)$/.test(name)) return 'itemRank';
    return 'item';
  }
  function normalizeRelationType(value) {
    const raw = String(value || '').trim();
    const map = {
      member_of: 'member_of', memberof: 'member_of', belongs_to: 'member_of', 隶属: 'member_of', 所属: 'member_of', 加入: 'member_of',
      located_at: 'located_at', locatedat: 'located_at', 位于: 'located_at', 坐落于: 'located_at',
      controls: 'controls', 控制: 'controls', 统治: 'controls', 管辖: 'controls',
      owns: 'owns', 持有: 'owns', 拥有: 'owns',
      uses: 'uses', 使用: 'uses', 运用: 'uses',
      appears_at: 'appears_at', appearsat: 'appears_at', 出现于: 'appears_at',
      related: 'related', relation: 'related', 相关: 'related', 关联: 'related'
    };
    return map[raw] || map[raw.toLowerCase()] || (RELATION_TYPES.some(x => x.type === raw) ? raw : 'related');
  }
  function normalizeAliasList(value) {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap(x => String(x || '').split(/[、,，;；\n]/)).map(x => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  }
  function sourceEntityRef(value) {
    if (value && typeof value === 'object') return String(value.id || value.name || value.title || '').trim();
    return String(value || '').trim();
  }
  function sourceParentRef(src) {
    if (!src || typeof src !== 'object') return '';
    return sourceEntityRef(src.parentId || src.parent || src.parentName || src.belongsTo || src.category || src.rank || src.归属 || src.所属 || src.上级);
  }
  function normalizeKnowledgeEntity(e) {
    if (!e || typeof e !== 'object') return;
    e.type = inferEntityType(e);
    e.name = String(e.name || '').trim().slice(0, 160) || '未命名设定';
    e.aliases = normalizeAliasList(e.aliases).map(x => x.slice(0, 160)).filter(x => x !== e.name).slice(0, 30);
    const rawAttrs = Array.isArray(e.attrs) ? e.attrs : (e.attrs && typeof e.attrs === 'object' ? Object.entries(e.attrs).map(x => ({ k: x[0], v: x[1] })) : []);
    const attrSeen = new Set();
    e.attrs = rawAttrs.map(a => ({ k: String(a && a.k || '').trim().slice(0, 80), v: String(a && a.v || '').trim().slice(0, 500) })).filter(a => {
      if (!a.k) return false;
      const key = a.k + '\u0001' + a.v;
      if (attrSeen.has(key)) return false;
      attrSeen.add(key);
      return true;
    }).slice(0, 80);
    e.tags = normalizeAliasList(e.tags).map(x => x.slice(0, 40)).slice(0, 20);
    e.parentId = sourceEntityRef(e.parentId);
    if (e.parentId === e.id) e.parentId = '';
    e.status = String(e.status || '').trim().slice(0, 24);
    e.currentLocation = String(e.currentLocation || e.location || '').trim().slice(0, 120);
    e.owner = String(e.owner || e.holder || e.持有者 || '').trim().slice(0, 120);
    e.personality = String(e.personality || '').trim().slice(0, 4000);
    e.notes = String(e.notes || '').trim().slice(0, 8000);
    if (e.type === 'character') {
      e.archetype = normalizeCharacterArchetype(e.archetype);
      e.archetypeSource = ['explicit', 'inferred', 'none'].includes(e.archetypeSource) ? e.archetypeSource : (e.archetype ? 'explicit' : 'none');
      e.archetypeConfidence = Number.isFinite(Number(e.archetypeConfidence)) ? Number(e.archetypeConfidence) : (e.archetypeSource === 'explicit' ? 1 : 0);
    }
    if (!e.history || typeof e.history !== 'object' || Array.isArray(e.history)) e.history = {};
    if (!Number.isFinite(Number(e.createdAt))) e.createdAt = Date.now();
    if (!Number.isFinite(Number(e.updatedAt))) e.updatedAt = e.createdAt;
  }
  function dedupeKnowledgeEdges() {
    const seen = new Map();
    const edges = [];
    (state.knowledge.edges || []).forEach(source => {
      if (!source || typeof source !== 'object') return;
      const from = sourceEntityRef(source.from || source.source);
      const to = sourceEntityRef(source.to || source.target);
      if (!from || !to || from === to) return;
      const relationType = normalizeRelationType(source.relationType || source.type || source.kind || source.relation);
      const label = String(source.label || source.description || '').trim().slice(0, 300);
      const key = from + '\u0001' + to + '\u0001' + relationType;
      const existing = seen.get(key);
      if (existing) {
        if (label && label !== existing.label && !existing.label.split('；').includes(label)) existing.label = [existing.label, label].filter(Boolean).join('；');
        return;
      }
      const edge = { id: source.id || uid('r'), from, to, label, relationType };
      seen.set(key, edge);
      edges.push(edge);
    });
    state.knowledge.edges = edges;
  }
  function ensureKnowledge() {
    if (!state.knowledge) state.knowledge = { entities: {}, edges: [], version: 1 };
    if (!state.knowledge.entities) state.knowledge.entities = {};
    if (!state.knowledge.edges) state.knowledge.edges = [];
    if (!state.knowledge.version) state.knowledge.version = 1;
    Object.values(state.knowledge.entities).forEach(normalizeKnowledgeEntity);
    const refs = new Map();
    Object.values(state.knowledge.entities).forEach(e => {
      [e.id, e.name, ...(e.aliases || [])].filter(Boolean).forEach(ref => refs.set(String(ref).trim().toLowerCase(), e.id));
    });
    Object.values(state.knowledge.entities).forEach(e => {
      if (e.parentId && !state.knowledge.entities[e.parentId]) e.parentId = refs.get(String(e.parentId).trim().toLowerCase()) || '';
    });
    state.knowledge.edges.forEach(edge => {
      edge.from = state.knowledge.entities[edge.from] ? edge.from : (refs.get(String(edge.from || '').trim().toLowerCase()) || '');
      edge.to = state.knowledge.entities[edge.to] ? edge.to : (refs.get(String(edge.to || '').trim().toLowerCase()) || '');
    });
    dedupeKnowledgeEdges();
  }
  function ensureReferenceMaterials() {
    if (!Array.isArray(state.referenceMaterials)) state.referenceMaterials = [];
    return state.referenceMaterials;
  }
  function classifyReferenceType(name, text) {
    const value = String(name || '').toLowerCase() + '\n' + String(text || '').slice(0, 1000).toLowerCase();
    if (/(地图|地理|疆域|路线|map|world.?map|territor)/i.test(value)) return 'map';
    if (/(人物卡|角色卡|人物|角色|character|profile|persona)/i.test(value)) return 'character';
    if (/(大纲|细纲|章节规划|outline|plot)/i.test(value)) return 'outline';
    if (/(设定|世界观|规则|setting|world.?building|lore)/i.test(value)) return 'setting';
    return 'reference';
  }
  function addReferenceMaterial(name, text, type) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const list = ensureReferenceMaterials();
    const relPath = String(name || '导入资料').replace(/\\/g, '/').slice(0, 240);
    const item = { id: uid('ref'), name: relPath, type: type || classifyReferenceType(relPath, raw), text: raw, truncated: false, updatedAt: Date.now() };
    const same = list.findIndex(x => x.name === item.name);
    if (same >= 0) list.splice(same, 1, item); else list.push(item);
    return item;
  }
  function referenceMaterialsContext() {
    const list = ensureReferenceMaterials();
    if (!list.length) return '';
    const parts = ['【已导入参考资料（写作时必须优先遵循）】'];
    const priority = { setting: 0, character: 1, map: 2, outline: 3, manuscript: 4, reference: 5 };
    for (const item of list.slice().sort((a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9) || (a.name || '').localeCompare(b.name || ''))) {
      const body = String(item.text || '').trim();
      if (!body) continue;
      parts.push('### ' + (item.type || 'reference') + ' · ' + item.name + '\n' + body);
    }
    return parts.length > 1 ? parts.join('\n\n') : '';
  }
  // 时间线 / 故事画布：标记类型 + 故事线调色板
  const MARK_TYPES = {
    '': { label: '无', color: '#c4c9d4', short: '' },
    foreshadow: { label: '伏笔', color: '#5b9bff', short: '伏' },
    climax: { label: '高潮', color: '#ff6b5b', short: '高' },
    turn: { label: '转折', color: '#b06bff', short: '转' }
  };
  const STORYLINE_PALETTE = ['#7c9cff', '#5fd0a8', '#f0b35a', '#e07ad0', '#6bd0e0', '#d0a86b', '#a8d06b', '#d06b8a'];
  function storylineColor(name, idx) {
    if (!name || name === '主线') return STORYLINE_PALETTE[0];
    if (name === '支线') return STORYLINE_PALETTE[1];
    return STORYLINE_PALETTE[(idx % STORYLINE_PALETTE.length)];
  }
  function ensureOutlineChapters() {
    if (!state.outline) state.outline = { book: { title: state.title || '未命名小说', oneLine: '', themes: [] }, volume: { title: '第一卷', synopsis: '', target: '', done: 0, total: 0 }, chapters: [] };
    // 兜底：部分导入/旧数据可能缺 book 或 volume 字段，补齐避免访问 undefined 崩溃
    if (!state.outline.book) state.outline.book = { title: state.title || '未命名小说', oneLine: '', themes: [] };
    if (!state.outline.volume) state.outline.volume = { title: '第一卷', synopsis: '', target: '', done: 0, total: 0 };
    if (!Array.isArray(state.outline.chapters)) state.outline.chapters = [];
    // 清理导入残留：如果 oneLine/synopsis 包含文件导入标记，清空为合理默认值
    if (state.outline.book.oneLine && /从外部文件导入|imported|\.md$|\.txt$/i.test(state.outline.book.oneLine)) {
      state.outline.book.oneLine = '';
    }
    if (state.outline.volume.synopsis && /从外部文件导入|imported|\.md$|\.txt$/i.test(state.outline.volume.synopsis)) {
      state.outline.volume.synopsis = '';
    }
    const vol = state.volumes && state.volumes[0];
    const volChs = (vol && vol.chapters) || [];
    // ★ 自动对齐：确保 outline.chapters 与 volumes[0].chapters 1:1 索引对应
    if (volChs.length > state.outline.chapters.length) {
      // 卷里有更多章节 → 补充蓝图条目
      for (let i = state.outline.chapters.length; i < volChs.length; i++) {
        const vc = volChs[i];
        state.outline.chapters.push({
          num: vc.title || ('第' + (i + 1) + '章'),
          status: (vc.scenes && vc.scenes.some(s => s.content && s.content !== '<p></p>' && htmlToText(s.content).trim())) ? 'done' : 'empty',
          title: vc.sub || '',
          synopsis: '',
          wordCount: chapterWordCount(vc),
          mark: '',
          storyline: '主线'
        });
      }
    } else if (volChs.length < state.outline.chapters.length) {
      // 蓝图比卷多（如章节被删除）→ 截断
      state.outline.chapters.length = volChs.length;
    }
    // 同步已有条目的标题（卷标题可能被用户改过）
    state.outline.chapters.forEach((c, i) => {
      if (typeof c.mark === 'undefined') c.mark = '';
      if (typeof c.storyline === 'undefined' || !c.storyline) c.storyline = '主线';
      if (volChs[i]) {
        c.num = volChs[i].title || c.num;
        c.wordCount = chapterWordCount(volChs[i]);
        // 如果卷章节有内容但蓝图状态还是 empty/todo，自动提升为 done
        const hasContent = volChs[i].scenes && volChs[i].scenes.some(s => s.content && s.content !== '<p></p>' && htmlToText(s.content).trim());
        if (hasContent && (c.status === 'empty' || c.status === 'todo')) c.status = 'done';
      }
    });
    // 更新卷进度
    const doneCnt = state.outline.chapters.filter(c => c.status === 'done' || c.status === 'writing').length;
    state.outline.volume.done = doneCnt;
    state.outline.volume.total = state.outline.chapters.length;
  }
  function entList() { ensureKnowledge(); return Object.values(state.knowledge.entities); }
  function addEntity(type, name) {
    ensureKnowledge();
    const e = { id: uid('e'), type: type || 'character', name: (name || '').trim() || '未命名', aliases: [], tags: [], parentId: '', attrs: [], notes: '', status: '', currentLocation: '', owner: '', history: {}, createdAt: Date.now(), updatedAt: Date.now() };
    state.knowledge.entities[e.id] = e; save(); return e;
  }
  function updateEntity(id, patch) { ensureKnowledge(); const e = state.knowledge.entities[id]; if (!e) return; Object.assign(e, patch); e.updatedAt = Date.now(); save(); }
  function deleteEntity(id) {
    ensureKnowledge(); delete state.knowledge.entities[id];
    state.knowledge.edges = state.knowledge.edges.filter(ed => ed.from !== id && ed.to !== id);
    save();
  }
  function addEdge(from, to, label, relationType) {
    ensureKnowledge(); if (from === to) return null;
    const normalizedRelation = normalizeRelationType(relationType);
    const ex = state.knowledge.edges.find(ed => ed.from === from && ed.to === to && normalizeRelationType(ed.relationType) === normalizedRelation);
    if (ex) { ex.label = label || ex.label; ex.relationType = normalizedRelation; save(); return ex; }
    const ed = { id: uid('r'), from: from, to: to, label: label || '', relationType: normalizedRelation };
    state.knowledge.edges.push(ed); save(); return ed;
  }
  function removeEdge(id) { ensureKnowledge(); state.knowledge.edges = state.knowledge.edges.filter(ed => ed.id !== id); save(); }
  function findEntIdByName(list, name) {
    const ref = sourceEntityRef(name);
    if (!ref) return null;
    const e = list.find(x => x.id === ref) || list.find(x => x.name === ref) || list.find(x => (x.aliases || []).includes(ref));
    return e ? e.id : null;
  }

  // 记录实体在「当前章节」的状态快照（供历史视图）
  function recordEntityHistory(e) {
    const cid = state.currentChapterId || 'global';
    e.history = e.history || {};
    e.history[cid] = { at: Date.now(), summary: (e.attrs || []).map(a => a.k + (a.v ? '=' + a.v : '')).join('、') || '（无属性）' };
  }

  // 从整本正文抽取实体（按章节分块，避免长篇只读取开头）
  async function extractKnowledge() {
    ensureKnowledge();
    const all = state.volumes.flatMap(v => v.chapters.map(ch => {
      const body = ch.scenes.map(s => htmlToText(s.content)).join('\n\n');
      return '【章节：' + ch.title + (ch.sub ? ' · ' + ch.sub : '') + '】\n' + body;
    })).filter(Boolean).join('\n\n');
    const chunks = chunkText(all, 9000);
    if (!chunks.length) { toast('正文为空，无法抽取'); return; }
    // ★ S3：断点恢复——优先复用未完成的任务（续跑），否则新建
    const existing = (state.aiTasks || []).find(t => t.retry && t.retry.kind === 'extractKnowledge' && ['interrupted', 'credit_exhausted', 'failed'].includes(t.status));
    const task = existing || createAITask('正文抽取 · 知识库', currentAIPanelModel(), 'setting', { kind: 'extractKnowledge', checkpoint: 0, total: chunks.length });
    if (!task.retry) task.retry = { kind: 'extractKnowledge', checkpoint: 0, total: chunks.length };
    task.retry.total = chunks.length;
    if (!Number.isFinite(task.retry.checkpoint) || task.retry.checkpoint < 0) task.retry.checkpoint = 0;
    // 边界保护：checkpoint 越过实际块数（正文被删改/导入数据变化）时回到起点重抽
    if (task.retry.checkpoint >= chunks.length) { task.retry.checkpoint = 0; task.retry.total = chunks.length; }
    updateAITask(task, { status: 'running', stage: task.retry.checkpoint > 0 ? ('从第 ' + task.retry.checkpoint + '/' + chunks.length + ' 段续跑') : '正在抽取正文设定', progress: task.retry.checkpoint > 0 ? Math.round((task.retry.checkpoint / chunks.length) * 100) : 4 });
    persist();
    let success = task.retry.checkpoint; // 已完成段数从 checkpoint 继承
    let stopped = ''; // '' = 跑完；'credit_exhausted' = 积分耗尽；'error' = 抽取失败
    for (let i = task.retry.checkpoint; i < chunks.length; i++) {
      if (chunks.length > 1) toast('正在抽取正文第 ' + (i + 1) + '/' + chunks.length + ' 段…');
      const result = await extractEntitiesFromTextP(chunks[i], '当前正文');
      if (result.ok) { success++; task.retry.checkpoint = i + 1; updateAITask(task, { checkpoint: i + 1, progress: Math.round(((i + 1) / chunks.length) * 100), stage: '已抽取 ' + (i + 1) + '/' + chunks.length + ' 段' }); persist(); }
      else if (result.creditExhausted) { stopped = 'credit_exhausted'; updateAITask(task, { stage: '积分不足，进度已保存至第 ' + (i + 1) + '/' + chunks.length + ' 段，可在任务中续跑' }); persist(); break; }
      else {
        // 单段抽取失败（网络/解析重试仍失败）：保留进度，任务标记为可续跑
        stopped = 'error';
        task.retry.checkpoint = i; // 停在当前段，续跑会重试这一段
        updateAITask(task, { stage: '第 ' + (i + 1) + '/' + chunks.length + ' 段抽取失败，进度已保存至第 ' + i + '/' + chunks.length + ' 段，可在任务中续跑' });
        persist();
        toast('第 ' + (i + 1) + '/' + chunks.length + ' 段抽取失败，已保存进度，可在任务中续跑');
        break;
      }
    }
    const partial = stopped && task.retry.checkpoint < chunks.length;
    if (partial) updateAITask(task, { progress: Math.round((task.retry.checkpoint / chunks.length) * 100) });
    const finishExtra = { resultExcerpt: success + '/' + chunks.length + ' 段已写入知识库' };
    if (partial) finishExtra.stage = stopped === 'credit_exhausted'
      ? '积分不足，进度已保存至第 ' + task.retry.checkpoint + '/' + chunks.length + ' 段，可在任务中续跑'
      : '抽取未完成，进度已保存至第 ' + task.retry.checkpoint + '/' + chunks.length + ' 段，可在任务中续跑';
    finishAITask(task, stopped, null, finishExtra);
    toast((partial ? (stopped === 'credit_exhausted' ? '积分不足，已停止后续抽取（进度已保存，可在任务中续跑）。' : '正文抽取未完成（进度已保存，可在任务中续跑）。') : '') + '正文抽取完成：' + success + '/' + chunks.length + ' 段已写入知识库');
  }
  async function extractEntitiesFromText(text, sourceLabel, onComplete) {
    ensureKnowledge();
    const t = (text || '').trim();
    if (!t) { toast('内容为空，无法抽取'); if (onComplete) onComplete(false); return; }
    toast('正在从' + (sourceLabel || '文本') + '抽取实体…');
    const sys = await buildSystemReady('你是小说资料抽取引擎。阅读正文、人物卡、地图、世界观设定等资料，抽取可被后续创作严格遵循的事实。识别地点、势力/宗门、人物、物品类别、物品品级、物品、事件、关系、主题、文风和章节摘要。只输出一个 JSON 对象，不要解释，不要 Markdown 代码块。未知字段留空，不要臆造；只有文本明确表达时才建立上级归属和关系。');
    if (!sys) { if (onComplete) onComplete({ ok: false, error: 'Skill 尚未加载完成' }); return; }
    const userMsgBase = '请抽取以下小说资料，严格输出 JSON：\n{\n "summary":"本段事实摘要",\n "themes":["主题"],\n "style":{"pointOfView":"视角","tone":"语气","tense":"时态","notes":"文风特征"},\n "entities":[{"type":"location|faction|character|itemCategory|itemRank|item|event","name":"名称","aliases":["别名"],"parent":"直接上级实体名称（没有则为空）","personality":"（仅人物，可选）","attrs":[{"k":"属性名","v":"属性值"}],"notes":"设定或事实","tags":["标签，如主线/第三卷，可选"],"status":"状态，人物可写存活/死亡/失踪/未出场，物品可写在身/封存/遗失，可选","currentLocation":"当前位置，可选","owner":"持有者，仅物品可选"}],\n "edges":[{"from":"实体名或别名","to":"实体名或别名","relationType":"member_of|located_at|controls|owns|uses|appears_at|related","label":"关系补充描述"}],\n "chapterSummaries":[{"chapter":"章节名","summary":"章节事实摘要"}]\n}\n\n文本：\n' + t;
    const model = currentAIPanelModel();
    const task = createAITask('AI抽取 · ' + (sourceLabel || '文本'), model, 'setting', { kind: 'extract', text: t, label: sourceLabel || '文本' });
    // ★ 输出校验 + 自动修复重试（DeterminFlow 借鉴）：解析失败时带错误信息重试 ≤2 次
    let full = '';
    let attempts = 0;
    const MAX_ATTEMPTS = 2;
    const runExtract = (repairHint) => {
      full = '';
      const userMsg = userMsgBase + (repairHint ? '\n\n【上轮输出解析失败】' + repairHint + '\n请只输出一个合法 JSON 对象（不要 Markdown 代码块、不要多余文字），保持实体名唯一。' : '');
      streamChat({ model: model, thinking: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] }, {
        onStart: c => { bindAITaskController(task, c); updateAITask(task, { stage: attempts ? ('修复输出中（第 ' + attempts + '/' + MAX_ATTEMPTS + ' 次）') : '正在抽取设定与关系', progress: 8 }); },
        onBilling: billing => updateAITaskBilling(task, billing),
        onDelta: d => { full += d; },
        onDone: (reason, usage) => {
          const result = { ok: false, reason: reason || '', usage: usage || null, model: model };
          logAICall('AI抽取·' + (sourceLabel || '文本'), model, usage, full);
          if (reason === 'credit_exhausted') {
            result.creditExhausted = true;
            toast('积分已耗尽，已中断当前抽取，后续内容未继续发送');
          } else if (reason === 'abort') {
            toast('抽取已中断');
          } else {
            try {
              mergeExtracted(full); result.ok = true; toast('实体抽取完成，已并入知识库');
            } catch (e) {
              if (attempts < MAX_ATTEMPTS) {
                attempts++;
                updateAITask(task, { stage: '输出解析失败，正在修复重试 ' + attempts + '/' + MAX_ATTEMPTS, progress: 6 });
                runExtract(String((e && e.message) || e));
                return;
              }
              result.error = 'json_parse_failed_after_retry';
              toast('抽取结果解析失败（已自动重试 ' + MAX_ATTEMPTS + ' 次），请缩小范围或稍后重试');
            }
          }
          finishAITask(task, reason || (result.ok ? '' : 'error'), usage, { resultExcerpt: full.slice(0, 180), error: result.error });
          if (onComplete) onComplete(result);
        },
        onError: (e, meta) => {
          const creditExhausted = !!(meta && (meta.code === 'credit_exhausted' || meta.status === 402));
          if (creditExhausted) toast('积分不足，已停止后续抽取');
          else toast('抽取失败：' + (e && e.message ? e.message : e));
          logAICall('AI抽取·' + (sourceLabel || '文本'), model, null, full);
          finishAITask(task, creditExhausted ? 'credit_exhausted' : 'error', null, { error: String(e) });
          if (onComplete) onComplete({ ok: false, creditExhausted, error: e, meta: meta || null, model: model });
        }
      });
    };
    runExtract('');
  }
  function extractEntitiesFromTextP(text, label) {
    return new Promise(resolve => {
      extractEntitiesFromText(text, label, result => resolve(result && typeof result === 'object' ? result : { ok: !!result }));
    });
  }
  function chunkText(t, size) {
    if (!t || t.length <= size) return t ? [t] : [];
    const out = [];
    for (let i = 0; i < t.length; i += size) out.push(t.slice(i, i + size));
    return out;
  }
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function parseJSONSafe(str) {
    if (!str) return null;
    let s = String(str).trim();
    const f0 = s.indexOf('{'), f1 = s.lastIndexOf('}');
    if (f0 >= 0 && f1 > f0) s = s.slice(f0, f1 + 1);
    try { return JSON.parse(s); } catch (_) {}
    s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
    try { return JSON.parse(s); } catch (_) { return null; }
  }
  function mergeExtracted(text) {
    const data = (typeof text === 'string') ? parseJSONSafe(text) : text;
    if (!data) throw new Error('no json');
    const norm = normalizeImportData(data); if (!norm) throw new Error('no entities');
    ensureKnowledge();
    const list = entList();
    let added = 0;
    let updated = 0;
    const pendingParents = [];
    norm.entities.forEach(src => {
      if (!src || typeof src !== 'object') return;
      const type = normalizeEntityType(src.type);
      const name = String(src.name || '').trim(); if (!name) return;
      let e = list.find(x => x.type === type && x.name === name) || list.find(x => x.type === type && (x.aliases || []).includes(name));
      if (!e) { e = { id: uid('e'), type, name, aliases: [], parentId: '', attrs: [], notes: '', history: {}, createdAt: Date.now() }; state.knowledge.entities[e.id] = e; list.push(e); added++; }
      else updated++;
      normalizeKnowledgeEntity(e);
      const aliases = normalizeAliasList(src.aliases || src.alias || src.alternateNames || src.别名);
      if (e.name !== name) aliases.push(name);
      e.aliases = normalizeAliasList([...(e.aliases || []), ...aliases]).filter(x => x !== e.name);
      const parentRef = sourceParentRef(src);
      if (parentRef) pendingParents.push({ e, type, parentRef });
      if (src.personality && type === 'character' && !String(e.personality || '').includes(String(src.personality))) e.personality = (e.personality ? e.personality + '\n' : '') + String(src.personality);
      if (src.attrs && Array.isArray(src.attrs)) src.attrs.forEach(a => {
        if (!a || !a.k) return;
        const attr = { k: String(a.k), v: String(a.v || '') };
        if (!e.attrs.some(x => x.k === attr.k && x.v === attr.v)) e.attrs.push(attr);
      });
      if (src.notes && !String(e.notes || '').includes(String(src.notes))) e.notes = (e.notes ? e.notes + '\n' : '') + String(src.notes);
      const tags = normalizeAliasList(src.tags || src.tag || src.标签);
      if (tags.length) e.tags = Array.from(new Set([...(e.tags || []), ...tags])).slice(0, 20);
      if (src.status && !e.status) e.status = String(src.status).trim().slice(0, 12);
      if (src.currentLocation && !e.currentLocation) e.currentLocation = String(src.currentLocation).trim().slice(0, 40);
      if (src.owner && !e.owner) e.owner = String(src.owner).trim().slice(0, 40);
      if (type === 'character') applyCharacterArchetype(e, src.archetype, src.archetypeSource);
      e.updatedAt = Date.now();
    });
    pendingParents.forEach(item => {
      const parentId = findEntIdByName(list, item.parentRef);
      const parent = parentId ? state.knowledge.entities[parentId] : null;
      if (parent && taxonomyParentTypes(item.type).includes(parent.type) && parent.id !== item.e.id && !parentCreatesCycle(item.e.id, parent.id)) item.e.parentId = parent.id;
    });
    norm.edges.forEach(ed => {
      if (!ed || typeof ed !== 'object') return;
      const fromId = findEntIdByName(list, ed.from || ed.source), toId = findEntIdByName(list, ed.to || ed.target);
      const relationType = normalizeRelationType(ed.relationType || ed.type || ed.kind || ed.关系类型 || ed.relation);
      const label = String(ed.label || ed.description || '').trim();
      if (fromId && toId && fromId !== toId && !state.knowledge.edges.some(x => x.from === fromId && x.to === toId && normalizeRelationType(x.relationType) === relationType && (x.label || '') === label)) {
        state.knowledge.edges.push({ id: uid('r'), from: fromId, to: toId, label, relationType });
      }
    });
    if (data.summary) state.knowledge.summary = mergeUniqueLine(state.knowledge.summary, data.summary, 4);
    if (Array.isArray(data.themes)) state.knowledge.themes = Array.from(new Set([...(state.knowledge.themes || []), ...data.themes.map(String).map(x => x.trim()).filter(Boolean)])).slice(0, 20);
    if (data.style && typeof data.style === 'object') state.knowledge.style = Object.assign({}, state.knowledge.style || {}, data.style);
    if (Array.isArray(data.chapterSummaries)) mergeChapterSummaries(data.chapterSummaries);
    save(); renderSidebarSheji();
    return { added, updated };
  }
  function mergeUniqueLine(existing, value, max) {
    const lines = String(existing || '').split('\n').map(x => x.trim()).filter(Boolean);
    const next = String(value || '').trim();
    if (next && !lines.includes(next)) lines.push(next);
    return lines.slice(-(max || 6)).join('\n');
  }
  function mergeChapterSummaries(items) {
    if (!state.outline || !Array.isArray(state.outline.chapters)) return;
    items.forEach(item => {
      const key = String(item.chapter || item.title || '').trim();
      const summary = String(item.summary || item.synopsis || '').trim();
      if (!key || !summary) return;
      const target = state.outline.chapters.find(c => c.num === key || c.title === key || key.includes(c.num) || key.includes(c.title));
      if (target && (!target.synopsis || /从外部文件导入/.test(target.synopsis))) target.synopsis = summary;
    });
  }
  function normalizeImportData(raw) {
    if (!raw || typeof raw !== 'object') return null;
    let entities = [], edges = Array.isArray(raw.edges) ? raw.edges : (Array.isArray(raw.relations) ? raw.relations : []);
    if (Array.isArray(raw.entities)) entities = raw.entities;
    else if (Array.isArray(raw)) entities = raw;
    else {
      const map = {
        characters: 'character', roles: 'character', characterCards: 'character', 人物: 'character', 角色: 'character', 人物卡: 'character',
        locations: 'location', places: 'location', 地点: 'location', 场所: 'location',
        factions: 'faction', organizations: 'faction', sects: 'faction', 势力: 'faction', 宗门: 'faction', 组织: 'faction',
        itemCategories: 'itemCategory', item_categories: 'itemCategory', categories: 'itemCategory', 物品类别: 'itemCategory', 物品分类: 'itemCategory',
        itemRanks: 'itemRank', item_ranks: 'itemRank', ranks: 'itemRank', 品级: 'itemRank', 物品品级: 'itemRank',
        items: 'item', 物品: 'item', events: 'event', 事件: 'event'
      };
      for (const key in map) {
        if (Array.isArray(raw[key])) raw[key].forEach(x => entities.push(Object.assign({ type: map[key] }, x)));
      }
    }
    if (!entities.length && !edges.length && !raw.summary && !raw.style && !(Array.isArray(raw.themes) && raw.themes.length) && !(Array.isArray(raw.chapterSummaries) && raw.chapterSummaries.length)) return null;
    if (!Array.isArray(raw)) return Object.assign({}, raw, { entities, edges });
    return { entities, edges };
  }
  function importSettingsText(text) {
    const t = (text || '').trim();
    if (!t) { toast('内容为空，无法导入'); return; }
    const data = parseJSONSafe(t);
    const looksJson = !!(data && normalizeImportData(data));
    if (looksJson) {
      try { mergeExtracted(data); toast('设定集已导入知识库'); return; }
      catch (e) { toast('JSON 解析异常，转为文本抽取'); }
    }
    extractEntitiesFromText(t, '导入的设定集');
  }
  // 一次导入多个文件 / 文件夹：JSON 直接合并，文本分块后逐段 AI 抽取
  const IMPORT_EXT = /\.(txt|md|markdown|json|text)$/i;
  const NOVEL_IMPORT_EXT = /\.(txt|md|markdown|text)$/i;
  async function importSettingFiles(fileList, pastedText) {
    const files = Array.from(fileList || []);
    if (!files.length && !pastedText) { toast('请先选择文件或粘贴内容'); return; }
    startImportProgress('正在导入设定集');
    try {
      const jsonMerged = [], textParts = [];
      let skipped = 0;
      const readTotal = files.length + (pastedText ? 1 : 0);
      let readDone = 0;
      for (const f of files) {
        const rel = f.webkitRelativePath || f.name;
        if (!IMPORT_EXT.test(f.name)) {
          skipped++; readDone++;
          importProgressStep(0, 32, readDone, readTotal, '正在读取设定集', '已跳过不支持的文件：' + rel);
          continue;
        }
        let txt;
        try { txt = await readEditorTextFile(f); } catch (_) {
          skipped++; readDone++;
          importProgressStep(0, 32, readDone, readTotal, '正在读取设定集', '读取失败：' + rel);
          continue;
        }
        readDone++;
        if (!txt.trim()) {
          importProgressStep(0, 32, readDone, readTotal, '正在读取设定集', '已跳过空文件：' + rel);
          continue;
        }
        addReferenceMaterial(rel, txt, classifyReferenceType(rel, txt));
        const data = parseJSONSafe(txt);
        if (data && normalizeImportData(data)) {
          try { mergeExtracted(txt); jsonMerged.push(rel); }
          catch (_) { textParts.push({ name: rel, text: txt }); }
        } else {
          textParts.push({ name: rel, text: txt });
        }
        importProgressStep(0, 32, readDone, readTotal, '正在读取设定集', '已读取 ' + readDone + '/' + readTotal + '：' + rel);
      }
      if (pastedText) {
        addReferenceMaterial('粘贴内容', pastedText, classifyReferenceType('粘贴内容', pastedText));
        const d = parseJSONSafe(pastedText);
        if (d && normalizeImportData(d)) {
          try { mergeExtracted(pastedText); jsonMerged.push('粘贴内容'); }
          catch (_) { textParts.push({ name: '粘贴内容', text: pastedText }); }
        } else {
          textParts.push({ name: '粘贴内容', text: pastedText });
        }
        readDone++;
        importProgressStep(0, 32, readDone, readTotal, '正在读取设定集', '已处理粘贴内容');
      }
      persist();
      setImportProgress(36, '正在整理设定集', '已读取 ' + (files.length + (pastedText ? 1 : 0)) + ' 项内容');
      let extractSuccess = 0, extractTotal = 0, extractionStopped = false;
      if (textParts.length) {
        const combined = textParts.map(x => '===== 文件：' + x.name + ' =====\n' + x.text).join('\n\n');
        const chunks = chunkText(combined, 9000);
        extractTotal = chunks.length;
        for (let i = 0; i < chunks.length; i++) {
          importProgressStep(40, 55, i, chunks.length, '正在 AI 抽取设定', '正在处理第 ' + (i + 1) + '/' + chunks.length + ' 段');
          if (chunks.length > 1) toast('正在抽取第 ' + (i + 1) + '/' + chunks.length + ' 段…');
          const result = await extractEntitiesFromTextP(chunks[i], '导入的设定集');
          if (result.ok) extractSuccess++;
          if (result.creditExhausted) { extractionStopped = true; break; }
          importProgressStep(40, 55, i + 1, chunks.length, '正在 AI 抽取设定', '已完成第 ' + (i + 1) + '/' + chunks.length + ' 段');
        }
      }
      const parts = [];
      if (jsonMerged.length) parts.push('JSON 直接导入 ' + jsonMerged.length + ' 个');
      if (textParts.length) parts.push('文本抽取 ' + textParts.length + ' 个（' + extractSuccess + '/' + extractTotal + ' 段）');
      if (skipped) parts.push('跳过非文本文件 ' + skipped + ' 个');
      if (extractionStopped) parts.push('积分不足，已停止后续 AI 抽取');
      const message = '导入完成：' + (parts.join('，') || '无内容');
      const partial = extractionStopped || (extractTotal > 0 && extractSuccess < extractTotal);
      finishImportProgress(partial ? (extractionStopped ? '设定集已导入，AI 抽取已中断' : '设定集导入完成（部分抽取失败）') : '设定集导入完成', message, partial);
      toast(message);
    } catch (err) {
      const message = '设定集导入失败：' + (err && err.message ? err.message : err);
      finishImportProgress('设定集导入失败', message, true);
      toast(message);
    }
  }
  function openImportSettingsModal() {
    const importModelName = esc(modelLabel(currentAIPanelModel()));
    const html =
      '<h3 class="ml-modal__title">导入设定集</h3>' +
      '<p class="ml-modal__hint">支持三种方式：① 上传 JSON（{entities,edges} 或 {characters,locations,items,events} 或实体数组）直接导入；② 上传纯文本 / Markdown，由 AI 抽取人物卡牌与设定；③ 直接粘贴内容。<b>可一次选择多个文件，也可选择整个文件夹</b>（重复点按钮可累加）。当前模型：<b>' + importModelName + '</b>；AI 抽取按实际 Token 计费，积分不足会立即停止后续抽取。</p>' +
      '<div class="kg-sub">文件 / 文件夹导入（可多选、可重复添加）</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' +
        '<label class="tv-btn tv-btn--ghost" style="cursor:pointer;"><input type="file" id="importSettingsFile" multiple accept=".txt,.md,.markdown,.json,.text" style="display:none"/>选择文件（可多选）</label>' +
        '<label class="tv-btn tv-btn--ghost" style="cursor:pointer;"><input type="file" id="importSettingsFolder" webkitdirectory multiple style="display:none"/>追加资料文件夹</label>' +
        '<button class="tv-btn tv-btn--ghost" id="isClear" type="button">清空已选</button>' +
      '</div>' +
      '<div id="isFileList" style="max-height:140px;overflow:auto;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:6px 8px;font-size:12px;color:#374151;margin-bottom:10px;"></div>' +
      '<div class="kg-sub">或粘贴内容</div>' +
      '<textarea id="importSettingsText" placeholder="把设定集文本或 JSON 粘到这里…" style="width:100%;min-height:120px;background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:6px;padding:8px 10px;font-size:13px;line-height:1.6;resize:vertical;outline:none;font-family:inherit;"></textarea>' +
      '<div class="ml-modal__actions"><button class="tv-btn tv-btn--ghost" id="isCancel" type="button">取消</button><button class="tv-btn tv-btn--primary" id="isImport" type="button">导入并抽取</button></div>';
    const modal = openModal(html, { wide: true });
    let selectedFiles = [];
    const listBox = modal.querySelector('#isFileList');
    function renderFileList() {
      if (!selectedFiles.length) { listBox.innerHTML = '<div class="kg-empty">尚未选择文件</div>'; return; }
      const total = selectedFiles.reduce((s, f) => s + f.size, 0);
      listBox.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">已选 ' + selectedFiles.length + ' 个文件 · ' + fmtSize(total) + '</div>' +
        selectedFiles.map((f, i) => '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2px 0;"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(f.webkitRelativePath || f.name) + '</span><button class="is-file-x" data-i="' + i + '" type="button" style="border:none;background:none;color:#9ca3af;cursor:pointer;font-size:14px;">×</button></div>').join('');
      listBox.querySelectorAll('.is-file-x').forEach(b => b.onclick = () => { selectedFiles.splice(+b.dataset.i, 1); renderFileList(); });
    }
    function addFiles(fileList) {
      Array.from(fileList).forEach(f => {
        const rel = f.webkitRelativePath || f.name;
        if (!selectedFiles.some(x => (x.webkitRelativePath || x.name) === rel && x.size === f.size)) selectedFiles.push(f);
      });
      renderFileList();
    }
    renderFileList();
    modal.querySelector('#importSettingsFile').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
    modal.querySelector('#importSettingsFolder').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
    modal.querySelector('#isClear').onclick = () => { selectedFiles = []; renderFileList(); };
    modal.querySelector('#isCancel').onclick = () => closeModal();
    modal.querySelector('#isImport').onclick = async () => {
      const pasted = modal.querySelector('#importSettingsText').value.trim();
      if (!selectedFiles.length && !pasted) { toast('请先选择文件或粘贴内容'); return; }
      closeModal();
      await importSettingFiles(selectedFiles, pasted);
    };
  }

  // 实体编辑弹窗
  function openEntityModal(id, prefill) {
    ensureKnowledge();
    const isNew = !id;
    const e = isNew ? Object.assign({ type: 'character', name: '', attrs: [], notes: '' }, prefill || {}) : (state.knowledge.entities[id] || {});
    normalizeKnowledgeEntity(e);
    const others = entList().filter(x => x.id !== id);
    const typeOpts = ENTITY_TYPES.map(t => '<option value="' + t.type + '"' + (t.type === e.type ? ' selected' : '') + '>' + t.label + '</option>').join('');
    const parentOpts = taxonomyParentCandidates(e.type, id).map(o => '<option value="' + o.id + '"' + (o.id === e.parentId ? ' selected' : '') + '>' + esc(entityPath(o)) + '</option>').join('');
    const relationOpts = RELATION_TYPES.map(r => '<option value="' + r.type + '">' + r.label + '</option>').join('');
    const attrRows = (e.attrs || []).map((a, i) => '<div class="kg-attr-row"><input class="kg-attr-k" data-i="' + i + '" placeholder="属性名" value="' + esc(a.k) + '"/><input class="kg-attr-v" data-i="' + i + '" placeholder="属性值" value="' + esc(a.v) + '"/><button class="kg-attr-del" data-i="' + i + '" type="button">×</button></div>').join('');
    const relRows = (state.knowledge.edges || []).filter(ed => ed.from === id || ed.to === id).map(ed => {
      const other = ed.from === id ? state.knowledge.entities[ed.to] : state.knowledge.entities[ed.from];
      const dir = ed.from === id ? '→' : '←';
      return '<div class="kg-rel-row"><span>' + dir + ' ' + esc(other ? other.name : '?') + '</span><span class="kg-rel-label">' + esc(relationTypeMeta(ed.relationType).label + (ed.label ? ' · ' + ed.label : '')) + '</span><button class="kg-rel-del" data-rid="' + ed.id + '" type="button">×</button></div>';
    }).join('');
    const relOpts = others.map(o => '<option value="' + o.id + '">' + esc(o.name) + '（' + entityTypeMeta(o.type).label + '）</option>').join('');
    const archetypeDisplay = e.type === 'character' ? characterArchetypeDisplay(e) : { archetype: '', source: 'none', sourceLabel: '仅人物可用' };
    const archetypeOptions = '<option value="">未指定，自动判断</option>' + CHARACTER_ARCHETYPES.map(value => '<option value="' + esc(value) + '"' + (value === archetypeDisplay.archetype ? ' selected' : '') + '>' + esc(value) + '</option>').join('');
    const html = '<h3 class="ml-modal__title">编辑实体</h3>' +
      '<div class="kg-form">' +
      '<label class="kg-field"><span>类型</span><select id="kgType">' + typeOpts + '</select></label>' +
      '<label class="kg-field"><span>名称</span><input id="kgName" value="' + esc(e.name || '') + '" placeholder="实体名称"/></label>' +
      '<label class="kg-field"><span>别名</span><input id="kgAliases" value="' + esc((e.aliases || []).join('、')) + '" placeholder="多个别名用顿号或逗号分隔"/></label>' +
      '<label class="kg-field"><span>主归属</span><select id="kgParent"><option value="">未归类</option>' + parentOpts + '</select></label>' +
      '<label class="kg-field"><span>标签</span><input id="kgTags" value="' + esc((e.tags || []).join('、')) + '" placeholder="用顿号或逗号分隔，如：主线、第三卷"/></label>' +
      '<label class="kg-field kg-field--check"><span>标记</span><label class="kg-checkline"><input type="checkbox" id="kgCore"' + (e.core ? ' checked' : '') + '/> 主线核心（列表优先显示 ★）</label></label>' +
      '<label id="kgPersonalityField" class="kg-field kg-field--col"' + (e.type === 'character' || isNew ? '' : ' hidden') + '><span>性格</span><textarea id="kgPersonality" placeholder="性格特点、行为习惯、说话方式…">' + esc(e.personality || '') + '</textarea></label>' +
      '<label id="kgArchetypeField" class="kg-field kg-field--col"' + (e.type === 'character' || isNew ? '' : ' hidden') + '><span>人物类型</span><select id="kgArchetype" data-source="' + esc(archetypeDisplay.source) + '">' + archetypeOptions + '</select><small id="kgArchetypeHint">来源：' + esc(archetypeDisplay.sourceLabel) + '；保存人物卡后会同步到素材检索。</small></label>' +
      '<div class="kg-sub">属性</div><div id="kgAttrs">' + (attrRows || '<div class="kg-empty">暂无属性</div>') + '</div>' +
      '<button class="kg-add-attr" type="button" id="kgAddAttr">+ 添加属性</button>' +
      '<div class="kg-sub">状态</div><div class="kg-meta-grid"><input id="kgStatus" list="kgStatusList" placeholder="状态（存活/死亡/失踪…）" value="' + esc(e.status || '') + '"/><input id="kgLoc" placeholder="当前位置（谁在哪）" value="' + esc(e.currentLocation || '') + '"/><input id="kgOwner" placeholder="持有者（谁拿着）" value="' + esc(e.owner || '') + '" style="grid-column:1/-1"' + (e.type === 'item' ? '' : ' hidden') + '/></div><datalist id="kgStatusList"><option value="存活"></option><option value="死亡"></option><option value="失踪"></option><option value="未出场"></option><option value="已登场"></option><option value="在身"></option><option value="封存"></option><option value="遗失"></option><option value="已毁"></option><option value="进行中"></option><option value="已结束"></option></datalist>' +
      '<label class="kg-field kg-field--col"><span>备注</span><textarea id="kgNotes" placeholder="设定、背景…">' + esc(e.notes || '') + '</textarea></label>' +
      '<div class="kg-sub">关系</div><div class="kg-rel-list">' + (relRows || '<div class="kg-empty">暂无关系</div>') + '</div>' +
      '<div class="kg-rel-add"><select id="kgRelTarget">' + (relOpts || '<option value="">（暂无其他实体）</option>') + '</select><select id="kgRelType">' + relationOpts + '</select><input id="kgRelLabel" placeholder="补充描述" style="flex:1"/><button type="button" id="kgAddRel">+ 关系</button></div>' +
      '</div>' +
      '<div class="ml-modal__actions"><button class="tv-btn tv-btn--ghost" id="kgDelete">' + (isNew ? '取消' : '删除') + '</button><button class="tv-btn tv-btn--primary" id="kgSave">保存</button></div>';
    const modal = openModal(html, { wide: true });
    function refreshParentOptions() {
      const select = modal.querySelector('#kgParent'); if (!select) return;
      const type = modal.querySelector('#kgType').value;
      const current = select.value;
      select.innerHTML = '<option value="">未归类</option>' + taxonomyParentCandidates(type, id).map(o => '<option value="' + o.id + '">' + esc(entityPath(o)) + '</option>').join('');
      if (current && Array.from(select.options).some(o => o.value === current)) select.value = current;
    }
    function refreshTypeSpecificFields() {
      const type = modal.querySelector('#kgType').value;
      const personality = modal.querySelector('#kgPersonalityField');
      const archetypeField = modal.querySelector('#kgArchetypeField');
      const owner = modal.querySelector('#kgOwner');
      if (personality) personality.hidden = type !== 'character';
      if (archetypeField) archetypeField.hidden = type !== 'character';
      if (owner) owner.hidden = type !== 'item';
      const archetype = modal.querySelector('#kgArchetype');
      const hint = modal.querySelector('#kgArchetypeHint');
      if (archetype && hint) {
        const display = type === 'character' ? characterArchetypeDisplay({ ...e, type, tags: modal.querySelector('#kgTags') ? modal.querySelector('#kgTags').value.split(/[、,，\n]/).filter(Boolean) : e.tags, personality: modal.querySelector('#kgPersonality') ? modal.querySelector('#kgPersonality').value : e.personality, notes: modal.querySelector('#kgNotes') ? modal.querySelector('#kgNotes').value : e.notes, archetype: archetype.dataset.userChanged === 'true' ? archetype.value : (archetype.dataset.source === 'inferred' ? '' : archetype.value) }) : { archetype: '', sourceLabel: '仅人物可用' };
        hint.textContent = '来源：' + (archetype.dataset.userChanged === 'true' ? (archetype.value ? '用户指定' : '自动判断') : display.sourceLabel) + '；保存人物卡后会同步到素材检索。';
      }
    }
    modal.querySelector('#kgType').onchange = () => { refreshParentOptions(); refreshTypeSpecificFields(); };
    const archetypeSelect = modal.querySelector('#kgArchetype');
    if (archetypeSelect) archetypeSelect.onchange = () => { archetypeSelect.dataset.userChanged = 'true'; archetypeSelect.dataset.source = archetypeSelect.value ? 'explicit' : 'none'; refreshTypeSpecificFields(); };
    refreshTypeSpecificFields();
    modal.querySelector('#kgAddAttr').onclick = () => {
      const wrap = modal.querySelector('#kgAttrs');
      const i = wrap.querySelectorAll('.kg-attr-row').length;
      const div = document.createElement('div'); div.className = 'kg-attr-row';
      div.innerHTML = '<input class="kg-attr-k" data-i="' + i + '" placeholder="属性名"/><input class="kg-attr-v" data-i="' + i + '" placeholder="属性值"/><button class="kg-attr-del" data-i="' + i + '" type="button">×</button>';
      wrap.appendChild(div);
    };
    modal.querySelectorAll('.kg-attr-del').forEach(b => b.onclick = () => b.closest('.kg-attr-row').remove());
    modal.querySelector('#kgAddRel').onclick = () => {
      const tid = modal.querySelector('#kgRelTarget').value; const label = modal.querySelector('#kgRelLabel').value.trim();
      if (!tid) { toast('请先在别处创建其他实体'); return; }
      if (!id) { toast('请先保存本实体再添加关系'); return; }
      addEdge(id, tid, label, modal.querySelector('#kgRelType').value); openEntityModal(id);
    };
    modal.querySelectorAll('.kg-rel-del').forEach(b => b.onclick = () => { removeEdge(b.dataset.rid); openEntityModal(id); });
    modal.querySelector('#kgDelete').onclick = () => { if (id) deleteEntity(id); closeModal(); renderSidebarSheji(); };
    modal.querySelector('#kgSave').onclick = () => {
      const name = modal.querySelector('#kgName').value.trim();
      const type = modal.querySelector('#kgType').value;
      if (!name) { toast('请填写名称'); return; }
      const aliases = modal.querySelector('#kgAliases').value.split(/[、,，\n]/).map(x => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
      const parentId = modal.querySelector('#kgParent').value;
      const attrs = []; modal.querySelectorAll('.kg-attr-row').forEach(r => { const k = r.querySelector('.kg-attr-k').value.trim(); const v = r.querySelector('.kg-attr-v').value.trim(); if (k) attrs.push({ k, v }); });
      const notes = modal.querySelector('#kgNotes').value;
      const personality = modal.querySelector('#kgPersonality') ? modal.querySelector('#kgPersonality').value : (e.personality || '');
      const tags = modal.querySelector('#kgTags').value.split(/[、,，\n]/).map(x => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 20);
      const status = (modal.querySelector('#kgStatus') ? modal.querySelector('#kgStatus').value : '').trim().slice(0, 12);
      const loc = (modal.querySelector('#kgLoc') ? modal.querySelector('#kgLoc').value : '').trim().slice(0, 40);
      const owner = (modal.querySelector('#kgOwner') ? modal.querySelector('#kgOwner').value : '').trim().slice(0, 40);
      const core = !!(modal.querySelector('#kgCore') && modal.querySelector('#kgCore').checked);
      const metaPatch = { tags, status, currentLocation: loc, owner, core };
      const selectedArchetype = modal.querySelector('#kgArchetype');
      const explicitArchetype = selectedArchetype && selectedArchetype.dataset.source === 'inferred' && selectedArchetype.dataset.userChanged !== 'true' ? '' : (selectedArchetype ? selectedArchetype.value : '');
      if (isNew) {
        const ne = addEntity(type, name);
        ne.aliases = aliases; ne.parentId = parentId; ne.attrs = attrs; ne.notes = notes; Object.assign(ne, metaPatch);
        if (type === 'character') { ne.personality = personality; applyCharacterArchetype(ne, explicitArchetype); }
        recordEntityHistory(ne); save();
      } else {
        const cur = state.knowledge.entities[id];
        const patch = { name, type, aliases, parentId, attrs, notes, tags, status, currentLocation: loc, owner, core };
        if (type === 'character') {
          const next = { ...cur, ...patch, personality };
          applyCharacterArchetype(next, explicitArchetype);
          patch.personality = personality;
          patch.archetype = next.archetype;
          patch.archetypeSource = next.archetypeSource;
          patch.archetypeConfidence = next.archetypeConfidence;
        }
        updateEntity(id, patch); recordEntityHistory(cur);
      }
      closeModal(); renderSidebarSheji();
    };
  }

  // 知识图谱弹窗（节点图 / 列表 / 历史）
  let kgFocusId = '';
  function openKnowledgeGraphModal() {
    ensureKnowledge();
    kgFocusId = '';
    const html = '<h3 class="ml-modal__title">知识图谱</h3>' +
      '<div class="kg-tabs"><button class="kg-tab is-active" data-v="graph">节点图</button><button class="kg-tab" data-v="list">列表</button><button class="kg-tab" data-v="history">历史</button></div>' +
      '<div class="kg-body" id="kgBody"></div>' +
      '<div class="ml-modal__actions"><button class="tv-btn tv-btn--ghost" id="kgExtract">从正文抽取实体</button><button class="tv-btn tv-btn--primary" id="kgClose">关闭</button></div>';
    const modal = openModal(html, { wide: true });
    const body = modal.querySelector('#kgBody');
    function show(v) {
      modal.querySelectorAll('.kg-tab').forEach(t => t.classList.toggle('is-active', t.dataset.v === v));
      if (v === 'graph') renderGraph(body, kgFocusId);
      else if (v === 'list') renderKgList(body);
      else renderKgHistory(body);
    }
    modal.querySelectorAll('.kg-tab').forEach(t => t.onclick = () => show(t.dataset.v));
    modal.querySelector('#kgExtract').onclick = () => extractKnowledge();
    modal.querySelector('#kgClose').onclick = () => closeModal();
    show('graph');
  }
  function graphSVGInner(idm, edges) {
    let s = '';
    (edges || []).forEach(ed => { const a = idm[ed.from], b = idm[ed.to]; if (!a || !b) return; s += '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="rgba(255,255,255,.18)" stroke-width="1"/>'; });
    Object.values(idm).forEach(n => { const c = entityTypeMeta(n.type).color; s += '<circle class="kg-node" data-id="' + n.id + '" cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="9" fill="' + c + '" stroke="rgba(0,0,0,.35)" stroke-width="1" style="cursor:pointer"/>'; s += '<text x="' + n.x.toFixed(1) + '" y="' + (n.y + 22).toFixed(1) + '" fill="#cfd3da" font-size="11" text-anchor="middle">' + esc(n.name.length > 8 ? n.name.slice(0, 8) + '…' : n.name) + '</text>'; });
    return s;
  }
  const KNOWLEDGE_GRAPH_DEFAULT_LIMIT = 80;
  const KNOWLEDGE_GRAPH_FOCUS_LIMIT = 120;
  function knowledgeGraphEdges() {
    const byId = state.knowledge.entities || {};
    const out = [], seen = new Set();
    const add = (from, to, relationType, label, id) => {
      if (!byId[from] || !byId[to] || from === to) return;
      const type = normalizeRelationType(relationType);
      const key = from + '\u0001' + to + '\u0001' + type;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: id || uid('graph'), from, to, relationType: type, label: label || '' });
    };
    (state.knowledge.edges || []).forEach(ed => add(ed.from, ed.to, ed.relationType, ed.label, ed.id));
    Object.values(byId).forEach(e => { if (e.parentId) add(e.parentId, e.id, 'member_of', '层级归属', 'parent_' + e.id); });
    return out;
  }
  function graphStableValue(value, salt) {
    let hash = 2166136261 ^ (salt || 0);
    for (const ch of String(value || '')) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return ((hash >>> 0) % 1000) / 1000;
  }
  function renderGraph(body, focusId) {
    const ents = entList(); const allEdges = knowledgeGraphEdges();
    if (!ents.length) { body.innerHTML = '<div class="kg-empty">暂无实体，点「从正文抽取实体」或返回设定集新建。</div>'; return; }
    const degree = {};
    allEdges.forEach(ed => { degree[ed.from] = (degree[ed.from] || 0) + 1; degree[ed.to] = (degree[ed.to] || 0) + 1; });
    let nodes = ents, edges = allEdges, truncated = false;
    if (focusId) {
      const focusSet = new Set([focusId]);
      allEdges.forEach(ed => { if (ed.from === focusId) focusSet.add(ed.to); if (ed.to === focusId) focusSet.add(ed.from); });
      nodes = ents.filter(e => focusSet.has(e.id)).sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : (degree[b.id] || 0) - (degree[a.id] || 0)));
      if (nodes.length > KNOWLEDGE_GRAPH_FOCUS_LIMIT) { nodes = nodes.slice(0, KNOWLEDGE_GRAPH_FOCUS_LIMIT); truncated = true; }
      edges = allEdges.filter(ed => focusSet.has(ed.from) && focusSet.has(ed.to));
      edges = edges.filter(ed => nodes.some(e => e.id === ed.from) && nodes.some(e => e.id === ed.to));
    } else if (nodes.length > KNOWLEDGE_GRAPH_DEFAULT_LIMIT) {
      nodes = ents.slice().sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0) || a.name.localeCompare(b.name)).slice(0, KNOWLEDGE_GRAPH_DEFAULT_LIMIT);
      const shown = new Set(nodes.map(e => e.id));
      edges = allEdges.filter(ed => shown.has(ed.from) && shown.has(ed.to));
      truncated = true;
    }
    const W = 720, H = 460;
    const nodeArr = nodes.map(e => ({ id: e.id, type: e.type, name: e.name, x: W * (0.2 + graphStableValue(e.id, 1) * 0.6), y: H * (0.16 + graphStableValue(e.id, 2) * 0.68), vx: 0, vy: 0 }));
    const idm = {}; nodeArr.forEach(n => idm[n.id] = n);
    const k = Math.sqrt(W * H / Math.max(1, nodeArr.length)) * 0.7;
    for (let it = 0; it < 300; it++) {
      for (let i = 0; i < nodeArr.length; i++) for (let j = i + 1; j < nodeArr.length; j++) {
        let dx = nodeArr[i].x - nodeArr[j].x, dy = nodeArr[i].y - nodeArr[j].y;
        let d2 = dx * dx + dy * dy || 0.01, d = Math.sqrt(d2);
        let f = 8000 / d2; nodeArr[i].vx += dx / d * f; nodeArr[i].vy += dy / d * f; nodeArr[j].vx -= dx / d * f; nodeArr[j].vy -= dy / d * f;
      }
      edges.forEach(ed => { const a = idm[ed.from], b = idm[ed.to]; if (!a || !b) return; let dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01; let f = (d - k) * 0.03; a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; });
      nodeArr.forEach(n => { n.vx += (W / 2 - n.x) * 0.004; n.vy += (H / 2 - n.y) * 0.004; n.vx *= 0.85; n.vy *= 0.85; n.x = Math.max(30, Math.min(W - 30, n.x + n.vx)); n.y = Math.max(26, Math.min(H - 26, n.y + n.vy)); });
    }
    let bar = '';
    if (focusId) {
      const fe = state.knowledge.entities[focusId];
      bar = '<div class="kg-focusbar">聚焦：<b>' + esc(fe ? fe.name : '') + '</b>（' + nodeArr.length + ' 个实体 · ' + edges.length + ' 条关系 · 1 跳）' + (truncated ? ' 已限制显示关系度最高的 ' + KNOWLEDGE_GRAPH_FOCUS_LIMIT + ' 个实体' : '') + '<button id="kgFocusBack" type="button">← 返回全图</button></div>';
    } else {
      bar = '<div class="kg-focusbar"><span>' + (truncated ? '全图显示关系度最高的 ' + nodeArr.length + '/' + ents.length + ' 个实体' : '全图：' + nodeArr.length + ' 个实体 · ' + edges.length + ' 条关系') + '</span><select id="kgFocusSel"><option value="">聚焦单个实体（1 跳关系）…</option>' + ents.slice().sort((a, b) => a.name.localeCompare(b.name)).map(e => '<option value="' + e.id + '">' + esc(e.name) + '</option>').join('') + '</select></div>';
    }
    body.innerHTML = bar + '<svg id="kgSvg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" aria-label="知识关系图谱" style="background:rgba(255,255,255,.02);border-radius:8px;touch-action:none;display:block;"><title>拖拽节点可调整布局，点击节点编辑</title>' + graphSVGInner(idm, edges) + '</svg>';
    const sel = body.querySelector('#kgFocusSel'); if (sel) sel.onchange = () => { if (sel.value) { kgFocusId = sel.value; renderGraph(body, kgFocusId); } };
    const back = body.querySelector('#kgFocusBack'); if (back) back.onclick = () => { kgFocusId = ''; renderGraph(body, ''); };
    const svgEl = body.querySelector('#kgSvg');
    svgEl.addEventListener('click', ev => { const t = ev.target.closest('.kg-node'); if (t) openEntityModal(t.dataset.id); });
    let drag = null;
    svgEl.addEventListener('pointerdown', ev => { const t = ev.target.closest('.kg-node'); if (!t) return; drag = t.dataset.id; svgEl.setPointerCapture && svgEl.setPointerCapture(ev.pointerId); });
    svgEl.addEventListener('pointermove', ev => {
      if (!drag) return; const pt = svgEl.getBoundingClientRect(); const sx = W / pt.width, sy = H / pt.height;
      const n = idm[drag]; if (!n) return; n.x = (ev.clientX - pt.left) * sx; n.y = (ev.clientY - pt.top) * sy;
      svgEl.innerHTML = graphSVGInner(idm, edges);
    });
    svgEl.addEventListener('pointerup', () => { drag = null; });
    svgEl.addEventListener('pointercancel', () => { drag = null; });
  }
  function renderKgList(body) {
    const ents = entList();
    if (!ents.length) { body.innerHTML = '<div class="kg-empty">暂无实体</div>'; return; }
    let html = '<input class="kg-search" id="kgSearch" placeholder="搜索实体…" style="width:100%;margin-bottom:10px;background:rgba(255,255,255,.05);color:#e6e8eb;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;"/>';
    html += '<div id="kgListWrap">';
    ENTITY_TYPES.forEach(t => {
      const list = ents.filter(e => e.type === t.type);
      if (!list.length) return;
      html += '<div class="kg-list-sec">' + t.label + '（' + list.length + '）</div>';
      list.forEach(e => {
        const attrSummary = (e.attrs || []).slice(0, 3).map(a => a.k + (a.v ? '：' + a.v : '')).join('、');
        const extra = [e.status, (e.tags || []).join('、')].filter(Boolean).join(' · ');
        const sub = [attrSummary, extra].filter(Boolean).join(' · ');
        html += '<div class="kg-list-row" data-id="' + e.id + '"><span class="kg-dot" style="background:' + t.color + '"></span><div class="kg-list-main"><div class="kg-list-name">' + esc(e.name) + '</div>' + (sub ? '<div class="kg-list-sub">' + esc(sub) + '</div>' : '') + '</div><button class="kg-list-del" data-id="' + e.id + '" type="button">删除</button></div>';
      });
    });
    html += '</div>';
    body.innerHTML = html;
    const wrap = body.querySelector('#kgListWrap');
    body.querySelector('#kgSearch').oninput = ev => {
      const q = ev.target.value.trim().toLowerCase();
      wrap.querySelectorAll('.kg-list-row').forEach(r => { const e = state.knowledge.entities[r.dataset.id]; r.style.display = (!q || (e && e.name.toLowerCase().includes(q))) ? '' : 'none'; });
    };
    wrap.querySelectorAll('.kg-list-row').forEach(r => r.onclick = ev => { if (ev.target.closest('.kg-list-del')) return; openEntityModal(r.dataset.id); });
    wrap.querySelectorAll('.kg-list-del').forEach(b => b.onclick = () => { deleteEntity(b.dataset.id); renderKgList(body); });
  }
  function renderEntityTimelineHtml(entity) {
    const history = entity && entity.history && typeof entity.history === 'object' && !Array.isArray(entity.history) ? entity.history : {};
    const rows = Object.entries(history).sort((a, b) => (Number(b[1] && b[1].at) || 0) - (Number(a[1] && a[1].at) || 0));
    if (!rows.length) return '<div class="kg-empty">暂无状态记录</div>';
    return rows.map(([chapterId, snapshot]) => {
      const chapter = chapterById(chapterId);
      const chapterLabel = chapter ? chapter.title + (chapter.sub ? ' · ' + chapter.sub : '') : (chapterId === 'global' ? '全局' : chapterId || '未知章节');
      const summary = snapshot && typeof snapshot === 'object' ? snapshot.summary : snapshot;
      return '<div class="kg-hist-row"><span class="kg-hist-ch">' + esc(chapterLabel) + '</span><span class="kg-hist-sum">' + esc(String(summary || '未记录摘要')) + '</span></div>';
    }).join('');
  }
  function renderKgHistory(body) {
    const ents = entList();
    const withHist = ents.filter(e => e.history && Object.keys(e.history).length);
    if (!withHist.length) { body.innerHTML = '<div class="kg-empty">暂无状态记录。编辑实体、或在设定集点场景卡改状态时，会自动记录「当前章节」的状态快照。</div>'; return; }
    let html = '';
    withHist.forEach(e => {
      html += '<div class="kg-hist-entity"><div class="kg-hist-name" style="color:' + entityTypeMeta(e.type).color + '">● ' + (e.core ? '★ ' : '') + esc(e.name) + '</div>' + renderEntityTimelineHtml(e) + '</div>';
    });
    body.innerHTML = html;
  }

  /* ===================== 设定治理：查重合并 / AI 梳理 ===================== */
  function normalizedNameKey(s) {
    return String(s || '').toLowerCase().replace(/[\s·•—\-_（）()【】\[\]《》〈〉「」『』"'`~!@#$%^&*+=,.;:，。；：、|/\\]/g, '');
  }
  function nameEditDistance(a, b) {
    const left = Array.from(a), right = Array.from(b);
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    let prev = right.map((_, i) => i);
    for (let i = 0; i < left.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < right.length; j++) next.push(left[i] === right[j] ? prev[j] : Math.min(prev[j] + 1, next[j] + 1, prev[j + 1] + 1));
      prev = next;
    }
    return prev[right.length];
  }
  function duplicateNameMatch(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    const left = [a.name, ...(a.aliases || [])].map(normalizedNameKey).filter(Boolean);
    const right = [b.name, ...(b.aliases || [])].map(normalizedNameKey).filter(Boolean);
    return left.some(x => right.some(y => {
      if (x === y) return true;
      const minLength = Math.min(x.length, y.length);
      if (minLength >= 3 && (x.includes(y) || y.includes(x))) return true;
      return minLength >= 4 && Math.abs(x.length - y.length) <= 1 && x[0] === y[0] && nameEditDistance(x, y) <= 1;
    }));
  }
  function findDuplicateGroups(ents) {
    const byType = {};
    ents.forEach(e => { (byType[e.type] = byType[e.type] || []).push(e); });
    const assigned = new Set();
    const groups = [];
    Object.values(byType).forEach(bucket => bucket.forEach(seed => {
      if (assigned.has(seed.id)) return;
      const group = [seed];
      assigned.add(seed.id);
      for (let i = 0; i < group.length; i++) {
        bucket.forEach(candidate => {
          if (assigned.has(candidate.id) || !duplicateNameMatch(group[i], candidate)) return;
          assigned.add(candidate.id);
          group.push(candidate);
        });
      }
      if (group.length > 1) groups.push(group);
    }));
    return groups;
  }
  function openDedupModal() {
    ensureKnowledge();
    const ents = entList();
    const groups = findDuplicateGroups(ents);
    const html = '<h3 class="ml-modal__title">查重合并</h3><p class="ml-modal__hint">按同类型实体的名称、别名和近似名称找出可能重复的设定。请人工确认后合并：<b>保留每组第一条</b>，其余并入（属性、备注、标签、状态、关系、历史和子实体一并归并）。</p><div class="kg-body" id="dedupBody">' + (groups.length ? '' : '<div class="cs-empty">未发现疑似重复的设定。</div>') + '</div><div class="ml-modal__actions"><button class="tv-btn tv-btn--ghost" id="dedupRefresh" type="button">重新扫描</button><button class="tv-btn tv-btn--primary" id="dedupClose" type="button">关闭</button></div>';
    const modal = openModal(html, { wide: true });
    const body = modal.querySelector('#dedupBody');
    function render() {
      if (!groups.length) {
        body.innerHTML = '<div class="cs-empty">未发现疑似重复的设定。</div>';
        return;
      }
      let h = '';
      groups.forEach((g, gi) => {
        h += '<div class="kg-dedup-group"><div class="kg-dedup-head">疑似重复组 ' + (gi + 1) + '（' + g.length + ' 条）</div><div class="kg-dedup-rows">';
        g.forEach((e, ei) => {
          const meta = entityTypeMeta(e.type);
          const sub = [(e.attrs || []).slice(0, 2).map(a => a.k + (a.v ? '=' + a.v : '')).join('、'), (e.aliases || []).length ? '别名：' + e.aliases.join('、') : ''].filter(Boolean).join(' · ');
          h += '<div class="kg-dedup-row' + (ei === 0 ? ' is-keep' : '') + '"><span class="kg-dot" style="background:' + meta.color + '"></span><span class="kg-dedup-name">' + (ei === 0 ? '★ ' : '') + esc(e.name) + '</span><span class="kg-dedup-sub">' + esc(meta.label + (sub ? ' · ' + sub : '')) + '</span>' + (ei > 0 ? '<button class="kg-dedup-btn" data-target="' + g[0].id + '" data-dup="' + e.id + '" type="button">合并到第一项</button>' : '') + '</div>';
        });
        h += '</div></div>';
      });
      body.innerHTML = h;
      body.querySelectorAll('.kg-dedup-btn').forEach(b => b.onclick = () => {
        mergeEntities(b.dataset.target, [b.dataset.dup]);
        toast('已合并，重复条目已移除');
        closeModal(); openDedupModal();
      });
    }
    render();
    modal.querySelector('#dedupRefresh').onclick = () => openDedupModal();
    modal.querySelector('#dedupClose').onclick = () => { closeModal(); renderSidebarSheji(); };
  }
  function mergeEntities(targetId, dupIds) {
    ensureKnowledge();
    const target = state.knowledge.entities[targetId]; if (!target) return;
    normalizeKnowledgeEntity(target);
    (dupIds || []).forEach(id => {
      const d = state.knowledge.entities[id]; if (!d || id === targetId) return;
      normalizeKnowledgeEntity(d);
      (d.attrs || []).forEach(a => {
        if (!a || !a.k) return;
        const existing = target.attrs.find(x => x.k === a.k);
        if (!existing) target.attrs.push({ k: String(a.k), v: String(a.v || '') });
        else if (a.v && existing.v !== a.v && !String(existing.v || '').split('；').includes(a.v)) existing.v = [existing.v, a.v].filter(Boolean).join('；');
      });
      target.aliases = normalizeAliasList([...(target.aliases || []), ...(d.aliases || []), d.name]).filter(x => x !== target.name);
      const dn = String(d.notes || '').trim();
      if (dn && !String(target.notes || '').includes(dn)) target.notes = [target.notes, dn].filter(Boolean).join('\n\n');
      if ((d.tags || []).length) target.tags = Array.from(new Set([...(target.tags || []), ...d.tags])).slice(0, 20);
      if (d.core) target.core = true;
      if (!target.status && d.status) target.status = d.status;
      if (!target.currentLocation && d.currentLocation) target.currentLocation = d.currentLocation;
      if (!target.owner && d.owner) target.owner = d.owner;
      if (d.personality && !String(target.personality || '').includes(String(d.personality))) target.personality = [target.personality, d.personality].filter(Boolean).join('\n');
      if (!target.parentId && d.parentId && d.parentId !== id && d.parentId !== targetId) target.parentId = d.parentId;
      Object.entries(d.history || {}).forEach(([chapterId, snapshot]) => { if (!target.history[chapterId]) target.history[chapterId] = snapshot; });
      state.knowledge.edges.forEach(ed => { if (ed.from === id) ed.from = targetId; if (ed.to === id) ed.to = targetId; });
      entList().forEach(x => { if (x.id !== targetId && x.parentId === id) x.parentId = targetId; });
      if (target.parentId === id) target.parentId = d.parentId || '';
      delete state.knowledge.entities[id];
    });
    dedupeKnowledgeEdges();
    target.updatedAt = Date.now();
    save(); renderSidebarSheji();
  }

  // 大屏工作台：三栏浏览（实体列表 | 详情卡片 | 关系/状态时间线）
  function openShejiWorkbench() {
    ensureKnowledge();
    const ents = entList().sort((a, b) => (b.core ? 1 : 0) - (a.core ? 1 : 0) || a.name.localeCompare(b.name));
    if (!ents.length) { toast('暂无设定，先新建或从正文抽取'); return; }
    usageStats = computeEntityUsage();
    const html = '<h3 class="ml-modal__title">设定集工作台</h3><p class="ml-modal__hint">三栏集中整理：实体列表 → 详情卡片 → 关系与状态时间线。适合大屏使用。</p><div class="kg-wb">' +
      '<div class="kg-wb-col kg-wb-col--list"><input id="wbSearch" class="kg-wb-search" placeholder="搜索名称、别名、属性…"/><div class="kg-wb-list" id="wbList"></div></div>' +
      '<div class="kg-wb-col kg-wb-col--detail" id="wbDetail"></div>' +
      '<div class="kg-wb-col kg-wb-col--side" id="wbSide"></div>' +
      '</div><div class="ml-modal__actions"><button class="tv-btn tv-btn--primary" id="wbClose">关闭</button></div>';
    const modal = openModal(html, { wide: true });
    const listEl = modal.querySelector('#wbList');
    const detailEl = modal.querySelector('#wbDetail');
    const sideEl = modal.querySelector('#wbSide');
    let selectedId = ents[0].id;
    function listRows(filter) {
      const q = String(filter || '').trim().toLowerCase();
      const rows = ents.filter(e => !q || entitySearchText(e).includes(q));
      listEl.innerHTML = rows.map(e => '<div class="kg-wb-row' + (e.id === selectedId ? ' is-active' : '') + '" data-id="' + e.id + '"><span class="kg-dot" style="background:' + entityTypeMeta(e.type).color + '"></span><span class="kg-wb-name">' + (e.core ? '<span class="kg-core-star">★</span>' : '') + esc(e.name) + '</span><span class="kg-wb-meta">' + esc(entityTypeMeta(e.type).label) + (e.status ? ' · ' + esc(e.status) : '') + '</span></div>').join('') || '<div class="kg-empty">无匹配</div>';
      listEl.querySelectorAll('.kg-wb-row').forEach(r => r.onclick = () => { selectedId = r.dataset.id; listRows(filter); renderDetail(); });
    }
    function renderDetail() {
      const e = state.knowledge.entities[selectedId]; if (!e) return;
      const meta = entityTypeMeta(e.type);
      const attrs = (e.attrs || []).map(a => '<div class="kg-wb-attr"><span>' + esc(a.k) + '</span><b>' + esc(a.v) + '</b></div>').join('') || '<div class="kg-empty">无属性</div>';
      const tags = (e.tags || []).map(t => '<span class="kg-tag-chip">' + esc(t) + '</span>').join('');
      const use = (usageStats && usageStats.byId[e.id]) || null;
      detailEl.innerHTML = '<div class="kg-wb-detail"><div class="kg-wb-dhead"><span class="kg-dot" style="background:' + meta.color + '"></span><h4>' + (e.core ? '<span class="kg-core-star">★</span>' : '') + esc(e.name) + '</h4><span class="kg-wb-dtype">' + esc(meta.label) + '</span><button class="kg-wb-edit" id="wbEdit" type="button">编辑</button></div>' +
        ((e.status || e.currentLocation || e.owner) ? '<div class="kg-wb-dstatus">' + (e.status ? '<span class="kg-status-chip">' + esc(e.status) + '</span>' : '') + (e.currentLocation ? ' 位于 ' + esc(e.currentLocation) : '') + (e.owner ? ' · 持有者 ' + esc(e.owner) : '') + '</div>' : '') +
        '<div class="kg-wb-dsub">' + esc(entityPath(e) || meta.label) + (use ? (use.count > 0 ? ' · 用过 ' + use.count + ' 次' : ' · 未引用') : '') + '</div>' +
        (tags ? '<div class="kg-wb-dtags">' + tags + '</div>' : '') +
        '<div class="kg-sub">属性</div>' + attrs +
        (e.notes ? '<div class="kg-sub">备注</div><div class="kg-wb-dnotes">' + esc(e.notes) + '</div>' : '') +
        '</div>';
      const editBtn = detailEl.querySelector('#wbEdit');
      if (editBtn) editBtn.onclick = () => openEntityModal(selectedId);
      const rels = (state.knowledge.edges || []).filter(ed => ed.from === selectedId || ed.to === selectedId);
      const relHtml = rels.map(ed => {
        const other = ed.from === selectedId ? state.knowledge.entities[ed.to] : state.knowledge.entities[ed.from];
        const dir = ed.from === selectedId ? '→' : '←';
        return '<div class="kg-wb-rel"><span>' + dir + ' ' + esc(other ? other.name : '?') + '</span><span>' + esc(relationTypeMeta(ed.relationType).label + (ed.label ? ' · ' + ed.label : '')) + '</span></div>';
      }).join('') || '<div class="kg-empty">暂无关系</div>';
      sideEl.innerHTML = '<div class="kg-sub">关系（' + rels.length + '）</div>' + relHtml + '<div class="kg-sub">状态时间线</div>' + renderEntityTimelineHtml(e);
    }
    listRows('');
    renderDetail();
    const search = modal.querySelector('#wbSearch');
    if (search) search.oninput = ev => listRows(ev.target.value);
    modal.querySelector('#wbClose').onclick = () => closeModal();
  }

  // C2：AI 设定梳理报告（重复/矛盾/过时/缺失），复用一致性智能体思路
  async function openAiAuditModal() {
    const requestSession = sessionIdentity();
    ensureKnowledge();
    const ents = entList();
    const html = '<h3 class="ml-modal__title">AI 设定梳理</h3><p class="ml-modal__hint">扫描全部设定条目，检查重复、矛盾、过时与缺失，输出问题清单与修正建议。</p><div class="kg-body" id="kgAuditBody">' + (ents.length ? '<div class="cs-loading">正在分析…</div>' : '<div class="cs-empty">暂无设定可梳理</div>') + '</div><div class="ml-modal__actions"><button class="tv-btn tv-btn--primary" id="kgAuditClose" type="button">关闭</button></div>';
    const modal = openModal(html, { wide: true });
    const body = modal.querySelector('#kgAuditBody');
    modal.querySelector('#kgAuditClose').onclick = () => closeModal();
    if (!ents.length) return;
    const facts = ents.map(e => {
      const t = entityTypeMeta(e.type).label;
      const bits = ['【' + t + '】' + e.name];
      if ((e.aliases || []).length) bits.push('别名：' + e.aliases.join('、'));
      if (e.status) bits.push('状态：' + e.status);
      if (e.currentLocation) bits.push('位置：' + e.currentLocation);
      if (e.owner) bits.push('持有者：' + e.owner);
      if ((e.tags || []).length) bits.push('标签：' + e.tags.join('、'));
      if ((e.attrs || []).length) bits.push(e.attrs.map(a => a.k + '=' + a.v).join('、'));
      if (e.notes) bits.push(String(e.notes).slice(0, 90));
      return bits.join('｜');
    }).join('\n');
    const sys = await buildSystemReady('你是小说设定审核引擎。对比下方全部设定条目，找出：重复（同一事物被建多个条目）、矛盾（同一实体属性/状态冲突）、过时（与故事当前进展不符，如角色已死亡却仍标存活）、缺失（明显需要但没有的关键设定）。只输出一个 JSON 对象：{"issues":[{"type":"重复|矛盾|过时|缺失","entity":"相关实体名","desc":"具体问题","fix":"建议修正"}]}，没有问题则输出 {"issues":[]}。不要解释，不要 Markdown 代码块。');
    if (sessionIdentity() !== requestSession) return;
    if (!sys) { body.innerHTML = '<div class="cs-empty">Skill 尚未加载完成，请稍后重试</div>'; return; }
    const userMsg = '【全部设定条目】\n' + facts.slice(0, 14000);
    const model = currentAIPanelModel();
    const task = createAITask('AI设定梳理', model, 'setting', { kind: 'audit' });
    let full = '';
    streamChat({ model: model, thinking: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] }, {
      onStart: c => { bindAITaskController(task, c); updateAITask(task, { stage: '正在扫描重复、矛盾与缺失', progress: 8 }); },
      onBilling: billing => updateAITaskBilling(task, billing),
      onDelta: d => { full += d; body.innerHTML = '<div class="cs-loading">正在分析…</div><pre style="white-space:pre-wrap;font-size:12px;color:#6b7280;max-height:40vh;overflow:auto;margin-top:8px;">' + esc(full) + '</pre>'; },
      onDone: (reason, usage) => {
        finishAITask(task, reason, usage, { resultExcerpt: full.slice(0, 180) });
        logAICall('AI设定梳理', model, usage, full);
        if (reason === 'credit_exhausted') { body.innerHTML = '<div class="cs-empty">积分不足，无法完成梳理</div>'; return; }
        if (reason === 'abort') { body.innerHTML = '<div class="cs-empty">已中断</div>'; return; }
        const data = parseJSONSafe(full);
        if (!data || !Array.isArray(data.issues)) { body.innerHTML = '<div class="cs-empty">未解析到有效结果，请重试</div><pre style="white-space:pre-wrap;font-size:12px;color:#6b7280;max-height:30vh;overflow:auto;margin-top:8px;">' + esc(full) + '</pre>'; return; }
        renderAuditIssues(body, data.issues);
      },
      onError: (e, meta) => {
        const creditExhausted = !!(meta && (meta.code === 'credit_exhausted' || meta.status === 402));
        finishAITask(task, creditExhausted ? 'credit_exhausted' : 'error', null, { error: String(e) });
        logAICall('AI设定梳理', model, null, full);
        body.innerHTML = '<div class="cs-empty">梳理失败：' + esc((e && e.message) || e) + '</div>';
      }
    });
  }
  function renderAuditIssues(body, issues) {
    if (!issues || !issues.length) { body.innerHTML = '<div class="cs-summary">未发现明显问题，设定基本健康。</div>'; return; }
    const typeMap = { 重复: ['conflict', '重复'], 矛盾: ['conflict', '矛盾'], 过时: ['eatbook', '过时'], 缺失: ['miss', '缺失'] };
    let html = '<div class="cs-summary">发现 ' + issues.length + ' 个问题</div>';
    issues.forEach(it => {
      const meta = typeMap[String(it.type).trim()] || ['miss', String(it.type || '问题')];
      html += '<div class="cs-row"><span class="cs-type cs-type--' + meta[0] + '">' + meta[1] + '</span><div class="cs-row__main"><div class="cs-row__entity">' + esc(it.entity || '') + '</div><div class="cs-row__desc">' + esc(it.desc || '') + '</div>' + (it.fix ? '<div class="cs-row__fix">建议：' + esc(it.fix) + '</div>' : '') + '</div></div>';
    });
    body.innerHTML = html;
  }

  /* ---------------- 初始化 ---------------- */
  /* ---------------- 选中正文 → 记为设定（浮动按钮） ---------------- */
  let quickRecordEl = null;
  function ensureQuickRecordEl() {
    if (quickRecordEl && quickRecordEl.isConnected) return quickRecordEl;
    const wrap = document.createElement('div');
    wrap.id = 'quickRecordWrap';
    wrap.style.cssText = 'position:fixed;z-index:2000;display:none;font-family:inherit;background:#fff;border:1px solid #d1d5db;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.12);padding:2px 4px;';
    wrap.innerHTML = '<button id="quickRecordBtn" type="button" title="把选中文字记为设定" style="border:none;background:transparent;padding:4px 8px;font-size:12px;cursor:pointer;border-radius:4px;">记为设定</button>' +
      '<button id="quickCorrectionBtn" type="button" title="把选中文字记入纠错库回流队列" style="border:none;background:transparent;padding:4px 8px;font-size:12px;cursor:pointer;border-radius:4px;color:#d97706;">记入纠错</button>' +
      '<div id="quickRecordTypes" hidden style="display:flex;gap:2px;margin-top:2px;border-top:1px solid #f3f4f6;padding-top:2px;"><button data-t="character" type="button">人物</button><button data-t="location" type="button">地点</button><button data-t="item" type="button">物品</button><button data-t="faction" type="button">势力</button><button data-t="event" type="button">事件</button></div>';
    document.body.appendChild(wrap);
    quickRecordEl = wrap;
    wrap.querySelector('#quickRecordBtn').onclick = () => { wrap.querySelector('#quickRecordTypes').hidden = false; };
    wrap.querySelector('#quickCorrectionBtn').onclick = () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().replace(/\s+/g, ' ').trim() : '';
      hideQuickRecord();
      if (text) openCorrectionInboxModal(text);
    };
    wrap.querySelectorAll('#quickRecordTypes button').forEach(b => b.onclick = () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().replace(/\s+/g, ' ').trim() : '';
      hideQuickRecord();
      if (text) openEntityModal(null, { name: text.slice(0, 40), type: b.dataset.t });
    });
    return wrap;
  }
  function showQuickRecord(rect) {
    const wrap = ensureQuickRecordEl();
    wrap.querySelector('#quickRecordTypes').hidden = true;
    wrap.style.display = 'block';
    const bw = 160, bh = 30;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    let top = rect.top - bh - 8;
    if (top < 8) top = rect.bottom + 8;
    wrap.style.left = left + 'px';
    wrap.style.top = top + 'px';
  }
  function hideQuickRecord() { if (quickRecordEl) quickRecordEl.style.display = 'none'; }
  function quickRecordSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { hideQuickRecord(); return; }
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 120) { hideQuickRecord(); return; }
    const anchor = sel.anchorNode;
    const editorEl = anchor && anchor.nodeType === 3 ? anchor.parentElement : anchor;
    const inEditor = editorEl && (editorEl.closest('#editorContent') || editorEl.closest('.immersive-editor'));
    if (!inEditor || document.querySelector('.ml-modal')) { hideQuickRecord(); return; }
    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { hideQuickRecord(); return; }
      showQuickRecord(rect);
    } catch (_) { hideQuickRecord(); }
  }
  function initSelectToRecord() {
    const editors = document.querySelectorAll('#editorContent, .immersive-editor');
    if (!editors.length) return;
    editors.forEach(el => {
      el.addEventListener('mouseup', quickRecordSelection);
      el.addEventListener('keyup', quickRecordSelection);
      el.addEventListener('scroll', hideQuickRecord, true);
      el.addEventListener('input', () => setTimeout(hideQuickRecord, 50));
    });
    document.addEventListener('scroll', hideQuickRecord, true);
    document.addEventListener('selectionchange', quickRecordSelection);
    document.addEventListener('mousedown', ev => { if (!ev.target.closest('#quickRecordWrap')) hideQuickRecord(); });
  }

  function init() {
    // Keep the live toolbar inside the center column so it follows panel
    // resizing and collapse states instead of relying on fixed viewport offsets.
    const editorToolbar = $('editorToolbar');
    const editorMainArea = document.querySelector('.editor-main-area');
    if (editorToolbar && editorMainArea && editorToolbar.parentElement !== editorMainArea) {
      editorMainArea.insertBefore(editorToolbar, editorMainArea.firstChild);
    }
    state = initFromURL();
    loadNovelSkillDefinitions(state);
    const migrated = normalizeNovelState(state);
    ensureAdvancedState();
    recoverInterruptedAITasks();
    if (migrated) persist();
    if (dissectionHandoffApplied) setTimeout(() => toast('\u5df2\u542f\u7528\u62c6\u4e66\u63d0\u53d6\u7684\u6587\u98ce\u4e0e\u521b\u4f5c\u6280\u6cd5'), 450);
    // SaaS：拉取平台模型列表（含计费提示，不含密钥）并刷新积分显示
    loadPlatformModels().then(() => { initSettings(); updateModelBadges(); renderThinkControl(); applyModelAccessUI(); });
    refreshServerCredits();
    initSelectToRecord();
    // 首次使用提醒导出备份（数据仅存于本机浏览器）
    if (!localStorage.getItem('molan_backup_reminded') && Object.keys(novels).length) {
      try { localStorage.setItem('molan_backup_reminded', '1'); } catch (_) {}
      setTimeout(() => toast('你的小说仅保存在本机浏览器。建议定期点「更多 → 导出文库」备份，避免数据丢失。'), 900);
    }
    // 登录后首次同步：先征得用户同意，再把本地所有小说推送到云端。
    // 在这个决定完成前不启动云端拉取，避免本地推送与远端覆盖并行发生。
    let cloudStartup = Promise.resolve(true);
    if (cloudEnabled() && !localStorage.getItem(LS_CLOUD_SYNCED)) {
      const localCount = Object.keys(novels).length;
      if (localCount > 0) {
        cloudStartup = new Promise(resolve => setTimeout(() => {
          const accepted = window.confirm('检测到本机有 ' + localCount + ' 本小说。是否现在同步到云端？\n\n选择“取消”不会删除或修改本地作品。');
          if (!accepted) { toast('已保留在本地，未进行云端同步'); resolve(false); return; }
          localStorage.setItem(LS_CLOUD_SYNCED, '1');
          firstSyncToCloud().then(r => {
            if (r.ok && r.count > 0) toast('已把本机 ' + r.count + ' 本小说同步到云端');
            else if (r.fail) toast('同步完成：' + r.count + ' 成功，' + r.fail + ' 失败');
          }).catch(e => console.warn('[首次同步]', e.message)).finally(resolve);
        }, 350));
      } else {
        localStorage.setItem(LS_CLOUD_SYNCED, '1');
      }
    }
    // 其他设备 / 新设备登录后自动从云端拉取（含 GPT 源等配置），无需手动点「同步」
    if (cloudEnabled()) {
      cloudStartup.then(allowPull => allowPull ? pullFromCloud() : { ok: true, loaded: 0, total: 0 }).then(r => {
          if (r.ok && pendingNovelId && novels[pendingNovelId]) {
            currentId = pendingNovelId;
            state = novels[currentId];
            pendingNovelId = '';
            loadNovel(currentId);
          } else if (r.ok && r.loaded > 0) { renderTree(); renderEditor(); }
        renderSyncBadge();
      }).catch(() => {});
    }
    // 云端状态徽章初始渲染 + 同步按钮
    renderSyncBadge();
    const cloudStatus = $('cloudStatus');
    if (cloudStatus) cloudStatus.onclick = () => {
      const first = cloudConflicts.keys().next();
      if (!first.done) openCloudConflict(first.value);
    };
    const syncBtn = $('syncBtn');
    if (syncBtn) syncBtn.onclick = async () => {
      if (!cloudEnabled()) { toast('未登录，无法从云端同步'); return; }
      const firstConflict = cloudConflicts.keys().next();
      if (!firstConflict.done) { openCloudConflict(firstConflict.value); return; }
      syncBtn.disabled = true;
      const oldText = syncBtn.textContent;
      syncBtn.textContent = '同步中…';
      try {
        const r = await pullFromCloud();
        if (r.ok) {
          toast('已从云端拉取 ' + r.loaded + ' 本小说（共 ' + r.total + '）');
          // 重新打开当前小说以刷新视图
          if (currentId && novels[currentId]) { save(); renderTree(); renderEditor(); }
          renderSyncBadge();
        }
      } catch (e) { toast('同步失败：' + e.message); }
      syncBtn.textContent = oldText;
      syncBtn.disabled = false;
    };
    // 监听 token 变化（同一窗口内登录后）刷新徽章
    setInterval(() => {
      const hasTok = !!getToken();
      const accountChanged = switchAccountNamespaceIfNeeded();
      const lastHas = window.__mlCloudLast === undefined ? !!hasTok : window.__mlCloudLast;
        if (accountChanged || lastHas !== hasTok) {
          window.__mlCloudLast = hasTok;
          renderSyncBadge();
          refreshServerCredits();
          // 同窗口内登录后，自动从云端拉取小说（含 GPT 源等配置）
          if (hasTok) { pullFromCloud().then(r => { if (r.ok && r.loaded > 0) { renderTree(); renderEditor(); } }).catch(() => {}); }
        }
    }, 2000);
    recomputeChapterWords();
    applyTheme(state.settings.theme);
    renderTree();
    renderEditor();

    // 我的文库
    const libBtn = $('libBtn'); if (libBtn) libBtn.onclick = () => { window.location.href = './novels.html'; };

    // 侧栏 / 面板折叠（桌面）或抽屉（移动端）
    const isMobile = () => window.matchMedia('(max-width: 1100px)').matches;
    const sidebarToggle = $('sidebarToggle'); if (sidebarToggle) sidebarToggle.onclick = () => {
      if (isMobile()) { sidebar.classList.toggle('is-open'); updateBackdrop(); }
      else sidebar.classList.toggle('is-collapsed');
    };
    const backBtn = $('backBtn'); if (backBtn) backBtn.onclick = () => { window.location.href = '../index.html'; };
    const rightPanelToggle = $('rightPanelToggle'); if (rightPanelToggle) rightPanelToggle.onclick = () => {
      if (isMobile()) { rightPanel.classList.toggle('is-open'); if (typeof updateAIFab === 'function') updateAIFab(); updateBackdrop(); }
      else rightPanel.classList.toggle('is-collapsed');
    };
    // 折叠后的重开条：点击恢复右侧三段式面板
    const rpReopenRail = $('rpReopenRail');
    if (rpReopenRail) {
      const reopen = () => { if (rightPanel) rightPanel.classList.remove('is-collapsed'); };
      rpReopenRail.addEventListener('click', reopen);
      rpReopenRail.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reopen(); } });
    }
    const drawerBackdrop = $('drawerBackdrop');
    if (drawerBackdrop) drawerBackdrop.onclick = () => closeDrawers();

    // 更多菜单
    const moreMenu = $('moreMenu'); const moreBtn = $('moreBtn');
    if (moreBtn) moreBtn.onclick = (e) => { e.stopPropagation(); moreMenu.classList.toggle('is-open'); };
    document.addEventListener('click', () => moreMenu && moreMenu.classList.remove('is-open'));
    if (moreMenu) moreMenu.onclick = e => e.stopPropagation();
    if (moreMenu) Array.from(moreMenu.querySelectorAll('.editor-menu__item')).forEach(btn => {
      const act = btn.dataset.act;
      const txt = btn.textContent.trim();
      btn.onclick = () => {
        moreMenu.classList.remove('is-open');
        if (act === 'save-draft') { save({ snapshot: true }); toast('已保存草稿'); }
        else if (act === 'chapter-settings') { switchTab('settings'); toast('章节设置'); }
        else if (act === 'export-novel') { exportNovel(); }
        else if (act === 'delete-chapter') { deleteCurrentChapter(); }
        else if (act === 'export-lib') { exportLibrary(); }
        else if (act === 'import-lib') { importLibrary(); }
        else if (act === 'import-novel') { importNovel(); }
        else if (act === 'inspirations') { openInspirationsModal(); }
        else if (act === 'model-sources') { toast('平台已内置全部模型（DeepSeek / GPT 中转），密钥由平台统一托管，无需自行配置'); }
        else if (act === 'consistency') { runConsistencyCheck(); }
        else if (act === 'correction' || txt.includes('纠错') || txt.includes('审校')) { openChapterCorrectionModal(); }
        else if (txt.includes('保存草稿')) { save({ snapshot: true }); toast('已保存草稿'); }
      };
    });

    // 顶栏标签页
    const toolbar = $('editorToolbar');
    if (toolbar) toolbar.onclick = e => { const b = e.target.closest('.editor-tab'); if (b) switchTab(b.dataset.tab); };
    const settingsBtn = $('settingsBtn'); if (settingsBtn) settingsBtn.onclick = () => switchTab('settings');
    const exitIm = $('exitImmersive'); if (exitIm) exitIm.onclick = () => switchTab('writing');

    // 分享：编辑器顶栏和首页同款 AI 卡片共用同一行为。
    const shareHandler = () => {
      const data = { title: state.title, chapters: state.volumes[0].chapters.length };
      copyTextToClipboard(JSON.stringify(data)).then(ok => toast(ok ? '分享链接已复制到剪贴板（演示）' : '分享（演示）'));
    };
    const shareBtn = $('shareBtn'); if (shareBtn) shareBtn.onclick = shareHandler;
    const rpShareBtn = $('rpShareBtn'); if (rpShareBtn) rpShareBtn.onclick = shareHandler;
    const rpAccountBtn = $('rpAccountBtn'); if (rpAccountBtn) rpAccountBtn.onclick = () => { location.href = 'account.html'; };
    const rpInspirationBtn = $('rpInspirationBtn'); if (rpInspirationBtn) rpInspirationBtn.onclick = () => openInspirationsModal();
    const rpCopyBtn = $('rpCopyBtn'); if (rpCopyBtn) rpCopyBtn.onclick = () => {
      const text = (state.aiMessages || []).map(m => (m.role === 'user' ? '我：' : 'AI：') + (m.text || '')).join('\n\n');
      if (!text) { toast('当前会话暂无内容'); return; }
      copyTextToClipboard(text).then(ok => toast(ok ? '已复制当前会话' : '复制失败，请检查浏览器剪贴板权限'));
    };
    const rpClearBtn = $('rpClearBtn'); if (rpClearBtn) rpClearBtn.onclick = async () => {
      if (!(await confirmModal('清空当前对话？'))) return;
      const sess = getCurrentSession();
      if (sess) sess.messages = [];
      state.aiMessages = sess ? sess.messages : [];
      save(); renderAILog(); renderSessionList(); toast('当前对话已清空');
    };

    // 写作技能 / 本地素材
    selectedSkillIds = (state.aiSkills && Array.isArray(state.aiSkills)) ? state.aiSkills.slice() : [];
    skillsReady = loadSkills();
    const skillBtn = $('skillBtn');
    if (skillBtn) skillBtn.onclick = e => { e.stopPropagation(); const m = $('skillMenu'); if (m) m.hidden = !m.hidden; };
    const skillBtn2 = $('skillBtn2');
    if (skillBtn2) skillBtn2.onclick = e => { e.stopPropagation(); const m = $('skillMenu2'); if (m) m.hidden = !m.hidden; };
    const skillBtnR = $('skillBtnR');
    if (skillBtnR) skillBtnR.onclick = e => {
      e.stopPropagation();
      const m = $('skillMenuR');
      if (!m) return;
      const opening = m.hidden;
      m.hidden = !opening;
      if (!opening) return;

      // The footer controls scroll horizontally and clip overflow vertically.
      // Float this menu against the viewport so it can expand above the footer.
      m.classList.add('skill-menu--floating');
      const rect = skillBtnR.getBoundingClientRect();
      const width = Math.min(280, Math.max(220, window.innerWidth - 24));
      const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12));
      const bottom = Math.max(12, window.innerHeight - rect.top + 8);
      m.style.width = width + 'px';
      m.style.left = left + 'px';
      m.style.right = 'auto';
      m.style.top = 'auto';
      m.style.bottom = bottom + 'px';
    };
    document.addEventListener('click', () => {
      ['skillMenu', 'skillMenu2', 'skillMenuR'].forEach(id => {
        const m = $(id);
        if (!m) return;
        m.hidden = true;
        if (id === 'skillMenuR') {
          m.classList.remove('skill-menu--floating');
          m.removeAttribute('style');
        }
      });
    });
    const loadFolderBtn = $('loadFolderBtn');
    if (loadFolderBtn) loadFolderBtn.onclick = () => openLocalImportChooser();
    const loadFolderBtn2 = $('loadFolderBtn2');
    if (loadFolderBtn2) loadFolderBtn2.onclick = () => openLocalImportChooser();
    const loadFolderBtnR = $('loadFolderBtnR');
    if (loadFolderBtnR) loadFolderBtnR.onclick = () => openLocalImportChooser();
    const localTagBtn = $('localTag');
    if (localTagBtn) localTagBtn.onclick = () => renderLocalPanel();
    const localTag2Btn = $('localTag2');
    if (localTag2Btn) localTag2Btn.onclick = () => renderLocalPanel();
    const localTagRBtn = $('localTagR');
    if (localTagRBtn) localTagRBtn.onclick = () => renderLocalPanel();
    updateSkillTag();

    // 历史版本
    const historyBtn = $('historyBtn'); if (historyBtn) historyBtn.onclick = openHistory;

    // 侧栏标签（设定集 / 资源 / 伏笔 / 大纲 / 章节目录 / AI续写 / AI检测）
    const sidebarTabs = $('sidebarTabs');
    if (sidebarTabs) sidebarTabs.onclick = e => { const b = e.target.closest('.sidebar-tab'); if (!b) return; switchSidebarTab(b.dataset.tab); };

    const sidebarHeaderActions = q('.sidebar-header__actions');
    if (sidebarHeaderActions) sidebarHeaderActions.addEventListener('click', event => {
      const button = event.target.closest('.sidebar-icon-btn');
      if (!button) return;
      const action = button.getAttribute('aria-label');
      if (action === '搜索章节') {
        switchSidebarTab('search');
        const searchInput = $('srSearch');
        if (searchInput) { searchInput.focus(); searchInput.select(); }
      } else if (action === '更多操作' && moreBtn) {
        event.stopPropagation();
        moreBtn.click();
      }
    });

    // 卷折叠
    const vol1 = $('vol1'); if (vol1) vol1.onclick = function (e) { if (e.target.closest('.ch-caret')) return; this.classList.toggle('is-collapsed'); };

    // 章节树交互
    const chapterList = $('chapterList');
    if (chapterList) chapterList.onclick = e => {
      // 侧栏内联删除按钮：删除指定章节 / 场景
      const delCh = e.target.closest('[data-del-chapter]');
      if (delCh) { e.preventDefault(); e.stopPropagation(); deleteChapter(delCh.getAttribute('data-del-chapter')); return; }
      const delSc = e.target.closest('[data-del-scene]');
      if (delSc) { e.preventDefault(); e.stopPropagation(); deleteScene(delSc.getAttribute('data-chapter'), delSc.getAttribute('data-del-scene')); return; }
      const row = e.target.closest('.chapter-row');
      const sceneRow = e.target.closest('.scene-row');
      if (sceneRow) {
        e.stopPropagation();
        const ch = currentChapter();
        const sc = ch.scenes.find(s => s.id === sceneRow.dataset.scene);
        if (sc) { invalidateAIRequests(); state.currentSceneId = sc.id; selTree = { type: 'scene', chapterId: ch.id, sceneId: sc.id }; renderTree(); renderEditor(); }
        return;
      }
      if (row) {
        const item = row.parentElement;
        if (e.target.closest('.ch-caret')) { item.classList.toggle('is-collapsed'); return; }
        qa('.chapter-item', chapterList).forEach(i => i.classList.remove('is-current'));
        item.classList.add('is-current');
        invalidateAIRequests();
        state.currentChapterId = item.getAttribute('data-chapter');
        selTree = { type: 'chapter', chapterId: state.currentChapterId };
        const firstScene = currentChapter().scenes[0];
        state.currentSceneId = firstScene.id;
        renderTree(); renderEditor();
        refreshDissectionContext(); // ★ 阶段3 · 侧栏普通切章也必须刷新拆书上下文
      }
    };

    // 新章节
    const chapterAdd = $('chapterAdd');
    if (chapterAdd) chapterAdd.onclick = createChapter;

    // 空状态：创建第一个章节（复用新建逻辑）
    const emptyCreateChapter = $('emptyCreateChapter');
    if (emptyCreateChapter) emptyCreateChapter.onclick = createChapter;

    // 侧栏工具：添加场景、打开搜索和设置。
    const sidebarToolbar = q('.sidebar-toolbar');
    if (sidebarToolbar) sidebarToolbar.addEventListener('click', event => {
      const button = event.target.closest('.toolbar__btn');
      if (!button) return;
      const label = button.textContent.trim();
      if (label.includes('添加Act')) addScene();
      else if (label.includes('编辑大纲') || label.includes('大纲设置')) switchTab('outline');
      else if (label.includes('筛选')) {
        switchSidebarTab('search');
        const scope = $('srScope');
        if (scope) scope.value = 'all';
        const searchInput = $('srSearch');
        if (searchInput) { searchInput.focus(); searchInput.select(); }
      } else if (label.includes('选项')) switchTab('settings');
    });

    // 编辑器输入 → 自动保存 + 字数
    if (editorContent) {
      editorContent.addEventListener('input', () => {
        const safe = setSceneContent(editorContent.innerHTML);
        if (editorContent.innerHTML !== safe) editorContent.innerHTML = safe;
        updateWordCount();
        debouncedSave();
      });
      // 记录光标位置（切换章节时恢复）
      editorContent.addEventListener('blur', saveCursor);
      editorContent.addEventListener('mouseup', saveCursor);
    }
    if (immersiveEditor) {
      immersiveEditor.addEventListener('input', () => {
        const safe = sanitizeEditorHtml(immersiveEditor.innerHTML);
        if (immersiveEditor.innerHTML !== safe) immersiveEditor.innerHTML = safe;
        if (editorContent) editorContent.innerHTML = safe;
        setSceneContent(safe);
        updateWordCount();
        debouncedSave();
      });
    }

    // 格式工具栏
    const formatBar = $('formatBar');
    if (formatBar) {
      formatBar.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        e.preventDefault();
        const cmd = b.dataset.cmd;
        if (cmd === 'insertImage') { insertImage(); return; }
        if (cmd === 'insertSeparator') { insertSeparator(); return; }
        if (editorContent) editorContent.focus();
        const val = b.dataset.val || null;
        if (cmd === 'formatBlock' && val) document.execCommand(cmd, false, val);
        else document.execCommand(cmd, false, null);
        if (editorContent) {
          setSceneContent(editorContent.innerHTML);
          updateWordCount();
          debouncedSave();
        }
      };
    }

    // 自动保存间隔
    setInterval(() => { if (state.settings.autosave) save({ snapshot: true }); }, 30000);

    // 右侧面板场景属性已迁移至设定集视图（renderSidebarSheji）

    // AI 助手面板：桌面使用右侧栏，窄屏用已有悬浮按钮打开抽屉。
    const aiFab = $('aiFab'); const aiPanel = $('aiPanel');
    const updateAIFab = () => {
      if (!aiFab) return;
      const mobile = isMobile();
      const panelOpen = rightPanel && rightPanel.classList.contains('is-open');
      aiFab.hidden = !mobile || panelOpen;
      aiFab.style.display = mobile && !panelOpen ? 'inline-flex' : 'none';
      if (mobile) aiFab.onclick = () => { rightPanel.classList.add('is-open'); updateAIFab(); updateBackdrop(); };
    };
    updateAIFab();
    window.addEventListener('resize', updateAIFab);
    if (aiPanel) aiPanel.style.display = 'none';
    const aiChatForm = $('aiChatForm');
    if (aiChatForm) aiChatForm.onsubmit = e => { e.preventDefault(); sendAIMessage($('aiChatInput') ? $('aiChatInput').value : ''); };
    renderAILog();

    // AI 工具栏
    initAIToolbar();
    // 剧情推演
    initPlot();
    // 聊天
    initChat();
    // 大纲可编辑
    initOutlineEdit();
    // 故事画布 / 时间线 工具栏
    initTimelineToolbar();
    // 设置
    initSettings();
    // 搜索替换面板事件
    initSearchReplace();
    // AI助手面板（会话管理 / 快捷指令 / 模型选择）
    initAIAssistantPanel();
    // 思考强度控制（随模型动态切换）
    renderThinkControl();
    // 三栏自由拖拽缩放
    initPanelResize();
    // 初次渲染空状态
    checkEmptyState();
    // 弹窗关闭 ESC + 保存/重做/搜索替换 快捷键
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { moreMenu && moreMenu.classList.remove('is-open'); closeModal(); if (q('.tab-view[data-view="immersive"].is-active')) switchTab('writing'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save({ snapshot: true }); toast('已保存'); }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'y') { e.preventDefault(); document.execCommand('redo'); }
      // Ctrl+H：唤起搜索替换面板
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        const searchTab = document.querySelector('.sidebar-tab[data-tab="search"]');
        if (searchTab) searchTab.click();
        setTimeout(() => { const srSearch = $('srSearch'); if (srSearch) srSearch.focus(); }, 100);
      }
      // Delete/Backspace：删除侧栏中最后选中的章节或场景（仅在侧栏树聚焦或非编辑区时生效，防误删）
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target || {}).tagName || '';
        const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
        const inSidebar = e.target && e.target.closest && e.target.closest('#chapterList');
        if (!isInput && (inSidebar || e.target === document.body)) {
          e.preventDefault();
          const sel = selTree || { type: 'chapter', chapterId: state.currentChapterId };
          if (sel.type === 'scene' && sel.sceneId) deleteScene(sel.chapterId, sel.sceneId);
          else if (sel.chapterId) deleteChapter(sel.chapterId);
        }
      }
    });

    lucide.createIcons();
  }

  /* ---------------- 章节/场景操作 ---------------- */
  /* 统一新建章节函数：在当前章节之后插入新章节 */
  function createChapter() {
    invalidateAIRequests();
    var vol = state.volumes[0];
    // 找到当前章节的插入位置（其后一位）
    var curIdx = vol.chapters.findIndex(c => c.id === state.currentChapterId);
    var insertIdx = curIdx >= 0 ? curIdx + 1 : vol.chapters.length;
    var id = 'c' + Date.now();
    var ch = { id: id, title: '', sub: '', scenes: [{ id: id + 's1', name: '场景一', content: '<p></p>' }] };
    vol.chapters.splice(insertIdx, 0, ch);
    // 重新编号所有章节标题
    renumberChapters();
    // 插入后新章标题已被 renumberChapters 更新，重新获取
    var inserted = vol.chapters[insertIdx];
    state.currentChapterId = inserted.id;
    state.currentSceneId = inserted.scenes[0].id;
    syncOutlineToChapters();
    recomputeChapterWords(); save(); renderTree(); renderEditor(); checkEmptyState();
    toast('已新建 ' + inserted.title);
  }
  /* 重新编号所有章节「第N章」+ 同步 outline */
  function renumberChapters() {
    var vol = state.volumes[0];
    vol.chapters.forEach(function(ch, i) {
      ch.title = '第' + (i + 1) + '章';
    });
    syncOutlineToChapters();
  }
  /* 确保 outline.chapters 与 volumes[0].chapters 索引 1:1 对齐 */
  function syncOutlineToChapters() {
    var vol = state.volumes[0];
    if (!Array.isArray(state.outline.chapters)) state.outline.chapters = [];
    // 补齐 outline
    while (state.outline.chapters.length < vol.chapters.length) {
      var i = state.outline.chapters.length;
      var vc = vol.chapters[i];
      state.outline.chapters.push({ num: vc.title, status: 'writing', title: vc.sub || '', synopsis: '', wordCount: 0, mark: '', storyline: '主线' });
    }
    // 裁剪 outline
    if (state.outline.chapters.length > vol.chapters.length) {
      state.outline.chapters.length = vol.chapters.length;
    }
    // 同步 num
    state.outline.chapters.forEach(function(c, i) { c.num = vol.chapters[i].title; });
  }
  function addScene() {
    invalidateAIRequests();
    const ch = currentChapter();
    const n = ch.scenes.length + 1;
    const id = ch.id + 's' + n + '_' + Date.now();
    ch.scenes.push({ id, name: chineseSceneNum(n), content: '<p></p>' });
    state.currentSceneId = id;
    recomputeChapterWords(); save(); renderTree(); renderEditor(); toast('已添加 ' + ch.scenes[ch.scenes.length - 1].name);
  }
  // 最后一次选中的树行（章节/场景），用于键盘删除键判断
  let selTree = { type: 'chapter', chapterId: null, sceneId: null };
  // 删除指定场景（按 id）
  async function deleteScene(chId, scId) {
    const ch = state.volumes[0].chapters.find(c => c.id === chId) || currentChapter();
    if (!ch) return;
    if (ch.scenes.length <= 1) { toast('至少保留一个场景'); return; }
    const sc = ch.scenes.find(s => s.id === scId);
    if (!sc) return;
    if (!(await confirmModal('确定删除场景「' + sc.name + '」？此操作不可撤销。'))) return;
    const idx = ch.scenes.findIndex(s => s.id === scId);
    if (idx < 0) return;
    ch.scenes.splice(idx, 1);
    if (state.currentSceneId === scId) state.currentSceneId = ch.scenes[0].id;
    // 重新编号剩余场景名
    ch.scenes.forEach((s, i) => { s.name = chineseSceneNum(i + 1); });
    selTree = { type: 'scene', chapterId: ch.id, sceneId: state.currentSceneId };
    recomputeChapterWords(); save(); renderTree(); renderEditor(); toast('已删除场景');
  }
  // 兼容：删除当前选中场景
  async function deleteCurrentScene() { return deleteScene(state.currentChapterId, state.currentSceneId); }
  // 中文数字工具（用于场景命名）
  function chineseSceneNum(n) {
    const cn = ['零','一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十'];
    return '场景' + (n >= 0 && n < cn.length ? cn[n] : String(n));
  }
  // 删除指定章节：移入回收站（可恢复），而非直接清除
  async function deleteChapter(id) {
    const vol = state.volumes[0];
    if (vol.chapters.length <= 1) { toast('至少保留一个章节'); return; }
    const ch = vol.chapters.find(c => c.id === id);
    if (!ch) return;
    if (!(await confirmModal('确定删除章节「' + ch.title + '」？可在回收站恢复。'))) return;
    const idx = vol.chapters.findIndex(c => c.id === id);
    if (idx < 0) return;
    const removed = vol.chapters.splice(idx, 1)[0];
    // 移入回收站保留元数据
    moveToRecycleBin(removed, 'chapter');
    // 切到被删除位置的那一章（或最后一章）
    var targetIdx = Math.min(idx, vol.chapters.length - 1);
    state.currentChapterId = vol.chapters[targetIdx].id;
    state.currentSceneId = vol.chapters[targetIdx].scenes[0].id;
    renumberChapters();
    selTree = { type: 'chapter', chapterId: state.currentChapterId };
    recomputeChapterWords(); save(); renderTree(); renderEditor(); checkEmptyState(); toast('已删除章节，可在回收站恢复');
  }
  // 兼容：删除当前选中章节
  async function deleteCurrentChapter() { return deleteChapter(state.currentChapterId); }

  /* ---------------- AI 消息发送（浮动面板 + 聊天共用） ---------------- */
  function appendMsg(container, role, text, streaming) {
    const d = document.createElement('div');
    d.className = 'ai-msg ai-msg--' + role;
    d.textContent = text || '';
    container.appendChild(d);
    container.scrollTop = container.scrollHeight;
    return d;
  }
  const AI_MESSAGE_STAGE_TEXT = {
    connecting: '正在连接模型…',
    skill_analysis: '正在分析 Skill…',
    writing: '正在生成正文…',
    humanizer: '正在整理正文…',
    thinking: '正在思考…'
  };
  function setAIMessageStage(index, stage) {
    const message = state.aiMessages && state.aiMessages[index];
    if (!message) return;
    message.stage = stage || '';
    message.stageText = AI_MESSAGE_STAGE_TEXT[stage] || (stage ? '正在处理…' : '');
    renderAILog();
  }
  function aiMessageDisplay(message) {
    const raw = String(message && message.text || '');
    if (raw && raw !== '思考中…') return { text: raw, pending: false };
    if (message && message.status === 'credit_exhausted') return { text: '积分已耗尽，生成已停止', pending: false };
    if (message && message.status === 'cancelled') return { text: '已停止生成', pending: false };
    if (message && message.status === 'interrupted') return { text: '上次生成已中断，请重试', pending: false };
    return {
      text: String(message && message.stageText || (message && message.thinking ? AI_MESSAGE_STAGE_TEXT.thinking : AI_MESSAGE_STAGE_TEXT.connecting)),
      pending: true
    };
  }
  function appendChatMessageContent(container, message) {
    if (!container || !message) return;
    if (message.role === 'bot' && Array.isArray(message.workflow) && message.workflow.length) {
      const workflow = document.createElement('div');
      workflow.className = 'chat-msg-workflow';
      const heading = document.createElement('strong');
      heading.textContent = '章节写作流程';
      workflow.appendChild(heading);
      message.workflow.forEach(item => {
        if (!item) return;
        const row = document.createElement('div');
        row.className = 'chat-msg-workflow__item chat-msg-workflow__item--' + String(item.status || 'running').replace(/[^a-z_]/g, '');
        const marker = document.createElement('span');
        marker.className = 'chat-msg-workflow__marker';
        marker.textContent = item.status === 'completed' ? '✓' : item.status === 'warning' ? '!' : item.status === 'failed' ? '×' : '·';
        const body = document.createElement('span');
        body.className = 'chat-msg-workflow__body';
        const title = document.createElement('b');
        title.textContent = item.label || item.key || '流程阶段';
        const detail = document.createElement('span');
        detail.textContent = item.text || '';
        body.appendChild(title);
        body.appendChild(detail);
        row.appendChild(marker);
        row.appendChild(body);
        workflow.appendChild(row);
      });
      container.appendChild(workflow);
    }
    if (message.role === 'bot' && message.skillAnalysis) {
      const analysis = document.createElement('div');
      analysis.className = 'chat-msg-skill-analysis';
      const label = document.createElement('strong');
      label.textContent = 'Skill 分析';
      const content = document.createElement('div');
      content.className = 'chat-msg-skill-analysis__body';
      content.textContent = message.skillAnalysis;
      analysis.appendChild(label);
      analysis.appendChild(content);
      container.appendChild(analysis);
    }
    if (message.role === 'bot' && message.thinking) {
      const details = document.createElement('details');
      details.className = 'chat-msg-thinking-panel';
      const summary = document.createElement('summary');
      summary.textContent = '模型推理';
      const thought = document.createElement('div');
      thought.className = 'chat-msg-thinking';
      thought.textContent = message.thinking;
      details.appendChild(summary);
      details.appendChild(thought);
      container.appendChild(details);
    }
    if (message.role === 'bot' && message.correctionAudit && message.correctionAudit.enabled) {
      const audit = document.createElement('div');
      audit.className = 'chat-msg-correction-audit';
      audit.style.cursor = 'pointer';
      audit.title = '点击打开纠错库深度审校面板';
      const findingCount = Number(message.correctionAudit.findingCount) || (Array.isArray(message.correctionAudit.findings) ? message.correctionAudit.findings.length : 0);
      audit.textContent = message.correctionAudit.status === 'passed'
        ? '通用纠错复核：通过（点击查看）'
        : '通用纠错复核：发现 ' + findingCount + ' 项待复核（点击查看明细）';
      audit.onclick = () => openChapterCorrectionModal(message.text, message.correctionAudit);
      container.appendChild(audit);
    }
    const body = document.createElement('div');
    const display = aiMessageDisplay(message);
    body.className = 'chat-msg-text' + (display.pending ? ' chat-msg-text--status' : '');
    body.textContent = display.text;
    container.appendChild(body);
  }
  let _aiLogScheduled = false;
  function renderAILog() {
    if (_aiLogScheduled) return;
    _aiLogScheduled = true;
    requestAnimationFrame(() => { _aiLogScheduled = false; renderAILogNow(); });
  }
  function formatCreditCost(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }
  function attachUsageToMessage(index, usage) {
    const msg = state.aiMessages && state.aiMessages[index];
    if (!msg) return;
    msg.usage = usage || null;
    msg.creditCost = usage && usage.creditCost != null ? Number(usage.creditCost) : null;
    msg.usageStatus = usage && usage.status ? usage.status : 'usage_unavailable';
    msg.correctionAudit = usage && usage.correctionAudit
      ? usage.correctionAudit
      : usage && usage.skillAudit && usage.skillAudit.correctionAudit
        ? usage.skillAudit.correctionAudit
        : null;
  }
  const AI_TASK_STATUS_LABELS = {
    queued: '排队中', running: '进行中', completed: '已完成', cancelled: '已取消',
    failed: '失败', interrupted: '等待恢复', truncated: '达到输出上限', credit_exhausted: '积分耗尽'
  };
  const activeAITaskControllers = new Map();
  function taskStatusLabel(status) { return AI_TASK_STATUS_LABELS[status] || status || '未完成'; }
  function createAITask(title, model, target, retry) {
    ensureAdvancedState();
    const task = {
      id: uid('task'), title: title || 'AI任务', model: model || currentAIPanelModel(), target: target || 'chat',
      status: 'running', progress: 4, stage: '正在准备请求', estimatedCredits: null, creditCost: null,
      createdAt: Date.now(), updatedAt: Date.now(), retry: retry || null
    };
    state.aiTasks.unshift(task);
    if (state.aiTasks.length > 40) state.aiTasks = state.aiTasks.slice(0, 40);
    renderAITaskProgress();
    persist();
    return task;
  }
  // 页面刷新、切换设备或上次网络中断后，浏览器无法继续持有原 AbortController。
  // 将遗留的运行中任务和占位消息标记为可重试，避免永久停留在“思考中…”。
  function recoverInterruptedAITasks() {
    ensureAdvancedState();
    const interruptedIds = new Set();
    let changed = false;
    (state.aiTasks || []).forEach(task => {
      if (!task || !['queued', 'running'].includes(task.status)) return;
      task.status = 'interrupted';
      task.stage = '页面刷新或连接中断，可重新尝试';
      task.updatedAt = Date.now();
      interruptedIds.add(task.id);
      changed = true;
    });
    const seen = new Set();
    const sessions = Array.isArray(state.chatSessions) ? state.chatSessions : [];
    sessions.forEach(session => {
      (session.messages || []).forEach(message => {
        if (message) seen.add(message);
      });
    });
    (state.aiMessages || []).forEach(message => {
      if (message) seen.add(message);
    });
    seen.forEach(message => {
      const isStale = message.pending || (message.taskId && interruptedIds.has(message.taskId));
      if (!isStale || !message.text || !String(message.text).trim()) return;
      message.pending = false;
      message.status = 'interrupted';
      message.finishReason = 'interrupted';
      if (message.text === '思考中…') message.text = '⚠️ 上次生成未完成，请在任务时间线中重试';
      else if (!String(message.text).includes('上次生成已中断')) message.text += '\n\n⚠️ 上次生成已中断，请检查内容后重试';
      changed = true;
    });
    if (changed) persist();
    return changed;
  }
  function updateAITask(task, patch) {
    if (!task || !state || !Array.isArray(state.aiTasks) || !state.aiTasks.some(item => item === task || item.id === task.id)) return;
    Object.assign(task, patch || {}, { updatedAt: Date.now() });
    renderAITaskProgress();
  }
  function updateAITaskBilling(task, billing) {
    if (!task || !billing) return;
    const reserved = Number(billing.reservedCost);
    const estimated = Number(billing.estimatedCreditCost);
    const progress = Number.isFinite(reserved) && reserved > 0 && Number.isFinite(estimated)
      ? Math.min(96, Math.max(5, Math.round((estimated / reserved) * 100))) : task.progress;
    const skillNote = billing.skillForwardingStatus === 'verified'
      ? ' · Skill 已验证' + (Number(billing.skillForwardedFileCount) > 0 ? ' · ' + Number(billing.skillForwardedFileCount) + ' 个文件' : '')
      : '';
    updateAITask(task, {
      progress,
      estimatedCredits: Number.isFinite(estimated) ? estimated : task.estimatedCredits,
      stage: billing.status === 'credit_exhausted' ? '积分已耗尽，正在停止' : '生成中 · 已实时计费' + skillNote
    });
  }
  function finishAITask(task, reason, usage, extra) {
    if (!task || !state || !Array.isArray(state.aiTasks) || !state.aiTasks.some(item => item === task || item.id === task.id)) return;
    const status = reason === 'credit_exhausted' ? 'credit_exhausted' : reason === 'abort' ? 'cancelled' : reason === 'length' ? 'truncated' : (reason ? 'failed' : 'completed');
    const forwarding = usage && usage.skillAudit && usage.skillAudit.forwarding;
    const skillNote = forwarding && forwarding.status === 'verified'
      ? ' · Skill 已验证' + (Array.isArray(forwarding.skills) ? ' · ' + forwarding.skills.reduce((total, skill) => total + (Array.isArray(skill && skill.forwardedTextFiles) ? skill.forwardedTextFiles.length : 0), 0) + ' 个文件' : '')
      : '';
    updateAITask(task, Object.assign({
      status, progress: status === 'completed' ? 100 : task.progress,
      stage: taskStatusLabel(status) + skillNote, creditCost: usage && usage.creditCost != null ? Number(usage.creditCost) : task.creditCost,
      skillForwardingStatus: forwarding && forwarding.status ? forwarding.status : 'not-recorded',
      correctionAudit: usage && (usage.correctionAudit || (usage.skillAudit && usage.skillAudit.correctionAudit)) || null,
      usage: usage || null, endedAt: Date.now()
    }, extra || {}));
    activeAITaskControllers.delete(task.id);
    persist();
  }
  function bindAITaskController(task, controller) {
    if (task && controller) activeAITaskControllers.set(task.id, controller);
  }
  function cancelAITask(id) {
    const task = (state.aiTasks || []).find(t => t.id === id);
    if (!task || !['queued', 'running'].includes(task.status)) return;
    const ctl = activeAITaskControllers.get(id);
    if (ctl && typeof ctl.abort === 'function') ctl.abort();
    updateAITask(task, { status: 'cancelled', stage: '正在停止', progress: task.progress });
    toast('已请求停止「' + task.title + '」');
  }
  function retryAITask(id) {
    const task = (state.aiTasks || []).find(t => t.id === id);
    if (!task || !task.retry) return;
    const retry = task.retry;
    if (retry.kind === 'chat' && retry.text) submitAIMessage(retry.text, retry.outputTarget || task.target);
    else if (retry.kind === 'quick' && retry.action) runQuickAction(retry.action);
    else if (retry.kind === 'nextChapter') generateNextChapter();
    else if (retry.kind === 'streamInsert') streamInsertContinue();
    else if (retry.kind === 'consistency') runConsistencyCheck();
    else if (retry.kind === 'audit') openAiAuditModal();
    else if (retry.kind === 'extract' && retry.text) extractEntitiesFromText(retry.text, retry.label || '文本');
    else if (retry.kind === 'extractKnowledge') extractKnowledge();
    else if (retry.kind === 'tool' && retry.name && retry.text) showAIToolResult(retry.name, retry.system || '', retry.text, retry.model);
    else if (retry.kind === 'report') runAIChapterReport();
    else if (retry.kind === 'plot') runPlotBranch(null, retry.index, retry.model);
    else if (retry.kind === 'rewrite' && retry.reportId) {
      const report = (state.aiReports || []).find(x => x.id === retry.reportId);
      if (report) { const modal = openModal('<h3 class="ml-modal__title">去 AI 味</h3><div id="aiReportBody"></div>', { wide: true }); rewriteAIReport(report.id, modal); }
    }
  }
  function renderAITaskProgress() {
    const el = $('aiTaskProgress');
    if (!el) return;
    const tasks = (state.aiTasks || []).slice(0, 6);
    if (!tasks.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<div class="rp-task-progress__head"><span>任务时间线</span><button type="button" class="rp-task-clear" id="aiTaskClear">清理已完成</button></div>' + tasks.map(task => {
      const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
      const active = task.status === 'running' || task.status === 'queued';
      const retryable = !active && task.retry && ['failed', 'cancelled', 'credit_exhausted', 'interrupted'].includes(task.status);
      const cost = task.creditCost != null ? '消耗 ' + formatCreditCost(task.creditCost) + ' 积分' : (task.estimatedCredits != null ? '预计 ' + formatCreditCost(task.estimatedCredits) + ' 积分' : '积分实时结算');
      return '<div class="rp-task" data-task-id="' + esc(task.id) + '">' +
        '<div class="rp-task__top"><strong>' + esc(task.title) + '</strong><span class="rp-task__status rp-task__status--' + esc(task.status) + '">' + esc(taskStatusLabel(task.status)) + '</span></div>' +
        '<div class="rp-task__stage">' + esc(task.stage || '') + '<span>' + esc(cost) + '</span></div>' +
        '<div class="rp-task__bar"><i style="width:' + progress + '%"></i></div>' +
        '<div class="rp-task__actions">' + (active ? '<button type="button" data-task-cancel="' + esc(task.id) + '">停止</button>' : '') + (retryable ? '<button type="button" data-task-retry="' + esc(task.id) + '">重试</button>' : '') + '</div>' +
        '</div>';
    }).join('');
    const clear = $('aiTaskClear');
    if (clear) clear.onclick = () => { state.aiTasks = (state.aiTasks || []).filter(t => ['running', 'queued'].includes(t.status)); renderAITaskProgress(); save(); };
    el.querySelectorAll('[data-task-cancel]').forEach(btn => btn.onclick = () => cancelAITask(btn.dataset.taskCancel));
    el.querySelectorAll('[data-task-retry]').forEach(btn => btn.onclick = () => retryAITask(btn.dataset.taskRetry));
  }
  function forkAISession(messageIndex) {
    getCurrentSession();
    const source = (state.aiMessages || []).slice(0, messageIndex + 1).map(m => Object.assign({}, m));
    const base = source.find(m => m.role === 'user');
    const sess = { id: 'sess_' + Date.now().toString(36), title: '分叉 · ' + ((base && base.text) || '新对话').replace(/[\r\n]+/g, ' ').slice(0, 18), messages: source };
    state.chatSessions.push(sess);
    state.currentSessionId = sess.id;
    state.aiMessages = sess.messages;
    save(); renderAILog(); renderRightPanel(); renderSessionList();
    toast('已从当前回复创建分叉会话');
  }
  function openAIDiffModal(source, revised) {
    const changes = diffLines(source || '', revised || '');
    const html = '<h3 class="ml-modal__title">AI 输出差异</h3><p class="ml-modal__hint">新增、删除和保留内容按句子显示，确认后再写入正文。</p><div class="diff-legend"><span class="diff-add">新增</span><span class="diff-del">删除</span><span class="diff-eq">保留</span></div><div class="diff-body">' + changes.map(x => '<div class="diff-l diff-' + x.t + '">' + (x.t === 'add' ? '+ ' : x.t === 'del' ? '- ' : '  ') + esc(x.s) + '</div>').join('') + '</div>';
    openModal(html, { wide: true });
  }
  function applyAIOutputTarget(message) {
    if (!message || message.targetApplied || !message.text || message.text === '思考中…') return;
    const target = message.outputTarget || 'chat';
    if (target === 'setting') {
      message.knowledgeSaved = saveAIGeneratedKnowledge(message.action || 'setting', message.text);
      message.targetApplied = true;
    } else if (target === 'outline') {
      ensureOutlineChapters();
      const outline = currentOutlineChapter();
      if (outline) { outline.synopsis = message.text.trim(); outline.status = 'writing'; }
      message.targetApplied = true;
      save(); renderOutline(); renderSidebarOutline();
    } else if (target === 'foreshadow') {
      ensureAdvancedState();
      const item = { id: uid('fs'), title: 'AI生成伏笔 · ' + ((currentChapter() || {}).title || '当前章节'), description: message.text.trim(), status: 'planned', strength: 'medium', plantedChapterId: state.currentChapterId || '', targetChapterId: '', resolvedChapterId: '', clues: [], relatedEntityIds: [], notes: '由 AI 对话生成，待作者补充回收章节。' };
      normalizeForeshadow(item); state.foreshadows.unshift(item); message.targetApplied = true;
      save(); renderSidebarForeshadow();
    }
  }
  // ★ S4：人工审批状态标签（待确认 / 已采纳 / 已拒绝 / 返工中）
  function approvalStatusLabel(approval) {
    if (approval === 'accepted') return '已采纳';
    if (approval === 'rejected') return '已拒绝';
    if (approval === 'rewrite') return '返工中';
    return '待确认';
  }
  // 渲染AI消息到各消息容器（浮动面板 / 聊天标签 / 右侧AI助手面板）
  function renderAILogNow() {
    const msgs = state.aiMessages || [];
    // 旧浮动面板（已隐藏，保持兼容）
    const f = $('aiMessages');
    if (f) { f.innerHTML = ''; msgs.forEach(m => appendMsg(f, m.role, m.text)); f.scrollTop = f.scrollHeight; }
    // 聊天标签页
    const c = q('.chat-content');
    if (c) {
      c.innerHTML = '';
      msgs.forEach(m => { const d = document.createElement('div'); d.className = 'chat-msg chat-msg--' + m.role; appendChatMessageContent(d, m); c.appendChild(d); });
      if (c.parentElement) c.parentElement.scrollTop = c.parentElement.scrollHeight;
    }
    // 右侧AI助手面板消息区
    const cm = $('aiChatMessages');
    if (cm) {
      cm.innerHTML = '';
      msgs.forEach((m, i) => {
        const d = document.createElement('div');
        d.className = 'ai-chat-msg ai-chat-msg--' + (m.role === 'user' ? 'user' : 'bot');
        appendChatMessageContent(d, m);
        cm.appendChild(d);
        // bot消息追加操作栏（排除"思考中…"占位与错误消息）
        if (m.role === 'bot' && m.text && m.text !== '思考中…' && !m.text.startsWith('⚠️')) {
          var actions = document.createElement('div');
          actions.className = 'ai-msg-actions';
          var actionHtml =
            '<button class="ai-msg-action-btn" data-act="copy" data-idx="' + i + '">复制</button>' +
            '<button class="ai-msg-action-btn" data-act="regen" data-idx="' + i + '">重新生成</button>' +
            '<button class="ai-msg-action-btn" data-act="fork" data-idx="' + i + '">分叉会话</button>';
          if (m.finishReason === 'length') {
            actionHtml += '<span class="ai-msg-action-status">已达到输出长度上限</span><button class="ai-msg-action-btn" data-act="continue" data-idx="' + i + '">继续生成</button>';
          } else if (m.finishReason === 'credit_exhausted') {
            actionHtml += '<span class="ai-msg-action-status">积分已耗尽，已停止生成</span><button class="ai-msg-action-btn ai-msg-action-btn--primary" data-act="continue" data-idx="' + i + '">补充积分后继续</button>';
          }
          if (m.sourceText && m.sourceText.trim()) actionHtml += '<button class="ai-msg-action-btn" data-act="diff" data-idx="' + i + '">查看差异</button>';
          if (m.action === 'nextChapter') {
            if (m.pending) {
              actionHtml += '<span class="ai-msg-action-status">正在生成下一章…</span>';
            } else if (m.finishReason === 'material_overlap') {
              actionHtml += '<span class="ai-msg-action-status">人物素材原创性审计未通过，已阻止写入</span>';
            } else if (m.committed) {
              actionHtml += '<span class="ai-msg-action-status ai-msg-action-status--success">已写入正文</span>';
            } else {
              actionHtml += '<button class="ai-msg-action-btn ai-msg-action-btn--primary" data-act="insertNextChapter" data-idx="' + i + '">' + (m.partial ? '写入已生成内容' : '写入下一章') + '</button>';
            }
          } else if (m.action === 'character' || m.action === 'setting' || m.outputTarget === 'setting') {
            actionHtml += m.knowledgeSaved
              ? '<span class="ai-msg-action-status ai-msg-action-status--success">已保存到设定集</span><button class="ai-msg-action-btn" data-act="viewSetting" data-idx="' + i + '">查看设定集</button>'
              : '<button class="ai-msg-action-btn ai-msg-action-btn--primary" data-act="saveSetting" data-idx="' + i + '">保存到设定集</button>';
          } else if (m.outputTarget === 'outline') {
            actionHtml += m.targetApplied
              ? '<span class="ai-msg-action-status ai-msg-action-status--success">已保存到当前章节蓝图</span><button class="ai-msg-action-btn" data-act="viewOutline" data-idx="' + i + '">查看蓝图</button>'
              : '<button class="ai-msg-action-btn ai-msg-action-btn--primary" data-act="saveOutline" data-idx="' + i + '">保存到章节蓝图</button>';
          } else if (m.outputTarget === 'foreshadow') {
            actionHtml += m.targetApplied
              ? '<span class="ai-msg-action-status ai-msg-action-status--success">已记录到伏笔台账</span><button class="ai-msg-action-btn" data-act="viewForeshadow" data-idx="' + i + '">查看伏笔</button>'
              : '<button class="ai-msg-action-btn ai-msg-action-btn--primary" data-act="saveForeshadow" data-idx="' + i + '">保存为伏笔</button>';
          } else if (m.finishReason === 'material_overlap') {
            actionHtml += '<span class="ai-msg-action-status">人物素材原创性审计未通过，已阻止插入</span>';
          } else if (m.outputTarget === 'body') {
            actionHtml += '<button class="ai-msg-action-btn ai-msg-action-btn--primary" data-act="insert" data-idx="' + i + '">确认插入正文</button>';
          } else {
            actionHtml += '<button class="ai-msg-action-btn" data-act="insert" data-idx="' + i + '">插入到正文</button>';
          }
          actionHtml += '<button class="ai-msg-action-btn ai-msg-feedback' + (m.feedback === 'up' ? ' is-active' : '') + '" data-act="feedback" data-feedback="up" data-idx="' + i + '">有帮助</button><button class="ai-msg-action-btn ai-msg-feedback' + (m.feedback === 'down' ? ' is-active' : '') + '" data-act="feedback" data-feedback="down" data-idx="' + i + '">需改进</button>';
          // ★ S4：人工审批状态机（DeterminFlow Approval Node 轻量版）
          actionHtml += '<span class="ai-msg-action-status ai-msg-approval ai-msg-approval--' + esc(m.approval || 'pending') + '">' + approvalStatusLabel(m.approval) + '</span>';
          if ((m.approval || 'pending') !== 'accepted') actionHtml += '<button class="ai-msg-action-btn ai-msg-action-btn--primary" data-act="approve" data-idx="' + i + '">采纳</button>';
          if ((m.approval || 'pending') !== 'rejected' && (m.approval || 'pending') !== 'rewrite') actionHtml += '<button class="ai-msg-action-btn" data-act="reject" data-idx="' + i + '">拒绝</button>';
          if ((m.approval || 'pending') === 'rejected' || (m.approval || 'pending') === 'rewrite') actionHtml += '<button class="ai-msg-action-btn" data-act="regen" data-idx="' + i + '">返工重写</button>';
          actionHtml += '<span class="ai-msg-cost">共消耗 <strong>✧ ' + formatCreditCost(m.creditCost) + '</strong></span>';
          actions.innerHTML = actionHtml;
          cm.appendChild(actions);
        }
      });
      // 绑定操作栏事件（事件委托）
      cm.onclick = function(e) {
        var btn = e.target.closest('.ai-msg-action-btn');
        if (!btn) return;
        var idx = parseInt(btn.dataset.idx);
        var msg = msgs[idx];
        if (!msg) return;
        var act = btn.dataset.act;
        if (act === 'copy') {
          copyTextToClipboard(msg.text || '').then(function(ok) { toast(ok ? '已复制' : '复制失败，请检查浏览器剪贴板权限'); });
        } else if (act === 'continue') {
          continueLastAI();
        } else if (act === 'fork') {
          forkAISession(idx);
        } else if (act === 'diff') {
          openAIDiffModal(msg.sourceText || '', msg.text || '');
        } else if (act === 'feedback') {
          msg.feedback = btn.dataset.feedback || '';
          save(); renderAILogNow();
        } else if (act === 'viewSetting') {
          switchSidebarTab('sheji');
        } else if (act === 'viewOutline') {
          switchSidebarTab('dagang');
          } else if (act === 'viewForeshadow') {
            switchSidebarTab('foreshadow');
          } else if (act === 'saveSetting' || act === 'saveOutline' || act === 'saveForeshadow') {
            applyAIOutputTarget(msg);
            msg.approval = msg.approval || 'accepted';
            save();
            renderAILogNow();
          } else if (act === 'approve') {
            if (msg.finishReason === 'material_overlap') { toast('人物素材原创性审计未通过，不能采纳或写入'); return; }
            // ★ S4：采纳——若该回复带落点目标且尚未应用，则一并应用
            msg.approval = 'accepted';
            if (!msg.targetApplied && msg.outputTarget && msg.text) {
              applyAIOutputTarget(msg);
              if (msg.targetApplied) save();
            }
            save();
            renderAILogNow();
            toast('已采纳该回复' + (msg.targetApplied ? '，并已应用到对应位置' : ''));
          } else if (act === 'reject') {
            msg.approval = 'rejected';
            save();
            renderAILogNow();
            toast('已拒绝该回复，可在消息上选择「返工重写」');
          } else if (act === 'regen') {
          // 找到上一条user消息
          var userMsg = null;
          for (var j = idx - 1; j >= 0; j--) { if (msgs[j].role === 'user') { userMsg = msgs[j].text; break; } }
          if (userMsg) {
            // 删除当前bot消息和对应的user消息
            msgs.splice(idx, 1);
            if (userMsg) { var uIdx = msgs.findIndex(function(m2, i2) { return i2 < idx && m2.role === 'user' && m2.text === userMsg; }); if (uIdx >= 0) msgs.splice(uIdx, 1); }
            renderAILog();
            // 重新发送：若为快捷指令消息则走 runQuickAction，否则走普通对话
            if (userMsg.startsWith('【')) {
              var am = userMsg.match(/【(.+?)】/);
              if (am) {
                var an = am[1];
                for (var k in QUICK_ACTION_PROMPTS) {
                  if (QUICK_ACTION_PROMPTS[k].name === an) { runQuickAction(k); return; }
                }
              }
            }
            submitAIMessage(userMsg);
          }
        } else if (act === 'insert') {
          if (msg.finishReason === 'material_overlap') { toast('人物素材原创性审计未通过，不能插入正文'); return; }
          insertTextToEditor(msg.text || '');
        } else if (act === 'insertNextChapter') {
          if (msg.pending || msg.committed || msg.finishReason === 'material_overlap') return;
          commitGeneratedChapter(msg.text || '', msg.nextChapter, msg).then(function(ok) {
            if (ok) {
              msg.committed = true;
              save();
              renderAILogNow();
            }
          });
        }
      };
      cm.scrollTop = cm.scrollHeight;
    }
    // 渲染上下文预览摘要
    renderContextPreview();
    renderAITaskProgress();
  }

  /* 渲染上下文预览摘要：显示当前发送给AI的上下文包含哪些模块和总字数
   * 字数采用 countWords 统计（中文字 + 西文词），并展示技能/素材/知识库实体数量，
   * 帮助作者直观判断AI是否已携带足够的设定信息。
   */
  function renderContextPreview() {
    var el = $('aiCtxPreview');
    if (!el) return;
    var dynamic = buildDynamicContext();
    var ctx = dynamic.text;
    var meta = dynamic.meta || lastContextMeta;
    var modules = meta.blocks || [];
    var kgLen = entList().length;
    var edgeLen = (state.knowledge && state.knowledge.edges) ? state.knowledge.edges.length : 0;
    var skillLen = effectiveSkillIds().length;
    var matLen = localMaterial.filter(function(m) { return m.include && m.text && m.text.trim(); }).length;
    var inspLen = (state.inspirations || []).filter(function(i) { return i.enabled && (i.content || i.title); }).length;
    var summary = '📋 作品上下文 · ' + (meta.used || ctx.length) + '/' + meta.budget + '字 · 动态召回';
    var extras = [];
    if (edgeLen) extras.push('关系' + edgeLen);
    if (skillLen) extras.push('技能' + skillLen);
    if (matLen) extras.push('素材' + matLen);
    if (inspLen) extras.push('灵感' + inspLen);
    if (extras.length) summary += ' · ' + extras.join('·');
    var html = '<div class="rp-ctx-preview__head" id="aiCtxToggle">' + summary + '</div>';
    html += '<div class="rp-ctx-preview__body" id="aiCtxBody" hidden>';
    html += '<div class="rp-ctx-budget"><span>作品上下文</span><strong>' + (meta.truncated ? '已按预算截断' : '按任务召回') + '</strong></div>';
    html += modules.map(function(m) { return '<span class="rp-ctx-tag">' + esc(m) + '</span>'; }).join('');
    if (kgLen) html += '<div class="rp-ctx-note">知识库共 ' + kgLen + ' 条实体 · 本次召回 ' + (meta.entities || []).length + ' 条 · 关系按关联实体筛选</div>';
    html += '<div class="rp-ctx-note">优先发送当前章节、邻近蓝图、相关设定、伏笔与资料，减少无关内容对正文质量的干扰。</div>';
    html += '</div>';
    el.innerHTML = html;
    var toggle = $('aiCtxToggle');
    if (toggle) toggle.onclick = function() {
      var body = $('aiCtxBody');
      if (body) body.hidden = !body.hidden;
    };
  }
  /* 构建完整对话历史消息数组（用于 API 调用时携带上下文） */
  function buildChatHistory() {
    var msgs = state.aiMessages || [];
    // 过滤掉“思考中…”占位消息和空消息
    var valid = msgs.filter(function(m) {
      return m.text && m.text.trim() && m.text !== '思考中…';
    });
    // 不再按条数筛选，完整保留当前会话历史。
    return valid.map(function(m) {
      return { role: m.role === 'bot' ? 'assistant' : 'user', content: m.text };
    });
  }
  // 提交AI消息：推入消息队列并流式调用接口
  async function submitAIMessage(text, outputTargetOverride) {
    text = (text || '').trim(); if (!text) return;
    const requestSession = sessionIdentity();
    collapseQuickStart(); // 开始对话后收缩「快速开始」，把空间让给对话区
    ensureAdvancedState();
    const allowedTargets = new Set(['chat', 'body', 'setting', 'outline', 'foreshadow']);
    const selectedTarget = outputTargetOverride && allowedTargets.has(outputTargetOverride) ? outputTargetOverride : null;
    const outputTarget = selectedTarget || ($('aiOutputTarget') ? $('aiOutputTarget').value : (state.aiOutputTarget || 'chat'));
    state.aiOutputTarget = outputTarget;
    const model = currentUnifiedModel();
    const characterMaterial = outputTarget === 'body'
      ? buildCharacterMaterialRequest(text, { proseTask: true })
      : { enabled: false, proseTask: false };
    getCurrentSession();
    const requestTarget = captureAITarget();
    const sys = await buildSystemReady('你是一位专业的中文网络小说写作助手，擅长构思情节、生成正文与设定，与作者讨论剧情与大纲。', text);
    if (!sys || sessionIdentity() !== requestSession || !isCurrentAITarget(requestTarget)) return;
    const task = createAITask('AI对话', model, outputTarget, { kind: 'chat', text: text });
    getCurrentSession(); // 确保会话已初始化，state.aiMessages 指向当前会话
    state.aiMessages = state.aiMessages || [];
    state.aiMessages.push({ role: 'user', text });
    // 会话标题自动推导：首次发送消息时以消息前15字更新标题
    var sess = getCurrentSession();
    if (sess && (sess.title === '默认会话' || (sess.title.indexOf('新对话') === 0))) {
      sess.title = text.slice(0, 15) + (text.length > 15 ? '…' : '');
      renderRightPanel();
      renderSessionList();
    }
    state.aiMessages.push({ role: 'bot', text: '思考中…', thinking: '', skillAnalysis: '', taskId: task.id, outputTarget: outputTarget });
    var botMsgIndex = state.aiMessages.length - 1;
    renderAILog();
    let botText = '思考中…';
    var history = buildChatHistory(10);
    // 移除最后一条（刚推入的当前用户消息），避免重复
    if (history.length > 0) history.pop();
    var messages = [{ role: 'system', content: sys }].concat(history).concat([{ role: 'user', content: text }]);
    try {
      await streamSkillPipeline({ model: model, thinking: state.settings.think, analyzeSkill: outputTarget === 'body', humanize: outputTarget === 'body', correction: outputTarget === 'body', skillMode: outputTarget === 'body' ? 'write' : undefined, characterMaterial, messages: messages }, {
      onStage: stage => { if (isCurrentAITarget(requestTarget)) { setAIMessageStage(botMsgIndex, stage); updateAITask(task, { stage: stage === 'skill_analysis' ? '正在分析已选 Skill' : stage === 'humanizer' ? '正在执行 humanizer 后处理' : stage === 'writing' ? '正在生成正文' : '正在连接模型' }); } },
      onStart: c => { if (!isCurrentAITarget(requestTarget)) return; chatCtl = c; bindAITaskController(task, c); setAIMessageStage(botMsgIndex, 'connecting'); updateAITask(task, { stage: '正在连接模型', progress: 8 }); setAIStopState(true); },
      onBilling: billing => { if (isCurrentAITarget(requestTarget)) updateAITaskBilling(task, billing); },
      onThink: t => {
        if (!isCurrentAITarget(requestTarget)) return;
        const message = state.aiMessages[botMsgIndex];
        if (message) {
          message.thinking = (message.thinking || '') + t;
          message.stageText = AI_MESSAGE_STAGE_TEXT.thinking;
          renderAILog();
        }
      },
      onSkillAnalysisDelta: t => {
        if (!isCurrentAITarget(requestTarget)) return;
        const message = state.aiMessages[botMsgIndex];
        if (message) {
          message.skillAnalysis = (message.skillAnalysis || '') + t;
          message.stageText = AI_MESSAGE_STAGE_TEXT.skill_analysis;
          renderAILog();
        }
      },
      onReplaceText: text => {
        if (!isCurrentAITarget(requestTarget)) return;
        botText = String(text || '');
        const last = state.aiMessages[botMsgIndex];
        if (last) { last.text = botText; last.stageText = ''; }
        renderAILog();
      },
      onDelta: d => { if (!isCurrentAITarget(requestTarget)) return; if (botText === '思考中…') botText = ''; botText += d; const last = state.aiMessages[botMsgIndex]; if (last) { last.text = botText; last.stageText = ''; } renderAILog(); },
      onDone: (reason, usage) => {
        if (!isCurrentAITarget(requestTarget)) return;
        const message = state.aiMessages[botMsgIndex];
        if (!String(botText || '').trim() || botText === '思考中…') {
          botText = reason === 'abort' ? '已停止生成' : reason === 'credit_exhausted' ? '积分已耗尽，生成已停止' : reason === 'length' ? '已达到输出长度上限，但模型未返回正文，请重试' : message && message.thinking ? '模型已返回思考过程，但没有返回正文，请重试' : '模型未返回正文，请重试';
        }
        if (message) {
          message.finishReason = reason || '';
          message.partial = ['abort', 'length', 'credit_exhausted', 'material_overlap'].includes(reason);
          message.status = reason === 'material_overlap' ? 'material_overlap' : reason === 'credit_exhausted' ? 'credit_exhausted' : reason === 'abort' ? 'cancelled' : reason === 'length' ? 'truncated' : 'completed';
          message.text = botText;
          message.stageText = '';
        }
        attachUsageToMessage(botMsgIndex, usage); finishAITask(task, reason, usage, { resultExcerpt: botText.slice(0, 180) });
        chatCtl = null; setAIStopState(false); save(); logAICall('AI聊天', model, usage, botText); renderAILogNow();
      },
      onError: (e, meta) => {
        if (!isCurrentAITarget(requestTarget)) return;
        chatCtl = null; setAIStopState(false);
        const fallbackText = meta && meta.partialText ? String(meta.partialText) : '';
        botText = fallbackText || ('⚠️ ' + e);
        const last = state.aiMessages[botMsgIndex];
        if (last) {
          last.text = botText;
          last.stageText = '';
          last.finishReason = meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : '';
          last.status = fallbackText ? 'completed_with_fallback' : meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'failed';
        }
        finishAITask(task, meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', null, { error: String(e) });
        renderAILog(); save();
        if (fallbackText) toast('humanizer 后处理失败，已保留写作初稿');
      }
      });
    } catch (error) {
      if (!isCurrentAITarget(requestTarget)) return;
      chatCtl = null; setAIStopState(false);
      const message = state.aiMessages[botMsgIndex];
      if (message) { message.text = '⚠️ ' + (error && error.message || error); message.stageText = ''; message.status = 'failed'; }
      finishAITask(task, 'error', null, { error: String(error && error.message || error) });
      renderAILog(); save();
    } finally {
      if (isCurrentAITarget(requestTarget) && chatCtl) { chatCtl = null; setAIStopState(false); }
    }
  }
  // 发送AI消息：清空输入框并调用流式接口
  function sendAIMessage(text) {
    if ($('aiChatInput')) $('aiChatInput').value = '';
    submitAIMessage(text);
  }

  /* ===================== AI助手面板：会话管理 =====================
   * state.chatSessions 存储多个会话，每个会话 {id, title, messages: []}
   * state.currentSessionId 跟踪当前会话
   * state.aiMessages 始终引用当前会话的 messages 数组，保证自动同步
   * ------------------------------------------------------------------ */
  // 获取当前会话：不存在时创建默认会话并迁移现有消息
  function getCurrentSession() {
    if (!state.chatSessions) state.chatSessions = [];
    if (!state.currentSessionId || !state.chatSessions.find(s => s.id === state.currentSessionId)) {
      const sess = { id: 'sess_' + Date.now().toString(36), title: '默认会话', messages: state.aiMessages || [] };
      state.chatSessions.push(sess);
      state.currentSessionId = sess.id;
      state.aiMessages = sess.messages; // 使 state.aiMessages 指向会话的 messages
    }
    return state.chatSessions.find(s => s.id === state.currentSessionId);
  }

  // 新建会话：创建空会话并切换
  function createAISession() {
    if (!state.chatSessions) state.chatSessions = [];
    const sess = { id: 'sess_' + Date.now().toString(36), title: '新对话 ' + (state.chatSessions.length + 1), messages: [] };
    state.chatSessions.push(sess);
    state.currentSessionId = sess.id;
    state.aiMessages = sess.messages;
    save();
    renderAILog();
    renderRightPanel();
    renderSessionList();
    toast('已新建对话');
  }

  // 切换会话：加载目标会话的消息到对话区
  function switchAISession(id) {
    if (id === state.currentSessionId) return;
    const target = state.chatSessions.find(s => s.id === id);
    if (!target) return;
    invalidateAIRequests();
    state.currentSessionId = id;
    state.aiMessages = target.messages || (target.messages = []);
    save();
    renderAILog();
    renderRightPanel();
    renderSessionList();
  }

  // 删除会话：从 chatSessions 中移除
  async function deleteAISession(id) {
    const idx = state.chatSessions.findIndex(s => s.id === id);
    if (idx < 0) return;
    if (!(await confirmModal('确定删除此会话？'))) return;
    state.chatSessions.splice(idx, 1);
    // 删除的是当前会话时，切换到第一个或创建新会话
    if (id === state.currentSessionId) {
      if (state.chatSessions.length > 0) {
        state.currentSessionId = state.chatSessions[0].id;
        state.aiMessages = state.chatSessions[0].messages || (state.chatSessions[0].messages = []);
      } else {
        state.currentSessionId = '';
        state.aiMessages = [];
        getCurrentSession();
      }
    }
    save();
    renderAILog();
    renderRightPanel();
    renderSessionList();
    toast('已删除会话');
  }

  // 渲染会话历史列表
  function renderSessionList() {
    const items = $('aiSessionItems');
    if (!items) return;
    const sessions = Array.isArray(state.chatSessions) ? state.chatSessions : [];
    const count = $('aiSessionCount');
    if (count) count.textContent = sessions.length + ' 个会话';
    const inlineNew = $('aiNewSessionInline');
    if (inlineNew) inlineNew.onclick = createAISession;
    if (!sessions.length) {
      items.innerHTML = '<div class="ai-session-empty"><div class="ai-session-empty__icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.3 9.3 9.3 0 0 1-4-.9L3 20l1.2-4.2A8.1 8.1 0 0 1 3 11.5a8.4 8.4 0 0 1 9-8.3 8.4 8.4 0 0 1 9 8.3Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></svg></div><strong>还没有会话</strong><span>从下方输入框开始新的创作讨论</span></div>';
      return;
    }
    items.innerHTML = sessions.map(s => {
      const messages = Array.isArray(s.messages) ? s.messages : [];
      const meaningful = messages.slice().reverse().find(m => {
        const text = String(m && m.text || '').trim();
        return text && text !== '思考中…' && text !== '思考中...';
      });
      const preview = meaningful
        ? String(meaningful.text).replace(/\s+/g, ' ').trim()
        : '暂无消息，开始一段新对话';
      const messageCount = messages.filter(m => {
        const messageText = String(m && m.text || '').trim();
        return (messageText && messageText !== '思考中…' && messageText !== '思考中...') || String(m && m.thinking || '').trim() || String(m && m.skillAnalysis || '').trim();
      }).length;
      const active = s.id === state.currentSessionId;
      return '<div class="ai-session-item' + (active ? ' is-active' : '') + '" data-id="' + esc(s.id) + '" role="listitem">' +
        '<button class="ai-session-item__main" data-session="' + esc(s.id) + '" type="button"' + (active ? ' aria-current="true"' : '') + '>' +
          '<div class="ai-session-item__title-row"><span class="ai-session-item__dot" aria-hidden="true"></span><span class="ai-session-item__title">' + esc(s.title || '未命名会话') + '</span></div>' +
          '<div class="ai-session-item__preview">' + esc(preview) + '</div>' +
          '<div class="ai-session-item__meta">' + messageCount + ' 条消息</div>' +
        '</button>' +
        '<button class="ai-session-item__del" data-del="' + esc(s.id) + '" type="button" title="删除会话" aria-label="删除会话">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>' +
        '</button>' +
      '</div>';
    }).join('');
    // 绑定会话切换
    items.querySelectorAll('[data-session]').forEach(button => {
      button.onclick = () => switchAISession(button.dataset.session);
      button.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          switchAISession(button.dataset.session);
        }
      };
    });
    // 绑定删除按钮
    items.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = e => { e.stopPropagation(); deleteAISession(btn.dataset.del); };
    });
  }

  /* 切换AI发送按钮的停止/发送状态
   * @param {boolean} active - true=生成中(停止按钮), false=空闲(发送按钮)
   */
  function setAIStopState(active) {
    var btn = $('aiChatSend');
    if (!btn) return;
    if (active) {
      btn.classList.add('is-stop');
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
      btn.title = '停止生成';
    } else {
      btn.classList.remove('is-stop');
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
      btn.title = '发送';
    }
  }

  /* ===================== 统一插入正文函数 =====================
   * 将AI生成的文本插入到当前场景编辑器光标位置，
   * 同步更新数据模型、字数统计、沉浸编辑器，并持久化。
   * @param {string} text - 要插入的纯文本
   * ------------------------------------------------------------------ */
  function insertTextToEditor(text) {
    if (!text || !text.trim()) { toast('内容为空，无法插入'); return; }
    if (!editorContent) { toast('编辑器未就绪'); return; }
    editorContent.focus();
    // 将纯文本转为HTML段落
    var html = '<p>' + esc(text).replace(/\n/g, '</p><p>') + '</p>';
    document.execCommand('insertHTML', false, html);
    setSceneContent(editorContent.innerHTML);
    updateWordCount();
    // 同步沉浸编辑器
    if (immersiveEditor) immersiveEditor.innerHTML = editorContent.innerHTML;
    debouncedSave();
    toast('已插入到正文');
  }

  /* 从AI生成的设定文本中提取实体信息
   * 支持「【类型】名称：描述」格式
   * @param {string} text - AI输出的设定文本
   * @returns {Array<{name:string,type:string,desc:string}>} 提取的实体数组
   */
  function parseAIEntities(text) {
    var results = [];
    if (!text) return results;
    // 匹配「【类型】名称：描述」格式
    var pattern = /【(角色|地点|势力|宗门|人物|物品类别|品级|物品品级|物品|事件|character|location|faction|itemCategory|itemRank|item|event)】\s*([^：:]+)[：:]\s*([^\n【】]+)/gi;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      var typeMap = { '角色': 'character', '人物': 'character', '地点': 'location', '势力': 'faction', '宗门': 'faction', '物品类别': 'itemCategory', '品级': 'itemRank', '物品品级': 'itemRank', '物品': 'item', '事件': 'event', 'character': 'character', 'location': 'location', 'faction': 'faction', 'itemCategory': 'itemCategory', 'itemRank': 'itemRank', 'item': 'item', 'event': 'event' };
      var type = typeMap[match[1]] || 'item';
      var name = match[2].trim();
      var desc = match[3].trim();
      var aliasMatch = desc.match(/(?:别名|又名|aliases?)\s*[:：]\s*([^；;\n]+)/i);
      var parentMatch = desc.match(/(?:上级|归属|所属|主归属|parent)\s*[:：]\s*([^；;\n]+)/i);
      if (name && name.length <= 20) {
        results.push({ name: name, type: type, aliases: aliasMatch ? normalizeAliasList(aliasMatch[1]) : [], parent: parentMatch ? parentMatch[1].trim() : '', desc: desc });
      }
    }
    return results;
  }

  // 将角色/设定快捷生成结果写入知识库；解析失败时保留为参考资料，避免生成内容丢失。
  function saveAIGeneratedKnowledge(action, text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    ensureKnowledge();
    const entities = parseAIEntities(raw);
    if (entities.length) {
      try {
        const result = mergeExtracted({ entities: entities.map(function(ent) {
          return { name: ent.name, type: ent.type, aliases: ent.aliases, parent: ent.parent, notes: ent.desc };
        }) });
        toast('已保存到设定集，共更新 ' + (result.added + result.updated) + ' 条');
        return true;
      } catch (_) {}
    }
    addReferenceMaterial('AI生成' + (action === 'character' ? '角色' : '设定') + '-' + Date.now(), raw, action === 'character' ? 'character' : 'setting');
    save();
    renderSidebarSheji();
    toast('已保存到设定集参考资料，请检查并整理');
    return true;
  }

  /* 为AI助手面板中指定索引的bot消息追加"插入到正文"按钮
   * @param {number} msgIndex - state.aiMessages 中的消息索引
   * @param {string} text - 要插入的文本
   * ------------------------------------------------------------------ */
  function appendInsertButton(msgIndex, text) {
    var cm = $('aiChatMessages');
    if (!cm) return;
    // 找到对应索引的bot消息元素（bot消息是第 msgIndex 个子元素，但需要考虑user消息也在其中）
    // state.aiMessages 中 user 和 bot 交替，msgIndex 是 bot 的索引
    // 在DOM中，每条消息是一个子div，所以 bot 消息是第 msgIndex 个子元素
    var msgEls = cm.querySelectorAll('.ai-chat-msg--bot');
    // 找到最近的bot消息（最后一条）
    var lastBot = msgEls[msgEls.length - 1];
    if (!lastBot) return;
    // 避免重复添加按钮
    if (lastBot.querySelector('.ai-msg-insert-btn')) return;
    // 若消息操作栏已提供"插入到正文"按钮（renderAILog 渲染），则不再追加冗余按钮，避免重复
    var nextActions = lastBot.nextElementSibling;
    if (nextActions && nextActions.classList.contains('ai-msg-actions') && nextActions.querySelector('[data-act="insert"]')) return;
    var btn = document.createElement('button');
    btn.className = 'ai-msg-insert-btn';
    btn.type = 'button';
    btn.textContent = '插入到正文';
    btn.onclick = function() { insertTextToEditor(text); };
    lastBot.appendChild(document.createElement('br'));
    lastBot.appendChild(btn);
  }

  /* ===================== AI助手面板：快捷指令 =====================
   * 6个快捷指令卡片：续写/润色/扩写/改写/大纲/设定
   * 结果流式显示在消息对话区，并记录到 aiCallLog
   * ------------------------------------------------------------------ */
  // 快捷指令配置映射
  var QUICK_ACTION_PROMPTS = {
    continue: {
      name: '续写', group: '创作', instruction: '请在当前正文之后继续创作。请严格遵循知识库中的人物性格、关系与世界观设定，保持与已有正文一致的文风和叙事视角。直接输出续写内容，不要解释、不要重复原文。',
      needSelection: false, model: 'continuation'
    },
    polish: {
      name: '润色', group: '创作', instruction: '请润色下面的文本，使表达更流畅、更有文学性。保持原意不变，注意人物对话要符合知识库中的性格设定。仅输出润色后的文本。',
      needSelection: true, model: 'polish'
    },
    expand: {
      name: '扩写', group: '创作', instruction: '请扩写下面的段落，增加细节、感官描写与张力。保持原意，注意与知识库中的世界观设定一致。直接输出扩写后的文本。',
      needSelection: false, model: 'continuation'
    },
    rewrite: {
      name: '改写', group: '创作', instruction: '请用不同的风格重写下面的文本，保留核心情节与信息。注意人物性格应与知识库设定一致。仅输出改写后的文本。',
      needSelection: true, model: 'continuation'
    },
    character: {
      name: '角色', group: '设定', instruction: '请根据当前已有角色关系和世界观，生成一个新角色。只输出一条结构化设定，格式必须是「【角色】角色姓名：上级：所属势力；别名：别名；描述：活动地点、性格特征、背景故事、与现有角色的关系」。没有上级或别名时省略对应字段。请参考知识库中已有角色避免重复，不要解释。',
      needSelection: false, model: 'default'
    },
    outline: {
      name: '大纲', group: '分析', instruction: '请为当前章节生成一个详细大纲，包含主要情节走向、关键场景和情感节奏。请参考章节蓝图中的规划，确保与整体故事线一致。',
      needSelection: false, model: 'default'
    },
    consistency: {
      name: '查错', group: '分析', instruction: '请对比当前正文与知识库中的设定，找出矛盾、吃书（前后设定冲突）、遗漏关键设定之处。逐条列出问题并给出修正建议。',
      needSelection: false, model: 'default'
    },
    setting: {
      name: '设定', group: '设定', instruction: '请根据当前正文内容，生成世界观设定，包括地点、势力/宗门、人物、物品类别、物品品级、物品等要素。请以结构化格式输出，每条设定用「【类型】名称：上级：上级名称；别名：别名1、别名2；描述：事实描述」的格式；没有上级或别名时省略对应字段。类型使用地点、势力、人物、物品类别、品级、物品、事件。只输出文本设定，不要臆造。',
      needSelection: false, model: 'default'
    }
  };

  // 执行快捷指令：构建提示词并流式调用AI
  async function runQuickAction(action) {
    const cfg = QUICK_ACTION_PROMPTS[action];
    if (!cfg) return;
    const requestSession = sessionIdentity();
    // 获取选中文本或当前正文
    let userText = '';
    const selObj = window.getSelection();
    if (cfg.needSelection && selObj && selObj.toString().trim()) {
      userText = selObj.toString();
    } else if (cfg.needSelection) {
      toast('请先在编辑器中选中文本');
      return;
    } else if (action === 'continue') {
      userText = getTextBeforeCursor();
    } else {
      userText = htmlToText(currentSceneContent());
    }
    var roleBase = cfg.instruction;
    getCurrentSession();
    const requestTarget = captureAITarget();
    var sys = await buildSystemReady('你是一位专业的中文网络小说写作助手。请严格遵循上方提供的知识库设定、人物关系与章节蓝图进行创作。回答简洁、有画面感、贴合网文节奏。');
    if (!sys || sessionIdentity() !== requestSession || !isCurrentAITarget(requestTarget)) return;
    const userMsg = cfg.instruction + '\n\n【原文/上下文】\n' + userText;
    const model = currentUnifiedModel();
    const outputTarget = (action === 'character' || action === 'setting') ? 'setting' : ['continue', 'polish', 'expand', 'rewrite'].includes(action) ? 'body' : 'chat';
    const characterMaterial = outputTarget === 'body'
      ? buildCharacterMaterialRequest(userMsg, { proseTask: true })
      : { enabled: false, proseTask: false };
    const task = createAITask('快捷操作 · ' + cfg.name, model, outputTarget, { kind: 'quick', action: action });
    // 在对话区显示用户指令摘要
    getCurrentSession();
    state.aiMessages = state.aiMessages || [];
    state.aiMessages.push({ role: 'user', text: '【' + cfg.name + '】' + (cfg.needSelection ? '\n' + userText.slice(0, 200) : '') });
    state.aiMessages.push({ role: 'bot', text: '思考中…', thinking: '', skillAnalysis: '', action: (action === 'character' || action === 'setting') ? action : '', outputTarget: outputTarget, taskId: task.id, sourceText: cfg.needSelection || ['continue', 'polish', 'expand', 'rewrite'].includes(action) ? userText : '' });
    var botMsgIndex = state.aiMessages.length - 1; // bot消息是最后推入的
    renderAILog();
    let botText = '思考中…';
    var history = buildChatHistory(10);
    // 移除最后一条（刚推入的快捷指令user消息），避免重复
    if (history.length > 0) history.pop();
    var messages = [{ role: 'system', content: sys }].concat(history).concat([{ role: 'user', content: userMsg }]);
    try {
      await streamSkillPipeline({ model: model, thinking: state.settings.think, humanize: outputTarget === 'body', correction: outputTarget === 'body', skillMode: outputTarget === 'body' ? 'write' : undefined, characterMaterial, messages: messages }, {
      onStage: stage => { if (isCurrentAITarget(requestTarget)) { setAIMessageStage(botMsgIndex, stage); updateAITask(task, { stage: stage === 'skill_analysis' ? '正在分析已选 Skill' : stage === 'humanizer' ? '正在执行 humanizer 后处理' : stage === 'writing' ? '正在生成正文' : '正在连接模型' }); } },
      onStart: c => { if (!isCurrentAITarget(requestTarget)) return; chatCtl = c; bindAITaskController(task, c); setAIMessageStage(botMsgIndex, 'connecting'); updateAITask(task, { stage: '正在连接模型', progress: 8 }); setAIStopState(true); },
      onBilling: billing => { if (isCurrentAITarget(requestTarget)) updateAITaskBilling(task, billing); },
      onThink: t => {
        if (!isCurrentAITarget(requestTarget)) return;
        const message = state.aiMessages[botMsgIndex];
        if (message) {
          message.thinking = (message.thinking || '') + t;
          message.stageText = AI_MESSAGE_STAGE_TEXT.thinking;
          renderAILog();
        }
      },
      onSkillAnalysisDelta: t => {
        if (!isCurrentAITarget(requestTarget)) return;
        const message = state.aiMessages[botMsgIndex];
        if (message) {
          message.skillAnalysis = (message.skillAnalysis || '') + t;
          message.stageText = AI_MESSAGE_STAGE_TEXT.skill_analysis;
          renderAILog();
        }
      },
      onReplaceText: text => {
        if (!isCurrentAITarget(requestTarget)) return;
        botText = String(text || '');
        const message = state.aiMessages[botMsgIndex];
        if (message) { message.text = botText; message.stageText = ''; }
        renderAILog();
      },
      onDelta: d => { if (!isCurrentAITarget(requestTarget)) return; if (botText === '思考中…') botText = ''; botText += d; const message = state.aiMessages[botMsgIndex]; if (message) { message.text = botText; message.stageText = ''; } renderAILog(); },
      onDone: (reason, usage) => {
        if (!isCurrentAITarget(requestTarget)) return;
        attachUsageToMessage(botMsgIndex, usage);
        chatCtl = null; setAIStopState(false); save();
        logAICall(cfg.name, model, usage, botText);
        var message = state.aiMessages[botMsgIndex];
        if (!String(botText || '').trim() || botText === '思考中…') botText = reason === 'abort' ? '已停止生成' : reason === 'credit_exhausted' ? '积分已耗尽，生成已停止' : reason === 'length' ? '已达到输出长度上限，但模型未返回正文，请重试' : message && message.thinking ? '模型已返回思考过程，但没有返回正文，请重试' : '模型未返回正文，请重试';
         if (message) {
           message.finishReason = reason || '';
           message.partial = ['abort', 'length', 'credit_exhausted', 'material_overlap'].includes(reason);
           message.status = reason === 'material_overlap' ? 'material_overlap' : reason === 'credit_exhausted' ? 'credit_exhausted' : reason === 'abort' ? 'cancelled' : reason === 'length' ? 'truncated' : 'completed';
           message.text = botText;
          message.stageText = '';
        }
        finishAITask(task, reason, usage, { resultExcerpt: botText.slice(0, 180) });
        renderAILogNow();
      },
      onError: (e, meta) => {
        if (!isCurrentAITarget(requestTarget)) return;
        chatCtl = null; setAIStopState(false);
        const fallbackText = meta && meta.partialText ? String(meta.partialText) : '';
        botText = fallbackText || ('⚠️ ' + e);
        const last = state.aiMessages[botMsgIndex];
        if (last) {
          last.text = botText;
          last.stageText = '';
          last.finishReason = meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : '';
          last.status = fallbackText ? 'completed_with_fallback' : meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'failed';
        }
        finishAITask(task, meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', null, { error: String(e) });
        renderAILog(); save();
        if (fallbackText) toast('humanizer 后处理失败，已保留写作初稿');
      }
      });
    } catch (error) {
      if (!isCurrentAITarget(requestTarget)) return;
      chatCtl = null; setAIStopState(false);
      const message = state.aiMessages[botMsgIndex];
      if (message) { message.text = '⚠️ ' + (error && error.message || error); message.stageText = ''; message.status = 'failed'; }
      finishAITask(task, 'error', null, { error: String(error && error.message || error) });
      renderAILog(); save();
    } finally {
      if (isCurrentAITarget(requestTarget) && chatCtl) { chatCtl = null; setAIStopState(false); }
    }
  }

  /* ===================== AI助手面板：初始化 =====================
   * 绑定新建会话/会话历史/快捷指令/输入框/模型选择事件
   * ------------------------------------------------------------------ */
  // 初始化AI助手面板：会话管理 / 快捷指令 / 模型选择 / 输入控制
  function initAIAssistantPanel() {
    // 确保会话已初始化
    getCurrentSession();
    renderSessionList();
    renderRightPanel();
    renderContextPreview();

    // 新建会话按钮
    const newBtn = $('aiNewSession');
    if (newBtn) newBtn.onclick = createAISession;

    // 会话历史列表切换
    const listBtn = $('aiSessionList');
    const listPanel = $('aiSessionListPanel');
    if (listBtn) listBtn.onclick = () => { if (listPanel) listPanel.hidden = !listPanel.hidden; };

    // 快捷指令卡片：点击执行对应AI操作
    const cards = $('aiQuickCards');
    if (cards) cards.onclick = e => {
      const card = e.target.closest('.rp-chip[data-action]');
      if (!card) return;
      runQuickAction(card.dataset.action);
    };

    // 输入框：Enter发送，Shift+Enter换行
    const input = $('aiChatInput');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const form = $('aiChatForm');
          if (form) form.requestSubmit();
        }
      });
      // 自动调整输入框高度
      input.addEventListener('input', () => {
        input.style.height = '44px';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      });
    }

    // 发送按钮：生成中点击则中断，空闲时提交表单
    var sendBtn = $('aiChatSend');
    if (sendBtn) {
      sendBtn.onclick = function(e) {
        e.preventDefault();
        if (chatCtl) {
          // 生成中：中断
          try { chatCtl.abort(); } catch(_) {}
          chatCtl = null;
          setAIStopState(false);
          toast('已停止生成');
        } else {
          // 空闲：提交表单
          var form = $('aiChatForm');
          if (form) form.requestSubmit();
        }
      };
    }

    // 模型选择：下拉切换 DeepSeek / GPT
    const modelBtn = $('aiModelSelect');
    if (modelBtn) {
      const menu = document.createElement('div');
      menu.className = 'ai-model-menu';
      menu.id = 'aiModelMenu';
      menu.hidden = true;
      document.body.appendChild(menu);
      function renderModelMenu() {
        const cur = currentUnifiedModel();
        const groups = {};
        PLATFORM_MODELS.forEach(m => { (groups[m.group] = groups[m.group] || []).push(m); });
        let html = '';
        Object.keys(groups).forEach(g => {
          const title = g === 'deepseek' ? 'DeepSeek' : (g === 'gpt' ? 'GPT 中转' : g);
          html += '<div class="ai-model-group"><div class="ai-model-group__title">' + esc(title) + '</div>';
          groups[g].forEach(m => {
            html += '<button type="button" class="ai-model-option' + (cur === m.id ? ' is-active' : '') + '" data-model="' + esc(m.id) + '"><span class="ai-model-option__name">' + esc(m.name) + '</span></button>';
          });
          html += '</div>';
        });
        menu.innerHTML = html;
        menu.querySelectorAll('.ai-model-option').forEach(b => {
          b.onclick = (e) => {
            e.stopPropagation();
            if (!SERVER_CAN_CHOOSE_MODEL) return;
            const sel = b.dataset.model;
            state.settings.models = state.settings.models || { default: 'deepseek-v4-flash', continuation: 'deepseek-v4-flash', polish: 'deepseek-v4-flash' };
            state.settings.models.default = sel;
            state.settings.models.continuation = sel;
            state.settings.models.polish = sel;
            rememberSelectedModel(sel);
            save();
            updateModelBadges();
            renderThinkControl();
            menu.hidden = true;
            toast('已切换模型：' + modelLabel(sel));
          };
        });
      }
      modelBtn.onclick = (e) => {
        e.stopPropagation();
        if (!SERVER_CAN_CHOOSE_MODEL) return;
        renderModelMenu();
        const rect = modelBtn.getBoundingClientRect();
        // 模型选择按钮在右栏底部，菜单向上展开避免超出视口
        menu.style.left = rect.left + 'px';
        menu.style.top = 'auto';
        menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        menu.hidden = !menu.hidden;
      };
      document.addEventListener('click', () => { menu.hidden = true; });
    }

    // P3/P4 AI 能力栏
    ensureAdvancedState();
    const outputSelect = $('aiOutputTarget');
    if (outputSelect) { outputSelect.value = state.aiOutputTarget || 'chat'; outputSelect.onchange = () => { state.aiOutputTarget = outputSelect.value; save(); }; }
    save(); // 持久化 GPT 源等新增默认状态
    const roleSel = $('aiRoleSelect');
    if (roleSel) {
      renderRoleSelectOptions();
      roleSel.onchange = () => {
        const v = roleSel.value;
        if (String(v).startsWith('ap:')) { state.aiProfileId = String(v).slice(3); save(); toast('已启用自定义智能体'); }
        else { state.aiProfileId = ''; state.aiRole = v; save(); const r = AGENT_ROLES[v]; toast('智能体：' + (r ? r.label : v) + ' — ' + (r ? r.desc : '')); }
      };
    }
    const styleSel = $('aiStyleSelect');
    if (styleSel) { styleSel.value = state.aiStyle || ''; styleSel.onchange = () => { state.aiStyle = styleSel.value; save(); toast(styleSel.value ? ('仿写风格：' + (STYLE_TAGS.find(s => s.id === styleSel.value) || {}).label) : '已清除仿写风格'); }; }
    const siBtn = $('streamInsertBtn'); if (siBtn) siBtn.onclick = streamInsertContinue;
    const siStop = $('streamInsertStop'); if (siStop) siStop.onclick = stopStreamInsert;
    const imiBtn = $('aiStyleImitateBtn'); if (imiBtn) imiBtn.onclick = runStyleImitation;
    const contBtn = $('aiContinueGenBtn'); if (contBtn) contBtn.onclick = continueLastAI;
    const genNextBtn = $('genNextChapterBtn'); if (genNextBtn) genNextBtn.onclick = generateNextChapter;
    const qaGenNext = $('qaGenNext'); if (qaGenNext) qaGenNext.onclick = generateNextChapter;

    // === 新简洁面板事件绑定 ===
    // 设置抽屉
    const settingsBtn = $('rpSettingsBtn');
    const settingsDrawer = $('rpSettingsDrawer');
    const settingsClose = $('rpSettingsClose');
    if (settingsBtn && settingsDrawer) {
      settingsBtn.onclick = () => { settingsDrawer.hidden = false; };
      if (settingsClose) settingsClose.onclick = () => { settingsDrawer.hidden = true; };
    }
    // ★ S5：自定义智能体——保存当前角色+风格为模板 / 管理列表
    const saveProfileBtn = $('aiSaveProfileBtn');
    if (saveProfileBtn) saveProfileBtn.onclick = () => {
      const r = AGENT_ROLES[state.aiRole] || AGENT_ROLES.generation;
      const name = prompt('自定义智能体名称（例如：热血玄幻文风助手）', r.label + ' · ' + ((STYLE_TAGS.find(s => s.id === state.aiStyle) || {}).label || '默认风格'));
      if (name === null) return;
      saveCurrentAsProfile(name);
    };
    const manageProfileBtn = $('aiManageProfileBtn');
    if (manageProfileBtn) manageProfileBtn.onclick = openProfileManager;

    // 快速开始卡片
    const qsTitle = document.querySelector('.rp-quick-start__title');
    if (qsTitle) qsTitle.onclick = () => { const el = qsTitle.closest('.rp-quick-start'); if (el) el.classList.toggle('is-collapsed'); };
    const qscardFull = $('qscardFullflow');
    if (qscardFull) qscardFull.onclick = () => { submitAIMessage('请根据当前小说的大纲蓝图、已有章节内容和角色设定，生成下一章的完整正文。要求：保持文风一致、推进主线剧情、有至少一个冲突或转折点。', 'body'); };
    const qscardEarly = $('qscardEarly');
    if (qscardEarly) qscardEarly.onclick = () => { submitAIMessage('我正在创作初期，请帮我：1）完善小说的核心设定（世界观/力量体系）；2）构思开篇前三章的详细大纲；3）设计主角的初始状态和第一个核心冲突。', 'outline'); };
    const qscardCont = $('qscardContinue');
    if (qscardCont) qscardCont.onclick = () => { runQuickAction('continue'); };

    // 工具栏快捷按钮
    const rpNewChat = $('rpNewChatBtn');
    if (rpNewChat) rpNewChat.onclick = createAISession;
    const rpHistory = $('rpHistoryBtn');
    const rpListPanel = $('aiSessionListPanel');
    if (rpHistory && rpListPanel) rpHistory.onclick = () => { rpListPanel.hidden = !rpListPanel.hidden; };

    // 积分显示同步
    const creditEl = $('rpCredits');
    if (creditEl) {
      const updateRPCredits = () => {
        const cs = $('creditText');
        if (cs) creditEl.textContent = cs.textContent || '—';
      };
      // 初始更新 + MutationObserver 监听变化
      updateRPCredits();
      const csObserver = $('creditText');
      if (csObserver) new MutationObserver(updateRPCredits).observe(csObserver, { childList: true, characterData: true, subtree: true });
    }

    // 智能体名称显示同步（顶层 updateRoleDisplay 已处理自定义智能体 ap: 前缀）
    const roleDisplay = $('aiRoleDisplay');
    const roleSelInner = $('aiRoleSelect');
    if (roleDisplay && roleSelInner) {
      updateRoleDisplay();
      roleSelInner.onchange = () => {
        const v = roleSelInner.value;
        if (String(v).startsWith('ap:')) { state.aiProfileId = String(v).slice(3); save(); updateRoleDisplay(); }
        else { state.aiProfileId = ''; state.aiRole = v; save(); updateRoleDisplay(); }
      };
    }

    // 内联模型选择器同步到原模型按钮
    const modelSelInner = $('aiModelSelectInner');
    const modelBadge = $('aiModelBadge');
    if (modelSelInner) {
      modelSelInner.onchange = () => {
        switchUnifiedModel(modelSelInner.value);
        if (modelBadge) modelBadge.textContent = modelSelInner.options[modelSelInner.selectedIndex]?.text || modelSelInner.value;
      };
      // 同步当前模型到内联选择器
      const syncModelSelect = () => {
        const cur = currentUnifiedModel();
        if (modelSelInner.querySelector('option[value="' + cur + '"]')) {
          modelSelInner.value = cur;
        } else {
          // 动态添加选项
          const pm = PLATFORM_MODELS.find(m => m.id === cur);
          if (pm) {
            const opt = document.createElement('option');
            opt.value = pm.id; opt.textContent = pm.name;
            modelSelInner.appendChild(opt);
            modelSelInner.value = cur;
          }
        }
      };
      syncModelSelect();
    }
  }

  // 继续生成：把上一条 bot 回复作为上下文，要求模型继续
  function continueLastAI() {
    const msgs = state.aiMessages || [];
    const lastBot = [...msgs].reverse().find(m => m.role === 'bot' && m.text && m.text !== '思考中…' && ['length', 'credit_exhausted'].includes(m.finishReason)) || [...msgs].reverse().find(m => m.role === 'bot' && m.text && m.text !== '思考中…');
    if (!lastBot) { toast('暂无可继续的回复'); return; }
    submitAIMessage('请从上一条回复的末尾继续生成，不要重复已经输出的内容。', 'chat');
  }

  /* ---------------- AI 工具栏 ---------------- */
  function initAIToolbar() {
    const actions = {
      'AI续写': '请在当前正文之后继续创作，保持文风与视角一致，直接输出续写内容，不要解释。',
      'AI润色': '请润色下面的文本，使表达更流畅、更有文学性，仅输出润色后的文本。',
      '摘要扩写': '请将下面的摘要扩写为一段完整的场景描写，富有画面感。',
      '文本扩写': '请扩写下面的段落，增加细节与张力，保持原意。',
      '文本重写': '请用不同的风格重写下面的文本，保留核心信息。',
      '文本缩写': '请精简下面的段落，保留关键信息，缩短篇幅。'
    };
    let curAction = 'AI续写';
    qa('.ai-action').forEach(btn => {
      btn.onclick = () => { qa('.ai-action').forEach(x => x.classList.remove('is-active')); btn.classList.add('is-active'); curAction = btn.querySelector('.ai-action__name').textContent.trim(); };
    });
    const execBtn = qa('.tv-card .tv-btn--primary').find(b => b.textContent.includes('执行'));
    if (execBtn) execBtn.onclick = runAIToolbar;
  }
  const AI_ACTION_PROMPTS = {
    'AI续写': '请在当前正文之后继续创作，保持文风与视角一致，直接输出续写内容，不要解释。',
    'AI润色': '请润色下面的文本，使表达更流畅、更有文学性，仅输出润色后的文本。',
    '摘要扩写': '请将下面的摘要扩写为一段完整的场景描写，富有画面感。',
    '文本扩写': '请扩写下面的段落，增加细节与张力，保持原意。',
    '文本重写': '请用不同的风格重写下面的文本，保留核心信息。',
    '文本缩写': '请精简下面的段落，保留关键信息，缩短篇幅。'
  };
  async function runAIToolbar() {
    const active = qa('.ai-action').find(b => b.classList.contains('is-active'));
    const name = active ? active.querySelector('.ai-action__name').textContent.trim() : 'AI续写';
    const instruction = AI_ACTION_PROMPTS[name] || AI_ACTION_PROMPTS['AI续写'];
    const promptText = q('.prompt-textarea') ? q('.prompt-textarea').value.trim() : '';
    // 取选中文本或当前正文
    let userText = '';
    const selObj = window.getSelection();
    if (selObj && selObj.toString().trim()) userText = selObj.toString();
    else userText = htmlToText(currentSceneContent());
    const sys = await buildSystemReady('你是一位专业的中文网络小说写作助手，擅长构思情节、生成正文与设定。回答简洁、有画面感、贴合网文节奏。');
    if (!sys) return;
    const userMsg = instruction + (promptText ? '\n额外指令：' + promptText : '') + '\n\n【原文/上下文】\n' + userText;
    const model = currentUnifiedModel();
    const characterMaterial = buildCharacterMaterialRequest(userMsg, { proseTask: true });
    showAIToolResult(name, sys, userMsg, model, characterMaterial);
  }
  function showAIToolResult(name, sys, userMsg, model, characterMaterial) {
    // 在"执行"按钮下方插入结果卡片（若不存在）
    let box = q('#aiToolResult');
    if (!box) {
      box = document.createElement('div');
      box.id = 'aiToolResult';
      box.className = 'tv-card';
      box.style.marginTop = '16px';
      const card = qa('.tv-card').find(c => c.querySelector('.prompt-textarea'));
      if (card && card.parentElement) card.parentElement.insertBefore(box, card.nextSibling);
    }
    box.innerHTML = '<div class="set-row__label" style="margin-bottom:8px;">' + esc(name) + ' · 结果</div><div class="ai-tool-output" style="white-space:pre-wrap;line-height:1.7;min-height:60px;color:#333;"></div>';
    const out = box.querySelector('.ai-tool-output');
    out.textContent = '生成中…';
    const insertBtn = document.createElement('button');
    insertBtn.className = 'tv-btn tv-btn--primary';
    insertBtn.style.marginTop = '12px';
    insertBtn.textContent = '插入到正文';
    insertBtn.onclick = () => { insertTextToEditor(out.textContent); };
    box.appendChild(insertBtn);
    const resolvedModel = currentUnifiedModel();
    const task = createAITask(name, resolvedModel, 'body', { kind: 'tool', name, system: sys, text: userMsg, model: resolvedModel });
    streamSkillPipeline({ model: resolvedModel, thinking: state.settings.think, analyzeSkill: true, humanize: false, skillMode: 'write', characterMaterial: characterMaterial || buildCharacterMaterialRequest(userMsg, { proseTask: true }), messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] }, {
      onStage: stage => { updateAITask(task, { stage: stage === 'humanizer' ? '正在执行 humanizer 后处理' : '正在生成 ' + name }); },
      onStart: c => { bindAITaskController(task, c); updateAITask(task, { stage: '正在生成 ' + name, progress: 8 }); },
      onBilling: billing => updateAITaskBilling(task, billing),
      onReplaceText: text => { out.textContent = String(text || ''); },
      onDelta: d => { if (out.textContent === '生成中…') out.textContent = ''; out.textContent += d; },
      onDone: (reason, usage) => {
        const materialBlocked = reason === 'material_overlap' || !!(usage && usage.characterMaterial && usage.characterMaterial.blocked);
        if (materialBlocked) { insertBtn.disabled = true; insertBtn.textContent = '审计未通过，禁止插入'; out.textContent = out.textContent || '素材原创性审计未通过，已阻止插入正文'; }
        finishAITask(task, materialBlocked ? 'material_overlap' : reason, usage, { resultExcerpt: out.textContent.slice(0, 180) });
        logAICall(name, resolvedModel, usage, materialBlocked ? '素材原创性审计未通过，已阻止插入正文' : out.textContent);
      },
      onError: (e, meta) => {
        const fallbackText = meta && meta.partialText ? String(meta.partialText) : '';
        out.textContent = fallbackText || ('⚠️ ' + e);
        finishAITask(task, meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', null, { error: String(e) });
        if (fallbackText) toast('humanizer 后处理失败，已保留写作初稿');
      }
    });
  }

  /* ---------------- 剧情推演 ---------------- */
  function initPlot() {
    const slider = $('plotSlider'); const val = $('plotSliderVal');
    if (slider && val) slider.oninput = () => { val.textContent = slider.value + ' 个'; };
    renderPlotModel();
    renderPlotContext();
    const startBtn = $('runPlotBtn');
    if (startBtn) startBtn.onclick = runPlot;
    // 重新生成 / 采纳（事件委托）
    const tv = q('[data-view="plot"] .tv-content');
    if (tv) tv.onclick = e => {
      const btn = e.target.closest('.tv-btn'); if (!btn) return;
      if (btn.textContent.includes('采纳此方案')) {
        const card = btn.closest('.plot-card');
        const plot = card.querySelector('.plot-card__plot').textContent;
        insertTextToEditor(plot);
      } else if (btn.textContent.includes('重新生成')) {
        const card = btn.closest('.plot-card');
        runPlotBranch(card);
      }
    };
  }
  async function runPlot() {
    const n = parseInt($('plotSlider').value, 10) || 3;
    const model = currentAIPanelModel();
    const container = q('[data-view="plot"] .tv-content');
    let head = container.querySelector('.plot-results-head');
    if (!head) { head = document.createElement('div'); head.className = 'outline-section-head plot-results-head'; head.style.marginTop = '24px'; head.innerHTML = '<span class="outline-emoji">🔮</span><span>推演结果</span>'; container.appendChild(head); }
    // 清除旧结果
    qa('.plot-card').forEach(c => c.remove());
    const empty = $('plotEmpty'); if (empty) empty.hidden = true;
    const startBtn = $('runPlotBtn');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = '推演中…'; }
    try {
      for (let i = 0; i < n; i++) {
        const result = await runPlotBranch(null, i, model, head);
        if (result && result.creditExhausted) {
          if (i + 1 < n) toast('积分不足，已停止后续剧情推演');
          break;
        }
      }
    } finally {
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = '开始推演'; }
    }
  }
  async function runPlotBranch(card, index, model, head) {
    const container = q('[data-view="plot"] .tv-content');
    const cards = qa('.plot-card');
    const i = (index != null) ? index : Math.max(0, cards.indexOf(card));
    const resolvedModel = currentUnifiedModel();
    const task = createAITask('剧情推演 · 方案 ' + String.fromCharCode(65 + i), resolvedModel, 'chat', { kind: 'plot', index: i, model: resolvedModel });
    if (!card) {
      card = document.createElement('div');
      card.className = 'plot-card';
      const tag = String.fromCharCode(65 + i);
      card.innerHTML = '<div class="plot-card__head"><span class="plot-card__tag">方案 ' + tag + '</span><span class="plot-card__model">' + esc(modelLabel(resolvedModel)) + '</span><span class="plot-card__billing">计费中…</span></div>' +
        '<div class="plot-card__title">生成中…</div><div class="plot-card__plot"></div>' +
        '<div class="plot-card__actions"><button class="tv-btn tv-btn--primary" type="button">采纳此方案</button><button class="tv-btn" type="button">重新生成</button></div>';
      const h = head || container.querySelector('.plot-results-head');
      const lastCard = qa('.plot-card').pop();
      if (lastCard) lastCard.insertAdjacentElement('afterend', card);
      else if (h) h.insertAdjacentElement('afterend', card);
      else container.appendChild(card);
    }
    const titleEl = card.querySelector('.plot-card__title');
    const plotEl = card.querySelector('.plot-card__plot');
    const modelEl = card.querySelector('.plot-card__model');
    const billingEl = card.querySelector('.plot-card__billing');
    if (modelEl) modelEl.textContent = modelLabel(resolvedModel);
    if (billingEl) billingEl.textContent = '计费中…';
    titleEl.textContent = '生成中…'; plotEl.textContent = '';
    const sys = await buildSystemReady('你是小说剧情推演引擎。请严格基于下方【实时作品上下文】（书名、简介、卷纲、章节蓝图、当前章节已写正文、上一章回顾、出场人物与设定）来推演，确保生成的后续剧情与已有内容连贯、不矛盾、不凭空捏造未出现的人物或设定。为当前章节生成一条合理的后续剧情走向（含标题与要点）。');
    if (!sys) {
      titleEl.textContent = 'Skill 加载失败';
      plotEl.textContent = '请稍后重试';
      finishAITask(task, 'error', null, { error: 'Skill 尚未加载完成' });
      return { creditExhausted: false };
    }
    const cur = currentChapter(); const oc = currentOutlineChapter(); const hasPrev = !!prevChapter();
    const userMsg = '基于上方【实时作品上下文】（书名、简介、卷纲、章节蓝图、本章已写正文' + (hasPrev ? '、上一章回顾' : '') + '、出场人物与设定），请为当前章节「' + cur.title + (cur.sub ? ('（' + cur.sub + '）') : '') + '」' +
      (oc && oc.synopsis ? '（本章规划：' + oc.synopsis + '）' : '') +
      '生成第 ' + (i + 1) + ' 条后续剧情走向（方案 ' + String.fromCharCode(65 + i) + '）。' +
      '要求：必须承接本章已有正文与本章规划，给出有张力、可直接落笔的分支；以「标题：」起头，随后用 2-4 条要点描述走向。各方案需彼此不同、各有侧重（如冲突升级 / 伏笔铺设 / 情感反转等）。';
    let creditExhausted = false;
    return streamChat({ model: resolvedModel, thinking: state.settings.think, messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] }, {
      onStart: c => { bindAITaskController(task, c); updateAITask(task, { stage: '正在推演剧情分支', progress: 8 }); },
      onBilling: billing => updateAITaskBilling(task, billing),
      onDelta: d => {
        // 解析标题行
        if (titleEl.textContent === '生成中…') titleEl.textContent = '';
        plotEl.textContent += d;
        const m = plotEl.textContent.match(/标题[:：]\s*(.+)/);
        if (m && titleEl.dataset.done !== '1') { titleEl.textContent = m[1].trim(); titleEl.dataset.done = '1'; }
      },
      onDone: (reason, usage) => {
        creditExhausted = reason === 'credit_exhausted';
        titleEl.dataset.done = '';
        if (!titleEl.textContent || titleEl.textContent === '生成中…') titleEl.textContent = '剧情分支 ' + String.fromCharCode(65 + i);
        if (billingEl) billingEl.textContent = usage && usage.creditCost != null ? '消耗 ' + formatCreditCost(usage.creditCost) + ' 积分' : (creditExhausted ? '积分已耗尽' : '积分待结算');
        finishAITask(task, reason, usage, { resultExcerpt: plotEl.textContent.slice(0, 180) });
        logAICall('剧情推演', resolvedModel, usage, plotEl.textContent);
      },
      onError: (e, meta) => {
        creditExhausted = !!(meta && (meta.code === 'credit_exhausted' || meta.status === 402));
        plotEl.textContent = '⚠️ ' + (e && e.message ? e.message : e);
        finishAITask(task, creditExhausted ? 'credit_exhausted' : 'error', null, { error: String(e) });
        if (billingEl) billingEl.textContent = creditExhausted ? '积分不足' : '未完成计费';
      }
    }).then(() => ({ creditExhausted }));
  }

  /* ---------------- 聊天视图 ---------------- */
  function initChat() {
    const form = $('chatForm'); if (!form) return;
    const input = $('chatInput');
    form.onsubmit = e => { e.preventDefault(); submitAIMessage(input ? input.value : ''); };
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  }

  /* ---------------- 大纲可编辑 ---------------- */
  function initOutlineEdit() {
    // 总纲书名/简介/主题、卷纲简介、章节蓝图：contenteditable 保存
    qa('.tv-card .outline-value').forEach(v => {
      v.setAttribute('contenteditable', 'true');
      v.style.cursor = 'text';
      v.addEventListener('blur', () => {
        const field = v.closest('.outline-field');
        if (!field) return;
        const label = field.querySelector('.outline-label').textContent.trim();
        const txt = v.textContent.trim();
        if (label.includes('书名')) state.outline.book.title = txt;
        else if (label.includes('简介')) state.outline.book.oneLine = txt;
        else if (label.includes('卷简介')) state.outline.volume.synopsis = txt;
        if (label.includes('卷简介') || label.includes('简介') || label.includes('书名')) renderImpact($('tlImpactBody'));
        debouncedSave();
      });
    });
    // 章节蓝图卡片可编辑 + 添加
    const grid = q('.ch-grid');
    if (grid) {
      let dragIdx = null;
      grid.addEventListener('dragstart', e => {
        const card = e.target.closest('.ch-card'); if (!card) return;
        dragIdx = +card.dataset.idx; card.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragIdx)); } catch (_) {}
      });
      grid.addEventListener('dragend', e => {
        const card = e.target.closest('.ch-card'); if (card) card.classList.remove('dragging');
        qa('.ch-card', grid).forEach(c => c.classList.remove('drag-over')); dragIdx = null;
      });
      grid.addEventListener('dragover', e => {
        e.preventDefault();
        const card = e.target.closest('.ch-card'); if (!card) return;
        qa('.ch-card', grid).forEach(c => c.classList.remove('drag-over')); card.classList.add('drag-over');
      });
      grid.addEventListener('drop', e => {
        e.preventDefault();
        const card = e.target.closest('.ch-card'); if (!card || dragIdx == null) return;
        const to = +card.dataset.idx; reorderChapters(dragIdx, to); dragIdx = null;
      });
      grid.addEventListener('click', e => {
        const mv = e.target.closest('.ch-move button'); if (!mv) return;
        const card = e.target.closest('.ch-card'); if (!card) return;
        const idx = +card.dataset.idx;
        reorderChapters(idx, mv.dataset.move === 'up' ? idx - 1 : idx + 1);
      });
      grid.addEventListener('blur', e => {
        const card = e.target.closest('.ch-card'); if (!card) return;
        const idx = Array.from(grid.children).indexOf(card);
        const o = state.outline.chapters[idx]; if (!o) return;
        if (e.target.classList.contains('ch-card__title')) o.title = e.target.textContent.trim();
        if (e.target.classList.contains('ch-card__synopsis')) o.synopsis = e.target.textContent.trim();
        debouncedSave();
      }, true);
      qa('.ch-card__title, .ch-card__synopsis', grid).forEach(el => { el.setAttribute('contenteditable', 'true'); el.style.cursor = 'text'; });
      const addBtn = qa('.tv-btn--dashed').find(b => b.textContent.includes('添加章节蓝图'));
      if (addBtn) addBtn.onclick = () => {
        state.outline.chapters.push({ num: '第' + (state.outline.chapters.length + 1) + '章', status: 'todo', title: '新章节', synopsis: '（待填写）', wordCount: 0 });
        save(); renderOutline();
        qa('.ch-card__title, .ch-card__synopsis', grid).forEach(el => { el.setAttribute('contenteditable', 'true'); el.style.cursor = 'text'; });
        toast('已添加章节蓝图');
      };
    }
    // 分段切换
    const seg = $('outlineSeg');
    if (seg) {
      // 给卡片打标
      const cards = qa('.tv-card');
      if (cards[0]) { cards[0].classList.add('sec-synopsis'); }
      if (cards[1]) { cards[1].classList.add('sec-volume'); }
      const chSec = qa('.outline-section-head').find(h => h.textContent.includes('章节蓝图'));
      const chGrid = q('.ch-grid');
      const addB = qa('.tv-btn--dashed').find(b => b.textContent.includes('添加章节蓝图'));
      seg.onclick = e => {
        const b = e.target.closest('.seg-btn'); if (!b) return;
        qa('.seg-btn', seg).forEach(x => x.classList.remove('is-active')); b.classList.add('is-active');
        const which = b.dataset.seg;
        const show = sel => { (sel || []).forEach(el => el.style.display = ''); };
        const hide = sel => { (sel || []).forEach(el => el.style.display = 'none'); };
        if (which === 'synopsis') { show([cards[0], cards[1]]); hide(chSec ? [chSec, chGrid, addB].filter(Boolean) : []); }
        else if (which === 'volume') { hide([cards[0]]); show([cards[1]]); hide(chSec ? [chSec, chGrid, addB].filter(Boolean) : []); }
        else { hide([cards[0], cards[1]]); show(chSec ? [chSec, chGrid, addB].filter(Boolean) : []); }
      };
    }
  }

  /* ---------------- 故事画布 / 时间线 工具栏 ---------------- */
  function initTimelineToolbar() {
    const markSel = $('tlMarkSelect');
    if (markSel) markSel.onchange = () => { const i = currentOutlineIndex(); if (i >= 0) setChapterMark(i, markSel.value); };
    const storySel = $('tlStorySelect');
    if (storySel) storySel.onchange = () => { const i = currentOutlineIndex(); if (i >= 0) setChapterStoryline(i, storySel.value); };
    const addBtn = $('tlAddStory'); if (addBtn) addBtn.onclick = addStoryline;
    const refresh = $('tlRefresh'); if (refresh) refresh.onclick = () => { renderTimeline(); toast('已刷新布局'); };
    const impactBtn = $('tlImpactBtn');
    if (impactBtn) impactBtn.onclick = () => {
      renderImpact($('tlImpactBody'));
      const panel = $('tlImpact');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('影响分析已更新');
    };
  }

  /* ---------------- 设置 ---------------- */
  function initSettings() {
    const groups = {
      fontsize: v => { state.settings.fontSize = parseInt(v, 10); applyEditorStyle(); },
      lineheight: v => { state.settings.lineHeight = parseFloat(v); applyEditorStyle(); },
      paragraphSpacing: v => { state.settings.paragraphSpacing = parseInt(v, 10) || 12; applyEditorStyle(); },
      contentWidth: v => { state.settings.contentWidth = parseInt(v, 10) || 720; applyEditorStyle(); },
      theme: v => { const map = { '浅色': 'light', '深色': 'dark', '跟随系统': 'follow' }; state.settings.theme = map[v] || 'light'; applyTheme(state.settings.theme); },
      fontfamily: v => { state.settings.fontFamily = v === '宋体' ? 'song' : v === '黑体' ? 'hei' : 'system'; applyEditorStyle(); },
      export: v => { state.settings.exportFormat = v === 'TXT' ? 'txt' : v === 'Markdown' ? 'md' : 'pdf'; }
    };
    qa('[data-toggle-group]').forEach(g => {
      g.onclick = e => {
        const b = e.target.closest('.seg-btn'); if (!b) return;
        qa('.seg-btn', g).forEach(x => x.classList.remove('is-active')); b.classList.add('is-active');
        const key = g.getAttribute('data-toggle-group');
        if (groups[key]) groups[key](b.textContent.trim());
        save();
      };
    });
    const settingValues = {
      fontsize: (state.settings.fontSize || 16) + 'px', lineheight: String(state.settings.lineHeight || 1.8),
      paragraphSpacing: (state.settings.paragraphSpacing || 12) + 'px', contentWidth: (state.settings.contentWidth || 720) + 'px',
      theme: ({ light: '浅色', dark: '深色', follow: '跟随系统' })[state.settings.theme] || '浅色',
      fontfamily: ({ song: '宋体', hei: '黑体', system: '系统默认' })[state.settings.fontFamily] || '系统默认'
    };
    qa('[data-toggle-group]').forEach(g => { const selected = settingValues[g.getAttribute('data-toggle-group')]; if (!selected) return; qa('.seg-btn', g).forEach(btn => btn.classList.toggle('is-active', btn.textContent.trim() === selected)); });
    // 每日写作目标
    var dg = $('setDailyGoal');
    if (dg) {
      dg.value = (state.settings && state.settings.dailyGoal) || 2000;
      dg.onchange = () => { state.settings.dailyGoal = parseInt(dg.value, 10) || 2000; save(); updateWordCount(); };
    }
    // 自动保存开关
    const sw = q('.tv-card .switch input');
    if (sw) { sw.checked = state.settings.autosave; sw.onchange = () => { state.settings.autosave = sw.checked; save(); }; }
    // 思考模式开关
    const thinkSw = q('.switch input[data-setting="think"]');
    if (thinkSw) { thinkSw.checked = !!state.settings.think; thinkSw.onchange = () => { state.settings.think = thinkSw.checked; save(); }; }
    const readingSw = q('.switch input[data-setting="readingMode"]');
    if (readingSw) { readingSw.checked = !!state.settings.readingMode; readingSw.onchange = () => { state.settings.readingMode = readingSw.checked; applyEditorStyle(); save(); }; }
    // 模型下拉：真正影响各 AI 调用（动态填充平台模型列表）
    state.settings.models = state.settings.models || { default: 'deepseek-v4-flash', continuation: 'deepseek-v4-flash', polish: 'deepseek-v4-flash' };
    qa('.set-select').forEach(sel => {
      const role = sel.getAttribute('data-model-role');
      const curVal = currentUnifiedModel();
      let html = '';
      PLATFORM_MODELS.forEach(m => {
        html += '<option value="' + esc(m.id) + '"' + (curVal === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>';
      });
      sel.innerHTML = html;
      sel.value = curVal;
      sel.disabled = !SERVER_CAN_CHOOSE_MODEL;
      sel.title = SERVER_CAN_CHOOSE_MODEL ? '为当前账户设置模型' : '普通用户使用平台默认模型';
      sel.onchange = () => {
        if (!SERVER_CAN_CHOOSE_MODEL) return;
        if (role) {
          state.settings.models.default = sel.value;
          state.settings.models.continuation = sel.value;
          state.settings.models.polish = sel.value;
          rememberSelectedModel(sel.value);
          qa('.set-select').forEach(other => { if (other !== sel) other.value = sel.value; });
          save();
        }
        updateModelBadges();
        if (role === 'default') renderThinkControl();
      };
    });
  }

  /* ---------------- 历史版本 ---------------- */
  function openHistory() {
    const h = state.history || [];
    const rows = h.length ? h.map((x, i) => '<li class="hist-row" data-idx="' + i + '" style="padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.08);cursor:pointer;border-radius:6px;"><div style="font-weight:600;">' + esc(x.chapter) + (x.scene ? ' · ' + esc(x.scene) : '') + ' · ' + x.words + '字 · ' + esc(x.t) + '</div><div style="color:#666;font-size:12px;margin-top:2px;">' + esc(x.excerpt || '') + '</div></li>').join('') : '<li style="color:#888;">暂无历史快照（编辑内容会自动生成快照，Ctrl+S 手动生成）</li>';
    const modal = openModal('<h3 style="margin:0 0 4px;">历史版本</h3><p class="ml-modal__hint" style="margin:0 0 12px;">点击任意快照与当前场景进行差异对比</p><ul style="list-style:none;padding:0;margin:0;max-height:50vh;overflow:auto;">' + rows + '</ul>', { wide: true });
    if (modal) modal.querySelectorAll('.hist-row').forEach(r => r.onclick = () => openVersionDiff(+r.dataset.idx));
  }

  /* ---------------- 小说文库（切换 / 重命名 / 删除 / 新建） ---------------- */
  function closeDrawers() {
    if (sidebar) sidebar.classList.remove('is-open');
    if (rightPanel) rightPanel.classList.remove('is-open');
    updateBackdrop();
  }
  function updateBackdrop() {
    const bd = $('drawerBackdrop'); if (!bd) return;
    const open = (sidebar && sidebar.classList.contains('is-open')) || (rightPanel && rightPanel.classList.contains('is-open'));
    bd.classList.toggle('is-open', !!open);
  }
  /* ---------------- 三栏自由拖拽缩放（持久化到 localStorage） ---------------- */
  function initPanelResize() {
    const main = document.querySelector('.editor-main');
    const mainArea = document.querySelector('.editor-main-area');
    if (!main || !mainArea || !sidebar || !rightPanel || window.matchMedia('(max-width: 1100px)').matches) return;
    const LAYOUT_KEY = 'molan_editor_layout';
    let store = {};
    try { store = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'); } catch (_) {}
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
    const storedWidth = (value, min, max) => Number.isFinite(Number(value)) ? clamp(Number(value), min, max) : null;
    const savedSidebar = storedWidth(store.sidebar, 180, 520);
    const savedRight = storedWidth(store.right, 240, 640);
    if (savedSidebar !== null) sidebar.style.setProperty('--sidebar-w', savedSidebar + 'px');
    if (savedRight !== null) rightPanel.style.setProperty('--right-w', savedRight + 'px');

    const rL = document.createElement('div'); rL.className = 'ml-resizer'; rL.id = 'resizerLeft'; rL.title = '拖拽调整左侧栏宽度';
    const rR = document.createElement('div'); rR.className = 'ml-resizer'; rR.id = 'resizerRight'; rR.title = '拖拽调整右侧栏宽度';
    [
      [rL, '左侧章节目录宽度', 180, 520],
      [rR, '右侧 AI 助手宽度', 240, 640]
    ].forEach(([resizer, label, min, max]) => {
      resizer.setAttribute('role', 'separator');
      resizer.setAttribute('aria-orientation', 'vertical');
      resizer.setAttribute('aria-label', label);
      resizer.setAttribute('tabindex', '0');
      resizer.setAttribute('aria-valuemin', String(min));
      resizer.setAttribute('aria-valuemax', String(max));
    });
    main.insertBefore(rL, mainArea);
    main.insertBefore(rR, rightPanel);

    function attach(resizer, target, isLeft, min, max) {
      if (!target) return;
      const persistWidth = () => {
        const s = {}; try { Object.assign(s, JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}')); } catch (_) {}
        s[isLeft ? 'sidebar' : 'right'] = Math.round(target.getBoundingClientRect().width);
        try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(s)); } catch (_) {}
        resizer.setAttribute('aria-valuenow', String(s[isLeft ? 'sidebar' : 'right']));
      };
      const setWidth = width => {
        const next = clamp(width, min, max);
        target.style.setProperty(isLeft ? '--sidebar-w' : '--right-w', next + 'px');
        resizer.setAttribute('aria-valuenow', String(Math.round(next)));
      };
      resizer.addEventListener('pointerdown', e => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX;
        const startW = target.getBoundingClientRect().width;
        target.style.transition = 'none';
        main.classList.add('is-resizing');
        resizer.classList.add('is-dragging');
        const pointerId = e.pointerId;
        if (resizer.setPointerCapture && pointerId !== undefined) resizer.setPointerCapture(pointerId);
        const move = ev => {
          let dx = ev.clientX - startX;
          if (!isLeft) dx = -dx; // 右栏：分隔条在左边缘，左拖变宽
          setWidth(startW + dx);
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', up);
          target.style.transition = '';
          main.classList.remove('is-resizing');
          resizer.classList.remove('is-dragging');
          persistWidth();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
      });
      resizer.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        const delta = isLeft ? (e.key === 'ArrowRight' ? 16 : -16) : (e.key === 'ArrowLeft' ? 16 : -16);
        setWidth(target.getBoundingClientRect().width + delta);
        persistWidth();
      });
    }
    attach(rL, sidebar, true, 180, 520);
    attach(rR, rightPanel, false, 240, 640);
  }
  // 加载指定小说：切换state并重新渲染所有视图
  function loadNovel(id) {
    if (!novels[id]) return;
    invalidateAIRequests();
    currentId = id; state = novels[id];
    kgSelectedIds.clear();
    normalizeNovelState(state);
    ensureKnowledge();
    ensureReferenceMaterials();
    ensureOutlineChapters();
    ensureAdvancedState();
    recoverInterruptedAITasks();
    persist();
    recomputeChapterWords();
    applyTheme(state.settings.theme);
    renderTree(); renderEditor();
    renderAILog();
    renderSessionList();
    renderStatusBar();
    closeDrawers();
    refreshDissectionContext(); // ★ 阶段3 · 打开拆书衍生书时刷新动态上下文快照
  }
  function openLibrary() {
    const ids = Object.keys(novels);
    const rowHtml = ids.map(id => {
      const s = novels[id] || {};
      const vol = s.volumes || [];
      const words = vol.reduce((a, v) => a + v.chapters.reduce((b, ch) => b + ch.scenes.reduce((c, sc) => c + countWords(sc.content || ''), 0), 0), 0);
      const title = esc(s.title || '未命名小说');
      const cur = id === currentId;
      return '<div class="lib-row' + (cur ? ' is-current' : '') + '" data-id="' + id + '">' +
        '<div class="lib-row__main"><div class="lib-title"><span class="lib-name">' + title + '</span>' + (cur ? '<span class="lib-current-badge">当前</span>' : '') + '</div><div class="lib-meta">' + words + ' 字</div></div>' +
        '<div class="lib-actions">' +
        (cur ? '' : '<button class="lib-btn lib-btn--primary" data-act="open">打开</button>') +
        '<button class="lib-btn" data-act="rename">重命名</button>' +
        (ids.length > 1 ? '<button class="lib-btn lib-btn--danger" data-act="del">删除</button>' : '') +
        '</div></div>';
    }).join('');
    const html = '<h3 class="ml-modal__title">我的文库</h3><p class="ml-modal__hint">共 ' + ids.length + ' 本小说 · 点击「打开」切换</p>' +
      '<div class="lib-list">' + (ids.length ? rowHtml : '<div class="lib-empty">还没有小说，点击下方新建或导入</div>') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;">' +
      '<button class="tv-btn tv-btn--primary" style="flex:1" data-act="new">+ 新建小说</button>' +
      '<button class="tv-btn" style="flex:1" data-act="import">📥 导入小说（TXT/MD）</button>' +
      '<button class="tv-btn tv-btn--ghost" style="flex:1 0 100%" data-act="create-from-dissect">✨ 基于拆书结果创书（微创新）</button>' +
      '</div>';
    const modal = openModal(html, { wide: true });
    const list = modal.querySelector('.lib-list');
    if (list) list.onclick = e => {
      const row = e.target.closest('.lib-row'); if (!row) return;
      const id = row.dataset.id;
      const actBtn = e.target.closest('[data-act]');
      const act = actBtn ? actBtn.dataset.act : '';
      if (act === 'open') { loadNovel(id); closeModal(); toast('已切换到《' + (novels[id].title || '未命名小说') + '》'); }
      else if (act === 'rename') { startRename(row, id); }
      else if (act === 'del') { removeNovel(id); }
    };
    const newBtn = modal.querySelector('[data-act="new"]');
    if (newBtn) newBtn.onclick = () => newNovel();
    const impBtn = modal.querySelector('[data-act="import"]');
    if (impBtn) impBtn.onclick = () => { closeModal(); importNovel(); };
    const dissectBtn = modal.querySelector('[data-act="create-from-dissect"]');
    if (dissectBtn) dissectBtn.onclick = openCreateFromDissection;
  }
  function startRename(row, id) {
    const nameEl = row.querySelector('.lib-name'); if (!nameEl) return;
    nameEl.setAttribute('contenteditable', 'true'); nameEl.focus();
    const rg = document.createRange(); rg.selectNodeContents(nameEl); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
    const commit = () => {
      nameEl.removeAttribute('contenteditable');
      const v = nameEl.textContent.trim() || '未命名小说';
      if (novels[id]) { novels[id].title = v; if (novels[id].outline) novels[id].outline.book.title = v; }
      persist(); renderTree();
      nameEl.removeEventListener('blur', commit); nameEl.removeEventListener('keydown', keyh);
      toast('已重命名');
    };
    const keyh = e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } else if (e.key === 'Escape') { nameEl.textContent = (novels[id] && novels[id].title) || '未命名小说'; nameEl.blur(); } };
    nameEl.addEventListener('blur', commit); nameEl.addEventListener('keydown', keyh);
  }
  async function removeNovel(id) {
    const title = (novels[id] && novels[id].title) || '未命名小说';
    if (!(await confirmModal('确定删除小说《' + title + '》？此操作不可撤销。'))) return;
    const wasCurrent = id === currentId;
    delete novels[id];
    if (wasCurrent) {
      const ids = Object.keys(novels);
      if (ids.length) { currentId = ids[0]; loadNovel(currentId); }
      else { const nid = 'n_' + Date.now().toString(36); const ns = defaultState(); novels[nid] = ns; currentId = nid; state = ns; persist(); loadNovel(nid); }
    }
    // 同步删除云端
    removeCloud(id);
    persist(); openLibrary(); toast('已删除《' + title + '》');
  }
  function newNovel() {
    const nid = 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const s = defaultState();
    s.title = '未命名小说'; if (s.outline) s.outline.book.title = '未命名小说';
    s.volumes.forEach(v => v.chapters.forEach(ch => ch.scenes.forEach(sc => sc.content = '<p></p>')));
    s.currentChapterId = s.volumes[0].chapters[0].id; s.currentSceneId = s.volumes[0].chapters[0].scenes[0].id;
    novels[nid] = s; currentId = nid; state = s; persist();
    loadNovel(nid); closeModal(); toast('已新建小说');
  }

  /* ===================== 基于拆书结果创书（微创新） ===================== */
  // 选择已完成的拆书任务 → 设置新题材 + 微创新方向 → AI 生成新作品框架（保留原作节奏与结构）
  async function openCreateFromDissection() {
    if (!getToken()) { toast('请先登录后使用拆书创书'); return; }
    try {
      const data = await api('/api/dissections', 'GET');
      const tasks = (data.tasks || []).filter(t => t.status === 'completed' && t.hasResult);
      if (!tasks.length) {
        toast('暂无已完成的拆书结果，请先到「拆书分析」页面完成一次拆书');
        return;
      }
      const options = tasks.map(t => '<option value="' + esc(t.id) + '">' + esc(t.title) + '（' + number(t.wordCount) + ' 字 · ' + esc(t.depth || '') + '）</option>').join('');
      // ★ 创书理念（换皮微创新）：保留骨架、替换皮相；题材/章数/保留程度由用户选择
      const genreOptions = [
        ['__same__', '与原作一致（默认）'],
        ['男频玄幻', '男频玄幻'], ['男频都市', '男频都市'], ['男频科幻', '男频科幻'],
        ['男频悬疑', '男频悬疑'], ['男频仙侠', '男频仙侠'], ['男频游戏/无限流', '男频游戏/无限流'],
        ['女频古言', '女频古言'], ['女频现言', '女频现言'], ['女频玄幻', '女频玄幻'],
        ['__custom__', '自定义题材…']
      ].map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('');
      const chapterOptions = [10, 20, 30, 40, 50, 80].map(n => '<option value="' + n + '"' + (n === 20 ? ' selected' : '') + '>' + n + ' 章</option>').join('');
      const html =
        '<h3 class="ml-modal__title">基于拆书结果创书</h3>' +
        '<p class="ml-modal__hint">选择拆书任务后设置题材、章数与保留骨架程度。AI 会<strong>保留原书的开篇节奏、金手指机制、整体架构与节奏结构（只微创新）</strong>，把人物、地图、地名、势力、物品全部替换为原创设定。</p>' +
        '<div class="kg-form">' +
        '<label class="kg-field"><span>拆书结果</span><select id="ccDissectSelect">' + options + '</select></label>' +
        '<label class="kg-field"><span>新作品题材</span><select id="ccGenre">' + genreOptions + '</select><input id="ccGenreCustom" style="margin-top:6px;display:none" placeholder="输入自定义题材，例如：废土求生 / 赛博仙侠" value=""/></label>' +
        '<label class="kg-field"><span>保留骨架程度</span><select id="ccKeep">' +
        '<option value="skin" selected>换皮微创新（骨架几乎不变，仅换人物/地图/名称）</option>' +
        '<option value="adapt">适度改编（可微调开篇角度/配角/部分支线）</option>' +
        '<option value="big">大幅创新（可调整金手指细节与世界观，仍保留成长曲线）</option>' +
        '</select></label>' +
        '<label class="kg-field"><span>微创新方向（可选）</span><input id="ccDirection" placeholder="例如：主角身份改为满级大佬 / 金手指增加可交易限制 / 增加团队线" value=""/></label>' +
        '<label class="kg-field"><span>预生成章节数</span><select id="ccChapters">' + chapterOptions + '</select></label>' +
        '</div>' +
        '<div class="modal-foot" style="margin-top:14px;"><button class="tv-btn" id="ccCancel" type="button">取消</button><button class="tv-btn tv-btn--primary" id="ccCreate" type="button">生成新作品框架</button></div>';
      const modal = openModal(html, { wide: true });
      modal.querySelector('#ccCancel').onclick = closeModal;
      const genreSel = modal.querySelector('#ccGenre');
      const genreCustom = modal.querySelector('#ccGenreCustom');
      const syncGenreInput = () => { genreCustom.style.display = genreSel.value === '__custom__' ? '' : 'none'; };
      genreSel.addEventListener('change', syncGenreInput);
      modal.querySelector('#ccCreate').onclick = async () => {
        const id = modal.querySelector('#ccDissectSelect').value;
        let genre = genreSel.value;
        if (genre === '__same__') genre = '与原作一致';
        else if (genre === '__custom__') genre = genreCustom.value.trim();
        if (!genre) { toast('请选择或填写新作品题材'); return; }
        const keepLevel = modal.querySelector('#ccKeep').value;
        const direction = modal.querySelector('#ccDirection').value.trim();
        const chapterCount = Number(modal.querySelector('#ccChapters').value) || 20;
        const createBtn = modal.querySelector('#ccCreate');
        createBtn.disabled = true; createBtn.textContent = '正在生成框架…';
        try {
          const detail = await api('/api/dissections/' + encodeURIComponent(id), 'GET');
          const task = detail.task || {};
          const r = task.result || {};
          // ★ 阶段3 · 多阶段创书：第一步生成「可迁移创作简报 + 分卷/人物/伏笔规划」
          createBtn.textContent = '正在生成创作简报…';
          let brief = null;
          try {
            const briefRes = await api('/api/dissections/' + encodeURIComponent(id) + '/creative-brief', 'POST', { genre, direction, keepLevel });
            brief = (briefRes && briefRes.brief && briefRes.brief.brief) ? briefRes.brief : null;
          } catch (e) { toast('简报生成失败，改用直接框架模式'); }
          createBtn.textContent = '正在生成框架…';
          const dissectionBlock = brief
            ? '【可迁移创作简报】' + JSON.stringify(brief.brief) +
              '\n【分卷规划】' + JSON.stringify(brief.volumePlan || []) +
              '\n【人物规划】' + JSON.stringify(brief.characterPlan || []) +
              '\n【伏笔规划】' + JSON.stringify(brief.foreshadowPlan || []) +
              '\n【禁止复制项】' + JSON.stringify(brief.brief.forbiddenCopy || [])
            : ['【开篇节奏】' + JSON.stringify(r.opening || {}),
               '【金手指】' + JSON.stringify(r.goldenFinger || {}),
               '【文章架构】' + JSON.stringify(r.architecture || {}),
               '【创作技法】' + JSON.stringify((r.craftConstraints || []).slice(0, 12))].join('\n');
          const keepText = keepLevel === 'adapt'
            ? '保持整体架构与金手指成长逻辑，可微调开篇角度、配角设定与部分支线'
            : keepLevel === 'big'
              ? '保持核心成长曲线与节奏结构，可调整金手指细节与世界观设定'
              : '开篇节奏、金手指机制、整体架构与节奏结构基本保持一致，仅替换皮相并做微创新';
          const genreText = genre === '与原作一致' ? '与原作一致（完全保留骨架与题材，只换皮）' : ('用户选择题材：' + genre);
          const prompt = '你是一位资深网文架构师。基于下面的创作简报，为一部新小说生成完整创作框架。\n' +
            '要求：1) ' + genreText + '；2) ' + keepText + '；3) 人物、地名、势力、地图、物品全部替换为原创设定，严禁沿用任何"禁止复制项"，不得换字改名套用；4)' + (direction ? '微创新方向：' + direction : '在保留骨架前提下做适度微创新') + '。\n\n' +
            '创作简报：\n' + dissectionBlock + '\n\n' +
            '只输出 JSON，格式：{"title":"新书名","oneLine":"一句话简介","themes":["主题标签"],"volumeTitle":"第一卷名","volumeSynopsis":"卷纲摘要","chapters":[{"title":"章名","synopsis":"本章规划","mark":"伏笔/高潮/转折/空（四选一，可空）"}]}，共 ' + chapterCount + ' 个章节。';
          const genModel = currentUnifiedModel();
          const task2 = createAITask('创书 · ' + genre, genModel, 'chat', { kind: 'chat', text: prompt });
          let full = '';
          await streamChat({ model: genModel, thinking: state.settings.think, jsonMode: true, messages: [{ role: 'system', content: '你是网文架构师。只输出合法 JSON 对象（不要 Markdown 围栏、不要解释）。' }, { role: 'user', content: prompt }] }, {
            onStart: c => { bindAITaskController(task2, c); updateAITask(task2, { stage: '正在生成新作品框架', progress: 15 }); },
            onBilling: billing => updateAITaskBilling(task2, billing),
            onDelta: d => { full += d; },
            onDone: async (reason, usage) => {
              finishAITask(task2, reason, usage, { resultExcerpt: full.slice(0, 180) });
              if (reason === 'credit_exhausted') { toast('积分不足，创书已停止'); return; }
              const parsed = parseJSONSafe(full);
              if (!parsed || !parsed.title) { toast('生成结果解析失败，请重试'); createBtn.disabled = false; createBtn.textContent = '重新生成'; return; }
              const migrationPlan = brief
                ? {
                  brief: brief.brief || {},
                  volumePlan: Array.isArray(brief.volumePlan) ? brief.volumePlan : [],
                  characterPlan: Array.isArray(brief.characterPlan) ? brief.characterPlan : [],
                  foreshadowPlan: Array.isArray(brief.foreshadowPlan) ? brief.foreshadowPlan : []
                }
                : null;
              // ★ Q1 · 服务端持久化创作圣经（creationBook + Bible v1），失败不阻断本地创作
              let creationBookId = null;
              if (migrationPlan && getToken()) {
                try {
                  const cb = await api('/api/creation-books', 'POST', {
                    title: parsed.title || '未命名小说',
                    brief: migrationPlan,
                    sourceDissectionId: id,
                    genre
                  });
                  if (cb && cb.ok && cb.book && cb.book.id) creationBookId = cb.book.id;
                } catch (_) { toast('创作圣经云端保存失败，已回退本地模式'); }
              }
              const built = buildNovelFromDissection(parsed, task.title || '拆书来源', migrationPlan, creationBookId);
              closeModal();
              novels[built.id] = built.state; currentId = built.id; state = built.state; persist();
              loadNovel(built.id);
              toast('已基于拆书结果创建新书《' + (parsed.title || '未命名') + '》，可在「大纲」页查看框架');
            },
            onError: (e, meta) => { finishAITask(task2, 'error', null, { error: String(e) }); toast('生成失败：' + (e && e.message ? e.message : e)); createBtn.disabled = false; createBtn.textContent = '重新生成'; }
          });
        } catch (e) {
          toast(e && e.message ? e.message : '创书失败');
          createBtn.disabled = false; createBtn.textContent = '生成新作品框架';
        }
      };
    } catch (e) { toast(e && e.message ? e.message : '加载拆书结果失败'); }
  }
  // 把 AI 返回的创书框架组装成新小说 state（含大纲蓝图 + 卷章结构）
  function buildNovelFromDissection(parsed, sourceTitle, migrationPlan, creationBookId) {
    const nid = 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const s = defaultState();
    const title = String(parsed.title || '未命名小说').slice(0, 60);
    s.title = title;
    s.outline.book.title = title;
    s.outline.book.oneLine = String(parsed.oneLine || '').slice(0, 400);
    s.outline.book.themes = Array.isArray(parsed.themes) ? parsed.themes.map(String).filter(Boolean).slice(0, 10) : [];
    s.outline.volume.title = String(parsed.volumeTitle || '第一卷').slice(0, 60);
    s.outline.volume.synopsis = String(parsed.volumeSynopsis || '').slice(0, 2000);
    const plan = migrationPlan && typeof migrationPlan === 'object' ? migrationPlan : {};
    s.outline.volumePlan = Array.isArray(plan.volumePlan)
      ? plan.volumePlan.map((v, i) => ({
        volume: String(v && (v.volume || v.title) || ('第' + (i + 1) + '卷')).slice(0, 80),
        goal: String(v && v.goal || '').slice(0, 600),
        turningPoint: String(v && (v.turningPoint || v.turningPoints) || '').slice(0, 600),
        endingHook: String(v && v.endingHook || '').slice(0, 600)
      }))
      : [];
    s.outline.portableBlueprint = plan.brief && typeof plan.brief === 'object'
      ? {
        targetGenre: String(plan.brief.targetGenre || '').slice(0, 120),
        targetReader: String(plan.brief.targetReader || '').slice(0, 120),
        pacingModel: String(plan.brief.pacingModel || '').slice(0, 600),
        openingApproach: String(plan.brief.openingApproach || '').slice(0, 600),
        conflictEscalation: String(plan.brief.conflictEscalation || '').slice(0, 600),
        growthReward: String(plan.brief.growthReward || '').slice(0, 600),
        transferableStyle: Array.isArray(plan.brief.transferableStyle) ? plan.brief.transferableStyle.map(String).slice(0, 30) : []
      }
      : null;
    const chapters = Array.isArray(parsed.chapters) ? parsed.chapters.slice(0, 60) : [];
    // 组装卷章结构（正文留空）
    const vol = s.volumes[0];
    vol.title = s.outline.volume.title;
    vol.chapters = chapters.map((c, i) => {
      const chId = 'c' + (i + 1);
      const sceneId = chId + 's1';
      return {
        id: chId,
        title: String(c.title || ('第' + (i + 1) + '章')).slice(0, 80),
        sub: '',
        scenes: [{ id: sceneId, name: '场景一', content: '<p></p>' }]
      };
    });
    if (!vol.chapters.length) vol.chapters = [{ id: 'c1', title: '第1章', sub: '', scenes: [{ id: 'c1s1', name: '场景一', content: '<p></p>' }] }];
    // 大纲蓝图与卷章 1:1 对齐
    s.outline.chapters = vol.chapters.map((ch, i) => {
      const c = chapters[i] || {};
      return {
        num: ch.title,
        status: 'todo',
        title: String(c.title || '').slice(0, 80),
        synopsis: String(c.synopsis || '').slice(0, 1000),
        wordCount: 0,
        mark: ['伏笔', '高潮', '转折', '空'].includes(c.mark) ? c.mark : '',
        storyline: '主线'
      };
    });
    s.currentChapterId = vol.chapters[0].id;
    s.currentSceneId = vol.chapters[0].scenes[0].id;
    // 只迁移创作简报生成的原创计划；不把原书人物、伏笔、实体或拆书任务作为新书运行时上下文。
    if (plan && (Array.isArray(plan.foreshadowPlan) || Array.isArray(plan.characterPlan))) {
      if (!Array.isArray(s.foreshadows)) s.foreshadows = [];
      (Array.isArray(plan.foreshadowPlan) ? plan.foreshadowPlan : []).slice(0, 100).forEach((f, i) => {
        const plantIn = String(f && f.plantIn || '').trim().slice(0, 180);
        const payoffIn = String(f && f.payoffIn || '').trim().slice(0, 180);
        s.foreshadows.push({
          id: uid('fs'), title: String(f && f.title || '原创伏笔' + (i + 1)).slice(0, 40),
          description: String(f && f.desc || '').slice(0, 120),
          status: 'planned',
          strength: String(f && f.strength || 'medium'),
          plantedChapterId: '',
          targetChapterId: '', resolvedChapterId: '', clues: [], relatedEntityIds: [],
          notes: ['来自原创创作简报的伏笔规划，待作者在新书正文中落地。', plantIn ? '建议埋设：' + plantIn : '', payoffIn ? '建议回收：' + payoffIn : ''].filter(Boolean).join('；')
        });
      });
      if (!s.knowledge) s.knowledge = { entities: {}, edges: [], version: 1 };
      (Array.isArray(plan.characterPlan) ? plan.characterPlan : []).slice(0, 100).forEach((c, i) => {
        const name = String(c && c.name || ('原创角色' + (i + 1))).slice(0, 30);
        const entId = 'ent_' + nid + '_' + i;
        const attrs = [
          ['角色定位', c && c.role], ['核心目标', c && c.goal], ['人物缺陷', c && c.flaw], ['人物弧光', c && c.arc]
        ].filter(item => String(item[1] || '').trim()).map(item => ({ k: item[0], v: String(item[1]).slice(0, 500) }));
        s.knowledge.entities[entId] = {
          id: entId, name, type: 'character',
          aliases: [], parentId: '', attrs, notes: '来自原创创作简报的人物规划，正文生成时需以实际剧情为准。',
          status: '计划', currentLocation: '', owner: '', history: {}, createdAt: Date.now(), updatedAt: Date.now()
        };
      });
    }
    // 仅保留人工可见的来源说明，不保存原任务 ID，避免后续正文生成重新读取原书状态。
    s.dissectionSource = { title: String(sourceTitle || '').slice(0, 120), sourceType: 'creative-brief', createdAt: Date.now() };
    // ★ Q1 · 绑定服务端创作圣经：新书用 creationBookId 读取自己的 Bible / 状态快照（方案 6.2 / 11.3-3）
    s.creationBookId = String(creationBookId || '').slice(0, 80) || null;
    // 首版禁止复制清单：进入新书 outline，供本地原创审计（forbiddenCopyTerms）使用
    if (plan && plan.brief && Array.isArray(plan.brief.forbiddenCopy)) {
      s.outline.forbiddenCopy = plan.brief.forbiddenCopy.map(String).filter(Boolean).slice(0, 200);
    }
    s.dissectionContext = null;
    return { id: nid, state: s };
  }

  // ★ 阶段3 · 拆书动态上下文快照：基于拆书来源与当前章节，拉取"截至本章"的故事弧/人物状态/
  // 时间线/未回收伏笔，缓存到 state.dissectionContext 供 buildDynamicContext 注入续写提示词。
  // 章节切换时自动刷新（网络失败静默，不影响本地写作）。
  // ★ Q0 · 无 dissectionId（创意简报新书）：用本书状态构建本地快照，修复原「首行早退」死代码。
  function localDissectionContext() {
    const idx = currentChapterIndex();
    const oc = (state.outline && state.outline.chapters) ? (state.outline.chapters[idx] || {}) : {};
    const snapshot = {
      upTo: idx + 1,
      source: 'local',
      arcs: [],
      currentArc: null,
      characterStates: [],
      timeline: [],
      foreshadows: [],
      volume: null,
      bookMap: null
    };
    if (oc) snapshot.currentArc = {
      range: String(idx + 1),
      coreConflict: String(oc.storyline || '主线').slice(0, 120),
      protagonistGoal: String(oc.synopsis || '').slice(0, 240),
      turningPoints: [],
      endingHook: String(oc.mark || '').slice(0, 40)
    };
    if (state.knowledge && state.knowledge.entities) {
      snapshot.characterStates = Object.values(state.knowledge.entities)
        .filter(e => e && e.name)
        .slice(0, 20)
        .map(e => ({
          name: String(e.name),
          stage: String(e.status || 'active'),
          at: '第1-当前章',
          state: { statusChanges: (Array.isArray(e.attrs) ? e.attrs : []).map(a => String(a.k) + '=' + String(a.v)).slice(0, 8) }
        }));
    }
    snapshot.foreshadows = (state.foreshadows || [])
      .filter(f => !['resolved', 'abandoned'].includes(f.status))
      .slice(0, 30)
      .map(f => ({ id: String(f.id || ''), title: String(f.title || ''), description: String(f.description || ''), status: String(f.status || 'planned'), strength: String(f.strength || 'medium') }));
    snapshot.timeline = (state.chapterCalls || [])
      .filter(c => c && ['committed', 'committed_with_warnings'].includes(c.status))
      .slice(0, 12)
      .map(c => ({ chapterNo: String(c.chapterTitle || ''), title: String((c.result && c.result.excerpt) || '已完成').slice(0, 80) }));
    return snapshot;
  }
  let _dissectCtxPending = null;
  async function refreshDissectionContext() {
    const source = state && state.dissectionSource;
    if (!getToken()) return;
    const chapterNo = currentChapterIndex() + 1; // 1-based 章节号
    // ★ Q1 · 已绑定创作圣经：读取新书自己的 Bible / 状态快照（不读原书）
    if (state && state.creationBookId) {
      const pendingKey = 'book:' + state.creationBookId + ':' + chapterNo;
      if (_dissectCtxPending === pendingKey) return;
      _dissectCtxPending = pendingKey;
      try {
        const data = await api('/api/creation-books/' + encodeURIComponent(state.creationBookId) + '/state?chapterNo=' + chapterNo, 'GET');
        const bible = data && data.bible ? data.bible.payload : null;
        const snapshots = (data && Array.isArray(data.snapshots)) ? data.snapshots : [];
        const latest = snapshots[0] || null;
        const ctx = localDissectionContext();
        if (bible) {
          ctx.bibleVersion = bible.version;
          ctx.currentArc = ctx.currentArc || { range: String(chapterNo), coreConflict: String((bible.taskConstraints && bible.taskConstraints.genre) || '主线'), protagonistGoal: String((bible.bookPremise && bible.bookPremise.oneLine) || '').slice(0, 200), turningPoints: [], endingHook: '' };
          if (!ctx.foreshadows.length && Array.isArray(bible.foreshadowLedger)) {
            ctx.foreshadows = bible.foreshadowLedger.filter(f => f && f.status !== 'paid_off').slice(0, 30).map(f => ({ id: '', title: String(f.desc || '').slice(0, 40), description: String(f.desc || ''), status: 'planned', strength: String(f.strength || 'medium') }));
          }
        }
        if (latest) {
          ctx.upTo = latest.chapterNo || chapterNo;
          if (latest.characterStates && Object.keys(latest.characterStates).length) {
            ctx.characterStates = Object.entries(latest.characterStates).map(([name, st]) => ({ name, stage: 'active', at: '第1-' + latest.chapterNo + '章', state: st && typeof st === 'object' ? st : {} })).slice(0, 20);
          }
          if (Array.isArray(latest.timeline) && latest.timeline.length) ctx.timeline = latest.timeline.slice(0, 12);
          if (Array.isArray(latest.openForeshadows) && latest.openForeshadows.length) ctx.foreshadows = latest.openForeshadows.slice(0, 30);
        }
        state.dissectionContext = ctx;
        persist();
        renderPlotContext();
      } catch (_) {
        const ctx = localDissectionContext();
        if (ctx) { state.dissectionContext = ctx; persist(); renderPlotContext(); }
      } finally {
        if (_dissectCtxPending === pendingKey) _dissectCtxPending = null;
      }
      return;
    }
    if (!source || !source.dissectionId) {
      // ★ Q0 · 无原书上下文：构建本书本地快照（故事弧/人物状态/未回收伏笔/近期时间线）
      const ctx = localDissectionContext();
      if (ctx) { state.dissectionContext = ctx; persist(); renderPlotContext(); }
      return;
    }
    const pendingKey = source.dissectionId + ':' + chapterNo;
    if (_dissectCtxPending === pendingKey) return;
    _dissectCtxPending = pendingKey;
    try {
      const data = await api('/api/dissections/' + encodeURIComponent(source.dissectionId) + '/creation-context?chapterNo=' + chapterNo, 'GET');
      const ctx = data && data.context;
      if (ctx && ctx.characterStates !== undefined) {
        state.dissectionContext = ctx;
        persist();
        renderPlotContext();
      }
    } catch (_) {} finally {
      if (_dissectCtxPending === pendingKey) _dissectCtxPending = null;
    }
  }
  // 当前章节在卷内的 0-based 序号（动态上下文按章号拉取）
  function currentChapterIndex() {
    const vol = state && state.volumes && state.volumes[0];
    const ch = state && state.currentChapterId && vol && (vol.chapters || []).find(c => c.id === state.currentChapterId);
    return ch ? (vol.chapters || []).indexOf(ch) : 0;
  }

  /* ---------------- 单本小说导入（TXT/MD 自动分章） ---------------- */
  function uid(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // 正文多行 → HTML：非空行成段，段内保留换行
  function bodyLinesToHtml(lines) {
    return normalizeSceneContent((lines || []).join('\n'));
  }

  const RE_VOLUME = /^第\s*[0-9零〇一二两三四五六七八九十百千]+\s*(卷|部|篇)/;
  const RE_CHAPTER = /^第\s*[0-9零〇一二两三四五六七八九十百千]+\s*(章|回|节)/;
  const RE_CHAPTER_EN = /^chapter\s+[0-9]+/i;
  const RE_MD = /^(#{1,3})\s+(.*)$/;

  function detectHeading(line) {
    const t = (line || '').trim();
    if (!t) return null;
    const md = t.match(RE_MD);
    if (md) { const lvl = md[1].length; return { type: lvl === 1 ? 'h1' : lvl === 2 ? 'h2' : 'h3', title: (md[2] || '').trim() }; }
    if (RE_VOLUME.test(t)) return { type: 'volume', title: t };
    if (RE_CHAPTER.test(t)) return { type: 'chapter', title: t };
    if (RE_CHAPTER_EN.test(t)) return { type: 'chapter', title: t };
    return null;
  }
  function parseChapterHeading(title) {
    let m = title.match(/^(第[0-9零〇一二两三四五六七八九十百千]+\s*[章回节])\s*[：:．.。]?\s*(.*)$/);
    if (m) return { num: m[1], sub: (m[2] || '').trim() || m[1] };
    m = title.match(/^(chapter\s+[0-9]+)\s*[：:．.。]?\s*(.*)$/i);
    if (m) return { num: m[1], sub: (m[2] || '').trim() || m[1] };
    return { num: title, sub: title };
  }

  // 解析外部 TXT/MD 文本 → 一本小说 state（所有章节置于单卷，与 outline.chapters 1:1 对齐）
  function buildImportedNovel(text, filename) {
    const rawLines = (text || '').replace(/\r\n?/g, '\n').split('\n');
    let bookTitle = ((filename || '').replace(/\.[^.]+$/, '') || '').trim().replace(/[_\-]+/g, ' ') || '未命名小说';
    let firstHeading = false;
    const chapters = [];
    let cur = null, buf = [], volTitle = '第一卷';
    function flush() {
      if (!cur) return;
      const html = bodyLinesToHtml(buf) || '<p></p>';
      cur.html = html; cur.wordCount = countWords(html);
      chapters.push(cur); cur = null; buf = [];
    }
    for (const raw of rawLines) {
      const h = detectHeading(raw);
      if (h) {
        const t = h.title.trim();
        if (h.type === 'h1') {
          if (!firstHeading) { bookTitle = t || bookTitle; firstHeading = true; continue; }
          flush(); volTitle = t; cur = { num: t, sub: t, wordCount: 0 }; flush(); continue;
        }
        if (h.type === 'volume') { flush(); volTitle = t; cur = { num: t, sub: t, wordCount: 0 }; flush(); continue; }
        if (h.type === 'h3') { buf.push('### ' + t); continue; }
        flush();
        const p = parseChapterHeading(t);
        cur = { num: p.num, sub: p.sub, wordCount: 0 };
        continue;
      }
      buf.push(raw);
    }
    flush();
    if (!chapters.length) {
      const html = bodyLinesToHtml(buf) || '<p></p>';
      chapters.push({ num: '第1章', sub: '正文', html, wordCount: countWords(html) });
    }
    const s = defaultState();
    const vol = { id: uid('v'), title: volTitle, chapters: [] };
    const outlineChapters = [];
    chapters.forEach((c, i) => {
      const chId = uid('c'), sceneId = uid('s');
      vol.chapters.push({ id: chId, title: c.num, sub: c.sub, scenes: [{ id: sceneId, name: '场景一', content: c.html }] });
      outlineChapters.push({ num: c.num, status: i === 0 ? 'writing' : 'todo', title: c.sub, synopsis: '（从外部文件导入）', wordCount: c.wordCount });
    });
    s.volumes = [vol];
    s.outline.chapters = outlineChapters;
    s.outline.book.title = bookTitle;
    s.outline.book.oneLine = '从外部文件导入：' + (filename || bookTitle);
    s.outline.volume.title = volTitle;
    s.outline.volume.synopsis = '（从外部文件导入）';
    s.outline.volume.total = chapters.length;
    s.outline.volume.done = 0;
    s.title = bookTitle;
    s.currentChapterId = vol.chapters[0].id;
    s.currentSceneId = vol.chapters[0].scenes[0].id;
    s.history = []; s.aiMessages = [];
    s.sceneProps = { summary: '', elements: { characters: [], locations: [], items: [], plot: [] } };
    return { id: uid('n'), state: s };
  }

  async function extractImportedSources(sources, onProgress) {
    const usable = (sources || []).filter(x => x && String(x.text || '').trim());
    if (!usable.length) return { success: 0, total: 0 };
    const combined = usable.map(x => '===== 资料：' + x.name + ' =====\n' + x.text).join('\n\n');
    const chunks = chunkText(combined, 9000);
    const model = currentAIPanelModel();
    let success = 0;
    let stopped = false;
    toast('AI 抽取将使用当前模型「' + modelLabel(model) + '」，并按实际 Token 计费');
    for (let i = 0; i < chunks.length; i++) {
      if (onProgress) onProgress(i, chunks.length);
      if (chunks.length > 1) toast('正在自动抽取导入内容第 ' + (i + 1) + '/' + chunks.length + ' 段…');
      const result = await extractEntitiesFromTextP(chunks[i], '导入小说');
      if (result.ok) success++;
      if (onProgress) onProgress(i + 1, chunks.length);
      if (result.creditExhausted) { stopped = true; break; }
    }
    return { success, total: chunks.length, stopped, model };
  }

  async function importNovelFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => NOVEL_IMPORT_EXT.test(f.name));
    if (!files.length) { toast('没有可导入的 TXT 或 Markdown 文件'); return; }
    startImportProgress('正在导入正文与资料');
    try {
      const sources = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const rel = f.webkitRelativePath || f.name;
        try {
          const text = await readEditorTextFile(f);
          if (text && text.trim()) sources.push({ file: f, name: rel, text });
          importProgressStep(0, 24, i + 1, files.length, '正在读取正文与资料', '已读取 ' + (i + 1) + '/' + files.length + '：' + rel);
        } catch (_) {
          importProgressStep(0, 24, i + 1, files.length, '正在读取正文与资料', '读取失败，已跳过：' + rel);
        }
      }
      if (!sources.length) { finishImportProgress('正文导入失败', '文件为空或读取失败，未导入', true); toast('文件为空或读取失败，未导入'); return; }
      setImportProgress(28, '正在识别正文文件', '正在选择正文主文件并整理资料');
      const main = sources.slice().sort((a, b) => {
        const score = x => (/(正文|全文|novel|manuscript|chapter|第\s*[0-9一二三四五六七八九十]+\s*[章节回])/i.test(x.name) ? 100000000 : 0) + x.text.length;
        return score(b) - score(a);
      })[0];
      const built = buildImportedNovel(main.text, main.name);
      setImportProgress(34, '正在建立正文结构', '已识别《' + (built.state.title || '未命名小说') + '》· ' + built.state.volumes[0].chapters.length + ' 章');
      state = built.state; currentId = built.id; novels[built.id] = built.state;
      ensureReferenceMaterials();
      sources.filter(x => x !== main).forEach(x => addReferenceMaterial(x.name, x.text, classifyReferenceType(x.name, x.text)));
      addReferenceMaterial(main.name, main.text, 'manuscript');
      ensureReferenceMaterials();
      persist();
      loadNovel(built.id);
      toast('已导入《' + (state.title || '未命名小说') + '》· ' + state.volumes[0].chapters.length + ' 章，正在自动抽取人物/地点/设定…');
      const result = await extractImportedSources(sources.map(x => ({ name: x.name, text: x.text })), (current, total) => {
        importProgressStep(38, 57, current, total, '正在 AI 抽取正文与设定', '正在处理第 ' + Math.min(current + 1, total) + '/' + total + ' 段');
      });
      persist(); renderEditor(); renderSidebarSheji();
      const message = '导入完成：' + state.volumes[0].chapters.length + ' 章，自动抽取 ' + result.success + '/' + result.total + ' 段' + (result.stopped ? '，积分不足，已停止后续抽取' : '');
      const partial = !!result.stopped || (result.total > 0 && result.success < result.total);
      finishImportProgress(partial ? (result.stopped ? '正文已导入，AI 抽取已中断' : '正文与资料导入完成（部分抽取失败）') : '正文与资料导入完成', message, partial);
      toast(message);
    } catch (err) {
      const message = '正文导入失败：' + (err && err.message ? err.message : err);
      finishImportProgress('正文导入失败', message, true);
      toast(message);
    }
  }

  function importNovel() {
    const fileInput = $('novelFileInput');
    const folderInput = $('novelFolderInput');
    if (!fileInput || !folderInput) return;
    const importModelName = esc(modelLabel(currentAIPanelModel()));
    const html = '<h3 class="ml-modal__title">导入已有小说</h3>' +
      '<p class="ml-modal__hint">可选择多个正文 TXT/Markdown 文件，也可反复追加多个包含正文、人物卡、地图文字、世界观设定和大纲的文件夹。导入后会自动分章，并由当前模型 <b>' + importModelName + '</b> AI 抽取知识库；抽取按实际 Token 计费，积分不足会立即停止后续抽取。</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">' +
      '<button class="tv-btn tv-btn--ghost" id="chooseNovelFiles" type="button">选择多个正文/资料文件</button>' +
      '<button class="tv-btn tv-btn--ghost" id="chooseNovelFolder" type="button">追加资料文件夹</button></div>' +
      '<div id="novelImportList" style="max-height:180px;overflow:auto;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:8px;font-size:12px;color:#374151;"></div>' +
      '<div class="ml-modal__actions"><button class="tv-btn tv-btn--ghost" id="novelImportCancel" type="button">取消</button><button class="tv-btn tv-btn--primary" id="novelImportConfirm" type="button">导入并自动抽取</button></div>';
    const modal = openModal(html, { wide: true });
    const listBox = modal.querySelector('#novelImportList');
    let selected = [];
    const renderFiles = () => {
      listBox.innerHTML = selected.length ? '<b>已选 ' + selected.length + ' 个文件</b><br>' + selected.map(f => esc(f.webkitRelativePath || f.name)).join('<br>') : '<span style="color:#9ca3af;">尚未选择文件</span>';
    };
    const addFiles = list => {
      Array.from(list || []).forEach(f => { const key = f.webkitRelativePath || f.name; if (NOVEL_IMPORT_EXT.test(f.name) && !selected.some(x => (x.webkitRelativePath || x.name) === key)) selected.push(f); });
      renderFiles();
    };
    renderFiles();
    modal.querySelector('#chooseNovelFiles').onclick = () => { fileInput.value = ''; fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ''; }; fileInput.click(); };
    modal.querySelector('#chooseNovelFolder').onclick = () => { folderInput.value = ''; folderInput.onchange = () => { addFiles(folderInput.files); folderInput.value = ''; }; folderInput.click(); };
    modal.querySelector('#novelImportCancel').onclick = () => closeModal();
    modal.querySelector('#novelImportConfirm').onclick = async () => { if (!selected.length) { toast('请先选择正文或资料文件'); return; } closeModal(); await importNovelFiles(selected); };
  }

  /* ---------------- 文库整体导入 / 导出 ---------------- */
  function exportLibrary() {
    const data = { app: 'molan', version: 1, exportedAt: new Date().toISOString(), currentId, novels };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    const d = new Date(); const pad = n => String(n).padStart(2, '0');
    a.download = '墨阑文库_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已导出文库（' + Object.keys(novels).length + ' 本）');
  }
  function importLibrary() {
    const inp = $('libFileInput'); if (!inp) return;
    const folder = $('libFolderInput');
    const readText = readEditorTextFile;
    const openImport = async fileList => {
      const files = Array.from(fileList || []).filter(file => /\.json$/i.test(file.name || ''));
      if (!files.length) { toast('没有找到可导入的 JSON 文库文件'); return; }
      const imported = {};
      const errors = [];
      const currentIds = [];
      for (const file of files) {
        const name = file.webkitRelativePath || file.name;
        try {
          const data = JSON.parse(await readText(file));
          if (!data || !data.novels || typeof data.novels !== 'object') throw new Error('不是墨阑文库格式');
          Object.assign(imported, data.novels);
          if (data.currentId) currentIds.push(data.currentId);
        } catch (error) {
          errors.push(name + '：' + (error && error.message ? error.message : '解析失败'));
        }
      }
      const count = Object.keys(imported).length;
      if (!count) { toast('导入失败：没有有效的文库 JSON 文件' + (errors.length ? '（' + errors.join('；') + '）' : '')); return; }
      const summary = errors.length ? '；失败 ' + errors.length + ' 个' : '';
      const html = '<h3 class="ml-modal__title">导入文库</h3><p class="ml-modal__hint">已读取 ' + files.length + ' 个文件，检测到 ' + count + ' 本小说' + summary + '，请选择导入方式：</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<button class="tv-btn tv-btn--primary" data-mode="merge">合并：保留现有，追加导入的</button>' +
        '<button class="tv-btn" data-mode="replace">替换：清空现有，仅保留导入的</button>' +
        '<button class="tv-btn" data-mode="cancel">取消</button></div>' +
        (errors.length ? '<p class="ml-modal__hint" style="margin-top:10px;">未导入：' + esc(errors.join('；')) + '</p>' : '');
      const modal = openModal(html, { wide: true });
      modal.onclick = e => {
        const b = e.target.closest('[data-mode]'); if (!b) return;
        const mode = b.dataset.mode;
        if (mode === 'cancel') { closeModal(); return; }
        if (mode === 'replace') novels = imported;
        else novels = Object.assign({}, novels, imported);
        const preferredId = currentIds.find(id => novels[id]);
        currentId = preferredId || (currentId && novels[currentId] ? currentId : Object.keys(novels)[0]);
        persist();
        if (currentId && novels[currentId]) loadNovel(currentId); else { renderTree(); renderOutline(); }
        closeModal(); toast('已导入文库（' + Object.keys(novels).length + ' 本）' + (errors.length ? '，部分文件已跳过' : ''));
      };
    };
    const choose = input => {
      if (!input) return;
      input.value = '';
      input.onchange = () => { const files = Array.from(input.files || []); input.value = ''; void openImport(files); };
      input.click();
    };
    const modal = openModal('<h3 class="ml-modal__title">导入文库</h3><p class="ml-modal__hint">可选择多个文库 JSON 文件，或选择包含文库 JSON 的整个文件夹。</p><div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="tv-btn tv-btn--primary" data-library-pick="files">选择多个文件</button><button class="tv-btn" data-library-pick="folder">选择文件夹</button><button class="tv-btn" data-library-pick="cancel">取消</button></div>', { wide: false });
    modal.onclick = event => {
      const button = event.target.closest('[data-library-pick]'); if (!button) return;
      const action = button.dataset.libraryPick;
      if (action === 'cancel') { closeModal(); return; }
      closeModal();
      choose(action === 'folder' ? folder : inp);
    };
  }

  /* ---------------- 写作区：图片 / 分隔符 ---------------- */
  function insertImage() {
    if (editorContent) editorContent.focus();
    const modal = openModal('<h3 class="ml-modal__title">插入图片</h3>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
      '<label style="font-size:13px;color:#666;">图片链接（URL）</label>' +
      '<input id="imgUrl" type="text" placeholder="https://…" style="border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:14px;">' +
      '<div style="text-align:center;color:#999;font-size:12px;">或</div>' +
      '<label style="font-size:13px;color:#666;">从本机选择（可同时插入多张，图片会嵌入正文）</label>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
      '<label class="tv-btn tv-btn--ghost" style="cursor:pointer;">选择多个文件<input id="imgFile" type="file" accept="image/*" multiple hidden></label>' +
      '<label class="tv-btn tv-btn--ghost" style="cursor:pointer;">选择文件夹<input id="imgFolder" type="file" accept="image/*" webkitdirectory directory multiple hidden></label>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">' +
      '<button id="imgCancel" class="tv-btn">取消</button>' +
      '<button id="imgInsert" class="tv-btn tv-btn--primary">插入</button>' +
      '</div></div>', { wide: false });
    modal.querySelector('#imgCancel').onclick = closeModal;
    modal.querySelector('#imgInsert').onclick = async () => {
      const url = modal.querySelector('#imgUrl').value.trim();
      const files = Array.from(new Map([
        ...Array.from(modal.querySelector('#imgFile').files || []),
        ...Array.from(modal.querySelector('#imgFolder').files || [])
      ].map(file => [`${file.name}\u0000${file.size}\u0000${file.lastModified}`, file])).values());
      if (files.length) {
        const button = modal.querySelector('#imgInsert');
        button.disabled = true;
        try {
          const sources = await Promise.all(files.map(file => new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(new Error('图片读取失败'));
            fr.readAsDataURL(file);
          })));
          sources.forEach(source => doInsertImage(source, { silent: true }));
          closeModal();
          toast(`已插入 ${sources.length} 张图片`);
        } catch (error) {
          button.disabled = false;
          toast(error.message || '图片读取失败');
        }
      } else if (url) { doInsertImage(url); closeModal(); }
      else toast('请填写图片链接或选择文件');
    };
  }
  function insertBlockAtCaret(node) {
    if (!editorContent) return;
    editorContent.focus();
    const sel = window.getSelection();
    let range = null;
    if (sel && sel.rangeCount) { try { range = sel.getRangeAt(0); } catch (_) {} }
    if (range && editorContent.contains(range.startContainer)) {
      let block = range.startContainer;
      if (block.nodeType === 3) block = block.parentElement;
      while (block && block !== editorContent && !/^(P|DIV|H1|H2|H3|H4|BLOCKQUOTE|LI|PRE)$/.test(block.tagName)) block = block.parentElement;
      if (block && block !== editorContent) block.parentNode.insertBefore(node, block.nextSibling);
      else editorContent.appendChild(node);
    } else {
      editorContent.appendChild(node);
    }
    const r = document.createRange(); r.setStartAfter(node); r.collapse(true);
    const s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(r);
    setSceneContent(editorContent.innerHTML); updateWordCount(); debouncedSave();
  }
  function doInsertImage(src, options) {
    if (!editorContent) return;
    if (!isSafeEditorUrl(src, 'image')) { toast('图片链接不安全，仅支持 HTTPS 或常见图片 Data URL'); return; }
    const img = document.createElement('img');
    img.setAttribute('src', String(src).trim()); img.alt = 'image'; img.className = 'scene-img';
    insertBlockAtCaret(img);
    if (!options || !options.silent) toast('已插入图片');
  }
  function insertSeparator() {
    if (!editorContent) editorContent.focus();
    const sep = document.createElement('p');
    sep.className = 'scene-sep'; sep.textContent = '※ ※ ※';
    insertBlockAtCaret(sep);
    toast('已插入分隔符');
  }

  /* ---------------- 大纲拖拽排序 ---------------- */
  function reorderChapters(from, to) {
    const vol = state.volumes[0];
    const oc = state.outline.chapters;
    if (from < 0 || to < 0 || from >= vol.chapters.length || to >= oc.length || from === to) return;
    const a = vol.chapters.splice(from, 1)[0]; vol.chapters.splice(to, 0, a);
    const b = oc.splice(from, 1)[0]; if (b) oc.splice(to, 0, b);
    save(); renderEditor(); toast('已调整章节顺序');
  }

  /* ===================== 搜索替换 =====================
   * 在编辑器正文中按关键字查找匹配，支持上一个/下一个定位、
   * 单次替换与全部替换，并实时显示匹配计数。Ctrl+H 唤起。
   * ------------------------------------------------------------------ */
  let srMatches = [];      // 当前匹配位置数组
  let srCurrentIdx = -1;   // 当前高亮匹配索引

  function buildSearchCorpus(scope) {
    const rows = [];
    const chapters = state.volumes.flatMap(v => (v.chapters || []).map(ch => ({ chapter: ch, volume: v })));
    const addChapter = item => {
      const text = (item.chapter.scenes || []).map(s => htmlToText(s.content || '')).join('\n\n');
      rows.push({ kind: 'chapter', id: item.chapter.id, title: item.chapter.title + (item.chapter.sub ? ' · ' + item.chapter.sub : ''), meta: item.volume.title, text: text || '（空章节）' });
    };
    if (scope === 'chapter') {
      const cur = currentChapter();
      if (cur) addChapter({ chapter: cur, volume: state.volumes.find(v => (v.chapters || []).some(ch => ch.id === cur.id)) || state.volumes[0] });
    } else if (scope === 'book' || scope === 'all') chapters.forEach(addChapter);
    if (scope === 'resources' || scope === 'all') {
      ensureReferenceMaterials().forEach(item => rows.push({ kind: 'reference', id: item.id, title: item.name || '未命名资料', meta: item.type || '资料', text: item.text || '' }));
      entList().forEach(item => rows.push({ kind: 'entity', id: item.id, title: item.name, meta: entityTypeMeta(item.type).label + (entityPath(item) ? ' · ' + entityPath(item) : ''), text: entitySearchText(item) }));
      (state.inspirations || []).forEach(item => rows.push({ kind: 'inspiration', id: item.id, title: item.title || '未命名灵感', meta: '灵感卡片', text: (item.content || '') + ' ' + (item.tag || '') }));
      (state.aiReports || []).forEach(item => rows.push({ kind: 'report', id: item.id, title: item.chapterTitle || 'AI报告', meta: 'AI检测 · ' + (item.status || '未完成'), text: item.summary || '' }));
    }
    return rows;
  }
  function locateSearchHit(query, mode) {
    const raw = String(query || '').trim();
    if (!raw || !editorContent) return false;
    const tokens = Array.from(tokenize(raw)).sort((a, b) => b.length - a.length);
    const target = mode === 'related' ? (tokens[0] || raw) : raw;
    editorContent.focus();
    try {
      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();
      if (typeof window.find === 'function' && window.find(target, false, false, true)) return true;
    } catch (_) {}
    return false;
  }
  function renderSearchResults(rows, query, mode) {
    const holder = $('srResults'); if (!holder) return;
    if (!query) { holder.innerHTML = ''; return; }
    const qText = query.toLowerCase();
    const tokens = Array.from(tokenize(query));
    const scored = rows.map(row => {
      const hay = String(row.title + ' ' + row.meta + ' ' + row.text).toLowerCase();
      let score = 0;
      if (mode === 'related') tokens.forEach(token => { if (hay.includes(token)) score += token.length > 1 ? 2 : 1; });
      else if (hay.includes(qText)) score = 10 + (String(row.title).toLowerCase().includes(qText) ? 8 : 0);
      if (String(row.title).toLowerCase().includes(qText)) score += 5;
      return Object.assign({}, row, { score, excerpt: String(row.text || '').replace(/[\r\n]+/g, ' ').slice(0, 160) });
    }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    holder.innerHTML = scored.length ? scored.slice(0, 60).map(row => '<div class="sr-result" data-sr-kind="' + esc(row.kind) + '" data-sr-id="' + esc(row.id) + '"><div class="sr-result__title">' + esc(row.title) + '</div><div class="sr-result__meta"><span>' + esc(row.kind === 'chapter' ? '章节' : row.kind === 'entity' ? '设定' : row.kind === 'reference' ? '资料' : row.kind === 'report' ? 'AI报告' : '灵感') + '</span><span>' + esc(row.meta) + '</span></div><div class="sr-result__excerpt">' + esc(row.excerpt) + '</div></div>').join('') : '<div class="kg-empty">没有找到相关资源</div>';
    holder.querySelectorAll('[data-sr-kind]').forEach(item => item.onclick = () => {
      const row = scored.find(x => x.kind === item.dataset.srKind && x.id === item.dataset.srId); if (!row) return;
      if (row.kind === 'chapter') { gotoChapter(row.id); switchTab('writing'); setTimeout(() => locateSearchHit(query, mode), 0); }
      else if (row.kind === 'entity') openEntityModal(row.id);
      else if (row.kind === 'report') { const report = (state.aiReports || []).find(x => x.id === row.id); if (report) openAIReportModal(report); }
      else openModal('<h3 class="ml-modal__title">' + esc(row.title) + '</h3><p class="ml-modal__hint">' + esc(row.meta) + '</p><div class="resource-preview">' + esc(row.text || '暂无内容') + '</div>', { wide: true });
    });
  }
  // 执行搜索：当前章节可替换，其余范围返回可定位的资源结果。
  function srPerformSearch() {
    const keyword = $('srSearch') ? $('srSearch').value.trim() : '';
    const caseSensitive = $('srCaseSensitive') ? $('srCaseSensitive').checked : false;
    const scope = ($('srScope') && $('srScope').value) || 'chapter';
    const mode = ($('srMode') && $('srMode').value) || 'keyword';
    srMatches = [];
    srCurrentIdx = -1;
    const rows = buildSearchCorpus(scope);
    if (!keyword) {
      const cnt = $('srCount'); if (cnt) cnt.textContent = '0 / 0';
      renderSearchResults([], '', mode);
      return;
    }
    if (scope === 'chapter' && editorContent) {
      const text = editorContent.innerText || '';
      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        srMatches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
        if (match.index === regex.lastIndex) regex.lastIndex++;
      }
      if (srMatches.length > 0) { srCurrentIdx = 0; srHighlightMatch(); }
      const cnt = $('srCount'); if (cnt) cnt.textContent = (srCurrentIdx + 1) + ' / ' + srMatches.length;
    } else {
      const resultRows = rows.map(row => Object.assign({}, row, { score: 1 })).filter(row => row.text || row.title);
      renderSearchResults(resultRows, keyword, mode);
      const count = resultRows.filter(row => {
        const hay = String(row.title + ' ' + row.meta + ' ' + row.text).toLowerCase();
        return mode === 'related' ? Array.from(tokenize(keyword)).some(t => hay.includes(t)) : hay.includes(keyword.toLowerCase());
      }).length;
      const cnt = $('srCount'); if (cnt) cnt.textContent = count + ' 项资源';
    }
    ['srReplaceOne', 'srReplaceAll'].forEach(id => { const btn = $(id); if (btn) btn.disabled = scope !== 'chapter'; });
  }

  // 高亮当前匹配：通过 window.find 在编辑器中定位并选中关键字
  function srHighlightMatch() {
    if (srCurrentIdx < 0 || srCurrentIdx >= srMatches.length) return;
    const keyword = $('srSearch') ? $('srSearch').value : '';
    if (!keyword || !editorContent) return;

    editorContent.focus();
    const caseSensitive = $('srCaseSensitive') ? $('srCaseSensitive').checked : false;
    // 先清除既有选区，再调用 window.find 定位到下一处匹配
    try {
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      // window.find 在部分嵌入式 webview 中可能不可用，捕获异常以兼容
      if (typeof window.find === 'function') {
        // 多次调用以定位到当前索引
        for (let i = 0; i <= srCurrentIdx; i++) {
          if (!window.find(keyword, caseSensitive, false, true)) break;
        }
      }
    } catch (_) {}
  }

  // 初始化搜索替换：绑定输入框、复选框与按钮事件
  function initSearchReplace() {
    const srSearch = $('srSearch');
    const srCaseSensitive = $('srCaseSensitive');
    const srScope = $('srScope');
    const srMode = $('srMode');
    if (srSearch) {
      srSearch.addEventListener('input', srPerformSearch);
      if (srCaseSensitive) srCaseSensitive.addEventListener('change', srPerformSearch);
    }
    if (srScope) srScope.addEventListener('change', srPerformSearch);
    if (srMode) srMode.addEventListener('change', srPerformSearch);

    const srPrev = $('srPrev');
    if (srPrev) srPrev.addEventListener('click', () => {
      if (srMatches.length === 0) return;
      srCurrentIdx = (srCurrentIdx - 1 + srMatches.length) % srMatches.length;
      srHighlightMatch();
      const cnt = $('srCount'); if (cnt) cnt.textContent = (srCurrentIdx + 1) + ' / ' + srMatches.length;
    });

    const srNext = $('srNext');
    if (srNext) srNext.addEventListener('click', () => {
      if (srMatches.length === 0) return;
      srCurrentIdx = (srCurrentIdx + 1) % srMatches.length;
      srHighlightMatch();
      const cnt = $('srCount'); if (cnt) cnt.textContent = (srCurrentIdx + 1) + ' / ' + srMatches.length;
    });

    // 替换当前匹配：利用 execCommand 在光标处插入替换文本
    const srReplaceOne = $('srReplaceOne');
    if (srReplaceOne) srReplaceOne.addEventListener('click', () => {
      const replaceText = $('srReplace') ? $('srReplace').value : '';
      const keyword = $('srSearch') ? $('srSearch').value : '';
      if (!keyword || !editorContent) return;

      editorContent.focus();
      // 若当前未选中匹配，先定位到第一个
      const selObj = window.getSelection();
      if (!selObj || !selObj.toString()) {
        srCurrentIdx = 0;
        srHighlightMatch();
      }
      document.execCommand('insertText', false, replaceText);
      setSceneContent(editorContent.innerHTML);
      srPerformSearch();   // 重新搜索刷新匹配
      updateWordCount();
      debouncedSave();
    });

    // 全部替换：基于纯文本正则替换后回写编辑器
    const srReplaceAll = $('srReplaceAll');
    if (srReplaceAll) srReplaceAll.addEventListener('click', () => {
      const replaceText = $('srReplace') ? $('srReplace').value : '';
      const keyword = $('srSearch') ? $('srSearch').value : '';
      if (!keyword || !editorContent) return;

      const caseSensitive = $('srCaseSensitive') ? $('srCaseSensitive').checked : false;
      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);

      const text = editorContent.innerText || '';
      const replaced = text.replace(regex, replaceText);
      // 将替换后的纯文本按段落包成 <p> 写回
      const paras = replaced.split(/\n{1,}/).map(ln => '<p>' + esc(ln) + '</p>').join('');
      editorContent.innerHTML = paras || '<p></p>';
      setSceneContent(editorContent.innerHTML);
      srMatches = [];
      srCurrentIdx = -1;
      const cnt = $('srCount'); if (cnt) cnt.textContent = '0 / 0';
      updateWordCount();
      debouncedSave();
      toast('已替换全部匹配项');
    });
  }

  /* ===================== 回收站 =====================
   * 删除的卷/章节不直接清除，而是移入回收站并保留元数据，
   * 支持恢复到第一个卷末尾或永久删除。
   * ------------------------------------------------------------------ */
  // 将被删除项移入回收站，附加类型与删除时间戳
  function moveToRecycleBin(item, type) {
    if (!state.recycleBin) state.recycleBin = [];
    state.recycleBin.push({
      ...item,
      _type: type,           // 'chapter' 或 'volume'
      _deletedAt: new Date().toISOString(),
      _wordCount: type === 'chapter' ? chapterWordCount(item) : 0
    });
    persist();
  }

  // 渲染回收站列表：空时展示提示，有项时列出并可恢复/永久删除
  function renderRecycle() {
    const body = $('sbRecycleBody');
    if (!body) return;

    const items = state.recycleBin || [];
    if (items.length === 0) {
      body.innerHTML = '<div class="sidebar-empty-hint">回收站为空</div>';
      return;
    }

    body.innerHTML = items.map((item, idx) => {
      const title = item.title || (item._type === 'volume' ? '未命名卷' : '未命名章节');
      const typeLabel = item._type === 'volume' ? '卷' : '章节';
      const time = new Date(item._deletedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return '<div class="recycle-item">' +
        '<div class="recycle-item__title">' + esc(title) + '</div>' +
        '<div class="recycle-item__meta">' +
        '<span>' + typeLabel + '</span>' +
        '<span>' + (item._wordCount || 0) + '字</span>' +
        '<span>' + esc(time) + '</span>' +
        '</div>' +
        '<div class="recycle-item__actions">' +
        '<button class="recycle-btn" data-act="restore" data-idx="' + idx + '">恢复</button>' +
        '<button class="recycle-btn recycle-btn--danger" data-act="delete" data-idx="' + idx + '">永久删除</button>' +
        '</div></div>';
    }).join('');

    // 绑定恢复 / 永久删除按钮
    body.querySelectorAll('[data-act]').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const act = btn.dataset.act;
        if (act === 'restore') restoreFromRecycle(idx);
        else if (act === 'delete') permanentDelete(idx);
      };
    });
  }

  // 从回收站恢复：章节追加到第一个卷末尾，卷直接追加到 volumes
  function restoreFromRecycle(idx) {
    const item = state.recycleBin[idx];
    if (!item) return;

    if (item._type === 'chapter') {
      const vol = state.volumes[0];
      if (vol) {
        // 剥离回收站元数据字段
        const { _type, _deletedAt, _wordCount, ...chapter } = item;
        vol.chapters.push(chapter);
      }
    } else if (item._type === 'volume') {
      const { _type, _deletedAt, _wordCount, ...volume } = item;
      state.volumes.push(volume);
    }

    state.recycleBin.splice(idx, 1);
    persist();
    renderRecycle();
    renderTree();      // 刷新章节列表
    checkEmptyState();
    toast('已恢复');
  }

  // 永久删除：从回收站中彻底移除
  function permanentDelete(idx) {
    if (!state.recycleBin || !state.recycleBin[idx]) return;
    state.recycleBin.splice(idx, 1);
    persist();
    renderRecycle();
    toast('已永久删除');
  }

  /* ===================== AI 检测历史 =====================
   * 记录每次 AI 调用（续写/润色/聊天/剧情推演）的操作类型、模型、
   * 结果摘要与时间，最多保留 50 条，点击可展开详情。
   * ------------------------------------------------------------------ */
  function reportTarget(report) {
    const chapter = chapterById(report.chapterId);
    const scene = chapter && (chapter.scenes || []).find(s => s.id === report.sceneId);
    return { chapter, scene };
  }
  function simpleTextHash(value) {
    let hash = 2166136261;
    String(value || '').split('').forEach(ch => { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); });
    return (hash >>> 0).toString(16);
  }
  function reportScore(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  }
  function normalizeAIReport(data, report) {
    const source = data && typeof data === 'object' ? data : {};
    report.overallScore = reportScore(source.overallScore != null ? source.overallScore : source.overall);
    report.aiTraceScore = reportScore(source.aiTraceScore != null ? source.aiTraceScore : source.aiTrace);
    report.repetitionScore = reportScore(source.repetitionScore != null ? source.repetitionScore : source.repetition);
    report.pacingScore = reportScore(source.pacingScore != null ? source.pacingScore : source.pacing);
    report.consistencyScore = reportScore(source.consistencyScore != null ? source.consistencyScore : source.consistency);
    report.summary = String(source.summary || '').trim().slice(0, 3000);
    report.findings = Array.isArray(source.findings) ? source.findings.map(item => ({
      type: String(item && item.type || '建议').slice(0, 30),
      severity: String(item && item.severity || 'medium').slice(0, 12),
      quote: String(item && item.quote || '').slice(0, 300),
      suggestion: String(item && item.suggestion || item && item.fix || '').slice(0, 800)
    })).slice(0, 30) : [];
    return report;
  }
  function reportScoreHtml(label, value) {
    return '<div class="ai-report-score"><span>' + esc(label) + '</span><b>' + (value == null ? '—' : value) + '</b></div>';
  }
  function renderAIReportModal(modal, report) {
    const body = modal && modal.querySelector('#aiReportBody'); if (!body) return;
    const scoreHtml = '<div class="ai-report-scores">' + reportScoreHtml('综合', report.overallScore) + reportScoreHtml('AI 痕迹', report.aiTraceScore) + reportScoreHtml('重复度', report.repetitionScore) + reportScoreHtml('节奏', report.pacingScore) + reportScoreHtml('一致性', report.consistencyScore) + '</div>';
    const findings = report.findings && report.findings.length ? '<div class="ai-report-findings">' + report.findings.map(item => '<div class="ai-report-finding"><span class="ai-report-finding__type">' + esc(item.type) + '</span><span class="ai-report-finding__severity ai-report-finding__severity--' + esc(item.severity) + '">' + esc(item.severity) + '</span><div><div>' + esc(item.quote || '未提供原文片段') + '</div><p>' + esc(item.suggestion || '暂无建议') + '</p></div></div>').join('') + '</div>' : '<div class="cs-empty">未发现需要重点处理的表达问题。</div>';
    const revision = report.revisedText ? '<div class="ai-report-revision"><div class="ai-report-section-title">改写预览</div><div class="ai-report-revision__grid"><div><b>原文</b><pre>' + esc(report.sourceText || '') + '</pre></div><div><b>改写后</b><pre>' + esc(report.revisedText) + '</pre></div></div></div>' : '';
    body.innerHTML = '<div class="ai-report-meta"><span>' + esc(report.chapterTitle || '当前章节') + '</span><span>' + esc(report.model || '') + '</span><span>' + esc(new Date(report.createdAt || Date.now()).toLocaleString('zh-CN')) + '</span>' + (report.creditCost != null ? '<span>消耗 ' + formatCreditCost(report.creditCost) + ' 积分</span>' : '') + '</div>' +
      scoreHtml + (report.summary ? '<div class="ai-report-summary">' + esc(report.summary) + '</div>' : '') + '<div class="ai-report-section-title">检测建议</div>' + findings + revision +
      '<div class="ml-modal__actions"><button class="tv-btn tv-btn--ghost" id="aiReportRecheck" type="button">复检当前正文</button><button class="tv-btn" id="aiReportRewrite" type="button">' + (report.revisedText ? '重新去 AI 味' : '一键去 AI 味') + '</button>' + (report.revisedText && report.status !== 'accepted' ? '<button class="tv-btn tv-btn--primary" id="aiReportAccept" type="button">接受改写</button>' : '') + (report.status === 'accepted' ? '<button class="tv-btn tv-btn--ghost" id="aiReportUndo" type="button">撤销改写</button>' : '') + '<button class="tv-btn tv-btn--ghost" id="aiReportClose" type="button">关闭</button></div>';
    const close = modal.querySelector('#aiReportClose'); if (close) close.onclick = closeModal;
    const rewrite = modal.querySelector('#aiReportRewrite'); if (rewrite) rewrite.onclick = () => rewriteAIReport(report.id, modal);
    const accept = modal.querySelector('#aiReportAccept'); if (accept) accept.onclick = () => acceptAIReportRevision(report.id, modal);
    const undo = modal.querySelector('#aiReportUndo'); if (undo) undo.onclick = () => undoAIReportRevision(report.id, modal);
    const recheck = modal.querySelector('#aiReportRecheck'); if (recheck) recheck.onclick = () => {
      const target = reportTarget(report);
      if (target.chapter && target.scene) { state.currentChapterId = target.chapter.id; state.currentSceneId = target.scene.id; renderTree(); renderEditor(); }
      closeModal(); setTimeout(runAIChapterReport, 0);
    };
  }
  function openAIReportModal(report) {
    if (!report) return;
    const html = '<h3 class="ml-modal__title">章节 AI 检测报告</h3><p class="ml-modal__hint">报告只作为编辑辅助，不替代作者判断。改写结果先进入预览，确认后才会写回正文。</p><div id="aiReportBody"><div class="cs-loading">加载中…</div></div>';
    const modal = openModal(html, { wide: true });
    renderAIReportModal(modal, report);
  }
  async function runAIChapterReport() {
    const requestSession = sessionIdentity();
    const chapter = currentChapter(), scene = currentScene();
    const sourceText = htmlToText(scene && scene.content || '').trim();
    if (!sourceText) { toast('当前场景正文为空'); return; }
    const report = { id: uid('report'), chapterId: chapter.id, sceneId: scene.id, chapterTitle: chapter.title, model: currentAIPanelModel(), createdAt: Date.now(), status: 'running', sourceText, sourceHash: simpleTextHash(sourceText), findings: [], revisedText: '' };
    const task = createAITask('章节 AI 检测', report.model, 'chat', { kind: 'report' });
    report.taskId = task.id;
    const html = '<h3 class="ml-modal__title">章节 AI 检测</h3><p class="ml-modal__hint">正在检查模板化表达、重复、节奏和设定一致性。检测会按当前模型实际 Token 计费。</p><div id="aiReportBody"><div class="cs-loading">正在分析…</div></div>';
    const modal = openModal(html, { wide: true });
    let full = '';
    const system = await buildSystemReady('你是中文小说编辑与 AI 文本检测助手。请只分析当前章节正文，不要凭空添加设定。输出 JSON，不要 Markdown 代码块：{\"overallScore\":0-100,\"aiTraceScore\":0-100,\"repetitionScore\":0-100,\"pacingScore\":0-100,\"consistencyScore\":0-100,\"summary\":\"简短总评\",\"findings\":[{\"type\":\"模板化|重复|节奏|一致性|表达\",\"severity\":\"high|medium|low\",\"quote\":\"原文片段\",\"suggestion\":\"可执行修改建议\"}]}。分数越高表示问题越明显；没有问题时 findings 为空。');
    if (sessionIdentity() !== requestSession) return;
    if (!system) { finishAITask(task, 'error', null, { error: 'Skill 尚未加载完成' }); closeModal(); return; }
    const user = '【当前章节】' + chapter.title + '\\n【正文】\\n' + sourceText;
    streamChat({ model: report.model, thinking: false, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, {
      onStart: c => { bindAITaskController(task, c); updateAITask(task, { stage: '正在分析章节', progress: 8 }); },
      onBilling: billing => updateAITaskBilling(task, billing),
      onDelta: d => { full += d; const body = modal.querySelector('#aiReportBody'); if (body) body.innerHTML = '<div class="cs-loading">正在分析… ' + full.length + ' 字</div><pre class="ai-report-raw">' + esc(full) + '</pre>'; },
      onDone: (reason, usage) => {
        report.status = reason === 'credit_exhausted' ? 'failed' : (reason === 'abort' ? 'aborted' : 'completed');
        report.creditCost = usage && usage.creditCost != null ? Number(usage.creditCost) : null;
        report.usage = usage || null;
        if (report.status === 'completed') normalizeAIReport(parseJSONSafe(full) || { summary: full.slice(0, 1000) }, report);
        else report.summary = report.status === 'failed' ? '积分不足，检测未完成' : '检测已中断';
        state.aiReports = state.aiReports || [];
        state.aiReports.unshift(report);
        if (state.aiReports.length > 30) state.aiReports = state.aiReports.slice(0, 30);
        finishAITask(task, reason, usage, { resultExcerpt: report.summary || full.slice(0, 180) });
        save(); logAICall('章节 AI 检测', report.model, usage, report.summary || full); renderAIDetect();
        if (report.status === 'completed') renderAIReportModal(modal, report); else {
          const body = modal.querySelector('#aiReportBody'); if (body) body.innerHTML = '<div class="cs-empty">' + esc(report.summary) + '</div><div class="ml-modal__actions"><button class="tv-btn tv-btn--ghost" id="aiReportClose" type="button">关闭</button></div>';
          const close = modal.querySelector('#aiReportClose'); if (close) close.onclick = closeModal;
        }
      },
      onError: (e, meta) => {
        report.status = meta && meta.code === 'credit_exhausted' ? 'failed' : 'error';
        report.summary = String(e && e.message || e || '检测失败');
        finishAITask(task, report.status === 'failed' ? 'credit_exhausted' : 'error', null, { error: report.summary });
        state.aiReports = state.aiReports || []; state.aiReports.unshift(report); save();
        renderAIDetect();
        const body = modal.querySelector('#aiReportBody'); if (body) body.innerHTML = '<div class="cs-empty">检测失败：' + esc(report.summary) + '</div><div class="ml-modal__actions"><button class="tv-btn tv-btn--ghost" id="aiReportClose" type="button">关闭</button></div>';
        const close = modal.querySelector('#aiReportClose'); if (close) close.onclick = closeModal;
      }
    });
  }
  async function rewriteAIReport(id, modal) {
    const requestSession = sessionIdentity();
    const report = (state.aiReports || []).find(x => x.id === id); if (!report || !report.sourceText) return;
    const body = modal && modal.querySelector('#aiReportBody'); if (body) body.innerHTML = '<div class="cs-loading">正在去 AI 味…</div>';
    let revised = '';
    const system = await buildSystemReady('你是中文小说责任编辑。根据检测报告改写正文，降低模板化和机械重复表达，保留事实、人物关系、情节顺序和作者原意。只输出改写后的正文，不要解释，不要标题。');
    if (!system || sessionIdentity() !== requestSession) return;
    const user = '【检测报告】\\n' + (report.summary || '') + '\\n' + (report.findings || []).map(x => x.type + '：' + x.suggestion).join('\\n') + '\\n\\n【原文】\\n' + report.sourceText;
    const model = currentAIPanelModel(); report.rewriteModel = model;
    const characterMaterial = buildCharacterMaterialRequest(user, { proseTask: true });
    const task = createAITask('去 AI 味', model, 'body', { kind: 'rewrite', reportId: report.id });
    streamSkillPipeline({ model, thinking: false, correction: true, skillMode: 'write', characterMaterial, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, {
      onStart: c => { bindAITaskController(task, c); updateAITask(task, { stage: '正在生成改写预览', progress: 8 }); },
      onBilling: billing => updateAITaskBilling(task, billing),
      onDelta: d => { revised += d; if (body) body.innerHTML = '<div class="cs-loading">正在去 AI 味… ' + revised.length + ' 字</div><pre class="ai-report-raw">' + esc(revised) + '</pre>'; },
      onDone: (reason, usage) => {
        if (reason === 'credit_exhausted' || reason === 'abort') { finishAITask(task, reason, usage, { resultExcerpt: revised.slice(0, 180) }); if (body) body.innerHTML = '<div class="cs-empty">' + (reason === 'credit_exhausted' ? '积分不足，改写未完成' : '已中断') + '</div>'; return; }
        if (reason === 'material_overlap' || (usage && usage.characterMaterial && usage.characterMaterial.blocked)) {
          report.revisedText = '';
          report.rewriteStatus = 'blocked';
          report.rewriteCreditCost = usage && usage.creditCost != null ? Number(usage.creditCost) : null;
          report.updatedAt = Date.now();
          finishAITask(task, 'material_overlap', usage, { resultExcerpt: '素材原创性审计未通过，改写结果未提供' });
          save();
          if (body) body.innerHTML = '<div class="cs-empty">人物素材原创性审计未通过，改写结果已阻止接受。请调整人物素材模式后重试。</div>';
          return;
        }
        report.revisedText = revised.trim(); report.rewriteStatus = 'preview'; report.rewriteCreditCost = usage && usage.creditCost != null ? Number(usage.creditCost) : null; report.updatedAt = Date.now();
        finishAITask(task, reason, usage, { resultExcerpt: report.revisedText.slice(0, 180) });
        save(); logAICall('去 AI 味', model, usage, report.revisedText); renderAIReportModal(modal, report);
      },
      onError: (e, meta) => { finishAITask(task, meta && meta.code === 'credit_exhausted' ? 'credit_exhausted' : 'error', null, { error: String(e) }); if (body) body.innerHTML = '<div class="cs-empty">改写失败：' + esc(String(e && e.message || e)) + '</div>'; }
    });
  }
  async function acceptAIReportRevision(id, modal) {
    const report = (state.aiReports || []).find(x => x.id === id); if (!report || !report.revisedText) return;
    const target = reportTarget(report);
    if (!target.scene) { toast('原章节已不存在'); return; }
    const currentText = htmlToText(target.scene.content || '');
    if (report.sourceHash && report.sourceHash !== simpleTextHash(currentText) && !(await confirmModal('检测后正文已有修改，接受改写会覆盖当前场景，是否继续？'))) return;
    target.scene.content = textToParas(report.revisedText);
    report.status = 'accepted'; report.acceptedAt = Date.now(); report.acceptedText = report.revisedText; report.updatedAt = Date.now();
    save({ snapshot: true }); renderEditor(); renderTree(); renderAIReportModal(modal, report); toast('已接受去 AI 味结果');
  }
  async function undoAIReportRevision(id, modal) {
    const report = (state.aiReports || []).find(x => x.id === id); if (!report || report.status !== 'accepted' || !report.sourceText) return;
    const target = reportTarget(report);
    if (!target.scene) { toast('原章节已不存在'); return; }
    const currentText = htmlToText(target.scene.content || '');
    if (report.acceptedText && simpleTextHash(currentText) !== simpleTextHash(report.acceptedText) && !(await confirmModal('当前正文在接受改写后又有修改，撤销会恢复检测前版本，是否继续？'))) return;
    target.scene.content = textToParas(report.sourceText);
    report.status = 'reverted'; report.revertedAt = Date.now(); report.updatedAt = Date.now();
    save({ snapshot: true }); renderEditor(); renderTree(); renderAIReportModal(modal, report); toast('已撤销去 AI 味改写');
  }
  // 记录一次 AI 调用到 aiCallLog（最新在前）。ctxMeta 可选：{chars, blocks, ignoredEntities} 展示每次调用注入的上下文规模
  function logAICall(opType, model, usage, result, ctxMeta) {
    if (!state.aiCallLog) state.aiCallLog = [];
    const exact = usage && usage.totalTokens != null;
    const ctx = ctxMeta && typeof ctxMeta === 'object' ? ctxMeta : null;
    state.aiCallLog.unshift({
      op: opType,
      model: model,
      tokens: exact ? Number(usage.totalTokens) : null,
      promptTokens: exact && usage.promptTokens != null ? Number(usage.promptTokens) : null,
      completionTokens: exact && usage.completionTokens != null ? Number(usage.completionTokens) : null,
      reasoningTokens: exact && usage.reasoningTokens != null ? Number(usage.reasoningTokens) : null,
      cachedTokens: exact && usage.cachedTokens != null ? Number(usage.cachedTokens) : null,
      cacheWriteTokens: exact && usage.cacheWriteTokens != null ? Number(usage.cacheWriteTokens) : null,
      usageSource: usage && usage.usageSource ? usage.usageSource : 'unavailable',
      usageStatus: usage && usage.status ? usage.status : 'usage_unavailable',
      skillAuditStatus: usage && usage.skillAudit ? usage.skillAudit.status : 'not-recorded',
      skillForwardingStatus: usage && usage.skillAudit && usage.skillAudit.forwarding ? usage.skillAudit.forwarding.status : 'not-recorded',
      correctionAudit: usage && (usage.correctionAudit || (usage.skillAudit && usage.skillAudit.correctionAudit)) || null,
      creditCost: usage && usage.creditCost != null ? Number(usage.creditCost) : null,
      requestId: usage && usage.requestId ? usage.requestId : '',
      contextChars: ctx && Number.isFinite(ctx.chars) ? Number(ctx.chars) : null,
      contextBlocks: ctx && Number.isFinite(ctx.blocks) ? Number(ctx.blocks) : null,
      ignoredEntities: ctx && Number.isFinite(ctx.ignoredEntities) ? Number(ctx.ignoredEntities) : null,
      time: new Date().toISOString(),
      excerpt: (result || '').slice(0, 200)
    });
    if (state.aiCallLog.length > 50) state.aiCallLog = state.aiCallLog.slice(0, 50);
    persist();
    // 若当前停留在AI检测标签，自动刷新列表
    var activeTab = document.querySelector('.sidebar-tab.is-active');
    if (activeTab && activeTab.dataset.tab === 'aidetect') {
      renderAIDetect();
    }
  }

  // 渲染 AI 检测历史列表：空时展示提示，有记录时列出操作/模型/摘要
  function renderAIDetect() {
    const body = $('sbAIDetectBody');
    if (!body) return;

    const logs = state.aiCallLog || [];
    const reports = state.aiReports || [];
    let html = '<div class="aidetect-toolbar"><button class="tv-btn tv-btn--primary tv-btn--block" id="runAIChapterReport" type="button">检测当前章节</button><div class="aidetect-toolbar__hint">章节检测、去 AI 味和复检都会保留版本记录。</div></div>';
    if (reports.length) {
      html += '<div class="aidetect-section-title">章节报告（' + reports.length + '）</div><div class="ai-report-list">' + reports.map(report => {
        const score = report.overallScore == null ? '未完成' : '综合 ' + report.overallScore;
        const status = report.status === 'accepted' ? '已接受改写' : report.status === 'reverted' ? '已撤销改写' : report.status === 'completed' ? '已完成' : (report.status === 'failed' ? '积分不足' : '未完成');
        return '<div class="ai-report-list__item" data-report-id="' + esc(report.id) + '"><div class="ai-report-list__head"><strong>' + esc(report.chapterTitle || '当前章节') + '</strong><span>' + esc(score) + '</span></div><div class="ai-report-list__meta"><span>' + esc(status) + '</span><span>' + esc(report.model || '') + '</span><span>' + esc(new Date(report.createdAt || Date.now()).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</span></div><div class="ai-report-list__summary">' + esc(report.summary || '点击查看检测报告') + '</div></div>';
      }).join('') + '</div>';
    }
    if (logs.length) html += '<div class="aidetect-section-title">AI 调用明细（最近 ' + Math.min(logs.length, 30) + ' 条）</div>';
    if (logs.length) html += logs.slice(0, 30).map((log, idx) => {
      const time = new Date(log.time).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return '<div class="aidetect-item" data-idx="' + idx + '">' +
        '<div class="aidetect-item__head">' +
        '<span class="aidetect-item__op">' + esc(log.op) + '</span>' +
        '<span class="aidetect-item__time">' + esc(time) + '</span>' +
        '</div>' +
        '<div class="aidetect-item__meta">' +
        '<span>' + esc(log.model) + '</span>' +
        '<span>' + (log.tokens == null ? 'usage unavailable' : log.tokens + ' tokens') + '</span>' +
        (log.contextChars != null ? '<span title="本次注入的上下文规模（节点级上下文隔离）">上下文 ' + fmtSize(log.contextChars) + (log.contextBlocks != null ? ' · ' + log.contextBlocks + ' 块' : '') + (log.ignoredEntities != null ? ' · 忽略 ' + log.ignoredEntities + ' 条设定' : '') + '</span>' : '') +
        (log.creditCost == null ? '' : '<span>' + formatCreditCost(log.creditCost) + ' 积分</span>') +
        '</div>' +
        '<div class="aidetect-item__detail">' + esc(log.excerpt) + '</div>' +
        '</div>';
    }).join('');
    if (!reports.length && !logs.length) html += '<div class="sidebar-empty-hint">暂无AI检测报告或调用记录</div>';
    body.innerHTML = html;
    const run = body.querySelector('#runAIChapterReport'); if (run) run.onclick = runAIChapterReport;
    body.querySelectorAll('[data-report-id]').forEach(item => item.onclick = () => {
      const report = reports.find(x => x.id === item.dataset.reportId); if (report) openAIReportModal(report);
    });

    // 点击展开/收起详情
    body.querySelectorAll('.aidetect-item').forEach(item => {
      item.onclick = () => item.classList.toggle('is-expanded');
    });
  }

  /* ===================== 空状态 =====================
   * 当当前卷没有任何章节时，展示空状态引导并隐藏格式栏/编辑区/头部。
   * ------------------------------------------------------------------ */
  function checkEmptyState() {
    const emptyState = $('editorEmptyState');
    if (!emptyState) return;
    const vol = state.volumes[0];
    const hasChapters = !!(vol && vol.chapters && vol.chapters.length > 0);
    emptyState.hidden = hasChapters;
    const formatBar = $('formatBar');
    const editorScroll = q('.editor-scroll');
    const areaHeader = q('.editor-area-header');
    if (formatBar) formatBar.style.display = hasChapters ? '' : 'none';
    if (editorScroll) editorScroll.style.display = hasChapters ? '' : 'none';
    if (areaHeader) areaHeader.style.display = hasChapters ? '' : 'none';
  }

  /* ---------------- 启动 ---------------- */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
