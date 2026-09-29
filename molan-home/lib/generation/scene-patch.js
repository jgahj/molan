'use strict';

const crypto = require('node:crypto');
const { GenerationError } = require('./errors');

const MAX_SCENE_OPERATIONS = 100;
const MAX_SCENE_PATCH_BYTES = 1024 * 1024;

/** 计算场景正文基线摘要；与浏览器 IndexedDB WAL 的 SHA-256 契约一致。 */
function hashSceneText(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value), 'utf8').digest('hex');
}

/** 顺序应用 UTF-16 字符索引 splice，拒绝范围错误或异常大的补丁。 */
function applySceneOperations(value, operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > MAX_SCENE_OPERATIONS) {
    throw new GenerationError('CONTRACT_INVALID', 'operations 必须包含 1 到 100 条正文操作', { status: 422 });
  }
  if (Buffer.byteLength(JSON.stringify(operations), 'utf8') > MAX_SCENE_PATCH_BYTES) {
    throw new GenerationError('CONTEXT_OVERFLOW', '场景差量超过 1 MB 限制', { status: 413 });
  }
  let content = String(value == null ? '' : value);
  for (const operation of operations) {
    if (!operation || operation.type !== 'splice') {
      throw new GenerationError('CONTRACT_INVALID', '场景操作类型无效', { status: 422 });
    }
    const index = Number(operation.index);
    const deleteCount = Number(operation.deleteCount);
    if (!Number.isInteger(index) || !Number.isInteger(deleteCount) || index < 0 || deleteCount < 0 || index + deleteCount > content.length) {
      throw new GenerationError('CONTRACT_INVALID', '场景操作位置无效', { status: 422 });
    }
    if (typeof operation.text !== 'string') {
      throw new GenerationError('CONTRACT_INVALID', '场景操作 text 必须是字符串', { status: 422 });
    }
    content = content.slice(0, index) + operation.text + content.slice(index + deleteCount);
  }
  return content;
}

/** 按 id 定位卷中的章节和场景，不依赖客户端提供数组下标。 */
function locateScene(state, chapterId, sceneId) {
  if (!state || !Array.isArray(state.volumes)) return null;
  for (let volumeIndex = 0; volumeIndex < state.volumes.length; volumeIndex += 1) {
    const volume = state.volumes[volumeIndex];
    const chapters = Array.isArray(volume && volume.chapters) ? volume.chapters : [];
    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
      const chapter = chapters[chapterIndex];
      if (String(chapter && chapter.id) !== String(chapterId)) continue;
      const scenes = Array.isArray(chapter.scenes) ? chapter.scenes : [];
      const sceneIndex = scenes.findIndex(item => String(item && (item.id || item.sceneId)) === String(sceneId));
      if (sceneIndex < 0) return null;
      return {
        chapter,
        scene: scenes[sceneIndex],
        path: ['volumes', String(volumeIndex), 'chapters', String(chapterIndex), 'scenes', String(sceneIndex), 'content']
      };
    }
  }
  return null;
}

module.exports = {
  MAX_SCENE_OPERATIONS,
  MAX_SCENE_PATCH_BYTES,
  hashSceneText,
  applySceneOperations,
  locateScene
};
