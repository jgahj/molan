'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn, execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const DEFAULT_ACP_REL_PATH = path.resolve(__dirname, '../../tools/antigravity-acp/agy_acp_server.exe');
const DEFAULT_SANDBOX_DIR = path.resolve(__dirname, '../data/acp-sandbox');

function parseWindowsProxyServer(srv) {
  const match = String(srv || '').match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i);
  const server = match ? String(match[1]).trim() : '';
  if (!server) return '';
  if (server.includes('=')) {
    const httpsMatch = server.match(/https=([^;]+)/i) || server.match(/http=([^;]+)/i);
    const picked = httpsMatch ? httpsMatch[1].trim() : '';
    return picked ? (/^https?:\/\//i.test(picked) ? picked : `http://${picked}`) : '';
  }
  return /^https?:\/\//i.test(server) ? server : `http://${server}`;
}

async function resolveDefaultAcpProxyAsync(env = process.env) {
  const explicit = String(env.MOLAN_ACP_PROXY || env.HTTPS_PROXY || env.HTTP_PROXY || env.MOLAN_PROXY || '').trim();
  if (explicit) return explicit;
  if (process.platform !== 'win32') return '';
  try {
    const { stdout: out } = await execFileAsync('reg.exe', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      'ProxyEnable'
    ], { encoding: 'utf8', timeout: 1500, windowsHide: true });
    if (!/0x1\b/i.test(out)) return '';
    const { stdout: srv } = await execFileAsync('reg.exe', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      'ProxyServer'
    ], { encoding: 'utf8', timeout: 1500, windowsHide: true });
    return parseWindowsProxyServer(srv);
  } catch (_) {
    return '';
  }
}

function resolveDefaultAcpProxy(env = process.env) {
  const explicit = String(env.MOLAN_ACP_PROXY || env.HTTPS_PROXY || env.HTTP_PROXY || env.MOLAN_PROXY || '').trim();
  if (explicit) return explicit;
  if (process.platform !== 'win32') return '';
  try {
    const out = execFileSync('reg.exe', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      'ProxyEnable'
    ], { encoding: 'utf8', timeout: 1500, windowsHide: true });
    if (!/0x1\b/i.test(out)) return '';
    const srv = execFileSync('reg.exe', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v',
      'ProxyServer'
    ], { encoding: 'utf8', timeout: 1500, windowsHide: true });
    return parseWindowsProxyServer(srv);
  } catch (_) {
    return '';
  }
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(extractTextFromContent).filter(Boolean).join('\n');
  if (!content || typeof content !== 'object') return '';
  if (typeof content.text === 'string') return content.text;
  if (content.content !== undefined) return extractTextFromContent(content.content);
  return '';
}

function compileAcpPromptFromMessages(messages, options = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const systemParts = [];
  const turnParts = [];
  for (const msg of list) {
    if (!msg || typeof msg !== 'object') continue;
    const role = String(msg.role || 'user').toLowerCase();
    const text = extractTextFromContent(msg.content).trim();
    if (!text) continue;
    if (role === 'system') {
      systemParts.push(text);
    } else if (role === 'assistant') {
      turnParts.push(`【助手前序回复】\n${text}`);
    } else {
      turnParts.push(text);
    }
  }
  const systemText = systemParts.join('\n\n');
  const jsonHint = options.jsonMode
    ? '\n- 输出格式硬性要求：只输出一个合法 JSON 对象，严禁输出 Markdown 围栏、工具调用或额外说明。'
    : '\n- 输出格式硬性要求：直接输出最终正文结果，严禁调用任何工具、读取文件、提及代码环境或输出开场白/结语。';
  const framing = '[纯文本创作/评审模式：禁止触发任何文件读写、终端或搜索工具，仅依据下方提供内容直接作答。' + jsonHint + ']';
  const sections = [framing];
  if (systemText) sections.push(`【系统写作与评估指令】\n${systemText}`);
  if (turnParts.length) sections.push(`【当前任务内容】\n${turnParts.join('\n\n')}`);
  return {
    systemText,
    promptText: sections.join('\n\n---\n\n')
  };
}

function collectOptionChoices(option) {
  const rawList = Array.isArray(option && option.options)
    ? option.options
    : (Array.isArray(option && option.values) ? option.values : []);
  const out = [];
  for (const item of rawList) {
    if (typeof item === 'string') {
      out.push({ value: item, label: item });
    } else if (item && typeof item === 'object') {
      if (Array.isArray(item.options)) {
        for (const nested of item.options) {
          const val = nested && (nested.value ?? nested.id ?? nested.name);
          if (val != null) out.push({ value: String(val), label: String(nested.name || nested.label || val) });
        }
      } else {
        const val = item.value ?? item.id ?? item.name;
        if (val != null) out.push({ value: String(val), label: String(item.name || item.label || val) });
      }
    }
  }
  return out;
}

