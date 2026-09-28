const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-structural-'));
process.env.MOLAN_DATA_DIR = tempDataDir;
process.env.MOLAN_CONFIG_DIR = tempDataDir;
process.env.MOLAN_REQUIRE_SQLITE = '0';
process.env.MOLAN_PUBLIC_MODE = '0';

const server = require('../server');

// ---------- 2.2 · callMolanChat 非流式兜底：上游返回 HTML 应抛错而非把错误文本当输出 ----------
test('callMolanChat 在不上游返回可解析内容时抛错（不把原始文本当输出）', async () => {
  // callMolanChat 走 node:http 回环请求 /api/chat，这里拦截 http.request 模拟上游返回 HTML 错误页。
  const saved = http.request;
  http.request = (options, callback) => {
    const request = new EventEmitter();
    request.destroy = error => request.emit('error', error);
    request.end = () => queueMicrotask(() => {
      const response = new PassThrough();
      response.statusCode = 200;
      callback(response);
      response.end('<html><body>502 Bad Gateway</body></html>');
    });
    return request;
  };
  try {
    await assert.rejects(
      server.callMolanChat('Bearer tok', { email: 'structural-test@example.com' }, { system: 'sys', userPrompt: 'hi', stage: 'writing' }),
      /上游返回无法解析/
    );
  } finally {
    http.request = saved;
  }
});

// ---------- G0 · 场景能级与躯体应激配比门禁 ----------
test('evaluateSomaticGate 低能级场景出现应激套话即 warning，累计过多升级 blocker', () => {
  const calm = server.evaluateSomaticGate('他把账本放回柜里，指腹反复摩挲杯沿，随口应了一声。', { emotionIntensity: 2 });
  assert.equal(calm.issue && calm.issue.severity, 'warning');
  assert.equal(calm.issue.category, 'somatic');
  const clean = server.evaluateSomaticGate('他把账本放回柜里，随口应了一声。', { emotionIntensity: 2 });
  assert.equal(clean.issue, null);
  const heavy = server.evaluateSomaticGate('喉头一哽。指节泛白。喉咙发紧。虎口发麻。耳膜生疼。气血翻涌。', { emotionIntensity: 9 });
  assert.equal(heavy.issue && heavy.issue.severity, 'blocker');
  assert.equal(heavy.metrics.hits, 6);
});

// ---------- G2 · 模型审计引文必须能在正文定位 ----------
test('verifyModelAuditQuotes 定位失败的 blocker 降级为 warning 并标 unverified', () => {
  const content = '林晚推开档案室的门，值夜守卫已经折返。';
  const out = server.verifyModelAuditQuotes([
    { severity: 'blocker', category: 'continuity', quote: '值夜守卫已经折返', description: 'a' },
    { severity: 'blocker', category: 'continuity', quote: '她掏出了从未出现的钥匙', description: 'b' },
    { severity: 'info', category: 'lineedit', description: '无引文' }
  ], content);
  assert.equal(out[0].severity, 'blocker');
  assert.equal(out[0].verified, true);
  assert.equal(out[1].severity, 'warning');
  assert.equal(out[1].unverified, true);
  assert.match(out[1].description, /引文未能在正文定位/);
  assert.equal(out[2].severity, 'info');
});

// ---------- G0 · 题材默认写作 Skill 切换 ----------
test('resolveGenreWritingSkill 玄幻题材切到纯玄幻技能，其它题材回落通用技能', () => {
  const xuanhuan = server.resolveGenreWritingSkill('东方玄幻·废柴流');
  assert.equal(xuanhuan.genreMatched, true);
  assert.equal(xuanhuan.skill.id, 'mars-style-pure-xuanhuan-writing');
  const urban = server.resolveGenreWritingSkill('都市异能');
  assert.equal(urban.genreMatched, false);
  assert.equal(urban.skill.id, server.DEFAULT_WRITING_SKILL_ID);
  const ensured = server.ensureDefaultWritingSkill([{ role: 'system', content: '写作' }, { role: 'user', content: '写' }], 'writing', '仙侠');
  assert.equal(ensured.injected, true);
  assert.ok(server.extractSkillBlocks(ensured.messages).has('mars-style-pure-xuanhuan-writing'));
});

