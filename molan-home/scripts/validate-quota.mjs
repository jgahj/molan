import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_INDEX_PATH,
  DEFAULT_QUOTA_CONFIG_PATH,
  DEFAULT_REPORT_PATH,
  extractQuota,
  makeThresholds,
  parseArgs
} from './export-quota-contract.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'character-material-v3.1', 'contracts', 'quota.validation.json');

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

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cellKey(archetype, bucket) {
  return `${archetype}|${bucket}`;
}

function cellChars(cell) {
  if (Object.prototype.hasOwnProperty.call(cell || {}, 'effectiveChars')) return finiteNumber(cell.effectiveChars);
  return finiteNumber(cell?.chars);
}

function validateConfigShape(config) {
  const errors = [];
  const archetypes = Array.isArray(config?.archetypes) ? config.archetypes : [];
  const buckets = config?.genreBuckets && typeof config.genreBuckets === 'object' && !Array.isArray(config.genreBuckets)
    ? Object.keys(config.genreBuckets)
    : [];
  const hardFloor = finiteNumber(config?.cellHardFloor);
  const target = finiteNumber(config?.cellMinChars);
  const capPct = finiteNumber(config?.perBookCellCapPct);
  if (!String(config?.version || '').trim()) errors.push('quota-config 缺少 version');
  if (archetypes.length !== 10) errors.push(`quota-config.archetypes 应为 10 类，实际为 ${archetypes.length}`);
  if (buckets.length !== 4) errors.push(`quota-config.genreBuckets 应为 4 桶，实际为 ${buckets.length}`);
  if (hardFloor === null || target === null || hardFloor <= 0 || target < hardFloor) errors.push('quota-config hard floor/target 无效');
  if (capPct === null || capPct <= 0 || capPct > 1) errors.push('quota-config perBookCellCapPct 无效');
  return errors;
}

function normalizePlatformRows(value) {
  if (Array.isArray(value)) {
    return value.map(item => ({
      platform: String(item?.platform || '').trim(),
      charCount: finiteNumber(item?.charCount ?? item?.chars),
      sampleCount: finiteNumber(item?.sampleCount),
      sourceWorkCount: finiteNumber(item?.sourceWorkCount),
      charShare: finiteNumber(item?.charShare)
    }));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([platform, item]) => ({
      platform,
      charCount: finiteNumber(item?.charCount ?? item?.chars ?? item),
      sampleCount: finiteNumber(item?.sampleCount),
      sourceWorkCount: finiteNumber(item?.sourceWorkCount ?? item?.works),
      charShare: finiteNumber(item?.charShare)
    }));
  }
  return [];
}

function validateCells(quota, config, thresholds) {
  const errors = [];
  const archetypes = Array.isArray(config.archetypes) ? config.archetypes : [];
  const buckets = config.genreBuckets && typeof config.genreBuckets === 'object' ? Object.keys(config.genreBuckets) : [];
  const expectedKeys = archetypes.flatMap(archetype => buckets.map(bucket => cellKey(archetype, bucket)));
  const cells = Array.isArray(quota?.cells) ? quota.cells : [];
  const seen = new Set();
  const missing = [];
  const unexpected = [];
  const hardFloorFailures = [];
  const perBookViolations = [];
  const perBookMissing = [];
  const malformed = [];
  for (const cell of cells) {
    const key = cellKey(String(cell?.archetype || ''), String(cell?.bucket || ''));
    if (seen.has(key)) errors.push(`quota cells 存在重复格：${key}`);
    seen.add(key);
  }
  for (const key of expectedKeys) {
    const cell = cells.find(item => cellKey(String(item?.archetype || ''), String(item?.bucket || '')) === key);
    if (!cell) {
      missing.push(key);
      continue;
    }
    const chars = cellChars(cell);
    if (chars === null) {
      malformed.push({ key, reason: 'missing effectiveChars/chars' });
    } else if (chars < thresholds.cellHardFloor) {
      hardFloorFailures.push({ key, chars, hardFloor: thresholds.cellHardFloor });
    }
    const observedCap = finiteNumber(cell.perBookCapChars);
    if (observedCap !== null && observedCap > thresholds.perBookCapChars) {
      errors.push(`单书上限高于 15%：${key}=${observedCap} > ${thresholds.perBookCapChars}`);
    }
    const perBook = cell.perBookEffectiveChars ?? cell.byBook;
    if (!perBook || typeof perBook !== 'object' || Array.isArray(perBook)) {
      perBookMissing.push(key);
      continue;
    }
    for (const [sourceWork, value] of Object.entries(perBook)) {
      const charsForBook = finiteNumber(value);
      if (charsForBook === null) {
        malformed.push({ key, sourceWork, reason: 'invalid per-book char count' });
      } else if (charsForBook > thresholds.perBookCapChars) {
        perBookViolations.push({ key, sourceWork, chars: charsForBook, capChars: thresholds.perBookCapChars });
      }
    }
  }
  for (const key of seen) if (!expectedKeys.includes(key)) unexpected.push(key);
  if (missing.length) errors.push(`quota cells 缺失：${missing.length}`);
  if (unexpected.length) errors.push(`quota cells 存在非配置格：${unexpected.length}`);
  if (hardFloorFailures.length) errors.push(`quota hard floor 未满足：${hardFloorFailures.length}`);
  if (perBookMissing.length) errors.push(`缺少单书字数明细：${perBookMissing.length}`);
  if (perBookViolations.length) errors.push(`单书 15% 上限超限：${perBookViolations.length}`);
  if (malformed.length) errors.push(`quota cell 数据格式异常：${malformed.length}`);
  if (Array.isArray(quota?.perBookCapViolations) && quota.perBookCapViolations.length) {
    errors.push(`report 已记录单书超限：${quota.perBookCapViolations.length}`);
  }
  return {
    pass: errors.length === 0,
    errors,
    expectedCellCount: expectedKeys.length,
    actualCellCount: cells.length,
    missing,
    unexpected,
    hardFloorFailures,
    perBookMissing,
    perBookViolations,
    malformed,
    expectedPerBookCapChars: thresholds.perBookCapChars
  };
}

