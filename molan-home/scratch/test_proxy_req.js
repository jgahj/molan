const http = require('http');

const req = http.request({
  host: '127.0.0.1',
  port: 7891,
  path: 'http://192.220.47.188:8080/v1/models',
  headers: {
    'Host': '192.220.47.188:8080',
    'Authorization': 'Bearer sk-6ea28df55f371c773cdb577ac429d27ce08627901a80b320d4fee78d43ca328b'
  }
}, res => {
  console.log('Status:', res.statusCode);
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Len:', d.length, d.slice(0, 100)));
});
req.on('error', e => console.log('Err:', e.message));
req.setTimeout(8000, () => {
  console.log('Timeout triggered');
  req.destroy();
});
req.end();
