const freezeList = values => Object.freeze([...values]);

const SCENE_WHITELIST = freezeList([
  '日常', '闲聊', '独处', '重逢', '离别', '冲突', '争吵', '谈判', '试探', '安慰', '关心', '拒绝',
  '告白', '暧昧', '吃醋', '误解', '和解', '失败', '胜利', '危机', '战斗', '战后', '公开场合', '私下场合'
]);

const RELATIONSHIP_WHITELIST = freezeList([
  '陌生人', '普通朋友', '亲密朋友', '恋人', '暧昧对象', '夫妻', '家人', '父子', '母子', '兄弟姐妹',
  '师徒', '上下级', '同僚', '竞争者', '敌对', '陌生但有利益关系'
]);

const EMOTIONAL_STATE_WHITELIST = freezeList([
  '平静', '紧张', '尴尬', '防备', '期待', '失望', '委屈', '羞耻', '得意', '心虚', '担忧', '嘴硬',
  '压抑', '兴奋', '疲惫', '走神'
]);

const INTENT_WHITELIST = freezeList([
  '询问', '确认对方态度', '试探', '表达关心', '安慰', '拒绝', '接受', '解释', '道歉', '说服', '警告',
  '威胁', '请求', '求助', '隐瞒', '转移话题', '争取主动', '保护自尊', '缓解尴尬', '维持体面', '告白',
  '挽留', '观察反应'
]);

const DIMENSION_WHITELIST = freezeList([
  'appearance', 'expression', 'action', 'dialogue', 'catchphrase', 'psychology'
]);

const HUMAN_TEXTURE_SIGNAL_WHITELIST = freezeList([
  'hesitation', 'pause', 'self_correction', 'unfinished_thought', 'uncertainty',
  'avoidance', 'deflection', 'misdirection', 'withholding', 'topic_shift',
  'fragment', 'repetition', 'interruption', 'repair', 'vague_reference', 'casual_filler',
  'self_contradiction', 'emotion_vs_action', 'speech_vs_action', 'public_private_difference', 'want_but_refuse',
  'habitual_gesture', 'object_habit', 'body_habit', 'speech_habit', 'avoidance_habit',
  'save_face', 'politeness_mask', 'status_awareness', 'social_pressure', 'reading_the_room',
  'sensory_anchor', 'object_anchor', 'spatial_anchor', 'body_detail', 'environment_detail',
  'underreaction', 'overreaction', 'delayed_reaction', 'misplaced_attention', 'unexpected_focus',
  'implicit_emotion', 'reader_inference', 'unexplained_reaction', 'silent_response'
]);

const ARCHETYPE_WHITELIST = freezeList([
  '豪爽侠义型', '冷静理智型', '温柔内敛型', '活泼开朗型', '阴郁腹黑型', '霸道强势型', '天真烂漫型',
  '市侩圆滑型', '高傲冷峻型', '热血冲动型'
]);

const CONTEXT_WHITELIST = Object.freeze({
  scene: SCENE_WHITELIST,
  relationship: RELATIONSHIP_WHITELIST,
  emotionalState: EMOTIONAL_STATE_WHITELIST,
  intent: INTENT_WHITELIST,
  dimension: DIMENSION_WHITELIST,
  humanTextureSignals: HUMAN_TEXTURE_SIGNAL_WHITELIST
});

const SCORE_WEIGHTS = Object.freeze({
  scene: 0.35,
  relationship: 0.20,
  dimension: 0.15,
  texture: 0.10,
  archetype: 0.10,
  diversity: 0.10
});

const DIVERSITY_PENALTIES = Object.freeze({
  sameBook: 0.45,
  sameAuthor: 0.30,
  sameMicroPattern: 0.25
});

const SCENE_ALIASES = {
  '日常': ['日常生活', 'everyday'],
  '闲聊': ['聊天', '闲谈', '说笑'],
  '独处': ['独自', '一个人'],
  '重逢': ['再会', '相逢', '久别重逢'],
  '离别': ['分别', '告别', '送行'],
  '冲突': ['对峙', '争执'],
  '争吵': ['吵架', '争论'],
  '谈判': ['协商', '交涉', '交易'],
  '试探': ['旁敲侧击', '探口风'],
  '安慰': ['宽慰', '哄'],
  '关心': ['照顾', '担心'],
  '拒绝': ['不答应', '不愿意'],
  '告白': ['表白', '表明心意'],
  '暧昧': ['关系暧昧'],
  '吃醋': ['嫉妒'],
  '误解': ['误会'],
  '和解': ['原谅', '握手言和'],
  '失败': ['失手', '落败', '没成功'],
  '胜利': ['获胜', '赢了', '成功'],
  '危机': ['危险', '生死关头', '追杀'],
  '战斗': ['厮杀', '交战'],
  '战后': ['战斗结束', '收拾残局'],
  '公开场合': ['当众', '大庭广众', '众目睽睽'],
  '私下场合': ['私下', '无人处', '关起门来']
};

