import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_RESOURCE_ROOT = path.resolve(REPO_ROOT, '..', '资源库');
const DEFAULT_PIPELINE_ROOT = path.join(REPO_ROOT, 'data', 'character-material-v3.1');
const DEFAULT_OUTPUT = path.join(DEFAULT_PIPELINE_ROOT, 'pipeline-state.json');

const PASS_STATUSES = new Set(['pass', 'passed', 'complete', 'completed', 'ready', 'published', 'released', 'clear', 'has_quarantine', 'scored']);
const PENDING_STATUSES = new Set(['pending', 'partial', 'running', 'ready_for_review', 'needs_review', 'unverified', 'proxy-only']);
const BLOCKED_STATUSES = new Set(['blocked', 'failed', 'failure', 'invalid', 'error', 'rejected']);

function freezeSpec(relativePath, options = {}) {
  return Object.freeze({
    path: relativePath,
    kind: options.kind || 'json',
    policy: options.policy || 'generic',
    producer: options.producer || null,
    defaultPath: options.defaultPath || null,
    aliases: Object.freeze(Array.isArray(options.aliases) ? [...options.aliases] : []),
    evaluationStage: options.evaluationStage || null,
    minRows: Number.isInteger(options.minRows) ? options.minRows : null
  });
}

function freezeStage(id, name, dependsOn, specs) {
  const artifactSpecs = Object.freeze(specs);
  return Object.freeze({
    id,
    name,
    dependsOn: Object.freeze([...dependsOn]),
    artifactSpecs,
    // Keep the original string list as a stable public interface for callers that
    // construct fixtures from PIPELINE_STAGES.
    artifacts: Object.freeze(artifactSpecs.map(spec => spec.path))
  });
}

const dataPath = (...parts) => path.join(DEFAULT_PIPELINE_ROOT, ...parts);
const resourcePath = (...parts) => path.join(DEFAULT_RESOURCE_ROOT, ...parts);

