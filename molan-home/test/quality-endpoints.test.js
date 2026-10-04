'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { evaluateStoryQuality } = require('../lib/quality/story-quality');
const { analyzeHumanTexture } = require('../lib/style/human-texture');

test('P2 Quality & UI - Quality APIs story-check and texture-check perform correctly', () => {
  // 1. 测试 story-check 业务逻辑
  const chapters = [
    { chapterNo: 1, characters: ['楚狂人', '苏青'], debts: [{ id: 'd1', keyword: '宗门试炼契约', plantedAt: 1, status: 'open' }], text: '第一章相遇。' },
    { chapterNo: 2, characters: ['楚狂人', '苏青'], text: '第二章独行。' },
    { chapterNo: 3, characters: ['楚狂人'], text: '第三章遇敌。' },
    { chapterNo: 4, characters: ['楚狂人'], text: '第四章险胜。' },
    { chapterNo: 5, characters: ['楚狂人'], text: '第五章突破。' },
    { chapterNo: 6, characters: ['楚狂人'], text: '第六章秘境探秘。' },
    { chapterNo: 7, characters: ['楚狂人'], text: '第七章战果斐然。' }
  ];

  const storyReport = evaluateStoryQuality(chapters);
  assert.equal(storyReport.checkpoint, 5);
  assert.equal(storyReport.chapterCount, 7);
  assert.ok(storyReport.characterArc.ghostCharacters.some(c => c.name === '苏青'));
  assert.ok(storyReport.causalDebtLifecycle.staleCount >= 1);

  // 2. 测试 texture-check 业务逻辑
  const text = '他嘴角勾起一抹玩味的弧度，深吸了一口气。空气仿佛在此刻凝固了。周围旁观者倒吸了一口凉气。';
  const textureResult = analyzeHumanTexture(text);
  assert.ok(textureResult.cliches.length >= 2);
  assert.ok(textureResult.replacementWindows.length >= 2);
  assert.equal(textureResult.passed, false);
});

test('P2 Design System - CSS files reference tokens.css as Single Source of Truth', () => {
  const pagesDir = path.resolve(__dirname, '..', 'pages');

  // 1. 验证 tokens.css 存在且定义了核心调色板
  const tokensContent = fs.readFileSync(path.join(pagesDir, 'tokens.css'), 'utf8');
  assert.ok(tokensContent.includes('--ink:'));
  assert.ok(tokensContent.includes('--paper:'));
  assert.ok(tokensContent.includes('--canvas:'));
  assert.ok(tokensContent.includes('--line:'));
  assert.ok(tokensContent.includes('--green:'));
  assert.ok(tokensContent.includes('--amber:'));
  assert.ok(tokensContent.includes('--danger:'));

  // 2. 验证 novels.css 使用 CSS 变量绑定单一真源
  const novelsContent = fs.readFileSync(path.join(pagesDir, 'novels.css'), 'utf8');
  assert.ok(novelsContent.includes('--novel-bg: var(--canvas'));
  assert.ok(novelsContent.includes('--novel-paper: var(--paper'));
  assert.ok(novelsContent.includes('--novel-ink: var(--ink'));
  assert.ok(novelsContent.includes('--novel-muted: var(--muted'));

  // 3. 验证 skills.css 使用 CSS 变量绑定单一真源
  const skillsContent = fs.readFileSync(path.join(pagesDir, 'skills.css'), 'utf8');
  assert.ok(skillsContent.includes('--skill-bg: var(--canvas'));
  assert.ok(skillsContent.includes('--skill-paper: var(--paper'));
  assert.ok(skillsContent.includes('--skill-ink: var(--ink'));
  assert.ok(skillsContent.includes('--skill-green: var(--green'));

  // 4. 验证 dissect.css 使用 CSS 变量绑定单一真源
  const dissectContent = fs.readFileSync(path.join(pagesDir, 'dissect.css'), 'utf8');
  assert.ok(dissectContent.includes('--d-ink: var(--ink'));
  assert.ok(dissectContent.includes('--d-soft: var(--canvas'));
  assert.ok(dissectContent.includes('--d-line: var(--line'));

  // 5. 验证 shell.css 存在且遵循 tokens 设计系统
  const shellContent = fs.readFileSync(path.join(pagesDir, 'shell.css'), 'utf8');
  assert.ok(shellContent.includes('.molan-shell'));
  assert.ok(shellContent.includes('.molan-topbar'));
  assert.ok(shellContent.includes('var(--z-sticky'));
});
