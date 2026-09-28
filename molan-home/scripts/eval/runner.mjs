// 评测 runner（方案 13.2.1）：读取 fixtures -> 调用可插拔 pipeline -> 计算指标 -> 输出报告 -> 与 baselines 比较。
// 用法：node scripts/eval/runner.mjs [--only=task1,task2] [--out=report.json]
// 说明：`evaluate(sample)` 是需要接入真实 pipeline/prompt/model 的插槽；未接入前默认用 sample.actual（若有）或标记 not_run。
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeMetrics } from './metrics.mjs';
import aiFlavorDetector from '../../lib/ai-flavor-detector.js';
import styleFingerprint from '../../lib/style-fingerprint.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(ROOT, 'fixtures');
const BASELINE_FILE = join(ROOT, 'baselines.json');
const LIVE_PROMPT_VERSION = 'molan-eval-live-v1';
const CONTRACT_FIELDS = ['goal', 'protagonistAction', 'opposition', 'informationChange', 'irreversibleResult'];

// —— 可插拔评估插槽：接入真实 pipeline/prompt/model 后替换此实现 ——
// 当前骨架：优先用样本自带的 actual 结果；没有则标记 not_run（不计入通过指标）。
/** 评估单条 fixture 样本，fixture 模式沿用样本自带的实际结果。 */
function evaluate(sample) {
  if (sample && sample.actual && typeof sample.actual === 'object') {
    return { ...sample.actual, from: 'fixture' };
  }
  return { from: 'not_run', passed: false, notRun: true };
}

/** 读取命令行参数的值，兼容 --name=value 与 --name value 两种写法。 */
function readArgValue(args, name) {
  const equals = args.find(value => value.startsWith(name + '='));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
  return '';
}

