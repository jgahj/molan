// scripts/audit-sentence-ai-flavor.mjs
import fs from 'node:fs';
import path from 'node:path';

const molanHome = 'c:/Users/lyh/Desktop/小说专属网页/molan-home';

// 全量纠错库细颗粒度句子级检测规则矩阵
const SENTENCE_RULES = [
  // 1. 声音/目光/情绪实体化与局部主体
  { id: 'S-01-sound-personification', name: '声音实体化', pattern: /(?:声音|低笑|冷笑|话音|叹息)(?:从|自)[^，。！？\n]{0,20}(?:漏(?:出|来)?|飘(?:出|来)?|渗(?:入|出)?|挤出)/g },
  { id: 'S-02-gaze-subject', name: '目光/视线/眼神替代人物主体', pattern: /(?:目光|视线|眼神)[^，。！？\n]{0,10}(?:落在|扫过|投向|移向|停在|望向|转到|冷冷地落在)/g },
  { id: 'S-03-body-subject', name: '指尖/局部器官替代主体做动作', pattern: /(?:指尖|笔尖)[^，。！？\n]{0,10}(?:顿在|停在|划过|落在|做出)/g },
  
  // 2. 动词缩写生硬与语句不完整
  { id: 'S-04-fragmented-verb', name: '单字动词生硬缩写', pattern: /(?:颤|抖|顿)一下/g },
  { id: 'S-05-narrative-mei-shuohua', name: '叙述句口语缩写“没说话”', pattern: /(?:^|[^“'「『])([^\s，。！？\n]{2,6})(?:没说话|没出声|没言语)[^”'」』]/g },
  { id: 'S-06-incomplete-phrase', name: '语句节奏不完整', pattern: /(?:哄笑一片|力量是真实的|喘得说不出整句)/g },

  // 3. 冗余修饰与动作后二次解释
  { id: 'S-07-redundant-facial-backpedal', name: '神态动作后二次压制解释', pattern: /(?:脸色|面色|眼神)[^，。！？\n]{0,8}(?:一沉|微变|一凝|一冷)[，,]又(?:压|收|敛)了回去/g },
  { id: 'S-08-emotion-announcement', name: '空洞告知情绪标签', pattern: /苍老面容上满是心疼|满是心疼和无奈|写满了苦涩|眼中闪过一抹(?:决绝|复杂|痛苦)/g },

  // 4. 烂俗套话比喻
  { id: 'S-09-formulaic-metaphor', name: '烂俗套话比喻', pattern: /(?:如刀|如水|如铁|如风|如鬼魅|如断线风筝|如雷霆|如重锤|苍白如纸|惨白如纸|像谈天气|语气平得像在谈天气|像一柄钉子钉进心头|像一盘散落的棋子|如散落的棋子|泪水如断了线的珠子)/g },
  { id: 'S-10-decorative-quantity', name: '空泛装饰性数量词', pattern: /(?:一丝|一股|一种|一缕)(?:杀意|冷意|寒意|阴鸷|玩味|戏谑|讥诮|自得|傲慢|复杂之色|说不清的情绪)/g },

  // 5. 状语后置与生硬转折
  { id: 'S-11-postposed-state', name: '状态状语后置', pattern: /(?:笑|说|问|语调|声音)[^，。！？\n]{0,6}得很(?:轻|淡|冷|平静)/g },
  { id: 'S-12-negative-sentimentality', name: '否定式对偶煽情', pattern: /不是不想[^，。！？\n]{0,10}而是|不是[^，。！？\n]{1,8}而是[^，。！？\n]{1,8}/g },

  // 6. 同步群体反应与震惊模板
  { id: 'S-13-formulaic-crowd', name: '全场统一震惊模板', pattern: /(?:所有人|全场|众人|在场众人|整个大厅)[^，。！？\n]{0,8}(?:都)?(?:愣住|沉默|哑然|死寂|倒吸一口凉气|惊呆)/g },

  // 7. 嘴角神态与微动作过度设计
  { id: 'S-14-template-smile', name: '模板化笑意/嘴角勾起', pattern: /(?:嘴角|唇角)[^，。！？\n]{0,12}(?:勾起|扯了扯|泛起|浮现)[^，。！？\n]{0,10}(?:一抹)?[^，。！？\n]{0,8}(?:弧度|笑意|冷笑|意味难明)/g },
  { id: 'S-15-micro-actions', name: 'AI典型神经质微动作', pattern: /(?:推了推眼镜|推了下眼镜|揉了揉虎口|捏了捏手指|摸了摸下巴|摸了摸胡茬|咬了咬下唇|抿了抿嘴)/g },

  // 8. 旁白越权与说明文解释堆砌
  { id: 'S-16-narrator-value-judgment', name: '旁白越权价值判断', pattern: /(?:实在不值当|敷衍至极|成长速度太恐怖了|何其恐怖|何其骇人|显然就是|必然是|唯一真相)/g },
  { id: 'S-17-narrator-spoiler-decision', name: '旁白直接剧透心理决定', pattern: /(?:心里已经有了决定|心中已经有了主意|早已做出了决定)/g },
  { id: 'S-18-contrast-cliche', name: 'AI典型对比句装逼框架', pattern: /(?:普通人|常人|寻常人|旁人|外人)(?:未必能|根本无法|很难)[^，。！？\n]{0,15}(?:却太熟悉|却一眼看穿|却再熟悉不过|却心知肚明)/g },

  // 9. 伪精确数字与死板步数
  { id: 'S-19-pseudo-precision', name: '伪精确数字/死板步数', pattern: /(?:每隔[三四五六七八九十]步|北偏东\d+度|下降超过\d+丈|长约[七八九]尺，?宽不到半尺)/g },

  // 10. 套路化伤势与秒表倒数
  { id: 'S-20-formulaic-wound', name: '套路化伤势感知', pattern: /(?:旧伤[^，。！？\n]{0,8}发紧|旧伤在寒气里发紧|疼痛沿着骨缝往上爬|像被重新凿了一遍)/g },
  { id: 'S-21-breath-countdown', name: '动作戏秒表排队倒数', pattern: /第[一二三四五六七八九十]息[，、]/g },
  { id: 'S-22-pupil-cliche', name: '套路化瞳孔反应', pattern: /瞳孔(?:猛然|骤然|剧烈)?(?:收缩|放大|骤缩)/g },

  // 11. 隐形翻译腔与假深沉
  { id: 'S-23-translationese', name: '隐形翻译腔假深沉', pattern: /(?:在这一刻显得格外|无不在昭示着|带着一种不容置疑的|试图去寻找|不得不承认的是|仿佛只要轻轻一碰)/g },
  { id: 'S-24-translationese-loop', name: '连续“没有……只……”翻译腔句式', pattern: /没有(?:回答|接话|看他|理会)[，,]只(?:是)?[^，。！？\n]{2,15}/g },

  // 12. 神经反射式身体套话
  { id: 'S-25-mechanical-reflex', name: '受击神经条件反射套话', pattern: /(?:震得|震得那?)(?:脚底|双脚|双腿|脚掌|虎口|手腕|指尖|指节|胸口|内脏|五脏|耳膜|脑仁)(?:发麻|发木|发颤|生疼|剧痛|刺痛|嗡嗡|翻涌|发紧)|喉头一甜|气血翻涌/g },

  // 13. 骨节发白及变体
  { id: 'S-26-bone-whitening', name: '骨节/指骨/关节发白变体', pattern: /(?:指节|指骨|骨节|关节|指尖|指头|手指|手背|手面)[^，。！？\n]{0,8}(?:泛白|发白|变白|毫无血色|失去血色|硌得发白|捏得发白|攥得发白)/g },

  // 14. 机械节律脉动
  { id: 'S-27-rhythmic-pulsing', name: '机械节律脉动脉冲', pattern: /(?:一下一下地?)(?:收紧|抽痛|跳动|刺痛|挤压)|(?:顺着|随着)脉搏[^，。！？\n]{0,10}(?:收紧|跳动|抽搐|缩紧)/g },

  // 15. 网游任务惩罚公告体
  { id: 'S-28-quest-penalty', name: '网游惩罚通告体', pattern: /(?:若违约|违约者|如若违背|违契者)[，,]?(?:抽取生魂|当为矿奴|抹杀|扣除|炼入煞矿)/g }
];

// 收集所有需审计的目标目录与文件
const TARGET_SETS = [
  {
    name: '【凡人流管线】连续10章独立原创小说《太虚沉煞录》',
    dir: path.join(molanHome, 'data/genre-lab/fanren-10-chapters'),
    pattern: /^ch\d+\.md$/
  },
  {
    name: '【全系统30细分题材管线】Canonical V2 终审章节',
    dir: path.join(molanHome, 'data/genre-lab/canonical-19-routes-v2'),
    pattern: /\.md$/
  }
];

function splitIntoSentences(text) {
  const rawSentences = text.split(/(?<=[。！？!?；;\n])/);
  const result = [];
  let lineNum = 1;
  for (const s of rawSentences) {
    const trimmed = s.trim();
    const newlines = (s.match(/\n/g) || []).length;
    if (trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('>')) {
      result.push({ text: trimmed, lineNum });
    }
    lineNum += newlines;
  }
  return result;
}

function auditFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const sentences = splitIntoSentences(content);
  const fileFindings = [];

  for (const item of sentences) {
    for (const rule of SENTENCE_RULES) {
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(item.text);
      if (match) {
        fileFindings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          matched: match[0],
          sentence: item.text.length > 80 ? item.text.slice(0, 77) + '...' : item.text,
          lineNum: item.lineNum
        });
      }
    }
  }

  return {
    filePath,
    fileName: path.basename(filePath),
    sentenceCount: sentences.length,
    findings: fileFindings
  };
}

