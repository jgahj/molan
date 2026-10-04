'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditSemantics, SEMANTIC_AUDIT_STATUS } = require('../lib/generation/semantic-audit');

const CLEAN_DRAFT = `陆羽站在石桥上，夜雨淅淅沥沥地落入溪水中。
“天色不早了，我们该启程了。”随行的李叔收起雨伞，低声提醒。
陆羽微微颔首，目光落在前方的古道转角处。`;

const CLEAN_CONTRACT = {
  pov: 'third-limited',
  viewpointCharacter: '陆羽',
  chapterGoal: '雨夜启程'
};

const VALID_AUTH = { token: 'mock-auth-token-xyz' };

// ============================================================================
// SUITE 1: Hostile Model Responses (Malformed Text, HTML, Truncated JSON)
// ============================================================================

test('ADV-M2-01: Empty string response triggers EVALUATION_FAILED', async () => {
  const result = await auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: async () => ({ text: '' })
  });

  assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
  assert.equal(result.passed, false, 'Empty text response must fail');
  assert.ok(result.blockerCount >= 1);
  assert.equal(result.evaluationError.code, 'INVALID_MODEL_OUTPUT');
  assert.equal(result.audit.passed, false);
});

test('ADV-M2-02: Whitespace-only string triggers EVALUATION_FAILED', async () => {
  const result = await auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: async () => ({ text: '   \n\t\r   ' })
  });

  assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
  assert.equal(result.passed, false);
  assert.ok(result.blockerCount >= 1);
  assert.equal(result.evaluationError.code, 'INVALID_MODEL_OUTPUT');
});

test('ADV-M2-03: HTML 500/502/504 error page triggers EVALUATION_FAILED', async () => {
  const htmlResponses = [
    '<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1></body></html>',
    '<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>',
    '<html><head><title>504 Gateway Time-out</title></head><body>Cloudflare</body></html>'
  ];

  for (const html of htmlResponses) {
    const result = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: async () => ({ text: html })
    });

    assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
    assert.equal(result.passed, false, `HTML error response must fail: ${html.slice(0, 30)}`);
    assert.ok(result.blockerCount >= 1);
    assert.equal(result.evaluationError.code, 'JSON_PARSE_ERROR');
    assert.ok(result.evaluationError.message.includes('JSON'));
  }
});

test('ADV-M2-04: Truncated JSON outputs trigger EVALUATION_FAILED', async () => {
  const truncatedPayloads = [
    '{"issues": [',
    '{"issues": [{"quote": "突然拔出',
    '{"issues": [,]}',
    '{"issues": [{"category": "causality", "severity":',
    '{"issues": [{"category": "causality", "severity": "blocker"'
  ];

  for (const text of truncatedPayloads) {
    const result = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: async () => ({ text })
    });

    assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
    assert.equal(result.passed, false, `Truncated JSON must fail: ${text}`);
    assert.ok(result.blockerCount >= 1);
    assert.equal(result.evaluationError.code, 'JSON_PARSE_ERROR');
  }
});

test('ADV-M2-05: Markdown code fence with corrupted or empty content triggers EVALUATION_FAILED', async () => {
  const fenceCases = [
    '```json\n{"issues": [\n```',
    '```json\n\n```',
    '```json\nnot a json\n```',
    '```\n```'
  ];

  for (const text of fenceCases) {
    const result = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: async () => ({ text })
    });

    assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
    assert.equal(result.passed, false, `Corrupted markdown fence must fail: ${text}`);
    assert.ok(result.blockerCount >= 1);
  }
});

test('ADV-M2-06: Valid JSON non-object primitives trigger EVALUATION_FAILED', async () => {
  const nonObjectPrimitives = [
    'null',
    'true',
    'false',
    '12345',
    '"plain string"',
    '[]'
  ];

  for (const text of nonObjectPrimitives) {
    const result = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: async () => ({ text })
    });

    assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
    assert.equal(result.passed, false, `Non-object JSON root must fail: ${text}`);
    assert.ok(result.blockerCount >= 1);
  }
});

