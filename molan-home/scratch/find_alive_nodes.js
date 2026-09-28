const http = require('http');

function testNode(name) {
  return new Promise(resolve => {
    const url = `/proxies/${encodeURIComponent(name)}/delay?url=${encodeURIComponent('http://cp.cloudflare.com/generate_204')}&timeout=3000`;
    http.get({ socketPath: '\\\\.\\pipe\\verge-mihomo', path: url }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve({ name, delay: j.delay, msg: j.message });
        } catch (e) {
          resolve({ name, error: d });
        }
      });
    }).on('error', e => resolve({ name, error: e.message }));
  });
}

http.get({ socketPath: '\\\\.\\pipe\\verge-mihomo', path: '/proxies' }, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', async () => {
    const json = JSON.parse(d);
    const proxies = json.proxies;
    const group = proxies['吹雪云'] || proxies['GLOBAL'];
    const all = group ? group.all : [];
    console.log(`Found ${all.length} nodes in group`);
    for (const n of all) {
      if (n.includes('流量') || n.includes('到期') || n.includes('官网') || n.includes('重置')) continue;
      const res = await testNode(n);
      if (res.delay) {
        console.log(`[ALIVE] ${n}: ${res.delay}ms`);
      }
    }
    console.log('Finished testing alive nodes.');
  });
});