const STAGE_DEFINITIONS = [
  freezeStage('0', '环境冻结与契约', [], [
    freezeSpec('contracts/runtime-contract.snapshot.json', { producer: 'scripts/export-runtime-contract.mjs', defaultPath: dataPath('contracts', 'runtime-contract.snapshot.json') }),
    freezeSpec('contracts/quota-contract.snapshot.json', { producer: 'scripts/export-quota-contract.mjs', defaultPath: dataPath('contracts', 'quota-contract.snapshot.json') }),
    freezeSpec('contracts/schema-contract.snapshot.json', { producer: 'scripts/export-runtime-contract.mjs', defaultPath: dataPath('contracts', 'schema-contract.snapshot.json') })
  ]),
  freezeStage('0.5', '生成质量基线', ['0'], [
    freezeSpec('eval/stage-0.5/prompts.jsonl', {
      kind: 'jsonl',
      policy: 'prompt',
      producer: 'scripts/generation-eval.mjs',
      defaultPath: dataPath('eval', 'prompts.jsonl'),
      aliases: ['eval/prompts.jsonl'],
      evaluationStage: '0.5',
      minRows: 50
    }),
    freezeSpec('eval/stage-0.5/baseline.jsonl', {
      kind: 'jsonl',
      policy: 'generation-output',
      producer: 'scripts/generation-eval.mjs',
      defaultPath: dataPath('eval', 'baseline.jsonl'),
      aliases: ['eval/baseline.jsonl'],
      evaluationStage: '0.5',
      minRows: 50
    }),
    freezeSpec('eval/stage-0.5/material.jsonl', {
      kind: 'jsonl',
      policy: 'generation-output',
      producer: 'scripts/generation-eval.mjs',
      defaultPath: dataPath('eval', 'material.jsonl'),
      aliases: ['eval/material.jsonl'],
      evaluationStage: '0.5',
      minRows: 50
    }),
    freezeSpec('eval/stage-0.5/report.json', {
      policy: 'eval-report',
      producer: 'scripts/generation-eval.mjs',
      defaultPath: dataPath('eval', 'report.json'),
      aliases: ['eval/report.json'],
      evaluationStage: '0.5'
    })
  ]),
  freezeStage('1', '语料整理', ['0.5'], [
    freezeSpec('corpus-reorganize-report.json', { producer: 'scripts/corpus-stage.mjs', defaultPath: resourcePath('corpus-reorganize-report.json') })
  ]),
  freezeStage('2', '来源元数据联结', ['1'], [
    freezeSpec('corpus-source-metadata.json', { producer: 'scripts/corpus-stage.mjs', defaultPath: resourcePath('corpus-source-metadata.json') })
  ]),
  freezeStage('3', '原文准入', ['2'], [
    freezeSpec('source-manifest.json', { producer: 'scripts/corpus-stage.mjs', defaultPath: resourcePath('source-manifest.json') }),
    freezeSpec('source-quality-report.json', { producer: 'scripts/corpus-stage.mjs', defaultPath: resourcePath('source-quality-report.json') }),
    freezeSpec('quarantine-report.json', { producer: 'scripts/corpus-stage.mjs', defaultPath: resourcePath('quarantine-report.json') })
  ]),
  freezeStage('4', '低成本候选召回', ['3'], [
    freezeSpec('intermediate/v3.1/candidates.json', { producer: 'candidate mining / scripts/build-character-material-index.mjs', defaultPath: resourcePath('intermediate', 'v3.1', 'candidates.json') })
  ]),
  freezeStage('5', '人物识别', ['4'], [
    freezeSpec('intermediate/v3.1/person-annotations.json', {
      producer: 'scripts/annotation-pipeline.mjs',
      defaultPath: resourcePath('intermediate', 'v3.1', 'annotation-plan.json'),
      aliases: ['intermediate/v3.1/annotation-plan.json']
    })
  ]),
  freezeStage('6', '六维分类', ['5'], [
    freezeSpec('intermediate/v3.1/dimension-annotations.json', {
      producer: 'scripts/annotation-pipeline.mjs',
      defaultPath: resourcePath('intermediate', 'v3.1', 'rich-intermediate.json'),
      aliases: ['intermediate/v3.1/annotation-plan.json']
    })
  ]),
  freezeStage('7', 'Scene/Relationship/Emotion', ['6'], [
    freezeSpec('intermediate/v3.1/context-annotations.json', {
      producer: 'scripts/annotation-pipeline.mjs',
      defaultPath: resourcePath('intermediate', 'v3.1', 'rich-intermediate.json'),
      aliases: ['intermediate/v3.1/rich-intermediate.json']
    })
  ]),
  freezeStage('8', 'Subtext', ['7'], [
    freezeSpec('intermediate/v3.1/subtext-annotations.json', {
      producer: 'scripts/annotation-pipeline.mjs',
      defaultPath: resourcePath('intermediate', 'v3.1', 'rich-intermediate.json'),
      aliases: ['intermediate/v3.1/rich-intermediate.json']
    })
  ]),
  freezeStage('9', 'HTL', ['8'], [
    freezeSpec('intermediate/v3.1/htl-annotations.json', {
      producer: 'scripts/annotation-pipeline.mjs',
      defaultPath: resourcePath('intermediate', 'v3.1', 'rich-intermediate.json'),
      aliases: ['intermediate/v3.1/rich-intermediate.json']
    })
  ]),
  freezeStage('10', 'Sample Grade', ['9'], [
    freezeSpec('intermediate/v3.1/graded.json', { producer: 'material grading', defaultPath: resourcePath('intermediate', 'v3.1', 'graded.json') })
  ]),
  freezeStage('11', 'safe/audit', ['10'], [
    freezeSpec('intermediate/v3.1/safe.json', { producer: 'safe/audit transformation', defaultPath: resourcePath('intermediate', 'v3.1', 'safe.json') })
  ]),
  freezeStage('12', 'MicroPattern', ['11'], [
    freezeSpec('intermediate/v3.1/micropatterns.json', { producer: 'scripts/material-publication.mjs', defaultPath: resourcePath('intermediate', 'v3.1', 'micropatterns.json') })
  ]),
  freezeStage('13', 'Rules', ['12'], [
    freezeSpec('intermediate/v3.1/rules.json', { producer: 'scripts/material-publication.mjs', defaultPath: resourcePath('intermediate', 'v3.1', 'rules.json') })
  ]),
  freezeStage('14', 'Profile', ['13'], [
    freezeSpec('intermediate/v3.1/profiles.json', { producer: 'scripts/material-publication.mjs', defaultPath: resourcePath('intermediate', 'v3.1', 'profiles.json') })
  ]),
  freezeStage('15', 'Compatibility Builder', ['14'], [
    freezeSpec('intermediate/v3.1/runtime-index.json', {
      producer: 'scripts/build-character-material-v31.mjs',
      defaultPath: dataPath('runtime-index.json'),
      policy: 'compatibility-index'
    })
  ]),
  freezeStage('16', 'Runtime Index', ['15'], [
    freezeSpec('runtime-index.json', {
      producer: 'scripts/build-character-material-index.mjs',
      defaultPath: path.join(REPO_ROOT, 'lib', 'character-material', 'index.json'),
      policy: 'runtime-index'
    })
  ]),
  freezeStage('17', 'A/B Generation', ['16'], [
    freezeSpec('eval/stage-17/scores.jsonl', {
      kind: 'jsonl',
      policy: 'score',
      producer: 'scripts/generation-eval.mjs',
      defaultPath: dataPath('eval', 'stage-17', 'scores.jsonl'),
      evaluationStage: '17',
      minRows: 50
    }),
    freezeSpec('eval/stage-17/report.json', {
      policy: 'eval-report',
      producer: 'scripts/generation-eval.mjs',
      defaultPath: dataPath('eval', 'stage-17', 'report.json'),
      evaluationStage: '17'
    })
  ]),
  freezeStage('18', 'Quality Report / Final Release', ['17'], [
    freezeSpec('eval/stage-18/feedback-report.json', {
      producer: 'scripts/generation-feedback.mjs',
      defaultPath: dataPath('eval', 'feedback-report.json'),
      aliases: ['eval/feedback-report.json', 'eval/feedback.json'],
      policy: 'feedback-report'
    }),
    freezeSpec('releases/manifest.json', {
      producer: 'scripts/release-version.mjs',
      defaultPath: path.join(DEFAULT_PIPELINE_ROOT, 'releases', 'manifest.json'),
      aliases: ['eval/stage-18/version-manifest.json', 'eval/version-manifest.json'],
      policy: 'release-manifest'
    }),
    freezeSpec('contracts/index.validation.json', { producer: 'scripts/validate-index.mjs', defaultPath: dataPath('contracts', 'index.validation.json'), policy: 'validation' }),
    freezeSpec('contracts/runtime-compat.validation.json', { producer: 'scripts/validate-runtime-compat.mjs', defaultPath: dataPath('contracts', 'runtime-compat.validation.json'), policy: 'validation' }),
    freezeSpec('contracts/material-safety.validation.json', { producer: 'scripts/validate-material-safety.mjs', defaultPath: dataPath('contracts', 'material-safety.validation.json'), policy: 'validation' }),
    freezeSpec('contracts/quota.validation.json', { producer: 'scripts/validate-quota.mjs', defaultPath: dataPath('contracts', 'quota.validation.json'), policy: 'validation' })
  ])
];

