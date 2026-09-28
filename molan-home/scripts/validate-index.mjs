import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_INDEX_PATH, DEFAULT_REPORT_PATH } from './export-runtime-contract.mjs';
import { validateRuntimeCompatibility } from './validate-runtime-compat.mjs';
import { DEFAULT_QUOTA_CONFIG_PATH } from './export-quota-contract.mjs';
import { validateQuota } from './validate-quota.mjs';
import {
  DEFAULT_OUTPUT_PATH as DEFAULT_SAFETY_OUTPUT_PATH,
  validateMaterialSafety
} from './validate-material-safety.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'character-material-v3.1', 'contracts', 'index.validation.json');

function resolvePath(value, fallback) {
  return value ? path.resolve(process.cwd(), String(value)) : fallback;
}

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
    if (['help', 'write'].includes(key)) {
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 JSON：${filePath}；${error.message}`);
  }
}

export function validatePublicationState(options = {}) {
  const indexPath = options.indexPath || DEFAULT_INDEX_PATH;
  const reportPath = options.reportPath || DEFAULT_REPORT_PATH;
  const errors = [];
  let index = null;
  let report = null;
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

  const publishedFlags = {
    published: index?.published === true,
    markdownPublished: index?.markdownPublished === true,
    profilesPublished: index?.profilesPublished === true,
  };
  for (const [name, pass] of Object.entries(publishedFlags)) {
    if (!pass) errors.push(`index.${name} 必须为 true`);
  }

  const reportBinding = {
    version: Boolean(index?.version && report?.version && String(index.version) === String(report.version)),
    sourceHash: Boolean(index?.sourceHash && report?.sourceHash && String(index.sourceHash) === String(report.sourceHash)),
    publicationGate: report?.publicationGate?.pass === true,
    profileRelease: report?.profileRelease?.pass === true,
    strongSamplesPublished: report?.audit?.strongSamplesPublished === true,
    markdownPublished: report?.audit?.markdownPublished === true,
  };
  if (!reportBinding.version) errors.push('index/report version 发布绑定缺失或不一致');
  if (!reportBinding.sourceHash) errors.push('index/report sourceHash 发布绑定缺失或不一致');
  if (!reportBinding.publicationGate) errors.push('quality-report.publicationGate.pass 必须为 true');
  if (!reportBinding.profileRelease) errors.push('quality-report.profileRelease.pass 必须为 true');
  if (!reportBinding.strongSamplesPublished) errors.push('quality-report.audit.strongSamplesPublished 必须为 true');
  if (!reportBinding.markdownPublished) errors.push('quality-report.audit.markdownPublished 必须为 true');

  const pass = errors.length === 0;
  return {
    pass,
    errors: [...new Set(errors)],
    warnings: [],
    inputs: { indexPath, reportPath },
    checks: {
      publishedFlags,
      reportBinding,
    },
    observed: {
      indexVersion: index?.version || null,
      reportVersion: report?.version || null,
      indexSourceHash: index?.sourceHash || null,
      reportSourceHash: report?.sourceHash || null,
    },
  };
}

/** Combine the independent final gates without weakening any child result. */
export function combineValidationResults(results = {}) {
  const finalResults = Object.prototype.hasOwnProperty.call(results, 'publication')
    ? results
    : { ...results, publication: null };
  const gates = Object.fromEntries(Object.entries(finalResults).map(([name, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [name, { pass: false, errors: [`${name} validator did not return a result`], warnings: [] }];
    }
    if (typeof value.pass !== 'boolean' || !Array.isArray(value.errors) || !Array.isArray(value.warnings)) {
      return [name, { pass: false, errors: [`${name} validator returned malformed result`], warnings: [] }];
    }
    const status = String(value.status || '').trim().toLowerCase();
    if (value.pass === true && ['blocked', 'failed', 'failure', 'invalid', 'error', 'rejected'].includes(status)) {
      return [name, { pass: false, errors: [...value.errors, `${name} validator reported ${status} status`], warnings: value.warnings }];
    }
    return [name, { pass: value.pass, errors: value.errors, warnings: value.warnings }];
  }));
  const errors = [...new Set(Object.values(gates).flatMap(gate => gate.errors))];
  const warnings = [...new Set(Object.values(gates).flatMap(gate => gate.warnings))];
  const pass = Object.values(gates).every(gate => gate.pass);
  return {
    validationVersion: 'molan-character-material-index-validation-v3.1-2',
    pass,
    status: pass ? 'pass' : 'blocked',
    errors,
    warnings,
    gates
  };
}

export function validateIndex(options = {}) {
  const indexPath = options.indexPath || DEFAULT_INDEX_PATH;
  const reportPath = options.reportPath || DEFAULT_REPORT_PATH;
  const quotaConfigPath = options.quotaConfigPath || DEFAULT_QUOTA_CONFIG_PATH;
  const publication = validatePublicationState({ indexPath, reportPath });
  const results = {
    runtimeCompatibility: validateRuntimeCompatibility({ indexPath, reportPath }),
    materialSafety: validateMaterialSafety({ indexPath, reportPath }),
    quota: validateQuota({ indexPath, reportPath, quotaConfigPath }),
    publication
  };
  return {
    ...combineValidationResults(results),
    inputs: { indexPath, reportPath, quotaConfigPath },
    checks: {
      runtimeCompatibility: results.runtimeCompatibility.checks || null,
      materialSafety: results.materialSafety.checks || null,
      quota: results.quota.checks || null,
      publication: results.publication.checks || null
    }
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/validate-index.mjs [--index path] [--report path] [--quota-config path] [--write] [--out path]');
    return 0;
  }
  let result;
  try {
    result = validateIndex({
      indexPath: resolvePath(options.index, DEFAULT_INDEX_PATH),
      reportPath: resolvePath(options.report, DEFAULT_REPORT_PATH),
      quotaConfigPath: resolvePath(options['quota-config'], DEFAULT_QUOTA_CONFIG_PATH)
    });
  } catch (error) {
    result = {
      validationVersion: 'molan-character-material-index-validation-v3.1-2',
      pass: false,
      status: 'blocked',
      errors: [error.message],
      warnings: [],
      gates: {},
      inputs: {
        indexPath: resolvePath(options.index, DEFAULT_INDEX_PATH),
        reportPath: resolvePath(options.report, DEFAULT_REPORT_PATH),
        quotaConfigPath: resolvePath(options['quota-config'], DEFAULT_QUOTA_CONFIG_PATH)
      },
      checks: {}
    };
  }
  if (options.write === true) writeJson(resolvePath(options.out || options.output, DEFAULT_OUTPUT_PATH), result);
  console.log(JSON.stringify(result, null, 2));
  return result.pass ? 0 : 1;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  process.exitCode = main();
}

export {
  DEFAULT_INDEX_PATH,
  DEFAULT_REPORT_PATH,
  DEFAULT_QUOTA_CONFIG_PATH,
  DEFAULT_OUTPUT_PATH,
  parseArgs
};
