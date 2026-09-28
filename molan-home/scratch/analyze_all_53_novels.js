const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '../data/evaluation-input/ground-truth-benchmarks/real-generated-chapters');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

const allNovels = files.map(f => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const text = d.content || d.full_text || '';
    const paras = text.split(/\n\s*\n/).filter(p => p.trim());
    const diaMatches = text.match(/“[^”]*”|"[^"]*"/g) || [];
    const diaChars = diaMatches.reduce((a, s) => a + s.length, 0);
    const hardCuts = (text.match(/(?:^|\n)\s*(?:三日后|三天后|次日|翌日|一晃|转眼间|不知不觉|弹指间)[，,。]|(?:三日后|三天后)(?=[^\n]{0,8}[，,。])/g) || []).length;
    const fangfu = (text.match(/仿佛|似乎|宛如|深吸一口气|嘴角勾起/g) || []).length;
    const sensory = (text.match(/油|香|热|焦|裂|刺|冰|冷|痛|红|雾|血|铁|针/g) || []).length;

    // 提取纯净书名
    let title = d.bookTitle || '';
    if (!title || title === 'novel') {
      const parts = f.split('-');
      title = parts[0];
    }

    return {
      file: f,
      title: title,
      genre: d.genre || '未分类',
      chars: text.length,
      paras: paras.length,
      diaRatio: text.length ? Number((diaChars / text.length).toFixed(3)) : 0,
      hardCuts: hardCuts,
      fangfu: fangfu,
      sensoryCount: sensory,
      sensoryDensity: text.length ? Number(((sensory / text.length) * 100).toFixed(2)) : 0,
      model: d.model || 'gpt-5.6-luna',
      reqId: d.usage?.requestId || d.tokens?.requestId || 'N/A',
      stage: d.stage || 'N/A',
      variant: d.variant || 'N/A'
    };
  } catch (e) {
    console.error('Error parsing', f, e.message);
    return null;
  }
}).filter(Boolean);

console.log('Total files parsed:', allNovels.length);

const byGenre = {};
for (const n of allNovels) {
  if (!byGenre[n.genre]) byGenre[n.genre] = [];
  byGenre[n.genre].push(n);
}

console.log('\n=== 各题材统计数量 ===');
for (const g in byGenre) {
  console.log(`- ${g}: ${byGenre[g].length} 篇`);
}

// 汇总保存
const outPath = path.resolve(__dirname, '../data/evaluation-input/all-53-real-chapters-profile.json');
fs.writeFileSync(outPath, JSON.stringify(allNovels, null, 2), 'utf8');
console.log(`\n结果已保存至: ${outPath}`);
