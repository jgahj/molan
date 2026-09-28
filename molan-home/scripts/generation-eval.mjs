import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './export-runtime-contract.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_EVAL_DIR = path.join(REPO_ROOT, 'data', 'character-material-v3.1', 'eval');
const DEFAULT_PROMPTS_PATH = path.join(DEFAULT_EVAL_DIR, 'prompts.jsonl');
const DEFAULT_BASELINE_PATH = path.join(DEFAULT_EVAL_DIR, 'baseline.jsonl');
const DEFAULT_MATERIAL_PATH = path.join(DEFAULT_EVAL_DIR, 'material.jsonl');
const DEFAULT_SCORES_PATH = path.join(DEFAULT_EVAL_DIR, 'scores.jsonl');
const DEFAULT_METRICS_PATH = path.join(DEFAULT_EVAL_DIR, 'metrics.json');
const DEFAULT_REPORT_PATH_OUT = path.join(DEFAULT_EVAL_DIR, 'report.json');
const DEFAULT_REPORT_MARKDOWN_PATH = path.join(DEFAULT_EVAL_DIR, 'report.md');
const DEFAULT_SEED = 3101;
const DEFAULT_EVALUATION_STAGE = '0.5';

const COMMON_REQUIREMENTS = '要求：写 180-300 字，保持剧情条件不变；通过可观察的动作、对白和细节呈现人物，不直接解释完整心理；避免“眼中闪过”“不由得”“顿时”“微微一笑”等模板化表达。';

