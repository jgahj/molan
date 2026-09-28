'use strict';

const fs = require('node:fs');
const path = require('node:path');
const review = require('../lib/evidence-review');
const { computeAiFlavorScore } = require('../lib/ai-flavor-detector');
const correctionPolicy = require('../correction-policy');
const pipeline = require('../lib/benchmark-pipeline');

// Control Group A: R2 baseline generation (without payoff 4-step & without loot touch directive)
const sampleA = `# 第二章　堂前验册

执事堂前的青石台阶上覆着薄霜，清晨的寒风卷着落叶扫过回廊。

三十余名外门弟子散在石坪两侧，手里各自捏着领俸的木筹，窃窃私语声在晨雾中起伏不定。今日是孟冬月俸发放之期，但高踞案桌后的外门执事赵坤，却把那本朱砂红皮的账册翻得哗哗作响。

“张拂潇，你上月在断魂谷采摘幽冥草，私损药铲两柄，漏交灵草三株。”赵坤抬起眼皮，两道法令纹如刀刻般深陷，右手食指重重叩在案几上，“折算下来，本月该发你的三枚下品灵石尽数充公，另外还倒欠公库二十枚。今日若交不出灵石，便需将你祖传的那枚青玉残卷暂押执事堂。”

石坪周围的弟子顿时安静下来。谁都明白，所谓折损欠账不过是个借口，赵坤真正觊觎的，是张拂潇怀里那枚残缺的古玉简。

张拂潇站在石阶第三级，面色平静，身上的粗麻道袍洗得发白，袖口被晨风吹得猎猎作响。他没有露出惊慌失措的神情，只是从袖中取出一张折叠得齐整的泛黄油纸，展开在掌心。

“赵执事，宗门药园的收割规制在《百草清律》第四条写得清清楚楚。”张拂潇的声音不大，却清晰地传遍整个石坪，“凡采掘三品以下阴属灵草，折损两成之内皆由宗门损耗补贴；且上月交割药草时，乃是前任孙执事亲自过目核验，这是孙执事离任前签署的盖印结单。”

赵坤眼角猛地跳动了一下，抓起那张油纸扫了两眼，脸色逐渐阴沉下来：“孙执事已于月初调往内门，这等陈年旧单死无对证，谁知是不是你伪造的私凭？”

“纸上有孙执事的本命朱砂印信，执事若有疑虑，大可传讯执法堂查验灵纹真伪。”张拂潇踏上一步，目光落定在案头的账册上，“倒是赵执事手里的底册，上月初六这页墨迹发亮，边缘裁切粗糙，分明是昨夜匆忙撕扯重装的补页。”

人群中顿时起了一阵骚动，几名老弟子交头接耳，目光纷纷投向赵坤的案桌。

赵坤勃然大怒，宗门执事的威严被一个外门小辈当众撕开，让他恼羞成怒。他猛然拍案而起，浑身真气激荡，练气七层的威压轰然散开：“放肆！区区外门杂役，也敢当众污蔑宗门执事！今日若不严惩，执事堂威严何在！”

话音未落，赵坤欺身而上，右手化作鹰爪，狂暴的风刃撕裂空气，直奔张拂潇胸口要害抓来。这一爪动了真怒，分明是要当场废掉张拂潇的经脉。

面对凌厉的爪风，张拂潇眼神微动，脚踏奇门步法侧滑三尺，右掌自下而上斜切而出，体内压抑许久的雷元真气悍然爆发。

两股力量在半空中轰然对撞，空气中爆发出沉闷的闷响。赵坤只觉对方掌风刚猛无匹，狂暴的震荡之力瞬间震偏了他的攻势。

赵坤连退了三步才勉强稳住身形，面色难看至极。他没想到这个平日里低调隐忍的少年，竟藏着如此深厚的修为。

“好小子，原来藏了拙。”赵坤咬牙冷笑，但在众目睽睽之下失手，自知理亏，再动手恐引来执法长老干预。他深吸了一口气，将桌上的欠条撕成两半，冷冷道，“今日算你走运，扣除的月俸归还与你，这残卷且由你保管！”

张拂潇收起欠条与纳戒中的残卷，转身下山。石阶上的晨雾渐渐散去，但他知道，赵坤身后的内门长老绝不会善罢甘休。`;

