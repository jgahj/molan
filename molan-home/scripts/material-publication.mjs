import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ARCHETYPE_WHITELIST,
  DIMENSION_WHITELIST,
  EMOTIONAL_STATE_WHITELIST,
  HTL_WHITELIST,
  RELATIONSHIP_WHITELIST,
  SCENE_WHITELIST,
  SUBTEXT_WHITELIST,
  characterCount,
  canonicalizeText,
  normalizedTextHash,
  scanTextOverlap,
  validateRichRecord,
} from '../lib/character-material-v31.mjs';

export const PUBLICATION_SCHEMA_VERSION = 'character-material-publication-v1';
export const DEFAULT_AUTHORIZATION_POLICY = Object.freeze({
  requiredScope: 'corpus',
  allowedStatuses: ['licensed', 'public_domain', 'open_license', 'cc0', 'cc_by', 'cc_by_sa'],
  requiredPermissions: ['archiveUseAllowed', 'modelProcessingAllowed', 'runtimeUseAllowed'],
  requireVerifiedEvidence: true,
});
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;
export const DEFAULT_QUOTA_BUCKETS = Object.freeze({
  言情: ['现言', '古言', '言情衍生', '言情'],
  男频玄幻: ['玄幻', '奇幻', '仙侠', '武侠'],
  都市: ['都市', '职场', '校园', '现实'],
  悬疑: ['悬疑', '推理', '惊悚', '惊险'],
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  return String(value ?? '').trim();
}

function subtextLabel(value) {
  const label = isObject(value) ? text(value.label || value.value || value.type) : text(value);
  return SUBTEXT_WHITELIST.includes(label) ? label : '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right), 'zh-CN'));
}

function countMap(values) {
  const result = {};
  for (const value of values) {
    const key = text(value);
    if (key) result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right, 'zh-CN')));
}

function listField(value, whitelist) {
  return unique(asArray(value).map(text).filter((item) => whitelist.includes(item)));
}

function workId(record) {
  return text(record?.source?.canonicalWorkId || record?.source?.sourceWorkId);
}

export function publicationRecordId(record, index = 0) {
  return text(record?.id || record?.sample?.id)
    || `${workId(record) || `record-${index + 1}`}|${normalizedTextHash(record?.sample?.safeText || '')}`;
}

function sourceAuthorization(record) {
  return record?.source?.authorization
    || record?.source?.provenance?.authorization
    || null;
}

function sourceField(source, key, alias) {
  return source?.[key] ?? (alias ? source?.[alias] : undefined);
}

function checkSha256(value, field, missing, blockers) {
  const hash = text(value);
  if (!hash) missing.push(field);
  else if (!SHA256_PATTERN.test(hash)) blockers.push(`${field} must be a valid SHA-256`);
  return hash;
}

function evaluateSourceEvidence(record) {
  const source = isObject(record?.source) ? record.source : {};
  const missing = [];
  const blockers = [];
  const rawText = text(record?.sample?.rawText);
  if (!rawText) missing.push('sample.rawText');

  if (source.partial === undefined) missing.push('source.partial');
  else if (source.partial !== false) blockers.push('source.partial');
  if (source.incomplete === undefined) missing.push('source.incomplete');
  else if (source.incomplete !== false) blockers.push('source.incomplete');

  const contentScope = text(source.contentScope);
  if (!contentScope) missing.push('source.contentScope');
  else if (contentScope !== 'full_work') blockers.push('source.contentScope');

  const fullWorkEvidence = isObject(source.fullWorkEvidence) ? source.fullWorkEvidence : {};
  const nestedFullWorkEvidenceRef = text(fullWorkEvidence.evidenceRef);
  const flatFullWorkEvidenceRef = text(source.fullWorkEvidenceRef);
  const nestedFullWorkEvidenceSha256 = text(fullWorkEvidence.evidenceSha256);
  const flatFullWorkEvidenceSha256 = text(source.fullWorkEvidenceSha256);
  const fullWorkEvidenceRef = nestedFullWorkEvidenceRef || flatFullWorkEvidenceRef;
  const fullWorkEvidenceSha256 = nestedFullWorkEvidenceSha256 || flatFullWorkEvidenceSha256;
  if (nestedFullWorkEvidenceRef && flatFullWorkEvidenceRef && nestedFullWorkEvidenceRef !== flatFullWorkEvidenceRef) blockers.push('source.fullWorkEvidence.evidenceRef conflict');
  if (nestedFullWorkEvidenceSha256 && flatFullWorkEvidenceSha256 && nestedFullWorkEvidenceSha256.toLowerCase() !== flatFullWorkEvidenceSha256.toLowerCase()) blockers.push('source.fullWorkEvidence.evidenceSha256 conflict');
  const nestedEvidenceVerified = sourceField(fullWorkEvidence, 'verified');
  const fullWorkEvidenceVerified = (nestedEvidenceVerified === undefined
    ? source.fullWorkEvidenceVerified === true
    : nestedEvidenceVerified === true)
    && source.fullWorkEvidenceVerified !== false;
  if (!fullWorkEvidenceRef) missing.push('source.fullWorkEvidence.evidenceRef');
  checkSha256(fullWorkEvidenceSha256, 'source.fullWorkEvidence.evidenceSha256', missing, blockers);
  if (!fullWorkEvidenceVerified) {
    if (nestedEvidenceVerified === undefined && source.fullWorkEvidenceVerified === undefined) {
      missing.push('source.fullWorkEvidence.verified');
    } else {
      blockers.push('source.fullWorkEvidence.verified');
    }
  }

  const contentHash = text(source.contentHash);
  checkSha256(contentHash, 'source.contentHash', missing, blockers);
  if (source.contentHashVerified !== true) {
    if (source.contentHashVerified === undefined) missing.push('source.contentHashVerified');
    else blockers.push('source.contentHashVerified');
  }

  const completionEvidenceRef = text(source.completionEvidenceRef);
  const completionEvidenceSha256 = text(source.completionEvidenceSha256);
  if (!completionEvidenceRef) missing.push('source.completionEvidenceRef');
  checkSha256(completionEvidenceSha256, 'source.completionEvidenceSha256', missing, blockers);
  if (source.completionEvidenceVerified !== true) {
    if (source.completionEvidenceVerified === undefined) missing.push('source.completionEvidenceVerified');
    else blockers.push('source.completionEvidenceVerified');
  }

  return {
    status: blockers.length ? 'blocked' : missing.length ? 'pending' : 'pass',
    missing: unique(missing),
    blockers: unique(blockers),
    originalText: Boolean(rawText),
    completeness: source.partial === false && source.incomplete === false,
    fullWorkEvidence: Boolean(fullWorkEvidenceRef && fullWorkEvidenceSha256 && fullWorkEvidenceVerified && contentScope === 'full_work'),
    contentHash: Boolean(contentHash && source.contentHashVerified === true),
    completionEvidence: Boolean(completionEvidenceRef && completionEvidenceSha256 && source.completionEvidenceVerified === true),
  };
}

