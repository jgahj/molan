import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './export-runtime-contract.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'character-material-v3.1', 'releases');
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const AUTOMATED_REVIEW_PATTERN = /ai|detector|model|proxy|llm|machine|automatic/iu;

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { value: null, missing: true, errors: [`文件不存在：${filePath || '(空)'}`] };
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')), missing: false, errors: [] };
  } catch (error) {
    return { value: null, missing: false, errors: [`JSON 无效：${filePath}：${error.message}`] };
  }
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function isValidVersionId(value) {
  const version = asString(value);
  return VERSION_PATTERN.test(version) && !version.includes('..');
}

export function resolveContainedPath(root, requested) {
  const rootPath = path.resolve(String(root || '.'));
  const raw = asString(requested);
  if (!raw || raw.includes('\0')) return { pass: false, error: '路径为空或包含非法字符' };
  if (raw.split(/[\\/]/u).includes('..')) return { pass: false, error: '路径越界：禁止使用 ..' };
  const resolved = path.resolve(rootPath, raw);
  const relative = path.relative(rootPath, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { pass: false, error: `路径越界：${raw}` };
  }
  return { pass: true, path: resolved };
}

function gatePassed(gate) {
  if (gate === true || gate === 'pass' || gate === 'passed') return true;
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) return false;
  const status = asString(gate.status).toLowerCase();
  if (gate.pending === true || gate.pass === false || gate.valid === false || ['pending', 'blocked', 'failed', 'rejected', 'error'].includes(status)) return false;
  return gate.pass === true || gate.passed === true || status === 'pass' || status === 'passed';
}

function gateFrom(value, key) {
  if (value && typeof value === 'object' && value[key] !== undefined) return value[key];
  return value;
}

export function extractVersionEntries(registry) {
  if (Array.isArray(registry)) return registry;
  if (registry && Array.isArray(registry.versions)) return registry.versions;
  if (registry && registry.version && typeof registry === 'object') return [registry];
  return [];
}

function manifestGate(manifest, type) {
  return gateFrom(manifest?.gates, type) ?? manifest?.[`${type}Gate`];
}

/** A rollback target must be registered, readable, identity-matching and gate-approved. */
export function validateRollbackTarget({ targetVersion, registry, versionsRoot, manifestLoader } = {}) {
  const version = asString(targetVersion);
  const errors = [];
  if (!isValidVersionId(version)) errors.push('回滚版本标识无效或疑似伪造');
  const entries = extractVersionEntries(registry);
  const entry = entries.find(item => asString(item?.version || item?.versionId) === version);
  if (!entry) errors.push(`回滚版本未在版本登记表中找到：${version}`);
  if (!versionsRoot) errors.push('缺少 versionsRoot，不能验证回滚路径');
  let manifest = null;
  let manifestPath = '';
  let manifestHashVerified = false;
  if (entry && versionsRoot) {
    const requestedPath = entry.manifestPath || entry.path || `${version}/manifest.json`;
    const safe = resolveContainedPath(versionsRoot, requestedPath);
    if (!safe.pass) errors.push(safe.error);
    else {
      manifestPath = safe.path;
      const loaded = manifestLoader ? manifestLoader(manifestPath) : readJson(manifestPath);
      if (loaded?.errors?.length) errors.push(...loaded.errors);
      manifest = loaded?.value ?? loaded;
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) errors.push('回滚 manifest 缺失或格式无效');
    }
  }
  if (manifest && asString(manifest.version || manifest.versionId) !== version) errors.push('manifest 版本标识与登记目标不一致，拒绝伪造版本');
  const compatibility = entry?.compatibility ?? entry?.compatibilityGate;
  const security = entry?.security ?? entry?.securityGate;
  if (!gatePassed(compatibility) || !gatePassed(manifestGate(manifest, 'compatibility'))) errors.push('回滚目标未通过兼容门禁');
  if (!gatePassed(security) || !gatePassed(manifestGate(manifest, 'security'))) errors.push('回滚目标未通过安全门禁');
  const entryStatus = asString(entry?.status).toLowerCase();
  if (!['passed', 'released'].includes(entryStatus)) errors.push('回滚目标必须明确标记为已通过/已发布版本');
  const expectedHash = asString(entry?.manifestSha256 || entry?.sha256);
  if (!/^[a-f0-9]{64}$/u.test(expectedHash)) errors.push('回滚目标缺少有效的 manifest SHA-256 登记');
  if (manifest && !['passed', 'released'].includes(asString(manifest.status).toLowerCase())) errors.push('回滚 manifest 未明确标记为已通过/已发布');
  if (expectedHash && manifestPath && fs.existsSync(manifestPath)) {
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
    if (actualHash !== expectedHash) errors.push('回滚 manifest 哈希与登记表不一致，拒绝伪造版本');
    else manifestHashVerified = true;
  }
  return { pass: errors.length === 0, version, entry: entry || null, manifest, manifestPath, manifestHashVerified, errors };
}

