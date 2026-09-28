'use strict';

const element = id => document.getElementById(id);
let dimensions = [];
let currentJob = null;
let caseIndex = 0;
let candidateLabel = 'A';
let busy = false;
let timer;
const drafts = new Map();
let referencePack = null;
const referenceDrafts = new Map();

function renderBenchmark() {
  const sample = referencePack.samples[Number(element('benchmark-select').value) || 0];
  if (!sample) return;
  element('benchmark-body').hidden = false;
  element('benchmark-prose').textContent = sample.text;
  element('benchmark-source').textContent = sample.title ? `来源：《${sample.title}》 ${sample.chapter}` : '全部参照评分完成后显示来源。';
  const ratings = element('benchmark-ratings'); ratings.replaceChildren();
  if (!referenceDrafts.has(sample.id)) referenceDrafts.set(sample.id, {});
  const scores = sample.scores || referenceDrafts.get(sample.id);
  for (const dimension of dimensions) {
    const row = node('div', null, 'rating-row'); row.append(node('span', dimension));
    const buttons = node('div', null, 'rating-buttons');
    for (let value = 1; value <= 5; value += 1) { const button = node('button', value, scores[dimension] === value ? 'selected' : ''); button.disabled = Boolean(sample.scores); button.setAttribute('aria-label', `${sample.label} ${dimension} ${value}分`); button.addEventListener('click', () => { referenceDrafts.get(sample.id)[dimension] = value; renderBenchmark(); }); buttons.append(button); }
    row.append(buttons); ratings.append(row);
  }
  element('benchmark-vote').disabled = Boolean(sample.scores);
}

function showBenchmarkPack(pack) {
  referencePack = pack;
  const samples = Array.isArray(pack.samples) ? pack.samples : [];
  const status = element('benchmark-status');
  status.textContent = pack.message || (pack.finished ? '留出参照评分已完成。' : '');
  element('benchmark-select').replaceChildren(...samples.map((sample, index) => { const option = node('option', `${sample.label}${sample.scores ? ' ✓' : ''}`); option.value = index; return option; }));
  element('benchmark-body').hidden = samples.length === 0;
  if (!samples.length) {
    element('benchmark-vote').disabled = true;
    element('benchmark-source').textContent = '';
    return;
  }
  const next = samples.findIndex(sample => !sample.scores); element('benchmark-select').value = next >= 0 ? next : 0; renderBenchmark();
  status.textContent = pack.message || (pack.finished ? '留出参照评分已完成。' : '');
}

function notice(text, error = false) {
  element('notice').textContent = text;
  element('notice').className = text ? 'notice' + (error ? ' error' : '') : '';
}

