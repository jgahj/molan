(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const projectId = params.get('nid');
  const memoryBookId = params.get('bookId') || projectId;
  const token = localStorage.getItem('ml_token') || '';
  const base = '/api/books/' + encodeURIComponent(memoryBookId || '');
  let state;
  let manuscript;
  let reviewed;
  let dirty = false;
  let loading = false;
  let generating = false;
  let generatedRun;
  let rewriteReviewId = '';
  const generationKey = 'molan-memory-run-' + memoryBookId;
  const element = id => document.getElementById(id);
  const lines = id => element(id).value.split('\n').map(value => value.trim()).filter(Boolean);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const plain = html => {
    const document = new DOMParser().parseFromString(String(html).replace(/<\/p>|<br\s*\/?>|<\/div>/gi, '\n'), 'text/html');
    return document.body.textContent.replace(/\n$/, '');
  };
  function status(message, error) {
    element('status').textContent = message;
    element('status').dataset.error = error ? 'true' : 'false';
  }
  async function api(path, body, options) {
    const response = await fetch(path.startsWith('/api/') ? path : base + path, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(options || {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.code || result.error || '请求失败');
    return result;
  }
  function task(action) {
    return async event => {
      if (event) event.preventDefault();
      if (loading) return;
      loading = true;
      try { await action(event); }
      catch (error) { status(error.message, true); }
      finally { loading = false; }
    };
  }
  function tab(name) {
    document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === name)));
  }
  function card(title, content, actions) {
    return '<article class="record-card"><h4>' + escape(title) + '</h4><pre>' + escape(typeof content === 'string' ? content : JSON.stringify(content, null, 2)) + '</pre>' + (actions || '') + '</article>';
  }
  function selection() { return state ? state.chapters[Number(element('chapter').value)] || null : null; }
  function selectChapter() {
    const selected = selection();
    if (!selected) return;
    manuscript = state.manuscripts.find(record => record.chapterId === selected.chapterId && record.sceneId === selected.sceneId);
    element('original').textContent = plain(selected.content);
    element('draft').value = manuscript ? manuscript.text : plain(selected.content);
    element('draftStatus').textContent = manuscript ? '已保存候选版本 ' + manuscript.revision + ' · ' + manuscript.contentHash : '尚未保存候选';
    element('extraction').replaceChildren();
    rewriteReviewId = '';
    element('rewriteReport').textContent = '';
    ['rewriteLockedPropositions', 'rewriteLockedEvents', 'rewriteForbiddenAnswers', 'rewriteLockedForeshadows'].forEach(id => { element(id).value = ''; });
    element('createChangeset').disabled = !state || !state.canWrite;
    dirty = false;
  }
  async function refresh(preserveDraft = true) {
    const savedSelection = selection();
    const draftText = element('draft').value;
    state = await api('/workbench');
    element('title').textContent = state.title + ' · 故事工作台';
    element('chapter').innerHTML = state.chapters.map((chapter, index) => '<option value="' + index + '">' + escape(chapter.title) + '</option>').join('');
    if (savedSelection) {
      const index = state.chapters.findIndex(chapter => chapter.chapterId === savedSelection.chapterId && chapter.sceneId === savedSelection.sceneId);
      if (index >= 0) element('chapter').value = index;
    }
    if (!preserveDraft || !dirty) selectChapter();
    else element('draft').value = draftText;
    document.querySelectorAll('[data-write]').forEach(button => { button.disabled = !state.canWrite; });
    element('changesets').innerHTML = state.changesets.map(record =>
      '<article class="record-card"><p>' + escape(record.id) + ' · ' + escape(record.committed_at ? '已提交' : record.approval_status) +
      ' · 基线 ' + record.base_state_version + '</p><button data-review="' + escape(record.id) + '">查看正文与操作</button></article>').join('') || '<p>暂无变更集。</p>';
    element('projectionReport').textContent = JSON.stringify(state.projections, null, 2);
    element('impactList').innerHTML = state.invalidations.map(record => card('确定来源失效', record)).join('') || '<p>暂无已记录的来源失效。</p>';
    element('createChangeset').disabled = !state.canWrite || dirty || !rewriteReviewId;
    status('正文版本 ' + state.novelRevision + ' · 故事状态 ' + state.stateVersion +
      ' · 投影 ' + state.projections.status + (state.canWrite ? '' : ' · 只读权限'));
  }
  function appendOperation(operation) {
    const operations = JSON.parse(element('operationsInput').value);
    if (!Array.isArray(operations)) throw new Error('操作必须是数组');
    operations.push(operation);
    element('operationsInput').value = JSON.stringify(operations, null, 2);
    status('已加入待提交操作，尚未生效。请回到“正文与确认”建立变更集。');
  }
  function requireSaved() {
    if (!manuscript || dirty) throw new Error('请先保存当前候选，再执行此操作');
    return manuscript.id;
  }
  function requireRewriteReview() {
    if (!rewriteReviewId) throw new Error('请先完成并通过当前候选版本的改写约束审查');
    return rewriteReviewId;
  }
  async function loadStyles() {
    const result = await api('/styles');
    element('styleList').innerHTML = result.styles.map(profile => card(profile.name + ' · v' + profile.revision, profile,
      '<button data-style="' + escape(profile.id) + '">载入编辑</button>')).join('') || '<p>暂无文风配置。</p>';
    element('styleList').querySelectorAll('[data-style]').forEach(button => button.addEventListener('click', () => {
      const profile = result.styles.find(record => record.id === button.dataset.style);
      element('styleId').value = profile.id;
      element('styleRevision').value = profile.revision;
      element('styleName').value = profile.name;
      element('styleLevel').value = profile.level;
      element('styleTarget').value = profile.targetEntityId;
      element('styleScene').value = profile.targetSceneType;
      element('styleRules').value = profile.hardRules.join('\n');
      element('stylePositive').value = profile.positiveSamples.join('\n');
      element('styleNegative').value = profile.negativeSamples.join('\n');
      element('styleForbidden').value = (profile.checkRules.forbiddenTerms || []).join('\n');
    }));
  }
  element('saveDraft').addEventListener('click', task(async () => {
    const selected = selection();
    if (!selected) throw new Error('请先在编辑器建立章节和场景');
    const result = await api('/manuscripts', {
      chapterId: selected.chapterId, sceneId: selected.sceneId, text: element('draft').value,
      expectedRevision: manuscript ? manuscript.revision : 0, expectedNovelRevision: state.novelRevision
    });
    manuscript = result.manuscript;
    dirty = false;
    rewriteReviewId = '';
    element('rewriteReport').textContent = '';
    await refresh(false);
  }));
  element('checkRewrite').addEventListener('click', task(async () => {
    const result = await api('/rewrite', {
      manuscriptRevisionId: requireSaved(),
      contract: {
        taskType: 'rewrite',
        lockedPropositions: lines('rewriteLockedPropositions'),
        lockedEvents: lines('rewriteLockedEvents'),
        lockedForeshadows: lines('rewriteLockedForeshadows'),
        disclosureBoundary: { forbiddenAnswers: lines('rewriteForbiddenAnswers') }
      }
    });
    rewriteReviewId = result.compliant ? result.review.id : '';
    element('rewriteReport').textContent = JSON.stringify({
      status: result.compliant ? '确定性约束检查通过' : '存在约束冲突',
      reviewId: result.review && result.review.id,
      candidateHash: result.candidateHash,
      violations: result.violations,
      requiresHumanReview: result.requiresHumanReview
    }, null, 2);
    element('createChangeset').disabled = !rewriteReviewId || !state.canWrite;
    status(result.compliant ? '约束检查通过；仍需作者审阅正文与记忆操作。' : '约束检查未通过，请修订候选后重新保存并审查。', !result.compliant);
  }));
  ['rewriteLockedPropositions', 'rewriteLockedEvents', 'rewriteForbiddenAnswers', 'rewriteLockedForeshadows'].forEach(id => {
    element(id).addEventListener('input', () => {
      rewriteReviewId = '';
      element('rewriteReport').textContent = '约束已修改，需重新审查当前候选版本。';
      element('createChangeset').disabled = true;
    });
  });
  async function queryGeneration() {
    const requestId = sessionStorage.getItem(generationKey);
    if (!requestId) throw new Error('当前标签页没有已记录任务');
    const result = await api('/generations?requestId=' + encodeURIComponent(requestId));
    generatedRun = result.run;
    element('generationStatus').textContent = JSON.stringify({
      id: generatedRun.id, status: generatedRun.status, calls: generatedRun.calls,
      manifestId: generatedRun.manifestId, usage: generatedRun.result.usage || null,
      hasText: !!generatedRun.result.text
    }, null, 2);
    return generatedRun;
  }
  element('generate').addEventListener('click', async () => {
    if (generating) return;
    generating = true;
    try {
      if (sessionStorage.getItem(generationKey)) {
        const previous = await queryGeneration();
        if (['queued', 'running', 'cancel_requested', 'provider_unknown'].includes(previous.status)) throw new Error('上一任务仍在运行或结果未知，请先查询核对，不会自动重复请求');
      }
      const requestId = crypto.randomUUID();
      const prompt = element('generationPrompt').value.trim();
      if (!prompt) throw new Error('请填写本次创作任务');
      sessionStorage.setItem(generationKey, requestId);
      element('generationStatus').textContent = '请求已发出。请求标识：' + requestId + '。断线后请查询此任务，不要新建重发。';
      const result = await api('/generations', {
        requestId, prompt, modelId: element('generationModel').value.trim(),
        genre: element('generationGenre').value.trim(), targetWords: Number(element('generationWords').value),
        maxCalls: Number(element('generationMaxCalls').value), povId: element('povId').value.trim(),
        storyTime: element('storyTime').value.trim()
      });
      generatedRun = result.run;
      await queryGeneration();
    } catch (error) { status(error.message + '；如请求已经送达，请使用“查询上次任务”。', true); }
    finally { generating = false; }
  });
  element('resumeGeneration').addEventListener('click', task(queryGeneration));
  element('cancelGeneration').addEventListener('click', task(async () => {
    const run = await queryGeneration();
    await api('/generations/' + run.id + '/cancel', {});
    await queryGeneration();
  }));
  element('loadGenerated').addEventListener('click', task(async () => {
    const run = await queryGeneration();
    if (!run.result.text) throw new Error('任务尚未保存正文结果');
    if (dirty && !window.confirm('当前候选尚未保存。是否用生成结果替换输入框？')) return;
    element('draft').value = run.result.text;
    dirty = true;
    rewriteReviewId = '';
    element('createChangeset').disabled = true;
    element('draftStatus').textContent = '已载入生成结果，尚未保存与确认；审稿状态：' + run.status;
  }));
  element('copyDraft').addEventListener('click', task(async () => {
    await navigator.clipboard.writeText(element('draft').value);
    status('候选正文已复制。');
  }));
  element('extract').addEventListener('click', task(async () => {
    const result = await api('/memory/extract', { manuscriptRevisionId: requireSaved() });
    element('extraction').innerHTML = result.evidence.map(evidence => card(evidence.modality + ' · ' + evidence.propositionId, evidence.sourceAnchor.quote,
      '<p>原文位置：' + evidence.sourceAnchor.startOffset + '–' + evidence.sourceAnchor.endOffset +
      '（UTF-16）</p><button data-fact="' + escape(evidence.id) + '">作为待确认事实加入</button>')).join('');
    element('extraction').querySelectorAll('[data-fact]').forEach(button => button.addEventListener('click', task(() => {
      const evidence = result.evidence.find(record => record.id === button.dataset.fact);
      const reason = window.prompt('这是待核对的“' + evidence.modality + '”证据。若确认为世界事实，请写明依据；取消则不添加。');
      if (!reason || !reason.trim()) return;
      appendOperation({ type: 'INSERT_FACT', payload: {
        propositionId: evidence.propositionId, supportingEvidenceIds: [evidence.id], verdict: 'true', decisionReason: reason
      } });
    })));
    status('候选线索已保存。任何线索都尚未成为正式事实。');
  }));
  element('createChangeset').addEventListener('click', task(async () => {
    const result = await api('/memory/changesets', {
      manuscriptRevisionId: requireSaved(), rewriteReviewId: requireRewriteReview(),
      operations: JSON.parse(element('operationsInput').value)
    });
    await refresh();
    await reviewChangeset(result.changeset.id);
  }));
  async function reviewChangeset(id) {
    const result = await api('/memory/changesets/' + encodeURIComponent(id));
    reviewed = result.changeset;
    let text = '';
    if (reviewed.source) text = (await api('/manuscripts/' + encodeURIComponent(reviewed.source.manuscript_id))).manuscript.text;
    element('reviewContent').textContent = '绑定正文：\n' + text + '\n\n完整操作：\n' + JSON.stringify(reviewed.operations, null, 2);
    element('authorConfirm').checked = false;
    element('review').hidden = false;
    const events = await api('/api/runs/' + encodeURIComponent(id) + '/events');
    element('events').textContent = JSON.stringify(events, null, 2);
    tab('draft');
  }
  element('changesets').addEventListener('click', task(async event => {
    const button = event.target.closest('[data-review]');
    if (button) await reviewChangeset(button.dataset.review);
  }));
  element('approve').addEventListener('click', task(async () => {
    if (!reviewed || !element('authorConfirm').checked) throw new Error('请核对完整操作并勾选作者确认');
    await api('/memory/changesets/' + reviewed.id + '/approve', { status: 'approved' });
    status('作者确认已记录；尚未正式提交。');
  }));
  element('reject').addEventListener('click', task(async () => {
    if (!reviewed) return;
    await api('/memory/changesets/' + reviewed.id + '/approve', { status: 'rejected' });
    await refresh();
  }));
  element('commit').addEventListener('click', task(async () => {
    if (!reviewed || !element('authorConfirm').checked) throw new Error('请确认已审阅绑定正文与全部操作');
    const result = await api('/memory/changesets/' + reviewed.id + '/commit', {}, { 'Idempotency-Key': 'workbench-' + reviewed.id });
    dirty = false;
    element('operationsInput').value = '[]';
    await refresh(false);
    status('正文与记忆已提交至版本 ' + result.stateVersion + ' · 投影待同步。返回编辑器前请重新加载云端版本。');
  }));
  element('memoryForm').addEventListener('submit', task(() => {
    const type = element('memoryOperation').value;
    const propositionId = element('propositionId').value.trim();
    let payload;
    if (type === 'INSERT_COGNITION') payload = { targetExpressionId: propositionId, holderEntityId: element('holderId').value.trim(),
      attitude: element('attitude').value, publicStance: element('publicStance').value, acquisitionChannel: 'author_confirmed' };
    else if (type === 'SET_DISCLOSURE') payload = { targetInfoId: propositionId, policyType: element('disclosure').value, allowedClues: lines('clues') };
    else payload = { propositionId, verdict: element('verdict').value, decisionReason: element('decisionReason').value };
    appendOperation({ type, payload });
  }));
  element('planningForm').addEventListener('submit', task(() => {
    const type = element('planningOperation').value;
    const payload = {};
    if (element('recordId').value) payload.id = element('recordId').value.trim();
    if (element('recordRevision').value) payload.expectedRevision = Number(element('recordRevision').value);
    const evidence = lines('recordEvidence');
    if (type === 'TEMPORAL_RELATION') Object.assign(payload, { sourceEventId: element('sourceEntity').value, targetEventId: element('targetEntity').value, relationType: element('relationType').value });
    else if (type === 'UPSERT_COMMITMENT') Object.assign(payload, { promisorId: element('sourceEntity').value, promiseeId: element('targetEntity').value,
      triggerCondition: element('condition').value, fulfillmentContent: element('recordContent').value,
      conditionEvidenceIds: lines('conditionEvidence'), fulfillmentEvidenceIds: evidence });
    else {
      payload.title = element('recordTitle').value;
      if (type === 'INSERT_EVENT') Object.assign(payload, { summary: element('recordContent').value, storyTime: element('eventTime').value, sourceEvidenceIds: evidence });
      if (type === 'UPSERT_PLAN') Object.assign(payload, { content: element('recordContent').value, realizationEventId: element('realizationEvent').value });
      if (type === 'UPSERT_FORESHADOW') Object.assign(payload, { targetSecret: element('recordContent').value, requiredConditions: lines('condition'), payoffEvidenceIds: evidence });
    }
    if (element('recordStatus').value) payload.status = element('recordStatus').value;
    appendOperation({ type, payload });
  }));
  element('loadMemory').addEventListener('click', task(async () => {
    const type = element('memoryType').value;
    const result = await api(type === 'facts' ? '/memory' : type === 'cognition' ? '/cognition' : '/memory/records?type=' + type);
    element('memoryList').innerHTML = (result.memory || result.cognitions || result.records || []).map(record =>
      card(record.displayText || record.display_text || record.id, record)).join('') || '<p>没有匹配记录；没有认知记录不代表人物明确不知。</p>';
  }));
  element('loadPlanning').addEventListener('click', task(async () => {
    const type = element('planningType').value;
    const result = await api(type === 'timeline' ? '/timeline' : '/memory/records?type=' + type);
    element('planningList').innerHTML = type === 'timeline' ? card('时间关系', result.timeline)
      : result.records.map(record => card(record.title || record.id, record)).join('') || '<p>暂无记录。</p>';
  }));
  element('assemble').addEventListener('click', task(async () => {
    const result = await api('/context/assemble', { povId: element('povId').value.trim(), storyTime: element('storyTime').value.trim(), budgetTokens: Number(element('contextBudget').value) });
    element('context').textContent = JSON.stringify({ manifestId: result.manifest.id, inputHash: result.manifest.inputHash,
      writingPackage: result.manifest.writingPackage, excludedReasons: result.manifest.excludedReasons }, null, 2);
  }));
  element('styleForm').addEventListener('submit', task(async () => {
    const body = { name: element('styleName').value, level: element('styleLevel').value,
      targetEntityId: element('styleTarget').value, targetSceneType: element('styleScene').value,
      hardRules: lines('styleRules'), positiveSamples: lines('stylePositive'), negativeSamples: lines('styleNegative'),
      checkRules: { forbiddenTerms: lines('styleForbidden') } };
    if (element('styleId').value) Object.assign(body, { id: element('styleId').value, expectedRevision: Number(element('styleRevision').value) });
    await api('/styles', body);
    element('styleForm').reset();
    element('styleId').value = '';
    element('styleRevision').value = '';
    await loadStyles();
    status('文风新版本已保存。旧候选需重新保存并审查，不能沿用旧配置确认。');
  }));
  element('newStyle').addEventListener('click', () => { element('styleForm').reset(); element('styleId').value = ''; element('styleRevision').value = ''; });
  element('audit').addEventListener('click', task(async () => {
    const result = await api('/style-audits', { manuscriptRevisionId: requireSaved() });
    element('auditReport').textContent = JSON.stringify(result.audit, null, 2);
    tab('styles');
  }));
  element('analyzeImpact').addEventListener('click', task(async () => {
    const targetId = element('impactTarget').value.trim();
    if (!targetId) throw new Error('请填写要分析的对象 ID');
    const result = await api('/impact-analysis', {
      targetId,
      modifiedType: element('impactType').value,
      branchId: element('impactBranch').value.trim() || 'main'
    });
    const impact = result.impact;
    element('impactAnalysisReport').textContent = JSON.stringify({
      targetId: impact.targetId,
      modifiedType: impact.modifiedType,
      totalImpactCount: impact.totalImpactCount,
      coverage: impact.coverage,
      recommendations: impact.recommendations
    }, null, 2);
    const renderGroup = (title, records) => '<section><h4>' + escape(title) + '</h4>' +
      (records.length ? records.map(record => card(record.type + ' · ' + record.severity, { id: record.id, summary: record.summary })).join('') : '<p>没有发现记录。</p>') + '</section>';
    element('impactAnalysisResults').innerHTML = renderGroup('明确影响', impact.explicitImpacts || []) +
      renderGroup('可能影响', impact.potentialImpacts || []);
    status('影响分析完成；语义依赖仍需人工复核。');
  }));
  element('process').addEventListener('click', task(async () => { await api('/projections/process', {}); await refresh(); }));
  async function loadOperations() {
    const result = await api('/memory/operations');
    element('operationList').innerHTML = result.operations.map(operation => card(operation.operation_type + ' · ' + operation.record_id,
      JSON.parse(operation.after_state_json), operation.reverted ? '<p>已补偿撤销</p>' :
        '<button data-revert="' + escape(operation.id) + '"' + (state.canWrite ? '' : ' disabled') + '>建立补偿撤销</button>')).join('');
  }
  element('operationList').addEventListener('click', task(async event => {
    const button = event.target.closest('[data-revert]');
    if (!button) return;
    const reason = window.prompt('请说明撤销理由。若已有后续修改，服务端将拒绝直接撤销。');
    if (!reason) return;
    await api('/memory/operations/' + button.dataset.revert + '/revert', { reason });
    await refresh();
    await loadOperations();
  }));
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', task(async () => {
    tab(button.dataset.tab);
    if (button.dataset.tab === 'styles') await loadStyles();
    if (button.dataset.tab === 'operations') await loadOperations();
  })));
  element('draft').addEventListener('input', () => {
    dirty = true;
    rewriteReviewId = '';
    element('createChangeset').disabled = true;
    element('draftStatus').textContent = '候选正文已修改，尚未保存；旧审核不适用于此内容';
  });
  element('chapter').addEventListener('change', () => {
    if (dirty && !window.confirm('当前候选尚未保存，是否放弃未保存文字并切换？')) {
      if (manuscript) element('chapter').value = state.chapters.findIndex(chapter => chapter.chapterId === manuscript.chapterId && chapter.sceneId === manuscript.sceneId);
      return;
    }
    selectChapter();
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  function clearAfterAccountChange() {
    if ((localStorage.getItem('ml_token') || '') === token) return;
    dirty = false;
    state = null;
    manuscript = null;
    reviewed = null;
    generatedRun = null;
    document.body.replaceChildren();
    const message = document.createElement('p');
    message.textContent = '登录状态已变化，作品内容已清除。请重新从作品列表进入。';
    document.body.append(message);
  }
  window.addEventListener('storage', clearAfterAccountChange);
  document.addEventListener('visibilitychange', clearAfterAccountChange);
  element('refresh').addEventListener('click', task(() => refresh()));
  element('editorLink').href = '../index.html?nid=' + encodeURIComponent(projectId || '') + '#editor';
  element('editorLink').addEventListener('click', (event) => {
    if (window.parent && window.parent !== window) {
      event.preventDefault();
      window.parent.postMessage({ type: 'molan:navigate', page: 'editor', novelId: projectId }, '*');
    }
  });
  const syncBtn = element('syncToEditor');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      const textToSync = (element('draft')?.value || element('original')?.textContent || '').trim();
      if (!textToSync) {
        status('正文内容为空，无法同步', true);
        return;
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'molan:apply-draft-to-editor',
          text: textToSync,
          novelId: projectId,
          chapterId: element('chapter')?.value
        }, '*');
        status('已将正文成功同步至主 AI 编辑器！');
      } else if (window.opener && window.opener !== window) {
        window.opener.postMessage({
          type: 'molan:apply-draft-to-editor',
          text: textToSync,
          novelId: projectId,
          chapterId: element('chapter')?.value
        }, '*');
        status('已通过跨窗口直传同步至主 AI 编辑器！');
      } else {
        localStorage.setItem('molan_external_draft_' + projectId, textToSync);
        localStorage.setItem('molan_external_draft', JSON.stringify({
          text: textToSync,
          novelId: projectId,
          chapterId: element('chapter')?.value,
          time: Date.now()
        }));
        status('正文已暂存，切回主编辑器即可载入！');
      }
    });
  }
  const pushDraftBtn = element('pushDraftToAiEditor');
  if (pushDraftBtn) {
    pushDraftBtn.addEventListener('click', () => {
      const draftText = (element('draft')?.value || '').trim();
      if (!draftText) { status('候选稿为空', true); return; }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'molan:cite-to-prompt',
          text: '【工作台候选正文】\n' + draftText,
          title: '候选正文'
        }, '*');
        status('已将候选稿带入 AI 创作助手提示词！');
      } else if (window.opener && window.opener !== window) {
        window.opener.postMessage({
          type: 'molan:cite-to-prompt',
          text: '【工作台候选正文】\n' + draftText,
          title: '候选正文'
        }, '*');
        status('已通过跨窗口直传将候选稿带入 AI 创作助手！');
      } else {
        localStorage.setItem('molan_external_cite', JSON.stringify({
          text: '【工作台候选正文】\n' + draftText,
          title: '候选正文',
          time: Date.now()
        }));
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText('【工作台候选正文】\n' + draftText).catch(() => {});
        }
        status('已将候选稿暂存并复制，切回主编辑器即可载入提示词！');
      }
    });
  }
  element('materialsLink').href = './project-docs.html?nid=' + encodeURIComponent(projectId || '') +
    (memoryBookId && memoryBookId !== projectId ? '&bookId=' + encodeURIComponent(memoryBookId) : '');
  if (!projectId || !token) status('请登录后从已保存的作品进入工作台。', true);
  else task(() => refresh(false))();
})();