const RELATIONSHIP_ALIASES = {
  '陌生人': ['初次见面'],
  '普通朋友': ['朋友'],
  '亲密朋友': ['好友', '挚友'],
  '恋人': ['情侣', '男朋友', '女朋友'],
  '暧昧对象': ['暧昧', '暧昧关系', '关系暧昧'],
  '夫妻': ['夫妇', '丈夫', '妻子'],
  '家人': ['亲人'],
  '父子': ['父亲和儿子', '爸爸和儿子'],
  '母子': ['母亲和儿子', '妈妈和儿子'],
  '兄弟姐妹': ['兄弟', '姐妹', '哥哥', '弟弟', '姐姐', '妹妹'],
  '师徒': ['师父', '徒弟'],
  '上下级': ['上司', '下属'],
  '同僚': ['同事'],
  '竞争者': ['对手', '竞争关系'],
  '敌对': ['敌人', '仇人', '对立'],
  '陌生但有利益关系': ['利益关系', '合作关系']
};

const EMOTION_ALIASES = {
  '平静': ['镇定', '安静'],
  '紧张': ['不安'],
  '尴尬': ['窘迫'],
  '防备': ['戒备', '警惕'],
  '期待': ['盼望'],
  '失望': ['落空'],
  '委屈': ['受委屈'],
  '羞耻': ['羞愧'],
  '得意': ['自得'],
  '心虚': ['心慌'],
  '担忧': ['忧虑'],
  '嘴硬': ['口是心非'],
  '压抑': ['憋闷'],
  '兴奋': ['激动'],
  '疲惫': ['疲倦', '累'],
  '走神': ['出神']
};

const INTENT_ALIASES = {
  '询问': ['提问'],
  '确认对方态度': ['确认心意', '确认态度'],
  '表达关心': ['关怀'],
  '拒绝': ['推辞'],
  '接受': ['答应', '同意'],
  '解释': ['说明', '澄清'],
  '道歉': ['赔罪'],
  '说服': ['劝说'],
  '警告': ['提醒'],
  '请求': ['拜托'],
  '隐瞒': ['掩饰'],
  '转移话题': ['岔开话题'],
  '争取主动': ['占据主动'],
  '保护自尊': ['维护面子'],
  '缓解尴尬': ['打圆场', '解围'],
  '维持体面': ['顾全面子'],
  '告白': ['表白'],
  '挽留': ['挽回'],
  '观察反应': ['看反应', '看脸色']
};

const DIMENSION_ALIASES = {
  appearance: ['外貌', '外形', '长相'],
  expression: ['神态', '表情'],
  action: ['动作', '行为'],
  dialogue: ['语言', '对白', '说话'],
  catchphrase: ['口头禅', '高频语气'],
  psychology: ['心理', '内心', '想法']
};

const TEXTURE_ALIASES = {
  hesitation: ['犹豫', '迟疑'],
  pause: ['停顿'],
  self_correction: ['自我纠正', '改口'],
  unfinished_thought: ['欲言又止', '未说完'],
  uncertainty: ['不确定', '不知所措'],
  avoidance: ['回避'],
  deflection: ['搪塞', '敷衍'],
  misdirection: ['误导'],
  withholding: ['隐瞒'],
  topic_shift: ['转移话题'],
  fragment: ['碎片化表达'],
  repetition: ['重复'],
  interruption: ['打断', '插话'],
  repair: ['修正说法'],
  vague_reference: ['模糊指代'],
  casual_filler: ['口头填充'],
  self_contradiction: ['自相矛盾'],
  emotion_vs_action: ['情绪与行动不一致'],
  speech_vs_action: ['言行不一'],
  public_private_difference: ['公开与私下反差'],
  want_but_refuse: ['想要却拒绝'],
  habitual_gesture: ['习惯动作'],
  object_habit: ['物件习惯'],
  body_habit: ['身体习惯'],
  speech_habit: ['语言习惯'],
  avoidance_habit: ['回避习惯'],
  save_face: ['顾全面子'],
  politeness_mask: ['礼貌面具'],
  status_awareness: ['身份意识'],
  social_pressure: ['社交压力'],
  reading_the_room: ['察言观色'],
  sensory_anchor: ['感官锚点'],
  object_anchor: ['物件锚点'],
  spatial_anchor: ['空间锚点'],
  body_detail: ['身体细节'],
  environment_detail: ['环境细节'],
  underreaction: ['反应偏弱'],
  overreaction: ['反应过度'],
  delayed_reaction: ['延迟反应'],
  misplaced_attention: ['注意力错位'],
  unexpected_focus: ['意外关注'],
  implicit_emotion: ['隐含情绪'],
  reader_inference: ['读者推断'],
  unexplained_reaction: ['无解释反应'],
  silent_response: ['沉默回应']
};

function createLookup(values, aliases = {}) {
  const lookup = new Map(values.map(value => [normalizeKey(value), value]));
  for (const [canonical, names] of Object.entries(aliases)) {
    for (const name of names) lookup.set(normalizeKey(name), canonical);
  }
  return lookup;
}

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/gu, ' ');
}

