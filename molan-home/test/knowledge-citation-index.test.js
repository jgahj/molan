'use strict';

/**
 * 知识页引用统计索引专项测试
 * 覆盖：DOM 无关可见文本提取、单遍合并正则索引正确性（别名/共享别名/长名优先）、
 *       memoize 命中与编辑失效、debounce 合并、性能不变量（一次构建 + O(1) 查询）。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const completionEditorSource = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');

/** 从 completion-editor.js 提取引用索引代码块（含 citationIndexCache 闭包变量） */
function extractCitationBlock() {
  const start = completionEditorSource.indexOf('let citationIndexCache');
  const end = completionEditorSource.indexOf('const debouncedKnowledgeSearchRender');
  assert.ok(start >= 0 && end > start, '未找到引用索引代码块');
  return completionEditorSource.slice(start, end);
}

/** 以测试桩依赖执行真实代码块 */
function createHarness({ editorChangeVersion = 0 } = {}) {
  const stubs = {
    text: value => String(value == null ? '' : value).replace(/\u0000/g, ''),
    ensureKnowledge: state => (state && state.knowledge) || { entities: {}, edges: [] },
    runtime: { editorChangeVersion },
    renderKnowledgeList: () => {},
    editorState: () => null
  };
  const factory = new Function(
    'text', 'ensureKnowledge', 'runtime', 'renderKnowledgeList', 'editorState',
    `${extractCitationBlock()}\nreturn { citationPlain, buildCitationIndex, citationIndexSignature, citationIndexFor, citationStats, debounce, runtime };`
  );
  return factory(stubs.text, stubs.ensureKnowledge, stubs.runtime, stubs.renderKnowledgeList, stubs.editorState);
}

function makeState({ chapters = [], entities = {} }) {
  return {
    volumes: [{
      title: '卷一',
      chapters: chapters.map((body, i) => ({
        id: `c${i}`, title: `第${i + 1}章`,
        scenes: [{ id: `s${i}`, content: body }]
      }))
    }],
    knowledge: { entities, edges: [], version: 1 }
  };
}

test('citationPlain：去标签 + 解实体，与 DOM 可见文本等价', () => {
  const { citationPlain } = createHarness();
  assert.equal(citationPlain('<p>林安 走进 <b>大殿</b>&amp;离开</p>'), '林安 走进 大殿&离开');
  assert.equal(citationPlain('<p>a</p><p>b</p>'), 'ab');
  assert.equal(citationPlain(''), '');
  assert.equal(citationPlain(null), '');
});

test('索引正确性：名称命中、别名命中、跨章累计', () => {
  const { citationStats } = createHarness();
  const state = makeState({
    chapters: ['林安走进大殿', '殿外无人，林安离去', '沈商提到林安'],
    entities: {
      e1: { id: 'e1', name: '林安', aliases: ['安公子'] },
      e2: { id: 'e2', name: '沈商', aliases: [] }
    }
  });
  assert.deepEqual(citationStats(state, state.knowledge.entities.e1), { count: 3, chapters: ['第1章', '第2章', '第3章'] });
  assert.deepEqual(citationStats(state, state.knowledge.entities.e2), { count: 1, chapters: ['第3章'] });
});

test('索引正确性：别名计入、共享别名双计、空 needle 记零', () => {
  const { citationStats } = createHarness();
  const state = makeState({
    chapters: ['安公子来了，安公子又走了'],
    entities: {
      e1: { id: 'e1', name: '林安', aliases: ['安公子'] },
      e2: { id: 'e2', name: '安公子', aliases: [] },
      e3: { id: 'e3', name: '', aliases: [] }
    }
  });
  assert.equal(citationStats(state, state.knowledge.entities.e1).count, 2);
  assert.equal(citationStats(state, state.knowledge.entities.e2).count, 2);
  assert.equal(citationStats(state, state.knowledge.entities.e3).count, 0);
});

test('索引正确性：长 needle 优先，短名前缀不误吞长名', () => {
  const { citationStats } = createHarness();
  const state = makeState({
    chapters: ['林安与林商'],
    entities: {
      e1: { id: 'e1', name: '林', aliases: [] },
      e2: { id: 'e2', name: '林安', aliases: [] }
    }
  });
  assert.equal(citationStats(state, state.knowledge.entities.e1).count, 1, '「林」只应命中独立出现的林商之林');
  assert.equal(citationStats(state, state.knowledge.entities.e2).count, 1, '「林安」应完整命中');
});

test('memoize：同签名复用同一索引，编辑变更版本变化则重建', () => {
  const harness = createHarness({ editorChangeVersion: 1 });
  const state = makeState({ chapters: ['林安'], entities: { e1: { id: 'e1', name: '林安', aliases: [] } } });
  const first = harness.citationIndexFor(state);
  const second = harness.citationIndexFor(state);
  assert.equal(first, second, '同签名应返回同一 Map 实例');
  harness.runtime.editorChangeVersion = 2;
  const third = harness.citationIndexFor(state);
  assert.notEqual(third, first, '编辑后应重建索引');
  assert.equal(third.get('e1').count, 1);
});

test('memoize：正文长度变化即使章数不变也重建', () => {
  const harness = createHarness({ editorChangeVersion: 1 });
  const state = makeState({ chapters: ['林安'], entities: { e1: { id: 'e1', name: '林安', aliases: [] } } });
  const first = harness.citationIndexFor(state);
  state.volumes[0].chapters[0].scenes[0].content = '林安林安';
  const second = harness.citationIndexFor(state);
  assert.notEqual(first, second);
  assert.equal(second.get('e1').count, 2);
});

test('性能不变量：一次构建服务全部查询（模拟旧实现的 6 次/实体全扫）', () => {
  const { buildCitationIndex, citationStats } = createHarness();
  const chapters = [];
  for (let i = 0; i < 60; i += 1) {
    chapters.push(`第${i}章正文，林安与沈商在殿中对峙，苏黎旁观。`.repeat(20));
  }
  const entities = {};
  for (let i = 0; i < 40; i += 1) {
    entities[`e${i}`] = { id: `e${i}`, name: i % 2 ? '林安' : '沈商', aliases: i % 3 ? ['苏黎'] : [] };
  }
  const state = makeState({ chapters, entities });
  const index = buildCitationIndex(state);
  // 旧实现：每实体 6 次全本扫描 = 240 次；新实现：1 次构建 + Map 查询
  for (let round = 0; round < 6; round += 1) {
    Object.keys(entities).forEach(id => citationStats(state, entities[id]));
  }
  // e1：名称「林安」每章 20 次 + 别名「苏黎」每章 20 次 = 每章 40 次 × 60 章
  assert.equal(index.get('e1').count, 60 * 20 * 2);
  assert.equal(index.size, 40);
});

test('debounce：连续触发只执行一次', async () => {
  const { debounce } = createHarness();
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 30);
  fn(); fn(); fn();
  assert.equal(calls, 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(calls, 1);
});

test('debounce：cancel 后不再执行', async () => {
  const { debounce } = createHarness();
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 20);
  fn();
  fn.cancel();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls, 0);
});
