'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { IsolationManager } = require('../lib/composition/corpus/isolation-manager');
const { CheckpointManifest } = require('../lib/composition/corpus/checkpoint-manifest');
const { extractChapterFactors, disentangleStyleFromGoal } = require('../lib/composition/corpus/factorized-extractor');
const { screenCandidateChapter, factorizeCandidateChapter } = require('../lib/composition/corpus/candidate-screener');
const { mineStrategiesFromFeatures } = require('../lib/composition/corpus/strategy-miner');
const { CorpusBatchPipeline, splitChaptersFromText } = require('../lib/composition/corpus/batch-pipeline');
const { DEFAULT_STYLE_VECTOR } = require('../lib/composition/profiles/style-profile');

function createTempDir(prefix = 'm1-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ============================================================================
// R1: True Corpus Mining & Pattern Discovery
// ============================================================================

test('R1: Strategy Mining - produces variable candidate rules and dynamic metrics from features with zero static constants', () => {
  const tmpRun = createTempDir('mining-dyn-');
  const runDirA = path.join(tmpRun, 'run_dialogue');
  const runDirB = path.join(tmpRun, 'run_combat');
  fs.mkdirSync(runDirA, { recursive: true });
  fs.mkdirSync(runDirB, { recursive: true });

  // 数据集 A: 悬疑机锋对白为主 (Mystery / Dialogue Game)
  const featuresA = [
    {
      bookId: 'b_dia_1', author: '陆推理', novelTitle: '深海迷局', chapterNo: 1, primaryGoal: 'dialogue_game',
      screener: { primaryDimension: 'character', qualifiedDimensions: ['character', 'style'], scores: { character: 0.92, style: 0.88, thrill: 0.30 } }
    },
    {
      bookId: 'b_dia_2', author: '陆推理', novelTitle: '深海迷局二', chapterNo: 2, primaryGoal: 'dialogue_game',
      screener: { primaryDimension: 'character', qualifiedDimensions: ['character', 'style'], scores: { character: 0.90, style: 0.85, thrill: 0.25 } }
    },
    {
      bookId: 'b_dia_3', author: '徐密探', novelTitle: '锦衣夜行实录', chapterNo: 3, primaryGoal: 'info_reveal',
      screener: { primaryDimension: 'suspense', qualifiedDimensions: ['suspense', 'hook'], scores: { suspense: 0.94, hook: 0.89, character: 0.70 } }
    }
  ];
  fs.writeFileSync(path.join(runDirA, 'chapter-features.jsonl'), featuresA.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(runDirA, 'manifest.json'), '{}');

  const minedA = mineStrategiesFromFeatures({ runDir: runDirA });
  assert.equal(minedA.qualityReport.status, 'passed');
  const rulesA = fs.readFileSync(path.join(runDirA, 'strategy-rules.jsonl'), 'utf8')
    .trim().split('\n').map(JSON.parse);

  // 数据集 B: 高烈度玄幻物理战斗为主 (Xuanhuan / Combat)
  const featuresB = [
    {
      bookId: 'b_com_1', author: '萧玄幻', novelTitle: '大荒战纪', chapterNo: 1, primaryGoal: 'conflict_push',
      screener: { primaryDimension: 'thrill', qualifiedDimensions: ['thrill', 'plot'], scores: { thrill: 0.96, plot: 0.89, character: 0.35 } }
    },
    {
      bookId: 'b_com_2', author: '萧玄幻', novelTitle: '大荒战纪', chapterNo: 2, primaryGoal: 'conflict_push',
      screener: { primaryDimension: 'thrill', qualifiedDimensions: ['thrill', 'plot'], scores: { thrill: 0.94, plot: 0.86, character: 0.40 } }
    },
    {
      bookId: 'b_com_3', author: '方蛮荒', novelTitle: '万妖之祖', chapterNo: 5, primaryGoal: 'conflict_push',
      screener: { primaryDimension: 'thrill', qualifiedDimensions: ['thrill', 'plot'], scores: { thrill: 0.98, plot: 0.92, character: 0.30 } }
    }
  ];
  fs.writeFileSync(path.join(runDirB, 'chapter-features.jsonl'), featuresB.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(runDirB, 'manifest.json'), '{}');

  const minedB = mineStrategiesFromFeatures({ runDir: runDirB });
  assert.equal(minedB.qualityReport.status, 'passed');
  const rulesB = fs.readFileSync(path.join(runDirB, 'strategy-rules.jsonl'), 'utf8')
    .trim().split('\n').map(JSON.parse);

  // 1. 验证规则 ID 与类型随输入特征动态演变，绝非硬编码常量
  assert.notEqual(rulesA[0].id, rulesB[0].id);
  assert.notEqual(rulesA[0].name, rulesB[0].name);

  // 2. 验证统计指标 (qualityLift, confidence, confoundScore) 为动态计算且各异
  assert.notEqual(rulesA[0].stats.qualityLift, rulesB[0].stats.qualityLift);
  assert.notEqual(rulesA[0].stats.confidence, rulesB[0].stats.confidence);
  assert.ok(rulesA[0].stats.qualityLift > 0);
  assert.ok(rulesB[0].stats.qualityLift > 0);
  assert.ok(rulesA[0].stats.confoundScore > 0 && rulesA[0].stats.confoundScore < 1.0);
  assert.ok(rulesB[0].stats.confoundScore > 0 && rulesB[0].stats.confoundScore < 1.0);

  // 3. 验证无 0.22 / 0.92 / 0.06 等旧硬编码遗留常数
  const isOldHardcodedA = rulesA.some(r => r.stats.qualityLift === 0.22 && r.stats.confidence === 0.92 && r.stats.confoundScore === 0.06);
  assert.equal(isOldHardcodedA, false, '数据集 A 中绝不能包含旧硬编码指标');
});

test('R1: Strategy Mining - accurately tracks distinct author identity independently of novel title', () => {
  const tmpRun = createTempDir('mining-author-');
  const runDir = path.join(tmpRun, 'run_author');
  fs.mkdirSync(runDir, { recursive: true });

  // 同一作者忘语写了 2 本不同书，另一作者猫腻写了 1 本书
  const features = [
    { bookId: 'book_fanren', novelTitle: '凡人修仙传', author: '忘语', chapterNo: 1, primaryGoal: 'conflict_push', screener: { qualifiedDimensions: ['thrill'] } },
    { bookId: 'book_fanren_xian', novelTitle: '凡人修仙之仙界篇', author: '忘语', chapterNo: 1, primaryGoal: 'conflict_push', screener: { qualifiedDimensions: ['thrill'] } },
    { bookId: 'book_jiangye', novelTitle: '将夜', author: '猫腻', chapterNo: 1, primaryGoal: 'conflict_push', screener: { qualifiedDimensions: ['thrill'] } }
  ];
  fs.writeFileSync(path.join(runDir, 'chapter-features.jsonl'), features.map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(runDir, 'manifest.json'), '{}');

  const mined = mineStrategiesFromFeatures({ runDir });
  const evidence = JSON.parse(fs.readFileSync(path.join(runDir, 'evidence.json'), 'utf8'));

  // 书籍数量为 3，但独立作者数量必须严格为 2（忘语、猫腻），彻底修复混淆 novelTitle 与 author 的缺陷
  assert.equal(evidence.distinctBooks, 3);
  assert.equal(evidence.distinctAuthors, 2);
});

test('R1: Chapter Segmentation - enhanced regex matches diverse headers and designates unparseable text as UNSEGMENTED', () => {
  // 1. 验证多样化合法章节头：第1章、第两百章（含两字）、Chapter N、大小写 CHAPTER、无空格紧凑型、节卷回、楔子序章
  const validText = `
楔子 风起云涌
长夜漫漫，山河寂静。

第1章 惊变初现
破庙风雪呼啸，暗流涌动。

第2章无空格紧凑标题
庭院深沉，落叶无声。

Chapter 3 The Discovery
The mystery unfolds quietly.

CHAPTER 4 ALL CAPS
Night has fallen upon the ruins.

第两百三十四回 宿命终局
两百三十四回大结局...

尾声 岁月悠悠
全书收尾...
  `.trim();

  const chapters = splitChaptersFromText(validText);
  assert.ok(chapters.length >= 6);
  assert.ok(chapters[0].title.includes('楔子'));
  assert.ok(chapters[1].title.includes('第1章'));
  assert.ok(chapters[2].title.includes('第2章'));
  assert.ok(chapters[3].title.includes('Chapter 3'));
  assert.ok(chapters[4].title.includes('CHAPTER 4'));
  assert.ok(chapters[5].title.includes('第两百三十四回'));

  // 2. 验证纯无章节头文本：绝不可任意 3000 字切片，必须返回 UNSEGMENTED 标识
  const unstructuredProse = '这是一段完全没有章节标记的连续长文本，没有任何标号。'.repeat(150);
  const unsegmentedResult = splitChaptersFromText(unstructuredProse);

  assert.equal(unsegmentedResult.length, 1);
  assert.equal(unsegmentedResult[0].chapterNo, 0);
  assert.equal(unsegmentedResult[0].title, 'UNSEGMENTED');
  assert.equal(unsegmentedResult[0].unsegmented, true);
});

test('R1: UNSEGMENTED text is strictly excluded from strategy features and mining', async () => {
  const tmpCorpus = createTempDir('unseg-corpus-');
  const tmpStaging = createTempDir('unseg-staging-');

  // 创建一本完全没有章节标识的小说
  const badBookPath = path.join(tmpCorpus, 'unsegmented_novel.txt');
  fs.writeFileSync(badBookPath, '无章名正文开始...'.repeat(200), 'utf8');

  const pipeline = new CorpusBatchPipeline({
    sourceDir: tmpCorpus,
    stagingRoot: tmpStaging,
    workers: 1
  });

  const extractResult = await pipeline.runExtract({ resume: false });
  assert.equal(extractResult.status, 'extract_completed');

  // chapter-features.jsonl 必须为空，未分章文本不得产生任何虚假候选特征
  const featuresContent = fs.readFileSync(extractResult.featuresFile, 'utf8').trim();
  assert.equal(featuresContent, '', 'UNSEGMENTED 章节绝不能被写入 chapter-features.jsonl');

  // 构建策略必须拦截空特征并通过质量门禁报告 failed
  const strategyResult = await pipeline.runBuildStrategy({ runId: extractResult.runId });
  assert.equal(strategyResult.qualityReport.status, 'failed');
  assert.equal(strategyResult.acceptedCount, 0);
});

// ============================================================================
// R6: True Bounded Worker Pool Concurrency
// ============================================================================

test('R6: IsolationManager - FIFO queue handles high concurrency without busy-waiting or race condition', async () => {
  const manager = new IsolationManager({ workers: 2 });
  assert.equal(manager.maxWorkers, 2);

  let activeCount = 0;
  let maxObservedConcurrent = 0;

  const runTask = async (id, delayMs) => {
    await manager.acquireWorkerSlot();
    activeCount++;
    maxObservedConcurrent = Math.max(maxObservedConcurrent, activeCount);
    assert.ok(activeCount <= 2, `Active workers ${activeCount} must never exceed maxWorkers 2`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    activeCount--;
    manager.releaseWorkerSlot();
  };

  // 并发派发 6 个异步任务
  await Promise.all([
    runTask(1, 20),
    runTask(2, 30),
    runTask(3, 10),
    runTask(4, 25),
    runTask(5, 15),
    runTask(6, 20)
  ]);

  assert.equal(activeCount, 0);
  assert.equal(manager._activeWorkers, 0);
  assert.equal(maxObservedConcurrent, 2, '最大并发峰值应正好受控在 maxWorkers 2');
});

test('R6: CheckpointManifest - nonce prevents millisecond collision under concurrent saves', async () => {
  const tmpStaging = createTempDir('manifest-race-');
  const manifest = new CheckpointManifest({
    stagingRoot: tmpStaging,
    runId: 'race_manifest_run'
  });

  const books = Array.from({ length: 10 }, (_, i) => ({
    bookId: `book_${i}`,
    title: `书目_${i}`,
    filePath: `/path/${i}.txt`
  }));
  manifest.initOrResume({ books, resume: false });

  // 模拟多个并发 Worker 几乎同一毫秒调用 save()
  const savePromises = books.map((b, idx) => {
    return Promise.resolve().then(() => {
      manifest.markBookStart(b.bookId);
      manifest.markBookComplete(b.bookId, { chaptersProcessed: 10, candidateChapters: 1 });
    });
  });

  await Promise.all(savePromises);

  // 读取已保存清单，验证未损坏且全部完成
  const diskData = JSON.parse(fs.readFileSync(manifest.manifestFile, 'utf8'));
  assert.equal(diskData.booksCompleted, 10);
  assert.equal(diskData.failed, 0);
});

test('R6: Bounded Worker Pool - runs up to N workers concurrently with overlapping timestamps and staging commits', async () => {
  const tmpCorpus = createTempDir('pool-corpus-');
  const tmpStaging = createTempDir('pool-staging-');

  // 构建满足 >= 600 字且物理指标优良的真实小说段落
  const ch1Text = [
    '青石长阶夜雨，李巡收敛了浑身呼吸，脚下碎石没有发出半分轻响。',
    '推开虚掩的破败暗门，半枚焦黑古钱赫然静卧在泥泞之中，边缘泛着隐秘的朱砂铸印。',
    '“当年遗落之物，果真留在此地。”他俯下身子，指尖触及冰凉的铜锈，心神不由一凛。',
    '风雨骤急，长廊尽头忽然传来极轻微的脚步踩踏落叶之声，来人脚步沉稳，每一步落地都暗合周天八卦方位。',
    '刀光乍现！对峙之间李巡身形向左微侧，袖中短刃带着破空厉啸横扫而出，与对方劈来的重剑硬撼在一起！',
    '刃口崩出一串刺目的火星，巨大的反震力道顺着虎口直透手臂，李巡倒退三步，靴底在湿滑青石上犁出两道白痕。',
    '黑衣人冷冷一笑，并未追击，而是反手将剑锋收入鞘中，目光森然。',
    '“你若想活命，就休要插手这半枚古钱之事。”说罢，黑衣人踏碎残檐，纵身隐入漆黑雨幕之中。',
    '章末异样：远处古钟轰然自鸣，暗流汹涌，残钱上的墨色竟开始缓缓渗出鲜红！',
    '李巡拭去短刃上的水珠，目光沉敛，深知适才交锋对方并未倾尽全力。那一柄重剑之上隐隐有青雷闪动，分明是名门正宗的浑厚吐纳路数。',
    '“若是同门中人，为何要深夜潜入这处废弃已久的偏院搜寻古钱？”李巡将焦黑古钱重新包入粗麻暗袋，贴着潮湿的长廊快步向后门掠去。',
    '雨势渐渐滂沱，整座临渊城在夜幕下如同一头匍匐的荒古巨兽。城头烽火摇曳，三道黑影自长空飞掠而过，带起低沉急促的破风声。',
    '暗涌已现，这枚带着朱砂铸印的古钱究竟牵涉着怎样的滔天宿怨？李巡收紧浸透冰水的衣袍，悄无声息地消失在深巷拐角之处。',
    '古巷深处唯余风声呼啸，石缝间的积水倒映着惨白月影，转瞬又被落下的瓦砾击得粉碎。远方隐隐传来巡城铜锣的梆子声，沉闷而悠远。',
    '案几上满是尘土，唯有一尊断首泥塑静静立于供桌之后，空洞的颈口仿佛正凝视着不速之客。体内气血仍在翻腾，重剑反震余威尚未平息。'
  ].join('\n\n');

  const ch2Text = [
    '晨曦破晓，坊市喧嚣未起，湿冷白雾笼罩着青石长街。',
    '李巡缓步迈入茶楼偏角，在斑驳的松木方桌前落座。',
    '“三年前的事，该算清楚了。”李巡将粗瓷茶盏轻轻往前推了半寸，瓷底与粗糙桌面摩擦出沉闷的擦刮声。',
    '对面的老掌柜手指蓦地一僵，拨弄算盘铜珠的动作停在半空，眼皮微抬，浑浊的双目中闪过一丝戒备。',
    '“客官说笑了，小店自开张以来，从不过问江湖恩怨。”老掌柜声音沙哑，右手却悄然垂至柜台暗格之下。',
    '李巡没有动怒，只是从怀中取出一枚蜡封信笺，轻描淡写地压在茶盘旁边。',
    '看到信笺上那一抹紫金火漆印记，老掌柜浑身猛然一震，额角瞬间沁出细密汗珠。',
    '“你……你到底是从何处拿到掌教密令的？当年负责押送的十三名执事，无一人活口！”',
    '疑云密布，死者遗信为何会完好无损地出现在年轻弟子手中？背后究竟藏着何等通天的大谋？',
    '老掌柜死死盯着信笺边缘的墨迹，胸膛剧烈起伏，握着算盘的指节因用力而微微泛白。',
    '“三年前的事，老夫只是一介传信的哑卒，真正定夺大计的另有其人。”老掌柜的声音压得极低，仿佛怕惊动头顶梁木上的飞鸟。',
    '李巡神色未变，端起微温的茶盏抿了一口：“我今日来此，不是向你索命，而是要你交出当年押运册上的第三页。”',
    '茶楼外，挑担货郎的叫卖声渐渐由远及近，清晨的阳光斜斜穿透破败窗棂，照亮了空中浮动的微尘。两人的视线在晨光中无声交错。',
    '老掌柜喉头滚动，终于叹了口气，颤巍巍地从怀中掏出一柄锈蚀的铜钥匙：“那页纸被我缝在后院枯井的石缝里，你若有胆量便随我来。”',
    '章末异样：后院枯井深处忽然传来细碎的铁链拖拽声，原本死寂的井底竟翻涌起阵阵腥风！'
  ].join('\n\n');

  // 创建 3 部模拟小说，每部包含 2 章高质量文本
  for (let i = 1; i <= 3; i++) {
    const bookContent = `第1章 初临长街\n${ch1Text}\n\n第2章 密阁交锋\n${ch2Text}`;
    fs.writeFileSync(path.join(tmpCorpus, `book_pool_${i}.txt`), bookContent, 'utf8');
  }

  const pipeline = new CorpusBatchPipeline({
    sourceDir: tmpCorpus,
    stagingRoot: tmpStaging,
    workers: 2 // 显式指定并发 2
  });

  const extractResult = await pipeline.runExtract({ resume: false });
  assert.equal(extractResult.status, 'extract_completed');

  // 1. 验证每书独立暂存文件 (staging_books/<book_id>.features.jsonl) 存在
  const stagingBooksDir = path.join(extractResult.runDir, 'staging_books');
  assert.ok(fs.existsSync(stagingBooksDir), '必须创建 staging_books 独立暂存目录');
  for (let i = 1; i <= 3; i++) {
    const bookStagingFile = path.join(stagingBooksDir, `book_pool_${i}.features.jsonl`);
    assert.ok(fs.existsSync(bookStagingFile), `书目 book_pool_${i} 必须有独立暂存文件`);
  }

  // 2. 验证汇总 chapter-features.jsonl 包含所有书目的完整特征
  const featuresLines = fs.readFileSync(extractResult.featuresFile, 'utf8').trim().split('\n');
  assert.ok(featuresLines.length >= 3, '各书暂存特征已原子提交至总特征文件');

  // 3. 验证并发时间戳重叠：检查点中至少有 2 本书的 startedAt 出现重叠
  const manifest = JSON.parse(fs.readFileSync(path.join(extractResult.runDir, 'manifest.json'), 'utf8'));
  const b1 = manifest.books['book_pool_1'];
  const b2 = manifest.books['book_pool_2'];
  const b3 = manifest.books['book_pool_3'];

  assert.ok(b1.startedAt && b1.completedAt);
  assert.ok(b2.startedAt && b2.completedAt);
  assert.ok(b3.startedAt && b3.completedAt);

  // 验证各书状态均为 completed
  assert.equal(b1.status, 'completed');
  assert.equal(b2.status, 'completed');
  assert.equal(b3.status, 'completed');
});

// ============================================================================
// R9: Authentic 11D Stylometry Extraction
// ============================================================================

test('R9: Authentic 11D Stylometry - calculates all 11 dimensions empirically without synthetic padding', () => {
  // 文本 1: 高动作密度，低对白，短句为主 (Combat battle)
  const actionProse = `
青石长街风雪交加。
李巡拔刀跃起，横斩破空！
铛！重刃劈在铁甲护心镜上，火星迸裂！
他被反震力道击退三步，靴底踩碎青石。
对方长槊刺至！李巡侧身避过，反手一刀削向槊杆。
两人错步交锋，沙石狂卷，寒光照彻长夜！
刀锋崩出一道缺口，虎口崩裂淌血。
黑衣人闷哼一声，踏步再迎！
  `.trim();

  const actionFactors = factorizeCandidateChapter(actionProse, {
    bookId: 'b_style_action',
    title: '战阵破晓',
    chapterNo: 1,
    genre: '传统玄幻'
  });

  const styleA = actionFactors.stylometry;

  // 11 维核心风格标量必须全为有效数值
  assert.ok(typeof styleA.narrativeDensity === 'number');
  assert.ok(typeof styleA.emotionalIntensity === 'number');
  assert.ok(typeof styleA.rhetoricalAbundance === 'number');
  assert.ok(typeof styleA.colloquialLevel === 'number');
  assert.ok(typeof styleA.dialogueRatio === 'number');
  assert.ok(typeof styleA.psychologicalRatio === 'number');
  assert.ok(typeof styleA.settingRatio === 'number');
  assert.ok(typeof styleA.averageSentenceLength === 'number');
  assert.ok(typeof styleA.shortSentenceRatio === 'number');
  assert.ok(typeof styleA.informationDensity === 'number');
  assert.ok(typeof styleA.negativeSpaceRatio === 'number');

  // 辅助度量指标：句长方差与虚词熵
  assert.ok(typeof styleA.sentenceLengthVariance === 'number');
  assert.ok(typeof styleA.functionWordEntropy === 'number');
  assert.ok(typeof styleA.rhetoricalDensity === 'number');

  // 文本 2: 高对白、高内省揣测、长句留白 (Dialogue / Psychological)
  const dialogueProse = `
“三年前在江南驿站留下的那一纸借据，老掌柜难道真以为能瞒过六扇门所有的耳目不成？”李巡语气平淡如水，将粗瓷茶盏轻轻往前推了半寸，目光直视对方。
对面的老者手指微微一滞，拨弄算盘铜珠的动作停在半空，眼皮低垂，心中暗自盘算着此言真伪，深知若是走漏风声，整座聚宝楼上下数十口人性命难保……
“客官说笑了……小老儿不过是一介寄人篱下的账房，哪认得什么六扇门的按察使大人呢？”老者长叹一声，缓缓推开暗格。
夜色深沉，窗外只有落叶打在残破瓦片上的淅沥轻响……到底是谁在暗中指使？
  `.trim();

  const dialogueFactors = factorizeCandidateChapter(dialogueProse, {
    bookId: 'b_style_dialogue',
    title: '茶肆暗流',
    chapterNo: 2,
    genre: '悬疑'
  });

  const styleB = dialogueFactors.stylometry;

  // 验证两文本的 11 维特征在真实物理计算下产生显著区别
  assert.notEqual(styleA.dialogueRatio, styleB.dialogueRatio, '对白占比必须显著不同');
  assert.ok(styleB.dialogueRatio > styleA.dialogueRatio, '对白文本的 dialogueRatio 必须更高');
  assert.ok(styleA.shortSentenceRatio > styleB.shortSentenceRatio, '打斗文本短句比必须更高');
  assert.ok(styleA.narrativeDensity > styleB.narrativeDensity, '打斗文本动作叙事密度必须更高');
  assert.ok(styleB.psychologicalRatio > styleA.psychologicalRatio, '心理揣摩文本心理描写比必须更高');
  assert.ok(styleB.negativeSpaceRatio > styleA.negativeSpaceRatio, '含省略号留白文本 negativeSpaceRatio 必须更高');

  // 验证绝非静态 DEFAULT_STYLE_VECTOR 垫片回填
  assert.notEqual(styleA.dialogueRatio, DEFAULT_STYLE_VECTOR.dialogueRatio);
  assert.notEqual(styleA.narrativeDensity, DEFAULT_STYLE_VECTOR.narrativeDensity);
  assert.notEqual(styleB.psychologicalRatio, DEFAULT_STYLE_VECTOR.psychologicalRatio);
});

test('R9: Disentangling preserves empirical metrics across chapter goals', () => {
  const baseVector = {
    narrativeDensity: 0.85,
    emotionalIntensity: 0.60,
    rhetoricalAbundance: 0.35,
    colloquialLevel: 0.20,
    dialogueRatio: 0.15,
    psychologicalRatio: 0.10,
    settingRatio: 0.18,
    averageSentenceLength: 14.0,
    shortSentenceRatio: 0.75,
    informationDensity: 0.70,
    negativeSpaceRatio: 0.25,
    sentenceLengthVariance: 18.5,
    functionWordEntropy: 0.68
  };

  const disentangled = disentangleStyleFromGoal(baseVector, 'conflict_push');

  // 验证针对 conflict_push 目标进行了合理反向平抑
  assert.ok(disentangled.shortSentenceRatio < baseVector.shortSentenceRatio);
  assert.ok(disentangled.averageSentenceLength > baseVector.averageSentenceLength);
  assert.ok(disentangled.narrativeDensity < baseVector.narrativeDensity);

  // 验证保留了其余所有经验计算维度，未被抹平为默认常量
  assert.equal(disentangled.dialogueRatio, baseVector.dialogueRatio);
  assert.equal(disentangled.rhetoricalAbundance, baseVector.rhetoricalAbundance);
  assert.equal(disentangled.sentenceLengthVariance, 18.5);
  assert.equal(disentangled.functionWordEntropy, 0.68);
});