/** 读取 fixtures 目录中的 JSONL 样本，并忽略空行与非法行。 */
function loadFixtures() {
  if (!existsSync(FIXTURE_DIR)) return [];
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.jsonl'));
  const samples = [];
  for (const file of files) {
    for (const line of readFileSync(join(FIXTURE_DIR, file), 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try { samples.push({ file, ...JSON.parse(t) }); } catch (_) { /* 跳过坏行 */ }
    }
  }
  return samples;
}

/** 解析 runner 命令行参数，生成 fixture 或真实模型评测的标准选项。 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const has = (name) => args.includes(name);
  const port = process.env.MOLAN_PORT || '3000';
  return {
    live: has('--live'),
    baseUrl: readArgValue(args, '--base-url') || ('http://127.0.0.1:' + port),
    email: readArgValue(args, '--email') || process.env.MOLAN_EVAL_EMAIL || '',
    password: readArgValue(args, '--password') || process.env.MOLAN_EVAL_PASSWORD || '',
    only: readArgValue(args, '--only'),
    out: readArgValue(args, '--out') || join(ROOT, 'report.json')
  };
}

// 登录评测测试账号：POST /api/auth/login（server.js handleLogin），成功返回鉴权 token。
async function liveLogin(baseUrl, email, password) {
  const res = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.token) {
    throw new Error('评测登录失败（HTTP ' + res.status + '）：' + JSON.stringify(data).slice(0, 200));
  }
  return String(data.token);
}

/** 为不同评测任务生成机器可判分的输出要求，避免 live 结果只有不可计算的散文。 */
function liveTaskInstruction(task) {
  if (task === 'contract') return '请从输入大纲生成章节合同，只返回 JSON 对象，字段必须包含 goal、protagonistAction、opposition、informationChange、irreversibleResult；每个字段都写具体人物、行动、对象和后果，不要解释。';
  if (task === 'originality') return '请判断输入段落是否存在明显原文复刻风险，只返回 JSON 对象 {"blocked":true或false,"reason":"简短理由"}，不要改写段落。';
  if (task === 'entity_state') return '请比较输入中的前后章节，抽取目标人物的状态变化，只返回 JSON 对象 {"entity":"人物名","stateChange":"前后状态变化"}，不要解释。';
  if (task === 'claim' || task === 'evidence') return '请从输入文本抽取可核对事实，只返回 JSON 对象 {"claims":[{"text":"事实","hasEvidence":true或false,"important":true或false}]}，只写文本明确支持或明确缺失的事实，不要解释。';
  if (task === 'unit') return '请判断输入对应的计划单元是否完成，只返回 JSON 对象 {"completed":数字}，不要解释。';
  if (task === 'foreshadow') return '请从输入中判断伏笔识别结果，只返回 JSON 对象 {"truePos":数字,"falsePos":数字,"falseNeg":数字}，不要解释。';
  return '请只返回一个合法 JSON 对象，不要解释或使用 Markdown。';
}

/** 依据样本构造 /api/chat 请求体：输入文本与任务要求一起发送给真实模型。 */
function buildLiveChatBody(sample) {
  const task = String(sample && sample.task || '').trim();
  const input = sample && (sample.input != null ? sample.input : (sample.prompt != null ? sample.prompt : ''));
  const content = (String(input == null ? '' : input) || '(空输入)') + '\n\n【评测输出要求】\n' + liveTaskInstruction(task);
  const structuredTask = new Set(['contract', 'originality', 'entity_state', 'claim', 'evidence', 'unit', 'foreshadow']).has(task);
  const messages = [{ role: 'user', content }];
  const body = {
    stage: (sample && sample.stage) || (structuredTask ? 'skill_analysis' : 'writing'),
    messages,
    stream: true,
    temperature: Number(sample && sample.temperature) > 0 ? Number(sample.temperature) : (structuredTask ? 0.2 : 0.7),
    max_tokens: Number(sample && sample.max_tokens) > 0 ? Number(sample.max_tokens) : 2000
  };
  if (sample && sample.model) body.model = sample.model;
  body.jsonMode = sample && sample.jsonMode === false ? false : true;
  return body;
}

// 从单个 SSE data 包中提取增量文本，兼容 delta / message / content / text 多种形态。
function sseTextOf(pkt) {
  if (!pkt || typeof pkt !== 'object') return '';
  const c = pkt.choices && pkt.choices[0];
  if (c) {
    if (c.delta && typeof c.delta.content === 'string') return c.delta.content;
    if (c.message && typeof c.message.content === 'string') return c.message.content;
  }
  if (typeof pkt.content === 'string') return pkt.content;
  if (typeof pkt.text === 'string') return pkt.text;
  return '';
}

// 解析 /api/chat 的流式响应文本，提取模型输出与 molan_usage（含 requestId）。
// 逻辑对齐 server.js callMolanChat 的流式解析（data: 行解析 + molan_usage 提取）。
function parseLiveStream(raw) {
  let text = '';
  let usage = null;
  String(raw || '').split(/\r?\n/).forEach(line => {
    const v = line.trim();
    if (!v.startsWith('data:')) return;
    const val = v.slice(5).trim();
    if (!val || val === '[DONE]') return;
    try {
      const pkt = JSON.parse(val);
      if (pkt.molan_usage) usage = pkt.molan_usage;
      const t = sseTextOf(pkt);
      if (t) text += t;
    } catch (_) { /* 跳过无法解析的行 */ }
  });
  return { text, usage };
}

/** 从模型输出中解析第一个 JSON 对象，兼容代码围栏和前后解释文字。 */
function parseJsonOutput(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!source) return null;
  try { return JSON.parse(source); } catch (_) {}
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(source.slice(start, end + 1)); } catch (_) { return null; }
}

/** 将中文短文本切成可比较的词片，供 live 评测做保守的语义覆盖判断。 */
function matchTokens(value) {
  return new Set((String(value || '').toLowerCase().match(/[\u4e00-\u9fff]{2,4}|[a-z0-9]{3,}/gi) || []));
}

/** 计算两个评测文本的词片覆盖率，避免依赖额外模型调用。 */
function textCoverage(actual, expected) {
  const target = matchTokens(expected);
  if (!target.size) return 0;
  const source = matchTokens(actual);
  let hit = 0;
  for (const token of target) if (source.has(token)) hit += 1;
  return hit / target.size;
}

/** 判断合同字段是否足够具体，拒绝空值、套话和过短输出。 */
function substantiveContractValue(value) {
  const text = String(value || '').trim();
  return text.length >= 8 && /[\u4e00-\u9fffA-Za-z0-9]/.test(text) && !['主角变强', '敌人出现', '发生冲突', '展开战斗', '实力提升', '危机降临'].some(word => text.includes(word));
}

