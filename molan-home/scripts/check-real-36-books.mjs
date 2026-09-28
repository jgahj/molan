import fs from 'node:fs';
import path from 'node:path';

const dir = 'molan-home/data/evaluation-input/ground-truth-benchmarks/real-generated-chapters';
const files = fs.readdirSync(dir);

const books = {};
files.forEach(f => {
  const filePath = path.join(dir, f);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const title = data.bookTitle;
  if (!books[title]) {
    books[title] = {
      bookTitle: title,
      genre: data.genre,
      files: []
    };
  }
  books[title].files.push({
    filename: f,
    stage: data.stage,
    variant: data.variant,
    charCount: data.charCount || data.content?.length,
    model: data.model,
    requestId: data.usage?.requestId,
    auditFindings: data.correctionAudit?.findingCount || 0
  });
});

console.log('Total Books Found:', Object.keys(books).length);
const genres = {};
for (const [title, info] of Object.entries(books)) {
  if (!genres[info.genre]) genres[info.genre] = [];
  genres[info.genre].push(info);
}

for (const [genre, bList] of Object.entries(genres)) {
  console.log(`\n=== 题材: ${genre} (${bList.length} 本) ===`);
  for (const info of bList) {
    const details = info.files.map(x => `${x.stage}/${x.variant} (${x.charCount}字, ${x.model}, req: ${x.requestId?.slice(0, 12)}...)`).join('; ');
    console.log(`  - 《${info.bookTitle}》: ${details}`);
  }
}
