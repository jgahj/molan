const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'completion-import.js'), 'utf8');
const server = require('../server');

function importApi() {
  const window = {
    addEventListener() {},
    setTimeout,
    setInterval,
    clearInterval
  };
  const document = { readyState: 'loading', addEventListener() {} };
  vm.runInNewContext(source, { window, document, Intl, TextDecoder, AbortController, URL, console });
  return window.MolanCompletionImport;
}

function file(name, text = '') {
  return { name, webkitRelativePath: name, size: Buffer.byteLength(text, 'utf8'), lastModified: 1, text };
}

test('正文文件按章节号自然排序，并保留文件夹层级的稳定顺序', () => {
  const api = importApi();
  const files = [file('第2卷/第10章.txt'), file('第1卷/第2章.txt'), file('第1卷/第10章.txt'), file('第1卷/第2章-续.txt')];
  assert.deepEqual([...api.sortImportFiles(files)].map(item => item.name), [
    '第1卷/第2章.txt',
    '第1卷/第2章-续.txt',
    '第1卷/第10章.txt',
    '第2卷/第10章.txt'
  ]);
});

test('多个正文文件按文件内容的首个章节号排序，而不是按选择回调顺序导入', () => {
  const api = importApi();
  const entries = [
    { name: 'part-c.txt', text: '第十章\n第十章正文' },
    { name: 'part-a.txt', text: '第二章\n第二章正文' },
    { name: 'part-b.txt', text: '第一章\n第一章正文' }
  ];
  assert.deepEqual([...api.orderImportedEntries(entries)].map(item => item.name), ['part-b.txt', 'part-a.txt', 'part-c.txt']);

  const volumes = [
    { name: '第2卷/part-a.txt', text: '第一章\n第二卷正文' },
    { name: '第1卷/part-b.txt', text: '第十章\n第一卷正文' }
  ];
  assert.deepEqual([...api.orderImportedEntries(volumes)].map(item => item.name), ['第1卷/part-b.txt', '第2卷/part-a.txt']);
});

test('大文件逐行识别章节，空行不会吞掉标题，且保留全部章节正文', () => {
  const api = importApi();
  const text = Array.from({ length: 300 }, (_, index) => `第${index + 1}章 标题${index + 1}\n\n本章正文${index + 1}`).join('\n\n');
  const chapters = api.splitImportedChapters(text, 'long.txt');
  assert.equal(chapters.length, 300);
  assert.equal(chapters[0].title, '第1章 标题1');
  assert.equal(chapters[0].text, '本章正文1');
  assert.equal(chapters[198].title, '第199章 标题199');
  assert.equal(chapters[198].text, '本章正文199');
  assert.equal(chapters[299].title, '第300章 标题300');
  assert.equal(chapters[299].text, '本章正文300');
});

test('章节识别支持中文数字、英文章节和序章，不把标题行重复写入正文', () => {
  const api = importApi();
  const chapters = api.splitImportedChapters('序章\n\n引子正文\n\n第一章：初见\n\n中文正文\n\nChapter IV - Return\n\nEnglish body', 'book.md');
  assert.deepEqual([...chapters].map(item => item.title), ['序章', '第一章：初见', 'Chapter IV - Return']);
  assert.deepEqual([...chapters].map(item => item.text), ['引子正文', '中文正文', 'English body']);
});

test('拆书服务端按章节号整理多文件，并保留卷序', () => {
  const result = server.normalizeDissectionInput({ files: [
    { name: '第2卷/第一章.txt', text: '第一章\n第二卷正文' },
    { name: '第1卷/第十章.txt', text: '第十章\n第一卷正文' },
    { name: '第1卷/第二章.txt', text: '第二章\n第一卷前段' }
  ] });
  assert.deepEqual(result.sourceFiles.map(item => item.name), [
    '第1卷/第二章.txt',
    '第1卷/第十章.txt',
    '第2卷/第一章.txt'
  ]);
});
