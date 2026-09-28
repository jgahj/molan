const http = require('http');

function patchConfig(patch) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(patch);
    const req = http.request({
      socketPath: '\\\\.\\pipe\\verge-mihomo',
      path: '/configs',
      method: 'PATCH',
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
  const status = await patchConfig({ mode: 'global' });
  console.log('Patch config status:', status);
})();
