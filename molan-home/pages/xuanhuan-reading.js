'use strict';
const element = id => document.getElementById(id);
const labels = { fact: '原文事实', inference: '分析推断', open_question: '待后文确认' };
const statuses = { running: '正在精读', queued: '等待开始', completed: '精读揣摩已就绪 · 双路线叙事引擎已激活', interrupted: '已中断 · 已完成阶段保留', cancelled: '已停止' };
let currentJob, currentQuote, timer, fingerprint = '';
function node(tag, text, className) { const output = document.createElement(tag); if (text != null) output.textContent = text; if (className) output.className = className; return output; }
function notice(text, error = false) { element('notice').textContent = text; element('notice').className = text ? 'notice' + (error ? ' error' : '') : ''; }
async function api(route, body) {
  const token = localStorage.getItem('ml_token');
  if (!token) throw new Error('请先返回网站登录，再打开精读页面');
  const response = await fetch('/api/xuanhuan-reading' + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败'); return data;
}
function option(value, text) { const output = node('option', text); output.value = value; return output; }
function renderNotes() {
  if (!currentJob) return;
  const book = currentJob.books.find(item => item.id === element('book').value) || currentJob.books[0];
  const chapter = book.chapters.find(item => item.id === element('chapter').value);
  const paragraphs = chapter ? chapter.paragraphs : book.chapters.flatMap(item => item.paragraphs);
  const phase = element('phase').value;
  element('phase').disabled = !chapter;
  const bundles = !chapter ? [book.retrospective] : phase === 'reading' ? chapter.reading : [phase === 'synthesis' ? chapter.synthesis : chapter.review?.notes];
  const excludedCount = (chapter ? [chapter] : book.chapters).reduce((sum, item) => sum + (item.excludedAppendix?.length || 0), 0);
  element('version').textContent = `原文件 SHA256：${book.hash} · ${book.encoding} · ${book.excludedPreamble} · 本范围另有${excludedCount}段作者附言/宣传，未计入故事正文，导出中保留位置。`;
  element('paragraphs').replaceChildren(...paragraphs.map(paragraph => { const output = node('div', null, 'source-paragraph'); output.id = paragraph.id; output.append(node('small', `${paragraph.id} · 原文字符偏移 ${paragraph.start}—${paragraph.end}`), node('div', paragraph.text)); return output; }));
  element('notes').replaceChildren();
  if (bundles.every(bundle => !bundle)) { element('notes').append(node('p', '此阶段尚未完成；不会把不完整笔记冒充已读懂。', 'muted')); return; }
  for (const bundle of bundles.filter(Boolean)) {
    element('notes').append(node('p', bundle.summary, 'summary'));
    for (const claim of bundle.claims) {
      const card = node('section', null, 'claim'); card.append(node('div', `${labels[claim.kind]} · ${claim.topic}`, 'kind'), node('h3', claim.statement));
      for (const [label, key] of [['如何得出', 'reasoning'], ['其他解释 / 不确定性', 'alternative'], ['可迁移方法', 'application'], ['适用条件与反例', 'limits']]) card.append(node('p', `${label}：${claim[key]}`));
      for (const evidence of claim.evidence) { const button = node('button', evidence.quote, 'evidence'); button.append(node('small', `查看原文 ${evidence.paragraphId}${evidence.reportedParagraphId ? ` · 原标${evidence.reportedParagraphId}，经同章唯一原句定位纠正` : ''}${evidence.quoteRepair ? ' · 此引用经单独对照原文修复，判断未改写，导出保留修复记录' : ''}`)); button.addEventListener('click', () => { element('original').open = true; for (const previous of document.querySelectorAll('.highlight')) previous.classList.remove('highlight'); const target = element(evidence.paragraphId); target.classList.add('highlight'); target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); card.append(button); }
      const check = chapter && phase === 'review' && chapter.review?.checks.find(item => item.claimId === claim.id);
      if (check) card.append(node('p', `模型复核 ${check.verdict}：${check.reason}`, 'review-check'));
      element('notes').append(card);
    }
  }
}
function selectBook() {
  const book = currentJob.books.find(item => item.id === element('book').value) || currentJob.books[0];
  element('chapter').replaceChildren(...book.chapters.map(chapter => option(chapter.id, chapter.title)), option('retrospective', '前三章跨章复盘'));
  renderNotes();
}
function renderJob() {
  const job = currentJob; element('reader').hidden = false;
  element('job-title').textContent = statuses[job.status] || job.status;
  const routeFailures = (job.attempts || []).filter(attempt => attempt.status === 'failed' && !attempt.revalidatedAt && !(job.attempts || []).some(later => later.stage === attempt.stage && later.number > attempt.number && later.status === 'completed'));
  element('progress').textContent = `已复核 ${job.completedChapters}/${job.totalChapters}章 · 已调用 ${job.callCount}/${job.maxCalls}次\n当前阶段：${job.runningStages?.length ? job.runningStages.join(' / ') : job.stage || '准备'}${job.error ? '\n' + job.error : ''}${job.sourceWarning ? '\n' + job.sourceWarning : ''}${job.status === 'running' && routeFailures.length ? '\n独立路线存在未完成阶段；另一条仍可继续，已保存阶段不会丢失。' : ''}`;
  const known = job.usage.filter(item => Number.isFinite(item.usage?.totalTokens));
  const credits = job.usage.filter(item => Number.isFinite(item.usage?.creditCost));
  element('usage').textContent = `已返回用量：${known.reduce((sum, item) => sum + item.usage.totalTokens, 0)} tokens（${known.length}/${job.callCount}次有令牌记录） · 已知积分扣费 ${credits.reduce((sum, item) => sum + item.usage.creditCost, 0)}（${credits.length}/${job.callCount}次有记录；缺失不当作零）`;
  element('cancel').hidden = !['running', 'queued'].includes(job.status); element('resume').hidden = !['interrupted', 'cancelled'].includes(job.status); element('export').hidden = false;
  if (job.status === 'completed') {
    if (job.activated) {
      element('activate').hidden = true;
      element('to-editor').hidden = false;
      element('progress').textContent = '已精读提炼《元始法则》（飞天鱼）与《剑烛大荒》（乌贼）前三章叙事机制，只读限制已解除，双路线已激活打通至创作空间。';
    } else {
      element('activate').hidden = false;
      element('to-editor').hidden = true;
      element('progress').textContent = '精读试点已完成，可点击右侧「解除只读 · 激活双路线创作」接入小说编辑器。';
    }
  } else {
    element('activate').hidden = true;
    element('to-editor').hidden = true;
  }
  if (!element('book').options.length) { element('book').replaceChildren(...job.books.map(book => option(book.id, `${book.title} · 独立路线`))); selectBook(); } else renderNotes();
}
async function loadJobs() {
  const data = await api('/jobs'); element('jobs').replaceChildren(...data.jobs.map(job => { const button = node('button', null, 'job-card'); button.append(node('strong', '双书各3章'), node('div', statuses[job.status] || job.status), node('div', `${job.completedChapters}/6章 · ${new Date(job.createdAt).toLocaleString('zh-CN')}`)); button.addEventListener('click', () => openJob(job.id).catch(showError)); return button; })); return data.jobs;
}
async function openJob(id) {
  clearTimeout(timer); const job = await api('/jobs/' + id); const next = JSON.stringify([job.id, job.callCount, job.status, job.completedChapters, job.stage, job.attempts.map(attempt => attempt.status)]);
  if (currentJob?.id !== job.id) element('book').replaceChildren(); currentJob = job;
  if (next !== fingerprint) { fingerprint = next; renderJob(); }
  if (['running', 'queued'].includes(job.status)) timer = setTimeout(() => openJob(id).catch(showError), 4000);
}
function showError(error) { notice(error.message, true); }
element('book').addEventListener('change', selectBook); element('chapter').addEventListener('change', renderNotes); element('phase').addEventListener('change', renderNotes);
element('refresh').addEventListener('click', () => loadJobs().then(() => currentJob && openJob(currentJob.id)).catch(showError));
element('model').addEventListener('change', () => { currentQuote = null; element('start').disabled = true; element('consent').checked = false; element('estimate').textContent = '模型已变更，请重新核实预算。'; });
element('consent').addEventListener('change', () => { element('start').disabled = !currentQuote || !element('consent').checked; });
element('quote').addEventListener('click', async () => { element('quote').disabled = true; try { currentQuote = await api('/quote', { modelId: element('model').value }); element('estimate').textContent = `模型：${currentQuote.model.name}（网站配置名称）\n完整顺序执行预计 ${currentQuote.plannedCalls}次；硬上限 ${currentQuote.maxCalls}次。\n当前账户积分预估上限：${currentQuote.estimate.estimatedCredits}；不是外部供应商成本。\n${currentQuote.note}`; element('start').disabled = !element('consent').checked; } catch (error) { currentQuote = null; element('start').disabled = true; showError(error); } finally { element('quote').disabled = false; } });
element('start').addEventListener('click', async () => { if (!currentQuote || !element('consent').checked) return; element('start').disabled = true; try { const job = await api('/jobs', { modelId: currentQuote.model.id, consent: true, maxCalls: 38, maxCredits: currentQuote.estimate.estimatedCredits, chapterCount: 3 }); await loadJobs(); await openJob(job.id); notice('试点任务已保存；完成后等待扩展预算确认，不会自动开始创书。'); } catch (error) { showError(error); } finally { element('start').disabled = !currentQuote || !element('consent').checked; } });
for (const action of ['resume', 'cancel']) element(action).addEventListener('click', async () => { element(action).disabled = true; try { await api(`/jobs/${currentJob.id}/${action}`, {}); await openJob(currentJob.id); } catch (error) { showError(error); } finally { element(action).disabled = false; } });
element('activate').addEventListener('click', async () => {
  element('activate').disabled = true;
  try {
    const result = await api('/jobs/' + currentJob.id + '/activate', {});
    currentJob = result.job;
    notice('只读限制已成功解除！《元始法则》与《剑烛大荒》双路线已激活，小说生成器可直接调用。');
    renderJob();
  } catch (error) {
    showError(error);
  } finally {
    element('activate').disabled = false;
  }
});
element('export').addEventListener('click', async () => { try { const data = await api(`/jobs/${currentJob.id}/export`); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const anchor = node('a'); anchor.href = url; anchor.download = `dual-reading-${currentJob.id}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { showError(error); } });
async function initialize() {
  const status = await api('/status'); element('sources').replaceChildren(...status.books.map(book => { const output = node('div'); output.append(node('strong', `《${book.title}》`), node('p', `${book.chapters.map(chapter => chapter.title).join(' / ')}\n${book.excludedPreamble}`)); return output; }));
  const response = await fetch('/api/models', { headers: { Authorization: 'Bearer ' + localStorage.getItem('ml_token') } }); if (!response.ok) throw new Error('模型列表读取失败'); const data = await response.json();
  const models = (data.models || []).filter(model => model.contextWindowTokens >= 100000); element('model').replaceChildren(...models.map(model => option(model.id, model.name))); if (models.some(model => model.id === data.access?.defaultModel)) element('model').value = data.access.defaultModel;
  if (!models.length) { element('quote').disabled = true; notice('账户没有满足精读完整上下文预算的模型，未启动任何调用。', true); }
  const jobs = await loadJobs(); if (jobs.length) await openJob(status.activeJob || jobs[0].id);
}
initialize().catch(showError);
