import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_INDEX_PATH = path.join(REPO_ROOT, 'lib', 'character-material', 'index.json');
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'lib', 'character-material', 'quality-report.json');
const DEFAULT_RUNTIME_SOURCE_PATH = path.join(REPO_ROOT, 'lib', 'character-material.js');
const DEFAULT_CONTRACT_DIR = path.join(REPO_ROOT, 'data', 'character-material-v3.1', 'contracts');
const DEFAULT_OUTPUT_PATH = path.join(DEFAULT_CONTRACT_DIR, 'runtime-contract.snapshot.json');
const DEFAULT_SCHEMA_OUTPUT_PATH = path.join(DEFAULT_CONTRACT_DIR, 'schema-contract.snapshot.json');

const requireFromScript = createRequire(SCRIPT_PATH);
const runtimeModule = requireFromScript(DEFAULT_RUNTIME_SOURCE_PATH);

const LEGACY_ROOT_KEYS = [
  'version',
  'published',
  'markdownPublished',
  'sourceHash',
  'general',
  'mature',
  'profiles',
  'profilesPublished',
  'profileFallback',
  'profileFocusSlices',
  'profileGenreMap',
  'audit'
];

const LEGACY_BUCKET_KEYS = ['rules', 'samples'];
const LEGACY_RULE_KEYS = ['id', 'archetype', 'dimension', 'rule', 'application', 'caution', 'scenes', 'signals', 'score'];
const LEGACY_SAMPLE_KEYS = [
  'id',
  'archetype',
  'dimension',
  'corpus',
  'text',
  'sourceHash',
  'canonicalWorkId',
  'sourceWorkId',
  'sourceNovelId',
  'platform',
  'audience',
  'genre',
  'rawGenres',
  'primaryGenre',
  'genreBucket',
  'signals',
  'forbiddenTerms',
  'residualTerms',
  'score'
];

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

function ownKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
}

function countBucket(index, bucketName, key) {
  return Array.isArray(index?.[bucketName]?.[key]) ? index[bucketName][key].length : 0;
}

function makeProbeIndex() {
  const longText = '她'.repeat(200);
  const samples = [
    { id: 'short', archetype: '冷静理智型', dimension: 'psychology', text: '她'.repeat(11), sourceHash: 'probe-short', sourceWorkId: 'probe-short' },
    { id: 'long', archetype: '冷静理智型', dimension: 'psychology', text: longText, sourceHash: 'probe-long', sourceWorkId: 'probe-long' },
    { id: 'one', archetype: '冷静理智型', dimension: 'psychology', text: '她先看向门口，再把杯子移到手边。', sourceHash: 'probe-one', sourceWorkId: 'probe-one' },
    { id: 'two', archetype: '冷静理智型', dimension: 'psychology', text: '她核对时间后才拿起手机，动作没有催促。', sourceHash: 'probe-two', sourceWorkId: 'probe-two' },
    { id: 'three', archetype: '冷静理智型', dimension: 'psychology', text: '她把证据按顺序排好，抬头等对方解释。', sourceHash: 'probe-three', sourceWorkId: 'probe-three' },
    { id: 'four', archetype: '冷静理智型', dimension: 'psychology', text: '她没有立刻回答，只把窗缝又检查了一遍。', sourceHash: 'probe-four', sourceWorkId: 'probe-four' }
  ];
  return {
    version: 'runtime-contract-probe',
    published: true,
    general: {
      rules: [{ id: 'probe-rule', archetype: '冷静理智型', dimension: 'psychology', rule: '先核对证据，再决定动作。' }],
      samples
    },
    mature: { rules: [], samples: [] },
    audit: { strongSamplesPublished: true }
  };
}