function selectConfigOptionValue(configOptions, requestedModel, requestedEffort) {
  const list = Array.isArray(configOptions) ? configOptions : [];
  const updates = [];
  const cleanEffort = String(requestedEffort || '').trim().toLowerCase();
  const rawModel = String(requestedModel || '').trim();
  const baseModel = rawModel.replace(/-(low|medium|high|xhigh|max|minimal|none)$/i, '');

  const modelOpt = list.find(o => o && (o.category === 'model' || /^model$/i.test(String(o.id || ''))));
  if (modelOpt && rawModel) {
    const choices = collectOptionChoices(modelOpt);
    const candidates = [
      cleanEffort ? `${baseModel}-${cleanEffort}` : '',
      rawModel,
      baseModel,
      `${baseModel}-high`,
      `${baseModel}-medium`
    ].filter(Boolean);
    let matched = null;
    for (const candidate of candidates) {
      matched = choices.find(c => c.value.toLowerCase() === candidate.toLowerCase());
      if (matched) break;
    }
    if (!matched) {
      matched = choices.find(c => c.value.toLowerCase().includes(baseModel.toLowerCase()) || c.label.toLowerCase().includes(baseModel.toLowerCase()));
    }
    if (matched && String(modelOpt.currentValue || '') !== matched.value) {
      updates.push({ configId: String(modelOpt.id), value: matched.value });
    }
  }

  const thoughtOpt = list.find(o => o && (
    o.category === 'thought_level'
    || o.category === 'reasoning_effort'
    || /(thought|thinking|reasoning|effort)/i.test(String(o.id || o.name || ''))
  ));
  if (thoughtOpt && cleanEffort) {
    const choices = collectOptionChoices(thoughtOpt);
    const matched = choices.find(c => c.value.toLowerCase() === cleanEffort)
      || (cleanEffort === 'xhigh' ? choices.find(c => c.value.toLowerCase() === 'high') : null)
      || (cleanEffort === 'max' ? choices.find(c => ['xhigh', 'high'].includes(c.value.toLowerCase())) : null);
    if (matched && String(thoughtOpt.currentValue || '') !== matched.value) {
      updates.push({ configId: String(thoughtOpt.id), value: matched.value });
    }
  }

  return updates;
}

function buildSseChunkPacket(id, model, delta, extra = {}) {
  return 'data: ' + JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: extra.finishReason ?? null }],
    ...(extra.usage ? { usage: extra.usage } : {})
  }) + '\n\n';
}

/**
 * 创建官方 Antigravity ACP（JSON-RPC over stdio）传输适配器，对外兼容 chat-service 的流式接口。
 */
