// 对比评测（bare vs legacy-full vs two-pass）：对同一 fixture 任务指令，分别以三种配置请求 /api/chat，
// 采集返回状态、全文、总耗时与 tokens，并用 lib/ai-flavor-detector.js 对三份全文打 AI 味分数，输出对比表。
//
// 三种配置：
//   A bare        —— stage='single'，不带 characterMaterial、不带 skill（最小注入路径）
//   B legacy-full —— stage='writing'，沿用现有默认注入路径（纠错库 + 默认 skill + characterMaterial 素材）
//   C two-pass    —— stage='writing' + input.twoPassHumanize=true + characterMaterial enabled（两遍去 AI 味路径）
//
// 用法：
//   node scripts/eval/bare-vs-full.mjs --help
//   node scripts/eval/bare-vs-full.mjs --dry-run
//   node scripts/eval/bare-vs-full.mjs --fixture scripts/eval/fixtures/golden.jsonl --genre 仙侠 --limit 1 \
//        --base-url http://127.0.0.1:3000 --email xx --password xx
//
// 结果写入：scripts/eval/results/bare-vs-full-<timestamp>.json

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import aiFlavorDetector from '../../lib/ai-flavor-detector.js';
import styleFingerprint from '../../lib/style-fingerprint.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = join(ROOT, 'fixtures', 'golden.jsonl');
const RESULTS_DIR = join(ROOT, 'results');
const DEFAULT_GENRE = '仙侠';
const DEFAULT_LIMIT = 1;
const DEFAULT_PORT = process.env.MOLAN_PORT || '3000';

// AI 味通过阈值：与 lib/ai-flavor-detector.js 的 SCORE_RULES.passThreshold（score < 40）保持一致，仅用于控制台展示。
const AI_FLAVOR_PASS_THRESHOLD = 40;

// 写作任务指令：把 fixture 的大纲/输入转成正文写作要求。
// 注意必须走散文路径（jsonMode:false），否则服务端会禁用 characterMaterial 与纠错库注入。
const WRITING_INSTRUCTION = '请根据以上内容写出一段连贯的小说正文（400-600字），只输出正文本身，不要解释，不要使用 Markdown。';

// 三种对比配置的静态定义；请求体由 buildConfigurations 依据任务指令动态构造。
const CONFIG_DEFINITIONS = Object.freeze([
  {
    id: 'bare',
    label: '裸请求',
    description: "stage='single'，不带 characterMaterial、不带 skill（最小注入路径）"
  },
  {
    id: 'legacy-full',
    label: '旧全量注入',
    description: "stage='writing' 且显式 twoPassHumanize=false（旧单遍注入路径：纠错库 + skill + 素材）"
  },
  {
    id: 'two-pass',
    label: '两遍去 AI 味',
    description: "stage='writing' + twoPassHumanize=true + characterMaterial enabled"
  }
]);

/** 读取命令行参数的值，兼容 --name=value 与 --name value 两种写法（复用 runner.mjs 的解析模式）。 */
function readArgValue(args, name) {
  const equals = args.find(value => value.startsWith(name + '='));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
  return '';
}

/** 解析 bare-vs-full 命令行参数，生成运行配置对象。 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const has = (name) => args.includes(name);
  return {
    help: has('--help') || has('-h'),
    dryRun: has('--dry-run'),
    fixture: readArgValue(args, '--fixture') || DEFAULT_FIXTURE,
    genre: readArgValue(args, '--genre') || DEFAULT_GENRE,
    limit: Math.max(1, Number(readArgValue(args, '--limit')) || DEFAULT_LIMIT),
    baseUrl: readArgValue(args, '--base-url') || ('http://127.0.0.1:' + DEFAULT_PORT),
    email: readArgValue(args, '--email') || process.env.MOLAN_EVAL_EMAIL || '',
    password: readArgValue(args, '--password') || process.env.MOLAN_EVAL_PASSWORD || ''
  };
}

/** 打印帮助信息并返回退出码 0。 */
function printHelp() {
  console.log([
    '用法：node scripts/eval/bare-vs-full.mjs [选项]',
    '',
    '选项：',
    '  --fixture <path>   fixture JSONL 路径（默认 scripts/eval/fixtures/golden.jsonl）',
    '  --genre <题材>     风格指纹题材，用于解析 AI 味检测 profile（默认 仙侠）',
    '  --limit <n>        每种配置评测的 fixture 任务条数（默认 1）',
    '  --base-url <url>   服务地址（默认 http://127.0.0.1:3000，可用环境变量 MOLAN_PORT）',
    '  --email <邮箱>     评测账号（或环境变量 MOLAN_EVAL_EMAIL）',
    '  --password <密码>  评测账号密码（或环境变量 MOLAN_EVAL_PASSWORD）',
    '  --dry-run          只解析参数与 fixture、构造请求体，不发起真实请求',
    '  --help, -h         显示本帮助',
    '',
    '输出：scripts/eval/results/bare-vs-full-<timestamp>.json，并在控制台打印 AI 味分数对比表'
  ].join('\n'));
}

