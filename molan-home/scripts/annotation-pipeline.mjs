import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as rich from '../lib/character-material-v31.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

export const ANNOTATION_PASSES = Object.freeze([
  'person',
  'dimension',
  'scene',
  'relationship',
  'emotionalState',
  'subtext',
  'humanTexture',
  'microPattern'
]);

export const EXPENSIVE_ANNOTATION_PASSES = Object.freeze(['subtext', 'humanTexture', 'microPattern']);
export const CALIBRATION_TARGET = 200;

const PASS_LABELS = Object.freeze({
  person: '人物归属',
  dimension: '描写维度',
  scene: '场景',
  relationship: '关系',
  emotionalState: '情绪状态',
  subtext: '潜台词',
  humanTexture: 'Human Texture 信号',
  microPattern: 'MicroPattern'
});

const CALIBRATION_FIELDS = Object.freeze([
  'personAttribution',
  'dimension',
  'scene',
  'relationship',
  'subtextEvidence',
  'humanTextureEvidence',
  'safeTextFluency'
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function strings(value) {
  return [...new Set(asArray(value).map(item => String(item ?? '').trim()).filter(Boolean))];
}

function confidence(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function textOf(candidate) {
  return String(candidate?.text || candidate?.rawText || candidate?.sample?.rawText || '').trim();
}

function candidateId(candidate, index = 0) {
  const explicit = String(candidate?.candidateId || candidate?.id || candidate?.sample?.id || '').trim();
  return explicit || `candidate-${index + 1}-${crypto.createHash('sha256').update(textOf(candidate)).digest('hex').slice(0, 12)}`;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

function outputField(output, keys, fallback = undefined) {
  for (const key of keys) {
    if (output && Object.prototype.hasOwnProperty.call(output, key)) return output[key];
  }
  return fallback;
}

function evidenceList(value) {
  return strings(value).filter(item => item.length > 0);
}

function validateConfidence(output, errors) {
  if (confidence(output?.confidence) === null) errors.push('confidence must be a number between 0 and 1');
}

function validateLabelList(value, whitelist, label, errors, options = {}) {
  const values = strings(value);
  if (options.required && values.length === 0) errors.push(`${label} is required`);
  const invalid = values.filter(item => !whitelist.includes(item));
  if (invalid.length) errors.push(`${label} contains values outside whitelist: ${invalid.join(', ')}`);
  return values.filter(item => whitelist.includes(item));
}

function validateEvidenceSpans(value, errors, required = true, candidateText = '') {
  const spans = Array.isArray(value) ? value : [];
  if (required && spans.length === 0) errors.push('evidenceSpans is required');
  for (const span of spans) {
    if (!isObject(span) || !Number.isInteger(Number(span.start)) || !Number.isInteger(Number(span.end)) || Number(span.start) < 0 || Number(span.end) <= Number(span.start)) {
      errors.push('evidenceSpans must contain non-empty integer start/end coordinates');
      continue;
    }
    const start = Number(span.start);
    const end = Number(span.end);
    const spanText = typeof span.text === 'string' ? span.text : '';
    if (!spanText) {
      errors.push('evidence span text is required');
      continue;
    }
    if (end > candidateText.length || candidateText.slice(start, end) !== spanText) {
      errors.push('evidence span text is inconsistent with candidate text');
    }
  }
  return spans;
}

function validateSubtext(output, errors) {
  const value = isObject(output?.subtext) ? output.subtext : output;
  const label = String(outputField(value, ['label', 'value', 'type'], '') || '').trim();
  if (label && !rich.SUBTEXT_WHITELIST.includes(label)) errors.push('subtext label is outside whitelist');
  const evidence = evidenceList(outputField(value, ['evidence', 'subtextEvidence'], []));
  if (label && evidence.length === 0) errors.push('subtext evidence is required when a label is present');
  if (!label && evidence.length > 0) errors.push('subtext evidence cannot exist without a label');
  return { label: label || null, evidence, surfaceIntent: String(outputField(value, ['surfaceIntent', 'intent'], '') || '').trim() || null };
}

function validateHumanTexture(output, errors) {
  const signals = validateLabelList(outputField(output, ['signals', 'humanTextureSignals', 'HTL'], []), rich.HTL_WHITELIST, 'signals', errors);
  const evidence = isObject(output?.evidence) ? output.evidence : isObject(output?.humanTextureEvidence) ? output.humanTextureEvidence : {};
  for (const signal of signals) if (!evidenceList(evidence[signal]).length) errors.push(`humanTextureEvidence missing for ${signal}`);
  if (signals.length === 0 && Object.keys(evidence).length > 0) errors.push('human texture evidence cannot exist without signals');
  return { signals, evidence };
}

function validateMicroPattern(output, errors) {
  const value = isObject(output?.microPattern) ? output.microPattern : output;
  const pattern = strings(outputField(value, ['pattern', 'steps', 'structure'], []));
  if (pattern.length < 2) errors.push('microPattern must contain at least two structural steps');
  if (Object.prototype.hasOwnProperty.call(value, 'template') || Object.prototype.hasOwnProperty.call(value, 'sentence')) {
    errors.push('fixed sentence templates are not allowed in microPattern');
  }
  const details = {
    id: String(value.id || '').trim(),
    dimension: String(value.dimension || '').trim() || null,
    scene: strings(value.scene),
    relationship: strings(value.relationship),
    signals: strings(value.signals),
    pattern,
    whyItWorks: String(value.whyItWorks || '').trim(),
    antiPattern: String(value.antiPattern || '').trim()
  };
  if (details.dimension && !rich.DIMENSION_WHITELIST.includes(details.dimension)) errors.push('microPattern dimension is outside whitelist');
  if (details.scene.some(item => !rich.SCENE_WHITELIST.includes(item))) errors.push('microPattern scene is outside whitelist');
  if (details.relationship.some(item => !rich.RELATIONSHIP_WHITELIST.includes(item))) errors.push('microPattern relationship is outside whitelist');
  if (details.signals.some(item => !rich.HTL_WHITELIST.includes(item))) errors.push('microPattern signals are outside whitelist');
  if (!details.whyItWorks) errors.push('microPattern whyItWorks is required');
  return details;
}

/** Validate one narrowly scoped model pass; every inference remains evidence-bound. */
export function validateAnnotationPass(pass, output, candidate = {}) {
  const errors = [];
  if (!ANNOTATION_PASSES.includes(pass)) errors.push(`unknown annotation pass: ${pass}`);
  if (!isObject(output)) errors.push('pass output must be an object');
  if (errors.length) return { valid: false, errors };
  validateConfidence(output, errors);
  const text = textOf(candidate);
  if (!text) errors.push('candidate text is required');
  let normalized = {};
  switch (pass) {
    case 'person': {
      const person = isObject(output.person) ? output.person : output;
      const archetype = String(outputField(person, ['primaryArchetype', 'archetype'], '') || '').trim();
      if (!String(outputField(person, ['personId', 'characterKey', 'canonicalName'], '') || '').trim()) errors.push('person identity is required');
      if (!rich.ARCHETYPE_WHITELIST.includes(archetype)) errors.push('person primaryArchetype is outside whitelist');
      const evidenceSpans = validateEvidenceSpans(outputField(person, ['evidenceSpans', 'evidence'], []), errors, true, text);
      normalized = {
        ...person,
        primaryArchetype: archetype,
        evidenceSpans: evidenceSpans.map((span) => ({ ...span, start: Number(span.start), end: Number(span.end) }))
      };
      break;
    }
    case 'dimension': {
      const dimension = String(outputField(output, ['dimension', 'primaryDimension'], '') || '').trim();
      if (!rich.DIMENSION_WHITELIST.includes(dimension)) errors.push('dimension is outside whitelist');
      const secondaryDimensions = validateLabelList(outputField(output, ['secondaryDimensions'], []), rich.DIMENSION_WHITELIST, 'secondaryDimensions', errors);
      normalized = { dimension, secondaryDimensions };
      break;
    }
    case 'scene':
      normalized.scene = validateLabelList(outputField(output, ['scene', 'scenes'], []), rich.SCENE_WHITELIST, 'scene', errors, { required: true });
      break;
    case 'relationship':
      normalized.relationship = validateLabelList(outputField(output, ['relationship', 'relationships'], []), rich.RELATIONSHIP_WHITELIST, 'relationship', errors, { required: true });
      break;
    case 'emotionalState':
      normalized.emotionalState = validateLabelList(outputField(output, ['emotionalState', 'emotions', 'emotion'], []), rich.EMOTIONAL_STATE_WHITELIST, 'emotionalState', errors, { required: true });
      break;
    case 'subtext':
      normalized = validateSubtext(output, errors);
      break;
    case 'humanTexture':
      normalized = validateHumanTexture(output, errors);
      break;
    case 'microPattern':
      normalized = validateMicroPattern(output, errors);
      break;
    default:
      break;
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], normalized };
}

/** Build a JSON-only prompt for one pass, keeping expensive interpretation out of cheap passes. */
export function buildAnnotationPrompt(pass, candidate = {}) {
  if (!ANNOTATION_PASSES.includes(pass)) throw new Error(`unknown annotation pass: ${pass}`);
  const text = textOf(candidate);
  const instruction = {
    person: '只判断人物归属和人物类型，输出 personId/characterKey、primaryArchetype、evidenceSpans、confidence。',
    dimension: '只选择一个 primary dimension，并可给 secondaryDimensions；不要分析场景或人味。',
    scene: '只从场景白名单选择 scene；必须依据片段中的可观察情境。',
    relationship: '只从关系白名单选择 relationship；没有证据时输出空数组。',
    emotionalState: '只从情绪状态白名单选择 emotionalState；不要把推测当事实。',
    subtext: '只在片段有直接措辞或行为证据时给 subtext label，并逐条列出 evidence；没有证据输出空 label 和空 evidence。',
    humanTexture: '先列出原文 evidence，再从 HTL 白名单选择 signals；每个 signal 必须有对应 evidence。',
    microPattern: '只描述可迁移的行为过程结构，不得输出原句、固定句式、固定比喻或形容词组合。'
  }[pass];
  return [
    `任务：${PASS_LABELS[pass]}（Pass ${ANNOTATION_PASSES.indexOf(pass) + 1}）。`,
    instruction,
    '硬要求：仅依据片段证据；只输出 JSON；confidence 必须在 0 到 1；不确定时减少标签而不是脑补。',
    `候选片段：${text}`
  ].join('\n');
}

function gradeOf(candidate) {
  const value = String(candidate?.grade || candidate?.quality?.grade || '').trim().toUpperCase();
  return ['S', 'A', 'B', 'C', 'D'].includes(value) ? value : '';
}

function requiredPasses(candidate, options = {}) {
  const grade = gradeOf(candidate);
  const expensive = options.includeAllExpensive === true || grade === 'S' || grade === 'A';
  return expensive ? [...ANNOTATION_PASSES] : ANNOTATION_PASSES.filter(pass => !EXPENSIVE_ANNOTATION_PASSES.includes(pass));
}

export function buildAnnotationPlan(candidates = [], options = {}) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
    const id = candidateId(candidate, index);
    const passes = requiredPasses(candidate, options);
    return {
      candidateId: id,
      grade: gradeOf(candidate),
      requiredPasses: passes,
      passPrompts: Object.fromEntries(passes.map(pass => [pass, buildAnnotationPrompt(pass, candidate)]))
    };
  });
}

