import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const experiments = require('../lib/benchmark-experiments.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITE_DIRECTORY = path.join(ROOT, 'data', 'genre-lab', 'benchmark-suite');
export const IMPLEMENTATION_FILES = [
  'server.js', 'scripts/run-local-benchmark-session.mjs', 'scripts/run-benchmark-experiments.mjs',
  'lib/benchmark-experiments.js', 'lib/benchmark-pipeline.js', 'lib/benchmark-receipts.js',
  'lib/evidence-review.js', 'lib/benchmark-metrics.js', 'lib/molan-node-client.js',
  'lib/genre-evidence.js', 'lib/genre-rule-scope.js', 'correction-policy.js'
];
export const GENRE_ASSET_FILES = ['genre-evidence', 'genre-rules', 'genre-baselines'].flatMap(directory =>
  ['玄幻', '都市高武', '悬疑脑洞', '青春甜宠', '历史脑洞', '科幻末世'].map(genre => `data/${directory}/${genre}.json`));

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

export function writeNewJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function createCheckpointStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const files = fs.readdirSync(directory).filter(name => /^checkpoint-\d{6}\.json$/.test(name)).sort();
  let sequence = 0;
  let previousHash = null;
  let state = null;
  for (const filename of files) {
    const envelope = readJson(path.join(directory, filename));
    const { checkpointHash, ...body } = envelope;
    if (envelope.sequence !== sequence + 1 || envelope.previousHash !== previousHash ||
      checkpointHash !== experiments.hashValue(body) ||
      filename !== `checkpoint-${String(envelope.sequence).padStart(6, '0')}.json`) throw new Error('续跑账本链损坏，停止且不覆盖原文件');
    sequence = envelope.sequence;
    previousHash = checkpointHash;
    state = envelope.state;
  }
  return {
    state,
    saveCheckpoint(nextState) {
      const body = { sequence: sequence + 1, previousHash, state: nextState };
      const checkpointHash = experiments.hashValue(body);
      writeNewJson(path.join(directory, `checkpoint-${String(sequence + 1).padStart(6, '0')}.json`), { ...body, checkpointHash });
      sequence += 1;
      previousHash = checkpointHash;
      state = nextState;
    }
  };
}

export function collectImplementationHashes(projectRoot = ROOT) {
  const hashes = {};
  for (const name of IMPLEMENTATION_FILES) {
    hashes[name] = experiments.hashValue(fs.readFileSync(path.join(projectRoot, name), 'utf8'));
  }
  const assetFiles = new Set(GENRE_ASSET_FILES);
  for (const directory of ['genre-evidence', 'genre-rules', 'genre-baselines']) {
    const absolute = path.join(projectRoot, 'data', directory);
    if (fs.existsSync(absolute)) {
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.json')) assetFiles.add(`data/${directory}/${entry.name}`);
      }
    }
  }
  for (const name of [...assetFiles].sort()) {
    const filename = path.join(projectRoot, name);
    hashes[name] = fs.existsSync(filename) ? experiments.hashValue(fs.readFileSync(filename, 'utf8')) : null;
  }
  return hashes;
}

export function readFrozenManifest(directory, projectRoot = ROOT) {
  const manifest = readJson(path.join(directory, 'manifest.json'));
  const { manifestHash, ...body } = manifest;
  if (manifestHash !== experiments.hashValue(body) || manifest.planHash !== experiments.hashValue(manifest.plan) ||
    manifest.configHash !== experiments.hashValue(manifest.config)) throw new Error('冻结manifest自身哈希不符');
  if (manifest.hashCoverageVersion !== 2 ||
    experiments.canonicalJson(manifest.implementationHashes) !== experiments.canonicalJson(collectImplementationHashes(projectRoot))) {
    throw new Error('实现或六题材资产哈希变化/覆盖不足，禁止续跑；保留旧凭证，不自动升级manifest');
  }
  return manifest;
}

