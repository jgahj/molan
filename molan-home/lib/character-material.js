'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  SCENES,
  RELATIONSHIPS,
  EMOTIONAL_STATES,
  HUMAN_TEXTURE_SIGNALS,
  extractGenerationContext,
  rankMaterialCandidates
} = require('./character-material-context.cjs');

const CHARACTER_ARCHETYPES = Object.freeze([
  '豪爽侠义型',
  '冷静理智型',
  '温柔内敛型',
  '活泼开朗型',
  '阴郁腹黑型',
  '霸道强势型',
  '天真烂漫型',
  '市侩圆滑型',
  '高傲冷峻型',
  '热血冲动型'
]);

const CHARACTER_DIMENSIONS = Object.freeze([
  { id: 'appearance', label: '外貌', aliases: ['外貌', '外形', 'appearance'] },
  { id: 'expression', label: '神态', aliases: ['神态', '表情', 'expression', 'emotion'] },
  { id: 'action', label: '动作', aliases: ['动作', '行为', 'action'] },
  { id: 'dialogue', label: '语言', aliases: ['语言', '对白', '说话', 'dialogue'] },
  { id: 'catchphrase', label: '口头禅', aliases: ['口头禅', '高频语气', 'catchphrase'] },
  { id: 'psychology', label: '心理', aliases: ['心理', '内心', 'psychology', 'thought'] }
]);

const ARCHETYPE_KEYWORDS = Object.freeze({
  '豪爽侠义型': ['豪爽', '侠义', '仗义', '直爽', '洒脱', '义气', '大方'],
  '冷静理智型': ['冷静', '理智', '克制', '淡漠', '审慎'],
  '温柔内敛型': ['温柔', '含蓄', '内敛', '体贴', '柔和'],
  '活泼开朗型': ['活泼', '开朗', '乐观', '跳脱', '爱笑'],
  '阴郁腹黑型': ['阴沉', '腹黑', '算计', '偏执', '危险'],
  '霸道强势型': ['霸道', '强势', '掌控', '专横', '命令', '果断'],
  '天真烂漫型': ['天真', '单纯', '烂漫', '懵懂', '好奇'],
  '市侩圆滑型': ['市侩', '圆滑', '精明', '世故', '会算', '逐利'],
  '高傲冷峻型': ['高傲', '冷峻', '孤傲', '骄傲', '不屑', '疏离'],
  '热血冲动型': ['热血', '冲动', '直率', '暴躁', '好战']
});

const SENSITIVE_PATTERN = /露骨|下身|阴茎|阴部|乳房|乳头|性交|做爱|高潮|插入|性器官|呻吟|床笫|媾合|肉棒|精液|裸身|裸体|春药|发情|淫靡|潮吹|奸淫/i;
const CHARACTER_MATERIAL_MESSAGE_FLAG = '__molanCharacterMaterialMessage';
const DEFAULT_INDEX_VERSION = 'corpus-v3';

// 段落样本匿名化使用的常见姓氏与语境停词，避免把普通词误替换为占位符。
const ANON_SURNAME_CHARS = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元顾孟平黄穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍虞万柯管卢莫经房裘缪解应宗丁宣邓郁单杭洪包诸左石崔吉龚程嵇邢滑裴陆荣翁荀羊惠甄封芮羿储靳汲松井段富巫乌焦巴弓牧车侯全郗班仰秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟印宿白怀蒲从鄂索咸赖卓蔺屠蒙池乔胥能苍双党翟谭贡姬申扶堵冉宰桑桂濮牛寿通边扈燕冀浦尚农温庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越隆师巩聂晁勾敖融冷辛那简饶空曾毋养鞠须丰巢关蒯相查荆红游竺权逯盖益桓公';
const ANON_NAME_STOP_WORDS = new Set('人物人形人影人手人群人声人脸人身人心男人女人男子女子少年少女老人孩子朋友敌人亲人家人师兄师姐师父老师先生小姐公子姑娘众人所有人时候事情问题应付东西石子周围成功简单解释厉害相互经历明白周边天地方向身形身影'.split(''));
const ANON_NAME_TAIL_BLOCK = /[的地得着了过在会将被很还也又就便而把让从向对跟为与和心手头脸身口形影物群声色气体边里外前后上下第一于以]/u;
const ANON_LOCATION_PATTERN = /(?:来到|前往|赶往|走进|回到|位于|离开|进入|穿过|守在|退到|奔向|赶到|驻扎在|落在)([\u4e00-\u9fff]{2,8}(?:城|镇|村|山|谷|峰|殿|宫|府|关|岛|州|域|门|楼|寺|院|阁|堂|街))/gu;

function normalizeContextLabel(value, allowed, maxLength = 120) {
  const normalized = normalizeMaterialText(value, maxLength);
  return allowed.includes(normalized) ? normalized : '';
}

function normalizeContextLabels(value, allowed, maxLength = 120, limit = 8) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(item => normalizeContextLabel(item, allowed, maxLength)).filter(Boolean))].slice(0, limit);
}

function normalizeTextLabels(value, maxLength = 120, limit = 8) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(item => normalizeMaterialText(item, maxLength)).filter(Boolean))].slice(0, limit);
}

function normalizeMaterialHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-5).map(item => {
    const source = item && typeof item === 'object' ? item : {};
    return {
      sourceHash: normalizeMaterialText(source.sourceHash, 40),
      sourceWorkId: normalizeMaterialText(source.sourceWorkId, 120),
      canonicalWorkId: normalizeMaterialText(source.canonicalWorkId, 120),
      authorHash: normalizeMaterialText(source.authorHash || source.sourceAuthorHash, 80),
      microPatterns: normalizeTextLabels(source.microPatterns || source.microPattern, 120, 8)
    };
  }).filter(item => item.sourceHash || item.sourceWorkId || item.canonicalWorkId || item.authorHash || item.microPatterns.length);
}

const GENERIC_RULES = Object.freeze([
  { dimension: 'appearance', rule: '外貌只选会影响当前判断或行动的细节，用姿态、衣着状态和环境反应呈现人物，不做静态清单。', application: '让一个可观察细节服务于人物当下的目标、压力或关系。', caution: '不要用空泛的漂亮、冷峻、温柔等标签代替细节。' },
  { dimension: 'expression', rule: '神态通过视线、停顿、呼吸、手部和面部的微小变化落地，允许反应不完整。', application: '先写人物看见或听见什么，再写身体如何泄露态度。', caution: '不要在动作后重复解释同一种情绪。' },
  { dimension: 'action', rule: '动作要带有选择和阻力，写清人物做了什么、为此承担什么代价，以及动作如何改变场面。', application: '用动作推进冲突，而不是用性格标签宣布人物是什么样的人。', caution: '不要堆叠无结果的动作或让身体部位脱离人物自行行动。' },
  { dimension: 'dialogue', rule: '对白围绕即时目的展开，保留角色的省略、打断、称呼和不愿说出的部分。', application: '每一句话都应争取信息、关系、时间或位置中的至少一项。', caution: '不要把对白写成完整的教程式论证。' },
  { dimension: 'catchphrase', rule: '口头禅只能作为稳定倾向，必须结合关系和场景变化，不能机械重复。', application: '让高频语气在压力增大或关系变化时出现偏移。', caution: '不要用一个口头禅替代人物声音的全部差异。' },
  { dimension: 'psychology', rule: '心理优先保留当前人物能意识到的片段和选择依据，省略显而易见的完整因果链。', application: '让感官、记忆碎片或未完成的念头逼近最终行动。', caution: '不要用对称分支和完整意图链把所有答案提前讲完。' }
]);

let characterMaterialIndexCache = null;
let paragraphSampleLibraryCache = null;
const paragraphAnonymizationCache = new Map();

/** strong 模式每轮注入的完整段落样本条数（维度配额在此条数内分配）。 */
const PARAGRAPH_SAMPLE_COUNT = 3;

/** 段落样本库专有的启发式维度与注入时的展示标签（voice 不在 CHARACTER_DIMENSIONS 内）。 */
const PARAGRAPH_DIMENSION_LABELS = Object.freeze({
  dialogue: '对话',
  appearance: '外貌',
  voice: '声音',
  action: '动作'
});

/** 把匿名化编号转换为稳定的中文占位符后缀，便于同一本书跨样本复用。 */
function anonymizationLabel(index) {
  const value = Math.max(0, Number(index) || 0);
  const labels = '甲乙丙丁戊己庚辛壬癸';
  if (value < labels.length) return labels[value];
  return `第${value + 1}个`;
}

/** 为单本来源书取得可复用的人名、地名替换表，确保同一专名始终对应同一占位符。 */
function paragraphAnonymizationState(sourceKey) {
  const key = normalizeMaterialText(sourceKey, 240) || '__default__';
  let state = paragraphAnonymizationCache.get(key);
  if (!state) {
    state = { names: new Map(), locations: new Map() };
    paragraphAnonymizationCache.set(key, state);
  }
  return state;
}

/** 判断候选词是否满足中文人名的姓氏、长度和语境约束，减少普通词误替换。 */
function isParagraphNameCandidate(source, start, token) {
  const value = String(token || '');
  if (value.length < 2 || value.length > 3 || !ANON_SURNAME_CHARS.includes(value[0])) return false;
  if (ANON_NAME_TAIL_BLOCK.test(value[value.length - 1])) return false;
  if ([...value].some(char => ANON_NAME_STOP_WORDS.has(char))) return false;
  if (/^(.)\1+$/u.test(value)) return false;
  const before = source[start - 1] || '';
  const after = source[start + value.length] || '';
  const boundary = !before || /[\s，。！？；：、“”‘’「」『』（）()]/u.test(before);
  const following = !after || /[\s，。！？；：、“”‘’「」『』（）()]/u.test(after)
    || /[说说道问答喊叫笑哭骂劝看望盯瞥抬低垂握抓捏咬走跑退转停开起坐躲挡拦应察想见伸打抱拿接推带沉眯]/u.test(after);
  return boundary && following;
}

/** 从段落中提取具备强边界的姓名与地点候选，返回按出现顺序去重的专名列表。 */
function paragraphAnonymizationCandidates(text) {
  const source = String(text || '');
  const names = [];
  const nameSeen = new Set();
  for (let index = 0; index < source.length; index += 1) {
    if (!ANON_SURNAME_CHARS.includes(source[index])) continue;
    for (const length of [3, 2]) {
      const token = source.slice(index, index + length);
      if (!isParagraphNameCandidate(source, index, token) || nameSeen.has(token)) continue;
      nameSeen.add(token);
      names.push(token);
      break;
    }
  }
  const locations = [];
  const locationSeen = new Set();
  const locationPattern = new RegExp(ANON_LOCATION_PATTERN.source, 'gu');
  let match;
  while ((match = locationPattern.exec(source))) {
    const location = String(match[1] || '').trim();
    if (location && !locationSeen.has(location)) {
      locationSeen.add(location);
      locations.push(location);
    }
  }
  return { names, locations };
}

