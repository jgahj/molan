import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARCHETYPE_WHITELIST,
} from '../lib/character-material-v31.mjs';
import {
  buildDiversityStats,
  buildOfflineIndex,
  buildMicroPatterns,
  buildProfiles,
  publicationRecordId,
  publishMaterials,
  renderPublicationMarkdown,
} from '../scripts/material-publication.mjs';

const BUCKETS = {
  言情: ['言情'],
  男频玄幻: ['玄幻'],
  都市: ['都市'],
  悬疑: ['悬疑'],
};

const QUOTA = {
  archetypes: ARCHETYPE_WHITELIST,
  genreBuckets: BUCKETS,
  sourceBucketMap: { 言情: '言情', 玄幻: '男频玄幻', 都市: '都市', 悬疑: '悬疑' },
  cellHardFloor: 12,
  cellMinChars: 12,
  perBookCellCapChars: 1000,
};

const VERSIONS = {
  corpusVersion: 'corpus-v3.1-test',
  runtimeVersion: 'runtime-deferred-test',
  ruleVersion: 'rules-v3.1-test',
  profileVersion: 'profile-v3.1-test',
  evalVersion: 'eval-pending-test',
};

const RESEARCH_LOOP = {
  bestCases: Array.from({ length: 10 }, (_, index) => `best-${index + 1}`),
  worstCases: Array.from({ length: 10 }, (_, index) => `worst-${index + 1}`),
  disagreementCases: Array.from({ length: 10 }, (_, index) => `disagreement-${index + 1}`),
};

function richRecord(index, overrides = {}) {
  const archetype = ARCHETYPE_WHITELIST[index % ARCHETYPE_WHITELIST.length];
  const bucket = Object.keys(BUCKETS)[Math.floor(index / ARCHETYPE_WHITELIST.length) % 4];
  const genre = BUCKETS[bucket][0];
  const id = `sample-${index + 1}`;
  const safeText = `这个人${index + 1}轻敲杯沿后回应问题。`;
  const record = {
    schemaVersion: 'corpus-v3.1-rich-1',
    id,
    source: {
      sourceWorkId: `work-${index + 1}`,
      canonicalWorkId: `work-${index + 1}`,
      platform: ['起点', '番茄', '七猫', '晋江'][index % 4],
      title: `作品${index + 1}`,
      author: `作者${index + 1}`,
      completionStatus: 'completed',
      rawGenres: [genre],
      primaryGenre: genre,
      audience: '男频',
      partial: false,
      incomplete: false,
      contentScope: 'full_work',
      contentHash: 'c'.repeat(64),
      contentHashVerified: true,
      completionEvidenceRef: `completion-${index + 1}`,
      completionEvidenceSha256: 'd'.repeat(64),
      completionEvidenceVerified: true,
      fullWorkEvidence: {
        evidenceRef: `full-work-${index + 1}`,
        evidenceSha256: 'f'.repeat(64),
        verified: true,
      },
      authorization: {
        status: 'open_license',
        scope: 'corpus',
        evidenceRef: `auth-${index + 1}`,
        evidenceSha256: 'a'.repeat(64),
        evidenceVerified: true,
        archiveUseAllowed: true,
        modelProcessingAllowed: true,
        runtimeUseAllowed: true,
      },
    },
    person: {
      personId: `person-${index + 1}`,
      canonicalName: `内部人物${index + 1}`,
      primaryArchetype: archetype,
      archetypeDistribution: { [archetype]: 1 },
      stateArchetype: ['平时状态'],
    },
    sample: {
      rawText: `内部人物${index + 1}轻敲杯沿后回应问题。`,
      safeText,
      auditText: safeText,
      dimension: ['dialogue', 'action', 'expression'][index % 3],
      secondaryDimensions: [],
      scene: ['试探'],
      relationship: ['暧昧对象'],
      emotionalState: ['紧张'],
      surfaceIntent: '询问',
      subtext: { label: '试探', evidence: ['没有直接回答，先敲了敲杯沿。'] },
      subtextEvidence: ['没有直接回答，先敲了敲杯沿。'],
      humanTextureSignals: ['avoidance'],
      humanTextureEvidence: { avoidance: ['没有直接回答，先敲了敲杯沿。'] },
      microPatternDetails: [{
        dimension: 'dialogue',
        scene: ['试探'],
        relationship: ['暧昧对象'],
        signals: ['avoidance'],
        pattern: ['先避开核心问题', '处理一个无关的小动作', '再给出表面回答'],
        whyItWorks: '让读者从延迟和动作推断情绪。',
        antiPattern: '情绪标签后紧跟微表情解释',
      }],
      antiPatterns: ['动作三连'],
      evidence: { chapterIndex: index + 1, paragraphIndex: 1, charStart: 0, charEnd: safeText.length },
    },
    safety: {
      forbiddenTerms: [],
      forbiddenTermLayers: { coreTerms: [], localTerms: [], globalRiskTerms: [] },
      residualTerms: [],
      residualTermsByTrack: { safe: [], audit: [] },
      textOverlap: { blocked: false, maxContinuousOverlap: 0 },
      anonymizationScore: 1,
    },
    quality: { grade: 'A', confidence: 0.9 },
  };
  return {
    ...record,
    ...overrides,
  };
}

