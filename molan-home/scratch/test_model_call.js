const http = require('http');

const req = http.request('http://129.204.195.26/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-6ea28df55f371c773cdb577ac429d27ce08627901a80b320d4fee78d43ca328b'
  }
}, res => {
  console.log('Status:', res.statusCode);
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(d);
      console.log('Choices content:', parsed.choices?.[0]?.message?.content || d);
    } catch (_) {
      console.log('Raw output:', d);
    }
  });
});

req.on('error', e => console.error('ERR:', e.message));
req.write(JSON.stringify({
  model: 'gpt-5.6-luna',
  messages: [{ role: 'user', content: '请输出五个字：模型已联通' }],
  max_tokens: 20
}));
req.end();
