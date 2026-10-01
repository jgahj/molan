'use strict';

// Transport byte limits are separate from the deterministic model token budget.
function createChatMessageService({ CHAT_MAX_MESSAGES, CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_TOTAL_CHARS, CHAT_TRUNCATION_MARKER, copyPromptMessageFlags, requestError }) {
  const CHAT_MESSAGE_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool']);
  function utf8ByteLength(value) {
    return Buffer.byteLength(String(value == null ? '' : value), 'utf8');
  }

  function truncateUtf8Head(value, maxBytes, marker) {
    const source = String(value == null ? '' : value);
    const originalBytes = utf8ByteLength(source);
    const limit = Math.max(0, Math.floor(Number(maxBytes) || 0));
    if (originalBytes <= limit) return { text: source, truncated: false, originalBytes, bytes: originalBytes };

    const suffix = String(marker == null ? CHAT_TRUNCATION_MARKER : marker);
    const suffixBytes = utf8ByteLength(suffix);
    const headBudget = Math.max(0, limit - suffixBytes);
    const codePoints = Array.from(source);
    let low = 0;
    let high = codePoints.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const head = codePoints.slice(0, middle).join('');
      if (utf8ByteLength(head) <= headBudget) low = middle;
      else high = middle - 1;
    }
    const head = codePoints.slice(0, low).join('');
    const text = head + (suffixBytes <= limit ? suffix : '');
    return { text, truncated: true, originalBytes, bytes: utf8ByteLength(text) };
  }

  function serializedMessageBytes(message) {
    return utf8ByteLength(JSON.stringify(message) || '');
  }

  function truncateStringMessage(message, maxBytes) {
    const content = String(message.content == null ? '' : message.content);
    const codePoints = Array.from(content);
    let low = 0;
    let high = codePoints.length;
    const candidateFor = count => copyPromptMessageFlags(message, {
      ...message,
      content: codePoints.slice(0, count).join('') + CHAT_TRUNCATION_MARKER
    });
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (serializedMessageBytes(candidateFor(middle)) <= maxBytes) low = middle;
      else high = middle - 1;
    }
    const candidate = candidateFor(low);
    if (serializedMessageBytes(candidate) <= maxBytes) return candidate;
    const empty = copyPromptMessageFlags(message, { ...message, content: '' });
    if (serializedMessageBytes(empty) <= maxBytes) return empty;
    throw requestError(413, '消息元数据过大，无法在单条消息限制内发送');
  }

  function truncateArrayMessage(message, maxBytes) {
    const parts = Array.isArray(message.content) ? message.content.map(part => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) return part;
      return { ...part };
    }) : [];
    const textIndexes = parts.map((part, index) => ({ part, index }))
      .filter(item => item.part && typeof item.part.text === 'string');
    if (!textIndexes.length) {
      const kept = parts.slice();
      while (kept.length && serializedMessageBytes({ ...message, content: kept }) > maxBytes) kept.pop();
      const candidate = copyPromptMessageFlags(message, { ...message, content: kept });
      if (serializedMessageBytes(candidate) <= maxBytes) return candidate;
      throw requestError(413, '消息内容过大且无法按文本前部截断');
    }
    const lastText = textIndexes[textIndexes.length - 1];
    const originalText = lastText.part.text;
    const codePoints = Array.from(originalText);
    let low = 0;
    let high = codePoints.length;
    const candidateFor = count => {
      const next = parts.slice(0, lastText.index + 1).map(part => part && typeof part === 'object' && !Array.isArray(part) ? { ...part } : part);
      next[lastText.index] = { ...next[lastText.index], text: codePoints.slice(0, count).join('') + CHAT_TRUNCATION_MARKER };
      return copyPromptMessageFlags(message, { ...message, content: next });
    };
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (serializedMessageBytes(candidateFor(middle)) <= maxBytes) low = middle;
      else high = middle - 1;
    }
    const candidate = candidateFor(low);
    if (serializedMessageBytes(candidate) <= maxBytes) return candidate;
    throw requestError(413, '消息内容过大且无法按文本前部截断');
  }

  function truncateMessageToBytes(message, maxBytes) {
    const limit = Math.max(1000, Math.floor(Number(maxBytes) || CHAT_MAX_MESSAGE_CHARS));
    if (serializedMessageBytes(message) <= limit) return message;
    if (typeof message.content === 'string') return truncateStringMessage(message, limit);
    if (Array.isArray(message.content)) return truncateArrayMessage(message, limit);
    throw requestError(413, '消息内容格式不支持前部截断');
  }

  function fitMessagesToTotal(messages) {
    if (messages.length <= 1) return [truncateMessageToBytes(messages[0], Math.min(CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_TOTAL_CHARS))];
    const last = truncateMessageToBytes(messages[messages.length - 1], Math.min(CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_TOTAL_CHARS));
    const lastBytes = serializedMessageBytes(last);
    const prefixBudget = Math.max(0, CHAT_MAX_TOTAL_CHARS - lastBytes);
    const output = [];
    let remaining = prefixBudget;
    for (let index = 0; index < messages.length - 1 && remaining > 0; index += 1) {
      const candidate = truncateMessageToBytes(messages[index], Math.min(CHAT_MAX_MESSAGE_CHARS, remaining));
      const bytes = serializedMessageBytes(candidate);
      if (bytes > remaining) break;
      output.push(candidate);
      remaining -= bytes;
    }
    output.push(last);
    return output;
  }

  function validateChatMessages(messages) {
    if (!Array.isArray(messages) || !messages.length) throw new Error('messages 不能为空');
    if (messages.length > CHAT_MAX_MESSAGES) throw requestError(413, '消息数量过多，单次最多支持 ' + CHAT_MAX_MESSAGES + ' 条');
    const bounded = [];
    for (const message of messages) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('messages 格式非法');
      const role = String(message.role || '').trim().toLowerCase();
      if (!CHAT_MESSAGE_ROLES.has(role)) throw new Error('消息角色不受支持');
      try { JSON.stringify(message); } catch (_) { throw new Error('消息内容无法序列化'); }
      bounded.push(truncateMessageToBytes(copyPromptMessageFlags(message, { ...message, role }), CHAT_MAX_MESSAGE_CHARS));
    }
    const totalBytes = bounded.reduce((sum, message) => sum + serializedMessageBytes(message), 0);
    return totalBytes > CHAT_MAX_TOTAL_CHARS ? fitMessagesToTotal(bounded) : bounded;
  }
  return { validateChatMessages, serializedMessageBytes, truncateUtf8Head };
}

module.exports = { createChatMessageService };