function manualReview(records) {
  return {
    reviewedIds: records.map((record, index) => publicationRecordId(record, index)),
    htlReviewedIds: records.map((record, index) => publicationRecordId(record, index)),
    approved: true,
  };
}

test('缺少 Rich、授权和人工审核输入时只返回 pending，不生成公开样本', () => {
  const result = publishMaterials({ quotaConfig: QUOTA });
  assert.equal(result.status, 'pending');
  assert.equal(result.published, false);
  assert.ok(result.missing.includes('records'));
  assert.equal(result.publicData.samples.length, 0);
  assert.equal(result.manualReview.approved, false);
});

test('残留词与 12 字重合是 blocked，且不会被人工审核字段掩盖', () => {
  const first = richRecord(0);
  const second = richRecord(1, {
    sample: { ...richRecord(1).sample, safeText: `${first.sample.safeText}追加内容。`, auditText: `${first.sample.safeText}追加内容。` },
  });
  second.safety = { ...second.safety, forbiddenTerms: ['追加内容'], forbiddenTermLayers: { coreTerms: ['追加内容'], localTerms: [], globalRiskTerms: [] } };
  const records = [first, second];
  const result = publishMaterials({ records, quotaConfig: QUOTA, manualReview: manualReview(records) });
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.some((item) => item.includes('residual')));
  assert.ok(result.blockers.some((item) => item.includes('overlap')));
  assert.equal(result.publicData.samples.length, 0);
});

