'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditSemantics, SEMANTIC_AUDIT_STATUS } = require('../lib/generation/semantic-audit');

const CLEAN_DRAFT = '陆羽缓步走入书房，窗外竹影摇曳。桌案上放着一卷泛黄的古籍。';
const CLEAN_CONTRACT = { pov: 'third-limited', viewpointCharacter: '陆羽' };
const VALID_AUTH = { token: 'secret-token' };

test('Fuzz M2: 60+ Hostile model outputs MUST never produce passed: true', async () => {
  const hostileResponses = [
    // 1. Strings & HTML & Truncations
    { text: '' },
    { text: ' ' },
    { text: '\t\r\n' },
    { text: '<html><body>502 Bad Gateway</body></html>' },
    { text: '<!DOCTYPE html>500 Internal Error' },
    { text: '{"issues": [' },
    { text: '{"issues": [{"quote": "陆羽' },
    { text: '{"issues": [{"quote": "陆羽", "severity": "blocker"}' },
    { text: '{"issues":' },
    { text: '{' },
    { text: '}' },
    { text: '[]' },
    { text: 'null' },
    { text: 'undefined' },
    { text: 'NaN' },
    { text: 'true' },
    { text: 'false' },
    { text: '12345' },
    { text: '"plain text string"' },
    { text: '```json\n{"issues": [\n```' },
    { text: '```json\n\n```' },
    { text: '```\n<html>error</html>\n```' },
    { text: '```markdown\n# Header\n```' },

    // 2. Objects with malformed .json
    { json: null },
    { json: undefined },
    { json: 123 },
    { json: 'string' },
    { json: true },
    { json: false },
    { json: [] },
    { json: {} }, // missing issues
    { json: { issues: null } },
    { json: { issues: undefined } },
    { json: { issues: 'not an array' } },
    { json: { issues: 123 } },
    { json: { issues: {} } },
    { json: { issues: true } },

    // 3. Raw primitives as response
    null,
    undefined,
    false,
    true,
    0,
    1,
    '',
    'plain string response',
    {},
    [],

    // 4. Hostile spoofing attempts
    { passed: true, status: 'MEASURED', json: { issues: null } },
    { passed: true, status: 'MEASURED', text: '{"passed": true}' },
    { json: { passed: true, blockerCount: 0 } }, // missing issues
    { text: '{"passed": true, "issues": null}' }
  ];

  for (let i = 0; i < hostileResponses.length; i++) {
    const payload = hostileResponses[i];
    const res = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: async () => payload
    });

    assert.equal(
      res.passed,
      false,
      `Hostile payload #${i} must NOT result in passed: true. Payload: ${JSON.stringify(payload)}`
    );
    assert.equal(
      res.status,
      SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED,
      `Hostile payload #${i} status must be EVALUATION_FAILED`
    );
    assert.ok(
      res.blockerCount >= 1,
      `Hostile payload #${i} must have blockerCount >= 1`
    );
    assert.ok(
      res.evaluationError !== null,
      `Hostile payload #${i} must have evaluationError`
    );
    assert.equal(
      res.audit.passed,
      false,
      `Hostile payload #${i} audit.passed must be false`
    );
    assert.equal(
      res.dimensions.causality.status,
      'NOT_MEASURED',
      `Hostile payload #${i} causality must remain NOT_MEASURED`
    );
  }
});

test('Fuzz M2: 30+ Hostile exceptions and thrown values MUST never produce passed: true', async () => {
  const hostileThrows = [
    new Error('Normal error'),
    new TypeError('Type error'),
    new RangeError('Range error'),
    new SyntaxError('Syntax error'),
    (() => { const e = new Error('ETIMEDOUT'); e.code = 'ETIMEDOUT'; return e; })(),
    (() => { const e = new Error('ECONNRESET'); e.code = 'ECONNRESET'; return e; })(),
    (() => { const e = new Error('EAI_AGAIN'); e.code = 'EAI_AGAIN'; return e; })(),
    'String error message',
    '',
    123,
    0,
    -1,
    true,
    false,
    null,
    undefined,
    {},
    { message: 'Object error without code' },
    { code: 'CUSTOM_ERR' },
    { message: 'Object error with code', code: 'RATE_LIMIT' },
    { name: 'CustomError', message: 'Custom', code: 'ERR_CUSTOM' },
    [1, 2, 3],
    Symbol('hostile_symbol'),
    BigInt(123456789)
  ];

  for (let i = 0; i < hostileThrows.length; i++) {
    const thrownVal = hostileThrows[i];
    const res = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: async () => {
        throw thrownVal;
      }
    });

    assert.equal(
      res.passed,
      false,
      `Hostile throw #${i} must NOT result in passed: true. Thrown: ${String(thrownVal)}`
    );
    assert.equal(
      res.status,
      SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED,
      `Hostile throw #${i} status must be EVALUATION_FAILED`
    );
    assert.ok(
      res.blockerCount >= 1,
      `Hostile throw #${i} must have blockerCount >= 1`
    );
    assert.ok(
      res.evaluationError !== null,
      `Hostile throw #${i} must have evaluationError`
    );
    assert.equal(
      res.audit.passed,
      false,
      `Hostile throw #${i} audit.passed must be false`
    );
  }
});

test('Fuzz M2: 20+ Hostile Promise rejections MUST never produce passed: true', async () => {
  const hostileRejections = [
    new Error('Rejected Error'),
    new TypeError('Rejected TypeError'),
    'Rejected string',
    '',
    500,
    null,
    undefined,
    { code: 'REJECTED_OBJECT' },
    { message: 'Rejection message', code: 'REJ_CODE' }
  ];

  for (let i = 0; i < hostileRejections.length; i++) {
    const rej = hostileRejections[i];
    const res = await auditSemantics({
      draft: CLEAN_DRAFT,
      contract: CLEAN_CONTRACT,
      enableModelJudge: true,
      auth: VALID_AUTH,
      callModel: () => Promise.reject(rej)
    });

    assert.equal(
      res.passed,
      false,
      `Hostile rejection #${i} must NOT result in passed: true`
    );
    assert.equal(
      res.status,
      SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED
    );
    assert.ok(res.blockerCount >= 1);
  }
});

test('Fuzz M2: Hanging Promise MUST never prematurely resolve to passed: true', async () => {
  let settled = false;
  let settledValue = null;

  const hangingCallModel = () => new Promise(() => {});

  const auditPromise = auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: hangingCallModel
  }).then(val => {
    settled = true;
    settledValue = val;
    return val;
  });

  // Wait 100ms
  await new Promise(r => setTimeout(r, 100));

  assert.equal(settled, false, 'Audit must NOT resolve while callModel is hanging');
  assert.equal(settledValue, null);
});

test('Fuzz M2: Prototype pollution CANNOT bypass a verified blocker', async () => {
  const hostilePayload = JSON.parse('{"issues": [{"category": "causality", "severity": "blocker", "quote": "陆羽缓步走入书房"}], "__proto__": {"passed": true}}');

  const res = await auditSemantics({
    draft: CLEAN_DRAFT,
    contract: CLEAN_CONTRACT,
    enableModelJudge: true,
    auth: VALID_AUTH,
    callModel: async () => ({ json: hostilePayload })
  });

  assert.equal(res.passed, false, 'Blocker must NOT be bypassed by prototype pollution');
  assert.equal(res.status, SEMANTIC_AUDIT_STATUS.MEASURED);
  assert.equal(res.blockerCount, 1);
});

