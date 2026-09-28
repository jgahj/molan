// scripts/generate-fanren-10-chapters.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const molanHome = 'c:/Users/lyh/Desktop/小说专属网页/molan-home';
const { computeAiFlavorScore } = require(path.join(molanHome, 'lib/ai-flavor-detector'));
const {
  prepareGenreSceneContext,
  checkSourceOverlap,
  loadCorpusForFamily,
  sanitizeAiFlavor,
  CausalDebtTracker
} = require(path.join(molanHome, 'lib/genre-engine'));

const BASE_URL = 'http://127.0.0.1:3000';
const EMAIL = '1271055010@qq.com';
const PASSWORD = '123456';
const OUT_DIR = path.join(molanHome, 'data/genre-lab/fanren-10-chapters');
const DEBTS_DIR = path.join(OUT_DIR, 'debts');
const BOOK_ID = 'fanren_original_taixu_book';

// 原著专有词零容忍监控清单（严禁侵权抄袭）
const FORBIDDEN_IP_TERMS = [
  '韩立', '掌天瓶', '落霞宗', '黄枫谷', '厉飞雨', '墨大夫', '青元剑诀', '血色禁地', '七玄门'
];

const FORBIDDEN_AI_CLICHES = [
  '倒吸一口凉气', '倒吸凉气', '眼神一凝', '双眼微眯', '瞳孔微缩',
  '嘴角勾起', '扯了扯嘴角', '深吸一口气', '不由得一愣', '愣了一下',
  '脑海中轰然作响', '气血翻涌', '喉头一甜', '虎口发麻', '后背冷汗直流',
  '第一息', '第二息', '第三息', '恐怖如斯', '这一刻，他',
  '若违约', '抽取生魂', '炼入煞矿', '矿奴三年', '若逾期', '违契者'
];

const SOMATIC_REFLEXES = [
  '喉咙发紧', '咽喉发紧', '喉头发干', '喉头一哽', '指节泛白', '指节发白', '心跳漏了一拍',
  '呼吸一滞', '呼吸骤停', '下颌紧绷', '后颈发凉', '后颈一凉',
  '手心冷汗', '手心全是冷汗', '牙关紧咬', '咬紧后槽牙',
  '指骨发白', '指骨泛白', '硌得发白', '骨节发白', '骨节泛白', '关节发白', '手背发白',
  '指腹摩挲', '指肚摩挲', '反复摩挲', '食指轻叩', '轻叩桌面', '指尖悬停', '僵在半空',
  '掐进掌心', '掐入掌心', '按揉太阳穴', '揉太阳穴', '喉结上下滚动', '喉结微动',
  '脉搏一下一下', '一下一下地收紧', '一下一下收紧', '一下一下地抽痛', '一下一下地跳动', '血线钻进'
];

const TRANSLATIONESE = [
  '在这一刻显得格外', '无不在昭示着', '带着一种不容置疑的', '试图去寻找', '不得不承认的是'
];

const MICRO_ACTIONS = [
  '推了推眼镜', '推眼镜', '揉了揉虎口', '捏了捏手指', '摸了摸下巴', '摸了摸胡茬', '咬了咬下唇', '抿了抿嘴'
];

