/**
 * build-comparable-benchmarks.mjs
 * ---------------------------------------------------------------------------
 * 从已有的 48 题材基准画像、1035 部风格指纹、叙事机理库与榜单数据中，
 * 离线构建五级金字塔（Level 1~5）「同类可比」网络小说 Benchmark 数据库。
 *
 * 核心原则：
 * 1. 相似度优先于数量：样本少则平滑降级，样本足则细分到流派与人设；
 * 2. 绝对版权隔离：严禁存储原著大段文本，仅记录统计区间、结构规律与代表作元数据。
 * ---------------------------------------------------------------------------
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MOLAN_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const BASELINES_DIR = path.join(MOLAN_ROOT, 'data', 'genre-baselines');
const FINGERPRINTS_FILE = path.join(MOLAN_ROOT, 'data', 'style-fingerprints.json');
const QIDIAN_RANKS_FILE = path.resolve(MOLAN_ROOT, '..', '资源库', 'qidian-rank-manifest.json');
const OUTPUT_DIR = path.join(MOLAN_ROOT, 'data', 'benchmark-database');

// 加载题材机理数据（48类完整覆盖）
const { GENRE_48_MECHANISMS } = require('../lib/genre-mechanisms-data.js');

// 8 大叙事母类定义与二级题材映射
const GENRE_FAMILIES = {
  xuanhuan: {
    title: '玄幻修真',
    subcategories: ['玄幻', '传统玄幻', '玄幻脑洞', '东方仙侠', '仙侠', '都市修真', '武侠', '测试']
  },
  urban_martial: {
    title: '都市高武',
    subcategories: ['都市高武', '都市', '都市脑洞', '都市日常', '都市种田', '战神赘婿', '现实']
  },
  scifi_apocalypse: {
    title: '科幻末世',
    subcategories: ['科幻', '科幻末世', '星光璀璨']
  },
  suspense: {
    title: '悬疑惊悚',
    subcategories: ['悬疑灵异', '悬疑脑洞', '女频悬疑']
  },
  history: {
    title: '历史古代',
    subcategories: ['历史', '历史古代', '历史脑洞', '抗战谍战', '军事']
  },
  western_fantasy: {
    title: '西方奇幻',
    subcategories: ['奇幻', '西方奇幻', '诸天无限', '游戏', '游戏体育', '轻小说', '动漫衍生', '男频衍生', '女频衍生']
  },
  ancient_romance: {
    title: '古言世情',
    subcategories: ['古言脑洞', '古风世情', '宫斗宅斗', '民国言情', '年代', '玄幻言情']
  },
  modern_romance: {
    title: '现代言情',
    subcategories: ['青春甜宠', '豪门总裁', '现言脑洞', '职场婚恋', '种田', '快穿', '体育']
  }
};

// 预定义各核心流派金牌基准（Level 4 Archetypes & Pacing）
const ARCHETYPE_DEFINITIONS = [
  {
    id: 'fanren_cautious',
    genre: '玄幻修真',
    subgenre: '东方仙侠',
    name: '凡人谨慎修仙流',
    structure: '三区段推进 (1-3章底层生计危机逃亡 -> 4-7章低调潜伏门派 -> 8-10章初次资源生死搏杀)',
    narrative_type: '第三人称限制视角 (贴紧主角知情权与危机感，杜绝上帝俯瞰与剧透)',
    pacing_type: '蓄力沉淀-阶段爆发型 (章长2500±15%，8-10章首爆)',
    world_type: '残酷修真社会学 (灵根受限，门阀宗族资源垄断，优胜劣汰)',
    protagonist_type: '冷静理智型 / 谨慎藏拙',
    core_conflict: '底层散修生计死局与宗门剥削法则的生死博弈',
    golden_finger_type: '慢热辅助至宝 (如小绿瓶/演武奇石，无高压任务与直接打脸系统)',
    opening_mode_target: '具体物理场景动作或生存险境切入 (scene)',
    sample_titles: ['一世之尊 - 爱潜水的乌贼', '凡人修仙', '不努力就会成为病娇仙子的玩物'],
    excluded_titles: ['万族之劫', '绝世战神'],
    excluded_reason: '万族之劫属热血杀伐高武连环流；绝世战神属快节奏小白打脸流，与谨慎苟道结构排斥。',
    similarity_reason: '主角均具备极端谨慎人设与利己理性，前三章均在强力外敌压迫下潜伏逃生，对白轮次充实，环境描写具有物理阻力。',
    metrics_adjust: { dialogueTurnMean: 21.5, similePerKilo: 1.25, dialogueRatio: 0.24 }
  },
  {
    id: 'xuanjian_clan',
    genre: '玄幻修真',
    subgenre: '传统玄幻',
    name: '宗族谱系族运流',
    structure: '家族立足-代际传承-资源置换-族运牺牲',
    narrative_type: '第三人称多线限制群像视角 (以宗族核心人物为锚)',
    pacing_type: '慢热种田-长程因果伏笔型',
    world_type: '修真修仙地缘政治 (世家大族如林，灵脉瓜分，香火法统)',
    protagonist_type: '智谋传承型 / 牺牲奉献型',
    core_conflict: '弱小宗族在金丹宗门夹缝求存与代际延续',
    golden_finger_type: '家族传世镇物 / 族运图鉴',
    opening_mode_target: '家族危局会议或祖产争夺现场切入',
    sample_titles: ['完美世界 - 辰东', '玄鉴仙族'],
    excluded_titles: ['斗罗大陆'],
    excluded_reason: '个人英雄主义单挑流派，无严苛家族账目与谱系牺牲考据。',
    similarity_reason: '侧重族运兴衰与多代传承代价值，因果债务链条长且重。',
    metrics_adjust: { dialogueTurnMean: 22.0, sentenceLenMean: 28.0, chapterChars: [2600, 3400] }
  },
  {
    id: 'urban_martial_grind',
    genre: '都市高武',
    subgenre: '都市高武',
    name: '官方规制与实战体检流',
    structure: '体检武考前夕-资源置换突破-擂台/凶兽实战攻防-官方嘉奖',
    narrative_type: '第三人称紧凑限制视角',
    pacing_type: '连环压力-数值即时反馈型',
    world_type: '现代高武社会体系 (气血数值化、武道协会官方规制、地窟/异界前线)',
    protagonist_type: '冷静理智型 / 坚毅自律',
    core_conflict: '寒门武考竞争壁垒与地窟万族入侵压力',
    golden_finger_type: '熟练度面板 / 气血数值加点',
    opening_mode_target: '教室/训练馆实测气血或战术推演切入',
    sample_titles: ['武道！ - 田隶', '全球高武'],
    excluded_titles: ['狂婿当道'],
    excluded_reason: '传统都市赘婿侧重情感侮辱反转，缺乏武考科研与实战攻防体系。',
    similarity_reason: '具有鲜明的数值化气血度量体系，角色言语带官方规制与实战纪律感。',
    metrics_adjust: { dialogueTurnMean: 18.5, similePerKilo: 1.1, dialogueRatio: 0.26 }
  },
  {
    id: 'suspense_rule_horror',
    genre: '悬疑惊悚',
    subgenre: '悬疑脑洞',
    name: '空间规则怪谈求生流',
    structure: '置身异常密闭空间-解读违背常识规则-试探规则边界-付出代价生还',
    narrative_type: '第三人称深度限制视角 (剥夺全知权，视觉与听觉死角强化)',
    pacing_type: '心理高压紧缩型 (冷峻短句交替)',
    world_type: '日常认知崩塌 (不可名状存在，规则绝对致死，禁止正面物理对抗)',
    protagonist_type: '高智敏锐型 / 极度冷静',
    core_conflict: '荒诞致死规则与人类求生本能的智力对弈',
    golden_finger_type: '无金手指 / 仅有微弱代价型被动感知道具',
    opening_mode_target: '异化场景细节或诡异规则告示切入',
    sample_titles: ['玩家请上车 - 海晏山', '神秘复苏 - 佛前献花'],
    excluded_titles: ['他来了，请闭眼'],
    excluded_reason: '都市刑侦侧重刑法与心理画像，无不可名状规则异化。',
    similarity_reason: '侧重物理细节的扭曲描写（水汽、倒影、钟摆声音），情绪冷硬紧绷。',
    metrics_adjust: { sentenceLenMean: 22.5, sentenceLenStd: 15.8, dialogueRatio: 0.18, dialogueTurnMean: 14.5 }
  },
  {
    id: 'suspense_folklore',
    genre: '悬疑惊悚',
    subgenre: '悬疑灵异',
    name: '民俗禁忌与行业行规流',
    structure: '民间异事接活-违背传统禁忌-凶险上门-循古法破局',
    narrative_type: '第三人称沧桑市井视角',
    pacing_type: '民俗秘闻展开-诡谲危机爆发型',
    world_type: '民间怪谈江湖 (捞尸人、缝尸匠、扎纸人，行有行规)',
    protagonist_type: '市侩圆滑型 / 坚守行规',
    core_conflict: '行业古老禁忌与现代贪婪欲望的碰撞',
    golden_finger_type: '祖传手艺秘籍 / 辟邪器具',
    opening_mode_target: '具体江河捞尸现场或深夜守灵动作切入',
    sample_titles: ['捞尸人 - 纯洁滴小龙', '我有一座冒险屋'],
    excluded_titles: ['开端'],
    excluded_reason: '开端属现代社会群像科幻时间循环，缺乏民俗巫蛊江湖气。',
    similarity_reason: '充满大量行业暗语、市井行规与江湖禁忌，对白接地气且暗藏心机。',
    metrics_adjust: { sentenceLenMean: 24.0, dialogueTurnMean: 17.0, dialogueRatio: 0.22 }
  },
  {
    id: 'scifi_wasteland_shelter',
    genre: '科幻末世',
    subgenre: '科幻末世',
    name: '废土避难所重工业复苏流',
    structure: '残破避难所重启-勘探地表辐射废墟-技术图纸回收-重工业流水线扩张',
    narrative_type: '第三人称宏观领主与微观探险交替视角',
    pacing_type: '基建攀科技-抵御变异潮型',
    world_type: '核战废土后启示录 (极端严寒、辐射变异体、掠夺者聚落)',
    protagonist_type: '冷静理智型 / 领袖心智',
    core_conflict: '恶劣环境资源枯竭与掠夺者势力的压迫',
    golden_finger_type: '战前避难所核心超脑 / 工业克隆技术',
    opening_mode_target: '避难所警报响起或防核门开启重压动作切入',
    sample_titles: ['这游戏也太真实了 - 晨星LL', '黎明之剑 - 远瞳'],
    excluded_titles: ['吞噬星空'],
    excluded_reason: '吞噬星空为个人肉身无敌基因武者流，非废土工业基建经营流。',
    similarity_reason: '包含严密的力学、重工装备、齿轮轴承与防浪防尘物理咬合描写。',
    metrics_adjust: { sentenceLenMean: 25.5, dialogueTurnMean: 19.0, similePerKilo: 1.3 }
  },
  {
    id: 'western_sequence_mystery',
    genre: '西方奇幻',
    subgenre: '西方奇幻',
    name: '维多利亚蒸汽魔药序列流',
    structure: '离奇死而复生-探索序列魔药配方-加入官方非凡小队-对抗失控疯狂',
    narrative_type: '第三人称古典限制视角',
    pacing_type: '层层剥茧-理智值对抗型',
    world_type: '蒸汽朋克与克苏鲁交织 (红月、序列途径、魔药与神性失控代价)',
    protagonist_type: '谨慎探索型 / 守护心智',
    core_conflict: '凡人获取非凡力量与神性疯狂的不可逆代价',
    golden_finger_type: '神秘灵界聚合空间 (如源堡)',
    opening_mode_target: '案发现场苏醒或书桌油灯前阅读笔记切入',
    sample_titles: ['诡秘之主 - 爱潜水的乌贼', '放开那个女巫'],
    excluded_titles: ['轮回乐园'],
    excluded_reason: '轮回乐园为高频纯粹近身刀术与契约杀伐，无维多利亚古典社交与神秘仪式。',
    similarity_reason: '侧重仪式魔法、羊皮纸账单、煤气路灯与神秘学代价，言语庄重含蓄。',
    metrics_adjust: { sentenceLenMean: 27.5, dialogueTurnMean: 22.0, similePerKilo: 1.4 }
  },
  {
    id: 'history_spy_code',
    genre: '历史古代',
    subgenre: '抗战谍战',
    name: '隐蔽战线密电破译与潜伏流',
    structure: '打入敌伪情报机关-截获关键密电-双重假面周旋-传递绝密情报脱身',
    narrative_type: '第三人称冷峻伪装视角',
    pacing_type: '步步惊心-刀尖起舞型',
    world_type: '孤岛谍影暗战 (密码破译、特高课、军统中统多方倾轧)',
    protagonist_type: '伪装大师 / 坚毅铁血',
    core_conflict: '假面身份随时暴露的灭顶之灾与民族存亡大义',
    golden_finger_type: '过目不忘照相机记忆 / 微表情与电讯特长',
    opening_mode_target: '审讯室观察或街头公用电话亭密接动作切入',
    sample_titles: ['我的谍战岁月 - 猪头七', '风声'],
    excluded_titles: ['神话版三国'],
    excluded_reason: '神话三国为大兵团云气对撞玄幻历史，非微观市井暗战谍影。',
    similarity_reason: '人物言语充满机锋试探与潜台词，表面客套、实则生死攻防，严禁直球对白。',
    metrics_adjust: { dialogueTurnMean: 23.5, dialogueRatio: 0.28, sentenceLenStd: 18.0 }
  },
  {
    id: 'ancient_romance_mansion',
    genre: '古言世情',
    subgenre: '古风世情',
    name: '宅门月例账目与内宅生存流',
    structure: '庶女/孤女低调立足-掌管内宅产业账目-化解妻妾机心算计-家族利益博弈',
    narrative_type: '第三人称细腻世情视角',
    pacing_type: '润物无声-家族世道人情型',
    world_type: '礼教门阀世情 (内阁六部、族谱宗规、月例对牌、婚丧嫁娶)',
    protagonist_type: '聪慧内敛 / 守拙藏锋',
    core_conflict: '封建宗法制度对女性命运的压迫与个人尊严的守住',
    golden_finger_type: '现代财会理财心智 / 敏锐洞察力 (无修仙开挂系统)',
    opening_mode_target: '冬日雪夜内室问安或月例对牌发放切入',
    sample_titles: ['知否知否应是绿肥红瘦 - 关心则乱', '红楼之庶子风华'],
    excluded_titles: ['重生之将门毒后'],
    excluded_reason: '将门毒后侧重快意恩仇的大女主血腥复仇，非细腻琐碎的宅门生活世情。',
    similarity_reason: '对白充满世情客套、尊卑分寸与利益较量，衣食住行考据详实。',
    metrics_adjust: { dialogueTurnMean: 24.0, dialogueRatio: 0.30, sentenceLenMean: 25.0 }
  }
];

function round(val, d = 2) {
  return Number(Number(val || 0).toFixed(d));
}

function loadRankings() {
  if (!fs.existsSync(QIDIAN_RANKS_FILE)) return new Map();
  try {
    const data = JSON.parse(fs.readFileSync(QIDIAN_RANKS_FILE, 'utf8'));
    const map = new Map();
    (data.categories || []).forEach(cat => {
      Object.entries(cat.ranks || {}).forEach(([rankType, list]) => {
        list.forEach(book => {
          map.set(book.title, { rankType, rank: book.rank, author: book.author || '' });
        });
      });
    });
    return map;
  } catch {
    return new Map();
  }
}

export function buildBenchmarkDatabase() {
  console.log('=== [Benchmark Database Builder] 开始离线构建网络小说 Benchmark 库 ===');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const rankMap = loadRankings();
  const rawFingerprints = fs.existsSync(FINGERPRINTS_FILE)
    ? (JSON.parse(fs.readFileSync(FINGERPRINTS_FILE, 'utf8')).books || [])
    : [];

  // 按 bucket 归类指纹书籍
  const booksByBucket = new Map();
  for (const b of rawFingerprints) {
    const g = b.bucket || b.primaryGenre || 'unknown';
    if (!booksByBucket.has(g)) booksByBucket.set(g, []);
    booksByBucket.get(g).push(b);
  }

  // 1. 构建 Level 2: 全量 48 细分题材 Benchmark
  console.log('\n--> 构建 Level 2: 48 细分题材基准...');
  const level2Benchmarks = [];
  const fields = ['sentenceLenMean', 'sentenceLenStd', 'paragraphLenMean', 'paragraphLenStd', 'dialogueRatio', 'dialogueTurnMean', 'commaPeriodRatio', 'ttr', 'similePerKilo'];

  // 遍历 48 个题材
  const all48Genres = Object.keys(GENRE_48_MECHANISMS);

  for (const genre of all48Genres) {
    const mech = GENRE_48_MECHANISMS[genre] || {};
    const baseFile = path.join(BASELINES_DIR, `${genre}.json`);
    let base = {};
    let struct = {};
    let matchedBooks = [];
    let bookCount = 0;

    // 优先读取预先切片完整的 genre-baselines
    if (fs.existsSync(baseFile)) {
      try {
        const baselineData = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
        base = baselineData.baseline || {};
        struct = baselineData.structureBaseline || {};
        bookCount = baselineData.bookCount || 0;
        matchedBooks = (baselineData.books || []).map(b => {
          const cleanTitle = b.title.replace(/\.txt$/, '').trim();
          const rankInfo = rankMap.get(cleanTitle) || {};
          return {
            title: cleanTitle,
            author: rankInfo.author || (cleanTitle.includes('-') ? cleanTitle.split('-')[1].trim() : '原著作者'),
            ranking: rankInfo.rank ? `${rankInfo.rankType} No.${rankInfo.rank}` : '语料典范样本',
            filePath: b.filePath || ''
          };
        }).slice(0, 10);
      } catch (_) {}
    }

    // 若无预切片基准文件或样本较少，由 style-fingerprints 聚合补充
    if (!base.sentenceLenMean && booksByBucket.has(genre)) {
      const gBooks = booksByBucket.get(genre);
      bookCount = gBooks.length;
      base = {};
      fields.forEach(f => {
        const vals = gBooks.map(b => b.fingerprint && b.fingerprint[f]).filter(Number.isFinite);
        if (vals.length) {
          const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
          const stdDev = Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / vals.length);
          base[f] = { mean: round(mean, 4), stdDev: round(stdDev, 4), count: vals.length };
        }
      });
      matchedBooks = gBooks.map(b => {
        const cleanTitle = b.title.replace(/\.txt$/, '').trim();
        const rankInfo = rankMap.get(cleanTitle) || {};
        return {
          title: cleanTitle,
          author: rankInfo.author || (cleanTitle.includes('-') ? cleanTitle.split('-')[1].trim() : '原著作者'),
          ranking: rankInfo.rank ? `${rankInfo.rankType} No.${rankInfo.rank}` : '指纹库样本',
          filePath: b.filePath || ''
        };
      }).slice(0, 10);
    }

    // 确定所属母类
    let familyKey = 'other';
    let familyTitle = mech.family || '其它衍生';
    for (const [fKey, fVal] of Object.entries(GENRE_FAMILIES)) {
      if (fVal.subcategories.includes(genre)) {
        familyKey = fKey;
        familyTitle = fVal.title;
        break;
      }
    }

    const bId = `BM_L2_${familyKey.toUpperCase()}_${genre}`;
    const obj = {
      benchmark_id: bId,
      level: 'Level2_Subgenre',
      genre: familyTitle,
      subgenre: genre,
      audience: ['古言脑洞', '古风世情', '宫斗宅斗', '民国言情', '现言脑洞', '青春甜宠', '豪门总裁', '女频衍生', '女频悬疑'].includes(genre) ? 'female' : 'male',
      structure: '网文标准三区段推进 (第1-3章破题立境 -> 4-10章首个大爆点 -> 后续循环上升)',
      narrative_type: '第三人称限制视角',
      pacing_type: `${genre}题材标准节奏`,
      world_type: mech.coreEngine || `${genre}标准世界法则`,
      protagonist_type: '题材代表性主角原型',
      core_conflict: mech.settlementStakes || `${genre}核心利益冲突与生存压力`,
      golden_finger_type: '题材常见机理与能力支撑',
      friction_constraints: mech.frictionConstraints || '常规物理阻力与社会契约',
      taboos: mech.taboos || '严禁机械说教与无铺垫空降',
      opening_mode_target: struct.openingModeDistribution?.scene >= 0.6 ? '具体场景动作切入' : '对白/场景交织切入',
      metrics_target: {
        sentenceLenMean: round(base.sentenceLenMean?.mean, 2) || 24.5,
        sentenceLenStd: round(base.sentenceLenStd?.mean, 2) || 16.0,
        paragraphLenMean: round(base.paragraphLenMean?.mean, 2) || 30.0,
        dialogueRatio: round(base.dialogueRatio?.mean, 4) || 0.22,
        dialogueTurnMean: round(base.dialogueTurnMean?.mean, 2) || 19.5,
        commaPeriodRatio: round(base.commaPeriodRatio?.mean, 2) || 2.2,
        ttr: round(base.ttr?.mean, 4) || 0.65,
        similePerKilo: round(base.similePerKilo?.mean, 2) || 1.2,
        chapterChars: [struct.chapterCharsP25 || 2125, struct.chapterCharsP75 || 2875]
      },
      sample_books: matchedBooks,
      sample_count: bookCount || matchedBooks.length,
      similarity_reason: `基于 资源库/小说原本/${genre}/ 及指纹库共 ${bookCount} 部样本统计提炼，代表同题材原著客观分布。`,
      excluded_books: [],
      confidence: bookCount >= 20 ? 0.95 : bookCount >= 15 ? 0.88 : bookCount >= 5 ? 0.78 : 0.60
    };
    level2Benchmarks.push(obj);
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'level2-subgenres.json'), JSON.stringify(level2Benchmarks, null, 2), 'utf8');
  console.log(`  -> 成功写入 ${level2Benchmarks.length} 个 Level 2 细分题材基准。`);

  // 2. 构建 Level 1: 8 大叙事母类 Benchmark (由 Level 2 聚合)
  console.log('\n--> 构建 Level 1: 8 大叙事母类基准...');
  const level1Benchmarks = [];
  for (const [fKey, fVal] of Object.entries(GENRE_FAMILIES)) {
    const subList = level2Benchmarks.filter(b => fVal.subcategories.includes(b.subgenre));
    if (!subList.length) continue;
    const avg = field => round(subList.reduce((sum, b) => sum + (b.metrics_target[field] || 0), 0) / subList.length, 2);
    const avgRatio = field => round(subList.reduce((sum, b) => sum + (b.metrics_target[field] || 0), 0) / subList.length, 4);

    const bId = `BM_L1_FAMILY_${fKey.toUpperCase()}`;
    const allBooks = subList.flatMap(b => b.sample_books).slice(0, 15);
    const totalSamples = subList.reduce((sum, b) => sum + b.sample_count, 0);

    const obj = {
      benchmark_id: bId,
      level: 'Level1_Family',
      genre: fVal.title,
      subgenre: fVal.subcategories.join(' / '),
      audience: ['古言世情', '现代言情'].includes(fVal.title) ? 'female' : 'male',
      structure: '叙事母类宏观节奏框架与大章推进模式',
      narrative_type: '第三人称限制视角',
      pacing_type: '叙事母类均值节奏',
      world_type: `${fVal.title}广义世界观`,
      protagonist_type: '母类通用原型',
      core_conflict: `${fVal.title}核心矛盾动力`,
      golden_finger_type: '流派常见金手指集合',
      opening_mode_target: '视具体子题材而定 (场景动作或对白切入)',
      metrics_target: {
        sentenceLenMean: avg('sentenceLenMean'),
        sentenceLenStd: avg('sentenceLenStd'),
        paragraphLenMean: avg('paragraphLenMean'),
        dialogueRatio: avgRatio('dialogueRatio'),
        dialogueTurnMean: avg('dialogueTurnMean'),
        commaPeriodRatio: avg('commaPeriodRatio'),
        ttr: avgRatio('ttr'),
        similePerKilo: avg('similePerKilo'),
        chapterChars: [2100, 3000]
      },
      sample_books: allBooks,
      sample_count: totalSamples,
      similarity_reason: `由 ${subList.length} 个 ${fVal.title} 细分子类聚合而成（共 ${totalSamples} 部原著），供冷门题材或跨题材对比时安全降级使用。`,
      excluded_books: [],
      confidence: 0.92
    };
    level1Benchmarks.push(obj);
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'level1-families.json'), JSON.stringify(level1Benchmarks, null, 2), 'utf8');
  console.log(`  -> 成功写入 ${level1Benchmarks.length} 个 Level 1 叙事母类基准。`);

  // 3. 构建 Level 4: 细分流派与人设/节奏 Benchmark (Archetypes)
  console.log('\n--> 构建 Level 4: 细分流派与人设节奏基准...');
  const level4Benchmarks = [];
  for (const def of ARCHETYPE_DEFINITIONS) {
    const parentL2 = level2Benchmarks.find(b => b.subgenre === def.subgenre) || level2Benchmarks.find(b => b.genre === def.genre) || level2Benchmarks[0];
    const targetMetrics = { ...parentL2.metrics_target };
    if (def.metrics_adjust) {
      Object.assign(targetMetrics, def.metrics_adjust);
    }

    const matched = [];
    for (const titleKey of def.sample_titles) {
      const found = rawFingerprints.find(b => b.title.includes(titleKey.split(' - ')[0]) || titleKey.includes(b.title));
      if (found) {
        matched.push({
          title: found.title,
          author: found.title.includes('-') ? found.title.split('-')[1].trim() : (titleKey.includes('-') ? titleKey.split('-')[1].trim() : '原著作者'),
          ranking: '同流派典范样本',
          filePath: found.filePath
        });
      } else {
        matched.push({
          title: titleKey,
          author: titleKey.includes('-') ? titleKey.split('-')[1].trim() : '原著作者',
          ranking: '权威范本',
          filePath: ''
        });
      }
    }

    const bId = `BM_L4_${def.id.toUpperCase()}`;
    const obj = {
      benchmark_id: bId,
      level: 'Level4_Pacing',
      genre: def.genre,
      subgenre: `${def.subgenre} · ${def.name}`,
      audience: parentL2.audience,
      structure: def.structure,
      narrative_type: def.narrative_type,
      pacing_type: def.pacing_type,
      world_type: def.world_type,
      protagonist_type: def.protagonist_type,
      core_conflict: def.core_conflict,
      golden_finger_type: def.golden_finger_type,
      opening_mode_target: def.opening_mode_target,
      metrics_target: targetMetrics,
      sample_books: matched,
      sample_count: matched.length,
      similarity_reason: def.similarity_reason,
      excluded_books: (def.excluded_titles || []).map(t => ({ title: t, reason: def.excluded_reason })),
      confidence: 0.96
    };
    level4Benchmarks.push(obj);
  }
  fs.writeFileSync(path.join(OUTPUT_DIR, 'level4-archetypes.json'), JSON.stringify(level4Benchmarks, null, 2), 'utf8');
  console.log(`  -> 成功写入 ${level4Benchmarks.length} 个 Level 4 细分流派/人设节奏基准。`);

  // 4. 生成倒排总索引 index.json
  console.log('\n--> 构建 Benchmark 倒排总索引 index.json...');
  const allBenchmarks = [...level4Benchmarks, ...level2Benchmarks, ...level1Benchmarks];
  const index = {
    schemaVersion: 'molan-benchmark-database-v1',
    generatedAt: new Date().toISOString(),
    totalBenchmarks: allBenchmarks.length,
    countsByLevel: {
      Level1_Family: level1Benchmarks.length,
      Level2_Subgenre: level2Benchmarks.length,
      Level4_Pacing: level4Benchmarks.length
    },
    byGenre: {},
    bySubgenre: {},
    byProtagonistType: {},
    benchmarksSummary: allBenchmarks.map(b => ({
      id: b.benchmark_id,
      level: b.level,
      genre: b.genre,
      subgenre: b.subgenre,
      protagonist_type: b.protagonist_type,
      sample_count: b.sample_count,
      confidence: b.confidence
    }))
  };

  allBenchmarks.forEach(b => {
    // byGenre
    if (!index.byGenre[b.genre]) index.byGenre[b.genre] = [];
    index.byGenre[b.genre].push(b.benchmark_id);

    // bySubgenre
    if (!index.bySubgenre[b.subgenre]) index.bySubgenre[b.subgenre] = [];
    index.bySubgenre[b.subgenre].push(b.benchmark_id);

    // byProtagonistType
    if (b.protagonist_type) {
      if (!index.byProtagonistType[b.protagonist_type]) index.byProtagonistType[b.protagonist_type] = [];
      index.byProtagonistType[b.protagonist_type].push(b.benchmark_id);
    }
  });

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log(`  -> 索引构建完毕，收录 ${allBenchmarks.length} 个 Benchmark，索引表写入 data/benchmark-database/index.json`);
  console.log('=== [Benchmark Database Builder] 离线构建完成 ===\n');
  return index;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  buildBenchmarkDatabase();
}
