'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSearchIndex, createWorkerClient } = require('../lib/client/search-index');

test('倒排搜索返回章节、场景、版本和原文偏移', () => {
  const index = createSearchIndex([
    { chapterId: 'c1', chapterTitle: '第一章', sceneId: 's1', sceneTitle: '门口', revision: 7, text: '她看见规则怪谈写在墙上。' },
    { chapterId: 'c2', chapterTitle: '第二章', sceneId: 's2', text: '他们没有看见那面墙。' }
  ]);
  const result = index.search('规则怪谈');
  assert.equal(result.totalMatches, 1);
  assert.equal(result.matches[0].chapterId, 'c1');
  assert.equal(result.matches[0].sceneId, 's1');
  assert.equal(result.matches[0].revision, 7);
  assert.equal(result.matches[0].start, 3);
  assert.equal(result.matches[0].end, 7);
  assert.match(result.matches[0].snippet.text, /规则怪谈/);
});

test('索引支持单字、区分大小写和全角兼容规范化', () => {
  const index = createSearchIndex([
    { chapterId: 'c1', sceneId: 's1', text: 'Ａ门 Alpha alpha' }
  ]);
  const compatible = index.search('A');
  assert.equal(compatible.totalMatches, 5);
  assert.equal(compatible.matches[0].start, 0);
  assert.equal(index.search('alpha').totalMatches, 2);
  assert.equal(index.search('alpha', { caseSensitive: true }).totalMatches, 1);
});

test('空查询与无匹配查询不扫描或返回伪命中', () => {
  const index = createSearchIndex([{ chapterId: 'c1', sceneId: 's1', text: '正文' }]);
  assert.deepEqual(index.search(' '), { query: ' ', totalMatches: 0, truncated: false, matches: [] });
  assert.equal(index.search('不存在').totalMatches, 0);
});

test('命中上限显式报告截断状态', () => {
  const index = createSearchIndex([{ chapterId: 'c1', sceneId: 's1', text: '词词词词词词' }]);
  const result = index.search('词', { limit: 2 });
  assert.equal(result.matches.length, 2);
  assert.equal(result.totalMatches, 6);
  assert.equal(result.truncated, true);
});

test('索引重建移除已删除正文，清空后文档数归零', () => {
  const index = createSearchIndex([{ chapterId: 'c1', sceneId: 's1', text: '旧词' }]);
  assert.equal(index.search('旧词').totalMatches, 1);
  assert.equal(index.build([]).documentCount, 0);
  assert.equal(index.search('旧词').totalMatches, 0);
});

test('Worker 客户端按请求 ID 配对异步构建和查询结果', async () => {
  const listeners = new Map();
  const index = createSearchIndex();
  const worker = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    postMessage(message) {
      queueMicrotask(() => {
        try {
          const result = message.type === 'build'
            ? index.build(message.documents)
            : index.search(message.query, message.options);
          listeners.get('message')({ data: { id: message.id, ok: true, result } });
        } catch (error) {
          listeners.get('message')({ data: { id: message.id, ok: false, error: error.message } });
        }
      });
    },
    terminate() {}
  };
  const client = createWorkerClient(worker);
  assert.deepEqual(await client.build([{ chapterId: 'c1', sceneId: 's1', text: '异步索引' }]), { documentCount: 1 });
  const result = await client.search('索引');
  assert.equal(result.matches[0].sceneId, 's1');
});
