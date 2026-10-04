'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GENRE_FAMILIES,
  CHAPTER_FOCUS_MODES,
  ARCHETYPES_CATALOG,
  getArchetypesByFamily,
  getArchetype,
  compileFocusDirective
} = require('../lib/generation/corpus-archetypes');

test('corpus-archetypes exports all 10 genre families and valid archetypes', () => {
  const families = Object.keys(GENRE_FAMILIES);
  assert.equal(families.length, 10);
  assert.ok(families.includes('xuanhuan_xianxia'));
  assert.ok(families.includes('urban_martial'));
  assert.ok(families.includes('scifi_apocalypse'));
  assert.ok(families.includes('suspense_mystery'));

  const xuanhuanArchetypes = getArchetypesByFamily('xuanhuan_xianxia');
  assert.ok(xuanhuanArchetypes.length >= 3);
  assert.ok(xuanhuanArchetypes.some(a => a.id === 'yandere_harem_cultivation'));
  assert.ok(xuanhuanArchetypes.some(a => a.id === 'classical_gritty_xianxia'));
});

test('chapter focus modes contain dialogue, action, environment, psychological, etc.', () => {
  const modes = Object.keys(CHAPTER_FOCUS_MODES);
  assert.ok(modes.includes('dialogue'));
  assert.ok(modes.includes('action'));
  assert.ok(modes.includes('environment'));
  assert.ok(modes.includes('psychological'));
  assert.ok(modes.includes('suspense'));
  assert.ok(modes.includes('emotional'));
  assert.ok(modes.includes('farming'));

  const dialogueDirective = compileFocusDirective('dialogue');
  assert.ok(dialogueDirective.includes('对话博弈'));
  assert.ok(dialogueDirective.includes('动作-对白交错律'));

  const actionDirective = compileFocusDirective('action');
  assert.ok(actionDirective.includes('动作战斗'));
  assert.ok(actionDirective.includes('物理受力'));
});

test('archetype retrieval returns genuine prompt guidelines', () => {
  const archetype = getArchetype('street_calculating');
  assert.ok(archetype);
  assert.ok(archetype.prompt.includes('港风市井低武'));
  assert.ok(archetype.prompt.includes('月费'));
});
