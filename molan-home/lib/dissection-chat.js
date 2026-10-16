'use strict';

/**
 * 拆书阶段对话执行器（自 server.js 下沉，行为逐字节保持不变）。
 * 职责：向 /api/chat 发起单阶段拆书请求，含重试修复提示、PostgreSQL cancel 守护、
 *       SSE/JSON 双模解析、Token 用量校验与阶段字段校验。
 * 依赖由调用方（server.js）以工厂注入，避免模块级循环依赖。
 * 原实现：server.js runDissectionChat（导出与 __test 入口经委托桩保持兼容）。
 */
function createDissectionChatRunner(deps) {
  const {
    postgresRepository,
    port,
    postgresMode,
    projectScope,
    wrapSkillBlock,
    checkDissectionActiveInPostgres,
    currentDefaultModel,
    dissectionStreamText,
    safeJsonParse,
    extractJsonFromMixedText,
    autoFixJson,
    toTokenCount,
    normalizeDissectionStageResult,
    salvageDissectionStageResult,
    mergeDissectionResult,
    dissectionStageMissingFields,
    internalModelRouteHeader,
    internalModelRouteKey,
    dynamicPromptMarker
  } = deps || {};

  return async function runDissectionChat(authToken, record, systemPrompt, userPrompt, maxTokens, onUsage, controller, skillAudit, optionalDependencies = {}) {
  const activeRepository = optionalDependencies.postgresRepository || postgresRepository;
  const activeFetch = optionalDependencies.fetch || globalThis.fetch;
  const activePort = optionalDependencies.port || port;
  const activePollIntervalMs = optionalDependencies.pollIntervalMs || 1000;
  const postgresModeActive = optionalDependencies.postgresMode !== undefined ? optionalDependencies.postgresMode : postgresMode;

  const ownerActor = String(record && (record.ownerUserId || record.userId) || (record && record.userEmail ? projectScope.stableUserId(record.userEmail) : '')).trim();
  const auditSkill = skillAudit && Array.isArray(skillAudit.skills) ? skillAudit.skills[0] : null;
  const markedSystemPrompt = auditSkill ? wrapSkillBlock(auditSkill.id, systemPrompt) : systemPrompt;
  const machineContract = '【墨阑拆书接口约束】当前阶段必须返回一个合法 JSON 对象（用 JSON.parse 可直接解析），不能返回 Markdown、代码围栏、解释文字或散文分析。JSON 语法硬性要求：1) 每个字符串值都必须用英文双引号包裹并正确闭合，字符串值内部禁止再出现英文双引号（需要引用书名/台词时改用单引号或书名号《》，避免 JSON 解析提前闭合）；2) 键和值之间用英文冒号分隔；3) 数组/对象元素之间用英文逗号分隔；4) 不要省略任何括号或引号；5) 所有 value 保持简短（每项不超过 60 字），未知信息用 "unknown" 或 "candidate"；6) 严格按上方输出模板的字段结构与类型输出，不要新增顶层字段，不要改字段名。';
  let lastOutput = '';
  let lastError = '';
  const waitForRetry = delayMilliseconds => new Promise((resolve, reject) => {
    if (controller.signal.aborted) return reject(Object.assign(new Error('拆书任务已取消'), { name: 'AbortError' }));
    const retryTimer = setTimeout(resolve, delayMilliseconds);
    controller.signal.addEventListener('abort', () => {
      clearTimeout(retryTimer);
      reject(Object.assign(new Error('拆书任务已取消'), { name: 'AbortError' }));
    }, { once: true });
  });
  for (let attempt = 0; attempt <= 5; attempt += 1) {
    if (postgresModeActive && ownerActor && record.id) {
      const preflightCheck = await checkDissectionActiveInPostgres(activeRepository, ownerActor, record.id);
      if (!preflightCheck.ok) {
        controller.abort();
        const cancelError = new Error(preflightCheck.message);
        cancelError.cancelled = true;
        cancelError.name = 'AbortError';
        throw cancelError;
      }
    }
    const repairHint = attempt > 0
      ? (String(lastError).startsWith('当前阶段缺少必需产出')
        ? '\n\n【阶段字段校验重试】上一轮返回的是可解析 JSON，但缺少当前阶段的必需字段：' + lastError.replace(/^当前阶段缺少必需产出：/, '').replace(/。请严格按阶段模板补齐真实分析.*$/, '') + '。本轮必须完整返回当前阶段模板要求的顶层字段；不要返回 timeline、outline 或其他阶段字段代替它们。'
        : '\n\n【输出校验失败】你上一轮返回的内容不是合法 JSON（' + (lastError || '解析失败') + '）。最常见错误是：键名与值之间漏写英文冒号（如把 "goal": "目标" 写成 "goal目标"），或字符串未闭合。请重新输出一个干净、合法、完整的 JSON 对象：键和值之间必须有英文冒号 : 和空格，字符串必须成对闭合，不要散文、不要 Markdown 围栏。严格按当前阶段输出模板的字段名与结构，不要修改字段名。')
      : '';
    const previousOutputHint = attempt > 0 && lastOutput
      ? '\n\n【上一轮原始响应，仅用于修复格式】\n' + String(lastOutput).slice(0, 12000) + '\n【原始响应结束】\n请根据当前阶段模板修复这份响应并重新输出完整 JSON，不要解释修复过程。'
      : '';
    let response;
    let raw = '';
    let pollTimer = null;
    let pollError = null;
    let pollStopped = false;
    let inFlightPollPromise = null;

    const schedulePoll = () => {
      if (pollStopped || controller.signal.aborted) {
        return;
      }
      pollTimer = setTimeout(() => {
        pollTimer = null;
        if (pollStopped || controller.signal.aborted) {
          return;
        }
        const currentPoll = (async () => {
          try {
            const pollCheck = await checkDissectionActiveInPostgres(activeRepository, ownerActor, record.id);
            if (pollStopped) return;
            if (!pollCheck.ok) {
              const cancelError = new Error(pollCheck.message);
              cancelError.cancelled = true;
              cancelError.name = 'AbortError';
              pollError = cancelError;
              controller.abort();
              return;
            }
          } catch (checkError) {
            if (pollStopped) return;
            pollError = checkError;
            controller.abort();
            return;
          }
          if (!pollStopped && !controller.signal.aborted) {
            schedulePoll();
          }
        })();
        inFlightPollPromise = currentPoll;
        currentPoll.finally(() => {
          if (inFlightPollPromise === currentPoll) {
            inFlightPollPromise = null;
          }
        });
      }, activePollIntervalMs);
    };

    const stopPoll = async () => {
      pollStopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (inFlightPollPromise) {
        await inFlightPollPromise.catch(() => {});
      }
    };

    if (postgresModeActive && ownerActor && record.id) {
      schedulePoll();
    }
    try {
      console.log(`[拆书诊断] 阶段=${record.phase} attempt=${attempt} 正在发起 /api/chat 请求 (model=${(record && record.selectedModel) || 'gpt-5.6-luna'})...`);
      const fetchSignal = typeof AbortSignal.any === 'function'
        ? AbortSignal.any([controller.signal, AbortSignal.timeout(120000)])
        : controller.signal;
      response = await activeFetch('http://127.0.0.1:' + activePort + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken, [internalModelRouteHeader]: internalModelRouteKey },
        body: JSON.stringify({
          model: (record && record.selectedModel) || currentDefaultModel() || 'gpt-5.6-luna',
          internalModelId: (record && record.selectedModel) || currentDefaultModel() || 'gpt-5.6-luna',
          stage: 'skill_analysis',
          thinking: false,
          reasoningEffort: 'none',
          temperature: 0.2,
          max_tokens: maxTokens,
          skillAudit,
          jsonMode: true,
          messages: [
            { role: 'system', content: markedSystemPrompt + '\n\n' + machineContract + repairHint + previousOutputHint },
            { role: 'user', content: dynamicPromptMarker + '\n' + userPrompt },
            { role: 'user', content: '请执行当前阶段并只返回 JSON。' }
          ]
        }),
        signal: fetchSignal
      });
      raw = await response.text();
    } catch (networkOrAbortError) {
      if (pollError) {
        throw pollError;
      }
      if (networkOrAbortError && networkOrAbortError.name === 'AbortError' && controller.signal.aborted) throw networkOrAbortError;
      lastError = '上游网络错误：' + String(networkOrAbortError && networkOrAbortError.message || networkOrAbortError || '请求失败');
      console.warn(`[拆书诊断] 阶段=${record.phase} attempt=${attempt} 网络异常: ${lastError}`);
      if (attempt < 5) {
        await waitForRetry(Math.min(4000, 600 * Math.pow(2, attempt)));
        continue;
      }
      throw new Error('拆书阶段调用失败：' + lastError);
    } finally {
      await stopPoll();
    }
    if (pollError) {
      throw pollError;
    }
    console.log(`[拆书诊断] 阶段=${record.phase} attempt=${attempt} 收到响应 status=${response.status}, 长度=${raw.length} 字节`);
    if (!response.ok) {
      const message = raw.slice(0, 500);
      const retryable = response.status === 429 || response.status >= 500;
      lastError = '上游 HTTP ' + response.status + '：' + message;
      console.warn(`[拆书诊断] 阶段=${record.phase} attempt=${attempt} HTTP异常: ${lastError}`);
      if (retryable && attempt < 5) {
        await waitForRetry(Math.min(4000, 600 * Math.pow(2, attempt)));
        continue;
      }
      throw new Error('拆书阶段调用失败：' + lastError);
    }
    let output = '', reasoningOutput = '', usage = null;
    const consumePacket = item => {
      if (!item || typeof item !== 'object') return;
      if (item.molan_usage) usage = item.molan_usage;
      if (item.molan_error) {
        const detail = item.molan_error;
        const upstreamError = new Error(String((detail && (detail.error || detail.message)) || '上游返回错误').slice(0, 300));
        upstreamError.code = (detail && detail.code) || 'upstream_error';
        if (detail && detail.status != null) upstreamError.status = Number(detail.status) || 502;
        throw upstreamError;
      }
      const choice = item.choices && item.choices[0];
      const delta = choice && choice.delta;
      const finalCandidates = [
        delta && (delta.content || delta.text || delta.output_text),
        choice && choice.message && choice.message.content,
        choice && choice.text,
        item.output_text || item.outputText,
        item.answer,
        item.content,
        item.result,
        item.text
      ];
      const finalText = finalCandidates.map(dissectionStreamText).find(value => value);
      if (finalText) {
        output += finalText;
        return;
      }
      const reasoningCandidates = [
        delta && (delta.reasoning_content || delta.reasoning || delta.thinking),
        choice && choice.message && (choice.message.reasoning_content || choice.message.reasoning || choice.message.thinking),
        item.reasoning_content || item.reasoning || item.thinking
      ];
      const reasoningText = reasoningCandidates.map(dissectionStreamText).find(value => value);
      if (reasoningText) reasoningOutput += reasoningText;
    };
    if (raw.includes('data:')) {
      raw.split(/\r?\n/).forEach(line => {
        const normalizedLine = line.trim();
        if (!normalizedLine.startsWith('data:')) return;
        const value = normalizedLine.slice(5).trim();
        if (!value || value === '[DONE]') return;
        try { consumePacket(JSON.parse(value)); } catch (_) {}
      });
    } else {
      const envelope = safeJsonParse(raw);
      if (envelope) consumePacket(envelope);
      if (!output && envelope && envelope.result) output = dissectionStreamText(envelope.result);
      if (!output) {
        raw.split(/\r?\n/).forEach(line => {
          const packet = safeJsonParse(line.trim());
          if (packet) consumePacket(packet);
        });
      }
      if (!output && raw.trim()) output = raw;
    }
    if (!output && reasoningOutput) output = reasoningOutput;
    if (!output) output = reasoningOutput;
    if (!usage || toTokenCount(usage.totalTokens) === null) {
      const error = new Error('上游模型未返回精确 Token 用量，已停止拆书以避免结果和计费不一致');
      error.code = 'USAGE_UNAVAILABLE';
      throw error;
    }
    if (onUsage) await onUsage(usage);
    lastOutput = output;
    // 优先尝试完整 JSON 解析；散文输出时兜底提取，语法轻损时自动修复
    const parsedRaw = safeJsonParse(output) || extractJsonFromMixedText(output) || autoFixJson(output);
    const parsed = normalizeDissectionStageResult(parsedRaw);
    const salvaged = normalizeDissectionStageResult(salvageDissectionStageResult(output, record.phase));
    const candidate = parsed || salvaged ? mergeDissectionResult(parsed || {}, salvaged || {}) : null;
    if (candidate) {
      const missingFields = dissectionStageMissingFields(record.phase, candidate);
      if (missingFields.length) {
        lastError = '当前阶段缺少必需产出：' + missingFields.join('、') + '。请严格按阶段模板补齐真实分析，不要只返回空数组或空对象';
        console.warn(`[拆书诊断] 阶段=${record.phase} attempt=${attempt} 字段校验未通过，缺失: ${missingFields.join('、')}`);
        if (attempt < 5) continue;
        throw new Error('模型未返回完整的拆书阶段结果（' + lastError + '），请点击重试');
      }
      console.log(`[拆书诊断] 阶段=${record.phase} attempt=${attempt} 阶段分析成功通过！字段:`, Object.keys(candidate).join(', '));
      return candidate;
    }
    lastError = '输出中未找到可解析的 JSON（已收到 ' + output.length + ' 字符）';
    if (attempt < 5) continue;
    // 重试耗尽：保留最后一次原始输出供诊断
    const fallback = autoFixJson(output) || extractJsonFromMixedText(output);
    const fallbackParsed = fallback ? normalizeDissectionStageResult(fallback) : null;
    if (fallbackParsed && !dissectionStageMissingFields(record.phase, fallbackParsed).length) return fallbackParsed;
    console.warn('[拆书诊断] 阶段', record.phase, '第', attempt + 1, '次尝试仍失败:', lastError);
    console.warn('[拆书诊断] 原始输出前 600 字符:', String(output).slice(0, 600).replace(/\n/g, '\\n'));
    throw new Error('模型未返回有效的拆书结果（' + lastError + '），请点击重试');
  }
  throw new Error('模型未返回有效的拆书结果');
  }
}

module.exports = { createDissectionChatRunner };
