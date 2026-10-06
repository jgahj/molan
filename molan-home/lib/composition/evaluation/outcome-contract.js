'use strict';

/**
 * @file outcome-contract.js
 * 叙事结果契约深度评测引擎 (Deep State-Transition Outcome Verification Engine)
 * 
 * 核心三层判准体系：
 * 1. 实体提及判定 (Entity Mentions): 识别核心人事物与地点，区分前景活跃实体与背景口述/传闻/回忆/假设性提及；
 * 2. 事件发生判定 (Event Occurrences): 句法局部窗口 (<= 80 字符) 动态动作谓词 + 目标客体绑定，严格过滤否定、挫折未果与假设非实模态；
 * 3. 状态跃迁判定 (Narrative State Transitions): 覆盖 6 大跃迁领域 (物权、认知、生死/状态、关系、位阶、通用)，
 *    执行催化动作检验与矛盾冲突拦截 (如获得宝物与空手而归的互斥)。
 */

const TRANSITION_DOMAINS = Object.freeze([
  'possession',
  'information',
  'condition',
  'relationship',
  'status',
  'general'
]);

const DOMAIN_CONFIG = Object.freeze({
  possession: {
    domain: 'possession',
    name: '物权转移',
    affirmativeKeywords: [
      '入怀', '收入囊中', '攥在手心', '紧握', '起获', '到手', '收入贴身暗袋',
      '落入手心', '触碰到了', '揣入怀中', '纳入袖中', '稳稳握住', '拿到手',
      '夺得', '取入手中', '纳入囊中', '塞入怀中', '牢牢抓住', '收入怀中', '握在手',
      '抓在手里', '据为己有', '落入手中'
    ],
    contradictionKeywords: [
      '空手而归', '一无所获', '失之交臂', '遗失', '未能取得', '两手空空',
      '未能起获', '空手而回', '一无所得', '落空', '空手折返', '未得寸进'
    ],
    catalystVerbs: [
      '潜入', '搜寻', '摸索', '触碰', '盗取', '起获', '夺取', '探入', '翻找',
      '取走', '搜查', '启出', '取得', '夺下', '拿到', '偷取', '拔出'
    ],
    domainSignals: [
      '钱', '宝', '物', '盒', '匣', '玉', '珠', '佩', '图', '暗袋', '古钱',
      '线索', '证据', '起获', '夺得', '盗取', '窃取', '藏宝', '信物'
    ],
    synonymMap: {
      '起获': ['起获', '触碰', '取得', '拿到', '收下', '夺下', '获得'],
      '潜入': ['潜入', '潜行', '翻越', '探入', '闯入', '进入']
    }
  },
  information: {
    domain: 'information',
    name: '隐秘揭示/认知位移',
    affirmativeKeywords: [
      '赫然写着', '真相大白', '印证', '获悉', '原形毕露', '水落石出', '亲口承认',
      '彻底明白', '方才知晓', '浮出水面', '字迹清晰', '看清了', '终于明白',
      '确凿无疑', '揭晓', '看清信中', '获知真相', '查明叛徒', '查明真相', '看清',
      '已然明了', '豁然开朗', '辨认字迹'
    ],
    contradictionKeywords: [
      '守口如瓶', '一无所知', '仍是谜团', '毫无头绪', '查无实据', '密不透风',
      '未曾得知', '无从知晓', '毫无线索', '查无音讯', '扑朔迷离', '不得而知'
    ],
    catalystVerbs: [
      '拆阅', '展开', '破译', '审讯', '逼问', '翻看', '辨认', '查阅', '偷听',
      '窥见', '撬开', '揭开', '查明', '阅读', '审视', '查验', '看清'
    ],
    domainSignals: [
      '信', '密函', '真相', '隐秘', '秘密', '身世', '内奸', '叛徒', '字迹',
      '拆阅', '书信', '获悉', '查明', '印证', '证据', '口供', '账册', '通敌'
    ],
    synonymMap: {
      '查明': ['查明', '辨认', '获悉', '看清', '揭晓', '证实', '确认'],
      '叛徒': ['叛徒', '内奸', '通敌', '署名', '逆贼', '奸细', '真相']
    }
  },
  condition: {
    domain: 'condition',
    name: '生理/生死状态跃迁',
    affirmativeKeywords: [
      '断折', '重创', '鲜血狂喷', '倒地不起', '气绝身亡', '经脉尽碎', '再无生息',
      '瘫软在地', '血染', '咽气', '昏死', '断气', '身负重伤', '伤口崩裂', '倒下',
      '刺穿', '毙命', '身亡', '倒在血泊', '气绝'
    ],
    contradictionKeywords: [
      '毫发无损', '安然无恙', '虚惊一场', '毫发未伤', '未伤分毫', '完好无损',
      '平安无事', '安好'
    ],
    catalystVerbs: [
      '刺入', '斩落', '击中', '轰中', '命中', '斩杀', '重创', '刺穿', '贯穿',
      '下毒', '击杀', '诛杀', '重击', '挥刀', '开弓'
    ],
    domainSignals: [
      '伤', '死', '血', '刺客', '重创', '经脉', '毒', '气绝', '毙命', '身亡',
      '斩杀', '击杀', '刺死', '击退', '重伤'
    ],
    synonymMap: {
      '击杀': ['击杀', '斩杀', '刺穿', '诛杀', '重创', '除掉'],
      '刺客': ['刺客', '重铠', '敌人', '凶手', '敌手', '对手', '黑衣人', '目标']
    }
  },
  relationship: {
    domain: 'relationship',
    name: '阵营/关系跃迁',
    affirmativeKeywords: [
      '反目成仇', '割袍断义', '立誓效忠', '从此为敌', '歃血为盟', '拜入门下',
      '势不两立', '决裂', '恩断义绝', '结为异姓兄弟', '同生共死', '反目', '拔刀相向',
      '宣誓效忠', '结为盟友', '誓死效忠', '从此陌路'
    ],
    contradictionKeywords: [
      '和好如初', '虚与委蛇', '假意反目', '言归于好', '破镜重圆', '重归于好',
      '暗中结盟', '旧情难断'
    ],
    catalystVerbs: [
      '斩断', '拔刀', '撕破脸', '立誓', '歃血', '结义', '背叛', '告发', '决裂',
      '结拜', '誓言', '歃血为盟', '割袍断义'
    ],
    domainSignals: [
      '兄弟', '盟', '结拜', '反目', '断义', '效忠', '誓', '背叛', '决裂',
      '势不两立', '同盟', '恩义', '结义'
    ],
    synonymMap: {
      '反目': ['反目', '拔刀', '决裂', '背叛', '势不两立', '割袍断义'],
      '决裂': ['决裂', '反目成仇', '势不两立', '恩断义绝', '成仇']
    }
  },
  status: {
    domain: 'status',
    name: '位阶/权力/境界跃迁',
    affirmativeKeywords: [
      '突破', '踏入', '晋升', '册封', '威震', '立为', '登基', '筑基成功', '跻身',
      '跨入', '加冕', '登上帝位', '破境', '成功突破', '结丹', '荣登', '继任'
    ],
    contradictionKeywords: [
      '突破未果', '晋升失败', '功亏一篑', '走火入魔未成', '冲关失败', '跌落境界',
      '贬为', '未能晋升'
    ],
    catalystVerbs: [
      '运转', '破境', '度劫', '登基', '册封', '领命', '宣读圣旨', '闭关',
      '结丹', '炼化', '突破'
    ],
    domainSignals: [
      '突破', '晋升', '境界', '筑基', '金丹', '元婴', '位阶', '册封', '登基',
      '破境', '官阶', '宗主', '掌门'
    ],
    synonymMap: {
      '运转': ['运转', '炼化', '催动', '闭关'],
      '突破': ['突破', '破境', '踏入', '跻身', '结丹']
    }
  },
  general: {
    domain: 'general',
    name: '通用因果跃迁',
    affirmativeKeywords: [
      '终成定局', '尘埃落定', '不可逆转', '大局已定', '达成', '落定', '彻底改变',
      '再无回头路', '木已成舟', '生米煮成熟饭', '无可挽回'
    ],
    contradictionKeywords: [
      '重归原点', '一切如常', '功亏一篑', '徒劳无功', '化为泡影', '未有改变',
      '徒劳', '复归如初'
    ],
    catalystVerbs: ['推动', '促成', '引发', '导致', '触发', '扭转', '锁定', '闭合', '戒严'],
    domainSignals: ['局势', '命运', '因果', '局面', '大势', '结果'],
    synonymMap: {}
  }
});

