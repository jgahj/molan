import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INVENTORY_PATH = path.resolve(__dirname, '../data/genre-lab/triplets-inventory.json');
const TRIPLETS_DIR = path.resolve(__dirname, '../data/genre-lab/extracted-triplets');
const OUTPUT_BASE = path.resolve(__dirname, '../data/pipelines/library');
const INDEX_PATH = path.resolve(__dirname, '../data/pipelines/library-index.json');

// Import genre mechanism data
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { GENRE_48_MECHANISMS } = require('../lib/genre-mechanisms-data.js');

const EPISTEMIC_PRESETS = {
  'xuanhuan': {
    charactersDesire: '在宗门法度、世俗秩序与朝堂暗流中争夺修行资源、保全身家性命或探寻隐秘身世',
    charactersConceal: '未报备的古老传承信物、超凡反噬暗伤或足以招致杀身之祸的隐秘底牌',
    blindSpots: '看似寻常的公文差事或同门谈笑背后，早已被不可名状的大网或派系清剿所笼罩',
    irreversibleChange: '日常安宁秩序被超凡突变彻底粉碎、隐秘身份暴露、踏上无法回头的长生死斗之路'
  },
  'urban_martial': {
    charactersDesire: '在都市官方秩序、宗武行会或防务考核中确立合法资历，化解突发险情并护持身边之人',
    charactersConceal: '未在行会备案的高阶功法痕迹、暗中调理的经络隐患或关键保命信物',
    blindSpots: '城市治安监控网的覆盖死角、对手背后的资本派系与更高层级的防务演练暗线',
    irreversibleChange: '当众破局导致身份或底牌暴露、与敌对势力结下不可调和的死仇、被正式卷入更高层级的城市风暴'
  },
  'scifi_apocalypse': {
    charactersDesire: '抢修损坏的辐射滤芯、确保装甲电池续航与安全撤入地下避难所',
    charactersConceal: '最后半支广谱抗辐射血清与未向工会报备的高精度定位仪',
    blindSpots: '矿区深处重度畸变体的捕食频率与母舰撤退协议的真实截止日',
    irreversibleChange: '机械外骨骼液压轴承永久损坏、队友感染度超标与基地权限被锁'
  },
  'suspense': {
    charactersDesire: '查清老宅陈年凶案真相、打破门前引魂邪术与逃离窒息空间',
    charactersConceal: '童年目睹惨剧的记忆残片与私藏的死者绝笔信件',
    blindSpots: '身边看似最体贴的同行者实为当年换魂仪式的既得利益者',
    irreversibleChange: '宗祠底楼密室大门被反锁、心理防线彻底崩溃与真相无法抹除'
  },
  'history': {
    charactersDesire: '在漕运核验中规避弹劾连坐、保全宗族商号与借案立功',
    charactersConceal: '兵部侍郎的暗折密信与私铸劣钱的转运账本',
    blindSpots: '巡抚衙门与东厂番子已在后街布下围网等待两派自相残杀',
    irreversibleChange: '路引被当众销毁、重要证人被灭口与身家性命绑上战车'
  },
  'western_fantasy': {
    charactersDesire: '搜集第二魔药配方的主材料、抑制耳边低语并偿还蒸汽工坊债务',
    charactersConceal: '身上浮现的非凡异化鳞片与私藏的违禁密教手稿',
    blindSpots: '教会值夜者占卜指针早已指向自身、非凡晋升自带的精神污染陷阱',
    irreversibleChange: '人性锚点部分失落、魔药反噬导致永久感官异化与被密教标记'
  },
  'ancient_romance': {
    charactersDesire: '查明母亲当年落水真相、护住胞弟月例份额与争取管家钥匙',
    charactersConceal: '早年收买的账房私账与安插在嫡母房内的耳目丫鬟',
    blindSpots: '老太太对两房争斗心知肚明并以此制衡、退婚文书上的暗记',
    irreversibleChange: '内宅私情被当众挑破、掌家权易主与嫡庶尊卑秩序彻底撕裂'
  },
  'modern_romance': {
    charactersDesire: '拿下对赌轮次融资项目、在合伙人排挤中保住核心技术团队',
    charactersConceal: '对前任合伙人违规操作的知情与内心不愿暴露的软弱病痛',
    blindSpots: '对方看似苛刻的尽调条款实则是为替自己挡掉恶意收购陷阱',
    irreversibleChange: '商业底线被共同守住、防备铠甲卸下与势均力敌的情感契约确立'
  }
};

