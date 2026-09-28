import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const RESOURCE_ROOT = path.resolve(REPO_ROOT, '..', '资源库');
const DEFAULT_QUOTA_CONFIG_PATH = path.join(RESOURCE_ROOT, 'quota-config.json');
const DEFAULT_INDEX_PATH = path.join(REPO_ROOT, 'lib', 'character-material', 'index.json');
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'lib', 'character-material', 'quality-report.json');
const DEFAULT_CONTRACT_DIR = path.join(REPO_ROOT, 'data', 'character-material-v3.1', 'contracts');
const DEFAULT_OUTPUT_PATH = path.join(DEFAULT_CONTRACT_DIR, 'quota-contract.snapshot.json');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const equals = token.indexOf('=');
    if (equals > 2) {
      options[token.slice(2, equals)] = token.slice(equals + 1);
      continue;
    }
    const key = token.slice(2);
    if (['validate', 'write', 'help'].includes(key)) {
      options[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function resolvePath(value, fallback) {
  return value ? path.resolve(process.cwd(), String(value)) : fallback;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 JSON：${filePath}；${error.message}`);
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function objectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
}

function extractQuota(report, index) {
  return report?.quota
    || report?.audit?.quota
    || index?.audit?.quota
    || null;
}

function makeThresholds(config) {
  const platform = config.platformCoverage && typeof config.platformCoverage === 'object'
    ? config.platformCoverage
    : {};
  return {
    sampleMinChars: 12,
    sampleMaxChars: 140,
    strongSampleMax: 2,
    cellHardFloor: finiteNumber(config.cellHardFloor),
    cellTarget: finiteNumber(config.cellMinChars),
    perBookCellCapPct: finiteNumber(config.perBookCellCapPct),
    perBookCapBasis: String(config.perBookCellCapBasis || 'targetMinChars'),
    perBookCapChars: Math.floor(finiteNumber(config.cellMinChars) * finiteNumber(config.perBookCellCapPct)),
    requireCompletedWork: config.requireCompletedWork === true,
    requireFullWork: config.requireFullWork === true,
    requireDeclaredChapterCount: config.requireDeclaredChapterCount === true,
    maxSinglePlatformShare: finiteNumber(platform.maxSinglePlatformShare, null),
    platformCoverageEnforced: platform.enforce === true && platform.reportOnlyUntilEvidence !== true
  };
}

function validateConfig(config, report, index) {
  const errors = [];
  const thresholds = makeThresholds(config);
  const archetypes = Array.isArray(config.archetypes) ? config.archetypes : [];
  const buckets = config.genreBuckets && typeof config.genreBuckets === 'object' && !Array.isArray(config.genreBuckets)
    ? Object.keys(config.genreBuckets)
    : [];
  if (!String(config.version || '').trim()) errors.push('quota-config 缺少 version');
  if (!archetypes.length) errors.push('quota-config.archetypes 不能为空');
  if (!buckets.length) errors.push('quota-config.genreBuckets 不能为空');
  if (archetypes.length !== 10) errors.push(`archetypes 应为 10 类，实际为 ${archetypes.length}`);
  if (buckets.length !== 4) errors.push(`genreBuckets 应为 4 桶，实际为 ${buckets.length}`);
  if (thresholds.cellHardFloor <= 0 || thresholds.cellTarget < thresholds.cellHardFloor) {
    errors.push('cellHardFloor/cellMinChars 数值关系无效');
  }
  if (!(thresholds.perBookCellCapPct > 0 && thresholds.perBookCellCapPct <= 1)) {
    errors.push('perBookCellCapPct 必须在 (0, 1] 内');
  }
  if (thresholds.maxSinglePlatformShare !== null
    && !(thresholds.maxSinglePlatformShare > 0 && thresholds.maxSinglePlatformShare <= 1)) {
    errors.push('platformCoverage.maxSinglePlatformShare 必须在 (0, 1] 内');
  }
  // 兼容旧版 v3.1 重建报告：它服务于素材诊断，不等同于 quota-config 的发布版本；正式发布仍由最终门禁严格绑定。
  const legacyRebuildReport = String(report?.version || '').includes('v3.1-rebuild');
  if (!legacyRebuildReport && report?.version && config.version && String(report.version) !== String(config.version)) {
    errors.push(`quality-report/config version 不一致：${report.version} != ${config.version}`);
  }
  const quota = extractQuota(report, index);
  if (!legacyRebuildReport && quota?.configVersion && config.version && String(quota.configVersion) !== String(config.version)) {
    errors.push(`quota report/config version 不一致：${quota.configVersion} != ${config.version}`);
  }
  return {
    pass: errors.length === 0,
    errors,
    expectedCellCount: archetypes.length * buckets.length,
    archetypeCount: archetypes.length,
    bucketCount: buckets.length
  };
}

export function buildQuotaContract(options = {}) {
  const quotaConfigPath = options.quotaConfigPath || DEFAULT_QUOTA_CONFIG_PATH;
  const indexPath = options.indexPath || DEFAULT_INDEX_PATH;
  const reportPath = options.reportPath || DEFAULT_REPORT_PATH;
  const config = readJson(quotaConfigPath);
  const index = readJson(indexPath);
  const report = readJson(reportPath);
  const configValidation = validateConfig(config, report, index);
  const quota = extractQuota(report, index);
  const cells = Array.isArray(quota?.cells) ? quota.cells : [];
  const thresholds = makeThresholds(config);
  const profiles = index.profiles && typeof index.profiles === 'object' ? index.profiles : {};
  return {
    snapshotVersion: 'molan-character-material-quota-contract-v3.1-stage0',
    configVersion: String(config.version || ''),
    inputs: {
      quotaConfig: { path: quotaConfigPath, sha256: sha256File(quotaConfigPath), bytes: fs.statSync(quotaConfigPath).size },
      index: {
        path: indexPath,
        sha256: sha256File(indexPath),
        bytes: fs.statSync(indexPath).size,
        version: index.version || null,
        rootKeys: objectKeys(index)
      },
      report: {
        path: reportPath,
        sha256: sha256File(reportPath),
        bytes: fs.statSync(reportPath).size,
        version: report.version || null,
        sourceHash: report.sourceHash || null
      }
    },
    thresholds,
    rawGenres: Array.isArray(config.rawGenres) ? [...config.rawGenres] : [],
    archetypes: Array.isArray(config.archetypes) ? [...config.archetypes] : [],
    genreBuckets: config.genreBuckets || {},
    expected: {
      archetypeCount: configValidation.archetypeCount,
      bucketCount: configValidation.bucketCount,
      cellCount: configValidation.expectedCellCount,
      actualReportCellCount: cells.length,
      profileCount: Object.keys(profiles).length
    },
    policies: {
      counting: config.counting || {},
      platformCoverage: config.platformCoverage || {},
      focusSlices: config.focusSlices || [],
      acceptance: config.acceptancePolicy || {},
      authorization: config.authorizationPolicy || {}
    },
    observed: {
      quotaReportAvailable: Boolean(quota),
      profileReleasePass: report.profileRelease?.pass === true,
      publicationGatePass: report.publicationGate?.pass === true,
      totalUniqueChars: finiteNumber(quota?.totalUniqueChars),
      hardFloorCellCount: Array.isArray(quota?.hardFloorCells) ? quota.hardFloorCells.length : 0,
      perBookCapViolationCount: Array.isArray(quota?.perBookCapViolations) ? quota.perBookCapViolations.length : 0,
      platformCoveragePass: quota?.platformCoverage?.pass === true
    },
    validation: configValidation,
    pass: configValidation.pass
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/export-quota-contract.mjs [--validate] [--write] [--quota-config path] [--index path] [--report path] [--out path]');
    return 0;
  }
  const paths = {
    quotaConfigPath: resolvePath(options['quota-config'], DEFAULT_QUOTA_CONFIG_PATH),
    indexPath: resolvePath(options.index, DEFAULT_INDEX_PATH),
    reportPath: resolvePath(options.report, DEFAULT_REPORT_PATH)
  };
  let contract;
  try {
    contract = buildQuotaContract(paths);
  } catch (error) {
    console.error(JSON.stringify({ pass: false, errors: [error.message] }, null, 2));
    return 1;
  }
  const shouldWrite = options.write === true || options.validate !== true;
  if (shouldWrite) {
    const outputPath = resolvePath(options.out || options.output, DEFAULT_OUTPUT_PATH);
    writeJson(outputPath, contract);
    contract.outputs = { quota: outputPath };
  }
  console.log(JSON.stringify({
    pass: contract.pass,
    errors: contract.validation.errors,
    outputs: contract.outputs || null,
    thresholds: contract.thresholds,
    expected: contract.expected,
    observed: contract.observed
  }, null, 2));
  return contract.pass ? 0 : 1;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  process.exitCode = main();
}

export { DEFAULT_QUOTA_CONFIG_PATH, DEFAULT_INDEX_PATH, DEFAULT_REPORT_PATH, DEFAULT_OUTPUT_PATH, extractQuota, makeThresholds, parseArgs };
