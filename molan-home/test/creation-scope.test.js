const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const dataDirectory = require('./helpers/local-runtime').createLocalRuntime();
const app = require('../server');
const projectScope = require('../lib/project-scope');
app.initDB();

test('创作书首版保存使用稳定userId和工作区归属，换账户不能读取未关联创作书', () => {
  const userA = { email: 'creation-scope-a@example.com', name: '创作作者A', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  const userB = { email: 'creation-scope-b@example.com', name: '创作作者B', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  app.saveUser(userA);
  app.saveUser(userB);
  const database = new DatabaseSync(path.join(dataDirectory, 'molan.db'));
  try {
    const accountA = database.prepare('SELECT user_id FROM accounts WHERE email = ?').get(userA.email);
    const accountB = database.prepare('SELECT user_id FROM accounts WHERE email = ?').get(userB.email);
    const saved = app.saveCreationBookFirstBible(userA.email, {
      bookId: 'cb_scope_stable_1',
      title: '稳定归属测试',
      plan: { budgetLimit: 100 },
      payload: { bookPremise: { title: '稳定归属测试' }, characters: [{ name: '甲' }] },
      ownerUserId: accountA.user_id
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const row = database.prepare('SELECT owner_user_id, workspace_id, project_id, user_email FROM creation_books WHERE id = ?').get('cb_scope_stable_1');
    assert.equal(row.owner_user_id, accountA.user_id);
    assert.equal(row.workspace_id, projectScope.personalWorkspaceId(accountA.user_id));
    assert.equal(row.project_id, '');
    assert.equal(row.user_email, userA.email);
    assert.equal(app.loadCreationBookForAuth('cb_scope_stable_1', { user: { ...userB, userId: accountB.user_id } }), null);
  } finally {
    database.close();
  }
});
