import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const { computeAiFlavorScore } = require(path.join(projectRoot, 'lib/ai-flavor-detector.js'));

const configFile = path.join(projectRoot, 'data/config.json');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const gpt6Model = config.platformModels.find(m => m.id === 'gpt-6-luna') || {
  id: 'gpt-6-luna',
  model: 'gpt-6-luna',
  baseURL: 'https://codex.xiaoguo.work/v1',
  apiKey: 'sk-6ea28df55f371c773cdb577ac429d27ce08627901a80b320d4fee78d43ca328b'
};

const systemPrompt = `你是一位当代中文顶级都市小说作家，擅长美利坚海外华人生活流、黑色幽默、现实讽刺与荒诞奇幻悬念风格。
【核心写作规范】：
1. 语言风格：辛辣、克制、幽默、充满颗粒感的生活细节与法律/经济账本，拒绝浮夸空泛。
2. 对话要求：人物说话必须符合底层生存本能与真实利益算计，对话节奏紧凑，充满交锋与机智反制。
3. 严格去AI味：
   - 严禁“眼神微凝”、“倒吸一口凉气”、“嘴角勾起一丝冷笑”、“心头猛地一跳”、“深吸了一口气”、“不由得愣住了”等一切模板套话；
   - 严禁机械排队与报时倒数；
   - 避免无意义的心理全知旁白，一切背景与规则通过对话、动作、破旧道具与账单物证自然带出；
4. 输出要求：只输出小说第一章正文（包含章节标题），不带任何前言、后记、写作说明或自我评价。正文字数约 2800~3500 字。`;

const userPrompt = `【任务目标】：根据以下提取的都市题材第一章结构与核心设定，创作完整的小说第一章正文。
【章节标题】：第1章 欢迎来到美利坚

【核心人设】：
1. 李维（主角）：17岁未成年孤儿，容貌出众的混血少年。父母在国内因意外车祸双亡并留下沉重债务。为避免成为老赖并谋求生路，经外事部门牵线投奔美利坚远房叔叔。性格冷静、早熟、算账清醒、懂法律与规则，嘴毒但极有分寸，绝不让自己吃亏。
2. 堂吉诃德·塞万提斯（叔叔）：美利坚底层老油条、落魄中年破产商人。开着锈迹斑斑的破丰田，打两份工（工地搬砖+餐馆洗盘子）。被前妻每月榨取高额赡养费，欠黑帮高利贷。精明势利、满嘴牢骚、斤斤计较，却自命不凡，偷偷珍藏着一本破旧的西班牙语骑士小说和自制劣质板甲。

【剧情四幕硬核节拍】：
- 幕一【肯尼迪机场夺命狂奔】：
  李维走出海关。堂吉诃德为了省下4美元停车费，死活不进停车场，在路边催命般打电话。接上李维后，破丰田在纽约车流中颤颤巍巍狂飙。车门锁损坏随时可能弹开，车内塞满干掉的油漆桶和反光背心。堂吉诃德一边狂喷吸血鬼前妻与美利坚法律，一边盘算李维身上带了多少钱（李维藏了大部分积蓄，只报了600美金，叔叔却如获至宝）。
- 幕二【ACS办事大厅与“人头支票”反杀】：
  车子直接开到纽约市儿童服务管理局（ACS）。堂吉诃德用伪造的残疾人证抢占专用车位，露出真面目：他收留李维纯粹是为了骗取纽约州给未成年孤儿每月1000美元的“亲属寄养补贴”。凭借李维体面漂亮的混血长相顺利领到补贴支票。回到车上后叔叔试图用“食宿费”名义五五开甚至全吞，李维冷静抓住“举报虐待取消补贴”这一制度七寸，精准反杀，硬生生把分成砍到二八开（自己拿大头）。堂吉诃德不怒反喜，怪笑夸他“学的真快，欢迎来到美利坚”。
- 幕三【日落公园管状半地下室与生存现实科普】：
  破车开进布鲁克林日落公园华人区。满街福州鱼丸、移民中介与红砖旧楼，恍若破败县城。两人住进阴暗潮湿、发霉、长条管状的半地下室，窗外只有路人的脚踝和老鼠。李维在破沙发缝里摸出一本泛黄的骑士小说，戳破堂吉诃德心底的怪诞幻想。堂吉诃德换工服赶场洗盘子前，严肃警告李维：不能非法打黑工，必须正规转F-1学签读完高中熬满两年转绿卡；同时提醒他漂亮的混血长相在纽约公立高中极其危险，要么练块要么带刀防身。
- 幕四【午夜绝杀断章与荒诞神展开】：
  堂吉诃德出门，疲惫至极的李维在发霉床垫上和衣沉睡。半梦半醒间，脑海中突兀响起清脆的机械提示音：【欢迎来到中世纪，冒险者李维】【中世纪冒险者系统加载成功】。李维以为是幻觉，接着被凌晨三点半一阵刺耳沉重的金属撞击声吵醒。推开布帘，狭窄昏暗的地窖里，堂吉诃德竟然梦游般穿戴着一套叮咣乱响、缝缝补补的生锈铁骑士板甲，闭着双眼精准拍在李维肩上，神神叨叨大喊：“我知道了！你一定是我的侍从李维！”戛然而止！

请严格按照上述要求展开极其生动、细节饱满的小说第一章创作！`;