const REFINEMENT_DIRECTIVES = `
【深度精修·名家笔力与原创凡人流九大铁律（必须严格执行）】：
1. 【100% 独立原创，严禁照搬原著实体】：
   - 主角：【季安】（二十出头的四伪灵根草根散修，面色微黑木讷，眼神沉静如渊，行事谨微狠绝，后改名【严平】）；
   - 核心异宝：【太虚沉煞铜漏】（锈迹斑驳覆满铜绿的古旧青铜药漏，每隔七夜汲取星煞沉淀一滴冰凉彻骨的紫金【沉煞露】，可洗练顽劣残种与催熟年份）；
   - 关键势力：【赤崖散修坊市】、【栖霞门】（冷酷二流大宗）、【七峰山沉砂矿脉】；
   - 绝严禁出现“韩立”、“掌天瓶”、“落霞宗”、“黄枫谷”等原著任何专有名词！
2. 【篇幅严格限制：2,200 ~ 2,800 汉字】：全章字数必须严格控制在 2,200 ~ 2,800 字之间（严禁低于 2,000 字，严禁超过 3,000 字）！去繁就简，严禁大篇幅水环境描写，镜头干脆利落，聚焦事件即时推进！
3. 【彻底封杀骨节泛白一切变体】：绝对严禁描写“指节/指骨/关节/指头发白或硌得发白”！手部用力请描写朴素动作（如五指扣紧刀柄、手掌按进泥中），绝不关注骨头颜色！
4. 【彻底封杀机械脉动节律与寄生虫异化】：绝对严禁写“契文血线钻进皮肉，随着脉搏一下一下收紧/抽痛”！契约画押只写朴素写实的人间动作（如“在兽皮上按了血印”，“收起借据”），绝不玄虚夸张。
5. 【彻底封杀网游任务惩罚公告体】：绝对严禁写“若违约，抽取生魂，炼入煞矿，矿奴三年”等四字系统宣判腔！所有借贷代价必须融入自然市井对话或事实陈述（如枯竹翁沙哑哼道：“三个月后若凑不齐灵石，老朽就按黑市规矩拿你去七峰山挖三年苦矿抵债”）。
6. 【算计内敛，破除清单碎碎念】：严禁每走两步就在心里背一遍灵石、精铁和药草的琐碎账本！主角的谨慎体现在“先看退路、少说多听、留三分底牌、行事不留把柄”的实际冷硬行动上。全章关键经济账目至多出现1~2处关键数额。
7. 【金手指天地神异敬畏感】：动用【太虚沉煞铜漏】时，主角内心充满对不可知天地存在的本能敬畏与战战兢兢，如履薄冰，深恐引来通天大能神识锁定或招致灭门横祸，杜绝轻车熟路的机械说明书感。
8. 【战斗混乱感与生理扰动】：生死搏杀拒绝战棋式从容推演！必须写出生死关头的生理扰动——耳膜因气劲狂轰而剧烈轰鸣、飞溅泥血糊住眼皮被迫撕袖擦拭、泥浆湿滑导致发力走形偏出三寸、兵刃断茬反扎手掌的血肉刺痛。主角是拼尽残命的野兽，胜利必须是惨烈、狼狈而侥幸的险胜！
9. 【彻底封杀无端躯体应激与把玩多动症】：低能级日常与常态场景（日常问答、普通交接、市井买卖、寻常拿物、静坐思考等）严格实行自然人类白描！绝对严禁一摸到物件就“指腹/指肚反复摩挲（杯沿/铜钱/腰牌/刀柄/信纸/衣角）”；绝对严禁“食指轻叩桌面（一下又一下）”；绝对严禁别人随口问一句话就“喉咙发紧/喉头发干/喉头一哽”、“呼吸骤然一窒/呼吸乱了一拍”；绝对严禁“指尖悬停在半空/动作一僵”；绝对严禁随手拿物就“指节泛白/骨节捏得泛白”；绝对严禁稍有隐忍就“指甲深深掐进掌心”、“咬紧后槽牙咯咯作响”；绝对严禁一思考就“按揉发胀的太阳穴”；绝对严禁动辄滥用“猛地/骤然/赫然/下意识地”！拿东西就平稳拿，放东西就自然放，说话就平稳说！
`;

function sseTextOf(data) {
  if (!data) return '';
  if (data.choices && data.choices[0]) {
    const c = data.choices[0];
    if (c.delta && typeof c.delta.content === 'string') return c.delta.content;
    if (c.message && typeof c.message.content === 'string') return c.message.content;
    if (typeof c.text === 'string') return c.text;
  }
  return '';
}