function normalizeQuotaConfig(config) {
  if (!isObject(config)) return { config: null, missing: ['quotaConfig'], errors: [] };
  const buckets = isObject(config.genreBuckets) ? config.genreBuckets : DEFAULT_QUOTA_BUCKETS;
  const archetypes = Array.isArray(config.archetypes) ? config.archetypes.map(text) : [...ARCHETYPE_WHITELIST];
  const errors = [];
  if (archetypes.length !== ARCHETYPE_WHITELIST.length
    || new Set(archetypes).size !== archetypes.length
    || !ARCHETYPE_WHITELIST.every((item) => archetypes.includes(item))) {
    errors.push('quotaConfig.archetypes must contain all ten v3.1 archetypes');
  }
  if (Object.keys(buckets).length !== 4) errors.push('quotaConfig.genreBuckets must contain four buckets');
  const bucketNames = Object.keys(buckets);
  if (bucketNames.some((bucket) => !Array.isArray(buckets[bucket]) || buckets[bucket].length === 0)) {
    errors.push('quotaConfig.genreBuckets values must be non-empty arrays');
  }
  const hardFloor = Number(config.cellHardFloor ?? config.hardFloorChars);
  const target = Number(config.cellMinChars ?? config.targetChars ?? hardFloor);
  const capChars = Number(config.perBookCellCapChars ?? 0);
  const capPercent = Number(config.perBookCellCapPct ?? 0);
  if (!Number.isFinite(hardFloor) || hardFloor <= 0) errors.push('quotaConfig.cellHardFloor must be positive');
  if (!Number.isFinite(target) || target < hardFloor) errors.push('quotaConfig.cellMinChars must be >= cellHardFloor');
  if (capChars < 0 || capPercent < 0 || capPercent > 1) errors.push('quotaConfig per-book cap is invalid');
  return {
    config: errors.length ? null : {
      ...config,
      archetypes,
      genreBuckets: buckets,
      sourceBucketMap: isObject(config.sourceBucketMap) ? config.sourceBucketMap : {},
      cellHardFloor: hardFloor,
      cellMinChars: target,
      perBookCellCapChars: capChars > 0 ? capChars : (capPercent > 0 ? Math.floor(target * capPercent) : 0),
    },
    errors,
    missing: [],
  };
}

function evaluateAuthorization(record, policy = DEFAULT_AUTHORIZATION_POLICY) {
  const authorization = sourceAuthorization(record);
  const missing = [];
  const blockers = [];
  if (!isObject(authorization)) return { status: 'pending', missing: ['source.authorization'], blockers: [], evidence: false };
  const authorizationPolicy = isObject(policy) ? policy : DEFAULT_AUTHORIZATION_POLICY;
  const requiredScope = text(authorizationPolicy.requiredScope ?? DEFAULT_AUTHORIZATION_POLICY.requiredScope);
  const allowedStatuses = Array.isArray(authorizationPolicy.allowedStatuses) ? authorizationPolicy.allowedStatuses.map((item) => text(item).toLowerCase()) : DEFAULT_AUTHORIZATION_POLICY.allowedStatuses;
  const status = text(authorization.status).toLowerCase();
  const scope = text(authorization.scope);
  if (!status) missing.push('authorization.status');
  if (!scope) missing.push('authorization.scope');
  if (!text(authorization.evidenceRef)) missing.push('authorization.evidenceRef');
   checkSha256(authorization.evidenceSha256, 'authorization.evidenceSha256', missing, blockers);
  const evidenceVerified = (authorization.evidenceVerified === undefined
    ? authorization.verified === true
    : authorization.evidenceVerified === true)
    && authorization.evidenceVerified !== false
    && authorization.verified !== false;
  if (authorizationPolicy.requireVerifiedEvidence !== false && !evidenceVerified) {
    if (authorization.evidenceVerified === undefined && authorization.verified === undefined) missing.push('authorization.evidenceVerified');
    else blockers.push('authorization.evidenceVerified');
  }
  if (status && !allowedStatuses.includes(status)) blockers.push('authorization.status');
  if (scope && requiredScope && scope !== requiredScope) blockers.push('authorization.scope');
  for (const permission of authorizationPolicy.requiredPermissions || DEFAULT_AUTHORIZATION_POLICY.requiredPermissions) {
    if (authorization[permission] !== true) {
      if (authorization[permission] === undefined) missing.push(`authorization.${permission}`);
      else blockers.push(`authorization.${permission}`);
    }
  }
  const statusValue = blockers.length ? 'blocked' : missing.length ? 'pending' : 'pass';
  return {
    status: statusValue,
    missing: unique(missing),
    blockers: unique(blockers),
    evidence: statusValue === 'pass',
  };
}

