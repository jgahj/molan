/**
 * @file style-detector.js
 * 智能多维文风与题材自动推断引擎 (Style & Genre Detection Engine)
 * 能够自动分析任意小说大纲、设定与提示词，精准推断其文风基调、受众群体、题材母类与专属生成指令
 */

const { STYLE_ARCHETYPES } = require('./style-archetypes');

function getGenreFamilies() {
  try {
    return require('./genre-engine').GENRE_FAMILIES || {};
  } catch (_) {
    return {};
  }
}

// 经典 IP / 原著宇宙特征关键词映射
const IP_UNIVERSE_MAP = [
  {
    keywords: ['张若尘', '日晷', '天魔石刻', '罗祖云山界', '姑射静', '十界之战', '月圆夜'],
    styleArchetype: 'epic_grandeur',
    genreFamily: '玄幻修真',
    subcategory: '玄幻',
    bookTitleHint: '元始法则 / 万古神帝流'
  },
  {
    keywords: ['韩立', '掌天瓶', '黄枫谷', '小绿瓶', '乱星海', '青竹蜂云剑'],
    styleArchetype: 'hardcore_progression',
    genreFamily: '玄幻修真',
    subcategory: '东方仙侠',
    bookTitleHint: '凡人修仙传流'
  },
  {
    keywords: ['方源', '春秋蝉', '古月山寨', '蛊仙', '青茅山', '至尊仙胎'],
    styleArchetype: 'dark_calculating',
    genreFamily: '玄幻修真',
    subcategory: '仙侠',
    bookTitleHint: '蛊真人暗黑流'
  },
  {
    keywords: ['张拂潇', '张海琪', '张海盐', '张海虾', '盘花海礁', '水鬼望乡', '张瑞朴', '泗水城', '比格'],
    styleArchetype: 'humorous_sand_sculpture',
    genreFamily: '古言世情',
    subcategory: '女频衍生',
    bookTitleHint: '盗墓笔记张家衍生欢脱流'
  }
];

// 情绪语调扫描特征模式
const TONE_PATTERNS = [
  {
    styleArchetype: 'humorous_sand_sculpture',
    weight: 3,
    regex: /(草[！!，,\s]|老娘|比格|收脑子|沙雕|逗比|吐槽|发疯|饭票|送瘟神|巴豆|拉肚子|尖叫|暴躁|反差萌|恶毒女配|搞钱|打补丁|笑死|神仙打架|祖宗.*死绝|放狠话)/i
  },
  {
    styleArchetype: 'workplace_inversion',
    weight: 2.5,
    regex: /(打工人|到点就停|按时下班|四个时辰|修仙.*卷|内卷|躺平|拧螺丝|月薪|算账|资本家|剥削|绩效|考核|加班)/i
  },
  {
    styleArchetype: 'sweet_healing_pet',
    weight: 2,
    regex: /(甜宠|校草|同桌|暗恋|摸头|揉头发|耳根.*红|脸红|傲娇|小娇娇|撒娇|心动|小鹿乱撞|白月光|竹马)/i
  },
  {
    styleArchetype: 'creepy_folklore',
    weight: 2.5,
    regex: /(规则怪谈|不可名状|纸人|红衣女|绣花鞋|通灵|凶宅|水鬼|尸蟞|阴兵|棺材|冥婚|忌讳|鬼打墙)/i
  },
  {
    styleArchetype: 'court_intrigue',
    weight: 2,
    regex: /(嫡庶|掌家|主母|妾室|姨娘|侯府|国公府|后宅|宫斗|抄家|宗族戒律|东厂|锦衣卫|漕运|御史)/i
  },
  {
    styleArchetype: 'dark_calculating',
    weight: 2.5,
    regex: /(利己|不择手段|魔道|绝无圣母|万物皆为棋子|利益至上|灭门|炼化|血祭|冷血|枭雄)/i
  },
  {
    styleArchetype: 'hardcore_progression',
    weight: 2,
    regex: /(散修|灵根|筑基|金丹|苟道|藏拙|灵石.*紧缺|杀人夺宝|毁尸灭迹|坊市|灵田|灵药|如履薄冰)/i
  },
  {
    styleArchetype: 'urban_face_slap',
    weight: 2,
    regex: /(战神|赘婿|龙王|退婚|当场打脸|蝼蚁|资产万亿|首富|神豪|跪下|叫板|扮猪吃虎)/i
  },
  {
    styleArchetype: 'scifi_hardcore',
    weight: 2,
    regex: /(外骨骼|辐射度量|聚变堆|纳米|战舰|智脑|赛博|星舰|跃迁|公差|废土|机械臂|义体)/i
  },
  {
    styleArchetype: 'epic_grandeur',
    weight: 2,
    regex: /(神尊|大圣|伪神|神境|天地法则|大能|帝尊|道果|诸天万界|神话|星域|主宰|至尊)/i
  }
];

