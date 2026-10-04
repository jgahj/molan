'use strict';

/**
 * prompt-enricher.js
 * ---------------------------------------------------------------------------
 * 提示词自适应增强与架构重构引擎 (Prompt Expander & Architect Engine)
 *
 * 核心目标：
 * 当用户传入的小说创作提示词过于简略或平庸（如“写主角和师尊在房间里拉扯”）时，
 * 自动提取已有大纲（Outline）、人物性格档案（Characters）、题材世界观（Worldview），
 * 调用 Gemini 3.8 模型（或确定性规则兜底），将其重构成具备【题材与基调】、【核心人物张力矩阵】、
 * 【三幕分镜微节拍】和【语言文风硬约束】的标准高阶结构化提示词，再送入正文写作模型。
 * ---------------------------------------------------------------------------
 */

const { sanitizeInPlace } = require('./inplace-sanitizer');

/**
 * 判断用户提示词是否过于平庸/粗糙/简陋 (Barebones Prompt)
 * @param {string} prompt 用户原始输入
 * @returns {boolean}
 */
function isBarebonesPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return true;
  if (text.length < 150) return true;

  // 检查是否包含结构化三幕/分镜
  const hasSceneStructure = /(第[一二三123]幕|幕[一二三123]|场景[一二三四1234]|分镜)/i.test(text);
  // 检查是否包含人物反差/心理张力
  const hasCharacterTension = /(反差|内心|表面|破防|面具|算计|吐槽|拉扯|机锋)/i.test(text);
  // 检查是否包含文风/去AI约束
  const hasStyleConstraints = /(硬约束|禁词|反套路|去AI|交错|克制)/i.test(text);

  // 如果缺少核心结构要素中的两项及以上，判定为平庸/待补全
  let missingCount = 0;
  if (!hasSceneStructure) missingCount++;
  if (!hasCharacterTension) missingCount++;
  if (!hasStyleConstraints) missingCount++;

  return missingCount >= 2;
}

/**
 * 通用网文高阶提示词抽象模板（作为 Gemini 3.8 的构建规范）
 */
const UNIVERSAL_PROMPT_SCHEMA_SPEC = `
【题材与基调】
{{题材分类}} / {{核心流派标签}} / {{特色叙事风格}}。
表面{{表面环境与处境}}，内里{{底层欲望/生存利益/反差动机}}。行文节奏{{节奏类型}}，以{{核心推动力：对白机锋/肢体博弈/悬念攻防}}推动，心理独白{{独白风格}}，情感/戏剧暗流{{暗流基调}}。

【核心人物张力矩阵】
1. {{主角名}}（{{POV视点主角}}）：{{身份定位与底层诉求}}。表面【处事面具：如装怂/高冷/圆滑】，内心【真实独白/算计：如求生吐槽/狠辣盘算】。招牌行为与底线：{{招牌动作与危机底线}}。
2. {{对手戏角色名}}（{{主要对手/情感对象}}）：{{身份威严与外在光环}}。隐秘反差萌/破防弱点：{{反差弱点与笨拙失态之处}}。破防生理与动作反应：{{如耳红/指颤/真元泄漏/强行嘴硬}}。
3. {{催化剂角色名}}（{{旁观者/加压役/随身残魂/同门}}）：{{身份与定位}}，日常{{补刀/吃瓜/施加外部紧迫感}}。

【三幕分镜微节拍】
第一幕【{{空间锚定·初始冲突与动作压迫}}】：通过具体的{{空间器物、陈设、气味、衣物}}锚定现场。角色A以{{正当借口}}发难施压，角色B以{{防御姿态与正经胡扯}}抗衡，确立现场物理阻力与戏剧张力。
第二幕【{{交错对峙·递进逼问与外壳碎裂}}】：严格遵循“动作-对白交错律”。角色B三段式递进抓包/反诘（每指出一处出格，角色A必须有对应生理动作微反应）。角色A防线崩溃、恼羞成怒爆发反差。角色B急中生智用{{荒诞借口}}圆场，角色A顺水推舟化解尴尬。
第三幕【{{记忆触媒·情感升华与不可逆契约}}】：通过{{具体互动道具：如热粥/擦剑/分药}}展开动作。触媒闪回记忆（100~200字{{往昔旧事}}），揭开破防动情的真实因果。角色A展现傲娇蛮横，霸道立下{{不可逆长期契约/规则}}，留下发懵的主角与催化剂的收尾嘲笑。

【语言与文风硬约束】
1. 严禁老套AI套话（绝对禁止嘴角勾起、骨节泛白、瞳孔骤缩、喉头一甜、心头飞速转过念头）。
2. 动作-对白交错律：禁止单向长篇大论对白，台词必须穿插对手的物理微动作与生理反应。
3. 世界观原生化包装：现代梗或读者吐槽必须用本土化、世界观内自洽的术语包裹。
4. 心理独白克制自然，紧扣读者爽点与笑点，不剧透大纲。
`;

