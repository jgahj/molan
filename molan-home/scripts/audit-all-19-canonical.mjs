import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const molanHome = 'c:/Users/lyh/Desktop/小说专属网页/molan-home';
const { computeAiFlavorScore } = require(path.join(molanHome, 'lib/ai-flavor-detector'));
const { checkSourceOverlap, loadCorpusForFamily } = require(path.join(molanHome, 'lib/genre-engine'));

const FORBIDDEN_AI_CLICHES = [
  '倒吸一口凉气', '倒吸凉气', '眼神一凝', '双眼微眯', '瞳孔微缩',
  '嘴角勾起', '扯了扯嘴角', '深吸一口气', '不由得一愣', '愣了一下',
  '脑海中轰然作响', '气血翻涌', '喉头一甜', '虎口发麻', '后背冷汗直流',
  '第一息', '第二息', '第三息', '恐怖如斯', '这一刻，他'
];

const SOURCE_MAP = [
  { id: 'yuanshi', route: '高概念修真工业', src: 'data/genre-lab/master-20260908-eval/yuanshi/chapter.md', book: '万古神帝/飞天鱼体系', family: 'xuanhuan' },
  { id: 'jianzhu', route: '大荒神异朋克机关', src: 'data/genre-lab/master-20260908-eval/jianzhu/chapter.md', book: '大荒神异/爱潜水的乌贼', family: 'xuanhuan' },
  { id: 'xuanjian', route: '宗族谱系代际血火', src: 'data/genre-lab/eval-comparative/v2/xuanjian-chapter.md', book: '仙侠/玄鉴仙族 - 季越人.txt', family: 'xuanhuan' },
  { id: 'fanren', route: '散修生计谨慎藏拙', src: 'data/genre-lab/eval-exhaustive/v2/fanren-chapter-v2.md', book: '仙侠/凡人修仙传 - 忘语.txt', family: 'xuanhuan' },
  { id: 'urban_grind', route: '官方考核实战攻防', src: 'data/genre-lab/eval-comparative/v2/urban_grind-chapter.md', book: '都市/以神通之名 - 猪心虾仁.txt', family: 'urban_martial' },
  { id: 'yucun_1982', route: '沿海捕捞潮汐考据', src: 'data/genre-lab/eval-exhaustive/yucun_1982-chapter.md', book: '都市/重回1982小渔村 - 米饭的米.txt', family: 'urban_martial' },
  { id: 'daguo_junken', route: '重工业垦荒集体纪律', src: 'data/genre-lab/eval-exhaustive/daguo_junken-chapter.md', book: '现实/大国军垦 - 大强67.txt', family: 'urban_martial' },
  { id: 'hard_survival', route: '废土避难所工业复苏', src: 'data/genre-lab/eval-exhaustive/hard_survival-chapter.md', book: '科幻/这游戏也太真实了 - 晨星LL.txt', family: 'scifi_apocalypse' },
  { id: 'dawn_blade', route: '魔导工业深空去魅', src: 'data/genre-lab/eval-exhaustive/v2/dawn_blade-chapter-v2.md', book: '科幻/黎明之剑 - 远瞳.txt', family: 'scifi_apocalypse' },
  { id: 'swallow_star', route: '基因武者考核深空', src: 'data/genre-lab/eval-exhaustive/swallow_star-chapter.md', book: '科幻/吞噬星空 - 我吃西红柿.txt', family: 'scifi_apocalypse' },
  { id: 'laoshiren', route: '黄河捞尸民俗死相', src: 'data/genre-lab/eval-exhaustive/v2/laoshiren-chapter-v2.md', book: '都市/捞尸人 - 纯洁滴小龙.txt', family: 'suspense' },
  { id: 'rule_horror', route: '空间规则怪谈心理压榨', src: 'data/genre-lab/eval-exhaustive/rule_horror-chapter.md', book: '悬疑灵异/玩家请上车 - 海晏山.txt', family: 'suspense' },
  { id: 'folklore_investigation', route: '民俗异闻心理递进通用', src: 'data/genre-lab/eval-exhaustive/v2/folklore_investigation-chapter-v2.md', book: '悬疑灵异/民俗异闻', family: 'suspense' },
  { id: 'dynasty_friction', route: '军团大政大谋略天下大势', src: 'data/genre-lab/eval-exhaustive/dynasty_friction-chapter.md', book: '历史/神话版三国 - 坟土荒草.txt', family: 'history' },
  { id: 'spy_years', route: '隐蔽战线密电海派市井', src: 'data/genre-lab/eval-comparative/v2/spy_years-chapter.md', book: '军事/我的谍战岁月 - 猪头七.txt', family: 'history' },
  { id: 'sequence_cost', route: '蒸汽非凡扮演法则代价', src: 'data/genre-lab/eval-exhaustive/v2/sequence_cost-chapter-v2.md', book: '奇幻序列/爱潜水的乌贼', family: 'western_fantasy' },
  { id: 'super_mechanic', route: '机械图纸军火星海智械', src: 'data/genre-lab/eval-exhaustive/super_mechanic-chapter.md', book: '游戏/超神机械师 - 齐佩甲.txt', family: 'western_fantasy' },
  { id: 'reincarnation_paradise', route: '猎杀者刀术契约纯粹利益', src: 'data/genre-lab/eval-exhaustive/reincarnation_paradise-chapter.md', book: '诸天无限/轮回乐园', family: 'western_fantasy' },
  { id: 'mansion_secrets', route: '深宅世情月例对牌生存', src: 'data/genre-lab/eval-exhaustive/v2/mansion_secrets-chapter-v2.md', book: '宫斗宅斗/高门主母的驯夫手册.txt', family: 'ancient_romance' },
  { id: 'urban_emotion', route: '陆家嘴投行对赌SPV穿透', src: 'data/genre-lab/eval-exhaustive/urban_emotion-chapter.md', book: '现代职场投行法理尽调', family: 'modern_romance' },
  { id: 'dafeng_gongzhi', route: '大奉打更人儒道断案市井', src: 'data/genre-lab/eval-exhaustive/v2/dafeng_gongzhi-chapter-v2.md', book: '仙侠/大奉打更人 - 卖报小郎君.txt', family: 'xuanhuan' }
];