function evaluateSource(record, authorizationPolicy) {
  const source = isObject(record?.source) ? record.source : {};
  const required = ['sourceWorkId', 'canonicalWorkId', 'platform', 'title', 'author', 'completionStatus', 'primaryGenre', 'audience'];
  const missing = required.filter((field) => !text(source[field]));
  if (!asArray(source.rawGenres).map(text).some(Boolean)) missing.push('source.rawGenres');
  const completionStatus = text(source.completionStatus).toLowerCase();
  const completedStatuses = new Set(['completed', 'complete', 'finished', '已完结', '完结']);
  const completionBlocker = completionStatus && !completedStatuses.has(completionStatus) ? ['source.completionStatus'] : [];
  const authorization = evaluateAuthorization(record, authorizationPolicy);
  const sourceEvidence = evaluateSourceEvidence(record);
  const blockers = [...completionBlocker, ...authorization.blockers, ...sourceEvidence.blockers];
  const status = blockers.length ? 'blocked' : (missing.length || authorization.missing.length || sourceEvidence.missing.length) ? 'pending' : 'pass';
  return {
    id: workId(record),
    status,
    missing: unique([...missing, ...authorization.missing, ...sourceEvidence.missing]),
    blockers: unique(blockers),
    authorization,
    evidence: sourceEvidence,
  };
}

function evaluateManualReview(records, manualReview) {
  if (!isObject(manualReview)) {
    return { status: 'pending', provided: false, approved: false, reviewedCount: 0, missing: ['manualReview'], blockers: [] };
  }
  const reviewed = new Set(asArray(manualReview.reviewedIds).map(text).filter(Boolean));
  const ids = records.map((record, index) => publicationRecordId(record, index));
  const missingIds = ids.filter((id) => !reviewed.has(id));
  const rejected = new Set(asArray(manualReview.rejectedIds).map(text));
  const blockers = ids.filter((id) => rejected.has(id));
  const missing = missingIds.length ? ['manualReview.reviewedIds'] : [];
  if (manualReview.approved !== true && !missing.length && !blockers.length) missing.push('manualReview.approved');
  return {
    status: blockers.length ? 'blocked' : missing.length ? 'pending' : 'pass',
    provided: true,
    approved: manualReview.approved === true && missing.length === 0 && blockers.length === 0,
    reviewedCount: reviewed.size,
    missing,
    blockers,
    htlEvidenceReviewedCount: asArray(manualReview.htlReviewedIds).filter((id) => reviewed.has(text(id))).length,
  };
}

function evaluateHtl(record) {
  const sample = record?.sample || {};
  const signals = listField(sample.humanTextureSignals, HTL_WHITELIST);
  const evidence = isObject(sample.humanTextureEvidence) ? sample.humanTextureEvidence : (isObject(sample.htlEvidence) ? sample.htlEvidence : {});
  const evidenceComplete = signals.every((signal) => asArray(evidence[signal]).some((item) => text(item)));
  return {
    signals,
    evidenceComplete,
    validity: 'unverified',
  };
}

function evaluateRecord(record, references, index = 0) {
  const rich = validateRichRecord(record);
  const htl = evaluateHtl(record);
  const originalText = text(record?.sample?.rawText);
  const blockers = rich.errors.slice();
  if (!originalText) blockers.push('original text is missing');
  if (!htl.evidenceComplete) blockers.push('HTL evidence is incomplete');
  const overlap = scanTextOverlap(record?.sample?.safeText || '', references);
  if (overlap.blocked) blockers.push('safeText overlap gate failed');
  return {
    id: publicationRecordId(record, index),
    status: blockers.length ? 'blocked' : 'pass',
    blockers: unique(blockers),
    rich,
    evidence: { originalText: Boolean(originalText) },
    htl,
    overlap: overlap.toJSON(),
  };
}

function sampleReferences(records, referenceTexts) {
  const references = asArray(referenceTexts).filter((item) => typeof item === 'string' || isObject(item)).map((item) => item);
  return [...references, ...records.map((record, index) => ({
    id: publicationRecordId(record, index),
    sourceWorkId: workId(record),
    text: text(record?.sample?.safeText),
  }))];
}

function resolveBuckets(record, quotaConfig) {
  const source = record?.source || {};
  const buckets = isObject(quotaConfig?.genreBuckets) ? quotaConfig.genreBuckets : DEFAULT_QUOTA_BUCKETS;
  const sourceBucketMap = isObject(quotaConfig?.sourceBucketMap) ? quotaConfig.sourceBucketMap : {};
  const explicit = unique(asArray(source.genreBucket || source.bucket).map(text));
  const genres = asArray(source.rawGenres).map(text).filter(Boolean);
  const mapped = genres.map((genre) => text(sourceBucketMap[genre] || '')).filter(Boolean);
  const inferred = Object.entries(buckets)
    .filter(([, values]) => genres.some((genre) => values.includes(genre)))
    .map(([bucket]) => bucket);
  return unique([...explicit, ...mapped, ...inferred]).filter((bucket) => Object.prototype.hasOwnProperty.call(buckets, bucket));
}

