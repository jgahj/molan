'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../lib/genre-engine');
const http = require('node:http');

test('48题材到8大母类的智能归属推断', () => {
  assert.equal(engine.resolveFamilyForGenre('都市高武').id, 'urban_martial');
  assert.equal(engine.resolveFamilyForGenre('科幻末世').id, 'scifi_apocalypse');
  assert.equal(engine.resolveFamilyForGenre('悬疑灵异').id, 'suspense');
  assert.equal(engine.resolveFamilyForGenre('历史古代').id, 'history');
  assert.equal(engine.resolveFamilyForGenre('西方奇幻').id, 'western_fantasy');
  assert.equal(engine.resolveFamilyForGenre('古风世情').id, 'ancient_romance');
  assert.equal(engine.resolveFamilyForGenre('豪门总裁').id, 'modern_romance');
  assert.equal(engine.resolveFamilyForGenre('传统玄幻').id, 'xuanhuan');
  assert.equal(engine.resolveFamilyForGenre('未知冷门题材').id, 'xuanhuan'); // 兜底
});

test('各题材叙事路线与核心机理完整性', () => {
  const routes = Object.values(engine.NARRATIVE_ROUTES);
  assert.ok(routes.length >= 9);
  for (const r of routes) {
    assert.ok(r.title && r.title.length > 3);
    assert.ok(Array.isArray(r.corePrinciples) && r.corePrinciples.length >= 3);
    assert.ok(r.generationPrompt && r.generationPrompt.includes('直接输出'));
  }
});

test('四维动机卡与物理生活阻力库覆盖所有母类', () => {
  const familyIds = Object.values(engine.GENRE_FAMILIES).map(f => f.id);
  for (const fid of familyIds) {
    const ep = engine.EPISTEMIC_PRESETS[fid];
    assert.ok(ep, `缺少 ${fid} 的四维动机预设`);
    assert.ok(ep.charactersDesire);
    assert.ok(ep.charactersConceal);
    assert.ok(ep.blindSpots);
    assert.ok(ep.irreversibleChange);

    const friction = engine.FRICTION_PRESETS[fid];
    assert.ok(friction && friction.length > 5, `缺少 ${fid} 的阻力要素`);
  }
});

test('36字连续重合门禁精准拦截并放行安全文本', () => {
  const scenes = [
    { id: 'sc_01', text: '江南七怪站在醉仙楼前，看着漫天飞雪，手里紧紧攥着那一柄生锈的短剑，眼神凌厉如刀。', title: '射雕' }
  ];

  // 1. 全文安全时放行
  const safeText = '周叙站在照壁前解下雨蓑，露出洗得发白的边军旧铠甲，腰间横刀隐隐泛着冷光。他抬头看向远处的城门。';
  const safeIssues = engine.checkSourceOverlap(safeText, scenes);
  assert.equal(safeIssues.length, 0);

  // 2. 连续36字复用时精确阻断并报告证据
  const copiedText = '此时天色已晚，只见江南七怪站在醉仙楼前，看着漫天飞雪，手里紧紧攥着那一柄生锈的短剑，眼神凌厉如刀，随后转身离去。';
  const copiedIssues = engine.checkSourceOverlap(copiedText, scenes);
  assert.equal(copiedIssues.length, 1);
  assert.equal(copiedIssues[0].code, 'source_overlap');
  assert.ok(copiedIssues[0].length >= 36);
  assert.equal(copiedIssues[0].sourceId, 'sc_01');
});

