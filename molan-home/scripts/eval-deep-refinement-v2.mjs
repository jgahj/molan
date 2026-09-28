import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const molanHome = 'c:/Users/lyh/Desktop/小说专属网页/molan-home';
const { computeAiFlavorScore } = require(path.join(molanHome, 'lib/ai-flavor-detector'));
const { prepareGenreSceneContext, checkSourceOverlap, loadCorpusForFamily } = require(path.join(molanHome, 'lib/genre-engine'));

const BASE_URL = 'http://127.0.0.1:3000';
const EMAIL = '1271055010@qq.com';
const PASSWORD = '123456';

const FORBIDDEN_AI_CLICHES = [
  '倒吸一口凉气', '倒吸凉气', '眼神一凝', '双眼微眯', '瞳孔微缩',
  '嘴角勾起', '扯了扯嘴角', '深吸一口气', '不由得一愣', '愣了一下',
  '脑海中轰然作响', '气血翻涌', '喉头一甜', '虎口发麻', '后背冷汗直流',
  '第一息', '第二息', '第三息', '恐怖如斯', '这一刻，他'
];

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

function sendHttpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: rawData });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${rawData.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(600000, () => {
      req.destroy(new Error('Request timeout after 600s'));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function login() {
  const res = await sendHttpRequest({
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, JSON.stringify({ email: EMAIL, password: PASSWORD }));
  const { token } = JSON.parse(res.data);
  return token;
}

// 5 大核心代表性母类深度改进版对标案例 (V2)
const V2_REFINED_CASES = [
  {
    familyId: 'xuanhuan',
    routeId: 'fanren',
    genreName: '凡人修仙 (忘语流·V2深度对标)',
    benchmarkBook: '仙侠/凡人修仙传 - 忘语.txt',
    title: '《凡人仙途》· 岚州坊市辨药与伏击 (V2极致精修版)',
    prompt: `【本章写作任务·第一卷 第七章 算计与伏机 (V2深度精修)】：
对标名著《凡人修仙传》第131章《灵石与灵符》及青牛镇/太南坊市生存机理：
【篇幅要求】：3200~3800中文字符。只输出小说正文，不带说明总结。

【剧情四幕极致名家要求】：
1. 【幕一：散修生计与法术/灵石功能实战算计】：
   雨雪漫天，韩鸣踩着磨损的旧行云履赶往岚州坊市。他腰间藏着一块成色暗淡的下品灵石，心里精打细算：修仙界灵石不仅是货币，更是搏杀时握在手心快速补足法力的救命底牌。自己练气四层法力有限，施展一次“金刃术”要消耗三成灵力，若无灵石在手，绝无法强行催动第二张下品金刚符。鞋帮裂口用兽筋紧勒，精算买精铁补底工钱相当于四张下品火绒符，宁可忍着冻痛也不乱花一分灵砂。
2. 【幕二：旁观者视角与坊市信息差侦听】：
   进入坊市，韩鸣没有盲目冲动，而是低眉顺眼混迹在散修摊位旁，像老农般冷眼旁观两名修士为一张初级上阶“御风符”面红耳赤争吵。从争执的只言片语中，他捕捉到关键情报：附近“燕翎堡”与七派暗中摩擦加剧，凡是有年份的解毒与回气灵药皆被大宗门暗中限购，市价暗涨两成。这一信息让他对怀中三株三十年紫猴花有了新的谈判底气。
3. 【幕三：万宝阁老账房的斗智拉扯与验封机锋】：
   面对万宝阁老孙头的刁难压价（铜镜挑剔根须受损），韩鸣借刚才听到的宗门收购紧俏消息，不卑不亢地以退为进。老孙头企图用带火毒杂质的残次黄龙丹充数，韩鸣当场用验封钳挑出受潮的封泥，并用指甲在灵秤上剔除灵砂中掺杂的三成黑砂。最终迫使老孙头不仅补齐足额六块下品灵石，还多搭上两张实用的旧避尘符与半两精纯灵砂。
4. 【幕四：多层预置反杀陷阱与沼泽泥潭潜伏（绝杀断章）】：
   出城后遭遇两道阴冷神识锁定。韩鸣神色如常，毫不慌乱，不走宽阔官道，反而故意踩着泥泞拐入危险的毒瘴芦苇荡。在进入浓雾瞬间，他先用一根无色兽鬃毛和两枚空竹管在路口布下一道极隐蔽的落魂绊线，暗藏铁背獠胆汁淬炼的见血封喉毒刺；本体则将贴身敛气符压入经络，整个人悄无声息滑入冰冷刺骨的泥沼草窝，嘴衔一截空心芦苇潜伏。身后，两名练气五层劫修的脚步声踏碎枯枝，正一步步踩向绊线……

【忘语小说文学风骨与《纠错库.md》最高指示】：
- 严守凡人流精髓：平民凡人真实心理、多层安全防备、绝不逞强争胜、绝不显露底牌；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 严禁空洞比喻，强化具体修真器物交互（验封钳、灵秤、兽筋、空心芦苇、灵砂成色）；
- 直接输出小说正文。`
  },
  {
    familyId: 'western_fantasy',
    routeId: 'sequence_cost',
    genreName: '奇幻蒸汽 (乌贼流·V2深度对标)',
    benchmarkBook: '诡秘序列',
    title: '《灰雾之下》· 乔伍德街的硬面包与扮演法 (V2极致精修版)',
    prompt: `【本章写作任务·第一卷 第四章 扮演法则与寒雾 (V2深度精修)】：
对标名著《诡秘之主》克莱恩在贝克兰德东区生活流、值夜者后勤报销与魔药扮演反思机理：
【篇幅要求】：3200~3800中文字符。只输出小说正文，不带说明总结。

【剧情四幕极致名家要求】：
1. 【幕一：贝克兰德煤灰街景与微观物价精算】：
   细雨夹杂着工业煤灰从铅灰色天空降落，双轮轻便马车在泥泞石板路上颠簸。调查员莫兰裹紧领口发硬的旧呢大衣，摸着口袋里仅剩的三便士与半枚先令。报童叫卖着《塔索克报》，工人兜售着罢工传单。莫兰计算着今晚的开销：煤气费分摊需五便士，廉价红茶两便士，若多加一块硬面包，这个星期的结余就不足以支付房东太太的房租滞纳金。
2. 【幕二：英式绅士自嘲与教会报销官僚主义】：
   在“灰鸦咖啡馆”，同僚老侦探休斯正在用怀表核准时间，桌上摊着被教会后勤部驳回的三张车费报销单。休斯讽刺圣乔治大教堂的主教们以为一线值夜者靠吸入圣水饱腹。莫兰将硬面包泡入温红茶，自嘲硬面包是锻炼咀嚼肌与贫民窟生存的最佳工具。两人在黑色幽默间交接绝密档案“0-17号封印物”，讽刺官僚签字制度只管推诿责任。
3. 【幕三：魔药扮演法的深度反思与理智锚点】：
   档案翻开瞬间，莫兰耳畔突然响起无数昆虫振翅与冰冷低语，灵性直觉剧烈震荡。他没有慌乱服药，而是瞬间收束精神，调动自己所总结的序列8“秘术学者/解密人”核心扮演准则——“洞察秘密，但绝不沉溺于狂乱；记录真实，以秩序抵抗未知”。以这一理性认知为心理锚点，耳边的恐怖幻听如潮水般退去，魔药残余的消化度在理智归位的一刻悄然深进了一分。
4. 【幕四：水洼倒影异化与寂静逆十字（绝杀断章）】：
   莫兰解下黄水晶灵摆在素描上占卜失窃案。水晶突然疯狂反向狂转，细银链发出金属哀鸣。窗外煤气灯噗地一声齐刷刷转为幽绿，雨滴落在窗玻璃上的声音在一瞬间彻底消失！街道上的马车与行人在这一刹那全部静止如蜡像。莫兰低头看向脚下的水洼，水洼倒影中，自己的身后赫然站着一个倒吊在半空、胸口画满血色逆十字的苍白主教……

【乌贼小说文学风骨与《纠错库.md》最高指示】：
- 严守维多利亚时代古典译文质感，英式绅士优雅自嘲与官僚体制黑色讽刺；
- 严守核心扮演法哲学（认知即锚点，抵抗疯狂不是靠蛮力而是靠理智恪守）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起、深吸一口气、后背发凉）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发软）；
- 节奏沉郁典雅，直接输出小说正文。`
  },
  {
    familyId: 'ancient_romance',
    routeId: 'mansion_secrets',
    genreName: '古代言情 (深宅世情·V2深度对标)',
    benchmarkBook: '宫斗宅斗/高门主母的驯夫手册.txt',
    title: '《锦绣深宅》· 账房对簿与软刀世情 (V2极致精修版)',
    prompt: `【本章写作任务·第一卷 第四章 亏空与冷茶 (V2深度精修)】：
对标名著《高门主母的驯夫手册》与古典世情小说礼法规制、借力打力与软刀子杀人机理：
【篇幅要求】：3200~3800中文字符。只输出小说正文，不带说明总结。

【剧情四幕极致名家要求】：
1. 【幕一：高门晨起与仆妇姻亲网络背景】：
   冬月初三，靖国公府东跨院。少夫人沈宛清梳妆，领口压着素兔毛，体面而收敛。陪嫁丫鬟白芷低声汇报内宅深层盘剥网：内库管事周妈妈看似只是个奴婢，其丈夫实为外院管马房的总领，亲妹子更是二夫人的陪嫁心腹。动周妈妈一人，等于挑动整个二房在外院与采买上的根基。
2. 【幕二：笑里藏刀的礼法考据与对牌核验】：
   钱账房与周妈妈捧着蓝缎账册进门请安。沈宛清并不拍案动怒，反而温言赐座奉茶。翻看账目时，素手轻点云锦短少半匹与官燕每斤虚报四两之弊。周妈妈推诿为“风雨受潮与采买运费”。沈宛清端起温热的碎燕粥细品一口，语调极为温和，却句句拿“祖宗家法对牌合卯”与“族老查账体面”相压，把奴仆贪墨包装成“体贴长辈却坏了家规”。
3. 【幕三：借孝道行杀招的大宅门机锋】：
   二房王夫人身边的红绡姑娘笑吟吟进来替周妈妈打圆场，假意劝和“一家骨肉何必计较几两碎银”。沈宛清面色不改，浅笑自嘲：“红绡姑娘所言极是，只是生铁秤砣不认亲疏。老太太常夸二房最懂规矩，若这虚报官燕传到二老爷上峰耳中，反倒成了咱们小辈不孝，累及二爷仕途声名。”一句话将账目贪墨升格为官场弹劾隐患，让红绡与周妈妈瞬间面如死灰。
4. 【幕四：私押田契密信与请君入瓮（绝杀断章）】：
   周妈妈等人惶恐告退并承诺补齐亏空后，白芷从袖中取出密信——二房私自将公中西郊三百亩祖业良田押给城南利钱铺子。沈宛清眼神沉敛，并未立刻去老太太处告状，而是吩咐准备四色精致点心与补齐的四匹苏缎，带着账册先往二夫人房中“请安还布”，引蛇出洞……

【高门世情文学风骨与《纠错库.md》最高指示】：
- 严守世家大族规制：长幼尊卑、奴仆裙带关系、言语温婉而骨子如刀；
- 严禁直接粗鲁破口大骂，严禁现代网络词；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、冷汗涔涔）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 语言温润古典，暗流汹涌，直接输出小说正文。`
  },
  {
    familyId: 'scifi_apocalypse',
    routeId: 'dawn_blade',
    genreName: '科幻魔导 (远瞳流·V2深度对标)',
    benchmarkBook: '科幻/黎明之剑 - 远瞳.txt',
    title: '《塞西尔领》· 轨道视界与工业基建 (V2极致精修版)',
    prompt: `【本章写作任务·第一卷 第四章 导轨、石灰与深空 (V2深度精修)】：
对标名著《黎明之剑》高文·塞西尔以唯物工业与现代科研思维解构超凡与神权机理：
【篇幅要求】：3200~3800中文字符。只输出小说正文，不带说明总结。

【剧情四幕极致名家要求】：
1. 【幕一：水泥工棚与现代工程管理降维】：
   南境荒原开拓营地，高文踩着红黏土巡视新建的水泥窑与魔能导轨基槽。工匠们用土法煅烧第一批矿渣水泥，高文亲自蹲在木槽边指出排水沟坡度不足与石灰水冒泡配比问题。工匠抱怨工期赶不上，高文冷静计算：“晚半天排泥，比返工三整天省钱。返工的损耗记监工账上。”用工业流水线逻辑压制封建行会粗放习惯。
2. 【幕二：传奇英雄光环与车轴猪板油的荒诞反差】：
   旧领地骑士菲利普捧着古剑单膝跪地，激动地背诵七百年前高文公爵的骑士荣耀誓词，请求向神明举行圣油祈福仪式。高文无奈叹气，打断骑士的崇高宣誓，直接询问：“营地的独轮推车轴承涂了猪板油没有？祈福一次耗费十个银币的圣油，还不如给铁匠汉默发两块肉膘。神明要是真在乎导轨，不如替咱们把泥巴冻硬。”将宏大英雄史诗拉入硬核基建柴米油盐。
3. 【幕三：符文卡尺公差与魔力脉冲点火】：
   铁匠汉默调试符文导轨。高文亲自拿游标卡尺测量导轨铜线开槽深度——公差必须卡在0.5毫米内，否则魔力脉冲流经粗糙凹坑会产生热阻电弧。工匠屏息合闸，伴随着低沉的蜂鸣，蓝白色的魔能流光如水银泻地般顺着石墨线槽平稳注入蓄能水晶，彻底打破贵族对法术能量的垄断。
4. 【幕四：深空人造卫星热红外警讯（绝杀断章）】：
   工匠欢呼之际，高文视网膜深处古老的轨道卫星系统突然闪烁红光。他的意识在微秒间拔升至万米近地轨道——卫星热成像传感器穿透云层，清晰捕捉到距营地三十公里的黑森林地下，数万个暗红色的畸变生物热源正在有规律地凝聚共振，正朝着魔力脉冲方向苏醒进军……

【远瞳小说文学风骨与《纠错库.md》最高指示】：
- 严守反套路科学去魅：魔导工业化、老祖宗幽默自嘲、深空轨道双重視角；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 严禁乡土俚语，语言理性干练、幽默开朗；
- 节奏张弛有度，直接输出小说正文。`
  },
  {
    familyId: 'suspense',
    routeId: 'laoshiren',
    genreName: '悬疑惊悚 (纯洁滴小龙流·V2深度对标)',
    benchmarkBook: '都市/捞尸人 - 纯洁滴小龙.txt',
    title: '《九曲黄河》· 滩头草席与水底因果 (V2极致精修版)',
    prompt: `【本章写作任务·第一卷 第二章 水腥与人间 (V2深度精修)】：
对标名著《捞尸人》黄河民俗行规、人间悲欢与死相微观勘验机理：
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕极致名家要求】：
1. 【幕一：滩头破草席与底层人命账目】：
   秋夜子时，九曲黄河鬼门湾水腥刺鼻。羊皮筏推下水前，滩头漏风的茅棚里，死者的老母亲哭干了眼泪，颤巍巍递过来二十四枚铜钱和一碗温井水，求水鬼把儿子捞上来入土为安。老水鬼周拐子没有多收一分，把两枚铜钱压在船头当过江买路钱，其余退给老人：“黄河不喝无主之水，生人留着钱打棺材，咱只取行规香火钱。”
2. 【幕二：九股生麻绳与三不捞规矩】：
   羊皮筏在湍急回水湾颠簸。小石头手脚打颤，周拐子往他嘴里灌了口辛辣烈酒，笑骂浑话驱散阴森死气。周拐子腰系浸透黑狗血与羊油的九股生麻绳，点燃旱烟袋，重申行规：“立水尸不捞（怨气顶在头顶）、仰面尸不捞（死后遭水煞托体）、红衣穿花不捞。今夜水下这个，是横死被人沉江的，碰爪必须敬三柱香。”
3. 【幕三：带泥硬指甲与法医级死相勘验】：
   探阴爪沉下两丈水眼，钩起沉尸。周拐子不用肉手碰脸，先用红布盖面，铜钱压舌，细致勘验：死者指甲缝抠满黄河板结硬泥证明生前挣扎，衣领内扣反压，耳后至喉结有一道未被水泡散的麻绳紫红勒痕，手腕上暗铜镯嵌着粗麻纤维。周拐子冷声断定：“不是自己失足，是被人勒死后捆石沉底。这是冤煞。”
4. 【幕四：水底暗流回旋与血色浮尸暴起（绝杀断章）】：
   正在将尸身固定于船舷，水底突然发出轰隆巨响，一个巨大的暗黑旋涡猛然将羊皮筏卷向河心！绑尸的九股麻绳崩得嘎吱作响，水底深处，原本安详的沉尸猛然睁开白蒙蒙的死鱼眼，冰冷青紫的手指一把死死扣住了小石头的脚踝……

【纯洁滴小龙文学风骨与《纠错库.md》最高指示】：
- 严守民间民俗考据与底层人间冷暖，恐怖背后尽是人间因果；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发软）；
- 语言沉郁苍凉，直接输出小说正文。`
  },
  {
    familyId: 'suspense',
    routeId: 'folklore_investigation',
    genreName: '悬疑惊悚 (民俗异闻通用·V2深度对标)',
    benchmarkBook: '悬疑灵异/民俗异闻',
    title: '《老街异闻录》· 槐荫巷夜巡与停灵门槛 (V2深度精修版)',
    prompt: `【本章写作任务·第一卷 第三章 槐影、贡饭与门槛暗记 (V2深度精修)】：
对标经典民俗悬疑空间压迫与微观异化机理：
【篇幅要求】：3200~3800中文字符。只输出小说正文，不带说明总结。

【剧情四幕极致名家要求】：
1. 【幕一：老街深巷与寻常市井的微观异化】：
   深秋子夜，老旧的槐荫巷。巡街杂役老孙头与徒弟方平提着防风煤油灯走过斑驳青砖墙。巷口唯一的路灯忽明忽暗，钨丝发出滋滋蜂鸣。方平注意到路边每家每户门前摆的贡饭碗与平日不同——不是正放，而是全被往左偏了三寸，碗里的白米插着三根未点燃的短香，香头全沾着发黑的鸡血。
2. 【幕二：邻里旧事的遮掩言辞与账簿错位】：
   两人借巡查火烛之名敲开老裁缝铺的大门。陈老裁缝隔着门缝应答，眼神躲闪，屋里飘出一股刺鼻的樟脑与烂苹果甜腥。方平借着灯光瞥见柜台账簿上的流水记录：本月明明连着七日大雨无人出门，账上却密密麻麻记着七张为‘同一个人’赶制老衣（寿衣）的尺寸记录，且每一次尺寸都比前一次长了半寸！
3. 【幕三：停灵堂前的门槛划痕与心理步步逼近】：
   陈老裁缝在追问下言辞错位，推说是给乡下亲戚备用。老孙头蹲在门槛前，手指抠起门槛边缘新出现的深陷抓痕——抓痕是从门内往外抠出的，木刺里嵌着发白的棉线与指甲碎屑。更诡异的是，停在院当中的黑漆大棺材，棺盖下垫着的不是压棺石，而是两根被压成粉末的公鸡骨头。
4. 【幕四：暗影倒悬与煤油灯骤灭（绝杀断章）】：
   老孙头脸色骤变，急拉方平后退。就在此时，院子里的老槐树无风自晃，落叶沙沙砸在棺盖上。头顶上方的灯影拉长，方平低头猛然发现：地上的影子不是两个人，而是三个！第三个影子正从老孙头的后背无声延展出来，细长的脖子缓缓垂挂在方平的肩膀旁，灯芯噗的一声彻底熄灭……

【纯正民俗悬疑风骨与《纠错库.md》最高指示】：
- 严守民俗生活真实物态与细微异化，用日常之物构筑深层恐惧；
- 严禁廉价跳脸与西方血浆恶心套路；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起、深吸一口气、后背发凉）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发软）；
- 语言冷峻沉郁，直接输出小说正文。`
  },
  {
    familyId: 'xuanhuan',
    routeId: 'dafeng_gongzhi',
    genreName: '仙侠悬疑 (卖报小郎君流·大奉打更人)',
    benchmarkBook: '仙侠/大奉打更人 - 卖报小郎君.txt',
    title: '《大奉悬案》· 桑泊夜巡与铜锣旧案 (V2深度精修版)',
    prompt: `【本章写作任务·第一卷 第二章 铜锣、教坊司与桑泊水底 (V2深度精修)】：
对标名著《大奉打更人》公门打更人点卯、市井荤白骚话与浩然正气案情机理：
【篇幅要求】：3200~3800中文字符。只输出小说正文，不带说明总结。

【剧情四幕极致名家要求】：
1. 【幕一：衙门点卯与打更人公门生计】：
   更声敲过三巡，许平峰系紧腰间的铜锣配牌，领口微有些霉味。衙门班房里，几名老铜锣正聚在炭盆前烤火，就着冷茶撕开干硬的烧饼。众人一边清算这个月的禄米折色扣除了两钱银子，一边调侃谁昨夜在教坊司二十两银子的雅席上喝得烂醉。许平峰表面跟着笑骂，心里却冷眼盘算着自己微薄的月俸与二叔家柴米油盐的开销。
2. 【幕二：市井走访与市井骚话掩盖杀机】：
   巡街至春风堂外，同僚老宋挤眉弄眼打听浮香姑娘的近况，许平峰插科打诨间，目光已扫过街角茶摊的异样——一名穿青衫的儒衫书生倒扣茶碗，看似在温书，手指却在桌下有节奏地轻扣三声。许平峰顺水推舟借着讨要粗茶的名头凑过去，不动声色用铜锣挡住对方视线，借着市井浑话套出桑泊祭祀大典前夕军器监火药调令有诈的关键密信。
3. 【幕三：验尸卷宗折痕与微观法医勘验】：
   回到打更人地牢验尸房，冷气刺骨。许平峰翻看沉水死者的卷宗，指出刑部推官遗漏的致命破绽：死者指甲修剪整齐无挣扎泥垢，喉间却嵌着一枚未融化的蜡封药丸，且颈骨有一道极细微的钝器下压挫伤，分明是先被灌药扼杀后抛入禁水，制造投湖假象。
4. 【幕四：桑泊水下铁锚震颤与正气共鸣（绝杀断章）】：
   夜巡至皇家禁地桑泊湖畔，许平峰怀中的铜锣突然剧烈嗡鸣，细银链震颤不休！湖面上原本平静如镜的黑水泛起密密麻麻的血色气泡，水下深处，永镇山河庙沉寂五百年的万斤玄铁锚链猛然发出轰隆巨响，一尊散发着纯金佛光的巨大残手缓缓从湖心淤泥中探出，直指许平峰咽喉……

【卖报小郎君文学风骨与《纠错库.md》最高指示】：
- 严守公门打更人行当纪律与市井烟火骚话，外松内紧；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起、深吸一口气、后背发凉）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发软）；
- 语言风趣幽默又暗藏锋芒，直接输出小说正文。`
  }
];

async function runRefinedEvaluation() {
  console.log('================================================================');
  console.log('【墨阑名家引擎】五大核心代表题材母类 V2 深度精修对标生成与评测');
  console.log('对标对象：忘语《凡人修仙传》、乌贼《诡秘之主》、高门世情、远瞳《黎明之剑》、小龙《捞尸人》');
  console.log('评测目标：真实API调用、原著文学骨架对齐、物理深度、心理深度、纯正语感');
  console.log('================================================================\n');

  console.log('[1/4] 登录服务验证账户...');
  const token = await login();
  console.log('✓ 账户凭据就绪\n');

  const outDir = path.join(molanHome, 'data/genre-lab/eval-exhaustive/v2');
  fs.mkdirSync(outDir, { recursive: true });

  const targetFilter = process.argv[2];
  const targetCases = targetFilter
    ? V2_REFINED_CASES.filter(c => c.routeId === targetFilter || c.familyId === targetFilter)
    : V2_REFINED_CASES;

  console.log(`执行案例数: ${targetCases.length}`);

  const summaryJsonPath = path.join(outDir, 'eval-summary-v2.json');
  let existingResults = [];
  if (fs.existsSync(summaryJsonPath)) {
    try { existingResults = JSON.parse(fs.readFileSync(summaryJsonPath, 'utf8')); } catch (_) {}
  }
  const results = [...existingResults];

  for (let i = 0; i < targetCases.length; i++) {
    const item = targetCases[i];
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[${i + 1}/${targetCases.length}] 题材母类: ${item.genreName} | 路线: [${item.routeId}]`);
    console.log(`篇目: ${item.title}`);
    console.log(`对标原著: ${item.benchmarkBook}`);
    console.log(`----------------------------------------------------------------`);

    console.log(`  [A] 装配名家机理层与流派专属深度提示...`);
    const prep = prepareGenreSceneContext({
      genre: item.familyId,
      routeId: item.routeId,
      query: item.prompt.slice(0, 500),
      owner: EMAIL,
      dataDirectory: path.join(molanHome, 'data')
    });

    console.log(`  ✓ 体系就绪: route=${prep.routeTitle} | systemPromptLength=${prep.writingSystem?.length || 0}`);
    console.log(`  ✓ 语料范文样本数: ${prep.scenePlan?.sampleScenes?.length || 0}`);

    console.log(`  [B] 调用真实模型生成正文 (model: gpt-5.6-luna, temp: 0.85)...`);
    const startedAt = Date.now();
    let text = '';
    let usage = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const postData = JSON.stringify({
          stage: 'writing',
          model: 'gpt-5.6-luna',
          twoPassHumanize: false,
          max_tokens: 8192,
          temperature: 0.85,
          messages: [
            { role: 'system', content: prep.writingSystem },
            { role: 'user', content: item.prompt }
          ]
        });

        const chatRes = await sendHttpRequest({
          hostname: '127.0.0.1',
          port: 3000,
          path: '/api/chat',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }, postData);

        const parsed = parseChatStream(chatRes.data);
        const chars = (parsed.text.match(/[\u4e00-\u9fa5]/g) || []).length;
        if (chars < 2800 && attempt < 3) {
          console.warn(`  ⚠️ 生成字数未达标 (${chars} < 2800)，可能被中途截断，准备重试 (${attempt}/3)...`);
          await new Promise(r => setTimeout(r, 4000));
          continue;
        }
        text = parsed.text;
        usage = parsed.usage;
        break;
      } catch (err) {
        console.warn(`  ⚠️ 尝试 ${attempt}/3 异常: ${err.message}`);
        if (attempt === 3) throw err;
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    const charCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    console.log(`  ✓ 生成完成！耗时: ${elapsedSec}s | 正文汉字: ${charCount} 字`);

    const outPath = path.join(outDir, `${item.routeId}-chapter-v2.md`);
    fs.writeFileSync(outPath, text, 'utf8');
    console.log(`  ✓ 保存正文: ${outPath}`);

    // AI味与质检分析
    const flavor = computeAiFlavorScore(text);
    const foundCliches = FORBIDDEN_AI_CLICHES.filter(cliche => text.includes(cliche));
    const corpus = loadCorpusForFamily(item.familyId);
    const overlapIssues = checkSourceOverlap(text, corpus.scenes || [], 25);

    // 句式与段落统计
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const sentences = text.split(/[。！？!?；;\n]+/).map(s => s.trim()).filter(Boolean);
    const avgSentLen = (text.length / sentences.length).toFixed(1);
    const avgParaLen = (text.length / paragraphs.length).toFixed(1);

    const report = {
      routeId: item.routeId,
      genreName: item.genreName,
      title: item.title,
      benchmarkBook: item.benchmarkBook,
      charCount,
      elapsedSec,
      paragraphsCount: paragraphs.length,
      sentencesCount: sentences.length,
      avgSentLen,
      avgParaLen,
      aiFlavorScore: flavor.score,
      deductionsCount: flavor.deductions?.length || 0,
      foundCliches,
      passedCliches: foundCliches.length === 0,
      overlapIssuesCount: overlapIssues.length,
      passedOverlap: overlapIssues.length === 0,
      passedLength: charCount >= 2800,
      outPath
    };
    
    const existingIdx = results.findIndex(r => r.routeId === item.routeId);
    if (existingIdx >= 0) results[existingIdx] = report;
    else results.push(report);

    console.log(`  [C] 质量指标审计:`);
    console.log(`      - 字数达标 (≥2800): ${report.passedLength ? '✔ 是 (' + charCount + '字)' : '❌ 否'}`);
    console.log(`      - AI 味得分: ${flavor.score} / 100 (扣分点: ${report.deductionsCount})`);
    console.log(`      - 零容忍口癖: ${foundCliches.length ? '❌ 发现: ' + foundCliches.join(', ') : '✔ 0处 (完全干净)'}`);
    console.log(`      - 语料查重: ${overlapIssues.length ? '❌ 存在重合' : '✔ 0处重合 (完全原创叙事)'}`);
  }

  console.log('\n================================================================');
  console.log('【五大核心代表题材母类 V2 精修生成最终指标汇总】');
  console.log('================================================================');
  console.table(results.map(r => ({
    '路线ID': r.routeId,
    '题材母类': r.genreName,
    '生成篇目': r.title,
    '汉字数': r.charCount,
    '耗时(秒)': r.elapsedSec,
    '段落数': r.paragraphsCount,
    '平均句长': r.avgSentLen,
    'AI味得分': r.aiFlavorScore,
    '口癖零容忍': r.passedCliches ? 'PASS' : 'FAIL',
    '原创无重合': r.passedOverlap ? 'PASS' : 'FAIL'
  })));

  fs.writeFileSync(summaryJsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n汇总指标已保存至: ${summaryJsonPath}`);
}

runRefinedEvaluation().catch(err => {
  console.error('V2 评测流程异常:', err);
  process.exit(1);
});
