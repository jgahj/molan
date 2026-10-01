'use strict';

const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}
const stableDigest = value => digest(stableValue(value));
const compareIds = (left, right) => {
  const a = String(left), b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
};
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, statusCode: status }); };
const camel = key => key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
const convert = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [camel(key), value instanceof Date ? value.getTime() : value]));
const numeric = row => {
  const result = convert(row);
  for (const field of ['stateVersion', 'baseStateVersion', 'novelRevision', 'revision', 'attemptCount', 'sequence', 'budgetTokens']) if (result[field] !== undefined) result[field] = Number(result[field]);
  return result;
};

// Closed table/column maps bind the pure memory domain to 0024/0025. These are
// native relational reads/writes, never SQL parsing or a compatibility database.
const SPECS = [
  { table: 'records', key: ['record_type', 'id'], collect: b => Object.values(b.records), fields: { record_type: 'recordType', id: 'id', timeline_id: r => r.timelineId || 't0', cycle_id: r => r.cycleId || 'c0', status: r => r.status || 'active', revision: 'revision', payload: r => r, created_by: '@actor' }, json: ['payload'] },
  { table: 'manuscripts', key: ['id'], collect: b => Object.values(b.manuscripts), fields: { id: 'id', chapter_id: 'chapterId', scene_id: 'sceneId', revision: 'revision', content: 'content', content_hash: 'contentHash', source_hash: 'sourceHash', novel_revision: 'novelRevision', config_hash: 'configHash', created_by: '@actor' } },
  { table: 'manuscript_heads', key: ['chapter_id', 'scene_id'], collect: b => Object.entries(b.heads).map(([key, row]) => ({ ...row, chapterId: key.split(':')[0], sceneId: key.split(':').slice(1).join(':') })), fields: { chapter_id: 'chapterId', scene_id: 'sceneId', current_id: 'currentId', accepted_id: r => r.acceptedId || '', revision: 'revision' } },
  { table: 'rewrite_contracts', key: ['id'], collect: b => Object.values(b.contracts), fields: { id: 'id', candidate_hash: r => r.candidateHash || '', contract: r => r, created_by: '@actor' }, json: ['contract'] },
  { table: 'rewrite_reviews', key: ['id'], collect: b => Object.values(b.reviews), fields: { id: 'id', manuscript_id: 'manuscriptRevisionId', contract_id: 'contractId', candidate_hash: 'candidateHash', passed: 'passed', report: 'report', created_by: '@actor' }, json: ['report'] },
  { table: 'changesets', key: ['id'], collect: b => Object.values(b.changesets), fields: { id: 'id', base_state_version: 'baseStateVersion', candidate_hash: 'candidateHash', operations: 'operations', dependencies: 'dependencies', risk_level: r => r.riskLevel || 'low', audit_report: r => ({ ...r.auditReport, nativeApprovalHash: r.approvalHash }), approval_policy: 'approvalPolicy', approval_status: 'approvalStatus', approved_by: r => r.approvedBy || null, approved_at: r => r.approvedAt ? new Date(r.approvedAt) : null, committed_at: r => r.committedAt ? new Date(r.committedAt) : null, created_by: r => r.createdBy }, json: ['operations', 'dependencies', 'audit_report'] },
  { table: 'changeset_sources', key: ['changeset_id'], collect: b => Object.values(b.changesets).filter(c => c.source).map(c => ({ changesetId: c.id, manuscriptId: c.source.manuscriptId, bindingHash: digest(c.source) })), fields: { changeset_id: 'changesetId', manuscript_id: 'manuscriptId', binding_hash: 'bindingHash' } },
  { table: 'commit_receipts', key: ['actor_id', 'request_key'], collect: b => Object.values(b.receipts), fields: { actor_id: 'actorId', request_key: 'requestKey', request_hash: 'requestHash', changeset_id: 'changesetId', receipt: 'receipt' }, json: ['receipt'] },
  { table: 'operations', key: ['id'], collect: b => b.operations, fields: { id: 'id', changeset_id: 'changesetId', operation_type: 'operationType', record_type: 'recordType', record_id: 'recordId', before_state: r => r.before || {}, after_state: 'after', reverted: r => Boolean(r.reverted), revert_reason: r => r.revertReason || '', created_by: r => r.actorId }, json: ['before_state', 'after_state'] },
  { table: 'outbox', key: ['id'], collect: b => b.outbox, fields: { id: 'id', event_id: 'eventId', state_version: 'stateVersion', projection_type: () => 'causal_debts_and_snapshots', payload_hash: 'payloadHash', payload: 'payload', status: 'status', attempt_count: 'attemptCount', last_error: r => r.lastError || '' }, json: ['payload'] },
  { table: 'context_manifests', key: ['id'], collect: b => Object.values(b.manifests), fields: { id: 'id', state_version: 'stateVersion', writing_package: 'writingPackage', audit_package: 'auditPackage', included_reasons: 'includedReasons', excluded_reasons: 'excludedReasons', budget_tokens: 'budgetTokens', input_hash: 'inputHash', model_id: 'modelId', created_by: '@actor' }, json: ['writing_package', 'audit_package', 'included_reasons', 'excluded_reasons'] },
  { table: 'generation_runs', key: ['id'], collect: b => Object.values(b.generations || {}), fields: { id: 'id', actor_id: 'actorId', request_id: 'requestId', request_hash: 'requestHash', status: 'status', manifest_id: 'manifestId', input: 'input', result: r => ({ ...r.result, _molanProviderEvidenceV1: { costStatus: r.costStatus || null, settledCreditCost: r.settledCreditCost ?? null, providerResponses: r.providerResponses || [] } }), calls: 'calls', updated_at: r => new Date(r.updatedAt) }, json: ['input', 'result'] },
  { table: 'invalidations', key: ['id'], collect: b => b.invalidations, fields: { id: 'id', manuscript_id: 'manuscriptId', reason: 'reason', created_by: '@actor' } },
  { table: 'extractions', key: ['manuscript_id'], collect: b => Object.entries(b.extractions).map(([manuscriptId, result]) => ({ manuscriptId, result })), fields: { manuscript_id: 'manuscriptId', result: 'result', created_by: '@actor' }, json: ['result'] },
  { table: 'projection_snapshots', key: [], collect: b => b.projection ? [b.projection] : [], fields: { state_version: 'stateVersion', schema_version: 'schemaVersion', payload_hash: 'payloadHash', payload: 'payload' }, json: ['payload'] }
];
const where = 'workspace_id=$1::uuid AND project_id=$2::uuid AND book_id=$3::uuid AND branch_id=$4';
const scoped = (scope, branchId) => [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, branchId];