test('题材原文语料缺失时返回检查未完成，不得把空库当作通过', () => {
  const result = engine.inspectSourceOverlap('这是待检查的生成正文，文本长度足以进行检查。'.repeat(5), [], 10);
  assert.equal(result.available, false);
  assert.equal(result.passed, false);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.reason, 'source_corpus_unavailable');
  const tooShort = engine.inspectSourceOverlap('太短', [{ id: 'source', text: '可供检查的原文片段'.repeat(10) }], 10);
  assert.equal(tooShort.passed, false);
  assert.equal(tooShort.reason, 'source_text_too_short');
  assert.throws(() => engine.checkSourceOverlap('太短', [{ id: 'source', text: '可供检查的原文片段'.repeat(10) }]), { code: 'SOURCE_TEXT_TOO_SHORT' });
  const safe = engine.inspectSourceOverlap('这是一段长度足够的原创正文，主角走到门边后停下，听见屋内传来茶杯碰桌的声音。'.repeat(2), [{ id: 'source', text: '完全无关的原文片段'.repeat(10) }], 10);
  assert.equal(safe.available, true);
  assert.ok(safe.sceneCount > 0);
  assert.equal(safe.passed, true);
});

test('通用题材起草上下文组装完整（含动机、阻力与参考范文）', () => {
  const context = engine.prepareGenreSceneContext({
    genre: '都市高武',
    query: '执照考核 官方防务 阵营试探 城市街道',
    routeId: 'urban_grind'
  });

  assert.equal(context.ok, true);
  assert.equal(context.genreLab, true);
  assert.equal(context.familyId, 'urban_martial');
  assert.ok(context.writingSystem.includes('【即时动机与信息差约束'));
  assert.ok(context.writingSystem.includes('角色欲望'));
  assert.ok(context.writingSystem.includes('物理生活阻力要素'));
  assert.ok(context.writingSystem.includes('商业网文黄金四幕结构'));
  assert.ok(context.writingSystem.includes('高概念器物与视听仪器细节'));
  assert.ok(context.scenePlan.referenceTechniques.length > 0);
  // 验证 R-37/38/39 规则
  assert.ok(context.writingSystem.includes('震得脚底发木'));
  assert.ok(context.writingSystem.includes('从93跳到106卡'));
  assert.ok(context.writingSystem.includes('单字发报机流水账'));
});

test('都市高武预设已彻底清除有毒市井套路（高利贷/催缴单/合金指虎/药剂按揭）', () => {
  const ep = engine.EPISTEMIC_PRESETS['urban_martial'];
  const fp = engine.FRICTION_PRESETS['urban_martial'];
  const prompt = engine.NARRATIVE_ROUTES['urban_grind'].generationPrompt;
  const combined = JSON.stringify(ep) + fp + prompt;
  assert.equal(combined.includes('高利贷'), false, '不应包含高利贷');
  assert.equal(combined.includes('催缴'), false, '不应包含催缴');
  assert.equal(combined.includes('指虎'), false, '不应包含指虎');
  assert.equal(combined.includes('救命药剂'), false, '不应包含救命药剂');
  assert.equal(combined.includes('按揭'), false, '不应包含按揭');
});

test('元始法则特化管线动态加载并注入 Few-Shot 正向名家切片', () => {
  const p = engine.loadPipelineForRoute('yuanshi');
  assert.ok(p, '应成功加载 yuanshi 管线');
  assert.equal(p.pipelineId, 'pipeline-yuanshi-law-v1');
  assert.ok(Array.isArray(p.writingSkillSpec.fewShotExemplars) && p.writingSkillSpec.fewShotExemplars.length >= 4);

  const context = engine.prepareGenreSceneContext({
    genre: '玄幻',
    query: '北极科考船 冰原巨兽 探测器',
    routeId: 'yuanshi'
  });
  assert.equal(context.ok, true);
  assert.equal(context.pipelineId, 'pipeline-yuanshi-law-v1');
  assert.ok(context.scenePlan.pipeline, 'scenePlan 需挂接 pipeline 元信息');
  assert.ok(context.writingSystem.includes('【特化管线正向名家切片'));
  assert.ok(context.writingSystem.includes('李唯一将刚才拍的照片翻出来'));
  assert.ok(context.writingSystem.includes('庞大且健壮的体躯跃上数米高的船舷'));
});

