'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { parseBook, validateReading, validateNotes, validateReview } = require('../lib/xuanhuan-reading');
const root = path.resolve(__dirname, '..');
const database = new DatabaseSync(path.join(root, 'data/xuanhuan-lab/reading.db'), { readOnly: true });
const id = process.argv[2];
const row = id ? database.prepare('SELECT payload FROM reading_jobs WHERE id=?').get(id) : database.prepare('SELECT payload FROM reading_jobs ORDER BY updated DESC LIMIT 1').get();
database.close();
if (!row) throw new Error('没有精读任务');
const job = JSON.parse(row.payload);
const persistedStages = JSON.stringify(job.stages);
let paragraphs = 0, citations = 0, excluded = 0;
const errors = [], books = [];
for (const book of job.books) {
  const raw = fs.readFileSync(path.resolve(root, '../资源库/小说原本/玄幻', book.filename));
  const source = new TextDecoder(book.encoding, { fatal: true }).decode(raw);
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  if (digest !== book.hash) errors.push(`${book.id}: 原文件指纹变化`);
  for (const chapter of book.chapters) {
    paragraphs += chapter.paragraphs.length; excluded += chapter.excludedAppendix?.length || 0;
    if (JSON.stringify(chapter.segments.flat()) !== JSON.stringify(chapter.paragraphs.map(paragraph => paragraph.id))) errors.push(`${chapter.id}: 分段遗漏或重复`);
    for (const paragraph of [...chapter.paragraphs, ...(chapter.excludedAppendix || [])]) if (source.slice(paragraph.start, paragraph.end) !== paragraph.text) errors.push(`${paragraph.id}: 原文位置不准确`);
    for (let index = 0; index < chapter.segments.length; index += 1) {
      try { validateReading(job.stages[`${chapter.id}:read:${index}`], chapter.paragraphs.filter(paragraph => chapter.segments[index].includes(paragraph.id))); }
      catch (error) { errors.push(`${chapter.id}: ${error.message}`); }
    }
    try { validateNotes(job.stages[`${chapter.id}:synthesis`], chapter.paragraphs); validateReview(job.stages[`${chapter.id}:review`], job.stages[`${chapter.id}:synthesis`], chapter.paragraphs); }
    catch (error) { errors.push(`${chapter.id}: ${error.message}`); }
  }
  try {
    const retrospective = job.stages[`${book.id}:retrospective`]; validateNotes(retrospective, book.chapters.flatMap(chapter => chapter.paragraphs));
    if (retrospective.claims.filter(claim => new Set(claim.evidence.map(evidence => evidence.paragraphId.split('-p')[0])).size >= 2).length < 2) errors.push(`${book.id}: 缺少跨章证据`);
  } catch (error) { errors.push(`${book.id}: ${error.message}`); }
  const expanded = parseBook(raw, book, 30);
  const pilotCharacters = book.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.reduce((total, paragraph) => total + paragraph.text.length, 0), 0);
  const expandedCharacters = expanded.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.reduce((total, paragraph) => total + paragraph.text.length, 0), 0);
  const usage = job.usage.filter(item => item.stage.startsWith(book.id));
  const known = usage.filter(item => Number.isFinite(item.usage?.totalTokens));
  const total = known.reduce((sum, item) => sum + item.usage.totalTokens, 0);
  books.push({ id: book.id, title: book.title, hashUnchanged: digest === book.hash, chapters: book.chapters.map(chapter => chapter.title), pilotCharacters, first30Characters: expandedCharacters, callsWithUsage: usage.length, knownTokens: total, remaining27ReadingTokensProjection: known.length === usage.length && usage.length ? Math.ceil(total * (expandedCharacters - pilotCharacters) / pilotCharacters) : null, projectionDisclosure: '仅按前三章实际用量与剩余27章正文体量外推；不含30章最终综合、修复重试和原创试写，不是计费承诺。' });
}
for (const value of Object.values(job.stages)) {
  const notes = value.notes || value;
  citations += (notes.claims || []).reduce((sum, claim) => sum + claim.evidence.length, 0);
}
const usageRecords = job.usage.filter(item => Number.isFinite(item.usage?.totalTokens));
const costs = job.usage.filter(item => Number.isFinite(item.usage?.creditCost));
if (job.callCount > 38 || job.attempts.length !== job.callCount) errors.push('调用预算或尝试账本不一致');
if (job.status !== 'completed') errors.push('任务尚未完成');
if (JSON.stringify(job.stages) !== persistedStages) errors.push('持久化笔记仍需要来源定位修复，应通过恢复流程保存后重新审计');
const report = { id: job.id, status: job.status, passed: errors.length === 0, errors, books, narrativeParagraphs: paragraphs, excludedAppendixParagraphs: excluded, verifiedCitationEntries: citations, completedStages: Object.keys(job.stages).length, calls: job.callCount, maxCalls: job.maxCalls, knownTokens: usageRecords.reduce((sum, item) => sum + item.usage.totalTokens, 0), tokenRecords: usageRecords.length, knownCreditCost: costs.reduce((sum, item) => sum + item.usage.creditCost, 0), creditRecords: costs.length, missingUsageAttempts: job.callCount - usageRecords.length, nextPhase: '等待用户确认扩展预算；没有启动各30章精读或原创试写', limits: '这是完整性和来源核验，不是文学质量评审。模型覆盖回执不能证明理解。作者附言单独保留，未用于叙事方法提炼。' };
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