// 题材子类特征扫描
const SUBCATEGORY_PATTERNS = [
  { subcategory: '女频衍生', family: '古言世情', regex: /(张海琪|张拂潇|盗墓.*同人|衍生|万人迷|穿成炮灰|女配逆袭)/i },
  { subcategory: '女频悬疑', family: '悬疑惊悚', regex: /(女频悬疑|女法医|通灵小娇娇|读心.*破案)/i },
  { subcategory: '悬疑脑洞', family: '悬疑惊悚', regex: /(规则怪谈|脑洞悬疑|无限流.*逃生|剧本杀)/i },
  { subcategory: '悬疑灵异', family: '悬疑惊悚', regex: /(风水|赶尸|阴阳先生|道士出山|灵异)/i },
  { subcategory: '青春甜宠', family: '现代言情', regex: /(青春|校园|校花|校草|同桌|学霸)/i },
  { subcategory: '豪门总裁', family: '现代言情', regex: /(总裁|豪门|替身|契约|闪婚|亿万前妻)/i },
  { subcategory: '古言脑洞', family: '古言世情', regex: /(天幕曝光|读心术|弹幕教她|换装系统|女帝)/i },
  { subcategory: '宫斗宅斗', family: '古言世情', regex: /(宫斗|宅斗|嫡女|主母|贵妃|冷宫)/i },
  { subcategory: '东方仙侠', family: '玄幻修真', regex: /(仙侠|蜀山|昆仑|飞升|修仙|灵剑|道友)/i },
  { subcategory: '传统玄幻', family: '玄幻修真', regex: /(玄幻|血脉|武魂|魂环|至尊骨|荒古圣体|大帝)/i },
  { subcategory: '都市高武', family: '都市高武', regex: /(高武|气血|武道|觉醒|灵气复苏|异能|武馆)/i },
  { subcategory: '都市日常', family: '都市高武', regex: /(都市日常|神豪|奶爸|悠闲|摆摊|生活)/i },
  { subcategory: '科幻末世', family: '科幻末世', regex: /(丧尸|末世|避难所|囤货|极寒|天灾|冰封)/i },
  { subcategory: '历史脑洞', family: '历史古代', regex: /(大秦|大明|三国|祖龙|皇帝|朱元璋|嬴政)/i }
];

/**
 * 核心识别函数：多维文风、受众与题材自动检测
 * @param {string} inputQuery 用户输入的大纲、设定或提示词
 * @param {Object} [context] 上下文（书名、已有设定等）
 * @returns {Object} 检测报告及对应的风格基因规范
 */