// ---------- G0 · 因果债务登记按 seed 去重 ----------
test('recordChapterCausalDebts 登记承诺与代价并去重，账本落在 MOLAN_DATA_DIR', () => {
  const bookId = 'test_debt_book';
  server.getCreationDebtTracker().clearDebts(bookId);
  const first = server.recordChapterCausalDebts(bookId, 1, '他欠下三两银子，路引被扣。', {
    newPromises: [{ text: '三日内取回父亲遗物' }],
    newRules: [{ text: '每次引火后右臂麻木半日', kind: '副作用' }]
  });
  assert.ok(first.added.length >= 2);
  assert.ok(first.added.some(item => item.type === 'arc' && item.seed === '三日内取回父亲遗物'));
  const second = server.recordChapterCausalDebts(bookId, 2, '', { newPromises: [{ text: '三日内取回父亲遗物' }] });
  assert.equal(second.added.length, 0);
  assert.ok(fs.existsSync(path.join(tempDataDir, 'causal-debts', bookId + '-debts.json')));
  const block = server.getCreationDebtTracker().buildDebtPromptInjection(bookId, 3);
  assert.match(block, /三日内取回父亲遗物/);
});

// ---------- P1-4 · 静态资源压缩协商 ----------
test('pickStaticEncoding 按 Accept-Encoding 选择 br/gzip，小文件与图片不压缩', () => {
  assert.equal(server.pickStaticEncoding({ headers: { 'accept-encoding': 'gzip, deflate, br' } }, '.js', 50000), 'br');
  assert.equal(server.pickStaticEncoding({ headers: { 'accept-encoding': 'gzip' } }, '.css', 50000), 'gzip');
  assert.equal(server.pickStaticEncoding({ headers: { 'accept-encoding': 'gzip, br' } }, '.png', 50000), '');
  assert.equal(server.pickStaticEncoding({ headers: { 'accept-encoding': 'gzip, br' } }, '.js', 200), '');
  assert.equal(server.pickStaticEncoding({ headers: {} }, '.js', 50000), '');
});

test('compressedStaticBody 生成并缓存压缩体，压缩无收益时退回原文', () => {
  const zlib = require('node:zlib');
  const entry = { data: Buffer.from('const a = 1;\n'.repeat(400)) };
  const br = server.compressedStaticBody(entry, 'br');
  assert.equal(br.encoding, 'br');
  assert.ok(br.body.length < entry.data.length);
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), entry.data.toString());
  assert.strictEqual(server.compressedStaticBody(entry, 'br').body, br.body);
  const gz = server.compressedStaticBody(entry, 'gzip');
  assert.equal(gz.encoding, 'gzip');
  assert.equal(zlib.gunzipSync(gz.body).toString(), entry.data.toString());
  const tiny = server.compressedStaticBody({ data: Buffer.from('x') }, 'gzip');
  assert.equal(tiny.encoding, '');
  assert.equal(server.compressedStaticBody(entry, '').encoding, '');
});

// ---------- 2.4 · 合同字段实质性校验 ----------
test('contractFieldsSubstantive 通过含具体人物名/行动/后果的合同', () => {
  const ok = server.contractFieldsSubstantive({
    goal: '林晚为救被扣押的弟弟潜入军部档案室',
    protagonistAction: '林晚撬开保险柜取出当年的处决令',
    opposition: '值夜守卫突然折返盘查身份',
    irreversibleResult: '她开枪示警暴露行踪被迫连夜逃亡'
  });
  assert.equal(ok.ok, true);
});

