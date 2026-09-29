'use strict';

const { hashValue } = require('./manifest');
const { GenerationError } = require('./errors');
const review = require('../evidence-review');

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asRecord(value) {
  return isRecord(value) ? value : {};
}

function verifiedEntries(text, values, options = {}) {
  return (Array.isArray(values) ? values : []).filter(item => {
    const location = review.locateQuote(text, item && item.quote, item && item.paragraphIndex);
    const description = String(item && item.text || (options.allowQuoteAsText ? item && item.quote : '') || '').trim();
    return Boolean(location && location.found && description);
  }).map(item => ({
    ...item,
    text: String(item.text || (options.allowQuoteAsText ? item.quote : '')).trim().slice(0, 500),
    quote: String(item.quote).trim().slice(0, 500)
  }));
}

function projectStateMap(previous, entries, extraFields = []) {
  const next = { ...asRecord(previous) };
  for (const item of Array.isArray(entries) ? entries : []) {
    const entity = String(item && item.entity || '').trim().slice(0, 160);
    if (!entity || !item.text || !item.quote || !item.quote.includes(entity)) continue;
    const existing = asRecord(next[entity]);
    const value = {
      ...existing,
      text: String(item.text).slice(0, 500),
      source: { quote: String(item.quote).slice(0, 500), chapterNo: Number(item.chapterNo) || 0 }
    };
    for (const key of extraFields) if (item[key] != null && String(item[key]).trim()) value[key] = String(item[key]).trim().slice(0, 160);
    next[entity] = value;
  }
  return next;
}

function deriveGenerationCommitProjection(input = {}) {
  const result = asRecord(input.result);
  const text = String(input.text || '');
  const contentHash = hashValue(text);
  const semantic = asRecord(result.semanticAudit);
  const evidence = asRecord(semantic.audit);
  const deterministic = asRecord(result.audit || result.deterministicAudit);
  if (!text.trim() || contentHash !== String(result.outputHash || '') ||
      deterministic.passed !== true || semantic.passed !== true || evidence.passed !== true) {
    throw new GenerationError('AUDIT_BLOCKED', '生成 Run 缺少与提交正文匹配的通过审计', { status: 409 });
  }

  const delta = asRecord(evidence.factLedgerDelta);
  const state = asRecord(evidence.stateDelta);
  const rules = verifiedEntries(text, delta.newRules);
  const promises = verifiedEntries(text, delta.newPromises);
  const updates = verifiedEntries(text, delta.updates, { allowQuoteAsText: true })
    .filter(item => item.id && ['paid', 'superseded'].includes(String(item.status)));
  const byEntity = {};
  for (const [entity, values] of Object.entries(asRecord(delta.byEntity))) {
    if (['__proto__', 'constructor', 'prototype'].includes(entity)) continue;
    const verified = verifiedEntries(text, values).filter(item => String(item.quote || '').includes(entity));
    if (verified.length) byEntity[String(entity).slice(0, 160)] = verified;
  }
  const timelineDelta = verifiedEntries(text, state.timeline).map(item => ({
    ...item,
    location: String(item.location || '').trim().slice(0, 160),
    participants: Array.isArray(item.participants) ? item.participants.map(String).slice(0, 12) : []
  }));
  const relationDelta = verifiedEntries(text, state.relations).filter(item => item.entity && item.quote.includes(String(item.entity)));
  const characterDelta = verifiedEntries(text, state.characters).filter(item => item.entity && item.quote.includes(String(item.entity)))
    .map(item => ({ ...item, lifeStatus: ['alive', 'dead', 'unknown'].includes(String(item.lifeStatus)) ? String(item.lifeStatus) : 'unknown', location: String(item.location || '').trim().slice(0, 160) }));
  const worldDelta = verifiedEntries(text, state.world).filter(item => item.entity && item.quote.includes(String(item.entity)));
  const prior = asRecord(input.previousSnapshot);
  const chapterNo = Math.max(1, Number(input.chapterNo) || 1);
  const timeline = [...(Array.isArray(prior.timeline) ? prior.timeline : [])];
  for (const item of timelineDelta) {
    const key = hashValue({ contentHash, quote: item.quote });
    if (timeline.some(existing => String(existing && existing.evidenceId || '') === key)) continue;
    timeline.push({ ...item, chapterNo, contentHash, evidenceId: key });
  }
  const openForeshadows = [...(Array.isArray(prior.openForeshadows) ? prior.openForeshadows : [])];
  for (const update of updates) {
    const index = openForeshadows.findIndex(item => item && String(item.id || '') === String(update.id));
    if (index >= 0) openForeshadows[index] = { ...openForeshadows[index], status: String(update.status), resolutionQuote: update.quote, resolvedChapter: chapterNo };
  }
  for (const item of promises) {
    const id = String(item.id || `promise_${hashValue({ contentHash, quote: item.quote }).slice(0, 24)}`);
    if (openForeshadows.some(existing => existing && String(existing.id || '') === id)) continue;
    openForeshadows.push({ id, text: item.text, quote: item.quote, status: 'open', originChapter: chapterNo });
  }
  const recentFacts = [
    ...rules.map(item => ({ ...item, sourceType: 'rule' })),
    ...promises.map(item => ({ ...item, sourceType: 'promise' })),
    ...Object.entries(byEntity).flatMap(([entity, values]) => values.map(item => ({ ...item, entity, sourceType: 'entity' }))),
    ...updates.map(item => ({ ...item, sourceType: 'update' }))
  ];
  const causalDebts = [
    ...promises.map(item => ({ type: 'arc', seed: item.text, quote: item.quote, originChapter: chapterNo })),
    ...rules.filter(item => /代价|副作用|损失/.test(String(item.kind || '')))
      .map(item => ({ type: 'micro', seed: item.text, quote: item.quote, originChapter: chapterNo }))
  ].slice(0, 12);
  const outlineImpact = asRecord(evidence.outlineImpact);
  return {
    characterStates: projectStateMap(prior.characterStates, characterDelta, ['lifeStatus', 'location']),
    relationshipStates: projectStateMap(prior.relationshipStates, relationDelta),
    worldStates: projectStateMap(prior.worldStates, worldDelta),
    timeline: timeline.slice(-500),
    openForeshadows: openForeshadows.slice(-500),
    recentFacts,
    causalDebts,
    outlineImpact: {
      status: ['aligned', 'partial', 'diverged', 'unplanned'].includes(String(outlineImpact.status)) ? String(outlineImpact.status) : 'unplanned',
      addressed: verifiedEntries(text, outlineImpact.addressed),
      deferred: verifiedEntries(text, outlineImpact.deferred),
      unresolved: Array.isArray(outlineImpact.unresolved) ? outlineImpact.unresolved.map(value => String(value).slice(0, 500)).slice(0, 64) : [],
      chapterNo, contentHash
    },
    factLedgerDelta: { newRules: rules, newPromises: promises, byEntity, updates }
  };
}

module.exports = { deriveGenerationCommitProjection, verifiedEntries };