function parseChatStream(rawStream) {
  let text = '';
  let usage = null;
  for (const event of rawStream.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data || data === '[DONE]') continue;
    try {
      const packet = JSON.parse(data);
      if (packet.error || packet.molan_error) throw new Error(packet.error || packet.molan_error);
      if (packet.molan_usage) usage = packet.molan_usage;
      text += sseTextOf(packet);
    } catch (_) {}
  }
  if (!text.trim()) throw new Error('生成接口未返回正文');
  return { text: text.trim(), usage };
}

async function login() {
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  if (!loginRes.ok) throw new Error(`登录失败 HTTP ${loginRes.status}: ${await loginRes.text()}`);
  const { token } = await loginRes.json();
  return token;
}

const CHAPTER_BLUEPRINTS = [
  {
    chapterNum: 1,
    title: '第一章 坊市米珠与半块残灵石',
    sceneMode: 'inverted_sting',
    preDebts: [
      {
        type: 'major',
        seed: '季安在赤崖坊市黑市暗巷欠下赤脚怪客枯竹翁半块中品灵石，赊购微瑕残破金髓丹方与三颗干瘪古药种，立下三月债务凭条',
        immediateCost: '三月内若无法凑齐四块纯色下品灵石与一盒灵砂，便由枯竹翁抓去七峰山深矿当三年苦力抵债',
        maturationChapter: 9
      }
    ],
    prompt: `请写原创凡人流修仙小说《凡人道途：太虚沉煞录》第一章《坊市米珠与半块残灵石》。
【章节剧情与任务要求】：
1. 采用【倒置刺痛切入法（inverted_sting）】：开篇第一句以沉重的生计利息与兽皮借据开场：枯竹翁那双枯瘦如树皮的手指死死按住借据一角，浑浊的老眼看着季安。兽皮上的墨迹未干，三个月期限与四块下品灵石的账目黑白分明。季安在借据下方利落按上鲜红的血印画押，神色沉静。
2. 场景设在赤崖散修坊市最底层的泥泞暗巷。以精练利落的笔触描摹底层散修的清苦与残酷。季安四伪灵根资质，深知靠苦修无望突破，唯有铤而走险赊购古药方与残种。
3. 枯竹翁语气冷酷市井：“三个月后若拿不出灵石，老朽就按黑市规矩，拿你去七峰山挖三年苦矿抵债。”季安面色木讷，收下残方与三颗干瘪药种，确认退路后转身离开。
4. 【篇幅硬约束】：全章字数必须严格控制在 2,200 ~ 2,800 汉字之间（严禁低于 2,000 字，严禁超过 3,000 字）！去繁就简，镜头利落！
${REFINEMENT_DIRECTIVES}
直接输出小说正文。`
  },
  {
    chapterNum: 2,
    title: '第二章 密室滴露与十年药力之惑',
    sceneMode: 'causal_flow',
    preDebts: [
      {
        type: 'arc',
        seed: '催熟十年黄精异香险些逸出，以劣质艾草焦烟掩盖，隔壁练气五层刀客产生疑心',
        immediateCost: '隔壁刀客在房门外泥地留下半道深足印暗中窥视',
        maturationChapter: 4
      }
    ],
    prompt: `请写原创凡人流修仙小说《凡人道途：太虚沉煞录》第二章《密室滴露与十年药力之惑》。
【章节剧情与任务要求】：
1. 承接第一章：季安怀揣兽皮借据与枯萎药种回到出租石屋。深夜寒气浸透石墙，门后贴着三道防窥测的下品静音符。
2. 展现金手指【太虚沉煞铜漏】的天地神异敬畏感：深更半夜，孤灯如豆，季安谨慎地从怀中最深处摸出那个不过两寸大小、满覆铜绿泥锈的古旧铜漏。壶身残存古篆隐隐吞吐极淡月华与地底微煞。凡人之躯窃取天地神异，季安内心充满敬畏与战战兢兢，深恐引来通天大能神识锁定或遭天谴，如履薄冰。
3. 小心翼翼倾倒出一滴凝聚了整整七夜的莹润紫水（沉煞露），滴入泥盆。枯萎药种在神异灵露下抽芽，十年黄精成熟的瞬间异香随之升腾！季安惊骇之下毫不犹豫点燃准备好的苦涩艾草烟块，浓烈焦烟充斥石室，强行压下灵草清香。
4. 隔壁练气五层刀客被焦烟惊醒，在门外驻足嘀咕，留下深深泥印。季安在屋内屏住呼吸握紧短刃，静立在屋内看着门缝，危机四伏。
5. 【篇幅硬约束】：全章字数必须严格控制在 2,200 ~ 2,800 汉字之间（严禁低于 2,000 字，严禁超过 3,000 字）！
${REFINEMENT_DIRECTIVES}
直接输出小说正文。`
  },
  {
    chapterNum: 3,
    title: '第三章 换容问药与黑市掌柜的算盘',
    sceneMode: 'atmospheric_transition',
    preDebts: [
      {
        type: 'arc',
        seed: '典当草药换取灵石时衣角沾染黑市掌柜暗下的无色银尾磷粉，引来暗中两名截杀恶修',
        immediateCost: '被两名练气六层修士暗中尾随至荒山',
        maturationChapter: 4
      }
    ],
    prompt: `请写原创凡人流修仙小说《凡人道途：太虚沉煞录》第三章《换容问药与黑市掌柜的算盘》。
【章节剧情与任务要求】：
1. 采用【有机高阻力环境转场（atmospheric_transition）】：暴雨如注，黑石长街泥泞深陷。季安易容换声，微弓着背脊穿过重重阴暗窄巷，来到地下“聚宝阁”典当行。
2. 与典当掌柜老狐狸展开老辣的纯言语博弈：掌柜眼神精明，仔细翻检着黄精根须，表面客气恭维，实则以药力未稳极力压榨。季安言辞滴水不漏，以退为进，最终换取六块下品纯色灵石与防身符箓。
3. 掌柜暗中在找零的皮囊夹层涂抹了银尾磷粉，表面满脸和气送客。季安走出店铺，在冰冷雨巷中敏锐察觉到了不同寻常的神识波动，暗暗加快脚步。
4. 【篇幅硬约束】：全章字数必须严格控制在 2,200 ~ 2,800 汉字之间（严禁低于 2,000 字，严禁超过 3,000 字）！
${REFINEMENT_DIRECTIVES}
直接输出小说正文。`
  },
  {
    chapterNum: 4,
    title: '第四章 荒山伏夜与同门残杀之局',
    sceneMode: 'inverted_sting',
    preDebts: [
      {
        type: 'major',
        seed: '荒山断魂崖下飞剑对轰削塌山崖，波及季安藏身坑洼，被迫卷入名门栖霞门同门内讧血案',
        immediateCost: '身陷两名练气后期精锐与两名截杀恶修的多方绞杀漩涡',
        maturationChapter: 6
      }
    ],
    prompt: `请写原创凡人流修仙小说《凡人道途：太虚沉煞录》第四章《荒山伏夜与同门残杀之局》。
【章节剧情与任务要求】：
1. 采用【倒置刺痛切入（inverted_sting）】：开篇第一句以荒山夜雾中飞剑对撞的雷霆巨响与绝壁坍塌开场！飞剑撕裂山崖，巨石如雨倾泻，将季安本欲遁逃的路线彻底切断。
2. 破除舞台剧式送人头：不是弱智把玉盒丢进草坑！而是名门【栖霞门】内门精锐因争夺筑基残卷与宗门密令在此生死火并，狂暴的法术对轰直接削塌了半座断崖。山体崩塌将季安藏身的低洼彻底压垮，落石与泥浆砸得季安满身是血。
3. 暴退之中，季安的气息不可避免地被坍塌气流冲散暴露。正在激战的栖霞门弟子与赶来截杀的恶修双方同时将目光扫向废墟，为防杀人夺宝之事外泄，杀手修士当即调转飞刀，凌厉斩向满身泥污的季安！
4. 危机瞬间升级为生死一发的大混乱。
5. 【篇幅硬约束】：全章字数必须严格控制在 2,200 ~ 2,800 汉字之间（严禁低于 2,000 字，严禁超过 3,000 字）！
${REFINEMENT_DIRECTIVES}
直接输出小说正文。`
  },
  {
    chapterNum: 5,
    title: '第五章 符箓连珠与挫骨扬灰之术',
    sceneMode: 'causal_flow',
    preDebts: [
      {
        type: 'major',
        seed: '死者储物袋中藏有名门栖霞门大修士直系的独门血煞玉符，沾染潜伏血咒标记',
        immediateCost: '被血煞追魂秘法锁定神魂气息',
        maturationChapter: 9
      }
    ],
    prompt: `请写原创凡人流修仙小说《凡人道途：太虚沉煞录》第五章《符箓连珠与挫骨扬灰之术》。
【章节剧情与任务要求】：
1. 承接第四章的惨烈绝境：练气六层顶峰杀手驭使黑色飞刀呼啸追杀。硬接一击之下，龟甲盾粉碎凹陷，反震巨力直接将季安左肩震脱臼，骨骼剧痛钻心。
2. 强化【战斗生理扰动与泥泞险胜】：生死搏杀极其混乱狼狈！雨水泥浆湿滑，季安翻滚时重心失稳险些摔下石缝；雷符爆炸的狂烈气浪震得他双耳尖鸣失聪，泥血混合物糊住右眼眼眶，季安不得不撕下沾血的袖口狠命擦拭！
3. 在绝境中展现如野兽般的拼死算计：左手暗扣缠丝索贴泥滑行绊住敌修脚踝，借对方重心微晃的一瞬，右手一口气连甩十二张破煞雷符！电芒狂涌破其光罩，季安扑上前去以淬毒短刺直贯其咽喉，动作凶残决绝。
4. 极度干净的扫尾：摸尸搜袋、烈焰符焚尸、狂风符扬灰，前后三息清理战场。逃遁途中惊觉储物袋深处封印着一枚散发元婴血煞气息的栖霞门阴魄玉符！
5. 【篇幅硬约束】：全章字数必须严格控制在 2,200 ~ 2,800 汉字之间（严禁低于 2,000 字，严禁超过 3,000 字）！
${REFINEMENT_DIRECTIVES}
直接输出小说正文。`
  },
  {
    chapterNum: 6,
    title: '第六章 储物袋内的重案与烫手山芋',
    sceneMode: 'causal_flow',
    prompt: `请写原创凡人流修仙小说《凡人道途：太虚沉煞录》第六章《储物袋内的重案与烫手山芋》。
【章节剧情与任务要求】：
1. 承接第五章：季安逃出两百里荒山，躲入隐秘野狐石穴，巨石封门，以法铃与细沙警戒。
2. 描写深沉的修仙残酷感与肉体创痛：独自在黑暗洞穴中咬紧布条自接断臂关节，骨缝摩擦的冷汗与粗重喘息。清点战利品：灵石、乌金短刃、《筑基三煞丹古方》。
3. 发现那枚血煞玉符已在自己神魂上烙下了潜伏的血引印记，栖霞门执法堂十日内必循迹搜山。赤崖坊市与宗门境内已无路可走，唯有远走高飞，潜入边境黑矿。
4. 【篇幅硬约束】：全章字数必须严格控制在 2,200 ~ 2,800 汉字之间（严禁低于 2,000 字，严禁超过 3,000 字）！
${REFINEMENT_DIRECTIVES}
直接输出小说正文。`
  },
  {
    chapterNum: 7,
    title: '第七章 易名混迹与灵矿地底的冷遇',
    sceneMode: 'atmospheric_transition',
    preDebts: [
      {
        type: 'arc',
        seed: '更名严平潜入七峰山赤铜矿脉，领下三号极潮毒气废洞，立下每日两块赤铜精矿的苦役凭条',
        immediateCost: '每日需上缴定量矿石否则扣发月俸并受阴鞭之刑',
        maturationChapter: 8
      }
    ],
    prompt: `请写原创凡人流修仙小说《凡人道途：太虚沉煞录》第七章《易名混迹与灵矿地底的冷遇》。
【章节剧情与任务要求】：
1. 采用【有机高阻力环境转场（atmospheric_transition）】：长途跋涉三千里，来到边境七峰山赤铜矿脉。精练展现矿区炼狱般的工业与修仙底色：千丈赤峰、毒烟蔽日、铁索栈道铜锈斑斑、衣衫褴褛的散修矿奴在泥水中吞咽霉硬干粮。
2. 季安化名“严平”，藏匿修为扮作练气二层木讷杂役。面对矿务堂监工的刁难、验封费的剥削与冷嘲热讽，神色恭敬木讷，默默领下最危险的三号毒气废洞。
3. 下到矿洞最底层，毒瘴酷热刺骨，却意外在废弃石隙深处发现了一条沉寂的地脉阴火暗河！
4. 【篇幅硬约束】：全章字数必须严格控制在 2,200 ~ 2,800 汉字之间（严禁低于 2,000 字，严禁超过 3,000 字）！
${REFINEMENT_DIRECTIVES}
直接输出小说正文。`
  },
  {
    chapterNum: 8,
    title: '第八章 矿洞暗火与淬炼飞剑之谋',
    sceneMode: 'causal_flow',
    prompt: `请写原创凡人流修仙小说《凡人道途：太虚沉煞录》第八章《矿洞暗火与淬炼飞剑之谋》。
【章节剧情与任务要求】：
1. 承接第七章：严平（季安）在废矿洞地火边缘开辟暗室，借地火高温重新淬炼乌金短刃。
2. 纯言语博弈与底层生存逻辑：矿霸头目带人前来敲诈例钱。严平不拔刀、不施怪异小动作，而是端坐在阴影里，用监工交接账目的致命漏洞、矿石成色品级的行规，平静而切中要害地与对方谈判，拿出两块上等精矿化敌为友，拉其下水成为利益同盟。
3. 避开耳目，以【太虚沉煞铜漏】凝聚出的莹紫灵露灌溉岩隙中偶得的濒死“地火芝”，药香在阴火热流掩盖下悄然滋养。章末矿山警钟突鸣，搜捕网已压至矿区外围！
4. 【篇幅硬约束】：全章字数必须严格控制在 2,200 ~ 2,800 汉字之间（严禁低于 2,000 字，严禁超过 3,000 字）！
${REFINEMENT_DIRECTIVES}
直接输出小说正文。`
  },
  {
    chapterNum: 9,
    title: '第九章 期限逼近与倒悬残阵之网',
    sceneMode: 'causal_flow',
    prompt: `请写原创凡人流修仙小说《凡人道途：太虚沉煞录》第九章《期限逼近与倒悬残阵之网》。
【章节剧情与任务要求】：
1. 承接第八章，因果债务全面逼近：枯竹翁凭借借据血契追查到矿山，栖霞门血煞密探亦凭借玉符煞气逼近三号洞口。两路强敌已至，退无可退。
2. 展现凡人老辣深沉的绝境做局：严平（季安）拖着伤体两夜不眠，在狭窄如迷宫的矿道与地火喷口处，埋设残破阵旗与倒悬陷阱，将乌金短刃隐入倒挂钟乳石，备齐毒囊与引爆符。
3. 闭目打坐，调息静待死局。
4. 【篇幅硬约束】：全章字数必须严格控制在 2,200 ~ 2,800 汉字之间（严禁低于 2,000 字，严禁超过 3,000 字）！
${REFINEMENT_DIRECTIVES}
直接输出小说正文。`
  },
  {
    chapterNum: 10,
    title: '第十章 阴火爆鸣与绝地夺芝大逃杀',
    sceneMode: 'inverted_sting',
    prompt: `请写原创凡人流修仙小说《凡人道途：太虚沉煞录》第十章《阴火爆鸣与绝地夺芝大逃杀》。
【章节剧情与任务要求】：
1. 采用【倒置刺痛切入（inverted_sting）】：石门在剧烈法术轰击下炸成万千碎石！枯竹翁与栖霞门血煞使者同时破门杀入。
2. 终极大碰撞：双方逼杀，季安假意惊惶示弱退后，引动倒悬大阵！万道雷火齐发封死矿道，更决绝的是以飞剑直刺地火暗脉，引爆整座废洞的千年地脉阴火！
3. 天崩地裂，岩浆与火毒冲天爆发，将两路强敌卷入大崩塌；混乱火海中季安忍受烈火炙烤，一把采下成熟的地火芝，纵身跃入裂开的地底暗河！
4. 冰冷暗流将他卷出数十里外，破水而出时已是茫茫迷雾黑泽边境荒滩。季安浴血爬上湿冷礁石，长生大幕正式开启。
5. 【篇幅硬约束】：全章字数必须严格控制在 2,200 ~ 2,800 汉字之间（严禁低于 2,000 字，严禁超过 3,000 字）！
${REFINEMENT_DIRECTIVES}
直接输出小说正文。`
  }
];

