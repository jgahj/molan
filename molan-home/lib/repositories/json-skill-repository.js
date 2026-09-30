'use strict';

const crypto = require('node:crypto');
const { hashJson } = require('../evolution/replay-manifest');
const { assertPlatformConfigPromotion } = require('../evolution/platform-config-gate');
const SCOPE = '__molan_skills_v1__';
const clone = value => structuredClone(value);
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status, statusCode: status }); };
const emailOf = value => String(value || '').trim().toLowerCase();
const key = (kind, id) => `skill:${kind}:${id}`;

/** Native skill documents share the app repository lock, queue and redo transactions. */
class JsonSkillRepository {
  constructor(repository, options = {}) {
    if (!repository?.transaction || !repository?.novels) throw new TypeError('shared JsonFileRepository required');
    this.repository = repository;
    this.now = options.now || Date.now;
    this.guardGlobalWrite = options.guardGlobalWrite || assertPlatformConfigPromotion;
    this.backend = 'json';
  }

  actor(tx, userId) {
    const actor = tx.get(null, 'accounts', `account:${userId}`);
    if (!actor || actor.kind !== 'account' || actor.deleted || actor.disabled || actor.status === 'disabled') fail('UNAUTHENTICATED', 401);
    return actor;
  }
  owner(tx, actorUserId, ownerEmail) {
    const actor = this.actor(tx, actorUserId);
    const owner = tx.list(null, 'accounts').find(row => row.kind === 'account' && emailOf(row.email) === emailOf(ownerEmail) && !row.deleted);
    if (!owner) fail('ACCOUNT_NOT_FOUND', 404);
    if (owner.userId !== actor.userId && actor.role !== 'admin') fail('FORBIDDEN', 403);
    return owner;
  }
  normalize(skill) {
    if (!skill || typeof skill.id !== 'string' || !skill.id.trim() || skill.id.length > 256 ||
        typeof skill.name !== 'string' || !skill.name.trim() || typeof skill.instruction !== 'string' || !skill.instruction.trim()) fail('INVALID_SKILL', 422);
    if (skill.instruction.length > 1000000) fail('SKILL_TOO_LARGE', 413);
    if (skill.runtimeFiles !== undefined && (!skill.runtimeFiles || typeof skill.runtimeFiles !== 'object' || Array.isArray(skill.runtimeFiles))) fail('INVALID_SKILL_FILES', 422);
    for (const [filename, content] of Object.entries(skill.runtimeFiles || {})) {
      if (!filename || filename.startsWith('/') || filename.includes('\\') || filename.includes(':') || filename.split('/').some(part => !part || part === '.' || part === '..') ||
          content !== null && typeof content !== 'string') fail('INVALID_SKILL_FILES', 422);
    }
    if (skill.status !== undefined && !['published', 'withdrawn'].includes(skill.status)) fail('INVALID_SKILL_STATUS', 422);
    return clone(skill);
  }
  audit(tx, action, actorUserId, target, value) {
    tx.put(SCOPE, 'ledger', { id: `skill-audit:${crypto.randomUUID()}`, kind: 'skill-audit', action, actorUserId,
      target, ownerUserId: value.ownerUserId || actorUserId, contentHash: hashJson(value), snapshot: clone(value), createdAt: this.now() }, 0);
  }
  async listUser({ actorUserId, ownerEmail }) {
    return this.repository.transaction([null, SCOPE], tx => {
      const owner = this.owner(tx, actorUserId, ownerEmail);
      const row = tx.get(SCOPE, 'novels', key('user', owner.userId));
      return { revision: row?.revision || 0, skills: row?.skills || [] };
    });
  }
  async getUser(input) { return (await this.listUser(input)).skills.find(skill => skill.id === input.id) || null; }
  async saveUserRecords({ actorUserId, ownerEmail, skills, expectedRevision }) {
    if (!Array.isArray(skills)) fail('INVALID_SKILLS', 422);
    const normalized = skills.map(skill => this.normalize(skill));
    if (new Set(normalized.map(skill => skill.id)).size !== normalized.length) fail('DUPLICATE_SKILL', 422);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('EXPECTED_REVISION_REQUIRED', 422);
    return this.repository.transaction([null, SCOPE], tx => {
      const owner = this.owner(tx, actorUserId, ownerEmail);
      const saved = tx.put(SCOPE, 'novels', { id: key('user', owner.userId), kind: 'user-skills', ownerUserId: owner.userId,
        ownerEmail: emailOf(owner.email), skills: normalized, updatedAt: this.now() }, expectedRevision);
      this.audit(tx, 'user.replace', actorUserId, saved.id, saved);
      return { revision: saved.revision, skills: saved.skills };
    });
  }
  async listGlobal() {
    const row = await this.repository.novels.get(SCOPE, key('global', 'all'));
    return { revision: row?.revision || 0, skills: row?.skills || [] };
  }
  async saveGlobal({ actorUserId, skills, expectedRevision, qualityEvidence }) {
    if (!Array.isArray(skills) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_SKILLS_REVISION', 422);
    const normalized = skills.map(skill => this.normalize(skill));
    if (new Set(normalized.map(skill => skill.id)).size !== normalized.length) fail('DUPLICATE_SKILL', 422);
    return this.repository.transaction([null, SCOPE], async tx => {
      if (this.actor(tx, actorUserId).role !== 'admin') fail('FORBIDDEN', 403);
      await this.guardGlobalWrite({ kind: 'global-prompts', proposed: normalized, evidence: qualityEvidence });
      const saved = tx.put(SCOPE, 'novels', { id: key('global', 'all'), kind: 'global-skills', skills: normalized, updatedAt: this.now() }, expectedRevision);
      this.audit(tx, 'global.replace', actorUserId, saved.id, saved);
      return { revision: saved.revision, skills: saved.skills };
    });
  }
  visible(skill, actor) { return skill.status === 'published' || actor && (actor.role === 'admin' || actor.userId === skill.ownerUserId); }
  async listOpen({ actorUserId } = {}) {
    return this.repository.transaction([null, SCOPE], tx => {
      const actor = actorUserId ? this.actor(tx, actorUserId) : null;
      return tx.list(SCOPE, 'novels').filter(row => row.kind === 'open-skill' && !row.deleted && this.visible(row, actor)).map(({ id, recordId, ...row }) => ({ ...row, id: recordId }));
    });
  }
  async getOpen(input) { return (await this.listOpen(input)).find(skill => skill.id === input.id) || null; }
  async saveOpen({ actorUserId, skill, expectedRevision }) {
    const normalized = this.normalize(skill);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('EXPECTED_REVISION_REQUIRED', 422);
    return this.repository.transaction([null, SCOPE], tx => {
      const actor = this.actor(tx, actorUserId);
      const old = tx.get(SCOPE, 'novels', key('open', normalized.id));
      if (old?.deleted) fail('SKILL_DELETED', 409);
      if (old && old.ownerUserId !== actor.userId && actor.role !== 'admin') fail('FORBIDDEN', 403);
      if (!old && normalized.ownerEmail && emailOf(normalized.ownerEmail) !== emailOf(actor.email)) fail('FORBIDDEN', 403);
      const saved = tx.put(SCOPE, 'novels', { ...normalized, id: key('open', normalized.id), recordId: normalized.id, kind: 'open-skill',
        ownerUserId: old?.ownerUserId || actor.userId, ownerEmail: old?.ownerEmail || emailOf(actor.email),
        status: normalized.status === 'withdrawn' ? 'withdrawn' : 'published', downloads: old?.downloads || 0,
        createdAt: old?.createdAt || this.now(), updatedAt: this.now() }, expectedRevision);
      this.audit(tx, old ? 'open.update' : 'open.publish', actorUserId, saved.id, saved);
      return { ...saved, id: saved.recordId };
    });
  }
  async deleteOpen({ actorUserId, id, expectedRevision }) {
    return this.repository.transaction([null, SCOPE], tx => {
      const actor = this.actor(tx, actorUserId);
      const row = tx.get(SCOPE, 'novels', key('open', id));
      if (!row || row.deleted) return 0;
      if (row.ownerUserId !== actor.userId && actor.role !== 'admin') fail('FORBIDDEN', 403);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('EXPECTED_REVISION_REQUIRED', 422);
      const saved = tx.remove(SCOPE, 'novels', row.id, expectedRevision);
      this.audit(tx, 'open.delete', actorUserId, row.id, saved);
      return 1;
    });
  }
  async downloadOpen({ actorUserId, id, requestId }) {
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 256) fail('IDEMPOTENCY_KEY_REQUIRED', 422);
    return this.repository.transaction([null, SCOPE], tx => {
      const actor = this.actor(tx, actorUserId);
      const receiptId = key('download', `${actorUserId}:${requestId}`);
      const receipt = tx.get(SCOPE, 'ledger', receiptId);
      if (receipt) {
        if (receipt.sourceId !== id) fail('IDEMPOTENCY_CONFLICT');
        return receipt.skill;
      }
      const source = tx.get(SCOPE, 'novels', key('open', id));
      if (!source || source.deleted || !this.visible(source, actor)) fail('SKILL_NOT_FOUND', 404);
      const previous = tx.get(SCOPE, 'novels', key('user', actor.userId));
      const skills = previous?.skills || [];
      const downloaded = { id: `download-${crypto.randomUUID()}`, name: source.name, description: source.description || '', instruction: source.instruction,
        files: source.files || [], runtimeFiles: source.runtimeFiles || {}, fileManifest: source.fileManifest || [], complete: source.complete !== false,
        size: source.instruction.length, updatedAt: this.now(), sourceSkillId: id, sourceRevision: source.revision, sourceContentHash: hashJson(source) };
      tx.put(SCOPE, 'novels', { id: key('user', actor.userId), kind: 'user-skills', ownerUserId: actor.userId, ownerEmail: emailOf(actor.email),
        skills: [...skills, downloaded], updatedAt: this.now() }, previous?.revision || 0);
      tx.put(SCOPE, 'novels', { ...source, downloads: source.downloads + 1 }, source.revision);
      tx.put(SCOPE, 'ledger', { id: receiptId, kind: 'skill-download', actorUserId, sourceId: id, sourceRevision: source.revision,
        skill: downloaded, createdAt: this.now() }, 0);
      this.audit(tx, 'open.download', actorUserId, source.id, downloaded);
      return downloaded;
    });
  }
  async listAudit({ actorUserId, ownerEmail } = {}) {
    return this.repository.transaction([null, SCOPE], tx => {
      const actor = this.actor(tx, actorUserId);
      const owner = ownerEmail ? this.owner(tx, actorUserId, ownerEmail) : actor;
      return tx.list(SCOPE, 'ledger').filter(row => row.kind === 'skill-audit' && (actor.role === 'admin' || row.ownerUserId === owner.userId));
    });
  }
}

module.exports = { JsonSkillRepository, SKILL_SCOPE: SCOPE };
