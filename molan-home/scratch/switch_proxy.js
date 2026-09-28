const http = require('http');

function selectProxy(group, name) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ name });
    const req = http.request({
      socketPath: '\\\\.\\pipe\\verge-mihomo',
      path: `/proxies/${encodeURIComponent(group)}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const code1 = await selectProxy('吹雪云', '🇭🇰香港•移联02');
  const code2 = await selectProxy('GLOBAL', '🇭🇰香港•移联02');
  console.log('Switch result:', code1, code2);
})();
