'use strict';

/**
 * character-state-adapter.js
 * ---------------------------------------------------------------------------
 * 人物状态机与人味质感注入适配器 (Character & Emotion State Adapter)
 *
 * 核心设计目标：
 * 1. 根治 DEF-CHAR-001：主角心理层次单一高智问题。彻底告别“绝对冷酷理智谋略家”
 *    的机器工具人倾向，赋予角色真实的人性微弱点与生理应激反应；
 * 2. 激活并打通项目中已有的 character-material-context.cjs 基础设施（包含
 *    16 种情绪状态白名单与 38 种人味质感信号）；
 * 3. 动态编译为具有强执行力的人物言行指导指令，注入到 Writer Prompt 中。
 * ---------------------------------------------------------------------------
 */

const path = require('node:path');
const {
  EMOTIONAL_STATE_WHITELIST,
  HUMAN_TEXTURE_SIGNAL_WHITELIST
} = require('./character-material-context.cjs');

// 人性微弱点与生动质感模板映射库
const HUMAN_TEXTURE_TEMPLATES = Object.freeze({
  hesitation: '在决断前有半秒极其隐蔽的指尖微顿或视线轻垂，体现对未知杀局的真实敬畏与衡量，非无脑莽撞。',
  self_correction: '偶有自嘲心理（如自知在拿命赌刀尖、装腔作势实属无奈），打破全知全能的冰冷感。',
  somatic_stress: '遭遇神灵威压或死局压迫后，有真实的生理应激反应（如后背微凉、呼吸调息平复心跳、喉头微紧）。',
  save_face: '在熟人（如木灵希）或对手面前嘴硬以维系气场，但私下心知肚明，体现青年修者的真实性格反差。',
  delayed_reaction: '听到重大变故（如被指婚）时有短暂的思维空白或错愕怔忡，而非瞬间面不改色给出最优解。'
});

/**
 * 为指定角色构建场景级情绪状态与人味微弱点契约
 * @param {string} characterName 角色名称 (如 "张若尘")
 * @param {string} roleDescription 角色身份与定位
 * @param {Object} sceneContext 场景语境 (包含题材、危险等级、对手)
 * @returns {Object} 结构化角色动态心智契约
 */
function buildCharacterStateContract(characterName, roleDescription = '', sceneContext = {}) {
  const isProtagonist = /(张若尘|主角)/.test(characterName);
  const isHighStakes = sceneContext.dangerLevel === 'high' || /(神灵|神尊|神威|死战|绝境)/.test(JSON.stringify(sceneContext));

  // 1. 动态情绪状态分配 (从 16 种白名单中挑选)
  const emotionalStates = [];
  if (isProtagonist) {
    emotionalStates.push('防备', '嘴硬');
    if (isHighStakes) emotionalStates.push('担忧', '心虚');
  } else {
    emotionalStates.push('怀疑', '试探');
  }

  // 2. 人味微弱点信号绑定 (从 38 种人味信号中提取关键动作)
  const textureSignals = [];
  const appliedGuidelines = [];

  if (isProtagonist) {
    textureSignals.push('hesitation', 'self_correction', 'somatic_stress', 'save_face');
    appliedGuidelines.push(HUMAN_TEXTURE_TEMPLATES.somatic_stress);
    appliedGuidelines.push(HUMAN_TEXTURE_TEMPLATES.self_correction);
    appliedGuidelines.push(HUMAN_TEXTURE_TEMPLATES.save_face);
  } else {
    textureSignals.push('delayed_reaction', 'hesitation');
    appliedGuidelines.push(HUMAN_TEXTURE_TEMPLATES.delayed_reaction);
  }

  const promptDirective = isProtagonist
    ? `【${characterName} 人设立体度与人性弱点契约 (DEF-CHAR-001)】：
- 心理多维性：${characterName} 虽机变绝伦，但面对神灵威压与未知死局，【严禁写成绝对冰冷、不会犯错的算计机器】！
- 生理应激细节：神威退去或独处时，必须流露细微的生理应激（如背脊沁出冷汗、握住道具的手指轻微紧绷调息）。
- 幽默自嘲与嘴硬：在对白与心理活动中，适度展现“嘴上强硬从容、心里暗捏一把汗”的青年人性反差，具备真实的求生压力与自嘲。`
    : `【${characterName} 交互契约】：交谈中包含怀疑试探与真实的情绪波澜，拒绝千篇一律的工具人顺从。`;

  return {
    characterName,
    isProtagonist,
    emotionalStates,
    textureSignals,
    appliedGuidelines,
    promptDirective
  };
}

