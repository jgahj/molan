'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const editorSource = fs.readFileSync(path.join(__dirname, '..', 'completion-editor.js'), 'utf8');

test('completion-editor.js defines GENRE_FAMILY_MAP with 8 families', () => {
  assert.match(editorSource, /const GENRE_FAMILY_MAP\s*=\s*\{/);
  for (const family of ['xuanhuan', 'urban_martial', 'scifi_apocalypse', 'suspense', 'history', 'western_fantasy', 'ancient_romance', 'modern_romance']) {
    assert.match(editorSource, new RegExp(`${family}:\\s*\\{`));
  }
});

test('completion-editor.js exposes buildGenreFamilyOptions and cascading buildGenreRouteOptions', () => {
  // Run isolated evaluation of the top declarations
  const endIdx = editorSource.indexOf('(function () {');
  assert.ok(endIdx > 0, 'Top level declarations exist before IIFE');
  const topCode = editorSource.slice(0, endIdx);
  const context = {};
  vm.createContext(context);
  vm.runInContext(topCode, context);

  assert.equal(typeof context.buildGenreFamilyOptions, 'function');
  assert.equal(typeof context.buildGenreRouteOptions, 'function');

  // Test buildGenreFamilyOptions default
  const familyHtml = context.buildGenreFamilyOptions({});
  assert.match(familyHtml, /value="all"[^>]*selected/);
  assert.match(familyHtml, /value="xuanhuan"/);
  assert.match(familyHtml, /value="scifi_apocalypse"/);

  // Test buildGenreRouteOptions with family = 'scifi_apocalypse'
  const scifiHtml = context.buildGenreRouteOptions({}, 'scifi_apocalypse');
  assert.match(scifiHtml, /《这游戏也太真实了》/);
  assert.match(scifiHtml, /《黎明之剑》/);
  assert.match(scifiHtml, /《吞噬星空》/);
  assert.doesNotMatch(scifiHtml, /《元始法则》/);
  assert.doesNotMatch(scifiHtml, /《以神通之名》/);

  // Test buildGenreRouteOptions with family = 'all'
  const allHtml = context.buildGenreRouteOptions({}, 'all');
  assert.match(allHtml, /<optgroup label="玄幻修真">/);
  assert.match(allHtml, /<optgroup label="科幻末世">/);
  assert.match(allHtml, /《元始法则》/);
  assert.match(allHtml, /《这游戏也太真实了》/);
});

test('renderEditorPage renders both data-completion-genre-family and data-completion-xuanhuan-route', () => {
  assert.match(editorSource, /data-completion-genre-family/);
  assert.match(editorSource, /data-completion-xuanhuan-route/);
  assert.match(editorSource, /data-completion-family-field/);
  assert.match(editorSource, /\$\{genreFamilySelect\}\$\{xuanhuanRouteSelect\}/);
});

test('event listener cascades genreFamily change to narrative engine options', () => {
  assert.match(editorSource, /event\.target\.closest\('\[data-completion-genre-family\]'\)/);
  assert.match(editorSource, /buildGenreRouteOptions\(state,\s*genreFamily\.value\)/);
  assert.match(editorSource, /toast\('已切换小说类型：'/);
});
