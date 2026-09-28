import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARCHETYPE_WHITELIST,
  DIMENSION_WHITELIST,
  EMOTIONAL_STATE_WHITELIST,
  HTL_WHITELIST,
  RELATIONSHIP_WHITELIST,
  SCENE_WHITELIST,
  SUBTEXT_WHITELIST,
  annotateCandidate,
  buildRichIntermediate,
  candidateMine,
  canonicalizeText,
  gradeCandidate,
  mergeForbiddenTerms,
  scanResidualTerms,
  scanTextOverlap,
  validateRichRecord,
} from '../lib/character-material-v31.mjs';

const SOURCE = {
  sourceWorkId: 'demo-work',
  canonicalWorkId: 'demo-work',
  platform: '起点',
  title: '测试作品',
  author: '测试作者',
  completionStatus: 'completed',
};

const PERSON = {
  personId: 'p-001',
  canonicalName: '内部人物',
  primaryArchetype: '冷静理智型',
  archetypeDistribution: {
    冷静理智型: 0.7,
    温柔内敛型: 0.3,
  },
  stateArchetype: ['担忧时的嘴硬状态'],
};

function validAnnotations(overrides = {}) {
  return {
    source: SOURCE,
    person: PERSON,
    dimension: 'dialogue',
    scene: ['试探'],
    relationship: ['暧昧对象'],
    emotionalState: ['紧张', '嘴硬'],
    surfaceIntent: '询问',
    subtext: {
      label: '寻求确认',
      evidence: ['他先说不在意，又追问对方是否真的要走。'],
    },
    humanTextureSignals: ['avoidance', 'speech_vs_action'],
    humanTextureEvidence: {
      avoidance: ['他没有接住问题，只把杯子推远。'],
      speech_vs_action: ['嘴上说随便，手却按住了门把。'],
    },
    microPatterns: ['先回避直接回答，再用动作暴露真实关注'],
    antiPatterns: ['直接解释人物情绪'],
    safeText: '“随你。”他说着，却按住了将要关上的门。',
    auditText: '“随你。”他说着，却按住了将要关上的门。',
    evidence: {
      chapterIndex: 12,
      paragraphIndex: 34,
      charStart: 10,
      charEnd: 32,
    },
    ...overrides,
  };
}

test('all v3.1 whitelists are fixed and contain the required sets', () => {
  assert.deepEqual(DIMENSION_WHITELIST, [
    'appearance',
    'expression',
    'action',
    'dialogue',
    'catchphrase',
    'psychology',
  ]);
  assert.equal(SCENE_WHITELIST.includes('试探'), true);
  assert.equal(RELATIONSHIP_WHITELIST.includes('暧昧对象'), true);
  assert.equal(EMOTIONAL_STATE_WHITELIST.includes('嘴硬'), true);
  assert.equal(SUBTEXT_WHITELIST.includes('拒绝但挽留'), true);
  assert.equal(HTL_WHITELIST.includes('speech_vs_action'), true);
  assert.equal(HTL_WHITELIST.includes('implicit_emotion'), true);
  assert.equal(ARCHETYPE_WHITELIST.length, 10);
  assert.equal(ARCHETYPE_WHITELIST.includes('热血冲动型'), true);
});

test('candidateMine recalls seven low-cost categories with stable dedupe and chapter evidence', () => {
  const chapterText = [
    '她抿住嘴角，低头整理袖口，半天没有回答。',
    '“随你。”他说着，却按住了将要关上的门。',
    '“随你。”他说着，又把那句话重复了一遍。',
    '他摸了摸口袋，才想起钥匙忘在桌上，心里有些担心。',
  ];
  const candidates = candidateMine({ chapters: chapterText.map((text, index) => ({ chapterIndex: index + 10, text })) }, {
    sourceWorkId: 'work-1',
  });
  assert.ok(candidates.length >= 3);
  assert.equal(new Set(candidates.map((candidate) => canonicalizeText(candidate.text))).size, candidates.length);
  assert.equal(candidates.every((candidate) => candidate.text.length >= 12 && candidate.text.length <= 140), true);
  assert.equal(candidates.some((candidate) => candidate.recallKinds.includes('appearance')), true);
  assert.equal(candidates.some((candidate) => candidate.recallKinds.includes('dialogue')), true);
  assert.equal(candidates.some((candidate) => candidate.recallKinds.includes('catchphrase')), true);
  assert.equal(candidates.some((candidate) => candidate.recallKinds.includes('lifeTexture')), true);
  assert.equal(candidates.every((candidate) => candidate.evidence.chapterIndex >= 10), true);
  assert.equal(candidates.every((candidate) => candidate.chapterEvidence.length >= 1), true);
  assert.equal(candidates.find((candidate) => candidate.recallKinds.includes('catchphrase')).chapters.length >= 1, true);
});

