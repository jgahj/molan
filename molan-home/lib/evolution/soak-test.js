'use strict';

const SOAK_MILESTONES = [3, 10, 20, 50, 100, 200];
const SOAK_CHECKPOINT_METRICS = [
  'continuityErrors', 'relationshipDrift', 'characterDrift', 'powerDrift', 'timelineErrors',
  'orphanedForeshadows', 'causalDebtAge', 'styleDrift', 'aiFlavorDrift', 'dialogueDrift',
  'cost', 'latency', 'retryCount'
];

function buildSoakPlan({ taskId, replayManifest, milestone = 100 } = {}) {
  if (!SOAK_MILESTONES.includes(milestone)) throw new TypeError('soak milestone 必须为 3、10、20、50、100 或 200 章');
  if (!replayManifest || replayManifest.schemaVersion !== 'generation-replay-manifest-v1' || !isReference(replayManifest.manifestHash)) {
    throw new TypeError('soak task 必须绑定固定的 Replay Manifest');
  }
  return {
    schemaVersion: 'long-form-soak-plan-v1',
    task_id: String(taskId || replayManifest.sourceGenerationId),
    replay_manifest_hash: replayManifest.manifestHash,
    target_chapters: milestone,
    checkpoints: Array.from({ length: Math.floor(milestone / 10) }, (_, index) => (index + 1) * 10),
    required_snapshot_fields: ['bible', 'outline', 'chapterContract', 'contextSnapshot', 'model', 'parameters', 'pipelineVersion']
  };
}

function isReference(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateCheckpoint(checkpoint, chapterIndex) {
  const missing = [];
  if (!checkpoint || checkpoint.chapter_index !== chapterIndex) missing.push('chapter_index');
  if (!isReference(checkpoint && checkpoint.evidence_ref)) missing.push('evidence_ref');
  const metrics = checkpoint && checkpoint.metrics;
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) missing.push('metrics');
  for (const key of SOAK_CHECKPOINT_METRICS) {
    if (typeof (metrics && metrics[key]) !== 'number' || !Number.isFinite(metrics[key]) || metrics[key] < 0) {
      missing.push(`metrics.${key}`);
    }
  }
  return missing;
}

/** Validate a cumulative run and its 10-chapter health snapshots without inferring missing metrics. */
function evaluateSoakRun({ plan, chapters = [], checkpoints = [] } = {}) {
  if (!plan || plan.schemaVersion !== 'long-form-soak-plan-v1') throw new TypeError('无效的长篇 Soak Plan');
  const target = plan.target_chapters;
  if (!SOAK_MILESTONES.includes(target) || !Array.isArray(chapters) || !Array.isArray(checkpoints)) {
    throw new TypeError('Soak run 输入无效');
  }
  const expectedCheckpoints = Array.from({ length: Math.floor(target / 10) }, (_, index) => (index + 1) * 10);
  if (JSON.stringify(plan.checkpoints) !== JSON.stringify(expectedCheckpoints) || !isReference(plan.replay_manifest_hash)) {
    throw new TypeError('Soak Plan 的回放快照或检查点定义无效');
  }
  const chapterByIndex = new Map();
  const duplicateChapters = [];
  for (const chapter of chapters) {
    const index = chapter && Number(chapter.chapter_index);
    if (!Number.isInteger(index) || index < 1 || index > target) continue;
    if (chapterByIndex.has(index)) duplicateChapters.push(index);
    else chapterByIndex.set(index, chapter);
  }

  const failedChapters = [];
  const blockedChapters = [];
  for (let index = 1; index <= target; index += 1) {
    const chapter = chapterByIndex.get(index);
    if (!chapter || !isReference(chapter.text_hash) || !isReference(chapter.evidence_ref)) {
      blockedChapters.push(index);
    } else if (chapter.status !== 'completed' || chapter.audit_passed !== true) {
      failedChapters.push(index);
    }
  }

  const checkpointByIndex = new Map();
  const duplicateCheckpoints = [];
  for (const checkpoint of checkpoints) {
    const index = checkpoint && Number(checkpoint.chapter_index);
    if (!Number.isInteger(index)) continue;
    if (checkpointByIndex.has(index)) duplicateCheckpoints.push(index);
    else checkpointByIndex.set(index, checkpoint);
  }
  const checkedMetrics = {};
  for (const index of plan.checkpoints) {
    const checkpoint = checkpointByIndex.get(index);
    const missing = validateCheckpoint(checkpoint, index);
    if (!checkpoint || missing.length) {
      blockedChapters.push(`checkpoint_${index}`);
      checkedMetrics[index] = { status: 'BLOCKED', missing };
    } else {
      checkedMetrics[index] = {
        status: 'MEASURED',
        evidence_ref: checkpoint.evidence_ref,
        metrics: Object.fromEntries(SOAK_CHECKPOINT_METRICS.map(key => [key, checkpoint.metrics[key]]))
      };
    }
  }

  const status = failedChapters.length || duplicateChapters.length || duplicateCheckpoints.length
    ? 'FAIL'
    : blockedChapters.length ? 'BLOCKED' : 'PASS';
  return {
    schemaVersion: 'long-form-soak-report-v1',
    task_id: plan.task_id,
    target_chapters: target,
    completed_chapters: [...chapterByIndex.keys()].sort((a, b) => a - b).filter(index => {
      const chapter = chapterByIndex.get(index);
      return chapter.status === 'completed' && chapter.audit_passed === true;
    }).length,
    status,
    failed_chapters: [...new Set(failedChapters)],
    blocked_chapters: [...new Set(blockedChapters)],
    duplicate_chapters: [...new Set(duplicateChapters)],
    duplicate_checkpoints: [...new Set(duplicateCheckpoints)],
    checkpoints: checkedMetrics
  };
}

module.exports = {
  SOAK_MILESTONES,
  SOAK_CHECKPOINT_METRICS,
  buildSoakPlan,
  evaluateSoakRun
};
