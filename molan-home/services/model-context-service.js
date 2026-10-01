'use strict';

function createModelContextService({ findPlatformModel, normalizeContextWindowTokens, defaultContextWindowTokens, DYNAMIC_PROMPT_FLAG, DYNAMIC_PROMPT_MARKER, copyCharacterMaterialMessageFlag, characterMaterialMessageMeta, INJECTION_GUARD, CONTEXT_WINDOW_SAFETY_TOKENS, CONTEXT_WINDOW_MIN_COMPLETION_TOKENS }) {
  // 请求开始前没有统一可用的 tokenizer，只能用保守的字符启发式估算。
  // UTF-8 字节数不是 Token 数：一个中文字符通常不是 3 个 Token，直接使用
  // byteLength 会把中文长上下文高估约 2~3 倍，导致低余额请求被过早截断。
  function estimateTextTokenUpperBound(value) {
    const text = String(value == null ? '' : value);
    let tokens = 0;
    let asciiRun = 0;
    const flushAscii = () => {
      if (!asciiRun) return;
      // 英文、数字、路径和 JSON 片段按 2 字符约 1 Token 估算，保持保守。
      tokens += Math.ceil(asciiRun / 2);
      asciiRun = 0;
    };
    for (const ch of text) {
      const code = ch.codePointAt(0) || 0;
      if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
        asciiRun += 1;
        continue;
      }
      flushAscii();
      if (/\s/u.test(ch)) {
        tokens += 0.5;
      } else if (
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0x3040 && code <= 0x30ff) ||
        (code >= 0xac00 && code <= 0xd7af)
      ) {
        // 中文、日文、韩文按 1.5 Token/字符预留，覆盖常见分词差异。
        tokens += 1.5;
      } else if (code > 0xffff) {
        // Emoji 和其他补充平面字符通常会拆成多个 Token。
        tokens += 2;
      } else {
        // 标点、引号、JSON 结构符号各按一个 Token 预留。
        tokens += 1;
      }
    }
    flushAscii();
    return Math.max(0, Math.ceil(tokens));
  }

  function promptTokenUpperBound(messages) {
    if (!Array.isArray(messages)) return 0;
    // JSON punctuation is only a transport format and should not be counted as
    // model input. Counting the serialized request can reserve roughly twice as
    // many tokens for long Chinese prompts and stop generation too early.
    let total = 0;
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue;
      total += 16; // message framing and role overhead
      total += estimateTextTokenUpperBound(message.role || '');
      if (typeof message.content === 'string') {
        total += estimateTextTokenUpperBound(message.content);
      } else if (Array.isArray(message.content)) {
        message.content.forEach(part => {
          if (!part || typeof part !== 'object') return;
          total += 8 + estimateTextTokenUpperBound(part.type || '');
          if (typeof part.text === 'string') total += estimateTextTokenUpperBound(part.text);
          else total += estimateTextTokenUpperBound(JSON.stringify(part));
        });
      } else if (message.content != null) {
        total += estimateTextTokenUpperBound(JSON.stringify(message.content));
      }
    }
    return Math.min(20000000, Math.ceil(total));
  }

  // 预留只用于并发控额，不是最终计费。最终积分只能来自上游返回的精确 usage。
  function contextWindowTokensForModel(modelOrId) {
    const model = modelOrId && typeof modelOrId === 'object' ? modelOrId : findPlatformModel(modelOrId);
    return normalizeContextWindowTokens(
      model && model.contextWindowTokens,
      defaultContextWindowTokens(model)
    );
  }

  function markDynamicPromptMessage(message) {
    if (message && typeof message === 'object') {
      Object.defineProperty(message, DYNAMIC_PROMPT_FLAG, { value: true, enumerable: false, configurable: true });
    }
    return message;
  }

  function copyDynamicPromptFlag(source, target) {
    if (source && source[DYNAMIC_PROMPT_FLAG]) markDynamicPromptMessage(target);
    return target;
  }

  /** Copy all internal prompt priority markers while preserving the public message shape. */
  function copyPromptMessageFlags(source, target) {
    copyDynamicPromptFlag(source, target);
    copyCharacterMaterialMessageFlag(source, target);
    return target;
  }

  /** 为写作类消息追加提示词注入边界，并保持 JSON 与其他阶段消息不变。 */
  function injectPromptInjectionGuard(messages, stage, jsonMode) {
    const source = Array.isArray(messages) ? messages : [];
    const normalizedStage = String(stage || '').trim().toLowerCase();
    if (jsonMode === true || !['writing', 'humanizer'].includes(normalizedStage)) return source;
    const output = source.map(message => copyPromptMessageFlags(message, { ...message }));
    const systemIndex = output.findIndex(message => message && message.role === 'system');
    const marker = INJECTION_GUARD.trim();
    if (systemIndex < 0) {
      output.unshift({ role: 'system', content: marker });
      return output;
    }
    const content = String(output[systemIndex].content || '');
    if (!content.includes(marker)) output[systemIndex].content = content + INJECTION_GUARD;
    return output;
  }

  function dynamicPromptMessageIndex(messages) {
    if (!Array.isArray(messages)) return -1;
    return messages.findIndex(message => message &&
      (message[DYNAMIC_PROMPT_FLAG] || (typeof message.content === 'string' && message.content.startsWith(DYNAMIC_PROMPT_MARKER))));
  }

  function stripDynamicPromptMarker(messages) {
    return (Array.isArray(messages) ? messages : []).map(message => {
      if (!message || typeof message.content !== 'string' || !message.content.startsWith(DYNAMIC_PROMPT_MARKER)) return message;
      return copyPromptMessageFlags(message, { ...message, content: message.content.slice(DYNAMIC_PROMPT_MARKER.length).replace(/^\s+/, '') });
    });
  }

  function truncatePromptMessageToTokens(message, maxTokens, marker) {
    if (!message || typeof message.content !== 'string') return message;
    const limit = Math.max(0, Math.floor(Number(maxTokens) || 0));
    if (promptTokenUpperBound([message]) <= limit) return message;
    const source = message.content;
    const suffix = String(marker || '\n\n[墨阑提示：当前模型窗口有限，作品动态上下文已保留前部内容。]');
    const codePoints = Array.from(source);
    const candidateFor = count => copyPromptMessageFlags(message, {
      ...message,
      content: codePoints.slice(0, count).join('') + suffix
    });
    let low = 0;
    let high = codePoints.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (promptTokenUpperBound([candidateFor(middle)]) <= limit) low = middle;
      else high = middle - 1;
    }
    const candidate = candidateFor(low);
    if (promptTokenUpperBound([candidate]) <= limit) return candidate;
    const empty = copyPromptMessageFlags(message, { ...message, content: '' });
    return promptTokenUpperBound([empty]) <= limit ? empty : null;
  }

  /** Rebuild a planned prompt while omitting only material messages selected by the budget planner. */
  function composeContextWindowMessages(messages, dynamicIndex, dynamicMessage, removedMaterialIndexes) {
    const removed = removedMaterialIndexes instanceof Set ? removedMaterialIndexes : new Set();
    const output = [];
    (Array.isArray(messages) ? messages : []).forEach((message, index) => {
      if (index === dynamicIndex) {
        if (dynamicMessage) output.push(dynamicMessage);
        return;
      }
      if (characterMaterialMessageMeta(message) && removed.has(index)) return;
      output.push(message);
    });
    return output;
  }

  /** Plan model-window usage while preserving protected prompts before character material. */
  function planContextWindow(modelOrId, messages, requestedMaxTokens) {
    const contextWindowTokens = contextWindowTokensForModel(modelOrId);
    const requested = Math.max(1, Math.floor(Number(requestedMaxTokens) || 1));
    const dynamicIndex = dynamicPromptMessageIndex(messages);
    const upstreamMessages = stripDynamicPromptMarker(messages);
    const materialEntries = upstreamMessages
      .map((message, index) => ({ message, index, meta: characterMaterialMessageMeta(message) }))
      .filter(item => item.meta);
    const protectedFixedMessages = upstreamMessages.filter((message, index) => index !== dynamicIndex && !characterMaterialMessageMeta(message));
    const fixedPromptTokens = promptTokenUpperBound(protectedFixedMessages);
    const originalDynamicMessage = dynamicIndex >= 0 ? upstreamMessages[dynamicIndex] : null;
    const originalDynamicPromptTokens = originalDynamicMessage ? promptTokenUpperBound([originalDynamicMessage]) : 0;
    let plannedDynamicMessage = originalDynamicMessage;
    let dynamicPromptTruncated = false;

    const removedMaterialIndexes = new Set();
    const originalCharacterMaterialTokens = materialEntries.reduce((sum, item) => sum + promptTokenUpperBound([item.message]), 0);
    const originalCharacterMaterialSampleTokens = materialEntries
      .filter(item => item.meta.kind === 'sample')
      .reduce((sum, item) => sum + promptTokenUpperBound([item.message]), 0);
    const dynamicAndProtectedTokens = fixedPromptTokens + originalDynamicPromptTokens;
    const characterMaterialBudget = Math.max(0, contextWindowTokens - dynamicAndProtectedTokens - CONTEXT_WINDOW_SAFETY_TOKENS - requested);
    let samplesRemovedByBudget = false;
    let rulesReducedByBudget = false;
    let materialEntriesTokens = originalCharacterMaterialTokens;

    // Character samples are the lowest writing-specific priority. Remove them
    // before reducing rule cards so facts, Skill instructions, and corrections
    // can remain complete in smaller model windows.
    if (materialEntriesTokens > characterMaterialBudget) {
      materialEntries.filter(item => item.meta.kind === 'sample').forEach(item => {
        removedMaterialIndexes.add(item.index);
        samplesRemovedByBudget = true;
      });
      materialEntriesTokens = materialEntries
        .filter(item => !removedMaterialIndexes.has(item.index))
        .reduce((sum, item) => sum + promptTokenUpperBound([item.message]), 0);
    }

    // Rule cards are ordered by retrieval relevance. A front-preserving token
    // bound therefore keeps the most relevant cards before dropping the block.
    if (materialEntriesTokens > characterMaterialBudget) {
      const ruleEntry = materialEntries.find(item => item.meta.kind === 'rules' && !removedMaterialIndexes.has(item.index));
      const remainingBudget = Math.max(0, characterMaterialBudget);
      if (ruleEntry) {
        const boundedRule = truncatePromptMessageToTokens(ruleEntry.message, remainingBudget, '\n\n[墨阑提示：人物描写规则已按相关性收紧。]');
        if (boundedRule && promptTokenUpperBound([boundedRule]) <= remainingBudget) {
          ruleEntry.message = boundedRule;
          upstreamMessages[ruleEntry.index] = boundedRule;
        } else {
          removedMaterialIndexes.add(ruleEntry.index);
        }
        rulesReducedByBudget = true;
      }
      materialEntriesTokens = materialEntries
        .filter(item => !removedMaterialIndexes.has(item.index))
        .reduce((sum, item) => sum + promptTokenUpperBound([item.message]), 0);
    }

    let plannedMessages = composeContextWindowMessages(upstreamMessages, dynamicIndex, plannedDynamicMessage, removedMaterialIndexes);

    // Keep the requested output budget whenever the fixed prompt leaves room.
    // After lower-priority character material has been reduced, only the
    // dynamic novel context is eligible for this final reduction.
    if (dynamicIndex >= 0 && originalDynamicMessage) {
      const dynamicBudgetForRequestedOutput = Math.max(0,
        contextWindowTokens - fixedPromptTokens - materialEntriesTokens - CONTEXT_WINDOW_SAFETY_TOKENS - requested);
      if (originalDynamicPromptTokens > dynamicBudgetForRequestedOutput) {
        const boundedDynamic = truncatePromptMessageToTokens(originalDynamicMessage, dynamicBudgetForRequestedOutput);
        plannedDynamicMessage = boundedDynamic;
        plannedMessages = composeContextWindowMessages(upstreamMessages, dynamicIndex, plannedDynamicMessage, removedMaterialIndexes);
        dynamicPromptTruncated = true;
      }
    }

    let promptTokens = promptTokenUpperBound(plannedMessages);
    let availableCompletionTokens = contextWindowTokens - promptTokens - CONTEXT_WINDOW_SAFETY_TOKENS;
    const fixedPromptAvailable = contextWindowTokens - fixedPromptTokens - CONTEXT_WINDOW_SAFETY_TOKENS;
    const fixedPromptExceeded = fixedPromptAvailable < CONTEXT_WINDOW_MIN_COMPLETION_TOKENS;
    const dynamicPromptTokens = plannedDynamicMessage ? promptTokenUpperBound([plannedDynamicMessage]) : 0;
    const baseResult = {
      contextWindowTokens,
      requestedMaxTokens: requested,
      fixedPromptTokens,
      originalDynamicPromptTokens,
      dynamicPromptTokens,
      dynamicPromptBudget: dynamicIndex >= 0 ? Math.max(0, contextWindowTokens - fixedPromptTokens - materialEntriesTokens - CONTEXT_WINDOW_SAFETY_TOKENS - requested) : 0,
      dynamicPromptTruncated,
      characterMaterialTokens: materialEntriesTokens,
      originalCharacterMaterialTokens,
      originalCharacterMaterialSampleTokens,
      characterMaterialBudget,
      characterMaterialSamplesRemovedByBudget: samplesRemovedByBudget,
      characterMaterialRulesReducedByBudget: rulesReducedByBudget,
      fixedPromptExceeded,
      overflowTokens: Math.max(0, CONTEXT_WINDOW_MIN_COMPLETION_TOKENS - fixedPromptAvailable),
      messages: plannedMessages,
      promptTokens
    };
    if (fixedPromptExceeded || availableCompletionTokens < CONTEXT_WINDOW_MIN_COMPLETION_TOKENS) {
      return {
        ...baseResult,
        ok: false,
        code: 'context_window_exceeded',
        availableCompletionTokens: Math.max(0, availableCompletionTokens)
      };
    }
    const maxTokens = Math.min(requested, availableCompletionTokens);
    return {
      ...baseResult,
      ok: true,
      maxTokens,
      cappedByContext: maxTokens < requested,
      availableCompletionTokens
    };
  }

  return { estimateTextTokenUpperBound, promptTokenUpperBound, contextWindowTokensForModel, markDynamicPromptMessage, copyDynamicPromptFlag, copyPromptMessageFlags, injectPromptInjectionGuard, dynamicPromptMessageIndex, stripDynamicPromptMarker, truncatePromptMessageToTokens, composeContextWindowMessages, planContextWindow };
}

module.exports = { createModelContextService };