const FIXED_SCENE_DEFINITIONS = Object.freeze([
  Object.freeze({ id: '01-daily-interaction', name: '日常互动', prompts: [
    '人物：一个做事利落、说话直接的合租室友。场景：两人下班后发现冰箱里只剩一盒饭，他先拿起了锅。',
    '人物：一个习惯把物品摆得整齐的姐姐。场景：弟弟借走她的充电器又忘了归还，她在门口堵住他。',
    '人物：一个嘴上嫌麻烦却总会帮忙的同事。场景：午休时新人把咖啡洒在文件上，他刚好经过。'
  ] }),
  Object.freeze({ id: '02-first-meeting', name: '初次见面', prompts: [
    '人物：一个谨慎寡言的调查员。场景：他在旧书店第一次见到主动提供线索的陌生人。',
    '人物：一个表面随和、实际很会观察的谈判代表。场景：她在车站与临时合作对象交换第一句话。',
    '人物：一个不擅长寒暄但记忆力很好的医生。场景：他在诊室门口认出多年未见的患者。'
  ] }),
  Object.freeze({ id: '03-familiar-chat', name: '熟人闲聊', prompts: [
    '人物：两个相识多年的朋友，其中一人最近隐瞒了换工作的事。场景：他们在便利店门口闲聊。',
    '人物：一个总爱开玩笑的哥哥。场景：妹妹一边收拾行李一边避开关于恋人的问题。',
    '人物：一个冷淡但熟悉对方习惯的搭档。场景：两人在等电梯时谈起昨晚谁没有睡好。'
  ] }),
  Object.freeze({ id: '04-awkwardness', name: '尴尬', prompts: [
    '人物：一个平时很会控场的主持人。场景：他把嘉宾的名字叫错，现场短暂安静。',
    '人物：一个习惯把话说得很满的学生。场景：她发现自己误解了朋友的暗示，只能在雨棚下解释。',
    '人物：一个看起来从容的上司。场景：他在会议上被下属当众指出忘记签字。'
  ] }),
  Object.freeze({ id: '05-contained-anger', name: '生气但克制', prompts: [
    '人物：一个习惯先收集证据再发火的人。场景：他发现搭档擅自改动了共同的计划。',
    '人物：一个重视体面的店主。场景：顾客在众人面前指责她，却拿不出订单记录。',
    '人物：一个不愿把怒气带回家的父亲。场景：他在饭桌上接到一通让人失望的电话。'
  ] }),
  Object.freeze({ id: '06-disappointment', name: '失望', prompts: [
    '人物：一个很少求人、对承诺记得很清楚的人。场景：约好见面的人没有出现。',
    '人物：一个为了比赛准备很久的新人。场景：她看见最终名单，却没有自己的名字。',
    '人物：一个仍想替朋友找理由的人。场景：他发现朋友把关键消息单独告诉了别人。'
  ] }),
  Object.freeze({ id: '07-jealousy', name: '吃醋', prompts: [
    '人物：一个不肯承认在意的恋人。场景：对方在聚会上和旧识聊得很投机。',
    '人物：一个平时大方的搭档。场景：他发现新来的同事知道对方的秘密习惯。',
    '人物：一个擅长用玩笑遮掩情绪的人。场景：她看见喜欢的人把外套递给了别人。'
  ] }),
  Object.freeze({ id: '08-defensive-care', name: '关心但嘴硬', prompts: [
    '人物：一个不习惯说软话的男人。场景：女主手上受伤，他刚知道。',
    '人物：一个总说“随便你”的姐姐。场景：弟弟发烧还要出门，她把药放到了门边。',
    '人物：一个把担心藏在安排里的队长。场景：队员坚持独自去危险地点，他必须阻止对方。'
  ] }),
  Object.freeze({ id: '09-misunderstood', name: '被误解', prompts: [
    '人物：一个习惯先做事后解释的人。场景：他刚替同伴承担责任，却被认为是在抢功。',
    '人物：一个不愿透露真实目的的记者。场景：同事看见她删除采访录音，以为她收了好处。',
    '人物：一个表达笨拙但很重承诺的人。场景：朋友把他的沉默当成拒绝。'
  ] }),
  Object.freeze({ id: '10-lying', name: '撒谎', prompts: [
    '人物：一个平时说话很精确的人。场景：他必须向熟人隐瞒自己昨晚去过某处。',
    '人物：一个为了保护同伴而撒谎的学生。场景：老师拿着被打碎的窗户来问话。',
    '人物：一个不擅长编故事却想维持体面的人。场景：她的手机在桌上响起，来电显示暴露了漏洞。'
  ] }),
  Object.freeze({ id: '11-unfinished-thought', name: '欲言又止', prompts: [
    '人物：一个已经决定离开却没有说出口的人。场景：对方问他明天是否还会来。',
    '人物：一个想道歉但不愿示弱的朋友。场景：两人在关店后一起走到街口。',
    '人物：一个发现真相却担心破坏关系的女儿。场景：她在病房里看着父亲睡醒。'
  ] }),
  Object.freeze({ id: '12-relationship-probe', name: '关系试探', prompts: [
    '人物：一个从不先问“你在想什么”的人。场景：他想确认暧昧对象是否还愿意继续合作。',
    '人物：一个习惯把问题绕远的人。场景：她借谈工作试探朋友是否听说了自己的离职。',
    '人物：一个看似随口、实际很在意答案的上司。场景：他问下属周末是否和那位竞争者见过面。'
  ] }),
  Object.freeze({ id: '13-conflict', name: '冲突', prompts: [
    '人物：一个遇事先护住证据的人。场景：搭档要求他立刻公开尚未核实的消息。',
    '人物：一个不愿退让但知道力量悬殊的店主。场景：对方带人来店里逼她交出账本。',
    '人物：两个都认为自己在保护团队的朋友。场景：他们在出发前争夺唯一一把钥匙。'
  ] }),
  Object.freeze({ id: '14-reconciliation', name: '和解', prompts: [
    '人物：两个刚说过重话的旧友。场景：其中一人把修好的旧物放在对方面前。',
    '人物：一个不善于认错但愿意补偿的人。场景：他在清晨的厨房里等对方醒来。',
    '人物：一个仍有戒心的搭档。场景：对方承认错误，却没有要求立刻被原谅。'
  ] }),
  Object.freeze({ id: '15-reunion', name: '重逢', prompts: [
    '人物：一个以为自己已经放下往事的人。场景：他在办事大厅重新见到多年未见的旧友。',
    '人物：一个离开故乡后很少回头的人。场景：她在夜班车上认出曾经的邻居。',
    '人物：一个曾经被留下的人。场景：那个人带着与当年相同的伞站在门外。'
  ] }),
  Object.freeze({ id: '16-farewell', name: '离别', prompts: [
    '人物：一个不愿把离别说成永别的人。场景：他在站台把车票递回给同行者。',
    '人物：一个习惯提前安排好一切的人。场景：她把钥匙和一张便签交给即将远行的朋友。',
    '人物：一个嘴上说不送、实际提前到了的人。场景：清晨机场广播开始播报登机。'
  ] }),
  Object.freeze({ id: '17-failure', name: '失败', prompts: [
    '人物：一个把结果看得很重的负责人。场景：他确认计划彻底失败，队员都在等他下令。',
    '人物：一个第一次独自承担后果的新人。场景：她回到空荡的工作室，桌上还留着失败的方案。',
    '人物：一个平常总能找到补救办法的人。场景：他发现最后一条退路也被封死。'
  ] }),
  Object.freeze({ id: '18-victory', name: '胜利', prompts: [
    '人物：一个赢了也不习惯庆祝的人。场景：比赛结束后，队友把奖牌塞到他手里。',
    '人物：一个一直被低估的谈判者。场景：她拿到签字后的合同，却先去确认对手的表情。',
    '人物：一个把胜利视为起点的人。场景：众人欢呼时，他发现桌上还有一份未处理的名单。'
  ] }),
  Object.freeze({ id: '19-solitude', name: '独处', prompts: [
    '人物：一个在人群中很会应付、独处时才放松的人。场景：夜里办公室只剩他一人。',
    '人物：一个把日程排得很满的人。场景：她突然得到一个没有安排的下午。',
    '人物：一个不愿承认自己在等消息的人。场景：他独自坐在亮着屏幕的客厅里。'
  ] }),
  Object.freeze({ id: '20-public-disguise', name: '公共场合伪装', prompts: [
    '人物：一个必须在人前保持亲密的竞争者。场景：两人在颁奖礼上并肩接受采访。',
    '人物：一个刚经历争执却要主持公开会议的负责人。场景：对方坐在台下第一排。',
    '人物：一个不能让旁人看出害怕的证人。场景：她在拥挤的大厅里等候传唤。'
  ] })
]);

