#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const correctionLib = require('../lib/correction-library.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, '..');

const DEFAULT_MD_PATH = path.join(REPO_ROOT, 'editor-sources', '纠错库.md');
const ROOT_MD_PATH = path.join(WORKSPACE_ROOT, '纠错库.md');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'data', 'correction-library');
const INBOX_PATH = path.join(DEFAULT_OUT_DIR, 'inbox.jsonl');

// 严重度与适用范围映射
const RULE_METADATA = {
  'R-01': { severity: 'high', scope: '叙述', manual: false, label: '感官实体化' },
  'R-02': { severity: 'medium', scope: '叙述', manual: false, label: '动词缩写生硬' },
  'R-03': { severity: 'medium', scope: '叙述', manual: false, label: '语句不完整' },
  'R-04': { severity: 'medium', scope: '叙述', manual: false, label: '动作后情绪二次解释' },
  'R-05': { severity: 'high', scope: '叙述', manual: false, label: '告知情绪而非展示' },
  'R-06': { severity: 'medium', scope: '叙述', manual: true, label: '神态情绪与情境不符' },
  'R-07': { severity: 'high', scope: '对白', manual: false, label: '同步群体反应模板与台词弱' },
  'R-08': { severity: 'medium', scope: '通用', manual: false, label: '关键动作指代模糊与越界推断' },
  'R-09': { severity: 'high', scope: '叙述', manual: false, label: '套话比喻' },
  'R-10': { severity: 'medium', scope: '叙述', manual: false, label: '状语后置语序' },
  'R-11': { severity: 'high', scope: '叙述', manual: false, label: '结论超过证据' },
  'R-12': { severity: 'medium', scope: '叙述', manual: false, label: '机械工整与装饰性数量词' },
  'R-13': { severity: 'high', scope: '开篇', manual: true, label: '制度解释顺序倒置' },
  'R-14': { severity: 'high', scope: '叙述', manual: false, label: '嘴角勾起一抹弧度套话' },
  'R-15': { severity: 'low', scope: '叙述', manual: false, label: '无功能身体状态与转场' },
  'R-16': { severity: 'low', scope: '通用', manual: false, label: '不自然用词“唇角”' },
  'R-17': { severity: 'low', scope: '叙述', manual: false, label: '局部物件替代人物主体' },
  'R-18': { severity: 'high', scope: '叙述', manual: false, label: '声音实体化变体' },
  'R-19': { severity: 'high', scope: '叙述', manual: false, label: '旁白越权价值判断与惊叹' },
  'R-20': { severity: 'high', scope: '叙述', manual: false, label: 'AI典型对比句装逼框架' },
  'R-21': { severity: 'medium', scope: '战斗', manual: false, label: '伤势感知抽象比喻' },
  'R-22': { severity: 'low', scope: '叙述', manual: false, label: '微反应刻意计时' },
  'R-23': { severity: 'high', scope: '通用', manual: false, label: '出戏的现代法务行政黑话' },
  'R-24': { severity: 'high', scope: '叙述', manual: false, label: '现代段子与脱口秀感悟腔' },
  'R-25': { severity: 'medium', scope: '叙述', manual: false, label: '章尾账目盘点式机械复盘' },
  'R-26': { severity: 'low', scope: '叙述', manual: true, label: '拟声段落节奏观察' },
  'R-27': { severity: 'high', scope: '战斗', manual: false, label: '动作戏回合制点名排队' },
  'R-28': { severity: 'medium', scope: '叙述', manual: false, label: '工整对称二分句式' },
  'R-29': { severity: 'high', scope: '对白', manual: false, label: '角色口号复读与标签台词' },
  'R-30': { severity: 'medium', scope: '战斗', manual: false, label: '旁白招式报幕与设定弹窗' },
  'R-31': { severity: 'medium', scope: '战斗', manual: false, label: '生理痛觉指标循环播报' },
  'R-32': { severity: 'medium', scope: '叙述', manual: false, label: '说明文式多层因果堆砌' },
  'R-33': { severity: 'high', scope: '叙述', manual: false, label: '伪精确数字与死板步数' },
  'R-34': { severity: 'high', scope: '叙述', manual: false, label: '套路化伤势感知（旧伤发紧）' },
  'R-35': { severity: 'high', scope: '战斗', manual: false, label: '动作戏秒表倒数' },
  'R-36': { severity: 'medium', scope: '叙述', manual: false, label: '套路化瞳孔反应与翻译腔' },
  'R-37': { severity: 'high', scope: '战斗', manual: false, label: '神经反射式受击震颤套话' },
  'R-38': { severity: 'high', scope: '战斗', manual: false, label: '战斗机械数值打卡跳字' },
  'R-39': { severity: 'medium', scope: '叙述', manual: false, label: '主角名连续主语发报机流水账' },
  'R-40': { severity: 'high', scope: '叙述', manual: false, label: '植物神经/微肌群痉挛套路' },
  'R-41': { severity: 'high', scope: '叙述', manual: false, label: '隐形翻译腔与假深沉修饰链' },
  'R-42': { severity: 'high', scope: '叙述', manual: false, label: '变种指骨关节泛白套话' },
  'R-43': { severity: 'high', scope: '叙述', manual: false, label: '机械节律脉动抽动套路' },
  'R-44': { severity: 'high', scope: '对白', manual: false, label: '网游任务惩罚弹窗式四字通告' },
  'R-45': { severity: 'high', scope: '通用', manual: false, label: '商业单章篇幅硬标准（2000~3000字）' },
  'R-46': { severity: 'medium', scope: '叙述', manual: false, label: '滥用盯/盯住制造虚假紧绷感' }
};

