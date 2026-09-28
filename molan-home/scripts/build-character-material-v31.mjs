import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { splitChapters } from '../../资源库/scripts/build-manifest.mjs';
import {
  canonicalizeRawGenres,
  evaluateArchiveRecord,
  logicalWorkId,
  normalizePlatform
} from '../../资源库/scripts/corpus-utils.mjs';
import * as rich from '../lib/character-material-v31.mjs';
import runtimeMaterial from '../lib/character-material.js';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');
const RESOURCE_ROOT = path.resolve(REPOSITORY_ROOT, '..', '资源库');
const DEFAULT_CONFIG = path.join(RESOURCE_ROOT, 'quota-config.json');
const DEFAULT_MANIFEST = path.join(RESOURCE_ROOT, 'manifest.json');
const DEFAULT_OUTPUT = path.join(RESOURCE_ROOT, 'intermediate', 'v3.1');
const DEFAULT_REPORT = path.join(REPOSITORY_ROOT, 'data', 'character-material-v3.1', 'stage0-report.json');
const DEFAULT_INDEX = path.join(REPOSITORY_ROOT, 'data', 'character-material-v3.1', 'runtime-index.json');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseArgs(argv) {
  const options = {
    stage: '0',
    config: DEFAULT_CONFIG,
    manifest: DEFAULT_MANIFEST,
    output: DEFAULT_OUTPUT,
    report: DEFAULT_REPORT,
    index: DEFAULT_INDEX,
    source: '',
    sourceRecord: '',
    annotations: '',
    limit: 2000,
    write: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--stage') options.stage = next();
    else if (arg === '--config') options.config = path.resolve(next());
    else if (arg === '--manifest') options.manifest = path.resolve(next());
    else if (arg === '--output') options.output = path.resolve(next());
    else if (arg === '--report') options.report = path.resolve(next());
    else if (arg === '--index') options.index = path.resolve(next());
    else if (arg === '--source') options.source = path.resolve(next());
    else if (arg === '--source-record') options.sourceRecord = path.resolve(next());
    else if (arg === '--annotations') options.annotations = path.resolve(next());
    else if (arg === '--limit') options.limit = Math.max(1, Math.min(2000, Number(next()) || 2000));
    else if (arg === '--dry-run') options.write = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

function usage() {
  return [
    'Stage 0 v3.1 人物描写素材库构建器',
    '',
    'node scripts/build-character-material-v31.mjs [options]',
    '',
    '--source <file>          指定一本文本；必须同时提供已验证的 --source-record',
    '--source-record <file>   manifest/source metadata JSON',
    '--manifest <file>        默认使用资源库/manifest.json',
    '--output <dir>           默认资源库/intermediate/v3.1',
    '--annotations <file>     可选的逐候选人工/模型标注 JSON',
    '--limit <n>              候选上限，默认 2000',
    '--dry-run                只计算，不写入中间产物',
    '--stage 0                只允许 Stage 0；未过门禁不得自动扩量'
  ].join('\n');
}

function relativeToWorkspace(filePath) {
  return path.relative(REPOSITORY_ROOT, filePath).replace(/\\/g, '/');
}

function cleanSourceRecord(value, sourcePath = '') {
  const source = value && typeof value === 'object' ? value : {};
  const rawGenres = canonicalizeRawGenres(source.rawGenres || source.genres || source.genre, readJson(DEFAULT_CONFIG, {}));
  return {
    sourceWorkId: String(source.sourceWorkId || source.source_work_id || '').trim(),
    canonicalWorkId: String(source.canonicalWorkId || source.canonical_work_id || '').trim(),
    sourceNovelId: String(source.sourceNovelId || source.source_novel_id || '').trim(),
    platform: normalizePlatform(source.platform || ''),
    platformWorkId: String(source.platformWorkId || source.platform_work_id || '').trim(),
    title: String(source.title || source.work_title || '').trim(),
    author: String(source.author || '').trim(),
    rawGenres,
    primaryGenre: String(source.primaryGenre || source.primary_genre || rawGenres[0] || '').trim(),
    audience: String(source.audience || '').trim(),
    sourceUrl: String(source.sourceUrl || source.url || '').trim(),
    sourceKind: String(source.sourceKind || source.source_kind || '').trim(),
    repository: String(source.repository || source.repo || '').trim(),
    sourcePath: String(source.sourcePath || source.path || '').trim(),
    completionStatus: String(source.completionStatus || '').trim(),
    expectedChapterCount: Number(source.expectedChapterCount || source.chapterCount || 0) || 0,
    fetchedChapterCount: Number(source.fetchedChapterCount || source.chapterCount || 0) || 0,
    chapterCountDeclared: source.chapterCountDeclared === true,
    chapterCoverage: Number.isFinite(Number(source.chapterCoverage)) ? Number(source.chapterCoverage) : null,
    contentScope: String(source.contentScope || '').trim(),
    contentHash: String(source.contentHash || source.content_hash || '').trim(),
    completionEvidenceRef: String(source.completionEvidenceRef || '').trim(),
    completionEvidenceVerified: source.completionEvidenceVerified === true,
    fullWorkEvidenceRef: String(source.fullWorkEvidenceRef || '').trim(),
    fullWorkEvidenceVerified: source.fullWorkEvidenceVerified === true,
    catalogSnapshot: source.catalogSnapshot && typeof source.catalogSnapshot === 'object' ? source.catalogSnapshot : null,
    fullWorkEvidenceSha256: String(source.fullWorkEvidenceSha256 || '').trim(),
    authorization: source.authorization && typeof source.authorization === 'object' ? source.authorization : {},
    ranking: source.ranking && typeof source.ranking === 'object' ? source.ranking : {},
    excludeFromCorpus: source.excludeFromCorpus === true,
    filePath: sourcePath
  };
}

function resolveSource(options) {
  const explicitRecord = options.sourceRecord ? readJson(options.sourceRecord, null) : null;
  if (options.source) {
    return {
      filePath: options.source,
      record: cleanSourceRecord(explicitRecord || {}, options.source)
    };
  }
  const manifest = readJson(options.manifest, null);
  const books = Array.isArray(manifest?.books) ? manifest.books : [];
  for (const book of books) {
    const part = Array.isArray(book.parts) ? book.parts.find(item => item && item.filePath) : null;
    const filePath = part?.filePath ? path.resolve(RESOURCE_ROOT, part.filePath) : '';
    if (filePath && fs.existsSync(filePath)) {
      return { filePath, record: cleanSourceRecord({ ...book, ...(part || {}) }, filePath) };
    }
  }
  return { filePath: '', record: cleanSourceRecord(explicitRecord || {}) };
}

function sourceGate(record, config) {
  const gateConfig = {
    ...config,
    resourceRoot: RESOURCE_ROOT,
    evidenceRoot: RESOURCE_ROOT,
    revalidateArchiveEvidence: true
  };
  return evaluateArchiveRecord(record, gateConfig);
}

function getCandidateRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  if (Array.isArray(result?.candidates)) return result.candidates;
  return [];
}

function candidateId(row, index) {
  return String(row?.id || row?.candidateId || `candidate-${index + 1}-${sha256(row?.text || '').slice(0, 12)}`);
}

function annotationFor(annotations, row, index) {
  if (Array.isArray(annotations)) return annotations[index] || {};
  if (annotations && typeof annotations === 'object') {
    return annotations[candidateId(row, index)] || annotations[String(index)] || {};
  }
  return {};
}

function callAnnotator(row, annotation, source, chapters) {
  if (typeof rich.annotateCandidate !== 'function') throw new Error('v3.1 rich module 缺少 annotateCandidate');
  return rich.annotateCandidate(row, {
    ...annotation,
    source,
    chapters,
    sourceWorkId: source.sourceWorkId || logicalWorkId(source, source.filePath),
    canonicalWorkId: source.canonicalWorkId || logicalWorkId(source, source.filePath),
    platform: source.platform,
    title: source.title,
    author: source.author,
    rawGenres: source.rawGenres,
    primaryGenre: source.primaryGenre,
    audience: source.audience
  });
}

function privateRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const copy = JSON.parse(JSON.stringify(record));
  if (copy.sample && typeof copy.sample === 'object') delete copy.sample.rawText;
  delete copy.rawText;
  return copy;
}