async function main() {
  console.log('='.repeat(70));
  console.log('★ 项目真实生成启动');
  console.log(`★ 目标模型: ${gpt6Model.id} (${gpt6Model.model})`);
  console.log(`★ 上游端点: ${gpt6Model.baseURL}/chat/completions`);
  console.log('='.repeat(70));

  const endpoint = `${gpt6Model.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const startTime = Date.now();

  const bodyData = {
    model: gpt6Model.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.82,
    stream: true,
    stream_options: { include_usage: true },
    reasoning_effort: 'medium'
  };

  console.log('正在向上游发送生成请求...');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${gpt6Model.apiKey}`
    },
    body: JSON.stringify(bodyData),
    signal: AbortSignal.timeout(600000)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`上游接口返回错误 HTTP ${res.status}: ${errText}`);
  }

  console.log('上游连接成功，正在接收流式正文...');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let usage = null;
  let chunkCount = 0;

  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
          const delta = parsed.choices[0].delta;
          if (delta.content) {
            fullText += delta.content;
            chunkCount++;
            if (chunkCount % 50 === 0) {
              process.stdout.write(`\r已接收字符数: ${fullText.length} ...`);
            }
          }
        }
        if (parsed.usage) {
          usage = parsed.usage;
        }
      } catch (_) {}
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✓ 真实生成完成！耗时: ${durationSec} 秒 | 正文长度: ${fullText.length} 字符`);
  if (usage) {
    console.log(`✓ Token使用: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}`);
  }

  // 写入落盘
  const outDir = path.join(projectRoot, 'generated');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'urban_ch1_gpt6_luna.md');
  fs.writeFileSync(outFile, fullText, 'utf8');
  console.log(`✓ 生成小说已落盘保存至: ${outFile}`);

  // AI 味检测
  try {
    const flavor = computeAiFlavorScore(fullText);
    console.log(`✓ AI 味质检评分: ${flavor.score} / 100 (低于40为优秀，越低越好)`);
    console.log(`  - 扣分项数量: ${flavor.deductions?.length || 0}`);
  } catch (e) {
    console.log('AI味检测略过:', e.message);
  }

  // 将结果也以 JSON 写入，方便后续审计
  const metaFile = path.join(outDir, 'urban_ch1_gpt6_luna_meta.json');
  fs.writeFileSync(metaFile, JSON.stringify({
    novel: '人在美利坚：我的叔叔堂吉诃德',
    genre: '都市',
    model: gpt6Model.model,
    durationSec: Number(durationSec),
    charCount: fullText.length,
    usage,
    generatedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  console.log(`✓ 元数据已落盘保存至: ${metaFile}`);
}

main().catch(err => {
  console.error('\n❌ 执行失败:', err);
  process.exit(1);
});