function validatePlatformChars(quota, config, thresholds) {
  const errors = [];
  const platformConfig = config.platformCoverage && typeof config.platformCoverage === 'object'
    ? config.platformCoverage
    : {};
  const enforced = platformConfig.enforce === true && platformConfig.reportOnlyUntilEvidence !== true;
  const coverage = quota?.platformCoverage;
  if (!coverage || typeof coverage !== 'object') {
    return {
      pass: !enforced,
      enforced,
      errors: enforced ? ['缺少 quota.platformCoverage，无法验证平台字数份额'] : [],
      overall: null,
      focusSlices: []
    };
  }
  const overall = coverage.overall && typeof coverage.overall === 'object' ? coverage.overall : coverage;
  const totalChars = finiteNumber(overall.charCount);
  const platforms = normalizePlatformRows(overall.platforms || overall.byPlatform || overall.platformChars);
  if (totalChars === null) errors.push('平台覆盖缺少 overall.charCount');
  const platformCharTotal = platforms.reduce((sum, item) => sum + (item.charCount || 0), 0);
  if (totalChars !== null && Math.abs(platformCharTotal - totalChars) > 1) {
    errors.push(`平台 charCount 汇总不等于 overall.charCount：${platformCharTotal} != ${totalChars}`);
  }
  const invalidRows = platforms.filter(item => !item.platform || item.charCount === null || item.charCount < 0);
  if (invalidRows.length) errors.push(`平台字数明细异常：${invalidRows.length}`);
  const computedMaxShare = totalChars > 0
    ? Math.max(0, ...platforms.map(item => (item.charCount || 0) / totalChars))
    : 0;
  const reportedMaxShare = finiteNumber(overall.maxSinglePlatformShare);
  const maxShare = computedMaxShare;
  if (enforced && (totalChars === null || totalChars <= 0)) errors.push('平台 overall.charCount 必须为正数');
  if (reportedMaxShare !== null && Math.abs(reportedMaxShare - computedMaxShare) > 0.0001) {
    errors.push(`报告单平台份额与 charCount 计算不一致：${reportedMaxShare} != ${computedMaxShare}`);
  }
  for (const platform of platforms) {
    if (totalChars > 0 && platform.charShare !== null) {
      const expectedShare = platform.charCount / totalChars;
      if (Math.abs(platform.charShare - expectedShare) > 0.0001) {
        errors.push(`平台 ${platform.platform || 'unknown'} charShare 与 charCount 不一致`);
      }
    }
  }
  if (thresholds.maxSinglePlatformShare !== null && maxShare > thresholds.maxSinglePlatformShare + 0.0001) {
    errors.push(`单平台字数份额超过上限：${maxShare} > ${thresholds.maxSinglePlatformShare}`);
  }
  if (enforced && coverage.maxSinglePlatformPass === false) errors.push('quota.platformCoverage.maxSinglePlatformPass 为 false');
  if (enforced && coverage.enforced !== true) errors.push('quota report 未标记 platform coverage enforced');
  const configuredSlices = Array.isArray(config.focusSlices) ? config.focusSlices : [];
  const reportedSlices = Array.isArray(coverage.focusSlices) ? coverage.focusSlices : [];
  const focusSlices = [];
  for (const configured of configuredSlices) {
    const slice = reportedSlices.find(item => item.id === configured.id || item.runtimeKey === configured.runtimeKey);
    if (!slice) {
      if (enforced && configured.gate === 'enforce') errors.push(`缺少 focus slice 平台字数报告：${configured.id || configured.runtimeKey}`);
      continue;
    }
    const sliceEnforced = enforced && configured.gate === 'enforce';
    const sliceChars = finiteNumber(slice.charCount);
    const minimumChars = finiteNumber(platformConfig.minimumFocusSliceChars) || 0;
    if (sliceEnforced && (sliceChars === null || sliceChars < minimumChars)) {
      errors.push(`focus slice 字数不足：${configured.id || configured.runtimeKey}`);
    }
    if (sliceEnforced && slice.pass !== true) errors.push(`focus slice 平台覆盖未通过：${configured.id || configured.runtimeKey}`);
    focusSlices.push({
      id: configured.id || configured.runtimeKey,
      charCount: sliceChars,
      requiredPlatforms: slice.requiredPlatforms || configured.platforms || platformConfig.requiredForFocusSlices || [],
      pass: slice.pass === true,
      reported: slice
    });
  }
  if (enforced && coverage.pass !== true) errors.push('quota.platformCoverage.pass 为 false');
  return {
    pass: errors.length === 0,
    enforced,
    errors,
    overall: {
      charCount: totalChars,
      platformCharTotal,
      platforms,
      maxSinglePlatformShare: maxShare,
      configuredMaxSinglePlatformShare: thresholds.maxSinglePlatformShare
    },
    focusSlices
  };
}