// Treatment Group B: R3 optimized generation (4-step payoff + immediate loot touch/inspection + dialogue depth)
const sampleB = `# 第二章　堂前对质与当场验货

执事堂前的青石石坪泛着刺骨寒意，清晨的薄霜凝在廊檐铜铃上，久久未化。

三十余名外门弟子缩着脖颈立在石阶下，手里捏着领俸的木筹，彼此交换着惊疑不定的目光。高踞案桌后的外门执事赵坤，正慢条斯理地抿了一口热茶，案几上摊开着一本朱砂画圈的厚重账册。

“张拂潇，上月你在黑水渊采药，遗失精铁药铲两柄，少交三叶幽冥草四株。”赵坤放下茶盏，瓷盖与茶碗磕碰出刺耳的脆响，他抬起浮肿的眼皮冷笑道，“按律折算灵石二十枚。今日你若拿不出这笔赔偿，便将你亡父留下的《九霄雷印》残卷押在公库抵账。”

台阶下一片压抑的死寂。众弟子心知肚明，所谓欠款不过是强取豪夺的幌子，赵坤盯上那卷古修残篇已非一日。

张拂潇身穿一袭洗得泛白的青布长袍，立在第三级石阶上，神色未见半分惊乱。他自袖囊中取出一叠泛黄的硬皮册页，指尖在封签处轻轻一抹。

“赵执事若是记性不好，不妨看看这卷原版出入账目。”张拂潇抬眸直视案前之人，语调沉稳如古井微澜，“上月初五交割，前任孙执事以本命灵识烙下朱雀封印，明注灵草全数入库，精铁药铲乃是自然磨损折旧。你昨夜新填的私账，上面的宗门暗记甚至漏盖了左角云纹。”

赵坤面皮猛烈抽搐了一下，探手抓过那叠硬皮册页，目光触及那一枚鲜红如血的朱雀法印时，眼角剧烈跳动。

“大胆狂徒！竟敢私盗宗门旧档伪造法印！”赵坤眼见诡计败露，在数十名外门弟子注视下顿生杀心，案桌被他一掌震得四分五裂，木屑漫天激射，“目无尊长，污蔑执事，今日老夫便替戒律堂废了你这一身驳杂气血！”

话音未落，赵坤整个人腾空暴起，枯瘦的手掌瞬间化作乌黑青鳞之色，挟带一阵腥臭恶风，五指如钢钩直扣张拂潇的天灵盖。

面对这毫无征兆的暴起发难，张拂潇没有退后半步。他右足重重一踏，脚下青石板轰然塌陷出三寸深坑，体内沉寂的雷脉真元如决堤江水般咆哮奔涌。

“赵坤，你太贪了。”

张拂潇右掌翻转，掌心隐隐浮现出一道深紫色的雷霆符印，后发先至，迎着那乌黑掌印悍然横推而出。

拳掌相交的瞬间，空气中爆开一声沉闷至极的炸响。紫青交织的气浪如狂飙般横扫石坪，几名靠得近的弟子甚至被掀得连连倒退。

只听得“咔嚓”一声脆响，赵坤右臂衣袖瞬间炸成粉碎。他整个人如遭重锤横扫，倒退数步，后背狠狠砸在执事堂的朱红大柱上，当场喷出一口黑红逆血。

“面色惨白，手腕剧痛，骨裂之声清晰可闻。”赵坤瘫软在地，嘴唇哆嗦着抬起软绵绵的右手，眼角剧烈抽动，失声尖叫道：“雷印真意……你竟然已经练成了雷煞真劲？！这绝不可能！”

全场弟子目瞪口呆，谁也没想到平日里低眉顺眼的药园少年，竟能一掌重创练气七层的外门执事。

张拂潇神色漠然，缓步走到赵坤身前，俯身自其腰间扯下一枚墨色储物袋，从容拉开袋口的兽筋暗扣。

袋中除了二十枚晶莹剔透的下品灵石，赫然躺着一卷非金非木的紫玉残卷。

张拂潇将那枚《九霄雷印》残卷握在掌心。入手冰凉微沉，玉质表面雕刻的云雷纹路凹凸有致，指尖抚过断口处，甚至能感到残存的雷煞温热。他微阖双目，一缕神念探入玉简之中，确认内里记载的功法心诀完整无缺，未被外力抹去，这才神色自若地将玉简连同灵石一并揣入怀中内袋。

“执事大人，欠条与灵石，今日张某便替你清结了。”

张拂潇收手拂袖，转身朝石阶下行去。围观的三十余名弟子神色敬畏，不由自主向两侧退开，让出一条笔直的山道。

晨风吹散了阶前的血腥气，但山道尽头，内门执法堂的传讯飞剑正泛着凄厉血光，破空而来。`;