function eligibleRecords(records, recordChecks) {
  return records.filter((record) => recordChecks.get(record) === true);
}

export function buildDiversityStats(records) {
  const samples = asArray(records);
  const dimensions = samples.map((record) => record?.sample?.dimension).filter((item) => DIMENSION_WHITELIST.includes(item));
  const scenes = samples.flatMap((record) => listField(record?.sample?.scene, SCENE_WHITELIST));
  const relationships = samples.flatMap((record) => listField(record?.sample?.relationship, RELATIONSHIP_WHITELIST));
  const states = samples.flatMap((record) => listField(record?.sample?.emotionalState, EMOTIONAL_STATE_WHITELIST));
  const platforms = samples.map((record) => text(record?.source?.platform));
  const works = samples.map(workId);
  const characters = samples.map((record) => text(record?.person?.personId));
  return {
    sampleCount: samples.length,
    characterCount: samples.reduce((sum, record) => sum + characterCount(record?.sample?.safeText), 0),
    dimensions: { counts: countMap(dimensions), distinct: sorted(dimensions) },
    scenes: { counts: countMap(scenes), distinct: sorted(scenes) },
    relationships: { counts: countMap(relationships), distinct: sorted(relationships) },
    states: { counts: countMap(states), distinct: sorted(states) },
    platforms: { counts: countMap(platforms), distinct: sorted(platforms) },
    works: { counts: countMap(works), distinct: sorted(works) },
    characters: { distinctCount: new Set(characters.filter(Boolean)).size },
  };
}

function patternKey(detail) {
  return [detail.dimension || '', ...detail.scene || [], ...detail.relationship || [], ...detail.signals || [], ...(detail.pattern || [])]
    .map(canonicalizeText).join('|');
}

export function buildMicroPatterns(records) {
  const patterns = new Map();
  const invalid = [];
  for (const record of asArray(records)) {
    for (const detail of asArray(record?.sample?.microPatternDetails)) {
      if (!isObject(detail) || !Array.isArray(detail.pattern) || detail.pattern.length === 0
        || Object.prototype.hasOwnProperty.call(detail, 'template')
        || Object.prototype.hasOwnProperty.call(detail, 'sentence')
        || asArray(detail.invalidFields).length
        || asArray(detail.invalidLabels).length) {
        invalid.push(publicationRecordId(record));
        continue;
      }
      const dimension = DIMENSION_WHITELIST.includes(detail.dimension) ? detail.dimension : null;
      const scene = listField(detail.scene, SCENE_WHITELIST);
      const relationship = listField(detail.relationship, RELATIONSHIP_WHITELIST);
      const signals = listField(detail.signals, HTL_WHITELIST);
      const pattern = detail.pattern.map(text).filter(Boolean);
      if (!dimension || !pattern.length) {
        invalid.push(publicationRecordId(record));
        continue;
      }
      const key = patternKey({ dimension, scene, relationship, signals, pattern });
      const current = patterns.get(key) || {
        id: `mp-${String(patterns.size + 1).padStart(3, '0')}`,
        dimension,
        scene,
        relationship,
        signals,
        pattern,
        whyItWorks: text(detail.whyItWorks),
        antiPattern: text(detail.antiPattern),
        sampleCount: 0,
        works: new Set(),
      };
      current.sampleCount += 1;
      if (workId(record)) current.works.add(workId(record));
      patterns.set(key, current);
    }
  }
  return {
    patterns: [...patterns.values()].map(({ works, ...pattern }) => ({
      ...pattern,
      distinctWorks: works.size,
    })),
    invalidRecordIds: unique(invalid),
  };
}

export function buildOfflineIndex(records, quotaConfig = {}) {
  const samples = asArray(records);
  const primary = { platform: {}, bucket: {}, rawGenre: {}, audience: {}, archetype: {}, dimension: {} };
  const secondary = { scene: {}, relationship: {}, emotionalState: {}, intent: {}, subtext: {}, humanTextureSignals: {} };
  const add = (group, key, id) => {
    const value = text(key);
    if (!value) return;
    group[value] = group[value] || [];
    if (!group[value].includes(id)) group[value].push(id);
  };
  for (const [index, record] of samples.entries()) {
    const id = publicationRecordId(record, index);
    const source = record.source || {};
    add(primary.platform, source.platform, id);
    add(primary.audience, source.audience, id);
    add(primary.archetype, record.person?.primaryArchetype, id);
    add(primary.dimension, record.sample?.dimension, id);
    for (const genre of asArray(source.rawGenres)) add(primary.rawGenre, genre, id);
    for (const bucket of resolveBuckets(record, quotaConfig)) add(primary.bucket, bucket, id);
    for (const scene of asArray(record.sample?.scene)) add(secondary.scene, scene, id);
    for (const relationship of asArray(record.sample?.relationship)) add(secondary.relationship, relationship, id);
    for (const state of asArray(record.sample?.emotionalState)) add(secondary.emotionalState, state, id);
    add(secondary.intent, record.sample?.surfaceIntent, id);
    add(secondary.subtext, subtextLabel(record.sample?.subtext), id);
    for (const signal of asArray(record.sample?.humanTextureSignals)) add(secondary.humanTextureSignals, signal, id);
  }
  return {
    primary,
    secondary,
    sortOrder: ['sampleQuality', 'sourceDiversity', 'workDiversity', 'novelty', 'runtimeCompatibility'],
    runtimeCompatibility: { status: 'deferred', owner: 'existing builder', mapped: false },
  };
}

