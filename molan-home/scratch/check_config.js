const http = require('http');

http.get({
  socketPath: '\\\\.\\pipe\\verge-mihomo',
  path: '/configs'
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Port:', json.port, 'MixedPort:', json['mixed-port'], 'SocksPort:', json['socks-port'], 'Mode:', json.mode);
    } catch (e) {
      console.error(e);
    }
  });
}).on('error', console.error);
