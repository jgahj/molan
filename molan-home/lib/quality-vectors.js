'use strict';

const QUALITY_DIMENSIONS = [
  'opening', 'plot', 'pacing', 'character', 'relationship', 'emotion', 'causality',
  'foreshadowing', 'payoff', 'dialogue', 'description', 'language', 'human_texture',
  'ai_flavor', 'consistency', 'originality', 'reader_drive', 'genre_fit', 'style_fit'
];

const LEGACY_QUALITY_DIMENSIONS = [
  'plot', 'pacing', 'character', 'emotion', 'causality', 'hook', 'suspense',
  'payoff', 'dialogue', 'description', 'language', 'human_texture', 'ai_flavor',
  'consistency', 'originality', 'commercial_drive'
];

const QUALITY_PROFILE_FIELDS = {
  opening: 'opening',
  plot: 'plot',
  pacing: 'pacing',
  character: 'character',
  relationship: 'relationship',
  emotion: 'emotion',
  causality: 'causality',
  foreshadowing: 'foreshadowing',
  payoff: 'payoff',
  dialogue: 'dialogue',
  description: 'description',
  language: 'language',
  human_texture: 'human_texture',
  ai_flavor: 'ai_flavor',
  consistency: 'consistency',
  originality: 'originality',
  reader_drive: 'reader_drive',
  genre_fit: 'genre_fit',
  style_fit: 'style_fit'
};

const QUALITY_AXES = Object.freeze({
  quality: Object.freeze([
    'opening', 'plot', 'pacing', 'character', 'relationship', 'emotion', 'causality',
    'foreshadowing', 'payoff', 'dialogue', 'description', 'language', 'human_texture',
    'consistency', 'reader_drive'
  ]),
  genre_fit: Object.freeze(['genre_fit']),
  style_fit: Object.freeze(['style_fit']),
  originality: Object.freeze(['originality']),
  ai_flavor_risk: Object.freeze(['ai_flavor'])
});

const DEFECT_DIMENSIONS = [
  'weak_opening', 'weak_hook', 'flat_pacing', 'shallow_character',
  'forced_dialogue', 'ai_flavor', 'causality_gap'
];

const ROOT_CAUSE_DIMENSIONS = [
  'planner_goal_missing', 'scene_objective_missing', 'character_state_loss',
  'context_overload', 'writer_template_bias'
];

const DEFECT_MATCHERS = {
  weak_opening: /opening|开篇|开场|起笔/u,
  weak_hook: /hook|悬念|钩子/u,
  flat_pacing: /pacing|节奏|冲突密度|平淡/u,
  shallow_character: /character|人物|角色塑造/u,
  forced_dialogue: /dialogue|对白|台词/u,
  ai_flavor: /ai.?flavou?r|ai味|模板套话|机械表达/u,
  causality_gap: /causal|causality|因果|逻辑断裂/u
};

const ROOT_CAUSE_MATCHERS = {
  planner_goal_missing: /planner.{0,20}(goal|目标)|(?:goal|目标).{0,20}planner/iu,
  scene_objective_missing: /scene.{0,20}(objective|目标)|(?:objective|场景目标).{0,20}scene/iu,
  character_state_loss: /character.{0,20}state|人物状态|角色状态/iu,
  context_overload: /context.{0,20}(overload|过载)|上下文.{0,8}过载/iu,
  writer_template_bias: /writer.{0,20}(template|bias)|写作.{0,8}(模板|套式)|作者模板偏差/iu
};

const SEVERITY_BY_LABEL = { A: 1, B: 0.8, C: 0.6, D: 0.4, E: 0 };

/** 仅接受可验证的有限数值。 */
function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 读取画像明确提供的评分字段，不派生分数。 */
function scoreFromBlock(block) {
  if (typeof block === 'number' || typeof block === 'string') return toFiniteNumber(block);
  if (!block || typeof block !== 'object') return null;
  const candidates = [block.score, block.qualityScore, block.index, block.value];
  for (const candidate of candidates) {
    const score = toFiniteNumber(candidate);
    if (score !== null) return score;
  }
  const nestedValue = block.value;
  if (nestedValue && typeof nestedValue === 'object') {
    for (const key of ['score', 'qualityScore', 'index']) {
      const score = toFiniteNumber(nestedValue[key]);
      if (score !== null) return score;
    }
  }
  return null;
}