export const PIPELINE_STAGES = Object.freeze(STAGE_DEFINITIONS);
export const PIPELINE_ARTIFACT_MAP = Object.freeze(Object.fromEntries(
  PIPELINE_STAGES.map(stage => [stage.id, stage.artifactSpecs])
));
export const STAGE_DEPENDENCIES = Object.freeze(Object.fromEntries(
  PIPELINE_STAGES.map(stage => [stage.id, stage.dependsOn])
));

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function statusFromGate(value) {
  if (!isObject(value)) return '';
  const status = normalizedStatus(value.status);
  if (value.pass === false || value.valid === false || BLOCKED_STATUSES.has(status)) return 'blocked';
  if (value.pending === true || PENDING_STATUSES.has(status)) return 'pending';
  if (value.pass === true || value.valid === true) return 'pass';
  return status;
}

function outputText(value) {
  if (typeof value === 'string') return value.trim();
  if (!isObject(value)) return '';
  for (const key of ['text', 'output', 'content', 'generation', 'response']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (isObject(candidate) && typeof candidate.text === 'string' && candidate.text.trim()) return candidate.text.trim();
  }
  return '';
}

function rowId(value, lineNumber) {
  if (isObject(value)) {
    for (const key of ['evalId', 'promptId', 'candidateId', 'id', 'calibrationId']) {
      if (value[key] !== undefined && String(value[key]).trim()) return String(value[key]).trim();
    }
  }
  return `line-${lineNumber}`;
}