test('服务端通用题材HTTP接口端到端正常', async (t) => {
  const origin = String(process.env.MOLAN_GENRE_TEST_ORIGIN || '').trim();
  const token = String(process.env.MOLAN_GENRE_TEST_TOKEN || '').trim();
  if (!origin || !token) {
    t.skip('设置隔离的本机测试地址和令牌后运行 HTTP 集成测试');
    return;
  }
  const base = new URL(origin);
  assert.equal(base.protocol, 'http:');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(base.hostname), 'genre HTTP 测试只允许访问本机');
  const requestJson = (method, route, value) => new Promise((resolve, reject) => {
    const data = value == null ? '' : JSON.stringify(value);
    const headers = { Authorization: 'Bearer ' + token };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(new URL(route, base), { method, headers }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });

  const routesData = await requestJson('GET', '/api/genre-lab/routes?genre=科幻末世');
  assert.equal(routesData.ok, true);
  assert.ok(routesData.routes.length >= 1);
  assert.equal(routesData.routes[0].id, 'hard_survival');

  const prepareData = await requestJson('POST', '/api/genre-lab/prepare', {
    genre: '科幻末世', query: '外骨骼电池 辐射 废土', routeId: 'hard_survival'
  });
  assert.equal(prepareData.ok, true);
  assert.equal(prepareData.routeId, 'hard_survival');
  assert.ok(prepareData.writingSystem.includes('硬核资源约束'));
});

test('48类全题材叙事机理矩阵完整性测试', () => {
  const mechs = engine.GENRE_48_MECHANISMS;
  assert.ok(mechs, 'GENRE_48_MECHANISMS 必须导出');
  const count = Object.keys(mechs).length;
  assert.ok(count >= 48, `48 类机理矩阵数量不足，当前为: ${count}`);

  // 重点商业热门品类校验
  assert.ok(mechs['古言经商种田'] || mechs['种田'], '缺少古言种田机理');
  assert.ok(mechs['年代'], '缺少年代军婚随军机理');
  assert.ok(mechs['都市种田'], '缺少两界倒爷商战机理');
  assert.ok(mechs['都市'], '缺少体制基层调研机理');
  assert.ok(mechs['诸天无限'], '缺少同时穿越互助机理');
  assert.ok(mechs['轻小说'], '缺少东京平成泡沫职场机理');

  for (const [name, item] of Object.entries(mechs)) {
    assert.ok(item.coreEngine, `${name} 缺少 coreEngine`);
    assert.ok(item.frictionConstraints, `${name} 缺少 frictionConstraints`);
    assert.ok(item.settlementStakes, `${name} 缺少 settlementStakes`);
    assert.ok(item.taboos, `${name} 缺少 taboos`);
    assert.ok(Array.isArray(item.referenceBooks), `${name} 缺少 referenceBooks`);
  }
});

test('大师笔风拓展卡预设完整性测试', () => {
  const presets = engine.AUTHOR_PERSONA_PRESETS;
  assert.ok(presets, 'AUTHOR_PERSONA_PRESETS 必须导出');
  const keys = ['maobao', 'ergen', 'guzhenren', 'fenghuo_maoni', 'wangyu', 'wuzei', 'yuantong', 'jiyueren', 'xiaolong'];
  for (const k of keys) {
    const p = presets[k];
    assert.ok(p, `缺少大师笔风预设: ${k}`);
    assert.ok(p.name);
    assert.ok(p.coreAesthetic);
    assert.ok(Array.isArray(p.voiceFeatures) && p.voiceFeatures.length >= 2);
    assert.ok(p.syntacticRhythm);
    assert.ok(p.taboos);
  }
});

