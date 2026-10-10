'use strict';

const crypto = require('node:crypto');
const workflow = require('./memory-workflow');

function applicableTime(record, storyTime) {
  const start = record.validIntervalStart || record.valid_interval_start || '';
  const end = record.validIntervalEnd || record.valid_interval_end || '';
  if ((start || end) && !storyTime) return false;
  return (!start || storyTime >= start) && (!end || storyTime < end);
}

function policyApplies(policy, query) {
  if (policy.scope_pov_id && query.povId && policy.scope_pov_id !== query.povId) return false;
  if (policy.scope_scene_id && query.sceneId && policy.scope_scene_id !== query.sceneId) return false;
  if (policy.scope_chapter_range) {
    const range = policy.scope_chapter_range.match(/^(\d+)(?:-(\d+))?$/);
    if (range && query.chapterNumber != null) {
      if (Number(query.chapterNumber) < Number(range[1]) || Number(query.chapterNumber) > Number(range[2] || range[1])) return false;
    }
  }
  return true;
}

function assembleContext(db, bookId, query = {}, styleProfilesOverride) {
  const memory = require('./memory-system');
  const branchId = query.branchId || 'main';
  const version = workflow.stateVersion(db, bookId, branchId);
  if (query.stateVersion !== undefined && Number(query.stateVersion) !== version) workflow.fail('MEMORY_VERSION_CONFLICT');
  const timelineId = query.timelineId || 't0';
  const cycleId = query.cycleId || 'c0';
  const policies = db.prepare('SELECT * FROM disclosure_policies WHERE book_id = ? AND branch_id = ? ORDER BY id')
    .all(bookId, branchId).filter(policy => policyApplies(policy, query));
  const facts = memory.getMemory(db, bookId, { branchId }).filter(fact =>
    fact.timelineId === timelineId && fact.cycleId === cycleId && applicableTime(fact, query.storyTime));
  const cognitions = memory.getCognition(db, bookId, { branchId, timelineId, cycleId, holderEntityId: query.povId })
    .filter(record => applicableTime(record, query.storyTime) &&
      (!record.acquiredTimeRef || query.storyTime && record.acquiredTimeRef <= query.storyTime));
  const styles = require('./style-system');
  const profiles = Array.isArray(styleProfilesOverride) ? styleProfilesOverride
    : db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'style_profiles'").get()
      ? styles.getStyleProfiles(db, bookId, { branchId }) : [];
  const sourceCurrent = fact => fact.supportingEvidenceIds.every(id => {
    const evidence = db.prepare('SELECT source_anchor_json FROM memory_evidence WHERE id = ? AND book_id = ?').get(id, bookId);
    if (!evidence) return false;
    const anchor = JSON.parse(evidence.source_anchor_json);
    return !anchor.chapterRevisionId || !db.prepare('SELECT id FROM memory_invalidations WHERE manuscript_id = ?').get(anchor.chapterRevisionId);
  });
  const manifest = compileContext({ bookId, branchId, version, facts, cognitions, policies, profiles,
    plans: db.prepare('SELECT * FROM story_plans WHERE book_id = ? AND branch_id = ?').all(bookId, branchId), sourceCurrent }, query);
  db.prepare(`INSERT INTO context_manifests
    (id, book_id, branch_id, state_version, writing_package_json, audit_package_json, included_reasons_json,
      excluded_reasons_json, budget_tokens, input_hash, model_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(manifest.id, bookId, branchId, version, JSON.stringify(manifest.writingPackage),
      JSON.stringify(manifest.auditPackage), JSON.stringify(manifest.includedReasons), JSON.stringify(manifest.excludedReasons),
      manifest.budgetTokens, manifest.inputHash, manifest.modelId, manifest.createdAt);
  return manifest;
}

function selectRelevantPlans(plans = [], query = {}) {
  const safePlans = Array.isArray(plans) ? plans : [];
  const safeQuery = query && typeof query === 'object' ? query : {};

  const currentChapterRaw = safeQuery.chapterNumber ?? safeQuery.chapterNo ?? safeQuery.currentChapterNo;
  const currentChapter = currentChapterRaw != null && Number.isFinite(Number(currentChapterRaw))
    ? Number(currentChapterRaw)
    : null;
  const currentChapterId = safeQuery.chapterId != null ? String(safeQuery.chapterId) : null;

  const rawChars = [
    safeQuery.povId,
    ...(Array.isArray(safeQuery.castIds) ? safeQuery.castIds : (safeQuery.castIds ? [safeQuery.castIds] : [])),
    ...(Array.isArray(safeQuery.characters) ? safeQuery.characters : (safeQuery.characters ? [safeQuery.characters] : []))
  ].filter(Boolean);
  const currentCharSet = new Set(rawChars.map(c => String(c && typeof c === 'object' ? (c.id != null ? c.id : c.name || '') : (c != null ? c : '')).trim()).filter(Boolean));

  const rawRequired = [
    ...(Array.isArray(safeQuery.requiredPlanIds) ? safeQuery.requiredPlanIds : (safeQuery.requiredPlanIds ? [safeQuery.requiredPlanIds] : [])),
    ...(Array.isArray(safeQuery.requiredIds) ? safeQuery.requiredIds : (safeQuery.requiredIds ? [safeQuery.requiredIds] : []))
  ].filter(Boolean);
  const requiredPlanSet = new Set(rawRequired.map(String));

  const timelineId = safeQuery.timelineId || 't0';
  const cycleId = safeQuery.cycleId || 'c0';

  const candidates = [];
  const decisions = [];
  const includedReasons = [];
  const excludedReasons = [];

  for (const raw of safePlans) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = String(raw.id || '');
    const revision = Number(raw.revision) || 1;
    const status = String(raw.status || 'planned').trim().toLowerCase();

    // 1. Status Gate: filter out completed and abandoned
    if (status === 'completed' || status === 'abandoned') {
      const reason = `plan_status_${status}`;
      decisions.push({ id, revision, reason, included: false });
      excludedReasons.push({ id, reason });
      continue;
    }

    // Timeline / cycle check
    if (raw.timelineId && raw.timelineId !== timelineId) {
      decisions.push({ id, revision, reason: 'timeline_mismatch', included: false });
      excludedReasons.push({ id, reason: 'timeline_mismatch' });
      continue;
    }
    if (raw.cycleId && raw.cycleId !== cycleId) {
      decisions.push({ id, revision, reason: 'cycle_mismatch', included: false });
      excludedReasons.push({ id, reason: 'cycle_mismatch' });
      continue;
    }

    // Specific chapterId mismatch check
    if (currentChapterId && (raw.chapterId || raw.chapter_id)) {
      const planChId = String(raw.chapterId || raw.chapter_id);
      if (currentChapterId !== planChId && !requiredPlanSet.has(id)) {
        decisions.push({ id, revision, reason: 'chapter_id_mismatch', included: false });
        excludedReasons.push({ id, reason: 'chapter_id_mismatch' });
        continue;
      }
    }

    // 2. Participant IDs
    let participantIds = raw.participantIds || raw.participant_ids || raw.participant_ids_json || [];
    if (typeof participantIds === 'string') {
      try { participantIds = JSON.parse(participantIds); } catch (_) { participantIds = []; }
    }
    const participants = (Array.isArray(participantIds) ? participantIds : [])
      .map(p => String(p && typeof p === 'object' ? (p.id != null ? p.id : p.name || '') : (p != null ? p : '')).trim())
      .filter(Boolean);

    // 3. Chapter range analysis & scoring
    const hasExplicitRange = Boolean(raw.targetChapterRange || raw.target_chapter_range);
    const targetRangeStr = String(raw.targetChapterRange || raw.target_chapter_range ||
      (raw.chapterNo != null ? String(raw.chapterNo) : (raw.chapter_no != null ? String(raw.chapter_no) : ''))).trim();

    let score = 0;
    let matchReason = '';
    const isRequired = requiredPlanSet.has(id);

    if (isRequired) {
      score += 100;
      matchReason = 'required_plan_directive';
    }

    // Specific chapterNo mismatch for legacy plans without targetChapterRange
    if (!hasExplicitRange && (raw.chapterNo != null || raw.chapter_no != null) && currentChapter != null) {
      const planCh = Number(raw.chapterNo ?? raw.chapter_no);
      if (currentChapter !== planCh && !isRequired) {
        decisions.push({ id, revision, reason: 'chapter_no_mismatch', included: false });
        excludedReasons.push({ id, reason: 'chapter_no_mismatch' });
        continue;
      }
    }

    if (targetRangeStr && currentChapter != null) {
      const rangeMatch = targetRangeStr.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2] || rangeMatch[1]);
        if (currentChapter >= start && currentChapter <= end) {
          score += 10;
          if (!matchReason) {
            matchReason = hasExplicitRange ? 'chapter_target_match' : 'applicable_story_plan';
          }
        } else if (hasExplicitRange && currentChapter === start - 1) {
          score += 3;
          if (!matchReason) matchReason = 'chapter_upcoming_horizon';
        } else {
          // Out of range
          if (!isRequired) {
            const outReason = hasExplicitRange ? 'chapter_out_of_range' : 'chapter_no_mismatch';
            decisions.push({ id, revision, reason: outReason, included: false });
            excludedReasons.push({ id, reason: outReason });
            continue;
          }
        }
      } else {
        score += 2;
        if (!matchReason) matchReason = 'general_scope_plan';
      }
    } else if (!targetRangeStr) {
      score += 2;
      if (!matchReason) matchReason = 'general_scope_plan';
    } else {
      score += 5;
      if (!matchReason) matchReason = hasExplicitRange ? 'chapter_target_match' : 'applicable_story_plan';
    }

    // 4. Character presence match
    if (participants.some(p => currentCharSet.has(p))) {
      score += 5;
      if (!matchReason) matchReason = 'participant_character_match';
    }

    if (score > 0) {
      candidates.push({
        score,
        plan: {
          id,
          title: String(raw.title || ''),
          content: String(raw.content || raw.summary || raw.planText || raw.plan_text || '').slice(0, 300),
          summary: raw.summary ? String(raw.summary).trim().slice(0, 150) : String(raw.content || '').trim().slice(0, 80),
          targetChapterRange: targetRangeStr,
          chapterNo: raw.chapterNo ?? raw.chapter_no,
          participantIds: participants,
          status,
          planType: raw.planType || raw.plan_type || 'story_plan',
          revision
        },
        decision: {
          id,
          revision,
          reason: matchReason || 'applicable_story_plan',
          score,
          included: true
        }
      });
    } else {
      decisions.push({ id, revision, reason: 'low_relevance', included: false });
      excludedReasons.push({ id, reason: 'low_relevance' });
    }
  }

  // 5. Stable sorting by score desc, then plan.id asc
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.plan.id.localeCompare(b.plan.id);
  });

  // 6. Top-N capping: default Top 3 items (max 5)
  const topLimit = Math.min(5, Math.max(1, Number(safeQuery.maxPlans || safeQuery.topN || 3)));
  const selectedPlans = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (i < topLimit) {
      selectedPlans.push(candidate.plan);
      decisions.push(candidate.decision);
      includedReasons.push({
        id: candidate.plan.id,
        revision: candidate.decision.revision,
        reason: candidate.decision.reason
      });
    } else {
      decisions.push({
        id: candidate.plan.id,
        revision: candidate.plan.revision,
        reason: 'plan_budget_capped',
        included: false
      });
      excludedReasons.push({
        id: candidate.plan.id,
        reason: 'plan_budget_capped'
      });
    }
  }

  return { selectedPlans, decisions, includedReasons, excludedReasons };
}

function compileContext({ bookId, branchId, version, facts, cognitions, policies, profiles = [], plans = [], sourceCurrent }, query = {}) {
  const sourceInput = { facts, cognitions, policies, profiles, plans };
  const timelineId = query.timelineId || 't0', cycleId = query.cycleId || 'c0';
  policies = policies.filter(policy => policyApplies(policy, query));
  facts = facts.filter(f => (f.timelineId || 't0') === timelineId && (f.cycleId || 'c0') === cycleId && applicableTime(f, query.storyTime));
  cognitions = cognitions.filter(c => (c.timelineId || 't0') === timelineId && (c.cycleId || 'c0') === cycleId && applicableTime(c, query.storyTime) && (!c.acquiredTimeRef || query.storyTime && c.acquiredTimeRef <= query.storyTime));
  if (query.stateVersion !== undefined && Number(query.stateVersion) !== version) workflow.fail('MEMORY_VERSION_CONFLICT');
  const includedReasons = [];
  const excludedReasons = [];
  const writingFacts = [];
  const hidden = new Set();
  const implied = new Set();
  const required = new Set(query.requiredIds || []);
  for (const fact of facts) {
    const rules = policies.filter(policy => policy.target_info_id === fact.propositionId || policy.target_info_id === fact.id);
    let reason = '';
    if (!sourceCurrent(fact)) reason = 'source_invalidated';
    if (rules.some(policy => policy.policy_type === 'hide')) reason = 'disclosure_policy_hidden';
    if (reason) {
      hidden.add(fact.propositionId);
      excludedReasons.push({ id: fact.id, reason });
      continue;
    }
    const clues = rules.filter(policy => policy.policy_type === 'imply').flatMap(policy => JSON.parse(policy.allowed_clues_json));
    if (clues.length) {
      implied.add(fact.propositionId);
      writingFacts.push({ id: fact.id, revision: fact.revision, impliedMode: true, allowedClues: clues });
      includedReasons.push({ id: fact.id, revision: fact.revision, reason: 'disclosure_policy_imply' });
      continue;
    }
    if (query.povId && !cognitions.some(record => record.holderEntityId === query.povId &&
        record.targetExpressionId === fact.propositionId && record.attitude === 'knows' && record.awareness !== 'unaware')) {
      excludedReasons.push({ id: fact.id, reason: 'pov_knowledge_not_established' });
      continue;
    }
    writingFacts.push(fact);
    includedReasons.push({ id: fact.id, revision: fact.revision, reason: 'applicable_confirmed_fact' });
  }
  const writingCognitions = query.povId ? cognitions.filter(record => record.holderEntityId === query.povId &&
    !hidden.has(record.targetExpressionId) && !implied.has(record.targetExpressionId)).map(record => {
      const { nestedCognition, ...visible } = record;
      return { ...visible, nestedCognition: {}, nestedExpansion: Object.keys(nestedCognition || {}).length
        ? 'requires_disclosure_review' : 'none' };
    }) : [];
  for (const id of required) {
    if (!writingFacts.some(record => record.id === id || record.propositionId === id)) workflow.fail('REQUIRED_CONTEXT_UNAVAILABLE', 422);
  }
  const styles = require('./style-system');
  const styleBundle = styles.compileStyleBundle(profiles, query);

  const {
    selectedPlans: writingPlans,
    includedReasons: planIncludedReasons,
    excludedReasons: planExcludedReasons
  } = selectRelevantPlans(plans, query);

  for (const inc of planIncludedReasons) {
    includedReasons.push(inc);
  }
  for (const exc of planExcludedReasons) {
    excludedReasons.push(exc);
  }

  const writingPackage = { facts: writingFacts, cognitions: writingCognitions, style: styleBundle, plans: writingPlans };
  const budget = query.budgetTokens == null ? 4000 : Number(query.budgetTokens);
  const reserve = query.outputReserve == null ? 0 : Number(query.outputReserve);
  if (!Number.isInteger(budget) || budget <= 0 || !Number.isInteger(reserve) || reserve < 0 || reserve >= budget) workflow.fail('INVALID_CONTEXT_BUDGET', 422);
  const estimate = value => Math.ceil(JSON.stringify(value).length * 2);
  if (estimate(writingPackage) > budget - reserve) workflow.fail('CONTEXT_BUDGET_EXCEEDED', 422);
  let compiled;
  try {
    const assembleInput = {
      currentTask: query.currentTask || query.prompt || '',
      hardState: writingFacts,
      povKnowledge: writingCognitions,
      styleSamples: styleBundle
    };
    if (query.outlineContext) {
      assembleInput.outlineContext = query.outlineContext;
    }
    if (writingPlans.length > 0) {
      assembleInput.storyPlans = writingPlans;
      if (!query.outlineContext && !query.currentChapterOutline) {
        assembleInput.currentChapterOutline = writingPlans
          .map(p => `${p.title ? p.title + ': ' : ''}${p.summary || p.content || ''}`.trim())
          .filter(Boolean)
          .join('\n') || writingPlans;
      }
    }
    compiled = require('./generation/context').assembleContext(assembleInput, {
      model: query.modelId || 'default', provider: query.provider || 'default', hardLimit: budget,
      outputReserve: reserve, reservedInputTokens: 0,
      chapterNo: query.chapterNo,
      chapterId: query.chapterId
    });
  } catch (error) {
    if (error.code === 'CONTEXT_OVERFLOW') workflow.fail('CONTEXT_BUDGET_EXCEEDED', 422);
    throw error;
  }
  const selectionInput = Object.fromEntries(Object.entries(query).filter(([key]) => !['userId', 'projectId', 'workspaceId', 'bookId'].includes(key)));
  const id = `manif_${crypto.randomUUID()}`;
  const manifest = {
    id, bookId, branchId, stateVersion: version, writingPackage, compiledContext: compiled.text, contextPlan: compiled.contextPlan,
    auditPackage: { facts, cognitions, plans,
      inputMetadata: { timelineId, cycleId, storyTime: query.storyTime || '', povId: query.povId || '',
        policyVersions: policies.map(policy => ({ id: policy.id, revision: policy.revision })),
        styleVersions: profiles.map(profile => ({ id: profile.id, revision: profile.revision })),
        templateVersion: 'memory-context-v2', outputReserve: reserve,
        selectionInput, sourceInputHash: workflow.digest(sourceInput), compiledContext: compiled.text, contextPlan: compiled.contextPlan,
        estimatedInputTokens: estimate(writingPackage), estimator: 'conservative-utf16-v1' } },
    includedReasons, excludedReasons, budgetTokens: budget, outputReserve: reserve,
    estimatedInputTokens: estimate(writingPackage), estimator: 'conservative-utf16-v1',
    inputHash: workflow.digest({ bookId, branchId, version, selectionInput, sourceInput, writingPackage,
      templateVersion: 'memory-context-v2', estimator: 'conservative-utf16-v1', compilerStrategy: compiled.contextPlan.contextStrategyVersion,
      compilerEstimator: compiled.contextPlan.replayManifest.budget.estimator }),
    modelId: query.modelId || '', createdAt: Date.now()
  };
  return manifest;
}

module.exports = { assembleContext, compileContext, selectRelevantPlans, applicableTime };