// ============================================================================
// SUITE 2: Corrupted or Malformed `response.json` Structure
// ============================================================================

test('ADV-M2-07: Malformed response.json types trigger EVALUATION_FAILED', async () => {
  const malformedJsonValues = [
    null,
    42,
    'issues: []',
    [],
    {},
    { issues: null },
    { issues: 'not an array' },
    { issues: 123 },
    { issues: {} }
  ];

  for (const json of malformedJsonValues) {
    const result = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: async () => ({ json })
    });

    assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
    assert.equal(result.passed, false, `Malformed json value must fail: ${JSON.stringify(json)}`);
    assert.ok(result.blockerCount >= 1);
  }
});

test('ADV-M2-08: Malformed top-level response objects trigger EVALUATION_FAILED', async () => {
  const rawResponses = [
    null,
    undefined,
    false,
    true,
    0,
    '',
    {},
    'string without wrapper'
  ];

  for (const resp of rawResponses) {
    const result = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: async () => resp
    });

    assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
    assert.equal(result.passed, false, `Invalid response object must fail: ${String(resp)}`);
    assert.ok(result.blockerCount >= 1);
  }
});

// ============================================================================
// SUITE 3: Thrown Exceptions and Rejected Promises
// ============================================================================

test('ADV-M2-09: Synchronous and Asynchronous thrown errors trigger EVALUATION_FAILED', async () => {
  // Sync throw in callModel
  const syncResult = await auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: () => {
      throw new Error('Immediate synchronous runtime explosion');
    }
  });
  assert.equal(syncResult.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
  assert.equal(syncResult.passed, false);
  assert.ok(syncResult.evaluationError.message.includes('Immediate synchronous runtime explosion'));

  // Async throw in callModel
  const asyncResult = await auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: async () => {
      throw new TypeError('Async type error inside provider pipeline');
    }
  });
  assert.equal(asyncResult.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
  assert.equal(asyncResult.passed, false);
  assert.ok(asyncResult.evaluationError.message.includes('Async type error'));
});

test('ADV-M2-10: Non-standard thrown exceptions (strings, numbers, objects, symbols) handled safely', async () => {
  const hostileThrows = [
    'Literal string error',
    503,
    { custom: 'object without message', code: 'CUSTOM_ERR' },
    null,
    undefined,
    Symbol('hostile_symbol')
  ];

  for (const hostile of hostileThrows) {
    const result = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: async () => {
        throw hostile;
      }
    });

    assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
    assert.equal(result.passed, false, `Hostile throw must fail: ${String(hostile)}`);
    assert.ok(result.blockerCount >= 1);
    assert.ok(result.evaluationError);
    assert.equal(typeof result.evaluationError.message, 'string');
    assert.equal(typeof result.evaluationError.code, 'string');
    assert.equal(result.audit.passed, false);
  }
});

test('ADV-M2-11: Promise rejections (standard and non-standard) trigger EVALUATION_FAILED', async () => {
  const rejections = [
    Promise.reject(new Error('Rejected network stream')),
    Promise.reject('Rejected string'),
    Promise.reject({ code: 'RATE_LIMIT_EXCEEDED' }),
    Promise.reject(null)
  ];

  for (const rej of rejections) {
    const result = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: () => rej
    });

    assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
    assert.equal(result.passed, false);
    assert.ok(result.blockerCount >= 1);
    assert.equal(result.audit.passed, false);
  }
});

// ============================================================================
// SUITE 4: Timeout & Hanging Promises Stress
// ============================================================================

test('ADV-M2-12: Provider timeout rejection is intercepted as EVALUATION_FAILED', async () => {
  const timeoutMock = async () => {
    const err = new Error('Connection timed out after 30000ms');
    err.code = 'ETIMEDOUT';
    throw err;
  };

  const result = await auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: timeoutMock
  });

  assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
  assert.equal(result.passed, false);
  assert.equal(result.evaluationError.code, 'ETIMEDOUT');
  assert.ok(result.blockerCount >= 1);
});