const SCORE_KEYS = Object.freeze(['naturalness', 'individuality', 'subtext', 'dialogue', 'emotionalEffect', 'readability', 'aiFlavor']);
const POSITIVE_SCORE_KEYS = Object.freeze(['naturalness', 'individuality', 'subtext', 'dialogue', 'emotionalEffect', 'readability']);
const TEMPLATE_PATTERNS = Object.freeze(['眼中闪过', '不由得', '顿时', '微微一笑', '仿佛', '只见', '一时间', '心中一动']);
const DIRECT_EMOTION_PATTERNS = Object.freeze(['他很生气', '她很生气', '他很难过', '她很难过', '他感到', '她感到', '他非常', '她非常', '内心充满']);
const ACTION_PATTERNS = Object.freeze(['拿', '放', '转身', '停', '看', '移', '握', '松开', '靠', '退', '抬', '低头', '收起', '翻', '递', '推', '按', '等']);
const CONCRETE_PATTERNS = Object.freeze(['杯', '门', '钥匙', '手机', '纸', '灯', '雨', '风', '衣服', '鞋', '桌', '椅', '车', '药', '文件', '窗', '伞', '票', '屏幕', '声音']);
const SUBTEXT_PATTERNS = Object.freeze(['却', '只是', '还是', '随你', '没事', '不用', '算了', '当然', '你先', '我只是', '如果']);