async function api(route, body, method) {
  const token = localStorage.getItem('ml_token');
  if (!token) throw new Error('请先返回网站登录，再刷新此页面。');
  const response = await fetch('/api/xuanhuan-lab' + route, { method: method || (body ? 'POST' : 'GET'), headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '请求失败');
  return value;
}

function node(tag, text, className) {
  const output = document.createElement(tag);
  if (text != null) output.textContent = text;
  if (className) output.className = className;
  return output;
}

function estimate() {
  const serial = element('kind').value === 'serial';
  element('count').disabled = serial;
  const count = serial ? 10 : Number(element('count').value);
  element('estimate').textContent = `将生成${count}题 × 4份 = ${count * 4}份真实正文。调用次数硬上限${count * (serial ? 16 : 9)}次（含规划、评审${serial ? '与三本账' : ''}）；无问题时跳过修订。费用按实际账单，不预报虚构金额。`;
}

async function loadJobs() {
  const { jobs } = await api('/jobs');
  const container = element('jobs');
  container.replaceChildren();
  if (!jobs.length) container.textContent = '还没有测试记录';
  const statuses = { queued: '等待生成', running: '生成中', interrupted: '可恢复', cancelled: '已停止', completed: '待阅读 / 已生成' };
  for (const job of jobs) {
    const button = node('button', null, 'job-card' + (currentJob?.id === job.id ? ' active' : ''));
    button.append(node('strong', `${job.kind === 'serial' ? '连续十章' : '独立场景'} · ${job.total}题`), node('div', `${statuses[job.status] || job.status} · ${job.completed}/${job.total}`), node('div', new Date(job.createdAt).toLocaleString('zh-CN')), node('div', `已评 ${job.voted}题`));
    button.addEventListener('click', () => openJob(job.id).catch(showError));
    container.append(button);
  }
  return jobs;
}

function showError(error) { notice(error.message || String(error), true); }

async function openJob(id) {
  currentJob = await api('/jobs/' + id);
  caseIndex = Math.max(0, currentJob.cases.findIndex(item => !item.vote));
  candidateLabel = 'A';
  element('empty').hidden = true;
  element('reader').hidden = false;
  renderJob();
  await loadJobs();
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(timer);
  if (!currentJob || currentJob.status !== 'running') return;
  timer = setTimeout(async () => {
    try {
      const nextJob = await api('/jobs/' + currentJob.id);
      const changed = nextJob.completed !== currentJob.completed || nextJob.status !== currentJob.status || nextJob.voted !== currentJob.voted;
      currentJob = nextJob;
      if (changed) renderJob();
      if (currentJob.status !== 'running') await loadJobs();
      schedulePoll();
    } catch (error) { showError(error); timer = setTimeout(schedulePoll, 6000); }
  }, 5000);
}

function renderJob() {
  const job = currentJob;
  element('job-title').textContent = job.kind === 'serial' ? '连续十章 · 分支字母跨章固定' : '匿名场景阅读';
  element('progress').textContent = `生成 ${job.completed}/${job.total} · 已评 ${job.voted}/${job.total}`;
  element('job-status').textContent = `${job.status === 'running' ? '后台生成中，离开页面可继续。已完成的题目可以先读先评，评分独立保存。' : (job.error || '先比较正文；建议逐份阅读并评分，再作整体选择。')} 已发起 ${job.callCount}/${job.maxCalls} 次调用。`;
  element('resume').hidden = !['interrupted', 'cancelled'].includes(job.status);
  element('cancel').hidden = job.status !== 'running';
  element('reveal').disabled = !job.canReveal;
  element('export').hidden = !job.revealed;
  element('case-body').hidden = !job.cases.length;
  if (!job.cases.length) return;
  caseIndex = Math.min(caseIndex, job.cases.length - 1);
  const select = element('case-select');
  select.replaceChildren(...job.cases.map((item, index) => { const option = node('option', `${index + 1}. ${item.title}${item.vote ? ' ✓' : ''}`); option.value = index; return option; }));
  select.value = caseIndex;
  renderCase();
}

function getDraft(item) {
  const key = currentJob.id + ':' + item.id;
  if (!drafts.has(key)) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem('xh-vote:' + key) || 'null'); } catch (_) {}
    drafts.set(key, saved || { scores: { A: {}, B: {}, C: {}, D: {} }, winner: '', reason: '' });
  }
  return drafts.get(key);
}

function persistDraft(item) {
  try { localStorage.setItem('xh-vote:' + currentJob.id + ':' + item.id, JSON.stringify(getDraft(item))); } catch (_) { notice('本地评分草稿存储失败，请及时提交评分。', true); }
}

