'use strict';

/**
 * 题材分层规则作用域：把《纠错库》与起草硬指令拆成 global + genre-scoped 两层。
 * 依据 2026-09-09 范本核对：都市高武范本以校园对话开局、都市脑洞范本以打游戏聊天开局，
 * 开篇尺度不能由题材强制；KPI 等现代行话在都市题材属正常用语。
 */

const GENRE_FAMILIES = Object.freeze({
  ancient_cultivation: { label: '仙侠修真', match: /仙侠|修真|修仙|东方玄幻|传统玄幻|^玄幻$|玄幻(?!言情)|诸天|武侠|洪荒|凡人/ },
  ancient_world: { label: '古代世情', match: /历史|古言|古风|宫斗|宅斗|民国|抗战|谍战|军事|年代|种田(?!都市)/ },
  urban_modern: { label: '都市现代', match: /都市|现言|现代|职场|婚恋|豪门|总裁|赘婿|星光|娱乐|青春|甜宠|校园|体育|游戏|轻小说|动漫|衍生|快穿|现实|脑洞(?!历史|古言|玄幻|悬疑)/ },
  disaster_exploration: { label: '灾变探索', match: /末世|科幻|无限|规则|怪谈|灵异|悬疑|克苏鲁|废土|求生|奇幻|西方/ },
  romance_fantasy: { label: '玄幻言情', match: /玄幻言情|女频|仙恋|仙侠言情/ }
});

/**
 * 规则作用域表：未列出的规则视为 global（所有题材生效）。
 * exclude：在这些题材族禁用；only：仅在这些题材族生效。
 */
const RULE_SCOPES = Object.freeze({
  'R-23-modern-legal-bureaucracy': { exclude: ['urban_modern', 'disaster_exploration'], reason: '都市/现代背景中 KPI、流程等行话属正常用语' },
  'R-33-pseudo-precision': { only: ['ancient_cultivation', 'ancient_world'], reason: '丈/尺等伪精确单位仅对古代背景成立' },
  'R-44-quest-penalty-staccato': { only: ['ancient_cultivation', 'ancient_world', 'romance_fantasy'], reason: '契约宣判腔只在修真/古代契约语境判定' },
  'R-38-game-meter-ticking': { exclude: ['urban_modern'], reason: '游戏/系统流都市范本允许面板数值出现，交由题材规则单独约束' },
  'R-30-lore-announcement': { exclude: ['urban_modern'], reason: '都市脑洞范本常见系统弹窗式说明' }
});

/** 起草硬指令作用域：编号对应 completion-editor.js baseWritingDirectives 序号。 */
const DIRECTIVE_SCOPES = Object.freeze({
  macroScale: { exclude: Object.keys(GENRE_FAMILIES).concat('unknown'), reason: '所有题材均按当下叙事任务选择开篇尺度，不强制宏大奇观或禁止市井场景' },
  dialectFlavor: { exclude: ['ancient_cultivation', 'romance_fantasy'], reason: '地域俚语声调要求不适用于架空修真世界' }
});

/** 将任意题材字符串解析为题材族键；无法识别时返回 'unknown'。 */
function resolveGenreFamily(genre) {
  const source = String(genre || '').trim();
  if (!source) return 'unknown';
  if (/玄幻言情|仙侠言情|仙恋/.test(source)) return 'romance_fantasy';
  if (/悬疑|怪谈|灵异|科幻|末世|废土/.test(source)) return 'disaster_exploration';
  if (/历史/.test(source)) return 'ancient_world';
  if (/都市|现代|青春|校园/.test(source)) return 'urban_modern';
  for (const [key, meta] of Object.entries(GENRE_FAMILIES)) {
    if (meta.match.test(source)) return key;
  }
  return 'unknown';
}

/** 判断某条规则/指令在给定题材族下是否生效；unknown 题材按 global 处理（保守全开）。 */
function scopeAllows(scope, family) {
  if (!scope) return true;
  if (family === 'unknown') return !(Array.isArray(scope.only) && scope.only.length) && !(scope.exclude || []).includes('unknown');
  if (Array.isArray(scope.only) && scope.only.length) return scope.only.includes(family);
  if (Array.isArray(scope.exclude) && scope.exclude.length) return !scope.exclude.includes(family);
  return true;
}

/** 按题材过滤纠错规则，返回 { rules, skipped: [{id, reason}] , family }。 */
function filterCorrectionRules(rules, genre) {
  const family = resolveGenreFamily(genre);
  const kept = [];
  const skipped = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const scope = RULE_SCOPES[rule.id];
    if (scopeAllows(scope, family)) kept.push(rule);
    else skipped.push({ id: rule.id, reason: scope.reason });
  }
  return { rules: kept, skipped, family };
}

/** 判断某条起草硬指令在题材下是否注入。 */
function directiveAllowed(directiveKey, genre) {
  return scopeAllows(DIRECTIVE_SCOPES[directiveKey], resolveGenreFamily(genre));
}

module.exports = { GENRE_FAMILIES, RULE_SCOPES, DIRECTIVE_SCOPES, resolveGenreFamily, filterCorrectionRules, directiveAllowed, scopeAllows };
