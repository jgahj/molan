const fs = require('fs');
const path = require('path');

const root = 'c:/Users/lyh/Desktop/小说专属网页/资源库/小说原本';
const dirs = fs.readdirSync(root, { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== '测试')
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

console.log('Total categories:', dirs.length);

const results = {};

for (const d of dirs) {
  const catPath = path.join(root, d.name);
  const files = fs.readdirSync(catPath)
    .filter(f => f.endsWith('.txt'))
    .map(f => {
      const full = path.join(catPath, f);
      const stat = fs.statSync(full);
      return {
        title: f.replace('.txt', ''),
        sizeBytes: stat.size,
        sizeMb: (stat.size / (1024 * 1024)).toFixed(2)
      };
    });

  // Sort by file size to get range from short/medium to very long epic
  files.sort((a, b) => a.sizeBytes - b.sizeBytes);

  const picked = [];
  const n = files.length;
  if (n <= 6) {
    picked.push(...files);
  } else {
    // Pick 6 distributed samples across the size/style spectrum
    const indices = [
      0,
      Math.floor(n * 0.2),
      Math.floor(n * 0.4),
      Math.floor(n * 0.6),
      Math.floor(n * 0.8),
      n - 1
    ];
    const seen = new Set();
    for (const idx of indices) {
      if (!seen.has(idx) && files[idx]) {
        seen.add(idx);
        picked.push(files[idx]);
      }
    }
    // ensure 6
    let cur = 0;
    while (picked.length < 6 && cur < n) {
      if (!seen.has(cur)) {
        seen.add(cur);
        picked.push(files[cur]);
      }
      cur++;
    }
  }

  results[d.name] = {
    totalBooks: n,
    picked: picked
  };
}

const outPath = 'c:/Users/lyh/Desktop/小说专属网页/molan-home/data/genre_sampling_6books.json';
fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
console.log('Sampling completed! Output written to:', outPath);
