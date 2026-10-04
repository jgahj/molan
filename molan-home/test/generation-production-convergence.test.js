'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');

function functionSource(name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, `${name} exists in completion-editor.js`);
  const end = source.indexOf('\n  }', match.index);
  assert.ok(end > match.index);
  return source.slice(match.index, end + 4);
}

function computeDigest(content) {
  return createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function createConvergenceHarness(options = {}) {
  const scene = { id: 'scene-conv-1', name: '收敛测试场景', content: options.content || '' };
  const chapter = { id: 'chapter-conv-1', title: '第一章', scenes: [scene] };
  const state = {
    title: '收敛测试作品',
    generationRuns: options.generationRuns ? [...options.generationRuns] : [],
    chapterContracts: {},
    volumes: [{ id: 'v1', title: '第一卷', chapters: [{ id: chapter.id, title: chapter.title, scenes: [scene] }] }],
    factLedger: { schemaVersion: 1, rules: [{ id: 'fact-1', text: '初始事实' }], promises: [], byEntity: {} },
    foreshadows: [],
    creationBookId: options.creationBookId || 'book-conv-1'
  };

  const records = options.records ? [...options.records] : [{ kind: 'assistant', text: '' }];
  const requests = [];
  const toasts = [];
  const persistedRuns = [];
  const novelSaves = [];
  let v2Called = false;
  let legacyWorkflowCalled = false;

  const sandbox = {
    console, URLSearchParams, TextEncoder, Uint8Array,
    window: { crypto: webcrypto, TextEncoder, clearTimeout() {} },
    document: {
      createElement() {
        return {
          innerHTML: '',
          get textContent() {
            return this.innerHTML.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
          }
        };
      }
    },
    runtime: {
      pendingResults: [],
      editorBusy: false,
      aiApplyBusy: false,
      editorChangeVersion: 0
    },
    DYNAMIC_CONTEXT_MARKER: 'dyn-marker',
    uid: prefix => `${prefix}-${Math.random().toString(16).slice(2, 8)}`,
    esc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    ico: () => '',
    toast: msg => toasts.push(String(msg)),
    editorState: () => state,
    activeScene: () => scene,
    activeRefs: () => ({ volume: state.volumes[0], chapter, scene }),
    chapterSequence: () => [{ volume: state.volumes[0], chapter }],
    ensureKnowledge: () => ({ entities: [] }),
    characterArchetypeDisplay: () => ({ archetype: 'none', source: 'none', confidence: 0 }),
    editorRequestOptions: () => ({}),
    responseText: val => typeof val === 'string' ? val : (val && val.text) || '',
    sanitizeAiFlavor: str => str,
    getVolumeOutline: () => null,
    chapterOutline: () => null,
    completionNovelKey: () => 'novel-1',
    completionTarget: () => ({ chapterId: chapter.id, sceneId: scene.id }),
    completionTargetMatches: () => true,
    getPreview: () => ({ editorChatSessionId: 'sess-1', editorChat: records, novelId: 'n1' }),
    getStage: () => ({
      querySelector: sel => {
        if (sel === '[data-completion-prompt]') return { value: '' };
        if (sel === '[data-completion-thinking]') return { classList: { add() {}, remove() {} } };
        return null;
      }
    }),
    renderGenerationControl: () => {},
    creationChapterNo: () => 1,
    openEditorForm: (title, body, confirmText, onConfirm) => onConfirm(),
    setEditorThinking: () => {},
    renderEditorChat: () => {},
    writeWorkspace: () => {},
    readWorkspace: (key, fallback) => fallback,
    persistEditorChatSession: () => {},
    trimCompletionHistory: () => {},
    chatRecords: () => records,
    editorChatHistoryRecords: () => [],
    editorChatHistoryTitle: () => '历史',
    ensureGenerationActive: () => {},
    markEditorDirty: () => {},
    sessionStorage: { removeItem() {}, getItem() { return null; }, setItem() {} },
    hashText: async val => computeDigest(val),
    persistGenerationRun: (passedState, runItem) => {
      persistedRuns.push(JSON.parse(JSON.stringify(runItem)));
    },
    persistAppliedNovel: async (saveOptions = {}) => {
      novelSaves.push({ content: scene.content, saveOptions });
    },
    renderBodyApplication: () => {},
    syncCreationCommitReceipt: (passedState, runItem) => {
      if (runItem.commitReceipt) {
        passedState.commitSynced = true;
      }
    },
    mergeAcceptedLedger: async (passedState, runItem) => {
      passedState.factLedger.rules.push({ id: 'merged-rule', text: '新采纳事实' });
    },
    commitCreationChapter: async (passedState, recordItem, sceneItem, textContent) => {
      if (options.commitOutcome) {
        return options.commitOutcome;
      }
      const runItem = (passedState.generationRuns || []).find(record => record && record.id === recordItem.workflowRunId);
      if (runItem) {
        runItem.commitReceipt = { snapshotId: 'snap-1', stateVersion: 1 };
      }
      return { ok: true, outcome: 'committed', snapshotId: 'snap-1', stateVersion: 1 };
    },
    generationV2Capabilities: async () => {
      if (options.v2Enabled) {
        return { generationV2: true, disabled: false, commit: true, recovery: true };
      }
      return { generationV2: false, disabled: true, code: 'generation_v2_disabled' };
    },
    runChapterWorkflowV2: async () => {
      v2Called = true;
      return { ok: true };
    },
    runChapterWorkflow: async () => {
      legacyWorkflowCalled = true;
      requests.push({ endpoint: '/api/benchmark/generate' });
      return { ok: true };
    },
    currentContext: () => ({ current: { chapter, scene }, previous: { ending: '' }, history: [], contract: null, body: scene.content, characters: [] }),
    refFunction: name => {
      if (name === 'requestChatText') {
        return async () => {
          requests.push({ endpoint: '/api/chat' });
          return '这是非正文助手的回答内容。';
        };
      }
      return null;
    }
  };

  const functions = [
    'text', 'cloneValue', 'plainText', 'clipContextText', 'isBodyTask', 'isCharacterMaterialTask',
    'sendEditorAI', 'resultAt', 'isRealGenerationV2Run', 'normalizeAudit', 'prepareCreationCommit',
    'markRunNeedsReview', 'applyReviewedBody', 'applyAIResult', 'adoptNeedsReviewBody'
  ];

  vm.createContext(sandbox);
  vm.runInContext(functions.map(functionSource).join('\n'), sandbox);

  return {
    sandbox, state, scene, records, requests, toasts, persistedRuns, novelSaves,
    get v2Called() { return v2Called; },
    get legacyWorkflowCalled() { return legacyWorkflowCalled; }
  };
}

test('convergence: 正式章节任务在 capabilities disabled 时明确阻断，零 benchmark、零旧工作流、零正文篡改', async () => {
  const harness = createConvergenceHarness({ v2Enabled: false, content: '<p>原始章节正文</p>' });
  const { sandbox, scene, records, requests } = harness;

  await sandbox.sendEditorAI('请帮我写本章正文，场景是雪夜山神庙');

  assert.equal(records.length, 3);
  const blockerMsg = records.at(-1);
  assert.equal(blockerMsg.kind, 'assistant');
  assert.equal(blockerMsg.status, 'failed');
  assert.match(blockerMsg.text, /Generation V2 正式正文生成能力当前未开启或不可用/);
  assert.match(blockerMsg.text, /不会回退到旧章节工作流/);
  assert.equal(harness.legacyWorkflowCalled, false);
  assert.equal(harness.v2Called, false);
  assert.equal(requests.filter(req => req.endpoint.includes('benchmark')).length, 0);
  assert.equal(scene.content, '<p>原始章节正文</p>');
  assert.equal(sandbox.runtime.editorBusy, false);
});

test('convergence: 普通非正文助手任务不受 V2 门禁拦截，仍可正常工作', async () => {
  const harness = createConvergenceHarness({ v2Enabled: false });
  const { sandbox, records, requests } = harness;

  await sandbox.sendEditorAI('解释一下世界观里的灵气复苏背景');

  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, '/api/chat');
  assert.match(records.at(-1).text, /这是非正文助手的回答内容/);
  assert.equal(harness.legacyWorkflowCalled, false);
});

