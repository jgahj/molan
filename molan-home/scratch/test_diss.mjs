const BASE = 'http://127.0.0.1:3000';

async function main() {
  console.log('1. 注册临时用户...');
  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `diss_${Date.now()}@example.com`, password: 'Password123!', name: 'DissTest' })
  });
  const reg = await regRes.json();
  const token = reg.token;
  console.log('2. 注册成功，Token =', token.slice(0, 10));

  console.log('3. 提交拆书任务 POST /api/dissections ...');
  const t0 = Date.now();
  const dissRes = await fetch(`${BASE}/api/dissections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      text: '第一章 寒冬腊月\n李木田推着独轮车走在泥泞里，车轴吱呀作响。',
      title: '极简测试',
      depth: 'quick',
      purpose: 'new-writer',
      model: 'gpt-5.6-luna'
    })
  });
  console.log(`4. 返回状态: ${dissRes.status}, 耗时: ${Date.now() - t0}ms`);
  const diss = await dissRes.json();
  console.log('5. 响应内容:', JSON.stringify(diss));
}

main().catch(err => console.error('出错了:', err));