function sha256(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function parseCommandLine(argv) {
  const options = {
    sourceFile: DEFAULT_MD_PATH,
    outDir: DEFAULT_OUT_DIR,
    mergeInbox: false,
    checkOnly: false
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--merge-inbox') options.mergeInbox = true;
    else if (arg === '--check-only') options.checkOnly = true;
    else if (arg === '--file' && argv[i + 1]) options.sourceFile = path.resolve(argv[++i]);
    else if (arg === '--out-dir' && argv[i + 1]) options.outDir = path.resolve(argv[++i]);
  }
  return options;
}

function syncBothMarkdowns(content) {
  fs.writeFileSync(DEFAULT_MD_PATH, content, 'utf8');
  if (fs.existsSync(path.dirname(ROOT_MD_PATH))) {
    fs.writeFileSync(ROOT_MD_PATH, content, 'utf8');
  }
}

export function buildCorrectionLibrary(options = {}) {
  const sourcePath = options.sourceFile || DEFAULT_MD_PATH;
  const outDir = options.outDir || DEFAULT_OUT_DIR;

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`纠错库源文件不存在：${sourcePath}`);
  }

  let markdown = fs.readFileSync(sourcePath, 'utf8');

  // 处理 --merge-inbox 回流合并
  if (options.mergeInbox) {
    if (fs.existsSync(INBOX_PATH)) {
      const entries = correctionLib.readInbox(INBOX_PATH);
      if (entries.length) {
        console.log(`[build-correction] 发现 ${entries.length} 条待合并回流记录，正在追加到 Markdown...`);
        const parsed = correctionLib.parseCorrectionLibrary(markdown);
        const merged = correctionLib.mergeInboxIntoMarkdown(markdown, parsed, entries);
        if (merged.added && merged.added.length) {
          markdown = merged.markdown;
          syncBothMarkdowns(markdown);
          console.log(`[build-correction] 成功追加 ${merged.added.length} 条案例到两处 Markdown，跳过 ${merged.skipped.length} 条重复项。`);
          // 清空 inbox.jsonl 并保留备份
          const backupPath = path.join(outDir, `inbox-merged-${new Date().toISOString().slice(0, 10)}.jsonl`);
          fs.writeFileSync(backupPath, fs.readFileSync(INBOX_PATH, 'utf8'), 'utf8');
          fs.writeFileSync(INBOX_PATH, '', 'utf8');
        } else {
          console.log(`[build-correction] 没有新增记录被合入（全部已存在）。`);
        }
      } else {
        console.log(`[build-correction] inbox.jsonl 暂无待合入记录。`);
      }
    }
  }

  const rawParsed = correctionLib.parseCorrectionLibrary(markdown, { path: sourcePath });
  const hash = sha256(markdown);
  const version = hash.slice(0, 12);

  // 1. 构建 rules.json
  const rules = rawParsed.rules.map(rule => {
    const meta = RULE_METADATA[rule.id] || { severity: 'medium', scope: '通用', manual: false, label: rule.category };
    return {
      id: rule.id,
      category: rule.category,
      label: meta.label || rule.category,
      must: rule.must,
      badExample: rule.badExample,
      severity: meta.severity || 'medium',
      scope: meta.scope || '通用',
      manual: Boolean(meta.manual)
    };
  });

  // 校验 R- 规则完整性（必须覆盖 R-01~R-46）
  const missingRuleIds = [];
  for (let i = 1; i <= 46; i++) {
    const id = `R-${String(i).padStart(2, '0')}`;
    if (!rules.some(r => r.id === id)) missingRuleIds.push(id);
  }
  if (missingRuleIds.length) {
    throw new Error(`[build-correction] 致命错误：硬规则缺失编号 ${missingRuleIds.join(', ')}`);
  }

  // 2. 构建 cases.json
  const cases = rawParsed.cases.map(item => ({
    id: item.id,
    chapter: item.chapter,
    type: item.type,
    before: item.before,
    after: item.after,
    principle: item.principle,
    source: item.source || 'ai',
    heading: item.heading,
    duplicates: item.duplicates || []
  }));

  // 3. 构建 blacklist.json（包含近义变体扩展）
  const blacklistCategories = rawParsed.blacklist.map(entry => ({
    category: entry.category,
    phrases: [...new Set(entry.phrases)],
    problem: entry.problem || ''
  }));

  // 将所有用户案例的核心短语加入近义扩展池
  const userCasePhrases = [];
  cases.filter(c => c.source === 'user' && c.before).forEach(c => {
    const core = correctionLib.corePhraseOfCase(c);
    if (core && core.length >= 3) userCasePhrases.push(core);
  });
  if (userCasePhrases.length) {
    const existing = blacklistCategories.find(entry => entry.category === '用户纠正重点近义变体');
    if (existing) {
      existing.phrases = [...new Set([...existing.phrases, ...userCasePhrases])];
    } else {
      blacklistCategories.push({
        category: '用户纠正重点近义变体',
        phrases: [...new Set(userCasePhrases)],
        problem: '用户明确纠正的表达及其近义变体'
      });
    }
  }

  const allBlacklistPhrases = [...new Set(blacklistCategories.flatMap(e => e.phrases))].sort((a, b) => b.length - a.length);

  // 4. 构建 checks.json
  const checks = rawParsed.checks.map(check => ({
    heading: check.heading,
    text: check.text,
    phrases: check.phrases || [],
    chapter: check.chapter,
    pattern: check.phrases && check.phrases.length
      ? check.phrases.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
      : ''
  }));

  const payload = {
    rules: {
      version,
      sha256: hash,
      updatedAt: new Date().toISOString(),
      ruleCount: rules.length,
      rules
    },
    cases: {
      version,
      sha256: hash,
      updatedAt: new Date().toISOString(),
      stats: rawParsed.stats,
      caseCount: cases.length,
      cases
    },
    blacklist: {
      version,
      sha256: hash,
      updatedAt: new Date().toISOString(),
      totalPhrases: allBlacklistPhrases.length,
      categories: blacklistCategories,
      allPhrases: allBlacklistPhrases
    },
    checks: {
      version,
      sha256: hash,
      updatedAt: new Date().toISOString(),
      checkCount: checks.length,
      checks
    }
  };

  if (!options.checkOnly) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'rules.json'), JSON.stringify(payload.rules, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'cases.json'), JSON.stringify(payload.cases, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'blacklist.json'), JSON.stringify(payload.blacklist, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify(payload.checks, null, 2), 'utf8');
  }

  return {
    version,
    sha256: hash,
    warnings: rawParsed.warnings || [],
    stats: {
      rules: rules.length,
      cases: cases.length,
      userCases: cases.filter(c => c.source === 'user').length,
      blacklistPhrases: allBlacklistPhrases.length,
      checks: checks.length
    }
  };
}

// 命令行入口
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  try {
    const opts = parseCommandLine(process.argv);
    console.log(`[build-correction] 正在编译《纠错库.md》...`);
    const result = buildCorrectionLibrary(opts);
    console.log(`[build-correction] 编译完成！结构化版本：${result.version}`);
    console.log(`  - 硬规则：${result.stats.rules} 条（覆盖 R-01 ~ R-46）`);
    console.log(`  - 案例库：${result.stats.cases} 条（其中用户纠错 ${result.stats.userCases} 条）`);
    console.log(`  - 黑名单短语：${result.stats.blacklistPhrases} 处`);
    console.log(`  - 派生检查项：${result.stats.checks} 条`);
    if (result.warnings && result.warnings.length) {
      console.log(`[build-correction] 提示：发现 ${result.warnings.length} 项告警（已自动去重合并）：`);
      result.warnings.slice(0, 8).forEach(w => console.log(`  · ${w}`));
    }
  } catch (error) {
    console.error(`[build-correction] 编译失败：`, error);
    process.exit(1);
  }
}