const LOOKUPS = Object.freeze({
  scene: createLookup(SCENE_WHITELIST, SCENE_ALIASES),
  relationship: createLookup(RELATIONSHIP_WHITELIST, RELATIONSHIP_ALIASES),
  emotionalState: createLookup(EMOTIONAL_STATE_WHITELIST, EMOTION_ALIASES),
  intent: createLookup(INTENT_WHITELIST, INTENT_ALIASES),
  dimension: createLookup(DIMENSION_WHITELIST, DIMENSION_ALIASES),
  humanTextureSignals: createLookup(HUMAN_TEXTURE_SIGNAL_WHITELIST, TEXTURE_ALIASES),
  archetype: createLookup(ARCHETYPE_WHITELIST)
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeOne(value, lookup) {
  const key = normalizeKey(value);
  if (!key) return '';
  return lookup.get(key) || '';
}

function normalizeList(value, lookup) {
  const source = Array.isArray(value) ? value : [value];
  const result = [];
  for (const item of source) {
    const direct = normalizeOne(item, lookup);
    if (direct) {
      result.push(direct);
      continue;
    }
    const text = normalizeText(item);
    if (!text) continue;
    for (const part of text.split(/[、,，/／|;；\n]+/u)) {
      const normalized = normalizeOne(part, lookup);
      if (normalized) result.push(normalized);
    }
  }
  return unique(result);
}

function firstNormalized(objects, keys, lookup, many = false) {
  for (const object of objects) {
    if (!isRecord(object)) continue;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
      const result = many ? normalizeList(object[key], lookup) : normalizeOne(object[key], lookup);
      if (many ? result.length > 0 : result) return result;
    }
  }
  return many ? [] : '';
}

function toRegExp(pattern) {
  if (pattern instanceof RegExp) {
    return new RegExp(pattern.source, pattern.flags.replace('g', ''));
  }
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'u');
}

function rule(label, patterns, weight = 1) {
  return Object.freeze({ label, patterns: Object.freeze(patterns), weight });
}

const SCENE_RULES = [
  rule('日常', ['日常', '吃饭', '喝水', '做饭', '买菜', '起床', '回家']),
  rule('闲聊', ['闲聊', '聊天', '闲谈', '随口', '说笑']),
  rule('独处', ['独处', '独自', '一个人', '无人陪伴']),
  rule('重逢', ['重逢', '再会', '相逢', '久别']),
  rule('离别', ['离别', '分别', '告别', '送行', '离开']),
  rule('冲突', ['冲突', '对峙', '争执']),
  rule('争吵', ['争吵', '吵架', '争论', '大吼']),
  rule('谈判', ['谈判', '协商', '交涉', '交易', '条件']),
  rule('试探', ['试探', '旁敲侧击', '探口风', '看他反应', '确认态度'], 2),
  rule('安慰', ['安慰', '宽慰', '哄他', '哄她', '别难过', '没事']),
  rule('关心', ['关心', '照顾', '担心', '询问伤势']),
  rule('拒绝', ['拒绝', '不答应', '不愿意', '随你']),
  rule('告白', ['告白', '表白', '表明心意', '喜欢你', '爱你'], 2),
  rule('暧昧', ['暧昧', '关系暧昧', '心动']),
  rule('吃醋', ['吃醋', '嫉妒']),
  rule('误解', ['误解', '误会']),
  rule('和解', ['和解', '原谅', '握手言和']),
  rule('失败', ['失败', '失手', '落败', '没成功']),
  rule('胜利', ['胜利', '获胜', '赢了', '成功']),
  rule('危机', ['危机', '危险', '生死关头', '追杀', '逃命'], 2),
  rule('战斗', ['战斗', '厮杀', '交战', '挥刀', '出剑']),
  rule('战后', ['战后', '战斗结束', '收拾残局']),
  rule('公开场合', ['公开场合', '当众', '大庭广众', '众目睽睽', '宴会', '朝堂']),
  rule('私下场合', ['私下', '无人处', '关起门来'])
];

const RELATIONSHIP_RULES = [
  rule('陌生人', ['陌生人', '初次见面']),
  rule('普通朋友', ['普通朋友', '朋友']),
  rule('亲密朋友', ['亲密朋友', '好友', '挚友']),
  rule('恋人', ['恋人', '情侣', '男朋友', '女朋友']),
  rule('暧昧对象', ['暧昧对象', '暧昧关系', '关系暧昧', '暧昧']),
  rule('夫妻', ['夫妻', '夫妇', '丈夫', '妻子']),
  rule('父子', ['父子', '父亲和儿子', '爸爸和儿子']),
  rule('母子', ['母子', '母亲和儿子', '妈妈和儿子']),
  rule('兄弟姐妹', ['兄弟姐妹', '兄弟', '姐妹', '哥哥', '弟弟', '姐姐', '妹妹']),
  rule('家人', ['家人', '亲人']),
  rule('师徒', ['师徒', '师父', '徒弟']),
  rule('上下级', ['上下级', '上司', '下属']),
  rule('同僚', ['同僚', '同事']),
  rule('竞争者', ['竞争者', '对手', '竞争关系']),
  rule('敌对', ['敌对', '敌人', '仇人', '对立'], 2),
  rule('陌生但有利益关系', ['陌生但有利益关系', '利益关系', '合作关系'])
];

