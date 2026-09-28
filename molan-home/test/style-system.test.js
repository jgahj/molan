'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const styleSystem = require('../lib/style-system');

function createTestDatabase() {
  const db = new DatabaseSync(':memory:');
  styleSystem.initializeSchema(db);
  return db;
}

test('五层文风档案与版本化管理（正向标杆样本与反向样本）', () => {
  const db = createTestDatabase();
  const bookId = 'book-001';

  // 1. 创建作品叙述风格档案 (novel_narrative)
  const profileRes = styleSystem.upsertStyleProfile(db, {
    bookId,
    name: '东方古典玄幻-沉稳凌厉风',
    level: 'novel_narrative',
    hardRules: ['第三人称全知受限', '严禁机械说教', '动作白描为主'],
    softPreferences: { pace: 'fast', rhetoricDensity: 'medium' },
    positiveSamples: ['剑起青锋，风雪初歇。他未多言，提剑直入寒夜。'],
    negativeSamples: ['恐怖如斯的威压宛如泰山压顶，这一刻天地为之变色。']
  });

  assert.equal(profileRes.ok, true);
  assert.equal(profileRes.revision, 1);

  // 2. 版本升级
  const updatedRes = styleSystem.upsertStyleProfile(db, {
    id: profileRes.id,
    bookId,
    name: '东方古典玄幻-沉稳凌厉风-修订版',
    level: 'novel_narrative',
    hardRules: ['第三人称全知受限', '严禁机械说教', '动作白描为主', '强化环境压迫感']
  });

  assert.equal(updatedRes.ok, true);
  assert.equal(updatedRes.revision, 2);

  // 3. 查询档案及最新版本规则
  const profiles = styleSystem.getStyleProfiles(db, bookId);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].name, '东方古典玄幻-沉稳凌厉风-修订版');
  assert.equal(profiles[0].revision, 2);
  assert.ok(profiles[0].hardRules.includes('强化环境压迫感'));
});

test('分层编译合成文风约束集（作品级规则与角色口吻隔离）', () => {
  const profiles = [
    {
      level: 'novel_narrative',
      hardRules: ['第三人称全知受限', '拒绝无病呻吟比喻'],
      softPreferences: { pace: 'steady' },
      positiveSamples: ['风停，剑止。']
    },
    {
      level: 'scene_mode',
      targetSceneType: 'battle',
      hardRules: ['战斗场景短句推进', '禁用过长心理剖析'],
      softPreferences: { pace: 'rapid' }
    },
    {
      level: 'character_voice',
      targetEntityId: 'char_cold_swordsman',
      name: '冷孤绝',
      hardRules: ['冷酷寡言', '每句话不超过十个字'],
      softPreferences: { tone: 'cold' }
    }
  ];

  const compiled = styleSystem.compileStyleBundle(profiles, {
    sceneType: 'battle',
    castIds: ['char_cold_swordsman']
  });

  assert.ok(compiled.hardRules.includes('第三人称全知受限'));
  assert.ok(compiled.hardRules.includes('战斗场景短句推进'));
  assert.equal(compiled.voiceConstraints['char_cold_swordsman'].name, '冷孤绝');
  assert.ok(compiled.voiceConstraints['char_cold_swordsman'].rules.includes('冷酷寡言'));
});

test('确定性与语义文风审查（超长单句、禁用套话、人称漂移、串音与机械升华）', () => {
  const badText = `冷孤绝冷冷看着对手，突然“哈哈，老兄你这剑法也太逗了吧呀！”
他心知肚明，我这一剑刺出必定要让他好看。这一刻，恐怖如斯的气息宛如狂风暴雨席卷了整座山巅，让所有人震撼不已！
正如古人所言，人生的真谛唯有在死斗中方能彰显。`;

  const auditResult = styleSystem.auditTextStyle(badText, {
    deterministicRules: {
      enforcePerson: 'third',
      forbiddenTerms: ['恐怖如斯', '宛如', '这一刻']
    },
    semanticContext: {
      voiceConstraints: {
        char_cold_swordsman: {
          name: '冷孤绝',
          rules: ['冷酷寡言']
        }
      }
    }
  });

  assert.equal(auditResult.passed, false, '违规文风文本应被判定不通过');
  assert.ok(auditResult.score < 80);

  // 1. 检查作品级缺陷：命中禁用套话和人称漂移
  assert.ok(auditResult.reports.novelLevel.some(f => f.type === 'FORBIDDEN_TERM_HIT'));
  assert.ok(auditResult.reports.novelLevel.some(f => f.type === 'POV_PERSON_DRIFT'));

  // 2. 检查角色级缺陷：冷酷角色卖萌串音
  assert.ok(auditResult.reports.characterLevel.some(f => f.type === 'CHARACTER_VOICE_OUT_OF_CHARACTER'));

  // 3. 检查场景级缺陷：机械升华与过度说教
  assert.ok(auditResult.reports.sceneLevel.some(f => f.type === 'OVER_EXPLANATION_MECHANICAL_ELEVATION'));
});

test('合规文风正文顺利通过审查', () => {
  const goodText = `风雪骤紧。
冷孤绝按住剑柄，目光掠过长街。三名黑衣人自檐下阴影中步出，刀刃贴着腕骨低垂，未发一语。
“留步。”领头人声音干涩。
冷孤绝未答，脚步未滞。三尺剑锋递出半寸，霜华映雪，已断杀路。`;

  const auditResult = styleSystem.auditTextStyle(goodText, {
    deterministicRules: {
      enforcePerson: 'third',
      forbiddenTerms: ['恐怖如斯', '宛如']
    },
    semanticContext: {
      voiceConstraints: {
        char_cold_swordsman: {
          name: '冷孤绝',
          rules: ['冷酷寡言']
        }
      }
    }
  });

  assert.equal(auditResult.passed, true, '高张力凝练正文应通过审查');
  assert.ok(auditResult.score >= 90);
});