const ACTION_VERBS = [
  '割袍断义', '反目成仇', '气绝身亡', '倒地不起', '歃血为盟', '势不两立', '恩断义绝',
  '潜入', '潜行', '翻越', '探入', '闯入', '起获', '取得', '夺下', '夺得', '拿到',
  '收下', '获得', '取走', '斩杀', '击杀', '诛杀', '斩落', '刺死', '除掉', '击毙',
  '重创', '打伤', '逼退', '击退', '拆阅', '撕开', '展开', '阅读', '查验', '审视',
  '翻看', '揭开', '交出', '奉上', '递给', '赠予', '交付', '结拜', '结盟', '立誓',
  '联手', '反目', '决裂', '背叛', '突破', '晋升', '踏入', '觉醒', '参悟', '领悟',
  '触碰', '刺入', '刺穿', '破译', '撬开', '获悉', '查明', '找到', '搜出', '搜寻',
  '摸索', '贯穿', '运转', '破境', '度劫', '登基', '册封', '闭合', '戒严'
];

const ALL_ACTION_VERBS = Array.from(new Set([
  ...ACTION_VERBS,
  ...Object.values(DOMAIN_CONFIG).flatMap(d => d.catalystVerbs || []),
  ...Object.values(DOMAIN_CONFIG).flatMap(d => Object.keys(d.synonymMap || {})),
  ...Object.values(DOMAIN_CONFIG).flatMap(d => Object.values(d.synonymMap || {}).flat()),
  '盗取', '夺取', '翻找', '搜查', '启出', '偷取', '拔出',
  '击中', '轰中', '命中', '下毒', '重击', '挥刀', '开弓', '斩首', '手刃', '格杀',
  '审讯', '逼问', '辨认', '查阅', '偷听', '窥见', '看清', '获知', '洞察',
  '斩断', '拔刀', '撕破脸', '结义', '告发', '结交', '反戈',
  '领命', '宣读圣旨', '闭关', '结丹', '炼化', '入定',
  '推动', '促成', '引发', '导致', '触发', '扭转', '锁定',
  '身负重伤', '倒地不起', '气绝身亡'
])).sort((a, b) => b.length - a.length);

const NEGATION_MARKERS = [
  '未曾', '未能', '并未', '没有', '不曾', '未见', '无法', '难以',
  '未果', '未成', '未得', '决不', '绝不', '毫不'
];

const POST_VERB_NEGATION_MARKERS = [
  '未果', '未成', '未得', '不成', '失败', '无果', '落空'
];

const FAILURE_MARKERS = [
  '中途折返', '被迫收手', '功亏一篑', '空手而回', '空手而归', '失手',
  '被迫撤离', '被迫仓皇逃窜', '仓皇逃窜', '未能如愿', '无功而返', '两手空空',
  '触动机关后被迫收手'
];

const HYPOTHETICAL_MARKERS = [
  '若是', '假使', '如果', '一旦', '倘若', '万一', '设若', '设想',
  '要是', '纵使', '即便', '假若'
];

const HEARSAY_MARKERS = [
  '传闻', '听说', '据说', '道听途说', '传说', '捕风捉影', '闲聊',
  '坊间传言', '低声闲聊', '不过是捕风捉影'
];