test('candidateMine accepts a single chapter and preserves relative character coordinates', () => {
  const candidates = candidateMine('他把杯子推到她面前，随后才低声问她是不是还在生气。', {
    chapterIndex: 7,
    charOffset: 100,
  });
  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].evidence.chapterIndex, 7);
  assert.equal(candidates[0].evidence.charStart, 100);
  assert.equal(candidates[0].evidence.charEnd > candidates[0].evidence.charStart, true);
});

test('annotateCandidate builds rich schema with both text tracks and evidence', () => {
  const record = annotateCandidate({
    id: 'candidate-1',
    text: '“随你。”他说着，却按住了将要关上的门。',
    evidence: { chapterIndex: 12, paragraphIndex: 34, charStart: 10, charEnd: 32 },
  }, validAnnotations());
  assert.equal(record.schemaVersion, 'corpus-v3.1-rich-1');
  assert.deepEqual(Object.keys(record).sort(), ['person', 'quality', 'safety', 'sample', 'schemaVersion', 'source']);
  assert.equal(record.sample.rawText.length >= 12, true);
  assert.equal(record.sample.safeText, '“随你。”他说着，却按住了将要关上的门。');
  assert.equal(record.sample.auditText, record.sample.safeText);
  assert.deepEqual(record.sample.subtextEvidence, ['他先说不在意，又追问对方是否真的要走。']);
  assert.deepEqual(record.sample.humanTextureEvidence.avoidance, ['他没有接住问题，只把杯子推远。']);
  assert.equal(record.sample.evidence.chapterIndex, 12);
  assert.equal(record.safety.residualTerms.length, 0);
  assert.deepEqual(record.safety.forbiddenTermLayers, {
    coreTerms: [],
    localTerms: [],
    globalRiskTerms: [],
  });
  assert.notEqual(record.sample.normalizedTextHash, undefined);
  assert.equal(validateRichRecord(record).valid, true);
});

test('micro patterns retain structural steps and reject fixed sentence templates', () => {
  const structured = annotateCandidate({ text: '他移开视线，整理了一下袖口，才用平静的语气回答她。' }, validAnnotations({
    safeText: '他移开视线，整理了一下袖口，才用平静的语气回答她。',
    auditText: '他移开视线，整理了一下袖口，才用平静的语气回答她。',
    microPatterns: [{
      id: 'mp-structural-1',
      dimension: 'expression',
      scene: ['误解'],
      relationship: ['亲密朋友'],
      signals: ['avoidance', 'speech_vs_action'],
      pattern: ['先回避直接回应', '做一个与话题无关的小动作', '再用表面平静的方式回答'],
      whyItWorks: '情绪通过行为露出，不直接替读者下结论。',
      antiPattern: '直接写出人物的完整心理结论。',
    }],
  }));
  assert.deepEqual(structured.sample.microPatterns, ['mp-structural-1']);
  assert.deepEqual(structured.sample.microPatternDetails[0].pattern, [
    '先回避直接回应',
    '做一个与话题无关的小动作',
    '再用表面平静的方式回答',
  ]);
  assert.equal(validateRichRecord(structured).valid, true);

  const template = annotateCandidate({ text: '他移开视线，整理了一下袖口，才用平静的语气回答她。' }, validAnnotations({
    safeText: '他移开视线，整理了一下袖口，才用平静的语气回答她。',
    auditText: '他移开视线，整理了一下袖口，才用平静的语气回答她。',
    microPatterns: [{
      id: 'mp-invalid-1',
      dimension: 'expression',
      pattern: ['先回避直接回应'],
      template: '他垂下眼眸，淡淡道……',
    }],
  }));
  assert.equal(validateRichRecord(template).valid, false);
  assert.ok(template.quality.labelErrors.some((error) => error.includes('template')));
});