function validateRecord(record) {
  if (typeof rich.validateRichRecord !== 'function') return { pass: true, reasons: [] };
  const result = rich.validateRichRecord(record);
  return {
    pass: result === true || result?.pass === true || result?.valid === true,
    reasons: Array.isArray(result?.reasons)
      ? result.reasons
      : Array.isArray(result?.errors) ? result.errors : []
  };
}

function runtimeSample(record, index) {
  const person = record?.person || {};
  const sample = record?.sample || {};
  const safety = record?.safety || {};
  const source = record?.source || {};
  const text = String(sample.safeText || sample.text || '').trim();
  return {
    id: String(sample.id || record.id || `v31-sample-${index + 1}`),
    archetype: String(person.primaryArchetype || sample.archetype || '').trim(),
    dimension: String(sample.dimension || '').trim(),
    text: text.slice(0, 140),
    sourceHash: sha256(source.sourceWorkId || source.sourceUrl || record.id || text).slice(0, 16),
    canonicalWorkId: String(source.canonicalWorkId || '').trim(),
    sourceWorkId: String(source.sourceWorkId || '').trim(),
    sourceNovelId: String(source.sourceNovelId || '').trim(),
    platform: String(source.platform || '').trim(),
    authorHash: source.author ? sha256(source.author).slice(0, 16) : '',
    audience: String(source.audience || '').trim(),
    genre: String(source.primaryGenre || '').trim(),
    rawGenres: Array.isArray(source.rawGenres) ? source.rawGenres.slice(0, 12) : [],
    primaryGenre: String(source.primaryGenre || '').trim(),
    genreBucket: String(source.genreBucket || '').trim(),
    scene: String(sample.scene || '').trim(),
    relationship: String(sample.relationship || '').trim(),
    emotionalState: Array.isArray(sample.emotionalState) ? sample.emotionalState.slice(0, 8) : [],
    intent: String(sample.surfaceIntent || sample.intent || '').trim(),
    subtext: Array.isArray(sample.subtext) ? sample.subtext.slice(0, 4) : sample.subtext ? [String(sample.subtext).slice(0, 160)] : [],
    microPatterns: Array.isArray(sample.microPatterns) ? sample.microPatterns.slice(0, 8) : [],
    signals: Array.isArray(sample.humanTextureSignals) ? sample.humanTextureSignals.slice(0, 12) : [],
    humanTextureSignals: Array.isArray(sample.humanTextureSignals) ? sample.humanTextureSignals.slice(0, 12) : [],
    forbiddenTerms: Array.isArray(safety.forbiddenTerms) ? safety.forbiddenTerms.slice(0, 20) : [],
    residualTerms: Array.isArray(safety.residualTerms) ? safety.residualTerms.slice(0, 20) : [],
    score: Number(record?.quality?.score || record?.quality?.value || 0) || 0
  };
}