async function run() {
  console.log('================================================================');
  console.log('★ 《凡人修仙传》特化管线：V2深度精修版连续十章真实生成与审查 ★');
  console.log('================================================================');

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(DEBTS_DIR)) fs.mkdirSync(DEBTS_DIR, { recursive: true });

  const tracker = new CausalDebtTracker(DEBTS_DIR);
  console.log('>>> 正在登录系统获取生成权限...');
  const token = await login();
  console.log('✔ 登录成功！准备加载玄幻母类语料库进行 36 字原创门禁校验...');
  const corpus = loadCorpusForFamily('xuanhuan');
  const scenes = corpus && corpus.scenes ? corpus.scenes : [];
  console.log(`✔ 语料库加载完成，共有 ${scenes.length} 个基准场景用于重合查重。\n`);

  const results = [];

  for (const bp of CHAPTER_BLUEPRINTS) {
    const chFile = path.join(OUT_DIR, `ch${String(bp.chapterNum).padStart(2, '0')}.md`);
    console.log(`----------------------------------------------------------------`);
    console.log(`>>> 正在推进第 ${bp.chapterNum} 章: 《${bp.title}》 [调度模式: ${bp.sceneMode}]`);

    // 录入因果债务
    if (Array.isArray(bp.preDebts)) {
      for (const d of bp.preDebts) {
        tracker.recordDebt(BOOK_ID, {
          chapterNum: bp.chapterNum,
          ...d
        });
        console.log(`  [因果债务记入] 种子: "${d.seed.slice(0, 25)}..."`);
      }
    }

    // 上下文准备
    const context = prepareGenreSceneContext({
      genre: '仙侠',
      routeId: 'fanren',
      sceneMode: bp.sceneMode,
      bookId: BOOK_ID,
      chapterNum: bp.chapterNum,
      tracker
    });

    console.log(`  [上下文装配] 写作提示词体系字符数: ${context.writingSystem.length}`);
    console.log(`  [调用模型] gpt-5.6-luna 流式起草中，请稍候...`);

    const start = Date.now();
    let draftText = '';
    let retryCount = 0;
    while (!draftText && retryCount < 3) {
      try {
        const chatRes = await fetch(`${BASE_URL}/api/chat`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(600000),
          body: JSON.stringify({
            stage: 'writing',
            model: 'gpt-5.6-luna',
            twoPassHumanize: false,
            max_tokens: 3100,
            temperature: 0.72,
            messages: [
              { role: 'system', content: context.writingSystem },
              { role: 'user', content: bp.prompt }
            ]
          })
        });

        if (!chatRes.ok) {
          throw new Error(`HTTP ${chatRes.status}: ${await chatRes.text()}`);
        }

        const rawStream = await chatRes.text();
        const parsed = parseChatStream(rawStream);
        draftText = parsed.text;
      } catch (err) {
        retryCount += 1;
        console.warn(`  ⚠ 第 ${bp.chapterNum} 章生成遭遇异常: ${err.message}，重试 ${retryCount}/3...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!draftText) {
      throw new Error(`第 ${bp.chapterNum} 章生成失败，重试耗尽！`);
    }

    // 后处理：调用 sanitizeAiFlavor 清除潜在的躯体反射或翻译腔
    const cleanedText = sanitizeAiFlavor(draftText);
    const costSec = ((Date.now() - start) / 1000).toFixed(1);

    // 原著专有词零容忍扫描（零同人、零抄袭）
    const ipHits = FORBIDDEN_IP_TERMS.filter(term => cleanedText.includes(term));

    // 审计指标
    const rawChars = cleanedText.replace(/\s+/g, '').length;
    const aiScore = computeAiFlavorScore(cleanedText).score;
    const clicheHits = FORBIDDEN_AI_CLICHES.filter(c => cleanedText.includes(c));
    const somaticHits = SOMATIC_REFLEXES.filter(c => cleanedText.includes(c));
    const transHits = TRANSLATIONESE.filter(c => cleanedText.includes(c));
    const microHits = MICRO_ACTIONS.filter(c => cleanedText.includes(c));
    const overlapIssues = checkSourceOverlap(cleanedText, scenes);

    // 计算段落均匀度与单句段比例
    const paras = cleanedText.split(/\n\s*\n/).filter(p => p.trim());
    const singleSentenceParas = paras.filter(p => {
      const trimmed = p.trim();
      return (trimmed.match(/[。！？!?]/g) || []).length <= 1 && trimmed.length <= 25;
    }).length;
    const singleSentenceRatio = ((singleSentenceParas / Math.max(1, paras.length)) * 100).toFixed(1);

    // 落盘写入 Markdown
    const mdContent = `# ${bp.title}\n\n> 作品：《凡人道途：太虚沉煞录》（100% 独立原创凡人流小说）\n> 主角：季安（化名严平） | 核心异宝：太虚沉煞铜漏\n> 调度模式：${bp.sceneMode} | 字数：${rawChars} 汉字 | 单句段比：${singleSentenceRatio}% | 生成耗时：${costSec}s\n\n${cleanedText}\n`;
    fs.writeFileSync(chFile, mdContent, 'utf8');

    const isPass = (rawChars >= 2000 && rawChars <= 3200 && aiScore <= 35 && clicheHits.length === 0 && somaticHits.length === 0 && ipHits.length === 0 && overlapIssues.length === 0);

    const chResult = {
      chapterNum: bp.chapterNum,
      title: bp.title,
      sceneMode: bp.sceneMode,
      chars: rawChars,
      paragraphs: paras.length,
      singleSentenceRatio: `${singleSentenceRatio}%`,
      costSec,
      aiScore,
      ipHits,
      cliches: clicheHits,
      somaticHits,
      transHits,
      microHits,
      overlapCount: overlapIssues.length,
      status: isPass ? 'PASS' : 'WARN'
    };

    results.push(chResult);
    console.log(`✔ 第 ${bp.chapterNum} 章起草完成！篇幅: ${rawChars} 字 | 耗时: ${costSec}s | 单句段比: ${singleSentenceRatio}% | 原著专有词: ${ipHits.length} | AI味分: ${aiScore} | 状态: ${chResult.status}`);
  }

  const summaryFile = path.join(OUT_DIR, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(results, null, 2), 'utf8');
  console.log('\n================================================================');
  console.log('🎉 连续十章原创凡人流小说起草全部完毕！汇总数据已保存至 summary.json');
  console.log('================================================================');
}

run().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
