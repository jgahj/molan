'use strict';

const http = require('http');

async function getAdminToken() {
  const res = await request('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '1271055010@qq.com', password: '123456' })
  });
  if (res.json?.token) return res.json.token;
  throw new Error('Admin login failed: ' + res.body);
}

async function getGuestToken() {
  const rnd = Math.floor(Math.random() * 100000);
  const testEmail = `guest_${rnd}@example.com`;
  const testPass = '123456';
  const regRes = await request('http://127.0.0.1:3000/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPass, name: '普通用户' })
  });
  if (regRes.json?.token) {
    console.log('  Registered guest user:', testEmail, 'role:', regRes.json.user?.role);
    return regRes.json.token;
  }
  const loginRes = await request('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPass })
  });
  return loginRes.json?.token || '';
}

async function request(urlStr, options = {}) {
  const u = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        resolve({ statusCode: res.statusCode, headers: res.headers, body, json });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function testStream(urlStr, options = {}) {
  const u = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: options.headers || {}
    }, res => {
      let fullText = '';
      let billing = null;
      let usage = null;
      let error = null;
      res.on('data', chunk => {
        const text = chunk.toString();
        fullText += text;
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (dataStr && dataStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.molan_billing) billing = parsed.molan_billing;
                if (parsed.molan_usage) usage = parsed.molan_usage;
                if (parsed.molan_error) error = parsed.molan_error;
              } catch (_) {}
            }
          }
        }
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, fullText, billing, usage, error });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  console.log('=== [1] 开始验证题材规范化与基线接口 (GET /api/benchmark/baseline?genre=都市) ===');
  const adminToken = await getAdminToken();
  const guestToken = await getGuestToken();

  const baselineRes = await request('http://127.0.0.1:3000/api/benchmark/baseline?genre=都市', {
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  console.log('Baseline Status:', baselineRes.statusCode);
  if (baselineRes.statusCode === 200 && baselineRes.json) {
    console.log('  Normalized Genre:', baselineRes.json.genre);
    console.log('  Family:', baselineRes.json.family);
    console.log('  Runtime Status:', baselineRes.json.runtime?.status);
    console.log('  Has Writing Block:', !!baselineRes.json.runtime?.writingBlock);
    console.log('  Has Review Block:', !!baselineRes.json.runtime?.reviewBlock);
  } else {
    console.error('  Failed baseline:', baselineRes.body);
  }

  console.log('\n=== [2] 开始验证模型降级标记 (普通用户请求非默认模型 gpt-5.2) ===');
  const downgradeRes = await testStream('http://127.0.0.1:3000/api/chat', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + guestToken
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '测试一句话' }],
      model: 'gpt-5.2',
      stage: 'single'
    })
  });
  console.log('Chat Status:', downgradeRes.statusCode);
  console.log('X-Molan-Model-Downgraded Header:', downgradeRes.headers['x-molan-model-downgraded'] || 'none');
  console.log('X-Molan-Requested-Model Header:', downgradeRes.headers['x-molan-requested-model'] || 'none');
  console.log('Billing Downgraded Field:', downgradeRes.billing?.downgraded, 'from:', downgradeRes.billing?.downgradedFrom);
  console.log('Final Model:', downgradeRes.headers['x-molan-model']);

  console.log('\n=== [3] 开始验证真实 gpt-6-luna 都市题材两阶段起草与流式输出 ===');
  const chatRes = await testStream('http://127.0.0.1:3000/api/chat', {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + adminToken
    },
    body: JSON.stringify({
      messages: [{
        role: 'user',
        content: '沈砚舟醒来时，先想抬手。没有手掌，没有呼吸，也没有身体压在床褥上的重量。他能感到的只有一层层细碎的回响：断开的铜线、停转的测波器、沉在潮下的旧信标。请据此续写一段都市高武正文，要求展现人物机锋与现场细节，字数约600字。'
      }],
      model: 'gpt-6-luna',
      stage: 'writing',
      genre: '都市',
      creationMode: true,
      max_tokens: 3000
    })
  });
  console.log('GPT-6-Luna Stream Status:', chatRes.statusCode);
  console.log('Stream Usage:', chatRes.usage ? `totalTokens=${chatRes.usage.totalTokens}, cost=${chatRes.usage.creditCost}` : 'none');
  const sampleDelta = chatRes.fullText.split('\n').filter(l => l.includes('"delta":{"content":')).slice(0, 5).join('\n');
  console.log('Stream Deltas Preview:\n', sampleDelta);

  console.log('\n=== [4] 开始验证证据审校管线 (POST /api/benchmark/audit with genre=都市) ===');
  const auditRes = await request('http://127.0.0.1:3000/api/benchmark/audit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + adminToken
    },
    body: JSON.stringify({
      genre: '都市',
      modelId: 'gpt-6-luna',
      minChars: 200,
      targetWords: 800,
      text: '沈砚舟醒来时，先想抬手。没有手掌，没有呼吸，也没有身体压在床褥上的重量。他能感到的只有一层层细碎的回响：断开的铜线、停转的测波器、沉在潮下的旧信标。那些声音沿着废弃信号网传来，在他意识里拼出一张模糊的岚汐城地图。他试着喊了一声。几个仍在工作的接收器同时亮起，随后又暗了下去。“行。”沈砚舟想，“至少没把自己喊成全城广播。”一段旧档案随回响浮上来。档案上有他的姓名和职位：沈砚舟，旧日航道指挥官。下面的事故标签更醒目——断灯夜责任者。纪岑推开检修井的铸铁盖，雨水顺着眉骨流进眼睛。他抹了一把脸，手里拎着扳手与旧电容。巷子尽头的霓虹在积水里碎成红蓝交错的细斑。'
    })
  });
  console.log('Audit Status:', auditRes.statusCode);
  const auditData = auditRes.json?.audit || auditRes.json;
  if (auditRes.statusCode === 200 && auditData) {
    console.log('  Audit Passed:', auditData.passed);
    console.log('  Audit Status Field:', auditData.status);
    console.log('  Genre Inferred/Used:', auditData.baseline?.genre);
    console.log('  Hard Constraints Passed:', auditData.hard?.passed);
    console.log('  Issue Count:', auditData.issues?.length || 0);
  } else {
    console.error('  Audit Failed:', auditRes.body);
  }

  console.log('\n=== 诊断与复核全部完成 ===');
}

main().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