test('contractFieldsSubstantive 拦截过短字段', () => {
  const bad = server.contractFieldsSubstantive({
    goal: '变强',
    protagonistAction: '林晚撬开保险柜取出当年的处决令',
    opposition: '值夜守卫突然折返盘查身份',
    irreversibleResult: '她开枪示警暴露行踪被迫连夜逃亡'
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.field, 'goal');
});

test('contractFieldsSubstantive 拦截套话短语', () => {
  const bad = server.contractFieldsSubstantive({
    goal: '主角变强后向门派复仇',
    protagonistAction: '林晚撬开保险柜取出当年的处决令',
    opposition: '值夜守卫突然折返盘查身份',
    irreversibleResult: '她开枪示警暴露行踪被迫连夜逃亡'
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.field, 'goal');
  assert.match(bad.reason, /套话/);
});

// ---------- 2.5 · L1 结构级原创比对（纯本地） ----------
test('eventChainLcsRatio 完全相同事件链返回 1', () => {
  const chain = [
    { action: 'escape', character: 'lin', result: 'caught' },
    { action: 'fight', character: 'lin', result: 'win' },
    { action: 'heal', character: 'doc', result: 'revived' }
  ];
  const ratio = server.eventChainLcsRatio(chain, chain.slice());
  assert.equal(ratio, 1);
});

test('eventChainLcsRatio 不相交事件链返回 0', () => {
  const a = [{ action: 'escape', character: 'lin', result: 'caught' }, { action: 'fight', character: 'lin', result: 'win' }];
  const b = [{ action: 'trade', character: 'mer', result: 'profit' }, { action: 'travel', character: 'mer', result: 'arrive' }];
  assert.equal(server.eventChainLcsRatio(a, b), 0);
});

test('eventChainLcsRatio 事件不足 2 条返回 null', () => {
  assert.equal(server.eventChainLcsRatio([{ action: 'a' }], [{ action: 'a' }]), null);
});

test('functionSetJaccard 完全一致返回 1，空集合返回 null', () => {
  const a = [{ role: '主角', function: '战士' }, { role: '导师', function: '谋士' }];
  const b = [{ role: '主角', function: '战士' }, { role: '导师', function: '谋士' }];
  assert.equal(server.functionSetJaccard(a, b), 1);
  assert.equal(server.functionSetJaccard([], []), null);
});

test('computeStructuralSimilarity 在照搬事件链时判定 blocked', () => {
  const srcEvents = [
    { action: 'escape', character: 'lin', result: 'caught' },
    { action: 'fight', character: 'lin', result: 'win' },
    { action: 'heal', character: 'doc', result: 'revived' }
  ];
  const payload = { sourceStructure: { events: srcEvents, characters: [{ role: '主角', function: '战士' }] }, characters: [{ role: '主角', function: '战士' }] };
  const snapshots = [{ chapterNo: 1, recentFacts: srcEvents.slice() }];
  const result = server.computeStructuralSimilarity(payload, snapshots);
  assert.equal(result.eventChainLcsRatio, 1);
  assert.equal(result.blocked, true);
});

test('computeStructuralSimilarity 在事件链不相交时不误判', () => {
  const srcEvents = [{ action: 'escape', character: 'lin', result: 'caught' }, { action: 'fight', character: 'lin', result: 'win' }];
  const newEvents = [{ action: 'trade', character: 'mer', result: 'profit' }, { action: 'travel', character: 'mer', result: 'arrive' }];
  const payload = { sourceStructure: { events: srcEvents, characters: [{ role: '导师', function: '谋士' }] }, characters: [{ role: '主角', function: '剑客' }] };
  const snapshots = [{ chapterNo: 1, recentFacts: newEvents }];
  const result = server.computeStructuralSimilarity(payload, snapshots);
  assert.equal(result.eventChainLcsRatio, 0);
  assert.equal(result.blocked, false);
});