const FAMILY_ID_MAP = {
  '玄幻修真': 'xuanhuan',
  '都市高武': 'urban_martial',
  '科幻末世': 'scifi_apocalypse',
  '悬疑惊悚': 'suspense',
  '历史古代': 'history',
  '西方奇幻': 'western_fantasy',
  '古言世情': 'ancient_romance',
  '现代言情': 'modern_romance'
};

function extractExemplars(firstText = '', middleText = '') {
  const exemplars = [];
  
  // 1. Opening scene
  const paras1 = firstText.split(/\r?\n/).map(p => p.trim()).filter(p => p.length > 50 && p.length < 350);
  if (paras1.length > 0) {
    exemplars.push({
      sceneType: 'opening_atmospheric_friction',
      annotation: '开篇客观环境物态阻力与行动切入',
      text: paras1[0]
    });
  }

  // 2. Dialogue / confrontation in opening or middle
  const dialogParas = [...paras1, ...middleText.split(/\r?\n/).map(p => p.trim())].filter(p => /“|”|‘|’/.test(p) && p.length > 40 && p.length < 280);
  if (dialogParas.length > 0) {
    exemplars.push({
      sceneType: 'interpersonal_dialogue_tension',
      annotation: '克制对白博弈与利益试探',
      text: dialogParas[0]
    });
  }

  // 3. Climax / physical action from middle chapter
  const parasMid = middleText.split(/\r?\n/).map(p => p.trim()).filter(p => p.length > 60 && p.length < 350);
  if (parasMid.length > 1) {
    exemplars.push({
      sceneType: 'climax_physical_weight',
      annotation: '高潮阶段物理受挫与生死破局',
      text: parasMid[Math.floor(parasMid.length / 2)]
    });
  }

  return exemplars;
}