test('forbidden terms merge core, local, and global risk layers stably with traditional/simplified scanning', () => {
  const merged = mergeForbiddenTerms(
    { coreTerms: ['角色甲', '視線'], localTerms: ['角色乙'], globalRiskTerms: ['IP名'] },
    { coreTerms: ['角色甲'], localTerms: ['視線'] },
  );
  assert.deepEqual(merged.coreTerms, ['角色甲', '視線']);
  assert.deepEqual(merged.localTerms, ['角色乙', '視線']);
  assert.deepEqual(merged.globalRiskTerms, ['IP名']);
  assert.deepEqual(merged.all, ['角色甲', '視線', '角色乙', 'IP名']);
  assert.deepEqual(scanResidualTerms('他移开了视线。', ['視線']), ['視線']);
  assert.deepEqual(scanResidualTerms('没有禁词。', merged), []);
});

test('scanTextOverlap blocks 12-character overlap and exact/hash/4-gram duplicates', () => {
  const source = '他把手机扣在桌上过了一会儿才抬头看她的眼睛。';
  const hard = scanTextOverlap(`前文${source}后文`, [source]);
  assert.equal(hard.blocked, true);
  assert.equal(hard.hardGate, false);
  assert.equal(hard.hardMatches.length >= 1, true);
  assert.equal(hard.maxContinuousOverlap >= 12, true);

  const exact = scanTextOverlap(source, [{ id: 'same', text: source }]);
  assert.equal(exact.exactDuplicate, true);
  assert.equal(exact.blocked, true);

  const near = scanTextOverlap('abcdefghijklmno', ['abcdefghijklmnp'], { fourGramThreshold: 0.7 });
  assert.equal(near.fourGramDuplicate, true);
  assert.equal(near.blocked, true);

  const clean = scanTextOverlap('完全不同的一段人物描写素材。', [source]);
  assert.equal(clean.pass, true);
  assert.equal(clean.length, 0);
});

test('validateRichRecord rejects residual terms, invalid labels, missing subtext evidence, and HTL evidence gaps', () => {
  const record = annotateCandidate({ text: '他没有回答，只把视线移向窗外。' }, validAnnotations({
    safeText: '他没有回答，只把视线移向窗外。',
    auditText: '他没有回答，只把视线移向窗外。',
    forbiddenTerms: { coreTerms: ['视线'] },
    scene: ['不存在的场景'],
    subtext: { label: '嘴硬' },
    humanTextureSignals: ['avoidance', 'pause'],
    humanTextureEvidence: { avoidance: ['他没有直接回答。'] },
  }));
  const result = validateRichRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('residual')));
  assert.ok(result.errors.some((error) => error.includes('whitelist')));
  assert.ok(result.errors.some((error) => error.includes('subtextEvidence')));
  assert.ok(result.errors.some((error) => error.includes('humanTextureEvidence')));
  assert.equal(result.hardGate.residualTerms, false);
});

test('12-140 character length and overlap remain hard gates even for otherwise rich candidates', () => {
  const tooShort = annotateCandidate({ text: '他沉默了。' }, validAnnotations({
    safeText: '他沉默了。',
    auditText: '他沉默了。',
  }));
  assert.equal(gradeCandidate(tooShort), 'D');
  assert.equal(validateRichRecord(tooShort).valid, false);

  const source = '他把手机扣在桌上过了一会儿才抬头看她的眼睛。';
  const overlapped = annotateCandidate({ text: `前文${source}后文` }, validAnnotations({
    safeText: `前文${source}后文`,
    auditText: `前文${source}后文`,
    referenceTexts: [source],
  }));
  assert.equal(overlapped.safety.textOverlap.blocked, true);
  assert.equal(gradeCandidate(overlapped), 'D');
  assert.equal(validateRichRecord(overlapped).valid, false);
});

test('buildRichIntermediate is pure and supports collections', () => {
  const rows = [
    { id: 'one', text: '他把杯子推到她面前，随后才问她是不是还在生气。' },
    { id: 'two', text: '她低头整理袖口，过了很久才说自己并没有介意。' },
  ];
  const original = JSON.stringify(rows);
  const records = buildRichIntermediate({
    rows,
    source: SOURCE,
    person: PERSON,
    annotations: [
      validAnnotations({ dimension: 'action', safeText: rows[0].text, auditText: rows[0].text }),
      validAnnotations({ dimension: 'expression', safeText: rows[1].text, auditText: rows[1].text }),
    ],
  });
  assert.equal(records.length, 2);
  assert.equal(records[0].sample.dimension, 'action');
  assert.equal(records[1].sample.dimension, 'expression');
  assert.equal(JSON.stringify(rows), original);
  assert.equal(records.every((record) => validateRichRecord(record).valid), true);
});
