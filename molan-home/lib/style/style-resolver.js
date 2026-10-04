'use strict';

const crypto = require('node:crypto');
const styleDetector = require('../style-detector');
const { resolveStyleDNA, STYLE_DNA } = require('./style-dna');
const { deterministicStringify } = require('./style-bundle');

const SCHEMA_VERSION = 'style-bundle-v2';

/** 规范化计算稳定哈希，确保输入不变时哈希严格恒定。 */
function computeDeterministicHash(data) {
  const serialized = deterministicStringify(data);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/** 深度格式化字段值，支持字符串、数字与嵌套对象，严格避免 [object Object]。 */
function formatField(fieldValue) {
  if (fieldValue == null) return '';
  if (typeof fieldValue === 'string') return fieldValue.trim();
  if (typeof fieldValue === 'number' || typeof fieldValue === 'boolean') return String(fieldValue);
  if (Array.isArray(fieldValue)) {
    return fieldValue.map(formatField).filter(Boolean).join('；');
  }
  if (typeof fieldValue === 'object') {
    return Object.entries(fieldValue)
      .filter(([fieldKey, nestedValue]) => nestedValue != null && nestedValue !== '')
      .map(([fieldKey, nestedValue]) => `${fieldKey}: ${typeof nestedValue === 'object' ? formatField(nestedValue) : nestedValue}`)
      .join('；');
  }
  return String(fieldValue);
}

/** 格式化规则或范例项，支持字符串和对象形态。 */
function formatRuleOrSample(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object') {
    if (typeof item.text === 'string') return item.text.trim();
    if (typeof item.rule === 'string') return item.rule.trim();
    if (typeof item.description === 'string') return item.description.trim();
    if (typeof item.sample === 'string') return item.sample.trim();
    return formatField(item);
  }
  return String(item);
}

/** 将各类风格对象安全展开为清晰的文本指令，严格避免 [object Object]。 */
function formatStyleDirectives(bundleData) {
  const sections = [];
  if (bundleData.tone) {
    const toneText = formatField(bundleData.tone);
    if (toneText) sections.push(`【基调风格】：${toneText}`);
  }

  if (bundleData.voice) {
    const voiceText = formatField(bundleData.voice);
    if (voiceText) sections.push(`【叙述语声】：${voiceText}`);
  }

  if (bundleData.language) {
    const langText = formatField(bundleData.language);
    if (langText) sections.push(`【语言句法】：${langText}`);
  }

  if (bundleData.dialogue) {
    const dialogueText = formatField(bundleData.dialogue);
    if (dialogueText) sections.push(`【对白习惯】：${dialogueText}`);
  }

  if (bundleData.emotion) {
    const emotionText = formatField(bundleData.emotion);
    if (emotionText) sections.push(`【情感表达】：${emotionText}`);
  }

  const hardRules = Array.isArray(bundleData.rules?.hardRules) ? bundleData.rules.hardRules.filter(Boolean) : [];
  if (hardRules.length > 0) {
    sections.push(`【硬性规约】：\n${hardRules.map(rule => `- ${formatRuleOrSample(rule)}`).join('\n')}`);
  }

  const softPreferences = Array.isArray(bundleData.rules?.softPreferences) ? bundleData.rules.softPreferences.filter(Boolean) : [];
  if (softPreferences.length > 0) {
    sections.push(`【风格偏好】：\n${softPreferences.map(pref => `- ${formatRuleOrSample(pref)}`).join('\n')}`);
  }

  const samples = Array.isArray(bundleData.samples) ? bundleData.samples.filter(Boolean) : [];
  if (samples.length > 0) {
    sections.push(`【正向质感范例】：\n${samples.map(sample => `「${formatRuleOrSample(sample)}」`).join('\n')}`);
  }

  return sections.join('\n\n');
}

