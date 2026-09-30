'use strict';

function createChatStreamRuntime({ maxResponseBytes, maxBufferBytes, onLimit, onChunk, onLine }) {
  let responseBytes = 0;
  let buffer = '';
  let stopped = false;
  function push(chunk, passthrough) {
    if (stopped) return;
    responseBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    if (responseBytes > maxResponseBytes) {
      stopped = true;
      onLimit('upstream_response_too_large', '上游模型响应超过服务端安全上限');
      return;
    }
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer) > maxBufferBytes) {
      stopped = true;
      onLimit('upstream_sse_buffer_overflow', '上游模型流未按 SSE 分帧，缓冲超过服务端安全上限');
      return;
    }
    if (passthrough && onChunk(chunk) === false) return;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      onLine(line);
    }
  }
  function finish() {
    if (stopped) return;
    const tail = buffer.trim();
    if (tail) onLine(tail, true);
  }
  return { push, finish };
}
module.exports = { createChatStreamRuntime };