/** 解析题材风格指纹：适配 lib/style-fingerprint.js 的返回结构（matchedBucket/bookCount/profile）；指纹库缺失或异常时 profile 为 null，检测器将跳过基准偏离计分。 */
function resolveGenreProfile(genre) {
  try {
    const resolved = styleFingerprint.resolveFingerprintProfile(genre);
    if (resolved && resolved.profile && typeof resolved.profile === 'object') {
      return {
        genre: String(genre),
        matchedBucket: String(resolved.matchedBucket || ''),
        bookCount: Number(resolved.bookCount) || 0,
        profile: resolved.profile
      };
    }
  } catch (_) { /* 指纹库异常时降级为无基准检测，不阻断评测 */ }
  return { genre: String(genre), matchedBucket: '', bookCount: 0, profile: null };
}

/** 读取 fixture JSONL 中带输入文本的样本，最多取 limit 条作为评测任务指令。 */
function loadFixtureTasks(fixturePath, limit) {
  if (!existsSync(fixturePath)) {
    throw new Error('fixture 文件不存在：' + fixturePath);
  }
  const tasks = [];
  for (const line of readFileSync(fixturePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try { row = JSON.parse(trimmed); } catch (_) { continue; }
    const input = row && (row.input != null ? row.input : (row.prompt != null ? row.prompt : ''));
    if (!input) continue;
    tasks.push({
      sampleId: String(row.sampleId || ''),
      task: String(row.task || ''),
      genre: String(row.genre || ''),
      input: String(input)
    });
    if (tasks.length >= limit) break;
  }
  if (!tasks.length) {
    throw new Error('fixture 中没有带 input/prompt 字段的可用样本：' + fixturePath);
  }
  return tasks;
}

/** 依据任务指令构造三种配置的 /api/chat 请求体（jsonMode:false 保证素材与纠错注入路径生效）。 */
function buildConfigurations(task, genre) {
  const messages = [{ role: 'user', content: task.input + '\n\n' + WRITING_INSTRUCTION }];
  const common = {
    messages,
    stream: true,
    temperature: 0.85,
    max_tokens: 2000,
    jsonMode: false
  };
  // A bare：stage='single'，不带 characterMaterial、不带 skill
  const bareBody = { ...common, stage: 'single' };
  // B legacy-full：stage='writing'，旧单遍注入路径（纠错库 + skill + 素材），显式关闭两遍模式以复现旧行为
  const legacyFullBody = {
    ...common,
    stage: 'writing',
    twoPassHumanize: false,
    characterMaterial: { enabled: true, proseTask: true, genre }
  };
  // C two-pass：stage='writing' + twoPassHumanize + characterMaterial enabled
  const twoPassBody = {
    ...common,
    stage: 'writing',
    twoPassHumanize: true,
    characterMaterial: { enabled: true, proseTask: true, genre }
  };
  const bodies = { bare: bareBody, 'legacy-full': legacyFullBody, 'two-pass': twoPassBody };
  return CONFIG_DEFINITIONS.map(def => ({ ...def, body: bodies[def.id] }));
}

/** 登录评测测试账号：POST /api/auth/login（复用 runner.mjs 的登录模式），成功返回鉴权 token。 */
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

/** 从单个 SSE data 包中提取增量文本，兼容 delta / message / content / text 多种形态（复用 runner.mjs）。 */
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

/** 解析 /api/chat 的流式响应文本，提取模型输出全文与 molan_usage（含 requestId 与 tokens，复用 runner.mjs）。 */
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

/** 对指定配置发起一次 /api/chat 流式请求并聚合全文，记录状态、耗时与 tokens。 */
async function requestOnce(baseUrl, token, body) {
  const startedAt = Date.now();
  try {
    const res = await fetch(baseUrl + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    const model = res.headers.get('X-Molan-Model') || '';
    const requestIdHeader = res.headers.get('X-Molan-Request-Id') || '';
    const raw = await res.text();
    const elapsedMs = Date.now() - startedAt;
    if (!res.ok) {
      return { httpStatus: res.status, elapsedMs, text: '', usage: null, error: 'HTTP ' + res.status, model, requestId: requestIdHeader };
    }
    const { text, usage } = parseLiveStream(raw);
    return {
      httpStatus: res.status,
      elapsedMs,
      text,
      usage,
      error: text ? null : '响应中未聚合到任何正文文本',
      model,
      requestId: (usage && usage.requestId) || requestIdHeader || ''
    };
  } catch (e) {
    return { httpStatus: 0, elapsedMs: Date.now() - startedAt, text: '', usage: null, error: String((e && e.message) || e), model: '', requestId: '' };
  }
}

/** 对单条任务的三种配置结果计算 AI 味分数（无文本时记 null），生成结果 JSON 中的 configurations 数组。 */
function scoreConfigurations(results) {
  return results.map(result => ({
    id: result.id,
    label: result.label,
    description: result.description,
    httpStatus: result.httpStatus,
    elapsedMs: result.elapsedMs,
    text: result.text,
    usage: result.usage ? {
      promptTokens: result.usage.promptTokens ?? null,
      completionTokens: result.usage.completionTokens ?? null,
      totalTokens: result.usage.totalTokens ?? null
    } : null,
    requestId: result.requestId || '',
    error: result.error || null,
    aiFlavor: result.text ? aiFlavorDetector.computeAiFlavorScore(result.text, result.profile) : null
  }));
}

/** 汇总所有任务的 AI 味均分、耗时与 tokens，并生成按 AI 味从低到高的排名。 */
function buildSummary(taskResults) {
  const configIds = CONFIG_DEFINITIONS.map(def => def.id);
  const collect = (pick) => {
    const summary = {};
    for (const id of configIds) {
      const values = taskResults
        .flatMap(task => task.configurations.filter(c => c.id === id))
        .map(pick)
        .filter(value => value != null && Number.isFinite(value));
      summary[id] = values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)) : null;
    }
    return summary;
  };
  const aiFlavorMeanScore = collect(c => c.aiFlavor && c.aiFlavor.score);
  const ranking = configIds
    .filter(id => aiFlavorMeanScore[id] != null)
    .sort((a, b) => aiFlavorMeanScore[a] - aiFlavorMeanScore[b]);
  return {
    aiFlavorMeanScore,
    meanElapsedMs: collect(c => Number(c.elapsedMs) || null),
    meanTotalTokens: collect(c => (c.usage && Number(c.usage.totalTokens)) || null),
    ranking
  };
}

