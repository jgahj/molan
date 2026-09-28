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

const COMPARATIVE_CASES = [
  {
    familyId: 'xuanhuan',
    routeId: 'xuanjian',
    genreName: '玄幻仙侠',
    benchmarkBook: '仙侠/玄鉴仙族 - 季越人.txt',
    title: '《宗族血火》· 坊市秋粮交割',
    prompt: `【本章写作任务·第一卷 第三章 寒粟】：
背景：大黎山脚黎泾村，李氏宗族四兄弟（李木田、李通崖、李项平、李玄宣）耕荒初定。时逢寒冬将至，长兄李木田带着二弟李通崖押送秋粮与几口袋晒干的野栗子，赶往三十里外的青池宗坊市交粮纳捐，顺带换取半包熬骨草药。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：泥泞山道与农具磨损】：
   冬雨夹雪，两辆木独轮车在黎泾河滩的冻烂泥里吱呀打滑。木车轴早磨得焦黑，李通崖用麻绳缠住手掌死命稳住车把，手背冻得全是紫红皲裂；李木田腰里别着缺了口子的柴刀，鞋底早脱了底，用干稻草扎紧。父兄二人一言不发，只有沉重喘息与车轮碾烂泥的吧唧声。
2. 【幕二：坊市税吏的规制盘剥与账目机锋】：
   到了青池宗坊市偏门，税吏陆管事披着粗鹿皮袄，手里捏着一柄铜杆秤，斜眼打量。过斗时，税吏使暗劲用斗面刮出一层尖，硬把原本六石的秋粟扣成四石八斗，还要加征“折耗耗羡”。李木田没有拍案动怒，而是满脸堆笑地从怀里摸出两块包了三层油布的野蜂蜡，塞进管事袖筒，言语卑微周全：“黎泾荒远，收成薄，仙师抬抬手，给后生留两升粟米糊口。”
3. 【幕三：散修恶霸的暗中窥伺与利害权衡】：
   交完粮换得一包劣质“透骨草”，在坊市茶寮避雨。邻桌两名腰悬断刃的练气二层散修眼露凶光，盯着李通崖腰间的一张黄桦木猎弓和那包草药，故意踢翻板凳寻衅。李木田在桌下死死按住性情刚烈的通崖手臂，低眉顺眼替对方捡起酒葫芦，主动赔了三枚当十制钱；通崖牙关咬得微酸，却深知凡俗宗族面对修士哪怕最低阶的符箓也是灭顶之灾，硬生生把头埋低。
4. 【幕四：雨夜风雪还乡与代际执念（绝杀断章）】：
   归途雪渐大，车轮在半道断了轴。两兄弟在风雪中拆下旧板车木料，合力将粮袋扛在肩头，深一脚浅一脚往村里挪。远望黎泾村头微弱的豆大油灯，李木田抹了把脸上的冰水泥水，低声对通崖道：“咱李家在这泥塘里挣扎了三代人……草药给你三弟送去，只要咱家能出一个炼气的苗子，这骨头碎在泥里，也值当。”

【季越人/网文名家质感与《纠错库.md》最高指示】：
- 严守乡村宗族考据与物质阻力（斗秤成色、荒地税制、皲裂冻疮、独轮车轴、草绳草鞋）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁写“震得气血翻涌/喉头一甜/双腿发颤/虎口发麻”）；
- 穿插真实民俗与闲笔（如茶棚檐下冻结的冰棱、油纸包上的猪油斑印、远处山林夜枭的啼鸣）；
- 长短句自然交织，沉静肃杀，直接输出小说正文。`
  },
  {
    familyId: 'history',
    routeId: 'spy_years',
    genreName: '历史谍战',
    benchmarkBook: '军事/我的谍战岁月 - 猪头七.txt',
    title: '《暗夜独行》· 霞飞路密电警报',
    prompt: `【本章写作任务·第一卷 第四章 烟雨寒弄】：
背景：一九三六年深秋，上海法租界，细雨连绵。法捕房副巡长程千帆（地下党员“火种”）接到绝密警报：一名负责交接第三国际密电码本的联络员在霞飞路被特高课特务钉梢，即将陷入合围。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：法租界弄堂市井烟火与多重伪装】：
   晨光微晞，霞飞路旁的德庆里弄堂弥漫着煤球炉的呛烟与煎生煎馒头的油香。程千帆一身考究的浅灰花呢西服，外罩深蓝羊毛大衣，看似漫不经心地在街角馄饨摊要了一碗加辣油的云吞。他的眼角余光却将整条街道的动向收进眼底：斜对面的公用电话亭外，一个穿黄包车夫坎肩的汉子，脚上踩的却是一双底子磨损的日式胶底布鞋。
2. 【幕二：捕房警务人情与职业利益网】：
   巡捕房的法籍巡官皮埃尔带着两名包探走过，程千帆熟稔地打招呼，顺手递上一罐高档三五牌香烟，用流利的法文和对方抱怨今冬的煤炭配给不足。皮埃尔拍了拍程千帆的肩膀，笑着抱怨公董局扣减巡捕薪水。程千帆在插科打诨间，巧妙借助巡捕房临检的名义，将两名巡警支派去盘查那名伪装车夫的特务，打乱特务的盯梢节奏。
3. 【幕三：惊心动魄的雨中盲传与试探交锋】：
   联络员“老吴”提着皮箱快步走入弄堂雨幕中，脸色灰白。程千帆没有当面相认，而是在穿过狭窄过街楼的一瞬，故意与一名拉泔水桶的苦力轻微相撞。皮鞋踩进积水坑，泥浆飞溅，引来街坊一阵叫骂。在这混乱的一刹那，程千帆将折叠成口香糖锡纸大小的撤退路线指令，精准顺进了老吴微开的雨衣外兜里，擦肩而过，视线毫不停留。
4. 【幕四：冷雨夜暗流与潜伏代价（绝杀断章）】：
   哨声骤然在街口吹响，特务察觉异样开始搜查。老吴借着程千帆指引的排污渠暗道成功脱身。程千帆站在屋檐下，掏出纯银打火机点燃一支烟，火光照亮了他毫无波澜的面孔。他低头看了看被泥水打湿的裤腿，心中默默计算着方才交接暴露的概率与善后口供。雨水顺着帽檐滑落，街面电车当当远去，黑暗深沉的上海滩，真正的死生搏杀才刚刚拉开序幕……

【猪头七/网文名家质感与《纠错库.md》最高指示】：
- 严守民国上海租界细节（法文俚语、电车票价、生煎摊气味、胶底鞋磨损、英镑银元折算）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁气血翻涌、手脚发颤、喉头一甜）；
- 穿插弄堂市井闲笔（如晾衣绳上滴落的肥皂水、马路巡捕吹哨时喷出的白气、小贩敲击铁勺的清脆声）；
- 节奏张弛有度，沉着冷硬，直接输出小说正文。`
  },
  {
    familyId: 'urban_martial',
    routeId: 'urban_grind',
    genreName: '都市现实',
    benchmarkBook: '都市/以神通之名 - 猪心虾仁.txt',
    title: '《执规者》· 违禁工坊夜检',
    prompt: `【本章写作任务·第一卷 第二章 规制之外】：
背景：南海西道防城，连绵春雨。巡检司特勤三组执事陆昭（患有严重睡眠障碍症）带队，突击搜查城郊工业园一家假借机械加工之名、暗中非法熔炼违禁法器“定魂针”的地下工坊。
【篇幅要求】：3000~3600中文字符。只输出小说正文，不带说明总结。

【剧情四幕硬核要求】：
1. 【幕一：工业雨夜与成年人身体沉重负担】：
   雨水冲刷着工业园泛着油光的沥青地面，雨刷器在五菱宏光的前挡风玻璃上发出吱呀的单调摩擦。陆昭靠在副驾，太阳穴因连续四天失眠而针扎般钝痛，他从风衣内袋倒出两片白色的镇静药片，没就水干嚼咽下，苦涩在舌根泛开。身后的两名年轻干事在调试手持式灵压检测仪，指示灯在暗色车厢内忽明忽暗。
2. 【幕二：程序正义与执法取证博弈】：
   陆昭带着执法记录仪和盖有巡检司红印的《现场勘验令》进入工坊。工坊老板金总满脸堆笑地迎出来，递上印着“精工模具制造”的营业执照，身上浓重的机油味掩盖着一丝极淡的朱砂与雷击木焦味。金总娴熟地掏出软中华，试探陆昭的底细与来意：“陆执事，咱们可是纳税大户，市工信局张科长上周还来视察过……”陆昭神色冷淡，依法出示证件，拒绝接烟，严格按照规章指令手下封闭所有电源与排气阀门。
3. 【幕三：隐藏暗室与高概念法器物理特征】：
   陆昭没有盲目乱翻，而是用随身携带的测厚仪在机床后墙测出空腔。砸开夹层，露出一座小型电磁屏蔽铅房！里面不是神话里的大鼎，而是改装过的真空电弧熔炼炉，炉膛内插着九根刻满微缩符文的钨钢细针（定魂针），高频电流在水冷铜管内发出刺耳的高频蜂鸣，空气中充斥着浓烈的臭氧与金属气化酸味。老板脸色骤变，暗中将手伸向应急断电拉杆试图销毁数据，被陆昭单手反剪按死在冰冷的工字钢立柱上。
4. 【幕四：体制内的成年人妥协与暗流（绝杀断章）】：
   现场查扣封存。陆昭脱下浸满机油与酸雨的手套，点了一支烟。随队干事小林兴奋地以为立了大功，陆昭的手机却震动起来。屏幕上赫然是副司长私人号码发来的一条短信：“涉案资产封存入库，涉案人员暂缓羁押，明天上午带卷宗到我办公室。”陆昭站在雨里，吐出一口青烟，看着雨水顺着工坊铁皮屋檐倾泻而下，神情平静得看不出一丝情绪。在这个超凡融入规则的时代，真正的漩涡从来不在法器，而在规章折页的阴影里……

【猪心虾仁/网文名家质感与《纠错库.md》最高指示】：
- 严守体制执法考据与现代物质摩擦（勘验文书、公章规制、公差尺寸、手套机油味、失眠药片苦味）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁气血翻涌、虎口发麻、喉头一甜）；
- 真实都市闲笔（如路灯下泛黄的水洼倒影、雨刷器老化的胶条毛边、远处货运列车穿过夜空的闷响）；
- 笔调冷峻克制，成年人现实主义，直接输出小说正文。`
  }
];

