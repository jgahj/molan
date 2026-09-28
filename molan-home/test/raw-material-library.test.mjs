import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import material from '../lib/character-material.js';
import {
  buildRawMaterialLibrary,
  splitRawChapters,
} from '../scripts/build-raw-material-library.mjs';

function fixtureText() {
  const chapterBody = (prefix, sentence) => Array.from({ length: 230 }, (_, index) => `${prefix}${index}${sentence}`).join('\r\n');
  return [
    '小说名：原文测试\r\n作者：测试作者\r\n',
    '第1节 初见\r\n',
    `${chapterBody('第一段', '，他没有立刻回答，只把杯子往桌角推了推，视线在门口停了一下，才说自己知道了。')}\r\n`,
    '第2章 试探\r\n',
    `${chapterBody('第二段', '，她问得很轻，他却笑了一下，没有回答，只把外套搭在她肩上。')}\r\n`,
    '第3章 离开\r\n',
    `${chapterBody('第三段', '，他站在楼梯口，听见脚步声后回头，手指在栏杆上敲了两下，最后什么也没说。')}\r\n`,
  ].join('');
}

test('原文分章识别包含第×节并保留原始偏移', () => {
  const source = fixtureText();
  const chapters = splitRawChapters(source);
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].title, '第1节 初见');
  assert.equal(source.slice(chapters[0].bodyStart, chapters[0].end).includes('他没有立刻回答'), true);
});

test('素材库 Markdown 与运行索引只使用原文连续片段', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-raw-library-test-'));
  try {
    const archiveRoot = path.join(root, '小说原本');
    fs.mkdirSync(archiveRoot, { recursive: true });
    const sourcePath = path.join(archiveRoot, '原文测试 - 测试作者.txt');
    const sourceText = fixtureText();
    fs.writeFileSync(sourcePath, sourceText, 'utf8');
    const markdownPath = path.join(root, '素材库.md');
    const indexPath = path.join(root, 'index.json');
    const reportPath = path.join(root, 'report.json');
    const jsonlPath = path.join(root, 'samples.jsonl');
    const result = buildRawMaterialLibrary({
      archiveRoot,
      markdown: markdownPath,
      index: indexPath,
      report: reportPath,
      jsonl: jsonlPath,
      perWorkLimit: 12,
    });
    assert.equal(result.report.filesScanned, 1);
    assert.equal(result.report.admittedFiles, 1);
    assert.ok(result.rows.length > 0);
    const markdown = fs.readFileSync(markdownPath, 'utf8');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.equal(index.general.rules.length, 0);
    assert.equal(index.mature.rules.length, 0);
    for (const row of result.rows) {
      assert.equal(sourceText.slice(row.charStart, row.charEnd), row.rawText);
      assert.ok(markdown.includes(row.rawText));
    }
    assert.equal(index.general.samples.length + index.mature.samples.length, result.rows.length);
    assert.equal(index.audit.rawTextRuntime, true);
    assert.equal(index.audit.materialTextPolicy, 'raw-source-excerpts-no-distillation-no-anonymization');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('raw 模式只注入原文样本，不注入规则卡', () => {
  const sample = '她没有解释，只把手里的钥匙放回口袋，转身看向窗外。';
  const index = {
    version: 'raw-test',
    published: true,
    general: { rules: [], samples: [{ id: 'raw-1', dimension: 'action', text: sample, sourceWorkId: 'work-1', sourceHash: 'source-1', residualTerms: [], forbiddenTerms: [], score: 5 }] },
    mature: { rules: [], samples: [] },
    profiles: {},
    profilesPublished: false,
    audit: { strongSamplesPublished: true, rawTextRuntime: true },
  };
  const result = material.buildCharacterMaterialBlock(null, { mode: 'raw', query: '人物动作', proseTask: true }, { index });
  assert.equal(result.request.mode, 'raw');
  assert.deepEqual(result.samples.map(item => item.id), result.retrieval.samples.map(item => item.id));
  assert.equal(result.retrieval.rules.length, 0);
  assert.equal(result.retrieval.samples.length, 1);
  assert.equal(result.audit.rawSamplesInjected, true);
  assert.ok(result.messages[0].content.includes(sample));
});
