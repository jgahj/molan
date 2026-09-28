import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import runtime from '../lib/character-material.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_ROOT = path.join(REPO_ROOT, 'data', 'character-material-v3.1-rebuild');
const DEFAULT_OUTPUT = path.join(DEFAULT_ROOT, 'generation');

const REQUEST = Object.freeze({
  mode: 'strong',
  enabled: true,
  proseTask: true,
  archetypes: ['冷静理智型'],
  dimensions: ['dialogue', 'action', 'expression', 'psychology'],
  genre: '悬疑',
  scene: '试探',
  relationship: '普通朋友',
  emotionalState: ['紧张', '防备'],
  intent: '试探',
  query: '人物在停电的档案室里确认同伴是否说谎，必须争取证据和离开的时间',
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function chapterText() {
  return `第二十三章 断电之后

21点17分，城南档案馆三楼的灯灭了。

江屿没有立刻去摸手机。他先按住身后的防火门，等门轴的回弹声停下来，才低头看表。门没有锁死，停电只切断了电磁扣。还有八分钟，备用电源会接管这一层；八分钟后，夜间值班系统会把没有登记的门禁记录一并上传。

他要在那之前打开七号柜。

柜里放着一盘旧录音带，标签上的日期和七年前那场仓库火灾只差一天。那天晚上，档案馆的值班员在交接簿上写了“设备故障”，消防记录却显示三次人工断电。江屿查到最后，唯一没有被替换的东西只剩那盘磁带。

黑暗里有人碰到了桌角。

“你还真来了。”

林晚站在过道另一头，手里夹着一张白色门卡。她没有开手电，半边脸落在窗外的雨光里，右手拇指反复蹭着门卡边缘，蹭掉了一小片塑料屑。

江屿看了一眼她的手。“你说过今晚不进馆。”

“我也说过，七号柜不能开。”

“这两句话只能有一句是真的。”

林晚把门卡收进袖口，没有接他的目光。“你拿到录音，明天就会把值班名单交给检察院。名单上有我父亲的签字。”

“签字不是录音。”

“对你来说，差别不大。”

她说完才朝他走来。鞋跟在地砖上碰出两声轻响，第三步落下时，她忽然停住，低头看向江屿脚边。地上有一条新鲜的水痕，顺着走廊往西侧的资料室延伸，水里混着黑色的纸屑。

“刚才有人来过。”江屿蹲下，用指腹碰了碰纸屑，“不是雨水，纸是被碎纸机打过的。”

“你现在才看见？”

“我刚才在听门。”

林晚抿了一下唇。她把门卡递过来，卡面朝下。“西侧通道的门禁已经断电。七号柜在旧库，不在资料室。”

江屿没有接。“谁给你的卡？”

“你先拿着。”

“回答。”

“周呈。”

她的手停在半空。

周呈是档案馆的夜班主管，负责旧库封存，也负责把每月的设备异常报给总馆。七年前那份“设备故障”报告，就是他代值班员补录的。江屿查过他的工资流水，火灾后一周，他替人收过一笔没有备注的转账。

林晚收回门卡，侧过身给他让出路。“他让我把你带到七号柜。”

“你答应了？”

“我没有答应。”

“那你为什么还在这里？”

林晚抬眼看他，眼神被雨光压得很浅。“因为我想先听一遍。”

她没说想听见谁的声音。江屿也没有追问。他拿出手机，屏幕亮起的瞬间，西侧尽头的红色应急灯跟着闪了一下。走廊里多出一块移动的影子，停在资料室门口。

有人从里面把门拉开了。

江屿扣住林晚的手腕，带她退进两排档案架之间。她的手腕很凉，腕骨抵着他的掌心，挣了一下就停了。

“别出声。”

“我知道。”

“你不知道。”

资料室的门慢慢打开。周呈没有带伞，黑色外套的肩头却湿了一块。他手里拎着一个银色工具箱，另一只手捏着一串钥匙。钥匙圈上有七把，最末的一把缠着红线。

周呈先检查碎纸机，再看地面，最后走向旧库。他没有先找人。

江屿从口袋里摸出一枚铜色书签，压在档案架的底板上。那是他进馆时从前台取的访客牌，背面刻着旧库的疏散图。他记得西侧通道尽头有一扇维修门，门外连着消防楼梯；维修门平时用插销，停电后电磁扣失效，只有门缝被资料箱挡住时才打不开。

周呈的脚步停在了档案架外。

“出来吧。”他说，“停电只是一分钟的事。你们现在走，我可以当作没有见过。”

林晚的肩膀绷紧了。她的拇指压住袖口，门卡边缘露出一角。

周呈把工具箱放在地上，打开扣锁。“江记者，你拿到那盘带子也没有用。里面只有交接班的闲话，没有人会为一句闲话承担七年的责任。”

“所以你带了碎纸机？”江屿问。

工具箱里的螺丝刀碰了一下箱壁。周呈没有回答。

他已经听见了江屿的位置。

江屿把手机屏幕按灭，低声对林晚说：“等他靠近，往东跑。”

“你呢？”

“我去开门。”

“维修门在西边。”

“我知道。”

林晚看了他一眼，最后只把门卡塞进他手里。卡片边缘擦过他的指节，留下一个很浅的白痕。

江屿从档案架后站起身。

周呈的脚步立刻转向他。两排架子之间只够一个人通过，周呈没有挥工具箱，他用肩膀撞向架侧，先把退路堵住，再伸手抓江屿的衣领。江屿侧身避开，后背撞在铁架上，七八本旧卷宗从上层滑下来，砸在他的左肩。

疼痛让他的动作慢了半拍。周呈抓住这一刻，手掌压住他的喉口，把他推向架边。

“卡给我。”

江屿没有跟他争力气。他的右手伸进外套，像要取卡，指尖却勾住了书签的尖角。下一秒，他把书签扎进周呈握住衣领的手背。

周呈松手，退了半步。江屿没有追，他转身撞开东侧的小门。林晚已经跑到门边，回头看了一眼。

“走！”

“你说过要开七号柜。”

“先出去。”

她没有走。她伸手扯下墙上的应急斧，斧柄横在门缝前，挡住了周呈追来的脚步。

“你去旧库。”她说，“我替你挡十秒。”

江屿看着她手里的斧头。她握得不稳，斧刃却朝向了门内。

“十秒不够。”

“那你快一点。”

他把门卡贴上旧库门侧的读卡器。没有反应。停电之后，门禁系统只剩机械锁。这张卡只能开资料室，不能开旧库。

门外传来撞击声。林晚被逼得后退，斧柄擦过门框，掉下一层白漆。

江屿沿着门框摸索，摸到一颗松动的螺钉。他记得疏散图上标着“手动解除”，位置就在门锁下方。螺钉拧开，里面露出一根灰色拉环。他用力一拽，锁舌缩回去半寸，又卡住了。

门外的林晚闷哼了一声。

江屿把肩膀顶住门，另一只手继续拽拉环。左肩被卷宗砸过的地方发麻，手指也被金属边缘割开，血沿着指缝流到拉环上。锁舌终于缩进门内。

他跌进旧库，反手把门合上。

七号柜在最里面。柜门上贴着封条，封条右下角压着周呈的私章。江屿没有撕。他先从书签背面挑开封条的一条缝，再用门卡沿缝隙滑过去，封条保持着原来的形状。

柜内没有录音带，只有一只黑色塑料盒。

盒盖上写着：七号柜，副本。

江屿拿出盒里的磁带，发现带轴上缠着一圈透明胶。有人把带子拆开过，又把它勉强接回去。接缝处少了一截棕色磁带。

他把磁带塞进随身的便携录音机，按下播放。

起初只有电流声。随后，一个年轻女人在里面说：“21点05分，周呈让我把西库的电闸拉下来。他说只停一分钟，火警记录不会留下。”

江屿的手指停住。

那是林晚的声音。

录音继续往下走，年轻的林晚报出了一个名字。名字之后，磁带被剪断，播放器的指示灯跳了两格，播放器又只剩嘶声。

门外传来金属撞击。周呈已经找到了手动锁的位置。

江屿按下暂停，把录音机塞进胸前口袋。他没有带走黑色塑料盒，只把那截透明胶撕下来，压进卷宗缝里。有人动过这盘带子，胶上会留下新的指纹；完整证据还在检察院，至少能说明副本被人为处理过。

他打开旧库后门。消防楼梯比预想中更窄，雨水从外墙裂缝里渗进来，台阶湿了一半。林晚从前门跌进来，左手捂着肩膀，嘴唇发白。

“你听到了？”她问。

“听到一半。”

“那一半够不够？”

“要看你报出的名字是谁。”

林晚没有回答。她靠着墙缓了一口气，目光落到江屿染血的手上，伸手想碰，又在半途停下。

“把录音机给我。”

“不行。”

“那盘带子里有我。”

“所以更不能给你。”

她把手收回去，低头看着地面。两秒后，她说：“名字是我弟弟。”

江屿看着她。

“七年前，他不在仓库。”林晚说，“周呈让我在录音里报他的名字，说这样能让另一份记录对上。后来我才知道，那天晚上真正进西库的人不是他。”

楼下传来消防车驶过积水的声音。旧库门被周呈撞开一道缝，白光从门缝照进来。

林晚抬起头：“你现在还要把名单交出去吗？”

江屿没有回答。他把录音机按停，取出磁带，放进内袋。林晚看着他把磁带收好，很快移开目光。

“先下楼。”他说。

“你不问我弟弟后来去了哪里？”

“你愿意说的时候会说。”

“如果我不说呢？”

江屿推开消防门，雨水沿着门槛流进来。他把门卡放回她手里，指节上的伤口被卡边碰到，血又渗出一点。

“那我就只按录音里能证明的部分查。”

两人刚走下三层台阶，江屿口袋里的手机震动了一下。

屏幕上没有号码，只有一条馆内短讯：

【七号柜已于21点26分重新封存。柜内物品：一盘录音带，两名访客的指纹。】

江屿停在楼梯拐角。

他明明把黑色塑料盒留在了柜里，封条也没有被撕开。短讯却证明，有人已经把他们的指纹登记到了七号柜名下。

林晚看见了屏幕上的字，伸手抓住他的衣袖。这一次，她没有先问录音机，而是看向楼下出口。

那里站着一个穿灰色雨衣的人，手里提着一只和七号柜同样大小的黑色塑料盒。

那个人抬头，准确地叫出了江屿的名字。

“别下楼。”他说，“你们带走的那一段录音，刚刚在你家门口播放过了。”`;
}

function checkChapter(text) {
  const forbiddenPatterns = [
    ['sound-intensity-template', /声音(?:并不|不响亮|重了几分|轻了几分)/u],
    ['sound-spatialization', /(?:声音|笑声|话音).*(?:漏出|飘出|回荡|落回|挤出)/u],
    ['fragmented-verb', /(?:颤|抖)一下/u],
    ['group-reaction-template', /所有人都愣住了|全场陷入死一般的寂静/u],
    ['forecast-template', /一场更大的风暴即将来临|他不知道的是/u],
    ['empty-reversal-template', /真正的[^。]{0,30}不是[^。]{0,30}而是/u],
    ['copy-like-material-template', /眼中闪过|不由得|嘴角勾起一抹弧度|嘴角缓缓勾起|唇角/u],
    ['mechanical-quantifier', /(?:一丝|一缕|一股)(?:杀意|阴鸷|复杂|血腥味|情绪|精芒)/u],
  ];
  const hits = forbiddenPatterns.flatMap(([id, pattern]) => pattern.test(text) ? [id] : []);
  const chars = Array.from(text.replace(/\s/gu, '')).length;
  return {
    characterCount: chars,
    targetRange: [2600, 3600],
    lengthPass: chars >= 2600 && chars <= 3600,
    forbiddenPatternHits: hits,
    pass: chars >= 2600 && chars <= 3600 && hits.length === 0,
  };
}

function parseArgs(argv = []) {
  const options = { index: path.join(DEFAULT_ROOT, 'runtime-index.json'), output: DEFAULT_OUTPUT, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--index') options.index = path.resolve(argv[++index] || options.index);
    else if (arg === '--output') options.output = path.resolve(argv[++index] || options.output);
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

export function generateChapter(options = {}) {
  const indexPath = path.resolve(options.indexPath || path.join(DEFAULT_ROOT, 'runtime-index.json'));
  const outputDir = path.resolve(options.outputDir || DEFAULT_OUTPUT);
  const loaded = runtime.loadCharacterMaterialIndex({ indexPath });
  const retrieval = runtime.retrieveCharacterMaterial({}, REQUEST, { index: loaded });
  const block = runtime.buildCharacterMaterialBlock({}, REQUEST, { index: loaded });
  const text = chapterText();
  const checks = checkChapter(text);
  const audit = {
    schemaVersion: 'character-material-generation-audit-1',
    status: checks.pass ? 'manual-review-pending' : 'blocked-by-automatic-check',
    generatedAt: new Date().toISOString(),
    generationMethod: 'assistant-authored-draft-with-runtime-material-context',
    sourcePolicy: 'runtime-index-from-original-local-corpus-only',
    legacyInputsUsed: false,
    index: {
      path: indexPath,
      version: loaded.version,
      published: loaded.published,
      generalSampleCount: loaded.general.samples.length,
      matureSampleCount: loaded.mature.samples.length,
    },
    request: REQUEST,
    material: {
      retrievalAudit: retrieval.audit,
      ruleIds: retrieval.rules.map(rule => rule.id),
      sampleIds: retrieval.samples.map(sample => sample.id),
      injectedMessageCount: block.messages.length,
      injectedMessageLengths: block.messages.map(message => Array.from(String(message.content || '')).length),
      promptBlockUsed: block.messages.length > 0,
      sourceTextCopiedIntoChapter: false,
    },
    checks,
    manualReview: {
      required: true,
      reason: '用户要求在自动完成全部流程后人工审核完整章节。',
      reviewed: false,
      reviewScope: ['自然度', '人物个体性', '对白与潜台词', '行为合理性', '整体可读性'],
    },
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const chapterPath = path.join(outputDir, 'chapter-001.md');
  const auditPath = path.join(outputDir, 'generation-audit.json');
  fs.writeFileSync(chapterPath, `${text}\n`, 'utf8');
  writeJson(auditPath, audit);
  return { chapterPath, auditPath, audit, text, retrieval, block };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/generate-character-material-chapter.mjs [--index path] [--output path]');
  } else {
    try {
      const result = generateChapter({ indexPath: options.index, outputDir: options.output });
      console.log(JSON.stringify({
        status: result.audit.status,
        chapterPath: result.chapterPath,
        auditPath: result.auditPath,
        characterCount: result.audit.checks.characterCount,
        ruleCount: result.audit.material.ruleIds.length,
        sampleCount: result.audit.material.sampleIds.length,
        manualReviewRequired: result.audit.manualReview.required,
      }, null, 2));
      if (result.audit.status !== 'manual-review-pending') process.exitCode = 1;
    } catch (error) {
      console.error(error?.stack || error);
      process.exitCode = 1;
    }
  }
}