async function load(client, scope, b, branchId) {
  for (const spec of SPECS) {
    const raw = (await client.query(`SELECT * FROM luna.story_memory_${spec.table} WHERE ${where}`, scoped(scope, branchId))).rows;
    const list = raw.map(numeric);
    switch (spec.table) {
      case 'generation_runs': b.generations = Object.fromEntries(list.map(r => {
        const result = { ...r.result }, proof = result._molanProviderEvidenceV1;
        delete result._molanProviderEvidenceV1;
        return [r.id, { ...r, result, ...(proof || {}), bookId: scope.bookId, branchId }];
      })); break;
      case 'records': for (const r of list) b.records[r.id] = { ...convert(r.payload), ...r.payload, id: r.id, recordType: r.recordType, revision: r.revision, status: r.status, createdAt: r.createdAt }; break;
      case 'manuscripts': for (const r of list) b.manuscripts[r.id] = r; break;
      case 'manuscript_heads': for (const r of list) b.heads[`${r.chapterId}:${r.sceneId}`] = r; break;
      case 'rewrite_contracts': for (const r of list) b.contracts[r.id] = { ...r.contract, id: r.id }; break;
      case 'rewrite_reviews': for (const r of list) b.reviews[r.id] = { ...r, manuscriptRevisionId: r.manuscriptId }; break;
      case 'changesets': for (const r of list) { const audit = { ...r.auditReport }; delete audit.nativeApprovalHash; b.changesets[r.id] = { ...r, bookId: scope.bookId, auditReport: audit, approvalHash: r.auditReport.nativeApprovalHash }; } break;
      case 'changeset_sources': for (const r of list) if (b.changesets[r.changesetId]) b.changesets[r.changesetId].source = { manuscriptId: r.manuscriptId }; break;
      case 'commit_receipts': for (const r of list) b.receipts[digest([r.actorId, r.requestKey])] = r; break;
      case 'operations': b.operations = list.map(r => ({ ...r, actorId: r.createdBy, before: r.beforeState?.id ? r.beforeState : null, after: r.afterState })); break;
      case 'outbox': b.outbox = list; break;
      case 'context_manifests': for (const r of list) b.manifests[r.id] = { ...r, bookId: scope.bookId, outputReserve: r.auditPackage?.inputMetadata?.outputReserve || 0, estimatedInputTokens: r.auditPackage?.inputMetadata?.estimatedInputTokens, estimator: r.auditPackage?.inputMetadata?.estimator, compiledContext: r.auditPackage?.inputMetadata?.compiledContext, contextPlan: r.auditPackage?.inputMetadata?.contextPlan }; break;
      case 'invalidations': b.invalidations = list; break;
      case 'extractions': for (const r of list) b.extractions[r.manuscriptId] = r.result; break;
      case 'projection_snapshots': b.projection = list[0]; break;
    }
  }
  // Records written by the former adapter used JSON-suffixed legacy payload fields.
  for (const record of Object.values(b.records)) for (const [key, value] of Object.entries(record)) if (key.endsWith('Json') && typeof value === 'string') {
    try { record[key.slice(0, -4)] = JSON.parse(value); } catch (_) { fail('MEMORY_RECORD_CORRUPT', 500); }
  }
  b.events = (await client.query(`SELECT sequence,run_id,type,data,created_at FROM luna.story_memory_run_events WHERE ${where} ORDER BY sequence`, scoped(scope, branchId))).rows.map(numeric);
  return b;
}

