'use strict';

const fs = require('node:fs');
const path = require('node:path');
const engine = require('../lib/genre-engine');

const root = path.resolve(__dirname, '..');
const baseSource = path.resolve(root, '..', '资源库', '小说原本');
const outDir = path.join(root, 'data', 'genre-lab');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function processFamily(familyName, familyMeta) {
  console.log(`\n=== 正在构建 [${familyName}] (${familyMeta.title}) 资产库 ===`);
  const corpusFile = path.join(outDir, `corpus-${familyMeta.id}.json`);
  let existingCorpus = { books: [], scenes: [] };
  if (fs.existsSync(corpusFile)) {
    try {
      existingCorpus = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
    } catch (_) {}
  }
  const existingBookMap = new Map((existingCorpus.books || []).map(b => [b.filename, b]));
  const existingSceneMap = new Map((existingCorpus.scenes || []).map(s => [s.id, s]));

  const books = [];
  const scenes = [];
  const seenHashes = new Set();

  for (const sub of familyMeta.subcategories) {
    const subDir = path.join(baseSource, sub);
    if (!fs.existsSync(subDir)) continue;

    const files = fs.readdirSync(subDir).filter(f => f.endsWith('.txt')).sort();
    console.log(`- 子题材 [${sub}]: 发现 ${files.length} 部小说`);

    for (const file of files) {
      const filePath = path.join(subDir, file);
      const stat = fs.statSync(filePath);
      const fileKey = `${sub}/${file}`;
      
      const buffer = fs.readFileSync(filePath);
      const sourceHash = engine.digest(buffer);

      const [title, ...authorParts] = file.replace(/\.txt$/, '').split(' - ');
      const author = authorParts.join(' - ') || '佚名';
      const bookId = engine.digest(fileKey).slice(0, 16);

      // 检查增量缓存
      const cachedBook = existingBookMap.get(fileKey);
      if (cachedBook && cachedBook.sourceHash === sourceHash && cachedBook.sceneIds) {
        books.push(cachedBook);
        for (const sid of cachedBook.sceneIds) {
          const sc = existingSceneMap.get(sid);
          if (sc && !seenHashes.has(sc.hash)) {
            seenHashes.add(sc.hash);
            scenes.push(sc);
          }
        }
        continue;
      }

      const { text, encoding } = engine.decodeTextBuffer(buffer);
      const chapters = engine.extractChapterRanges(text);
      const sceneIds = [];

      // 每本书选取至多 15 个代表性章节窗口
      const maxSample = Math.min(15, chapters.length);
      const step = chapters.length > maxSample ? Math.floor(chapters.length / maxSample) : 1;

      for (let i = 0; i < chapters.length && sceneIds.length < maxSample; i += step) {
        const chap = chapters[i];
        const windows = engine.extractSceneWindows(text, chap);
        if (!windows.length) continue;
        const win = windows[0];

        // 过滤非正文杂音
        if (/求月票|最新网址|请收藏|本站域名|关注公众号/.test(win.text)) continue;

        const hash = engine.digest(engine.compact(win.text));
        if (seenHashes.has(hash)) continue;
        seenHashes.add(hash);

        const sceneId = hash.slice(0, 20);
        const tags = engine.labelSceneFunctions(win.text);

        const sceneObj = {
          id: sceneId,
          hash,
          bookId,
          title,
          author,
          category: sub,
          family: familyName,
          chapter: chap.title,
          text: win.text,
          length: win.text.length,
          functions: tags.map(t => t.name),
          techniques: tags.map(t => t.technique)
        };

        scenes.push(sceneObj);
        sceneIds.push(sceneId);
      }

      books.push({
        id: bookId,
        title,
        author,
        filename: fileKey,
        category: sub,
        encoding,
        sizeBytes: stat.size,
        sourceHash,
        chaptersCount: chapters.length,
        scenesCount: sceneIds.length,
        sceneIds
      });
    }
  }

  const corpus = {
    version: engine.VERSION,
    familyId: familyMeta.id,
    familyName,
    generatedAt: new Date().toISOString(),
    totalBooks: books.length,
    totalScenes: scenes.length,
    books,
    scenes
  };

  fs.writeFileSync(corpusFile + '.tmp', JSON.stringify(corpus));
  fs.renameSync(corpusFile + '.tmp', corpusFile);

  console.log(`✔ [${familyName}] 构建完成: ${books.length} 部小说, 提取 ${scenes.length} 篇高张力范文切片`);
  return { familyId: familyMeta.id, familyName, booksCount: books.length, scenesCount: scenes.length };
}

function main() {
  const target = process.argv[2] || 'all';
  const summary = [];

  for (const [familyName, meta] of Object.entries(engine.GENRE_FAMILIES)) {
    if (target === 'all' || target === familyName || target === meta.id) {
      const res = processFamily(familyName, meta);
      summary.push(res);
    }
  }

  // 写入全局索引汇总
  const summaryFile = path.join(outDir, 'index.json');
  fs.writeFileSync(summaryFile, JSON.stringify({
    version: engine.VERSION,
    updatedAt: new Date().toISOString(),
    families: summary
  }, null, 2));

  console.log('\n========================================');
  console.log('所有指定题材资产整理与切片索引构建完毕！');
  console.log(JSON.stringify(summary, null, 2));
}

main();