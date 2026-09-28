import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const molanHome = 'c:/Users/lyh/Desktop/小说专属网页/molan-home';
const { computeAiFlavorScore } = require(path.join(molanHome, 'lib/ai-flavor-detector'));
const { prepareGenreSceneContext } = require(path.join(molanHome, 'lib/genre-engine'));

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

async function main() {
  console.log('================================================================');
  console.log('【天权号·第二章】项目真实API调用生成');
  console.log('路线：元始法则（飞天鱼·硬朗秩序与危机担当风格）');
  console.log('================================================================\n');

  console.log('[1/4] 登录项目账户...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  if (!loginRes.ok) throw new Error(`登录失败 HTTP ${loginRes.status}`);
  const { token } = await loginRes.json();
  console.log('✓ 登录成功\n');

  console.log('[2/4] 加载《元始法则》特化管线与场景驱动方案...');
  const prepData = prepareGenreSceneContext({
    genre: '玄幻',
    routeId: 'yuanshi',
    query: '天权号深海科考 第二章 巨浪撞击 海底异化黑鳞兽袭舰 现代热兵器受挫 陆不危以工业机械与桩功封堵',
    owner: EMAIL,
    dataDirectory: path.join(molanHome, 'data')
  });

  const writingSystem = prepData.writingSystem;

  const chapter1Summary = `
【前情提要·第一章要点】：
- 故事开局于西太平洋千岛海沟边缘，“天权号”重型地质调查船（一万六千吨，双核动力）。
- 主角陆不危（十九岁，太和观老道人传人，老道人两月前逝世，留下粗布包裹的残缺古石片）。大副陈岳（东海机动救援支队潜水长转业，性格刚硬）带他上船散心，安排在防卫组。
- 船内矛盾：防卫副组长高锐（港口调度局领导亲戚）排挤陆不危“关系户占好宿舍”；陆不危心性极沉静，以成年人理性看待制度漏洞，不搞口舌相讥。
- 第一章末尾：物探组在四千八百米深海断裂带取出的三号岩芯标本中发现超硬度人工同心圆切纹。陆不危触摸标本箱瞬间，胸前古石片剧烈冰冷刺痛。深海五千米下有超高速巨大活物破水上浮。全舰防撞防空最高警报拉响，大副陈岳咆哮预警：“水下防撞准备！全员抓牢固定物！”`;

  const userPrompt = `${chapter1Summary}

【本章写作任务·第二章 巨擘】：
承接第一章末尾的剧烈危机断章，直接输出第二章正文。标题“## 第二章 巨擘”。
【篇幅要求】：2600~3500中文字符。只输出小说正文，不带说明、不带设定总结。

【剧情四幕硬核要求】：
1. 【幕一：万吨巨轮受撞与甲板物理混乱】：
   五千米深渊下巨力破浪上涌！一万六千吨的“天权号”被海啸巨浪和撞击硬生生横向掀倾，龙骨扭曲呻吟，两吨重的箱式取样器限位架螺栓崩脱，钢缆崩断如巨鞭狂甩！甲板积水结冰，研究生温晴等人失去平衡滑向卷筒；陆不危展现扎实古桩功与惊人反应，下盘深扎如生根，单臂拉住温晴，指挥混乱的研究人员顺着安全扶索退入损管防爆门。
2. 【幕二：伴随巨浪冲上甲板的凶戾异变】：
   海水倒灌甲板，冲上后舷的不是深海章鱼，而是一头被深海压力塑造成的异形黑鳞巨兽（体长近十米，背覆如黑色铸铁的厚重硬角质，口器形如重型液压钢剪，四肢生有刺入钢板的倒钩骨爪）。冰冷死寂的海水冲刷甲板，巨兽发出金铁摩擦般的暴虐低吼。
3. 【幕三：现代枪械火力受挫（打破科技傲慢）】：
   高锐带领安保巡查队员荷枪实弹赶到现场，惊慌中组织防暴枪与霰弹枪齐射。子弹打在黑鳞上火星四溅，只崩落几星碳酸盐残渣，根本无法破防！巨兽被激怒，巨尾横扫，钢制工作台如纸糊般爆碎，一名队员被撞飞骨折，高锐惊恐失色、手足无措往后溃退。
4. 【幕四：沉着利用重工业设备破局封堵】：
   陆不危绝不莽撞用肉拳硬碰。他极其冷静，指挥老周启动起吊机绞盘拉动断裂钢缆缠住巨兽后肢，同时反手拧开后甲板高压液氮吹扫阀和重型干粉灭火管！超低温液氮白雾瞬间爆发，极寒让巨兽关节甲壳骤然脆化发僵。陆不危借机猛拉液压阀，巨型防爆重水密门轰然闭锁，将巨兽卡死隔绝在外！
5. 【幕五：更深维度的恐怖悬念（绝杀断章）】：
   全员瘫软脱力、急促喘息之际，声呐室的警报声却不仅没有停，反而音调变得极其低沉压抑。船体下方数千米水层陷入诡异死寂。声呐荧光屏上，那头近十米的异兽只是个逃难的幼崽——在它下方，一道长逾两百米的不可思议巨大阴影，正从千岛海沟最深处，缓缓游弋而过……

【飞天鱼文学质感与《纠错库.md》最高指示】：
- 严守工业制度真实与物理细节（吨位、气阀、螺栓断裂声、液氮白雾、钢板形变）；
- 严禁AI劣质口癖：严禁“眼神一凝”、“倒吸凉气”、“嘴角勾起一丝冷笑”、“深吸一口气”、“不由得愣住了”；
- 严禁动作戏秒表排队倒数（第一息第二息）；
- 严禁神经生理套话（严禁写“震得气血翻涌/喉头一甜/双腿发颤/虎口发麻”，只写真实物理运动）；
- 长短句交织，沉静大气，危机紧迫而不失章法。直接输出小说正文。`;

  console.log('[3/4] 正在调用项目 /api/chat 模型进行真实生成...');
  const startedAt = Date.now();
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    signal: AbortSignal.timeout(600000),
    body: JSON.stringify({
      stage: 'writing',
      genre: '玄幻',
      twoPassHumanize: false,
      max_tokens: 8192,
      temperature: 0.85,
      messages: [
        { role: 'system', content: writingSystem },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`生成请求失败 HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('生成接口未返回 SSE 流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rawStream = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rawStream += decoder.decode(value, { stream: true });
  }

  const { text, usage } = parseChatStream(rawStream);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const wordCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  console.log(`✓ 项目真实生成成功！耗时: ${elapsedSec}s | 正文字数: ${wordCount} 字 | 请求ID: ${usage?.requestId || 'N/A'}`);

  console.log('\n[4/4] 正在保存与质检核验...');
  const outDir = path.join(molanHome, 'data/genre-lab/tianquan');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'chapter_2.md');
  fs.writeFileSync(outPath, text, 'utf8');
  console.log(`✓ 正文已写入: ${outPath}`);

  const flavorScore = computeAiFlavorScore(text);
  console.log(`✓ AI 味质检得分: ${flavorScore.score} / 100 (扣分点: ${flavorScore.deductions?.length || 0}项)`);
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