function renderCase() {
  const item = currentJob.cases[caseIndex];
  if (!item) return;
  const candidate = item.candidates.find(entry => entry.label === candidateLabel);
  const draft = item.vote || getDraft(item);
  element('case-title').textContent = item.title;
  element('case-prompt').textContent = item.prompt;
  element('prose').textContent = candidate.text;
  element('previous').disabled = caseIndex === 0;
  element('next').disabled = caseIndex >= currentJob.cases.length - 1;
  const tabs = element('tabs'); tabs.replaceChildren();
  for (const entry of item.candidates) {
    const scored = dimensions.every(dimension => draft.scores?.[entry.label]?.[dimension]);
    const button = node('button', `稿 ${entry.label}${scored ? ' ✓' : ''}`);
    button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(entry.label === candidateLabel));
    button.addEventListener('click', () => { candidateLabel = entry.label; renderCase(); }); tabs.append(button);
  }
  const ratings = element('ratings'); ratings.replaceChildren();
  for (const dimension of dimensions) {
    const row = node('div', null, 'rating-row'); row.append(node('span', dimension));
    const buttons = node('div', null, 'rating-buttons');
    for (let value = 1; value <= 5; value += 1) {
      const selected = draft.scores?.[candidateLabel]?.[dimension] === value;
      const button = node('button', value, selected ? 'selected' : '');
      button.setAttribute('aria-label', `${candidateLabel} ${dimension} ${value}分`);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = Boolean(item.vote);
      button.addEventListener('click', () => { getDraft(item).scores[candidateLabel][dimension] = value; persistDraft(item); renderCase(); });
      buttons.append(button);
    }
    row.append(buttons); ratings.append(row);
  }
  element('winner').value = draft.winner || '';
  element('reason').value = draft.reason || '';
  for (const id of ['winner', 'reason', 'submit-vote']) element(id).disabled = Boolean(item.vote);
  element('submit-vote').textContent = item.vote ? '本题评分已保存' : '提交本题并继续';
  element('method').hidden = !candidate.methodName;
  element('method').replaceChildren();
  if (candidate.methodName) { element('method').append(node('strong', candidate.methodName), node('p', `写作模型：${candidate.model}；字符数：${candidate.checks.length}`)); if (candidate.revision) element('method').append(node('p', candidate.revision.adopted ? '局部修订已采纳' : '保留初稿（无有效修订或修订未改善）')); }
}

function renderReport() {
  const report = element('report'); report.hidden = false; report.replaceChildren(node('h3', '本轮结果 · 先看差异，不急着宣布达标'));
  const statistics = new Map();
  for (const item of currentJob.cases) for (const candidate of item.candidates) {
    if (!statistics.has(candidate.method)) statistics.set(candidate.method, { name: candidate.methodName, wins: 0, sum: 0, count: 0 });
    const value = statistics.get(candidate.method);
    if (item.vote.winner === candidate.label) value.wins += 1;
    for (const score of Object.values(item.vote.scores[candidate.label])) { value.sum += score; value.count += 1; }
  }
  for (const value of statistics.values()) report.append(node('p', `${value.name}：被选为最佳 ${value.wins}/${currentJob.total}题；六维平均 ${(value.sum / value.count).toFixed(2)}/5。`));
  if (currentJob.narrativeRoute && currentJob.narrativeRoute !== 'auto') {
    const routeNames = { yuanshi: '《元始法则》（飞天鱼·硬朗秩序与危机担当路线）', jianzhu: '《剑烛大荒》（爱潜水的乌贼·细腻世俗与对白博弈路线）' };
    report.append(node('p', `精读挂载路线：${routeNames[currentJob.narrativeRoute] || currentJob.narrativeRoute}`));
  }
  report.append(node('p', '这些是你本轮四方案偏好，不是与真人范文的同题胜率。平局和都不满意不计为任一方案胜出；小样本不证明长篇质量。'));
}