function jsonlRowGate(value, spec = {}) {
  const status = statusFromGate(value);
  if (status === 'blocked' || BLOCKED_STATUSES.has(status)) return { status: 'blocked', reason: 'jsonl_row_gate_failed' };
  if (PENDING_STATUSES.has(status)) return { status: 'pending', reason: 'jsonl_row_pending' };

  if (spec.policy === 'prompt') {
    if (isObject(value) && String(value.promptId || value.id || '').trim() && String(value.prompt || '').trim()) {
      return { status: 'pass', reason: '' };
    }
    return { status: 'pending', reason: 'jsonl_prompt_incomplete' };
  }
  if (spec.policy === 'generation-output') {
    return outputText(value)
      ? { status: 'pass', reason: '' }
      : { status: 'pending', reason: 'jsonl_generation_output_missing' };
  }
  if (spec.policy === 'score') {
    const pair = isObject(value?.scores) ? value.scores : isObject(value?.score) ? value.score : null;
    if (isObject(pair?.A) && isObject(pair?.B) && Object.keys(pair.A).length > 0 && Object.keys(pair.B).length > 0) {
      return { status: 'pass', reason: '' };
    }
    return { status: 'pending', reason: 'jsonl_score_status_missing' };
  }
  if (PASS_STATUSES.has(status)) return { status: 'pass', reason: '' };
  if (isObject(value) && value.claimable === true) return { status: 'pass', reason: '' };
  return { status: 'pending', reason: 'jsonl_row_has_no_verified_gate' };
}

function readJsonlArtifact(filePath, spec = {}) {
  const rows = [];
  const rowStates = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!line.trim()) return;
    try {
      const value = JSON.parse(line);
      const gate = jsonlRowGate(value, spec);
      rows.push(value);
      rowStates.push({ line: lineNumber, id: rowId(value, lineNumber), status: gate.status, reason: gate.reason });
    } catch (error) {
      rowStates.push({ line: lineNumber, id: `line-${lineNumber}`, status: 'blocked', reason: 'jsonl_invalid_json', detail: error.message });
    }
  });
  return {
    available: true,
    jsonl: true,
    value: { rows },
    rowStates,
    empty: rowStates.length === 0,
    error: ''
  };
}

function readArtifact(filePath, spec = {}) {
  if (spec.kind === 'jsonl' || path.extname(filePath).toLowerCase() === '.jsonl') {
    try {
      return readJsonlArtifact(filePath, spec);
    } catch (error) {
      return { available: false, value: null, error: error.message, jsonl: true, rowStates: [] };
    }
  }
  try {
    return { available: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: '', jsonl: false, rowStates: [] };
  } catch (error) {
    return { available: false, value: null, error: error.message, jsonl: false, rowStates: [] };
  }
}

