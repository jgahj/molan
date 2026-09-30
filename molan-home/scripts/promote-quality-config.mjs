import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validatePromotion, compareQualityVectors } = require('../lib/evolution/quality-vector-ab.js');

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new TypeError(`${name} 必须指定文件路径`);
  return value;
}

function readJson(filename) {
  const resolved = path.resolve(filename);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError(`必须指定普通文件：${resolved}`);
  const content = fs.readFileSync(resolved, 'utf8');
  return { path: resolved, content, value: JSON.parse(content), mode: stat.mode & 0o777 };
}

function hash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function atomicReplace(file, content, mode) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } catch (failure) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw failure;
  }
}

function main() {
  const reportPath = option('--report');
  const candidatePath = option('--candidate-config');
  if (!reportPath || !candidatePath) {
    throw new TypeError('用法：node scripts/promote-quality-config.mjs --report <report.json> --candidate-config <candidate.json>');
  }
  const reportFile = readJson(reportPath);
  const candidateFile = readJson(candidatePath);
  if (reportFile.path.toLowerCase() === candidateFile.path.toLowerCase()) {
    throw new TypeError('评测报告与候选配置必须是不同文件');
  }

  const receipt = validatePromotion(reportFile.value, candidateFile.value);
  const inputPath = option('--input');
  const artifactRoot = option('--artifacts');
  if (!inputPath || !artifactRoot) receipt.blockingReasons.push('promotion_source_evidence_required');
  else {
    const recomputed = compareQualityVectors(readJson(inputPath).value, { artifactRoot: path.resolve(artifactRoot) });
    if (recomputed.status !== 'PROMOTION_READY' || recomputed.reportHash !== reportFile.value.reportHash) receipt.blockingReasons.push('promotion_source_report_mismatch');
  }
  if (receipt.blockingReasons.length) { receipt.status = 'BLOCKED'; receipt.accepted = false; }
  if (receipt.status !== 'PASS') {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    process.exitCode = receipt.status === 'REJECTED' ? 1 : 2;
    return;
  }

  const prior = candidateFile.value.promotion;
  if (prior) {
    if (prior.status === 'PROMOTED' && prior.qualityReportHash === receipt.reportHash) {
      process.stdout.write(`${JSON.stringify({ ...receipt, status: 'ALREADY_PROMOTED' }, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify({ ...receipt, status: 'BLOCKED', accepted: false, blockingReasons: ['candidate_already_promoted'] }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }

  if (hash(fs.readFileSync(candidateFile.path, 'utf8')) !== hash(candidateFile.content)) {
    throw Object.assign(new Error('候选配置在校验期间发生变化，拒绝覆盖'), { code: 'CANDIDATE_CONFIG_CHANGED' });
  }
  const promotedConfig = {
    ...candidateFile.value,
    promotion: {
      schemaVersion: 'quality-config-promotion-v1',
      status: 'PROMOTED',
      promotedAt: new Date().toISOString(),
      qualityReportHash: receipt.reportHash,
      inputHash: receipt.inputHash,
      candidateVersions: receipt.candidateVersions
    }
  };
  atomicReplace(candidateFile.path, `${JSON.stringify(promotedConfig, null, 2)}\n`, candidateFile.mode);
  process.stdout.write(`${JSON.stringify({ ...receipt, status: 'PROMOTED' }, null, 2)}\n`);
}

try { main(); }
catch (failure) {
  process.stderr.write(`${failure && failure.message || failure}\n`);
  process.exitCode = 1;
}
