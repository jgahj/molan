/* =========================================================================
 * editor-shared-core.js — 双端编辑器共享核心层（SPA completion-editor + 独立页 pages/editor）
 * 统一抽离重复的角色原型推断引擎、安全 HTML 转义、中文字数统计与受控前端诊断日志，
 * 消除双端万行级文件中的复制粘贴漂移。兼容浏览器全局与 CommonJS 导入。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MolanEditorShared = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  'use strict';

  const CHARACTER_ARCHETYPES = Object.freeze([
    '豪爽侠义型', '冷静理智型', '温柔内敛型', '活泼开朗型', '阴郁腹黑型',
    '霸道强势型', '天真烂漫型', '市侩圆滑型', '高傲冷峻型', '热血冲动型'
  ]);

  const CHARACTER_ARCHETYPE_KEYWORDS = Object.freeze({
    '豪爽侠义型': ['豪爽', '侠义', '仗义', '直爽', '洒脱', '义气', '大方'],
    '冷静理智型': ['冷静', '理智', '克制', '淡漠', '审慎'],
    '温柔内敛型': ['温柔', '含蓄', '内敛', '体贴', '柔和'],
    '活泼开朗型': ['活泼', '开朗', '乐观', '跳脱', '爱笑'],
    '阴郁腹黑型': ['阴沉', '腹黑', '算计', '偏执', '危险'],
    '霸道强势型': ['霸道', '强势', '掌控', '专横', '命令', '果断'],
    '天真烂漫型': ['天真', '单纯', '烂漫', '懵懂', '好奇'],
    '市侩圆滑型': ['市侩', '圆滑', '精明', '世故', '会算', '逐利'],
    '高傲冷峻型': ['高傲', '冷峻', '孤傲', '骄傲', '不屑', '疏离'],
    '热血冲动型': ['热血', '冲动', '直率', '暴躁', '好战']
  });

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function countValidNovelChars(text) {
    return String(text == null ? '' : text).replace(/\s+/g, '').length;
  }

  function debugWarn(scope, message, err) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('molan_debug') === '1') {
        console.warn('[molan:ui:' + scope + '] ' + message, err || '');
      }
    } catch (_) {}
  }

  function normalizeCharacterArchetype(value) {
    const normalized = String(value || '').trim();
    return CHARACTER_ARCHETYPES.includes(normalized) ? normalized : '';
  }

  function inferCharacterArchetype(entity) {
    const source = entity && typeof entity === 'object' ? entity : {};
    const explicit = normalizeCharacterArchetype(source.archetype);
    if (explicit) {
      const explicitSource = source.archetypeSource === 'inferred' ? 'inferred' : 'explicit';
      return {
        archetype: explicit,
        source: explicitSource,
        confidence: explicitSource === 'explicit' ? 1 : Number(source.archetypeConfidence) || 0.65
      };
    }
    const tags = Array.isArray(source.tags)
      ? source.tags.map(v => String(v || '').trim().toLowerCase())
      : [];
    const attrs = Array.isArray(source.attrs)
      ? source.attrs.map(item => typeof item === 'string'
        ? item
        : String((item && (item.k || item.key || item.name || '')) + ' ' + (item && (item.v || item.value || item.text || ''))))
      : [];
    const body = [source.personality, source.notes, source.intro, source.description, ...attrs]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const scores = CHARACTER_ARCHETYPES.map(archetype => {
      let score = 0;
      (CHARACTER_ARCHETYPE_KEYWORDS[archetype] || []).forEach(keyword => {
        const normalized = keyword.toLowerCase();
        if (tags.some(tag => tag === normalized)) score += 6;
        else if (tags.some(tag => tag.includes(normalized))) score += 4;
        let at = 0;
        let count = 0;
        while ((at = body.indexOf(normalized, at)) >= 0 && count < 3) {
          count += 1;
          at += normalized.length;
        }
        score += count * 1.25;
      });
      return { archetype, score };
    }).sort((left, right) => right.score - left.score);

    const top = scores[0];
    const second = scores[1];
    if (!top || top.score < 2 || (second && second.score > 0 && top.score - second.score < 1.5)) {
      return { archetype: '', source: 'none', confidence: 0 };
    }
    const confidence = Number(Math.min(0.94, Math.max(0.5, top.score / (top.score + (second ? second.score : 0) + 1))).toFixed(2));
    return { archetype: top.archetype, source: 'inferred', confidence };
  }

  function characterArchetypeDisplay(entity) {
    const result = inferCharacterArchetype(entity);
    const sourceLabel = result.source === 'explicit'
      ? '用户指定'
      : result.source === 'inferred'
        ? '根据人物卡关键词推断'
        : '未能判断，使用通用规则';
    return { ...result, sourceLabel };
  }

  function applyCharacterArchetype(entity, explicitValue, sourceHint) {
    if (!entity || entity.type !== 'character') return;
    const explicit = normalizeCharacterArchetype(explicitValue);
    if (explicit && sourceHint === 'inferred') {
      entity.archetype = explicit;
      entity.archetypeSource = 'inferred';
      entity.archetypeConfidence = Number(entity.archetypeConfidence) || 0.65;
      return;
    }
    if (explicit) {
      entity.archetype = explicit;
      entity.archetypeSource = 'explicit';
      entity.archetypeConfidence = 1;
      return;
    }
    const inferred = inferCharacterArchetype({ ...entity, archetype: '' });
    entity.archetype = inferred.archetype;
    entity.archetypeSource = inferred.source;
    entity.archetypeConfidence = inferred.confidence;
  }

  return Object.freeze({
    CHARACTER_ARCHETYPES,
    CHARACTER_ARCHETYPE_KEYWORDS,
    escapeHtml,
    countValidNovelChars,
    debugWarn,
    normalizeCharacterArchetype,
    inferCharacterArchetype,
    characterArchetypeDisplay,
    applyCharacterArchetype
  });
}));