const EMOTION_RULES = [
  rule('平静', ['平静', '镇定', '安静']),
  rule('紧张', ['紧张', '不安']),
  rule('尴尬', ['尴尬', '窘迫']),
  rule('防备', ['防备', '戒备', '警惕']),
  rule('期待', ['期待', '盼望']),
  rule('失望', ['失望', '落空']),
  rule('委屈', ['委屈', '受委屈']),
  rule('羞耻', ['羞耻', '羞愧']),
  rule('得意', ['得意', '自得']),
  rule('心虚', ['心虚', '心慌']),
  rule('担忧', ['担忧', '忧虑', '担心', '受伤', '伤势', '伤口']),
  rule('嘴硬', ['嘴硬', '口是心非']),
  rule('压抑', ['压抑', '憋闷']),
  rule('兴奋', ['兴奋', '激动']),
  rule('疲惫', ['疲惫', '疲倦', '累']),
  rule('走神', ['走神', '出神'])
];

const INTENT_RULES = [
  rule('确认对方态度', [
    '确认对方态度',
    '确认心意',
    '确认态度',
    '看他反应',
    '看她反应',
    /确认.{0,6}(?:对方|他|她).{0,6}(?:态度|是否|说谎|真假)/u
  ], 2),
  rule('观察反应', ['观察反应', '看反应', '看脸色']),
  rule('试探', ['试探', '旁敲侧击', '探口风']),
  rule('询问', ['询问', '问道', '问他', '问她', '开口问']),
  rule('表达关心', ['表达关心', '关心', '照顾', '担心']),
  rule('安慰', ['安慰', '宽慰', '别难过', '没事']),
  rule('拒绝', ['拒绝', '不答应', '不愿意']),
  rule('接受', ['接受', '答应', '同意']),
  rule('解释', ['解释', '说明', '澄清']),
  rule('道歉', ['道歉', '对不起', '抱歉']),
  rule('说服', ['说服', '劝说', '劝']),
  rule('警告', ['警告', '提醒', '小心', '否则']),
  rule('威胁', ['威胁', '代价', '杀了你']),
  rule('请求', ['请求', '拜托', '请你']),
  rule('求助', ['求助', '帮我', '救我']),
  rule('隐瞒', ['隐瞒', '掩饰', '不说']),
  rule('转移话题', ['转移话题', '岔开话题']),
  rule('争取主动', ['争取主动', '占据主动', '先发制人']),
  rule('保护自尊', ['保护自尊', '维护面子', '不肯示弱']),
  rule('缓解尴尬', ['缓解尴尬', '打圆场', '解围']),
  rule('维持体面', ['维持体面', '顾全面子']),
  rule('告白', ['告白', '表白', '喜欢你']),
  rule('挽留', ['挽留', '别走', '留下'])
];

