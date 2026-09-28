const http = require('http');

http.get({
  socketPath: '\\\\.\\pipe\\verge-mihomo',
  path: '/proxies'
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const json = JSON.parse(data);
    for (const [k, v] of Object.entries(json.proxies || {})) {
      if (v.type === 'Selector' || v.type === 'URLTest' || v.type === 'Fallback') {
        console.log(`Group: ${k} (now: ${v.now})`);
      }
    }
  });
});
