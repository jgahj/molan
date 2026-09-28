import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { computeAiFlavorScore } = require('../lib/ai-flavor-detector');
const { NARRATIVE_ROUTES, prepareGenreSceneContext } = require('../lib/genre-engine');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 命令行参数解析
const args = process.argv.slice(2);
function getArg(name, def) {
  const prefix = `--${name}=`;
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : def;
}

const ROUTE = getArg('route', 'jianzhu'); // 'jianzhu' 或 'yuanshi'
const GENRE = getArg('genre', '玄幻');
const TWO_PASS = getArg('two-pass', 'false') === 'true';
const BASE_URL = 'http://127.0.0.1:3000';
const EMAIL = '1271055010@qq.com';
const PASSWORD = '123456';
const RUN_ID = getArg('run-id', new Date().toISOString().replace(/[:.]/g, '-'));

export function parseChatStream(rawStream) {
  let text = '';
  let usage = null;
  let billing = null;
  const rewriteEvents = [];
  for (const event of rawStream.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n').trim();
    if (!data || data === '[DONE]') continue;
    const packet = JSON.parse(data);
    if (packet.error || packet.molan_error) throw new Error('生成流返回错误，未计为成功');
    if (packet.molan_usage) usage = packet.molan_usage;
    if (packet.molan_billing) billing = packet.molan_billing;
    if (packet.molan_rewrite) rewriteEvents.push(packet.molan_rewrite);
    if (packet.choices?.some(choice => ['length', 'content_filter'].includes(choice.finish_reason))) {
      throw new Error('正文被截断或过滤，未计为完整章节');
    }
    text += sseTextOf(packet);
  }
  if (!text.trim()) throw new Error('生成接口未返回正文');
  if (!usage?.requestId || !usage.modelId || usage.status !== 'completed') {
    throw new Error('缺少已完成的项目调用凭证');
  }
  if (['length', 'content_filter'].includes(usage.finishReason)) throw new Error('项目报告正文未完整生成');
  return { text: text.trim(), usage, billing, rewriteEvents };
}

export function buildSampleSystem(preparedSystem, route) {
  const template = NARRATIVE_ROUTES[route]?.generationPrompt;
  if (!template || !preparedSystem?.includes(template)) {
    throw new Error('题材路线模板已变化，停止以免混入原著情节');
  }
  const assets = preparedSystem.split(/\n【(?:极品质感铁律（去匠气与去AI味）|名家级叙事质感与《纠错库\.md》最高指示)】/)[0];
  return assets
    + `\n【本次素材应用边界】
参考片段不是续写素材，背景用语、人物职业和设备服从本次原创场景，现代矿站不植入古代衙门制度。
短段本身不是缺陷：按动作与思考的完整性分段，不为凑句数机械合并。
保持道具、伤势、时空与人物知识来源连续；以可见行为展现压力，避免装饰性比喻和重复解释。
不将参考资产中的兵器、旧物与结霜等现象硬塞入场景；异常只能按本章预先建立的规则发展。
【名家神作三原则】
1. 现实生活的无功利杂音（闲笔工程）：正文中自然穿插2~3处非功利的日常生活感官碎片（如风吹灭油灯、水鸟啄食、衣鞋沾泥、远方灶房焦葱味），展现真实生活质地。
2. 意象衰减与防打卡红线（核心信物单章≤2~3次）：主角贴身信物全章至多提及2~3次（开篇入场1次、终幕共鸣1次），严禁每逢段落反复打卡提及！
3. 不对称节奏与句式拓扑（长短句3:5:2配比）：坚决打破发报机式断句与分镜疲劳，长短句交织，包含多处40字以上复合长句与连贯段落。`;
}

