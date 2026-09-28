const http = require('http');

const req = http.get({
  socketPath: '\\\\.\\pipe\\verge-mihomo',
  path: '/proxies'
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => console.log('Proxies status:', res.statusCode, data.length));
});

req.on('error', e => console.log('Pipe err:', e.message));