export function validateRuntimeDirectory(value, projectRoot = ROOT, mustExist = true) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('runtime必须为绝对目录');
  const allowedRoot = path.join(path.resolve(projectRoot), 'data', 'benchmark-local-runtime');
  const target = path.resolve(value);
  const relative = path.relative(allowedRoot, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('runtime仅允许data/benchmark-local-runtime下的独立子目录');
  }
  let current = path.resolve(projectRoot);
  for (const component of path.relative(current, target).split(path.sep)) {
    current = path.join(current, component);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('runtime路径不得经过符号链接、junction或文件');
    }
  }
  if (mustExist && !fs.existsSync(target)) throw new Error('冻结runtime不存在，禁止重建余额或运行数据');
  return target;
}

export function freezeManifest(directory, plan, config, projectRoot = ROOT) {
  const filename = path.join(directory, 'manifest.json');
  if (fs.existsSync(filename)) {
    const manifest = readFrozenManifest(directory, projectRoot);
    if (manifest.planHash !== experiments.hashValue(plan) ||
      manifest.configHash !== experiments.hashValue(config)) throw new Error('冻结manifest与续跑输入不符，不覆盖');
    return manifest;
  }
  const suiteDirectory = path.join(projectRoot, 'data', 'genre-lab', 'benchmark-suite');
  const snapshotFiles = ['manifest.json', 'suite.json', 'control-prompt.txt', 'control-provenance.json'];
  const fixedSnapshots = Object.fromEntries(snapshotFiles.map(name => {
    const content = fs.readFileSync(path.join(suiteDirectory, name), 'utf8');
    return [name, { content, sha256: experiments.hashValue(content) }];
  }));
  const regressionContent = fs.readFileSync(path.join(projectRoot, 'data', 'genre-lab', 'regression-prompts.json'), 'utf8');
  fixedSnapshots['regression-prompts.json'] = { content: regressionContent, sha256: experiments.hashValue(regressionContent) };
  const implementationHashes = collectImplementationHashes(projectRoot);
  const body = {
    schemaVersion: 1, kind: 'frozen-local-benchmark-manifest', createdAt: new Date().toISOString(),
    status: 'not_executed_at_manifest_creation', plan, config,
    planHash: experiments.hashValue(plan), configHash: experiments.hashValue(config),
    hashCoverageVersion: 2, implementationHashes,
    implementationCaveat: '冻结本地实现及六题材evidence/rules/baselines，缺失资产记null并核验后续出现；续跑须完全一致。不冒充供应商部署或已启动服务版本证明。',
    fixedSnapshots,
    comparisonCaveat: 'P0单control固定prompt基线，不是完整历史主链路；P3同条件A/B；P4单candidate长篇。人工结果无预填。'
  };
  const manifest = { ...body, manifestHash: experiments.hashValue(body) };
  writeNewJson(filename, manifest);
  return manifest;
}