const destDir = path.join(molanHome, 'data/genre-lab/canonical-19-routes-v2');
fs.mkdirSync(destDir, { recursive: true });

const results = [];
for (const item of SOURCE_MAP) {
  const fullSrc = path.join(molanHome, item.src);
  if (!fs.existsSync(fullSrc)) {
    console.error(`Missing: ${fullSrc}`);
    continue;
  }
  const content = fs.readFileSync(fullSrc, 'utf8');
  const targetFile = path.join(destDir, `${item.id}-canonical-v2.md`);
  fs.writeFileSync(targetFile, content, 'utf8');

  const chars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
  const flavor = computeAiFlavorScore(content);
  const foundCliches = FORBIDDEN_AI_CLICHES.filter(c => content.includes(c));
  const corpus = loadCorpusForFamily(item.family);
  const overlap = checkSourceOverlap(content, corpus.scenes || [], 25);
  const paras = content.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).length;
  const sents = content.split(/[。！？!?；;\n]+/).map(s => s.trim()).filter(Boolean).length;

  results.push({
    id: item.id,
    route: item.route,
    book: item.book,
    chars,
    paras,
    avgSent: (content.length / sents).toFixed(1),
    aiScore: flavor.score,
    cliches: foundCliches.length,
    overlap: overlap.length,
    status: chars >= 2800 && flavor.score === 0 && foundCliches.length === 0 && overlap.length === 0 ? 'PASS 100%' : 'FAIL'
  });
}

console.log('================================================================');
console.log('全系统 19+1 细分叙事路线 Canonical V2 真实章节指标全景审计');
console.log('================================================================');
console.table(results);

const allPass = results.every(r => r.status === 'PASS 100%');
console.log('\n全量路线 100% 达标通过:', allPass);

fs.writeFileSync(path.join(destDir, 'canonical-summary.json'), JSON.stringify(results, null, 2), 'utf8');
console.log(`汇总数据已保存至: ${path.join(destDir, 'canonical-summary.json')}`);
