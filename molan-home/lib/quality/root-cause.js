'use strict';

const { buildRootCauseVector } = require('../quality-vectors');

function evidenceReference(value) {
  if (!value || typeof value !== 'object' || Object.hasOwn(value, 'quote') ||
      Object.hasOwn(value, 'excerpt') || Object.hasOwn(value, 'text')) return null;
  const evidenceId = String(value.evidence_id || value.id || value.reference || '').trim();
  const artifactId = String(value.artifact_id || value.artifactId || '').trim();
  const location = String(value.location || value.path || '').trim();
  if (!evidenceId || !artifactId || !location) return null;
  return { evidence_id: evidenceId, artifact_id: artifactId, location };
}

function referencedEvidence(values) {
  const refs = (Array.isArray(values) ? values : [values]).map(evidenceReference).filter(Boolean);
  return [...new Map(refs.map(ref => [ref.evidence_id, ref])).values()];
}

function hasMissingObjective(contract) {
  return contract && ['missing', 'absent', 'not_defined'].includes(String(contract.dialogue_objective || '').toLowerCase());
}

function analyzeDialogueRootCause(defect) {
  const diagnostics = defect.diagnostics || {};
  const benchmark = diagnostics.benchmark || {};
  const sceneContract = diagnostics.scene_contract || {};
  const plannerContract = diagnostics.planner_contract || {};
  const metricValue = benchmark.value;
  const p25 = benchmark.p25;
  const benchmarkRef = evidenceReference(benchmark.evidence_ref);
  const sceneRef = evidenceReference(sceneContract.evidence_ref);
  const plannerRef = evidenceReference(plannerContract.evidence_ref);
  const belowP25 = Number.isFinite(metricValue) && Number.isFinite(p25) && metricValue < p25 && benchmarkRef;
  const sceneMissing = hasMissingObjective(sceneContract) && sceneRef;
  const plannerMissing = hasMissingObjective(plannerContract) && plannerRef;
  const supportingEvidence = referencedEvidence([
    ...(Array.isArray(defect.evidence_refs) ? defect.evidence_refs : []),
    benchmark.evidence_ref,
    sceneContract.evidence_ref,
    plannerContract.evidence_ref
  ]);

  if (!belowP25 || !sceneMissing || !plannerMissing || supportingEvidence.length < 4) return null;
  return {
    defect_id: defect.defect_id,
    status: 'confirmed',
    symptom: String(defect.symptom || defect.category || '对白指标低于同题材基准 P25'),
    metric: { name: 'dialogue', value: metricValue, p25, gap: p25 - metricValue },
    evidence: supportingEvidence,
    defect: defect.defect_id || defect.category || 'dialogue_deficit',
    root_cause: 'scene objective missing because planner goal is not defined',
    module: 'Scene Planner',
    parameter: 'sceneContract.dialogue_objective',
    hypothesis: '注入双方对白目标将对白占比拉升至题材 P25 以上',
    experiment: { targetMetric: 'dialogue', parameter: 'sceneContract.dialogue_objective', change: 'add_explicit_objective' },
    result: 'pending_shadow_evaluation',
    root_cause_categories: ['scene_objective_missing', 'planner_goal_missing'],
    direct_cause: `对白指标 ${metricValue} 低于同题材 P25 ${p25}。`,
    cause_chain: {
      phenomenon: String(defect.symptom || '对白指标落在同题材 P25 以下。'),
      direct_cause: '场景合同中没有双方对白目标，导致规划没有安排可执行的对话回合。',
      system_cause: 'Scene Contract 未定义 DialogueObjective，Writer 无从落实人物目标与回应。',
      process_cause: '生成前没有检查场景双方目标是否进入对白规划。',
      data_cause: '场景合同和 Planner 输入均缺少 DialogueObjective 字段。',
      architectural_cause: '规划与对白契约之间没有共享、可验证的目标字段。'
    },
    affected_module: ['Scene Planner', 'Dialogue Contract', 'Character Voice'],
    confidence: 0.85,
    evidence_refs: supportingEvidence,
    trace_rule: 'dialogue-objective-contract-v1'
  };
}

const CAUSE_CHAIN_STAGES = ['phenomenon', 'direct_cause', 'system_cause', 'process_cause', 'data_cause', 'architectural_cause'];

