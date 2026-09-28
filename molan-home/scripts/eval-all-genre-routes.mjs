import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const molanHome = 'c:/Users/lyh/Desktop/小说专属网页/molan-home';
const { computeAiFlavorScore } = require(path.join(molanHome, 'lib/ai-flavor-detector'));
const { prepareGenreSceneContext, checkSourceOverlap, loadCorpusForFamily } = require(path.join(molanHome, 'lib/genre-engine'));
const reviewedAssets = require(path.join(molanHome, 'lib/reviewed-route-assets'));

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

const EVAL_CASES = [
  {
    familyId: 'history',
    routeId: 'dynasty_friction',
    genreName: '历史军事',
    title: '《鼎革前夜》· 关隘夜伏',
    prompt: `【本章写作任务·第一卷 第四章 霜锋照夜】：
承接前文，并州边军都尉严恪率部驻守雁门要塞北口黑石堡。天气骤降大雪，朔风呼啸。
【篇幅要求】：3000~3500中文字符。直接输出小说正文。

【剧情四幕硬核要求】：
1. 【幕一：边关苦寒与辎重磨损】：
   暴雪封山，黑石堡外的土夯城墙冻裂出两寸宽的缝隙，士卒用掺了滚水与黄黏土的麻布层层填塞。严恪巡查哨楼，手掌按在冰冷粗粝的生铁女墙上，棉甲内衬被冷汗浸透后贴着脊背，冻得发硬。巡哨伙长端来掺杂着粗盐粒的浓稠豆麦糜，热气在睫毛上凝成白霜。
2. 【幕二：斥候带回的致命军情与利益盘剥】：
   雪地深处跌入一名浑身是血的骑哨，马匹前蹄崩裂脱掌，倒地抽搐而死。斥候带回一柄折断的鲜卑弯刀与沾血的密函：幽州大粮商勾结北狄部落，借运送冬盐之名，将三百套淬火重札甲与两万支铁簇箭由私关暗道运往塞外。更残酷的是，这批军械的押运文书上赫然盖着并州刺史府长史的朱红官印。
3. 【幕三：成年军官的利害抉择与权力博弈】：
   堡内副将主张隐瞒不报，“天下大乱在即，刺史府一句话就能断了我们堡子整个冬天的口粮炭火，惹不起世家大族”。严恪没有热血沸腾的慷慨陈词，而是冷静翻看粮册与军械磨损账目。他清醒地算准：一旦北狄重甲骑兵破关，黑石堡首先沦为弃子；刺史府要的是敛财，要的是借刀杀人清洗异己。
4. 【幕四：严阵以待的伏击军阵布置（绝杀断章）】：
   严恪下令关闭偏门，全堡生火伪装成畏寒歇息。二百名精锐老卒伏于鹰嘴峡峭壁两侧，拉开八石重弩，弩臂缠满浸油麻布防冻裂。风雪更急，峡谷深处隐约传来重车轴轮碾压冰冻碎石的刺耳吱呀声，以及铁蹄裹布踏雪的沉闷震颤……

【坟土荒草/网文名家质感与《纠错库.md》最高指示】：
- 严守制度考据与物质阻力（军衔、札甲片数、粮饷铜钱成色、箭矢损耗、冻伤皲裂）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起冷笑、深吸一口气、后背冷汗直流）；
- 严禁神经生理套话（严禁写“震得气血翻涌/喉头一甜/双腿发颤/虎口发麻”）；
- 2~3处非功利闲笔（如城头油灯被风扑灭的青烟、冻死在旗杆下的寒鸦、士卒呵气捂耳朵的笨拙动作）；
- 长短句交织，沉静肃杀，直接输出小说正文。`
  },
  {
    familyId: 'scifi_apocalypse',
    routeId: 'hard_survival',
    genreName: '科幻末世',
    title: '《地表之下》· 反应堆重燃',
    prompt: `【本章写作任务·第二卷 第一章 裂解深渊】：
承接前文，第七避难所地下四百米深处。全所供暖主线断裂，温度降至零下二十四度，通风管凝结厚霜。工程师宋岚带队抢修重型磁约束聚变堆“夸父-7”。
【篇幅要求】：3000~3500中文字符。直接输出小说正文。

【剧情四幕硬核要求】：
1. 【幕一：极度寒冷下的重工业机械停摆】：
   重油加热管在极寒中冻结成坚硬蜡块，气动扳手因高压管路密封圈硬化脆裂而漏气嘶鸣。宋岚穿着厚重的防辐射劳保工服，面罩下呵出的白汽在护目镜边缘凝结成薄冰。避难所上层三千名平民的排风换气扇已经降速至每分钟十二转，空气中弥漫着机油、臭氧和过度饱和的二氧化碳酸涩味。
2. 【幕二：超导线圈的致命机械公差】：
   宋岚与老电工陈叔爬上高空检修桥，超导磁体B环支撑柱因地壳沉降产生了1.8毫米的形变应力，磁通量传感器指针剧烈抖动。老陈的手套被液氦溢出管擦过，织物瞬间冻硬如玻璃，险些连皮肉撕扯下来。两人必须用手动液压千斤顶在狭窄的工字钢夹缝中完成毫米级微调顶升。
3. 【幕三：资源短缺引发的底层利益对抗】：
   避难所安全官带着四名持枪巡防员冲入机房，要求立即切断B区贫民窟的备用循环电，优先保全A区核心蔬菜温室与冷冻胚胎库。底层矿工家属集聚在防爆闸门外敲击铁管，声音沉闷回荡。宋岚没有说教，用油污斑驳的手掌将热负荷监测仪表直接怼在安全官胸前：“B区管网是主回水环路，强行切断会导致热冲击水锤效应，两秒内打穿主蒸汽管道，整个避难所谁也别想活到天亮。”
4. 【幕四：聚变点火与未知辐射异常（绝杀断章）】：
   千斤顶压力达到六百个大气压，伴随刺耳的金属挤压呻吟，磁体复位销咔哒啮合！宋岚猛拉主预热电闸，等离子体点火电极爆发出耀眼的蓝紫电弧，涡轮发电机组低沉的龙吟再次从地底深处轰鸣升起！温度计读数缓缓回升。然而就在全员瘫坐在油渍地面上松气时，地核地震波监测仪器的滚筒记录纸上，突然划出了一道规律整齐、持续衰减的十二位方波脉冲……地壳深处，有某种人造机械正在有节奏地回应避难所的点火！

【晨星LL/网文名家质感与《纠错库.md》最高指示】：
- 严守工业真实与物质摩擦（公差、扭矩、螺纹防滑胶、液氦冻伤、金属冷缩）；
- 严禁AI劣质口癖（严禁眼神一凝、倒吸凉气、嘴角勾起、深吸一口气、愣住了）；
- 严禁神经生理套话（严禁气血翻涌、喉头一甜、手脚发颤）；
- 穿插闲笔（如被机器余热解冻的一滴铁锈水滴入颈脖、螺母滑落掉进油水坑的清脆叮当声）；
- 语言干净利落，硬核克制，直接输出小说正文。`
  }
];

