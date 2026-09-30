'use strict';

const { GenerationError } = require('./errors');

const MAX_REVISION_ROUNDS = 2;

/** 根据唯一证据定位目标段落并截取前后各两段的改写窗口。 */
function locateReplacementWindow(text, quote) {
  const source = String(text || '');
  const target = String(quote || '');
  if (!target || !source.includes(target)) return { ok: false, reason: 'evidence_missing' };
  const first = source.indexOf(target);
  if (source.indexOf(target, first + target.length) >= 0) return { ok: false, reason: 'evidence_ambiguous' };
  const paragraphs = source.split(/(?<=\n\s*\n)/);
  let offset = 0;
  const index = paragraphs.findIndex(paragraph => {
    const start = offset;
    offset += paragraph.length;
    return first >= start && first < offset;
  });
  if (index < 0) return { ok: false, reason: 'evidence_missing' };
  const startIndex = Math.max(0, index - 2);
  const endIndex = Math.min(paragraphs.length, index + 3);
  const before = paragraphs.slice(startIndex, index).join('');
  const after = paragraphs.slice(index + 1, endIndex).join('');
  return { ok: true, before, target, after, paragraphIndex: index };
}

const NEGATION_PATTERNS = [
  '没有', '并未', '未曾', '绝不', '不可', '未有', '不曾', '不能', '并非', '不得',
  '不', '没', '未', '无', '非'
];

/** 提取文本中的否定词标记快照 */
function extractNegationSnapshot(text) {
  const clean = String(text || '');
  return NEGATION_PATTERNS.filter(neg => clean.includes(neg));
}

/**
 * 拒绝改写中丢失合同要求保留的人名、地点、数字和事实标记，
 * 建立 Invariant Snapshot 严格防止否定极性反转（如「他没有杀她」被修改为「他杀了她」）。
 */
function preservesMeaning(input = {}) {
  const before = String(input.before || '');
  const after = String(input.after || '');
  const protectedTerms = Array.isArray(input.protectedTerms) ? input.protectedTerms.map(String).filter(Boolean) : [];
  const numbers = (before.match(/\d+(?:\.\d+)?/g) || []).filter((value, index, values) => values.indexOf(value) === index);
  const required = [...new Set([...protectedTerms, ...numbers])];
  const missing = required.filter(term => !after.includes(term));

  // Invariant Snapshot: 否定极性反转防护
  const beforeNegations = extractNegationSnapshot(before);
  const afterNegations = extractNegationSnapshot(after);

  // 若原句包含明确双字否定短语，但修订后完全失去否定极性，判定语义被颠覆性篡改
  const strongBeforeNegations = beforeNegations.filter(n => n.length >= 2);
  const strongAfterNegations = afterNegations.filter(n => n.length >= 2);
  if (strongBeforeNegations.length > 0 && strongAfterNegations.length === 0 && afterNegations.length === 0) {
    missing.push(`否定极性反转: 原文包含[${strongBeforeNegations.join('/')}]但修订句被改为肯定事实`);
  }

  return { passed: missing.length === 0, required, missing };
}

/** 应用单个局部替换并确认语义保留，整次最多允许两轮。 */
function applyLocalRevision(input = {}) {
  const round = Math.max(0, Number(input.round) || 0);
  if (round >= MAX_REVISION_ROUNDS) {
    throw new GenerationError('REVISION_EXHAUSTED', '局部修订已达到两轮上限', { status: 409 });
  }
  const source = String(input.text || '');
  const quote = String(input.quote || '');
  const replacement = String(input.replacement || '');
  const window = locateReplacementWindow(source, quote);
  if (!window.ok) return { ok: false, reason: window.reason, status: 'needs_review' };
  if (!replacement.trim()) return { ok: false, reason: 'replacement_empty', status: 'needs_review' };
  const meaning = preservesMeaning({ before: quote, after: replacement, protectedTerms: input.protectedTerms });
  if (!meaning.passed) return { ok: false, reason: 'meaning_changed', meaning, status: 'rejected' };
  const first = source.indexOf(quote);
  return {
    ok: true,
    text: source.slice(0, first) + replacement + source.slice(first + quote.length),
    window,
    meaning,
    round: round + 1
  };
}

module.exports = { MAX_REVISION_ROUNDS, locateReplacementWindow, preservesMeaning, applyLocalRevision };
