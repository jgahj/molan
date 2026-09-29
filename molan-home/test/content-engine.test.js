'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateDraft, evaluateQualityVector } = require('../lib/generation/content-engine');
const { validateGenerationAuditEvidence } = require('../lib/generation/audit-evidence');

test('contentEngine.generateDraft orchestrates single-pass drafting, audit, and quality assessment', async () => {
  const mockCalls = [];
  const fakeDraftText = '林晨推开沉重的铁门，夜风从裂隙中灌入，带着刺鼻的焦糊味。他没有多余的动作，迅速在掩体后蹲伏，目光扫过空旷的庭院。';

  const result = await generateDraft({
    callModel: async (_auth, options) => {
      mockCalls.push(options);
      return {
        text: fakeDraftText,
        usage: { promptTokens: 300, completionTokens: 80, totalTokens: 380, creditCost: 0.05 }
      };
    },
    auth: { user: { email: 'writer@example.test' } },
    request: {
      generationId: 'gen-test-1',
      projectId: 'proj-1',
      chapterId: 'ch-1',
      genre: '都市',
      targetWords: 100
    },
    contract: {
      chapterId: 'ch-1',
      chapterNo: 1,
      chapterGoal: '潜入庭院确认接头信号',
      wordBudget: { minChars: 30, maxChars: 500, targetChars: 100 }
    },
    context: '前情提要：主角潜伏于旧城区。',
    genre: { status: 'resolved', genre: '都市' }
  });

  assert.equal(mockCalls.length, 1);
  assert.equal(result.calls.length, 1);
  assert.equal(result.draft, fakeDraftText);
  assert.equal(result.deterministicAudit.passed, true);
  assert.equal(result.quality.passed, true);
  assert.ok(result.quality.qualityVector.language);
  assert.ok(result.quality.qualityVector.logic);
  assert.ok(result.quality.qualityVector.dialogue);
  assert.equal(result.manifest.pipelineVersion, 'content-engine-v2');

  // 验证生成的证据能够通过提交门禁校验
  const commitCheck = validateGenerationAuditEvidence({
    generationId: 'gen-test-1',
    chapterNo: 1,
    content: fakeDraftText,
    contentHash: result.manifest.outputHash,
    genre: '都市',
    result: {
      draft: fakeDraftText,
      outputHash: result.manifest.outputHash,
      contract: { chapterNo: 1 },
      audit: result.deterministicAudit,
      semanticAudit: result.semanticAudit,
      quality: result.quality
    }
  });
  assert.equal(commitCheck.ok, true);
});

test('evaluateQualityVector generates genre-specific critical dimensions', () => {
  const suspenseQuality = evaluateQualityVector('正文内容足够长且逻辑严密', {
    genre: '悬疑',
    contract: { wordBudget: { targetChars: 50 } },
    targetWords: 50
  });
  assert.equal(suspenseQuality.passed, true);
  assert.ok(suspenseQuality.qualityVector.language);
  assert.ok(suspenseQuality.qualityVector.clueIntegrity);
  assert.ok(suspenseQuality.qualityVector.povBoundary);

  const xuanhuanQuality = evaluateQualityVector('玄幻战斗正文', {
    genre: '玄幻',
    contract: { wordBudget: { targetChars: 50 } },
    targetWords: 50
  });
  assert.ok(xuanhuanQuality.qualityVector.causality);
  assert.ok(xuanhuanQuality.qualityVector.consistency);
});