export function buildAntiPatterns(records) {
  const values = asArray(records).flatMap((record) => asArray(record?.sample?.antiPatterns).map(text).filter(Boolean));
  const all = unique(values);
  return all.map((value, index) => ({ id: `ap-${String(index + 1).padStart(3, '0')}`, antiPattern: value, sampleCount: values.filter((item) => item === value).length }));
}

function topLabels(values, limit = 8) {
  const counts = countMap(values);
  return Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN')).slice(0, limit).map(([value]) => value);
}

export function buildProfiles(records, options = {}) {
  const globalPatternIds = new Map(asArray(options.microPatterns).map((pattern) => [patternKey(pattern), pattern.id]));
  const globalAntiPatternIds = new Map(asArray(options.antiPatterns).map((pattern) => [pattern.antiPattern, pattern.id]));
  const groups = new Map();
  for (const record of asArray(records)) {
    const archetype = record?.person?.primaryArchetype;
    if (!ARCHETYPE_WHITELIST.includes(archetype)) continue;
    const buckets = resolveBuckets(record, options);
    for (const bucket of buckets) {
      const key = `${bucket}|${archetype}`;
      const list = groups.get(key) || [];
      list.push(record);
      groups.set(key, list);
    }
  }
  const profiles = {};
  for (const [key, group] of groups) {
    const [bucket, archetype] = key.split('|');
    const diversity = buildDiversityStats(group);
    const patterns = buildMicroPatterns(group).patterns;
    const stateArchetype = group.flatMap((record) => asArray(record?.person?.stateArchetype).map(text).filter(Boolean));
    const distribution = {};
    for (const record of group) {
      for (const [label, value] of Object.entries(record.person.archetypeDistribution || {})) distribution[label] = (distribution[label] || 0) + Number(value || 0);
    }
    const total = Object.values(distribution).reduce((sum, value) => sum + value, 0) || 1;
    profiles[key] = {
      key,
      bucket,
      primaryArchetype: archetype,
      archetypeDistribution: Object.fromEntries(Object.entries(distribution).map(([label, value]) => [label, Number((value / total).toFixed(6))])),
      stateArchetype: topLabels(stateArchetype),
      commonScenes: topLabels(group.flatMap((record) => record.sample.scene || [])),
      commonRelationships: topLabels(group.flatMap((record) => record.sample.relationship || [])),
      commonSubtext: topLabels(group.map((record) => subtextLabel(record.sample.subtext))),
      commonHumanTexture: topLabels(group.flatMap((record) => record.sample.humanTextureSignals || [])),
      commonMicroPatterns: patterns.map((pattern) => globalPatternIds.get(patternKey(pattern)) || pattern.id),
      commonAntiPatterns: buildAntiPatterns(group).map((pattern) => globalAntiPatternIds.get(pattern.antiPattern) || pattern.id),
      diversity,
      fallback: diversity.works.distinct.length < Number(options.profileMinimumWorks ?? 8)
        || diversity.scenes.distinct.length < 3
        || diversity.relationships.distinct.length < 3
        || diversity.dimensions.distinct.length < 3,
      fallbackReason: '证据不足时使用 generic-rules；此层不伪造画像达标',
    };
  }
  return profiles;
}

function buildRuleText(pattern) {
  const when = [pattern.scene.length ? `场景为${pattern.scene.join('、')}` : '', pattern.relationship.length ? `关系为${pattern.relationship.join('、')}` : '', `维度为${pattern.dimension}`].filter(Boolean).join('、');
  const steps = pattern.pattern.join(' → ');
  return {
    rule: `${when}时，可按“${steps}”的行为顺序处理压力；步骤是可调整的结构，不是句子模板。`,
    application: '根据当前人物目标、关系和状态选择或跳过步骤，用新的措辞重写，不引用素材原句。',
    caution: pattern.antiPattern || '避免把情绪标签、动作顺序和固定形容词组合成重复模板。',
  };
}

export function buildRuleCards(microPatterns, antiPatterns = []) {
  const antiIds = new Map(antiPatterns.map((item) => [item.antiPattern, item.id]));
  return asArray(microPatterns).map((pattern, index) => {
    const antiPatternIds = pattern.antiPattern && antiIds.has(pattern.antiPattern) ? [antiIds.get(pattern.antiPattern)] : [];
    return {
      id: `rule-${String(index + 1).padStart(3, '0')}`,
      dimension: pattern.dimension,
      scene: pattern.scene,
      relationship: pattern.relationship,
      signals: pattern.signals,
      ...buildRuleText(pattern),
      microPatterns: [pattern.id],
      antiPatterns: antiPatternIds,
    };
  });
}

