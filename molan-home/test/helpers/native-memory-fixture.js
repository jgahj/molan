'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonFileRepository } = require('../../lib/repositories/json-file-repository');
const { JsonAppRepository } = require('../../lib/repositories/json-app-repository');
const { createMemoryStore } = require('../../lib/memory-store');
const { createJsonStyleProfileStore } = require('../../lib/style-profile-store');

async function createNativeMemoryFixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-memory-domain-'));
  const repository = new JsonFileRepository(directory);
  const app = new JsonAppRepository(directory, { repository });
  const user = { userId: 'native-domain-author', email: 'native-domain@example.test' };
  const store = createMemoryStore({ repository, getAccess: input => app.getAccess(input) });
  const style = createJsonStyleProfileStore(directory, { repository });
  const scope = { userId: user.userId, bookId: 'n_nativedomain', projectId: 'n_nativedomain' };
  context.after(async () => { await store.close(); await style.close(); await repository.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await app.saveAccount(user);
  await app.create({ id: scope.bookId, user, state: { title: '领域合同', volumes: [] } });
  return {
    directory, repository, app, store, style, scope,
    async commit(operations, input = {}) {
      const current = await store.workbenchState({ ...scope, ...input });
      const changeset = await store.createChangeset({ ...scope, ...input, baseStateVersion: current.stateVersion, operations });
      await store.approveChangeset({ ...scope, ...input, changesetId: changeset.id });
      return store.commitChangeset({ ...scope, ...input, changesetId: changeset.id });
    },
    async secret(input = {}) {
      return (await store.extract({ ...scope, ...input, text: '凶手是师父。' })).propositions[0].id;
    },
    async state() { return repository.memory.get(scope.projectId, `memory:${scope.bookId}`); }
  };
}

module.exports = { createNativeMemoryFixture };
