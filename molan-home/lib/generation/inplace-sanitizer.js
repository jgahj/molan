'use strict';

/**
 * inplace-sanitizer.js
 * ---------------------------------------------------------------------------
 * 确定性正文微创手术替换雷达 (Deterministic In-Place Surgical Sanitizer)
 *
 * 核心目标：
 * 解决大模型生成小说时的三大顽疾：
 * 1. Prompt 催眠失效：无论提示词如何严禁，模型仍会高频吐出“嘴角勾起/扯起”、“骨节泛白”、
 *    “喉头一甜/泛起腥甜”、“瞳孔骤缩”等预训练神经反射；
 * 2. 元指令抄写进正文：模型把内心算计指令直接机械写成
 *    “心头飞速转过阴毒的念头：‘……’”这类出戏自报家门；
 * 3. 思考 Token 泄漏与草稿残留：去除 <think>、*Draft 等草稿碎片与代码围栏。
 * ---------------------------------------------------------------------------
 */

// 1. 思考碎片与草稿标记清除正则
const THINKING_TAG_REGEXES = [
  /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi,
  /<thought>[\s\S]*?<\/thought>/gi,
  /^\s*\*Draft\s*\d+[\s\S]*?\n(?=[一-龥“])/gm,
  /^\s*```(?:markdown|text)?\s*$/gm,
  /^\s*```\s*$/gm
];

// 2. 元指令与机械内心独白引导词切除与成熟化
const META_DIRECTIVE_PATTERNS = [
  {
    // 匹配如：心头飞速转过阴毒的念头：‘这小子莫不是冲着案子来的？’
    pattern: /(?:心(?:头|中)|暗自)(?:飞速|急速|飞快|微)?(?:转过|闪过|掠过|升起|涌起)(?:一个|数个|一丝|几分)?(?:阴毒|阴沉|狠厉|复杂|算计|冰冷|怨毒)?的?念头[：:](?:“|‘)?([^”’\n]{2,100})(?:”|’)?/g,
    replace: (match, p1) => `心中暗忖：${p1.trim()}`
  },
  {
    pattern: /(?:心(?:头|中)|暗自)(?:暗想|寻思|默念)[：:](?:“|‘)([^”’\n]{2,100})(?:”|’)/g,
    replace: (match, p1) => `心底盘算：${p1.trim()}`
  },
  {
    pattern: /【场景(?:一|二|三|1|2|3)[^】]*】\s*/g,
    replace: ''
  },
  {
    pattern: /【第(?:一|二|三|1|2|3)幕[^】]*】\s*/g,
    replace: ''
  }
];

// 3. 确定性物理受力与冷硬动作微创置换规则库
const PHYSICAL_SURGERY_RULES = [
  // A. 受伤与内伤套话 (R-37) -> 物理受力反馈 / 齿缝腥气
  {
    name: 'throat_sweet_or_blood_surge',
    pattern: /(?:喉头|喉咙)(?:一甜|泛起(?:一[丝抹点])?腥甜)|(?:体内)?气血翻涌/g,
    replacements: [
      '胸口如遭重锤，腥气直冲齿缝',
      '后背撞在生铁边缘，齿缝泛起铁锈味',
      '脏腑剧烈一震，一股腥气顶上牙关'
    ]
  },
  {
    name: 'electric_numbness',
    pattern: /(?:震得|震得那?)(?:脚底|双脚|双腿|脚掌|虎口|手腕|手臂|五脏|耳膜|整个人)(?:发麻|发木|发酸|生疼|嗡嗡作响)/g,
    replacements: [
      '掌中生铁剧烈震荡',
      '反震之力顺着手腕直冲肩头',
      '脚底青石被蹬得生生刮去一层碎粉'
    ]
  },

  // B. 模板化笑意神态 (R-14, R-16) -> 眼帘冷定 / 压低刀柄 / 面无表情
  {
    name: 'template_smile',
    pattern: /(?:嘴角|唇角)[^。！？\n]{0,8}(?:勾起|扯起|挑起|扬起|微微勾起|缓缓勾起|浮现|挂着|掀起)[^。！？\n]{0,8}(?:一抹)?[^。！？\n]{0,8}(?:弧度|笑意|笑容|冷笑|阴狠|玩味|意味难明|讥诮)/g,
    replacements: [
      '眼角微抬，冷冷吐出半句话',
      '眼神一凛，反手扣住刀柄生铁护手',
      '神色没有半分松动',
      '面无表情地看着对方'
    ]
  },
  {
    name: 'lip_corner_word',
    pattern: /唇角/g,
    replace: '嘴角'
  },

  // C. 骨节泛白痉挛套路 (R-40, R-42) -> 具体的器物接触 / 五指扣紧
  {
    name: 'bone_whitening',
    pattern: /(?:指节|指骨|骨节|关节|指尖|指头|手指|手背)[^，。\n]{0,8}(?:泛白|发白|变白|毫无血色|失去血色|硌得发白|捏得发白|攥得发白)/g,
    replacements: [
      '右手死死扣住生铁护手',
      '五指深深抠进粗糙的木纹',
      '手指力道骤增，指尖青筋凸起'
    ]
  },

  // D. 瞳孔神经反射 (R-36) -> 视线压低 / 眼神剧沉
  {
    name: 'pupil_reflex',
    pattern: /瞳孔(?:骤然|猛然|急速|猛地)?(?:收缩|放大|骤缩)/g,
    replacements: [
      '眼帘猛地一沉',
      '视线瞬间压低',
      '眼神冷了下来'
    ]
  },

  // E. 呼吸停滞与心跳漏拍 (R-40) -> 气息收紧 / 动作顿住
  {
    name: 'breath_pause',
    pattern: /呼吸(?:骤然|猛然|不由得)?一滞|呼吸一紧/g,
    replacements: [
      '气息猛地顿住',
      '下意识屏住呼吸',
      '吸入口中的冷风瞬间卡在喉间'
    ]
  },
  {
    name: 'heartbeat_skip',
    pattern: /心跳(?:骤然|猛然)?漏了一拍|心跳漏了半拍/g,
    replacements: [
      '胸口骤然一紧',
      '心头猛地往下一沉'
    ]
  },

  // F. 冷气与后颈发凉 (R-40) -> 冷汗 / 寒意
  {
    name: 'neck_chill',
    pattern: /后颈(?:发凉|一凉|汗毛倒竖)|一股凉气从脚底/g,
    replacements: [
      '后心渗出一层寒意',
      '后背渗出一层冷汗'
    ]
  },
  {
    name: 'gasp_air',
    pattern: /(?:倒吸|深吸)一口凉气/g,
    replacements: [
      '下意识屏住呼吸',
      '暗暗压住胸中起伏'
    ]
  },
  {
    name: 'jaw_clenching',
    pattern: /下颌(?:线)?(?:骤然)?(?:绷紧|收紧)|牙关紧咬|牙关咬得咯咯作响/g,
    replacements: [
      '咬紧牙关，没有做声',
      '面颊线条冷硬如铁'
    ]
  },

  // G. 视线游走与局部主体化 (R-13)
  {
    name: 'look_around_body_subject',
    pattern: /(?:目光|视线)在(?:屋[内里]|四周|场中|众人身上)转了一圈/g,
    replacements: [
      '视线扫过屋内各处',
      '目光落在四周众人脸上'
    ]
  },
  {
    name: 'eye_sharp_knife',
    pattern: /目光如刀(?:削)?|目光锐利如刀/g,
    replacements: [
      '冷冷看着对方眉心',
      '目光冰冷刺骨'
    ]
  },

  // H. 烂俗套话比喻 (R-05, R-17) -> 具体现实描写
  {
    name: 'dead_silence',
    pattern: /死一般的寂静|像一潭死水/g,
    replacements: [
      '屋内落针可闻',
      '四下里沉寂得只有雨水滴落声'
    ]
  },
  {
    name: 'face_like_water',
    pattern: /面沉如水/g,
    replacements: [
      '面无表情',
      '脸上看不出半点波澜'
    ]
  },
  {
    name: 'broken_kite',
    pattern: /如断线风筝(?:般)?(?:倒飞|跌落)?/g,
    replacements: [
      '身躯失控砸翻两张木桌',
      '重重撞在青石台阶上'
    ]
  }
];