function resolvePath(value, fallback) {
  return value ? path.resolve(process.cwd(), String(value)) : fallback;
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function jsonl(values) {
  return `${values.map(value => JSON.stringify(value)).join('\n')}\n`;
}

function countPatterns(text, patterns) {
  return patterns.reduce((count, pattern) => count + (String(text).split(pattern).length - 1), 0);
}

function clampScore(value) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function stripSpaces(text) {
  return Array.from(String(text || '').replace(/[\s\r\n]+/gu, ''));
}

function sentenceLengths(text) {
  return String(text || '').split(/[。！？!?；;]+/u)
    .map(value => stripSpaces(value).length)
    .filter(Boolean);
}

function repeatedNgramRate(chars, size = 4) {
  if (chars.length < size * 2) return 0;
  const counts = new Map();
  for (let index = 0; index <= chars.length - size; index += 1) {
    const gram = chars.slice(index, index + size).join('');
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  const repeated = [...counts.values()].reduce((sum, count) => sum + (count > 1 ? count - 1 : 0), 0);
  return repeated / Math.max(1, counts.size);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function variance(values, average) {
  return values.length ? mean(values.map(value => (value - average) ** 2)) : 0;
}

export function buildPromptSet() {
  return FIXED_SCENE_DEFINITIONS.flatMap((scene, sceneIndex) => scene.prompts.map((body, promptIndex) => ({
    promptId: `prompt-${String(sceneIndex * 3 + promptIndex + 1).padStart(3, '0')}`,
    categoryId: scene.id,
    category: scene.name,
    prompt: `${body}${COMMON_REQUIREMENTS}`,
    fixed: true,
    constraints: { minChars: 180, maxChars: 300, materialInjected: false }
  })));
}

export function validatePromptSet(prompts) {
  const expected = buildPromptSet();
  const errors = [];
  if (!Array.isArray(prompts)) errors.push('prompts 必须是数组');
  const rows = Array.isArray(prompts) ? prompts : [];
  if (rows.length !== expected.length) errors.push(`prompt 数量应为 ${expected.length}，实际为 ${rows.length}`);
  const expectedById = new Map(expected.map(row => [row.promptId, row]));
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      errors.push('prompt 行不是对象');
      continue;
    }
    if (!row.promptId || seen.has(row.promptId)) errors.push(`promptId 缺失或重复：${row.promptId || ''}`);
    seen.add(row.promptId);
    const expectedRow = expectedById.get(row.promptId);
    if (!expectedRow) {
      errors.push(`存在未知 promptId：${row.promptId}`);
      continue;
    }
    if (row.categoryId !== expectedRow.categoryId || row.category !== expectedRow.category || row.prompt !== expectedRow.prompt) {
      errors.push(`固定 prompt 内容被修改：${row.promptId}`);
    }
  }
  for (const row of expected) if (!seen.has(row.promptId)) errors.push(`缺少固定 prompt：${row.promptId}`);
  const categoryCounts = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1);
  }
  if (categoryCounts.size !== FIXED_SCENE_DEFINITIONS.length) errors.push(`场景类别应为 ${FIXED_SCENE_DEFINITIONS.length} 类，实际为 ${categoryCounts.size} 类`);
  for (const scene of FIXED_SCENE_DEFINITIONS) if (categoryCounts.get(scene.name) !== 3) errors.push(`场景 ${scene.name} 应有 3 条 prompt`);
  return { pass: errors.length === 0, errors: [...new Set(errors)], promptCount: rows.length, categoryCount: categoryCounts.size };
}

export function writePromptSet(filePath = DEFAULT_PROMPTS_PATH) {
  const prompts = buildPromptSet();
  writeText(filePath, jsonl(prompts));
  return { path: filePath, promptCount: prompts.length, categoryCount: FIXED_SCENE_DEFINITIONS.length };
}

function readPromptFile(filePath) {
  if (!fs.existsSync(filePath)) {
    const prompts = buildPromptSet();
    return { prompts, source: 'fixed-catalog', missing: true, errors: [], validation: validatePromptSet(prompts) };
  }
  const rows = [];
  const errors = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      errors.push(`prompts 第 ${index + 1} 行 JSON 无效：${error.message}`);
    }
  });
  return { prompts: rows, source: filePath, missing: false, errors, validation: validatePromptSet(rows) };
}

function outputText(row) {
  if (typeof row === 'string') return row.trim();
  if (!row || typeof row !== 'object') return '';
  for (const key of ['output', 'text', 'content', 'generation', 'response']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      if (typeof value.text === 'string' && value.text.trim()) return value.text.trim();
      if (typeof value.content === 'string' && value.content.trim()) return value.content.trim();
      if (Array.isArray(value.content)) {
        const content = value.content.map(item => typeof item === 'string' ? item : item?.text || '').join('').trim();
        if (content) return content;
      }
    }
  }
  return '';
}