const DIMENSION_RULES = [
  rule('dialogue', [/['“「『][^'”」』\n]{1,100}['”」』]/u, '对白', '说', '道', '问', '回答', '开口', '回话', '补了一句', '说了一句'], 2),
  rule('action', ['动作', '转身', '走到', '握住', '拿起', '放下', '抬手', '敲', '推开', '移开']),
  rule('expression', ['神态', '表情', '目光', '眼神', '脸色', '皱眉', '微笑', '哭']),
  rule('psychology', ['心理', '内心', '心里', '想到', '意识到', '犹豫', '担心']),
  rule('catchphrase', ['口头禅', '总说', '常说', '挂在嘴边']),
  rule('appearance', ['外貌', '外形', '长相', '衣着', '身材', '容貌'])
];

const TEXTURE_RULES = [
  rule('hesitation', ['犹豫', '迟疑', '踌躇']),
  rule('pause', ['停顿', '顿了顿', '片刻', '半晌', '过了一会儿']),
  rule('self_correction', ['改口', '不对', '应该说', '重新说']),
  rule('unfinished_thought', ['欲言又止', '说到一半', '没说完', '话到嘴边', '戛然而止', /[。！？]?[“”]?\.{3,}/u, /……/u]),
  rule('uncertainty', ['也许', '或许', '不确定', '说不准', '可能']),
  rule('avoidance', [/避开.{0,4}(?:目光|视线)/u, /移开.{0,4}(?:目光|视线)/u, '回避', '不敢看', '避而不答']),
  rule('deflection', ['搪塞', '敷衍', '顾左右而言他', '含糊其辞']),
  rule('misdirection', ['误导', '故意引开', '带偏']),
  rule('withholding', ['隐瞒', '闭口不提', '只字未提', '没有说']),
  rule('topic_shift', ['转移话题', '话题一转', '扯开话题']),
  rule('fragment', ['断断续续', '一句一句', '只吐出几个字']),
  rule('repetition', ['反复', '一遍遍', '重复', '又……又', '又...又']),
  rule('interruption', ['打断', '插话', '抢话']),
  rule('repair', ['不，是', '不是，我是说', '咳，不对']),
  rule('vague_reference', ['那个', '那件事', '某种', '什么的']),
  rule('casual_filler', ['其实', '就是', '嗯', '呃', '吧', '嘛']),
  rule('self_contradiction', ['自相矛盾', '明明', /嘴上.{0,8}(?:却|但是)/u]),
  rule('emotion_vs_action', [/心里.{0,10}(?:却|但是)/u, '情绪与行动不一致']),
  rule('speech_vs_action', [/说.{0,10}(?:却|但是)/u, '言行不一']),
  rule('public_private_difference', ['人前人后', '当众', '私下', '公开与私下']),
  rule('want_but_refuse', [/想.{0,8}(?:却|但是).{0,8}(?:拒绝|不肯)/u, '想要却拒绝']),
  rule('habitual_gesture', ['习惯性', '下意识', '总是', '每次都']),
  rule('object_habit', [/摸.{0,3}(?:手机|杯子|钥匙|袖口|戒指)/u, /捏.{0,3}(?:杯沿|袖口|衣角)/u, /摆弄.{0,3}(?:手机|杯子|钥匙|笔)/u]),
  rule('body_habit', ['咬唇', '抿嘴', '揉眉心', '敲指', '摸鼻子', '攥拳']),
  rule('speech_habit', ['口头禅', '常挂在嘴边', '总说']),
  rule('avoidance_habit', ['一遇到', '总要躲开', '习惯回避']),
  rule('save_face', ['强撑', '装作', '不肯示弱', '维护面子']),
  rule('politeness_mask', ['客气', '礼貌', '礼貌地笑', '嘴上客气']),
  rule('status_awareness', ['身份', '上下级', '尊卑', '行礼', '称呼']),
  rule('social_pressure', ['众人看着', '所有人看着', '众目睽睽', '社交压力']),
  rule('reading_the_room', ['察言观色', '看众人脸色', '观察气氛']),
  rule('sensory_anchor', ['闻到', '听见', '触到', '摸到', '温度', '气味', '声音']),
  rule('object_anchor', ['杯子', '钥匙', '手机', '门锁', '雨伞', '信', '刀柄']),
  rule('spatial_anchor', ['门口', '窗边', '角落', '桌前', '身后', '楼梯', '走廊']),
  rule('body_detail', ['指节', '呼吸', '手指', '肩膀', '喉结', '眼睫']),
  rule('environment_detail', ['雨声', '风声', '灯光', '尘土', '地面', '空气']),
  rule('underreaction', ['只是', '只淡淡', '没有反应', '不动声色']),
  rule('overreaction', ['猛地', '骤然', '失声', '大惊', '勃然大怒']),
  rule('delayed_reaction', ['过了很久才', '半晌才', '这才', '随后才']),
  rule('misplaced_attention', ['却注意到', '反而盯着', '注意力落在']),
  rule('unexpected_focus', ['意外地看向', '偏偏注意到', '没想到却看见']),
  rule('implicit_emotion', ['欲言又止', '移开视线', '没有回答', '强装镇定']),
  rule('reader_inference', ['似乎', '仿佛', '像是']),
  rule('unexplained_reaction', ['不知为何', '莫名', '突然']),
  rule('silent_response', ['沉默', '没有回答', '无言', '默不作声'])
];

function ruleHits(text, rules, all = false) {
  const source = normalizeText(text);
  const hits = [];
  rules.forEach((current, order) => {
    let firstIndex = Number.POSITIVE_INFINITY;
    let hitCount = 0;
    for (const pattern of current.patterns) {
      const match = toRegExp(pattern).exec(source);
      if (!match) continue;
      hitCount += 1;
      firstIndex = Math.min(firstIndex, match.index);
    }
    if (hitCount > 0) hits.push({ label: current.label, score: hitCount * current.weight, firstIndex, order });
  });
  hits.sort((left, right) => right.score - left.score || left.firstIndex - right.firstIndex || left.order - right.order);
  return all ? hits : hits[0] || null;
}

const TEXT_INPUT_KEYS = Object.freeze([
  'text', 'safeText', 'prompt', 'query', 'content', 'plot', 'currentPlot', 'currentScene', 'sceneText',
  'generationContext', 'task', 'instruction', 'outline', 'focusSlice', 'proseTask', 'context'
]);

function collectInputText(input, objects) {
  if (typeof input === 'string') return normalizeText(input).slice(0, 6000);
  const parts = [];
  for (const object of objects) {
    if (!isRecord(object)) continue;
    for (const key of TEXT_INPUT_KEYS) {
      const value = object[key];
      if (typeof value === 'string') parts.push(value);
      else if (Array.isArray(value)) parts.push(value.filter(item => typeof item === 'string').join(' '));
    }
  }
  return normalizeText(parts.join('\n')).slice(0, 6000);
}

function makeFallbackContext() {
  return {
    scene: '',
    relationship: '',
    emotionalState: [],
    intent: '',
    dimension: '',
    humanTextureSignals: [],
    fallback: true
  };
}

function extractGenerationContext(input) {
  const source = isRecord(input) ? input : {};
  const nested = isRecord(source.context) ? source.context : {};
  const objects = [source, nested];
  const text = collectInputText(input, objects);
  const explicitScene = firstNormalized(objects, ['scene', 'scenes'], LOOKUPS.scene);
  const explicitRelationship = firstNormalized(objects, ['relationship', 'relationships'], LOOKUPS.relationship);
  const explicitEmotion = firstNormalized(objects, ['emotionalState', 'emotions', 'emotion'], LOOKUPS.emotionalState, true);
  const explicitIntent = firstNormalized(objects, ['intent', 'surfaceIntent'], LOOKUPS.intent);
  const explicitDimension = firstNormalized(objects, ['dimension'], LOOKUPS.dimension);
  const explicitTexture = firstNormalized(objects, ['humanTextureSignals', 'textureSignals', 'signals', 'htl'], LOOKUPS.humanTextureSignals, true);

  const inferredEmotion = ruleHits(text, EMOTION_RULES, true).slice(0, 4).map(hit => hit.label);
  const inferredTexture = ruleHits(text, TEXTURE_RULES, true).slice(0, 8).map(hit => hit.label);
  const result = {
    scene: explicitScene || (ruleHits(text, SCENE_RULES)?.label || ''),
    relationship: explicitRelationship || (ruleHits(text, RELATIONSHIP_RULES)?.label || ''),
    emotionalState: explicitEmotion.length ? explicitEmotion : unique(inferredEmotion),
    intent: explicitIntent || (ruleHits(text, INTENT_RULES)?.label || ''),
    dimension: explicitDimension || (ruleHits(text, DIMENSION_RULES)?.label || ''),
    humanTextureSignals: explicitTexture.length ? explicitTexture : unique(inferredTexture)
  };
  const extracted = Boolean(
    result.scene || result.relationship || result.emotionalState.length || result.intent || result.dimension
    || result.humanTextureSignals.length
  );
  return extracted ? { ...result, fallback: false } : makeFallbackContext();
}

const CONTEXT_FIELD_KEYS = Object.freeze({
  scene: ['scene', 'scenes'],
  relationship: ['relationship', 'relationships'],
  intent: ['intent', 'surfaceIntent'],
  emotion: ['emotionalState', 'emotionalStates', 'emotion', 'emotions'],
  dimension: ['dimension', 'dimensions'],
  texture: ['humanTextureSignals', 'textureSignals', 'signals'],
  archetype: ['archetype', 'archetypes', 'primaryArchetype']
});

function getNormalizedValues(object, keys, lookup) {
  if (!isRecord(object)) return [];
  const result = [];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) result.push(...normalizeList(object[key], lookup));
  }
  return unique(result);
}

function overlapScore(wanted, available) {
  if (!wanted.length || !available.length) return { match: 0, matched: [] };
  const availableSet = new Set(available);
  const matched = wanted.filter(value => availableSet.has(value));
  return { match: matched.length / wanted.length, matched };
}

function round(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function copyWithoutRawText(object) {
  const result = {};
  for (const key of Object.keys(object)) {
    if (key === 'rawText') continue;
    result[key] = object[key];
  }
  return result;
}

function firstIdentifier(object, keys) {
  if (!isRecord(object)) return '';
  for (const key of keys) {
    const value = normalizeKey(object[key]);
    if (value) return value;
  }
  return '';
}

function workKey(object) {
  return firstIdentifier(object, ['canonicalWorkId', 'sourceWorkId', 'sourceNovelId', 'bookId', 'workId', 'novelId', 'book', 'title', 'id']);
}

function authorKey(object) {
  return firstIdentifier(object, ['authorId', 'author', 'authorName', 'sourceAuthor']);
}

function microPatternValues(object) {
  if (!isRecord(object)) return [];
  const values = [];
  for (const key of ['microPattern', 'microPatterns', 'micro_pattern']) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      const value = Array.isArray(object[key]) ? object[key] : [object[key]];
      values.push(...value.map(normalizeKey).filter(Boolean));
    }
  }
  return unique(values);
}