async function persist(client, scope, before, b, branchId) {
  for (const spec of SPECS) {
    const previous = new Map(spec.collect(before).map(r => [digest(spec.key.map(k => { const value = spec.fields[k]; return typeof value === 'function' ? value(r) : r[value]; })), digest(r)]));
    for (const row of spec.collect(b)) {
      const identity = digest(spec.key.map(k => { const value = spec.fields[k]; return typeof value === 'function' ? value(row) : row[value]; }));
      if (previous.get(identity) === digest(row)) continue;
      const columns = ['workspace_id', 'project_id', 'book_id', 'branch_id', ...Object.keys(spec.fields)];
      const values = [...scoped(scope, branchId), ...Object.entries(spec.fields).map(([column, field]) => {
        const value = typeof field === 'function' ? field(row) : field === '@actor' ? scope.actorUuid : row[field];
        return spec.json?.includes(column) ? JSON.stringify(value) : value;
      })];
      if (values.some(v => v === undefined)) fail('MEMORY_RECORD_CORRUPT', 500);
      const keys = ['workspace_id', 'project_id', 'book_id', 'branch_id', ...spec.key];
      const updates = columns.filter(c => !keys.includes(c) && c !== 'created_by').map(c => `${c}=EXCLUDED.${c}`);
      await client.query(`INSERT INTO luna.story_memory_${spec.table} (${columns.join(',')}) VALUES (${columns.map((c, i) => `$${i + 1}${spec.json?.includes(c) ? '::jsonb' : ''}`).join(',')}) ON CONFLICT (${keys.join(',')}) ${updates.length ? `DO UPDATE SET ${updates.join(',')}` : 'DO NOTHING'}`, values);
    }
  }
  // Append-only source history accompanies each replacement of a memory record.
  for (const [rid, previous] of Object.entries(before.records)) if (b.records[rid] && previous.revision !== b.records[rid].revision) {
    await client.query(`INSERT INTO luna.story_memory_record_versions (workspace_id,project_id,book_id,branch_id,record_type,record_id,revision,payload,changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT DO NOTHING`, [...scoped(scope, branchId), previous.recordType, rid, previous.revision, JSON.stringify(previous), scope.actorUuid]);
  }
  for (const event of b.events.slice(before.events.length)) await client.query(`INSERT INTO luna.story_memory_run_events (workspace_id,project_id,book_id,branch_id,run_id,type,data) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [...scoped(scope, branchId), event.runId, event.type, JSON.stringify(event.data)]);
  await client.query(`UPDATE luna.story_memory_branches SET state_version=$5,updated_at=now() WHERE ${where}`, [...scoped(scope, branchId), b.stateVersion]);
}

function createPostgresMemoryStore(options, makeStore, blank, branch) {
  if (typeof makeStore !== 'function' || typeof blank !== 'function' || typeof branch !== 'function') fail('PG_MEMORY_STORE_FACTORY_REQUIRED', 500);
  const repository = options.repository;
  if (!repository?.withCreationBookTransaction) fail('PG_MEMORY_REPOSITORY_REQUIRED', 503);
  async function transact(input, write, action) {
    return repository.withCreationBookTransaction({ userId: input.userId, bookId: input.bookId, write: write && !input.approval }, async (client, scope) => {
      if (write && !['owner', 'admin', 'editor', 'author', ...(input.approval ? ['reviewer'] : [])].includes(scope.access.role)) fail('FORBIDDEN', 403);
      const branchId = input.branchId || 'main', params = scoped(scope, branchId);
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(branchId)) fail('INVALID_BRANCH', 422);
      if (write) await client.query(`INSERT INTO luna.story_memory_branches (workspace_id,project_id,book_id,branch_id,state_version) VALUES ($1,$2,$3,$4,1) ON CONFLICT DO NOTHING`, params);
      const head = (await client.query(`SELECT state_version FROM luna.story_memory_branches WHERE ${where} ${write ? 'FOR UPDATE' : 'FOR SHARE'}`, params)).rows[0];
      const state = blank(scope.bookId), b = branch(state, branchId); b.stateVersion = Number(head?.state_version || 1);
      await load(client, scope, b, branchId);
      const profile = (await client.query(`SELECT revision,payload FROM luna.project_profiles WHERE workspace_id=$1 AND project_id=$2 ${write ? 'FOR UPDATE' : 'FOR SHARE'}`, [scope.workspaceUuid, scope.projectUuid])).rows[0];
      const novel = { state: profile?.payload || { volumes: [], title: scope.book.title }, contentRevision: Number(profile?.revision || 1), aclRevision: Number(scope.access.acl_revision || 0) };
      const before = structuredClone(b), initialRevision = novel.contentRevision;
      const resolved = { ...scope.access, active: 1, userId: scope.actorUuid, bookId: scope.bookId, projectId: scope.projectId, branchId, role: scope.access.role };
      const readConfigurationSnapshot = async () => {
        const result = await client.query(
          `SELECT
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object('id', id, 'active', active, 'revision', revision) ORDER BY id)
               FROM luna.style_profiles
               WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid AND branch_id = $4::text
             ), '[]'::jsonb) AS style_profiles,
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'id', COALESCE(NULLIF(legacy_id, ''), id::text), 'kind', kind, 'status', status, 'revision', revision
               ) ORDER BY COALESCE(NULLIF(legacy_id, ''), id::text), id)
               FROM luna.project_resources
               WHERE workspace_id = $1::uuid AND project_id = $2::uuid
             ), '[]'::jsonb) AS resources,
             (
               SELECT jsonb_build_object(
                 'id', COALESCE(NULLIF(legacy_id, ''), id::text), 'revision', revision, 'plan', plan,
                 'currentStateVersion', current_state_version, 'currentChapterNo', current_chapter_no
               )
               FROM luna.creation_books
               WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND id = $3::uuid
             ) AS creation_book,
             (
               SELECT jsonb_build_object('version', revision, 'payloadHash', payload_hash, 'payload', payload)
               FROM luna.creation_bibles
               WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
               ORDER BY revision DESC LIMIT 1
             ) AS bible`,
          [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, branchId]
        );
        const row = result.rows[0] || {};
        const asArray = value => Array.isArray(value) ? value : [];
        const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
        const creationBook = asObject(row.creation_book);
        const bible = asObject(row.bible);
        const disclosures = Object.values(b.records)
          .filter(record => record.recordType === 'disclosure' && (record.branchId || 'main') === branchId)
          .map(record => structuredClone(record))
          .sort((left, right) => compareIds(left.id, right.id));
        return {
          novelSettings: structuredClone(novel.state?.settings || novel.state?.config || {}),
          styleProfiles: asArray(row.style_profiles).map(record => ({
            id: String(record.id || ''),
            bookId: scope.bookId,
            active: record.active === true || record.active === 't',
            revision: Number(record.revision)
          })).sort((left, right) => compareIds(left.id, right.id)),
          resources: asArray(row.resources).map(record => ({
            id: String(record.id || ''), kind: String(record.kind || ''), status: String(record.status || ''), revision: Number(record.revision)
          })).sort((left, right) => compareIds(left.id, right.id)),
          disclosures,
          creationBook: creationBook ? {
            id: String(creationBook.id || scope.bookId),
            revision: Number(creationBook.revision),
            plan: structuredClone(creationBook.plan || {}),
            currentStateVersion: Number(creationBook.currentStateVersion || 0),
            currentChapterNo: Number(creationBook.currentChapterNo || 0)
          } : null,
          bible: bible ? {
            version: Number(bible.version),
            payloadHash: String(bible.payloadHash || ''),
            payload: structuredClone(bible.payload || {})
          } : null
        };
      };
      const context = {
        readConfigurationSnapshot,
        readBaseline: async name => {
          if (name === 'novelRevision') return profile?.revision == null ? undefined : Number(profile.revision);
          if (name === 'aclRevision') return scope.access.acl_revision == null ? undefined : Number(scope.access.acl_revision);
          if (name === 'bibleVersion') return scope.book.bible_revision == null ? undefined : Number(scope.book.bible_revision);
          if (name === 'planVersion') return scope.book.current_state_version == null ? undefined : Number(scope.book.current_state_version);
          if (name === 'disclosurePolicyVersion') return Object.values(b.records)
            .filter(record => record.recordType === 'disclosure' && (record.branchId || 'main') === branchId).length;
          if (name === 'styleVersion') {
            const result = await client.query(
              `SELECT revision FROM luna.style_profiles
               WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
                 AND branch_id = $4::text AND active = true
               ORDER BY updated_at DESC, id ASC LIMIT 1`,
              [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, branchId]
            );
            return result.rows[0] ? Number(result.rows[0].revision) : undefined;
          }
          return undefined;
        }
      };
      const result = await action(b, novel, resolved, state, context);
      if (write) {
        await persist(client, scope, before, b, branchId);
        if (novel._memoryDirty) {
          const saved = await client.query(`UPDATE luna.project_profiles SET payload=$3::jsonb,revision=$4,updated_at=now() WHERE workspace_id=$1 AND project_id=$2 AND revision=$5`, [scope.workspaceUuid, scope.projectUuid, JSON.stringify(novel.state), novel.contentRevision, initialRevision]);
          if (saved.rowCount !== 1) fail('CONTENT_VERSION_CONFLICT');
        }
      }
      return result;
    });
  }
  const locateRun = async input => {
    for (const book of await repository.listCreationBooks(input.userId)) {
      const located = await repository.withCreationBookTransaction({ userId: input.userId, bookId: book.bookId || book.id, write: false }, async (client, scope) => {
        const params = [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, input.runId];
        const result = await client.query(`SELECT branch_id FROM (
          SELECT branch_id,id FROM luna.story_memory_generation_runs WHERE workspace_id=$1 AND project_id=$2 AND book_id=$3
          UNION ALL SELECT branch_id,id FROM luna.story_memory_changesets WHERE workspace_id=$1 AND project_id=$2 AND book_id=$3
          UNION ALL SELECT branch_id,id FROM luna.story_memory_manuscripts WHERE workspace_id=$1 AND project_id=$2 AND book_id=$3
          UNION ALL SELECT branch_id,id FROM luna.story_memory_outbox WHERE workspace_id=$1 AND project_id=$2 AND book_id=$3
          UNION ALL SELECT branch_id,event_id AS id FROM luna.story_memory_outbox WHERE workspace_id=$1 AND project_id=$2 AND book_id=$3
        ) runs WHERE id=$4 LIMIT 1`, params);
        return result.rows[0] ? { bookId: scope.bookId, branchId: result.rows[0].branch_id } : null;
      });
      if (located) return located;
    }
    return null;
  };
  return makeStore({ backend: 'postgres', repository, read: (input, action) => transact(input, false, action), write: (input, action) => transact(input, true, action), locateRun, resolve: input => transact(input, false, (b, novel, scope) => scope), close: async () => {} });
}
module.exports = { createPostgresMemoryStore };