/** 按来源书将原文中的专名替换为人名、地名占位符，并返回替换审计信息。 */
function anonymizeParagraphSample(value, sourceKey = '', options = {}) {
  const text = normalizeMaterialText(value, 2000);
  if (!text) return { anonymizedText: '', replacements: { names: [], locations: [] }, sourceKey: normalizeMaterialText(sourceKey, 240) };
  const state = paragraphAnonymizationState(sourceKey);
  const explicitNames = Array.isArray(options.names) ? options.names.map(item => normalizeMaterialText(item, 40)).filter(Boolean) : [];
  const candidates = paragraphAnonymizationCandidates(text);
  const names = [...new Set([...explicitNames, ...candidates.names])];
  const locations = candidates.locations;
  names.forEach(name => {
    if (!state.names.has(name)) state.names.set(name, `【人${anonymizationLabel(state.names.size)}】`);
  });
  locations.forEach(location => {
    if (!state.locations.has(location)) state.locations.set(location, `【地${anonymizationLabel(state.locations.size)}】`);
  });
  const replaceMap = new Map([...state.names.entries(), ...state.locations.entries()]);
  const terms = [...replaceMap.keys()].sort((left, right) => right.length - left.length);
  const anonymizedText = terms.length
    ? text.replace(new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|'), 'gu'), term => replaceMap.get(term) || term)
    : text;
  return {
    anonymizedText,
    replacements: {
      names: names.map(name => ({ source: name, replacement: state.names.get(name) })).filter(item => item.replacement),
      locations: locations.map(location => ({ source: location, replacement: state.locations.get(location) })).filter(item => item.replacement)
    },
    sourceKey: normalizeMaterialText(sourceKey, 240)
  };
}

/** 返回段落样本匿名化后的纯文本，供构建脚本与接口注入使用。 */
function anonymizeSampleText(value, sourceKey = '', options = {}) {
  return anonymizeParagraphSample(value, sourceKey, options).anonymizedText;
}

/** 清空进程内匿名化映射，便于离线重建或测试时从干净状态开始。 */
function resetParagraphAnonymizationCache() {
  paragraphAnonymizationCache.clear();
}

/** Normalize an arbitrary value into bounded plain text for material metadata. */
function normalizeMaterialText(value, maxLength = 2000) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

/** Normalize an archetype label and reject values outside the supported catalog. */
function normalizeCharacterArchetype(value) {
  const normalized = normalizeMaterialText(value, 80);
  return CHARACTER_ARCHETYPES.includes(normalized) ? normalized : '';
}

/** Normalize a material dimension from either its UI id or its Chinese label. */
function normalizeCharacterDimension(value) {
  const normalized = normalizeMaterialText(value, 40).toLowerCase();
  const found = CHARACTER_DIMENSIONS.find(item => item.id.toLowerCase() === normalized || item.aliases.some(alias => alias.toLowerCase() === normalized));
  return found ? found.id : '';
}

/** Normalize a dimension list while preserving the catalog order and uniqueness. */
function normalizeCharacterDimensions(values) {
  const source = Array.isArray(values) ? values : values ? [values] : [];
  const normalized = new Set(source.map(normalizeCharacterDimension).filter(Boolean));
  return CHARACTER_DIMENSIONS.map(item => item.id).filter(id => !normalized.size || normalized.has(id));
}

/** Convert a free-form entity field into the text used by deterministic inference. */
function entityFieldText(entity) {
  const source = entity && typeof entity === 'object' ? entity : {};
  const attrs = Array.isArray(source.attrs)
    ? source.attrs.map(item => typeof item === 'string' ? item : `${item && (item.key || item.k || item.name || '')} ${item && (item.value || item.v || item.text || '')}`)
    : [];
  const tags = Array.isArray(source.tags) ? source.tags : [];
  return {
    tags: tags.map(value => normalizeMaterialText(value, 120)).filter(Boolean),
    body: [source.name, source.personality, source.notes, source.intro, source.description, ...attrs]
      .map(value => normalizeMaterialText(value, 1000))
      .filter(Boolean)
      .join(' ')
  };
}

/** Count bounded keyword occurrences without allowing one repeated word to dominate inference. */
function countKeywordOccurrences(source, keyword) {
  const text = String(source || '');
  const term = String(keyword || '');
  if (!term) return 0;
  let count = 0;
  let start = 0;
  while (start < text.length && count < 3) {
    const index = text.indexOf(term, start);
    if (index < 0) break;
    count += 1;
    start = index + term.length;
  }
  return count;
}

/** Infer one standard character type, preferring explicit fields and exact tags over prose clues. */
function inferCharacterArchetype(entity) {
  const source = entity && typeof entity === 'object' ? entity : {};
  const explicit = normalizeCharacterArchetype(source.archetype);
  if (explicit) {
    const explicitSource = source.archetypeSource === 'inferred' ? 'inferred' : 'explicit';
    const confidence = explicitSource === 'explicit'
      ? 1
      : Math.min(0.99, Math.max(0.5, Number(source.archetypeConfidence) || 0.65));
    return { archetype: explicit, source: explicitSource, confidence, scores: { [explicit]: confidence } };
  }

  const fields = entityFieldText(source);
  const scores = new Map(CHARACTER_ARCHETYPES.map(type => [type, 0]));
  for (const type of CHARACTER_ARCHETYPES) {
    for (const keyword of ARCHETYPE_KEYWORDS[type]) {
      const normalizedKeyword = keyword.toLowerCase();
      const exactTag = fields.tags.some(tag => tag.toLowerCase() === normalizedKeyword);
      const tagMatch = fields.tags.some(tag => tag.toLowerCase().includes(normalizedKeyword));
      const tagScore = exactTag ? 6 : (tagMatch ? 4 : 0);
      const bodyScore = countKeywordOccurrences(fields.body, keyword) * 1.25;
      scores.set(type, scores.get(type) + tagScore + bodyScore);
    }
  }

  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]);
  const top = ranked[0];
  const second = ranked[1];
  if (!top || top[1] < 2 || (second && second[1] > 0 && top[1] - second[1] < 1.5)) {
    return { archetype: '', source: 'none', confidence: 0, scores: Object.fromEntries(scores) };
  }
  const confidence = Math.min(0.94, Math.max(0.5, top[1] / (top[1] + (second ? second[1] : 0) + 1)));
  return { archetype: top[0], source: 'inferred', confidence: Number(confidence.toFixed(2)), scores: Object.fromEntries(scores) };
}

/**
 * 规范化角色声音契约（CharacterVoiceContract）。
 * 针对基准数据中 -58.2% 对话过短差距（实测 8.98 字 vs 基线 21.48 字）与同质化机械应答，
 * 约束句子长度偏好、应答交锋模式、言语习惯及禁忌用语。
 */
function normalizeCharacterVoiceContract(voice) {
  if (!voice) return null;
  const source = typeof voice === 'object' ? voice : { habit: String(voice) };

  let sentenceLengthPreference = 'medium';
  if (source.sentenceLengthPreference || source.sentence_length_preference) {
    const pref = String(source.sentenceLengthPreference || source.sentence_length_preference).trim();
    if (['short', '短句', '短'].includes(pref)) sentenceLengthPreference = 'short';
    else if (['long', '长句', '长'].includes(pref)) sentenceLengthPreference = 'long';
    else if (['medium', '中等', '常态'].includes(pref)) sentenceLengthPreference = 'medium';
    else sentenceLengthPreference = normalizeMaterialText(pref, 40);
  }

  const responsePattern = normalizeMaterialText(source.responsePattern || source.response_pattern || source.pattern || '', 80);

  const rawHabits = Array.isArray(source.verbalHabits || source.habits)
    ? (source.verbalHabits || source.habits)
    : (source.habit ? [source.habit] : []);
  const verbalHabits = [...new Set(rawHabits.map(h => normalizeMaterialText(h, 60)).filter(Boolean))].slice(0, 5);

  const rawTaboos = Array.isArray(source.tabooPhrases || source.taboos || source.taboo)
    ? (source.tabooPhrases || source.taboos || source.taboo)
    : (source.taboo ? [source.taboo] : []);
  const tabooPhrases = [...new Set(rawTaboos.map(t => normalizeMaterialText(t, 60)).filter(Boolean))].slice(0, 8);

  const rawSamples = Array.isArray(source.samples) ? source.samples : (source.samples ? [source.samples] : []);
  const samples = [...new Set(rawSamples.map(s => normalizeMaterialText(s, 120)).filter(Boolean))].slice(0, 3);

  if (!responsePattern && !verbalHabits.length && !tabooPhrases.length && !samples.length && !source.sentenceLengthPreference && !source.sentence_length_preference) {
    return null;
  }

  return {
    sentenceLengthPreference,
    responsePattern,
    verbalHabits,
    tabooPhrases,
    samples
  };
}

/**
 * 根据参与角色的声音契约生成 Prompt 台词指令块。
 */
function buildCharacterVoiceDirectiveBlock(characters) {
  const list = Array.isArray(characters) ? characters.filter(c => c && (c.voice || c.name || c.archetype)) : [];
  if (!list.length) return '';
  const entries = [];
  for (const char of list) {
    const name = normalizeMaterialText(char.name, 40) || '未命名角色';
    const voice = char.voice ? normalizeCharacterVoiceContract(char.voice) : null;
    const parts = [];
    if (voice) {
      if (voice.sentenceLengthPreference === 'medium') parts.push('单轮台词饱满（建议 15~30 字有效区间，承载态度博弈，杜绝单薄短句）');
      else if (voice.sentenceLengthPreference === 'short') parts.push('单轮台词偏向精炼短句（8~15 字，击中要害）');
      else if (voice.sentenceLengthPreference === 'long') parts.push('单轮台词周密铺陈（25~45 字，语势连贯）');
      else if (voice.sentenceLengthPreference) parts.push(`台词句长倾向：${voice.sentenceLengthPreference}`);

      if (voice.responsePattern) parts.push(`交锋模式：${voice.responsePattern}`);
      if (voice.verbalHabits && voice.verbalHabits.length) parts.push(`口吻习惯：${voice.verbalHabits.join('、')}`);
      if (voice.tabooPhrases && voice.tabooPhrases.length) parts.push(`言语禁忌（严禁出现）：${voice.tabooPhrases.join('、')}`);
      if (voice.samples && voice.samples.length) parts.push(`标志台词：“${voice.samples.join('” / “')}”`);
    } else if (char.archetype) {
      parts.push(`单轮对白饱满（目标 15~30 字，杜绝空洞单字回应），契合【${char.archetype}】性格质地`);
    }
    if (parts.length) {
      entries.push(`- 【${name}】：${parts.join('；')}`);
    }
  }
  if (!entries.length) return '';
  return [
    '<!-- molan-character-voice-contract-v1 -->',
    '【角色台词与言语交互契约（消除单薄对白，目标 15~30 字/轮，基准 18~28 字）】',
    '- 基准目标：单轮对白向范本基线靠近（同题材均值约 21 字，有效区间 15~30 字），杜绝“好的”、“明白”、“快走”等无信息量机械短句对答。',
    ...entries,
    '- 对话原则：双方口吻与立场鲜明区分，每轮对白必须包含【事实判断/试探 + 利益博弈/筹码 + 态度/行动附带】中的至少两项，推动局面变化。'
  ].join('\n');
}