function unwrapHistoryEntry(entry) {
  if (!isRecord(entry)) return {};
  for (const key of ['candidate', 'selected', 'material', 'sample']) {
    if (isRecord(entry[key])) return entry[key];
  }
  return entry;
}

function recentHistory(options, context) {
  const candidates = [
    options && options.recentHistory,
    options && options.recentSelections,
    options && options.recentCandidates,
    options && options.history,
    options && options.recent,
    context && context.recentHistory
  ];
  const history = candidates.find(Array.isArray) || [];
  return history.slice(-5).map(unwrapHistoryEntry);
}

function diversityDetails(candidate, history, options) {
  const candidateBook = workKey(candidate);
  const candidateAuthor = authorKey(candidate);
  const candidatePatterns = microPatternValues(candidate);
  const matches = {
    sameBook: false,
    sameAuthor: false,
    sameMicroPattern: false
  };
  const counts = {
    sameBook: 0,
    sameAuthor: 0,
    sameMicroPattern: 0
  };
  for (const item of history) {
    const itemBook = workKey(item);
    const itemAuthor = authorKey(item);
    const itemPatterns = microPatternValues(item);
    if (candidateBook && itemBook && candidateBook === itemBook) {
      matches.sameBook = true;
      counts.sameBook += 1;
    }
    if (candidateAuthor && itemAuthor && candidateAuthor === itemAuthor) {
      matches.sameAuthor = true;
      counts.sameAuthor += 1;
    }
    if (candidatePatterns.length && itemPatterns.some(value => candidatePatterns.includes(value))) {
      matches.sameMicroPattern = true;
      counts.sameMicroPattern += 1;
    }
  }
  const configured = options && isRecord(options.diversityPenalties) ? options.diversityPenalties : {};
  const penalties = {
    sameBook: Number.isFinite(Number(configured.sameBook)) ? Number(configured.sameBook) : DIVERSITY_PENALTIES.sameBook,
    sameAuthor: Number.isFinite(Number(configured.sameAuthor)) ? Number(configured.sameAuthor) : DIVERSITY_PENALTIES.sameAuthor,
    sameMicroPattern: Number.isFinite(Number(configured.sameMicroPattern)) ? Number(configured.sameMicroPattern) : DIVERSITY_PENALTIES.sameMicroPattern
  };
  const penalty = Math.min(1, (matches.sameBook ? penalties.sameBook : 0)
    + (matches.sameAuthor ? penalties.sameAuthor : 0)
    + (matches.sameMicroPattern ? penalties.sameMicroPattern : 0));
  return {
    match: round(1 - penalty),
    penalty: round(penalty),
    matches,
    counts,
    penalties,
    recentWindow: history.length
  };
}