test('授权证据缺失时保持 pending，不把 Rich 来源字段当作授权', () => {
  const record = richRecord(0);
  delete record.source.authorization;
  const result = publishMaterials({
    records: [record],
    quotaConfig: QUOTA,
    manualReview: manualReview([record]),
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.gates.authorization, false);
  assert.ok(result.missing.includes('source.authorization'));
  assert.equal(result.publicData.samples.length, 0);
});

test('生成三层 profile、结构性 MicroPattern、Rule card 和多维统计', () => {
  const records = [richRecord(0), richRecord(1)];
  const patterns = buildMicroPatterns(records);
  assert.equal(patterns.invalidRecordIds.length, 0);
  assert.equal(patterns.patterns.length, 1);
  assert.deepEqual(patterns.patterns[0].pattern, ['先避开核心问题', '处理一个无关的小动作', '再给出表面回答']);
  const profiles = buildProfiles(records, { ...QUOTA, profileMinimumWorks: 8 });
  const profile = Object.values(profiles)[0];
  assert.equal(profile.primaryArchetype, ARCHETYPE_WHITELIST[0]);
  assert.equal(profile.fallback, true);
  assert.ok(Array.isArray(profile.commonMicroPatterns));
  const index = buildOfflineIndex(records, QUOTA);
  assert.equal(index.primary.dimension.dialogue.length, 1);
  assert.equal(index.secondary.scene['试探'].length, 2);
  const stats = buildDiversityStats(records);
  assert.equal(stats.dimensions.distinct.length, 2);
  assert.equal(stats.scenes.distinct[0], '试探');
  assert.equal(stats.works.distinct.length, 2);
});

test('所有显式门禁通过时只发布白名单字段和匿名化 safeText', () => {
  const records = Array.from({ length: 40 }, (_, index) => richRecord(index));
  const result = publishMaterials({ records, quotaConfig: QUOTA, manualReview: manualReview(records), versions: VERSIONS, researchLoop: RESEARCH_LOOP });
  assert.equal(result.status, 'published');
  assert.equal(result.gates.quotaHardFloor, true);
  assert.equal(result.htl.validity, 'unverified');
  assert.deepEqual(result.versions, VERSIONS);
  assert.equal(result.researchLoop.status, 'pass');
  assert.equal(result.publicData.samples.length, 40);
  assert.deepEqual(result.publicData.samples[0].sample.microPatterns, ['mp-001']);
  assert.deepEqual(result.publicData.samples[0].sample.antiPatterns, ['ap-001']);
  assert.equal(typeof result.publicData.samples[0].sample.subtext, 'string');
  assert.equal(result.publicData.samples[0].sample.subtext, '试探');
  assert.equal(result.publicData.samples[0].sample.sourceHash.length, 64);
  assert.deepEqual(Object.keys(result.publicData.samples[0].sample).sort(), [
    'antiPatterns',
    'dimension',
    'emotionalState',
    'humanTextureSignals',
    'microPatterns',
    'relationship',
    'safeText',
    'scene',
    'sourceHash',
    'subtext',
    'surfaceIntent',
  ]);
  const markdown = renderPublicationMarkdown(result);
  assert.equal(markdown.includes('rawText'), false);
  assert.equal(markdown.includes('auditText'), false);
  assert.equal(markdown.includes('没有直接回答，先敲了敲杯沿'), false);
  assert.equal(markdown.includes('内部人物'), false);
  assert.ok(markdown.includes('safeText:'));
  assert.equal(Object.prototype.hasOwnProperty.call(result.publicData.samples[0].sample, 'rawText'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.publicData.samples[0].sample, 'evidence'), false);
});

test('partial、incomplete 或未验证全文来源不得进入 safeRecords 或公开数据', () => {
  for (const field of ['partial', 'incomplete']) {
    const record = richRecord(0, { source: { ...richRecord(0).source, [field]: true } });
    const result = publishMaterials({ records: [record], quotaConfig: QUOTA, manualReview: manualReview([record]) });
    assert.equal(result.status, 'blocked');
    assert.equal(result.publicData.samples.length, 0);
    assert.ok(result.blockers.some((item) => item.includes(`source.${field}`)));
  }

  const unverified = richRecord(0, {
    source: { ...richRecord(0).source, fullWorkEvidenceVerified: false },
  });
  const result = publishMaterials({ records: [unverified], quotaConfig: QUOTA, manualReview: manualReview([unverified]) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.publicData.samples.length, 0);
  assert.ok(result.blockers.some((item) => item.includes('fullWorkEvidence.verified')));
});

test('缺失全文 evidence 或 hash 时保持 pending，不生成公开样本', () => {
  const record = richRecord(0);
  delete record.source.fullWorkEvidence;
  delete record.source.fullWorkEvidenceRef;
  delete record.source.fullWorkEvidenceSha256;
  const result = publishMaterials({ records: [record], quotaConfig: QUOTA, manualReview: manualReview([record]) });
  assert.equal(result.status, 'pending');
  assert.equal(result.publicData.samples.length, 0);
  assert.ok(result.missing.includes('source.fullWorkEvidence.evidenceRef'));
  assert.ok(result.missing.includes('source.fullWorkEvidence.evidenceSha256'));
});

test('缺失样本原文时阻断原文准入，即使其他来源证据完整', () => {
  const record = richRecord(0);
  delete record.sample.rawText;
  const result = publishMaterials({ records: [record], quotaConfig: QUOTA, manualReview: manualReview([record]) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.gates.originalText, false);
  assert.equal(result.publicData.samples.length, 0);
});

test('来源内容、全文、完结和授权证据必须使用有效 SHA-256', () => {
  const cases = [
    ['source.contentHash', record => { record.source.contentHash = 'not-a-hash'; }],
    ['source.fullWorkEvidence.evidenceSha256', record => { record.source.fullWorkEvidence.evidenceSha256 = 'not-a-hash'; }],
    ['source.completionEvidenceSha256', record => { record.source.completionEvidenceSha256 = 'not-a-hash'; }],
    ['authorization.evidenceSha256', record => { record.source.authorization.evidenceSha256 = 'not-a-hash'; }],
  ];
  for (const [field, mutate] of cases) {
    const record = richRecord(0);
    mutate(record);
    const result = publishMaterials({ records: [record], quotaConfig: QUOTA, manualReview: manualReview([record]) });
    assert.equal(result.status, 'blocked', field);
    assert.equal(result.publicData.samples.length, 0, field);
    assert.ok(result.blockers.some(reason => reason.includes('valid SHA-256')), field);
  }
});

test('嵌套与扁平全文证据字段冲突时不得发布', () => {
  const record = richRecord(0, {
    source: {
      ...richRecord(0).source,
      fullWorkEvidenceSha256: 'e'.repeat(64),
    },
  });
  const result = publishMaterials({ records: [record], quotaConfig: QUOTA, manualReview: manualReview([record]) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.publicData.samples.length, 0);
  assert.ok(result.blockers.some(reason => reason.includes('evidenceSha256 conflict')));
});
