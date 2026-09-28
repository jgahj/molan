'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const memory = require('../lib/memory-system');
const styles = require('../lib/style-system');

function fixture(context) {
  const db = new DatabaseSync(':memory:');
  context.after(() => db.close());
  memory.initializeSchema(db);
  styles.initializeSchema(db);
  db.exec(`CREATE TABLE novels (id TEXT PRIMARY KEY, state_json TEXT, revision INTEGER, word_count INTEGER, updated_at INTEGER);
    CREATE TABLE project_resources (project_id TEXT, id TEXT, revision INTEGER, status TEXT)`);
  const state = { title: '测试作品', volumes: [{ id: 'volume', chapters: [{ id: 'chapter', title: '第一章', scenes: [{ id: 'scene', content: '旧稿' }] }] }] };
  db.prepare('INSERT INTO novels VALUES (?, ?, 1, 2, 1)').run('book', JSON.stringify(state));
  return db;
}

function save(db, text = '师妹收下玉佩。') {
  return memory.saveManuscript(db, 'book', 'author', {
    chapterId: 'chapter', sceneId: 'scene', text, expectedRevision: 0, expectedNovelRevision: 1
  });
}

test('正文候选与正式稿分离，审批后同事务正式采纳', context => {
  const db = fixture(context);
  const draft = save(db);
  assert.equal(draft.contentHash, memory.computeTextHash('师妹收下玉佩。'));
  assert.ok(db.prepare('SELECT state_json FROM novels').get().state_json.includes('旧稿'));
  const changeset = memory.createBoundChangeset(db, 'book', 'author', { manuscriptRevisionId: draft.id, operations: [] });
  memory.approveChangeset(db, 'book', changeset.id, 'author');
  const receipt = memory.commitChangeset(db, 'book', changeset.id, 'author');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.manuscriptRevisionId, draft.id);
  assert.ok(db.prepare('SELECT state_json FROM novels').get().state_json.includes('师妹收下玉佩'));
  assert.equal(db.prepare('SELECT revision FROM novels').get().revision, 2);
  assert.equal(memory.commitChangeset(db, 'book', changeset.id, 'author').replayed, true);
});

test('保存新候选或修改来源正文后，旧确认不能采纳', context => {
  const db = fixture(context);
  const draft = save(db);
  const changeset = memory.createBoundChangeset(db, 'book', 'author', { manuscriptRevisionId: draft.id, operations: [] });
  memory.approveChangeset(db, 'book', changeset.id, 'author');
  memory.saveManuscript(db, 'book', 'author', {
    chapterId: 'chapter', sceneId: 'scene', text: '新候选', expectedRevision: 1, expectedNovelRevision: 1
  });
  assert.equal(memory.commitChangeset(db, 'book', changeset.id, 'author').code, 'CONTENT_VERSION_CONFLICT');
});

test('文风或资料版本变更使绑定审批失效', context => {
  const db = fixture(context);
  const draft = save(db);
  const changeset = memory.createBoundChangeset(db, 'book', 'author', { manuscriptRevisionId: draft.id, operations: [] });
  memory.approveChangeset(db, 'book', changeset.id, 'author');
  styles.upsertStyleProfile(db, { bookId: 'book', name: '新文风', hardRules: ['第三人称'] });
  assert.equal(memory.commitChangeset(db, 'book', changeset.id, 'author').code, 'CONFIG_VERSION_CONFLICT');
});

test('精确锚点保留空白、emoji与重复引文位置，提取不自动确立真相', context => {
  const db = fixture(context);
  const text = '  😀他来了。\r\n他来了。';
  const draft = save(db, text);
  const extracted = memory.extractSavedManuscript(db, 'book', draft.id);
  const anchors = extracted.evidence.map(record => record.sourceAnchor);
  assert.equal(anchors[0].contentHash, memory.computeTextHash(text));
  for (const anchor of anchors) {
    assert.equal(text.slice(anchor.startOffset, anchor.endOffset), anchor.quote);
    assert.equal(anchor.offsetUnit, 'utf16');
  }
  assert.ok(anchors[1].startOffset > anchors[0].startOffset);
  assert.equal(db.prepare('SELECT count(*) AS count FROM world_fact_decisions').get().count, 0);
  assert.equal(memory.extractSavedManuscript(db, 'book', draft.id).evidence[0].id, extracted.evidence[0].id);
});

test('投影消费可重放且检测同版本漂移，不覆盖外部修改', context => {
  const db = fixture(context);
  const draft = save(db);
  const changeset = memory.createBoundChangeset(db, 'book', 'author', { manuscriptRevisionId: draft.id, operations: [] });
  memory.approveChangeset(db, 'book', changeset.id, 'author');
  memory.commitChangeset(db, 'book', changeset.id, 'author');
  assert.equal(memory.verifyProjections(db, 'book').synced, false);
  assert.equal(memory.processProjections(db, 'book').status, 'SYNCED');
  assert.equal(memory.processProjections(db, 'book').status, 'SYNCED');
  db.exec("UPDATE memory_projection_snapshots SET payload_json = '{}'");
  assert.equal(memory.verifyProjections(db, 'book').status, 'PROJECTION_DRIFT');
  assert.equal(memory.processProjections(db, 'book').status, 'PROJECTION_DRIFT');
  assert.equal(db.prepare('SELECT payload_json FROM memory_projection_snapshots').get().payload_json, '{}');
});

test('正文写入后的outbox故障也必须回滚正文', context => {
  const db = fixture(context);
  const draft = save(db);
  const changeset = memory.createBoundChangeset(db, 'book', 'author', { manuscriptRevisionId: draft.id, operations: [] });
  memory.approveChangeset(db, 'book', changeset.id, 'author');
  db.exec("CREATE TRIGGER abort_projection BEFORE INSERT ON memory_outbox BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  assert.throws(() => memory.commitChangeset(db, 'book', changeset.id, 'author'), /fixture failure/);
  assert.equal(db.prepare('SELECT revision FROM novels').get().revision, 1);
  assert.ok(db.prepare('SELECT state_json FROM novels').get().state_json.includes('旧稿'));
});
