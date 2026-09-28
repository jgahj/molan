/**
 * webchat.js — DeepSeek 网页版自动化桥接（省Token模式后端）
 * 用 playwright-core 驱动本机 Edge 浏览器：自动打开 chat.deepseek.com，
 * 自动发送完整提示词（含技能规范与小说内容），实时截取 AI 回答回传。
 * 登录态持久化在 .ds-profile 目录，首次登录一次后长期有效。
 */
'use strict';

const path = require('path');

let chromium = null;
try { chromium = require('playwright-core').chromium; } catch (_) { /* 未安装 */ }

const PROFILE_DIR = path.join(__dirname, '.ds-profile');
const DS_URL = 'https://chat.deepseek.com/';

let contextPromise = null;   // 浏览器上下文单例
let busy = false;            // 同一时刻只允许一个生成任务

function available() { return !!chromium; }
function isBusy() { return busy; }

/** 获取（或启动）持久化浏览器上下文 */
async function getContext() {
  if (contextPromise) {
    try {
      const ctx = await contextPromise;
      // 探活：浏览器被手动关掉后 pages() 为空数组且 close 事件已置空单例
      if (contextPromise && ctx.pages().length >= 0) return ctx;
    } catch (_) { contextPromise = null; }
  }
  contextPromise = chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'msedge',
    headless: false, // 有头模式：方便登录 & 降低风控
    viewport: { width: 1180, height: 860 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation']
  });
  const ctx = await contextPromise;
  ctx.on('close', () => { contextPromise = null; busy = false; });
  return ctx;
}

/** 找到（或新开）DeepSeek 页面 */
async function getPage(ctx) {
  for (const p of ctx.pages()) {
    try { if (p.url().startsWith('https://chat.deepseek.com')) return p; } catch (_) {}
  }
  const page = ctx.pages().length === 1 && ctx.pages()[0].url() === 'about:blank'
    ? ctx.pages()[0]
    : await ctx.newPage();
  return page;
}

/** 聊天输入框定位（DeepSeek 网页版为 #chat-input 的 textarea，做多重回退） */
function inputLocator(page) {
  return page.locator('textarea#chat-input, textarea[placeholder*="DeepSeek"], textarea[placeholder*="消息"], main textarea').first();
}