test('ADV-M2-13: Caller timeout race rejects hanging provider before audit can self-certify', async () => {
  // Simulate a hanging callModel that never resolves
  const hangingCallModel = () => new Promise(() => {});

  let auditSettled = false;
  const auditPromise = auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: hangingCallModel
  }).then(res => {
    auditSettled = true;
    return res;
  });

  // Verify that within 50ms, auditSemantics is still awaiting and has NOT self-certified as passed: true
  const timeoutPromise = new Promise(resolve => setTimeout(resolve, 50));
  await timeoutPromise;

  assert.equal(auditSettled, false, 'Hanging callModel must never synchronously or prematurely self-certify');
});

// ============================================================================
// SUITE 5: Strict Invariant Guards & Zero Self-Certification
// ============================================================================

test('ADV-M2-14: Flawless prose CANNOT self-certify pass when model judge fails', async () => {
  // Even with award-winning flawless text and zero deterministic flaws:
  const result = await auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: async () => {
      throw new Error('LLM cluster degraded');
    }
  });

  assert.equal(result.passed, false, 'Zero self-certification: passed must be false');
  assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
  assert.equal(result.blockerCount, 1);
  assert.equal(result.issues[0].issueId, 'semantic_eval_failure');
  assert.equal(result.issues[0].severity, 'blocker');
  assert.equal(result.issues[0].status, 'verified');

  // Verify that subjective dimensions remain NOT_MEASURED and are NOT fabricated
  assert.equal(result.dimensions.causality.status, 'NOT_MEASURED');
  assert.equal(result.dimensions.causality.value, null);
  assert.equal(result.dimensions.characterConsistency.status, 'NOT_MEASURED');
  assert.equal(result.dimensions.characterConsistency.value, null);
});

test('ADV-M2-15: Deterministic blocker + Model evaluation failure accumulate blockers (no erasure)', async () => {
  // Text with deterministic first-person omniscient POV breach
  const badPovText = `我看着他，他心里暗想我其实毫无还手之力。`;

  const result = await auditSemantics({
    draft: badPovText,
    contract: {
      pov: 'first-person',
      viewpointCharacter: '我'
    },
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: async () => {
      throw new Error('Model unreachable');
    }
  });

  assert.equal(result.passed, false);
  assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
  // Blocker count must include BOTH deterministic pov issue and evaluation failure
  assert.ok(result.blockerCount >= 2, `Expected >= 2 blockers, got ${result.blockerCount}`);
  assert.ok(result.issues.some(i => i.category === 'pov' && i.severity === 'blocker'));
  assert.ok(result.issues.some(i => i.issueId === 'semantic_eval_failure' && i.severity === 'blocker'));
});

test('ADV-M2-16: Model issues containing dirty or toxic elements handled robustly', async () => {
  const dirtyIssues = [
    null,
    undefined,
    123,
    'not an object',
    { quote: null, severity: 'blocker' },
    { quote: 12345, severity: 'blocker' },
    { quote: '', severity: 'blocker' },
    { quote: '   ', severity: 'blocker' },
    { quote: 'abc', severity: 'blocker' } // length < 4 chars
  ];

  const result = await auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: async () => ({
      json: {
        issues: dirtyIssues
      }
    })
  });

  // Since all quotes are either invalid, missing, or < 4 chars, none can be verified blockers
  assert.equal(result.status, SEMANTIC_AUDIT_STATUS.MEASURED);
  assert.equal(result.passed, true);
  assert.equal(result.blockerCount, 0);
});

test('ADV-M2-17: Request object routing flag activates model judge requirement', async () => {
  // Testing activation via options.request.judgeModelId
  const result = await auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    request: { judgeModelId: 'gemini-2.5-pro' },
    callModel: null, // missing callModel
    auth: VALID_AUTH
  });

  assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
  assert.equal(result.passed, false);
  assert.equal(result.evaluationError.code, 'CALL_MODEL_NOT_A_FUNCTION');

  // Testing activation via options.request.enableSemanticJudge
  const result2 = await auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    request: { enableSemanticJudge: true },
    callModel: null,
    auth: VALID_AUTH
  });

  assert.equal(result2.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
  assert.equal(result2.passed, false);
});