element('kind').addEventListener('change', estimate);
element('load-benchmarks').addEventListener('click', async () => { try { showBenchmarkPack(await api('/benchmarks')); } catch (error) { showError(error); } });
element('benchmark-select').addEventListener('change', renderBenchmark);
element('benchmark-vote').addEventListener('click', async () => { try { const sample = referencePack.samples[Number(element('benchmark-select').value) || 0]; showBenchmarkPack(await api('/benchmarks/vote', { id: sample.id, scores: referenceDrafts.get(sample.id) })); notice('参照评分已保存。'); } catch (error) { showError(error); } });
element('full-protocol').addEventListener('click', () => { element('kind').value = 'scenes'; element('count').value = '30'; estimate(); });
element('count').addEventListener('change', estimate);
element('refresh').addEventListener('click', () => loadJobs().catch(showError));
element('create-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; element('create').disabled = true;
  try { const data = Object.fromEntries(new FormData(event.target)); const job = await api('/jobs', data); notice('已启动真实生成，任务保存在服务端；无需保持本页开启。'); await openJob(job.id); } catch (error) { showError(error); } finally { busy = false; element('create').disabled = false; }
});
element('case-select').addEventListener('change', event => { caseIndex = Number(event.target.value); candidateLabel = 'A'; renderCase(); });
for (const [id, delta] of [['previous', -1], ['next', 1]]) element(id).addEventListener('click', () => { caseIndex += delta; candidateLabel = 'A'; renderJob(); });
for (const id of ['winner', 'reason']) element(id).addEventListener('input', () => { const item = currentJob.cases[caseIndex]; getDraft(item)[id] = element(id).value; persistDraft(item); });
for (const action of ['resume', 'cancel']) element(action).addEventListener('click', async () => { try { await api(`/jobs/${currentJob.id}/${action}`, {}); await openJob(currentJob.id); } catch (error) { showError(error); } });
element('vote-form').addEventListener('submit', async event => {
  event.preventDefault(); const item = currentJob.cases[caseIndex];
  try {
    currentJob = await api(`/jobs/${currentJob.id}/vote`, { caseId: item.id, ...getDraft(item) });
    const next = currentJob.cases.findIndex(entry => !entry.vote); if (next >= 0) caseIndex = next;
    candidateLabel = 'A'; renderJob(); await loadJobs(); notice('评分已保存。' + (currentJob.canReveal ? '全部题目已完成，可以揭晓。' : '请继续下一题。'));
  } catch (error) { showError(error); }
});
element('reveal').addEventListener('click', async () => { try { currentJob = await api(`/jobs/${currentJob.id}/reveal`); renderJob(); renderReport(); notice('方案已揭晓，原始评分保持锁定。'); } catch (error) { showError(error); } });
element('export').addEventListener('click', async () => {
  try { const data = await api(`/jobs/${currentJob.id}/export`); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const anchor = node('a'); anchor.href = url; anchor.download = `xuanhuan-blind-${currentJob.id}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { showError(error); }
});

async function initialize() {
  estimate();
  const status = await api('/status'); dimensions = status.dimensions;
  const corpusStatus = status.corpusStatus || { available: Boolean(status.corpus), generationAvailable: Boolean(status.corpus) };
  const container = element('corpus');
  const createButton = element('create');
  createButton.disabled = !corpusStatus.generationAvailable;
  if (status.corpus) {
    container.replaceChildren(node('strong', `${status.corpus.books} 本 / ${status.corpus.scenes} 场景`), node('div', `参考集 ${corpusStatus.referenceBooks} 本 · 留出集 ${corpusStatus.holdoutBooks} 本`), node('div', '按作者隔离 · 仅使用指定玄幻目录'), node('div', '技法卡为规则候选，等待盲评校准'));
    if (!corpusStatus.generationAvailable) container.append(node('div', corpusStatus.message || '缺少可检索的参考集，暂不能启动生成。'));
    else if (!corpusStatus.benchmarkAvailable) container.append(node('div', `留出参照不足：至少需要${corpusStatus.requiredHoldoutBooks}本。`));
  } else {
    container.replaceChildren(node('strong', '玄幻语料库不可用'), node('div', corpusStatus.message || '缺少可检查的玄幻原文片段。'));
  }
  if (!corpusStatus.generationAvailable) notice(corpusStatus.message || '玄幻参考语料不可用，盲测生成已停用。', true);
  const response = await fetch('/api/models', { headers: { Authorization: 'Bearer ' + localStorage.getItem('ml_token') }, cache: 'no-store' });
  if (!response.ok) throw new Error('模型列表读取失败');
  const data = await response.json();
  for (const id of ['model', 'judge']) {
    const select = element(id); select.replaceChildren(...(data.models || []).map(model => { const option = node('option', model.name || model.id); option.value = model.id; return option; }));
    if (data.access?.defaultModel) select.value = data.access.defaultModel;
  }
  const jobs = await loadJobs();
  if (jobs.length) await openJob(status.activeJob || jobs[0].id);
}
initialize().catch(showError);