function buildRuntimeCompatibilityIndex(records, options = {}) {
  const acceptedRecords = [];
  const rejectedRecords = [];
  for (const record of Array.isArray(records) ? records : []) {
    const result = validateRecord(record);
    const sample = record?.sample || {};
    const safety = record?.safety || {};
    const text = String(sample.safeText || '').trim();
    if (!result.pass || text.length < 12 || text.length > 140
      || (Array.isArray(safety.residualTerms) && safety.residualTerms.length > 0)) {
      rejectedRecords.push({ id: record?.sample?.id || null, reasons: result.reasons.length ? result.reasons : ['runtime_sample_gate'] });
      continue;
    }
    const overlap = typeof rich.scanTextOverlap === 'function'
      ? rich.scanTextOverlap(text, acceptedRecords)
      : { blocked: false };
    if (overlap.blocked) {
      rejectedRecords.push({
        id: record?.sample?.id || null,
        reasons: ['runtime_sample_overlap'],
        overlap: overlap.toJSON ? overlap.toJSON() : overlap
      });
      continue;
    }
    acceptedRecords.push(record);
  }
  const samples = acceptedRecords.map(runtimeSample);
  const rules = typeof runtimeMaterial.genericCharacterRules === 'function'
    ? runtimeMaterial.genericCharacterRules().map((rule, index) => ({
      ...rule,
      id: `v31-generic-rule-${index + 1}`,
      archetype: ''
    }))
    : [];
  const config = options.config && typeof options.config === 'object' ? options.config : {};
  return {
    version: 'character-material-v3.1-runtime-compatible-1',
    published: false,
    markdownPublished: false,
    general: { rules, samples },
    mature: { rules: [], samples: [] },
    profiles: {},
    profilesPublished: false,
    profileFallback: 'generic-rules',
    profileFocusSlices: Array.isArray(config.focusSlices) ? config.focusSlices : [],
    profileGenreMap: config.sourceBucketMap || {},
    audit: {
      strongSamplesPublished: false,
      compatibilityBuilder: {
        inputSchema: 'corpus-v3.1-rich-1',
        outputSchema: 'legacy-character-material-v1',
        sourceRecordCount: Array.isArray(records) ? records.length : 0,
        compatibleSampleCount: samples.length,
        rejectedSampleCount: rejectedRecords.length,
        rejectedSamples: rejectedRecords,
        rawTextPublished: false,
        residualTermsRequired: true,
        sampleChars: [12, 140],
        strongSampleMax: 2
      }
    }
  };
}

