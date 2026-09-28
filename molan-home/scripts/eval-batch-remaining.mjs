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

const REMAINING_CASES = [
  {
    familyId: 'ancient_romance',
    routeId: 'mansion_secrets',
    genreName: '古代言情 (深宅世情)',
    benchmarkBook: '宫斗宅斗/高门主母的驯夫手册.txt',
    title: '《锦绣深宅》· 账房对簿与月例机锋',
    prompt: `【本章写作任务·第一卷 第四章 亏空与冷茶】：
背景：冬月初三，靖国公府东跨院。少夫人沈宛清查核内宅账目，面对内库管事妈妈与妯娌的利益盘剥。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：深宅晨起与器物礼数考据】：
   冬月初三，靖国公府东跨院。天刚蒙蒙亮，廊下铜雀笼里的画眉鸟扑棱着翅膀。少夫人沈宛清坐在紫檀妆台前，由陪嫁丫鬟白芷拿篦子抿着头油，镜中面色恬淡。铜盆里温水浮着两瓣干梅花，下人轻手轻脚换上炭盆，青白釉瓷碗里的燕窝粥只盛了半盏。
2. 【幕二：账房对簿与微观月例算计】：
   二管事周妈妈领着账房掌柜捧着蓝缎面账册进来回话。沈宛清翻开账页，素手轻敲桌面：“上月采买的云锦少了半匹，后厨买办的官燕每斤虚报了四两银子。二叔房里的月例缎匹前日就领了，三房这边的几位姑娘冬衣银子反倒拖了七日。”周妈妈赔着笑，额角渗出冷汗，嘴里推诿着公中银根紧。
3. 【幕三：京畿世家雅谑与内宅暗刺】：
   正房王夫人身边的红绡姑娘笑吟吟进来传话，假意劝和：“少夫人管家辛苦，老太太说了，一家子骨肉，算得太清楚倒显得生分了。”沈宛清端起茶盏轻轻拂去茶沫，浅笑自嘲：“红绡姑娘说得是。只可惜这生铁秤砣不认亲疏，若我不把这二两三钱的亏空补上，年底族老查账，背黑锅的可就是咱们这当差的晚辈了。”
4. 【幕四：密信揭发与借刀杀人（绝杀断章）】：
   周妈妈退下后，白芷悄悄从袖笼里递上一封沾着脂粉香气的密信——二房竟私下将公中西郊的三百亩良田押给了外头的利钱铺子。沈宛清合上账本，美眸微敛，将信压入妆台夹层，吩咐备车往老太太寿康堂去……

【高门世情/宅斗质感与《纠错库.md》最高指示】：
- 严守世家礼法规制与微观财务细账（对牌、月例、燕窝成色、缎匹耗损、利钱当铺）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、冷汗涔涔）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 严禁粗俗土白，保持世家雅言含蓄温润，谈笑间用软刀子割肉；
- 语言温润古朴，暗流汹涌，直接输出小说正文。`
  },
  {
    familyId: 'modern_romance',
    routeId: 'urban_emotion',
    genreName: '现代言情 (职场博弈)',
    benchmarkBook: '职场婚恋/机关女人.txt',
    title: '《风暴眼》· 陆家嘴暴雨对赌尽调',
    prompt: `【本章写作任务·第一卷 第五章 尽调深渊】：
背景：深夜十一点，陆家嘴环球金融中心48层。窗外台风暴雨倾盆。投资总监温凉与合伙人顾衍通宵复核B轮对赌底稿。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：暴雨陆家嘴与投行高压物态】：
   深夜十一点，陆家嘴环球金融中心48层。窗外台风暴雨拍打着双层中空钢化玻璃，会议室里弥漫着冷萃咖啡与打印机过热的油墨味。投资总监温凉揉着酸胀的太阳穴，脚下高跟鞋早已踢在一旁，脚后跟磨破的水泡贴着创可贴。桌上堆放着厚达四百页的“星云半导体”B轮对赌尽调底稿。
2. 【幕二：陆家嘴金融黑话与社畜自嘲】：
   合伙人顾衍推门进来，手里拎着两听无糖可乐，直接扔了一罐在温凉面前。“温总监，还没把那十三个壳公司的关联交易洗出来？”温凉拉开易拉罐，气泡呲的一声溢出，自嘲一笑：“顾总催得紧，我今晚要是猝死在这工位上，算不算工伤？你们合伙人分红几千万，我这月薪还得为下个月房贷算计。”顾衍挑眉：“放心，公司买了高额意外险，受益人写你爸妈。”
3. 【幕三：微观财务硬核博弈与专业风控】：
   两人迅速切入正题，红笔在财务模型报表上划出致命疑点：星云科技研发费用资本化率高达82%，且供应链核心供应商账户与创始人表弟高度重合，明摆着是个抽逃出资的资金池陷阱。温凉推了推眼镜：“如果签了无保留兜底协议，一旦暴雷，咱们基金今年所有carry全打水漂，还要承担连带清偿责任。”
4. 【幕四：雨夜天台与破防心动（绝杀断章）】：
   凌晨两点，大雨初歇。两人在避难层吸烟区吹着潮湿的夜风，外滩的霓虹逐渐熄灭。温凉胃部突发痉挛，脸色煞白地蹲下身。一向冷面严苛的顾衍没有多余废话，迅速脱下还带着体温的羊绒大衣裹住她的肩膀，从兜里掏出一板奥美拉唑和保温杯递过去，低沉道：“方案按你的改。塌下来，我顶着。”温凉握着温热的水杯，目光微震……

【都市投行/职场心动质感与《纠错库.md》最高指示】：
- 严守投行对赌、尽调底稿与真实行业法理（资本化率、关联交易、过桥资金、兜底协议、carry分红）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背发凉）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发软）；
- 严禁乡村土白，融入陆家嘴打工人黑色幽默、社畜真实胃痛与势均力敌的情感克制；
- 语言干净现代，情感沉敛，直接输出小说正文。`
  },
  {
    familyId: 'scifi_apocalypse',
    routeId: 'dawn_blade',
    genreName: '科幻魔导 (远瞳)',
    benchmarkBook: '科幻/黎明之剑 - 远瞳.txt',
    title: '《塞西尔领》· 符文导轨与水泥工棚',
    prompt: `【本章写作任务·第一卷 第四章 导轨与工匠】：
背景：南境荒原开拓营地，高文·塞西尔巡视新建的魔能符文基站与水泥窑工棚，处理贵族阻力与工业量产问题。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：领地泥泞晨起与工业基建实态】：
   开拓营地的早晨弥漫着水泥粉尘与劣质煤烟的气味。高文穿着合身的旧式轻铠，鞋底粘着红黏土，巡视正在建造的魔能导轨。工匠们用土法煅烧出的第一批生石灰混杂着矿渣，石灰水在木槽里翻滚冒泡，热浪把工匠的手臂熏得泛红。
2. 【幕二：老祖宗科学理性与领地政务吐槽】：
   赫蒂拿着领地账本匆匆赶来，神色忧虑。旧贵族骑士抱怨水泥工棚抢了农奴，导致秋麦收割延误，且拒绝让神官为导轨祈福。高文翻看账册，用现代工业眼光剖析：“祈福一次要耗费十个银币的圣油，还不如拿来给铁匠多发两块猪板油。让骑士们自己去推石滚，不然冬天连麦糊都喝不上。”言语间带着老祖宗看透世事的诙谐自嘲。
3. 【幕三：符文导轨充能试验与精密公差】：
   铁匠汉默正在调试符文扳手。高文亲自俯身用游标卡尺测量导轨铜线开槽深度——误差要求控制在半毫米内，否则魔力脉冲会导致铜芯过热熔断。工匠们紧张屏息，随着开关合闸，蓝白色的魔能电弧顺着石墨导轨平稳流淌，照亮了整个工棚。
4. 【幕四：深空卫星警报与未知黑潮阴影（绝杀断章）】：
   试验成功众人欢呼之际，高文视野角落的卫星轨道监控信标突然轻微蜂鸣，视网膜上闪过一道微弱红光——距营地西北四十公里的黑森林边缘，古老畸变体的移动频率正在异常激增，似乎被刚才的魔力脉冲所唤醒……

【远瞳/文明工业质感与《纠错库.md》最高指示】：
- 严守工业基建与去魅理性（水泥标号、导轨线槽、热工计算、贵族农奴利益、现代拓荒幽默）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 严禁套用乡村土话，保持文明拓荒的从容机智与老祖宗幽默；
- 语言干净利落，直接输出小说正文。`
  },
  {
    familyId: 'history',
    routeId: 'dynasty_friction',
    genreName: '历史争霸 (坟土荒草)',
    benchmarkBook: '历史/神话版三国 - 坟土荒草.txt',
    title: '《鼎革天下》· 雁门常平仓与并州军议',
    prompt: `【本章写作任务·第一卷 第五章 仓廪与狼烟】：
背景：并州边关要塞，雁门关校场与常平仓。严恪都尉与幕僚核验冬防钱粮，处置边军大势。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：边关霜雪与辎重损耗核算】：
   并州入冬，朔风猎猎。严恪头戴熟铁盔，披着褪色的旧红战袍，在常平仓督察粮草入库。粮官拨拉着发霉的黄册，叹息今年从幽州转运的糜子在路上被风雪折耗了三成，运到关上只剩四千石。士卒们呼哧呼哧把麦袋搬入地窖，地窖青砖泛着白霜。
2. 【幕二：汉末官话与幕僚名士慵懒机锋】：
   幕僚周子衡裹着灰鼠皮裘，手里抱着铜暖手炉，懒洋洋坐在火盆旁烤火，嘴里吐槽：“刺史府的大人们只管在晋阳清谈玄理，哪管前线老卒冻掉脚趾。若非我多扣下两成折色盐钱，这黑石关的防务早被北狄马蹄踏碎了。”严恪笑骂他油滑，两人在谈笑间拆解天下大势与各路诸侯算盘。
3. 【幕三：万人军团天赋与八石弩阵布设】：
   校场上，两千并州精锐步骑正在操演“玄甲磐石阵”。军侯挥动旗语，士卒步伐沉重整齐，地面冻土随着踏步沉闷共振。严恪亲自登上弩台，检视八石重弩的绞盘与弓弦牛筋，计算射程与下坠仰角，指出弓弦防冻鹿脂涂抹不均的问题。
4. 【幕四：斥候绝命警讯与狼烟冲天（绝杀断章）】：
   远处雪原狂飙突起，一骑血染并州斥候冲至关下，坠马气绝。箭囊中插着断裂的鲜卑雕翎箭，带回绝密急报：北狄三万游骑借暴雪隐蔽绕过阴山峡谷，先头锋刃已逼近关外三十里！关头烽火台的狼烟轰然点燃，黑烟撕裂铅灰色的苍穹……

【坟土荒草/神三国质感与《纠错库.md》最高指示】：
- 严守古代大国理政与军阵考据（粮道折色、常平仓、旗语、军团天赋受力、汉魏风骨）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 严禁低俗俚语，保持名士风骨与从容洒脱；
- 沉雄壮阔，直接输出小说正文。`
  },
  {
    familyId: 'western_fantasy',
    routeId: 'sequence_cost',
    genreName: '奇幻蒸汽 (乌贼)',
    benchmarkBook: '诡秘序列',
    title: '《灰雾之下》· 贝克兰德旧街密会',
    prompt: `【本章写作任务·第一卷 第四章 雾都冷茶与魔药反噬】：
背景：贝克兰德东区乔伍德街，煤气灯昏黄，雨雾弥漫。值夜者编外调查员莫兰复核一件非凡封印物失窃案，并承受魔药消化代价。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：维多利亚煤烟街景与微观物价】：
   细雨夹杂着煤灰从夜空洒落，乔伍德街的石板路上马车辚辚驶过。莫兰穿着一件浆洗得领口发硬的旧双排扣呢大衣，头戴半高丝绸礼帽，口袋里装着三便士铜币和半枚先令。街角报童嘶哑地叫卖着最新的《塔索克报》，空气中满是煤气泄漏与潮湿麦酒的气味。
2. 【幕二：英式绅士冷幽默与穷困自嘲】：
   莫兰走进一家低档咖啡馆，要了一杯两便士的劣质红茶和一块硬面包。同僚老侦探休斯正在用怀表比对报纸时间，吐槽这周的办案经费又被教会后勤部扣了三成：“那帮坐在圣乔治大教堂里的主教大概以为值夜者是靠吸入圣水饱腹的。”莫兰自嘲地用红茶浸泡硬面包：“至少硬面包能有效锻炼咀嚼肌。”
3. 【幕三：魔药消化耳语与物理克制】：
   莫兰取出昨晚记录的炼金笔记本，翻到封印物“0-17”的灵性勘验记录。耳边突然泛起如同千万只昆虫振翅的细密低语，太阳穴突突跳动。他没有露出痛苦惊恐的神色，而是动作沉稳地从银制药盒里倒出一粒薄荷镇静胶囊吞服，用指尖用力按压虎口神经，凭借扮演法的心理锚点将低语硬生生压制下去。
4. 【幕四：灵摆占卜突变与逆十字暗记（绝杀断章）】：
   莫兰解下缠绕在手腕上的黄水晶吊坠，悬空在泛黄的嫌疑人素描上方，低声念诵占卜语句。水晶原本顺时针旋转，却突然猛地一顿，随后疯狂逆向旋转，细银链在空气中绷得笔直！窗外煤气路灯噗的一声集体熄灭，浓雾深处，缓缓浮现出一个带着倒吊人黑斗篷的模糊身影……

【爱潜水的乌贼/蒸汽古典质感与《纠错库.md》最高指示】：
- 严守维多利亚时代细节与物价阶层（金镑、苏勒、便士、煤气灯、马车、报童、绅士派头）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背发凉）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 严禁生硬现代俚语与粗话，语言克制典雅，充满英式侦探推理与绅士自嘲；
- 节奏沉郁优雅，直接输出小说正文。`
  },
  {
    familyId: 'scifi_apocalypse',
    routeId: 'swallow_star',
    genreName: '未来高武 (我吃西红柿)',
    benchmarkBook: '科幻/吞噬星空 - 我吃西红柿.txt',
    title: '《荒野猎人》· 023号废墟高架伏击',
    prompt: `【本章写作任务·第一卷 第六章 战刀与兽影】：
背景：023号城市废墟高架桥，准武者罗峰带领猎手小队伏击一头初级兽将级“铁毛野猪”，面对严苛实战考验。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：荒野废墟压迫与合金装备受力】：
   暴雨冲刷着坍塌的高架桥路面，生锈的钢筋裸露在水泥残块外。罗峰身穿二阶克夫拉合金作战服，背后背着六棱重盾，手握血影二型合金战刀。作战服领口沾满酸雨和泥水，合金肩甲在抵靠水泥墩时发出沉闷的金属摩擦声。作战手表显示心率每分钟五十二次，电池续航还剩七成。
2. 【幕二：猎人行规与微观战利品算计】：
   队长陈哥趴在身侧，用测距望远镜观察千米外的废弃广场。老队员刘叔一边往重狙弹匣里压入涂有高爆破甲药剂的十二点七毫米钨合金子弹，一边嘟囔：“这头铁毛野猪的独角在极限武馆能换八万华夏币，獠牙每根值一万二。要是打烂了脑壳，材料评级掉到F级，这一趟连子弹钱都挣不回来。”罗峰低声应答，核算着自己的身法步幅。
3. 【幕三：硬核受力搏杀与九重雷刀发力】：
   破空声暴起，重达三吨的铁毛野猪撞碎水泥承重柱呼啸而来！罗峰没有无脑硬拼，双膝微沉利用高架桥斜坡卸力，身体在千钧一发之际侧滑两步，战刀顺着巨兽狂奔的惯性切入其颈肋软甲。肌肉群瞬间三次暗劲叠加爆发，血影战刀切入坚韧兽皮三寸深，刀刃因受力发出剧烈的金属蜂鸣！
4. 【幕四：兽吼惊动暗影与领主级威压（绝杀断章）】：
   铁毛野猪轰然翻滚撞塌护栏坠落桥底，尘土弥漫。就在小队准备收割独角材料时，城市中心三千米外的浓云雷暴中，突然传来一声撕裂耳膜的恐怖鹰啼，狂风将高架桥上的重型卡车残骸掀飞——头顶云层翻滚，一双展开达百米的金色垂天之翼在雷光中若隐若现……

【我吃西红柿/高武热血质感与《纠错库.md》最高指示】：
- 严守未来科幻武者体制与物理受力（速度、吨位、合金等级、武馆收购价、暗劲发力）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发麻）；
- 严禁粗鄙土白，语言凌厉硬派，充满大工业时代的金属质感与未来猎手纪律；
- 节奏紧凑刚猛，直接输出小说正文。`
  },
  {
    familyId: 'urban_martial',
    routeId: 'yucun_1982',
    genreName: '年代海滨 (米饭的米)',
    benchmarkBook: '都市/重回1982小渔村 - 米饭的米.txt',
    title: '《浪头弄潮》· 乌礁湾冬捕大黄鱼',
    prompt: `【本章写作任务·第一卷 第四章 潮头与拖网】：
背景：一九八二年冬，闽东沿海乌礁湾。叶耀东驾驶木质单缸柴油机机帆船出海捕捞，遭遇风浪与鱼讯。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：海风咸湿与老旧机帆船质感】：
   凌晨四点，港口海风刺骨，弥漫着浓烈的柴油味与海泥咸腥。十二马力的常柴单缸柴油机突突突地震颤着，船板缝隙里渗出海水。叶耀东穿着粗布棉裤，外罩橡胶雨衣，两手被冷海水泡得通红发白，掌心的茧子扣住湿滑的木舵柄，船头破开墨黑的碎浪。
2. 【幕二：沿海渔民生计精算与亲情打趣】：
   同船的二哥叶耀鹏蹲在机舱旁查看油箱，扯着嗓子大喊：“阿东，这趟柴油烧了半桶，要是捞不着值钱货，回去阿娘非拿竹条抽咱们不可！”叶耀东抹了把脸上的盐霜大笑：“怕什么！昨儿个供销社大前门两毛八一包，今天要是网起大黄鱼，给你买两条抽个够！”两兄弟在风浪里互损打气。
3. 【幕三：起网绞盘阻力与极度颗粒度物态】：
   到了乌礁湾回水区，绞网机滚筒吱呀吱呀发出沉重的钢缆绞紧声。拖网被沉重的渔获拖得紧紧下坠，网绳绷得笔直如弓弦。两人戴着浸水的麻线手套合力拉拽纲绳，网囊露出水面的一瞬，金灿灿的鳞片在汽灯照耀下翻滚扑腾——足有两百多斤正宗野生大黄鱼！
4. 【幕四：海上抢风舵与邻村渔船别碰（绝杀断章）】：
   正在装舱分拣碎冰，侧后方海雾里突然钻出一艘铁壳拖网船，径直朝着乌礁湾鱼道别过来，船头亮着高功率探照灯，分明是邻村霸道的陈老大船队企图抢占网位，浪头猛烈拍在机帆船侧帮，木船剧烈倾斜……

【米饭的米/年代渔村质感与《纠错库.md》最高指示】：
- 严守80年代沿海渔民生活真实（常柴单缸、拖网绞盘、柴油账、供销社物价、咸腥海风）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背发凉）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 保持沿海民俗自然生活流，生动朴实，有笑有泪；
- 语言扎实质朴，直接输出小说正文。`
  },
  {
    familyId: 'urban_martial',
    routeId: 'daguo_junken',
    genreName: '年代军垦 (大强67)',
    benchmarkBook: '现实/大国军垦 - 大强67.txt',
    title: '《红旗戈壁》· 盐碱荒滩排渠抢险',
    prompt: `【本章写作任务·第一卷 第五章 渠口与冻土】：
背景：一九七五年初冬，西北戈壁兵团十连。青年排长周铁柱带领战士抢修被山洪泥沙淤塞的总排灌渠，抢救两千亩冬小麦。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：戈壁狂风与重工业农机停摆】：
   狂风卷着黄沙抽打在土夯地窝子上方，气温骤降至零下十八度。东方红-75履带式拖拉机陷在渠坝泥潭里，水箱噗噗地喷着滚烫白汽，履带被坚硬的冻泥块彻底卡死。周铁柱戴着褪色的翻毛棉帽，劳保手套早被机油浸透，正拿着铁钎奋力凿砸履带销子上的冻泥。
2. 【幕二：兵团纪律与西北粗放乐观自嘲】：
   老指导员老马端着掉漆的红字搪瓷缸过来，递给周铁柱一碗热气腾腾的姜汤，缸沿印着“艰苦创业”四个红字。老马敲了敲车头钢板笑骂：“这铁牛跟咱们一样，几天没闻着纯柴油，脾气比团长还大！今天要是通不了水，今晚连队食堂的红薯稀饭大家就干看着吧！”战士们哄堂大笑，冻红的脸上全是豪迈。
3. 【幕三：微观工分记录与修渠水利技术】：
   周铁柱擦了把脸上的汗水与沙子，翻开油布封面的生产记录本，认真核实抢修人员工分与开凿方量。他踩着齐膝深的冰冷泥水，用水平仪测定排渠坡降，指挥战士用打眼放炮留下的碎石和草袋筑起导流围堰，确保水流不会倒灌冲毁刚发芽的麦垄。
4. 【幕四：渠坝决口危机与纵身扑水（绝杀断章）】：
   上游冰凌突然发生严重卡塞，洪峰水位猛涨，主闸口土堤发出沉闷的坍塌轰响，一道三尺宽的管涌喷涌而出！一旦决堤，连队两千亩麦苗将彻底被盐碱水吞没。周铁柱没有任何犹豫，甩掉棉大衣，抓起两捆沙袋便向着决口处猛扑过去……

【大强67/军垦年代质感与《纠错库.md》最高指示】：
- 严守兵团农垦历史真实与重工业物态（东方红拖拉机、履带销、水平仪、工分簿、掉漆搪瓷缸）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 严禁精致利己与虚浮言辞，展现钢铁般的革命奉献精神与开朗坚毅风骨；
- 沉稳铿锵，直接输出小说正文。`
  },
  {
    familyId: 'western_fantasy',
    routeId: 'reincarnation_paradise',
    genreName: '无限刀术 (那一只蚊子)',
    benchmarkBook: '轻小说/轮回乐园 - 那一只蚊子.txt',
    title: '《猎杀之刃》· 废弃城区近身交锋',
    prompt: `【本章写作任务·第一卷 第三章 刃口与契约】：
背景：衍生世界废弃化工厂，轮回乐园猎杀者苏晓追击一名违规契约者，进行高强度冷兵器格杀。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：废弃工厂死寂与装备损耗检视】：
   化工厂内部锈迹斑斑，破损的管道滴答淌着发绿的酸液。苏晓半蹲在钢架梁上方，黑风衣下摆随风轻摆。他拔出腰间的‘斩龙闪’，刀鞘内部涂抹的特殊机油散发微腥。视线微敛，刀身耐久度显示38/40，左臂皮下防弹护具在刚才穿透钢管时擦出一道白痕。
2. 【幕二：猎杀者极简干瘪与布布汪默契】：
   布布汪趴在一堆废旧橡胶轮胎后方，耳朵微微抖动，狗脸上满是警惕。苏晓从储物空间摸出一根肉干扔过去，布布汪一口接住，尾巴轻摇了两下便迅速进入潜行状态。没有多余言语交流，猎杀者的指令全部通过短促的手势与眼神下达。
3. 【幕三：宗师级近身搏杀与绝对物理受力】：
   违规者从蒸馏塔阴影中暴起，手持重型链锯剑横斩！刺耳的引擎尖啸撕裂空气。苏晓脚步没有任何慌乱，重心压低半寸，斩龙闪从下至上斜撩，刀锋准确卡入链锯旋转齿轮的间隙。火星爆射，巨大的扭矩反冲顺着刀柄传递至腕骨，苏晓借力旋转，短刀反手刺入违规者右肩锁骨缝隙！
4. 【幕四：乐园公证击杀与血色宝箱（绝杀断章）】：
   违规者眼露疯狂企图引爆贴身烈性炸药，苏晓眼神冰冷如铁，手腕发力震碎其咽喉，一脚将炸药包踹入下水道！轰鸣闷响在地下回荡。违规者尸体缓缓倒地，乐园冰冷的击杀提示随之响起，一团散发着幽蓝光芒的宝箱在血泊中静静凝聚……

【那一只蚊子/轮回乐园质感与《纠错库.md》最高指示】：
- 严守纯粹利益与刀术物理逻辑（发力重心、神经反射、兵刃卡位、装备耐久、乐园公证）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背发凉）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 严禁任何圣母犹豫与正义说教，行事冷酷高效，极简干瘪；
- 节奏凌厉干净，直接输出小说正文。`
  },
  {
    familyId: 'suspense',
    routeId: 'rule_horror',
    genreName: '规则怪谈 (海晏山)',
    benchmarkBook: '玩家请上车',
    title: '《幽冥列车》· 4号卧铺车厢夜巡守则',
    prompt: `【本章写作任务·第一卷 第二章 铜哨与血字】：
背景：夜间零点十七分，幽灵列车穿行在无光隧道中。实习列车员徐朗在4号车厢巡夜，破解冲突的乘车守则。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：幽闭空间异化与微观物态】：
   车厢过道只亮着一盏发黄的吸顶灯，灯丝发出轻微的滋滋电流声。窗外是一片吞噬一切光线的漆黑，只有偶尔划过的反光道钉。徐朗穿着深蓝色列车员制服，制服领口扣得紧紧的，铜纽扣泛着冷光。怀表指针精准停在零点十七分，秒针每跳动一下都伴随微小的齿轮摩擦声。
2. 【幕二：黑色幽默与反常理社畜自嘲】：
   过道墙壁贴着《列车员乘务守则》，第三条写着“不要与穿红鞋的乘客对视”，第七条却写着“遇到穿红鞋的乘客应主动提供热水”。徐朗在心里冷冷吐槽：“这列车的行政部门八成也是个草台班子，写守则的家伙连最基本的逻辑自洽都没学会就来上班了。”他低头检查配发的黄铜哨子，哨孔里还塞着半截陈年棉线。
3. 【幕三：规则漏洞逻辑推导与心理压榨】：
   4号下铺的帘子微微掀开，露出了一双猩红色的绣花鞋。空气中温度骤降，白雾从徐朗口鼻中溢出。他没有后退惊叫，而是极速推导两张守则的生效前提：第三条是“针对已购票乘客”，第七条是“针对补票乘客”。他从腰包掏出一张空白车票夹在手指间，平静地用打孔钳咔哒剪掉一角，制造出“正在查验补票”的规则豁免态。
4. 【幕四：广播变调与全员异化红光（绝杀断章）】：
   红鞋缓缓缩回帘后。然而就在徐朗收起打孔钳的一刹那，车顶的喇叭突然发出一阵尖锐的刺啦声，随后播音员的声音变成了男女重叠的诡异沙哑腔调：“各位旅客请注意，由于前方轨道塌方，列车即将驶入‘无名站台’，请所有非人类乘客保持在座……”车厢内所有卧铺帘子，在一瞬间齐刷刷拉开了……

【海晏山/规则怪谈质感与《纠错库.md》最高指示】：
- 严守规则逻辑漏洞推理与空间压榨（守则矛盾、心理防线、怀表、打孔钳、铜哨）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背发凉）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 严禁乡村土白，保持主角高智商冷静、黑色幽默自嘲与深邃的心理悬疑质感；
- 节奏紧凑窒息，直接输出小说正文。`
  }
];

