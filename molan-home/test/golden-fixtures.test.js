// 金标准样本集 schema 校验（阶段一 任务 1.2）。
// 仅做数据合法性校验，不依赖 server：读取 scripts/eval/fixtures/golden.jsonl，
// 断言总共 20 条、四类任务分布正确、originality 负正各 3、各任务字段齐全。
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const GOLDEN_PATH = path.join(__dirname, '..', 'scripts', 'eval', 'fixtures', 'golden.jsonl');
const TASKS = ['contract', 'originality', 'entity_state', 'claim'];
const CONTRACT_FIELDS = ['goal', 'protagonistAction', 'opposition', 'informationChange', 'irreversibleResult'];

// 读取 golden.jsonl：逐行解析，跳过空行；非法 JSON 直接抛错（让测试失败并指出行号）。
function loadGolden() {
  const raw = fs.readFileSync(GOLDEN_PATH, 'utf8');
  const out = [];
  raw.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch (e) {
      throw new Error('golden.jsonl 第 ' + (i + 1) + ' 行不是合法 JSON: ' + e.message);
    }
    out.push({ line: i + 1, obj });
  });
  return out;
}

test('golden.jsonl 共 20 条且每行均为合法 JSON', () => {
  const rows = loadGolden();
  assert.equal(rows.length, 20, 'golden.jsonl 应为 20 条，实际 ' + rows.length + ' 条');
});

test('任务分布正确：contract 6 / originality 6 / entity_state 4 / claim 4', () => {
  const rows = loadGolden();
  const byTask = {};
  for (const { obj } of rows) byTask[obj.task] = (byTask[obj.task] || 0) + 1;
  assert.equal(byTask.contract, 6, 'contract 应为 6，实际 ' + byTask.contract);
  assert.equal(byTask.originality, 6, 'originality 应为 6，实际 ' + byTask.originality);
  assert.equal(byTask.entity_state, 4, 'entity_state 应为 4，实际 ' + byTask.entity_state);
  assert.equal(byTask.claim, 4, 'claim 应为 4，实际 ' + byTask.claim);
});

test('每条样本含 sampleId / task / input / expected 且字段非空', () => {
  const rows = loadGolden();
  for (const { line, obj } of rows) {
    assert.ok(typeof obj.sampleId === 'string' && obj.sampleId.trim(), '第 ' + line + ' 行缺 sampleId');
    assert.ok(TASKS.includes(obj.task), '第 ' + line + ' 行 task 非法: ' + obj.task);
    assert.ok(typeof obj.input === 'string' && obj.input.trim().length > 0, '第 ' + line + ' 行 input 为空');
    assert.ok(obj.expected && typeof obj.expected === 'object', '第 ' + line + ' 行 expected 缺失或非法');
  }
});

test('contract 样本 expected 含 5 个非空字段且含中文内容', () => {
  const rows = loadGolden().filter(r => r.obj.task === 'contract');
  for (const { line, obj } of rows) {
    for (const f of CONTRACT_FIELDS) {
      const v = obj.expected[f];
      assert.ok(typeof v === 'string' && v.trim().length > 0, '第 ' + line + ' 行 contract 字段 ' + f + ' 为空');
      assert.ok(/[一-龥]/.test(v), '第 ' + line + ' 行 contract 字段 ' + f + ' 缺少中文内容（应含名词性实体）');
    }
  }
});

test('originality 负正样本各 3（按 expected.blocked 区分）', () => {
  const rows = loadGolden().filter(r => r.obj.task === 'originality');
  const neg = rows.filter(r => r.obj.expected && r.obj.expected.blocked === true);
  const pos = rows.filter(r => r.obj.expected && r.obj.expected.blocked === false);
  assert.equal(neg.length, 3, '负样本(blocked=true)应为 3，实际 ' + neg.length);
  assert.equal(pos.length, 3, '正样本(blocked=false)应为 3，实际 ' + pos.length);
  for (const { line, obj } of rows) {
    assert.equal(typeof obj.expected.risky, 'boolean', '第 ' + line + ' 行 originality 缺 risky 布尔');
    assert.equal(typeof obj.expected.blocked, 'boolean', '第 ' + line + ' 行 originality 缺 blocked 布尔');
  }
});

test('entity_state 样本 expected 含 entity 与 stateChange', () => {
  const rows = loadGolden().filter(r => r.obj.task === 'entity_state');
  for (const { line, obj } of rows) {
    assert.ok(typeof obj.expected.entity === 'string' && obj.expected.entity.trim(), '第 ' + line + ' 行 entity 为空');
    assert.ok(typeof obj.expected.stateChange === 'string' && obj.expected.stateChange.trim(), '第 ' + line + ' 行 stateChange 为空');
  }
});

test('claim 样本 expected.claims 合法且计数与 claims 一致', () => {
  const rows = loadGolden().filter(r => r.obj.task === 'claim');
  for (const { line, obj } of rows) {
    const claims = obj.expected.claims;
    assert.ok(Array.isArray(claims) && claims.length > 0, '第 ' + line + ' 行 claims 为空或非数组');
    let important = 0;
    for (const c of claims) {
      assert.ok(typeof c.text === 'string' && c.text.trim(), '第 ' + line + ' 行 claim 缺 text');
      assert.equal(typeof c.hasEvidence, 'boolean', '第 ' + line + ' 行 claim 缺 hasEvidence 布尔');
      if (c.important === true) important += 1;
    }
    assert.equal(obj.expected.claimCount, claims.length, '第 ' + line + ' 行 claimCount 与 claims 长度不一致');
    assert.equal(obj.expected.importantClaimCount, important, '第 ' + line + ' 行 importantClaimCount 与实际不符');
  }
});