function probeRuntime(runtime = runtimeModule) {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-v31-runtime-contract-'));
  const indexPath = path.join(probeDir, 'index.json');
  try {
    fs.writeFileSync(indexPath, JSON.stringify(makeProbeIndex()), 'utf8');
    runtime.resetCharacterMaterialIndexCache();
    const loaded = runtime.loadCharacterMaterialIndex({ indexPath });
    const longSample = loaded.general.samples.find(item => item.id === 'long');
    const shortSample = loaded.general.samples.find(item => item.id === 'short');
    const retrieval = runtime.retrieveCharacterMaterial({}, {
      mode: 'strong',
      archetypes: ['冷静理智型'],
      dimensions: ['psychology'],
      proseTask: true
    }, { index: loaded });
    return {
      normalizedLongLength: longSample ? longSample.text.length : 0,
      shortSampleAccepted: Boolean(shortSample),
      strongSampleCount: retrieval.samples.length,
      loadedRootKeys: ownKeys(loaded),
      loadedRuleKeys: ownKeys(loaded.general.rules[0]),
      loadedSampleKeys: ownKeys(loaded.general.samples[0])
    };
  } finally {
    runtime.resetCharacterMaterialIndexCache();
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

function makeSchemaContract(probe) {
  const normalizedRuleKeys = probe.loadedRuleKeys.length ? probe.loadedRuleKeys : LEGACY_RULE_KEYS;
  const normalizedSampleKeys = probe.loadedSampleKeys.length ? probe.loadedSampleKeys : LEGACY_SAMPLE_KEYS;
  const richMetadataFields = ['scene', 'scenes', 'relationship', 'relationships', 'emotionalState', 'emotionalStates', 'intent', 'surfaceIntent', 'subtext', 'humanTextureSignals', 'microPattern', 'microPatterns', 'antiPattern', 'antiPatterns', 'authorHash'];
  return {
    schemaVersion: 'molan-character-material-runtime-schema-v3.1-stage0',
    compatibility: {
      input: 'legacy-compatible character-material index',
      loader: 'loadCharacterMaterialIndex',
      normalization: 'normalizeCharacterMaterialIndex is applied inside the loader',
      supportedRichMetadata: richMetadataFields.filter(field => normalizedRuleKeys.includes(field) || normalizedSampleKeys.includes(field)),
      offlineOnlyFields: ['rawText', 'safeText', 'auditText', 'archetypeDistribution', 'stateArchetype', 'evidence']
    },
    root: {
      requiredKeys: ['general', 'mature'],
      optionalKeys: LEGACY_ROOT_KEYS.filter(key => !['general', 'mature'].includes(key)),
      normalizedKeys: probe.loadedRootKeys,
      ignoredInputKeys: ['rawGenreProfiles', 'aggregateRawGenreProfiles', 'rawGenreCoverage']
    },
    bucket: {
      requiredKeys: LEGACY_BUCKET_KEYS,
      fieldTypes: { rules: 'array', samples: 'array' }
    },
    rule: {
      requiredKeys: ['id', 'dimension', 'rule'],
      normalizedKeys: normalizedRuleKeys,
      fields: normalizedRuleKeys,
      legacyFields: LEGACY_RULE_KEYS
    },
    sample: {
      requiredKeys: ['id', 'dimension', 'text'],
      normalizedKeys: normalizedSampleKeys,
      fields: normalizedSampleKeys,
      legacyFields: LEGACY_SAMPLE_KEYS,
      text: { minChars: 12, maxChars: 140, measuredAs: 'JavaScript String.length after runtime normalization' },
      safety: { residualTerms: 'must be an empty array', sourceText: 'rawText/auditText are offline-only and not runtime fields' }
    },
    runtimeLimits: { sampleMinChars: 12, sampleMaxChars: 140, strongSampleMax: 2 }
  };
}

export function buildRuntimeContract(options = {}) {
  const indexPath = options.indexPath || DEFAULT_INDEX_PATH;
  const reportPath = options.reportPath || DEFAULT_REPORT_PATH;
  const runtimeSourcePath = options.runtimeSourcePath || DEFAULT_RUNTIME_SOURCE_PATH;
  const errors = [];
  let rawIndex;
  let report;
  let loaded;
  let probe;
  let runtime = runtimeModule;
  try {
    rawIndex = readJson(indexPath);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    report = readJson(reportPath);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    if (path.resolve(runtimeSourcePath) !== path.resolve(DEFAULT_RUNTIME_SOURCE_PATH)) {
      runtime = requireFromScript(runtimeSourcePath);
    }
    runtime.resetCharacterMaterialIndexCache();
    loaded = runtime.loadCharacterMaterialIndex({ indexPath });
  } catch (error) {
    errors.push(`运行时加载失败：${error.message}`);
  }
  try {
    probe = probeRuntime(runtime);
  } catch (error) {
    errors.push(`运行时 probe 失败：${error.message}`);
  }

  if (!runtime || typeof runtime.loadCharacterMaterialIndex !== 'function') {
    errors.push('character-material.js 未暴露 loadCharacterMaterialIndex');
  }
  if (!runtime || typeof runtime.retrieveCharacterMaterial !== 'function') {
    errors.push('character-material.js 未暴露 retrieveCharacterMaterial');
  }
  if (rawIndex && (!rawIndex.general || !rawIndex.mature)) errors.push('旧 index 缺少 general 或 mature bucket');
  // 旧 raw 兼容索引与新版重建报告可以并存；正式发布索引仍由 validate-index 严格绑定版本和 sourceHash。
  const legacyRawIndex = String(rawIndex?.version || '').includes('-raw-');
  if (!legacyRawIndex && report && rawIndex && report.version && rawIndex.version && String(report.version) !== String(rawIndex.version)) {
    errors.push(`index/report version 不一致：${rawIndex.version} != ${report.version}`);
  }
  if (probe) {
    if (probe.normalizedLongLength !== 140) errors.push(`运行时最大样本长度 probe 结果异常：${probe.normalizedLongLength}`);
    if (probe.shortSampleAccepted) errors.push('运行时接受了少于 12 字的样本');
    if (probe.strongSampleCount > 2) errors.push(`运行时 strong 样本超过 2 条：${probe.strongSampleCount}`);
  }
  if (loaded && (!Array.isArray(loaded.general?.rules) || !Array.isArray(loaded.general?.samples))) {
    errors.push('旧 index 无法归一化为 general.rules/general.samples 数组');
  }

  const schema = makeSchemaContract(probe || { loadedRootKeys: [], loadedRuleKeys: [], loadedSampleKeys: [] });
  const input = {
    runtimeSource: { path: runtimeSourcePath, sha256: sha256File(runtimeSourcePath), bytes: fs.statSync(runtimeSourcePath).size },
    index: {
      path: indexPath,
      sha256: sha256File(indexPath),
      bytes: fs.statSync(indexPath).size,
      version: rawIndex?.version || null,
      rootKeys: ownKeys(rawIndex),
      generalRuleCount: countBucket(rawIndex, 'general', 'rules'),
      generalSampleCount: countBucket(rawIndex, 'general', 'samples'),
      matureRuleCount: countBucket(rawIndex, 'mature', 'rules'),
      matureSampleCount: countBucket(rawIndex, 'mature', 'samples')
    },
    report: {
      path: reportPath,
      sha256: sha256File(reportPath),
      bytes: fs.statSync(reportPath).size,
      version: report?.version || null,
      sourceHash: report?.sourceHash || null
    }
  };
  const normalized = loaded ? {
    version: loaded.version,
    published: loaded.published,
    rootKeys: ownKeys(loaded),
    generalRuleCount: loaded.general.rules.length,
    generalSampleCount: loaded.general.samples.length,
    matureRuleCount: loaded.mature.rules.length,
    matureSampleCount: loaded.mature.samples.length,
    profilesPublished: loaded.profilesPublished
  } : null;

  return {
    snapshotVersion: 'molan-character-material-runtime-contract-v3.1-stage0',
    contract: {
      sampleMinChars: 12,
      sampleMaxChars: 140,
      strongSampleMax: 2,
      normalizeFunction: 'normalizeCharacterMaterialIndex',
      loadFunction: 'loadCharacterMaterialIndex',
      retrievalFunction: 'retrieveCharacterMaterial'
    },
    moduleExports: Object.keys(runtime || {}).sort(),
    input,
    normalized,
    probe: probe || null,
    schema,
    pass: errors.length === 0,
    errors
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/export-runtime-contract.mjs [--validate] [--write] [--index path] [--report path] [--out path] [--schema-out path]');
    return 0;
  }
  const indexPath = resolvePath(options.index, DEFAULT_INDEX_PATH);
  const reportPath = resolvePath(options.report, DEFAULT_REPORT_PATH);
  const runtimeSourcePath = resolvePath(options['runtime-source'], DEFAULT_RUNTIME_SOURCE_PATH);
  let contract;
  try {
    contract = buildRuntimeContract({ indexPath, reportPath, runtimeSourcePath });
  } catch (error) {
    console.error(JSON.stringify({ pass: false, errors: [error.message] }, null, 2));
    return 1;
  }
  const shouldWrite = options.write === true || options.validate !== true;
  if (shouldWrite) {
    const outputPath = resolvePath(options.out || options.output, DEFAULT_OUTPUT_PATH);
    const schemaOutputPath = resolvePath(options['schema-out'], DEFAULT_SCHEMA_OUTPUT_PATH);
    writeJson(outputPath, contract);
    writeJson(schemaOutputPath, contract.schema);
    contract.outputs = { runtime: outputPath, schema: schemaOutputPath };
  }
  console.log(JSON.stringify({
    pass: contract.pass,
    errors: contract.errors,
    outputs: contract.outputs || null,
    normalized: contract.normalized
  }, null, 2));
  return contract.pass ? 0 : 1;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  process.exitCode = main();
}

export { DEFAULT_INDEX_PATH, DEFAULT_REPORT_PATH, DEFAULT_OUTPUT_PATH, DEFAULT_SCHEMA_OUTPUT_PATH, makeSchemaContract, parseArgs };