test('模块化经典功能场景切片动态匹配测试', () => {
  // 1. 交易场景匹配
  const tradeMatch = engine.matchDynamicSceneSlice('当铺 压价 朝奉 柜台');
  assert.ok(tradeMatch);
  assert.equal(tradeMatch.categoryKey, 'trade');
  assert.ok(tradeMatch.slice.text.includes('当铺') || tradeMatch.slice.text.includes('柜台') || tradeMatch.slice.text.includes('朝奉'));

  // 2. 潜伏场景匹配
  const stealthMatch = engine.matchDynamicSceneSlice('暴雨 伤口 泥水 包扎 止血');
  assert.ok(stealthMatch);
  assert.equal(stealthMatch.categoryKey, 'stealth');
  assert.ok(stealthMatch.slice.text.includes('伤') || stealthMatch.slice.text.includes('泥') || stealthMatch.slice.text.includes('雨'));

  // 3. 交锋场景匹配
  const confrontMatch = engine.matchDynamicSceneSlice('公堂 敬酒 官场 对质');
  assert.ok(confrontMatch);
  assert.equal(confrontMatch.categoryKey, 'confrontation');

  // 4. 勘验场景匹配
  const forensicMatch = engine.matchDynamicSceneSlice('验尸 水浸线 溺水 痕迹 凶手');
  assert.ok(forensicMatch);
  assert.equal(forensicMatch.categoryKey, 'forensics');
  assert.ok(forensicMatch.slice.text.includes('水浸线') || forensicMatch.slice.text.includes('验尸') || forensicMatch.slice.text.includes('死者'));
});

test('新增主干叙事路线完整性测试', () => {
  const targetRoutes = ['junhun_suijun', 'tizhi_diaoyan', 'tongshi_chuanyue', 'tokyo_1991', 'fenghuo_maoni', 'dafeng_gongzhi', 'guangyin_shihuang', 'guzhenren_lixing', 'daoye_1988', 'gu_zhongtian'];
  for (const rId of targetRoutes) {
    const r = engine.NARRATIVE_ROUTES[rId];
    assert.ok(r, `NARRATIVE_ROUTES 缺少 ${rId}`);
    assert.ok(r.title);
    assert.ok(r.corePrinciples.length >= 3);
    assert.ok(r.generationPrompt.includes('直接输出'));
  }
});

test('30条细分叙事路线Canonical V2真实生成章节全量100%合规质检测试', () => {
  const summaryPath = path.join(__dirname, '../data/genre-lab/canonical-19-routes-v2/canonical-summary.json');
  assert.ok(fs.existsSync(summaryPath), 'canonical-summary.json 必须存在');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.length, 30, '应汇总全部 30 条细分叙事路线');
  for (const item of summary) {
    assert.ok(item.chars >= 2800, `${item.id} 篇幅不足 2800 字: ${item.chars}`);
    assert.equal(item.aiScore, 0, `${item.id} AI味得分不为 0: ${item.aiScore}`);
    assert.equal(item.cliches, 0, `${item.id} 包含口癖套话: ${item.cliches}`);
    assert.equal(item.overlap, 0, `${item.id} 语料重合超标: ${item.overlap}`);
    assert.equal(item.status, 'PASS 100%', `${item.id} 状态未达成 PASS 100%`);
  }
});

test('三大场景开篇与转场调度模式（倒置刺痛/高阻力转场/因果律推进）动态组装测试', () => {
  // 1. 倒置刺痛（开篇/重大危机）
  const stingCtx = engine.prepareGenreSceneContext({
    genre: '传统玄幻',
    query: '宗门试探',
    sceneMode: 'inverted_sting'
  });
  assert.equal(stingCtx.sceneMode, 'inverted_sting');
  assert.ok(stingCtx.writingSystem.includes('【开篇/危机调度：倒置刺痛切入（Inverted Sting）】'));
  assert.ok(stingCtx.writingSystem.includes('严禁平铺直叙交代背景或慢热铺陈'));

  // 2. 有机高阻力环境转场（转场/旅途）
  const transitionCtx = engine.prepareGenreSceneContext({
    genre: '传统玄幻',
    query: '风暴 旅途 换地图',
    sceneMode: 'atmospheric_transition'
  });
  assert.equal(transitionCtx.sceneMode, 'atmospheric_transition');
  assert.ok(transitionCtx.writingSystem.includes('【场景转换调度：有机高阻力环境转场（Atmospheric Friction Transition）】'));
  assert.ok(transitionCtx.writingSystem.includes('描写“环境-器物-肉体”的三维物理阻力与微观损耗'));

  // 3. 常态推进因果流
  const flowCtx = engine.prepareGenreSceneContext({
    genre: '传统玄幻',
    query: '常规交涉 资源置换',
    sceneMode: 'causal_flow'
  });
  assert.equal(flowCtx.sceneMode, 'causal_flow');
  assert.ok(flowCtx.writingSystem.includes('【常态行文调度：因果驱动推进流（Causal Flow）】'));
});

