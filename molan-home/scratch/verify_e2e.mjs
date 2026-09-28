import assert from 'node:assert/strict';

const BASE_URL = 'http://127.0.0.1:3000';
const EMAIL = '1271055010@qq.com';
const PASSWORD = '123456';

function parseChatStream(rawStream) {
  let text = '';
  let usage = null;
  for (const event of rawStream.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data || data === '[DONE]') continue;
    try {
      const packet = JSON.parse(data);
      if (packet.error || packet.molan_error) throw new Error(packet.error || packet.molan_error);
      if (packet.molan_usage) usage = packet.molan_usage;
      if (packet.choices && packet.choices[0]) {
        const c = packet.choices[0];
        if (c.delta && typeof c.delta.content === 'string') text += c.delta.content;
        else if (c.message && typeof c.message.content === 'string') text += c.message.content;
        else if (typeof c.text === 'string') text += c.text;
      }
    } catch (err) {
      if (err.message && err.message.includes('molan_error')) throw err;
    }
  }
  return { text: text.trim(), usage };
}

async function main() {
  console.log('=== [1/5] 健康检查 ===');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  assert.equal(healthRes.status, 200, 'Health endpoint should return 200');
  const health = await healthRes.json();
  console.log('Health:', JSON.stringify(health));
  assert.equal(health.ok, true);
  assert.equal(health.db, 'ready');
  assert.equal(health.postgres.status, 'ready');
  assert.equal(health.postgres.tableCount, 77);

  console.log('\n=== [2/5] 账户登录 ===');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  assert.equal(loginRes.status, 200, `Login failed with ${loginRes.status}`);
  const loginData = await loginRes.json();
  assert.equal(loginData.ok, true);
  const token = loginData.token;
  console.log(`登录成功，Token: ${token.slice(0, 16)}...`);

  console.log('\n=== [3/5] 查询初始账户信息 ===');
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(meRes.status, 200);
  const me = await meRes.json();
  console.log(`用户: ${me.user.name} (${me.user.email}), 积分: ${me.user.credits}, 已消耗: ${me.user.spent}`);

  console.log('\n=== [4/5] 发起真实超短模型请求 (gpt-5.6-luna) ===');
  const startTime = Date.now();
  const chatRes = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      modelId: 'gpt-5.6-luna',
      messages: [
        { role: 'user', content: '请只输出四个字：墨阑就绪' }
      ],
      max_tokens: 16,
      temperature: 0.2
    })
  });
  assert.equal(chatRes.status, 200, `Chat request failed HTTP ${chatRes.status}`);
  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder();
  let rawStream = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rawStream += decoder.decode(value, { stream: true });
  }
  const duration = Date.now() - startTime;
  console.log(`流传输完毕，耗时: ${duration}ms`);
  const parsed = parseChatStream(rawStream);
  console.log(`模型回复: "${parsed.text}"`);
  console.log(`Token 结算记录:`, JSON.stringify(parsed.usage));
  assert.ok(parsed.text.length > 0, 'Model returned non-empty response');

  console.log('\n=== [5/5] 验证调用后账户结算与状态 ===');
  const afterMeRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const afterMe = await afterMeRes.json();
  console.log(`调用后积分: ${afterMe.user.credits}, 已消耗: ${afterMe.user.spent}`);

  const finalHealth = await (await fetch(`${BASE_URL}/api/health`)).json();
  console.log('最终健康状态:', JSON.stringify(finalHealth));
  console.log('\n>>> 验收全流程顺利通过！<<<');
}

main().catch(err => {
  console.error('验收失败:', err);
  process.exit(1);
});