function analyzeVerifiedTrace(defect) {
  const trace = defect.causal_trace;
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return null;
  const chain = trace.cause_chain;
  const refsByStage = trace.evidence_refs_by_stage;
  if (!chain || typeof chain !== 'object' || !refsByStage || typeof refsByStage !== 'object') return null;
  const evidence = [];
  for (const stage of CAUSE_CHAIN_STAGES) {
    if (typeof chain[stage] !== 'string' || !chain[stage].trim()) return null;
    const refs = referencedEvidence(refsByStage[stage]);
    if (!refs.length) return null;
    evidence.push(...refs);
  }
  const categories = Array.isArray(trace.root_cause_categories)
    ? trace.root_cause_categories.filter(item => typeof item === 'string' && item.trim())
    : [];
  const modules = Array.isArray(trace.affected_module)
    ? trace.affected_module.filter(item => typeof item === 'string' && item.trim())
    : [];
  if (!categories.length || !modules.length || !String(trace.root_cause || '').trim()) return null;
  const confidence = typeof trace.confidence === 'number' && Number.isFinite(trace.confidence)
    ? Math.max(0, Math.min(1, trace.confidence)) : null;
  const result = {
    defect_id: defect.defect_id,
    status: 'confirmed',
    symptom: chain.phenomenon.trim(),
    metric: trace.metric || chain.phenomenon.trim(),
    evidence: [...new Map(evidence.map(ref => [ref.evidence_id, ref])).values()],
    defect: defect.defect_id,
    root_cause: String(trace.root_cause).trim(),
    module: modules[0] || 'UnknownModule',
    parameter: trace.parameter || 'system_configuration',
    hypothesis: trace.hypothesis || `调整 ${modules[0] || '系统参数'} 将消除根因 ${String(trace.root_cause).trim()}`,
    experiment: trace.experiment || { targetMetric: trace.metric || 'quality', action: 'mutate_parameter' },
    result: trace.result || 'pending_shadow_evaluation',
    root_cause_categories: [...new Set(categories)],
    direct_cause: chain.direct_cause.trim(),
    cause_chain: Object.fromEntries(CAUSE_CHAIN_STAGES.map(stage => [stage, chain[stage].trim()])),
    affected_module: [...new Set(modules.map(item => item.trim()))],
    confidence,
    evidence_refs: [...new Map(evidence.map(ref => [ref.evidence_id, ref])).values()],
    trace_rule: 'verified-causal-trace-v1'
  };
  if (typeof trace.strength === 'number' && Number.isFinite(trace.strength)) {
    result.strength = Math.max(0, Math.min(1, trace.strength));
  }
  return result;
}

/** Evidence-gated diagnosis for arbitrary generated chapters; unsupported causes stay unresolved. */
function analyzeQualityRootCauses({ defects = [] } = {}) {
  if (!Array.isArray(defects)) throw new TypeError('defects 必须是数组');
  const diagnoses = [];
  const unresolved = [];

  for (const defect of defects) {
    const id = String(defect && defect.defect_id || '').trim();
    if (!id) {
      unresolved.push({ defect_id: null, reason: 'missing_defect_id' });
      continue;
    }
    const label = [defect.category, defect.dimension, defect.symptom].filter(Boolean).join(' ');
    const diagnosis = analyzeVerifiedTrace(defect) ||
      (/dialogue|对白|台词/iu.test(label) ? analyzeDialogueRootCause(defect) : null);
    if (diagnosis) diagnoses.push(diagnosis);
    else unresolved.push({ defect_id: id, reason: 'causal_trace_evidence_incomplete' });
  }

  const rootCauseVector = buildRootCauseVector({
    status: unresolved.length ? 'partial' : 'complete',
    assessed_dimensions: diagnoses.flatMap(item => item.root_cause_categories),
    rootCauses: diagnoses
  });
  return {
    schemaVersion: 'quality-root-cause-v1',
    status: unresolved.length ? diagnoses.length ? 'PARTIAL' : 'NEEDS_MORE_DATA' : 'ANALYZED',
    rootCauses: diagnoses,
    root_cause_vector: rootCauseVector,
    unresolved_defects: unresolved,
    coverage: {
      submitted: defects.length,
      diagnosed: diagnoses.length,
      unresolved: unresolved.length
    }
  };
}

module.exports = {
  analyzeQualityRootCauses,
  evidenceReference
};