async function requestChapter(token, messages) {
  const startedAt = new Date().toISOString();
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(600000),
    body: JSON.stringify({
      stage: 'writing',
      genre: GENRE,
      twoPassHumanize: false,
      max_tokens: 8192,
      temperature: 0.88,
      presence_penalty: 0.18,
      frequency_penalty: 0.12,
      messages
    })
  });
  if (!response.ok) throw new Error(`生成请求失败 HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('生成接口未返回 SSE');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rawStream = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rawStream += decoder.decode(value, { stream: true });
  }
  return { ...parseChatStream(rawStream), startedAt, completedAt: new Date().toISOString(),
    streamSha256: createHash('sha256').update(rawStream).digest('hex') };
}

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

function countChineseChars(str) {
  const match = String(str || '').match(/[\u4e00-\u9fa5]/g);
  return match ? match.length : 0;
}

async function main() {
  if (!['jianzhu', 'yuanshi'].includes(ROUTE)) throw new Error('不支持的路线');
  if (!/^[A-Za-z0-9_-]+$/.test(RUN_ID)) throw new Error('run-id 只能包含字母、数字、横线和下划线');
  const outDir = path.resolve(__dirname, '../data/genre-lab', RUN_ID, ROUTE);
  if (fs.existsSync(outDir)) throw new Error('本次输出目录已存在，停止以免覆盖旧样章');
  fs.mkdirSync(outDir, { recursive: true });
  console.log('================================================================');
  console.log(`墨阑题材实验室 · 原创样章实测 (${ROUTE})`);
  console.log(`题材: ${GENRE} | 路线: ${ROUTE} | 脚本编排两次项目调用: ${TWO_PASS}`);
  console.log('================================================================');

  // 1. 登录
  console.log('\n[1/5] 正在登录项目账号...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  if (!loginRes.ok) {
    throw new Error(`登录失败 HTTP ${loginRes.status}`);
  }
  const loginData = await loginRes.json();
  const token = loginData.token;
  if (!token) throw new Error('登录响应缺少凭证');
  console.log('✓ 登录成功');
  const syncRes = await fetch(`${BASE_URL}/api/local-sync/status`);
  if (!syncRes.ok) throw new Error('无法核实项目调用链路');
  const syncStatus = await syncRes.json();
  console.log(`✓ 项目数据链路: ${syncStatus.mode}`);

  // 2. 题材实验室起草准备
  console.log('\n[2/5] 准备动机与路线方案...');
  const queryTopic = ROUTE === 'jianzhu'
    ? '架空皇朝渡口验尸 水灾追偿 人证账册各有局限 底层缉查利益冲突'
    : '盐漠矿区科考 重型绞车救援 地层异常 工业秩序与古老力量冲突';

  let prepData = null;
  try {
    const prepRes = await fetch(`${BASE_URL}/api/genre-lab/prepare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        genre: GENRE,
        route: ROUTE,
        query: queryTopic
      })
    });
    if (prepRes.ok) {
      const serverPrep = await prepRes.json();
      if (serverPrep.writingSystem && serverPrep.writingSystem.includes(NARRATIVE_ROUTES[ROUTE]?.generationPrompt)) {
        prepData = serverPrep;
      }
    }
  } catch (_) {}

  if (!prepData) {
    prepData = prepareGenreSceneContext({
      genre: GENRE,
      routeId: ROUTE,
      query: queryTopic,
      owner: EMAIL,
      dataDirectory: path.resolve(__dirname, '../data')
    });
  }
  console.log(`✓ 路线匹配: ${prepData.routeTitle} (${prepData.familyName})`);

  console.log(`\n[3/5] 组装原创场景与题材资产 (${ROUTE})...`);
  const writingSystem = buildSampleSystem(prepData.writingSystem, ROUTE);
  const userPrompt = (ROUTE === 'jianzhu'
    ? `原创大荒志怪与朋克市井小说，标题“## 第一章　少领的一份米”。
【世界观与世俗生计】：架空大荒水运要冲，机关水车与民俗志怪共存。深秋江风刺骨，泥地潮湿冰冷。主角沈砚刚入河务司四天，手腕内侧勒着妹妹沈禾编的旧草绳（提醒赎冬袄，当铺利钱比棉花还厚，妹妹咳嗽时单薄的背脊让他心头发紧）。他性格机敏克制，带着底层人的生存自嘲与防备。
【神作三原则（生活闲笔 · 信物衰减 · 句式呼吸）】：
- 【核心信物防打卡红线】：妹妹沈禾编的旧草绳全章至多出现2~3次（开篇入场触及1次、终幕因果共振1次），中间勘查走访绝不每段打卡提及！
- 【无功利生活闲笔】：自然穿插2~3处非功利的市井感官细节（如柜台油灯被江风吹灭的焦油味、江面翻滚浮沫上的冻僵水鸟、鞋底黏着的湿泥），赋予世界生动呼吸感；
- 【不对称句式拓扑】：长短句交织（30%超过40字的多分句复合长句，50%常态叙述句，20%短句冲击），段落长短错落，杜绝发报机短句与分镜疲劳。
【打破相声体，注入活人交谈与生理真实】：
- 严禁 A-B-A-B 乒乓球式接梗排练台词！交谈中有不耐烦、冷风灌进嗓子的剧烈咳嗽、因手冷数铜钱数错的烦躁、各怀心事的沉默；
- 杜嫂抱着病弱孩子，眼眶通红，手指冻得发紫生出冻疮，死活不领米是因为绝望中的一线执念；
- 老差役韩成腿疾发作时，疼得吸冷气、膝盖骨发出酸涩轻响，不是为了讲笑话，而是老吏在底层摸爬滚打一辈子的残破印记。
【黄金四幕商业节奏】：
1. 幕一（市井生计与深层人情）：封闸木将落，排队领米领钱，算盘声与江水声杂乱，沈砚在柜台前为二分银子与掌柜好话的纠结；
2. 幕二（异象微澜与现场侦查）：杜嫂抱着孩子拒领抚米，坚称门栓竖着。沈砚与韩成赴东柳巷查验，发现泥地只有一条腿的拖痕，祭水米灰与阴冷气味不符；
3. 幕三（超凡破壁与剧烈动量）：黄昏封闸，韩成用红泥与铜片在石阶退水缝测试，中缝红泥违背常理向下蠕动，河面下沉气泡，铁签挑出一枚河务司断木牌；
4. 幕四（信物宿命共振与绝顶悬念）：沈砚宁肯扣押工钱也不注销名册。此时断牌背面水痕聚拢，竟然赫然显出主角妹妹“沈禾”的名字！手腕草绳剧烈收紧勒进皮肉，危机穿透全场咬死主角，悬念在最高潮戛然而止！`
    : `原创高概念修真工业极地探索小说，标题“## 第一章　雪脊暗影”。
【世界观与肉体生存】：北疆千里冰川与极昼天幕，长逾三百二十丈的黑铁撞角“龙渊号”。极地酷寒与机械轰鸣交织：极昼冷阳照射下的万丈雪原，破冰巨舰黑铁撞角撕裂浮冰，甲板冰冷坚硬，呼出的白雾模糊视线，少年们在恶劣环境中各司其职。
【神作三原则（生活闲笔 · 信物衰减 · 句式呼吸）】：
- 【核心信物防打卡红线】：胸前古铜鱼佩全章至多出现2~3次（开篇入场触及1次、终幕与巨兽额骨共振1次），中间巡检与对抗绝不每段打卡提及！
- 【无功利生活闲笔】：自然穿插2~3处非功利的极地真实生活细节（如舷窗外冻僵海鸟羽毛、门边废弃纸卷被风卷起、金属手套碰响的钝音），赋予世界生动呼吸感；
- 【不对称句式拓扑】：长短句交织（30%超过40字的多分句复合长句，50%常态叙述句，20%短句冲击），段落长短错落，杜绝发报机短句与分镜疲劳。
【打破相声体，注入活人交谈与深层心流】：
- 林寒：性格内敛冷峻，心底深藏对武道长生与过往身世的执念；极度戒备时指节按紧衣领内的冰冷信物，呼吸沉降；
- 沈青禾：要强、专注，在风雪中端着沉重的测距仪专注校准度盘，手冷便在掌心呵气，说话带着被冷风打断的真实停顿；
- 许岳：怕死又重情义，啃着干粮抱怨不停，但遇到危险第一反应是身体僵硬、脸色发白；
- 严禁全员对仗接梗讲段子！允许交谈走神、各说各话、被寒风和咳嗽打断。
【黄金四幕商业节奏】：
1. 幕一（生活流与信物伏笔）：极昼冷阳下破冰航行，巡检弟子没走几步就要敲碎薄冰。同伴在风雪中抱团取暖与笨拙协作，林寒抚摸胸前冰冷刺骨的古铜鱼佩；
2. 幕二（仪器异动与数据冲击）：沈青禾与林寒通过仪器发现远处雪脊出现紫黑重甲与雪尘空痕，巨兽呼啸俯冲，压迫感骤降；
3. 幕三（狂暴冲锋与连贯硬核对抗）：雪崩狂暴倾泻，十丈紫黑骨甲巨兽狂暴冲锋（连贯对抗，严禁写成第一息第二息秒表倒数！）。撞角折断、结界爆碎！木箱崩塌阻断通路，许岳跌入杂物堆咬牙闷哼，林寒拼死拉扯掩护，导师大声呼喝维持防线；
4. 幕四（宿命因果与绝杀悬念）：林寒冲上二层平台，看清巨兽额骨嵌着的残缺古铜纹路与祖传鱼佩惊人共鸣，巨兽穿透风雪逼近舰桥，生死绝境戛然而止！`)
    + '\n正文目标3200~4200汉字。严守《纠错库.md》最高指示：严禁伪精确测绘数字（写“没走几步”而非“每隔七步”，写“正北方向”而非测绘度数）、严禁“旧伤在寒气里发紧”等空洞套话、严禁秒表倒数（第一息第二息）、严禁“瞳孔放大/收缩”、严禁连环套用“没有回答，只……”、严禁声音/目光实体化、严禁单字动词碎写（颤一下）、严禁烂俗比喻黑名单、严禁“嘴角勾起一抹弧度/笑意”、严禁“震得脚底发木/双腿发颤/虎口发麻/喉头一甜/气血翻涌”等身体套话、严禁数值打卡跳字、严禁连续单字动词发报机流水账、状语后置改自然语序、旁白不越权。直接输出正文。';

  console.log('\n[4/5] 调用项目 /api/chat 生成初稿...');
  const chatStart = Date.now();
  const messages = [{ role: 'system', content: writingSystem }, { role: 'user', content: userPrompt }];
  fs.writeFileSync(path.join(outDir, 'request.json'), JSON.stringify({
    route: ROUTE, endpoint: `${BASE_URL}/api/chat`, mode: syncStatus.mode,
    orchestration: 'script', serverTwoPassHumanize: false, messages,
    scenePlan: prepData.scenePlan
  }, null, 2), { encoding: 'utf8', flag: 'wx' });
  const draft = await requestChapter(token, messages);
  fs.writeFileSync(path.join(outDir, 'draft.md'), draft.text, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(path.join(outDir, 'draft-call.json'), JSON.stringify(draft, null, 2), { encoding: 'utf8', flag: 'wx' });
  console.log(`✓ 初稿已保存: ${countChineseChars(draft.text)}汉字 | ${draft.usage.requestId}`);
  let final = draft;
  if (TWO_PASS) {
    console.log('正在通过项目 /api/chat 做第二次因果与语言精修（名家质感与定向微创）...');
    const revisionMessages = [
      ...messages,
      { role: 'assistant', content: draft.text },
      { role: 'user', content: `请以名家审读标准逐段审阅初稿，并输出完整修订正文。重点落实以下升级：
1. 【彻底清除假人感与段子手相声体】：
   - 严禁 A-B-A-B 乒乓球式接梗对仗！清除刻意抖包袱的台词，恢复活人交谈的呼吸感、错位感与因严寒导致的停顿/粗粝；
   - 彻底封杀生死关头贫嘴开玩笑（如重伤时还在开玩笑）；遭遇撞击与剧痛时，必须有神经与生理失控：倒吸冷气、抽搐惨哼、肌肉痉挛发白、指甲在铁板上抠出血痕，再由意志强行压制！痛感真实，人物才有灵魂。
2. 【强化主角深层心流与人物身体微癖】：
   - 补足主角面对极昼冰原或大荒浊流时的私密记忆、旧伤痛感与骨子里的狠劲算计；
   - 呈现人物不自觉的生理小动作（如大拇指掐食指关节、咬下唇渗血、睫毛结霜粘连）。
3. 【严格落实《纠错库.md》最高指示】：
   - 彻底清除伪精确数字与死板步数（如“每隔七步”必改“没走几步/走几步”，“北偏东七度”、“长约七尺”改自然口语）；
   - 彻底清除套路化伤势感知（“旧伤在寒气里发紧”、“疼痛顺着骨缝往上爬”一律改为具体生理刺痛与沉闷钝痛）；
   - 彻底清除动作戏秒表倒数（全量清除“第一息……第二息……第三息……第十息”这类像游戏报时的排队倒数，改为狂暴连贯的战况连锁）；
   - 彻底清除“瞳孔放大/骤缩”等AI眼睛套话，清除“没有回答/没有接话，只……”连环套用；
   - 彻底清除声音/目光实体化（夜色漏出/飘出声音、目光落在/眼神扫过，必须写人物主体行为）；
   - 清除生硬单字动词（“颤一下”必须改为“颤抖一下”），叙述不用口语缩写“没说话”→改用“没有说话”；
   - 彻底清除烂俗比喻黑名单（如刀、如水、如断线风筝、如惊雷、像钉子钉进心头、像散落的棋子、受惊的丧家之犬等），全章比喻词≤2处；
   - 彻底清除AI套话神态（“嘴角/唇角勾起一抹……弧度/笑意/意味难明/微抿”等）；
   - 状语后置改自然语序（“轻笑一声、语气平淡”，而非“笑得很轻、声音淡淡的”）；
   - 旁白不越权（不替读者贴标签，如“实在不值当”、“成长速度太恐怖了”；不剧透心理，说明文因果堆砌限最多1个原因）。
4. 【定向微创修复，不抹杀初稿灵气】：
   - 只做有证据的最小局部修复，严禁大面积推倒重写抹平初稿的生动金句与生活细节。
目标3200~4200汉字，只输出含标题的完整正文，不输出审阅报告。` }
    ];
    fs.writeFileSync(path.join(outDir, 'revision-request.json'), JSON.stringify({
      endpoint: `${BASE_URL}/api/chat`, messages: revisionMessages
    }, null, 2), { encoding: 'utf8', flag: 'wx' });
    final = await requestChapter(token, revisionMessages);
    fs.writeFileSync(path.join(outDir, 'revision-call.json'), JSON.stringify(final, null, 2), { encoding: 'utf8', flag: 'wx' });
  }
  const durationMs = Date.now() - chatStart;
  const cleanText = final.text
    .replace(/(?:北偏东|东偏北|西偏北|北偏西|偏北|偏南|偏东|偏西)\s*[一二三四五六七八九十\d]+\s*度/g, '正北方向')
    .replace(/每隔[一二三四五六七八九十\d]+步/g, '没走几步');
  const charCount = countChineseChars(cleanText);
  const totalLength = cleanText.length;
  const outMd = path.join(outDir, 'chapter.md');
  const outJson = path.join(outDir, 'result.json');
  fs.writeFileSync(outMd, cleanText, { encoding: 'utf8', flag: 'wx' });

  console.log(`✓ 生成完成: 耗时 ${(durationMs / 1000).toFixed(1)} 秒 | 中文字数: ${charCount} 字 | 总字符数: ${totalLength}`);
  console.log(`  模型: ${final.usage.modelId} | 精修请求: ${final.usage.requestId}`);

  // 5. 题材实验室自动化全项质检
  console.log('\n[5/5] 执行有限规则检查（不代表文学质量验收）...');

  // A. 36字原创重合门禁
  const inspectRes = await fetch(`${BASE_URL}/api/genre-lab/inspect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      genre: GENRE,
      text: cleanText
    })
  });
  if (!inspectRes.ok) throw new Error(`正文已保存，但重合检查失败 HTTP ${inspectRes.status}`);
  const inspectData = await inspectRes.json();
  if (inspectData.ok !== true || !Array.isArray(inspectData.issues)) throw new Error('重合检查响应无效，正文已保存');
  const overlapIssues = inspectData.issues;
  console.log(`  1. 当前语料切片36字连续重合: ${overlapIssues.length}处；不构成完整原创性证明`);

  // B. 简易本地高危词与AI模式扫描
  const aiPhrases = [
    '似乎在诉说', '仿佛在嘲笑', '嘴角勾起一抹', '眼底闪过一丝', '心中不由得一沉',
    '如同断线的风筝', '不可名状的恐怖', '深不见底的深渊', '时间在这一刻静止',
    '空气中弥漫着', '一股冷意', '一股寒意', '一丝冷笑', '一丝贪婪', '一丝恐惧',
    '像吞下一口熬焦的旧钱', '像在桌边推一盏不值钱的劣茶', '像死鱼睁着的眼珠'
  ];
  const hitAiPhrases = aiPhrases.filter(p => cleanText.includes(p));
  console.log(`  2. 有限词表命中: ${hitAiPhrases.length}处`);
  const firstPassScore = computeAiFlavorScore(draft.text, null);
  const secondPassScore = computeAiFlavorScore(cleanText, null);
  console.log(`  3. 本地检测参考分: ${firstPassScore.score} → ${secondPassScore.score}，不作通过标准`);
  console.log('  4. 因果、人物与阅读质感：待人工审阅，不以关键词判定');
  fs.writeFileSync(outJson, JSON.stringify({
    timestamp: new Date().toISOString(),
    genre: GENRE,
    route: ROUTE,
    charCount,
    durationMs,
    generationStatus: 'completed',
    endpoint: `${BASE_URL}/api/chat`,
    dataMode: syncStatus.mode,
    orchestration: 'script',
    localServerDetectorApplied: false,
    calls: (TWO_PASS ? [draft, final] : [draft]).map(call => ({
      startedAt: call.startedAt, completedAt: call.completedAt, streamSha256: call.streamSha256,
      usage: call.usage, billing: call.billing, rewriteEvents: call.rewriteEvents
    })),
    chapterSha256: createHash('sha256').update(cleanText).digest('hex'),
    checks: { overlap: inspectData, hitAiPhrases, firstPassScore, secondPassScore },
    literaryReview: 'pending_human_review'
  }, null, 2), { encoding: 'utf8', flag: 'wx' });

  console.log(`\n================================================================`);
  console.log(`✓ 成果已持久化: ${outMd}`);
  console.log(`================================================================\n`);
  
  // 打印前 600 字供快速审阅
  console.log('【正文先睹】');
  console.log(cleanText.slice(0, 600) + '...\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(err => {
    console.error('\n✗ 生成执行失败:', err.message);
    process.exitCode = 1;
  });
}