function componentBreakdown(name, weight, wanted, available) {
  const result = overlapScore(wanted, available);
  return {
    weight,
    match: round(result.match),
    contribution: round(weight * result.match),
    requested: wanted,
    available,
    matched: result.matched
  };
}

function explain(breakdown, diversity) {
  const reasons = [];
  for (const name of ['scene', 'relationship', 'dimension', 'texture', 'archetype']) {
    const item = breakdown[name];
    if (item.matched.length) reasons.push(`${name}:matched(${item.matched.join(',')})`);
    else if (item.requested.length) reasons.push(`${name}:no-match`);
  }
  const diversityMatches = Object.entries(diversity.matches).filter(([, matched]) => matched).map(([name]) => name);
  reasons.push(diversityMatches.length
    ? `diversity:penalty(${diversityMatches.join(',')})`
    : 'diversity:novel-in-recent-window');
  return reasons;
}

function rankMaterialCandidates(candidates, context = {}, options = {}) {
  const source = Array.isArray(candidates) ? candidates : [];
  const safeContext = isRecord(context) ? context : {};
  const history = recentHistory(isRecord(options) ? options : {}, safeContext);
  const contextValues = {
    scene: getNormalizedValues(safeContext, CONTEXT_FIELD_KEYS.scene, LOOKUPS.scene),
    relationship: getNormalizedValues(safeContext, CONTEXT_FIELD_KEYS.relationship, LOOKUPS.relationship),
    intent: getNormalizedValues(safeContext, CONTEXT_FIELD_KEYS.intent, LOOKUPS.intent),
    emotion: getNormalizedValues(safeContext, CONTEXT_FIELD_KEYS.emotion, LOOKUPS.emotionalState),
    dimension: getNormalizedValues(safeContext, CONTEXT_FIELD_KEYS.dimension, LOOKUPS.dimension),
    texture: getNormalizedValues(safeContext, CONTEXT_FIELD_KEYS.texture, LOOKUPS.humanTextureSignals),
    archetype: getNormalizedValues(safeContext, CONTEXT_FIELD_KEYS.archetype, LOOKUPS.archetype)
  };
  return source
    .filter(isRecord)
    .map((candidate, index) => {
      const breakdown = {
        scene: componentBreakdown('scene', SCORE_WEIGHTS.scene, contextValues.scene, getNormalizedValues(candidate, CONTEXT_FIELD_KEYS.scene, LOOKUPS.scene)),
        relationship: componentBreakdown('relationship', SCORE_WEIGHTS.relationship, contextValues.relationship, getNormalizedValues(candidate, CONTEXT_FIELD_KEYS.relationship, LOOKUPS.relationship)),
        dimension: componentBreakdown('dimension', SCORE_WEIGHTS.dimension, contextValues.dimension, getNormalizedValues(candidate, CONTEXT_FIELD_KEYS.dimension, LOOKUPS.dimension)),
        texture: componentBreakdown('texture', SCORE_WEIGHTS.texture, contextValues.texture, getNormalizedValues(candidate, CONTEXT_FIELD_KEYS.texture, LOOKUPS.humanTextureSignals)),
        archetype: componentBreakdown('archetype', SCORE_WEIGHTS.archetype, contextValues.archetype, getNormalizedValues(candidate, CONTEXT_FIELD_KEYS.archetype, LOOKUPS.archetype))
      };
      const intentMatch = overlapScore(contextValues.intent, getNormalizedValues(candidate, CONTEXT_FIELD_KEYS.intent, LOOKUPS.intent)).match;
      const emotionMatch = overlapScore(contextValues.emotion, getNormalizedValues(candidate, CONTEXT_FIELD_KEYS.emotion, LOOKUPS.emotionalState)).match;
      const contextMatches = [];
      if (contextValues.scene.length) contextMatches.push(breakdown.scene.match);
      if (contextValues.intent.length) contextMatches.push(intentMatch);
      if (contextValues.emotion.length) contextMatches.push(emotionMatch);
      const contextMatch = contextMatches.length
        ? contextMatches.reduce((sum, value) => sum + value, 0) / contextMatches.length
        : 0;
      breakdown.scene.contextMatch = round(contextMatch);
      breakdown.scene.intentMatch = round(intentMatch);
      breakdown.scene.emotionMatch = round(emotionMatch);
      breakdown.scene.contribution = round(SCORE_WEIGHTS.scene * contextMatch);
      const diversity = diversityDetails(candidate, history, isRecord(options) ? options : {});
      breakdown.diversity = {
        weight: SCORE_WEIGHTS.diversity,
        match: diversity.match,
        contribution: round(SCORE_WEIGHTS.diversity * diversity.match),
        requested: [],
        available: [],
        matched: [],
        penalty: diversity.penalty,
        recentMatches: diversity.matches,
        recentMatchCounts: diversity.counts,
        recentWindow: diversity.recentWindow
      };
      const contributions = Object.fromEntries(Object.entries(breakdown).map(([name, item]) => [name, item.contribution]));
      const componentScores = Object.fromEntries(Object.entries(breakdown).map(([name, item]) => [name, item.match]));
      const score = round(Object.values(contributions).reduce((sum, value) => sum + value, 0));
      const result = copyWithoutRawText(candidate);
      Object.assign(result, {
        score,
        scoreBreakdown: breakdown,
        scoreContributions: contributions,
        componentScores,
        contextMatch: round(contextMatch),
        intentMatch: round(intentMatch),
        emotionMatch: round(emotionMatch),
        diversityPenalty: diversity.penalty,
        diversityMatches: diversity.matches,
        retrieval: {
          score,
          matchReasons: [
            ...(breakdown.scene.matched.length ? ['scene'] : []),
            ...(intentMatch > 0 ? ['intent'] : []),
            ...(emotionMatch > 0 ? ['emotionalState'] : []),
            ...(breakdown.relationship.matched.length ? ['relationship'] : []),
            ...(breakdown.dimension.matched.length ? ['dimension'] : []),
            ...(breakdown.texture.matched.length ? ['humanTextureSignals'] : []),
            ...(breakdown.archetype.matched.length ? ['archetype'] : []),
            ...(diversity.penalty > 0 ? ['diversityPenalty'] : [])
          ],
          diversityPenalty: diversity.penalty,
          sameRecentWork: diversity.counts.sameBook,
          sameRecentAuthor: diversity.counts.sameAuthor,
          sameRecentPattern: diversity.counts.sameMicroPattern,
          weights: SCORE_WEIGHTS
        },
        explanation: {
          weights: SCORE_WEIGHTS,
          components: breakdown,
          reasons: explain(breakdown, diversity)
        },
        reasons: explain(breakdown, diversity),
        _inputOrder: index
      });
      return result;
    })
    .sort((left, right) => right.score - left.score || left._inputOrder - right._inputOrder)
    .map(item => {
      const result = copyWithoutRawText(item);
      delete result._inputOrder;
      return result;
    });
}

