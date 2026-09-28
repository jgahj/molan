import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_INDEX_PATH,
  DEFAULT_REPORT_PATH,
  buildRuntimeContract,
  parseArgs
} from './export-runtime-contract.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'character-material-v3.1', 'contracts', 'runtime-compat.validation.json');
const requireFromScript = createRequire(SCRIPT_PATH);
const runtimeModule = requireFromScript(path.join(REPO_ROOT, 'lib', 'character-material.js'));

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

function allBucketRows(index, key) {
  return [
    ...(Array.isArray(index?.general?.[key]) ? index.general[key] : []),
    ...(Array.isArray(index?.mature?.[key]) ? index.mature[key] : [])
  ];
}

function validateLoadedSamples(loaded) {
  const rows = allBucketRows(loaded, 'samples');
  const invalidBounds = [];
  const residualRows = [];
  for (const sample of rows) {
    const length = String(sample.text || '').length;
    if (length < 12 || length > 140) invalidBounds.push({ id: sample.id, length });
    if (!Array.isArray(sample.residualTerms) || sample.residualTerms.length !== 0) {
      residualRows.push({ id: sample.id, residualTerms: sample.residualTerms || null });
    }
  }
  return { sampleCount: rows.length, invalidBounds, residualRows };
}

function validateStrongLimit(loaded) {
  const archetypes = Array.isArray(runtimeModule.CHARACTER_ARCHETYPES) ? runtimeModule.CHARACTER_ARCHETYPES : [''];
  const checks = [];
  for (const archetype of archetypes) {
    const retrieval = runtimeModule.retrieveCharacterMaterial({}, {
      mode: 'strong',
      archetypes: archetype ? [archetype] : [],
      dimensions: ['psychology'],
      proseTask: true
    }, { index: loaded });
    checks.push({ archetype, sampleCount: retrieval.samples.length });
  }
  return {
    maxObserved: checks.reduce((max, item) => Math.max(max, item.sampleCount), 0),
    checks
  };
}

export function validateRuntimeCompatibility(options = {}) {
  const indexPath = options.indexPath || DEFAULT_INDEX_PATH;
  const reportPath = options.reportPath || DEFAULT_REPORT_PATH;
  const errors = [];
  const warnings = [];
  let rawIndex = null;
  let report = null;
  let loaded = null;
  let contract = null;
  try {
    rawIndex = readJson(indexPath);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    report = readJson(reportPath);
  } catch (error) {
    warnings.push(error.message);
  }
  try {
    runtimeModule.resetCharacterMaterialIndexCache();
    loaded = runtimeModule.loadCharacterMaterialIndex({ indexPath });
  } catch (error) {
    errors.push(`旧 index load 失败：${error.message}`);
  }
  try {
    contract = buildRuntimeContract({ indexPath, reportPath });
    errors.push(...contract.errors);
  } catch (error) {
    errors.push(`runtime contract 构建失败：${error.message}`);
  }

  const shape = {
    root: Boolean(loaded && loaded.general && loaded.mature
      && Array.isArray(loaded.general.rules)
      && Array.isArray(loaded.general.samples)
      && Array.isArray(loaded.mature.rules)
      && Array.isArray(loaded.mature.samples)),
    ruleArrays: Boolean(loaded && Array.isArray(loaded.general?.rules) && Array.isArray(loaded.mature?.rules)),
    sampleArrays: Boolean(loaded && Array.isArray(loaded.general?.samples) && Array.isArray(loaded.mature?.samples))
  };
  if (!shape.root || !shape.ruleArrays || !shape.sampleArrays) errors.push('归一化后的旧 index 结构不完整');

  const sampleCheck = loaded ? validateLoadedSamples(loaded) : { sampleCount: 0, invalidBounds: [], residualRows: [] };
  if (sampleCheck.invalidBounds.length) errors.push(`运行时样本存在 12-140 字范围外记录：${sampleCheck.invalidBounds.length}`);
  if (sampleCheck.residualRows.length) errors.push(`运行时样本存在 residualTerms：${sampleCheck.residualRows.length}`);

  let strongCheck = { maxObserved: 0, checks: [] };
  if (loaded) {
    try {
      strongCheck = validateStrongLimit(loaded);
      if (strongCheck.maxObserved > 2) errors.push(`strong 样本上限失败：${strongCheck.maxObserved}`);
    } catch (error) {
      errors.push(`strong 检索 probe 失败：${error.message}`);
    }
  }

  // 兼容旧 raw 索引时，报告可能来自后续重建版本；发布校验仍由 validate-index 执行严格绑定。
  const legacyRawIndex = String(rawIndex?.version || '').includes('-raw-');
  if (!legacyRawIndex && report && rawIndex?.version && report.version && String(rawIndex.version) !== String(report.version)) {
    errors.push(`index/report version 不一致：${rawIndex.version} != ${report.version}`);
  }
  if (!legacyRawIndex && report && rawIndex?.sourceHash && report.sourceHash && String(rawIndex.sourceHash) !== String(report.sourceHash)) {
    errors.push('index/report sourceHash 不一致');
  }
  if (!report) warnings.push('未找到 quality-report.json；运行时本身可加载，但无法完成报告绑定检查');

  runtimeModule.resetCharacterMaterialIndexCache();
  return {
    validationVersion: 'molan-character-material-runtime-compat-v3.1-stage0',
    pass: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    inputs: { indexPath, reportPath },
    checks: {
      normalizedLoad: shape.root,
      sampleBounds: {
        pass: sampleCheck.invalidBounds.length === 0,
        sampleCount: sampleCheck.sampleCount,
        invalid: sampleCheck.invalidBounds
      },
      residualTerms: {
        pass: sampleCheck.residualRows.length === 0,
        invalid: sampleCheck.residualRows
      },
      strongSampleLimit: { pass: strongCheck.maxObserved <= 2, ...strongCheck },
      reportBinding: {
        pass: legacyRawIndex || !report || (!rawIndex?.version || !report.version || String(rawIndex.version) === String(report.version))
          && (!rawIndex?.sourceHash || !report.sourceHash || String(rawIndex.sourceHash) === String(report.sourceHash)),
        indexVersion: rawIndex?.version || null,
        reportVersion: report?.version || null,
        indexSourceHash: rawIndex?.sourceHash || null,
        reportSourceHash: report?.sourceHash || null
      },
      contract: contract ? { pass: contract.pass, snapshotVersion: contract.snapshotVersion } : null
    },
    normalized: loaded ? {
      version: loaded.version,
      published: loaded.published,
      generalRules: loaded.general.rules.length,
      generalSamples: loaded.general.samples.length,
      matureRules: loaded.mature.rules.length,
      matureSamples: loaded.mature.samples.length
    } : null
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/validate-runtime-compat.mjs [--validate] [--write] [--index path] [--report path] [--out path]');
    return 0;
  }
  const result = validateRuntimeCompatibility({
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

export { DEFAULT_OUTPUT_PATH };