/** 生成通用的中性默认风格包，标注置信度为配置默认值。 */
function buildNeutralDefaultBundle() {
  const neutralDna = STYLE_DNA['日常'] || { sentence: 'varied', pacing: 'episodic', emotion: 'naturalistic', dialogue: 'conversational' };
  const rawBundle = {
    schemaVersion: SCHEMA_VERSION,
    source: 'neutral_default',
    styleId: 'neutral_standard',
    voice: '自然叙述，克制留白，立足场景与人物现场动作',
    tone: '中性现实，客观冷暖适度，不过度抒情或喧哗',
    language: { sentence: neutralDna.sentence, pacing: neutralDna.pacing },
    dialogue: { style: neutralDna.dialogue, subtext: '含蓄自然' },
    emotion: { register: neutralDna.emotion },
    rules: {
      hardRules: ['禁止使用陈腐网络网文套话', '禁止脱离人物事实进行说教'],
      softPreferences: ['叙事节奏平稳推进，以动作与细节传达心理']
    },
    samples: []
  };
  const sourceHash = computeDeterministicHash(rawBundle);
  const bundle = { ...rawBundle, sourceHash };
  return {
    status: 'resolved',
    source: 'neutral_default',
    confidence: null,
    confidenceType: 'configured_policy',
    style: formatStyleDirectives(bundle),
    bundle
  };
}

/** 从结构化配置或原始字符串提取文风要素并封装为标准 Bundle。 */
function compileResolvedBundle(sourceType, rawInput, confidenceValue = null) {
  if (typeof rawInput === 'string' && rawInput.trim()) {
    const trimmed = rawInput.trim();
    const dnaMatch = resolveStyleDNA(trimmed);
    const dnaInfo = dnaMatch.status === 'resolved' ? dnaMatch.dna : null;

    const rawBundle = {
      schemaVersion: SCHEMA_VERSION,
      source: sourceType,
      styleId: dnaMatch.styleId || trimmed.slice(0, 32),
      voice: trimmed,
      tone: dnaInfo ? dnaInfo.emotion : trimmed,
      language: dnaInfo ? { sentence: dnaInfo.sentence, pacing: dnaInfo.pacing } : trimmed,
      dialogue: dnaInfo ? { dialogue: dnaInfo.dialogue } : '自然对话',
      emotion: dnaInfo ? dnaInfo.emotion : '适度克制',
      rules: {
        hardRules: ['保持指定文风连贯，不出现违和语气'],
        softPreferences: []
      },
      samples: []
    };
    const sourceHash = computeDeterministicHash(rawBundle);
    const bundle = { ...rawBundle, sourceHash };
    return {
      status: 'resolved',
      source: sourceType,
      confidence: confidenceValue,
      confidenceType: confidenceValue === null ? (sourceType === 'inferred_sample' ? 'unknown' : 'configured_policy') : 'measured',
      style: trimmed,
      bundle
    };
  }

  if (rawInput && typeof rawInput === 'object') {
    const styleId = String(rawInput.styleId || rawInput.id || rawInput.name || sourceType);
    const voice = rawInput.voice || rawInput.voiceSpec || rawInput.narrativeVoice || rawInput.description || '';
    const tone = rawInput.tone || rawInput.mood || '';
    const language = rawInput.language || rawInput.linguisticStyle || {};
    const dialogue = rawInput.dialogue || rawInput.dialogueHabits || {};
    const emotion = rawInput.emotion || rawInput.emotionalTone || '';
    const hardRules = Array.isArray(rawInput.hardRules)
      ? rawInput.hardRules
      : Array.isArray(rawInput.rules?.hardRules)
        ? rawInput.rules.hardRules
        : [];
    const softPreferences = Array.isArray(rawInput.softPreferences)
      ? rawInput.softPreferences
      : Array.isArray(rawInput.rules?.softPreferences)
        ? rawInput.rules.softPreferences
        : [];
    const samples = Array.isArray(rawInput.positiveSamples)
      ? rawInput.positiveSamples
      : Array.isArray(rawInput.samples)
        ? rawInput.samples
        : [];

    const rawBundle = {
      schemaVersion: SCHEMA_VERSION,
      source: sourceType,
      styleId,
      voice,
      tone,
      language,
      dialogue,
      emotion,
      rules: {
        hardRules: hardRules.map(ruleItem => (typeof ruleItem === 'object' && ruleItem !== null ? { ...ruleItem } : ruleItem)),
        softPreferences: softPreferences.map(preferenceItem => (typeof preferenceItem === 'object' && preferenceItem !== null ? { ...preferenceItem } : preferenceItem))
      },
      samples: samples.map(sampleItem => (typeof sampleItem === 'object' && sampleItem !== null ? { ...sampleItem } : sampleItem))
    };
    const sourceHash = computeDeterministicHash(rawBundle);
    const bundle = { ...rawBundle, sourceHash };
    const formattedStyle = formatStyleDirectives(bundle) || styleId;
    return {
      status: 'resolved',
      source: sourceType,
      confidence: confidenceValue,
      confidenceType: confidenceValue === null ? (sourceType === 'inferred_sample' ? 'unknown' : 'configured_policy') : 'measured',
      style: formattedStyle,
      bundle
    };
  }

  return buildNeutralDefaultBundle();
}