function passOutputFor(passOutputs, id, pass, index) {
  if (Array.isArray(passOutputs)) {
    const row = passOutputs[index];
    return row?.[pass] || row?.passes?.[pass] || null;
  }
  if (!isObject(passOutputs)) return null;
  const row = passOutputs[id] || passOutputs[String(index)] || passOutputs;
  return row?.[pass] || row?.passes?.[pass] || null;
}

function makeAnnotation(candidate, outputs) {
  const personOutput = isObject(outputs.person?.person) ? outputs.person.person : outputs.person;
  const subtext = outputs.subtext || {};
  const htl = outputs.humanTexture || {};
  const micro = outputs.microPattern && isObject(outputs.microPattern.microPattern)
    ? outputs.microPattern.microPattern
    : outputs.microPattern;
  const evidenceSpans = Array.isArray(personOutput?.evidenceSpans) ? personOutput.evidenceSpans : [];
  return {
    person: personOutput,
    dimension: outputs.dimension?.dimension,
    secondaryDimensions: outputs.dimension?.secondaryDimensions || [],
    scene: outputs.scene?.scene || [],
    relationship: outputs.relationship?.relationship || [],
    emotionalState: outputs.emotionalState?.emotionalState || [],
    surfaceIntent: subtext.surfaceIntent || null,
    subtext: subtext.label || null,
    subtextEvidence: subtext.evidence || [],
    subtextConfidence: confidence(outputs.subtext?.confidence),
    humanTextureSignals: htl.signals || [],
    humanTextureEvidence: htl.evidence || {},
    microPatterns: micro ? [micro] : [],
    confidence: Math.min(...Object.values(outputs).map(item => confidence(item?.confidence)).filter(value => value !== null)),
    evidence: {
      ...(isObject(candidate.evidence) ? candidate.evidence : {}),
      evidenceSpans
    }
  };
}