console.log('=== 运行 R3 对比实验量化审计 ===\n');

function analyzeText(text, label) {
  const chars = text.length;
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const paragraphs = review.indexedParagraphs(text);
  
  // 句子分析 (。！？)
  const sentences = text.split(/(?<=[。！？])/u).map(s => s.trim()).filter(Boolean);
  const sentenceLens = sentences.map(s => s.length);
  const sentMean = sentenceLens.reduce((a, b) => a + b, 0) / (sentenceLens.length || 1);
  const sentVariance = sentenceLens.reduce((sum, len) => sum + Math.pow(len - sentMean, 2), 0) / (sentenceLens.length || 1);
  const sentStd = Math.sqrt(sentVariance);

  // 对白分析
  const dialogues = [];
  const dialogueRegex = /“([^”]+)”|"([^"]+)"/g;
  let match;
  while ((match = dialogueRegex.exec(text)) !== null) {
    dialogues.push(match[1] || match[2]);
  }
  const dialogueCharCount = dialogues.reduce((sum, d) => sum + d.length, 0);
  const dialogueRatio = dialogueCharCount / chars;
  const dialogueTurnMean = dialogues.length ? (dialogueCharCount / dialogues.length) : 0;

  // 段落分析
  const paraLens = paragraphs.map(p => p.raw.length);
  const paraMean = paraLens.reduce((a, b) => a + b, 0) / (paraLens.length || 1);

  // AI 味评分
  const aiScore = computeAiFlavorScore(text);

  // 纠错库检测
  const correctionResult = correctionPolicy.scanUniversalCorrectionRisks(text, { genre: '玄幻' });
  const findings = correctionResult ? correctionResult.findings : [];

  // 登场实体检查
  const groundingIssues = review.checkEntityGrounding(text, { knownEntities: ['张拂潇', '赵坤'] });

  // 爽点与战利品验货检查
  const payoffIssues = review.checkPayoffExecution(text, { expectPayoff: true });

  return {
    label,
    chars,
    sentencesCount: sentences.length,
    sentMean: sentMean.toFixed(2),
    sentStd: sentStd.toFixed(2),
    paragraphCount: paragraphs.length,
    paraMean: paraMean.toFixed(1),
    dialogueCount: dialogues.length,
    dialogueRatio: (dialogueRatio * 100).toFixed(1) + '%',
    dialogueTurnMean: dialogueTurnMean.toFixed(2),
    aiScore: aiScore ? { score: aiScore.totalScore, passed: aiScore.passed, reasons: aiScore.breakdown } : 'N/A',
    correctionFindingsCount: findings.length,
    groundingIssuesCount: groundingIssues.length,
    groundingIssues,
    correctionFindingsCount: findings.length,
    findings: findings.map(f => ({ ruleId: f.ruleId, text: f.text, label: f.label })),
    payoffIssuesCount: payoffIssues.length,
    payoffIssues
  };
}

const statsA = analyzeText(sampleA, '对照组 A (R2 基准版)');
const statsB = analyzeText(sampleB, '实验组 B (R3 优化版)');

console.log(JSON.stringify({ statsA, statsB }, null, 2));
