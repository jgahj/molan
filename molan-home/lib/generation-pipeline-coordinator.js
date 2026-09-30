'use strict';

/**
 * @deprecated
 * ⚠️【历史组件转发层 / LEGACY SHIM】
 * 原始实现已物理迁移至 lib/legacy/generation-pipeline-coordinator.js。
 * 生产入口（server.js /api/generation-runs 以及 lib/generation/*）严禁调用本模块。
 * 本文件仅用于历史测试兼容。
 */

const legacy = require('./legacy/generation-pipeline-coordinator');

module.exports = {
  ...legacy
};