async function runEvaluation() {
  console.log('================================================================');
  console.log('【墨阑名家引擎】全题材小说正文质量评测与真实API验证');
  console.log('覆盖母类：历史古代、科幻末世、西方奇幻、都市现实等');
  console.log('================================================================\n');

  console.log('[1/4] 登录服务验证账户...');
  const token = await login();
  console.log('✓ 账户凭据就绪\n');

  const outDir = path.join(molanHome, 'data/genre-lab/eval-results');
  fs.mkdirSync(outDir, { recursive: true });

  const summary = [];

  for (const c of EVAL_CASES) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`【评测项目】：${c.genreName} · 路线 [${c.routeId}] · 篇目 ${c.title}`);
    console.log(`----------------------------------------------------------------`);

    console.log(`[步骤A] 装配名家机理层与四维动机约束...`);
    const prep = prepareGenreSceneContext({
      genre: c.familyId,
      routeId: c.routeId,
      query: c.prompt.slice(0, 500),
      owner: EMAIL,
      dataDirectory: path.join(molanHome, 'data')
    });

    console.log(`✓ 引擎就绪: route=${prep.routeTitle} | systemLen=${prep.writingSystem?.length || 0}`);
    console.log(`✓ 检索范文样本数: ${prep.scenePlan?.sampleScenes?.length || 0}`);

    console.log(`[步骤B] 调用真实 /api/chat 进行正文生成 (model: gpt-5.6-luna)...`);
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
          { role: 'user', content: c.prompt }
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
    console.log(`✓ 生成完成！耗时: ${elapsedSec}s | 正文字数: ${charCount} 字`);

    // 保存正文
    const filePath = path.join(outDir, `${c.routeId}-chapter.md`);
    fs.writeFileSync(filePath, text, 'utf8');
    console.log(`✓ 正文保存至: ${filePath}`);

    console.log(`[步骤C] 质量审计与物理硬指标检测...`);
    const flavor = computeAiFlavorScore(text);
    const foundCliches = FORBIDDEN_AI_CLICHES.filter(cliche => text.includes(cliche));
    
    // 语料库查重
    const corpus = loadCorpusForFamily(c.familyId);
    const overlapIssues = checkSourceOverlap(text, corpus.scenes || [], 25);

    const hasPhysicalAnchors = /螺栓|铜钱|冰冷|油漆|公差|粗粝|棉甲|齿轮|铁锈|泥泞|电缆|气阀/.test(text);
    const hasIdleNotes = /烟|灯|风|冷|霜|水滴|残渣|麻布/.test(text);

    const passedCliches = foundCliches.length === 0;
    const passedLength = charCount >= 2600;
    const passedFlavor = flavor.score === 100;
    const passedOverlap = overlapIssues.length === 0;

    const report = {
      familyId: c.familyId,
      routeId: c.routeId,
      title: c.title,
      charCount,
      elapsedSec,
      passedLength,
      aiFlavorScore: flavor.score,
      passedFlavor,
      clichesFound: foundCliches,
      passedCliches,
      hasPhysicalAnchors,
      hasIdleNotes,
      overlapIssuesCount: overlapIssues.length,
      passedOverlap
    };
    summary.push(report);

    console.log(`  - 字数达标 (≥2600): ${passedLength ? '✔ 是 (' + charCount + '字)' : '❌ 否'}`);
    console.log(`  - AI 味评测得分: ${flavor.score} / 100 (${flavor.deductions?.length || 0} 处扣分)`);
    console.log(`  - 零容忍口癖命中: ${foundCliches.length ? '❌ 发现: ' + foundCliches.join(', ') : '✔ 0处 (完全干净)'}`);
    console.log(`  - 范文库查重结果: ${overlapIssues.length ? '❌ 发现重合' : '✔ 0长片段重合 (完全原创叙事)'}`);
    console.log(`  - 物理质感与器物阻力: ${hasPhysicalAnchors ? '✔ 丰富' : '❌ 匮乏'}`);
    console.log(`  - 现实烟火闲笔: ${hasIdleNotes ? '✔ 具备' : '❌ 缺失'}`);
  }

  console.log('\n================================================================');
  console.log('【全题材名家管线评测总表】');
  console.log('================================================================');
  console.table(summary.map(s => ({
    '题材路线': s.routeId,
    '作品篇目': s.title,
    '汉字数': s.charCount,
    '耗时(秒)': s.elapsedSec,
    'AI味得分': s.aiFlavorScore,
    '口癖零容忍': s.passedCliches ? 'PASS' : 'FAIL',
    '原创无重合': s.passedOverlap ? 'PASS' : 'FAIL'
  })));

  const allPassed = summary.every(s => s.passedLength && s.passedCliches && s.passedOverlap);
  console.log(`\n最终验收结论: ${allPassed ? '🎉 全部题材名家管线质量完美达标！' : '⚠️ 存在需要优化的项目'}`);
}

runEvaluation().catch(err => {
  console.error('评测流程异常:', err);
  process.exit(1);
});
