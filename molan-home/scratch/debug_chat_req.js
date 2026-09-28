const http = require('http');

const body = JSON.stringify({
  model: 'gpt-5.6-luna',
  stage: 'skill_analysis',
  thinking: false,
  temperature: 0.2,
  max_tokens: 3000,
  jsonMode: true,
  messages: [
    { role: 'system', content: '你是一个小说拆解大师，请将以下小说片段拆解为 JSON 格式。包含 overview, framework, timeline 字段。' },
    { role: 'user', content: '第一章 冻水与柴刀。天蒙蒙亮，黎泾河面的水汽冻成了白茫茫的霜雾。李木田裹着打满补丁的粗麻袄子，踩在半融半冻的黑烂泥里。' }
  ]
});

const start = Date.now();
const req = http.request('http://127.0.0.1:3000/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer 80345da926eb25f3b9e672e1fe64a864f2a4ca2458d22372',
    'x-molan-internal-route': 'molan-internal-model-route-v1'
  }
}, res => {
  console.log(`[+${Date.now() - start}ms] Status: ${res.statusCode}, Headers:`, res.headers);
  let d = '';
  res.on('data', chunk => {
    d += chunk;
    console.log(`[+${Date.now() - start}ms] Data chunk received: ${chunk.length} bytes`);
  });
  res.on('end', () => {
    console.log(`[+${Date.now() - start}ms] STREAM ENDED! Total: ${d.length} bytes`);
  });
});

req.on('error', err => console.error('ERR:', err.message));
req.write(body);
req.end();