/**
 * 完整文风解析器，执行严格的阶梯优先级判定：
 * 1. scene 显式指定风格
 * 2. chapterContract / request 请求显式风格
 * 3. 作品叙述文风（服务端权威设定，禁止客户端 storyContext 冒充）
 * 4. author 创作偏好
 * 5. 样本推断（仅限真实关键词或高置信打分，排除 genre_default 兜底）
 * 6. 中性默认兜底
 */
async function resolveStyle(options = {}, context = {}) {
  const request = options.request || options;
  const scene = options.scene || request.scene || (request.storyContext && request.storyContext.currentScene) ||
    (options.chapterContract && options.chapterContract.currentScene);
  const chapterContract = options.chapterContract || request.chapterContract || request.contract;
  const authoritative = options.authoritativeContext || context.authoritativeContext || {};

  const sceneStyle = scene && (scene.style || scene.styleProfile || scene.styleDNA);
  if (sceneStyle) {
    return compileResolvedBundle('scene_explicit', sceneStyle, null);
  }

  const requestStyle = (chapterContract && chapterContract.style) ||
    request.style || request.styleProfile || request.styleDNA ||
    (request.contract && request.contract.style) ||
    (request.chapterContext && request.chapterContext.style);
  if (requestStyle) {
    return compileResolvedBundle('request_explicit', requestStyle, null);
  }

  const authoritativeStyle = authoritative.narrativeStyle || authoritative.styleProfile ||
    authoritative.styleDNA || (authoritative.novel && authoritative.novel.narrativeStyle) ||
    (authoritative.bible && (authoritative.bible.style || authoritative.bible.narrativeStyle));
  if (authoritativeStyle) {
    return compileResolvedBundle('narrative_authoritative', authoritativeStyle, null);
  }

  const authorPref = request.authorStylePreference || authoritative.authorPreference || authoritative.authorDna;
  if (authorPref) {
    return compileResolvedBundle('author_preference', authorPref, null);
  }

  const proseSamples = Array.isArray(authoritative.proseSamples) && authoritative.proseSamples.length > 0
    ? authoritative.proseSamples
    : (typeof request.sampleText === 'string' && request.sampleText.trim() ? [request.sampleText.trim()] : []);
  
  const sampleCandidate = proseSamples.length > 0
    ? proseSamples.join('\n\n')
    : (typeof request.prompt === 'string' && request.prompt.trim().length >= 10 ? request.prompt.trim() : '');

  if (typeof sampleCandidate === 'string' && sampleCandidate.trim().length >= 10) {
    try {
      const detection = styleDetector.detectNovelStyle(sampleCandidate, {
        title: authoritative.title || request.novelTitle || '',
        genreFamily: options.genre?.family || request.genreFamily
      });
      if (detection && detection.matchedBy && detection.matchedBy !== 'genre_default' && detection.styleArchetype) {
        const dnaResult = resolveStyleDNA(detection.styleArchetype);
        const dna = dnaResult.status === 'resolved' ? dnaResult.dna : null;
        if (dna) {
          const confidence = typeof detection.confidence === 'number' && Number.isFinite(detection.confidence)
            ? detection.confidence
            : null;
          const detectedInput = {
            styleId: detection.styleArchetype,
            tone: dnaResult.styleDnaKey || dna.emotion || '',
            voice: '',
            language: {
              sentence: dna.sentence,
              pacing: dna.pacing,
              metaphorDensity: dna.metaphorDensity
            },
            dialogue: {
              dialogue: dna.dialogue
            },
            emotion: dna.emotion || '',
            rules: {
              hardRules: [],
              softPreferences: []
            },
            samples: []
          };
          return compileResolvedBundle('inferred_sample', detectedInput, confidence);
        }
      }
    } catch (detectionError) {}
  }

  return buildNeutralDefaultBundle();
}

module.exports = {
  SCHEMA_VERSION,
  computeDeterministicHash,
  formatStyleDirectives,
  buildNeutralDefaultBundle,
  resolveStyle
};
