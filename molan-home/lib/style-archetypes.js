/**
 * @file style-archetypes.js
 * 10 大核心网文风格基因体系 (Core Style Archetypes)
 * 覆盖男频/女频、严肃/沙雕、升级/恋爱、悬疑/惊悚全品类生态
 */

const STYLE_ARCHETYPES = {
  // 1. 沙雕反差 / 暴躁吐槽 / 精神美丽流
  humorous_sand_sculpture: {
    id: 'humorous_sand_sculpture',
    name: '沙雕反差 / 暴躁吐槽流',
    description: '女主/主角战力天花板，性格狂躁随性如比格犬，内心吐槽密集，配角集体抓狂反差萌',
    targetAudience: 'female_and_general',
    tone: '爆笑、荒诞反差、毒舌爽快、精神状态极其美丽',
    voiceSpec: {
      dialogueTone: '语速快、攻击性强、嘴硬心黑、金句频出、带刺放狠话',
      allowInnerMonologue: true,
      allowSlangAndMemes: true,
      allowComedyBanter: true,
      prohibitedTones: [
        '严禁苦大仇深、自怨自艾',
        '严禁把荒诞搞笑的剧情写成严肃的家族伦理正剧',
        '严禁削弱主角的武力值或把主角写得狼狈求饶'
      ]
    },
    narrativeDirectives: [
      '主角必须保持“绝对掌控力 + 狂躁放狠话”的嚣张气魄，任性妄为且战力超群；',
      '配角负责疯狂抓狂、瑟瑟发抖或庆幸“终于送走瘟神”的极致反差喜感；',
      '允许并提倡第一人称或限知视角的内心吐槽、网络反差感、极简白描与快节奏反转；',
      '在面对危险、遇袭或落难时，主角绝不能显得凄凉无助，必须是霸气反弹与立誓报复（例如“抢劫抢到老娘头上来了？你们给老娘等着！”）；',
      '严禁任何生理抽搐词汇（指节泛白、喉咙发紧、心跳漏了一拍），保持动作利落干脆。'
    ],
    defaultWordBounds: [2000, 3200]
  },

  // 2. 打工人整顿修仙界 / 现代思维降维打击流
  workplace_inversion: {
    id: 'workplace_inversion',
    name: '打工人反套路 / 现代思维降维流',
    description: '用现代打工人算账思维、职场规则对抗古代/玄幻铁律，在极致内卷或极致反内卷中逆袭',
    targetAudience: 'general',
    tone: '幽默讽刺、冷静算账、心理对比强烈、爽快逆袭',
    voiceSpec: {
      dialogueTone: '表面温顺配合或公事公办，内心清醒冷酷算账，现代职场黑话与玄幻古风碰撞',
      allowInnerMonologue: true,
      allowSlangAndMemes: true,
      allowComedyBanter: true,
      prohibitedTones: [
        '严禁真情实感崇拜压迫者或天道规矩',
        '严禁陷入自我牺牲奉献圣母心态'
      ]
    },
    narrativeDirectives: [
      '用现代打工人算账法对比封建宗门剥削，形成强烈的反差爽点；',
      '主角目标明确务实，视修行和冒险为“搞钱/挣命/保身”，不讲假大空大道理；',
      '节奏明快，关键时刻果断打破所谓“千百年天道铁律”。'
    ],
    defaultWordBounds: [2200, 3200]
  },

  // 3. 甜宠治愈 / 轻松萌系 / 暧昧拉扯流
  sweet_healing_pet: {
    id: 'sweet_healing_pet',
    name: '甜宠治愈 / 细腻情愫流',
    description: '细腻情感拉扯，微表情与眼神交锋，傲娇、直球与反差萌，甜爽不虐',
    targetAudience: 'female',
    tone: '轻快、温情、细腻、暧昧拉扯、治愈',
    voiceSpec: {
      dialogueTone: '生动生活化，暗藏试探与在意，机敏带刺但眼神出卖内心',
      allowInnerMonologue: true,
      allowSlangAndMemes: true,
      allowComedyBanter: true,
      prohibitedTones: [
        '严禁狗血误会拖沓不解释',
        '严禁油腻霸总说教与降智卑微'
      ]
    },
    narrativeDirectives: [
      '重在微观动作与心理张力（对视、递物、侧脸、语气停顿），画面感要柔和鲜活；',
      '男女主角势均力敌或各具绝活，在日常琐碎与外部小事件中增进默契；',
      '拒绝大篇幅空洞心理独白，通过具体行为细节展现心动。'
    ],
    defaultWordBounds: [2000, 3000]
  },

  // 4. 硬核凡人 / 谨慎苟道 / 算计杀伐流
  hardcore_progression: {
    id: 'hardcore_progression',
    name: '谨慎苟道 / 凡人算计流',
    description: '每块灵石锱铢必较，绝无主角光环自大，低调藏拙，谋定后动，杀伐果断不留后患',
    targetAudience: 'male',
    tone: '冷峻、沉着、精算、杀伐决断、如履薄冰',
    voiceSpec: {
      dialogueTone: '言辞谨慎含蓄，绝不主动惹事挑衅，话留三分，不出恶言也不示弱',
      allowInnerMonologue: true,
      allowSlangAndMemes: false,
      allowComedyBanter: false,
      prohibitedTones: [
        '严禁狂妄嘲弄死前反派',
        '严禁冲动意气用事或为虚名斗狠',
        '严禁现代网络轻喜剧接梗'
      ]
    },
    narrativeDirectives: [
      '动手前底牌藏尽，动手时雷霆万钧不留活口，动用杀招后必清扫战场毁灭痕迹；',
      '修仙资源消耗与丹药法器折损必须有具体数字与沉重代价；',
      '众生相自私趋利，人心隔肚皮，严禁降智同门。'
    ],
    defaultWordBounds: [2400, 3500]
  },

  // 5. 宏大玄幻 / 帝尊博弈 / 仙魔威压流
  epic_grandeur: {
    id: 'epic_grandeur',
    name: '宏大玄幻 / 帝尊博弈流',
    description: '天下棋局，深层博弈，大智若愚借势破局，名家带刺机锋，阶级森严与超凡神威感官冲击',
    targetAudience: 'male',
    tone: '宏大、肃穆、从容深沉、城府如渊、威压厚重',
    voiceSpec: {
      dialogueTone: '名家机锋、谈笑间定大局、带刺调侃与深层算计并存，绝无轻浮废话',
      allowInnerMonologue: false,
      allowSlangAndMemes: false,
      allowComedyBanter: false,
      prohibitedTones: [
        '严禁都市恋爱剧相声推拉',
        '严禁大圣与神灵无脑降智对骂'
      ]
    },
    narrativeDirectives: [
      '明面高调或退让皆是做局阳谋，严格执行三重反转闭环（表象冲突 -> 深层借势 -> 底层阳谋）；',
      '超凡法宝、天地规则、阶级威压必须有具体的物理运行与感官冲击过程；',
      '配角与大能眼界深远，底层伪神见风使舵，刻画世态炎凉入骨。'
    ],
    defaultWordBounds: [2400, 3200]
  },

  // 6. 暗黑理智 / 极致利己 / 枭雄冷酷流
  dark_calculating: {
    id: 'dark_calculating',
    name: '暗黑理智 / 极致利己流',
    description: '利益至上，零圣母说教，绝对清醒理智，视道德与规则为工具，冷酷生存求道',
    targetAudience: 'male_and_general',
    tone: '冷酷、深邃、残酷现实、洞悉人性、哲思与血腥交织',
    voiceSpec: {
      dialogueTone: '语气平淡从容，言必中人性的弱点与利益，不屑情绪化发泄',
      allowInnerMonologue: true,
      allowSlangAndMemes: false,
      allowComedyBanter: false,
      prohibitedTones: [
        '严禁无端恻隐之心或为情义牺牲大局',
        '严禁正义说教与自欺欺人'
      ]
    },
    narrativeDirectives: [
      '主角目标唯有长生或超凡巅峰，世间万物皆为可消耗资源；',
      '对人性幽微处的利用精妙入微，算无遗策；',
      '反派与正道皆非蠢货，各有立场与道义伪装，博弈极具深度。'
    ],
    defaultWordBounds: [2400, 3500]
  },

  // 7. 中式民俗 / 规则怪谈 / 惊悚解谜流
  creepy_folklore: {
    id: 'creepy_folklore',
    name: '中式民俗 / 规则怪谈流',
    description: '规则悖论，民俗禁忌，不可名状之物，压迫窒息与严密逻辑推导反杀',
    targetAudience: 'general',
    tone: '诡谲、冰冷、压抑、毛骨悚然、逻辑严丝合缝',
    voiceSpec: {
      dialogueTone: '字数精炼、神情紧绷、试探与戒备、对规则字句字字推敲',
      allowInnerMonologue: true,
      allowSlangAndMemes: false,
      allowComedyBanter: false,
      prohibitedTones: [
        '严禁在规则降临时嬉皮笑脸',
        '严禁机械神降无因果通关'
      ]
    },
    narrativeDirectives: [
      '充分调动感官细节（冰冷水迹、纸人香火、阴暗视线、微小声音），营造真实的窒息压迫感；',
      '破局必须依靠对既有规则漏洞的敏锐洞察与道具的极限运用；',
      '章末留足不可逆的悬念或新规则揭示。'
    ],
    defaultWordBounds: [2200, 3200]
  },

  // 8. 深宫内宅 / 步步为营 / 古典世情流
  court_intrigue: {
    id: 'court_intrigue',
    name: '深宫内宅 / 典雅权谋流',
    description: '名分礼法，暗流汹涌，话里藏刀，掌家夺权与朝堂后宫联动的精巧利益博弈',
    targetAudience: 'female',
    tone: '典雅、含蓄、暗藏机锋、步步惊心、层次丰富',
    voiceSpec: {
      dialogueTone: '符合古代宗族闺阁规范，端庄得体中字字诛心，全是潜台词',
      allowInnerMonologue: true,
      allowSlangAndMemes: false,
      allowComedyBanter: false,
      prohibitedTones: [
        '严禁现代流行口语出戏',
        '严禁无视尊卑礼法的大呼小叫当街撕逼'
      ]
    },
    narrativeDirectives: [
      '严格遵从古代律法、宗族序齿、月例账本与礼制门禁；',
      '反击不显山不露水，借刀杀人、借势立规矩；',
      '环境描写考究（器皿、服饰、熏香、座次皆有深意）。'
    ],
    defaultWordBounds: [2200, 3200]
  },

  // 9. 都市极速爽文 / 扮猪吃虎 / 强反转打脸流
  urban_face_slap: {
    id: 'urban_face_slap',
    name: '都市高武 / 极速打脸爽文流',
    description: '身份错位，极速装逼打脸，社会关系压制与降维反杀，快节奏高情绪回报',
    targetAudience: 'male',
    tone: '极度爽快、节奏飞起、霸气碾压、情绪大开大合',
    voiceSpec: {
      dialogueTone: '简洁有力、冷峻霸道、言出必践、当面打脸毫不手软',
      allowInnerMonologue: false,
      allowSlangAndMemes: true,
      allowComedyBanter: false,
      prohibitedTones: [
        '严禁被反派当面嘲讽超过三句不反击',
        '严禁憋屈隐忍不报仇'
      ]
    },
    narrativeDirectives: [
      '反派挑衅直接而嚣张，主角回击致命而震撼，绝不拖泥带水；',
      '全场众生相震惊、后悔与倒戈必须写到位，情绪价值拉满；',
      '单段以短促有力为主，镜头切换明快利落。'
    ],
    defaultWordBounds: [2000, 3000]
  },

  // 10. 硬核重工 / 末世废土 / 钢铁工业流
  scifi_hardcore: {
    id: 'scifi_hardcore',
    name: '硬核科幻 / 钢铁重工流',
    description: '公差参数，辐射度量，机械形变，资源精算，绝境求生与冰冷机械美学',
    targetAudience: 'general',
    tone: '硬朗、写实、冰冷工业感、绝境坚韧、秩序感',
    voiceSpec: {
      dialogueTone: '专业术语精准、军事化无线电口令、简短高效、毫无拖泥带水',
      allowInnerMonologue: true,
      allowSlangAndMemes: false,
      allowComedyBanter: false,
      prohibitedTones: [
        '严禁唯心念力无视物理法则自愈',
        '严禁空洞中二科技口号'
      ]
    },
    narrativeDirectives: [
      '失血必虚脱、受冻必僵硬、器械受压必形变、电池耗尽必停机，物理规律不可违背；',
      '通过机械仪表、辐射数值、弹药存量等具体度量推进危机倒计时；',
      '人性的坚韧在冰冷钢铁与残忍废土中更具震撼力。'
    ],
    defaultWordBounds: [2400, 3500]
  }
};

const { STYLE_DNA, ARCHETYPE_TO_STYLE_DNA, resolveStyleDNA } = require('./style/style-dna');

// 统一文风适配：每个 StyleArchetype 严格绑定唯一的规范 StyleDNA
for (const [id, def] of Object.entries(STYLE_ARCHETYPES)) {
  const dnaKey = ARCHETYPE_TO_STYLE_DNA[id] || '日常';
  def.styleDnaKey = dnaKey;
  def.styleDna = STYLE_DNA[dnaKey];
}

function getArchetypeStyleDNA(archetypeId) {
  const def = STYLE_ARCHETYPES[archetypeId];
  if (def && def.styleDna) return def.styleDna;
  const resolved = resolveStyleDNA({ archetypeId });
  return resolved.status === 'resolved' ? resolved.dna : null;
}

module.exports = {
  STYLE_ARCHETYPES,
  getArchetypeStyleDNA
};