function evaluationReportState(value, spec) {
  if (!isObject(value)) return { status: 'blocked', reason: 'report_not_object' };
  const declaredStage = String(value.stageId || value.pipelineStage || '').trim();
  if (spec.evaluationStage && declaredStage !== spec.evaluationStage) return { status: 'blocked', reason: 'eval_report_stage_mismatch' };
  if (value.pass === false || value.valid === false || BLOCKED_STATUSES.has(normalizedStatus(value.status))) {
    return { status: 'blocked', reason: 'eval_report_gate_failed' };
  }
  if (Array.isArray(value.inputErrors) && value.inputErrors.length) return { status: 'pending', reason: 'eval_report_input_pending' };
  const metrics = value.metrics;
  if (!isObject(metrics)) return { status: 'pending', reason: 'eval_report_metrics_missing' };
  const promptCount = Number(metrics.promptCount ?? value.promptCount);
  const completePairCount = Number(metrics.completePairCount);
  if (!Number.isInteger(promptCount) || promptCount < 50) return { status: 'pending', reason: 'eval_report_prompt_count_incomplete' };
  if (!Number.isInteger(completePairCount) || completePairCount !== promptCount) return { status: 'pending', reason: 'eval_report_complete_pairs_incomplete' };
  if (Number(metrics.pendingPairCount || 0) > 0) return { status: 'pending', reason: 'eval_report_pairs_pending' };
  if (value.promptValidation?.pass !== true) return { status: 'pending', reason: 'eval_report_prompt_validation_missing' };
  const proxyOnly = normalizedStatus(value.status) === 'proxy-only' || /proxy/iu.test(String(metrics.evaluator || value.evaluator || ''));
  if (proxyOnly) {
    // A complete proxy run is an execution checkpoint only; Stage 18 still
    // requires the separate human-feedback quality report.
    if (['0.5', '17'].includes(spec.evaluationStage) && value.claimable === false && metrics.claimable === false) {
      return { status: 'pending', reason: 'eval_report_proxy_only_not_claimable' };
    }
    return { status: 'pending', reason: 'eval_report_proxy_only' };
  }
  if (PENDING_STATUSES.has(normalizedStatus(value.status))) return { status: 'pending', reason: 'eval_report_pending' };
  if (PASS_STATUSES.has(normalizedStatus(value.status)) || value.pass === true || value.valid === true) {
    return { status: 'pass', reason: '' };
  }
  return { status: 'pending', reason: 'eval_report_has_no_verified_gate' };
}

function feedbackReportState(value) {
  if (!isObject(value)) return { status: 'blocked', reason: 'feedback_report_not_object' };
  const status = normalizedStatus(value.status);
  if (value.pass === false || value.valid === false || BLOCKED_STATUSES.has(status)) {
    return { status: 'blocked', reason: 'feedback_report_gate_failed' };
  }
  if (PENDING_STATUSES.has(status)) return { status: 'pending', reason: 'feedback_report_pending' };
  if (Array.isArray(value.inputErrors) && value.inputErrors.length) return { status: 'pending', reason: 'feedback_report_input_pending' };
  const metrics = value.metrics;
  if (!isObject(metrics) || value.claimable !== true || metrics.claimable !== true) return { status: 'pending', reason: 'feedback_report_claimability_missing' };
  if (metrics.source !== 'human-blind-review' || metrics.evidencePolicy?.humanReviewRequired !== true) return { status: 'pending', reason: 'feedback_report_human_evidence_missing' };
  if (!Number.isInteger(Number(metrics.scoredPairCount)) || Number(metrics.scoredPairCount) <= 0 || Number(metrics.pendingPairCount) !== 0) {
    return { status: 'pending', reason: 'feedback_report_pairs_incomplete' };
  }
  const requiredGates = ['realHumanScoredData', 'noPendingPairs', 'failureCasesClassified', 'claimable'];
  if (!requiredGates.every(key => value.gates?.[key]?.pass === true)) return { status: 'pending', reason: 'feedback_report_gates_incomplete' };
  if (status !== 'scored') return { status: 'pending', reason: 'feedback_report_status_unverified' };
  return { status: 'pass', reason: '' };
}

function releaseManifestState(value) {
  if (!isObject(value)) return { status: 'blocked', reason: 'release_manifest_not_object' };
  const status = normalizedStatus(value.status);
  if (status === 'blocked' || value.pass === false || value.valid === false) return { status: 'blocked', reason: 'release_manifest_blocked' };
  if (status !== 'released') return { status: 'pending', reason: 'release_manifest_not_released' };
  if (!String(value.version || '').trim() || !isObject(value.gates) || !isObject(value.rollback) || value.rollback.auditable !== true) {
    return { status: 'pending', reason: 'release_manifest_evidence_incomplete' };
  }
  if (!Object.values(value.gates).every(gate => isObject(gate) && gate.pass === true)) return { status: 'blocked', reason: 'release_manifest_gate_failed' };
  return { status: 'pass', reason: '' };
}

