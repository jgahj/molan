'use strict';

const recordsOfType = (branch, type) => Object.values(branch.records || {}).filter(record => record.recordType === type);

function containsExactReference(value, targetId) {
  if (value === targetId) return true;
  if (Array.isArray(value)) return value.some(item => containsExactReference(item, targetId));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(item => containsExactReference(item, targetId));
}

function makeImpact(type, id, summary, severity) {
  return { type, id, summary, severity };
}

/** 使用稳定 ID 和显式记录引用计算 JSON 记忆的可验证影响范围。 */
function analyzeNativeMemoryImpact(branch, input = {}) {
  const targetId = String(input.targetId || '');
  const modifiedType = input.modifiedType || 'fact';
  const explicitImpacts = [];
  const potentialImpacts = [];
  const affected = new Set([targetId]);

  if (modifiedType === 'fact' && targetId) {
    for (const decision of recordsOfType(branch, 'fact').filter(record => record.supersedesId === targetId)) {
      explicitImpacts.push(makeImpact('SUPERSEDED_DECISION', decision.id,
        `后续裁决引用了此目标: ${decision.decisionReason || decision.id}`, 'high'));
    }
    for (const transition of recordsOfType(branch, 'transition').filter(record => containsExactReference(record.preState, targetId))) {
      explicitImpacts.push(makeImpact('STATE_TRANSITION_BROKEN', transition.id,
        `实体 ${transition.entityId} 的 ${transition.dimension} 状态转换引用了此前状态`, 'high'));
    }
    for (const cognition of recordsOfType(branch, 'cognition').filter(record => record.targetExpressionId === targetId)) {
      potentialImpacts.push(makeImpact('CHARACTER_BELIEF_MISMATCH', cognition.id,
        `角色 ${cognition.holderEntityId} 对此事实存在已知认知 (${cognition.attitude || 'unknown'})，可能产生误信或信息差`, 'medium'));
    }
  }

  if (modifiedType === 'chapter' && targetId) {
    const manuscripts = Object.values(branch.manuscripts || {}).filter(manuscript =>
      manuscript.chapterId === targetId || manuscript.id === targetId);
    const manuscriptIds = new Set(manuscripts.map(manuscript => manuscript.id));
    const evidence = recordsOfType(branch, 'evidence').filter(record => manuscriptIds.has(record.sourceAnchor?.chapterRevisionId));
    const evidenceIds = new Set(evidence.map(record => record.id));
    for (const record of evidence) {
      explicitImpacts.push(makeImpact('SOURCE_EVIDENCE', record.id, '证据指向被修改章节的确切版本', 'high'));
    }
    for (const decision of recordsOfType(branch, 'fact')) {
      if ((decision.supportingEvidenceIds || []).some(id => evidenceIds.has(id))) {
        explicitImpacts.push(makeImpact('FACT_SOURCE_CHANGED', decision.id, '裁决来源需要重新确认，不自动修改人物认知', 'high'));
      }
    }
  }

  for (const impact of explicitImpacts) affected.add(impact.id);
  const manifests = Object.values(branch.manifests || {}).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 1000);
  for (const manifest of manifests) {
    if ((manifest.includedReasons || []).some(item => affected.has(item.id))) {
      explicitImpacts.push(makeImpact('PROVIDED_CONTEXT', manifest.id,
        '生成输入曾包含目标信息；这不是剧情因果关系的证明', 'high'));
    }
  }

  for (const foreshadow of recordsOfType(branch, 'foreshadow').filter(record => ['planted', 'reinforced'].includes(record.status))) {
    potentialImpacts.push(makeImpact('OPEN_FORESHADOW_CHECK', foreshadow.id,
      `未闭环伏笔 [${foreshadow.title}] 需复核计划回收范围 ${foreshadow.plannedPayoffRange || ''}`, 'low'));
  }

  return {
    bookId: input.bookId,
    targetId,
    modifiedType,
    analysisTime: Date.now(),
    explicitImpacts,
    potentialImpacts,
    totalImpactCount: explicitImpacts.length + potentialImpacts.length,
    coverage: { semanticDependencies: 'not_checked', recentManifestLimit: 1000, truncated: Object.keys(branch.manifests || {}).length > 1000 },
    recommendations: explicitImpacts.length > 0
      ? ['修改后续章节对白或事件', '更新状态转换前置条件', '向变更集提交修正裁决']
      : ['检查人物认知是否需同步修正', '保留例外并在改写合同中锁定']
  };
}

module.exports = { analyzeNativeMemoryImpact };
