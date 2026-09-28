import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildProfiles,
  buildQuotaReport,
  buildRuntimeIndex,
  qualityStatusForQuota,
  selectRuntimeSamples,
} from './rebuild-character-material-from-original.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_ROOT = path.join(REPO_ROOT, 'data', 'character-material-v3.1-rebuild');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(argv = []) {
  const options = { root: DEFAULT_ROOT, publishRuntime: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') options.root = path.resolve(argv[++index] || DEFAULT_ROOT);
    else if (arg === '--publish-runtime') options.publishRuntime = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

export function rebuildRuntimeIndexFromRich(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const configPath = path.join(REPO_ROOT, '..', '资源库', 'quota-config.json');
  const config = readJson(options.quotaConfig || configPath);
  const rich = readJson(path.join(root, 'rich-intermediate.json'));
  const manifest = readJson(path.join(root, 'source-manifest.json'));
  const records = Array.isArray(rich.records) ? rich.records : [];
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  const selected = selectRuntimeSamples(records, config);
  const profiles = buildProfiles(selected.samples);
  const quotaReport = buildQuotaReport(selected.samples, selected.cells, config);
  const qualityStatus = qualityStatusForQuota(quotaReport);
  const runtimeIndex = buildRuntimeIndex({
    samples: selected.samples,
    sources,
    selected: {
      candidateCount: rich.summary?.candidateCount || records.length,
      richRecordCount: rich.summary?.richRecordCount || records.length,
      overlapRejectedCount: selected.rejected.filter(item => /overlap|duplicate/u.test(item.reason)).length,
    },
    config,
    quotaReport,
    profiles,
  });
  const qualityPath = path.join(root, 'quality-report.json');
  const qualityReport = readJson(qualityPath);
  qualityReport.status = qualityStatus;
  qualityReport.statusLabel = qualityStatus === 'auto-complete-with-diagnostics' ? '带诊断缺口完成' : '自动完成';
  qualityReport.sourceHash = runtimeIndex.sourceHash;
  qualityReport.quota = quotaReport;
  qualityReport.safety = {
    ...(qualityReport.safety || {}),
    rawTextStoredOnlyInResearchIntermediate: true,
    safeRecordCount: records.length,
    residualRecordCount: records.filter(record => record.safety?.residualTerms?.length).length,
    twelveCharacterGate: true,
    overlapRejectedCount: selected.rejected.filter(item => /overlap|duplicate/u.test(item.reason)).length,
  };
  qualityReport.runtime = {
    version: runtimeIndex.version,
    published: true,
    generalSamples: runtimeIndex.general.samples.length,
    matureSamples: runtimeIndex.mature.samples.length,
    ruleCount: runtimeIndex.general.rules.length,
    profiles: Object.keys(runtimeIndex.profiles).length,
    profilesReliable: Object.values(runtimeIndex.profiles).filter(profile => profile.reliable).length,
  };
  writeJson(path.join(root, 'runtime-index.json'), runtimeIndex);
  writeJson(qualityPath, qualityReport);
  const audit = {
    schemaVersion: 'character-material-runtime-rebuild-audit-1',
    status: 'completed',
    source: 'rich-intermediate.json',
    sourcePolicy: 'original-local-corpus-only',
    legacyInputsUsed: false,
    richRecordCount: records.length,
    runtimeSampleCount: selected.samples.length,
    rejectedCount: selected.rejected.length,
    overlapRejectedCount: selected.rejected.filter(item => /overlap|duplicate/u.test(item.reason)).length,
    quota: quotaReport,
  };
  writeJson(path.join(root, 'runtime-rebuild-audit.json'), audit);
  if (options.publishRuntime === true) {
    const runtimePath = path.join(REPO_ROOT, 'lib', 'character-material', 'index.json');
    const reportPath = path.join(REPO_ROOT, 'lib', 'character-material', 'quality-report.json');
    fs.copyFileSync(path.join(root, 'runtime-index.json'), runtimePath);
    fs.copyFileSync(qualityPath, reportPath);
  }
  return { root, runtimeIndex, qualityReport, audit };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/rebuild-runtime-index-from-rich.mjs [--root path] [--publish-runtime]');
  } else {
    try {
      const result = rebuildRuntimeIndexFromRich(options);
      console.log(JSON.stringify({
        status: result.audit.status,
        runtimeSampleCount: result.audit.runtimeSampleCount,
        generalSampleCount: result.runtimeIndex.general.samples.length,
        matureSampleCount: result.runtimeIndex.mature.samples.length,
        publishedRuntime: options.publishRuntime === true,
      }, null, 2));
    } catch (error) {
      console.error(error?.stack || error);
      process.exitCode = 1;
    }
  }
}