function buildStage0(options) {
  const config = readJson(options.config, {});
  const source = resolveSource(options);
  const gate = source.filePath ? sourceGate(source.record, config) : {
    usable: false,
    reasons: ['source_not_found'],
    platformMetadata: { verified: false },
    authorization: { usable: false },
    fullWorkVerified: false,
    contentHashVerified: false
  };
  const baseReport = {
    schemaVersion: 'stage0-report-v3.1-1',
    stage: '0',
    status: gate.usable ? 'running' : 'blocked',
    generatedAt: new Date().toISOString(),
    source: {
      path: source.filePath ? relativeToWorkspace(source.filePath) : '',
      sourceWorkId: source.record.sourceWorkId,
      canonicalWorkId: source.record.canonicalWorkId,
      platform: source.record.platform,
      title: source.record.title,
      primaryGenre: source.record.primaryGenre
    },
    gates: {
      source: {
        pass: gate.usable === true,
        reasons: Array.isArray(gate.reasons) ? gate.reasons : []
      },
      candidate: { pass: false, reasons: ['not_run'] },
      rich: { pass: false, reasons: ['not_run'] },
      runtimeCompatibility: { pass: false, reasons: ['not_run'] }
    },
    counts: {
      chapters: 0,
      candidateRows: 0,
      richRows: 0,
      validRichRows: 0,
      runtimeSamples: 0
    },
    outputs: {},
    nextAction: gate.usable
      ? '完成候选人工校准后再运行后续标注与 A/B。'
      : '补齐并验证来源、完结、全文、章节和授权证据；未过准入不得进入高级分析。'
  };
  if (!gate.usable) return baseReport;

  const sourceText = fs.readFileSync(source.filePath, 'utf8');
  const chapters = splitChapters(sourceText);
  const chapterUnits = chapters.map((chapter, index) => ({
    text: sourceText.slice(Number(chapter.start) || 0, Number(chapter.end) || sourceText.length),
    chapterIndex: chapter.number ?? index + 1,
    charOffset: Number(chapter.start) || 0,
    sourceWorkId: source.record.sourceWorkId || logicalWorkId(source.record, source.filePath)
  }));
  const minedResult = typeof rich.candidateMine === 'function'
    ? rich.candidateMine(chapterUnits, { sourceWorkId: source.record.sourceWorkId, maxCandidates: options.limit, minChars: 12, maxChars: 140 })
    : [];
  const candidates = getCandidateRows(minedResult).slice(0, options.limit);
  baseReport.status = 'ready_for_review';
  baseReport.counts.chapters = chapters.length;
  baseReport.counts.candidateRows = candidates.length;
  baseReport.gates.candidate = {
    pass: candidates.length >= 1,
    reasons: candidates.length ? [] : ['candidate_pool_empty']
  };
  const annotations = options.annotations ? readJson(options.annotations, {}) : {};
  const richRows = candidates.map((row, index) => callAnnotator(row, annotationFor(annotations, row, index), source.record, chapters)).filter(Boolean);
  const validations = richRows.map(validateRecord);
  const validRows = richRows.filter((_, index) => validations[index].pass);
  baseReport.counts.richRows = richRows.length;
  baseReport.counts.validRichRows = validRows.length;
  baseReport.gates.rich = {
    pass: validRows.length === richRows.length && richRows.length > 0,
    reasons: [...new Set(validations.flatMap(result => result.reasons))]
  };
  const runtimeIndex = buildRuntimeCompatibilityIndex(validRows, { config });
  baseReport.counts.runtimeSamples = runtimeIndex.general.samples.length;
  const compatibilityAudit = runtimeIndex.audit?.compatibilityBuilder || {};
  baseReport.gates.runtimeCompatibility = {
    pass: Number(compatibilityAudit.rejectedSampleCount || 0) === 0
      && runtimeIndex.general.samples.every(sample => sample.text.length >= 12 && sample.text.length <= 140 && sample.residualTerms.length === 0),
    reasons: [
      ...(Number(compatibilityAudit.rejectedSampleCount || 0) > 0 ? ['runtime_sample_rejected'] : []),
      ...(runtimeIndex.general.samples.some(sample => sample.residualTerms.length > 0) ? ['residual_terms'] : [])
    ]
  };
  if (!baseReport.gates.candidate.pass || !baseReport.gates.rich.pass || !baseReport.gates.runtimeCompatibility.pass) {
    baseReport.status = 'blocked';
    baseReport.nextAction = '修复候选、标注或安全门禁后重新运行；门禁通过前不得发布或扩量。';
  }
  baseReport.outputs = {
    raw: relativeToWorkspace(path.join(options.output, 'raw', `${source.record.sourceWorkId || 'stage0'}.json`)),
    annotated: relativeToWorkspace(path.join(options.output, 'annotated', `${source.record.sourceWorkId || 'stage0'}.json`)),
    safe: relativeToWorkspace(path.join(options.output, 'safe', `${source.record.sourceWorkId || 'stage0'}.json`)),
    final: relativeToWorkspace(path.join(options.output, 'final', `${source.record.sourceWorkId || 'stage0'}.json`)),
    runtimeIndex: relativeToWorkspace(options.index)
  };
  if (options.write) {
    const rawBundle = { schemaVersion: 'corpus-v3.1-rich-1', source: source.record, chapters, records: richRows };
    const safeBundle = { ...rawBundle, records: richRows.map(privateRecord) };
    writeJson(path.join(options.output, 'raw', `${source.record.sourceWorkId || 'stage0'}.json`), rawBundle);
    writeJson(path.join(options.output, 'annotated', `${source.record.sourceWorkId || 'stage0'}.json`), rawBundle);
    writeJson(path.join(options.output, 'safe', `${source.record.sourceWorkId || 'stage0'}.json`), safeBundle);
    writeJson(path.join(options.output, 'final', `${source.record.sourceWorkId || 'stage0'}.json`), safeBundle);
    writeJson(options.index, runtimeIndex);
  }
  return baseReport;
}

function run(options) {
  if (options.help) {
    console.log(usage());
    return { status: 'help' };
  }
  if (String(options.stage) !== '0') {
    throw new Error('v3.1 只允许从 Stage 0 开始；Stage 0 未通过前禁止自动扩量。');
  }
  const report = buildStage0(options);
  if (options.write) writeJson(options.report, report);
  return report;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const report = run(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'blocked') process.exitCode = 2;
  } catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  }
}

export {
  buildRuntimeCompatibilityIndex,
  buildStage0,
  cleanSourceRecord,
  parseArgs,
  resolveSource,
  run,
  sourceGate
};