function runtimeIndexState(value, options = {}) {
  if (!isObject(value)) return { status: 'blocked', reason: 'runtime_index_not_object' };
  if (value.pass === false || value.valid === false || BLOCKED_STATUSES.has(normalizedStatus(value.status))) {
    return { status: 'blocked', reason: 'runtime_index_gate_failed' };
  }
  if (value.pending === true || PENDING_STATUSES.has(normalizedStatus(value.status))) return { status: 'pending', reason: 'runtime_index_pending' };
  const hasBuckets = isObject(value.general) && isObject(value.mature)
    && Array.isArray(value.general.rules) && Array.isArray(value.general.samples)
    && Array.isArray(value.mature.rules) && Array.isArray(value.mature.samples);
  if (!hasBuckets) return { status: 'pending', reason: 'runtime_index_shape_incomplete' };
  const compatibility = value.audit?.compatibilityBuilder;
  if (!isObject(compatibility)
    || compatibility.residualTermsRequired !== true
    || !Array.isArray(compatibility.sampleChars)
    || compatibility.sampleChars[0] !== 12
    || compatibility.sampleChars[1] !== 140) {
    return { status: 'pending', reason: 'runtime_index_builder_evidence_missing' };
  }
  if (options.requirePublished === true && value.published !== true) return { status: 'pending', reason: 'runtime_index_not_published' };
  const rejected = Number(compatibility.rejectedSampleCount);
  if (rejected > 0) return { status: 'blocked', reason: 'runtime_index_samples_rejected' };
  if (!Number.isInteger(rejected) || rejected < 0) return { status: 'blocked', reason: 'runtime_index_rejection_count_invalid' };
  const samples = [...value.general.samples, ...value.mature.samples];
  if (!Number.isInteger(Number(compatibility.compatibleSampleCount)) || Number(compatibility.compatibleSampleCount) !== samples.length || samples.length === 0) {
    return { status: 'pending', reason: 'runtime_index_compatible_samples_incomplete' };
  }
  const invalidSample = samples.find(sample => {
    const length = String(sample?.text || '').length;
    return !String(sample?.id || '').trim() || length < 12 || length > 140 || !Array.isArray(sample?.residualTerms) || sample.residualTerms.length > 0;
  });
  if (invalidSample) return { status: 'blocked', reason: 'runtime_index_sample_constraints_failed' };
  if (Number(compatibility.strongSampleCount || compatibility.strongSamplesPublishedCount || 0) > 2) return { status: 'blocked', reason: 'runtime_index_strong_sample_limit' };
  return { status: 'pass', reason: '' };
}

function compatibilityIndexState(value) {
  return runtimeIndexState(value, { requirePublished: false });
}

function validationState(value) {
  if (!isObject(value)) return { status: 'blocked', reason: 'validation_not_object' };
  const status = normalizedStatus(value.status);
  if (value.pass === false || status === 'blocked' || BLOCKED_STATUSES.has(status)) return { status: 'blocked', reason: 'validation_gate_failed' };
  if (value.pending === true || PENDING_STATUSES.has(status)) return { status: 'pending', reason: 'validation_pending' };
  if (value.pass === true && (!status || PASS_STATUSES.has(status))) return { status: 'pass', reason: '' };
  return { status: 'pending', reason: 'validation_has_no_verified_pass' };
}

function jsonArtifactState(value, spec = {}) {
  if (spec.policy === 'eval-report') return evaluationReportState(value, spec);
  if (spec.policy === 'feedback-report') return feedbackReportState(value);
  if (spec.policy === 'release-manifest') return releaseManifestState(value);
  if (spec.policy === 'compatibility-index') return compatibilityIndexState(value);
  if (spec.policy === 'runtime-index') return runtimeIndexState(value, { requirePublished: true });
  if (spec.policy === 'validation') return validationState(value);
  if (!isObject(value)) return { status: 'blocked', reason: 'artifact_not_object' };
  const status = statusFromGate(value);
  if (status === 'blocked' || BLOCKED_STATUSES.has(status)) return { status: 'blocked', reason: 'artifact_gate_failed' };
  if (PENDING_STATUSES.has(status)) return { status: 'pending', reason: 'artifact_pending_review' };
  if (PASS_STATUSES.has(status)) return { status: 'pass', reason: '' };
  return { status: 'pending', reason: 'artifact_has_no_verified_gate' };
}

