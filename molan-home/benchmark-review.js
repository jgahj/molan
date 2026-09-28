(function () {
  'use strict';

  const dimensions = ['originality', 'narrative', 'characters', 'continuity'];
  const dimensionNames = { originality: '原创性', narrative: '叙事', characters: '人物', continuity: '连续性' };
  const stateDimensions = ['relations', 'knowledge', 'foreshadowing'];
  const stateNames = { relations: '关系变化', knowledge: '知识权限', foreshadowing: '伏笔状态' };
  const hashPattern = /^[a-f0-9]{64}$/;

  function canonicalJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }

  async function hashValue(value) {
    const source = typeof value === 'string' ? value : canonicalJson(value);
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function exactKeys(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).sort().join('|') === [...keys].sort().join('|');
  }

  async function validatePacket(packet) {
    if (!exactKeys(packet, ['schemaVersion', 'kind', 'packetId', 'packetHash', 'dimensions', 'items']) ||
      packet.schemaVersion !== 1 || packet.kind !== 'molan-blind-review' ||
      !hashPattern.test(packet.packetId) || !Array.isArray(packet.items) || !packet.items.length || packet.items.length > 1000 ||
      canonicalJson(packet.dimensions) !== canonicalJson(dimensions)) throw new Error('不是纯匿名题包；拒绝运行账本、私钥或额外身份字段');
    const { packetHash, ...body } = packet;
    if (packetHash !== await hashValue(body)) throw new Error('题包哈希不符');
    const identifiers = new Set();
    const seriesChapters = new Set();
    for (const item of packet.items) {
      if (!exactKeys(item, ['itemId', 'seriesId', 'genre', 'chapterIndex', 'prompt', 'candidates']) ||
        !/^[a-f0-9]{24}$/.test(item.itemId) || !/^[a-f0-9]{24}$/.test(item.seriesId) ||
        typeof item.genre !== 'string' || typeof item.prompt !== 'string' ||
        !Number.isInteger(item.chapterIndex) || item.chapterIndex < 1 ||
        identifiers.has(item.itemId) || seriesChapters.has(`${item.seriesId}:${item.chapterIndex}`) ||
        !exactKeys(item.candidates, ['A', 'B'])) throw new Error('匿名题目结构异常或重复');
      identifiers.add(item.itemId);
      seriesChapters.add(`${item.seriesId}:${item.chapterIndex}`);
      for (const label of ['A', 'B']) {
        const candidate = item.candidates[label];
        if (!exactKeys(candidate, ['text', 'textHash']) || typeof candidate.text !== 'string' || !candidate.text.trim() ||
          candidate.textHash !== await hashValue(candidate.text)) throw new Error('正文结构或哈希不符');
        if (/\b(?:openai|chatgpt|deepseek|claude|gemini|qwen|gpt-\d|as an ai)\b|作为.{0,8}(?:语言模型|人工智能)/iu.test(candidate.text)) {
          throw new Error('正文含模型身份线索，请交组织者处理，不在评审页改写');
        }
      }
    }
    return true;
  }

  function validateReview(packet, review) {
    const errors = [];
    if (review.kind !== 'molan-human-review' || review.packetHash !== packet.packetHash || review.packetId !== packet.packetId ||
      !review.reviewer?.trim() || !Number.isFinite(Date.parse(review.reviewedAt))) errors.push('须填写评审者并绑定题包');
    if (!Array.isArray(review.items) || review.items.length !== packet.items.length ||
      new Set(review.items?.map(item => item.itemId)).size !== packet.items.length) errors.push('人工结果缺题或重复');
    for (const item of packet.items) {
      const result = review.items?.find(entry => entry.itemId === item.itemId);
      if (!result || !['A', 'B', 'tie', 'neither'].includes(result.preference) || !result.reason?.trim()) {
        errors.push(`第${item.chapterIndex}章 ${item.itemId.slice(0, 6)}：缺偏好或理由`);
        continue;
      }
      for (const label of ['A', 'B']) {
        const candidate = result.candidates?.[label];
        if (candidate?.textHash !== item.candidates[label].textHash) errors.push('正文绑定不符');
        for (const dimension of dimensions) {
          const score = candidate?.scores?.[dimension];
          if (!Number.isInteger(score) || score < 1 || score > 5) errors.push(`${item.itemId.slice(0, 6)} ${label}：${dimensionNames[dimension]}未评分`);
        }
        for (const dimension of stateDimensions) {
          const check = candidate?.stateChecks?.[dimension];
          if (!['pass', 'fail'].includes(check?.status) || !check?.evidence?.trim() ||
            !item.candidates[label].text.includes(check.evidence)) errors.push(`${item.itemId.slice(0, 6)} ${label}：${stateNames[dimension]}缺判断或逐字证据`);
        }
      }
    }
    return { valid: !errors.length, errors };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { canonicalJson, hashValue, validatePacket, validateReview };
  }
  if (typeof document === 'undefined') return;

  const fileInput = document.getElementById('packet-file');
  const reviewer = document.getElementById('reviewer');
  const exportButton = document.getElementById('export-review');
  const message = document.getElementById('message');
  const container = document.getElementById('items');
  let packet = null;
  let loadSequence = 0;
  const fields = new Map();

  function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function selectField(labelText, choices) {
    const label = node('label', labelText);
    const select = node('select');
    const empty = node('option', '请选择（未填）');
    empty.value = '';
    select.append(empty);
    for (const [value, text] of choices) {
      const option = node('option', text);
      option.value = value;
      select.append(option);
    }
    label.append(select);
    return { element: label, input: select };
  }

  function textareaField(labelText) {
    const label = node('label', labelText);
    const textarea = node('textarea');
    textarea.maxLength = 8000;
    label.append(textarea);
    return { element: label, input: textarea };
  }

  function render() {
    container.replaceChildren();
    fields.clear();
    const sorted = [...packet.items].sort((left, right) => left.seriesId.localeCompare(right.seriesId) || left.chapterIndex - right.chapterIndex);
    for (const item of sorted) {
      const article = node('article');
      article.append(node('h2', `匿名系列 ${item.seriesId.slice(0, 6)} · ${item.genre} · 第${item.chapterIndex}章`));
      const prompt = node('p', item.prompt);
      prompt.className = 'prompt';
      article.append(prompt);
      const pair = node('div');
      pair.className = 'pair';
      const entry = { candidates: {} };
      for (const label of ['A', 'B']) {
        const section = node('section');
        section.className = 'candidate';
        section.append(node('h3', `正文 ${label}`));
        const text = node('div', item.candidates[label].text);
        text.className = 'text';
        text.tabIndex = 0;
        section.append(text);
        const scores = {};
        for (const dimension of dimensions) {
          const field = selectField(`${dimensionNames[dimension]}（1~5）`, [1, 2, 3, 4, 5].map(score => [String(score), String(score)]));
          section.append(field.element);
          scores[dimension] = field.input;
        }
        const stateChecks = {};
        const checks = node('fieldset');
        checks.append(node('legend', '逐项状态审查：需引用当前正文中的逐字证据'));
        for (const dimension of stateDimensions) {
          const status = selectField(stateNames[dimension], [['pass', '审过，无越权/矛盾'], ['fail', '发现问题']]);
          const evidence = textareaField(`${stateNames[dimension]}证据（即使判无问题也需正文引文）`);
          checks.append(status.element, evidence.element);
          stateChecks[dimension] = { status: status.input, evidence: evidence.input };
        }
        section.append(checks);
        entry.candidates[label] = { scores, stateChecks };
        pair.append(section);
      }
      const preference = selectField('整体偏好', [['A', 'A较好'], ['B', 'B较好'], ['tie', '相当'], ['neither', '均不可接受']]);
      const reason = textareaField('偏好理由及跨章状态说明（请说明前章事实与本章变化，不填模板结论）');
      entry.preference = preference.input;
      entry.reason = reason.input;
      article.append(pair, preference.element, reason.element);
      fields.set(item.itemId, entry);
      container.append(article);
    }
  }

  fileInput.addEventListener('change', async () => {
    const sequence = ++loadSequence;
    packet = null;
    exportButton.disabled = true;
    fields.clear();
    container.replaceChildren();
    const file = fileInput.files[0];
    if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('题包超过32MB，请由组织者拆分');
      const next = JSON.parse(await file.text());
      await validatePacket(next);
      if (sequence !== loadSequence) return;
      packet = next;
      render();
      exportButton.disabled = false;
      message.textContent = `已校验 ${packet.items.length} 对正文；所有人工项目仍未填写。页面没有网络写入。`;
    } catch (error) {
      if (sequence === loadSequence) message.textContent = error.message;
    }
  });

  exportButton.addEventListener('click', async () => {
    if (!packet) return;
    const review = {
      schemaVersion: 1, kind: 'molan-human-review', packetId: packet.packetId, packetHash: packet.packetHash,
      reviewer: reviewer.value.trim(), reviewedAt: new Date().toISOString(),
      items: packet.items.map(item => {
        const entry = fields.get(item.itemId);
        const candidates = {};
        for (const label of ['A', 'B']) {
          candidates[label] = {
            textHash: item.candidates[label].textHash,
            scores: Object.fromEntries(dimensions.map(dimension => [dimension, entry.candidates[label].scores[dimension].value ? Number(entry.candidates[label].scores[dimension].value) : null])),
            stateChecks: Object.fromEntries(stateDimensions.map(dimension => [dimension, {
              status: entry.candidates[label].stateChecks[dimension].status.value,
              evidence: entry.candidates[label].stateChecks[dimension].evidence.value.trim()
            }]))
          };
        }
        return { itemId: item.itemId, preference: entry.preference.value, reason: entry.reason.value.trim(), candidates };
      })
    };
    const validation = validateReview(packet, review);
    if (!validation.valid) {
      message.textContent = `未导出：${validation.errors.length}项未完成。\n${validation.errors.slice(0, 12).join('\n')}`;
      return;
    }
    const blob = new Blob([JSON.stringify(review, null, 2)], { type: 'application/json;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = node('a');
    link.href = objectUrl;
    link.download = `human-review-${packet.packetId.slice(0, 12)}-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    message.textContent = '完整人工结果已导出。此动作不等于模型、语义审计或长篇验收通过。';
  });
})();
