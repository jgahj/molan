import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ARCHIVE_ROOT = path.resolve(__dirname, '../../资源库/小说原本');
const OUTPUT_DIR = path.resolve(__dirname, '../data/genre-lab/extracted-triplets');
const INVENTORY_FILE = path.resolve(__dirname, '../data/genre-lab/triplets-inventory.json');

const HEADING_RE = /^[ \t\u3000\uFEFF]*(第([零〇一二三四五六七八九十百千万两\d]+)[章回节卷篇话][^\r\n]{0,80}|(?:引子|序章|楔子|尾声|大结局|终章|后记)[^\r\n]{0,80}|Chapter\s*(\d+)[^\r\n]{0,80})[ \t\u3000]*$/gmu;
const IS_ANNOUNCEMENT = /月票|请假|感言|通知|上架|单章|推书|打赏|完本感言|新年快乐|祝福|公告|读者|番外说明/u;

function decodeBuffer(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buf.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le' };
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text, encoding: 'utf-8' };
  } catch {
    try {
      const text = new TextDecoder('gb18030').decode(buf);
      return { text, encoding: 'gb18030' };
    } catch {
      const text = new TextDecoder('gbk').decode(buf);
      return { text, encoding: 'gbk' };
    }
  }
}

function parseChapters(fullText) {
  const matches = [...fullText.matchAll(HEADING_RE)];
  if (matches.length === 0) return [];

  // Detect TOC: check if matches are clustered very tightly at the start (e.g. within first 3000 chars)
  let startIndex = 0;
  if (matches.length > 5 && matches[4].index < 3000) {
    for (let i = 0; i < Math.min(matches.length, 50); i++) {
      if (matches[i].index > 3000) {
        startIndex = i;
        break;
      }
    }
  }

  const validMatches = matches.slice(startIndex);
  const chapters = [];
  for (let i = 0; i < validMatches.length; i++) {
    const m = validMatches[i];
    const nextM = validMatches[i + 1];
    const headStart = m.index;
    const bodyStart = m.index + m[0].length;
    const end = nextM ? nextM.index : fullText.length;
    const rawBody = fullText.slice(bodyStart, end).trim();
    chapters.push({
      index: i + 1,
      title: m[1].trim(),
      charCount: rawBody.length,
      headStart,
      bodyStart,
      end,
      body: rawBody
    });
  }
  return chapters;
}

function extractTriplet(chapters) {
  if (chapters.length === 0) return null;

  // 1. First chapter: find first chapter with reasonable length (>= 500 chars)
  let first = chapters[0];
  for (let i = 0; i < Math.min(10, chapters.length); i++) {
    if (chapters[i].charCount >= 500 && !IS_ANNOUNCEMENT.test(chapters[i].title)) {
      first = chapters[i];
      break;
    }
  }

  // 2. Middle chapter: midpoint index
  const midIdx = Math.floor(chapters.length / 2);
  let middle = chapters[midIdx];
  if (middle.charCount < 500 || IS_ANNOUNCEMENT.test(middle.title)) {
    for (const delta of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
      const cand = chapters[midIdx + delta];
      if (cand && cand.charCount >= 500 && !IS_ANNOUNCEMENT.test(cand.title)) {
        middle = cand;
        break;
      }
    }
  }

  // 3. Last chapter: step back from the end to skip announcements/epilogues under 500 chars
  let last = chapters[chapters.length - 1];
  for (let i = chapters.length - 1; i >= Math.max(0, chapters.length - 10); i--) {
    if (chapters[i].charCount >= 500 && !IS_ANNOUNCEMENT.test(chapters[i].title)) {
      last = chapters[i];
      break;
    }
  }

  return {
    totalChapters: chapters.length,
    first: { index: first.index, title: first.title, charCount: first.charCount, body: first.body },
    middle: { index: middle.index, title: middle.title, charCount: middle.charCount, body: middle.body },
    last: { index: last.index, title: last.title, charCount: last.charCount, body: last.body }
  };
}

// Map 48 categories to 8 genre families
const CATEGORY_TO_FAMILY = {
  '玄幻': '玄幻修真',
  '传统玄幻': '玄幻修真',
  '玄幻脑洞': '玄幻修真',
  '东方仙侠': '玄幻修真',
  '仙侠': '玄幻修真',
  '都市修真': '玄幻修真',
  '武侠': '玄幻修真',
  '测试': '玄幻修真',
  '都市高武': '都市高武',
  '都市': '都市高武',
  '都市脑洞': '都市高武',
  '都市日常': '都市高武',
  '都市种田': '都市高武',
  '战神赘婿': '都市高武',
  '现实': '都市高武',
  '科幻': '科幻末世',
  '科幻末世': '科幻末世',
  '星光璀璨': '科幻末世',
  '悬疑灵异': '悬疑惊悚',
  '悬疑脑洞': '悬疑惊悚',
  '女频悬疑': '悬疑惊悚',
  '历史': '历史古代',
  '历史古代': '历史古代',
  '历史脑洞': '历史古代',
  '抗战谍战': '历史古代',
  '军事': '历史古代',
  '奇幻': '西方奇幻',
  '西方奇幻': '西方奇幻',
  '诸天无限': '西方奇幻',
  '游戏': '西方奇幻',
  '游戏体育': '西方奇幻',
  '轻小说': '西方奇幻',
  '动漫衍生': '西方奇幻',
  '男频衍生': '西方奇幻',
  '女频衍生': '西方奇幻',
  '古言脑洞': '古言世情',
  '古风世情': '古言世情',
  '宫斗宅斗': '古言世情',
  '民国言情': '古言世情',
  '年代': '古言世情',
  '玄幻言情': '古言世情',
  '豪门总裁': '现代言情',
  '现言脑洞': '现代言情',
  '青春甜宠': '现代言情',
  '职场婚恋': '现代言情',
  '快穿': '现代言情',
  '种田': '现代言情',
  '体育': '现代言情'
};

