/* ===================== 马良写作 Clone · 前端逻辑 ===================== */
'use strict';

const STORE_KEY = 'maliang_clone_books_v1';

const $ = id => document.getElementById(id);
const editor = $('editor');
const chapterTitleEl = $('chapterTitle');
const chatLog = $('chatLog');
const wordCountEl = $('wordCount');
const stopBtn = $('stopBtn');
const resultBox = $('resultBox');
const resultText = $('resultText');
const resultTitle = $('resultTitle');

/* ---------- 状态 ---------- */
let state = { books: [], currentBookId: null, currentChapterId: null };
let activeController = null;   // 当前流式请求控制器
let savedRange = null;         // 润色/改写时保存的选区
let chatHistory = [];           // 当前本书的对话历史

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch (_) {}
  if (!state.books || !state.books.length) seedDemo();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
}
function seedDemo() {
  const b = { id: uid(), title: '我的第一部小说', premise: '', outline: '', worldSetting: '', chapters: [] };
  const c = { id: uid(), title: '第一章 觉醒', content: '<p>夜色如墨，少年林霄在破旧的院落里睁开了眼。记忆如潮水般涌来——这一世，他不愿再做任人宰割的废脉之人。</p>' };
  b.chapters.push(c);
  state.books.push(b);
  state.currentBookId = b.id;
  state.currentChapterId = c.id;
  save();
}

/* ---------- 取值辅助 ---------- */
const currentBook = () => state.books.find(b => b.id === state.currentBookId) || null;
const currentChapter = () => {
  const b = currentBook(); if (!b) return null;
  return b.chapters.find(c => c.id === state.currentChapterId) || null;
};
const editorText = () => (editor.innerText || '').replace(/\n+$/, '');
const modelVal = () => $('modelSelect').value;

/* ---------- 渲染 ---------- */
function renderBooks() {
  const ul = $('bookList'); ul.innerHTML = '';
  state.books.forEach(b => {
    const li = document.createElement('li');
    li.className = b.id === state.currentBookId ? 'active' : '';
    li.innerHTML = `<span>${escapeHtml(b.title)}</span><span class="badge">${b.chapters.length}章</span>`;
    li.onclick = () => selectBook(b.id);
    ul.appendChild(li);
  });
}
function renderChapters() {
  const ul = $('chapterList'); ul.innerHTML = '';
  const b = currentBook();
  if (!b) return;
  b.chapters.forEach(c => {
    const li = document.createElement('li');
    li.className = c.id === state.currentChapterId ? 'active' : '';
    li.textContent = c.title || '未命名章节';
    li.onclick = () => selectChapter(c.id);
    ul.appendChild(li);
  });
}
function renderAll() { renderBooks(); renderChapters(); }

function selectBook(id) {
  state.currentBookId = id;
  const b = currentBook();
  state.currentChapterId = b && b.chapters.length ? b.chapters[0].id : null;
  chatHistory = b && b.chat ? b.chat.slice() : [];
  loadChapterIntoEditor();
  renderAll();
  save();
}
function selectChapter(id) {
  saveCurrentChapter();
  state.currentChapterId = id;
  loadChapterIntoEditor();
  renderChapters();
}
function loadChapterIntoEditor() {
  const c = currentChapter();
  if (!c) { chapterTitleEl.value = ''; editor.innerHTML = ''; updateWordCount(); return; }
  chapterTitleEl.value = c.title || '';
  editor.innerHTML = c.content || '';
  updateWordCount();
}

/* ---------- 字数 & 保存 ---------- */
function updateWordCount() {
  const n = (editor.innerText || '').replace(/\s/g, '').length;
  wordCountEl.textContent = n + ' 字';
}
let saveTimer = null;
function saveCurrentChapter() {
  const c = currentChapter();
  if (!c) return;
  c.title = chapterTitleEl.value;
  c.content = editor.innerHTML;
}
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveCurrentChapter(); save(); }, 400);
}
editor.addEventListener('input', () => { updateWordCount(); debouncedSave(); });
chapterTitleEl.addEventListener('input', debouncedSave);

/* ---------- 新建 ---------- */
$('newBookBtn').onclick = () => {
  const title = prompt('小说名称：', '未命名小说');
  if (title === null) return;
  const b = { id: uid(), title: title || '未命名小说', premise: '', outline: '', worldSetting: '', chapters: [], chat: [] };
  const c = { id: uid(), title: '第一章', content: '<p></p>' };
  b.chapters.push(c);
  state.books.push(b);
  state.currentBookId = b.id; state.currentChapterId = c.id; chatHistory = [];
  loadChapterIntoEditor(); renderAll(); save();
  toast('已新建小说');
};
$('newChapterBtn').onclick = () => {
  const b = currentBook(); if (!b) return toast('请先创建小说');
  const title = prompt('章节标题：', '新章节');
  if (title === null) return;
  const c = { id: uid(), title: title || '新章节', content: '<p></p>' };
  b.chapters.push(c);
  state.currentChapterId = c.id;
  loadChapterIntoEditor(); renderAll(); save();
};
$('saveBtn').onclick = () => { saveCurrentChapter(); save(); toast('已保存'); };