/**
 * 格式化人物小传上下文
 */
function formatCharacterContext(characters) {
  if (!characters) return '暂无特定人物详案，请根据角色名提炼鲜明性格与反差。';
  if (typeof characters === 'string') return characters;
  if (Array.isArray(characters)) {
    return characters.map((c, i) => {
      if (typeof c === 'string') return `${i + 1}. ${c}`;
      const name = c.name || c.id || `角色${i + 1}`;
      const role = c.role || c.identity || '';
      const personality = c.personality || c.traits || c.desc || '';
      const contrast = c.contrast || c.quirk || '';
      return `${i + 1}. 【${name}】${role ? `(${role})` : ''}：性格【${personality}】${contrast ? `，反差弱点【${contrast}】` : ''}`;
    }).join('\n');
  }
  if (typeof characters === 'object') {
    return Object.entries(characters).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  }
  return '';
}

/**
 * 使用 Gemini 3.8 模型将简陋的用户提示词扩充为高阶通用标准提示词
 * @param {Object} options
 * @returns {Promise<{ enrichedPrompt: string, wasEnriched: boolean, modelUsed: string }>}
 */
async function enrichPromptWithGemini(options = {}) {
  const {
    rawPrompt = '',
    outline = '',
    characters = null,
    novelProfile = {},
    genre = '通用文学',
    context = '',
    callModel = null,
    modelId = 'gemini-3.8-flash-high',
    force = false
  } = options;

  const trimmedPrompt = String(rawPrompt || '').trim();

  // 如果提示词已经非常完整且未要求强制扩充，直接返回原提示词
  if (!force && !isBarebonesPrompt(trimmedPrompt)) {
    return {
      enrichedPrompt: trimmedPrompt,
      wasEnriched: false,
      modelUsed: 'bypass'
    };
  }

  // 提取现有资料要素
  const genreTitle = typeof genre === 'object' ? genre.genre || genre.id || '通用文学' : String(genre || novelProfile.primaryGenre || '通用文学');
  const novelTitle = novelProfile.title || '当前作品';
  const tone = novelProfile.tone || '具有戏剧张力与反差感';
  const charContext = formatCharacterContext(characters || novelProfile.characters);
  const outlineContext = outline || novelProfile.shortSynopsis || '根据当前剧情合理推演';

  // 构造发给 Gemini 3.8 的架构扩充指令
  const architectSystem = [
    '你是一位网文总编剧与顶级小说架构师。',
    '你的核心任务：将用户提供的不够详尽的创作构想，深度结合已有小说的大纲、人物档案与题材设定，全面重构并扩展为一份【高阶结构化网文执行提示词】。',
    '你输出的提示词必须严格遵循以下四个模块的格式与规范（纯文本，不要 Markdown 代码块包裹）：',
    UNIVERSAL_PROMPT_SCHEMA_SPEC.trim(),
    '【写作指导要求】：',
    '1. 必须根据已有的人物性格深入挖掘【表面面具】与【内心真实反差】，设计极具戏剧张力的对手戏；',
    '2. 三幕分镜中，必须设计具体的【物理道具/环境摩擦】、【三段式逼问与动作交错】、以及【旧事羁绊闪回与不可逆新契约】；',
    '3. 严禁空洞套话，严禁直接输出小说正文，你只输出重构扩充后的结构化提示词本身。'
  ].join('\n\n');

  const architectUser = [
    `【作品基本信息】：书名《${novelTitle}》，题材【${genreTitle}】，基调【${tone}】`,
    `【已有主要人物档案】：\n${charContext}`,
    `【已有大纲/前情剧情】：\n${outlineContext}`,
    context ? `【最近章节上下文】：\n${context.slice(-800)}` : '',
    `【用户原始粗略构思】：\n"${trimmedPrompt || '写出本章剧情的高潮交锋与人物拉扯'}"`,
    '请立即根据上述信息，补全并输出扩充后的完整结构化标准提示词：'
  ].filter(Boolean).join('\n\n');

  // 如果提供了 callModel 接口，真实调用 Gemini 3.8
  if (typeof callModel === 'function') {
    try {
      const response = await callModel({
        stage: 'prompt_enrichment',
        system: architectSystem,
        userPrompt: architectUser,
        modelId: modelId || 'gemini-3.8-flash-high',
        temperature: 0.7,
        maxTokens: 2500
      });

      const enrichedText = String(response && (response.text || response.content) || '').trim();
      if (enrichedText && enrichedText.length > 200) {
        return {
          enrichedPrompt: sanitizeInPlace(enrichedText).text,
          wasEnriched: true,
          modelUsed: modelId
        };
      }
    } catch (err) {
      console.warn('[prompt-enricher] Gemini 3.8 prompt expansion non-fatal error, falling back to rule synthesis:', err && err.message || err);
    }
  }

  // 兜底方案：使用确定性模板合成扩充
  const fallback = buildEnrichedPromptFallback({
    rawPrompt: trimmedPrompt,
    genreTitle,
    charContext,
    outlineContext,
    tone
  });

  return {
    enrichedPrompt: fallback,
    wasEnriched: true,
    modelUsed: 'rule_fallback'
  };
}