test('因果债务追踪器与跨章因果链动态注入上下文测试', () => {
  const tempDir = path.join(__dirname, '../data/test-engine-causal-debts');
  const customTracker = new engine.CausalDebtTracker(tempDir);
  const testBookId = 'engine_test_novel_01';

  try {
    // 注入因果债务
    customTracker.recordDebt(testBookId, {
      chapterNum: 1,
      type: 'major',
      description: '周叙欠下边军粮道三百石军饷，立字据限三月内清偿',
      stakes: '失信则抄没祖宅并革去武备籍'
    });

    const context = engine.prepareGenreSceneContext({
      genre: '都市高武',
      bookId: testBookId,
      chapterNum: 2,
      tracker: customTracker
    });

    assert.ok(context.writingSystem.includes('【跨章节因果债务与细节复利（Causal Debt & Compounding Payoffs）】'));
    assert.ok(context.writingSystem.includes('周叙欠下边军粮道三百石军饷'));
    assert.ok(context.writingSystem.includes('失信则抄没祖宅并革去武备籍'));
    assert.ok(context.causalDebtCount >= 1);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('纯言语阶级话语权群像约束生效（严禁推眼镜/捏手指等神经微动作）', () => {
  const context = engine.prepareGenreSceneContext({ genre: '东方仙侠' });
  assert.ok(context.writingSystem.includes('纯言语与身份话语权群像（彻底禁绝小动作与微表情）'));
  assert.ok(context.writingSystem.includes('严禁通过“推眼镜、捏手指、摸胡茬、咬下唇、抿嘴”等神经性微动作塑造人物'));
  assert.ok(context.writingSystem.includes('人物的辨识度完全来自职业黑话、阶级话语权的高低非对称'));
});

test('sanitizeAiFlavor 精准清除躯体化反射与翻译腔，并严格保护商业中二招式与宏大奇观', () => {
  const textWithCliches = '他感到喉咙发紧，指节泛白，心跳漏了一拍。在这一刻显得格外危险，无不在昭示着前方的杀机。';
  const cleaned = engine.sanitizeAiFlavor(textWithCliches);
  assert.equal(cleaned.includes('喉咙发紧'), false);
  assert.equal(cleaned.includes('指节泛白'), false);
  assert.equal(cleaned.includes('心跳漏了一拍'), false);
  assert.equal(cleaned.includes('在这一刻显得格外'), false);
  assert.equal(cleaned.includes('无不在昭示着'), false);
  assert.ok(cleaned.includes('呼吸粗重'));
  assert.ok(cleaned.includes('手指用力'));
  assert.ok(cleaned.includes('心头一沉'));
  assert.ok(cleaned.includes('此时格外'));

  // 验证商业中二热血词汇 100% 完整保留，不受破坏
  const chuunibyouText = '他施展出焚尽苍穹的九重离火，神魔辟易，绝对零度领域轰然降临，万丈雷霆呼啸而下！';
  const preserved = engine.sanitizeAiFlavor(chuunibyouText);
  assert.equal(preserved, chuunibyouText, '商业热血中二词汇必须100%原样保留');
});