export function buildQuotaReport(records, quotaConfig) {
  if (!asArray(records).length) return { status: 'pending', missing: ['records'], blockers: [], cells: [], totalChars: 0 };
  const configResult = normalizeQuotaConfig(quotaConfig);
  if (!configResult.config) return { status: 'pending', missing: configResult.missing, blockers: configResult.errors, cells: [], totalChars: 0 };
  const config = configResult.config;
  const cells = [];
  for (const archetype of config.archetypes) {
    for (const bucket of Object.keys(config.genreBuckets)) {
      const key = `${archetype}|${bucket}`;
      const selected = asArray(records).filter((record) => record.person?.primaryArchetype === archetype && resolveBuckets(record, config).includes(bucket));
      const seen = new Set();
      let chars = 0;
      const byWork = {};
      for (const record of selected) {
        const sampleKey = `${workId(record)}|${normalizedTextHash(record.sample.safeText)}`;
        if (seen.has(sampleKey)) continue;
        seen.add(sampleKey);
        const length = characterCount(record.sample.safeText);
        chars += length;
        byWork[workId(record)] = (byWork[workId(record)] || 0) + length;
      }
      const cap = config.perBookCellCapChars > 0 ? config.perBookCellCapChars : null;
      const capViolations = cap ? Object.entries(byWork).filter(([, value]) => value > cap).map(([work]) => work) : [];
      cells.push({
        key,
        archetype,
        bucket,
        chars,
        sampleCount: seen.size,
        distinctWorks: Object.keys(byWork).filter(Boolean).length,
        hardFloor: config.cellHardFloor,
        target: config.cellMinChars,
        status: chars >= config.cellMinChars ? 'target' : chars >= config.cellHardFloor ? 'hard-floor' : 'gap',
        perBookCapChars: cap,
        perBookCapViolations: capViolations,
      });
    }
  }
  const hardFloorPass = cells.every((cell) => cell.chars >= cell.hardFloor);
  const capPass = cells.every((cell) => cell.perBookCapViolations.length === 0);
  return {
    status: hardFloorPass && capPass ? 'pass' : 'blocked',
    hardFloorPass,
    capPass,
    targetMet: cells.every((cell) => cell.status === 'target'),
    cells,
    totalChars: cells.reduce((sum, cell) => sum + cell.chars, 0),
    hardFloor: config.cellHardFloor,
    target: config.cellMinChars,
  };
}

function publicSample(record, patternIds, antiPatternIds) {
  const sample = record.sample;
  const archetypeDistribution = Object.fromEntries(
    ARCHETYPE_WHITELIST
      .filter((label) => Number.isFinite(Number(record.person.archetypeDistribution?.[label])))
      .map((label) => [label, Number(record.person.archetypeDistribution[label])])
  );
  const samplePatterns = asArray(sample.microPatternDetails).map((detail) => {
    if (!isObject(detail)) return '';
    const dimension = DIMENSION_WHITELIST.includes(detail.dimension) ? detail.dimension : null;
    const normalized = {
      dimension,
      scene: listField(detail.scene, SCENE_WHITELIST),
      relationship: listField(detail.relationship, RELATIONSHIP_WHITELIST),
      signals: listField(detail.signals, HTL_WHITELIST),
      pattern: asArray(detail.pattern).map(text).filter(Boolean),
    };
    return patternIds.get(patternKey(normalized)) || '';
  }).filter(Boolean);
  const sampleAntiPatterns = asArray(sample.antiPatterns).map((value) => antiPatternIds.get(text(value)) || '').filter(Boolean);
  return {
    id: publicationRecordId(record),
    source: {
      sourceWorkId: text(record.source.sourceWorkId),
      canonicalWorkId: text(record.source.canonicalWorkId),
      platform: text(record.source.platform),
      completionStatus: text(record.source.completionStatus),
      rawGenres: asArray(record.source.rawGenres).map(text).filter(Boolean),
      primaryGenre: text(record.source.primaryGenre),
      audience: text(record.source.audience),
    },
    archetype: {
      primaryArchetype: record.person.primaryArchetype,
      archetypeDistribution,
      stateArchetype: asArray(record.person.stateArchetype).map(text).filter(Boolean),
    },
    sample: {
      safeText: sample.safeText,
      sourceHash: normalizedTextHash(sample.safeText),
      dimension: sample.dimension,
      scene: listField(sample.scene, SCENE_WHITELIST),
      relationship: listField(sample.relationship, RELATIONSHIP_WHITELIST),
      emotionalState: listField(sample.emotionalState, EMOTIONAL_STATE_WHITELIST),
      surfaceIntent: text(sample.surfaceIntent),
      subtext: subtextLabel(sample.subtext) || null,
      humanTextureSignals: listField(sample.humanTextureSignals, HTL_WHITELIST),
      microPatterns: unique(samplePatterns),
      antiPatterns: unique(sampleAntiPatterns),
    },
    safety: {
      residualTerms: [],
      residualTermsCount: 0,
      textOverlap: { blocked: false, maxContinuousOverlap: 0 },
      anonymizationScore: Number(record.safety.anonymizationScore),
    },
    quality: {
      grade: record.quality.grade,
      confidence: record.quality.confidence,
    },
  };
}

function buildGateSummary(recordChecks, sourceChecks, manualReview, quota) {
  return {
    schema: recordChecks.every((check) => check.rich.hardGate.schema && check.rich.valid),
    originalText: recordChecks.every((check) => check.evidence.originalText),
    sourceCompleteness: sourceChecks.every((check) => check.evidence.completeness),
    fullWorkEvidence: sourceChecks.every((check) => check.evidence.fullWorkEvidence),
    contentHash: sourceChecks.every((check) => check.evidence.contentHash),
    completionEvidence: sourceChecks.every((check) => check.evidence.completionEvidence),
    source: sourceChecks.every((check) => check.status === 'pass'),
    authorization: sourceChecks.every((check) => check.authorization.status === 'pass'),
    residualTerms: recordChecks.every((check) => check.rich.hardGate.residualTerms && check.rich.residualTerms.length === 0),
    twelveCharacterOverlap: recordChecks.every((check) => !check.overlap.blocked),
    htlEvidence: recordChecks.every((check) => check.htl.evidenceComplete),
    manualReview: manualReview.status === 'pass',
    quotaHardFloor: quota.status === 'pass' && quota.hardFloorPass,
    quotaPerBookCap: quota.status === 'pass' && quota.capPass,
  };
}

function publicationStatus(gates, missing, blockers) {
  if (blockers.length) return 'blocked';
  if (missing.length || Object.values(gates).some((value) => value !== true)) return 'pending';
  return 'published';
}