/** Apply available pass outputs; missing or invalid outputs remain explicitly pending/rejected. */
export function runAnnotationPipeline({ candidates = [], passOutputs = {}, options = {} } = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const plan = buildAnnotationPlan(rows, options);
  const records = [];
  const pending = [];
  const rejected = [];
  rows.forEach((candidate, index) => {
    const itemPlan = plan[index];
    const outputs = {};
    const errors = [];
    for (const pass of itemPlan.requiredPasses) {
      const raw = passOutputFor(passOutputs, itemPlan.candidateId, pass, index);
      if (!raw) {
        pending.push({ candidateId: itemPlan.candidateId, pass, reason: 'pass_output_missing' });
        continue;
      }
      const checked = validateAnnotationPass(pass, raw, candidate);
      if (!checked.valid) {
        errors.push({ pass, errors: checked.errors });
        continue;
      }
      outputs[pass] = { ...raw, ...checked.normalized };
    }
    const rowPending = pending.some(item => item.candidateId === itemPlan.candidateId);
    if (errors.length) rejected.push({ candidateId: itemPlan.candidateId, errors });
    if (rowPending || errors.length) return;
    try {
      const record = rich.annotateCandidate(candidate, makeAnnotation(candidate, outputs));
      const validation = rich.validateRichRecord(record);
      if (!validation.valid) rejected.push({ candidateId: itemPlan.candidateId, errors: validation.errors });
      else records.push(record);
    } catch (error) {
      rejected.push({ candidateId: itemPlan.candidateId, errors: [error.message] });
    }
  });
  const pendingIds = new Set(pending.map(item => item.candidateId));
  const status = pending.length ? (records.length ? 'partial' : 'pending') : (rejected.length ? 'blocked' : 'ready');
  return {
    status,
    records,
    pending,
    rejected,
    plan,
    counts: {
      candidates: rows.length,
      records: records.length,
      pendingCandidates: pendingIds.size,
      pendingPasses: pending.length,
      rejectedCandidates: new Set(rejected.map(item => item.candidateId)).size
    },
    claimable: false
  };
}

