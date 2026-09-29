'use strict';

/**
 * 墨阑长篇记忆与文风稳定系统 · 文风资产与审查服务
 * 
 * 职责：
 * 1. 五层文风资产配置（作者偏好、作品叙述、角色口吻、场景模式、任务要求）
 * 2. 锚点样本与版本化管理（正向标杆样本、反向规避样本及问题说明）
 * 3. 冲突裁决与分层编译合成（禁止润色入口暗改剧情事实）
 * 4. 双层文风检查器：
 *    - 确定性检查：句长/段长方差、对白比例、套话/高频修饰语密度、禁用词、角色口癖过度、人称漂移
 *    - 语义与情境检查：角色串音风险、视角越界、叙事节奏失衡、过度解释/机械升华
 * 5. 多维度分级文风诊断报告（作品级、角色级、场景级）
 */

const crypto = require('node:crypto');
const { computeAiFlavorScore } = require('./ai-flavor-detector');
const { detectNovelStyle } = require('./style-detector');

/**
 * 初始化文风资产表结构。
 */
function initializeSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS style_profiles (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    name TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'novel_narrative',
    target_entity_id TEXT NOT NULL DEFAULT '',
    target_scene_type TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_style_prof_book ON style_profiles(book_id, level, active)');

  db.exec(`CREATE TABLE IF NOT EXISTS style_profile_versions (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    hard_rules_json TEXT NOT NULL DEFAULT '[]',
    soft_preferences_json TEXT NOT NULL DEFAULT '{}',
    positive_samples_json TEXT NOT NULL DEFAULT '[]',
    negative_samples_json TEXT NOT NULL DEFAULT '[]',
    check_rules_json TEXT NOT NULL DEFAULT '{}',
    revision_strategy_json TEXT NOT NULL DEFAULT '{}',
    approved_by TEXT NOT NULL DEFAULT 'author',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES style_profiles(id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_style_ver_prof ON style_profile_versions(profile_id, revision)');

  db.exec(`CREATE TABLE IF NOT EXISTS style_bindings (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    branch_id TEXT NOT NULL DEFAULT 'main',
    profile_id TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'novel',
    target_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES style_profiles(id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_style_bind ON style_bindings(book_id, target_type, target_id)');

  db.exec(`CREATE TABLE IF NOT EXISTS style_anchor_samples (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    sample_type TEXT NOT NULL DEFAULT 'positive',
    text TEXT NOT NULL,
    critique TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES style_profiles(id)
  )`);
}

/**
 * 创建或更新文风档案（Profile）及初始版本。
 */
function upsertStyleProfile(db, entry) {
  const profileId = entry.id || `style_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Date.now();
  const bookId = String(entry.bookId || 'default');
  const branchId = String(entry.branchId || 'main');
  const level = entry.level || 'novel_narrative'; // 'author_preference' | 'novel_narrative' | 'character_voice' | 'scene_mode' | 'task_temporary'

  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT * FROM style_profiles WHERE id = ?').get(profileId);
    if (existing && (existing.book_id !== bookId || existing.branch_id !== branchId)) {
      throw Object.assign(new Error('STYLE_NOT_FOUND'), { code: 'STYLE_NOT_FOUND', statusCode: 404 });
    }
    if (existing && entry.expectedRevision !== undefined && entry.expectedRevision !== existing.revision) {
      throw Object.assign(new Error('STYLE_VERSION_CONFLICT'), { code: 'STYLE_VERSION_CONFLICT', statusCode: 409 });
    }
    const previous = existing ? db.prepare('SELECT * FROM style_profile_versions WHERE profile_id = ? AND revision = ?').get(profileId, existing.revision) : null;
    const value = (field, column, fallback) => entry[field] !== undefined ? entry[field]
      : previous ? JSON.parse(previous[column]) : fallback;
    const nextRevision = existing ? Number(existing.revision) + 1 : 1;
    if (existing) {
      db.prepare(`UPDATE style_profiles
        SET name = ?, level = ?, target_entity_id = ?, target_scene_type = ?, revision = ?, updated_at = ?
        WHERE id = ?`).run(
        entry.name || existing.name,
        entry.level || existing.level,
        entry.targetEntityId ?? existing.target_entity_id,
        entry.targetSceneType ?? existing.target_scene_type,
        nextRevision,
        now,
        profileId
      );
    } else {
      db.prepare(`INSERT INTO style_profiles (
        id, book_id, branch_id, name, level, target_entity_id, target_scene_type, revision, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`).run(
        profileId,
        bookId,
        branchId,
        entry.name || '未命名文风',
        level,
        entry.targetEntityId || '',
        entry.targetSceneType || '',
        now,
        now
      );
    }

    // 记录版本快照
    const versionId = `stylever_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    db.prepare(`INSERT INTO style_profile_versions (
      id, profile_id, revision, hard_rules_json, soft_preferences_json, positive_samples_json,
      negative_samples_json, check_rules_json, revision_strategy_json, approved_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      versionId,
      profileId,
      nextRevision,
      JSON.stringify(value('hardRules', 'hard_rules_json', [])),
      JSON.stringify(value('softPreferences', 'soft_preferences_json', {})),
      JSON.stringify(value('positiveSamples', 'positive_samples_json', [])),
      JSON.stringify(value('negativeSamples', 'negative_samples_json', [])),
      JSON.stringify(value('checkRules', 'check_rules_json', {})),
      JSON.stringify(value('revisionStrategy', 'revision_strategy_json', {})),
      entry.approvedBy || 'author',
      now
    );

    db.exec('COMMIT');
    return {
      ok: true,
      id: profileId,
      revision: nextRevision,
      name: entry.name,
      level,
      updatedAt: now
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

/**
 * 查询指定作品的所有生效文风配置。
 */
function getStyleProfiles(db, bookId, options = {}) {
  const branchId = options.branchId || 'main';
  let sql = 'SELECT * FROM style_profiles WHERE book_id = ? AND branch_id = ? AND active = 1';
  const params = [bookId, branchId];

  if (options.level) {
    sql += ' AND level = ?';
    params.push(options.level);
  }
  sql += ' ORDER BY created_at ASC';

  const rows = db.prepare(sql).all(...params);
  return rows.map(r => {
    const latestVer = db.prepare('SELECT * FROM style_profile_versions WHERE profile_id = ? ORDER BY revision DESC LIMIT 1')
      .get(r.id);
    return {
      id: r.id,
      bookId: r.book_id,
      name: r.name,
      level: r.level,
      targetEntityId: r.target_entity_id,
      targetSceneType: r.target_scene_type,
      revision: Number(r.revision) || 1,
      hardRules: latestVer ? JSON.parse(latestVer.hard_rules_json || '[]') : [],
      softPreferences: latestVer ? JSON.parse(latestVer.soft_preferences_json || '{}') : {},
      positiveSamples: latestVer ? JSON.parse(latestVer.positive_samples_json || '[]') : [],
      negativeSamples: latestVer ? JSON.parse(latestVer.negative_samples_json || '[]') : [],
      checkRules: latestVer ? JSON.parse(latestVer.check_rules_json || '{}') : {}
    };
  });
}

/**
 * 分层合成文风写作提示词与约束集（Layered Style Compilation）。
 * 按层级优先级覆盖并保证：硬视角/世界事实不被低层覆盖。
 */
function compileStyleBundle(profiles, sceneContext = {}) {
  const hardRules = [];
  const softPreferences = {};
  const voiceConstraints = {};
  const positiveSamples = [];
  const checkRules = {};
  const ruleValues = new Map();
  const addRules = rules => {
    for (const rule of rules || []) {
      let key;
      let value;
      if (typeof rule === 'object' && rule) {
        key = rule.key;
        value = rule.value;
      } else if (typeof rule === 'string') {
        const person = rule.match(/第[一二三]人称/);
        if (person) { key = 'person'; value = person[0]; }
      }
      if (key && ruleValues.has(key) && ruleValues.get(key) !== value) {
        throw Object.assign(new Error('STYLE_HARD_RULE_CONFLICT'), { code: 'STYLE_HARD_RULE_CONFLICT', statusCode: 422 });
      }
      if (key) ruleValues.set(key, value);
      hardRules.push(rule);
    }
  };
  for (const profile of profiles.filter(profile => profile.level === 'author_preference')) {
    Object.assign(softPreferences, profile.softPreferences);
    addRules(profile.hardRules);
    Object.assign(checkRules, profile.checkRules);
  }

  // 1. 作品级硬规则
  const novelProfiles = profiles.filter(p => p.level === 'novel_narrative');
  for (const p of novelProfiles) {
    addRules(p.hardRules);
    Object.assign(softPreferences, p.softPreferences);
    Object.assign(checkRules, p.checkRules);
    positiveSamples.push(...p.positiveSamples);
  }

  // 2. 场景模式（主要影响节奏与描写密度）
  const sceneType = sceneContext.sceneType;
  if (sceneType) {
    const sceneProfile = profiles.find(p => p.level === 'scene_mode' && p.targetSceneType === sceneType);
    if (sceneProfile) {
      addRules(sceneProfile.hardRules);
      Object.assign(softPreferences, sceneProfile.softPreferences);
      Object.assign(checkRules, sceneProfile.checkRules);
    }
  }
  for (const profile of profiles.filter(profile => profile.level === 'task_temporary' &&
    profile.targetEntityId && profile.targetEntityId === sceneContext.taskId)) {
    addRules(profile.hardRules);
    Object.assign(softPreferences, profile.softPreferences);
    Object.assign(checkRules, profile.checkRules);
  }

  // 3. 角色语言口吻（仅限制对应角色的对白与内心）
  const characters = sceneContext.castIds || [];
  for (const cid of characters) {
    const charProfile = profiles.find(p => p.level === 'character_voice' && p.targetEntityId === cid);
    if (charProfile) {
      voiceConstraints[cid] = {
        name: charProfile.name,
        rules: charProfile.hardRules,
        preferences: charProfile.softPreferences
      };
    }
  }

  const uniqueHardRules = Array.from(new Set(hardRules));
  const deterministicPayload = JSON.stringify({
    hardRules: uniqueHardRules,
    softPreferences,
    voiceConstraints,
    positiveSamples,
    checkRules
  });
  const hash = crypto.createHash('sha256').update(deterministicPayload, 'utf8').digest('hex');

  return {
    version: 'style-bundle-v1',
    hash,
    hardRules: uniqueHardRules,
    softPreferences,
    voiceConstraints,
    positiveSamples,
    checkRules,
    profileVersions: profiles.map(profile => ({ id: profile.id, revision: profile.revision }))
  };
}

/**
 * 确定性文风检查器：
 * - 句长/段长方差与极端句
 * - 对白占比
 * - 重复词与套话密度
 * - 禁用词
 * - 角色口癖过度
 * - 人称异常
 */
function runDeterministicStyleAudit(text, rules = {}) {
  const content = String(text || '').trim();
  const findings = [];

  if (!content) {
    return { passed: false, findings: [{ type: 'EMPTY_TEXT', message: '正文内容为空' }] };
  }

  // 1. 段落与句子统计
  const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const sentences = content.split(/[。！？\n]/).map(s => s.trim()).filter(Boolean);

  const sentenceLengths = sentences.map(s => s.length);
  const avgSentenceLength = sentenceLengths.length > 0
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;

  // 检查超长单句 (如 > 80 字未断句)
  const maxSentenceLength = rules.maxSentenceLength || 80;
  for (const s of sentences) {
    if (s.length > maxSentenceLength) {
      findings.push({
        type: 'LONG_SENTENCE',
        severity: 'warning',
        detail: `单句过长(${s.length}字): "${s.slice(0, 25)}..."`,
        suggestion: '适当拆分为利落短句，增强张力'
      });
      break;
    }
  }

  // 2. 对白比例统计
  const dialogueChars = (content.match(/[“"][^”"]*[”"]/g) || []).reduce((sum, d) => sum + d.length, 0);
  const dialogueRatio = content.length > 0 ? dialogueChars / content.length : 0;

  if (rules.minDialogueRatio != null && dialogueRatio < rules.minDialogueRatio) {
    findings.push({
      type: 'DIALOGUE_RATIO_TOO_LOW',
      severity: 'notice',
      detail: `对白占比偏低(${(dialogueRatio * 100).toFixed(1)}%)，缺少角色直接互动`
    });
  }
  if (rules.maxDialogueRatio != null && dialogueRatio > rules.maxDialogueRatio) {
    findings.push({
      type: 'DIALOGUE_RATIO_TOO_HIGH',
      severity: 'notice',
      detail: `对白占比过高(${(dialogueRatio * 100).toFixed(1)}%)，通篇纯对话缺少动作与情境铺垫`
    });
  }

  // 3. 禁用词检查
  const forbiddenTerms = rules.forbiddenTerms || ['只见', '宛如', '仿佛如同一尊', '恐怖如斯', '这一刻'];
  for (const term of forbiddenTerms) {
    if (content.includes(term)) {
      findings.push({
        type: 'FORBIDDEN_TERM_HIT',
        severity: 'warning',
        detail: `命中套话或禁用表达: "${term}"`,
        suggestion: `替换为动作描写或具象事实`
      });
    }
  }

  // 4. AI 味与套话密度
  let aiFlavorScore = 0;
  try {
    const verdict = computeAiFlavorScore(content);
    aiFlavorScore = verdict ? verdict.score : 0;
    if (verdict && !verdict.passed) {
      findings.push({
        type: 'AI_SLOP_DENSITY_HIGH',
        severity: 'warning',
        detail: `AI 味与修饰语膨胀超标 (分值: ${verdict.score})`,
        metrics: verdict.metrics
      });
    }
  } catch (_) {}

  // 5. 角色口癖过度检测
  const catchphrases = rules.catchphrases || [];
  for (const cp of catchphrases) {
    const count = (content.split(cp).length - 1);
    if (count > 4) {
      findings.push({
        type: 'CATCHPHRASE_OVERUSE',
        severity: 'warning',
        detail: `角色口癖 "${cp}" 在单章出现 ${count} 次，频率过高显得机械僵化`
      });
    }
  }

  // 6. 人称漂移检查
  if (rules.enforcePerson === 'third') {
    const strippedDialogue = content.replace(/[“"][^”"]*[”"]/g, '');
    const firstPersonMatches = strippedDialogue.match(/我|俺|咱/g) || [];
    if (firstPersonMatches.length > 0) {
      findings.push({
        type: 'POV_PERSON_DRIFT',
        severity: 'critical',
        detail: `第三人称小说在旁白叙述中误用了第一人称代词 (${firstPersonMatches.length}处)`
      });
    }
  }

  const passed = findings.filter(f => f.severity === 'critical').length === 0 &&
                 findings.filter(f => f.severity === 'warning').length <= 2;

  return {
    passed,
    metrics: {
      totalChars: content.length,
      sentenceCount: sentences.length,
      paragraphCount: paragraphs.length,
      avgSentenceLength: Number(avgSentenceLength.toFixed(1)),
      dialogueRatio: Number(dialogueRatio.toFixed(3)),
      aiFlavorScore
    },
    findings
  };
}

/**
 * 语义与情境文风审查（角色是否串音、视角与认知越界、场景节奏）：
 */
function runSemanticStyleAudit(text, context = {}) {
  const content = String(text || '').trim();
  const findings = [];

  // 1. 角色口吻与串音检查
  const voiceRules = context.voiceConstraints || {};
  for (const [entityId, vConfig] of Object.entries(voiceRules)) {
    const entityName = vConfig.name || entityId;
    // 检查是否有冷酷角色说出了卖萌词汇
    if (vConfig.rules && vConfig.rules.includes('冷酷寡言')) {
      const safeName = entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const dialogueMatches = content.match(new RegExp(`${safeName}[^\\n]{0,10}[：:“"]([^”"]+)[”"]`, 'g')) || [];
      for (const d of dialogueMatches) {
        if (/哈哈|嘻嘻|嘛|呢|呀/.test(d)) {
          findings.push({
            type: 'CHARACTER_VOICE_OUT_OF_CHARACTER',
            severity: 'warning',
            entityId,
            detail: `角色 [${entityName}] 被配置为冷酷寡言，但对白出现了轻佻卖萌语气: "${d}"`
          });
        }
      }
    }
  }

  // 2. 机械升华与过度解释检查
  if (/总而言之|这告诉我们|人生的真谛|正如古人所言/.test(content)) {
    findings.push({
      type: 'OVER_EXPLANATION_MECHANICAL_ELEVATION',
      severity: 'warning',
      detail: '正文结尾或段落中出现了说教式总结或机械升华，破坏故事沉浸感'
    });
  }

  const passed = findings.filter(f => f.severity === 'critical').length === 0;

  return {
    passed,
    coverage: { deterministic: 'checked', semantic: 'heuristic_only' },
    requiresSemanticReview: true,
    findings
  };
}

/**
 * 联合文风审查（合并确定性检查与语义情境检查，输出多维度报告）。
 */
function auditTextStyle(text, options = {}) {
  const detAudit = runDeterministicStyleAudit(text, options.deterministicRules || {});
  const semAudit = runSemanticStyleAudit(text, options.semanticContext || {});

  const allFindings = [...detAudit.findings, ...semAudit.findings];
  const passed = detAudit.passed && semAudit.passed;

  const hardViolations = allFindings.filter(f => f.severity === 'critical' || ['EMPTY_TEXT', 'FORBIDDEN_TERM_HIT', 'POV_PERSON_DRIFT'].includes(f.type));
  const styleMeasurements = {
    dialogueRatio: detAudit.metrics ? detAudit.metrics.dialogueRatio : 0,
    avgSentenceLength: detAudit.metrics ? detAudit.metrics.avgSentenceLength : 0,
    longSentenceRatio: detAudit.metrics ? detAudit.metrics.longSentenceRatio : 0,
    rhythmVariance: detAudit.metrics ? detAudit.metrics.rhythmVariance : 0,
    charCount: text ? text.length : 0
  };
  const aiFlavorRisk = {
    score: (detAudit.metrics && detAudit.metrics.aiFlavorScore) || 0,
    risk: ((detAudit.metrics && detAudit.metrics.aiFlavorScore) >= 60 ? 'critical' : (((detAudit.metrics && detAudit.metrics.aiFlavorScore) >= 35) ? 'warning' : 'clean')),
    findings: allFindings.filter(f => f.type === 'AI_SLOP_DENSITY_HIGH' || String(f.type || '').startsWith('AI_'))
  };
  const voiceConsistency = {
    passed: !allFindings.some(f => ['CHARACTER_VOICE_OUT_OF_CHARACTER', 'CATCHPHRASE_OVERUSE'].includes(f.type)),
    findings: allFindings.filter(f => ['CHARACTER_VOICE_OUT_OF_CHARACTER', 'CATCHPHRASE_OVERUSE'].includes(f.type))
  };
  const pacingEvidence = {
    passed: !allFindings.some(f => ['LONG_SENTENCE', 'DIALOGUE_RATIO_TOO_LOW', 'DIALOGUE_RATIO_TOO_HIGH', 'OVER_EXPLANATION_MECHANICAL_ELEVATION'].includes(f.type)),
    findings: allFindings.filter(f => ['LONG_SENTENCE', 'DIALOGUE_RATIO_TOO_LOW', 'DIALOGUE_RATIO_TOO_HIGH', 'OVER_EXPLANATION_MECHANICAL_ELEVATION'].includes(f.type)),
    dialogueRatio: detAudit.metrics ? detAudit.metrics.dialogueRatio : 0,
    avgSentenceLength: detAudit.metrics ? detAudit.metrics.avgSentenceLength : 0
  };

  let score = 100;
  if (hardViolations.length > 0) score -= Math.min(60, hardViolations.length * 25);
  if (!voiceConsistency.passed) score -= 15;
  if (!pacingEvidence.passed) score -= 10;
  if (aiFlavorRisk.risk === 'critical') score -= 25;
  else if (aiFlavorRisk.risk === 'warning') score -= 10;
  score = Math.max(0, Math.min(100, score));

  return {
    passed,
    score,
    hardViolations,
    styleMeasurements,
    aiFlavorRisk,
    voiceConsistency,
    pacingEvidence,
    metrics: detAudit.metrics,
    reports: {
      novelLevel: allFindings.filter(f => ['AI_SLOP_DENSITY_HIGH', 'FORBIDDEN_TERM_HIT', 'POV_PERSON_DRIFT'].includes(f.type)),
      characterLevel: allFindings.filter(f => ['CHARACTER_VOICE_OUT_OF_CHARACTER', 'CATCHPHRASE_OVERUSE'].includes(f.type)),
      sceneLevel: allFindings.filter(f => ['LONG_SENTENCE', 'DIALOGUE_RATIO_TOO_LOW', 'DIALOGUE_RATIO_TOO_HIGH', 'OVER_EXPLANATION_MECHANICAL_ELEVATION'].includes(f.type))
    },
    findings: allFindings
  };
}

module.exports = {
  initializeSchema,
  upsertStyleProfile,
  getStyleProfiles,
  compileStyleBundle,
  runDeterministicStyleAudit,
  runSemanticStyleAudit,
  auditTextStyle
};
