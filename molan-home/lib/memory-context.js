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

function compileContext({ bookId, branchId, version, facts, cognitions, policies, profiles = [], plans = [], sourceCurrent }, query = {}) {
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
  const writingPackage = { facts: writingFacts, cognitions: writingCognitions, style: styleBundle };
  const budget = query.budgetTokens == null ? 4000 : Number(query.budgetTokens);
  const reserve = query.outputReserve == null ? 0 : Number(query.outputReserve);
  if (!Number.isInteger(budget) || budget <= 0 || !Number.isInteger(reserve) || reserve < 0 || reserve >= budget) workflow.fail('INVALID_CONTEXT_BUDGET', 422);
  const estimate = value => Math.ceil(JSON.stringify(value).length * 2);
  if (estimate(writingPackage) > budget - reserve) workflow.fail('CONTEXT_BUDGET_EXCEEDED', 422);
  const id = `manif_${crypto.randomUUID()}`;
  const manifest = {
    id, bookId, branchId, stateVersion: version, writingPackage,
    auditPackage: { facts, cognitions, plans,
      inputMetadata: { timelineId, cycleId, storyTime: query.storyTime || '', povId: query.povId || '',
        policyVersions: policies.map(policy => ({ id: policy.id, revision: policy.revision })),
        styleVersions: profiles.map(profile => ({ id: profile.id, revision: profile.revision })),
        templateVersion: 'memory-context-v1', outputReserve: reserve,
        estimatedInputTokens: estimate(writingPackage), estimator: 'conservative-utf16-v1' } },
    includedReasons, excludedReasons, budgetTokens: budget, outputReserve: reserve,
    estimatedInputTokens: estimate(writingPackage), estimator: 'conservative-utf16-v1',
    inputHash: workflow.digest({ writingPackage, version, timelineId, cycleId, storyTime: query.storyTime || '',
      policyVersions: policies.map(policy => [policy.id, policy.revision]), styleVersions: profiles.map(profile => [profile.id, profile.revision]) }),
    modelId: query.modelId || '', createdAt: Date.now()
  };
  return manifest;
}

module.exports = { assembleContext, compileContext, applicableTime };