/* ---------- 格式工具 ---------- */
document.querySelectorAll('.format-toolbar button[data-cmd]').forEach(btn => {
  btn.onclick = () => {
    const cmd = btn.dataset.cmd;
    const val = btn.dataset.val || null;
    editor.focus();
    document.execCommand(cmd, false, val);
  };
});
$('clearFormat').onclick = () => { editor.focus(); document.execCommand('removeFormat'); };

/* ---------- 选区 ---------- */
function captureSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    savedRange = sel.getRangeAt(0).cloneRange();
    return sel.toString();
  }
  savedRange = null; return '';
}
function applyToSelection(text) {
  if (!savedRange) { toast('未找到原选区，请在正文重新选中');
    editor.focus(); return false; }
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(savedRange);
  savedRange.deleteContents();
  savedRange.insertNode(document.createTextNode(text));
  savedRange.collapse(false);
  updateWordCount(); debouncedSave();
  return true;
}

/* ---------- 流式调用 ---------- */
async function streamChat(payload, handlers) {
  stopBtn.disabled = false;
  const controller = new AbortController();
  activeController = controller;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error((JSON.parse(t).error) || ('HTTP ' + res.status));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) || '';
            if (delta && handlers.onDelta) handlers.onDelta(delta);
          } catch (_) {}
        }
      }
    }
    handlers.onDone && handlers.onDone();
  } catch (e) {
    if (e.name === 'AbortError') { handlers.onDone && handlers.onDone(true); }
    else { handlers.onError && handlers.onError(e.message); }
  } finally {
    activeController = null;
    stopBtn.disabled = true;
  }
}
stopBtn.onclick = () => { if (activeController) activeController.abort(); };

/* ---------- 系统提示词 ---------- */
const SYSTEM = {
  continue: '你是一位专业的中文网络小说写作助手。请严格顺着已有正文写下去，保持人物、视角、文风、节奏一致；不要重复已有内容，不要添加标题或解释，直接输出续写正文（约 400-600 字）。',
  polish: '你是资深网文编辑。请润色下方文本，提升语言流畅度与画面感，保持原意与人物口吻，仅输出润色后的文本，不要解释。',
  rewrite: '你是创意写作助手。请在不改变核心情节与含义的前提下，用不同的表达或视角重写下方文本，仅输出重写结果，不要解释。',
  generate: '你是网文写作高手。请基于设定与章节标题，写出一章完整正文（800-1200 字），有冲突、有细节、符合网文节奏。只输出正文，不要标题与解释。',
  outline: '你是小说架构师。请基于下方创意，产出三级大纲：①总纲（核心梗/结局方向）②卷纲（3-5 卷及每卷爆点）③章节蓝图（前 10 章每章一句话）。条理清晰，用中文。',
  setting: '你是世界观架构师。请基于下方创意，生成结构化设定：力量体系、主要种族/势力、关键角色（3-5 个，含人设与动机）、地理与背景。条理清晰，用中文。',
  chat: '你是陪伴作者创作的 AI 写作助手，可结合本书设定与当前正文给出建议、灵感或续写。回答简洁、有用、贴合网文创作。'
};

/* ---------- 智能体动作 ---------- */
function runAgent(action) {
  const b = currentBook();
  if (!b) return toast('请先创建小说');

  if (action === 'continue') {
    const text = editorText();
    if (!text.trim()) return toast('正文为空，先写点什么或让 AI 生成章节');
    const ctx = text.length > 2000 ? text.slice(-2000) : text;
    streamIntoEditor(
      { role: 'system', content: SYSTEM.continue },
      { role: 'user', content: `已有正文（请接着写）：\n"""\n${ctx}\n"""` }
    );
  }
  else if (action === 'polish' || action === 'rewrite') {
    const sel = captureSelection();
    if (!sel) return toast('请先在正文中用鼠标选中要' + (action === 'polish' ? '润色' : '改写') + '的文本');
    const label = action === 'polish' ? '润色结果' : '改写结果';
    streamIntoResultBox(label, SYSTEM[action], `请处理以下文本：\n"""\n${sel}\n"""`);
  }
  else if (action === 'generate') {
    const title = chapterTitleEl.value || '本章';
    streamIntoEditor(
      { role: 'system', content: SYSTEM.generate },
      { role: 'user', content: `小说设定：${b.premise || '（暂无）'}\n大纲：${b.outline || '（暂无）'}\n本章标题：${title}\n请生成本章正文。` }
    );
  }
  else if (action === 'outline' || action === 'setting') {
    const premise = b.premise || chapterTitleEl.value || '';
    streamIntoModal(
      action === 'outline' ? '章节大纲' : '世界观设定',
      SYSTEM[action],
      `创意 / 设定：${premise || '（请自由发挥一个网络小说设定）'}`,
      action
    );
  }
}