function synthesizePipeline(bookData) {
  const { bookId, bookTitle, category, family, chapters } = bookData;
  const famId = FAMILY_ID_MAP[family] || 'xuanhuan';
  const mech = GENRE_48_MECHANISMS[category] || {
    coreEngine: '底层求生与突破资源垄断的现实精算',
    frictionConstraints: '环境物理阻力、器械损耗与体制戒律',
    settlementStakes: '核心资源凭证与生存名额',
    taboos: '严禁浮夸无脑装逼打脸、严禁无代价自愈'
  };
  const epistemic = EPISTEMIC_PRESETS[famId] || EPISTEMIC_PRESETS.xuanhuan;

  // Extract author if formatted as "Title - Author"
  let author = '名家精选';
  let title = bookTitle;
  if (bookTitle.includes(' - ')) {
    const parts = bookTitle.split(' - ');
    title = parts[0].trim();
    author = parts[1].trim();
  }

  const firstCh = chapters.first || {};
  const midCh = chapters.middle || {};
  const lastCh = chapters.last || {};

  const exemplars = extractExemplars(firstCh.body || '', midCh.body || '');

  return {
    $schema: 'https://molan.ai/schemas/pipeline-v1.json',
    pipelineId: `pipeline-${bookId}-v1`,
    version: '1.0.0',
    meta: {
      name: `《${title}》9月10日标杆叙事引擎：${category}特化流`,
      genre: `${family} / ${category}`,
      sourceNovel: {
        title,
        author,
        bookId,
        category,
        family,
        totalChapters: bookData.totalChapters,
        samplePointers: {
          firstChapter: firstCh.title,
          midChapter: midCh.title,
          lastChapter: lastCh.title
        }
      },
      coreDrive: `${mech.coreEngine} ➔ ${epistemic.irreversibleChange}`
    },
    macroRhythm: {
      openingPacingModel: {
        targetChapterWordCount: [2500, 3500],
        goldFiveChaptersBlueprint: [
          {
            chapterIndex: 1,
            titlePattern: `【${firstCh.title || '初始入局'} ➔ 严酷物理阻力 ➔ 突发危机破绽】`,
            emotionIntensity: 4,
            tensionCurve: '日常微观生计(3) ➔ 规制摩擦与代价试探(5) ➔ 异象或危机制高点(7) ➔ 警报断章(8)',
            narrativeMission: `确立主角身份、生存环境真实阻力（${mech.frictionConstraints}）；引出核心动机（${epistemic.charactersDesire}）；章末以即时危险强力留钩。`,
            hookType: '生存倒计时或核心底牌受迫暴露威胁'
          },
          {
            chapterIndex: 2,
            titlePattern: '【突围受挫 ➔ 严酷物理损伤 ➔ 果断反制破局】',
            emotionIntensity: 7,
            tensionCurve: '险境封堵(7) ➔ 器械/武力受损(8) ➔ 抓住关键破绽(8) ➔ 惨胜制敌见血(9)',
            narrativeMission: '写实展开第一场生死搏杀或利益碰撞；展现身体受创与物资消耗；绝无空灵闪避，全写物理重量与借力换位。',
            hookType: '线索外泄或敌对势力二阶段更大压迫'
          },
          {
            chapterIndex: 3,
            titlePattern: '【盟友入局 ➔ 隐秘利益账本 ➔ 势力裂隙初显】',
            emotionIntensity: 6,
            tensionCurve: '伤口处理与物资清点(5) ➔ 关键盟友带战略物资入场(7) ➔ 利益分配分歧(7) ➔ 外部围网逼近(8)',
            narrativeMission: `揭开危机背后的体制或利益网（${epistemic.blindSpots}）；确立与盟友的理性合作契约；章末倒计时逼近。`,
            hookType: '因果揭晓与不可逆抉择'
          },
          {
            chapterIndex: 4,
            titlePattern: '【防线撕裂 ➔ 底牌极限出鞘 ➔ 决定性战役】',
            emotionIntensity: 9,
            tensionCurve: '外部重压逼临绝境(8) ➔ 孤立无援(9) ➔ 动用隐秘传承/技术绝杀(10) ➔ 震撼破局(8)',
            narrativeMission: '第一卷最高潮之战；主角在所有人面前兑现不可替代的生存与战斗价值；彻底打破原有压迫平衡。',
            hookType: '阶段性大捷 + 更高阶势力目光投射'
          },
          {
            chapterIndex: 5,
            titlePattern: '【结算战果 ➔ 规则初立 ➔ 新天地大幕展开】',
            emotionIntensity: 7,
            tensionCurve: '战后重组秩序(6) ➔ 结算核心权益（${mech.settlementStakes}）(8) ➔ 确立新地位(7) ➔ 遥望下一重险峰(8)',
            narrativeMission: `第一卷圆满闭环；兑现利益凭证；确立不可动摇的话语权；引出更宏大世界观主线。`,
            hookType: '世界观主线大幕拉开'
          }
        ]
      },
      macroProgressionLaws: {
        crisisDualTrack: `【外部恶劣生存压力】 + 【内部利益与组织制度摩擦（${mech.frictionConstraints}）】，双轨交织。`,
        physicalWeightLaw: '严格遵循客观世界物理规律与生理耐受极限。失血必虚脱、受冻必僵硬、器械受压必形变。严禁无代价自愈。'
      }
    },
    narrativeSlots: {
      protagonistSlot: {
        archetypeRole: `深谙${category}现实规则、沉静果决的求生与破局者`,
        coreTraits: '目光清亮敏锐、作风雷厉克制、做事从不逞口舌之快、身负重担却不宣泄负面情绪',
        voiceSpec: {
          samples: [
            '多余的废话留给能活下来的人说，先把眼前的死局解了。',
            '既然规矩是用来压人的，那就按我的账目重新立规矩。'
          ],
          taboos: [
            mech.taboos,
            '绝不说教与中二叫嚣',
            '不在生死关头冷笑讥讽'
          ]
        },
        tellSpec: {
          anxious: '指尖微扣掌心伤痕，呼吸减缓至平时一半观察破绽',
          focused: '肌肉微紧重心沉于足下，眼神不怒自威凝视关键枢纽',
          grief: '背对众人整理残破衣物或擦拭器械，默不作声'
        }
      }
    },
    causalDebt: {
      trackerRules: [
        '每一次动用底牌或非常规手段破局，必在下一章承担资源亏空或引来审查。',
        '击杀或得罪对手必留下物理痕迹与社会关系牵连。'
      ]
    },
    writingSkillSpec: {
      styleToneId: 'write-high-tension-fiction',
      fewShotExemplars: exemplars
    },
    styleDirectives: {
      prohibitedWords: [
        '眼神一凝', '倒吸一口凉气', '嘴角勾起一抹弧度', '深吸一口气', '恐怖如斯', '眸中闪过一丝异色'
      ],
      encouragedPatterns: [
        '客观物态、公差参数、生理受挫的精准描写',
        '成年人克制、专业、充满潜台词的对白交锋'
      ]
    }
  };
}

