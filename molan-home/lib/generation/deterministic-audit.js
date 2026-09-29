'use strict';

const crypto = require('node:crypto');

/** 为审计证据中的原文片段生成 SHA-256。 */
function quoteHash(quote) {
  return crypto.createHash('sha256').update(String(quote || ''), 'utf8').digest('hex');
}

/** 校验正文的硬约束并把模型发现映射成可验证证据。 */
function auditDraft(input = {}) {
  const text = String(input.text || '').trim();
  const issues = [];
  const add = (category, severity, quote, problem, fixHint = '', sourceFactId = '') => {
    const exact = String(quote || '');
    const verified = Boolean(exact && text.includes(exact));
    issues.push({
      issueId: `audit_${issues.length + 1}`,
      category, severity,
      quote: exact,
      quoteHash: exact ? quoteHash(exact) : '',
      sourceFactId: String(sourceFactId || ''),
      problem: String(problem || ''),
      fixHint: String(fixHint || ''),
      status: verified ? 'verified' : 'unverified'
    });
  };
  if (!text) add('structure', 'blocker', '', '正文为空');
  const minChars = Math.max(0, Number(input.minChars) || 0);
  const maxChars = Math.max(0, Number(input.maxChars) || 0);
  const lengthSeverity = input.strictLength === true ? 'blocker' : 'warning';
  if (minChars && text.length < minChars) add('length', lengthSeverity, '', `正文长度低于下限 ${minChars}`);
  if (maxChars && text.length > maxChars) add('length', lengthSeverity, '', `正文长度超过上限 ${maxChars}`);
  const paragraphs = text.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
  const seen = new Set();
  for (const paragraph of paragraphs) {
    const key = paragraph.replace(/\s+/g, '');
    if (key.length >= 30 && seen.has(key)) add('repetition', 'blocker', paragraph, '正文包含完全重复段落');
    seen.add(key);
  }
  for (const finding of Array.isArray(input.findings) ? input.findings : []) {
    const quote = String(finding && (finding.quote || finding.evidence) || '');
    const factId = String(finding && (finding.sourceFactId || finding.factId) || '');
    add(String(finding && (finding.category || finding.type) || 'semantic'),
      String(finding && finding.severity || 'warning'), quote,
      String(finding && (finding.problem || finding.description) || '审计发现待核验'),
      String(finding && (finding.fixHint || finding.fix) || ''), factId);
  }
  const unverified = issues.filter(issue => issue.status === 'unverified');
  const blockers = issues.filter(issue => issue.severity === 'blocker' && issue.status === 'verified');
  return {
    passed: blockers.length === 0 && !unverified.some(issue => issue.severity === 'blocker'),
    status: unverified.some(issue => issue.severity === 'blocker') ? 'needs_review' : blockers.length ? 'blocked' : 'passed',
    contentHash: quoteHash(text),
    charCount: text.length,
    issues,
    unverifiedCount: unverified.length,
    blockerCount: blockers.length
  };
}

module.exports = { quoteHash, auditDraft };
