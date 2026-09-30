'use strict';

/**
 * stream-parser.js
 * ---------------------------------------------------------------------------
 * 生产级流式 SSE 解析器 (Production SSE Stream Parser)
 *
 * 遵循架构规范 (第二十八条)：
 * 1. 严格区分控制帧 (心跳、计费事件) 与正文数据帧 (content delta)；
 * 2. 严格区分 FRAME_VALID / FRAME_DROPPED_CONTROL / FRAME_MALFORMED_CONTROL / FRAME_MALFORMED_CONTENT；
 * 3. 严格判定 STREAM_COMPLETE / STREAM_INTERRUPTED / STREAM_UNKNOWN；
 * 4. 杜绝仅靠 content.length > 50 粗暴判定成功，保障正文不静默截断。
 * ---------------------------------------------------------------------------
 */

const FRAME_TYPES = Object.freeze({
  FRAME_VALID: 'FRAME_VALID',
  FRAME_DROPPED_CONTROL: 'FRAME_DROPPED_CONTROL',
  FRAME_MALFORMED_CONTROL: 'FRAME_MALFORMED_CONTROL',
  FRAME_MALFORMED_CONTENT: 'FRAME_MALFORMED_CONTENT'
});

const STREAM_STATUS = Object.freeze({
  STREAM_COMPLETE: 'STREAM_COMPLETE',
  STREAM_INTERRUPTED: 'STREAM_INTERRUPTED',
  STREAM_UNKNOWN: 'STREAM_UNKNOWN'
});

/**
 * 解析并解耦模型 SSE 响应流
 * @param {string} rawStream 原始流字符串
 * @param {Object} [options] 配置选项
 * @returns {Object} 解析结果
 */
function parseDecoupledStream(rawStream = '', options = {}) {
  const minValidChars = Math.max(1, Number(options.minValidChars) || 20);
  let removedBillingEvents = 0;
  let removedHeartbeats = 0;
  let content = '';
  let usage = null;
  let finishReason = null;
  let hasDoneSignal = false;
  const streamErrors = [];
  const frameStats = {
    validFrames: 0,
    droppedControlFrames: 0,
    malformedControlFrames: 0,
    malformedContentFrames: 0
  };

  if (typeof rawStream !== 'string' || !rawStream.trim()) {
    return {
      ok: false,
      status: STREAM_STATUS.STREAM_INTERRUPTED,
      content: '',
      usage: null,
      finishReason: null,
      streamErrors: ['原始流为空或非字符串'],
      removedBillingEvents: 0,
      removedHeartbeats: 0,
      frameStats
    };
  }

  const events = rawStream.split(/\r?\n\r?\n/);
  for (const event of events) {
    const trimmedEvent = event.trim();
    if (!trimmedEvent) continue;

    // 1. 识别并剥离心跳包
    if (/^:\s*(?:ping|keep-alive)/i.test(trimmedEvent)) {
      removedHeartbeats += 1;
      frameStats.droppedControlFrames += 1;
      continue;
    }

    // 2. 识别并隔离计费控制帧
    if (/molan_billing/i.test(trimmedEvent)) {
      removedBillingEvents += 1;
      frameStats.droppedControlFrames += 1;
      continue;
    }

    // 3. 处理正规 SSE data 帧
    const lines = trimmedEvent.split(/\r?\n/).filter(l => l.startsWith('data:'));
    if (lines.length === 0) {
      // 既非心跳也非 data: 格式的异常控制行
      if (/^event:|^id:/i.test(trimmedEvent)) {
        frameStats.droppedControlFrames += 1;
      } else {
        frameStats.malformedControlFrames += 1;
        streamErrors.push(`未知控制帧格式: ${trimmedEvent.slice(0, 80)}`);
      }
      continue;
    }

    for (const line of lines) {
      const payload = line.slice(5).trim();
      if (!payload) continue;

      if (payload === '[DONE]') {
        hasDoneSignal = true;
        frameStats.validFrames += 1;
        continue;
      }

      try {
        const packet = JSON.parse(payload);
        frameStats.validFrames += 1;

        if (packet.error || packet.molan_error) {
          const errMsg = packet.error?.message || packet.molan_error?.message || '上游流式返回错误';
          streamErrors.push(errMsg);
        }
        if (packet.molan_usage) {
          usage = packet.molan_usage;
        } else if (packet.usage) {
          usage = packet.usage;
        }

        const choice = packet.choices?.[0];
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }

        const delta = choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? '';
        content += delta;
      } catch (err) {
        // 判断是否是内容帧解析崩溃
        if (payload.includes('"content"') || payload.includes('"delta"')) {
          frameStats.malformedContentFrames += 1;
          streamErrors.push(`正文数据帧损坏被阻断: ${err.message}`);
        } else {
          frameStats.malformedControlFrames += 1;
          streamErrors.push(`控制数据帧格式错误: ${err.message}`);
        }
      }
    }
  }

  // 严格状态判定
  let status = STREAM_STATUS.STREAM_COMPLETE;
  const isContentValid = content.trim().length >= minValidChars;
  const hasSevereContentErrors = frameStats.malformedContentFrames > 0;
  const hasStopReason = finishReason === 'stop' || hasDoneSignal;

  if (hasSevereContentErrors || (!hasStopReason && !isContentValid)) {
    status = STREAM_STATUS.STREAM_INTERRUPTED;
  } else if (!hasStopReason && isContentValid) {
    // 有部分内容但未收到正常结束标识
    status = finishReason === 'length' ? STREAM_STATUS.STREAM_INTERRUPTED : STREAM_STATUS.STREAM_UNKNOWN;
  }

  const ok = status === STREAM_STATUS.STREAM_COMPLETE && isContentValid && streamErrors.length === 0;

  return {
    ok,
    status,
    content,
    usage,
    finishReason,
    streamErrors,
    removedBillingEvents,
    removedHeartbeats,
    frameStats
  };
}

module.exports = {
  FRAME_TYPES,
  STREAM_STATUS,
  parseDecoupledStream
};