async function runRemainingEvaluation() {
  console.log('================================================================');
  console.log('【墨阑名家引擎】全题材剩余 10 条管线全面真实生成与深度评测');
  console.log('覆盖：古言深宅、都市职场、魔导科幻、历史争霸、蒸汽诡秘、未来高武、年代渔村、军垦拓荒、无限刀术、规则怪谈');
  console.log('评测目标：真实API调用、硬核物理阻力、各流派纯正语感、微观算计、反崇高幽默');
  console.log('================================================================\n');

  console.log('[1/4] 登录服务验证账户...');
  const token = await login();
  console.log('✓ 账户凭据就绪\n');

  const outDir = path.join(molanHome, 'data/genre-lab/eval-exhaustive');
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];

  for (let i = 0; i < REMAINING_CASES.length; i++) {
    const item = REMAINING_CASES[i];
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[${i + 1}/${REMAINING_CASES.length}] 题材母类: ${item.genreName} | 路线: [${item.routeId}]`);
    console.log(`篇目: ${item.title}`);
    console.log(`对标原著: ${item.benchmarkBook}`);
    console.log(`----------------------------------------------------------------`);

    console.log(`  [A] 装配名家机理层与流派专属语感...`);
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

    // 带重试的生成请求
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

    const outPath = path.join(outDir, `${item.routeId}-chapter.md`);
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
    results.push(report);

    console.log(`  [C] 质量指标审计:`);
    console.log(`      - 字数达标 (≥2800): ${report.passedLength ? '✔ 是 (' + charCount + '字)' : '❌ 否'}`);
    console.log(`      - AI 味得分: ${flavor.score} / 100 (扣分点: ${report.deductionsCount})`);
    console.log(`      - 零容忍口癖: ${foundCliches.length ? '❌ 发现: ' + foundCliches.join(', ') : '✔ 0处 (完全干净)'}`);
    console.log(`      - 语料查重: ${overlapIssues.length ? '❌ 存在重合' : '✔ 0处重合 (完全原创叙事)'}`);
  }

  console.log('\n================================================================');
  console.log('【全题材剩余 10 条管线生成最终指标汇总】');
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

  const summaryJsonPath = path.join(outDir, 'eval-summary-remaining.json');
  fs.writeFileSync(summaryJsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n汇总指标已保存至: ${summaryJsonPath}`);

  const allPassed = results.every(r => r.passedLength && r.passedCliches && r.passedOverlap && r.aiFlavorScore === 100);
  console.log(`\n剩余管线验收结果: ${allPassed ? '🎉 剩余 10 条管线质量全部完美达标！' : '⚠️ 存在部分指标需要复查'}`);
}

runRemainingEvaluation().catch(err => {
  console.error('评测流程异常:', err);
  process.exit(1);
});
