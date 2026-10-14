'use strict';

/**
 * prompt-markers.js — 提示词标记常量（唯一来源）。
 *
 * DYNAMIC_PROMPT_MARKER 是 user 消息中「稳定提示词 / 动态上下文」的分界标记：
 *   - splitDynamicPrompt 依此把消息拆为 stable + dynamic 两条，供上游做提示词缓存；
 *   - 纠错策略/安全围栏注入依此定位插入点。
 * 历史问题：该常量原仅在 server.js 内联定义，content-engine 产出的
 * RenderedPromptPackage 用户消息缺失标记，导致规范主链走的提示词
 * 与回退路径不一致（少一次 stable/dynamic 拆分，且指纹覆盖不完整）。
 * 现收口至本模块，server.js / content-engine / model-call-service 共用。
 */

const DYNAMIC_PROMPT_MARKER = '<!-- molan-dynamic-context-v2 -->';

module.exports = { DYNAMIC_PROMPT_MARKER };