/** 从 live 模型输出归一化出 metrics.mjs 能够聚合的 actual 结构。 */
function actualFromLiveOutput(sample, text, usage, meta = {}) {
  const parsed = parseJsonOutput(text);
  const base = {
    from: 'live',
    text: String(text || '').slice(0, 20000),
    model: String(meta.model || ''),
    requestId: String(meta.requestId || ''),
    usage: usage || null
  };
  if (!parsed || typeof parsed !== 'object') return { ...base, parseError: '模型输出不是合法 JSON' };
  const task = String(sample && sample.task || '');
  const expected = sample && sample.expected && typeof sample.expected === 'object' ? sample.expected : {};
  if (task === 'contract') {
    const contract = parsed.contract && typeof parsed.contract === 'object' ? parsed.contract : parsed;
    return { ...base, passed: CONTRACT_FIELDS.every(field => substantiveContractValue(contract[field])) };
  }
  if (task === 'originality') {
    const blocked = parsed.blocked === true || (parsed.review && parsed.review.blocked === true);
    return { ...base, blocked };
  }
  if (task === 'entity_state') {
    const entity = String(parsed.entity || '');
    const stateChange = String(parsed.stateChange || parsed.change || '');
    const matched = entity === String(expected.entity || '') && textCoverage(stateChange, expected.stateChange) >= 0.3;
    return { ...base, entity, stateChange, truePos: matched ? 1 : 0, falsePos: matched ? 0 : 1, falseNeg: matched ? 0 : 1 };
  }
  if (task === 'claim' || task === 'evidence') {
    const claims = Array.isArray(parsed.claims) ? parsed.claims.filter(item => item && typeof item === 'object') : [];
    const expectedClaims = Array.isArray(expected.claims) ? expected.claims : [];
    const matchedExpected = new Set();
    let correctClaimCount = 0;
    let withValidEvidence = 0;
    for (const claim of claims) {
      const index = expectedClaims.findIndex((item, i) => !matchedExpected.has(i) && textCoverage(claim.text, item && item.text) >= 0.5);
      if (index < 0) continue;
      matchedExpected.add(index);
      correctClaimCount += 1;
      if (claim.hasEvidence === true && expectedClaims[index].hasEvidence === true && (task !== 'evidence' || expectedClaims[index].important !== true || claim.important === true || claim.hasEvidence === true)) withValidEvidence += 1;
    }
    return { ...base, claims, claimCount: claims.length, correctClaimCount, foundCorrectClaimCount: matchedExpected.size, withValidEvidence };
  }
  if (task === 'unit') return { ...base, completed: Number(parsed.completed) || 0 };
  if (task === 'foreshadow') return { ...base, truePos: Number(parsed.truePos) || 0, falsePos: Number(parsed.falsePos) || 0, falseNeg: Number(parsed.falseNeg) || 0 };
  return { ...base, parsed };
}

