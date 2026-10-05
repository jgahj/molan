'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { IsolationManager, CorpusQuotaManager } = require('../lib/composition/corpus/isolation-manager');
const { CheckpointManifest } = require('../lib/composition/corpus/checkpoint-manifest');
const { screenCandidateChapter, factorizeCandidateChapter, DIMENSION_KEYS } = require('../lib/composition/corpus/candidate-screener');
const { mineStrategiesFromFeatures } = require('../lib/composition/corpus/strategy-miner');
const { PackagePublisher } = require('../lib/composition/corpus/package-publisher');
const { CorpusBatchPipeline, discoverSourceBooks, splitChaptersFromText } = require('../lib/composition/corpus/batch-pipeline');
const { defaultEvidenceCatalog } = require('../lib/composition/corpus/evidence-catalog');

function createTempDir(prefix = 'molan-corpus-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('IsolationManager: 6 层隔离体系 (进程、数据库、文件、CPU、内存、配额)', async () => {
  const tmp = createTempDir();
  const manager = new IsolationManager({
    workers: 2,
    memoryCeilingMb: 128,
    outputDir: tmp,
    quotaOptions: { maxDailyTokens: 5000, offlineZeroCostMode: false }
  });

  // 1. 进程隔离检查
  process.env.MOLAN_IS_WEB_SERVER = '1';
  delete process.env.ALLOW_INPROCESS_CORPUS;
  assert.throws(() => manager.assertProcessIsolation(), /进程隔离违规/);
  delete process.env.MOLAN_IS_WEB_SERVER;

  // 2. 数据库隔离检查
  assert.throws(() => manager.assertDatabaseIsolation('/path/to/production.sqlite'), /数据库隔离违规/);
  assert.doesNotThrow(() => manager.assertDatabaseIsolation(path.join(tmp, 'staging.sqlite')));

  // 3. 文件只读流
  const dummyFile = path.join(tmp, 'readonly_sample.txt');
  fs.writeFileSync(dummyFile, '只读测试语料', 'utf8');
  const stream = manager.createReadOnlyStream(dummyFile);
  assert.ok(stream !== null);
  stream.destroy();

  // 4. CPU 隔离并发槽管理
  await manager.acquireWorkerSlot();
  await manager.acquireWorkerSlot();
  assert.equal(manager._activeWorkers, 2);
  manager.releaseWorkerSlot();
  assert.equal(manager._activeWorkers, 1);
  manager.releaseWorkerSlot();
  assert.equal(manager._activeWorkers, 0);

  // 5. 内存看门狗
  const memHealth = manager.checkMemoryHealth();
  assert.ok(typeof memHealth.heapUsedMb === 'number');

  // 6. API/LLM 配额隔离
  const quota = manager.getQuotaManager();
  assert.equal(quota.canConsume(1000), true);
  quota.consume(6000);
  assert.equal(quota.quotaExhausted, true);
  assert.equal(quota.canConsume(1000), false);
});

test('CheckpointManifest: 书目级独立检查点与断点续跑 (--resume)', () => {
  const tmp = createTempDir();
  const manifest = new CheckpointManifest({
    stagingRoot: tmp,
    runId: 'run_test_001'
  });

  const books = [
    { bookId: 'book_a', title: '剑破九天', category: '玄幻', filePath: '/a.txt' },
    { bookId: 'book_b', title: '暗夜密探', category: '悬疑', filePath: '/b.txt' }
  ];

  manifest.initOrResume({ books, resume: false });
  assert.equal(manifest.getPendingBooks().length, 2);

  // 模拟处理 book_a 完成
  manifest.markBookStart('book_a');
  manifest.markBookComplete('book_a', { lastChapter: 50, chaptersProcessed: 50, candidateChapters: 5 });

  assert.equal(manifest.isBookCompleted('book_a'), true);
  assert.equal(manifest.isBookCompleted('book_b'), false);
  assert.equal(manifest.getPendingBooks().length, 1);

  // 模拟进程重启并执行 --resume
  const resumeManifest = new CheckpointManifest({
    stagingRoot: tmp,
    runId: 'run_test_001'
  });
  resumeManifest.initOrResume({ books, resume: true });

  // book_a 仍然是完成状态，无缝跳过；仅需处理 book_b
  assert.equal(resumeManifest.isBookCompleted('book_a'), true);
  assert.equal(resumeManifest.getPendingBooks().length, 1);
  assert.equal(resumeManifest.getPendingBooks()[0].book_id, 'book_b');
});

test('CandidateScreener: 两阶段多目标分层初筛 (8 维非唯高爽初筛 + 深度正交因子化)', () => {
  // 1. 水文/短文拒绝
  const shortResult = screenCandidateChapter('太短了');
  assert.equal(shortResult.isCandidate, false);
  assert.ok(shortResult.rejectionReason.includes('字数过少'));

  // 2. 悬疑与物证异样优秀章节 (多目标：悬疑优秀、文风优秀)
  const suspenseText = `
长街更深，更夫铜锣声远去。
李巡俯身推开暗格，指尖在松木板底摸到半截蜡封古券。
古券边缘泛着诡异的焦黑，本该在八年前被焚毁的铸印，竟泛着新磨的青光。
“为何当年死在断魂谷的人，字迹会出现在这里？”李巡眼皮微抬，后背渗出细密冷汗。
他没有声张，将古券掩入衣襟，指骨暗自抵紧了袖中短刃。
窗外檐角水滴啪嗒作响，整座客栈死寂得不对劲。到底是谁在暗中算计？难道三年前那场血案，自始至终都是圈套？
  `.repeat(8);

  const suspenseScreener = screenCandidateChapter(suspenseText, { title: '暗夜密券' });
  assert.equal(suspenseScreener.isCandidate, true);
  assert.ok(suspenseScreener.qualifiedDimensions.includes('suspense') || suspenseScreener.qualifiedDimensions.includes('hook'));
  assert.ok(suspenseScreener.dimensionScores.suspense >= 0.65);

  // 3. 对候选章节执行第二阶段深度正交因子化
  const factors = factorizeCandidateChapter(suspenseText, {
    bookId: 'b_suspense_1',
    title: '暗夜密券',
    chapterNo: 12,
    genre: '悬疑灵异'
  }, suspenseScreener);

  assert.equal(factors.schemaVersion, 'chapter-features-v2');
  assert.ok(factors.focusVector !== undefined);
  assert.ok(factors.tailHook !== undefined);
  assert.ok(factors.stylometry.averageSentenceLength > 0);
  assert.equal(factors.bookId, 'b_suspense_1');
});