/**
 * 遍历主要角色集合，编译出可直接注入 Writer Prompt 的人物多维性指令块
 * @param {Array<Object>} characters 角色列表 [{ name, role }]
 * @param {Object} sceneContext 场景语境
 * @returns {string} 提示词注入文本
 */
function compileCharacterStateDirectives(characters = [], sceneContext = {}) {
  const chars = Array.isArray(characters) && characters.length > 0
    ? characters
    : [{ name: '张若尘', role: '主角' }];

  const lines = [
    '### 【人物动态心智与人性弱点契约 (Character State Machine Enforced)】',
    '> 针对 DEF-CHAR-001 缺陷的系统性防范：打破纯高智机器脸谱，赋予角色真实生理应激与生动反差。',
    ''
  ];

  for (const c of chars) {
    const name = typeof c === 'string' ? c : c.name;
    const role = typeof c === 'string' ? '' : (c.role || '');
    const contract = buildCharacterStateContract(name, role, sceneContext);
    lines.push(contract.promptDirective);
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * 获取角色在特定紧张局势下的动态心智情态锚点 (OPT-CHAR-001)
 * @param {string} characterId 角色名称/标识
 * @param {string|number} tensionLevel 紧张程度 ('LOW' | 'MEDIUM' | 'HIGH' 或数字 1~10)
 * @param {Object} sceneContext 场景语境
 * @returns {Object} 动态情态锚点规格
 */
function getDynamicCharacterContext(characterId = '张若尘', tensionLevel = 'MEDIUM', sceneContext = {}) {
  const isHighTension = tensionLevel === 'HIGH' || tensionLevel >= 7 || sceneContext.dangerLevel === 'high';
  const isProtagonist = /(张若尘|主角)/.test(characterId);

  const physicalReaction = isHighTension
    ? (isProtagonist ? '肌肉骤紧，手心微汗，后背微凉，暗中调息平复剧烈心跳' : '呼吸骤停，神色骇然，脚步下意识后撤半步')
    : (isProtagonist ? '神色悠闲自得，指尖轻扣桌面，目光内敛' : '眼神飘忽，试探性打量');

  const psychologicalVulnerability = isHighTension
    ? (isProtagonist ? '暗自骂了一句疯子，深知自己在刀尖跳舞，强行撑住面子' : '心惊肉跳，唯恐惹火烧身')
    : (isProtagonist ? '表面沉稳带痞气，内心实则在自嘲装腔作势实属无奈' : '暗自盘算得失');

  const emotionalStates = isHighTension ? ['防备', '心虚', '担忧'] : ['防备', '嘴硬'];
  const textureSignals = isHighTension
    ? ['somatic_stress', 'save_face', 'hesitation', 'self_correction']
    : ['self_correction', 'save_face'];

  const promptSnippet = [
    `【${characterId} 场景情态微反应约束 (OPT-CHAR-001)】:`,
    `- 生理反应：${physicalReaction}；`,
    `- 心理漏洞：${psychologicalVulnerability}；`,
    `- 行为质感要求：决断前允许半秒极其隐蔽的指尖微顿或视线轻垂，体现真实敬畏与衡量，严禁写成全知全能的冰冷机器。`
  ].join('\n');

  return {
    characterId,
    tensionLevel: isHighTension ? 'HIGH' : 'MEDIUM',
    isProtagonist,
    emotionalStates,
    textureSignals,
    physicalReaction,
    psychologicalVulnerability,
    promptSnippet
  };
}

module.exports = {
  HUMAN_TEXTURE_TEMPLATES,
  buildCharacterStateContract,
  compileCharacterStateDirectives,
  getDynamicCharacterContext
};