function readOutputFile(filePath, prompts) {
  if (!fs.existsSync(filePath)) return { available: false, rows: [], map: new Map(), errors: [], missing: true };
  const rows = [];
  const map = new Map();
  const promptIds = new Set((Array.isArray(prompts) ? prompts : []).map(prompt => String(prompt?.promptId || '').trim()).filter(Boolean));
  const errors = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      errors.push(`模型输出 ${filePath} 第 ${index + 1} 行 JSON 无效：${error.message}`);
      return;
    }
    const promptId = row && typeof row === 'object' && row.promptId
      ? String(row.promptId).trim()
      : '';
    if (!promptId) {
      errors.push(`模型输出 ${filePath} 第 ${index + 1} 行缺少 promptId`);
      return;
    }
    if (!promptIds.has(promptId)) {
      errors.push(`模型输出 ${filePath} 第 ${index + 1} 行使用未知 promptId：${promptId}`);
      return;
    }
    if (map.has(promptId)) errors.push(`模型输出 ${filePath} 存在重复 promptId：${promptId}`);
    const normalized = { promptId, text: outputText(row) };
    rows.push(normalized);
    map.set(promptId, normalized);
  });
  return { available: true, rows, map, errors, missing: false };
}

export function scoreGenerationText(text, prompt = {}) {
  const chars = stripSpaces(text);
  const source = chars.join('');
  const lengths = sentenceLengths(text);
  const average = mean(lengths);
  const standardDeviation = Math.sqrt(variance(lengths, average));
  const templateHits = countPatterns(source, TEMPLATE_PATTERNS);
  const directEmotionHits = countPatterns(source, DIRECT_EMOTION_PATTERNS);
  const actionHits = countPatterns(source, ACTION_PATTERNS);
  const concreteHits = countPatterns(source, CONCRETE_PATTERNS);
  const subtextHits = countPatterns(source, SUBTEXT_PATTERNS);
  const repeatedRate = repeatedNgramRate(chars);
  const quoteCount = (source.match(/[“”"「」『』]/gu) || []).length;
  const dialogueTurns = Math.floor(quoteCount / 2);
  const lengthFit = chars.length >= 180 && chars.length <= 300 ? 1 : chars.length >= 120 && chars.length <= 360 ? 0.3 : -0.8;
  const variedSentences = lengths.length >= 2 && standardDeviation >= 3 ? 0.7 : (lengths.length >= 2 ? 0.1 : -0.3);
  const tooUniform = lengths.length >= 3 && standardDeviation < 1.5 ? 0.7 : 0;
  const promptCategory = String(prompt.category || '');
  const hasConflictCue = /冲突|生气|失望|吃醋|误解|撒谎|试探|离别|失败/u.test(promptCategory);
  const naturalness = clampScore(3 + lengthFit + variedSentences + Math.min(0.6, concreteHits * 0.08) - templateHits * 0.65 - repeatedRate * 0.08);
  const individuality = clampScore(2.3 + Math.min(1.7, concreteHits * 0.12 + actionHits * 0.06) + (subtextHits > 0 ? 0.3 : 0) - templateHits * 0.3);
  const subtext = clampScore(2.2 + Math.min(2, subtextHits * 0.24 + (directEmotionHits === 0 && actionHits > 0 ? 0.45 : 0)) + (hasConflictCue ? 0.15 : 0));
  const dialogue = clampScore(2.3 + Math.min(2, dialogueTurns * 0.55 + (dialogueTurns >= 2 ? 0.35 : 0)) - (dialogueTurns === 0 && /对白|说|问|回答/u.test(source) ? 0.4 : 0));
  const emotionalEffect = clampScore(2.4 + Math.min(1.8, subtextHits * 0.18 + actionHits * 0.05 + (hasConflictCue ? 0.25 : 0)) - directEmotionHits * 0.3);
  const readability = clampScore(3 + lengthFit - tooUniform - templateHits * 0.35 - repeatedRate * 0.06 - (average > 80 ? 0.5 : 0));
  const aiFlavor = clampScore(2.4 + templateHits * 0.7 + directEmotionHits * 0.35 + tooUniform + repeatedRate * 0.08 - Math.min(0.9, concreteHits * 0.05) - (variedSentences > 0.5 ? 0.25 : 0));
  return {
    naturalness,
    individuality,
    subtext,
    dialogue,
    emotionalEffect,
    readability,
    aiFlavor
  };
}

function hashToUint(value) {
  return Number.parseInt(crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16) >>> 0;
}

export function deterministicBlindOrder(promptId, seed = DEFAULT_SEED) {
  return (hashToUint(`${seed}:${promptId}`) & 1) === 0 ? ['A', 'B'] : ['B', 'A'];
}

function asOutputMap(value) {
  if (value instanceof Map) return value;
  const map = new Map();
  for (const row of Array.isArray(value) ? value : []) {
    const promptId = String(row?.promptId || row?.id || '').trim();
    const text = outputText(row);
    if (promptId) map.set(promptId, { promptId, text });
  }
  return map;
}

function qualityTotal(scores) {
  return POSITIVE_SCORE_KEYS.reduce((sum, key) => sum + Number(scores[key] || 0), 0) + (6 - Number(scores.aiFlavor || 3));
}

export function evaluateGenerationPairs({ prompts, baseline, material, seed = DEFAULT_SEED } = {}) {
  const baselineMap = asOutputMap(baseline);
  const materialMap = asOutputMap(material);
  const rows = (Array.isArray(prompts) ? prompts : []).map((prompt, index) => {
    const promptId = String(prompt?.promptId || `prompt-${String(index + 1).padStart(3, '0')}`);
    const a = baselineMap.get(promptId);
    const b = materialMap.get(promptId);
    const aText = a?.text || '';
    const bText = b?.text || '';
    const missing = [];
    if (!aText) missing.push('baseline');
    if (!bText) missing.push('material');
    const blindOrder = deterministicBlindOrder(promptId, seed);
    if (missing.length) {
      return {
        evalId: `eval-${promptId}`,
        promptId,
        categoryId: prompt.categoryId || '',
        category: prompt.category || '',
        versionA: 'baseline',
        versionB: 'character-material-v3.1',
        blindOrder,
        status: 'pending',
        pendingReason: missing.map(value => `${value}_output_missing`),
        scores: null,
        winner: null,
        claimable: false,
        evaluator: 'deterministic-proxy-v1'
      };
    }
    const scoresA = scoreGenerationText(aText, prompt);
    const scoresB = scoreGenerationText(bText, prompt);
    const totalA = qualityTotal(scoresA);
    const totalB = qualityTotal(scoresB);
    const winner = totalB === totalA ? 'tie' : totalB > totalA ? 'B' : 'A';
    return {
      evalId: `eval-${promptId}`,
      promptId,
      categoryId: prompt.categoryId || '',
      category: prompt.category || '',
      versionA: 'baseline',
      versionB: 'character-material-v3.1',
      blindOrder,
      status: 'scored',
      scores: { A: scoresA, B: scoresB },
      totals: { A: totalA, B: totalB },
      deltas: Object.fromEntries(SCORE_KEYS.map(key => [key, scoresB[key] - scoresA[key]])),
      winner,
      claimable: false,
      evaluator: 'deterministic-proxy-v1'
    };
  });
  return rows;
}

export function aggregateEvaluationMetrics(scores = [], options = {}) {
  const { seed = DEFAULT_SEED, promptCount = Array.isArray(scores) ? scores.length : 0, evaluationStage = DEFAULT_EVALUATION_STAGE } = options;
  const rows = Array.isArray(scores) ? scores : [];
  const complete = rows.filter(row => row.status === 'scored' && row.scores?.A && row.scores?.B);
  const pending = rows.filter(row => row.status === 'pending');
  const means = { A: {}, B: {} };
  const deltas = {};
  for (const key of SCORE_KEYS) {
    means.A[key] = Number(mean(complete.map(row => row.scores.A[key])).toFixed(4));
    means.B[key] = Number(mean(complete.map(row => row.scores.B[key])).toFixed(4));
    deltas[key] = Number((means.B[key] - means.A[key]).toFixed(4));
  }
  const count = predicate => complete.filter(predicate).length;
  const bWins = count(row => row.winner === 'B');
  const aWins = count(row => row.winner === 'A');
  const ties = count(row => row.winner === 'tie');
  const denominator = complete.length || 0;
  const ratio = value => denominator ? Number((value / denominator).toFixed(4)) : null;
  return {
    evaluationVersion: `molan-character-generation-eval-v3.1-stage${evaluationStage}`,
    stageId: evaluationStage,
    evaluator: 'deterministic-proxy-v1',
    seed,
    promptCount,
    completePairCount: complete.length,
    pendingPairCount: pending.length,
    status: pending.length || !complete.length ? 'pending' : 'proxy-only',
    means,
    meanDelta: deltas,
    winnerCounts: { B: bWins, A: aWins, tie: ties },
    bWinRate: ratio(bWins),
    aiFlavorDecreaseRate: ratio(count(row => row.scores.B.aiFlavor < row.scores.A.aiFlavor)),
    readabilityDecreaseRate: ratio(count(row => row.scores.B.readability < row.scores.A.readability)),
    individualityImprovementRate: ratio(count(row => row.scores.B.individuality > row.scores.A.individuality)),
    dialogueImprovementRate: ratio(count(row => row.scores.B.dialogue > row.scores.A.dialogue)),
    subtextImprovementRate: ratio(count(row => row.scores.B.subtext > row.scores.A.subtext)),
    naturalnessImprovementRate: ratio(count(row => row.scores.B.naturalness > row.scores.A.naturalness)),
    claimable: false,
    humanReviewRequired: true,
    limitations: [
      '当前分数是可复现的字符串特征 proxy，不是人类盲评或模型裁判结果。',
      '缺少任一侧模型输出的 prompt 保持 pending，不以空文本代替。',
      '在完成真实人工盲评前，不据此宣称素材库带来收益。'
    ]
  };
}

function outputFileStatus(filePath, input) {
  return {
    path: filePath,
    available: input.available,
    rowCount: input.rows.length,
    errorCount: input.errors.length,
    missing: input.missing
  };
}

function makeMarkdownReport(report) {
  const metrics = report.metrics;
  const statusText = report.status === 'pending'
    ? '待补齐模型输出'
    : '已完成确定性 proxy 计算，待人工盲评';
  return [
    '# Stage 0 Generation Evaluation',
    '',
    `状态：${statusText}`,
    '',
    `- Prompt：${report.promptCount}`,
    `- 完整 A/B 对：${metrics.completePairCount}`,
    `- Pending：${metrics.pendingPairCount}`,
    `- evaluator：${metrics.evaluator}`,
    `- seed：${metrics.seed}`,
    '',
    '## 事实边界',
    '',
    report.interpretation,
    '',
    '## Metrics',
    '',
    '```json',
    JSON.stringify(metrics, null, 2),
    '```',
    '',
    '## 人工盲评问题',
    '',
    ...report.humanReviewQuestions.map((question, index) => `${index + 1}. ${question}`),
    ''
  ].join('\n');
}

export function runGenerationEvaluation(options = {}) {
  const outputDir = options.outputDir || DEFAULT_EVAL_DIR;
  const promptsPath = options.promptsPath || path.join(outputDir, 'prompts.jsonl');
  const baselinePath = options.baselinePath || path.join(outputDir, 'baseline.jsonl');
  const materialPath = options.materialPath || path.join(outputDir, 'material.jsonl');
  const seed = options.seed ?? DEFAULT_SEED;
  const evaluationStage = String(options.evaluationStage || DEFAULT_EVALUATION_STAGE);
  const promptInput = readPromptFile(promptsPath);
  const baselineInput = readOutputFile(baselinePath, promptInput.prompts);
  const materialInput = readOutputFile(materialPath, promptInput.prompts);
  const scores = evaluateGenerationPairs({
    prompts: promptInput.prompts,
    baseline: baselineInput.map,
    material: materialInput.map,
    seed
  });
  const metrics = aggregateEvaluationMetrics(scores, { seed, promptCount: promptInput.prompts.length, evaluationStage });
  const inputErrors = [...promptInput.errors, ...promptInput.validation.errors, ...baselineInput.errors, ...materialInput.errors];
  const report = {
    reportVersion: `molan-character-generation-report-v3.1-stage${evaluationStage}`,
    stageId: evaluationStage,
    status: metrics.status,
    promptCount: promptInput.prompts.length,
    promptValidation: promptInput.validation,
    promptSource: promptInput.source,
    inputs: {
      baseline: outputFileStatus(baselinePath, baselineInput),
      material: outputFileStatus(materialPath, materialInput)
    },
    metrics,
    scoresPathContract: 'scores.jsonl contains no model output text; it contains status, blind order and scores only',
    interpretation: metrics.status === 'pending'
      ? '模型输出尚未完整提供，当前结果为 pending。不能以缺失输出或确定性代理分数判断素材库收益。'
      : '两侧模型输出已齐，但当前仅有确定性 proxy 分数；必须完成人工随机盲评后才能讨论收益，当前不宣称 v3.1 改善生成质量。',
    claimable: false,
    humanReviewRequired: true,
    humanReviewQuestions: [
      '哪一侧更像真人？',
      '哪一侧人物更鲜明？',
      '哪一侧对白更自然？',
      '哪一侧情绪更有力度但不过度解释？',
      '哪一侧 AI 味更重？',
      '哪一侧整体更好读？'
    ],
    inputErrors
  };
  return {
    pass: inputErrors.length === 0 && promptInput.validation.pass && metrics.status === 'proxy-only',
    inputValid: inputErrors.length === 0 && promptInput.validation.pass,
    prompts: promptInput.prompts,
    scores,
    metrics,
    report,
    paths: { promptsPath, baselinePath, materialPath }
  };
}

function writeEvaluationOutputs(result, paths) {
  writeText(paths.promptsPath, jsonl(result.prompts));
  writeText(paths.scoresPath, jsonl(result.scores));
  writeJson(paths.metricsPath, result.metrics);
  writeJson(paths.reportPath, result.report);
  writeText(paths.reportMarkdownPath, makeMarkdownReport(result.report));
  return paths;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('用法：node scripts/generation-eval.mjs [--validate] [--write] [--out-dir path] [--prompts path] [--baseline path] [--material path] [--seed number]');
    return 0;
  }
  const outputDir = resolvePath(options['out-dir'], DEFAULT_EVAL_DIR);
  const promptsPath = resolvePath(options.prompts || options['prompt-file'], path.join(outputDir, 'prompts.jsonl'));
  const baselinePath = resolvePath(options.baseline, path.join(outputDir, 'baseline.jsonl'));
  const materialPath = resolvePath(options.material, path.join(outputDir, 'material.jsonl'));
  const result = runGenerationEvaluation({
    outputDir,
    promptsPath,
    baselinePath,
    materialPath,
    seed: options.seed === undefined ? DEFAULT_SEED : options.seed,
    evaluationStage: options.stage || DEFAULT_EVALUATION_STAGE
  });
  let outputs = null;
  if (options.write === true) {
    outputs = writeEvaluationOutputs(result, {
      promptsPath,
      scoresPath: resolvePath(options.scores, path.join(outputDir, 'scores.jsonl')),
      metricsPath: resolvePath(options.metrics, path.join(outputDir, 'metrics.json')),
      reportPath: resolvePath(options['report-out'] || options['report-json'], path.join(outputDir, 'report.json')),
      reportMarkdownPath: resolvePath(options['report-md'], path.join(outputDir, 'report.md'))
    });
  }
  console.log(JSON.stringify({
    pass: result.pass,
    status: result.report.status,
    promptCount: result.prompts.length,
    completePairCount: result.metrics.completePairCount,
    pendingPairCount: result.metrics.pendingPairCount,
    claimable: false,
    outputs
  }, null, 2));
  return result.pass ? 0 : 1;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  process.exitCode = main();
}

export {
  DEFAULT_EVAL_DIR,
  DEFAULT_PROMPTS_PATH,
  DEFAULT_BASELINE_PATH,
  DEFAULT_MATERIAL_PATH,
  DEFAULT_SCORES_PATH,
  DEFAULT_METRICS_PATH,
  DEFAULT_REPORT_PATH_OUT,
  DEFAULT_REPORT_MARKDOWN_PATH,
  FIXED_SCENE_DEFINITIONS,
  SCORE_KEYS,
  POSITIVE_SCORE_KEYS
};