function detectNovelStyle(inputQuery, context = {}) {
  const query = String(inputQuery || '');
  const title = String(context.bookTitle || context.title || '');
  const combined = `${title}\n${query}`;

  // 1. IP / 原著宇宙优先匹配
  for (const ip of IP_UNIVERSE_MAP) {
    const hits = ip.keywords.filter(kw => combined.includes(kw));
    if (hits.length >= 2) {
      const archetypeDef = STYLE_ARCHETYPES[ip.styleArchetype];
      return {
        matchedBy: 'ip_universe',
        confidence: 0.98,
        ipHint: ip.bookTitleHint,
        matchedKeywords: hits,
        styleArchetype: ip.styleArchetype,
        styleArchetypeDef: archetypeDef,
        genreFamily: ip.genreFamily,
        subcategory: ip.subcategory,
        tone: archetypeDef.tone,
        voiceSpec: archetypeDef.voiceSpec,
        narrativeDirectives: archetypeDef.narrativeDirectives,
        wordBounds: archetypeDef.defaultWordBounds
      };
    }
  }

  // 2. 情绪语调与文风打分
  const scores = {};
  for (const p of TONE_PATTERNS) {
    const matches = combined.match(new RegExp(p.regex, 'g')) || [];
    if (matches.length > 0) {
      scores[p.styleArchetype] = (scores[p.styleArchetype] || 0) + matches.length * p.weight;
    }
  }

  // 3. 题材子类与母类推断
  let detectedSubcat = '玄幻';
  let detectedFamily = '玄幻修真';
  for (const sub of SUBCATEGORY_PATTERNS) {
    if (sub.regex.test(combined)) {
      detectedSubcat = sub.subcategory;
      detectedFamily = sub.family;
      break;
    }
  }

  // 若提供了显式题材偏好
  if (context.genreFamily && context.genreFamily !== 'auto' && context.genreFamily !== 'all') {
    detectedFamily = context.genreFamily;
  }
  if (context.genreRoute && context.genreRoute !== 'auto') {
    // 允许通过 route 反查
    for (const [fName, fObj] of Object.entries(getGenreFamilies())) {
      if (fObj.routes?.some(r => r.id === context.genreRoute || r.value === context.genreRoute)) {
        detectedFamily = fName;
        break;
      }
    }
  }

  // 4. 决定最终文风大类
  let bestArchetype = null;
  let highestScore = 0;
  for (const [arch, sc] of Object.entries(scores)) {
    if (sc > highestScore) {
      highestScore = sc;
      bestArchetype = arch;
    }
  }

  // 如果没有明显情绪特征，根据母类赋予自然默认风格
  if (!bestArchetype || highestScore < 1.5) {
    if (detectedFamily === '现代言情') bestArchetype = 'sweet_healing_pet';
    else if (detectedFamily === '古言世情') bestArchetype = 'court_intrigue';
    else if (detectedFamily === '悬疑惊悚') bestArchetype = 'creepy_folklore';
    else if (detectedFamily === '科幻末世') bestArchetype = 'scifi_hardcore';
    else if (detectedFamily === '都市高武') bestArchetype = 'urban_face_slap';
    else if (detectedSubcat.includes('修仙') || detectedSubcat.includes('仙侠')) bestArchetype = 'hardcore_progression';
    else bestArchetype = 'epic_grandeur';
  }

function getEpistemicAndFriction(family) {
  try {
    const { EPISTEMIC_PRESETS, FRICTION_PRESETS } = require('./genre-engine');
    const fMap = {
      '玄幻修真': 'xuanhuan',
      '都市高武': 'urban_martial',
      '科幻末世': 'scifi_apocalypse',
      '悬疑惊悚': 'suspense',
      '历史古代': 'history',
      '西方奇幻': 'western_fantasy',
      '古言世情': 'ancient_romance',
      '现代言情': 'modern_romance'
    };
    const key = fMap[family] || 'xuanhuan';
    const ep = (EPISTEMIC_PRESETS && EPISTEMIC_PRESETS[key]) || (EPISTEMIC_PRESETS && EPISTEMIC_PRESETS.xuanhuan) || {};
    const fr = (FRICTION_PRESETS && FRICTION_PRESETS[key]) || (FRICTION_PRESETS && FRICTION_PRESETS.xuanhuan) || '';
    return {
      epistemic5D: {
        desire: ep.charactersDesire || '争夺机缘与生存话语权',
        conceal: ep.charactersConceal || '隐秘底牌杀招与未报备之物',
        blindSpots: ep.blindSpots || '局势暗流与不可名状的黄雀杀局',
        irreversibleChange: ep.irreversibleChange || '秩序或关系打破，隐秘暴露',
        friction: fr || '物理磨损与现实阻力'
      },
      tensionCurve: [
        { beat: '起手铺垫', tension: 3.5, label: '平静中隐现反常暗涌' },
        { beat: '突发变数', tension: 6.5, label: '常规手段破产矛盾激化' },
        { beat: '名场面交锋', tension: 9.5, label: '核心底牌绝杀高潮' },
        { beat: '战局收尾', tension: 7.5, label: '清点损耗章末致命钩子' }
      ]
    };
  } catch (_) {
    return {
      epistemic5D: null,
      tensionCurve: null
    };
  }
}

  const archetypeDef = STYLE_ARCHETYPES[bestArchetype] || STYLE_ARCHETYPES.epic_grandeur;
  const epData = getEpistemicAndFriction(detectedFamily);

  return {
    matchedBy: highestScore >= 1.5 ? 'tone_analysis' : 'genre_default',
    confidence: highestScore >= 1.5 ? Math.min(0.95, 0.6 + highestScore * 0.05) : 0.7,
    styleArchetype: bestArchetype,
    styleArchetypeDef: archetypeDef,
    genreFamily: detectedFamily,
    subcategory: detectedSubcat,
    tone: archetypeDef.tone,
    voiceSpec: archetypeDef.voiceSpec,
    narrativeDirectives: archetypeDef.narrativeDirectives,
    wordBounds: archetypeDef.defaultWordBounds,
    epistemic5D: epData.epistemic5D,
    tensionCurve: epData.tensionCurve
  };
}

module.exports = {
  detectNovelStyle,
  IP_UNIVERSE_MAP
};
