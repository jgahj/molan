const http = require('http');

const req = http.request({
  host: '127.0.0.1',
  port: 7891,
  method: 'CONNECT',
  path: '192.220.47.188:8080'
});

req.on('connect', (res, socket) => {
  console.log('CONNECT STATUS:', res.statusCode);
  socket.write('GET /v1/models HTTP/1.1\r\nHost: 192.220.47.188:8080\r\nAuthorization: Bearer sk-6ea28df55f371c773cdb577ac429d27ce08627901a80b320d4fee78d43ca328b\r\nConnection: close\r\n\r\n');
  let d = '';
  socket.on('data', c => d += c);
  socket.on('end', () => console.log('DATA:', d.slice(0, 100)));
});

req.on('error', e => console.error('ERR:', e.message));
req.setTimeout(5000, () => { console.log('TIMEOUT'); req.destroy(); });
req.end();
