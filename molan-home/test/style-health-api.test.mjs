import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const app = require('../server.js');

function createMockReq(method, url, body) {
  const jsonStr = body !== undefined ? JSON.stringify(body) : '';
  const req = Readable.from(jsonStr ? [Buffer.from(jsonStr, 'utf8')] : []);
  req.method = method;
  req.url = url;
  req.headers = {
    'content-type': 'application/json',
    origin: 'http://127.0.0.1:3000'
  };
  return req;
}

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(code, headers) {
      this.statusCode = code;
      if (headers) Object.assign(this.headers, headers);
    },
    end(chunk) {
      if (chunk) this.body += chunk.toString();
      if (this._resolve) this._resolve();
    },
    waitForEnd() {
      return new Promise(resolve => {
        if (this.body) resolve();
        else this._resolve = resolve;
      });
    }
  };
}

test('POST /api/style/detect 处理文本智能文风识别', async () => {
  const req = createMockReq('POST', '/api/style/detect', {
    text: '张拂潇嘴里叼着一根草，骂了一句：“草！抢劫抢到老娘头上来了？你们给老娘等着！”'
  });
  const res = createMockRes();

  app.handleStyleDetect(req, res);
  await res.waitForEnd();

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.equal(data.styleArchetype, 'humorous_sand_sculpture');
  assert.ok(data.genreFamily === '古言世情' || data.genreFamily === 'ancient_romance');
});

test('POST /api/chapter/health-check 评估章节正文健康度与合规', async () => {
  const chapterText = `第1章 风雪夜归人\n\n大雪纷飞，长街寂静。\n\n陆沉按住腰间的《断水剑》，眼神冷冽如冰。身后传来轻微的踏雪声，他并未回头。`;
  const req = createMockReq('POST', '/api/chapter/health-check', {
    text: chapterText,
    metadata: { title: '风雪夜归人', keyProps: ['断水剑'] }
  });
  const res = createMockRes();

  app.handleChapterHealthCheck(req, res);
  await res.waitForEnd();

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.ok(data.health);
  assert.ok(data.health.compositeScore > 0);
  assert.equal(data.health.fulfillment.props.fulfilled[0], '断水剑');
});

test('Causal Debts API: 创建、提取、平账全流程', async () => {
  const bookId = 'api-test-book-99';

  // 1. 创建因果债务
  const reqCreate = createMockReq('POST', `/api/causal-debts/${bookId}`, {
    originChapter: 1,
    type: 'arc',
    debtCategory: 'comedy_mess',
    seed: '偷偷放走了掌门的七彩锦鸡',
    immediateCost: '掌门发飙封锁宗门大门'
  });
  const resCreate = createMockRes();
  app.handleCausalDebtCreate(reqCreate, resCreate, bookId);
  await resCreate.waitForEnd();
  assert.equal(resCreate.statusCode, 200);
  const createdData = JSON.parse(resCreate.body);
  assert.equal(createdData.ok, true);
  const debtId = createdData.debt.id;

  // 2. 读取因果债务
  const reqGet = createMockReq('GET', `/api/causal-debts/${bookId}?chapterNo=2`);
  const resGet = createMockRes();
  app.handleCausalDebtsGet(reqGet, resGet, bookId);
  await resGet.waitForEnd();
  assert.equal(resGet.statusCode, 200);
  const getData = JSON.parse(resGet.body);
  assert.equal(getData.ok, true);
  assert.ok(getData.active.some(d => d.id === debtId));

  // 3. 从文本提取
  const sampleText = '县衙后堂内，书吏冷笑道：“少了一钱碎银，大魏律例，折色少二钱不准立户。”';
  const reqExt = createMockReq('POST', `/api/causal-debts/${bookId}/extract`, {
    text: sampleText,
    chapterNo: 2
  });
  const resExt = createMockRes();
  app.handleCausalDebtsExtract(reqExt, resExt, bookId);
  await resExt.waitForEnd();
  assert.equal(resExt.statusCode, 200);
  const extData = JSON.parse(resExt.body);
  assert.equal(extData.ok, true);
  assert.ok(extData.count >= 1);

  // 4. 平账
  const reqSettle = createMockReq('POST', `/api/causal-debts/${bookId}/settle`, {
    debtId,
    reason: '第3章锦鸡自己飞回来了'
  });
  const resSettle = createMockRes();
  app.handleCausalDebtSettle(reqSettle, resSettle, bookId);
  await resSettle.waitForEnd();
  assert.equal(resSettle.statusCode, 200);
  const settleData = JSON.parse(resSettle.body);
  assert.equal(settleData.ok, true);
  assert.equal(settleData.debt.status, 'settled');

  // 清理
  const tracker = app.getCreationDebtTracker();
  tracker.clearDebts(bookId);
});