async function main() {
  const args = process.argv.slice(2);
  const sampleLimit = args.includes('--sample') ? 20 : Infinity;

  console.log(`Starting novel triplet extraction... (Archive: ${ARCHIVE_ROOT})`);
  if (!fs.existsSync(ARCHIVE_ROOT)) {
    console.error(`Archive root not found: ${ARCHIVE_ROOT}`);
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const entries = fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true });
  const allBookPaths = [];

  for (const ent of entries) {
    const full = path.join(ARCHIVE_ROOT, ent.name);
    if (ent.isDirectory()) {
      const category = ent.name;
      const files = fs.readdirSync(full).filter(f => f.endsWith('.txt'));
      for (const f of files) {
        allBookPaths.push({ category, filename: f, fullPath: path.join(full, f) });
      }
    } else if (ent.isFile() && ent.name.endsWith('.txt')) {
      allBookPaths.push({ category: '未分类', filename: ent.name, fullPath: full });
    }
  }

  console.log(`Discovered ${allBookPaths.length} books across archive.`);

  const inventory = [];
  let processed = 0;
  let successCount = 0;
  let failCount = 0;

  const targetList = sampleLimit === Infinity ? allBookPaths : allBookPaths.slice(0, sampleLimit);

  for (const book of targetList) {
    processed++;
    const bookTitle = book.filename.replace(/\.txt$/i, '');
    const family = CATEGORY_TO_FAMILY[book.category] || '玄幻修真';
    try {
      const buf = fs.readFileSync(book.fullPath);
      const { text, encoding } = decodeBuffer(buf);
      const chapters = parseChapters(text);
      const triplet = extractTriplet(chapters);

      if (!triplet) {
        failCount++;
        inventory.push({
          bookTitle,
          category: book.category,
          family,
          filename: book.filename,
          success: false,
          reason: 'No chapters detected'
        });
        continue;
      }

      successCount++;
      const bookRecord = {
        bookId: crypto.createHash('sha256').update(bookTitle).digest('hex').slice(0, 16),
        bookTitle,
        category: book.category,
        family,
        filename: book.filename,
        encoding,
        totalChars: text.length,
        totalChapters: triplet.totalChapters,
        success: true,
        chapters: {
          first: {
            index: triplet.first.index,
            title: triplet.first.title,
            charCount: triplet.first.charCount
          },
          middle: {
            index: triplet.middle.index,
            title: triplet.middle.title,
            charCount: triplet.middle.charCount
          },
          last: {
            index: triplet.last.index,
            title: triplet.last.title,
            charCount: triplet.last.charCount
          }
        }
      };

      inventory.push(bookRecord);

      // Save individual chapter details in family subfolder
      const familyDir = path.join(OUTPUT_DIR, family);
      if (!fs.existsSync(familyDir)) fs.mkdirSync(familyDir, { recursive: true });
      const safeFilename = bookTitle.replace(/[/\\?%*:|"<>]/g, '_') + '.json';
      fs.writeFileSync(
        path.join(familyDir, safeFilename),
        JSON.stringify({
          ...bookRecord,
          chapters: triplet
        }, null, 2),
        'utf-8'
      );

      if (processed % 100 === 0 || processed === targetList.length) {
        console.log(`Progress: ${processed}/${targetList.length} books processed. (Success: ${successCount}, Fail: ${failCount})`);
      }
    } catch (err) {
      failCount++;
      console.warn(`Error processing ${book.filename}:`, err.message);
      inventory.push({
        bookTitle,
        category: book.category,
        family,
        filename: book.filename,
        success: false,
        reason: err.message
      });
    }
  }

  // Save final inventory
  fs.writeFileSync(INVENTORY_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalDiscovered: allBookPaths.length,
    processedCount: processed,
    successCount,
    failCount,
    successRate: `${((successCount / processed) * 100).toFixed(2)}%`,
    inventory
  }, null, 2), 'utf-8');

  console.log(`\nExtraction completed!`);
  console.log(`Success: ${successCount} / ${processed} (${((successCount / processed) * 100).toFixed(2)}%)`);
  console.log(`Inventory saved to: ${INVENTORY_FILE}`);
}

main().catch(console.error);
