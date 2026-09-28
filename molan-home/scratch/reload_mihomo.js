const http = require('http');

const data = JSON.stringify({
  path: 'C:\\Users\\lyh\\AppData\\Roaming\\io.github.clash-verge-rev.clash-verge-rev\\profiles\\RPdzPfg9daVs.yaml'
});

const req = http.request({
  socketPath: '\\\\.\\pipe\\verge-mihomo',
  path: '/configs?force=true',
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, res => {
  console.log('Reload config status:', res.statusCode);
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Body:', d));
});
req.on('error', console.error);
req.write(data);
req.end();