/**
 * 拆解文本为句子，保留标点信息
 */
function splitIntoSentences(text) {
  const content = String(text || '');
  if (!content) return [];
  return content
    .split(/([。！？；\n]+[”"’」』]*)/)
    .filter(Boolean)
    .reduce((acc, cur, idx, arr) => {
      if (idx % 2 === 0) {
        const punct = arr[idx + 1] || '';
        acc.push(cur + punct);
      }
      return acc;
    }, []);
}

const CONTRADICTION_NEGATION_MARKERS = [
  '未曾', '未能', '并未', '没有', '不曾', '未见', '无法', '难以',
  '未果', '未成', '未得', '决不', '绝不', '毫不', '并非', '绝非',
  '决非', '休想', '绝无', '毫无', '并不', '绝不会', '不是', '不曾有',
  '不可能', '岂会', '怎会', '怎能', '岂能', '断不会', '断不可能'
];

const NON_ENTITY_PREFIX = /^(终究|最终|然而|但是|不过|却|依然|依旧|仍然|随后|随即|旋即|遂|于是|只得|不得不|只能|结果|到底|其实|果然|甚至|便|又|再|亦|也|且|并|倒|反倒|竟然|居然|竟|偏偏|终归|到头来|总归|不料|未料|谁料|岂料|当下|这才|但|可|可是|是|还是|实则|实际|终是|更是|只是|仅仅|只|光|犹|尚|仍|总|甚|极其|极为|分明|明明|偏|自己|自身|其|之|已|皆|咸|尽|俱|统统|全部|彻底|完全|几乎|大体|基本|虽|虽然|虽说|即使|纵使|就算|倘若|若是|如果|即|就|当|在|从|自|由|向|往|朝|经|早已|仍旧|已然|两手|双手|双足|浑身|全身|周身|他|她|它|此人|对方|双方)*$/;

function maskDialogueQuotes(text) {
  return String(text || '')
    .replace(
      /(?:“[^”]{0,1000}”|"[^"\r\n]{0,1000}"|‘[^’]{0,1000}’|「[^」]{0,1000}」|『[^』]{0,1000}』|(?<=[\s，。！？；、\n]|^)'[^'\r\n]{0,1000}')/g,
      match => ' '.repeat(match.length)
    )
    .replace(
      /(?:[“「『][^”」』\r\n]{0,1000}|(?<=[\s，。！？；、\n:：]|^)"[^"\r\n]{0,1000})(?=$|\r?\n)/g,
      match => ' '.repeat(match.length)
    );
}

function hasUnnegatedFailure(text, targetTerms = null) {
  const masked = maskDialogueQuotes(text);
  const targets = targetTerms ? (Array.isArray(targetTerms) ? targetTerms : Array.from(targetTerms)).filter(Boolean) : null;

  for (const fail of FAILURE_MARKERS) {
    if (!masked.includes(fail)) continue;
    const clauses = masked.split(/[，,；;、\n]+/).map(c => c.trim()).filter(Boolean);
    for (const clause of clauses) {
      if (!clause.includes(fail)) continue;
      const idx = clause.indexOf(fail);
      const prefix = clause.slice(0, idx).trim();
      const preceding = prefix.slice(-8);
      if (CONTRADICTION_NEGATION_MARKERS.some(m => preceding.includes(m))) {
        continue;
      }

      // 若未限定目标词项上下文，保留全局兜底匹配能力
      if (!targets || targets.length === 0) {
        return true;
      }

      // 1. 子句直接包含目标词项 (实体、谓词或状态关键词)
      if (targets.some(t => clause.includes(t))) {
        return true;
      }

      // 2. 主句包含目标词项，且子句无其他辅助独立实体介入 (主语承接)
      if (targets.some(t => text.includes(t))) {
        const cleanedPrefix = prefix.replace(/[^\u4e00-\u9fa5]/g, '');
        if (NON_ENTITY_PREFIX.test(cleanedPrefix)) {
          return true;
        }
      }
    }
  }
  return false;
}

function isVerbNegatedInText(text, verbCandidates = [], evStr = '') {
  const masked = maskDialogueQuotes(text);
  const clauses = masked.split(/[，,；;、\n]+/).map(c => c.trim()).filter(Boolean);
  for (const clause of clauses) {
    const hasVerb = verbCandidates.some(v => v && clause.includes(v)) || (evStr && clause.includes(evStr));
    if (!hasVerb) continue;
    for (const neg of NEGATION_MARKERS) {
      if (!clause.includes(neg)) continue;
      const negIdx = clause.indexOf(neg);
      const matchingVerbs = verbCandidates.filter(v => v && clause.includes(v));
      const verbIdx = matchingVerbs.length ? Math.min(...matchingVerbs.map(v => clause.indexOf(v))) : (evStr ? clause.indexOf(evStr) : -1);
      const verbLen = matchingVerbs.length ? Math.max(...matchingVerbs.filter(v => clause.indexOf(v) === verbIdx).map(v => v.length)) : (evStr ? evStr.length : 2);

      if (verbIdx !== -1 && negIdx < verbIdx) {
        const between = clause.slice(negIdx + neg.length, verbIdx);
        const hasNegatedFail = FAILURE_MARKERS.some(f => between.includes(f));
        if (!hasNegatedFail) {
          return true;
        }
      } else if (verbIdx !== -1 && negIdx >= verbIdx + verbLen) {
        if (POST_VERB_NEGATION_MARKERS.includes(neg)) {
          const distance = negIdx - (verbIdx + verbLen);
          if (distance <= 6) {
            return true;
          }
        }
      } else if (verbIdx === -1) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 提取事件中的谓词与客体核心实体 (支持 SVO、把/将处置句式 与 被字被动句式)
 */
function parseEventStructure(eventStr) {
  const trimmed = String(eventStr || '').trim();
  if (!trimmed) return { verb: '', entity: '', subject: '', object: '', raw: '' };

  const ev = trimmed.replace(/^[\s“”"'「」『』()（）《》〈〉【】,\.!?，。！？；;、]+|[\s“”"'「」『』()（）《》〈〉【】,\.!?，。！？；;、]+$/g, '').trim();
  if (!ev) return { verb: '', entity: '', subject: '', object: '', raw: trimmed };

  let matchedVerb = '';
  let subject = '';
  let object = '';

  // 1. 优先识别处置句式（把/将字句: 主语 + 把/将 + 宾语 + [修饰] + 动词 + [补语/助词]）
  for (const v of ALL_ACTION_VERBS) {
    const baPattern = new RegExp(`^(.+?)[把将](.+?)(?:给|当场|直接|彻底|顺势|顺手|生生|一并|全部|痛快|予以|便|就|顺带|随手|亲手|悄然|赫然|径直|奋力|断然|终于|终究)*${v}(?:[了着过掉]|致死|于地|到手)?$`);
    const m = ev.match(baPattern);
    if (m) {
      matchedVerb = v;
      subject = m[1].trim();
      object = m[2].trim();
      break;
    }
  }

  // 2. 识别被动句式（被字句: 宾语 + 被 + [主语] + [修饰] + 动词 + [补语/助词]）
  if (!matchedVerb) {
    for (const v of ALL_ACTION_VERBS) {
      const beiPatternWithSubject = new RegExp(`^(.+?)被(.+?)(?:给|当场|直接|彻底|顺势|顺手|生生|予以|便|就|随手|亲手|直接|彻底)*${v}(?:[了着过掉]|致死|于地)?$`);
      const m1 = ev.match(beiPatternWithSubject);
      if (m1) {
        matchedVerb = v;
        object = m1[1].trim();
        subject = m1[2].trim();
        break;
      }
      const beiPatternNoSubject = new RegExp(`^(.+?)被(?:给|当场|直接|彻底|顺势|顺手|生生|予以|便|就|随手|亲手|直接|彻底)*${v}(?:[了着过掉]|致死|于地)?$`);
      const m2 = ev.match(beiPatternNoSubject);
      if (m2) {
        matchedVerb = v;
        object = m2[1].trim();
        subject = '';
        break;
      }
    }
  }

  // 3. 标准 SVO 句式
  if (!matchedVerb) {
    for (const v of ALL_ACTION_VERBS) {
      if (ev.includes(v)) {
        matchedVerb = v;
        const vIdx = ev.indexOf(v);
        subject = ev.slice(0, vIdx).trim();
        object = ev.slice(vIdx + v.length).trim();
        break;
      }
    }
  }

  if (matchedVerb) {
    // 清理客体开头的动态助词与尾部补语 (如 "斩杀了刺客" -> "刺客", "斩杀刺客致死" -> "刺客")
    object = object.replace(/^[了着过]+/, '').replace(/([了着过掉]|致死|于地|到手)$/, '').trim();
    // 清理客体开头的指示代词量词 (如 "这名刺客" -> "刺客", "那枚暗黑古钱" -> "暗黑古钱")
    object = object.replace(/^(这名|那名|该|此|这个|那个|这枚|那枚|这一|那一)/, '').trim();
    // 清理客体末尾的副词与连词 (如 把字句中 "刺客亲手" -> "刺客", "刺客当场" -> "刺客")
    object = object.replace(/(已|已经|成功|顺势|当场|悄然|赫然|径直|奋力|直接|彻底|随手|亲手|断然|终于|终究|一并|全部|痛快|予以|便|就|顺带|并|且)+$/, '').trim();

    // 清理主体前缀常见时态副词与连词 (如 "适逢李巡" -> "李巡", "随后李巡" -> "李巡")
    subject = subject.replace(/^(适逢|随后|随即|旋即|只见|忽然|突然|此时|这时|随之|接着|紧接着|不料|未料|终究|最终)+/, '').trim();
    // 清理主体末尾的副词与连词 (如 "李巡已经成功起获" -> "李巡", "李巡当场斩杀" -> "李巡")
    subject = subject.replace(/(已|已经|成功|顺势|当场|悄然|赫然|径直|奋力|直接|彻底|随手|亲手|断然|终于|终究|并|且|将|把)+$/, '').trim();

    // 清洗主客体外围残余标点与引号
    subject = subject.replace(/^[\s“”"'「」『』()（）《》〈〉【】,\.!?，。！？；;、]+|[\s“”"'「」『』()（）《》〈〉【】,\.!?，。！？；;、]+$/g, '').trim();
    object = object.replace(/^[\s“”"'「」『』()（）《》〈〉【】,\.!?，。！？；;、]+|[\s“”"'「」『』()（）《》〈〉【】,\.!?，。！？；;、]+$/g, '').trim();
  }

  let entity = object || subject || '';

  if (!entity && !subject && !object) {
    const tokens = ev.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
    entity = tokens[tokens.length - 1] || ev;
    object = entity;
  }

  return { verb: matchedVerb, entity, subject, object, raw: trimmed };
}

/**
 * Tier 1: 实体提及判准 (Entity Mentions Discrimination)
 * 区分前景活跃叙事实体与背景传闻/口述/回忆/假设性提及
 */
function detectEntityMentions(text, targetEntities = [], options = {}) {
  const content = String(text || '');
  const entities = Array.isArray(targetEntities) ? targetEntities.map(String).filter(Boolean) : [];
  if (!content || !entities.length) {
    return {
      score: 0,
      entities: [],
      foregroundCount: 0,
      backgroundCount: 0,
      totalCount: entities.length
    };
  }

  const sentences = splitIntoSentences(content);
  const detailed = [];

  let foregroundCount = 0;
  let backgroundCount = 0;

  for (const ent of entities) {
    let totalMentions = 0;
    let fgMentions = 0;
    let bgMentions = 0;

    for (const sent of sentences) {
      if (sent.includes(ent)) {
        totalMentions++;
        const isHearsay = HEARSAY_MARKERS.some(m => sent.includes(m));
        const isHypo = HYPOTHETICAL_MARKERS.some(m => sent.includes(m));
        const hasAction = ACTION_VERBS.some(v => sent.includes(v));

        if ((isHearsay && !hasAction) || isHypo) {
          bgMentions++;
        } else {
          fgMentions++;
        }
      }
    }

    const inForeground = fgMentions > 0;
    if (inForeground) {
      foregroundCount++;
    } else if (bgMentions > 0) {
      backgroundCount++;
    }

    detailed.push({
      name: ent,
      totalMentions,
      inForeground,
      foregroundMentions: fgMentions,
      backgroundMentions: bgMentions
    });
  }

  const score = entities.length > 0 ? Number((foregroundCount / entities.length).toFixed(3)) : 0;

  return {
    score,
    entities: detailed,
    foregroundCount,
    backgroundCount,
    totalCount: entities.length
  };
}

/**
 * 展开谓词与客体的语义近义词表
 */
function expandSynonyms(word, domain) {
  if (!word) return [];
  const list = [word];
  const cfg = DOMAIN_CONFIG[domain];
  if (cfg && cfg.synonymMap) {
    for (const [key, syns] of Object.entries(cfg.synonymMap)) {
      if (word.includes(key) || key.includes(word)) {
        syns.forEach(s => {
          if (!list.includes(s)) list.push(s);
        });
      }
    }
  }
  return list;
}

/**
 * Tier 2: 事件发生判定 (Event Occurrences Engine)
 * 句法局部窗口 (<= 80 字符) 动态动作谓词 + 目标客体绑定，严格过滤否定、挫折未果与假设非实模态
 */
function detectEventOccurrences(text, events = [], options = {}) {
  const content = String(text || '');
  const rawEvents = Array.isArray(events) ? events.map(String).filter(Boolean) : [];
  if (!content || !rawEvents.length) {
    return {
      score: 0,
      events: [],
      verifiedCount: 0,
      totalCount: 0
    };
  }

  const domain = options.domain || 'general';
  const maxWindow = options.localityWindow || 80;
  const sentences = splitIntoSentences(content);
  const results = [];
  let verifiedCount = 0;

  for (const evStr of rawEvents) {
    const { verb, entity, subject, object } = parseEventStructure(evStr);
    const verbCandidates = expandSynonyms(verb, domain);
    const targetEntities = [object, subject, entity].filter(Boolean);
    const entityCandidates = Array.from(new Set(
      (targetEntities.length ? targetEntities : [entity]).flatMap(e => expandSynonyms(e, domain))
    ));

    let bestStatus = 'NOT_FOUND';
    let bestConfidence = 0;
    let evidenceSnippet = '';

    for (const sent of sentences) {
      const hasEntity = entityCandidates.some(e => sent.includes(e));
      const hasVerb = verbCandidates.some(v => sent.includes(v));
      const hasRaw = sent.includes(evStr);

      if (!hasEntity && !hasVerb && !hasRaw) continue;

      let windowText = sent;
      if (sent.length > maxWindow * 2 && hasEntity) {
        let pos = -1;
        for (const e of entityCandidates) {
          pos = sent.indexOf(e);
          if (pos !== -1) break;
        }
        if (pos !== -1) {
          const start = Math.max(0, pos - maxWindow);
          const end = Math.min(sent.length, pos + 10 + maxWindow);
          windowText = sent.slice(start, end);
        }
      }

      // 1. 检查口述/闲聊传闻
      const isHearsay = HEARSAY_MARKERS.some(m => windowText.includes(m));
      // 2. 检查假设性/非实模态
      const isHypo = HYPOTHETICAL_MARKERS.some(m => windowText.includes(m));
      // 3. 检查否定词与挫折未果标记 (排除双重否定，并限定至目标实体与事件谓词)
      const hasFailure = hasUnnegatedFailure(windowText, [...entityCandidates, ...verbCandidates]);
      const isNegated = isVerbNegatedInText(windowText, verbCandidates, evStr);

      if (hasFailure || isNegated) {
        bestStatus = 'FAILED_ATTEMPT';
        bestConfidence = 0.85;
        evidenceSnippet = windowText.slice(0, 100);
        break;
      }

      if (isHypo) {
        if (bestStatus !== 'FAILED_ATTEMPT') {
          bestStatus = 'HYPOTHETICAL';
          bestConfidence = 0.80;
          evidenceSnippet = windowText.slice(0, 100);
        }
        continue;
      }

      // 如果纯属背景闲聊且无实体落地动作
      if (isHearsay && !hasRaw) {
        if (bestStatus === 'NOT_FOUND') {
          bestStatus = 'MENTION_ONLY';
          bestConfidence = 0.60;
          evidenceSnippet = windowText.slice(0, 100);
        }
        continue;
      }

      // 4. 肯定性落地判断
      let verbDistance = 999;
      if (hasVerb && hasEntity) {
        let vPos = 0;
        let ePos = 0;
        for (const v of verbCandidates) {
          if (windowText.includes(v)) { vPos = windowText.indexOf(v); break; }
        }
        for (const e of entityCandidates) {
          if (windowText.includes(e)) { ePos = windowText.indexOf(e); break; }
        }
        verbDistance = Math.abs(vPos - ePos);
      }

      if (hasRaw || (hasVerb && hasEntity && verbDistance <= maxWindow) || (hasVerb && !entity && !isNegated)) {
        bestStatus = 'VERIFIED_OCCURRED';
        bestConfidence = 0.95;
        evidenceSnippet = windowText.slice(0, 100);
        break;
      } else if (hasEntity && !hasVerb) {
        if (bestStatus === 'NOT_FOUND') {
          bestStatus = 'MENTION_ONLY';
          bestConfidence = 0.50;
          evidenceSnippet = windowText.slice(0, 100);
        }
      }
    }

    if (bestStatus === 'VERIFIED_OCCURRED') {
      verifiedCount++;
    }

    results.push({
      event: evStr,
      status: bestStatus,
      confidence: bestConfidence,
      evidenceSnippet
    });
  }

  const score = rawEvents.length > 0 ? Number((verifiedCount / rawEvents.length).toFixed(3)) : 0;

  return {
    score,
    events: results,
    verifiedCount,
    totalCount: rawEvents.length
  };
}

/**
 * 自动识别或匹配结果契约的跃迁领域 (Transition Domain)
 */
function resolveTransitionDomain(outcomeContract, options = {}) {
  if (options.domain && DOMAIN_CONFIG[options.domain]) {
    return options.domain;
  }
  if (outcomeContract?.domain && DOMAIN_CONFIG[outcomeContract.domain]) {
    return outcomeContract.domain;
  }
  if (outcomeContract?.stateDelta?.domain && DOMAIN_CONFIG[outcomeContract.stateDelta.domain]) {
    return outcomeContract.stateDelta.domain;
  }

  const delta = outcomeContract?.stateDelta || {};
  const sample = [
    delta.stateBefore?.summary || delta.stateBefore || '',
    delta.stateAfter?.summary || delta.stateAfter || '',
    Array.isArray(delta.events) ? delta.events.join(' ') : (delta.events || '')
  ].join(' ');

  let bestDomain = 'general';
  let maxMatches = 0;

  for (const domKey of TRANSITION_DOMAINS) {
    const cfg = DOMAIN_CONFIG[domKey];
    const matchCount = cfg.domainSignals.filter(sig => sample.includes(sig)).length;
    if (matchCount > maxMatches) {
      maxMatches = matchCount;
      bestDomain = domKey;
    }
  }

  return bestDomain;
}

/**
 * Tier 3: 叙事状态跃迁判定 (Narrative State Transition Verification)
 * 覆盖 6 大领域，检验催化动作与后状态落地，严格拦截矛盾
 */
function verifyNarrativeStateTransition(text, stateDelta = {}, options = {}) {
  const content = String(text || '');
  if (!content) {
    return {
      score: 0,
      domain: 'general',
      verified: false,
      catalystFound: false,
      afterStateEstablished: false,
      evidenceSnippets: [],
      contradictions: []
    };
  }

  const domain = options.domain || resolveTransitionDomain({ stateDelta }, options);
  const cfg = DOMAIN_CONFIG[domain] || DOMAIN_CONFIG.general;

  // 1. 收集跃迁目标词项 (实体、谓词、状态实词)，用于上下文矛盾作用域界定
  const rawEvents = Array.isArray(stateDelta.events) ? stateDelta.events : (stateDelta.events ? [stateDelta.events] : []);
  const targetTerms = new Set();
  const combatSubjects = new Set();
  let hasCombatObject = false;

  for (const ev of rawEvents) {
    const { subject, object, entity, verb } = parseEventStructure(ev);
    if (domain === 'condition' && object) {
      hasCombatObject = true;
      if (subject) combatSubjects.add(subject);
      targetTerms.add(object);
      expandSynonyms(object, domain).forEach(s => targetTerms.add(s));
    } else {
      if (subject) {
        targetTerms.add(subject);
        expandSynonyms(subject, domain).forEach(s => targetTerms.add(s));
      }
      if (object) {
        targetTerms.add(object);
        expandSynonyms(object, domain).forEach(s => targetTerms.add(s));
      }
    }
    if (entity && (domain !== 'condition' || !object || entity === object)) {
      targetTerms.add(entity);
      expandSynonyms(entity, domain).forEach(s => targetTerms.add(s));
    }
    if (verb) {
      targetTerms.add(verb);
      expandSynonyms(verb, domain).forEach(s => targetTerms.add(s));
    }
  }
  if (stateDelta.targetEntity) {
    targetTerms.add(String(stateDelta.targetEntity));
    expandSynonyms(String(stateDelta.targetEntity), domain).forEach(s => targetTerms.add(s));
  }
  if (Array.isArray(stateDelta.targetEntities)) {
    stateDelta.targetEntities.forEach(e => {
      targetTerms.add(String(e));
      expandSynonyms(String(e), domain).forEach(s => targetTerms.add(s));
    });
  }
  if (Array.isArray(options.entities)) {
    options.entities.forEach(e => {
      targetTerms.add(String(e));
      expandSynonyms(String(e), domain).forEach(s => targetTerms.add(s));
    });
  }
  const afterSummary = stateDelta.stateAfter?.summary || (typeof stateDelta.stateAfter === 'string' ? stateDelta.stateAfter : '');
  if (afterSummary) {
    const afterTokens = afterSummary.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    afterTokens.forEach(t => targetTerms.add(t));
  }
  const beforeSummary = stateDelta.stateBefore?.summary || (typeof stateDelta.stateBefore === 'string' ? stateDelta.stateBefore : '');
  if (beforeSummary) {
    const beforeTokens = beforeSummary.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    beforeTokens.forEach(t => targetTerms.add(t));
  }

  // 辅助实体与修饰语前缀过滤器：允许副词、连词、语气助词承接主语，拦截非目标实词主体 (如 "师妹安好" 中的 "师妹")
  const NON_ENTITY_PREFIX = /^(终究|最终|然而|但是|不过|却|依然|依旧|仍然|随后|随即|旋即|遂|于是|只得|不得不|只能|结果|到底|其实|果然|甚至|便|又|再|亦|也|且|并|倒|反倒|竟然|居然|竟|偏偏|终归|到头来|总归|不料|未料|谁料|岂料|当下|这才|但|可|可是|是|还是|实则|实际|终是|更是|只是|仅仅|只|光|犹|尚|仍|总|甚|极其|极为|分明|明明|偏|自己|自身|其|之|已|皆|咸|尽|俱|统统|全部|彻底|完全|几乎|大体|基本|虽|虽然|虽说|即使|纵使|就算|倘若|若是|如果|即|就|当|在|从|自|由|向|往|朝|经|早已|仍旧|已然|两手|双手|双足|浑身|全身|周身|他|她|它|此人|对方|双方)*$/;

  // 全文预先对白引号脱敏，用于矛盾标记扫描
  const maskedContent = maskDialogueQuotes(content);
  const contradictionSentences = splitIntoSentences(maskedContent);
  const sentences = splitIntoSentences(content);

  // 1. 扫描矛盾标记 (作用域限制在描述目标实体/事件的句子与子句，排除对白引号与否定前缀)
  const contradictions = [];
  for (const sent of contradictionSentences) {
    for (const neg of cfg.contradictionKeywords) {
      if (!sent.includes(neg)) continue;

      const clauses = sent.split(/[，,；;、\n]+/).map(c => c.trim()).filter(Boolean);
      for (const clause of clauses) {
        if (!clause.includes(neg)) continue;

        const idx = clause.indexOf(neg);
        const prefix = clause.slice(0, idx).trim();

        // 排除被否定词修饰的矛盾词（如 "并未空手而归"、"没有毫发无损"）
        const precedingWindow = prefix.slice(-8);
        if (CONTRADICTION_NEGATION_MARKERS.some(m => precedingWindow.includes(m))) {
          continue;
        }

        // 1. 子句直接包含目标实体或核心事件/谓词
        const clauseHasTarget = Array.from(targetTerms).some(t => t && clause.includes(t));
        if (clauseHasTarget) {
          if (!contradictions.includes(neg)) contradictions.push(neg);
          continue;
        }

        // 2. 主句包含目标实体，且子句无其他辅助独立实体介入 (主语承接)
        const sentHasTarget = Array.from(targetTerms).some(t => t && sent.includes(t));
        if (sentHasTarget) {
          const cleanedPrefix = prefix.replace(/[^\u4e00-\u9fa5]/g, '');
          if (NON_ENTITY_PREFIX.test(cleanedPrefix)) {
            // 特殊保护：在 condition 领域，如果存在战斗施动主体且 cleanedPrefix 包含承接施动者的代词 ("自身"/"自己"/"他"/"她"/"其")，
            // 且主句明确包含施动者主体，则承接的是施动者主体而非受击客体，不得判定为矛盾
            if (
              domain === 'condition' &&
              hasCombatObject &&
              (/(自身|自己|他|她|其|本人|此人)/.test(cleanedPrefix) && !/(对方|刺客|敌人|受害者)/.test(cleanedPrefix)) &&
              Array.from(combatSubjects).some(cs => sent.includes(cs))
            ) {
              continue;
            }
            if (!contradictions.includes(neg)) contradictions.push(neg);
            continue;
          }
        }

        // 3. 兜底保护：当目标上下文全空时保留全局匹配能力
        if (targetTerms.size === 0) {
          if (!contradictions.includes(neg)) contradictions.push(neg);
        }
      }
    }
  }

  // 2. 收集催化动词集合 (领域词典 + 来自 stateDelta.events 的动词)
  const allCatalystVerbs = new Set(cfg.catalystVerbs);
  for (const ev of rawEvents) {
    const { verb } = parseEventStructure(ev);
    if (verb) allCatalystVerbs.add(verb);
  }

  // 3. 逐句扫描催化动作与状态确认标记（严格排除假设句与否定句）
  let catalystFound = false;
  let affirmativeFound = false;
  const catalystSnippets = [];
  const affirmativeSnippets = [];

  for (const sent of sentences) {
    const isHypo = HYPOTHETICAL_MARKERS.some(m => sent.includes(m));
    const hasFailure = hasUnnegatedFailure(sent, targetTerms);
    const hasVerbNegation = isVerbNegatedInText(sent, Array.from(allCatalystVerbs));

    // 假设句、失败未果句或否定句中的动作不得作为正向跃迁依据
    if (isHypo || hasFailure || hasVerbNegation) {
      continue;
    }

    for (const verb of allCatalystVerbs) {
      if (sent.includes(verb)) {
        catalystFound = true;
        catalystSnippets.push(verb);
      }
    }

    for (const aff of cfg.affirmativeKeywords) {
      if (sent.includes(aff)) {
        affirmativeFound = true;
        affirmativeSnippets.push(aff);
      }
    }
  }

  // 4. stateAfter 核心摘要实词检查（同样要求在肯定语境中落地）
  let afterSummaryAffirmed = false;
  if (afterSummary) {
    const afterTokens = afterSummary.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    for (const sent of sentences) {
      const isHypo = HYPOTHETICAL_MARKERS.some(m => sent.includes(m));
      const hasFailure = hasUnnegatedFailure(sent, afterTokens);
      const hasVerbNegation = isVerbNegatedInText(sent, afterTokens);
      if (isHypo || hasFailure || hasVerbNegation) continue;

      if (afterTokens.some(tok => sent.includes(tok))) {
        afterSummaryAffirmed = true;
        break;
      }
    }
  }

  const afterStateEstablished = (affirmativeFound || afterSummaryAffirmed) && contradictions.length === 0;
  const verified = catalystFound && afterStateEstablished && contradictions.length === 0;

  let score = 0.50;
  if (catalystFound) score += 0.20;
  if (afterStateEstablished) score += 0.30;
  if (contradictions.length > 0) score -= 0.60;
  if (!verified) score = Math.min(score, 0.65);

  return {
    score: Math.max(0.05, Math.min(1.0, Number(score.toFixed(3)))),
    domain,
    domainName: cfg.name,
    verified,
    catalystFound,
    afterStateEstablished,
    evidenceSnippets: [...catalystSnippets, ...affirmativeSnippets],
    contradictions
  };
}

/**
 * 检验正文对结果契约 (Narrative Outcome Contract) 的完整达成度
 * 支持参数双向重载 (text, contract) 或 (contract, text)
 * 
 * @param {string|Object} textOrContract 正文内容或契约实体
 * @param {Object|string} contractOrText 契约实体或正文内容
 * @param {Object} options 评测选项
 * @returns {Object} 结构化评测结果
 */
function evaluateOutcomeContractFulfillment(textOrContract, contractOrText, options = {}) {
  let text = '';
  let outcomeContract = null;

  if (typeof textOrContract === 'string') {
    text = textOrContract;
    outcomeContract = contractOrText;
  } else if (typeof contractOrText === 'string') {
    text = contractOrText;
    outcomeContract = textOrContract;
  } else if (textOrContract && (textOrContract.stateDelta || textOrContract.schemaVersion)) {
    outcomeContract = textOrContract;
    text = String(contractOrText || '');
  } else {
    text = String(textOrContract || '');
    outcomeContract = contractOrText || {};
  }

  const content = String(text || '');
  if (!content) {
    return Object.freeze({
      passed: false,
      fulfillmentScore: 0,
      entityMentions: { score: 0, entities: [], foregroundCount: 0, totalCount: 0 },
      eventOccurrences: { score: 0, events: [] },
      stateTransitions: { score: 0, domain: 'general', verified: false, contradictions: [] },
      contradictionsDetected: [],
      tierBreakdown: {
        entityMentions: { score: 0, entities: [] },
        eventOccurrences: { score: 0, events: [] },
        stateTransitions: { score: 0, verified: false, contradictions: [] }
      },
      observations: ['正文为空']
    });
  }

  const delta = outcomeContract?.stateDelta || {};
  const events = Array.isArray(delta.events) ? delta.events.map(String).filter(Boolean) : (delta.events ? [String(delta.events)] : []);
  const domain = resolveTransitionDomain(outcomeContract, options);

  // 1. 提取目标实体集 (独立提取主客体)
  const entityCandidates = new Set();
  for (const ev of events) {
    const { subject, object, entity } = parseEventStructure(ev);
    if (subject) entityCandidates.add(subject);
    if (object) entityCandidates.add(object);
    if (entity) entityCandidates.add(entity);
  }
  if (options.entities && Array.isArray(options.entities)) {
    options.entities.forEach(e => entityCandidates.add(String(e)));
  }

  // 2. 执行三层判准
  const entityMentions = detectEntityMentions(content, Array.from(entityCandidates), options);
  const eventOccurrences = detectEventOccurrences(content, events, { ...options, domain });
  const stateTransitions = verifyNarrativeStateTransition(content, delta, { ...options, domain });

  const contradictionsDetected = stateTransitions.contradictions;

  // 3. 统计判定与得分计算
  const observations = [];
  let score = 0.50;

  // Tier 1 权重贡献: +0.15
  if (entityMentions.totalCount > 0) {
    score += (entityMentions.foregroundCount / entityMentions.totalCount) * 0.15;
  } else {
    score += 0.10;
  }

  // Tier 2 权重贡献: +0.20
  const verifiedEvents = eventOccurrences.events.filter(e => e.status === 'VERIFIED_OCCURRED').length;
  const failedEvents = eventOccurrences.events.filter(e => e.status === 'FAILED_ATTEMPT').length;
  const hypoEvents = eventOccurrences.events.filter(e => e.status === 'HYPOTHETICAL').length;
  const mentionOnlyEvents = eventOccurrences.events.filter(e => e.status === 'MENTION_ONLY').length;

  if (events.length > 0) {
    if (verifiedEvents > 0) {
      score += (verifiedEvents / events.length) * 0.20;
      observations.push(`检测到 ${verifiedEvents} 项推进事件的核心事实落地`);
    } else {
      score -= 0.15;
      observations.push('未检测到推进事件的核心实体');
    }

    if (failedEvents > 0) {
      score -= failedEvents * 0.25;
      observations.push(`检测到 ${failedEvents} 项推进事件遭遇挫折或未果`);
    }
    if (hypoEvents > 0) {
      score -= hypoEvents * 0.10;
    }
    if (mentionOnlyEvents > 0 && verifiedEvents === 0) {
      score -= 0.05;
      observations.push(`推进事件仅作为背景传闻或口述提及，未在正文中真实发生`);
    }
  }

  // Tier 3 权重贡献: +0.15
  if (stateTransitions.verified) {
    score += 0.15;
    observations.push(`叙事状态跃迁达成 [${stateTransitions.domainName}]: 催化动作与后续状态均已确立`);
  } else {
    score -= 0.10;
    if (contradictionsDetected.length > 0) {
      score -= 0.35;
      observations.push(`检测到跃迁矛盾互斥标记: ${contradictionsDetected.join(', ')}`);
    } else {
      observations.push(`叙事状态跃迁未完全确立 [${stateTransitions.domainName}]`);
    }
  }

  // 4. 计算综合履行得分与合格门槛
  const finalScore = Math.max(0.05, Math.min(1.0, Number(score.toFixed(2))));
  const hasZeroContradictions = contradictionsDetected.length === 0;
  const passed = finalScore >= 0.75 && stateTransitions.verified && hasZeroContradictions && failedEvents === 0;

  const result = {
    passed,
    fulfillmentScore: finalScore,
    entityMentions,
    eventOccurrences,
    stateTransitions,
    contradictionsDetected,
    tierBreakdown: {
      entityMentions,
      eventOccurrences,
      stateTransitions
    },
    observations
  };

  return Object.freeze(result);
}

module.exports = {
  TRANSITION_DOMAINS,
  DOMAIN_CONFIG,
  parseEventStructure,
  detectEntityMentions,
  detectEventOccurrences,
  verifyNarrativeStateTransition,
  evaluateOutcomeContractFulfillment
};
