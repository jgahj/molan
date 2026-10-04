'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveWordBudget } = require('../lib/generation/word-budget');

test('word-budget prioritizes user prompt range instruction', () => {
  const budget = resolveWordBudget('请写一章，字数要求在1800-2200字之间，重点在试探');
  assert.equal(budget.hasUserInstruction, true);
  assert.equal(budget.min, 1800);
  assert.equal(budget.max, 2200);
  assert.equal(budget.target, 2000);
  assert.ok(budget.summary.includes('1800 ~ 2200 字'));
});

test('word-budget prioritizes single word count instruction', () => {
  const budget = resolveWordBudget('写一篇4000字的正文，围绕海沙流武馆展开');
  assert.equal(budget.hasUserInstruction, true);
  assert.equal(budget.target, 4000);
  assert.equal(budget.min, 3400);
  assert.equal(budget.max, 4600);
  assert.ok(budget.summary.includes('约 4000 字'));
});

test('word-budget handles at-least and at-most instructions', () => {
  const atLeast = resolveWordBudget('篇幅不少于3500字，正面战斗');
  assert.equal(atLeast.hasUserInstruction, true);
  assert.equal(atLeast.min, 3500);
  assert.ok(atLeast.max >= 3500);

  const atMost = resolveWordBudget('本章不超过2000字，快节奏过渡');
  assert.equal(atMost.hasUserInstruction, true);
  assert.equal(atMost.max, 2000);
  assert.ok(atMost.min < 2000);
});

test('word-budget parses Chinese numbers properly', () => {
  const budget = resolveWordBudget('篇幅两千到三千字即可');
  assert.equal(budget.hasUserInstruction, true);
  assert.equal(budget.min, 2000);
  assert.equal(budget.max, 3000);
  assert.equal(budget.target, 2500);
});

test('word-budget falls back to 2500-3500 words per chapter when user gives no instruction', () => {
  const budget = resolveWordBudget('继续写下一章，周烈夜潜刑狱司盗取林家物证，遭遇赵元奎盘查');
  assert.equal(budget.hasUserInstruction, false);
  assert.equal(budget.min, 2500);
  assert.equal(budget.max, 3500);
  assert.equal(budget.target, 3000);
  assert.ok(budget.summary.includes('2500 ~ 3500 字一章'));
});

test('word-budget respects explicit options when provided', () => {
  const budget = resolveWordBudget('', { targetWords: 1800 });
  assert.equal(budget.hasUserInstruction, true);
  assert.equal(budget.target, 1800);
  assert.equal(budget.min, 1530);
  assert.equal(budget.max, 2070);
});
