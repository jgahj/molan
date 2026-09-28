import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEFAULT_INDEX_PATH, DEFAULT_REPORT_PATH, parseArgs } from './export-runtime-contract.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'character-material-v3.1', 'contracts', 'material-safety.validation.json');
const requireFromScript = createRequire(SCRIPT_PATH);
const runtimeModule = requireFromScript(path.join(REPO_ROOT, 'lib', 'character-material.js'));
const SENSITIVE_PATTERN = runtimeModule.SENSITIVE_PATTERN || /露骨|下身|阴茎|阴部|乳房|乳头|性交|做爱|高潮|插入|性器官|呻吟|床笫|媾合|肉棒|精液|裸身|裸体|春药|发情|淫靡|潮吹|奸淫/i;
const UNSUPPORTED_RUNTIME_FIELDS = [
  'rawText',
  'safeText',
  'auditText',
  'scene',
  'relationship',
  'emotionalState',
  'surfaceIntent',
  'subtext',
  'humanTextureSignals',
  'microPattern',
  'microPatterns',
  'antiPattern',
  'antiPatterns'
];

function resolvePath(value, fallback) {
  return value ? path.resolve(process.cwd(), String(value)) : fallback;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取 JSON：${filePath}；${error.message}`);
  }
}

function normalizeForSafety(value) {
  const mapping = new Map([
    ['萬', '万'], ['與', '与'], ['專', '专'], ['業', '业'], ['東', '东'], ['絲', '丝'], ['丟', '丢'], ['兩', '两'], ['個', '个'], ['為', '为'], ['麗', '丽'], ['舉', '举'], ['義', '义'], ['鄉', '乡'], ['書', '书'], ['買', '买'], ['亂', '乱'], ['乾', '干'], ['亞', '亚'], ['從', '从'], ['會', '会'], ['傳', '传'], ['傷', '伤'], ['倫', '伦'], ['佈', '布'], ['佔', '占'], ['併', '并'], ['來', '来'], ['侖', '仑'], ['倉', '仓'], ['們', '们'], ['偵', '侦'], ['側', '侧'], ['偽', '伪'], ['傑', '杰'], ['備', '备'], ['價', '价'], ['儀', '仪'], ['優', '优'], ['兒', '儿'], ['億', '亿'], ['內', '内'], ['冊', '册'], ['寫', '写'], ['軍', '军'], ['農', '农'], ['凍', '冻'], ['凈', '净'], ['準', '准'], ['減', '减'], ['況', '况'], ['決', '决'], ['凱', '凯'], ['刪', '删'], ['別', '别'], ['剛', '刚'], ['創', '创'], ['劃', '划'], ['劇', '剧'], ['劉', '刘'], ['劍', '剑'], ['動', '动'], ['務', '务'], ['勝', '胜'], ['勞', '劳'], ['勢', '势'], ['區', '区'], ['協', '协'], ['卻', '却'], ['厲', '厉'], ['壓', '压'], ['厭', '厌'], ['廁', '厕'], ['廚', '厨'], ['廠', '厂'], ['參', '参'], ['發', '发'], ['叢', '丛'], ['號', '号'], ['後', '后'], ['嗎', '吗'], ['啟', '启'], ['問', '问'], ['單', '单'], ['嘗', '尝'], ['團', '团'], ['園', '园'], ['圓', '圆'], ['圖', '图'], ['國', '国'], ['場', '场'], ['壞', '坏'], ['壯', '壮'], ['聲', '声'], ['夢', '梦'], ['夾', '夹'], ['奮', '奋'], ['姦', '奸'], ['娛', '娱'], ['學', '学'], ['孫', '孙'], ['宮', '宫'], ['寧', '宁'], ['寶', '宝'], ['實', '实'], ['對', '对'], ['導', '导'], ['將', '将'], ['屬', '属'], ['岡', '冈'], ['峽', '峡'], ['崗', '岗'], ['島', '岛'], ['巒', '峦'], ['嶺', '岭'], ['嶽', '岳'], ['巖', '岩'], ['帶', '带'], ['幫', '帮'], ['幹', '干'], ['廣', '广'], ['慶', '庆'], ['庫', '库'], ['應', '应'], ['廳', '厅'], ['廢', '废'], ['開', '开'], ['異', '异'], ['彈', '弹'], ['強', '强'], ['當', '当'], ['錄', '录'], ['徑', '径'], ['復', '复'], ['憂', '忧'], ['憑', '凭'], ['憶', '忆'], ['懷', '怀'], ['懸', '悬'], ['戀', '恋'], ['戰', '战'], ['戶', '户'], ['拋', '抛'], ['擇', '择'], ['掛', '挂'], ['採', '采'], ['揀', '拣'], ['揚', '扬'], ['換', '换'], ['揮', '挥'], ['損', '损'], ['摺', '折'], ['擔', '担'], ['據', '据'], ['擴', '扩'], ['擁', '拥'], ['擠', '挤'], ['攜', '携'], ['數', '数'], ['斷', '断'], ['於', '于'], ['時', '时'], ['暫', '暂'], ['歷', '历'], ['曆', '历'], ['曉', '晓'], ['機', '机'], ['殺', '杀'], ['權', '权'], ['條', '条'], ['構', '构'], ['標', '标'], ['樓', '楼'], ['樂', '乐'], ['歎', '叹'], ['歡', '欢'], ['歲', '岁'], ['歸', '归'], ['殘', '残'], ['毀', '毁'], ['氣', '气'], ['沒', '没'], ['沖', '冲'], ['淺', '浅'], ['測', '测'], ['潔', '洁'], ['滅', '灭'], ['漢', '汉'], ['潛', '潜'], ['灣', '湾'], ['滿', '满'], ['漸', '渐'], ['潤', '润'], ['無', '无'], ['煩', '烦'], ['燈', '灯'], ['燦', '灿'], ['爐', '炉'], ['爭', '争'], ['牽', '牵'], ['狀', '状'], ['獎', '奖'], ['獨', '独'], ['現', '现'], ['環', '环'], ['畫', '画'], ['療', '疗'], ['瘋', '疯'], ['盡', '尽'], ['監', '监'], ['盤', '盘'], ['眾', '众'], ['着', '着'], ['睜', '睁'], ['瞭', '了'], ['矚', '瞩'], ['礙', '碍'], ['礦', '矿'], ['確', '确'], ['碼', '码'], ['禮', '礼'], ['穩', '稳'], ['窩', '窝'], ['竊', '窃'], ['競', '竞'], ['範', '范'], ['簡', '简'], ['簽', '签'], ['糧', '粮'], ['緊', '紧'], ['紅', '红'], ['紋', '纹'], ['紛', '纷'], ['綠', '绿'], ['緒', '绪'], ['線', '线'], ['練', '练'], ['縣', '县'], ['級', '级'], ['紀', '纪'], ['純', '纯'], ['納', '纳'], ['紙', '纸'], ['紹', '绍'], ['終', '终'], ['經', '经'], ['綁', '绑'], ['統', '统'], ['絕', '绝'], ['綜', '综'], ['綱', '纲'], ['網', '网'], ['緩', '缓'], ['綿', '绵'], ['緣', '缘'], ['縱', '纵'], ['績', '绩'], ['繩', '绳'], ['繪', '绘'], ['繼', '继'], ['纏', '缠'], ['缺', '缺'], ['聽', '听'], ['職', '职'], ['聯', '联'], ['聰', '聪'], ['腦', '脑'], ['臟', '脏'], ['臺', '台'], ['興', '兴'], ['舊', '旧'], ['艦', '舰'], ['莊', '庄'], ['華', '华'], ['葉', '叶'], ['著', '著'], ['虛', '虚'], ['術', '术'], ['衛', '卫'], ['見', '见'], ['觀', '观'], ['規', '规'], ['覽', '览'], ['覺', '觉'], ['觸', '触'], ['訂', '订'], ['計', '计'], ['訊', '讯'], ['訣', '诀'], ['訴', '诉'], ['詩', '诗'], ['誠', '诚'], ['話', '话'], ['說', '说'], ['課', '课'], ['調', '调'], ['諸', '诸'], ['謀', '谋'], ['謎', '谜'], ['識', '识'], ['譜', '谱'], ['護', '护'], ['讀', '读'], ['讓', '让'], ['負', '负'], ['財', '财'], ['責', '责'], ['敗', '败'], ['貨', '货'], ['質', '质'], ['賬', '账'], ['賓', '宾'], ['賣', '卖'], ['賤', '贱'], ['賦', '赋'], ['賴', '赖'], ['贊', '赞'], ['趕', '赶'], ['軀', '躯'], ['車', '车'], ['輕', '轻'], ['轉', '转'], ['輪', '轮'], ['轟', '轰'], ['辦', '办'], ['辭', '辞'], ['迴', '回'], ['過', '过'], ['遊', '游'], ['運', '运'], ['還', '还'], ['進', '进'], ['遠', '远'], ['違', '违'], ['醫', '医'], ['醜', '丑'], ['釋', '释'], ['鋪', '铺'], ['銳', '锐'], ['錢', '钱'], ['鍋', '锅'], ['錯', '错'], ['長', '长'], ['門', '门'], ['閒', '闲'], ['間', '间'], ['關', '关'], ['陣', '阵'], ['隊', '队'], ['階', '阶'], ['隨', '随'], ['險', '险'], ['隱', '隐'], ['難', '难'], ['雜', '杂'], ['離', '离'], ['電', '电'], ['霧', '雾'], ['靈', '灵'], ['靜', '静'], ['響', '响'], ['頁', '页'], ['題', '题'], ['顏', '颜'], ['風', '风'], ['飛', '飞'], ['飲', '饮'], ['餘', '余'], ['馮', '冯'], ['驚', '惊'], ['體', '体'], ['髮', '发'], ['鬥', '斗'], ['鬧', '闹'], ['魯', '鲁'], ['魚', '鱼'], ['鳥', '鸟'], ['鳳', '凤'], ['麥', '麦'], ['黃', '黄'], ['齊', '齐'], ['齒', '齿'], ['龍', '龙'], ['龜', '龟'], ['這', '这'], ['際', '际'], ['總', '总'], ['結', '结'], ['試', '试'], ['驗', '验'], ['檢', '检']
  ]);
  return Array.from(String(value == null ? '' : value).normalize('NFKC').toLowerCase())
    .map(character => mapping.get(character) || character)
    .join('')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function allRows(index, bucketName) {
  return [
    ...(Array.isArray(index?.general?.[bucketName]) ? index.general[bucketName] : []),
    ...(Array.isArray(index?.mature?.[bucketName]) ? index.mature[bucketName] : [])
  ];
}

function rawFieldIssues(index) {
  const issues = [];
  for (const bucketName of ['general', 'mature']) {
    const rows = Array.isArray(index?.[bucketName]?.samples) ? index[bucketName].samples : [];
    rows.forEach((row, rowIndex) => {
      for (const field of UNSUPPORTED_RUNTIME_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(row || {}, field)) {
          issues.push({ bucket: bucketName, row: rowIndex, id: row.id || null, field });
        }
      }
    });
  }
  return issues;
}

function validateSampleSafety(rows) {
  const invalidBounds = [];
  const residual = [];
  const sensitive = [];
  const forbiddenLeaks = [];
  for (const sample of rows) {
    const text = String(sample.text || sample.sample || '');
    if (text.length < 12 || text.length > 140) invalidBounds.push({ id: sample.id, length: text.length });
    if (!Array.isArray(sample.residualTerms) || sample.residualTerms.length !== 0) residual.push({ id: sample.id, count: sample.residualTerms?.length || null });
    if (sample.corpus !== 'mature' && SENSITIVE_PATTERN.test(text)) sensitive.push({ id: sample.id });
    const normalizedText = normalizeForSafety(text);
    const terms = Array.isArray(sample.forbiddenTerms) ? sample.forbiddenTerms : [];
    for (const term of terms) {
      const normalizedTerm = normalizeForSafety(term);
      if (normalizedTerm.length >= 2 && normalizedText.includes(normalizedTerm)) {
        forbiddenLeaks.push({ id: sample.id, termHash: hashValue(normalizedTerm) });
      }
    }
  }
  return { invalidBounds, residual, sensitive, forbiddenLeaks };
}

function findOverlaps(rows) {
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    const left = rows[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const right = rows[rightIndex];
      const result = runtimeModule.scanCharacterMaterialOverlap(right.text || right.sample, [left]);
      if (result.overlapFragments.length) {
        overlaps.push({ leftId: left.id, rightId: right.id, fragmentCount: result.overlapFragments.length });
      }
    }
  }
  return overlaps;
}

export function validateMaterialSafety(options = {}) {
  const indexPath = options.indexPath || DEFAULT_INDEX_PATH;
  const reportPath = options.reportPath || DEFAULT_REPORT_PATH;
  const errors = [];
  const warnings = [];
  let index;
  let report;
  let loaded;
  try {
    index = readJson(indexPath);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    report = readJson(reportPath);
  } catch (error) {
    warnings.push(error.message);
  }
  try {
    runtimeModule.resetCharacterMaterialIndexCache();
    loaded = runtimeModule.loadCharacterMaterialIndex({ indexPath });
  } catch (error) {
    errors.push(`运行时样本加载失败：${error.message}`);
  }
  const rows = loaded ? allRows(loaded, 'samples') : [];
  const rawRows = index ? allRows(index, 'samples') : [];
  const sampleSafety = validateSampleSafety(rows);
  const overlap = findOverlaps(rows);
  const rawSampleSafety = validateSampleSafety(rawRows);
  const rawOverlap = findOverlaps(rawRows);
  const unsupportedFields = rawFieldIssues(index);
  if (sampleSafety.invalidBounds.length) errors.push(`运行时样本长度不在 12-140：${sampleSafety.invalidBounds.length}`);
  if (sampleSafety.residual.length) errors.push(`运行时样本 residualTerms 非空：${sampleSafety.residual.length}`);
  if (sampleSafety.sensitive.length) errors.push(`general 运行时样本命中敏感词：${sampleSafety.sensitive.length}`);
  if (sampleSafety.forbiddenLeaks.length) errors.push(`运行时样本包含 forbiddenTerms：${sampleSafety.forbiddenLeaks.length}`);
  if (overlap.length) errors.push(`运行时样本存在 12 字连续重合：${overlap.length}`);
  if (rawSampleSafety.invalidBounds.length) errors.push(`index 原始样本长度不在 12-140：${rawSampleSafety.invalidBounds.length}`);
  if (rawSampleSafety.residual.length) errors.push(`index 原始样本 residualTerms 非空：${rawSampleSafety.residual.length}`);
  if (rawSampleSafety.sensitive.length) errors.push(`index 原始 general 样本命中敏感词：${rawSampleSafety.sensitive.length}`);
  if (rawSampleSafety.forbiddenLeaks.length) errors.push(`index 原始样本包含 forbiddenTerms：${rawSampleSafety.forbiddenLeaks.length}`);
  if (rawOverlap.length) errors.push(`index 原始样本存在 12 字连续重合：${rawOverlap.length}`);
  if (unsupportedFields.length) errors.push(`runtime index 样本包含 rich/offline 字段：${unsupportedFields.length}`);

  const fullResidualRate = report?.fullResidualRate ?? report?.audit?.fullResidualRate;
  if (Number.isFinite(Number(fullResidualRate)) && Number(fullResidualRate) !== 0) {
    errors.push(`quality report fullResidualRate 非 0：${fullResidualRate}`);
  }
  if (report?.audit?.strongSamplesPublished === true && Number(report.manualReview?.residualRate) > 0) {
    errors.push(`已发布 strong 样本的人工残留率非 0：${report.manualReview.residualRate}`);
  }
  if (Number(report?.counts?.residualNameCandidates || 0) > 0) {
    warnings.push(`quality report 仍记录 residualNameCandidates：${report.counts.residualNameCandidates}`);
  }
  runtimeModule.resetCharacterMaterialIndexCache();
  return {
    validationVersion: 'molan-character-material-safety-v3.1-stage0',
    pass: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    inputs: { indexPath, reportPath },
    checks: {
      runtimeSampleCount: rows.length,
      rawIndexSampleCount: rawRows.length,
      bounds: { pass: sampleSafety.invalidBounds.length === 0, invalid: sampleSafety.invalidBounds },
      residualTerms: { pass: sampleSafety.residual.length === 0, invalid: sampleSafety.residual },
      sensitiveTerms: { pass: sampleSafety.sensitive.length === 0, invalid: sampleSafety.sensitive },
      forbiddenTerms: { pass: sampleSafety.forbiddenLeaks.length === 0, invalid: sampleSafety.forbiddenLeaks },
      continuousOverlap12: { pass: overlap.length === 0, invalid: overlap },
      rawContinuousOverlap12: { pass: rawOverlap.length === 0, invalid: rawOverlap },
      rawIndexSafety: {
        pass: rawSampleSafety.invalidBounds.length === 0
          && rawSampleSafety.residual.length === 0
          && rawSampleSafety.sensitive.length === 0
          && rawSampleSafety.forbiddenLeaks.length === 0,
        bounds: rawSampleSafety.invalidBounds,
        residualTerms: rawSampleSafety.residual,
        sensitiveTerms: rawSampleSafety.sensitive,
        forbiddenTerms: rawSampleSafety.forbiddenLeaks
      },
      runtimeFields: { pass: unsupportedFields.length === 0, invalid: unsupportedFields },
      reportFullResidualRate: { pass: !Number.isFinite(Number(fullResidualRate)) || Number(fullResidualRate) === 0, value: fullResidualRate ?? null }
    }
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/validate-material-safety.mjs [--validate] [--write] [--index path] [--report path] [--out path]');
    return 0;
  }
  const result = validateMaterialSafety({
    indexPath: resolvePath(options.index, DEFAULT_INDEX_PATH),
    reportPath: resolvePath(options.report, DEFAULT_REPORT_PATH)
  });
  if (options.write === true) writeJson(resolvePath(options.out || options.output, DEFAULT_OUTPUT_PATH), result);
  console.log(JSON.stringify(result, null, 2));
  return result.pass ? 0 : 1;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  process.exitCode = main();
}

export { DEFAULT_OUTPUT_PATH, normalizeForSafety, findOverlaps };
