import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const { createPostgresRepository } = require('../lib/postgres-repository.js');
const { createMemoryStore } = require('../lib/memory-store.js');
const { createPostgresStyleProfileStore } = require('../lib/style-profile-store.js');
const memoryRoutes = require('../lib/memory-routes.js');

function assertExplicitTestTarget(environment) {
  for (const name of ['MOLAN_PG_HOST', 'MOLAN_PG_PORT', 'MOLAN_PG_DATABASE', 'MOLAN_PG_USER']) {
    if (!String(environment[name] || '').trim()) throw new Error(`${name} must be explicitly configured`);
  }
  if (environment.MOLAN_PG_ENABLED !== '1') throw new Error('Set MOLAN_PG_ENABLED=1 explicitly');
  if (!/^(?:\d+)$/.test(environment.MOLAN_PG_PORT) || Number(environment.MOLAN_PG_PORT) < 1 || Number(environment.MOLAN_PG_PORT) > 65535) {
    throw new Error('MOLAN_PG_PORT must be a valid explicit port');
  }
  if (!/(?:acceptance|test)/i.test(environment.MOLAN_PG_DATABASE)) {
    throw new Error('Refusing a database whose name does not identify a test or acceptance target');
  }
  if (!environment.MOLAN_PG_PASSWORD && !environment.MOLAN_PG_PASSWORD_FILE) {
    throw new Error('Set MOLAN_PG_PASSWORD or MOLAN_PG_PASSWORD_FILE explicitly');
  }
}

async function dispatch(memoryStore, styleProfileStore, actorId, method, url, body) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost' };
  const res = {
    statusCode: 200,
    body: '',
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(chunk) { if (chunk) this.body += String(chunk); this.finished = true; }
  };
  const handled = await memoryRoutes.dispatch(req, res, new URL(url, 'http://localhost').pathname, null,
    () => ({ user: { userId: actorId }, token: 'pg-style-route-smoke' }),
    { backend: 'postgres', memoryStore, styleProfileStore });
  assert.equal(handled, true);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

assertExplicitTestTarget(process.env);
const repository = createPostgresRepository(process.env);
if (!repository.enabled || !repository.available) throw new Error('PostgreSQL repository is unavailable');
let stage = 'target-check';
try {
  const target = await repository.pool.query('SELECT current_database() AS database');
  assert.equal(target.rows[0].database, process.env.MOLAN_PG_DATABASE);

  const suffix = crypto.randomUUID().replace(/-/g, '');
  const ownerId = `style-route-owner-${suffix}`;
  const viewerId = `style-route-viewer-${suffix}`;
  const strangerId = `style-route-stranger-${suffix}`;
  const workspaceId = `style-route-workspace-${suffix}`;
  const projectId = `style-route-project-${suffix}`;
  const bookId = `style-route-book-${suffix}`;

  stage = 'seed-project-book';
  await repository.saveProfile({ userId: ownerId, workspaceId, projectId, title: 'Style route smoke', state: { volumes: [] } });
  await repository.createCreationBook({ userId: ownerId, workspaceId, projectId, bookId, title: 'Style route smoke', plan: { totalChapters: 1 }, payload: {} });
  const ownerProfile = await repository.getProfile(ownerId, projectId, workspaceId);
  stage = 'seed-viewer-access';
  await repository.upsertWorkspaceMember(ownerId, workspaceId, viewerId, 'member');
  await repository.upsertProjectMember(ownerId, workspaceId, projectId, viewerId, 'viewer', false, false, false, ownerProfile.access.acl_revision);

  const memoryStore = createMemoryStore({ backend: 'postgres', repository });
  const styleProfileStore = createPostgresStyleProfileStore(repository);
  const profileId = `style-${suffix}`;
  const route = `/api/books/${bookId}/styles`;

  stage = 'owner-create-with-forged-scope';
  let result = await dispatch(memoryStore, styleProfileStore, ownerId, 'POST', route, {
    id: profileId, expectedRevision: 0, projectId: 'forged-project', workspaceId: 'forged-workspace',
    bookId: 'forged-book', userId: strangerId, hardRules: ['scope-bound rule']
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.revision, 1);

  stage = 'owner-version-query';
  result = await dispatch(memoryStore, styleProfileStore, ownerId, 'GET', `${route}/${profileId}/versions`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.versions.map(version => version.revision), [1]);

  stage = 'owner-cas-update';
  result = await dispatch(memoryStore, styleProfileStore, ownerId, 'POST', route, {
    id: profileId, expectedRevision: 1, hardRules: ['scope-bound rule', 'revision two']
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.revision, 2);

  stage = 'owner-updated-version-query';
  result = await dispatch(memoryStore, styleProfileStore, ownerId, 'GET', `${route}/${profileId}/versions`);
  assert.deepEqual(result.body.versions.map(version => version.revision), [1, 2]);

  stage = 'owner-stale-cas';
  result = await dispatch(memoryStore, styleProfileStore, ownerId, 'POST', route, {
    id: profileId, expectedRevision: 1, hardRules: ['stale']
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'STYLE_VERSION_CONFLICT');

  stage = 'viewer-read';
  result = await dispatch(memoryStore, styleProfileStore, viewerId, 'GET', route);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.styles.map(style => style.revision), [2]);

  stage = 'viewer-forged-owner-write-denied';
  result = await dispatch(memoryStore, styleProfileStore, viewerId, 'POST', route, {
    id: `style-denied-${suffix}`, expectedRevision: 0, userId: ownerId, projectId, bookId, workspaceId,
    hardRules: ['must not persist']
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'FORBIDDEN');

  stage = 'stranger-read-denied';
  result = await dispatch(memoryStore, styleProfileStore, strangerId, 'GET', route);
  assert.equal(result.status, 404);
  process.stdout.write('PostgreSQL native style route permissions, trusted scope, versions, and CAS PASS; unique smoke records retained in the configured test database.\n');
} catch (error) {
  process.stderr.write(`PostgreSQL native style route smoke failed at ${stage}: ${error.code || error.name || 'Error'}\n`);
  process.exitCode = 1;
} finally {
  await repository.close();
}
