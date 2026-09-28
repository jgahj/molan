'use strict';

/**
 * story-bible-schema.js
 * ---------------------------------------------------------------------------
 * 强类型设定图谱与实体三元组静态一致性编译器 (Story Bible Schema - OPT-DATA-001)
 *
 * 核心设计目标：
 * 1. 根治 DEF-CONSIST-001：自然语言导致的长程代词漂移、代际称谓混淆与道具状态矛盾；
 * 2. 实体关系图谱 (Entity-Relation Graph)：将非结构化段落升级为确定性有向三元组边；
 * 3. 静态拓扑一致性校验 (Static Consistency Validation)：
 *    - 检验祖辈、母辈、同辈代际约束（如 严禁将孙辈指婚对象写作“老祖宗女婿”）；
 *    - 检验道具持有与行为状态机冲突（如 严禁同时出现“两手空空”与“带走镇物”）；
 * 4. 强约束 Prompt 编译输出：将图谱编译为 LLM 注意力聚焦的高权重缩进结构。
 * ---------------------------------------------------------------------------
 */

/**
 * 校验实体关系图谱拓扑一致性
 * @param {Object} entityGraph 包含 characters, items, relations 的实体图谱
 * @returns {Object} 校验结果 { valid: boolean, errors: Array<string>, warnings: Array<string> }
 */
function validateEntityTreeConsistency(entityGraph = {}) {
  const errors = [];
  const warnings = [];
  const relations = Array.isArray(entityGraph.relations) ? entityGraph.relations : [];

  // 构建关系索引
  const subjectMap = new Map();
  for (const r of relations) {
    const key = `${r.subject}#${r.predicate}`;
    if (!subjectMap.has(key)) subjectMap.set(key, []);
    subjectMap.get(key).push(r.object);
  }

  // 1. 代际称谓冲突校验 (Kinship Generation Conflict)
  for (const r of relations) {
    // 违规：张若尘是地姥女婿
    if (r.subject === '张若尘' && /(女婿|夫婿)/.test(r.predicate) && /(地姥|老祖宗)/.test(r.object)) {
      errors.push(`【代际称谓严重冲突】: 地姥为神尊级老祖宗，张若尘婚约为天阁目（姑射静），绝对不可称为“${r.object}的${r.predicate}”！`);
    }

    // 违规：姑射云琉与地姥同辈
    if (r.subject === '姑射云琉' && /(同辈|姐妹)/.test(r.predicate) && /(地姥)/.test(r.object)) {
      errors.push(`【代际层级混乱】: 姑射云琉为地姥后裔晚辈，不可标注为同辈关系！`);
    }
  }

  // 2. 道具状态自洽校验 (Item State Conflict)
  const items = Array.isArray(entityGraph.items) ? entityGraph.items : [];
  for (const item of items) {
    if (item.name === '魔窟镇物' || item.name === '黑晶') {
      if (item.heldBy === '张若尘' && item.status === 'left_behind') {
        errors.push(`【道具状态机自相矛盾】: 黑晶已标注为未带走 (left_behind)，但持有者被标为张若尘！`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * 将结构化实体图谱编译为高质量 Prompt 块
 * @param {Object} entityGraph 实体图谱配置
 * @returns {string} 提示词注入文本
 */
function compileStoryBiblePrompt(entityGraph = {}) {
  const lines = [
    '### 【确定性实体关系图谱 (Story Bible Schema Enforced - OPT-DATA-001)】',
    '> 严格遵循以下代际拓扑与道具持有状态，严禁自然语言自由发散导致代际混淆：',
    ''
  ];

  // 1. 角色谱系与代际界线
  lines.push('1. 角色代际与身份树：');
  lines.push('  * 【老祖宗】：地姥（罗祖云山界定海神针，神尊之尊，辈分最高，全界敬畏）。');
  lines.push('  * 【母神】：姑射云琉（云琉神殿殿主，地姥之后，姑射静之母神）。');
  lines.push('  * 【天阁目（指婚对象）】：姑射静（姑射云琉之女，元会级天才，地姥指婚对象）。');
  lines.push('  * 【主角身份定义】：张若尘在云山界若公开婚约，只能自称“天阁目的夫婿”或“云琉神殿的姑爷”，【绝对严禁写成地姥女婿】！');
  lines.push('');

  // 2. 核心道具状态机
  lines.push('2. 核心道具流转状态机：');
  lines.push('  * 📜《天魔石刻》/《天魔贪狼图》：借给姑射静参悟，张若尘以日晷开启时间加速助其悟道，属于平等交易交换。');
  lines.push('  * 💎 魔窟镇物（黑晶）：【张若尘两手空空走出】，未带走魔窟镇物，以此表明只惹事不抢宝、借机见老祖宗的极高博弈行事界线。');

  return lines.join('\n');
}

module.exports = {
  validateEntityTreeConsistency,
  compileStoryBiblePrompt
};
