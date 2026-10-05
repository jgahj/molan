'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createStrategyIR, STRATEGY_IR_SCHEMA_VERSION } = require('../lib/composition/ir/strategy-ir-schema');
const { lowerToPrompt } = require('../lib/composition/ir/ir-lowering');
const { compileToStrategyIR, compileChapterStrategy } = require('../lib/composition/compiler/strategy-compiler');
const { defaultProfileRegistry } = require('../lib/composition/profiles/profile-registry');

test('Strategy IR: 权威中间表示创建、不可变性与 SHA-256 确定性指纹', () => {
  const baseInput = {
    metadata: {
      generationId: 'gen_001',
      runId: 'run_abc',
      chapterId: 'ch_15',
      targetModelFamily: 'claude-3-5-sonnet'
    },
    hardConstraints: {
      targetWordRange: { min: 2500, max: 3500, target: 3000 },
      narrativePov: '第三人称限制视角',
      viewpointCharacter: '林凡',
      forbiddenKnowledge: ['宗主真实身份', '后山禁地阵图'],
      continuityInvariants: ['林凡左肩受轻伤']
    },
    bookIdentity: {
      worldRuleSummary: '灵石不可直接吸收，需经炼化鼎淬洗',
      genre: { name: '传统玄幻' },
      storyEngine: { name: '宗门逆袭与复仇' },
      readerPromises: ['凡人以智谋破死局']
    },
    chapterOutcomeContract: {
      objectiveName: '揭露暗桩',
      stateDelta: {
        stateBefore: '怀疑暗桩在戒律堂',
        events: ['夜探藏经阁', '发现暗通魔教的私印'],
        stateAfter: '坐实暗桩身份为戒律堂大弟子',
        invalidIfRemoved: '后续主角被戒律堂陷害缺乏铺垫'
      },
      readerEffect: {
        knowledgeDelta: '确认戒律堂与魔教勾结',
        emotionalShift: '愤怒与戒备'
      },
      characterEffect: {
        beliefShift: '彻底放弃对戒律长老的幻想',
        motivationDelta: '由被动提防转为主动作局反击'
      }
    },
    stylePolicy: {
      name: '老白克制',
      narrativeDistance: 'close_limited',
      positiveRules: ['多白描动作', '少用感叹号'],
      negativeRules: ['严禁心声独白滥用']
    },
    focusPolicy: {
      name: '悬疑调查',
      priorityTiers: {
        dominant: ['conflict', 'dialogue'],
        supporting: ['action', 'character'],
        optional: ['setting'],
        forbidden: ['emotion']
      }
    },
    hookPolicy: {
      name: '危机钩',
      debtTracking: {
        debtsToAddress: ['debt_01_old_secret'],
        debtsToCreate: ['debt_02_new_clue']
      }
    },
    abstractEvidenceCards: [
      {
        id: 'rule_reveal_twist',
        ruleStatement: '在证据即将揭开时引入外部杂音干扰',
        abstractPattern: '线索锁定 -> 外部异响 -> 匆忙收束',
        microExample: '方欲印证私印，忽闻窗外枯枝折断声',
        failureMode: '无视异响强行长篇推理解说',
        evidenceStrength: 'A'
      }
    ]
  };

  const ir1 = createStrategyIR(baseInput);
  const ir2 = createStrategyIR(baseInput);

  assert.equal(ir1.schemaVersion, STRATEGY_IR_SCHEMA_VERSION);
  assert.equal(Object.isFrozen(ir1), true);
  assert.equal(Object.isFrozen(ir1.hardConstraints), true);
  assert.equal(Object.isFrozen(ir1.chapterOutcomeContract), true);
  assert.equal(Object.isFrozen(ir1.stylePolicy), true);

  // 1. 确定性指纹检验
  assert.equal(typeof ir1.irDigest, 'string');
  assert.equal(ir1.irDigest.length, 64);
  assert.equal(ir1.irDigest, ir2.irDigest, '相同输入必定产出相同 irDigest');

  // 2. 字段敏感性：微小改动必须导致 digest 变化
  const modifiedInput = {
    ...baseInput,
    hardConstraints: {
      ...baseInput.hardConstraints,
      viewpointCharacter: '陆沉'
    }
  };
  const ir3 = createStrategyIR(modifiedInput);
  assert.notEqual(ir1.irDigest, ir3.irDigest, '视点人物变动必须触发 digest 改变');
});