/** Resolve all usable character archetypes from entity cards and request-level hints. */
function resolveCharacterArchetypes(request) {
  const source = request && typeof request === 'object' ? request : {};
  const entities = Array.isArray(source.characters) ? source.characters.filter(item => item && typeof item === 'object').slice(0, 40) : [];
  const resolvedCharacters = entities.map(entity => {
    const result = inferCharacterArchetype(entity);
    const voice = normalizeCharacterVoiceContract(entity.voice || entity.voiceContract || {
      habit: entity.habit || entity.speakingHabit,
      taboo: entity.taboo || entity.tabooPhrases,
      sentenceLengthPreference: entity.sentenceLengthPreference || entity.sentence_length_preference,
      responsePattern: entity.responsePattern || entity.response_pattern,
      samples: entity.samples || entity.voiceSamples
    });
    return {
      id: normalizeMaterialText(entity.id, 120),
      name: normalizeMaterialText(entity.name, 120),
      archetype: result.archetype,
      archetypeSource: result.source,
      archetypeConfidence: result.confidence,
      ...(voice ? { voice } : {})
    };
  });
  const rawHints = Array.isArray(source.archetypes)
    ? source.archetypes.map(normalizeCharacterArchetype).filter(Boolean)
    : [];
  const explicitCharacters = resolvedCharacters.filter(item => item.archetype && item.archetypeSource === 'explicit');
  const inferredCharacters = resolvedCharacters.filter(item => item.archetype && item.archetypeSource === 'inferred');
  const inferredCharacterTypes = new Set(inferredCharacters.map(item => item.archetype));
  // The browser sends character cards and a deduplicated archetype list. When
  // a type is backed only by an inferred card, keep that provenance instead
  // of treating the derived list as a new explicit user choice.
  const explicitHints = rawHints.filter(value => !inferredCharacterTypes.has(value));
  const archetypes = [...new Set([
    ...explicitCharacters.map(item => item.archetype),
    ...explicitHints,
    ...inferredCharacters.map(item => item.archetype)
  ].filter(Boolean))];
  const primary = explicitCharacters[0]
    || (explicitHints[0] ? { archetype: explicitHints[0], archetypeSource: 'explicit', archetypeConfidence: 1 } : null)
    || inferredCharacters[0]
    || null;
  return {
    characters: resolvedCharacters,
    archetypes,
    primaryArchetype: primary ? primary.archetype : '',
    primarySource: primary ? primary.archetypeSource : 'none',
    primaryConfidence: primary ? primary.archetypeConfidence : 0
  };
}

/** Normalize a client material request without trusting it for authorization. */
function normalizeCharacterMaterialRequest(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const mode = source.mode === 'strong' ? 'strong' : source.mode === 'raw' ? 'raw' : source.mode === 'off' ? 'off' : 'auto';
  const index = source.index === 'mature' ? 'mature' : 'general';
  const resolved = resolveCharacterArchetypes(source);
  const rawGenres = Array.isArray(source.genres)
    ? source.genres.map(item => normalizeMaterialText(item, 80)).filter(Boolean).slice(0, 12)
    : [];
  const audienceSource = normalizeMaterialText(source.audience || source.targetAudience || source.genre, 160);
  const audience = /女频|女性|female|women/i.test(audienceSource)
    ? '女频'
    : /男频|男性|male|men/i.test(audienceSource)
      ? '男频'
      : '';
  const context = extractGenerationContext({
    ...source,
    query: source.query || source.currentText || source.prompt || ''
  });
  return {
    enabled: source.enabled !== false && mode !== 'off',
    mode,
    index,
    matureEnabled: source.matureEnabled === true,
    novelId: normalizeMaterialText(source.novelId, 160),
    dimensions: normalizeCharacterDimensions(source.dimensions),
    query: normalizeMaterialText(source.query, 1600),
    genre: normalizeMaterialText(source.genre, 160),
    genres: [...new Set(rawGenres)],
    audience,
    focusSlice: normalizeMaterialText(source.focusSlice, 120),
    proseTask: source.proseTask !== false,
    characters: resolved.characters,
    archetypes: resolved.archetypes,
    archetype: resolved.primaryArchetype,
    primaryArchetype: resolved.primaryArchetype,
    primarySource: resolved.primarySource,
    primaryConfidence: resolved.primaryConfidence,
    scene: normalizeContextLabel(context.scene, SCENES),
    relationship: normalizeContextLabel(context.relationship, RELATIONSHIPS),
    emotionalState: normalizeContextLabels(context.emotionalState, EMOTIONAL_STATES),
    intent: normalizeMaterialText(context.intent, 160),
    humanTextureSignals: normalizeContextLabels(context.humanTextureSignals, HUMAN_TEXTURE_SIGNALS, 80, 12),
    recentHistory: normalizeMaterialHistory(source.recentHistory),
    contextFallback: context.fallback === true,
    contextSource: context.source
  };
}

/** Mark a prompt message as removable character material while retaining its kind. */
function markCharacterMaterialMessage(message, kind) {
  if (message && typeof message === 'object') {
    Object.defineProperty(message, CHARACTER_MATERIAL_MESSAGE_FLAG, {
      value: { kind: kind === 'sample' ? 'sample' : 'rules' },
      enumerable: false,
      configurable: true
    });
  }
  return message;
}

/** Copy the internal material marker when the server clones or bounds a message. */
function copyCharacterMaterialMessageFlag(source, target) {
  const meta = source && source[CHARACTER_MATERIAL_MESSAGE_FLAG];
  if (meta) markCharacterMaterialMessage(target, meta.kind);
  return target;
}

/** Read the internal character-material priority marker from a prompt message. */
function characterMaterialMessageMeta(message) {
  return message && message[CHARACTER_MATERIAL_MESSAGE_FLAG] || null;
}

/** Return a stable short hash for internal corpus/source auditing without exposing source URLs. */
function materialSourceHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

/**
 * 将画像数值限制在运行时可接受的范围，避免损坏 JSON 影响提示词。
 * 参数：value 为待处理数值；minimum 和 maximum 为允许范围。
 * 返回值：范围内的有限数值，非法输入返回 0。
 */
function boundedProfileNumber(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(maximum, Math.max(minimum, number));
}

/**
 * 规范化一个类型×题材画像，只保留统计字段而不接收原文。
 * 参数：value 为索引中的画像对象。
 * 返回值：可安全注入运行时的画像对象。
 */
function normalizeCharacterProfile(value) {
  const source = value && typeof value === 'object' ? value : {};
  const commaHistogram = source.commaHistogram && typeof source.commaHistogram === 'object' ? source.commaHistogram : {};
  return {
    available: source.available === true && boundedProfileNumber(source.sampleCount) > 0,
    reliable: source.reliable === true,
    sampleCount: Math.floor(boundedProfileNumber(source.sampleCount)),
    charCount: Math.floor(boundedProfileNumber(source.charCount)),
    sentenceCount: Math.floor(boundedProfileNumber(source.sentenceCount)),
    sentenceMean: boundedProfileNumber(source.sentenceMean, 0, 1000),
    sentenceStd: boundedProfileNumber(source.sentenceStd, 0, 1000),
    shortSentenceRatio: boundedProfileNumber(source.shortSentenceRatio, 0, 1),
    longSentenceRatio: boundedProfileNumber(source.longSentenceRatio, 0, 1),
    commaPerSentence: boundedProfileNumber(source.commaPerSentence, 0, 100),
    commaHistogram: Object.fromEntries(['0', '1', '2', '3', '4+'].map(key => [key, Math.floor(boundedProfileNumber(commaHistogram[key]))])),
    enumerationPerKilo: boundedProfileNumber(source.enumerationPerKilo, 0, 1000),
    dashPerKilo: boundedProfileNumber(source.dashPerKilo, 0, 1000),
    ellipsisPerKilo: boundedProfileNumber(source.ellipsisPerKilo, 0, 1000),
    reduplicationPerKilo: boundedProfileNumber(source.reduplicationPerKilo, 0, 1000),
    fourCharStructurePerKilo: boundedProfileNumber(source.fourCharStructurePerKilo, 0, 1000),
    measureWordPerKilo: boundedProfileNumber(source.measureWordPerKilo, 0, 1000),
    noPunctuationLongRatio: boundedProfileNumber(source.noPunctuationLongRatio, 0, 1),
    singleSentenceParaRatio: boundedProfileNumber(source.singleSentenceParaRatio, 0, 1),
    dialogueRowRatio: boundedProfileNumber(source.dialogueRowRatio, 0, 1),
    dialogueNarrationAlternation: boundedProfileNumber(source.dialogueNarrationAlternation, 0, 1),
    sourceWorkCount: Math.floor(boundedProfileNumber(source.sourceWorkCount)),
    dimensionCoverage: source.dimensionCoverage && typeof source.dimensionCoverage === 'object'
      ? Object.fromEntries(Object.entries(source.dimensionCoverage).slice(0, 12).map(([key, count]) => [normalizeMaterialText(key, 80), Math.floor(boundedProfileNumber(count))]))
      : {},
    dimensionCount: Math.floor(boundedProfileNumber(source.dimensionCount)),
    platformCount: Math.floor(boundedProfileNumber(source.platformCount)),
    reliabilityReasons: Array.isArray(source.reliabilityReasons)
      ? source.reliabilityReasons.map(value => normalizeMaterialText(value, 80)).filter(Boolean).slice(0, 12)
      : [],
    basis: normalizeMaterialText(source.basis, 240)
  };
}

/**
 * 规范化索引中的所有画像和原题材到题材桶的映射。
 * 参数：value 为索引 profiles 或 profileGenreMap 字段。
 * 返回值：只包含合法键和值的普通对象。
 */
function normalizeCharacterProfiles(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [key, profile] of Object.entries(value)) {
    if (!/^.{1,80}\|.{1,80}$/u.test(key)) continue;
    result[key.slice(0, 161)] = normalizeCharacterProfile(profile);
  }
  return result;
}

/**
 * 根据请求题材和画像映射表解析唯一题材桶。
 * 参数：genre 为用户作品题材；profileGenreMap 为原题材到桶的映射。
 * 返回值：题材桶名称或空字符串。
 */
function resolveProfileGenreBucket(genre, profileGenreMap) {
  const source = normalizeMaterialText(genre, 160);
  const values = source.split(/[、,，/／|\s]+/u).filter(Boolean);
  for (const value of values) {
    if (profileGenreMap && profileGenreMap[value]) return normalizeMaterialText(profileGenreMap[value], 80);
    if (['言情', '男频玄幻', '都市', '悬疑'].includes(value)) return value;
  }
  // 仅在复合字符串只对应一个桶时兼容无分隔符输入，避免把“玄幻都市”任选其一。
  const embedded = Object.entries(profileGenreMap || {})
    .filter(([value, bucket]) => value && bucket && source.includes(value))
    .sort((left, right) => right[0].length - left[0].length);
  const buckets = [...new Set(embedded.map(([, bucket]) => bucket))];
  if (buckets.length === 1) return normalizeMaterialText(buckets[0], 80);
  return '';
}

/** 从请求或样本元数据中提取原题材提示，并兼容无分隔符的复合输入。
 * 参数：values 为题材字符串或字符串数组；profileGenreMap 为原题材到聚合桶的映射。
 * 返回值：去重后的题材提示数组，保留显式值并补充映射表中能匹配到的原题材。
 */
