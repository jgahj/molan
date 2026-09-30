'use strict';

const crypto = require('node:crypto');
const { JsonFileRepository } = require('./repositories/json-file-repository');

const STYLE_LEVELS = new Set([
  'author_preference', 'novel_narrative', 'character_voice', 'scene_mode', 'task_temporary'
]);

function styleError(code, status, message = code) {
  return Object.assign(new Error(message), { code, status, statusCode: status });
}

function cloneJson(value, fallback) {
  const serialized = JSON.stringify(value === undefined ? fallback : value);
  if (serialized === undefined) throw new TypeError('文风档案必须是可序列化 JSON');
  return JSON.parse(serialized);
}

function styleLevel(value, fallback = 'novel_narrative') {
  const level = String(value || fallback);
  if (!STYLE_LEVELS.has(level)) throw styleError('STYLE_LEVEL_INVALID', 422, '文风档案层级无效');
  return level;
}

function expectedRevisionMatches(input, currentRevision) {
  if (input.expectedRevision === undefined) return true;
  return Number.isSafeInteger(input.expectedRevision) && input.expectedRevision === Number(currentRevision);
}

function profileKey(profileId) {
  return `style_profile_${crypto.createHash('sha256').update(String(profileId)).digest('hex')}`;
}

function versionKey(profileId, revision) {
  return `style_version_${crypto.createHash('sha256').update(`${profileId}\u0000${revision}`).digest('hex')}`;
}

function projectScope(input) {
  const scope = String(input.projectId || input.bookId || '').trim();
  if (!scope) throw styleError('INVALID_SCOPE', 422, 'projectId is required');
  return scope;
}

function styleId(input) {
  return String(input.id || `style_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`);
}

function resolveVersionFields(entry, previous) {
  const select = (key, fallback) => cloneJson(entry[key] !== undefined ? entry[key] : previous ? previous[key] : fallback, fallback);
  const fields = {
    hardRules: select('hardRules', []),
    softPreferences: select('softPreferences', {}),
    positiveSamples: select('positiveSamples', []),
    negativeSamples: select('negativeSamples', []),
    checkRules: select('checkRules', {}),
    revisionStrategy: select('revisionStrategy', {})
  };
  validateVersionFields(fields);
  return fields;
}

function validateVersionFields(fields, code = 'STYLE_PROFILE_INVALID', status = 422) {
  for (const key of ['hardRules', 'positiveSamples', 'negativeSamples']) {
    if (!Array.isArray(fields[key])) throw styleError(code, status, `${key} 必须是数组`);
  }
  for (const key of ['softPreferences', 'checkRules', 'revisionStrategy']) {
    if (!fields[key] || typeof fields[key] !== 'object' || Array.isArray(fields[key])) {
      throw styleError(code, status, `${key} 必须是对象`);
    }
  }
}

function profileFromJson(profile, version) {
  if (!version || version.recordType !== 'style-profile-version') {
    throw styleError('STYLE_PROFILE_CORRUPT', 500, '文风档案缺少对应版本快照');
  }
  validateVersionFields(version, 'STYLE_PROFILE_CORRUPT', 500);
  return {
    id: profile.profileId, bookId: profile.bookId, branchId: profile.branchId,
    name: profile.name, level: profile.level, targetEntityId: profile.targetEntityId,
    targetSceneType: profile.targetSceneType, revision: Number(profile.profileRevision) || 1,
    hardRules: cloneJson(version.hardRules, []), softPreferences: cloneJson(version.softPreferences, {}),
    positiveSamples: cloneJson(version.positiveSamples, []), negativeSamples: cloneJson(version.negativeSamples, []),
    checkRules: cloneJson(version.checkRules, {}), revisionStrategy: cloneJson(version.revisionStrategy, {})
  };
}

function mapPgStyleProfile(row, bookId) {
  return {
    id: String(row.id), bookId: String(bookId), branchId: String(row.branch_id || 'main'),
    name: String(row.name || '未命名文风'), level: String(row.level || 'novel_narrative'),
    targetEntityId: String(row.target_entity_id || ''), targetSceneType: String(row.target_scene_type || ''),
    revision: Number(row.revision) || 1,
    hardRules: cloneJson(row.hard_rules, []), softPreferences: cloneJson(row.soft_preferences, {}),
    positiveSamples: cloneJson(row.positive_samples, []), negativeSamples: cloneJson(row.negative_samples, []),
    checkRules: cloneJson(row.check_rules, {}), revisionStrategy: cloneJson(row.revision_strategy, {})
  };
}