test('convergence: capabilities 可用时正常调度 runChapterWorkflowV2', async () => {
  const harness = createConvergenceHarness({ v2Enabled: true });
  const { sandbox } = harness;

  await sandbox.sendEditorAI('写本章正文');

  assert.equal(harness.v2Called, true);
  assert.equal(harness.legacyWorkflowCalled, false);
});

test('convergence: 无标记真实历史记录、缺失 run、伪造 item.generationV2 均拒绝正式采纳并保护草稿', async () => {
  const initialContent = '<p>当前章节正文草稿</p>';
  const proseText = '历史旧记录正文，没有任何 V2 标记。';
  const harness = createConvergenceHarness({ v2Enabled: false, content: initialContent });
  const { sandbox, records, scene, toasts } = harness;

  records.push({
    kind: 'assistant',
    text: proseText,
    status: 'ready',
    workflowRunId: 'legacy-run-1',
    target: { chapterId: 'chapter-conv-1', sceneId: 'scene-conv-1' }
  });

  const legacyIndex = records.length - 1;
  const result = await sandbox.applyAIResult('body', legacyIndex);

  assert.equal(result, false);
  assert.ok(toasts.some(toastText => toastText.includes('非正式 Generation V2 任务禁止正式采纳为正文')));
  assert.equal(scene.content, initialContent);
  assert.equal(records[legacyIndex].text, proseText);
  assert.equal(records[legacyIndex].status, 'ready');

  records[legacyIndex].generationV2 = true;
  toasts.length = 0;
  const spoofedResult = await sandbox.applyAIResult('body', legacyIndex);

  assert.equal(spoofedResult, false);
  assert.ok(toasts.some(toastText => toastText.includes('非正式 Generation V2 任务禁止正式采纳为正文')));
  assert.equal(scene.content, initialContent);
});