function isSampleCandidate(candidate) {
  if (!isRecord(candidate)) return false;
  const kind = normalizeKey(candidate.kind || candidate.type || candidate.category || candidate.sampleType);
  if (kind === 'sample' || candidate.isSample === true || candidate.sample === true) return true;
  return Object.prototype.hasOwnProperty.call(candidate, 'text')
    && !Object.prototype.hasOwnProperty.call(candidate, 'rule');
}

function isRuleCandidate(candidate) {
  if (!isRecord(candidate)) return false;
  const kind = normalizeKey(candidate.kind || candidate.type || candidate.category);
  return kind === 'rule' || Object.prototype.hasOwnProperty.call(candidate, 'rule');
}

function injectTop(candidates, mode) {
  const source = Array.isArray(candidates) ? candidates.filter(isRecord) : [];
  const normalizedMode = normalizeKey(mode);
  const explicitKinds = source.some(candidate => isSampleCandidate(candidate) || isRuleCandidate(candidate));
  const samples = source.filter(isSampleCandidate);
  const rules = source.filter(isRuleCandidate);
  let pool;
  let limit;
  if (normalizedMode === 'normal' || normalizedMode === 'auto') {
    pool = explicitKinds ? rules : [];
    limit = 1;
  } else if (normalizedMode === 'strong') {
    pool = explicitKinds ? samples : source;
    limit = 2;
  } else {
    pool = explicitKinds && samples.length ? samples : (explicitKinds ? rules : source);
    limit = 1;
  }
  return pool.slice(0, limit).map(copyWithoutRawText);
}
module.exports = {
  ARCHETYPE_WHITELIST,
  CONTEXT_WHITELIST,
  DIMENSION_WHITELIST,
  EMOTIONAL_STATE_WHITELIST,
  HUMAN_TEXTURE_SIGNAL_WHITELIST,
  INTENT_WHITELIST,
  RELATIONSHIP_WHITELIST,
  SCENE_WHITELIST,
  SCORE_WEIGHTS,
  extractGenerationContext,
  injectTop,
  rankMaterialCandidates,
  ARCHETYPES: ARCHETYPE_WHITELIST,
  DIMENSIONS: DIMENSION_WHITELIST,
  SCENES: SCENE_WHITELIST,
  RELATIONSHIPS: RELATIONSHIP_WHITELIST,
  EMOTIONAL_STATES: EMOTIONAL_STATE_WHITELIST,
  HUMAN_TEXTURE_SIGNALS: HUMAN_TEXTURE_SIGNAL_WHITELIST,
};