async function runComparativeGeneration() {
  console.log('================================================================');
  console.log('【名家管线深度生成与原著对标评测】');
  console.log('生成多题材真实章节，并定向对标《玄鉴仙族》《我的谍战岁月》《以神通之名》原著');
  console.log('================================================================\n');

  console.log('[1/3] 登录系统验证账户...');
  const token = await login();
  console.log('✓ 账户凭据获取成功\n');

  const outDir = path.join(molanHome, 'data/genre-lab/eval-comparative/v2');
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];

  for (const item of COMPARATIVE_CASES) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`▶ 正在起草：[${item.genreName}] 路线: ${item.routeId} | 篇名: ${item.title}`);
    console.log(`  对标原著: ${item.benchmarkBook}`);
    console.log(`----------------------------------------------------------------`);

    console.log(`- [步骤1] 装配叙事引擎、四维动机方案与名家微切片...`);
    const prep = prepareGenreSceneContext({
      genre: item.familyId,
      routeId: item.routeId,
      query: item.prompt.slice(0, 600),
      owner: EMAIL,
      dataDirectory: path.join(molanHome, 'data')
    });

    console.log(`  ✓ 路线引擎: ${prep.routeTitle}`);
    console.log(`  ✓ 写作系统指令长度: ${prep.writingSystem?.length || 0} 字符`);

    console.log(`- [步骤2] 发起真实 /api/chat 起草请求 (模型: gpt-5.6-luna)...`);
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
    const corpus = loadCorpusForFamily(item.familyId);
    const overlapIssues = checkSourceOverlap(text, corpus.scenes || [], 25);

    // 句式与段落统计
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const sentences = text.split(/[。！？!?；;\n]+/).map(s => s.trim()).filter(Boolean);
    const avgSentLen = (text.length / sentences.length).toFixed(1);
    const avgParaLen = (text.length / paragraphs.length).toFixed(1);

    results.push({
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
      deductions: flavor.deductions?.length || 0,
      overlapIssues: overlapIssues.length,
      outPath
    });
  }

  console.log('\n================================================================');
  console.log('【多管线真实生成基础指标汇总】');
  console.log('================================================================');
  console.table(results.map(r => ({
    '管线路线': r.routeId,
    '题材母类': r.genreName,
    '生成篇目': r.title,
    '汉字数': r.charCount,
    '耗时(秒)': r.elapsedSec,
    '段落数': r.paragraphsCount,
    '平均句长': r.avgSentLen,
    'AI味得分': r.aiFlavorScore
  })));

  // 将分析写入报告
  const summaryJsonPath = path.join(outDir, 'eval-summary.json');
  fs.writeFileSync(summaryJsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n汇总指标已保存至: ${summaryJsonPath}`);
}

runComparativeGeneration().catch(err => {
  console.error('对比评测异常:', err);
  process.exit(1);
});