/** 仅保留证据位置引用，避免向向量复制作品原文。 */
function evidenceRefs(block) {
  if (!block) return [];
  if (!Array.isArray(block.evidence)) {
    const location = block.location;
    if (!location) return [];
    return [{
      reference: block.evidence_id || block.defect_id || null,
      location: typeof location === 'string' ? location : location.chapter || location.paragraph_range || null
    }];
  }
  return block.evidence.slice(0, 3).map((item) => {
    if (typeof item === 'string') return { reference: null, location: null };
    return {
      reference: item && (item.evidence_id || item.id || item.source) || null,
      location: item && (item.location || item.paragraph || item.chapter) || null
    };
  });
}

/** 从画像中提取明确标量；没有分数的维度保留未知状态。 */
function buildQualityVector(profile = {}) {
  const dimensions = {};
  const values = {};

  for (const key of QUALITY_DIMENSIONS) {
    let sourceField = QUALITY_PROFILE_FIELDS[key];
    let block = profile[key];
    if (key === 'ai_flavor' && !block) {
      sourceField = 'language.value.aiFlavorScore';
      const aiFlavorScore = profile.language && profile.language.value && profile.language.value.aiFlavorScore;
      block = aiFlavorScore === undefined ? null : {
        value: aiFlavorScore,
        evidence: profile.language && profile.language.evidence,
        confidence: profile.language && profile.language.confidence
      };
    }

    const value = scoreFromBlock(block);
    const confidence = toFiniteNumber(block && block.confidence);
    const source = value === null ? null :
      ['deterministic', 'heuristic', 'model', 'human'].includes(String(block && block.source || '').toLowerCase())
        ? String(block.source).toLowerCase()
        : 'heuristic';
    const refs = evidenceRefs(block);
    values[key] = value;
    dimensions[key] = {
      value,
      status: value === null ? 'unknown' : 'measured',
      direction: key === 'ai_flavor' ? 'lower_is_better' : null,
      source,
      source_field: sourceField,
      confidence: confidence === null ? null : Math.max(0, Math.min(1, confidence)),
      evidence: refs,
      evidence_refs: refs
    };
  }

  const legacyValues = {};
  const legacyDimensions = {};
  for (const key of LEGACY_QUALITY_DIMENSIONS) {
    const mappedKey = key === 'commercial_drive' ? 'reader_drive' : key;
    const block = key === 'commercial_drive'
      ? profile.commercial_drive || profile.reader_drive || profile.commercial_patterns
      : profile[key];
    const value = scoreFromBlock(block);
    const confidence = toFiniteNumber(block && block.confidence);
    const source = value === null ? null :
      ['deterministic', 'heuristic', 'model', 'human'].includes(String(block && block.source || '').toLowerCase())
        ? String(block.source).toLowerCase()
        : 'heuristic';
    const refs = evidenceRefs(block);
    legacyValues[key] = value;
    legacyDimensions[key] = {
      value,
      status: value === null ? 'unknown' : 'measured',
      direction: key === 'ai_flavor' ? 'lower_is_better' : null,
      source,
      source_field: key === 'commercial_drive' ? mappedKey : key,
      confidence: confidence === null ? null : Math.max(0, Math.min(1, confidence)),
      evidence: refs,
      evidence_refs: refs
    };
  }

  return {
    schemaVersion: 'quality-vector-v2',
    legacySchemaVersion: 'quality-vector-v1',
    contractVersion: 'quality-vector-19d-v1',
    source_profile_version: profile.schemaVersion || null,
    values,
    dimensions,
    axes: Object.fromEntries(Object.entries(QUALITY_AXES).map(([axis, keys]) => [axis, keys.slice()])),
    legacy_values: legacyValues,
    legacy_dimensions: legacyDimensions
  };
}

