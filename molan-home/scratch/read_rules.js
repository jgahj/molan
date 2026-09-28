const http = require('http');

http.get({
  socketPath: '\\\\.\\pipe\\verge-mihomo',
  path: '/rules'
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(d);
      console.log('Total rules:', j.rules ? j.rules.length : 0);
      const first = j.rules ? j.rules.slice(0, 10) : [];
      console.log('First rules:', first);
    } catch (e) {
      console.error(e);
    }
  });
}).on('error', console.error);