export function artifactState(filePath, spec = {}) {
  if (!fs.existsSync(filePath)) return { status: 'missing', path: filePath, reason: 'artifact_missing', kind: spec.kind || 'json', rowStates: [] };
  const parsed = readArtifact(filePath, spec);
  if (!parsed.available) return { status: 'blocked', path: filePath, reason: 'artifact_invalid_json', detail: parsed.error, kind: spec.kind || 'json', rowStates: parsed.rowStates || [] };
  if (parsed.jsonl) {
    const rowStates = parsed.rowStates || [];
    const blocked = rowStates.filter(row => row.status === 'blocked');
    const pending = rowStates.filter(row => row.status === 'pending');
    const tooFew = Number.isInteger(spec.minRows) && rowStates.length < spec.minRows;
    const status = blocked.length ? 'blocked' : pending.length || parsed.empty || tooFew ? 'pending' : 'pass';
    return {
      status,
      path: filePath,
      reason: blocked[0]?.reason || pending[0]?.reason || (parsed.empty ? 'artifact_empty_jsonl' : tooFew ? 'artifact_row_count_below_minimum' : ''),
      kind: 'jsonl',
      rowCount: rowStates.length,
      rowStates,
      // `rows` intentionally contains gate state only, never the JSONL payload.
      rows: rowStates
    };
  }
  const gate = jsonArtifactState(parsed.value, spec);
  return { status: gate.status, path: filePath, reason: gate.reason, kind: spec.kind || 'json', rowStates: [] };
}

function rootContainedPath(root, requested) {
  const rootPath = path.resolve(root);
  const target = path.resolve(requested);
  const relative = path.relative(rootPath, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  return true;
}

export function stageRootPath(root, relativePath) {
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, relativePath);
  if (!rootContainedPath(rootPath, target)) throw new Error(`artifact path escapes root: ${relativePath}`);
  return target;
}

function overrideFor(overrides, stageId, relativePath) {
  if (!isObject(overrides)) return null;
  const value = overrides[`${stageId}:${relativePath}`] ?? overrides[relativePath];
  if (Array.isArray(value)) return value.find(item => item) || null;
  return value || null;
}

function artifactCandidates(artifactRoot, stage, spec, overrides, useDefaults) {
  const override = overrideFor(overrides, stage.id, spec.path);
  if (override) return [{ path: path.resolve(String(override)), source: 'override' }];
  const candidates = [{ path: stageRootPath(artifactRoot, spec.path), source: 'artifact-root' }];
  for (const alias of spec.aliases) candidates.push({ path: stageRootPath(artifactRoot, alias), source: 'artifact-root-alias' });
  if (useDefaults && spec.defaultPath) candidates.push({ path: path.resolve(spec.defaultPath), source: 'producer-default' });
  return candidates.filter((candidate, index, all) => all.findIndex(item => item.path === candidate.path) === index);
}

function normalizedArtifactMap(artifactRoot, stage, overrides = {}, options = {}) {
  return stage.artifactSpecs.map(spec => {
    const candidates = artifactCandidates(artifactRoot, stage, spec, overrides, options.useDefaults === true);
    const selected = candidates.find(candidate => fs.existsSync(candidate.path)) || candidates[0];
    const result = artifactState(selected.path, spec);
    return {
      ...result,
      logicalPath: spec.path,
      producer: spec.producer,
      evaluationStage: spec.evaluationStage,
      resolvedFrom: selected.source,
      candidates: candidates.map(candidate => candidate.path)
    };
  });
}