function dimensionOf(candidate) {
  return String(candidate?.dimension || candidate?.sample?.dimension || 'unclassified').trim();
}

function platformOf(candidate) {
  return String(candidate?.platform || candidate?.source?.platform || 'unknown').trim();
}

function archetypeOf(candidate) {
  return String(candidate?.archetype || candidate?.person?.primaryArchetype || candidate?.quality?.archetype || 'unclassified').trim();
}

function sceneOf(candidate) {
  const value = candidate?.scene || candidate?.sample?.scene;
  return strings(value)[0] || 'unclassified';
}

/** Select a deterministic, stratified 200-row structural calibration set without judging literary quality. */
export function buildCalibrationSet(candidates = [], options = {}) {
  const target = Math.max(1, Number(options.target || CALIBRATION_TARGET));
  const rows = (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({ candidate, index, id: candidateId(candidate, index) }));
  const groups = new Map();
  for (const row of rows) {
    const key = [platformOf(row.candidate), archetypeOf(row.candidate), dimensionOf(row.candidate), sceneOf(row.candidate), textOf(row.candidate).length < 60 ? 'short' : 'long'].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const values of groups.values()) values.sort((left, right) => stableHash(left.id).localeCompare(stableHash(right.id)));
  const keys = [...groups.keys()].sort();
  const selected = [];
  let cursor = 0;
  while (selected.length < Math.min(target, rows.length) && keys.length) {
    const key = keys[cursor % keys.length];
    const bucket = groups.get(key);
    if (bucket.length) selected.push(bucket.shift());
    if (!bucket.length) keys.splice(cursor % keys.length, 1);
    else cursor += 1;
  }
  const coverage = {
    platforms: [...new Set(selected.map(row => platformOf(row.candidate)))],
    archetypes: [...new Set(selected.map(row => archetypeOf(row.candidate)))],
    dimensions: [...new Set(selected.map(row => dimensionOf(row.candidate)))],
    scenes: [...new Set(selected.map(row => sceneOf(row.candidate)))],
    lengths: { short: selected.filter(row => textOf(row.candidate).length < 60).length, long: selected.filter(row => textOf(row.candidate).length >= 60).length }
  };
  return {
    schemaVersion: 'character-material-calibration-v3.1-1',
    status: selected.length >= target ? 'ready_for_review' : 'pending',
    targetCount: target,
    selectedCount: selected.length,
    claimable: false,
    fields: CALIBRATION_FIELDS,
    rows: selected.map(row => ({
      calibrationId: `cal-${row.id}`,
      candidateId: row.id,
      text: textOf(row.candidate),
      source: { platform: platformOf(row.candidate), archetype: archetypeOf(row.candidate), dimension: dimensionOf(row.candidate), scene: sceneOf(row.candidate) },
      answers: null,
      status: 'pending'
    })),
    coverage,
    reviewInstructions: '人工只核对实体归属、标签、证据和 safeText 自然度，不评价真人原文的文笔或人味。'
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
    console.log('用法：node scripts/annotation-pipeline.mjs --candidates path [--passes path] [--out-dir path] [--write]');
    return 0;
  }
  if (!options.candidates) {
    console.error('缺少 --candidates；未生成任何模型或人工标注。');
    return 1;
  }
  let candidates;
  try {
    const input = readJson(path.resolve(process.cwd(), String(options.candidates)));
    candidates = Array.isArray(input) ? input : input.candidates || input.rows || [];
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  let passOutputs = {};
  if (options.passes) {
    try { passOutputs = readJson(path.resolve(process.cwd(), String(options.passes))); } catch (error) { console.error(error.message); return 1; }
  }
  const result = runAnnotationPipeline({ candidates, passOutputs, options: { includeAllExpensive: options['include-all-expensive'] === true } });
  const calibration = buildCalibrationSet(candidates, { target: options['calibration-target'] });
  const outDir = options['out-dir'] ? path.resolve(process.cwd(), String(options['out-dir'])) : '';
  if (options.write === true && outDir) {
    writeJson(path.join(outDir, 'annotation-plan.json'), { schemaVersion: 'character-material-annotation-plan-v3.1-1', status: result.status, plan: result.plan, counts: result.counts });
    writeJson(path.join(outDir, 'rich-intermediate.json'), { schemaVersion: 'corpus-v3.1-rich-1', status: result.status, records: result.records, pending: result.pending, rejected: result.rejected, claimable: false });
    writeJson(path.join(outDir, 'calibration-set.json'), calibration);
  }
  console.log(JSON.stringify({ status: result.status, counts: result.counts, calibration: { status: calibration.status, selectedCount: calibration.selectedCount, targetCount: calibration.targetCount }, claimable: false }, null, 2));
  return result.status === 'ready' ? 0 : 2;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) process.exitCode = main();

export { CALIBRATION_FIELDS, PASS_LABELS, requiredPasses };