/** 单次 live 评测：调用真实 /api/chat，并把流式输出转换为可复用的 actual。 */
async function liveEvaluate(sample, token, baseUrl) {
  try {
    const body = buildLiveChatBody(sample);
    const res = await fetch(baseUrl + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    const model = res.headers.get('X-Molan-Model') || '';
    const requestIdHeader = res.headers.get('X-Molan-Request-Id') || '';
    const raw = await res.text();
    if (!res.ok) {
      return { from: 'live', error: 'HTTP ' + res.status, text: '', model, requestId: requestIdHeader, usage: null };
    }
    const { text, usage } = parseLiveStream(raw);
    const requestId = (usage && usage.requestId) || requestIdHeader || '';
    return actualFromLiveOutput(sample, text, usage, { model, requestId });
  } catch (e) {
    return { from: 'live', error: String((e && e.message) || e), text: '', model: '', requestId: '', usage: null };
  }
}

// —— AI 味增量指标：对每条生成文本调用 lib/ai-flavor-detector.js 打分（profile 按样本 genre 解析） ——

/** 按 fixture 样本的 genre 字段解析风格指纹 profile（取 lib 返回结构中的 profile 指纹本体）；缺省按仙侠题材解析，指纹库异常或缺失时返回 null 不阻断主流程。 */
function resolveProfileForSample(sample) {
  const genre = String((sample && sample.genre) || '').trim() || '仙侠';
  try {
    const resolved = styleFingerprint.resolveFingerprintProfile(genre);
    return resolved && resolved.profile && typeof resolved.profile === 'object' ? resolved.profile : null;
  } catch (_) {
    return null;
  }
}

/** 对单条评测结果的生成文本（actual.text）计算 AI 味分数 {score, passed, metrics}；无文本或库异常时返回 null。 */
function computeAiFlavorForResult(result) {
  const text = result && result.actual && typeof result.actual.text === 'string' ? result.actual.text : '';
  if (!text.trim()) return null;
  const profile = resolveProfileForSample(result.sample);
  try {
    return aiFlavorDetector.computeAiFlavorScore(text, profile);
  } catch (_) {
    return null;
  }
}

/** 汇总各样本的 AI 味分数为聚合指标（均分、通过率、可计分样本数），无样本时字段为 null。 */
function aggregateAiFlavor(aiFlavorRows) {
  const scored = (aiFlavorRows || []).filter(r => r && r.aiFlavor && Number.isFinite(r.aiFlavor.score));
  if (!scored.length) return { meanScore: null, passRate: null, scoredCount: 0 };
  const sum = scored.reduce((s, r) => s + r.aiFlavor.score, 0);
  const passed = scored.filter(r => r.aiFlavor.passed).length;
  return {
    meanScore: Number((sum / scored.length).toFixed(2)),
    passRate: Number((passed / scored.length).toFixed(4)),
    scoredCount: scored.length
  };
}

/** 在控制台打印 AI 味摘要表（sampleId / task / score / passed），无可计分文本时打印说明。 */
function printAiFlavorSummary(aiFlavorRows) {
  // 阈值与 lib/ai-flavor-detector.js 的 SCORE_RULES.passThreshold（score < 40）保持一致，仅用于展示。
  const passThreshold = 40;
  console.log('AI 味摘要（分数越低越好，通过阈值 ' + passThreshold + '）：');
  const rows = Array.isArray(aiFlavorRows) ? aiFlavorRows : [];
  if (!rows.some(r => r && r.aiFlavor)) {
    console.log('  （无可计分的生成文本：fixture 模式样本不含 actual.text，live 模式失败请求无正文）');
    return;
  }
  for (const row of rows) {
    const score = row.aiFlavor && row.aiFlavor.score != null ? row.aiFlavor.score : '-';
    const passed = row.aiFlavor ? (row.aiFlavor.passed ? '是' : '否') : '-';
    console.log('  ' + String(row.sampleId || '-').padEnd(20) + ' ' + String(row.task || '-').padEnd(14) + ' score=' + String(score).padEnd(5) + ' passed=' + passed);
  }
}

/** 执行 fixture 或 live 评测，生成报告并应用基线与 live 质量门禁。 */
async function main() {
  const opt = parseArgs(process.argv);
  const onlySet = opt.only ? new Set(opt.only.split(',')) : null;

  // live 模式：先登录拿 token（登录幂等）；缺少账号信息直接报错退出。
  let token = '';
  if (opt.live) {
    if (!opt.email || !opt.password) {
      console.error('[eval] --live 模式需要 --email/--password（或环境变量 MOLAN_EVAL_EMAIL / MOLAN_EVAL_PASSWORD）');
      process.exit(1);
    }
    token = await liveLogin(opt.baseUrl, opt.email, opt.password);
  }

  let requestIds = [];
  let liveModel = '';
  const results = await Promise.all(loadFixtures()
    .filter(s => !onlySet || (s.task && onlySet.has(s.task)))
    .map(async (s) => {
      let actual;
      if (opt.live) {
        const r = await liveEvaluate(s, token, opt.baseUrl);
        if (r.requestId && !requestIds.includes(r.requestId)) requestIds.push(r.requestId);
        if (!liveModel && r.model) liveModel = r.model;
        actual = r;
      } else {
        actual = evaluate(s);
      }
      return { task: s.task, sample: s, expected: s.expected, actual };
    }));

  const metrics = computeMetrics(results);
  // AI 味增量指标：对每条有生成文本的结果打分，聚合为 metrics.aiFlavor（不影响既有指标键）。
  const aiFlavorRows = results.map(r => ({ sampleId: r.sample.sampleId, task: r.task, aiFlavor: computeAiFlavorForResult(r) }));
  metrics.aiFlavor = aggregateAiFlavor(aiFlavorRows);
  const baselines = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};

  // 报告：记录运行环境与每个样本
  const report = {
    generatedAt: new Date().toISOString(),
    commit: process.env.GIT_COMMIT || '',
    model: opt.live ? liveModel : (process.env.EVAL_MODEL || 'n/a'),
    promptVersion: opt.live ? (process.env.EVAL_PROMPT_VERSION || LIVE_PROMPT_VERSION) : (process.env.EVAL_PROMPT_VERSION || 'n/a'),
    schemaVersion: '1',
    sampleCount: results.length,
    metrics,
    baselineCompare: {},
    samples: results.map((r, index) => ({ file: r.sample.file, sampleId: r.sample.sampleId, task: r.task, expected: r.expected, actual: r.actual, aiFlavor: aiFlavorRows[index] ? aiFlavorRows[index].aiFlavor : null })),
    regressions: []
  };

  // 报告强制校验：live 模式缺少真实模型或版本信息时标记 invalid；fixture 模式保留历史 n/a 行为。
  const missingLiveMetadata = opt.live && (!report.model || report.model === 'n/a' || !report.promptVersion || report.promptVersion === 'n/a');
  if (missingLiveMetadata || (!opt.live && !report.model && !report.promptVersion)) report.invalid = true;
  // live 模式记录每次真实调用的 requestId，便于回溯模型请求
  if (opt.live) report.requestIds = requestIds;

  // 与 baselines 比较：任一关键指标低于门槛 -> 返回非零退出码
  let gate = true;
  for (const [key, threshold] of Object.entries(baselines)) {
    const value = Number(metrics[key]);
    const ok = Number.isFinite(value) && value >= Number(threshold);
    report.baselineCompare[key] = { threshold: Number(threshold), value, ok };
    if (!ok) { gate = false; report.regressions.push(key); }
  }
  // Q1 门禁：false_pass_rate 必须为 0
  if (Number(metrics.false_pass_rate) > 0) { gate = false; report.regressions.push('false_pass_rate'); }

  // 阶段一 1.3 报告门禁：仅 live 模式执行，fixture 模式跳过。
  // 判据：合同通过率 < 0.9，或 originality 负样本（risky）拦截率 < 1.0。
  // 失败时 report.gate = 'failed' 并向 stderr 打印失败项；不影响 fixture 模式既有行为。
  if (opt.live) {
    const liveGateItems = [];
    if (report.invalid) liveGateItems.push('report_metadata_missing');
    if (Number(metrics.contract_pass_rate) < 0.9) {
      liveGateItems.push('contract_pass_rate=' + metrics.contract_pass_rate + ' (<0.9)');
    }
    if (Number(metrics.originality_block_rate) < 1.0) {
      liveGateItems.push('originality_negative_block_rate=' + metrics.originality_block_rate + ' (<1.0)');
    }
    if (liveGateItems.length) {
      report.gate = 'failed';
      gate = false; // 拉低最终退出码，使 CI 能识别门禁失败
      console.error('[eval] 报告门禁未通过：' + liveGateItems.join('；'));
    }
  }

  writeFileSync(opt.out, JSON.stringify(report, null, 2));
  console.log('样本数:', report.sampleCount);
  console.log('指标:', JSON.stringify(metrics, null, 2));
  printAiFlavorSummary(aiFlavorRows);
  if (opt.live) console.log('live 模型:', liveModel || '(未获取到)');
  console.log('报告:', opt.out);
  console.log(gate ? '✓ 门禁通过' : '✗ 门禁失败（' + report.regressions.join(', ') + '）');
  process.exit(gate ? 0 : 1);
}

main().catch(err => { console.error('[eval] 运行失败:', err); process.exit(1); });
