'use strict';

function createModelCallService({ DYNAMIC_PROMPT_MARKER, INTERNAL_MODEL_ROUTE_HEADER, INTERNAL_MODEL_ROUTE_KEY, PORT, POSTGRES_MODE, dissectionSkillRecord, extractJsonFromMixedText, findPlatformModel, http, loadBuiltinSkills, loadGlobalSkills, loadUserSkills, nativeSkillCatalog, recordModelUsage, requestError, resolveModelForUser, safeJsonParse, skillPromptFiles, skillPromptInstruction, wrapSkillBlock, parseChatStream }) {
  function dissectionStreamText(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(item => dissectionStreamText(item)).join('');
    if (!value || typeof value !== 'object') return '';
    for (const key of ['text', 'content', 'output_text', 'outputText', 'reasoning_content', 'reasoningContent', 'thinking', 'answer', 'value']) {
      if (value[key] !== undefined) {
        const text = dissectionStreamText(value[key]);
        if (text) return text;
      }
    }
    return '';
  }

  async function callMolanChat(authToken, user, opts) {
    const o = opts || {};
    o._startAt = Date.now(); // Q2 · 供 model_usage 记录耗时
    const internalModelId = o.internalModel === true && findPlatformModel(o.modelId)
      ? String(o.modelId).trim()
      : '';
    const model = internalModelId || resolveModelForUser(user, o.modelId);
    let systemPrompt = o.system || '';
    const skillAudit = o.skillAudit && Array.isArray(o.skillAudit.skills) && o.skillAudit.skills.length ? o.skillAudit : null;
    const nativeCatalog = !POSTGRES_MODE && process.env.MOLAN_APP_STORE === 'json' ? await nativeSkillCatalog(user) : null;
    if (skillAudit) {
      // skill 注入通道：按 opts.skillId 解析，不再写死拆书 skill（缺省或显式 'dissection' 走拆书 skill 以兼容既有调用）
      const requestedSkillId = String(o.skillId || '').trim();
      const skill = (!requestedSkillId || requestedSkillId === 'dissection') ? dissectionSkillRecord()
        : (nativeCatalog ? nativeCatalog.userSkills : user && user.email ? loadUserSkills(String(user.email).toLowerCase()) : []).find(item => item && item.id === requestedSkillId)
          || (nativeCatalog ? nativeCatalog.globalSkills : loadGlobalSkills()).find(item => item && item.id === requestedSkillId)
          || loadBuiltinSkills().find(item => item && item.id === requestedSkillId);
      if (!skill) throw new Error('Skill 未完整加载：' + (o.skillId || 'dissection'));
      const declaredSkill = skillAudit && Array.isArray(skillAudit.skills) && (skillAudit.skills.find(s => s && s.id === skill.id) || skillAudit.skills[0]);
      const promptFiles = declaredSkill && Array.isArray(declaredSkill.promptFiles) && declaredSkill.promptFiles.length
        ? declaredSkill.promptFiles
        : skillPromptFiles(skill);
      const instruction = skillPromptInstruction(skill, promptFiles);
      if (!instruction) throw new Error('Skill 未完整加载：' + (o.skillId || 'dissection'));
      systemPrompt = wrapSkillBlock(skill.id, instruction) + '\n\n' + systemPrompt;
    }
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: DYNAMIC_PROMPT_MARKER + '\n' + (o.userPrompt || '') },
      { role: 'user', content: o.jsonMode ? '请只返回一个合法 JSON 对象，不要任何解释或 Markdown 围栏。' : '请直接输出内容，不要解释。' }
    ];
    const body = {
      model, stage: o.stage || 'skill_analysis',
      temperature: o.temperature == null ? 0.3 : o.temperature, max_tokens: o.maxTokens || 2000, messages
    };
    if (o.requestId) body.requestId = String(o.requestId);
    if (o.thinking != null) body.thinking = o.thinking === true;
    if (o.reasoningEffort != null && o.reasoningEffort !== '') body.reasoningEffort = o.reasoningEffort;
    if (o.projectId) body.projectId = String(o.projectId);
    if (o.workspaceId) body.workspaceId = String(o.workspaceId);
    if (o.jsonMode) body.jsonMode = true;
    if (o.requireComplete === true) body.benchmarkProtocol = 'benchmark-local-v2';
    if (skillAudit) body.skillAudit = skillAudit;
    if (internalModelId) body.internalModelId = internalModelId;
    // ★ P0-2 · 组合中止信号：外部 controller（任务取消）与内部超时共同触发 abort。
    // 超时用普通 Error 中止（而非 AbortError），确保上层把超时判为“失败”而不是“用户取消”。
    // ★ 拆书/创书等内部模型调用默认不设总时长超时（长生成是常态，中止由 controller 传入）；
    //   只有调用方显式传正数 timeoutMs（短工具调用：题材分类、素材样本评审等）才计时兜底。
    const externalController = o.controller || null;
    const timeoutController = new AbortController();
    const timeoutMs = Number.isFinite(Number(o.timeoutMs)) && Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : 0;
    const timeoutError = new Error('内部模型调用超时（' + Math.round(timeoutMs / 1000) + 's），请重试');
    const timer = timeoutMs > 0 ? setTimeout(() => timeoutController.abort(timeoutError), timeoutMs) : null;
    const onExternalAbort = () => timeoutController.abort(externalController && externalController.signal && externalController.signal.reason);
    if (externalController && externalController.signal) {
      if (externalController.signal.aborted) timeoutController.abort(externalController.signal.reason);
      else externalController.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    let raw = '';
    let providerRequestStarted = false;
    try {
      const headers = { 'Content-Type': 'application/json', Authorization: authToken, Accept: 'text/event-stream' };
      if (o.requestId) headers['Idempotency-Key'] = String(o.requestId);
      if (internalModelId || o.requireComplete === true) headers[INTERNAL_MODEL_ROUTE_HEADER] = INTERNAL_MODEL_ROUTE_KEY;
      const bodyString = JSON.stringify(body);
      headers['Content-Length'] = String(Buffer.byteLength(bodyString));
      // ★ 用 node:http 裸连接替代进程内 fetch：与外部客户端完全同构，排除 undici 在
      //   长请求上的隐藏行为差异（实测同参外部调用成功而进程内 fetch 返回空内容）。
      if (timeoutController.signal.aborted) {
        throw timeoutController.signal.reason || new Error('内部模型调用已取消');
      }
      providerRequestStarted = true;
      if (typeof o.onProviderStart === 'function') o.onProviderStart();
      raw = await new Promise((resolve, reject) => {
        const upstreamRequest = http.request({
          hostname: '127.0.0.1', port: PORT, path: '/api/chat', method: 'POST', headers, timeout: 0
        }, upstreamResponse => {
          upstreamResponse.setEncoding('utf8');
          if (upstreamResponse.statusCode !== 200) {
            let errBody = '';
            upstreamResponse.on('data', c => { errBody += c; if (errBody.length > 4000) upstreamResponse.destroy(); });
            upstreamResponse.on('end', () => {
              const parsed = safeJsonParse(errBody);
              const detail = parsed && parsed.error;
              const message = String((detail && (detail.message || detail.type)) || detail || errBody || '').trim().slice(0, 300);
              const err = requestError(Math.min(599, Math.max(400, upstreamResponse.statusCode || 502)), '内部模型调用失败：' + (message || 'HTTP ' + upstreamResponse.statusCode));
              if (parsed && parsed.code) {
                err.code = String(parsed.code);
                if (parsed.unknown === true || err.code === 'PROVIDER_UNKNOWN') err.unknown = true;
              }
              err.definitiveResponse = upstreamResponse.statusCode >= 400 && upstreamResponse.statusCode < 500 && err.unknown !== true;
              if (upstreamResponse.statusCode === 402 && /余额不足/i.test(message)) err.code = 'upstream_balance_exhausted';
              reject(err);
            });
            upstreamResponse.on('error', reject);
            return;
          }
          let data = '';
          upstreamResponse.on('data', chunk => { data += chunk; });
          upstreamResponse.on('end', () => resolve(data));
          upstreamResponse.on('error', reject);
        });
        upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('内部连接超时')));
        upstreamRequest.on('error', reject);
        const abortOnce = () => upstreamRequest.destroy((timeoutController.signal && timeoutController.signal.reason) || new Error('aborted'));
        if (timeoutController.signal.aborted) { abortOnce(); return; }
        timeoutController.signal.addEventListener('abort', abortOnce, { once: true });
        upstreamRequest.end(bodyString);
      });
    } catch (error) {
      const errorCode = String(error && error.code || '');
      const definitelyNotConnected = ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(errorCode);
      if (providerRequestStarted && error.definitiveResponse !== true &&
          (timeoutController.signal.aborted || (errorCode && !definitelyNotConnected))) {
        error.code = 'PROVIDER_UNKNOWN';
        error.unknown = true;
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (externalController && externalController.signal) externalController.signal.removeEventListener('abort', onExternalAbort);
      if (providerRequestStarted && typeof o.onProviderComplete === 'function') o.onProviderComplete();
    }
     console.error('[callMolanChat] 响应诊断 model=' + (body.model || '') + ' rawLen=' + raw.length);
    if (!raw.trim()) throw requestError(502, '内部模型调用返回空响应，请重试');
    let usage = null, output = '';
    if (o.requireComplete === true) {
      const parsedStream = parseChatStream(raw);
      usage = parsedStream.usage;
      output = parsedStream.text;
    } else if (raw.includes('data:')) {
      raw.split(/\r?\n/).forEach(line => {
        const v = line.trim();
        if (!v.startsWith('data:')) return;
        const val = v.slice(5).trim();
        if (!val || val === '[DONE]') return;
        try {
          const pkt = JSON.parse(val);
          if (pkt.molan_usage) usage = pkt.molan_usage;
          const c = pkt.choices && pkt.choices[0];
          const t = dissectionStreamText((c && (c.delta || c.message)) || pkt);
          if (t) output += t;
        } catch (_) {}
      });
    } else {
      const env = safeJsonParse(raw);
      if (env) {
        if (env.molan_usage) usage = env.molan_usage;
        const c = env.choices && env.choices[0];
        const t = dissectionStreamText((c && (c.delta || c.message)) || env);
        if (t) output += t;
      }
      // 上游未按预期返回时明确失败，不把原始错误文本当模型输出传给调用方
      if (!output) throw new Error('上游返回无法解析：' + String(raw).slice(0, 200));
    }
    let json = null;
    if (o.jsonMode) json = safeJsonParse(output) || extractJsonFromMixedText(output);
    // ★ Q2 · 模型用量账本：统一在此写入（requestId 幂等），调用方可通过 o.recordId/o.unitId/o.workflowId 补齐维度
    if (usage && usage.requestId) {
      recordModelUsage({
        requestId: usage.requestId,
        userId: user && user.userId || '',
        workspaceId: o.workspaceId || '',
        projectId: o.projectId || '',
        recordId: o.recordId || o.taskId || '',
        workflowId: o.workflowId || '',
        stage: o.stage || 'chat',
        unitId: o.unitId || '',
        model: model,
        promptVersion: o.promptVersion || '',
        usage,
        latencyMs: o._startAt ? Date.now() - o._startAt : 0,
        status: usage.status || 'completed'
      });
    }
    return { text: output, json, usage };
  }

  return { dissectionStreamText, callMolanChat };
}

module.exports = { createModelCallService };