test('convergence: 直接调用 applyReviewedBody 对非真实 V2 run 立即阻断，先于状态修改、合成审计与持久化', async () => {
  const initialContent = '<p>作者原始场景</p>';
  const harness = createConvergenceHarness({ v2Enabled: false, content: initialContent });
  const { sandbox, state, scene, toasts, persistedRuns, novelSaves } = harness;

  const legacyItem = {
    kind: 'assistant',
    text: '待复核的旧正文',
    status: 'ready',
    workflowRunId: 'legacy-direct-run',
    target: { chapterId: 'chapter-conv-1', sceneId: 'scene-conv-1' }
  };
  const legacyRun = {
    id: 'legacy-direct-run',
    status: 'ready',
    generationV2: false,
    finalText: legacyItem.text
  };
  state.generationRuns.push(legacyRun);

  const applied = await sandbox.applyReviewedBody(state, legacyItem, scene, 'replace');

  assert.equal(applied, false);
  assert.ok(toasts.some(toastText => toastText.includes('非正式 Generation V2 任务禁止正式采纳为正文')));
  assert.equal(scene.content, initialContent);
  assert.equal(persistedRuns.length, 0);
  assert.equal(novelSaves.length, 0);
  assert.equal(state.factLedger.rules.length, 1);
});

test('convergence: 历史旧 pendingCommit 与 appliedContentHash 记录再次采纳时依然在检查最先阻断', async () => {
  const initialContent = '<p>作者原始场景</p>';
  const harness = createConvergenceHarness({ v2Enabled: false, content: initialContent });
  const { sandbox, state, scene, toasts } = harness;

  const proseText = '旧提交残留正文';
  const digest = computeDigest(proseText);
  const recoveringItem = {
    kind: 'assistant',
    text: proseText,
    status: 'ready',
    workflowRunId: 'recovering-legacy-run',
    target: { chapterId: 'chapter-conv-1', sceneId: 'scene-conv-1' }
  };
  const recoveringRun = {
    id: 'recovering-legacy-run',
    status: 'commit_pending',
    pendingCommit: { body: { content: proseText } },
    appliedContentHash: digest,
    generationV2: false
  };
  state.generationRuns.push(recoveringRun);

  const applied = await sandbox.applyReviewedBody(state, recoveringItem, scene, 'replace');

  assert.equal(applied, false);
  assert.ok(toasts.some(toastText => toastText.includes('非正式 Generation V2 任务禁止正式采纳为正文')));
  assert.equal(scene.content, initialContent);
  assert.equal(state.factLedger.rules.length, 1);
});

test('convergence: adoptNeedsReviewBody 严格阻断：非 V2 拒绝，真实 V2 提示需服务端复审', async () => {
  const harness = createConvergenceHarness({ v2Enabled: false, content: '<p>场景未变</p>' });
  const { sandbox, state, records, toasts } = harness;

  records.push({
    kind: 'assistant',
    text: '待复核非 V2 稿件',
    status: 'needs_review',
    workflowRunId: 'needs-review-non-v2',
    target: { chapterId: 'chapter-conv-1', sceneId: 'scene-conv-1' }
  });
  const nonV2Index = records.length - 1;
  const nonV2Adopt = await sandbox.adoptNeedsReviewBody(nonV2Index);
  assert.equal(nonV2Adopt, false);
  assert.ok(toasts.some(toastText => toastText.includes('非正式 Generation V2 任务禁止正式采纳为正文')));

  toasts.length = 0;
  const v2Prose = '待复核真实 V2 稿件';
  const v2RunId = 'needs-review-real-v2';
  records.push({
    kind: 'assistant',
    text: v2Prose,
    status: 'needs_review',
    generationV2: true,
    workflowRunId: v2RunId,
    target: { chapterId: 'chapter-conv-1', sceneId: 'scene-conv-1' }
  });
  state.generationRuns.push({
    id: v2RunId,
    status: 'needs_review',
    generationV2: true,
    remoteRunId: 'remote-v2-run-99',
    commitBase: { baseStateVersion: 1, baseBibleVersion: 1 }
  });
  const v2Index = records.length - 1;
  const v2Adopt = await sandbox.adoptNeedsReviewBody(v2Index);
  assert.equal(v2Adopt, false);
  assert.ok(toasts.some(toastText => toastText.includes('Generation V2 结果需先通过服务端复审')));
});

