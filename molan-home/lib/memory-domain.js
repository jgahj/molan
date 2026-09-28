'use strict';

const crypto = require('node:crypto');
const workflow = require('./memory-workflow');

const DEFINITIONS = Object.freeze({
  INSERT_EVENT: {
    table: 'story_events',
    fields: { title: 'title', summary: 'summary', eventType: 'event_type', timelineId: 'timeline_id',
      cycleId: 'cycle_id', storyTime: 'story_time', narrativePosition: 'narrative_position', sceneId: 'scene_id',
      povEntityId: 'pov_entity_id', sourceEvidenceIds: 'source_evidence_ids_json', preconditions: 'preconditions_json' },
    required: ['title']
  },
  UPSERT_PLAN: {
    table: 'story_plans', fields: { title: 'title', content: 'content', targetChapterRange: 'target_chapter_range',
      preconditions: 'preconditions_json', participantIds: 'participant_ids_json', status: 'status', realizationEventId: 'realization_event_id' },
    required: ['title'], states: ['planned', 'active', 'completed', 'abandoned']
  },
  UPSERT_FORESHADOW: {
    table: 'story_foreshadows', fields: { title: 'title', anchor: 'anchor_json', targetSecret: 'target_secret',
      disclosedClues: 'disclosed_clues_json', reinforcementEvents: 'reinforcement_events_json',
      plannedPayoffRange: 'planned_payoff_range', requiredConditions: 'required_conditions_json',
      payoffEvidenceIds: 'payoff_evidence_ids_json', status: 'status' },
    required: ['title'], states: ['planned', 'planted', 'reinforced', 'pending_payoff', 'partial', 'resolved', 'abandoned']
  },
  UPSERT_COMMITMENT: {
    table: 'conditional_commitments', fields: { promisorId: 'promisor_id', promiseeId: 'promisee_id',
      triggerCondition: 'trigger_condition', fulfillmentContent: 'fulfillment_content',
      conditionEvidenceIds: 'condition_evidence_ids_json', fulfillmentEvidenceIds: 'fulfillment_evidence_ids_json', status: 'status' },
    required: ['promisorId', 'promiseeId', 'triggerCondition', 'fulfillmentContent'],
    states: ['active', 'triggered', 'fulfilled', 'abandoned']
  },
  SET_DISCLOSURE: {
    table: 'disclosure_policies', fields: { targetInfoId: 'target_info_id', targetInfoType: 'target_info_type',
      chapterRange: 'scope_chapter_range', sceneId: 'scope_scene_id', povId: 'scope_pov_id',
      policyType: 'policy_type', allowedClues: 'allowed_clues_json', forbiddenAnswers: 'forbidden_answers_json' },
    required: ['targetInfoId', 'policyType']
  },
  TEMPORAL_RELATION: {
    table: 'temporal_relations', fields: { sourceEventId: 'source_event_id', targetEventId: 'target_event_id',
      relationType: 'relation_type', timelineId: 'timeline_id', cycleId: 'cycle_id', intervalValue: 'interval_value',
      sourceEvidenceId: 'source_evidence_id', status: 'status' },
    required: ['sourceEventId', 'targetEventId', 'relationType']
  }
});

function initializeSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS memory_record_versions (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL, branch_id TEXT NOT NULL,
    record_type TEXT NOT NULL, record_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, changeset_id TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_record_versions ON memory_record_versions(book_id, branch_id, record_type, record_id, sequence);
  CREATE TABLE IF NOT EXISTS memory_compensations (
    operation_id TEXT PRIMARY KEY, book_id TEXT NOT NULL, branch_id TEXT NOT NULL,
    receipt_json TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  for (const name of ['timeline_id', 'cycle_id']) {
    const columns = db.prepare('PRAGMA table_info(character_cognition)').all().map(row => row.name);
    if (!columns.includes(name)) db.exec(`ALTER TABLE character_cognition ADD COLUMN ${name} TEXT NOT NULL DEFAULT '${name === 'timeline_id' ? 't0' : 'c0'}'`);
  }
}

function referenceExists(db, table, id, scope) {
  return typeof id === 'string' && !!db.prepare(`SELECT id FROM ${table} WHERE id = ? AND book_id = ? AND branch_id = ?`)
    .get(id, scope.book_id, scope.branch_id);
}

function validateDomainOperation(db, operation, scope, operations) {
  const definition = DEFINITIONS[operation.type];
  if (!definition) return 'INVALID_MEMORY_OPERATION';
  const payload = operation.payload;
  for (const required of definition.required || []) {
    if (typeof payload[required] !== 'string' || !payload[required].trim()) return 'INVALID_MEMORY_OPERATION';
  }
  if (payload.status && definition.states && !definition.states.includes(payload.status)) return 'INVALID_MEMORY_OPERATION';
  if (payload.id) {
    const previous = db.prepare(`SELECT * FROM ${definition.table} WHERE id = ?`).get(payload.id);
    if (previous && (previous.book_id !== scope.book_id || previous.branch_id !== scope.branch_id)) return 'MEMORY_REFERENCE_INVALID';
    if (previous && (!Object.hasOwn(previous, 'revision') || payload.expectedRevision !== previous.revision)) return 'MEMORY_VERSION_CONFLICT';
    if (!previous && payload.expectedRevision) return 'MEMORY_VERSION_CONFLICT';
  }
  const eventExists = id => referenceExists(db, 'story_events', id, scope) ||
    operations.some(candidate => candidate.type === 'INSERT_EVENT' && candidate.payload.id === id);
  for (const field of Object.keys(definition.fields)) {
    const column = definition.fields[field];
    if (column.endsWith('_json') && payload[field] !== undefined) {
      if (field !== 'anchor' && !Array.isArray(payload[field])) return 'INVALID_MEMORY_OPERATION';
    }
    if (field.endsWith('EvidenceIds')) {
      for (const id of payload[field] || []) if (!referenceExists(db, 'memory_evidence', id, scope)) return 'MEMORY_REFERENCE_INVALID';
    }
  }
  if (operation.type === 'UPSERT_PLAN' && payload.status === 'completed' && !eventExists(payload.realizationEventId)) return 'EVENT_EVIDENCE_REQUIRED';
  if (operation.type === 'UPSERT_FORESHADOW' && ['partial', 'resolved'].includes(payload.status) && !(payload.payoffEvidenceIds || []).length) return 'PAYOFF_EVIDENCE_REQUIRED';
  if (operation.type === 'UPSERT_COMMITMENT') {
    if (['triggered', 'fulfilled'].includes(payload.status) && !(payload.conditionEvidenceIds || []).length) return 'CONDITION_EVIDENCE_REQUIRED';
    if (payload.status === 'fulfilled' && !(payload.fulfillmentEvidenceIds || []).length) return 'FULFILLMENT_EVIDENCE_REQUIRED';
  }
  if (operation.type === 'SET_DISCLOSURE') {
    if (!['allow', 'hide', 'imply'].includes(payload.policyType)) return 'INVALID_MEMORY_OPERATION';
    if (!referenceExists(db, 'memory_propositions', payload.targetInfoId, scope) &&
        !referenceExists(db, 'world_fact_decisions', payload.targetInfoId, scope)) return 'MEMORY_REFERENCE_INVALID';
    if (payload.policyType === 'imply' && !(payload.allowedClues || []).length) return 'DISCLOSURE_CLUES_REQUIRED';
  }
  if (operation.type === 'TEMPORAL_RELATION') {
    if (!['before', 'after', 'simultaneous', 'contains', 'overlaps', 'interval', 'unknown'].includes(payload.relationType)) return 'INVALID_TEMPORAL_RELATION';
    if (!eventExists(payload.sourceEventId) || !eventExists(payload.targetEventId)) return 'MEMORY_REFERENCE_INVALID';
    const timelineId = payload.timelineId || 't0';
    const cycleId = payload.cycleId || 'c0';
    for (const eventId of [payload.sourceEventId, payload.targetEventId]) {
      const event = db.prepare('SELECT timeline_id, cycle_id FROM story_events WHERE id = ?').get(eventId);
      const proposed = operations.find(candidate => candidate.type === 'INSERT_EVENT' && candidate.payload.id === eventId);
      if (event && (event.timeline_id !== timelineId || event.cycle_id !== cycleId)) return 'TEMPORAL_SCOPE_CONFLICT';
      if (proposed && ((proposed.payload.timelineId || 't0') !== timelineId || (proposed.payload.cycleId || 'c0') !== cycleId)) return 'TEMPORAL_SCOPE_CONFLICT';
    }
    const relations = db.prepare(`SELECT * FROM temporal_relations
      WHERE book_id = ? AND branch_id = ? AND timeline_id = ? AND cycle_id = ? AND status = 'confirmed'`)
      .all(scope.book_id, scope.branch_id, timelineId, cycleId);
    relations.push(...operations.filter(candidate => candidate.type === 'TEMPORAL_RELATION' &&
      (candidate.payload.timelineId || 't0') === timelineId && (candidate.payload.cycleId || 'c0') === cycleId).map(candidate => candidate.payload));
    if (!require('./memory-system').validateTemporalRelations(relations)) return 'TEMPORAL_CYCLE';
  }
  return null;
}

function applyDomainOperation(db, operation, scope, actorId) {
  const definition = DEFINITIONS[operation.type];
  const payload = operation.payload;
  const id = payload.id || `${definition.table}_${crypto.randomUUID()}`;
  const before = db.prepare(`SELECT * FROM ${definition.table} WHERE id = ?`).get(id);
  if (before) archiveRecord(db, definition.table, before, scope.id);
  const values = {};
  for (const [field, column] of Object.entries(definition.fields)) {
    if (payload[field] !== undefined) values[column] = column.endsWith('_json') ? JSON.stringify(payload[field]) : payload[field];
  }
  if (operation.type === 'SET_DISCLOSURE') values.approved_by = actorId;
  const columns = Object.keys(values);
  if (before) {
    db.prepare(`UPDATE ${definition.table} SET ${columns.map(column => `${column} = ?`).join(', ')}, revision = revision + 1 WHERE id = ?`)
      .run(...Object.values(values), id);
  } else {
    db.prepare(`INSERT INTO ${definition.table} (id, book_id, branch_id, created_at, ${columns.join(', ')})
      VALUES (${Array(columns.length + 4).fill('?').join(', ')})`)
      .run(id, scope.book_id, scope.branch_id, Date.now(), ...Object.values(values));
  }
  const after = db.prepare(`SELECT * FROM ${definition.table} WHERE id = ?`).get(id);
  db.prepare(`INSERT INTO memory_operations_log
    (id, book_id, branch_id, changeset_id, operation_type, target_table, record_id, before_state_json, after_state_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(`operation_${crypto.randomUUID()}`, scope.book_id, scope.branch_id,
      scope.id, operation.type, definition.table, id, JSON.stringify(before || {}), JSON.stringify(after), Date.now());
}

function archiveRecord(db, table, record, changesetId) {
  db.prepare(`INSERT INTO memory_record_versions
    (book_id, branch_id, record_type, record_id, revision, payload_json, changeset_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(record.book_id, record.branch_id, table, record.id, record.revision || 1,
      JSON.stringify(record), changesetId, Date.now());
}

function revertOperation(db, bookId, operationId, actorId, reason) {
  return workflow.transaction(db, () => {
    const operation = db.prepare('SELECT * FROM memory_operations_log WHERE id = ? AND book_id = ?').get(operationId, bookId);
    if (!operation) return { ok: false, code: 'operation_missing' };
    if (operation.reverted) return { ok: false, code: 'already_reverted' };
    if (!reason || !reason.trim()) return { ok: false, code: 'REVERT_REASON_REQUIRED' };
    const allowedTables = new Set(['world_fact_decisions', 'character_cognition', 'state_transitions', ...Object.values(DEFINITIONS).map(definition => definition.table)]);
    if (!allowedTables.has(operation.target_table)) return { ok: false, code: 'REVERT_UNSUPPORTED' };
    const later = db.prepare(`SELECT id FROM memory_operations_log
      WHERE book_id = ? AND branch_id = ? AND target_table = ? AND record_id = ?
      AND rowid > (SELECT rowid FROM memory_operations_log WHERE id = ?) AND reverted = 0`)
      .get(bookId, operation.branch_id, operation.target_table, operation.record_id, operationId);
    if (later) return { ok: false, code: 'REVERT_DEPENDENCY_CONFLICT' };
    const current = db.prepare(`SELECT * FROM ${operation.target_table} WHERE id = ? AND book_id = ? AND branch_id = ?`)
      .get(operation.record_id, bookId, operation.branch_id);
    if (!current) return { ok: false, code: 'REVERT_TARGET_MISSING' };
    archiveRecord(db, operation.target_table, current, operation.changeset_id);
    const before = JSON.parse(operation.before_state_json);
    const compensationId = `comp_${crypto.randomUUID()}`;
    if (before.id) {
      const columns = Object.keys(before).filter(column => !['id', 'book_id', 'branch_id', 'created_at', 'revision'].includes(column));
      db.prepare(`UPDATE ${operation.target_table} SET ${columns.map(column => `${column} = ?`).join(', ')},
        revision = revision + 1 WHERE id = ?`).run(...columns.map(column => before[column]), current.id);
    } else if (operation.target_table === 'state_transitions') {
      db.prepare(`INSERT INTO state_transitions
        (id, book_id, branch_id, event_id, entity_id, dimension, pre_state, post_state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(compensationId, bookId, operation.branch_id, current.event_id,
          current.entity_id, current.dimension, current.post_state, current.pre_state, Date.now());
    } else if (operation.target_table === 'world_fact_decisions') {
      db.prepare("UPDATE world_fact_decisions SET status = 'revoked', revision = revision + 1 WHERE id = ?").run(current.id);
    } else if (operation.target_table === 'character_cognition') {
      db.prepare("UPDATE character_cognition SET review_status = 'revoked', revision = revision + 1 WHERE id = ?").run(current.id);
    } else {
      return workflow.fail('REVERT_REQUIRES_CORRECTION_CHANGESET', 409);
    }
    db.prepare('UPDATE memory_operations_log SET reverted = 1 WHERE id = ?').run(operationId);
    const nextVersion = workflow.stateVersion(db, bookId, operation.branch_id) + 1;
    db.prepare(`INSERT INTO memory_branch_heads VALUES (?, ?, ?)
      ON CONFLICT(book_id, branch_id) DO UPDATE SET state_version = excluded.state_version`)
      .run(bookId, operation.branch_id, nextVersion);
    const receipt = { ok: true, operationId, compensationId, stateVersion: nextVersion, revertedAt: Date.now(), actorId, reason };
    db.prepare('INSERT INTO memory_compensations VALUES (?, ?, ?, ?, ?)').run(operationId, bookId, operation.branch_id, JSON.stringify(receipt), Date.now());
    const payload = JSON.stringify({ compensationId, operationId, stateVersion: nextVersion });
    db.prepare(`INSERT INTO memory_outbox
      (id, event_id, book_id, branch_id, state_version, projection_type, payload_hash, payload_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'causal_debts_and_snapshots', ?, ?, 'queued', ?, ?)`)
      .run(`outbox_${crypto.randomUUID()}`, compensationId, bookId, operation.branch_id, nextVersion, workflow.digest(payload), payload, Date.now(), Date.now());
    workflow.emitEvent(db, bookId, operation.branch_id, compensationId, 'COMPENSATION_COMMITTED', receipt);
    return receipt;
  });
}

module.exports = { DEFINITIONS, initializeSchema, validateDomainOperation, applyDomainOperation, archiveRecord, revertOperation };