function collectMaterialGenreHints(values, profileGenreMap = {}) {
  const source = (Array.isArray(values) ? values : [values])
    .flatMap(value => String(value || '').split(/[、,，/／|\s]+/u))
    .map(value => normalizeMaterialText(value, 80))
    .filter(Boolean);
  const knownGenres = Object.keys(profileGenreMap || {})
    .map(value => normalizeMaterialText(value, 80))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const result = new Set(source);
  for (const value of source) {
    for (const genre of knownGenres) {
      if (value.includes(genre)) result.add(genre);
    }
  }
  return [...result];
}

/** 判断一个强样本是否同时满足请求的类型、维度、题材、受众和画像范围。
 * 参数：item 为索引样本；request 为规范化人物素材请求；profileSelection 为画像选择结果；index 为规范化索引。
 * 返回值：满足全部可验证硬条件时返回 true，否则返回 false。
 */
function matchesMaterialSampleScope(item, request, profileSelection, index) {
  const sample = item && typeof item === 'object' ? item : {};
  if (request.archetypes.length && !request.archetypes.includes(sample.archetype)) return false;
  if (request.dimensions.length && !request.dimensions.includes(sample.dimension)) return false;
  if (request.audience && sample.audience !== request.audience) return false;

  const profileGenreMap = index?.profileGenreMap || {};
  const sampleGenres = collectMaterialGenreHints([
    ...(Array.isArray(sample.rawGenres) ? sample.rawGenres : []),
    sample.primaryGenre,
    sample.genre
  ], profileGenreMap);
  const requestGenres = collectMaterialGenreHints([request.genre, ...(request.genres || [])], profileGenreMap);
  const knownRequestGenres = requestGenres.filter(genre => Object.prototype.hasOwnProperty.call(profileGenreMap, genre));
  if (knownRequestGenres.length && !knownRequestGenres.some(genre => sampleGenres.includes(genre))) return false;

  const selectedKey = String(profileSelection?.key || '');
  if (selectedKey.includes('|raw:')) {
    const rawGenre = selectedKey.split('|raw:').slice(1).join('|raw:');
    const primaryGenre = String(sample.primaryGenre || '').trim();
    if (primaryGenre ? primaryGenre !== rawGenre : !sampleGenres.includes(rawGenre)) return false;
  } else if (profileSelection?.focusSlice) {
    const sliceRequest = { audience: sample.audience, genre: '', genres: sampleGenres };
    if (!matchesProfileFocusSlice(profileSelection.focusSlice, sliceRequest)) return false;
  } else if (profileSelection?.bucket && ['言情', '男频玄幻', '都市', '悬疑'].includes(profileSelection.bucket)) {
    if (sample.genreBucket !== profileSelection.bucket) return false;
  }
  return true;
}

/** 返回样本所属逻辑作品的稳定去重键，优先使用跨平台 canonicalWorkId。
 * 参数：item 为索引样本。
 * 返回值：用于 strong 样本去重的作品键。
 */
function materialSampleWorkKey(item) {
  const sample = item && typeof item === 'object' ? item : {};
  return String(sample.canonicalWorkId || sample.sourceWorkId || sample.sourceHash || sample.id || '').trim();
}

/** 规范化索引中的聚焦题材切片，避免运行时凭字符串顺序猜测复合题材。
 * 参数：value 为索引中的 focus slice 数组。
 * 返回值：只保留合法受众、题材和运行时键的切片数组。
 */
function normalizeProfileFocusSlices(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const source = item && typeof item === 'object' ? item : {};
    const genres = Array.isArray(source.genres)
      ? [...new Set(source.genres.map(value => normalizeMaterialText(value, 80)).filter(Boolean))].slice(0, 12)
      : [];
    return {
      id: normalizeMaterialText(source.id, 120),
      audience: normalizeMaterialText(source.audience, 40),
      genres,
      genreMatch: ['all', 'any', 'at_least'].includes(String(source.genreMatch || '').toLowerCase())
        ? String(source.genreMatch).toLowerCase()
        : 'all',
      minimumGenreHits: Math.max(1, Math.floor(Number(source.minimumGenreHits) || 1)),
      runtimeKey: normalizeMaterialText(source.runtimeKey, 180),
      requiresExplicitAudience: source.requiresExplicitAudience !== false
    };
  }).filter(item => item.id && item.runtimeKey && item.genres.length > 0);
}

/** 判断创作请求是否明确命中一个聚焦题材切片。
 * 参数：slice 为已规范化切片；request 为已规范化人物素材请求。
 * 返回值：同时满足受众和全部原题材标签时返回 true。
 */
function matchesProfileFocusSlice(slice, request) {
  if (!slice || !request) return false;
  if (slice.requiresExplicitAudience && !request.audience) return false;
  if (slice.audience && slice.audience !== request.audience) return false;
  const requestGenres = [...new Set([request.genre, ...(request.genres || [])].flatMap(value => String(value || '').split(/[、,，/／|\s]+/u)).filter(Boolean))];
  const matchedGenreCount = slice.genres.filter(genre => requestGenres.includes(genre)).length;
  if (slice.genreMatch === 'any') return matchedGenreCount >= 1;
  if (slice.genreMatch === 'at_least') return matchedGenreCount >= Math.min(slice.genres.length, slice.minimumGenreHits);
  return matchedGenreCount === slice.genres.length;
}

/**
 * 按类型、题材桶和全局兜底顺序检索统计画像。
 * 参数：index 为已规范化索引；request 为规范化人物素材请求。
 * 返回值：画像、命中键以及是否使用兜底的对象。
 */
function selectCharacterMaterialProfile(index, request) {
  const profiles = index && index.profiles && typeof index.profiles === 'object' ? index.profiles : {};
  const archetype = request.primaryArchetype || request.archetypes[0] || 'all';
  const focusSlice = (index.profileFocusSlices || []).find(slice => matchesProfileFocusSlice(slice, request)) || null;
  const bucket = focusSlice ? focusSlice.runtimeKey : resolveProfileGenreBucket(
    [request.genre, ...(request.genres || [])].filter(Boolean).join('、'),
    index.profileGenreMap || {}
  );
  if (index.profilesPublished === false) {
    return { profile: null, key: '', bucket, focusSlice, fallback: true, reason: 'profiles_not_published' };
  }
  const rawGenres = collectMaterialGenreHints([request.genre, ...(request.genres || [])], index.profileGenreMap || {});
  const candidates = [
    focusSlice ? `${archetype}|${focusSlice.runtimeKey}` : '',
    ...rawGenres.map(genre => `${archetype}|raw:${genre}`),
    `${archetype}|${bucket}`,
    `${archetype}|all`
  ].filter((key, position, values) => key && values.indexOf(key) === position);
  for (const key of candidates) {
    const profile = profiles[key];
    if (profile && profile.available && profile.reliable) {
      return { profile, key, bucket, focusSlice, fallback: key !== candidates[0], reason: '' };
    }
  }
  return { profile: null, key: '', bucket, focusSlice, fallback: true, reason: 'no_reliable_matching_profile' };
}

/**
 * 将统计画像渲染成不含原文的运行时语感锚点。
 * 参数：profile 为规范化画像；archetype、bucket 为请求标签；profileKey 为实际统计来源键。
 * 返回值：可注入模型 system message 的文本。
 */
function renderCharacterMaterialProfile(profile, archetype, bucket, profileKey = '') {
  const percent = value => `${(boundedProfileNumber(value, 0, 1) * 100).toFixed(1)}%`;
  const typeLabel = archetype || '未指定标准人物类型';
  const bucketLabel = bucket || '未指定题材桶';
  const comma = Number(profile.commaPerSentence || 0).toFixed(2);
  return [
    '<!-- molan-character-material-profile-v1 -->',
    `[语感锚点] 当前人物类型：${typeLabel}（题材：${bucketLabel}）`,
    `统计范围：${profileKey || '未指定'}（仅使用统计量，不包含原文）`,
    `真人原文统计画像：句长均值${Number(profile.sentenceMean || 0).toFixed(2)}字、标准差${Number(profile.sentenceStd || 0).toFixed(2)}，短句占比${percent(profile.shortSentenceRatio)}，长句占比${percent(profile.longSentenceRatio)}，平均每句${comma}个逗号。`,
    `标点与词汇频率：顿号每千字${Number(profile.enumerationPerKilo || 0).toFixed(2)}次，破折号${Number(profile.dashPerKilo || 0).toFixed(2)}次，省略号${Number(profile.ellipsisPerKilo || 0).toFixed(2)}次，叠词${Number(profile.reduplicationPerKilo || 0).toFixed(2)}次。`,
    '生成要求：保持相近的句长起伏和标点分布；允许铺陈后用三至五字短句收束；禁止连续三句等长，禁止连续两段都用对话开头。',
    '边界：画像只描述统计倾向，不复制任何原句；必须服从当前作品事实、章节任务、人物关系和纠错规则。'
  ].join('\n');
}

/**
 * 计算生成文本相对画像的节奏偏差，用于 usage 审计而不自动阻断输出。
 * 参数：text 为生成正文；profile 为目标统计画像。
 * 返回值：偏差数值、阈值和是否超标的对象；无画像时返回 available:false。
 */
function calculateCharacterMaterialRhythmDeviation(text, profile) {
  if (!profile || profile.available !== true) return { available: false, exceeded: false };
  const sentences = String(text || '')
    .split(/(?<=[。！？；])/u)
    .map(value => value.replace(/[\s\r\n“”‘’「」『』]/gu, '').trim())
    .filter(Boolean);
  const lengths = sentences.map(value => Array.from(value).length).filter(Boolean);
  const mean = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const variance = lengths.length ? lengths.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / lengths.length : 0;
  const std = Math.sqrt(variance);
  const shortRatio = lengths.length ? lengths.filter(value => value < 8).length / lengths.length : 0;
  const stdRelativeDeviation = profile.sentenceStd > 0 ? Math.abs(std - profile.sentenceStd) / profile.sentenceStd : (std > 0 ? 1 : 0);
  const shortPointDeviation = Math.abs(shortRatio - profile.shortSentenceRatio);
  return {
    available: true,
    sentenceCount: lengths.length,
    sentenceMean: Number(mean.toFixed(2)),
    sentenceStd: Number(std.toFixed(2)),
    shortSentenceRatio: Number(shortRatio.toFixed(4)),
    sentenceStdRelativeDeviation: Number(stdRelativeDeviation.toFixed(4)),
    shortSentencePointDeviation: Number(shortPointDeviation.toFixed(4)),
    thresholds: { sentenceStdRelativeDeviation: 0.4, shortSentencePointDeviation: 0.15 },
    exceeded: stdRelativeDeviation > 0.4 || shortPointDeviation > 0.15
  };
}