async function run() {
  console.log('================================================================');
  console.log('🔍 启动全系统·全管线·逐句级（Sentence-by-Sentence）AI味穿透审计');
  console.log('================================================================\n');

  let totalFiles = 0;
  let totalSentences = 0;
  let totalViolations = 0;
  const allReports = [];

  for (const set of TARGET_SETS) {
    console.log(`>>> 正在扫描目标集: ${set.name}`);
    if (!fs.existsSync(set.dir)) {
      console.warn(`  ⚠ 目录不存在: ${set.dir}`);
      continue;
    }

    const files = fs.readdirSync(set.dir).filter(f => set.pattern.test(f)).sort();
    console.log(`  发现文件数: ${files.length} 篇\n`);

    for (const file of files) {
      const fullPath = path.join(set.dir, file);
      const res = auditFile(fullPath);
      totalFiles++;
      totalSentences += res.sentenceCount;
      totalViolations += res.findings.length;
      allReports.push({ group: set.name, ...res });

      if (res.findings.length === 0) {
        console.log(`  ✔ [PASS] ${file.padEnd(36)} (总句数: ${String(res.sentenceCount).padStart(3)}) | 违规句: 0`);
      } else {
        console.log(`  ❌ [FAIL] ${file.padEnd(36)} (总句数: ${String(res.sentenceCount).padStart(3)}) | 违规句: ${res.findings.length}`);
        for (const f of res.findings) {
          console.log(`     - [行${f.lineNum}] [${f.ruleName}] 命中: "${f.matched}"`);
          console.log(`       整句: "${f.sentence}"`);
        }
      }
    }
    console.log('');
  }

  console.log('================================================================');
  console.log(`📊 逐句级全面穿透审计完成！`);
  console.log(`   - 审计篇数: ${totalFiles} 篇`);
  console.log(`   - 审计总句数: ${totalSentences} 句`);
  console.log(`   - 违规句子总数: ${totalViolations} 处`);
  console.log('================================================================');

  const reportOut = path.join(molanHome, 'data/genre-lab/sentence-audit-report.json');
  fs.writeFileSync(reportOut, JSON.stringify(allReports, null, 2), 'utf8');
  console.log(`详细报告已保存至: ${reportOut}`);
}

run().catch(console.error);