/** 在控制台打印单条任务的 AI 味分数对比表。 */
function printComparisonTable(task) {
  console.log('\n[' + (task.sampleId || 'task') + '] AI 味分数对比（分数越低越好，通过阈值 ' + AI_FLAVOR_PASS_THRESHOLD + '）');
  const pad = (value, width) => String(value == null ? '-' : value).padEnd(width, ' ');
  console.log([pad('配置', 14), pad('HTTP', 6), pad('耗时(ms)', 10), pad('tokens', 8), pad('AI味分数', 10), '通过'].join(''));
  for (const c of task.configurations) {
    const tokens = c.usage && c.usage.totalTokens != null ? c.usage.totalTokens : '-';
    const score = c.aiFlavor && c.aiFlavor.score != null ? c.aiFlavor.score : '-';
    const passed = c.aiFlavor ? (c.aiFlavor.passed ? '是' : '否') : '-';
    console.log([pad(c.id, 14), pad(c.httpStatus || '-', 6), pad(c.elapsedMs, 10), pad(tokens, 8), pad(score, 10), passed].join(''));
  }
}

/** 生成文件名安全的时间戳（形如 20260830-153000）。 */
function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..+$/, '');
}

/** dry-run 模式：只解析参数与 fixture、解析 profile、构造请求体并试算 AI 味，不发起真实请求。 */
function runDryRun(opt) {
  const tasks = loadFixtureTasks(opt.fixture, opt.limit);
  const profileMeta = resolveGenreProfile(opt.genre);
  console.log('[dry-run] fixture：' + opt.fixture + '（取前 ' + tasks.length + ' 条任务）');
  console.log('[dry-run] 风格指纹 profile：genre=' + profileMeta.genre
    + '，matchedBucket=' + (profileMeta.matchedBucket || '(无匹配)')
    + '，bookCount=' + profileMeta.bookCount
    + (profileMeta.profile ? '' : '（指纹库不可用，检测将跳过基准偏离计分）'));
  const firstConfigurations = buildConfigurations(tasks[0], opt.genre);
  for (const config of firstConfigurations) {
    console.log('[dry-run] 配置 ' + config.id + '（' + config.description + '）请求体：');
    console.log(JSON.stringify(config.body, null, 2));
  }
  const probe = aiFlavorDetector.computeAiFlavorScore(tasks[0].input, profileMeta.profile);
  console.log('[dry-run] AI 味检测器自检（对第一条任务指令文本试算）：score=' + probe.score + '，passed=' + probe.passed);
  console.log('[dry-run] 未发起任何网络请求，未写入结果文件。');
}