function pgTimestamp(value) {
  const number = Number(value);
  return new Date(Number.isFinite(number) && number > 0 ? number : Date.now());
}

function createJsonStyleProfileStore(directory, options = {}) {
  const repository = options.repository || new JsonFileRepository(directory, options.repositoryOptions);

  async function upsertStyleProfile(input = {}) {
    const bookId = String(input.bookId || '').trim();
    if (!bookId) throw styleError('INVALID_SCOPE', 422, 'bookId is required');
    const scope = projectScope(input);
    const id = styleId(input);
    const branchId = String(input.branchId || 'main');
    const now = Number(input.now) || Date.now();
    return repository.transaction([scope], tx => {
      const key = profileKey(id);
      const existing = tx.get(scope, 'styles', key);
      if (existing && (existing.recordType !== 'style-profile' || existing.bookId !== bookId || existing.branchId !== branchId)) {
        throw styleError('STYLE_NOT_FOUND', 404);
      }
      if (existing && !expectedRevisionMatches(input, existing.profileRevision)) {
        throw styleError('STYLE_VERSION_CONFLICT', 409);
      }
      const previous = existing ? tx.get(scope, 'styles', versionKey(id, existing.profileRevision)) : null;
      if (existing && (!previous || previous.recordType !== 'style-profile-version')) {
        throw styleError('STYLE_PROFILE_CORRUPT', 500, '文风档案缺少当前版本快照');
      }
      const level = styleLevel(input.level || existing && existing.level);
      const fields = resolveVersionFields(input, previous);
      const revision = existing ? Number(existing.profileRevision) + 1 : 1;
      const profile = tx.put(scope, 'styles', {
        ...(existing || {}), recordType: 'style-profile', id: key, profileId: id, bookId, branchId,
        name: input.name || existing && existing.name || '未命名文风', level,
        targetEntityId: input.targetEntityId ?? (existing && existing.targetEntityId) ?? '',
        targetSceneType: input.targetSceneType ?? (existing && existing.targetSceneType) ?? '',
        active: existing ? existing.active !== false : true,
        profileRevision: revision, createdAt: existing ? existing.createdAt : now, updatedAt: now
      }, existing ? existing.revision : 0);
      tx.put(scope, 'styles', {
        recordType: 'style-profile-version', id: versionKey(id, revision), profileId: id,
        bookId, branchId, versionNo: revision, ...fields,
        approvedBy: String(input.approvedBy || 'author'), createdAt: now
      }, 0);
      return { ok: true, id, revision, name: profile.name, level: profile.level, updatedAt: now };
    });
  }

  async function getStyleProfiles(input = {}) {
    const bookId = String(input.bookId || '').trim();
    if (!bookId) throw styleError('INVALID_SCOPE', 422, 'bookId is required');
    const scope = projectScope(input);
    const branchId = String(input.branchId || 'main');
    const rows = await repository.styles.list(scope);
    const profiles = rows.filter(row => row.recordType === 'style-profile' && row.bookId === bookId &&
      row.branchId === branchId && row.active !== false && (!input.level || row.level === input.level))
      .sort((left, right) => Number(left.createdAt) - Number(right.createdAt) || String(left.profileId).localeCompare(String(right.profileId)));
    return Promise.all(profiles.map(async profile => {
      const version = await repository.styles.get(scope, versionKey(profile.profileId, profile.profileRevision));
      return profileFromJson(profile, version);
    }));
  }

  async function getStyleProfileVersions(input = {}) {
    const bookId = String(input.bookId || '').trim();
    const id = String(input.profileId || '');
    if (!bookId || !id) throw styleError('STYLE_NOT_FOUND', 404);
    const scope = projectScope(input);
    const profile = await repository.styles.get(scope, profileKey(id));
    if (!profile || profile.recordType !== 'style-profile' || profile.bookId !== bookId ||
        profile.branchId !== String(input.branchId || 'main')) throw styleError('STYLE_NOT_FOUND', 404);
    const rows = await repository.styles.list(scope);
    const versions = rows.filter(row => row.recordType === 'style-profile-version' && row.bookId === bookId &&
      row.profileId === id && row.branchId === profile.branchId)
      .sort((left, right) => Number(left.versionNo) - Number(right.versionNo));
    if (!versions.length) throw styleError('STYLE_PROFILE_CORRUPT', 500, '文风档案没有版本快照');
    return versions.map(version => ({
      profileId: id, revision: Number(version.versionNo), ...resolveVersionFields(version, null),
      approvedBy: String(version.approvedBy || 'author'), createdAt: Number(version.createdAt) || 0
    }));
  }

  return {
    backend: 'json', upsertStyleProfile, getStyleProfiles, getStyleProfileVersions,
    close: () => repository.close()
  };
}