export function stageGate(stage, artifactStates) {
  const states = asArray(artifactStates);
  const missing = states.filter(item => item.status === 'missing');
  const blocked = states.filter(item => item.status === 'blocked');
  const pending = states.filter(item => item.status === 'pending');
  if (blocked.length) return { status: 'blocked', pass: false, reasons: unique(blocked.map(item => item.reason || 'artifact_gate_failed')), artifacts: states };
  if (missing.length) return { status: 'pending', pass: false, reasons: ['required_artifact_missing'], artifacts: states };
  if (pending.length) return { status: 'pending', pass: false, reasons: unique(pending.map(item => item.reason || 'artifact_pending_review')), artifacts: states };
  return { status: 'pass', pass: true, reasons: [], artifacts: states };
}

function requestedStageId(value) {
  if (value === undefined || value === null || value === '' || value === 'all') return null;
  return String(value);
}

function buildInvalidStageState(requested) {
  return {
    schemaVersion: 'character-material-pipeline-state-v3.1-1',
    generatedAt: new Date().toISOString(),
    artifactRoot: null,
    requestedStage: requested,
    targetStage: null,
    status: 'blocked',
    pass: false,
    mayExpand: false,
    claimable: false,
    stages: [],
    nextAction: `未知目标阶段：${requested}。可用阶段为 0、0.5、1-18。`
  };
}

/** Build ordered execution state; a failed dependency blocks every allowed later stage. */
export function buildPipelineState(options = {}) {
  const artifactRoot = path.resolve(options.artifactRoot || DEFAULT_RESOURCE_ROOT);
  const requested = requestedStageId(options.stage);
  const targetIndex = requested === null ? PIPELINE_STAGES.length - 1 : PIPELINE_STAGES.findIndex(stage => stage.id === requested);
  if (targetIndex < 0) return buildInvalidStageState(requested);
  const useDefaults = options.artifactRoot === undefined;
  const stages = [];
  const byId = new Map();
  for (const [index, stage] of PIPELINE_STAGES.entries()) {
    const artifacts = normalizedArtifactMap(artifactRoot, stage, options.artifacts || {}, { useDefaults });
    const local = stageGate(stage, artifacts);
    let result;
    if (index > targetIndex) {
      result = { status: 'not_requested', pass: false, reasons: ['outside_requested_stage'], artifacts };
    } else {
      const dependencies = stage.dependsOn.map(id => byId.get(id));
      const failedDependency = dependencies.find(dependency => !dependency?.pass);
      if (failedDependency) {
        result = {
          status: 'blocked',
          pass: false,
          reasons: unique([`prerequisite_${failedDependency.status}`, `dependency_${failedDependency.id || stage.dependsOn[0]}`]),
          artifacts
        };
      } else result = local;
    }
    const snapshot = { id: stage.id, name: stage.name, dependsOn: stage.dependsOn, ...result };
    stages.push(snapshot);
    byId.set(stage.id, snapshot);
  }
  const target = stages[targetIndex];
  const pass = Boolean(target?.pass && stages.slice(0, targetIndex + 1).every(stage => stage.pass));
  return {
    schemaVersion: 'character-material-pipeline-state-v3.1-1',
    generatedAt: new Date().toISOString(),
    artifactRoot,
    requestedStage: requested || 'all',
    targetStage: target.id,
    status: pass ? 'pass' : target.status,
    pass,
    mayExpand: pass && target.id !== '0.5',
    claimable: false,
    stages,
    nextAction: pass
      ? '目标阶段门禁通过；继续执行前仍需保留当前版本和评测证据。'
      : '补齐目标阶段证据并重新运行；不得跳过前置阶段或用代理结果替代人工/外部证据。'
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else options[key] = true;
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/run-character-material-pipeline.mjs [--artifact-root path] [--stage id] [--write] [--out path]');
    return 0;
  }
  const state = buildPipelineState({ artifactRoot: options['artifact-root'], stage: options.stage });
  if (options.write === true) writeJson(path.resolve(process.cwd(), String(options.out || DEFAULT_OUTPUT)), state);
  console.log(JSON.stringify(state, null, 2));
  return state.pass ? 0 : 2;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) process.exitCode = main();

export { DEFAULT_OUTPUT, DEFAULT_RESOURCE_ROOT, DEFAULT_PIPELINE_ROOT, readArtifact, parseArgs };