/** 主流程：解析参数 -> 登录 -> 逐任务逐配置请求 -> AI 味打分 -> 写结果文件并打印对比表。 */
async function main() {
  const opt = parseArgs(process.argv);
  if (opt.help) {
    printHelp();
    return;
  }
  if (opt.dryRun) {
    runDryRun(opt);
    return;
  }

  if (!opt.email || !opt.password) {
    console.error('[eval] 对比评测需要 --email/--password（或环境变量 MOLAN_EVAL_EMAIL / MOLAN_EVAL_PASSWORD）；仅验证参数可用 --dry-run');
    process.exit(1);
  }

  const tasks = loadFixtureTasks(opt.fixture, opt.limit);
  const profileMeta = resolveGenreProfile(opt.genre);
  console.log('[eval] fixture：' + opt.fixture + '（' + tasks.length + ' 条任务）');
  console.log('[eval] 风格指纹 profile：genre=' + profileMeta.genre
    + '，matchedBucket=' + (profileMeta.matchedBucket || '(无匹配)')
    + '，bookCount=' + profileMeta.bookCount
    + (profileMeta.profile ? '' : '（指纹库不可用，检测将跳过基准偏离计分）'));

  const token = await liveLogin(opt.baseUrl, opt.email, opt.password);

  const taskResults = [];
  for (const task of tasks) {
    const configurations = buildConfigurations(task, opt.genre);
    const results = [];
    for (const config of configurations) {
      console.log('[eval] 请求配置 ' + config.id + '（任务 ' + (task.sampleId || '-') + '）…');
      const result = await requestOnce(opt.baseUrl, token, config.body);
      results.push({ ...result, id: config.id, label: config.label, description: config.description, profile: profileMeta.profile });
    }
    taskResults.push({
      sampleId: task.sampleId,
      task: task.task,
      instruction: task.input + '\n\n' + WRITING_INSTRUCTION,
      configurations: scoreConfigurations(results)
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    script: 'bare-vs-full',
    fixture: opt.fixture,
    genre: opt.genre,
    fingerprintProfile: { genre: profileMeta.genre, matchedBucket: profileMeta.matchedBucket, bookCount: profileMeta.bookCount },
    baseUrl: opt.baseUrl,
    aiFlavorPassThreshold: AI_FLAVOR_PASS_THRESHOLD,
    taskCount: taskResults.length,
    tasks: taskResults,
    summary: buildSummary(taskResults)
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, 'bare-vs-full-' + timestampForFile() + '.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  for (const task of taskResults) printComparisonTable(task);
  console.log('\n[汇总] AI 味均分（低者为优）：' + JSON.stringify(report.summary.aiFlavorMeanScore));
  console.log('[汇总] 排名（AI 味从低到高）：' + (report.summary.ranking.join(' < ') || '无有效数据'));
  console.log('报告：' + outPath);
}

main().catch(err => { console.error('[eval] 运行失败:', err); process.exit(1); });