/**
 * 确定性规则兜底合成器
 */
function buildEnrichedPromptFallback({ rawPrompt, genreTitle, charContext, outlineContext, tone }) {
  return [
    `【题材与基调】`,
    `${genreTitle} / 角色反差拉扯 / 强戏剧张力。`,
    `表面处境紧绷或讲究规矩，内里充满生存算计与真实情感暗流。行文节奏轻快灵动，以密集机锋对白与肢体微动作推动，心理独白辛辣克制，情感暗流细腻真挚。`,
    ``,
    `【核心人物张力矩阵】`,
    charContext || `1. 主角：表面审慎周旋，内心疯狂算计与吐槽，极有分寸与底线。\n2. 主要对手/对手戏角色：外在威严霸道，骨子里具备隐秘反差萌与笨拙慌乱。\n3. 第三方看客：暗中观察吃瓜，适时施加外部压力。`,
    ``,
    `【三幕分镜微节拍】`,
    `第一幕【空间锚定·初始摩擦】：以具体器物、环境与动作破题。角色之间因本章目标（${rawPrompt || outlineContext}）产生初始发难，一方借故施压，另一方严防死守、巧妙周旋。`,
    `第二幕【交错对峙·外壳破防】：严格执行对白动作交错律。主角三段式层层抓包揭露破绽，对手戏角色防线失守、恼羞成怒爆发反差；主角适时抛出荒诞借口化解僵局。`,
    `第三幕【记忆触媒·不可逆契约】：通过具体道具行动（如递茶、疗伤、分账或旧物）触碰旧日回忆羁绊，揭开情感因果；对手戏角色霸道立下不可逆新规矩，确立长期拉扯关系，章末留有余韵。`,
    ``,
    `【语言与文风硬约束】`,
    `1. 严禁老套AI套话（严禁嘴角勾起、骨节泛白、瞳孔骤缩、喉头一甜、心头飞速转过念头）。`,
    `2. 对白动作交错律：台词禁止单向长篇大论，必须穿插对手的生理反应与微动作。`,
    `3. 心理独白贴近读者爽点与笑点，不拖泥带水，不直接抄写大纲。`
  ].join('\n');
}

module.exports = {
  isBarebonesPrompt,
  enrichPromptWithGemini,
  UNIVERSAL_PROMPT_SCHEMA_SPEC,
  buildEnrichedPromptFallback
};
