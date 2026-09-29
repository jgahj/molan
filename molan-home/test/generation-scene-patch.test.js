'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applySceneOperations,
  hashSceneText,
  locateScene
} = require('../lib/generation/scene-patch');

test('场景 splice 使用 UTF-16 字符索引并按顺序应用', () => {
  const result = applySceneOperations('甲😀乙', [
    { type: 'splice', index: 1, deleteCount: 2, text: '丙' },
    { type: 'splice', index: 2, deleteCount: 1, text: '丁戊' }
  ]);
  assert.equal(result, '甲丙丁戊');
});

test('场景 splice 拒绝越界、错误类型和空操作', () => {
  assert.throws(() => applySceneOperations('abc', [{ type: 'splice', index: 2, deleteCount: 2, text: '' }]), { code: 'CONTRACT_INVALID' });
  assert.throws(() => applySceneOperations('abc', [{ type: 'replace', index: 0, deleteCount: 1, text: '' }]), { code: 'CONTRACT_INVALID' });
  assert.throws(() => applySceneOperations('abc', []), { code: 'CONTRACT_INVALID' });
});

test('场景定位按 chapterId 和 sceneId，不依赖数组下标', () => {
  const state = { volumes: [{ chapters: [
    { id: 'chapter-a', scenes: [{ id: 'scene-a', content: '正文' }] },
    { id: 'chapter-b', scenes: [{ sceneId: 'scene-b', content: '其他' }] }
  ] }] };
  assert.equal(locateScene(state, 'chapter-b', 'scene-b').scene.content, '其他');
  assert.equal(locateScene(state, 'chapter-a', 'scene-b'), null);
  assert.equal(hashSceneText('正文').length, 64);
});