export function loadFixedInputs(phase, model = 'UNSELECTED_DRY_RUN', pipelineVersion = 'benchmark-local-v2-unverified', parameters = {}) {
  const suite = readJson(path.join(SUITE_DIRECTORY, 'suite.json'));
  const regression = readJson(path.join(ROOT, 'data', 'genre-lab', 'regression-prompts.json'));
  const provenance = readJson(path.join(SUITE_DIRECTORY, 'control-provenance.json'));
  const prompt = fs.readFileSync(path.join(SUITE_DIRECTORY, provenance.promptFile), 'utf8').replace(/\r\n/g, '\n').trim();
  const plan = experiments.buildExperimentPlan(suite, regression, phase);
  const fixedManifest = readJson(path.join(SUITE_DIRECTORY, 'manifest.json'));
  if (fixedManifest.suiteHash !== plan.suiteHash || fixedManifest.plans[phase]?.planHash !== experiments.hashValue(plan)) {
    throw new Error('固定套件与manifest计划哈希不符，拒绝实跑');
  }
  for (const [name, expectedHash] of Object.entries(fixedManifest.files)) {
    if (!['suite.json', 'control-prompt.txt', 'control-provenance.json'].includes(name) ||
      experiments.hashValue(fs.readFileSync(path.join(SUITE_DIRECTORY, name), 'utf8').replace(/\r\n/g, '\n')) !== expectedHash) {
      throw new Error('固定控制/题集文件哈希不符');
    }
  }
  if (experiments.hashValue(fs.readFileSync(path.join(ROOT, 'data', 'genre-lab', 'regression-prompts.json'), 'utf8').replace(/\r\n/g, '\n')) !== fixedManifest.regressionHash) {
    throw new Error('固定P3题集哈希不符');
  }
  const config = {
    model, pipelineVersion,
    parameters: { temperature: 0.8, maxRounds: 2, topP: null, seed: null, maxTokens: null, ...parameters },
    parameterSource: 'pipeline-request; provider overrides not independently verified',
    parameterLimitations: 'v2仅开放temperature/maxRounds。maxTokens由管线按阶段请求，topP/seed未开放；calls仅记录pipeline-request，不证明供应商实际采用参数或固定随机性。control无双稿与patch，费用不同是处理差异。',
    control: { ...provenance, prompt, promptHash: experiments.hashValue(prompt) }
  };
  return { plan, config };
}