test('Strategy IR: lowerToPrompt 降级渲染为 P0~P8 优先级梯队与 System/User 提示词', () => {
  const ir = createStrategyIR({
    hardConstraints: {
      targetWordRange: { min: 2400, max: 3200, target: 2800 },
      narrativePov: '第三人称限制视角',
      viewpointCharacter: '李巡',
      forbiddenKnowledge: ['幕后黑手为国师']
    },
    bookIdentity: {
      worldRuleSummary: '王朝律法压制修士神通',
      genre: { name: '悬疑高武' }
    },
    chapterOutcomeContract: {
      objectiveName: '勘破密信',
      stateDelta: {
        stateBefore: '无头死案',
        events: ['查验焦黑残纸', '推导火油出处'],
        stateAfter: '锁定漕帮'
      },
      readerEffect: {
        knowledgeDelta: '获知漕帮涉案'
      },
      characterEffect: {
        beliefShift: '认清朝廷内部亦不可信'
      }
    },
    stylePolicy: {
      name: '冷峻硬朗',
      narrativeDistance: 'medium'
    },
    focusPolicy: {
      name: '刑侦破案',
      priorityTiers: {
        dominant: ['conflict', 'dialogue'],
        supporting: ['action'],
        optional: ['setting'],
        forbidden: []
      }
    },
    hookPolicy: {
      name: '悬念钩'
    },
    abstractEvidenceCards: [
      {
        id: 'rule_footstep_suspense',
        ruleStatement: '借环境异物反衬心理压迫',
        abstractPattern: '物像聚焦 -> 动静反差',
        microExample: '水滴落入铜盆之声清脆异常',
        evidenceStrength: 'A'
      }
    ]
  });

  const lowered = lowerToPrompt(ir, {
    userInstruction: '重点写出漕帮信物的暗记细节',
    chapterContext: '前文回顾：李巡潜入停尸房。'
  });

  // 1. 结构完整性校验
  assert.ok(lowered.systemPrompt);
  assert.ok(lowered.userPrompt);
  assert.ok(lowered.priorityCascade);
  assert.equal(lowered.wordBudget.targetChars, 2800);
  assert.equal(lowered.wordBudget.minChars, 2400);

  const cascade = lowered.priorityCascade;

  // 2. P0 物理围栏
  assert.ok(cascade.P0_HARD_CONSTRAINTS.includes('基准 2800 字'));
  assert.ok(cascade.P0_HARD_CONSTRAINTS.includes('第三人称限制视角'));
  assert.ok(cascade.P0_HARD_CONSTRAINTS.includes('核心视点人物为【李巡】'));
  assert.ok(cascade.P0_HARD_CONSTRAINTS.includes('幕后黑手为国师'));

  // 3. P1 用户指令
  assert.ok(cascade.P1_USER_DIRECTIVE.includes('重点写出漕帮信物的暗记细节'));

  // 4. P2 创作圣经
  assert.ok(cascade.P2_CREATION_BIBLE.includes('王朝律法压制修士神通'));

  // 5. P3 结果契约
  assert.ok(cascade.P3_OUTCOME_CONTRACT.includes('【本章核心目标·勘破密信】'));
  assert.ok(cascade.P3_OUTCOME_CONTRACT.includes('章前状态：无头死案'));
  assert.ok(cascade.P3_OUTCOME_CONTRACT.includes('章后状态：锁定漕帮'));
  assert.ok(cascade.P3_OUTCOME_CONTRACT.includes('认清朝廷内部亦不可信'));

  // 6. P5 软预算
  assert.ok(cascade.P5_FOCUS_BUDGET.includes('【镜头资源软预算准则】'));
  assert.ok(cascade.P5_FOCUS_BUDGET.includes('重点倾斜 (Dominant)'));

  // 7. P7 抽象证据卡（严防原句直出）
  assert.ok(cascade.P7_EVIDENCE_CARDS.includes('工业创作策略规则库'));
  assert.ok(cascade.P7_EVIDENCE_CARDS.includes('借环境异物反衬心理压迫'));
  assert.ok(cascade.P7_EVIDENCE_CARDS.includes('物像聚焦 -> 动静反差'));
  assert.ok(cascade.P7_EVIDENCE_CARDS.includes('水滴落入铜盆之声清脆异常'));
  assert.ok(cascade.P7_EVIDENCE_CARDS.includes('【执行纪律】：上述规则卡为创作技巧与结构模式引导，严禁整段抄袭或直出示例原句！'));

  // 8. P8 反套路反重复护栏
  assert.ok(cascade.P8_NEGATIVE_GUARDS.includes('严禁“嘴角勾起一抹弧度”'));
});

test('Strategy IR: StrategyCompiler 纯 StrategyIR 编译与端到端组合', () => {
  const spec = defaultProfileRegistry.resolveCompositionSpec({
    genre: 'xuanhuan_cautious',
    style: 'laobai_restrained',
    chapterGoal: 'info_reveal',
    focus: 'combat',
    hook: 'suspense_clue'
  });

  // 1. 验证可直接编译为 StrategyIR
  const strategyIR = compileToStrategyIR({
    spec,
    bible: { worldRules: '天道不全，金丹有缺' },
    chapterContract: {
      chapterId: 'ch_01',
      wordBudget: { targetChars: 3200 }
    }
  });

  assert.equal(strategyIR.schemaVersion, STRATEGY_IR_SCHEMA_VERSION);
  assert.equal(strategyIR.hardConstraints.targetWordRange.target, 3200);
  assert.equal(strategyIR.bookIdentity.genre.name, '凡人谨慎修真');
  assert.equal(typeof strategyIR.irDigest, 'string');

  // 2. 验证 compileChapterStrategy 无缝返回 strategyIR 与 digest
  const compiled = compileChapterStrategy({
    spec,
    bible: { worldRules: '天道不全，金丹有缺' },
    chapterContract: {
      chapterId: 'ch_01',
      wordBudget: { targetChars: 3200 }
    }
  });

  assert.ok(compiled.strategyIR);
  assert.equal(compiled.strategyIR.schemaVersion, STRATEGY_IR_SCHEMA_VERSION);
  assert.equal(compiled.digest, compiled.strategyIR.irDigest);
  assert.ok(compiled.priorityCascade.P0_HARD_CONSTRAINTS);
  assert.ok(compiled.systemPrompt.includes('【P0 绝对事实与物理围栏'));
});