function feedbackGatePassed(report) {
  const metrics = report?.metrics;
  const requiredGates = ['sourceEvaluation', 'inputIntegrity', 'realHumanScoredData', 'noPendingPairs', 'failureCasesClassified', 'claimable', 'qualityNonInferiority'];
  const inputErrors = Array.isArray(report?.inputErrors) ? report.inputErrors : [];
  const reviewerIds = Array.isArray(report?.reviewerIds) ? report.reviewerIds.map(asString).filter(Boolean) : [];
  const source = report?.source;
  return Boolean(report
    && report.claimable === true
    && report.status === 'scored'
    && inputErrors.length === 0
    && metrics?.source === 'human-blind-review'
    && metrics?.evidencePolicy?.humanReviewRequired === true
    && metrics?.evidencePolicy?.aiDetectorSoleBasis === false
    && Number(metrics.scoredPairCount) > 0
    && Number(metrics.pendingPairCount) === 0
    && metrics.claimable === true
    && source?.generationEval === 'scripts/generation-eval.mjs'
    && asString(source.reportVersion)
    && Number(report.reviewCount) >= Number(metrics.scoredPairCount)
    && reviewerIds.length > 0
    && reviewerIds.every(reviewerId => !AUTOMATED_REVIEW_PATTERN.test(reviewerId))
    && report.qualityGate?.pass === true
    && requiredGates.every(key => report.gates?.[key]?.pass === true));
}

function isVerifiedRollbackValidation(value) {
  const hash = asString(value?.entry?.manifestSha256 || value?.entry?.sha256);
  return Boolean(value?.pass
    && isValidVersionId(value.version)
    && value.manifest
    && typeof value.manifest === 'object'
    && value.manifestPath
    && value.manifestHashVerified === true
    && asString(value.manifest.version || value.manifest.versionId) === value.version
    && ['passed', 'released'].includes(asString(value.manifest.status).toLowerCase())
    && ['passed', 'released'].includes(asString(value.entry?.status).toLowerCase())
    && SHA256_PATTERN.test(hash));
}

export function evaluateReleaseGates({ feedbackReport, compatibility, security } = {}) {
  const gates = {
    feedback: { pass: feedbackGatePassed(feedbackReport), reason: '必须有完整真实人工盲评且 claimable' },
    compatibility: { pass: gatePassed(compatibility), reason: '必须明确通过兼容门禁且不能 pending' },
    security: { pass: gatePassed(security), reason: '必须明确通过安全门禁且不能 pending' }
  };
  return { pass: Object.values(gates).every(gate => gate.pass), gates };
}

export function buildRollbackPlan({ currentVersion, targetVersion, targetValidation, reason = '新版本门禁失败时恢复上一已验证版本' } = {}) {
  if (!isVerifiedRollbackValidation(targetValidation) || targetValidation.version !== targetVersion) {
    throw new Error('不能为未验证的版本生成回滚计划');
  }
  return {
    planVersion: 'molan-rollback-plan-v1',
    auditable: true,
    currentVersion: asString(currentVersion),
    targetVersion: asString(targetVersion),
    targetManifestPath: targetValidation.manifestPath,
    targetStatus: targetValidation.entry?.status || 'passed',
    targetManifestSha256: targetValidation.entry?.manifestSha256 || targetValidation.entry?.sha256 || null,
    reason: asString(reason) || '门禁失败回滚',
    preconditions: [
      '冻结当前发布并记录触发事件、操作者和时间',
      `再次核验目标 ${targetVersion} 的 manifest 身份、兼容门禁和安全门禁`,
      '保留当前版本产物、日志和数据库迁移状态，不删除审计证据'
    ],
    steps: [
      '切换到目标版本 manifest 指向的已登记产物',
      '运行启动、兼容和安全烟囱检查',
      '验证关键生成任务与评测状态后解除流量冻结',
      '记录回滚结果；若验证失败，保持 needs_review 并停止自动重试'
    ],
    abortConditions: ['目标 manifest 不存在或身份不匹配', '兼容/安全门禁不再通过', '出现越界路径或登记哈希不匹配']
  };
}

