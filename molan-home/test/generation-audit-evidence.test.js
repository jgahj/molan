'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { validateGenerationAuditEvidence } = require('../lib/generation/audit-evidence');

/** 为测试正文计算稳定的 SHA-256。 */
function hash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** 构造包含三类通过结果的测试证据。 */
function evidenceInput(overrides = {}) {
  const content = '通过审计的正文';
  const contentHash = hash(content);
  return {
    generationId: 'generation-1', chapterNo: 3, content, contentHash,
    result: {
      draft: content, outputHash: contentHash, contract: { chapterNo: 3 },
      audit: { passed: true, blockerCount: 0, issues: [] },
      semanticAudit: { passed: true, audit: { passed: true, issues: [] } },
      quality: { passed: true, qualityVector: { language: { value: 0.9 } } }
    },
    ...overrides
  };
}

test('Generation audit evidence binds the run, exact content hash, chapter, and all three gates', () => {
  const valid = validateGenerationAuditEvidence(evidenceInput());
  assert.equal(valid.ok, true);
  assert.equal(valid.evidence.generationId, 'generation-1');
  assert.equal(valid.evidence.chapterNo, 3);
  assert.equal(valid.evidence.contentHash, hash('通过审计的正文'));

  const wrongChapter = evidenceInput({ chapterNo: 4 });
  assert.equal(validateGenerationAuditEvidence(wrongChapter).code, 'AUDIT_EVIDENCE_MISMATCH');
  const missingChapter = evidenceInput({ chapterNo: 0 });
  assert.equal(validateGenerationAuditEvidence(missingChapter).code, 'AUDIT_EVIDENCE_MISMATCH');
  const wrongOutput = evidenceInput({ content: '被替换的正文' });
  assert.equal(validateGenerationAuditEvidence(wrongOutput).code, 'AUDIT_EVIDENCE_MISMATCH');
  const semanticMissing = evidenceInput();
  delete semanticMissing.result.semanticAudit.audit;
  assert.equal(validateGenerationAuditEvidence(semanticMissing).code, 'SEMANTIC_AUDIT_REQUIRED');
  const qualityFailed = evidenceInput();
  qualityFailed.result.quality.passed = false;
  assert.equal(validateGenerationAuditEvidence(qualityFailed).code, 'QUALITY_AUDIT_REQUIRED');

  // 题材特定质检维度校验
  const suspenseMissing = evidenceInput({ genre: '悬疑' });
  assert.equal(validateGenerationAuditEvidence(suspenseMissing).code, 'CRITICAL_QUALITY_DIMENSION_MISSING');

  const suspenseComplete = evidenceInput({
    genre: '悬疑',
    result: {
      ...evidenceInput().result,
      quality: {
        passed: true,
        qualityVector: {
          language: { value: 0.9 },
          clueIntegrity: { value: 0.85 },
          povBoundary: { value: 0.8 }
        }
      }
    }
  });
  assert.equal(validateGenerationAuditEvidence(suspenseComplete).ok, true);
});
