const http = require('http');

http.get('http://127.0.0.1:3000/favicon.ico', (res) => {
  console.log('FAVICON STATUS:', res.statusCode);
  console.log('CONTENT-TYPE:', res.headers['content-type']);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('BODY LENGTH:', data.length);
    console.log('BODY PREFIX:', data.slice(0, 50));
  });
}).on('error', err => {
  console.error('ERROR:', err.message);
});