export function buildChangeSummary({ version, previousVersion, releaseGates, feedbackReport, changes = [] } = {}) {
  const changeItems = Array.isArray(changes) ? changes : [changes].filter(Boolean);
  const lines = [
    '# Generation Release Change Summary',
    '',
    `版本：${version}`,
    `前一版本：${previousVersion || '未指定'}`,
    `发布门禁：${releaseGates?.pass ? '通过' : '阻断'}`,
    '',
    '## 变更',
    '',
    ...(changeItems.length ? changeItems.map(item => `- ${item}`) : ['- 接入 generation-eval 的 prompt/pair/score/report 数据。', '- 引入真实人工盲评、pending 保留和结构化样本/rule/retrieval 反馈。', '- 发布产物绑定兼容、安全和可审计回滚门禁。']),
    '',
    '## 评测边界',
    '',
    `- 人工评分 pair：${feedbackReport?.metrics?.scoredPairCount ?? 0}`,
    `- Pending pair：${feedbackReport?.metrics?.pendingPairCount ?? 0}`,
    `- 可声明指标：${feedbackReport?.claimable ? '是' : '否'}`,
    '- deterministic proxy 和 AI 检测器不作为唯一质量依据。',
    ''
  ];
  return lines.join('\n');
}

export function prepareRelease({ version, previousVersion, feedbackReport, compatibility, security, rollbackTarget, changes, generatedAt } = {}) {
  const errors = [];
  if (!isValidVersionId(version)) errors.push('候选版本标识无效');
  const releaseGates = evaluateReleaseGates({ feedbackReport, compatibility, security });
  if (!releaseGates.pass) errors.push(...Object.entries(releaseGates.gates).filter(([, gate]) => !gate.pass).map(([name, gate]) => `${name} 门禁未通过：${gate.reason}`));
  const targetValidation = rollbackTarget?.validation || rollbackTarget;
  if (!isVerifiedRollbackValidation(targetValidation)) {
    errors.push('缺少已存在且兼容/安全门禁通过的回滚目标');
    if (targetValidation?.errors?.length) errors.push(...targetValidation.errors);
  }
  if (previousVersion && targetValidation?.version && previousVersion !== targetValidation.version) errors.push('previousVersion 与回滚目标不一致');
  const rollbackPlan = errors.length ? null : buildRollbackPlan({ currentVersion: version, targetVersion: targetValidation.version, targetValidation });
  const manifest = {
    manifestVersion: 'molan-generation-release-v1',
    version: asString(version),
    status: errors.length ? 'blocked' : 'released',
    generatedAt: generatedAt || new Date().toISOString(),
    source: 'scripts/generation-feedback.mjs',
    previousVersion: asString(previousVersion),
    gates: releaseGates.gates,
    feedback: {
      reportVersion: feedbackReport?.reportVersion || null,
      claimable: feedbackReport?.claimable === true,
      metrics: feedbackReport?.metrics || null,
      qualityGate: feedbackReport?.qualityGate || null
    },
    rollback: rollbackPlan ? { targetVersion: rollbackPlan.targetVersion, auditable: true } : null
  };
  return {
    pass: errors.length === 0,
    errors,
    manifest,
    changeSummary: buildChangeSummary({ version, previousVersion, releaseGates, feedbackReport, changes }),
    rollbackPlan,
    gates: releaseGates
  };
}

function cliJson(filePath) {
  return readJson(filePath).value;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/release-version.mjs --version id --feedback-report path --compatibility path --security path --versions path --versions-root path --rollback-to id --write --out-dir path');
    return 0;
  }
  const version = asString(options.version);
  const feedbackReport = cliJson(options['feedback-report']);
  const compatibility = cliJson(options.compatibility);
  const security = cliJson(options.security);
  const registryPath = options.versions ? path.resolve(process.cwd(), String(options.versions)) : '';
  const registry = registryPath ? cliJson(registryPath) : null;
  const versionsRoot = options['versions-root']
    ? path.resolve(process.cwd(), String(options['versions-root']))
    : (registryPath ? path.dirname(registryPath) : '');
  const targetVersion = asString(options['rollback-to'] || options['previous-version']);
  const targetValidation = validateRollbackTarget({ targetVersion, registry, versionsRoot });
  const result = prepareRelease({ version, previousVersion: options['previous-version'], feedbackReport, compatibility, security, rollbackTarget: targetValidation, changes: options.change ? [String(options.change)] : [] });
  const outputDir = options['out-dir'] ? path.resolve(process.cwd(), String(options['out-dir'])) : DEFAULT_OUTPUT_DIR;
  const outputs = {
    manifestPath: path.join(outputDir, 'manifest.json'),
    changeSummaryPath: path.join(outputDir, 'change-summary.md'),
    rollbackPlanPath: path.join(outputDir, 'rollback-plan.json')
  };
  if (options.write === true) {
    writeJson(outputs.manifestPath, result.manifest);
    writeText(outputs.changeSummaryPath, result.changeSummary);
    if (result.rollbackPlan) writeJson(outputs.rollbackPlanPath, result.rollbackPlan);
  }
  console.log(JSON.stringify({ pass: result.pass, version, errors: result.errors, outputs: options.write === true ? outputs : null }, null, 2));
  return result.pass ? 0 : 1;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) process.exitCode = main();

export { DEFAULT_OUTPUT_DIR };
