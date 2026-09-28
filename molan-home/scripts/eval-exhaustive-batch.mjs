import fs from 'node:fs';
import path from 'node:path';
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

async function login() {
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  if (!loginRes.ok) throw new Error(`登录失败 HTTP ${loginRes.status}`);
  const { token } = await loginRes.json();
  return token;
}

const EXHAUSTIVE_CASES = [
  {
    familyId: 'xuanhuan',
    routeId: 'fanren',
    genreName: '玄幻修真 (忘语)',
    benchmarkBook: '仙侠/凡人修仙传 - 忘语.txt',
    title: '《凡人仙途》· 岚州坊市辨药',
    prompt: `【本章写作任务·第一卷 第七章 辨药与生计】：
背景：岚州散修坊市，练气四层散修韩鸣进城售卖灵药并采购法器符箓。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：凡俗散修生计与泥泞脚力】：
   韩鸣脚踏磨损严重的行云履，鞋帮早裂了口子，用兽筋紧紧勒住。雨雪漫天，山道泥泞不堪，肩头扛着沉重的青竹药篓，里面用浸油油纸包裹着三株刚采摘的三十年份紫猴花。一路嚼着干硬发霉的干粮碎屑，喉咙干涩。
2. 【幕二：岚州万宝阁掌柜的规制盘剥与账目精算】：
   进了岚州散修坊市，万宝阁掌柜老孙头拨弄着包铜算盘，眼皮都不抬，拿起放大铜镜挑剔药草根须受损，硬把八块下品灵石的市价压到五块灵石外加三瓶下品黄龙丹。韩鸣心里将灵石成色、丹毒杂质与修补残破金蚨子母刃的费用算得清清楚楚，不卑不亢，假意转身欲走，在拉扯中多抠回了半两灵砂和两张避尘符。
3. 【幕三：冀南方言与草根抠搜自嘲】：
   韩鸣在散修茶棚喝着两文钱一碗的粗叶苦茶，同桌老散修刘瘸子操着冀南土白笑骂：“球！这鬼年景，筑基老怪放个屁，咱散修就得勒紧裤腰带喝西北风。韩小子，你那破履还能顶两里地不？”韩鸣自嘲：“缝缝补补还能对付半拉冬天，总比赤脚踩冰碴子强。”
4. 【幕四：黑市尾随与绝对防备（绝杀断章）】：
   出了坊市，两道阴冷神识悄然贴了上来。韩鸣脚步没有半分慌乱，左手暗扣一张敛气符，右手滑入袖中扣紧淬毒飞芒，迅速拐入迷雾沼泽地段……

【忘语/凡人流质感与《纠错库.md》最高指示】：
- 严守底层散修资源贫瘠与利益算计（灵石杂质、药力折损、磨损法器、干粮草鞋）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 穿插闲笔与泥土俗语（茶棚雨檐水滴、粗布衣襟上的草汁青斑）；
- 长短句交织，沉静肃杀，直接输出小说正文。`
  },
  {
    familyId: 'scifi_apocalypse',
    routeId: 'hard_survival',
    genreName: '科幻末世 (晨星LL)',
    benchmarkBook: '这游戏也太真实了',
    title: '《404废土守望》· 辐射区抢修外骨骼',
    prompt: `【本章写作任务·第二卷 第一章 荒原断路】：
背景：零下三十度，废土荒原呼啸着辐射狂风。工兵老陆与猎手小林在外骨骼故障下面临绝境。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：废土严寒与机械负荷衰减】：
   零下三十度，废土荒原呼啸着辐射狂风。工兵老陆与猎手小林趴在废弃加油站的机修地坑里，外骨骼装甲的动力电池显示红字14%，电磁阀结满灰白冰碴。老陆用冻僵的手指拧动生锈内六角螺栓，螺丝滑丝，崩碎的金属碎屑擦过面罩。
2. 【幕二：避难所黑话与流民抠门自嘲】：
   小林嚼着硬得像石头的合成老鼠肉干，含糊不清地嘟囔：“狗日的黑商，这批电容八成是从二手机甲坟场刨出来的翻新货，抽了我足足三十个避难所工分，老子差点把裤衩子当了！”老陆呸了一口：“少咧咧，再扣不下这两截焊丝，咱俩今晚就得冻成冰棍给变异狂犬当夜宵。”
3. 【幕三：微观物资损耗与辐射压迫】：
   盖革计数器发出尖锐的喀啦喀啦声，数值攀升到120微希沃特。两人计算着防毒滤罐的寿命（还剩二十七分钟），小林用自制气压表测试气动扳手，在狭窄的底盘下完成差速器齿轮校准，公差压在0.05毫米内。
4. 【幕四：游荡变异群逼近与冷酷战术伏击（绝杀断章）】：
   远方废墟传来水泥预制板被踏碎的沉闷轰响，热成像仪边缘出现三头两米高的裂嘴雪行者。老陆拉下夜视仪，拉栓推弹上膛，自制重管土铳的撞针发出清脆冰冷的卡簧声……

【晨星LL/废土流质感与《纠错库.md》最高指示】：
- 严守工业真实与物质摩擦（公差、扭矩、螺纹防滑胶、液氦冻伤、金属冷缩）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起、深吸一口气、愣住了）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 穿插闲笔（被机器余热融化的铁锈水、螺母掉进油坑的清脆声）；
- 硬核克制，直接输出小说正文。`
  },
  {
    familyId: 'suspense',
    routeId: 'laoshiren',
    genreName: '悬疑惊悚 (纯洁滴小龙)',
    benchmarkBook: '都市/捞尸人 - 纯洁滴小龙.txt',
    title: '《九曲黄河》· 鬼门湾夜捞红煞',
    prompt: `【本章写作任务·第一卷 第二章 水底阴煞】：
背景：秋夜子时，九曲黄河鬼门湾水流湍急。老水鬼周拐子领着徒弟小石头撑羊皮筏下水捞尸。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：黄河夜浪与老水鬼行规】：
   秋夜子时，九曲十八弯的鬼门湾水流湍急，阴风呼啸。老水鬼周拐子领着徒弟小石头撑着吃水沉重的柳木羊皮筏子，水腥味直冲脑门。周拐子腰里系着浸了黑狗血的九股生麻绳，嘴里叼着旱烟袋，烟锅里的暗红火星在黑夜中忽明忽灭。“三不捞：立水尸不捞，脱发浮尸不捞，穿红戴花不捞。今晚水下这个，是横死的，邪性大。”
2. 【幕二：陕甘滩客土语与荤话壮胆】：
   小石头看着旋涡里沉浮的暗影，手脚打颤。周拐子一巴掌拍在他后脑勺上笑骂：“怂瓜软蛋！你爷爷当年捞水猴子也没像你这样拉拉尿尿！昨儿个村头看白事班子跳艳舞，你小子眼睛瞪得跟铜铃似的，今天见个死人就尿裤子？喝口烧酒，把卵子塞裤裆里扎紧！”两口烈酒下肚，喉咙火辣辣烧开，小石头啐了口唾沫，不再发怵。
3. 【幕三：死相微观勘验与人情账目】：
   带倒钩的探阴爪沉下两丈深的水眼，绳头猛然一沉。周拐子熟练收绳，捞起的是一具被浸泡多日的浮尸，死者指甲缝里塞满黄河硬泥，腕子上还戴着一只成色发暗的铜镯子。周拐子摸了摸尸身关节与水浸线：“不是失足，是被人绑了青石沉江。按行规，捞尸赏银八两，给家属送去，咱取四钱香烛钱，分毫不许多占。”
4. 【幕四：水底异动与红绳崩断（绝杀断章）】：
   正要将尸身系在船舷，水底突然卷起黑沉沉的大旋涡，生麻绳发出令人牙酸的嘎吱绷紧声，柳木筏子骤然倾斜向水心拖去，水底下伸出了一只生满灰白鳞甲的肿胀怪手……

【纯洁滴小龙/民俗惊悚质感与《纠错库.md》最高指示】：
- 严守江河民俗考据与物态生活流（羊皮筏、生麻绳、旱烟袋、水浸水线、红白喜事陋习）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背发凉）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 穿插真实民俗闲笔与乡野土话荤白；
- 阴沉克制，直接输出小说正文。`
  },
  {
    familyId: 'western_fantasy',
    routeId: 'super_mechanic',
    genreName: '奇幻机械 (齐佩甲)',
    benchmarkBook: '游戏/超神机械师 - 齐佩甲.txt',
    title: '《星海工匠》· 地下工坊魔改火炮',
    prompt: `【本章写作任务·第一卷 第三章 膛线与电火】：
背景：暗区废弃车库地下工坊，机械师韩越魔改重型反器材磁轨炮，并应付黑市掮客。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：地下黑市与机械车床公差】：
   暗区废弃车库内，机油味与松节油味弥漫。机械师韩越戴着防护目镜，操作着一台二手重型台钻。钻头在合金装甲板上切削出刺耳的高频尖啸，卷曲发蓝的铁屑飞溅在水泥地上。韩越用千分尺卡紧炮管内径——公差0.008毫米，严丝合缝。
2. 【幕二：黑话俚语与割韭菜冷幽默】：
   副手瘦猴提着两罐劣质机油跑进来，龇牙咧嘴：“越哥，外面那帮野狼帮的雇佣兵脑子被门挤了，非要加价订购五把轻量化动能冲锋枪，还问能不能打折。”韩越面无表情地调试着伺服电机：“打折？告诉他们，加装消音器收两千海蓝币，附赠一包润滑脂。这群肥羊韭菜不割，留着给军阀过年？”
3. 【幕三：微观成本演算与电路过载】：
   韩越在工坊账本上勾画：微型电容损耗35币，高压导线折旧12币，这一单利润高达72%。正当他把最后一组充能电容焊接到重型反器材磁轨炮底座时，电容外壳突然冒出一股刺鼻白烟，温度传感器飙升至230度。韩越冷静抄起降温气雾罐喷射，呲啦作响的白霜瞬间冻结导线，稳住了核心电压。
4. 【幕四：仇家破门与重炮试射（绝杀断章）】：
   厚重的卷帘铁门轰然被榴弹轰碎，七八个荷枪实弹的赏金猎人踹门而入。韩越跨坐在重型磁轨炮的操作椅上，合金护臂咔哒锁紧扳机摇杆，冷漠地按下充能开关，炮口蓝幽幽的电弧骤然将整个工坊照得雪亮……

【齐佩甲/机械师质感与《纠错库.md》最高指示】：
- 严守机械装配精度与电气物理逻辑（公差、千分尺、伺服电机、淬火合金、电容耐压）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、瞳孔骤缩）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发麻）；
- 融入NPC黑话、割韭菜冷幽默与市井市侩算计；
- 节奏凌厉干净，直接输出小说正文。`
  },
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
- 融入世家言语机锋、雅谑反讽与含蓄冷刀子；
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
- 融入陆家嘴打工人黑色幽默、社畜真实胃痛与势均力敌的情感克制；
- 语言干净现代，情感沉敛，直接输出小说正文。`
  }
];

async function runExhaustiveEvaluation() {
  console.log('================================================================');
  console.log('【墨阑名家引擎】全题材全管线全面推演评测 (涵盖所有母类与名家风格)');
  console.log('评测目标：真实API调用、硬核物理阻力、方言口语、微观算计、反崇高幽默');
  console.log('================================================================\n');

  console.log('[1/4] 登录服务验证账户...');
  const token = await login();
  console.log('✓ 账户凭据就绪\n');

  const outDir = path.join(molanHome, 'data/genre-lab/eval-exhaustive');
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];

  for (let i = 0; i < EXHAUSTIVE_CASES.length; i++) {
    const item = EXHAUSTIVE_CASES[i];
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[${i + 1}/${EXHAUSTIVE_CASES.length}] 题材母类: ${item.genreName} | 路线: [${item.routeId}]`);
    console.log(`篇目: ${item.title}`);
    console.log(`对标原著: ${item.benchmarkBook}`);
    console.log(`----------------------------------------------------------------`);

    console.log(`  [A] 装配名家机理层、方言口白与防套路审查规则...`);
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
    const chatRes = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      signal: AbortSignal.timeout(600000),
      body: JSON.stringify({
        stage: 'writing',
        model: 'gpt-5.6-luna',
        twoPassHumanize: false,
        max_tokens: 8192,
        temperature: 0.85,
        messages: [
          { role: 'system', content: prep.writingSystem },
          { role: 'user', content: item.prompt }
        ]
      })
    });

    if (!chatRes.ok) throw new Error(`HTTP ${chatRes.status}: ${await chatRes.text()}`);
    const reader = chatRes.body.getReader();
    const decoder = new TextDecoder();
    let rawStream = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rawStream += decoder.decode(value, { stream: true });
    }

    const { text, usage } = parseChatStream(rawStream);
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
  console.log('【全题材全管线名家生成最终指标汇总】');
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

  const summaryJsonPath = path.join(outDir, 'eval-summary.json');
  fs.writeFileSync(summaryJsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n汇总指标已保存至: ${summaryJsonPath}`);

  const allPassed = results.every(r => r.passedLength && r.passedCliches && r.passedOverlap && r.aiFlavorScore === 100);
  console.log(`\n全部题材验收结果: ${allPassed ? '🎉 全部题材管线质量完美达标！' : '⚠️ 存在部分指标需要复查'}`);
}

runExhaustiveEvaluation().catch(err => {
  console.error('全管线评测流程异常:', err);
  process.exit(1);
});
