'use strict';
const { isDeepStrictEqual } = require('node:util');
const clone = value => structuredClone(value);
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status, statusCode: status }); }
function id(value) { if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('INVALID_ID', 422); return value; }
function kind(value) { if (!['reading', 'blind'].includes(value)) fail('INVALID_JOB_KIND', 422); return value; }
function actor(input) {
  const owner = id(input.owner);
  if (owner.includes('@') && !input.actorUserId) fail('ACTOR_USER_ID_REQUIRED', 422);
  return id(input.actorUserId || owner);
}
function publicRow(row) { return row ? { job: clone(row.payload), revision: Number(row.revision) } : null; }

/** SQL executes only through the parent repository's actor/worker transactions. */
function createPostgresLabJobMethods({ withTransaction, withWorkerTransaction, internalUuid }) {
  async function select(client, input, lock = false) {
    const result = await client.query(`SELECT payload, revision FROM luna.lab_jobs
      WHERE owner_id=$1::uuid AND job_kind=$2::text AND job_id=$3::text${lock ? ' FOR UPDATE' : ''}`,
    [internalUuid(actor(input)), kind(input.kind), id(input.id || input.job?.id)]);
    return result.rows[0];
  }
  async function save(client, input) {
    if (!input.job || input.job.owner !== input.owner) fail('OWNER_MISMATCH', 403);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('VERSION_REQUIRED', 428);
    const previous = await select(client, input, true);
    if (previous && previous.payload.owner !== input.owner) fail('OWNER_MISMATCH', 403);
    if (Number(previous?.revision || 0) !== input.expectedRevision) fail('REVISION_CONFLICT');
    const payload = clone(input.job);
    for (const [caseId, vote] of Object.entries(previous?.payload?.votes || {})) {
      if (payload.votes?.[caseId] && !isDeepStrictEqual(payload.votes[caseId], vote)) fail('VOTE_IMMUTABLE');
    }
    if (previous?.payload?.votes) payload.votes = { ...payload.votes, ...previous.payload.votes };
    const params = [internalUuid(actor(input)), kind(input.kind), id(payload.id), JSON.stringify(payload)];
    let result;
    if (previous) {
      result = await client.query(`UPDATE luna.lab_jobs SET payload=$4::jsonb, revision=revision+1, updated_at=now()
        WHERE owner_id=$1::uuid AND job_kind=$2::text AND job_id=$3::text AND revision=$5::bigint RETURNING payload,revision`,
      [...params, input.expectedRevision]);
    } else {
      result = await client.query(`INSERT INTO luna.lab_jobs(owner_id,job_kind,job_id,payload,owner_legacy_id)
        VALUES($1::uuid,$2::text,$3::text,$4::jsonb,$5::text) ON CONFLICT DO NOTHING RETURNING payload,revision`, [...params, input.owner]);
    }
    if (!result.rows[0]) fail('REVISION_CONFLICT');
    return publicRow(result.rows[0]);
  }
  return {
    loadLabJob(input) { return withTransaction(actor(input), async client => {
      const row = await select(client, input);
      return row?.payload.owner === input.owner ? publicRow(row) : null;
    }); },
    saveLabJob(input) { return withTransaction(actor(input), client => save(client, input)); },
    listLabJobs(input) {
      const limit = input.limit ?? 40;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) fail('INVALID_LIMIT', 422);
      return withTransaction(actor(input), async client => {
        const result = await client.query(`SELECT payload,revision FROM luna.lab_jobs WHERE owner_id=$1::uuid AND job_kind=$2::text
          ORDER BY updated_at DESC,job_id ASC LIMIT $3::integer`, [internalUuid(actor(input)), kind(input.kind), limit]);
        return result.rows.filter(row => row.payload.owner === input.owner).map(publicRow);
      });
    },
    voteLabJob(input) {
      return withTransaction(actor(input), async client => {
        const previous = await select(client, input, true);
        if (!previous || previous.payload.owner !== input.owner) fail('JOB_NOT_FOUND', 404);
        const caseId = id(input.caseId);
        if (previous.payload.votes?.[caseId]) fail('VOTE_IMMUTABLE');
        return save(client, { ...input, job: { ...previous.payload, votes: { ...previous.payload.votes, [caseId]: clone(input.vote) } } });
      });
    },
    listLabReferenceVotes(input) {
      return withTransaction(actor(input), async client => {
        const result = await client.query('SELECT scene_id,scores FROM luna.lab_reference_votes WHERE owner_id=$1::uuid ORDER BY scene_id', [internalUuid(actor(input))]);
        return result.rows.map(row => ({ sceneId: row.scene_id, scores: clone(row.scores) }));
      });
    },
    recordLabReferenceVote(input) {
      return withTransaction(actor(input), async client => {
        const result = await client.query(`INSERT INTO luna.lab_reference_votes(owner_id,scene_id,scores)
          VALUES($1::uuid,$2::text,$3::jsonb) ON CONFLICT DO NOTHING RETURNING scene_id`,
        [internalUuid(actor(input)), id(input.sceneId), JSON.stringify(input.scores)]);
        if (!result.rows[0]) fail('VOTE_IMMUTABLE');
        return { ok: true };
      });
    },
    recoverLabJobs(input = {}) {
      if (input.kind != null) kind(input.kind);
      return withWorkerTransaction(async client => {
        const result = await client.query(`SELECT * FROM luna.lab_jobs WHERE payload->>'status' IN ('running','queued')
          ${input.kind ? 'AND job_kind=$1::text' : ''} FOR UPDATE`, input.kind ? [input.kind] : []);
        for (const row of result.rows) {
          const job = clone(row.payload);
          const journaledAttempts = Array.isArray(job.attempts) ? job.attempts.length : Object.keys(job.stages || {}).length;
          const unresolved = (job.attempts || []).some(attempt => ['running', 'provider_started', 'provider_unknown'].includes(attempt.status)) ||
            job.pendingProvider === true || Number(job.callCount || 0) > journaledAttempts;
          job.status = unresolved ? 'needs_review' : 'interrupted';
          job.error = unresolved ? 'Provider outcome or usage is unresolved; manual review required before resume.' : 'Service restarted; saved stages preserved.';
          for (const attempt of job.attempts || []) if (['running', 'provider_started'].includes(attempt.status)) {
            attempt.status = 'provider_unknown'; attempt.error = 'Service restarted while provider call was unresolved.';
          }
          await client.query(`UPDATE luna.lab_jobs SET payload=$4::jsonb,revision=revision+1,updated_at=now()
            WHERE owner_id=$1::uuid AND job_kind=$2::text AND job_id=$3::text AND revision=$5::bigint`,
          [row.owner_id, row.job_kind, row.job_id, JSON.stringify(job), row.revision]);
        }
        return { recovered: result.rows.length };
      });
    },
    recoverLabJobsScoped(input = {}) {
      const owner = id(input.owner);
      const actorId = actor(input);
      if (input.kind != null) kind(input.kind);
      return withTransaction(actorId, async client => {
        const result = await client.query(`SELECT * FROM luna.lab_jobs WHERE owner_id=$1::uuid
          AND owner_legacy_id=$2::text AND payload->>'status' IN ('running','queued')
          ${input.kind ? 'AND job_kind=$3::text' : ''} FOR UPDATE`, [internalUuid(actorId), owner, ...(input.kind ? [input.kind] : [])]);
        for (const row of result.rows) {
          const job = clone(row.payload);
          const journaledAttempts = Array.isArray(job.attempts) ? job.attempts.length : Object.keys(job.stages || {}).length;
          const unresolved = (job.attempts || []).some(attempt => ['running', 'provider_started', 'provider_unknown'].includes(attempt.status)) ||
            job.pendingProvider === true || Number(job.callCount || 0) > journaledAttempts;
          job.status = unresolved ? 'needs_review' : 'interrupted';
          job.error = unresolved ? 'Provider outcome or usage is unresolved; manual review required before resume.' : 'Service restarted; saved stages preserved.';
          for (const attempt of job.attempts || []) if (['running', 'provider_started'].includes(attempt.status)) { attempt.status = 'provider_unknown'; attempt.error = 'Service restarted while provider call was unresolved.'; }
          await client.query(`UPDATE luna.lab_jobs SET payload=$4::jsonb,revision=revision+1,updated_at=now() WHERE owner_id=$1::uuid AND job_kind=$2::text AND job_id=$3::text AND revision=$5::bigint`, [row.owner_id, row.job_kind, row.job_id, JSON.stringify(job), row.revision]);
        }
        return { recovered: result.rows.length };
      });
    }
  };
}
module.exports = { createPostgresLabJobMethods };