async function main() {
  const args = process.argv.slice(2);
  const isFull = args.includes('--full');
  const batchSize = isFull ? Infinity : 50;

  console.log(`Starting pipeline synthesis... (Batch target: ${isFull ? 'All' : batchSize})`);

  if (!fs.existsSync(INVENTORY_PATH)) {
    console.error(`Inventory file not found: ${INVENTORY_PATH}`);
    process.exit(1);
  }

  const { inventory } = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const validBooks = inventory.filter(b => b.success);
  console.log(`Found ${validBooks.length} valid extracted books in inventory.`);

  if (!fs.existsSync(OUTPUT_BASE)) {
    fs.mkdirSync(OUTPUT_BASE, { recursive: true });
  }

  const targets = isFull ? validBooks : validBooks.slice(0, batchSize);
  const generatedIndex = [];
  let count = 0;

  for (const item of targets) {
    count++;
    const safeName = item.bookTitle.replace(/[/\\?%*:|"<>]/g, '_');
    const tripletPath = path.join(TRIPLETS_DIR, item.family, `${safeName}.json`);
    
    if (!fs.existsSync(tripletPath)) {
      continue;
    }

    const tripletData = JSON.parse(fs.readFileSync(tripletPath, 'utf8'));
    const pipeline = synthesizePipeline(tripletData);

    const familyOutDir = path.join(OUTPUT_BASE, item.family);
    if (!fs.existsSync(familyOutDir)) fs.mkdirSync(familyOutDir, { recursive: true });

    const pipelineFile = path.join(familyOutDir, `${safeName}-pipeline.json`);
    fs.writeFileSync(pipelineFile, JSON.stringify(pipeline, null, 2), 'utf8');

    generatedIndex.push({
      bookId: item.bookId,
      bookTitle: item.bookTitle,
      category: item.category,
      family: item.family,
      pipelinePath: path.relative(path.resolve(__dirname, '..'), pipelineFile).replace(/\\/g, '/'),
      exemplarCount: pipeline.writingSkillSpec.fewShotExemplars.length
    });

    if (count % 10 === 0 || count === targets.length) {
      console.log(`Synthesized ${count} / ${targets.length} novel pipelines...`);
    }
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalPipelines: generatedIndex.length,
    pipelines: generatedIndex
  }, null, 2), 'utf8');

  console.log(`\nPipeline synthesis complete!`);
  console.log(`Generated ${generatedIndex.length} pipelines into: ${OUTPUT_BASE}`);
  console.log(`Index written to: ${INDEX_PATH}`);
}

main().catch(console.error);