export function parseArguments(argv) {
  const options = {};
  const flags = new Set(['--execute', '--dry-run', '--resume', '--export-blind', '--help']);
  const values = new Set(['--phase', '--model', '--pipeline-version', '--out', '--base-url', '--adapter', '--max-calls',
    '--temperature', '--max-rounds', '--review', '--packet', '--mapping']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (flags.has(argument)) options[argument.slice(2)] = true;
    else if (values.has(argument) && argv[index + 1] && !argv[index + 1].startsWith('--')) options[argument.slice(2)] = argv[++index];
    else throw new Error(`未知选项或缺值: ${argument}`);
  }
  if (options.execute && options['dry-run']) throw new Error('--execute与--dry-run互斥');
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log('默认只做dry-run，不登录、不推理。\n--phase P0|P3|P4 --out <新目录> [--model <模型>] [--pipeline-version <版本>]\n实跑须主代理批准后显式 --execute --model ... --pipeline-version ...；--resume --out <原目录> 续跑；--max-calls N 定量暂停。\n--adapter <mjs> 可注入export generateChapter(params)，默认用修复后的本机client login/requestJson。\n--export-blind 导出匿名包与独立私钥；--review <人工JSON> --packet <匿名JSON> --mapping <私钥JSON> 校验绑定。');
    return null;
  }
  const directory = path.resolve(options.out || path.join(SUITE_DIRECTORY, 'runs', `${Date.now()}-${randomUUID()}`));
  if (!options.resume && fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error('输出目录非空；新运行不得覆盖旧报告，续跑须--resume');
  const store = createCheckpointStore(directory);
  if (options.resume && !store.state) throw new Error('没有可续跑账本');
  if (options.resume) readFrozenManifest(directory);
  const phase = options.phase || store.state?.plan.phase || 'P0';
  const model = options.model || store.state?.config.model;
  const version = options['pipeline-version'] || store.state?.config.pipelineVersion;
  const parameters = { ...(store.state?.config.parameters || {}) };
  if (options.temperature !== undefined) parameters.temperature = Number(options.temperature);
  if (options['max-rounds'] !== undefined) parameters.maxRounds = Number(options['max-rounds']);
  const { plan, config } = loadFixedInputs(phase, model, version, parameters);
  const priorTransport = store.state?.config.transport;
  const adapterPath = options.adapter ? path.resolve(options.adapter) : priorTransport?.kind === 'injected' ? priorTransport.path : null;
  if (adapterPath) {
    config.transport = { kind: 'injected', path: adapterPath, sourceHash: experiments.hashValue(fs.readFileSync(adapterPath, 'utf8')) };
  } else {
    const client = require('../lib/molan-node-client.js');
    config.transport = { kind: 'local-http', baseUrl: client.localBaseUrl(options['base-url'] || priorTransport?.baseUrl || client.DEFAULT_BASE_URL), protocol: 'benchmark-local-v2' };
    const runtimeDirectory = process.env.MOLAN_BENCHMARK_RUNTIME_DIR || priorTransport?.runtimeDirectory;
    if (runtimeDirectory) config.transport.runtimeDirectory = validateRuntimeDirectory(runtimeDirectory);
  }
  experiments.validateConfig(config);
  const uniqueSuffix = `${Date.now()}-${randomUUID()}`;
  if (options.review || options['export-blind']) {
    if (options.execute) throw new Error('导入/导出人工评审与实跑不可同时执行');
    if (!store.state) throw new Error('需指定已执行账本并--resume');
    experiments.verifyCheckpoint(store.state, plan, config);
    if (options.review) {
      if (!options.packet || !options.mapping) throw new Error('人工导入须同时提供--packet与--mapping');
      const bound = experiments.bindHumanReview(store.state, readJson(path.resolve(options.packet)),
        readJson(path.resolve(options.mapping)), readJson(path.resolve(options.review)));
      const filename = path.join(directory, `human-bound-${uniqueSuffix}.json`);
      writeNewJson(filename, bound);
      console.log(`人工结果已完整校验并绑定；仍须独立语义审计与长篇结构门禁：${filename}`);
      return bound;
    }
    const { packet, mapping } = experiments.makeBlindReview(store.state);
    const packetPath = path.join(directory, `blind-${uniqueSuffix}.json`);
    const mappingPath = path.join(directory, 'private', `mapping-${uniqueSuffix}.json`);
    writeNewJson(mappingPath, mapping);
    writeNewJson(packetPath, packet);
    console.log(`盲评包：${packetPath}\n私钥仅供组织者，勿交评审：${mappingPath}`);
    return packet;
  }
  if (options.execute && (!model || model === 'UNSELECTED_DRY_RUN' || !version || version.endsWith('-unverified'))) {
    throw new Error('实跑须显式选定模型与可追溯pipeline-version；默认dry-run占位不可实跑');
  }
  freezeManifest(directory, plan, config);
  let generateChapter;
  if (options.execute && !store.state?.records.some(record => ['in_flight', 'uncertain', 'failed', 'audit_failed'].includes(record.status))) {
    if (adapterPath) {
      const adapter = await import(pathToFileURL(adapterPath).href);
      generateChapter = adapter.generateChapter;
    } else {
      const client = require('../lib/molan-node-client.js');
      const baseUrl = config.transport.baseUrl;
      let session;
      generateChapter = async params => {
        session ||= await client.login({ baseUrl });
        return client.requestJson(session, '/api/benchmark/generate', params);
      };
    }
  }
  const state = await experiments.runExperiment({
    plan, config, checkpoint: store.state, dryRun: !options.execute,
    ...(options['max-calls'] !== undefined ? { maxCalls: Number(options['max-calls']) } : {})
  }, {
    generateChapter: generateChapter || (async () => { throw new Error('阻塞账本禁止调用'); }),
    saveCheckpoint: store.saveCheckpoint
  });
  const filename = path.join(directory, `${options.execute ? 'summary' : 'dry-run'}-${uniqueSuffix}.json`);
  writeNewJson(filename, state);
  console.log(JSON.stringify({ phase, status: state.status, executed: state.executed,
    expectedGenerations: plan.expectedGenerations, recorded: state.records.length, output: filename }, null, 2));
  if (['blocked_uncertain', 'audit_failed', 'failed', 'missing_evidence'].includes(state.status)) process.exitCode = 2;
  return state;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('本地评测未完成：请核对参数、账本和本机服务；保留已有凭证，不自动重试。使用--help查看接口。');
    process.exitCode = 1;
  });
}