function createPostgresStyleProfileStore(repository) {
  if (!repository || typeof repository.withCreationBookTransaction !== 'function') {
    throw new TypeError('PostgreSQL 文风仓储不可用');
  }

  async function upsertStyleProfile(input = {}) {
    const userId = String(input.userId || input.actorUserId || '').trim();
    const bookId = String(input.bookId || '').trim();
    if (!userId || !bookId) throw styleError('INVALID_SCOPE', 422, 'userId and bookId are required');
    const id = styleId(input);
    const branchId = String(input.branchId || 'main');
    const now = Number(input.now) || Date.now();
    return repository.withCreationBookTransaction({ userId, bookId, write: true }, async (client, scope) => {
      const current = await client.query(
        `SELECT * FROM luna.style_profiles
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid AND id = $4::text
         ORDER BY (branch_id = $5::text) DESC, created_at ASC
         LIMIT 1 FOR UPDATE`,
        [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, id, branchId]
      );
      const existing = current.rows[0] || null;
      if (existing && String(existing.branch_id) !== branchId) throw styleError('STYLE_NOT_FOUND', 404);
      if (existing && !expectedRevisionMatches(input, existing.revision)) {
        throw styleError('STYLE_VERSION_CONFLICT', 409);
      }
      const level = styleLevel(input.level || existing && existing.level);
      const previous = existing ? await client.query(
        `SELECT hard_rules, soft_preferences, positive_samples, negative_samples, check_rules,
                revision_strategy, approved_by
         FROM luna.style_profile_versions
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
           AND branch_id = $4::text AND profile_id = $5::text AND revision = $6::integer`,
        [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, branchId, id, Number(existing.revision)]
      ) : { rows: [] };
      if (existing && !previous.rows.length) throw styleError('STYLE_PROFILE_CORRUPT', 500, '文风档案缺少当前版本快照');
      const previousVersion = previous.rows[0] || null;
      const versionSource = previousVersion && {
        hardRules: previousVersion.hard_rules, softPreferences: previousVersion.soft_preferences,
        positiveSamples: previousVersion.positive_samples, negativeSamples: previousVersion.negative_samples,
        checkRules: previousVersion.check_rules, revisionStrategy: previousVersion.revision_strategy
      };
      const fields = resolveVersionFields(input, versionSource);
      const revision = existing ? Number(existing.revision) + 1 : 1;
      const name = String(input.name || existing && existing.name || '未命名文风');
      const targetEntityId = String(input.targetEntityId ?? (existing && existing.target_entity_id) ?? '');
      const targetSceneType = String(input.targetSceneType ?? (existing && existing.target_scene_type) ?? '');
      if (existing) {
        const updated = await client.query(
          `UPDATE luna.style_profiles
           SET name = $6::text, level = $7::text, target_entity_id = $8::text, target_scene_type = $9::text,
               revision = $10::integer, updated_at = $11::timestamptz
           WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
             AND branch_id = $4::text AND id = $5::text AND revision = $12::integer
           RETURNING id`,
          [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, branchId, id, name, level,
            targetEntityId, targetSceneType, revision, pgTimestamp(now), Number(existing.revision)]
        );
        if (!updated.rows.length) throw styleError('STYLE_VERSION_CONFLICT', 409);
      } else {
        await client.query(
          `INSERT INTO luna.style_profiles
           (workspace_id, project_id, book_id, branch_id, id, name, level, target_entity_id,
            target_scene_type, revision, active, created_by, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::text, $8::text,
                   $9::text, $10::integer, true, $11::uuid, $12::timestamptz, $12::timestamptz)`,
          [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, branchId, id, name, level,
            targetEntityId, targetSceneType, revision, scope.actorUuid, pgTimestamp(now)]
        );
      }
      await client.query(
        `INSERT INTO luna.style_profile_versions
         (workspace_id, project_id, book_id, branch_id, profile_id, revision, hard_rules, soft_preferences,
          positive_samples, negative_samples, check_rules, revision_strategy, approved_by, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::integer, $7::jsonb, $8::jsonb,
                 $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::uuid, $14::timestamptz)`,
        [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, branchId, id, revision,
          JSON.stringify(fields.hardRules), JSON.stringify(fields.softPreferences),
          JSON.stringify(fields.positiveSamples), JSON.stringify(fields.negativeSamples),
          JSON.stringify(fields.checkRules), JSON.stringify(fields.revisionStrategy), scope.actorUuid, pgTimestamp(now)]
      );
      return { ok: true, id, revision, name, level, updatedAt: now };
    });
  }

  async function getStyleProfiles(input = {}) {
    const userId = String(input.userId || input.actorUserId || '').trim();
    const bookId = String(input.bookId || '').trim();
    if (!userId || !bookId) throw styleError('INVALID_SCOPE', 422, 'userId and bookId are required');
    const branchId = String(input.branchId || 'main');
    return repository.withCreationBookTransaction({ userId, bookId, write: false }, async (client, scope) => {
      const values = [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, branchId];
      const levelClause = input.level ? ` AND p.level = $${values.push(String(input.level))}::text` : '';
      const result = await client.query(
        `SELECT p.id, p.name, p.level, p.target_entity_id, p.target_scene_type, p.revision, p.branch_id,
                v.hard_rules, v.soft_preferences, v.positive_samples, v.negative_samples,
                v.check_rules, v.revision_strategy
         FROM luna.style_profiles p
         LEFT JOIN LATERAL (
           SELECT hard_rules, soft_preferences, positive_samples, negative_samples, check_rules, revision_strategy
           FROM luna.style_profile_versions v
           WHERE v.workspace_id = p.workspace_id AND v.project_id = p.project_id AND v.book_id = p.book_id
             AND v.branch_id = p.branch_id AND v.profile_id = p.id AND v.revision = p.revision
           LIMIT 1
         ) v ON true
         WHERE p.workspace_id = $1::uuid AND p.project_id = $2::uuid AND p.book_id = $3::uuid
           AND p.branch_id = $4::text AND p.active${levelClause}
         ORDER BY p.created_at ASC, p.id ASC`, values
      );
      if (result.rows.some(row => row.hard_rules == null || row.soft_preferences == null ||
          row.positive_samples == null || row.negative_samples == null || row.check_rules == null ||
          row.revision_strategy == null)) {
        throw styleError('STYLE_PROFILE_CORRUPT', 500, '文风档案缺少当前版本快照');
      }
      return result.rows.map(row => mapPgStyleProfile(row, scope.bookId));
    });
  }

  async function getStyleProfileVersions(input = {}) {
    const userId = String(input.userId || input.actorUserId || '').trim();
    const bookId = String(input.bookId || '').trim();
    const id = String(input.profileId || '');
    if (!userId || !bookId || !id) throw styleError('STYLE_NOT_FOUND', 404);
    const branchId = String(input.branchId || 'main');
    return repository.withCreationBookTransaction({ userId, bookId, write: false }, async (client, scope) => {
      const profile = await client.query(
        `SELECT 1 FROM luna.style_profiles
         WHERE workspace_id = $1::uuid AND project_id = $2::uuid AND book_id = $3::uuid
           AND branch_id = $4::text AND id = $5::text`,
        [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, branchId, id]
      );
      if (!profile.rows.length) throw styleError('STYLE_NOT_FOUND', 404);
      const result = await client.query(
        `SELECT v.revision, v.hard_rules, v.soft_preferences, v.positive_samples, v.negative_samples,
                v.check_rules, v.revision_strategy, u.legacy_id AS approved_by, v.created_at
         FROM luna.style_profile_versions v
         LEFT JOIN luna.users u ON u.id = v.approved_by
         WHERE v.workspace_id = $1::uuid AND v.project_id = $2::uuid AND v.book_id = $3::uuid
           AND v.branch_id = $4::text AND v.profile_id = $5::text
         ORDER BY v.revision ASC`,
        [scope.workspaceUuid, scope.projectUuid, scope.bookUuid, branchId, id]
      );
      return result.rows.map(row => ({
        profileId: id, revision: Number(row.revision),
        hardRules: cloneJson(row.hard_rules, []), softPreferences: cloneJson(row.soft_preferences, {}),
        positiveSamples: cloneJson(row.positive_samples, []), negativeSamples: cloneJson(row.negative_samples, []),
        checkRules: cloneJson(row.check_rules, {}), revisionStrategy: cloneJson(row.revision_strategy, {}),
        approvedBy: String(row.approved_by || ''),
        createdAt: row.created_at instanceof Date ? row.created_at.getTime() : new Date(row.created_at).getTime()
      }));
    });
  }

  return {
    backend: 'postgres', upsertStyleProfile, getStyleProfiles, getStyleProfileVersions,
    async close() {}
  };
}

module.exports = { createJsonStyleProfileStore, createPostgresStyleProfileStore, STYLE_LEVELS };