test('convergence: 真实 Generation V2 运行采纳：验证远程身份、commitBase 并成功提交落盘', async () => {
  const initialContent = '';
  const v2Prose = '真实 Generation V2 服务端终稿正文。\n\n主角走出山门。';
  const v2Digest = computeDigest(v2Prose);
  const runId = 'v2-prod-run-1';

  const harness = createConvergenceHarness({
    v2Enabled: true,
    content: initialContent,
    creationBookId: 'book-conv-1'
  });
  const { sandbox, state, scene, records } = harness;

  const validV2Run = {
    id: runId,
    status: 'ready',
    generationV2: true,
    remoteRunId: 'server-run-uuid-12345',
    commitBase: { baseStateVersion: 2, baseBibleVersion: 1 },
    finalText: v2Prose,
    outputHash: v2Digest,
    resultContentHash: v2Digest,
    pendingFactLedgerHash: v2Digest,
    audit: {
      passed: true,
      status: 'passed',
      contentHash: v2Digest,
      summary: '全题材质检通过'
    }
  };
  state.generationRuns.push(validV2Run);

  records.push({
    kind: 'assistant',
    text: v2Prose,
    status: 'ready',
    generationV2: true,
    workflowRunId: runId,
    target: { chapterId: 'chapter-conv-1', sceneId: 'scene-conv-1' },
    audit: validV2Run.audit
  });

  const targetIndex = records.length - 1;
  const applied = await sandbox.applyReviewedBody(state, records[targetIndex], scene, 'replace');

  assert.equal(applied, true);
  assert.equal(scene.content, v2Prose);
  assert.equal(records[targetIndex].status, 'ready');
  assert.equal(state.factLedger.rules.length, 2);
  assert.equal(state.commitSynced, true);
});

test('convergence: 真实 Generation V2 提交结果未知恢复保持：保留 commit_unknown 状态与草稿', async () => {
  const initialContent = '';
  const v2Prose = '真实 V2 待重放正文';
  const v2Digest = computeDigest(v2Prose);
  const runId = 'v2-recovery-run-1';

  const harness = createConvergenceHarness({
    v2Enabled: true,
    content: initialContent,
    creationBookId: 'book-conv-1',
    commitOutcome: { ok: false, outcome: 'unknown', error: '网络超时未收到服务端回包' }
  });
  const { sandbox, state, scene, records } = harness;

  const validV2Run = {
    id: runId,
    status: 'ready',
    generationV2: true,
    remoteRunId: 'server-run-uuid-unknown-9',
    commitBase: { baseStateVersion: 2, baseBibleVersion: 1 },
    finalText: v2Prose,
    outputHash: v2Digest,
    resultContentHash: v2Digest,
    pendingFactLedgerHash: v2Digest,
    audit: {
      passed: true,
      status: 'passed',
      contentHash: v2Digest,
      summary: '质检通过'
    }
  };
  state.generationRuns.push(validV2Run);

  records.push({
    kind: 'assistant',
    text: v2Prose,
    status: 'ready',
    generationV2: true,
    workflowRunId: runId,
    target: { chapterId: 'chapter-conv-1', sceneId: 'scene-conv-1' },
    audit: validV2Run.audit
  });

  const targetIndex = records.length - 1;
  const applied = await sandbox.applyAIResult('body', targetIndex);

  assert.equal(applied, false);
  assert.equal(validV2Run.status, 'commit_unknown');
  assert.equal(records[targetIndex].status, 'commit_unknown');
  assert.match(records[targetIndex].errorNotice, /提交结果尚未确认/);
  assert.equal(records[targetIndex].text, v2Prose);
  assert.equal(state.factLedger.rules.length, 1);
});