/* 续写 / 生成章节：流式写入编辑器（追加） */
function streamIntoEditor(systemMsg, userMsg) {
  streamChat({ model: modelVal(), messages: [systemMsg, userMsg] }, {
    onStart: () => { editor.focus(); },
    onDelta: d => editor.appendChild(document.createTextNode(d)),
    onDone: () => { updateWordCount(); debouncedSave(); toast('AI 已写入正文'); },
    onError: e => toast('出错了：' + e)
  });
}

/* 润色 / 改写：流式写入结果框 */
function streamIntoResultBox(label, system, userContent) {
  resultTitle.textContent = label;
  resultText.textContent = '';
  resultBox.hidden = false;
  const full = { text: '' };
  streamChat({ model: modelVal(), messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }] }, {
    onDelta: d => { resultText.textContent += d; full.text += d; resultText.scrollTop = resultText.scrollHeight; },
    onDone: () => { resultBox._full = full.text; },
    onError: e => toast('出错了：' + e)
  });
}
$('applyResult').onclick = () => {
  const t = resultText.textContent;
  if (applyToSelection(t)) { resultBox.hidden = true; toast('已应用到正文'); }
};
$('copyResult').onclick = () => { copyText(resultText.textContent); };

/* 大纲 / 设定：流式写入弹窗 */
function streamIntoModal(title, system, userContent, kind) {
  openModal(title, '');
  const full = { text: '' };
  streamChat({ model: modelVal(), messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }] }, {
    onDelta: d => { $('modalBody').textContent += d; full.text += d; $('modalBody').scrollTop = $('modalBody').scrollHeight; },
    onDone: () => { modalFull = full.text; modalKind = kind; },
    onError: e => toast('出错了：' + e)
  });
}
let modalFull = '', modalKind = '';
$('modalSave').onclick = () => {
  const b = currentBook(); if (!b) return;
  if (modalKind === 'outline') b.outline = modalFull;
  if (modalKind === 'setting') b.worldSetting = modalFull;
  save(); toast('已保存到本书');
};
$('modalClose').onclick = closeModal;
$('modalCopy').onclick = () => copyText(modalFull);

/* ---------- 对话 ---------- */
$('sendBtn').onclick = sendChat;
$('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
function appendMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = `<div class="who">${role === 'user' ? '我' : 'AI'}</div><div class="bubble"></div>`;
  div.querySelector('.bubble').textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div.querySelector('.bubble');
}
function sendChat() {
  const b = currentBook(); if (!b) return toast('请先创建小说');
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  appendMsg('user', text);
  chatHistory.push({ role: 'user', content: text });

  const ctx = [];
  ctx.push({ role: 'system', content: SYSTEM.chat });
  if (b.premise) ctx.push({ role: 'system', content: '本书设定：' + b.premise });
  if (b.outline) ctx.push({ role: 'system', content: '本书大纲：' + b.outline });
  chatHistory.slice(-10).forEach(m => ctx.push(m));
  ctx.push({ role: 'user', content: text });

  const bubble = appendMsg('assistant', '');
  const full = { text: '' };
  streamChat({ model: modelVal(), messages: ctx }, {
    onDelta: d => { full.text += d; bubble.textContent = full.text; chatLog.scrollTop = chatLog.scrollHeight; },
    onDone: () => { chatHistory.push({ role: 'assistant', content: full.text }); b.chat = chatHistory.slice(); save(); },
    onError: e => { bubble.textContent = '⚠️ ' + e; }
  });
}

/* agent 按钮绑定 */
document.querySelectorAll('.agent-btn').forEach(btn => {
  btn.onclick = () => runAgent(btn.dataset.action);
});

/* ---------- 弹窗 & 工具 ---------- */
function openModal(title, body) {
  $('modalTitle').textContent = title;
  $('modalBody').textContent = body;
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; }
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });

function copyText(t) {
  navigator.clipboard.writeText(t).then(() => toast('已复制'), () => toast('复制失败'));
}
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
}
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 启动 ---------- */
load();
renderAll();
loadChapterIntoEditor();