/**
 * 确定性正文微创手术清洗
 * @param {string} text 待清洗的小说正文
 * @param {object} [options] 配置选项
 * @returns {{ text: string, modified: boolean, replacementCount: number, details: Array<object> }}
 */
function sanitizeInPlace(text, options = {}) {
  let content = String(text || '');
  if (!content.trim()) return { text: '', modified: false, replacementCount: 0, details: [] };

  const details = [];
  let modified = false;

  // 1. 清理思考与草稿围栏
  for (const rgx of THINKING_TAG_REGEXES) {
    if (rgx.test(content)) {
      content = content.replace(rgx, '');
      modified = true;
      details.push({ type: 'thinking_cleaned', pattern: rgx.toString() });
    }
  }

  // 2. 清理元指令与机械独白引导
  for (const item of META_DIRECTIVE_PATTERNS) {
    if (item.pattern.test(content)) {
      content = content.replace(item.pattern, typeof item.replace === 'function' ? item.replace : item.replace);
      modified = true;
      details.push({ type: 'meta_directive_removed', pattern: item.pattern.toString() });
    }
  }

  // 3. 确定性物理置换
  let replacementSeed = 0;
  for (const rule of PHYSICAL_SURGERY_RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(content)) {
      content = content.replace(rule.pattern, (match) => {
        let replacement = '';
        if (typeof rule.replace === 'string') {
          replacement = rule.replace;
        } else if (Array.isArray(rule.replacements) && rule.replacements.length > 0) {
          replacement = rule.replacements[replacementSeed % rule.replacements.length];
          replacementSeed++;
        } else {
          replacement = match;
        }
        details.push({
          rule: rule.name,
          original: match,
          replacedWith: replacement
        });
        modified = true;
        return replacement;
      });
    }
  }

  // 4. 清理冗余空行与两端空白
  content = content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 5. 结尾闭合防截断保护
  const hasTerminalPunctuation = /[。！？……”’]$/.test(content);
  if (!hasTerminalPunctuation && content.length > 200) {
    // 寻找最后一个自然句末标点
    const lastPunctIdx = Math.max(
      content.lastIndexOf('。'),
      content.lastIndexOf('！'),
      content.lastIndexOf('？'),
      content.lastIndexOf('”')
    );
    if (lastPunctIdx > content.length - 80 && lastPunctIdx > 100) {
      // 截掉最后不成句的悬空半句话
      content = content.slice(0, lastPunctIdx + 1).trim();
      modified = true;
      details.push({ type: 'terminal_clause_trimmed', trimmedFrom: lastPunctIdx });
    } else {
      // 补上句号
      content = content + '。';
      modified = true;
      details.push({ type: 'terminal_period_appended' });
    }
  }

  return {
    text: content,
    modified,
    replacementCount: details.length,
    details
  };
}

/**
 * 直接返回清洗后正文字符串
 */
function cleanTextForOutput(text, options = {}) {
  const result = sanitizeInPlace(text, options);
  return result.text;
}

module.exports = {
  sanitizeInPlace,
  cleanTextForOutput,
  PHYSICAL_SURGERY_RULES,
  META_DIRECTIVE_PATTERNS
};
