const http = require('http');

function testProxy(name) {
  return new Promise((resolve) => {
    const url = `/proxies/${encodeURIComponent(name)}/delay?url=${encodeURIComponent('http://192.220.47.188:8080/v1/models')}&timeout=4000`;
    http.get({ socketPath: '\\\\.\\pipe\\verge-mihomo', path: url }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ name, ...json });
        } catch {
          resolve({ name, error: data });
        }
      });
    }).on('error', e => resolve({ name, error: e.message }));
  });
}

(async () => {
  const nodes = [
    '🇯🇵日本•移联01',
    '🇯🇵日本•移联02',
    '🇸🇬新加坡•移联01',
    '🇸🇬新加坡•移联02',
    '🇭🇰香港•移联01',
    '🇭🇰香港•移联02',
    '🇨🇳台湾•移联01',
    '🇰🇷韩国•移联01',
    '🇺🇸美国•移联01',
    '🇬🇧英国•移联01',
    '🇩🇪德国•移联01',
    '🇯🇵日本•电信01',
    '🇭🇰香港•电信01'
  ];
  for (const n of nodes) {
    const r = await testProxy(n);
    console.log(n, r.delay ? `Delay: ${r.delay}ms` : `Fail: ${r.message || r.error}`);
  }
})();