function createAcpTransportService(deps = {}) {
  const spawnFn = deps.spawn || spawn;
  const fsImpl = deps.fs || fs;
  const pathImpl = deps.path || path;
  const estimatePromptTokens = typeof deps.estimatePromptTokens === 'function'
    ? deps.estimatePromptTokens
    : (text => Math.ceil(String(text || '').length * 0.65));
  const sandboxDir = pathImpl.resolve(deps.sandboxDir || DEFAULT_SANDBOX_DIR);
  let cachedProxy = null;
  let cachedProxyPromise = null;

  function resolveBinaryPath(modelConfig) {
    return String(
      (modelConfig && modelConfig.acpCommand)
      || process.env.MOLAN_ACP_BIN
      || deps.acpCommand
      || DEFAULT_ACP_REL_PATH
    ).trim();
  }

  async function resolveEnvAsync(modelConfig) {
    const explicit = String(
      (modelConfig && modelConfig.acpProxy)
      || process.env.MOLAN_ACP_PROXY
      || ''
    ).trim();
    let proxy = explicit;
    if (!proxy) {
      if (cachedProxy !== null) {
        proxy = cachedProxy;
      } else {
        if (!cachedProxyPromise) {
          cachedProxyPromise = resolveDefaultAcpProxyAsync(process.env).then(val => {
            cachedProxy = val || '';
            return cachedProxy;
          });
        }
        proxy = await cachedProxyPromise;
      }
    }
    const env = { ...process.env, ...(deps.acpEnv || {}) };
    if (proxy) {
      if (!env.HTTP_PROXY) env.HTTP_PROXY = proxy;
      if (!env.HTTPS_PROXY) env.HTTPS_PROXY = proxy;
    }
    return env;
  }

  const workers = new Map();

  function getOrCreateWorker(binaryPath, env) {
    const key = `${binaryPath}::${env.HTTPS_PROXY || ''}`;
    const existing = workers.get(key);
    if (existing && !existing.closed) return existing;

    let child = null;
    let initPromise = null;
    let stdoutBuffer = '';
    let nextId = 1;
    const pendingRequests = new Map();
    const sessionListeners = new Map();
    const stderrTail = [];

    const recordStderr = chunk => {
      const lines = String(chunk || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for (const line of lines) {
        stderrTail.push(line);
        if (stderrTail.length > 40) stderrTail.shift();
      }
    };

    const failAllPending = err => {
      for (const [, entry] of pendingRequests) {
        try { entry.reject(err); } catch (_) {}
      }
      pendingRequests.clear();
      for (const [, listener] of sessionListeners) {
        if (typeof listener.onError === 'function') listener.onError(err);
      }
      sessionListeners.clear();
    };

    const worker = {
      closed: false,
      stderrTail,
      ensureInitialized: () => {
        if (initPromise) return initPromise;
        initPromise = (async () => {
          if (!fsImpl.existsSync(binaryPath)) {
            throw Object.assign(
              new Error(`未找到官方 Antigravity ACP 可执行文件：${binaryPath}`),
              { code: 'ACP_BINARY_MISSING', status: 503 }
            );
          }
          fsImpl.mkdirSync(sandboxDir, { recursive: true });
          const args = Array.isArray(deps.acpArgs) ? deps.acpArgs : [];
          child = spawnFn(binaryPath, args, {
            cwd: pathImpl.dirname(binaryPath),
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
          });
          child.stderr.on('data', recordStderr);
          child.stdout.on('data', chunk => {
            stdoutBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
            let idx;
            while ((idx = stdoutBuffer.indexOf('\n')) >= 0) {
              const rawLine = stdoutBuffer.slice(0, idx).trim();
              stdoutBuffer = stdoutBuffer.slice(idx + 1);
              if (!rawLine) continue;
              let msg;
              try { msg = JSON.parse(rawLine); } catch (_) { continue; }
              if (msg.id != null && !msg.method && pendingRequests.has(msg.id)) {
                const pending = pendingRequests.get(msg.id);
                pendingRequests.delete(msg.id);
                if (msg.error) {
                  const err = new Error(String(msg.error.message || 'ACP 请求失败'));
                  err.rpcCode = msg.error.code;
                  err.rpcData = msg.error.data;
                  pending.reject(err);
                } else {
                  pending.resolve(msg.result);
                }
                continue;
              }
              if (msg.method === 'session/update' && msg.params && msg.params.sessionId) {
                const listener = sessionListeners.get(msg.params.sessionId);
                if (listener && typeof listener.onUpdate === 'function') {
                  listener.onUpdate(msg.params);
                }
                continue;
              }
              if (msg.id != null && msg.method === 'session/request_permission') {
                const rejectOpt = Array.isArray(msg.params && msg.params.options)
                  ? msg.params.options.find(o => o && /reject/i.test(String(o.kind || o.optionId || '')))
                  : null;
                const result = rejectOpt
                  ? { outcome: { outcome: 'selected', optionId: rejectOpt.optionId } }
                  : { outcome: { outcome: 'cancelled' } };
                try {
                  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
                } catch (_) {}
              }
            }
          });
          const onExit = (code, signal) => {
            worker.closed = true;
            workers.delete(key);
            initPromise = null;
            failAllPending(Object.assign(
              new Error(`Antigravity ACP 进程已退出 (${code ?? signal ?? 'closed'})`),
              { code: 'ACP_PROCESS_EXITED', status: 502 }
            ));
          };
          child.once('exit', onExit);
          child.once('error', err => {
            worker.closed = true;
            workers.delete(key);
            initPromise = null;
            failAllPending(err);
          });

          return worker.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false
            },
            clientInfo: { name: 'molan-home', version: '1.0.0' }
          });
        })().catch(err => {
          initPromise = null;
          throw err;
        });
        return initPromise;
      },
      request: (method, params) => new Promise((resolve, reject) => {
        if (!child || !child.stdin || worker.closed) {
          reject(new Error('Antigravity ACP 通道未连接'));
          return;
        }
        const id = nextId++;
        pendingRequests.set(id, { resolve, reject });
        try {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        } catch (err) {
          pendingRequests.delete(id);
          reject(err);
        }
      }),
      registerSession: (sessionId, listener) => {
        sessionListeners.set(sessionId, listener);
      },
      unregisterSession: sessionId => {
        sessionListeners.delete(sessionId);
      },
      close: () => {
        worker.closed = true;
        workers.delete(key);
        if (child && !child.killed) {
          try { child.kill(); } catch (_) {}
        }
        failAllPending(new Error('Antigravity ACP 服务已关闭'));
      }
    };

    workers.set(key, worker);
    return worker;
  }

  function mapAcpError(err) {
    const msg = String(err && err.message || 'Antigravity ACP 调用失败');
    if (err && (err.rpcCode === -32000 || /authentication required/i.test(msg))) {
      return {
        status: 503,
        code: 'ACP_AUTH_REQUIRED',
        message: 'Antigravity ACP 尚未完成 Google OAuth 登录，请先运行 molan-home\\acp-login.bat 完成一次浏览器认证。'
      };
    }
    return {
      status: Number(err && err.status) || 502,
      code: String(err && err.code || 'ACP_UPSTREAM_ERROR'),
      message: msg
    };
  }

  /**
   * 兼容 chat-service openUpstream 的流式入口：写入 OpenAI 请求体后通过 ACP 执行并返回模拟 SSE 响应流。
   */
  function openUpstream(reqOptions, cb) {
    const opts = reqOptions || {};
    const pm = opts.modelConfig || {};
    const binaryPath = resolveBinaryPath(pm);

    const upstreamReq = new EventEmitter();
    const chunks = [];
    let destroyed = false;
    let activeSessionId = '';
    let workerRef = null;

    upstreamReq.write = chunk => {
      if (!destroyed && chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
      return true;
    };
    upstreamReq.destroy = () => {
      if (destroyed) return;
      destroyed = true;
      if (workerRef && activeSessionId) {
        workerRef.unregisterSession(activeSessionId);
        workerRef.request('session/cancel', { sessionId: activeSessionId }).catch(() => {});
      }
    };
    upstreamReq.end = () => {
      if (destroyed) return;
      upstreamReq.emit('finish');
      process.nextTick(() => {
        runAcpTurn().catch(err => {
          if (destroyed) return;
          const mapped = mapAcpError(err);
          emitHttpResponse(mapped.status, JSON.stringify({ error: { message: mapped.message, type: mapped.code } }), true);
        });
      });
    };

    function emitHttpResponse(statusCode, singlePayload, endImmediately) {
      const upRes = new EventEmitter();
      upRes.statusCode = statusCode;
      let encoding = 'utf8';
      upRes.setEncoding = enc => { encoding = enc || 'utf8'; };
      upRes.resume = () => {};
      opts.onResponse(upRes);
      if (singlePayload) {
        upRes.emit('data', encoding === 'utf8' ? singlePayload : Buffer.from(singlePayload, 'utf8'));
      }
      if (endImmediately) {
        upRes.emit('end');
      }
      return upRes;
    }

    async function runAcpTurn() {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const bodyObj = JSON.parse(rawBody || '{}');
      const modelId = String(bodyObj.model || pm.model || pm.id || 'gemini-4-hydrogen').trim();
      const reasoningEffort = String(bodyObj.reasoning_effort || opts.reasoningEffort || pm.defaultReasoningEffort || 'high').trim();
      const jsonMode = Boolean(bodyObj.response_format && bodyObj.response_format.type === 'json_object');
      const { systemText, promptText } = compileAcpPromptFromMessages(bodyObj.messages, { jsonMode });

      const env = await resolveEnvAsync(pm);
      if (destroyed) return;
      const worker = getOrCreateWorker(binaryPath, env);
      workerRef = worker;
      await worker.ensureInitialized();
      if (destroyed) return;

      const sessionParams = { cwd: sandboxDir, mcpServers: [] };
      if (systemText) sessionParams._meta = { systemPrompt: { append: systemText } };
      const sessionResult = await worker.request('session/new', sessionParams);
      if (destroyed) return;

      const sessionId = String(sessionResult && sessionResult.sessionId || '').trim();
      if (!sessionId) throw new Error('Antigravity ACP 未返回有效的 sessionId');
      activeSessionId = sessionId;

      const configUpdates = selectConfigOptionValue(sessionResult && sessionResult.configOptions, modelId, reasoningEffort);
      for (const upd of configUpdates) {
        if (destroyed) return;
        await worker.request('session/set_config_option', {
          sessionId,
          configId: upd.configId,
          value: upd.value
        });
      }

      const upRes = emitHttpResponse(200, '', false);
      const streamId = `acp_${sessionId}`;
      let totalContent = '';
      let totalReasoning = '';
      let realUsage = null;

      worker.registerSession(sessionId, {
        onUpdate: params => {
          if (destroyed) return;
          const update = params && params.update ? params.update : {};
          const kind = String(update.sessionUpdate || '');
          if (kind === 'agent_message_chunk') {
            const text = extractTextFromContent(update.content || update.delta || update.text);
            if (text) {
              totalContent += text;
              upRes.emit('data', buildSseChunkPacket(streamId, modelId, { content: text }));
            }
          } else if (kind === 'agent_thought_chunk') {
            const text = extractTextFromContent(update.content || update.delta || update.text);
            if (text) {
              totalReasoning += text;
              upRes.emit('data', buildSseChunkPacket(streamId, modelId, { reasoning_content: text }));
            }
          } else if (kind === 'usage_update' || update.usage) {
            const u = update.usage || update;
            if (u && (u.inputTokens != null || u.prompt_tokens != null || u.used != null)) realUsage = u;
          }
        },
        onError: err => {
          if (!destroyed) upRes.emit('error', err);
        }
      });

      try {
        const promptResult = await worker.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: promptText }]
        });
        if (destroyed) return;
        const resultUsage = (promptResult && promptResult.usage) || realUsage;
        const promptTokens = Number(resultUsage && (resultUsage.inputTokens ?? resultUsage.prompt_tokens))
          || estimatePromptTokens(promptText, modelId);
        const reasoningTokens = Number(resultUsage && (resultUsage.thoughtTokens ?? resultUsage.reasoning_tokens))
          || (totalReasoning ? estimatePromptTokens(totalReasoning, modelId) : 0);
        const completionTokens = Number(resultUsage && (resultUsage.outputTokens ?? resultUsage.completion_tokens))
          || (estimatePromptTokens(totalContent, modelId) + reasoningTokens);
        const usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          ...(reasoningTokens > 0 ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : {})
        };
        upRes.emit('data', buildSseChunkPacket(streamId, modelId, {}, { finishReason: 'stop', usage }));
        upRes.emit('data', 'data: [DONE]\n\n');
        upRes.emit('end');
      } catch (err) {
        if (!destroyed) upRes.emit('error', err);
      } finally {
        worker.unregisterSession(sessionId);
      }
    }

    cb(null, upstreamReq);
    return upstreamReq;
  }

  async function inspectCapabilities(modelConfig) {
    const binaryPath = resolveBinaryPath(modelConfig);
    const env = await resolveEnvAsync(modelConfig);
    const worker = getOrCreateWorker(binaryPath, env);
    const init = await worker.ensureInitialized();
    const session = await worker.request('session/new', { cwd: sandboxDir, mcpServers: [] });
    return { init, session };
  }

  async function authenticateInteractive({ methodId = 'oauth-personal', modelConfig = null, onLog = null } = {}) {
    const binaryPath = resolveBinaryPath(modelConfig);
    const env = await resolveEnvAsync(modelConfig);
    const worker = getOrCreateWorker(binaryPath, env);
    if (typeof onLog === 'function') {
      const seen = new Set();
      const pollTimer = setInterval(() => {
        for (const line of worker.stderrTail) {
          if (!seen.has(line)) {
            seen.add(line);
            onLog(line);
          }
        }
      }, 250);
      if (typeof pollTimer.unref === 'function') pollTimer.unref();
      try {
        await worker.ensureInitialized();
        await worker.request('authenticate', { methodId });
        const session = await worker.request('session/new', { cwd: sandboxDir, mcpServers: [] });
        return { ok: true, session };
      } finally {
        clearInterval(pollTimer);
        for (const line of worker.stderrTail) {
          if (!seen.has(line)) onLog(line);
        }
      }
    }
    await worker.ensureInitialized();
    await worker.request('authenticate', { methodId });
    const session = await worker.request('session/new', { cwd: sandboxDir, mcpServers: [] });
    return { ok: true, session };
  }

  function close() {
    for (const worker of [...workers.values()]) {
      worker.close();
    }
    workers.clear();
  }

  return {
    openUpstream,
    inspectCapabilities,
    authenticateInteractive,
    close,
    _internal: {
      compileAcpPromptFromMessages,
      selectConfigOptionValue,
      resolveDefaultAcpProxy
    }
  };
}

module.exports = {
  createAcpTransportService,
  compileAcpPromptFromMessages,
  selectConfigOptionValue
};