/** Build a minimal safe fallback index when the generated corpus is unavailable. */
function fallbackCharacterMaterialIndex() {
  const rules = GENERIC_RULES.map((rule, index) => ({
    id: `generic-rule-${index + 1}`,
    archetype: '',
    dimension: rule.dimension,
    rule: rule.rule,
    application: rule.application,
    caution: rule.caution,
    score: 1
  }));
  return {
    version: DEFAULT_INDEX_VERSION,
    published: false,
    general: { rules, samples: [] },
    mature: { rules, samples: [] },
    profiles: {},
    profilesPublished: false,
    profileGenreMap: {},
    audit: { manualReview: false, strongSamplesPublished: false, sampleResidualRate: null }
  };
}

/** Normalize generated index records and keep malformed corpus data out of runtime prompts. */
function normalizeCharacterMaterialIndex(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalizeBucket = (bucket, allowSensitive) => {
    const input = bucket && typeof bucket === 'object' ? bucket : {};
    const rules = Array.isArray(input.rules) ? input.rules.map((item, index) => ({
      id: normalizeMaterialText(item && item.id || `rule-${index + 1}`, 120),
      archetype: normalizeCharacterArchetype(item && item.archetype),
      dimension: normalizeCharacterDimension(item && item.dimension) || 'psychology',
      rule: normalizeMaterialText(item && item.rule, 800),
      application: normalizeMaterialText(item && item.application, 600),
      caution: normalizeMaterialText(item && item.caution, 600),
      scenes: Array.isArray(item && item.scenes) ? item.scenes.map(value => normalizeMaterialText(value, 120)).filter(Boolean).slice(0, 8) : [],
      scene: normalizeContextLabel(item && item.scene, SCENES),
      relationships: normalizeContextLabels(item && (item.relationships || item.relationship), RELATIONSHIPS),
      emotionalStates: normalizeContextLabels(item && (item.emotionalStates || item.emotionalState), EMOTIONAL_STATES),
      intent: normalizeMaterialText(item && item.intent, 160),
      signals: Array.isArray(item && item.signals) ? item.signals.map(value => normalizeMaterialText(value, 80)).filter(Boolean).slice(0, 12) : [],
      humanTextureSignals: normalizeContextLabels(item && item.humanTextureSignals, HUMAN_TEXTURE_SIGNALS, 80, 12),
      microPatterns: normalizeTextLabels(item && (item.microPatterns || item.microPattern), 120, 8),
      antiPatterns: normalizeTextLabels(item && (item.antiPatterns || item.antiPattern), 120, 8),
      score: Number(item && item.score) || 0
    })).filter(item => item.rule) : [];
    const samples = Array.isArray(input.samples) ? input.samples.map((item, index) => ({
      id: normalizeMaterialText(item && item.id || `sample-${index + 1}`, 120),
      archetype: normalizeCharacterArchetype(item && item.archetype),
      dimension: normalizeCharacterDimension(item && item.dimension) || 'psychology',
      corpus: item && item.corpus === 'mature' ? 'mature' : 'general',
      text: normalizeMaterialText(item && (item.text || item.sample), 140),
      sourceHash: normalizeMaterialText(item && item.sourceHash, 40),
      canonicalWorkId: normalizeMaterialText(item && item.canonicalWorkId, 120),
      sourceWorkId: normalizeMaterialText(item && item.sourceWorkId, 120),
      sourceNovelId: normalizeMaterialText(item && item.sourceNovelId, 80),
      platform: normalizeMaterialText(item && item.platform, 80),
      audience: normalizeMaterialText(item && item.audience, 40),
      genre: normalizeMaterialText(item && item.genre, 160),
      authorHash: normalizeMaterialText(item && (item.authorHash || item.sourceAuthorHash), 80),
      rawGenres: Array.isArray(item && item.rawGenres) ? item.rawGenres.map(value => normalizeMaterialText(value, 80)).filter(Boolean).slice(0, 12) : [],
      primaryGenre: normalizeMaterialText(item && item.primaryGenre, 80),
      genreBucket: normalizeMaterialText(item && item.genreBucket, 80),
      signals: Array.isArray(item && item.signals) ? item.signals.map(value => normalizeMaterialText(value, 80)).filter(Boolean).slice(0, 12) : [],
      scene: normalizeContextLabel(item && item.scene, SCENES),
      scenes: normalizeContextLabels(item && item.scenes, SCENES),
      relationship: normalizeContextLabel(item && item.relationship, RELATIONSHIPS),
      relationships: normalizeContextLabels(item && item.relationships, RELATIONSHIPS),
      emotionalState: normalizeContextLabels(item && item.emotionalState, EMOTIONAL_STATES),
      emotionalStates: normalizeContextLabels(item && item.emotionalStates, EMOTIONAL_STATES),
      intent: normalizeMaterialText(item && (item.intent || item.surfaceIntent), 160),
      surfaceIntent: normalizeMaterialText(item && item.surfaceIntent, 160),
      subtext: normalizeTextLabels(item && item.subtext, 160, 4),
      humanTextureSignals: normalizeContextLabels(item && item.humanTextureSignals, HUMAN_TEXTURE_SIGNALS, 80, 12),
      microPatterns: normalizeTextLabels(item && (item.microPatterns || item.microPattern), 120, 8),
      antiPatterns: normalizeTextLabels(item && (item.antiPatterns || item.antiPattern), 120, 8),
      forbiddenTerms: Array.isArray(item && item.forbiddenTerms) ? item.forbiddenTerms.map(value => normalizeMaterialText(value, 40)).filter(value => value.length >= 2).slice(0, 20) : [],
      residualTerms: Array.isArray(item && item.residualTerms) ? item.residualTerms.map(value => normalizeMaterialText(value, 40)).filter(value => value.length >= 2).slice(0, 20) : [],
      score: Number(item && item.score) || 0
    })).filter(item => item.text.length >= 12 && item.residualTerms.length === 0 && (allowSensitive || !SENSITIVE_PATTERN.test(item.text))) : [];
    return { rules, samples };
  };
  const audit = source.audit && typeof source.audit === 'object' ? source.audit : {};
  const general = normalizeBucket(source.general, false);
  const mature = normalizeBucket(source.mature, true);
  // A generated index may contain an audit manifest while waiting for the
  // required human review. Never expose those samples at runtime until the
  // manifest explicitly marks the strong corpus as published.
  if (audit.strongSamplesPublished !== true) {
    general.samples = [];
    mature.samples = [];
  }
  return {
    version: normalizeMaterialText(source.version || DEFAULT_INDEX_VERSION, 40),
    sourceHash: normalizeMaterialText(source.sourceHash, 80),
    // 发布状态缺失时按未发布处理，防止损坏或旧索引意外暴露样本。
    published: source.published === true && audit.strongSamplesPublished === true,
    general,
    mature,
    profiles: normalizeCharacterProfiles(source.profiles),
    // 新旧索引都按未发布处理，只有明确的 true 才允许运行时读取画像。
    profilesPublished: source.profilesPublished === true,
    profileFallback: normalizeMaterialText(source.profileFallback, 80),
    profileFocusSlices: normalizeProfileFocusSlices(source.profileFocusSlices),
    profileGenreMap: source.profileGenreMap && typeof source.profileGenreMap === 'object' && !Array.isArray(source.profileGenreMap)
      ? Object.fromEntries(Object.entries(source.profileGenreMap).map(([key, value]) => [normalizeMaterialText(key, 80), normalizeMaterialText(value, 80)]).filter(([key, value]) => key && value))
      : {},
    audit
  };
}