test('StrategyMiner & PackagePublisher: 策略挖掘、证据分级 (A/B级入库) 与原子版本发布', () => {
  const tmpStaging = createTempDir('molan-staging-');
  const runId = 'run_mining_001';
  const runDir = path.join(tmpStaging, runId);
  fs.mkdirSync(runDir, { recursive: true });

  // 模拟写入若干章节的 features
  const featuresFile = path.join(runDir, 'chapter-features.jsonl');
  const mockFeatures = [
    {
      bookId: 'book_1', novelTitle: '凡人传', chapterNo: 1, primaryGoal: 'conflict_push',
      screener: { qualifiedDimensions: ['thrill', 'plot'] }
    },
    {
      bookId: 'book_2', novelTitle: '仙逆行', chapterNo: 5, primaryGoal: 'dialogue_game',
      screener: { qualifiedDimensions: ['character', 'style'] }
    },
    {
      bookId: 'book_3', novelTitle: '大医无疆', chapterNo: 8, primaryGoal: 'info_reveal',
      screener: { qualifiedDimensions: ['suspense', 'hook'] }
    }
  ];
  fs.writeFileSync(featuresFile, mockFeatures.map(f => JSON.stringify(f)).join('\n') + '\n', 'utf8');

  // 写入占位清单
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ runId, booksTotal: 3 }), 'utf8');

  // 1. 执行策略规则挖掘与评级
  const mined = mineStrategiesFromFeatures({ runDir });
  assert.equal(mined.status || mined.qualityReport.status, 'passed');
  assert.ok(mined.acceptedCount >= 3);

  assert.ok(fs.existsSync(path.join(runDir, 'strategy-rules.jsonl')));
  assert.ok(fs.existsSync(path.join(runDir, 'archetypes.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'evidence.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'quality-report.json')));

  // 2. 执行原子发布
  const tmpTarget = createTempDir('molan-pub-');
  const publisher = new PackagePublisher({ targetBase: tmpTarget });
  const publishResult = publisher.publishRun(runDir, { version: 'v1.0.0' });

  assert.equal(publishResult.status, 'published');
  assert.equal(publishResult.version, 'v1.0.0');
  assert.ok(fs.existsSync(publishResult.activePointerFile));

  // 验证指针读取与 EvidenceCatalog 加载
  const active = publisher.getActivePackage();
  assert.equal(active.pointer.activeVersion, 'v1.0.0');

  const loadedCount = defaultEvidenceCatalog.loadFromPublishedPackage(active.pointer.packageDir);
  assert.ok(loadedCount >= 3);
});

test('CorpusBatchPipeline: 端到端离线批处理 CLI 流水线 (Extract -> Mining -> Publish)', async () => {
  const tmpCorpus = createTempDir('molan-mock-corpus-');
  const tmpStaging = createTempDir('molan-staging-runs-');

  // 构建模拟语料结构
  const xuanhuanDir = path.join(tmpCorpus, '传统玄幻');
  fs.mkdirSync(xuanhuanDir, { recursive: true });

  const book1File = path.join(xuanhuanDir, '凡人求道录.txt');
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

  const novelContent = `第1章 惊变\n${ch1Text}\n\n第2章 探秘\n${ch2Text}`;
  fs.writeFileSync(book1File, novelContent, 'utf8');

  // 初始化管线
  const pipeline = new CorpusBatchPipeline({
    sourceDir: tmpCorpus,
    stagingRoot: tmpStaging,
    workers: 2
  });

  // 1. Dry Run 验证
  const dryRunResult = await pipeline.runExtract({ dryRun: true });
  assert.equal(dryRunResult.mode, 'dry_run');
  assert.equal(dryRunResult.booksDiscovered, 1);

  // 2. 真实执行 Extract
  const extractResult = await pipeline.runExtract({ resume: false });
  assert.equal(extractResult.status, 'extract_completed');
  assert.ok(fs.existsSync(extractResult.featuresFile));

  // 3. 执行 Build Strategy
  const strategyResult = await pipeline.runBuildStrategy({ runId: extractResult.runId });
  assert.ok(strategyResult.acceptedCount >= 3);

  // 4. 执行 Quality Report
  const qualityReport = await pipeline.runQualityReport({ runId: extractResult.runId });
  assert.equal(qualityReport.status, 'passed');

  // 5. 执行 Publish
  const pub = await pipeline.runPublish({ runId: extractResult.runId });
  assert.equal(pub.status, 'published');
  assert.ok(pub.packageDir.includes(extractResult.runId));
});
