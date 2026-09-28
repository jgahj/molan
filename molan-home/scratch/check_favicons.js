const fs = require('fs');
const dir = 'pages';
fs.readdirSync(dir).filter(f => f.endsWith('.html')).forEach(f => {
  const s = fs.readFileSync(dir + '/' + f, 'utf8');
  const m = s.match(/<link[^>]*rel=[^>]*icon[^>]*>/i);
  if (m) console.log(f, ':', m[0]);
  else console.log(f, ': NO FAVICON');
});