/** Read a JSON resource used by the administrator approval workflow. */
function readCharacterMaterialJson(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

/** Check the non-manual release gates before applying an administrator approval.
 * 参数：report 为与索引 sourceHash 绑定的质量报告。
 * 返回值：画像门禁、Markdown 门禁和待人工审批状态的逐项结果。
 */
function evaluateCharacterMaterialApprovalGates(report) {
  const source = report && typeof report === 'object' ? report : {};
  const profileRelease = source.profileRelease && typeof source.profileRelease === 'object'
    ? source.profileRelease
    : null;
  const publicationGate = source.publicationGate && typeof source.publicationGate === 'object'
    ? source.publicationGate
    : null;
  const publicationGateReasons = Array.isArray(publicationGate?.reasons)
    ? publicationGate.reasons.map(String).filter(Boolean)
    : [];
  const profileReleasePass = profileRelease?.pass === true;
  const publicationGatePass = publicationGate?.pass === true && publicationGateReasons.length === 0;
  const pendingHumanApprovalOnly = publicationGateReasons.length === 1
    && publicationGateReasons[0] === 'strong_samples_not_published';
  return {
    profileReleasePass,
    publicationGatePass,
    pendingHumanApprovalOnly,
    publicationApprovalReady: profileReleasePass && (publicationGatePass || pendingHumanApprovalOnly),
    publicationGateReasons
  };
}

/** Apply a persisted administrator approval to the audit samples at runtime. */
function applyCharacterMaterialApproval(index, indexPath) {
  const approvalPath = path.join(path.dirname(indexPath), '..', '..', 'data', 'character-material-audit.json');
  const approval = readCharacterMaterialJson(approvalPath);
  if (!approval || approval.approved !== true || String(approval.version || '') !== String(index.version || '')) return index;
  const report = readCharacterMaterialJson(path.join(path.dirname(indexPath), 'quality-report.json'));
  const indexSourceHash = String(index.sourceHash || '').trim();
  const reportSourceHash = String(report && report.sourceHash || '').trim();
  const approvalSourceHash = String(approval.sourceHash || '').trim();
  if (!report || !indexSourceHash || !reportSourceHash || !approvalSourceHash
    || indexSourceHash !== reportSourceHash || reportSourceHash !== approvalSourceHash
    || String(report.version || '') !== String(index.version || '')) return index;
  const releaseGates = evaluateCharacterMaterialApprovalGates(report);
  if (!releaseGates.publicationApprovalReady) return index;
  const auditSamples = report && report.manualReview && Array.isArray(report.manualReview.samples) ? report.manualReview.samples : [];
  const reviewedIds = new Set(Array.isArray(approval.reviewedIds) ? approval.reviewedIds.map(String) : []);
  const excludedIds = new Set(Array.isArray(approval.excludedIds) ? approval.excludedIds.map(String) : (Array.isArray(approval.residualIds) ? approval.residualIds.map(String) : []));
  const publishableSamples = auditSamples.filter(sample => !excludedIds.has(String(sample.id)));
  const residualSamples = publishableSamples.filter(sample => Array.isArray(sample.residualTerms) && sample.residualTerms.length > 0);
  const residualRate = publishableSamples.length ? Number((residualSamples.length / publishableSamples.length).toFixed(4)) : 1;
  if (!auditSamples.length || auditSamples.some(sample => !reviewedIds.has(String(sample.id))) || !publishableSamples.length || residualRate >= 0.02) return index;
  const approvedSamples = auditSamples
    .filter(sample => !excludedIds.has(String(sample.id)) && (!Array.isArray(sample.residualTerms) || sample.residualTerms.length === 0))
    .map(sample => ({
      ...sample,
      corpus: sample.corpus === 'mature' ? 'mature' : 'general',
      score: Number(sample.score) || 1
    }));
  const addUnique = (existing, rows) => {
    const seen = new Set(existing.map(item => item.id));
    return existing.concat(rows.filter(item => !seen.has(item.id)));
  };
  const generalSamples = approvedSamples.filter(sample => sample.corpus !== 'mature' && !SENSITIVE_PATTERN.test(sample.text));
  const matureSamples = approvedSamples.filter(sample => sample.corpus === 'mature' || SENSITIVE_PATTERN.test(sample.text));
  return {
    ...index,
    published: true,
    markdownPublished: true,
    general: { ...index.general, samples: addUnique(index.general.samples, generalSamples) },
    mature: { ...index.mature, samples: addUnique(index.mature.samples, matureSamples) },
    audit: {
      ...index.audit,
      strongSamplesPublished: true,
      markdownPublished: true,
      manualReview: true,
      approval: {
        version: approval.version,
        reviewedCount: reviewedIds.size,
        residualRate,
        excludedCount: excludedIds.size,
        publishableCount: approvedSamples.length,
        approvedAt: approval.approvedAt || null,
        approvedBy: approval.approvedBy || '',
        mode: approval.approvalMode || 'admin'
      }
    }
  };
}

/** 将用户作品的题材值解析到分片桶名（大小写、斜杠、泛化归一化）。
 * 参数：genre 为请求题材字符串；shards 为分片元数据清单；profileGenreMap 为题材到桶映射。
 * 返回值：命中的桶名，找不到则回退到“其他”桶或首个桶。
 */
function resolveShardBucket(genre, shards, profileGenreMap = {}) {
  const source = normalizeMaterialText(genre, 160);
  if (!Array.isArray(shards) || !shards.length) return '';
  const fallback = shards.find(s => s.bucket === '其他') || shards[0];
  if (!source) return fallback.bucket;
  const direct = shards.find(s => s.bucket === source);
  if (direct) return direct.bucket;
  // 先按通用题材映射表映射（如 玄幻 -> 男频玄幻），再精确命中。
  const mapped = resolveProfileGenreBucket(source, profileGenreMap);
  const byMapped = mapped && shards.find(s => s.bucket === mapped);
  if (byMapped) return byMapped.bucket;
  // 未映射时用包含关系：genre 包含桶名，或桶名包含 genre 片段。
  const contain = shards.find(s => source.includes(s.bucket) || s.bucket.replace(/^raw[/_]/, '').includes(source));
  if (contain) return contain.bucket;
  return fallback.bucket;
}

/** 分片模式：读取 sharded 元数据 + 命中题材桶的分片文件，组装成已发布索引。
 * 只把命中桶的 samples 读入内存，避免 100MB+ 全量索引导致 OOM。
 * 参数：shardRoot 为分片目录；options 含 genre、indexPath；返回值：组装后的索引对象，失败返回 null。
 */
function loadShardedCharacterMaterialIndex(shardRoot, options) {
  const metaPath = path.join(shardRoot, 'index.json');
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { return null; }
  const shards = Array.isArray(meta.buckets) ? meta.buckets : [];
  if (!shards.length) return null;
  const bucket = resolveShardBucket(options.genre || '', shards, meta.profileGenreMap || {});
  const shardMeta = shards.find(s => s.bucket === bucket) || shards.find(s => s.bucket === '其他') || shards[0];
  const filePath = path.join(shardRoot, String(shardMeta.file || ''));
  let slice;
  try { slice = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
  // 组装一个结构与全量索引同构、且标记为已发布的索引，确保下游 normalize 不清空样本。
  return normalizeCharacterMaterialIndex({
    version: meta.version || '',
    sourceHash: '',
    published: true,
    markdownPublished: true,
    general: {
      rules: Array.isArray(slice.rules) ? slice.rules : [],
      samples: Array.isArray(slice.samples) ? slice.samples : []
    },
    mature: { rules: [], samples: [] },
    profiles: {},
    profilesPublished: false,
    profileFallback: 'generic-rules',
    profileFocusSlices: Array.isArray(meta.profileFocusSlices) ? meta.profileFocusSlices : [],
    profileGenreMap: meta.profileGenreMap || {},
    audit: {
      strongSamplesPublished: true,
      markdownPublished: true,
      rawTextRuntime: true,
      sourcePolicy: 'original-local-corpus-only',
      materialTextPolicy: 'raw-source-excerpts-no-distillation-no-anonymization'
    }
  });
}

/** Load and cache the versioned character material index from the private lib directory. */
function loadCharacterMaterialIndex(options = {}) {
  const indexPath = options.indexPath || path.join(__dirname, 'character-material', 'index.json');
  const shardRoot = path.join(path.dirname(indexPath), 'sharded');
  // 分片模式：存在 sharded 目录时只加载一个题材桶，避免把 100MB+ 全量索引
  // 一次性读入内存导致 ECS 小内存实例 OOM 断连。
  if (fs.existsSync(path.join(shardRoot, 'index.json'))) {
    const loaded = loadShardedCharacterMaterialIndex(shardRoot, options);
    if (loaded) return loaded;
  }
  const approvalPath = path.join(path.dirname(indexPath), '..', '..', 'data', 'character-material-audit.json');
  const reportPath = path.join(path.dirname(indexPath), 'quality-report.json');
  const fileStamp = filePath => {
    try {
      const stat = fs.statSync(filePath);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch (_) {
      return '';
    }
  };
  const cacheKey = [fileStamp(indexPath), fileStamp(approvalPath), fileStamp(reportPath)].join('|');
  if (characterMaterialIndexCache && characterMaterialIndexCache.path === indexPath && characterMaterialIndexCache.cacheKey === cacheKey) {
    return characterMaterialIndexCache.value;
  }
  let value = fallbackCharacterMaterialIndex();
  try {
    value = normalizeCharacterMaterialIndex(JSON.parse(fs.readFileSync(indexPath, 'utf8')));
  } catch (_) {}
  if (value.audit.strongSamplesPublished !== true) value = applyCharacterMaterialApproval(value, indexPath);
  characterMaterialIndexCache = { path: indexPath, cacheKey, value };
  return value;
}

/** Clear the in-process index cache for tests or an explicit reload after publication. */
function resetCharacterMaterialIndexCache() {
  characterMaterialIndexCache = null;
}

/** Tokenize a short writing request into meaningful CJK chunks and Latin words for ranking. */
function materialQueryTokens(value) {
  const source = normalizeMaterialText(value, 1800).toLowerCase();
  const tokens = new Set((source.match(/[\u4e00-\u9fff]{2,4}|[a-z0-9_]{3,}/gi) || []).map(item => item.toLowerCase()));
  return [...tokens].slice(0, 80);
}

/** Score one corpus entry by type, dimension, scene clues and weak genre relevance. */
function scoreMaterialEntry(entry, request, isRule, profileGenreMap = {}) {
  const item = entry || {};
  const text = [
    item.rule,
    item.application,
    item.caution,
    item.text,
    item.scene,
    item.relationship,
    item.emotionalState,
    item.intent,
    ...(item.signals || []),
    ...(item.scenes || []),
    ...(item.relationships || []),
    ...(item.emotionalStates || []),
    ...(item.humanTextureSignals || [])
  ].join(' ').toLowerCase();
  const queryTokens = materialQueryTokens(request.query);
  const archetypeScore = request.archetypes.length
    ? (request.archetypes.includes(item.archetype) ? 100 : (item.archetype ? -30 : -10))
    : (item.archetype ? 4 : 18);
  const dimensionScore = request.dimensions.includes(item.dimension) ? 28 : -8;
  const queryScore = queryTokens.reduce((sum, token) => sum + (text.includes(token) ? 4 : 0), 0);
  const itemGenres = collectMaterialGenreHints([
    ...(Array.isArray(item.rawGenres) ? item.rawGenres : []),
    item.primaryGenre,
    item.genre
  ], profileGenreMap);
  const requestGenres = collectMaterialGenreHints([request.genre, ...(request.genres || [])], profileGenreMap);
  const genreScore = requestGenres.some(value => itemGenres.includes(value)) ? 8 : 0;
  const audienceScore = request.audience && item.audience === request.audience ? 4 : 0;
  const sceneScore = request.scene && (item.scene === request.scene || (item.scenes || []).includes(request.scene)) ? 24 : 0;
  const relationshipScore = request.relationship && (item.relationship === request.relationship || (item.relationships || []).includes(request.relationship)) ? 18 : 0;
  const emotionScore = request.emotionalState.some(value => item.emotionalState === value || (item.emotionalStates || []).includes(value)) ? 12 : 0;
  const intentScore = request.intent && item.intent && (item.intent.includes(request.intent) || request.intent.includes(item.intent)) ? 10 : 0;
  const textureScore = request.humanTextureSignals.some(value => (item.humanTextureSignals || []).includes(value)) ? 8 : 0;
  const kindScore = isRule ? 2 : 0;
  return archetypeScore + dimensionScore + queryScore + genreScore + audienceScore + sceneScore + relationshipScore + emotionScore + intentScore + textureScore + kindScore + Number(item.score || 0);
}

/** Choose a safe corpus bucket, keeping mature samples behind server-side admin and novel checks. */
function selectCharacterMaterialBucket(auth, request, index) {
  const wantsMature = request.index === 'mature' && request.matureEnabled === true;
  const authorized = wantsMature && auth && auth.characterMaterialAdmin === true && auth.characterMaterialMatureAllowed === true;
  if (authorized && index.mature && (index.mature.rules.length || index.mature.samples.length)) {
    return { bucket: index.mature, corpus: 'mature', fallback: false };
  }
  // 运行时索引可能暂时只有 strong 样本而没有规则，仍应使用已发布的 general 桶。
  if (index.general && (index.general.rules.length || index.general.samples.length)) {
    return { bucket: index.general, corpus: 'general', fallback: false };
  }
  return {
    bucket: index.general && index.general.rules.length ? index.general : fallbackCharacterMaterialIndex().general,
    corpus: 'general',
    fallback: wantsMature
  };
}

/** Retrieve ranked rule cards and a small diverse set of anonymous examples for one request. */
function retrieveCharacterMaterial(auth, requestValue, options = {}) {
  let request = normalizeCharacterMaterialRequest(requestValue);
  // 分片索引必须拿到请求题材：直接调用（未经过 buildCharacterMaterialBlock 透传）时若不传题材，
  // 会加载兜底“其他”桶，随后 matchesMaterialSampleScope 又按题材桶过滤样本，
  // 导致“都市”等可映射题材的 sampleCount 归零——这是本次修复的根因。
  const index = options.index
    ? normalizeCharacterMaterialIndex(options.index)
    : loadCharacterMaterialIndex({ ...options, genre: options.genre || request.genre || '' });
  // 发布门禁：请求 strong 模式但索引尚未通过人工发布，则降级为 auto，避免泄露未审样本
  let downgradeReason = '';
  if (['strong', 'raw'].includes(request.mode) && index.published !== true) {
    request = { ...request, mode: 'auto' };
    downgradeReason = 'corpus_not_published';
  }
  const selected = selectCharacterMaterialBucket(auth, request, index);
  const bucket = selected.bucket;
  const profileSelection = selectCharacterMaterialProfile(index, request);
  const typeRulePool = bucket.rules
    .filter(item => !request.archetypes.length || request.archetypes.includes(item.archetype))
    .sort((left, right) => scoreMaterialEntry(right, request, true, index.profileGenreMap) - scoreMaterialEntry(left, request, true, index.profileGenreMap));
  const genericRulePool = bucket.rules
    .filter(item => !item.archetype)
    .sort((left, right) => scoreMaterialEntry(right, request, true, index.profileGenreMap) - scoreMaterialEntry(left, request, true, index.profileGenreMap));
  const typeRules = rankMaterialCandidates(typeRulePool, request, {
    recentHistory: options.recentHistory || request.recentHistory,
    weights: options.rankingWeights
  });
  const genericRules = rankMaterialCandidates(genericRulePool, request, {
    recentHistory: options.recentHistory || request.recentHistory,
    weights: options.rankingWeights
  });
  const rulePool = request.archetypes.length ? typeRules : genericRules.concat(typeRules);
  const hasTypedRules = request.archetypes.length > 0 && typeRules.length > 0;
  const rules = request.mode === 'raw' ? [] : (rulePool.length ? rulePool : GENERIC_RULES).slice(0, 1);

  const scopedCandidates = bucket.samples
    .filter(item => matchesMaterialSampleScope(item, request, profileSelection, index))
    .slice()
    .sort((left, right) => scoreMaterialEntry(right, request, false, index.profileGenreMap) - scoreMaterialEntry(left, request, false, index.profileGenreMap));
  const candidates = rankMaterialCandidates(scopedCandidates, request, {
    recentHistory: options.recentHistory || request.recentHistory,
    weights: options.rankingWeights
  });
  const samples = [];
  const sourceSeen = new Set();
  const sampleAllowList = Array.isArray(options.sampleIds) ? new Set(options.sampleIds.map(String)) : null;
  if (['strong', 'raw'].includes(request.mode)) {
    for (const item of candidates) {
      if (sampleAllowList && !sampleAllowList.has(String(item.id))) continue;
      const source = materialSampleWorkKey(item);
      if (sourceSeen.has(source)) continue;
      sourceSeen.add(source);
      samples.push(item);
      if (samples.length >= 2) break;
    }
  }
  const audit = {
    enabled: request.enabled && request.proseTask,
    corpusVersion: index.version,
    corpus: selected.corpus,
    mode: request.mode,
    downgradeReason,
    archetype: request.primaryArchetype || '',
    archetypes: request.archetypes,
    archetypeSource: request.primarySource,
    archetypeConfidence: request.primaryConfidence,
    dimensions: request.dimensions,
    scene: request.scene,
    relationship: request.relationship,
    emotionalState: request.emotionalState,
    intent: request.intent,
    humanTextureSignals: request.humanTextureSignals,
    contextFallback: request.contextFallback,
    contextSource: request.contextSource,
    rankingWeights: options.rankingWeights || null,
    profileKey: profileSelection.key,
    profileBucket: profileSelection.bucket,
    profileFocusSlice: profileSelection.focusSlice ? profileSelection.focusSlice.id : '',
    profileAvailable: !!profileSelection.profile,
    profileFallback: profileSelection.fallback,
    profileReason: profileSelection.reason || '',
    profileSampleCount: profileSelection.profile ? profileSelection.profile.sampleCount : 0,
    ruleCount: request.mode === 'raw' ? 0 : request.enabled && request.proseTask ? rules.length : 0,
    sampleCount: request.enabled && request.proseTask ? samples.length : 0,
    fallback: selected.fallback || !request.archetypes.length || (request.archetypes.length > 0 && !hasTypedRules),
    samplesRemovedByBudget: false,
    rulesReducedByBudget: false,
    sampleSources: samples.map(item => item.sourceHash).filter(Boolean),
    reason: !request.enabled ? 'disabled_by_work' : !request.proseTask ? 'non_prose_task' : selected.fallback && request.index === 'mature' ? 'mature_not_authorized' : ''
  };
  return {
    request,
    index,
    audit,
    profile: profileSelection.profile,
    rules: request.enabled && request.proseTask ? rules : [],
    samples: request.enabled && request.proseTask ? samples : []
  };
}

/**
 * 懒加载完整段落样本库：读取 data/paragraph-samples.json，按文件 mtime+size 做进程内缓存。
 * 文件缺失、JSON 损坏、schema 不符或清洗后无有效样本时返回 null，让 strong 模式回退碎片样本逻辑。
 * 参数：options 可含 paragraphLibraryPath 覆盖默认路径（供测试注入）。
 * 返回值：{ buckets: [{ bucket, samples: [...] }] }，不可用时返回 null。
 */
function loadParagraphSampleLibrary(options = {}) {
  const filePath = options.paragraphLibraryPath || path.join(__dirname, '..', 'data', 'paragraph-samples.json');
  let stamp = '';
  try {
    const stat = fs.statSync(filePath);
    stamp = `${stat.mtimeMs}:${stat.size}`;
  } catch (_) {
    return null;
  }
  if (paragraphSampleLibraryCache && paragraphSampleLibraryCache.path === filePath && paragraphSampleLibraryCache.stamp === stamp) {
    return paragraphSampleLibraryCache.value;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !['paragraph-samples-1', 'paragraph-samples-2'].includes(parsed.schemaVersion) || !Array.isArray(parsed.buckets)) return null;
    const buckets = [];
    for (const entry of parsed.buckets) {
      const bucket = normalizeMaterialText(entry && entry.bucket, 80);
      if (!bucket) continue;
      const samples = [];
      const source = Array.isArray(entry && entry.samples) ? entry.samples : [];
      for (const item of source) {
        const sample = item && typeof item === 'object' ? item : {};
        const text = normalizeMaterialText(sample.text, 2000);
        const sourceKey = sample.filePath || `${bucket}/${sample.sourceTitle || sample.id || samples.length + 1}`;
        const anonymizedText = normalizeMaterialText(sample.anonymizedText, 2000) || anonymizeSampleText(text, sourceKey);
        const dimension = Object.prototype.hasOwnProperty.call(PARAGRAPH_DIMENSION_LABELS, sample.dimension) ? sample.dimension : 'action';
        // 只保留 300-800 字且不含显性敏感内容的段落组，保证注入样本形态一致（双重防线，构建脚本已过滤过一次）。
        if (text.length < 300 || text.length > 800 || SENSITIVE_PATTERN.test(text) || !anonymizedText) continue;
        samples.push({
          id: normalizeMaterialText(sample.id, 160) || `${bucket}-${samples.length + 1}`,
          bucket,
          dimension,
          dialogueRatio: Number(sample.dialogueRatio) || 0,
          charCount: text.length,
          sourceTitle: normalizeMaterialText(sample.sourceTitle, 160),
          text,
          anonymizedText
        });
      }
      if (samples.length) buckets.push({ bucket, samples });
    }
    if (!buckets.length) return null;
    const value = { buckets };
    paragraphSampleLibraryCache = { path: filePath, stamp, value };
    return value;
  } catch (_) {
    return null;
  }
}

/**
 * 判断请求题材词与段落库桶名是否双向包含命中（与 style-fingerprint 的 matchesGenre 同口径）。
 * 参数：request 为题材词；target 为桶名。比较前忽略大小写与空白。
 * 返回值：命中返回 true。
 */
function matchesParagraphBucket(request, target) {
  const req = String(request == null ? '' : request).toLowerCase().replace(/\s+/g, '');
  const tgt = String(target == null ? '' : target).toLowerCase().replace(/\s+/g, '');
  if (!req || !tgt) return false;
  return req.includes(tgt) || tgt.includes(req);
}

/**
 * 按题材解析段落候选池：请求的 genre 与 genres 按分隔符拆分后与桶名双向包含匹配，
 * 命中多个桶时合并样本；无任何命中时回退全部桶混抽（段落库没有 general 桶）。
 * 参数：library 为已加载段落库；request 为规范化人物素材请求。
 * 返回值：{ samples, buckets }，samples 为候选段落数组，buckets 为命中的桶名列表。
 */
function resolveParagraphSamplePool(library, request) {
  const tokens = [request.genre, ...(request.genres || [])]
    .flatMap(value => String(value || '').split(/[、,，/／|\s]+/u))
    .map(value => normalizeMaterialText(value, 80))
    .filter(Boolean);
  const matchedBuckets = [];
  for (const bucket of library.buckets) {
    if (tokens.some(token => matchesParagraphBucket(token, bucket.bucket))) {
      matchedBuckets.push(bucket);
    }
  }
  const useMatched = matchedBuckets.length > 0;
  const buckets = useMatched ? matchedBuckets : library.buckets;
  return {
    samples: buckets.flatMap(bucket => bucket.samples),
    buckets: buckets.map(bucket => bucket.bucket)
  };
}

/**
 * 从候选池按步长环形游走抽取样本：同一 seed 确定性地得到同一批样本，
 * 步长抽取保证覆盖池中不同位置（不同书、不同段落组），池不足时返回全部可用样本。
 * 参数：pool 为候选数组；count 为抽取数量；seed 为起始偏移。
 * 返回值：抽取结果数组。
 */
function pickParagraphSamplesByStride(pool, count, seed) {
  const picked = [];
  const used = new Set();
  if (!Array.isArray(pool) || !pool.length || count <= 0) return picked;
  const stride = Math.max(1, Math.floor(pool.length / count));
  let index = seed % pool.length;
  while (picked.length < count && used.size < pool.length) {
    if (!used.has(index)) {
      used.add(index);
      picked.push(pool[index]);
    }
    index = (index + stride) % pool.length;
  }
  return picked;
}

/**
 * 为 strong 模式构建完整段落样本块：按题材桶匹配候选池并做维度配额抽样——
 * 每轮至少 1 条非 dialogue 维度、dialogue 维度不超过 2 条，共取 3 条 300-800 字段落组。
 * 抽样种子取自请求本身（题材+query+novelId），保证同请求多次调用（含样本复核后的重建）得到同一批样本。
 * 参数：request 为规范化人物素材请求；options 可含 paragraphLibraryPath 与 sampleIds 白名单。
 * 返回值：{ text, samples, audit }；段落库不可用或白名单过滤后无样本时返回 null。
 */
function buildParagraphSampleBlock(request, options = {}) {
  const library = loadParagraphSampleLibrary(options);
  if (!library) return null;
  const normalized = request && typeof request === 'object' ? request : {};
  const pool = resolveParagraphSamplePool(library, normalized);
  if (!pool.samples.length) return null;
  const allowList = Array.isArray(options.sampleIds) ? new Set(options.sampleIds.map(String)) : null;
  const candidates = allowList ? pool.samples.filter(sample => allowList.has(String(sample.id))) : pool.samples;
  if (!candidates.length) return null;
  let seed = 0;
  try {
    const seedSource = [normalized.genre || '', (normalized.genres || []).join('、'), normalized.query || '', normalized.novelId || ''].join('|');
    seed = parseInt(crypto.createHash('md5').update(seedSource).digest('hex').slice(0, 8), 16) || 0;
  } catch (_) {
    seed = 0;
  }
  const dialoguePool = candidates.filter(sample => sample.dimension === 'dialogue');
  const otherPool = candidates.filter(sample => sample.dimension !== 'dialogue');
  // 维度配额：dialogue 至多 2 条，剩余名额给非 dialogue 维度（保证每轮至少 1 条非 dialogue）。
  const dialogueQuota = Math.min(2, dialoguePool.length);
  const otherQuota = Math.min(PARAGRAPH_SAMPLE_COUNT - dialogueQuota, otherPool.length);
  const picked = [
    ...pickParagraphSamplesByStride(otherPool, otherQuota, seed),
    ...pickParagraphSamplesByStride(dialoguePool, dialogueQuota, seed + 1)
  ];
  if (!picked.length) return null;
  const text = [
    '<!-- molan-character-material-paragraph-samples-v1 -->',
    '原文人物描写段落样本（300-800 字完整段落组，仅观察动作推进、感官细节、信息取舍和对话节奏，禁止逐字复用）：',
      ...picked.map((sample, index) => `${index + 1}. [${PARAGRAPH_DIMENSION_LABELS[sample.dimension] || sample.dimension}] ${sample.anonymizedText || sample.text}`),
    '原创性边界：不得复制样本连续片段，不得输出样本中可能残留的专名；段落样本只作为机制示范，不是答案。'
  ].join('\n');
  return {
    text,
    samples: picked.map(sample => ({
      id: sample.id,
      bucket: sample.bucket,
      dimension: sample.dimension,
      dialogueRatio: sample.dialogueRatio,
      charCount: sample.charCount,
      sourceTitle: sample.sourceTitle,
      text: sample.anonymizedText || sample.text,
      anonymizedText: sample.anonymizedText || sample.text,
      forbiddenTerms: []
    })),
    audit: {
      enabled: true,
      sampleCount: picked.length,
      dimensions: picked.map(sample => sample.dimension),
      buckets: pool.buckets,
      mode: 'paragraph-strong'
    }
  };
}

/** Build the two-level prompt block used by auto and strong writing modes. */
function buildCharacterMaterialBlock(auth, requestValue, options = {}) {
  // 把请求题材透传给索引加载，使分片模式能按题材只加载命中分片，避免全量 OOM。
  const genre = requestValue && requestValue.genre;
  const retrieval = retrieveCharacterMaterial(auth, requestValue, genre ? { ...options, genre } : options);
  const { request, audit, profile, rules, samples } = retrieval;
  if (!audit.enabled) return { messages: [], retrieval, request, rules: [], samples: [], audit };
  const voiceBlock = buildCharacterVoiceDirectiveBlock(request.characters);
  if (request.mode === 'raw') {
    if (!samples.length) {
      if (voiceBlock) {
        return {
          messages: [markCharacterMaterialMessage({ role: 'system', content: voiceBlock }, 'rules')],
          retrieval,
          request,
          rules: [],
          samples,
          audit: { ...audit, ruleCount: 0, voiceInjected: true }
        };
      }
      return { messages: [], retrieval, request, rules: [], samples, audit: { ...audit, ruleCount: 0 } };
    }
    const sampleText = [
      '<!-- molan-character-material-raw-samples-v1 -->',
      voiceBlock ? (voiceBlock + '\n\n') : '',
      '原文人物描写参考（以下内容直接来自用户本地小说原本，保持原文，不是待续写正文）：',
      ...samples.map((item, index) => `${index + 1}. [${CHARACTER_DIMENSIONS.find(d => d.id === item.dimension)?.label || item.dimension}] ${item.text}`),
      '使用边界：只观察人物在具体关系和情境中的行为、信息取舍、语气和反应，不得复述、照抄或改写成相近句式；新正文必须根据当前作品事实原创。'
    ].filter(Boolean).join('\n');
    return {
      messages: [markCharacterMaterialMessage({ role: 'system', content: sampleText }, 'sample')],
      retrieval,
      request,
      rules: [],
      samples,
      audit: { ...audit, ruleCount: 0, profileInjected: false, rawSamplesInjected: true, voiceInjected: !!voiceBlock }
    };
  }
  if (request.mode === 'auto' && profile) {
    const profileText = renderCharacterMaterialProfile(profile, request.primaryArchetype, audit.profileBucket, audit.profileKey);
    const content = voiceBlock ? (profileText + '\n\n' + voiceBlock) : profileText;
    return {
      messages: [markCharacterMaterialMessage({ role: 'system', content }, 'rules')],
      retrieval,
      request,
      rules: [],
      samples,
      audit: { ...audit, ruleCount: 0, profileInjected: true }
    };
  }
  const typeLabel = audit.archetype || '未指定标准人物类型，使用通用描写规则';
  const contextLabels = [
    audit.scene && `场景：${audit.scene}`,
    audit.relationship && `关系：${audit.relationship}`,
    audit.emotionalState && audit.emotionalState.length ? `状态：${audit.emotionalState.join('、')}` : '',
    audit.intent && `意图：${audit.intent}`,
    audit.humanTextureSignals && audit.humanTextureSignals.length ? `Human Texture 信号：${audit.humanTextureSignals.join('、')}` : ''
  ].filter(Boolean);
  const ruleText = [
    '<!-- molan-character-material-rules-v1 -->',
    '人物描写素材规则卡（只提取写法机制，不复制任何原句）：',
    `当前标准人物类型：${typeLabel}`,
    `来源：${audit.archetypeSource === 'explicit' ? '用户指定' : audit.archetypeSource === 'inferred' ? '根据人物卡关键词推断' : '通用规则'}`,
    contextLabels.length ? `当前情境：${contextLabels.join('；')}` : '当前情境：未能可靠提取，回退到人物类型和题材。',
    ...rules.map((item, index) => `${index + 1}. [${CHARACTER_DIMENSIONS.find(d => d.id === item.dimension)?.label || item.dimension}] ${item.rule}${item.application ? ` 落点：${item.application}` : ''}${item.caution ? ` 注意：${item.caution}` : ''}`),
    '执行边界：规则必须服从当前作品事实、章节任务、Skill 和纠错库；只在当前任务确实涉及人物描写时使用。',
    '迁移边界：这些内容只用于学习行为机制、关系机制和表达结构；禁止照抄措辞、复述原句或套用固定比喻。'
  ].join('\n');
  const fullRuleText = voiceBlock ? (ruleText + '\n\n' + voiceBlock) : ruleText;
  const messages = [markCharacterMaterialMessage({ role: 'system', content: fullRuleText }, 'rules')];
  if (request.mode === 'strong') {
    // 段落库可用时用完整段落组（300-800 字）替代 ≤140 字碎片样本注入，规则卡保持不变；
    // 段落样本放入返回值 samples 字段，服务端 scanCharacterMaterialOverlap 仍对其做 12 字重叠扫描。
    const paragraphBlock = buildParagraphSampleBlock(request, options);
    if (paragraphBlock && paragraphBlock.samples.length) {
      messages.push(markCharacterMaterialMessage({ role: 'system', content: paragraphBlock.text }, 'sample'));
      return {
        messages,
        retrieval,
        request,
        rules,
        samples: paragraphBlock.samples,
        audit: {
          ...audit,
          paragraphSamples: true,
          sampleCount: paragraphBlock.audit.sampleCount,
          sampleSources: [],
          paragraphDimensions: paragraphBlock.audit.dimensions,
          paragraphBuckets: paragraphBlock.audit.buckets,
          paragraphMode: paragraphBlock.audit.mode
        }
      };
    }
    // 段落库不可用时回退现有碎片样本逻辑，保持既有行为与测试兼容。
    if (samples.length) {
      const sampleText = [
        '<!-- molan-character-material-samples-v1 -->',
        '原文人物描写样本（仅观察动作、感官、信息过滤和节奏，禁止逐字复用）：',
        ...samples.map((item, index) => `${index + 1}. [${CHARACTER_DIMENSIONS.find(d => d.id === item.dimension)?.label || item.dimension}] ${item.text}`),
        '原创性边界：不得复制样本连续片段，不得输出样本中可能残留的专名；样本只作为少量机制示范，不是答案。'
      ].join('\n');
      messages.push(markCharacterMaterialMessage({ role: 'system', content: sampleText }, 'sample'));
    }
  }
  return { messages, retrieval, request, rules, samples, audit };
}

/** Normalize text for local overlap checks while ignoring punctuation and whitespace. */
function normalizeOverlapText(value) {
  return normalizeMaterialText(value, 200000).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** Scan generated prose for long source fragments and forbidden corpus proper-name leakage. */
function scanCharacterMaterialOverlap(text, samples = [], forbiddenTerms = []) {
  const generated = normalizeOverlapText(text);
  const overlapFragments = [];
  const seen = new Set();
  for (const sample of Array.isArray(samples) ? samples : []) {
    const source = normalizeOverlapText(sample && (sample.text || sample.sample));
    if (source.length < 12) continue;
    for (let index = 0; index <= source.length - 12 && overlapFragments.length < 5; index += 1) {
      const fragment = source.slice(index, index + 12);
      if (seen.has(fragment) || !generated.includes(fragment)) continue;
      seen.add(fragment);
      overlapFragments.push({ hash: materialSourceHash(fragment), length: 12 });
    }
  }
  const leakedTerms = [...new Set((Array.isArray(forbiddenTerms) ? forbiddenTerms : [])
    .map(value => normalizeMaterialText(value, 60))
    .filter(value => value.length >= 2 && generated.includes(normalizeOverlapText(value)))
  )].slice(0, 10).map(value => ({ hash: materialSourceHash(value), length: value.length }));
  return {
    checkedSampleCount: Array.isArray(samples) ? samples.length : 0,
    overlapFragments,
    leakedTerms,
    blocked: overlapFragments.length > 0 || leakedTerms.length > 0
  };
}

/** Return the complete generic rule set for tests and index-build fallbacks. */
function genericCharacterRules() {
  return GENERIC_RULES.map(item => ({ ...item }));
}

module.exports = {
  CHARACTER_ARCHETYPES,
  CHARACTER_DIMENSIONS,
  SCENES,
  RELATIONSHIPS,
  EMOTIONAL_STATES,
  HUMAN_TEXTURE_SIGNALS,
  ARCHETYPE_KEYWORDS,
  CHARACTER_MATERIAL_MESSAGE_FLAG,
  normalizeCharacterArchetype,
  normalizeCharacterDimension,
  normalizeCharacterDimensions,
  inferCharacterArchetype,
  resolveCharacterArchetypes,
  normalizeCharacterVoiceContract,
  buildCharacterVoiceDirectiveBlock,
  normalizeCharacterMaterialRequest,
  extractGenerationContext,
  rankMaterialCandidates,
  markCharacterMaterialMessage,
  copyCharacterMaterialMessageFlag,
  characterMaterialMessageMeta,
  loadCharacterMaterialIndex,
  resolveShardBucket,
  loadShardedCharacterMaterialIndex,
  resetCharacterMaterialIndexCache,
  evaluateCharacterMaterialApprovalGates,
  retrieveCharacterMaterial,
  buildCharacterMaterialBlock,
  buildParagraphSampleBlock,
  anonymizeParagraphSample,
  anonymizeSampleText,
  resetParagraphAnonymizationCache,
  calculateCharacterMaterialRhythmDeviation,
  normalizeCharacterProfile,
  scanCharacterMaterialOverlap,
  genericCharacterRules,
  materialSourceHash,
  SENSITIVE_PATTERN
};