function evaluateVersions(versions) {
  const required = ['corpusVersion', 'runtimeVersion', 'ruleVersion', 'profileVersion', 'evalVersion'];
  if (!isObject(versions)) return { status: 'pending', missing: ['versions'], values: {} };
  const missing = required.filter((field) => !text(versions[field]));
  return {
    status: missing.length ? 'pending' : 'pass',
    missing: missing.map((field) => `versions.${field}`),
    values: Object.fromEntries(required.map((field) => [field, text(versions[field])])),
  };
}

function evaluateResearchLoop(researchLoop) {
  if (!isObject(researchLoop)) return { status: 'pending', missing: ['researchLoop'], cases: { best: 0, worst: 0, disagreements: 0 } };
  const cases = {
    best: asArray(researchLoop.bestCases).length,
    worst: asArray(researchLoop.worstCases).length,
    disagreements: asArray(researchLoop.disagreementCases).length,
  };
  const complete = cases.best >= 10 && cases.worst >= 10 && cases.disagreements >= 10;
  return {
    status: complete ? 'pass' : 'pending',
    missing: complete ? [] : ['researchLoop.minimumCases'],
    cases,
  };
}

export function publishMaterials(input = {}) {
  const records = Array.isArray(input) ? input : asArray(input.records);
  const missing = [];
  const blockers = [];
  if (!records.length) missing.push('records');
  const quotaResult = normalizeQuotaConfig(input.quotaConfig);
  if (quotaResult.missing.length) missing.push(...quotaResult.missing);
  if (quotaResult.errors.length) blockers.push(...quotaResult.errors);
  const versions = evaluateVersions(input.versions);
  missing.push(...versions.missing);
  const researchLoop = evaluateResearchLoop(input.researchLoop);
  missing.push(...researchLoop.missing);
  const references = sampleReferences(records, input.referenceTexts);
  const recordChecks = records.map((record, index) => {
    const currentId = publicationRecordId(record, index);
    return evaluateRecord(record, references.filter((reference) => reference.id !== currentId), index);
  });
  const sourceChecks = records.map((record) => evaluateSource(record, input.authorizationPolicy));
  for (const check of recordChecks) blockers.push(...check.blockers.map((reason) => `${check.id || 'unknown'}: ${reason}`));
  for (const check of sourceChecks) {
    blockers.push(...check.blockers.map((reason) => `${check.id || 'source'}: ${reason}`));
    missing.push(...check.missing);
  }
  const manualReview = evaluateManualReview(records, input.manualReview);
  missing.push(...manualReview.missing);
  blockers.push(...manualReview.blockers.map((id) => `${id}: manual review rejected`));
  const safeRecords = eligibleRecords(records, new Map(records.map((record, index) => [record, recordChecks[index].status === 'pass' && sourceChecks[index].status === 'pass'])));
  for (const record of safeRecords) {
    if (!asArray(record.sample?.microPatternDetails).length) missing.push('sample.microPatternDetails');
    if (!asArray(record.sample?.antiPatterns).map(text).filter(Boolean).length) missing.push('sample.antiPatterns');
  }
  const microPatternResult = buildMicroPatterns(safeRecords);
  if (microPatternResult.invalidRecordIds.length) blockers.push('invalid structural MicroPattern');
  if (!microPatternResult.patterns.length) missing.push('sample.microPatternDetails');
  const antiPatterns = buildAntiPatterns(safeRecords);
  if (!antiPatterns.length) missing.push('sample.antiPatterns');
  const htlReviewIds = new Set(asArray(input.manualReview?.htlReviewedIds).map(text));
  if (safeRecords.some((record, index) => !htlReviewIds.has(publicationRecordId(record, index)))) missing.push('manualReview.htlReviewedIds');
  const quota = buildQuotaReport(safeRecords, input.quotaConfig);
  if (quota.status === 'blocked') blockers.push('quota hard gate failed');
  if (quota.status === 'pending') missing.push(...(quota.missing || ['quotaConfig']));
  const gates = buildGateSummary(recordChecks, sourceChecks, manualReview, quota);
  gates.versionMetadata = versions.status === 'pass';
  gates.researchLoop = researchLoop.status === 'pass';
  const profiles = buildProfiles(safeRecords, {
    ...(quotaResult.config || {}),
    microPatterns: microPatternResult.patterns,
    antiPatterns,
  });
  const diversity = buildDiversityStats(safeRecords);
  const offlineIndex = buildOfflineIndex(safeRecords, quotaResult.config || {});
  const rules = buildRuleCards(microPatternResult.patterns, antiPatterns);
  const patternIds = new Map(microPatternResult.patterns.map((pattern) => [patternKey(pattern), pattern.id]));
  const antiPatternIds = new Map(antiPatterns.map((pattern) => [pattern.antiPattern, pattern.id]));
  const status = publicationStatus(gates, unique(missing), unique(blockers));
  const publishedSamples = status === 'published' ? safeRecords.map((record) => publicSample(record, patternIds, antiPatternIds)) : [];
  const publicData = {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    published: status === 'published',
    samples: publishedSamples,
    microPatterns: status === 'published' ? microPatternResult.patterns : [],
    rules: status === 'published' ? rules : [],
    antiPatterns: status === 'published' ? antiPatterns : [],
    profiles: status === 'published' ? profiles : {},
    diversity: status === 'published' ? diversity : buildDiversityStats([]),
    index: status === 'published' ? offlineIndex : { runtimeCompatibility: offlineIndex.runtimeCompatibility },
  };
  const result = {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    status,
    published: status === 'published',
    missing: unique(missing),
    blockers: unique(blockers),
    gates,
    manualReview: {
      required: true,
      provided: manualReview.provided,
      approved: manualReview.approved,
      status: manualReview.status,
      reviewedCount: manualReview.reviewedCount,
      htlEvidenceReviewedCount: manualReview.htlEvidenceReviewedCount || 0,
    },
    versions: versions.values,
    researchLoop,
    htl: {
      validity: 'unverified',
      evidenceOnly: true,
      note: 'HTL 标签仅按 Rich Intermediate 中的原文证据检查，未伪造人工有效性结论。',
    },
    source: {
      checked: sourceChecks.length,
      passed: sourceChecks.filter((check) => check.status === 'pass').length,
      pending: sourceChecks.filter((check) => check.status === 'pending').length,
      blocked: sourceChecks.filter((check) => check.status === 'blocked').length,
    },
    quota,
    publicData,
  };
  result.markdown = renderPublicationMarkdown(result);
  return result;
}