export function validateQuota(options = {}) {
  const quotaConfigPath = options.quotaConfigPath || DEFAULT_QUOTA_CONFIG_PATH;
  const indexPath = options.indexPath || DEFAULT_INDEX_PATH;
  const reportPath = options.reportPath || DEFAULT_REPORT_PATH;
  const errors = [];
  const warnings = [];
  let config;
  let index;
  let report;
  try {
    config = readJson(quotaConfigPath);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    index = readJson(indexPath);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    report = readJson(reportPath);
  } catch (error) {
    errors.push(error.message);
  }
  if (!config || !index || !report) {
    return {
      validationVersion: 'molan-character-material-quota-v3.1-stage0',
      pass: false,
      errors,
      warnings,
      inputs: { quotaConfigPath, indexPath, reportPath },
      checks: null
    };
  }
  errors.push(...validateConfigShape(config));
  const quota = extractQuota(report, index);
  if (!quota) errors.push('index/report 均缺少 quota report');
  const thresholds = makeThresholds(config);
  if (report.version && config.version && String(report.version) !== String(config.version)) errors.push('quality-report/config version 不一致');
  if (quota?.configVersion && config.version && String(quota.configVersion) !== String(config.version)) errors.push('quota report/config version 不一致');
  const cells = validateCells(quota, config, thresholds);
  const platformChars = validatePlatformChars(quota, config, thresholds);
  errors.push(...cells.errors);
  errors.push(...platformChars.errors);
  const pass = errors.length === 0 && cells.pass && platformChars.pass;
  return {
    validationVersion: 'molan-character-material-quota-v3.1-stage0',
    pass,
    errors: [...new Set(errors)],
    warnings,
    inputs: { quotaConfigPath, indexPath, reportPath },
    thresholds,
    checks: {
      cells,
      hardFloor: { pass: cells.hardFloorFailures.length === 0 && cells.missing.length === 0, failures: cells.hardFloorFailures, missing: cells.missing },
      perBook15Percent: {
        pass: cells.perBookViolations.length === 0 && cells.perBookMissing.length === 0 && cells.malformed.length === 0
          && !(Array.isArray(quota?.perBookCapViolations) && quota.perBookCapViolations.length),
        capChars: thresholds.perBookCapChars,
        violations: cells.perBookViolations,
        missing: cells.perBookMissing,
        reportViolations: quota?.perBookCapViolations || []
      },
      platformChars
    },
    observed: {
      reportProfileReleasePass: report.profileRelease?.pass === true,
      reportPublicationGatePass: report.publicationGate?.pass === true,
      reportQuotaPass: quota?.platformCoverage?.pass === true && (!Array.isArray(quota?.hardFloorCells) || quota.hardFloorCells.length === 0)
    }
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/validate-quota.mjs [--validate] [--write] [--quota-config path] [--index path] [--report path] [--out path]');
    return 0;
  }
  const result = validateQuota({
    quotaConfigPath: resolvePath(options['quota-config'], DEFAULT_QUOTA_CONFIG_PATH),
    indexPath: resolvePath(options.index, DEFAULT_INDEX_PATH),
    reportPath: resolvePath(options.report, DEFAULT_REPORT_PATH)
  });
  if (options.write === true) writeJson(resolvePath(options.out || options.output, DEFAULT_OUTPUT_PATH), result);
  console.log(JSON.stringify(result, null, 2));
  return result.pass ? 0 : 1;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  process.exitCode = main();
}

export { DEFAULT_OUTPUT_PATH, normalizePlatformRows, validateCells, validatePlatformChars };