/** 将已有严重度标注映射到有界量表。 */
function defectSeverity(defect) {
  const explicitScore = toFiniteNumber(defect && defect.ranking_factors && defect.ranking_factors.severity_score);
  if (explicitScore !== null) return Math.max(0, Math.min(1, explicitScore / 5));
  const label = String(defect && defect.severity || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(SEVERITY_BY_LABEL, label) ? SEVERITY_BY_LABEL[label] : null;
}

/** 将已检测缺陷汇总为稀疏向量，不把未检测误写为零。 */
function buildDefectVector(report = {}) {
  const defects = Array.isArray(report.defects) ? report.defects : [];
  const assessed = new Set(Array.isArray(report.assessed_dimensions) ? report.assessed_dimensions : []);
  const complete = report.complete === true || report.status === 'complete';
  const values = {};
  const dimensions = {};
  const byDefectId = {};

  for (const defect of defects) {
    const id = defect && defect.defect_id;
    if (!id) continue;
    byDefectId[id] = {
      severity: defectSeverity(defect),
      confidence: toFiniteNumber(defect.confidence),
      evidence_refs: evidenceRefs(defect)
    };
  }

  for (const key of DEFECT_DIMENSIONS) {
    const matching = defects.filter((defect) => {
      if (!defect || String(defect.severity || '').toUpperCase() === 'E') return false;
      const text = [defect.defect_id, defect.category, defect.dimension, defect.symptom]
        .filter(Boolean).join(' ');
      return DEFECT_MATCHERS[key].test(text);
    });
    const scored = matching.map(defectSeverity).filter(value => value !== null);
    const isAssessed = assessed.has(key);
    const value = scored.length > 0
      ? Math.max(...scored)
      : matching.length > 0 ? null : isAssessed ? 0 : null;
    const confidences = matching.map(item => toFiniteNumber(item.confidence)).filter(value => value !== null);
    values[key] = value;
    dimensions[key] = {
      value,
      count: matching.length,
      status: matching.length > 0
        ? value === null ? 'detected_unquantified' : 'detected'
        : value === null ? 'unknown' : 'clear',
      confidence: confidences.length ? Number((confidences.reduce((sum, item) => sum + item, 0) / confidences.length).toFixed(3)) : null,
      evidence_refs: matching.flatMap(evidenceRefs).slice(0, 6)
    };
  }

  return {
    schemaVersion: 'defect-vector-v1',
    source_report_status: report.status || (complete ? 'complete' : 'partial'),
    values,
    dimensions,
    by_defect_id: byDefectId
  };
}

/** 读取根因记录显式给出的强度值。 */
function rootCauseStrength(rootCause) {
  for (const key of ['strength', 'risk_score', 'probability', 'score']) {
    const value = toFiniteNumber(rootCause && rootCause[key]);
    if (value !== null) return Math.max(0, Math.min(1, value));
  }
  return null;
}

/** 将已诊断根因按类型汇总，保留未评估维度的未知状态。 */
function buildRootCauseVector(report = {}) {
  const causes = Array.isArray(report.rootCauses) ? report.rootCauses
    : Array.isArray(report.root_causes) ? report.root_causes : [];
  const assessed = new Set(Array.isArray(report.assessed_dimensions) ? report.assessed_dimensions : []);
  const complete = report.complete === true || report.status === 'complete';
  const values = {};
  const dimensions = {};

  for (const key of ROOT_CAUSE_DIMENSIONS) {
    const matching = causes.filter((cause) => {
      const labels = [
        ...(Array.isArray(cause && cause.root_cause_categories) ? cause.root_cause_categories : []),
        cause && cause.root_cause,
        cause && cause.cause_chain && Object.values(cause.cause_chain).join(' '),
        cause && cause.affected_module
      ].flat().filter(Boolean).join(' ');
      return ROOT_CAUSE_MATCHERS[key].test(labels);
    });
    const strengths = matching.map(rootCauseStrength).filter(value => value !== null);
    const isAssessed = assessed.has(key);
    const value = strengths.length
      ? Math.max(...strengths)
      : matching.length > 0 ? null : isAssessed ? 0 : null;
    const confidences = matching.map(item => toFiniteNumber(item.confidence)).filter(value => value !== null);
    values[key] = value;
    dimensions[key] = {
      value,
      count: matching.length,
      status: matching.length > 0 ? 'diagnosed' : value === null ? 'unknown' : 'clear',
      confidence: confidences.length ? Number((confidences.reduce((sum, item) => sum + item, 0) / confidences.length).toFixed(3)) : null,
      defect_ids: matching.map(item => item.defect_id).filter(Boolean)
    };
  }

  return {
    schemaVersion: 'root-cause-vector-v1',
    source_report_status: report.status || (complete ? 'complete' : 'partial'),
    values,
    dimensions
  };
}

module.exports = {
  QUALITY_DIMENSIONS,
  LEGACY_QUALITY_DIMENSIONS,
  QUALITY_AXES,
  DEFECT_DIMENSIONS,
  ROOT_CAUSE_DIMENSIONS,
  buildQualityVector,
  buildDefectVector,
  buildRootCauseVector
};