/** 等待登录完成：输入框出现即视为已登录 */
async function ensureLoggedIn(page, emit, timeoutMs) {
  const input = inputLocator(page);
  try {
    await input.waitFor({ state: 'visible', timeout: 8000 });
    return true;
  } catch (_) {}
  // 未登录：提示用户在弹出的浏览器里登录
  emit({ type: 'status', stage: 'login', message: '请在弹出的浏览器窗口中登录 DeepSeek（仅首次需要），登录后将自动继续…' });
  try { await page.bringToFront(); } catch (_) {}
  try {
    await input.waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch (_) { return false; }
}

/**
 * 开启「深度思考」并优先选择专家版（best-effort，多重回退，失败不阻断生成）
 * 返回 { ok, expert, note }
 */
async function enableDeepThink(page, emit) {
  const findToggle = () => page.evaluate(() => {
    const isBlueish = (c) => {
      const m = (c || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      const r = +m[1], g = +m[2], b = +m[3];
      return b > 140 && b > r + 25 && b > g + 10; // 蓝色主导 → 激活态
    };
    const els = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"], div[class*="button"], div[class*="chip"], div[class*="toggle"]'));
    for (const el of els) {
      const t = (el.innerText || '').replace(/\s+/g, '');
      if (!t || t.length > 24) continue;
      if (/深度思考|DeepThink|深度思維/i.test(t)) {
        const st = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const active = el.getAttribute('aria-pressed') === 'true'
          || el.getAttribute('data-state') === 'on'
          || /active|selected|checked|--on\b/i.test(String(el.className || ''))
          || isBlueish(st.color) || isBlueish(st.backgroundColor) || isBlueish(st.borderColor);
        return { found: true, active, expert: /专家|Expert|Pro/i.test(t), text: t, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return { found: false };
  }).catch(() => ({ found: false }));

  // 在整个页面里找并点击含「专家」的可见小元素（模式菜单项/子选项）
  const clickExpertOption = () => page.evaluate(() => {
    const cands = [];
    for (const el of document.querySelectorAll('div, span, li, button, [role="option"], [role="menuitem"]')) {
      const t = (el.innerText || '').replace(/\s+/g, '');
      if (!t || t.length > 14) continue;
      if (!/专家|Expert/i.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      cands.push({ el, area: r.width * r.height });
    }
    if (!cands.length) return false;
    cands.sort((a, b) => a.area - b.area); // 点最小（最深层）的那个，避免点到整块容器
    cands[0].el.click();
    return true;
  }).catch(() => false);

  try {
    emit({ type: 'status', stage: 'think', message: '正在开启深度思考（专家版）…' });
    let s = await findToggle();
    if (!s.found) return { ok: false, expert: false, note: '未找到「深度思考」按钮，已按网页版默认模式发送' };

    // 1) 未激活则点击开启
    if (!s.active) {
      await page.mouse.click(s.x, s.y);
      await page.waitForTimeout(700);
      s = await findToggle();
    }

    // 2) 已带「专家」标识则完成
    if (s.found && s.expert && s.active) return { ok: true, expert: true, note: '' };

    // 3) 尝试选择专家版：开启后可能弹出模式菜单，或需再点按钮展开选择
    let picked = await clickExpertOption();
    if (!picked && s.found) {
      // 再点一下开关尝试展开模式选择菜单（若因此被关闭，下面会重新打开）
      await page.mouse.click(s.x, s.y);
      await page.waitForTimeout(600);
      picked = await clickExpertOption();
      const after = await findToggle();
      if (after.found && !after.active) { // 被误关了 → 重新打开
        await page.mouse.click(after.x, after.y);
        await page.waitForTimeout(500);
      }
    }
    await page.waitForTimeout(400);
    const fin = await findToggle();
    const on = fin.found ? fin.active : (s.found && s.active);
    const expert = picked || (fin.found && fin.expert);
    if (on) return { ok: true, expert: !!expert, note: expert ? '' : '深度思考已开启（未找到专家版子选项，网页版可能已默认专家档）' };
    return { ok: false, expert: false, note: '未能确认深度思考已开启，已按当前模式发送' };
  } catch (e) {
    return { ok: false, expert: false, note: '开启深度思考时出错，已按当前模式发送' };
  }
}

/** 读取页面上最后一条 AI 回答的文本 + 是否仍在生成 */
async function readLastAnswer(page) {
  return page.evaluate(() => {
    // DeepSeek 回答渲染在 .ds-markdown 容器中
    const blocks = document.querySelectorAll('.ds-markdown');
    const last = blocks.length ? blocks[blocks.length - 1] : null;
    const text = last ? last.innerText : '';
    // 生成中的特征：停止按钮（rect 图标）或 aria-label 包含 停止/Stop
    let generating = false;
    const btns = document.querySelectorAll('button, div[role="button"]');
    for (const b of btns) {
      const al = (b.getAttribute('aria-label') || '') + (b.className || '');
      if (/stop|停止/i.test(al)) { generating = true; break; }
      if (b.querySelector('svg rect') && !b.querySelector('svg path')) { generating = true; break; }
    }
    return { text, count: blocks.length, generating };
  }).catch(() => ({ text: '', count: 0, generating: false }));
}

/** 根据扩展名猜 mime（playwright setInputFiles 需要） */
function guessMime(name) {
  const ext = (name || '').toLowerCase().split('.').pop();
  const map = {
    txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', text: 'text/plain',
    json: 'application/json', csv: 'text/csv', yaml: 'text/yaml', yml: 'text/yaml',
    log: 'text/plain', srt: 'text/plain', ass: 'text/plain', vtt: 'text/plain',
    xml: 'application/xml', html: 'text/html', htm: 'text/html', toml: 'text/plain'
  };
  return map[ext] || 'application/octet-stream';
}
function sanitizeName(name) {
  return (name || 'file.txt').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

/**
 * 把本地素材作为文件上传到 DeepSeek 网页版对话（利用 composer 的隐藏 file input）。
 * 失败返回 {ok:false}，由调用方决定降级（抛出 → 前端改为复制含素材的提示词）。
 */
async function uploadFiles(page, files, emit) {
  const MAX = 10; // DeepSeek 网页版单次对话附件数有限，超出分批
  const toUpload = files.slice(0, MAX);
  if (files.length > MAX) emit({ type: 'status', stage: 'upload', message: '附件数超过 ' + MAX + '，仅上传前 ' + MAX + ' 个，其余请分批' });
  const pwFiles = [];
  for (const f of toUpload) {
    if (!f || !f.content || !f.content.trim()) continue;
    if (f.content.length > 50 * 1024 * 1024) { emit({ type: 'status', stage: 'upload', message: '跳过超大文件（>50MB）：' + (f.name || '') }); continue; }
    pwFiles.push({ name: sanitizeName(f.name || 'file.txt'), mimeType: guessMime(f.name), buffer: Buffer.from(f.content, 'utf-8') });
  }
  if (!pwFiles.length) return { ok: false, error: '没有可上传的有效素材文件' };

  // 定位 composer 的文件输入（DeepSeek 网页版隐藏 input[type=file]）
  let input;
  try {
    input = page.locator('#chat-input').locator('xpath=ancestor::form[1]').locator('input[type="file"]').first();
    await input.waitFor({ state: 'attached', timeout: 5000 });
  } catch (_) {
    try { input = page.locator('input[type="file"]').first(); await input.waitFor({ state: 'attached', timeout: 5000 }); }
    catch (_) { return { ok: false, error: '未找到文件上传控件' }; }
  }
  try {
    await input.setInputFiles(pwFiles, { timeout: 60000 });
    await page.waitForTimeout(3000); // 等附件 chip / 上传完成
    return { ok: true, count: pwFiles.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 核心：在 DeepSeek 网页版发送 prompt 并流式截取回答
 * emit 事件：{type:'status'} {type:'snapshot',text} {type:'done',text} {type:'error',message}
 */
async function webGenerate(prompt, emit, opts = {}) {
  if (!chromium) { emit({ type: 'error', message: '未安装 playwright-core，无法启动网页版自动化' }); return; }
  if (busy) { emit({ type: 'error', message: '网页版正在处理上一条请求，请稍后再试' }); return; }
  busy = true;
  const loginTimeout = opts.loginTimeout || 300000;   // 等登录最多 5 分钟
  const genTimeout = opts.genTimeout || 600000;       // 生成最多 10 分钟

  try {
    emit({ type: 'status', stage: 'launch', message: '正在启动本机浏览器…' });
    const ctx = await getContext();
    const page = await getPage(ctx);

    if (!page.url().startsWith('https://chat.deepseek.com')) {
      emit({ type: 'status', stage: 'open', message: '正在打开 DeepSeek 网页版…' });
      await page.goto(DS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    const ok = await ensureLoggedIn(page, emit, loginTimeout);
    if (!ok) { emit({ type: 'error', message: '等待登录超时，请登录 DeepSeek 后重试' }); return; }

    // 开新对话，避免旧上下文干扰（直接回到首页即是新对话）
    try {
      if (!/chat\.deepseek\.com\/?$/.test(page.url())) {
        await page.goto(DS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await inputLocator(page).waitFor({ state: 'visible', timeout: 15000 });
      }
    } catch (_) {}

    // 默认开启深度思考（专家版）；opts.thinking === false 时才跳过
    if (opts.thinking !== false) {
      const tk = await enableDeepThink(page, emit);
      if (tk.ok) {
        emit({ type: 'status', stage: 'think', message: tk.expert ? '已开启深度思考 · 专家版' : (tk.note || '已开启深度思考') });
      } else if (tk.note) {
        emit({ type: 'status', stage: 'think', message: tk.note });
      }
    }

    // 省Token模式：若携带本地素材，先作为文件上传到 DeepSeek 网页版（而非把全文塞进提示词）
    if (opts.files && opts.files.length) {
      emit({ type: 'status', stage: 'upload', message: '正在上传本地素材文件（' + opts.files.length + ' 个）…' });
      const up = await uploadFiles(page, opts.files, emit);
      if (!up.ok) {
        emit({ type: 'error', message: '本地素材文件上传失败：' + (up.error || '') + '，请手动粘贴含素材的提示词' });
        return;
      }
      emit({ type: 'status', stage: 'upload', message: '已上传 ' + up.count + ' 个素材文件' });
    }

    emit({ type: 'status', stage: 'send', message: '正在发送提示词' + (opts.files && opts.files.length ? '（素材已作为文件附上）' : '') + '…' });
    const input = inputLocator(page);
    await input.click();
    // fill 一次性注入（支持超长小说文本），失败则回退为 insertText
    try {
      await input.fill(prompt, { timeout: 20000 });
    } catch (_) {
      await page.keyboard.insertText(prompt);
    }
    await page.waitForTimeout(300);
    const before = await readLastAnswer(page);
    await page.keyboard.press('Enter');

    // 确认已发出（输入框清空或出现新回答块）
    await page.waitForTimeout(800);
    try {
      const val = await input.inputValue({ timeout: 3000 });
      if (val && val.length > 0 && val === prompt) {
        // Enter 未发送（可能设置了 Ctrl+Enter），尝试点击发送按钮
        const sendBtn = page.locator('div[role="button"]:has(svg), button:has(svg)').last();
        await sendBtn.click({ timeout: 5000 }).catch(() => {});
      }
    } catch (_) {}

    emit({ type: 'status', stage: 'generating', message: 'DeepSeek 网页版正在生成…' });

    // 轮询截取回答：文本快照 + 稳定性判停
    const start = Date.now();
    let lastText = '';
    let stableMs = 0;
    let seenNew = false;
    while (Date.now() - start < genTimeout) {
      await page.waitForTimeout(600);
      const cur = await readLastAnswer(page);
      const isNewBlock = cur.count > before.count || cur.text !== before.text;
      if (!seenNew) {
        if (isNewBlock && cur.text.trim()) seenNew = true;
        else if (Date.now() - start > 90000) { emit({ type: 'error', message: '网页版长时间未开始回答，请检查浏览器窗口' }); return; }
        else continue;
      }
      if (cur.text !== lastText) {
        lastText = cur.text;
        stableMs = 0;
        emit({ type: 'snapshot', text: lastText });
      } else {
        stableMs += 600;
        // 无生成中标志且文本稳定 3 秒 → 完成；有标志则继续等
        if (!cur.generating && stableMs >= 3000 && lastText.trim()) break;
        if (stableMs >= 15000 && lastText.trim()) break; // 兜底
      }
    }

    if (!lastText.trim()) { emit({ type: 'error', message: '未截取到网页版回答，请重试' }); return; }
    emit({ type: 'done', text: lastText });
  } catch (e) {
    emit({ type: 'error', message: '网页版自动化失败：' + (e && e.message ? e.message.split('\n')[0] : String(e)) });
  } finally {
    busy = false;
  }
}

module.exports = { available, isBusy, webGenerate };
