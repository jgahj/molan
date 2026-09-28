const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `Start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `End marker not found: ${endMarker}`);
  return source.slice(start, end);
}

test('index.html requestEditorAnswer executes two-stage model-driven planning and creation', async () => {
  const editorAnswerSrc = extractSource(indexSource, 'async function requestEditorAnswer', 'function mountIcons()');

  // Verify key architecture invariants in source
  assert.match(editorAnswerSrc, /stage:\s*'skill_analysis'/);
  assert.match(editorAnswerSrc, /stage:\s*'writing'/);
  assert.match(editorAnswerSrc, /金牌策划执行蓝图与场景分镜/);
  assert.match(editorAnswerSrc, /【模型自主规划·金牌策划执行蓝图】/);
  assert.match(editorAnswerSrc, /options\.onProgress/);

  // Functional mock evaluation
  const calls = [];
  const progressLogs = [];

  const mockRequestChatText = async (messages, options) => {
    calls.push({ messages, options });
    if (options.stage === 'skill_analysis') {
      return '【分镜规划】：第一幕 宴席试探；第二幕 神殿对峙；第三幕 借宝借势；第四幕 月圆惊变。';
    }
    return '# 第一章 月圆夜前的布局\n\n正文内容……';
  };

  // Construct sandbox environment
  const sandbox = {
    document: {
      getElementById: (id) => {
        if (id === 'editorCreationMode') return { value: 'creation' };
        if (id === 'editorStylePreset') return { value: 'xuanhuan' };
        return null;
      }
    },
    previewState: { editorChat: [] },
    requestChatText: mockRequestChatText,
    console
  };

  const fn = new Function('document', 'previewState', 'requestChatText', 'console', `
    ${editorAnswerSrc}
    return requestEditorAnswer;
  `)(sandbox.document, sandbox.previewState, sandbox.requestChatText, sandbox.console);

  const result = await fn('请写月圆夜前的布局', {
    onProgress: (status) => progressLogs.push(status)
  });

  // Check two-stage pipeline execution
  assert.equal(calls.length, 2, 'Must make exactly 2 requests in creation mode');
  assert.equal(calls[0].options.stage, 'skill_analysis', 'Stage 1 must be skill_analysis');
  assert.equal(calls[1].options.stage, 'writing', 'Stage 2 must be writing');

  // Check prompt augmentation
  assert.ok(calls[1].messages[0].content.includes('【模型自主规划·金牌策划执行蓝图】'), 'Stage 2 must include model blueprint');
  assert.ok(calls[1].messages[0].content.includes('第一幕 宴席试探'), 'Stage 2 must carry over the plan from Stage 1');

  // Check progress events
  assert.ok(progressLogs.some(p => p.includes('推演')), 'Must report planning progress');
  assert.ok(progressLogs.some(p => p.includes('名家正文深度创作')), 'Must report drafting progress');

  assert.match(result, /月圆夜前的布局/);
});

test('index.html requestEditorAnswer supports single-pass assistant mode', async () => {
  const editorAnswerSrc = extractSource(indexSource, 'async function requestEditorAnswer', 'function mountIcons()');
  const calls = [];

  const sandbox = {
    document: {
      getElementById: (id) => {
        if (id === 'editorCreationMode') return { value: 'assistant' };
        if (id === 'editorStylePreset') return { value: 'auto' };
        return null;
      }
    },
    previewState: { editorChat: [] },
    requestChatText: async (messages, options) => {
      calls.push({ messages, options });
      return '建议在下一段增强心理描写。';
    },
    console
  };

  const fn = new Function('document', 'previewState', 'requestChatText', 'console', `
    ${editorAnswerSrc}
    return requestEditorAnswer;
  `)(sandbox.document, sandbox.previewState, sandbox.requestChatText, sandbox.console);

  const result = await fn('如何写这一段？');
  assert.equal(calls.length, 1, 'Assistant mode must only make 1 call');
  assert.equal(calls[0].options.stage, 'single');
  assert.equal(result, '建议在下一段增强心理描写。');
});

test('index.html requestEditorAnswer supports auto fallback for narrative engine in creation mode', async () => {
  const editorAnswerSrc = extractSource(indexSource, 'async function requestEditorAnswer', 'function mountIcons()');
  const calls = [];

  const sandbox = {
    document: {
      getElementById: (id) => {
        if (id === 'editorCreationMode') return { value: 'creation' };
        if (id === 'editorStylePreset') return { value: 'auto' }; // auto fallback
        return null;
      }
    },
    previewState: { editorChat: [] },
    requestChatText: async (messages, options) => {
      calls.push({ messages, options });
      if (options.stage === 'skill_analysis') {
        return '【金牌策划执行蓝图与场景分镜】\n1. 人物机锋\n2. 双层反转\n3. 道具出场\n4. 四幕分镜';
      }
      return '正文：第一章 宗门试探…';
    },
    console
  };

  const fn = new Function('document', 'previewState', 'requestChatText', 'console', `
    ${editorAnswerSrc}
    return requestEditorAnswer;
  `)(sandbox.document, sandbox.previewState, sandbox.requestChatText, sandbox.console);

  const result = await fn('请写第一章');
  assert.equal(calls.length, 2, 'Creation mode with auto must complete two-stage pipeline');
  assert.equal(calls[0].options.stylePreset, 'auto');
  assert.equal(calls[1].options.stylePreset, 'auto');
  assert.match(result, /宗门试探/);
});