export function renderPublicationMarkdown(publication) {
  const data = publication?.publicData || {};
  const lines = [
    '# 人物描写素材库发布版',
    '',
    `- schemaVersion: ${text(publication?.schemaVersion)}`,
    `- status: ${text(publication?.status)}`,
    `- published: ${publication?.published === true}`,
    `- manualReview: ${publication?.manualReview?.status || 'pending'}`,
    `- HTL validity: ${publication?.htl?.validity || 'unverified'}`,
    `- versions: ${JSON.stringify(publication?.versions || {})}`,
    `- researchLoop: ${publication?.researchLoop?.status || 'pending'}`,
    '',
    '## 门禁摘要',
    '',
  ];
  for (const [name, value] of Object.entries(publication?.gates || {})) lines.push(`- ${name}: ${value}`);
  lines.push('', '## 多样性统计', '', '```json', JSON.stringify(data.diversity || {}, null, 2), '```', '', '## Offline Index', '', '```json', JSON.stringify(data.index || {}, null, 2), '```', '', '## Profiles', '');
  for (const profile of Object.values(data.profiles || {})) lines.push(`### ${profile.key}`, '', '```json', JSON.stringify(profile, null, 2), '```', '');
  lines.push('## MicroPatterns', '');
  for (const pattern of data.microPatterns || []) lines.push(`### ${pattern.id}`, '', `- dimension: ${pattern.dimension}`, `- scene: ${(pattern.scene || []).join('、')}`, `- relationship: ${(pattern.relationship || []).join('、')}`, `- pattern: ${(pattern.pattern || []).join(' -> ')}`, '');
  lines.push('## Rules', '');
  for (const rule of data.rules || []) lines.push(`### ${rule.id}`, '', `- when: ${(rule.scene || []).join('、') || '未限定'} / ${(rule.relationship || []).join('、') || '未限定'}`, `- rule: ${rule.rule}`, `- application: ${rule.application}`, `- caution: ${rule.caution}`, '');
  lines.push('## AntiPatterns', '');
  for (const antiPattern of data.antiPatterns || []) lines.push(`- ${antiPattern.id}: ${antiPattern.antiPattern}`);
  lines.push('', '## Samples', '');
  for (const item of data.samples || []) {
    lines.push(`### ${item.id}`, '', `- sourceWorkId: ${item.source.sourceWorkId}`, `- platform: ${item.source.platform}`, `- archetype: ${item.archetype.primaryArchetype}`, `- dimension: ${item.sample.dimension}`, `- scene: ${(item.sample.scene || []).join('、')}`, `- relationship: ${(item.sample.relationship || []).join('、')}`, `- subtext: ${item.sample.subtext || ''}`, `- safeText: ${item.sample.safeText}`, '');
  }
  return lines.join('\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    options[key] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return options;
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  let input = {};
  const errors = [];
  try {
    if (!options.input) errors.push('missing --input');
    else {
      const inputJson = readJson(path.resolve(String(options.input)));
      input = Array.isArray(inputJson) ? { records: inputJson } : { ...inputJson };
    }
    if (options.quota) input.quotaConfig = readJson(path.resolve(String(options.quota)));
    if (options['manual-review']) input.manualReview = readJson(path.resolve(String(options['manual-review'])));
    if (options.references) input.referenceTexts = readJson(path.resolve(String(options.references)));
  } catch (error) {
    errors.push(`input read failed: ${error.message}`);
  }
  const result = errors.length ? publishMaterials({ ...input, records: [] }) : publishMaterials(input);
  if (errors.length) {
    result.status = 'pending';
    result.published = false;
    result.missing = unique([...errors, ...result.missing]);
    result.publicData = { ...result.publicData, published: false, samples: [], rules: [], microPatterns: [], antiPatterns: [], profiles: {} };
    result.markdown = renderPublicationMarkdown(result);
  }
  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(String(options.out))), { recursive: true });
    fs.writeFileSync(path.resolve(String(options.out)), `${JSON.stringify({ ...result, markdown: undefined }, null, 2)}\n`, 'utf8');
  }
  if (options.markdown) {
    fs.mkdirSync(path.dirname(path.resolve(String(options.markdown))), { recursive: true });
    fs.writeFileSync(path.resolve(String(options.markdown)), result.markdown, 'utf8');
  }
  return result;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const result = runCli();
  process.stdout.write(`${JSON.stringify({ status: result.status, published: result.published, missing: result.missing, blockers: result.blockers }, null, 2)}\n`);
  if (result.status !== 'published') process.exitCode = 2;
}
