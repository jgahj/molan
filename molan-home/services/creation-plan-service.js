'use strict';

function createCreationPlanService({
  CREATION_LINE_IDS,
  CREATION_OPENING_STRATEGIES,
  CREATION_PLAN_BATCH_SIZE,
  CREATION_PLAN_PATCH_ROOTS,
  CREATION_PLAN_PATCH_ROOT_KINDS,
  CREATION_PLAN_REVIEW_LAYERS,
  CREATION_RETENTION_LEVELS,
  SOMATIC_REFLEX_PATTERN,
  computeEventChainLCS,
  computeMapTopologySimilarity,
  computeRoleCombinationJaccard,
  normalizeAuthorDna,
  sha256Text
}) {
  function normalizeCreationPlan(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const retention = input.retention && typeof input.retention === 'object' ? input.retention : {};
    const openingStrategyInput = input.openingStrategy && typeof input.openingStrategy === 'object' && !Array.isArray(input.openingStrategy)
      ? input.openingStrategy
      : {};
    const openingStrategyMode = CREATION_OPENING_STRATEGIES.has(String(openingStrategyInput.mode || input.openingStrategyMode || ''))
      ? String(openingStrategyInput.mode || input.openingStrategyMode)
      : 'advisory';
    const normalizeLevel = (key, fallback) => CREATION_RETENTION_LEVELS.has(String(retention[key] || '')) ? String(retention[key]) : fallback;
    const totalChapters = Math.max(1, Math.min(1000, Math.floor(Number(input.totalChapters || input.chapterCount || 20) || 20)));
    const volumeCount = Math.max(1, Math.min(totalChapters, Math.floor(Number(input.volumeCount || input.volumes || 1) || 1)));
    const chapterWordTarget = Math.max(300, Math.min(20000, Math.floor(Number(input.chapterWordTarget || input.wordCount || 2500) || 2500)));
    const lines = Array.isArray(input.lines) ? input.lines : [];
    const normalizedLines = lines.map((line, index) => {
      const source = line && typeof line === 'object' && !Array.isArray(line) ? structuredClone(line) : { label: String(line || '') };
      const rawId = String(source.id || source.key || '').trim();
      const id = rawId || (CREATION_LINE_IDS.has(rawId) ? rawId : 'custom-' + index);
      return {
        ...source,
        id,
        label: String(source.label || source.name || rawId || '自定义线索').trim(),
        role: index === 0 ? 'primary' : String(source.role || 'secondary').trim() || 'secondary',
        weight: Math.max(0, Math.min(1, Number(source.weight) || (index === 0 ? 1 : 0.4)))
      };
    }).filter((line, index, all) => all.findIndex(item => item.id === line.id) === index);
    if (!normalizedLines.length) normalizedLines.push({ id: 'growth', label: '成长线', role: 'primary', weight: 1 });
    normalizedLines[0].role = 'primary'; normalizedLines[0].weight = 1;
    normalizedLines.slice(1).forEach((line, index) => { line.role = String(line.role || 'secondary').trim() || 'secondary'; line.weight = Math.max(0.1, Math.min(0.9, Number(line.weight) || (index === 0 ? 0.6 : 0.4))); });
    return {
      schemaVersion: '1.0',
      title: String(input.title || '').slice(0, 120),
      genre: String(input.genre || '').slice(0, 120),
      subgenre: String(input.subgenre || '').slice(0, 120),
      audience: String(input.audience || '').slice(0, 120),
      totalChapters, volumeCount, chaptersPerVolume: Math.ceil(totalChapters / volumeCount), chapterWordTarget,
      sceneCount: Math.max(1, Math.min(12, Math.floor(Number(input.sceneCount || 3) || 3))),
      retention: {
        opening: normalizeLevel('opening', 'keep'),
        goldenFinger: normalizeLevel('goldenFinger', 'keep'),
        architecture: normalizeLevel('architecture', 'keep'),
        rhythm: normalizeLevel('rhythm', 'keep')
      },
      microInnovation: String(input.microInnovation || input.innovation || '').slice(0, 1200),
      primaryLine: normalizedLines[0].id,
      lines: normalizedLines,
      openingStrategy: {
        mode: openingStrategyMode,
        authorNote: String(openingStrategyInput.authorNote || input.openingStrategyNote || '').slice(0, 600)
      },
      modelId: String(input.modelId || input.model || '').slice(0, 120),
      skillId: String(input.skillId || '').slice(0, 160),
      budgetLimit: Math.max(0, Number(input.budgetLimit || 0) || 0),
      originalContentExcluded: true
    };
  }
  
  function creationPlanRules(plan) {
    const p = normalizeCreationPlan(plan);
    const rules = [];
    const add = (key, level, keep, tune) => rules.push({ key, level, keep, tune, rewrite: '不迁移原作该项，重新生成并执行原创审计' });
    add('opening', p.retention.opening, '功能节点顺序一致；首次危机和首次奖励章节相差不超过 1 章；钩子密度偏差不超过 15%', '允许调整一个非核心节点；关键窗口相差不超过 2 章；节奏密度偏差不超过 30%');
    add('goldenFinger', p.retention.goldenFinger, '进入时机相差不超过 1 章；成长阶段数量一致；保留奖励/代价循环但替换具体机制', '进入时机相差不超过 2 章；成长阶段允许上下浮动 1 个；必须新增限制或代价');
    add('architecture', p.retention.architecture, '保留阶段推进和卷级目标；抽象功能相似度至少 0.75；具体事件链相似度低于 0.35', '阶段数量允许上下浮动 1 个；抽象功能相似度至少 0.55；具体事件链相似度低于 0.35');
    add('rhythm', p.retention.rhythm, '冲突、奖励、信息变化和章末钩子频率偏差不超过 15%', '上述频率偏差不超过 30%，允许调整一个节奏周期');
    return rules;
  }
  
  function normalizeBiblePayload(body) {
    const input = body && typeof body === 'object' ? body : {};
    const brief = input.brief && typeof input.brief === 'object' ? input.brief : {};
    const briefObj = brief.brief && typeof brief.brief === 'object' ? brief.brief : brief;
    const generated = input.generated && typeof input.generated === 'object' ? input.generated : {};
    const plan = normalizeCreationPlan({ ...(input.plan || {}), title: input.title || input.plan && input.plan.title, genre: input.genre || input.plan && input.plan.genre });
    const split = value => String(value || '').split(/[；;]/).map(item => item.trim()).filter(Boolean);
    const cloneValue = value => value == null ? value : structuredClone(value);
    const asList = (value, limit = null) => {
      if (!Array.isArray(value)) return [];
      const cloned = value.map(item => cloneValue(item));
      return Number.isFinite(limit) ? cloned.slice(0, Math.max(0, Number(limit))) : cloned;
    };
    const fullList = value => asList(value);
    const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const authorDna = normalizeAuthorDna(generated.authorDna || generated.authorDNA || briefObj.authorDna || briefObj.authorDNA);
    const opening = asObject(generated.opening || generated.openingRhythm || briefObj.opening || briefObj.openingRhythm);
    const generatedCharacters = generated.characters || generated.characterDesign;
    const characterSources = Array.isArray(generatedCharacters) && generatedCharacters.length
      ? generatedCharacters
      : (Array.isArray(briefObj.characterPlan) ? briefObj.characterPlan : []);
    const characterLibrarySources = generated.characterLibrary || generated.characterPlan || characterSources || briefObj.characterLibrary || brief.characterPlan;
    const mainline = asObject(generated.mainline || generated.mainLine || briefObj.mainline);
    const storyTree = fullList(generated.storyTree || generated.story_tree || briefObj.storyTree);
    const conflictChain = fullList(generated.conflictChain || generated.conflict_chain || briefObj.conflictChain);
    const rewardChain = fullList(generated.rewardChain || generated.reward_chain || generated.growthRewardChain || briefObj.rewardChain);
    const arcPlan = fullList(generated.arcPlan || generated.storyArcs || briefObj.arcPlan);
    const chapterPlan = normalizeCreationChapterPlanRhythm(
      fullList(generated.chapterPlan || generated.chapters || briefObj.chapterPlan)
        .map((item, index) => normalizeCreationExpansionChapter(item, index + 1))
    );
    const scenePlan = fullList(generated.scenePlan || generated.scenes || briefObj.scenePlan);
    const reviewPlan = asObject(generated.reviewPlan || generated.review_plan || briefObj.reviewPlan);
    // ★ 人物演绎层：voice/tell/wound/stance/emotionStyle 随卡携带，供起草端生成"怎么演"
    const asObjectSafe = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const recordId = (prefix, item, index, occurrenceMap) => {
      const raw = item && typeof item === 'object' ? String(item.id || item.key || item.uid || '').trim() : '';
      if (raw) return raw;
      const name = String(item && (item.name || item.title || item.term || item.rule || '') || '').trim() || `${prefix}-${index + 1}`;
      const occurrence = occurrenceMap.get(name) || 0;
      occurrenceMap.set(name, occurrence + 1);
      return `${prefix}_${sha256Text(JSON.stringify({ name, occurrence })).slice(0, 20)}`;
    };
    const normalizeCharacter = (item, index, occurrenceMap) => {
      const source = item && typeof item === 'object' && !Array.isArray(item) ? cloneValue(item) : { name: String(item || '') };
      const voice = asObjectSafe(source.voice);
      return {
        ...source,
        id: recordId('character', source, index, occurrenceMap),
        name: String(source.name || source.title || '').trim(),
        role: String(source.role || '').trim(),
        goal: String(source.goal || source.coreGoal || '').trim(),
        flaw: String(source.flaw || source.conflict || '').trim(),
        arc: String(source.arc || '').trim(),
        relationships: fullList(source.relationships),
        voice: {
          ...cloneValue(voice),
          samples: fullList(voice.samples).map(value => String(value)),
          taboo: String(voice.taboo || ''),
          habit: String(voice.habit || '')
        },
        tell: fullList(source.tell).map(value => ({ ...cloneValue(value), when: String(value && value.when || ''), how: String(value && value.how || '') })),
        wound: String(source.wound || ''),
        stance: fullList(source.stance).map(value => ({ ...cloneValue(value), toward: String(value && value.toward || ''), current: String(value && value.current || ''), evolution: String(value && value.evolution || '') })),
        emotionStyle: String(source.emotionStyle || '')
      };
    };
    const characterOccurrences = new Map();
    const characters = fullList(characterSources).map((item, index) => normalizeCharacter(item, index, characterOccurrences)).filter(item => item.name || item.role);
    const libraryOccurrences = new Map();
    const characterLibrary = fullList(characterLibrarySources).map((item, index) => normalizeCharacter(item, index, libraryOccurrences)).filter(item => item.name || item.role);
    const worldOccurrences = new Map();
    const worldbuilding = fullList(generated.worldbuilding || generated.worldBuilding || generated.world || generated.settings).map((item, index) => {
      const source = item && typeof item === 'object' && !Array.isArray(item) ? cloneValue(item) : { detail: String(item || '') };
      return {
        ...source,
        id: recordId('world', source, index, worldOccurrences),
        category: String(source.category || source.type || 'setting').trim(),
        name: String(source.name || source.title || '').trim(),
        detail: String(source.detail || source.description || source.function || '').trim()
      };
    }).filter(item => item.name || item.detail);
    const sourceProfile = input.sourceProfile && typeof input.sourceProfile === 'object' ? input.sourceProfile : {};
    const map = asObject(generated.map || generated.worldMap || generated.world_map);
    const profileSource = generated.projectProfile || generated.profile || briefObj.projectProfile || briefObj.profile || {};
    const projectProfile = {
      ...cloneValue(asObject(profileSource)),
      title: String(profileSource.title || generated.title || input.title || '').trim(),
      subtitle: String(profileSource.subtitle || generated.subtitle || briefObj.subtitle || '').trim(),
      penName: String(profileSource.penName || profileSource.authorName || generated.penName || briefObj.penName || '').trim(),
      primaryGenre: String(profileSource.primaryGenre || generated.genre || input.genre || plan.genre || '').trim(),
      genreTags: fullList(profileSource.genreTags || generated.genreTags || briefObj.genreTags),
      theme: String(profileSource.theme || generated.theme || briefObj.theme || '').trim(),
      tone: String(profileSource.tone || generated.tone || briefObj.tone || '').trim(),
      audience: String(profileSource.audience || generated.audience || briefObj.targetReader || plan.audience || '').trim(),
      sellingPoints: fullList(profileSource.sellingPoints || generated.sellingPoints || briefObj.sellingPoints),
      shortSynopsis: String(profileSource.shortSynopsis || generated.shortSynopsis || generated.intro || generated.oneLine || '').trim(),
      longSynopsis: String(profileSource.longSynopsis || generated.longSynopsis || briefObj.longSynopsis || '').trim(),
      marketingCopy: fullList(profileSource.marketingCopy || generated.marketingCopy || briefObj.marketingCopy)
    };
    const rawPremise = asObject(generated.bookPremise || {});
    const bookPremise = {
      ...cloneValue(rawPremise),
      title: String(rawPremise.title || generated.title || input.title || projectProfile.title || '').trim(),
      oneLine: String(rawPremise.oneLine || generated.intro || generated.oneLine || projectProfile.shortSynopsis || '').trim(),
      shortSynopsis: String(rawPremise.shortSynopsis || projectProfile.shortSynopsis || '').trim(),
      longSynopsis: String(rawPremise.longSynopsis || projectProfile.longSynopsis || '').trim()
    };
    const goldenFinger = { ...cloneValue(asObject(generated.goldenFinger || generated.golden_finger || generated.cheatSystem || generated.cheat)) };
    if (!goldenFinger.type && (goldenFinger.kind || goldenFinger.name)) goldenFinger.type = goldenFinger.kind || goldenFinger.name;
    const forbidden = [...new Set([...fullList(briefObj.forbiddenCopy), ...fullList(sourceProfile.forbiddenCopy)].map(String).filter(Boolean))];
    const rawForeshadows = generated.foreshadows || generated.foreshadowPlan || generated.foreshadow_plan || generated.foreshadowLedger || briefObj.foreshadowPlan;
    const foreshadowOccurrences = new Map();
    const foreshadowLedger = fullList(rawForeshadows).map((item, index) => {
      const source = item && typeof item === 'object' && !Array.isArray(item) ? cloneValue(item) : { desc: String(item || '') };
      return {
        ...source,
        id: recordId('foreshadow', source, index, foreshadowOccurrences),
        plantIn: String(source.plantIn || source.setupChapter || source.plantedChapter || '').trim(),
        payoffIn: String(source.payoffIn || source.expectedPayoff || source.targetChapter || '').trim(),
        desc: String(source.desc || source.description || source.expectedPayoff || source.payoff || '').trim(),
        strength: String(source.strength || 'medium').trim(),
        status: String(source.status || 'planned').trim() || 'planned'
      };
    });
    const rawTimeline = generated.timeline || generated.storyTimeline || generated.historyTimeline || briefObj.timeline || brief.timeline;
    const timelineOccurrences = new Map();
    const timeline = fullList(rawTimeline).map((item, index) => {
      const source = item && typeof item === 'object' && !Array.isArray(item) ? cloneValue(item) : { title: String(item || '') };
      return {
        ...source,
        id: recordId('event', source, index, timelineOccurrences),
        title: String(source.title || source.name || source.event || '').trim(),
        storyTime: cloneValue(source.storyTime || source.date || source.storyDate || null),
        narrativeOrder: Number.isFinite(Number(source.narrativeOrder)) ? Number(source.narrativeOrder) : index + 1
      };
    }).filter(item => item.title || item.storyTime);
    const storylines = fullList(generated.storylines || generated.storyLines || generated.lines || plan.lines);
    const payload = {
      schemaVersion: '1.1', provenance: { sourceDissectionId: String(input.sourceDissectionId || '').slice(0, 80), derivedBriefId: String(input.briefId || '').slice(0, 80), originalContentExcluded: true },
      creationPlan: plan,
      retentionRules: creationPlanRules(plan),
      taskConstraints: {
        genre: String(plan.genre || briefObj.targetGenre || briefObj.userGenre || '').trim(),
        subgenre: plan.subgenre,
        audience: String(plan.audience || briefObj.targetReader || '').trim(),
        theme: projectProfile.theme,
        tone: projectProfile.tone,
        sellingPoints: cloneValue(projectProfile.sellingPoints),
        targetLength: String(plan.totalChapters + '章 / ' + plan.chapterWordTarget + '字/章'),
        totalChapters: plan.totalChapters,
        volumeCount: plan.volumeCount,
        chapterWordTarget: plan.chapterWordTarget,
        ratingAndTaboos: [],
        outputLanguage: 'zh-CN'
      },
      styleProfile: {
        rules: Array.isArray(briefObj.transferableStyle) ? briefObj.transferableStyle.map(item => ({ rule: String(item).slice(0, 240), confidence: 0.5 })) : [],
        evidenceRefs: [], confidence: 0.5, unknowns: [],
        // ★ 拆书挖掘的文风工坊资产：量化指纹/场景模板/反转套路/情绪节拍要一路带进写作端
        sentenceFingerprint: asObject(sourceProfile.sentenceFingerprint || generated.sentenceFingerprint),
        reusableTemplates: asObject(sourceProfile.reusableTemplates || generated.reusableTemplates),
        reversalPatterns: asList(sourceProfile.reversalPatterns || generated.reversalPatterns, 40),
        emotionBeats: asList(sourceProfile.emotionBeats, 400)
      },
      craftConstraints: { pacingRules: split(briefObj.pacingModel), conflictEscalation: split(briefObj.conflictEscalation), chapterCadence: asList(generated.chapterCadence || generated.rhythm && generated.rhythm.chapterCadence, 24), rewardCadence: asList(generated.rewardCadence || generated.rhythm && generated.rhythm.rewardCadence, 24) },
      forbiddenCopy: { entities: forbidden, events: asList(generated.forbiddenEvents, 200), quotedText: [], sequencePatterns: asList(generated.forbiddenSequences, 100), roleCombinations: asList(generated.forbiddenRoleCombinations, 100) },
      divergenceMatrix: asList(generated.divergenceMatrix || input.divergenceMatrix, 300),
      sourceStructure: {
        framework: sourceProfile.framework || {}, architecture: sourceProfile.architecture || {}, opening: sourceProfile.opening || {}, authorDna: sourceProfile.authorDna || {},
        goldenFinger: sourceProfile.goldenFinger || {}, characters: asList(sourceProfile.characters, 200),
        map: sourceProfile.map || {}, events: asList(sourceProfile.events, 300), relationships: asList(sourceProfile.relationships, 300), forbiddenCopy: forbidden
      },
      projectProfile,
      bookPremise,
      worldRules: fullList(generated.worldRules),
      architecture: cloneValue(generated.architecture || {}),
      opening: cloneValue(opening),
      authorDna,
      map: cloneValue(map),
      characters,
      characterLibrary,
      mainline,
      storyTree,
      conflictChain,
      rewardChain,
      relationships: fullList(generated.relationships),
      storylines,
      goldenFinger,
      worldbuilding,
      volumePlan: fullList(generated.volumePlan || brief.volumePlan),
      arcPlan, chapterPlan, scenePlan, reviewPlan, chapterContracts: [],
      foreshadowLedger,
      timeline,
      revisionMemory: [],
      qualityState: { status: 'draft', blockingIssues: [], lastAuditId: null, planReview: { status: 'pending', issues: [], reviewedAt: 0 }, stateVersion: 1 }
    };
    const coverage = creationPlanCoverage(payload);
    const priorPlanningState = generated.planningState && typeof generated.planningState === 'object' ? generated.planningState : {};
    payload.planningState = {
      schemaVersion: '1.0',
      status: coverage.ready ? 'completed' : 'pending',
      phase: coverage.resourcesReady ? (coverage.chaptersReady ? 'completed' : 'chapters') : 'resources',
      totalChapters: plan.totalChapters,
      volumeCount: plan.volumeCount,
      batchSize: CREATION_PLAN_BATCH_SIZE,
      completedThrough: coverage.completedThrough,
      nextChapterNo: coverage.nextChapterNo,
      resourceTargets: coverage.targets,
      resourceCounts: coverage.counts,
      lastBatch: priorPlanningState.lastBatch || null,
      lastError: null,
      updatedAt: Date.now()
    };
    return payload;
  }
  
  function creationPlanTargets(value) {
    const plan = normalizeCreationPlan(value);
    const arcCount = Math.max(plan.volumeCount, Math.ceil(plan.totalChapters / CREATION_PLAN_BATCH_SIZE));
    const storyNodeCount = Math.max(plan.volumeCount * 2, arcCount);
    const characterCount = Math.max(6, Math.min(24, 6 + Math.ceil(plan.totalChapters / 125)));
    return {
      chapters: plan.totalChapters,
      volumes: plan.volumeCount,
      characters: characterCount,
      characterLibrary: characterCount,
      worldbuilding: Math.max(10, Math.min(36, 10 + Math.ceil(plan.totalChapters / 75))),
      worldRules: Math.max(8, Math.min(32, 8 + Math.ceil(plan.totalChapters / 100))),
      mapNodes: Math.max(8, Math.min(48, 8 + Math.ceil(plan.totalChapters / 60))),
      relationships: Math.max(5, Math.min(48, Math.ceil(characterCount / 2))),
      storyTree: storyNodeCount,
      conflictChain: arcCount,
      rewardChain: arcCount,
      arcPlan: arcCount,
      foreshadowLedger: Math.max(6, Math.min(40, 6 + Math.ceil(plan.totalChapters / 100)))
    };
  }
  
  function creationPlanItemKey(item, index) {
    if (typeof item === 'string') return item.trim().toLowerCase() || 'item-' + index;
    if (!item || typeof item !== 'object') return 'item-' + index;
    const values = [
      item.id, item.name, item.title, item.volume, item.arc, item.node, item.stage,
      item.from, item.to, item.source, item.target, item.rule, item.goal, item.chapterRange
    ].map(value => String(value == null ? '' : value).trim().toLowerCase()).filter(Boolean);
    if (values.length) return values.join('|');
    try { return JSON.stringify(item).slice(0, 800); } catch (_) { return 'item-' + index; }
  }
  
  function creationNamedCount(value, keys) {
    const list = Array.isArray(value) ? value : [];
    const seen = new Set();
    list.forEach((item, index) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const named = keys.some(key => String(item[key] == null ? '' : item[key]).trim());
        if (!named && !creationPlanHasContent(item)) return;
      } else if (!String(item == null ? '' : item).trim()) return;
      seen.add(creationPlanItemKey(item, index));
    });
    return seen.size;
  }
  
  function creationChapterNumber(item) {
    const number = Number(item && (item.chapterNo || item.chapter || item.no || item.number));
    return Number.isInteger(number) ? number : 0;
  }
  
  function creationChapterTitle(item) {
    return String(item && (item.title || item.name || item.chapterTitle) || '').trim();
  }
  
  function creationChapterIsUsable(item) {
    if (!item || typeof item !== 'object') return false;
    if (!creationChapterTitle(item)) return false;
    const fields = [
      ['goal', 'synopsis', 'beat'],
      ['protagonistAction', 'action'],
      ['opposition', 'obstacle', 'conflict'],
      ['informationChange', 'information', 'newInformation'],
      ['result', 'irreversibleResult', 'outcome'],
      ['hook', 'endingHook', 'exitHook']
    ];
    return fields.every(keys => keys.some(key => String(item[key] == null ? '' : item[key]).trim().length >= 2));
  }
  
  function creationPlanCoverage(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const plan = normalizeCreationPlan(p.creationPlan || {});
    const targets = creationPlanTargets(plan);
    const architecture = p.architecture && typeof p.architecture === 'object' ? p.architecture : {};
    const map = p.map && typeof p.map === 'object' ? p.map : {};
    const chapters = Array.isArray(p.chapterPlan) ? p.chapterPlan : [];
    const chapterByNo = new Map();
    const duplicateChapters = [];
    chapters.forEach(item => {
      const chapterNo = creationChapterNumber(item);
      if (chapterNo < 1 || chapterNo > plan.totalChapters) return;
      if (chapterByNo.has(chapterNo)) duplicateChapters.push(chapterNo);
      chapterByNo.set(chapterNo, item);
    });
    const missingChapters = [];
    const invalidChapters = [];
    for (let chapterNo = 1; chapterNo <= plan.totalChapters; chapterNo += 1) {
      const item = chapterByNo.get(chapterNo);
      if (!item) missingChapters.push(chapterNo);
      else if (!creationChapterIsUsable(item)) invalidChapters.push(chapterNo);
    }
    let completedThrough = 0;
    while (completedThrough < plan.totalChapters) {
      const item = chapterByNo.get(completedThrough + 1);
      if (!creationChapterIsUsable(item)) break;
      completedThrough += 1;
    }
    const architectureVolumes = Array.isArray(architecture.volumes)
      ? architecture.volumes
      : Array.isArray(architecture.volumeMap) ? architecture.volumeMap : [];
    const counts = {
      chapters: chapterByNo.size,
      validChapters: chapterByNo.size - invalidChapters.length,
      volumes: Math.max(
        creationNamedCount(p.volumePlan, ['title', 'volume', 'name']),
        creationNamedCount(architectureVolumes, ['title', 'volume', 'name'])
      ),
      characters: creationNamedCount(p.characters, ['name', 'title', 'role']),
      characterLibrary: creationNamedCount(p.characterLibrary, ['name', 'title', 'role']),
      worldbuilding: creationNamedCount(p.worldbuilding, ['name', 'title', 'category']),
      worldRules: creationNamedCount(p.worldRules, ['rule', 'name', 'title', 'limit', 'consequence']),
      mapNodes: creationNamedCount(map.nodes, ['name', 'title', 'id']),
      relationships: creationNamedCount(p.relationships, ['from', 'to', 'source', 'target', 'name', 'title']),
      storyTree: creationNamedCount(p.storyTree, ['node', 'name', 'title', 'goal']),
      conflictChain: creationNamedCount(p.conflictChain, ['stage', 'name', 'title', 'pressure']),
      rewardChain: creationNamedCount(p.rewardChain, ['stage', 'name', 'title', 'payoff']),
      arcPlan: creationNamedCount(p.arcPlan, ['arc', 'name', 'title', 'goal']),
      foreshadowLedger: creationNamedCount(p.foreshadowLedger, ['id', 'name', 'title', 'desc', 'description'])
    };
    const missingResources = Object.entries(targets)
      .filter(([key]) => key !== 'chapters' && counts[key] < targets[key])
      .map(([field, target]) => ({ field, target, actual: counts[field] }));
    return {
      plan,
      targets,
      counts,
      completedThrough,
      nextChapterNo: Math.min(plan.totalChapters + 1, completedThrough + 1),
      missingChapters,
      invalidChapters,
      duplicateChapters: [...new Set(duplicateChapters)],
      missingResources,
      resourcesReady: missingResources.length === 0,
      chaptersReady: missingChapters.length === 0 && invalidChapters.length === 0 && duplicateChapters.length === 0 && chapterByNo.size === plan.totalChapters,
      ready: missingResources.length === 0 && missingChapters.length === 0 && invalidChapters.length === 0 && duplicateChapters.length === 0 && chapterByNo.size === plan.totalChapters
    };
  }
  
  function creationPlanText(value, maxLength = 320) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }
  
  function creationPlanCompactList(value, fields, limit = 20) {
    return (Array.isArray(value) ? value : []).slice(0, Math.max(0, limit)).map(item => {
      if (typeof item === 'string') return creationPlanText(item, 240);
      if (!item || typeof item !== 'object') return '';
      const output = {};
      fields.forEach(field => {
        if (item[field] !== undefined && item[field] !== null) {
          if (Array.isArray(item[field])) output[field] = item[field].slice(0, 8).map(value => creationPlanText(value, 160));
          else output[field] = creationPlanText(item[field], 320);
        }
      });
      return output;
    }).filter(item => creationPlanHasContent(item));
  }
  
  function creationPlanExpansionContext(payload, startChapterNo, endChapterNo, coverage) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const chapters = Array.isArray(p.chapterPlan) ? p.chapterPlan : [];
    const currentChapters = chapters.filter(item => {
      const number = creationChapterNumber(item);
      return number >= startChapterNo && number <= endChapterNo;
    });
    const previousChapters = chapters.filter(item => creationChapterNumber(item) < startChapterNo).slice(-8);
    return {
      plan: p.creationPlan || {},
      premise: p.bookPremise || {},
      opening: p.opening || {},
      mainline: p.mainline || {},
      goldenFinger: p.goldenFinger || {},
      lines: p.creationPlan && Array.isArray(p.creationPlan.lines) ? p.creationPlan.lines : [],
      volumePlan: creationPlanCompactList(p.volumePlan, ['volume', 'title', 'goal', 'purpose', 'turningPoint', 'endingHook', 'chapterRange'], 40),
      arcPlan: creationPlanCompactList(p.arcPlan, ['arc', 'title', 'goal', 'opposition', 'turn', 'payoff', 'chapterRange'], 20),
      characters: creationPlanCompactList(p.characters, ['name', 'role', 'goal', 'flaw', 'arc', 'relationships'], 24),
      characterLibrary: creationPlanCompactList(p.characterLibrary, ['name', 'role', 'goal', 'flaw', 'arc', 'relationships'], 24),
      worldbuilding: creationPlanCompactList(p.worldbuilding, ['category', 'name', 'detail', 'function'], 32),
      worldRules: creationPlanCompactList(p.worldRules, ['rule', 'limit', 'consequence', 'scope'], 24),
      mapNodes: creationPlanCompactList(p.map && p.map.nodes, ['id', 'name', 'parentId', 'type', 'detail', 'function'], 32),
      storyTree: creationPlanCompactList(p.storyTree, ['node', 'parent', 'goal', 'conflict', 'result', 'chapterRange'], 36),
      conflictChain: creationPlanCompactList(p.conflictChain, ['stage', 'source', 'pressure', 'choice', 'cost', 'chapterRange'], 36),
      rewardChain: creationPlanCompactList(p.rewardChain, ['stage', 'setup', 'payoff', 'cost', 'chapterRange'], 36),
      openForeshadows: creationPlanCompactList((Array.isArray(p.foreshadowLedger) ? p.foreshadowLedger : []).filter(item => item && item.status !== 'paid_off'), ['id', 'plantIn', 'payoffIn', 'desc', 'strength', 'status'], 24),
      previousChapters: creationPlanCompactList(previousChapters, ['chapterNo', 'title', 'goal', 'result', 'hook', 'line'], 8),
      currentChapters: creationPlanCompactList(currentChapters, ['chapterNo', 'title', 'goal', 'result', 'hook', 'line'], 20),
      coverage: { counts: coverage.counts, targets: coverage.targets, completedThrough: coverage.completedThrough }
    };
  }
  
  function creationPlanExpansionPrompt(payload, phase, startChapterNo, endChapterNo, coverage) {
    const context = creationPlanExpansionContext(payload, startChapterNo, endChapterNo, coverage);
    const shared = '你是原创长篇小说规划师。只使用下面的新书创作圣经，禁止引用或猜测来源作品内容。所有新增人物、地点、势力、物品、规则和剧情节点必须原创，并与已有资产保持一致。只返回合法 JSON，不要 Markdown，不要解释。\n';
    if (phase === 'resources') {
      const needs = Object.fromEntries(coverage.missingResources.map(item => [item.field, { actual: item.actual, target: item.target, add: Math.min(12, item.target - item.actual) }]));
      return shared + '当前处于“核心资源扩展”阶段。只补充下列缺口，不要生成正文或章纲：\n' + JSON.stringify(needs) + '\n人物卡必须包含演绎层字段 voice{samples:[标志性台词2句],taboo:绝不会说的话,habit:句式习惯}、tell:[{when:情绪场景,how:外露动作}]、wound:软肋、stance:[{toward,current,evolution}]、emotionStyle:克制型|外放型|转移型。\n输出格式：{worldbuilding:[{category,name,detail,function}],worldRules:[{rule,limit,consequence,scope}],characters:[{name,role,goal,conflict,flaw,arc,relationships,voice,tell,wound,stance,emotionStyle}],characterLibrary:[{name,role,goal,flaw,arc,relationships}],map:{nodes:[{id,name,parentId,type,detail,function}],edges:[{source,target,relation}]},relationships:[{from,to,type,change}],volumePlan:[{volume,title,purpose,goal,turningPoint,endingHook,chapterRange}],architecture:{volumes:[{title,purpose,goal,turningPoint,endingHook,chapterRange}]},storyTree:[{node,parent,goal,conflict,result,chapterRange}],conflictChain:[{stage,source,pressure,choice,cost,chapterRange}],rewardChain:[{stage,setup,payoff,cost,chapterRange}],arcPlan:[{arc,title,goal,opposition,turn,payoff,chapterRange}],foreshadowLedger:[{id,plantIn,payoffIn,desc,strength,status}]}\n已有新书规划上下文：\n' + JSON.stringify(context);
    }
    const expectedCount = Math.max(1, endChapterNo - startChapterNo + 1);
    // ★ 节奏是序列现象：给本批注入近期各章的钩子类型/强度/爽点间隔，避免批次之间平推。
    const recentChapters = (Array.isArray(payload.chapterPlan) ? payload.chapterPlan : [])
      .slice(-6)
      .map(item => item && typeof item === 'object' ? {
        chapterNo: Number(item.chapterNo) || 0,
        hookType: String(item.hookType || ''),
        emotionIntensity: Number(item.emotionIntensity) || 0,
        payoffGap: Number(item.payoffGap) || 0,
        hook: String(item.hook || '').slice(0, 60)
      } : null)
      .filter(Boolean);
    const openForeshadows = (Array.isArray(payload.foreshadowLedger) ? payload.foreshadowLedger : [])
      .filter(item => item && String(item.status || 'planned') !== 'paid')
      .slice(0, 12)
      .map(item => ({ id: item.id, plantIn: item.plantIn, desc: String(item.desc || '').slice(0, 60) }));
    const currentVolume = (Array.isArray(payload.volumePlan) ? payload.volumePlan : []).find(volume => {
      const range = String((volume && volume.chapterRange) || '');
      const numbers = range.match(/\d+/g);
      if (!numbers || numbers.length < 2) return false;
      return startChapterNo >= Number(numbers[0]) && startChapterNo <= Number(numbers[numbers.length - 1]);
    }) || null;
    let batchSpecific = '';
    if (startChapterNo <= 3) {
      const openingTemplate = payload.styleProfile && payload.styleProfile.reusableTemplates && payload.styleProfile.reusableTemplates.openingTemplate;
      const openingStrategy = payload.creationPlan && payload.creationPlan.openingStrategy && typeof payload.creationPlan.openingStrategy === 'object'
        ? payload.creationPlan.openingStrategy
        : {};
      const openingMode = CREATION_OPENING_STRATEGIES.has(String(openingStrategy.mode || ''))
        ? String(openingStrategy.mode)
        : 'advisory';
      if (openingMode === 'disabled') {
        batchSpecific = '\n【开篇专项策略：已关闭】当前批次包含第 1-3 章，请按题材、作者设定和本书自身节奏写作，不额外套用“黄金三章”模板；仍须满足通用章纲字段和引用完整性。';
      } else if (openingMode === 'strict') {
        batchSpecific = '\n【开篇专项策略：严格执行】作者明确选择对第 1-3 章采用开篇工程。请把强钩子、核心机制首次呈现、首轮冲突回报和章末悬念落实到具体章节，并保证它们服务本书题材；若作者备注与通用策略冲突，以作者备注为准。'
          + (openingStrategy.authorNote ? '\n作者开篇备注：' + String(openingStrategy.authorNote).slice(0, 600) : '')
          + (Array.isArray(openingTemplate) && openingTemplate.length ? '\n开篇模板（仅在适配本书时采用）：' + JSON.stringify(openingTemplate).slice(0, 800) : '');
      } else {
        batchSpecific = '\n【开篇专项策略：默认建议，非强制】当前批次包含第 1-3 章。可参考强钩子、尽早呈现核心冲突或能力机制、首轮回报和章末悬念，但必须服从作者设定、题材惯例与叙事节奏；不因未采用“黄金三章”套路而阻断、重写或判定规划失败。'
          + (openingStrategy.authorNote ? '\n作者开篇备注：' + String(openingStrategy.authorNote).slice(0, 600) : '')
          + (Array.isArray(openingTemplate) && openingTemplate.length ? '\n可选开篇模板：' + JSON.stringify(openingTemplate).slice(0, 800) : '');
      }
    }
    return shared + '当前处于“分批章纲扩展”阶段。必须只生成第 ' + startChapterNo + ' 至第 ' + endChapterNo + ' 章，共 ' + expectedCount + ' 章；chapterNo 必须连续、不可重复、不可遗漏。每章必须写出具体标题、章节目标、主角行动、对抗/阻力、信息变化、不可逆结果和章末钩子，不能使用“推进剧情”“发生冲突”“主角变强”等空泛句。每个非主角出场人物必须携带与主角的关系张力（扶持/竞争/提防/亏欠之一）以及一个与当前剧情无关的性格细节（怪癖/习惯动作）；无法承载张力的人物合并或删除。'
      + '\n【节奏合同（每章必填，防止连续平推）】hookType ∈ 悬念|危机|期待|反转（相邻章不得重复同类型）；emotionIntensity 为 0-10 整数（本章情绪强度，爽点/高潮 ≥8，过渡章 4-6，全书不得连续 3 章低于 5）；payoffGap 为距上一次主要爽点兑现的章数（超过 4 章必须安排一次兑现）。'
      + (recentChapters.length ? '\n近期章节节奏（本批必须与它们衔接，强度和钩子类型不得机械重复）：' + JSON.stringify(recentChapters) : '')
      + (openForeshadows.length ? '\n未回收伏笔（本批若触及相关剧情必须安排回收或推进并更新 status）：' + JSON.stringify(openForeshadows) : '')
      + (currentVolume ? '\n所在卷目标（本批章纲必须服务于该卷推进）：' + JSON.stringify({ volume: currentVolume.volume || currentVolume.title, goal: currentVolume.goal, turningPoint: currentVolume.turningPoint, endingHook: currentVolume.endingHook }) : '')
      + batchSpecific
      + '\n输出格式：{chapters:[{chapterNo,title,synopsis,goal,protagonistAction,opposition,informationChange,result,hook,hookType,emotionIntensity,payoffGap,line,characterStateChanges,foreshadowActions}]}\n已有新书规划上下文：\n' + JSON.stringify(context);
  }
  
  function mergeCreationUniqueList(existing, additions, limit = 1000) {
    const output = Array.isArray(existing) ? existing.slice(0, limit) : [];
    const seen = new Set(output.map((item, index) => creationPlanItemKey(item, index)));
    (Array.isArray(additions) ? additions : []).forEach(item => {
      if (!creationPlanHasContent(item) || output.length >= limit) return;
      const key = creationPlanItemKey(item, output.length);
      if (seen.has(key)) return;
      seen.add(key);
      output.push(item);
    });
    return output;
  }
  
  function mergeCreationVolumes(existing, additions, limit = 100) {
    const output = Array.isArray(existing) ? existing.slice(0, limit).map(item => ({ ...(item && typeof item === 'object' ? item : {}) })) : [];
    const volumeKey = (item, index) => {
      if (!item || typeof item !== 'object') return 'volume-' + index;
      const value = item.volume || item.title || item.name || item.id;
      return String(value == null ? '' : value).trim().toLowerCase() || 'volume-' + index;
    };
    const positions = new Map(output.map((item, index) => [volumeKey(item, index), index]));
    (Array.isArray(additions) ? additions : []).forEach(item => {
      if (!item || typeof item !== 'object' || !creationPlanHasContent(item) || output.length >= limit) return;
      const key = volumeKey(item, output.length);
      const existingIndex = positions.get(key);
      if (existingIndex !== undefined) output[existingIndex] = { ...output[existingIndex], ...item };
      else { positions.set(key, output.length); output.push({ ...item }); }
    });
    return output;
  }
  
  function normalizeCreationExpansionChapter(item, fallbackChapterNo) {
    const source = item && typeof item === 'object' ? item : {};
    const chapterNo = creationChapterNumber(source) || fallbackChapterNo;
    return {
      ...source,
      chapterNo,
      title: creationChapterTitle(source),
      synopsis: creationPlanText(source.synopsis || source.summary || source.goal || source.beat, 800),
      goal: creationPlanText(source.goal || source.synopsis || source.beat, 800),
      protagonistAction: creationPlanText(source.protagonistAction || source.action, 800),
      opposition: creationPlanText(source.opposition || source.obstacle || source.conflict, 800),
      informationChange: creationPlanText(source.informationChange || source.information || source.newInformation, 800),
      result: creationPlanText(source.result || source.irreversibleResult || source.outcome, 800),
      hook: creationPlanText(source.hook || source.endingHook || source.exitHook, 800),
      line: creationPlanText(source.line || source.storyline, 120),
      characterStateChanges: Array.isArray(source.characterStateChanges) ? structuredClone(source.characterStateChanges) : [],
      foreshadowActions: Array.isArray(source.foreshadowActions) ? structuredClone(source.foreshadowActions) : []
    };
  }
  
  function normalizeCreationChapterPlanRhythm(chapters) {
    const hookTypes = ['悬念', '危机', '期待', '反转'];
    const list = (Array.isArray(chapters) ? chapters : []).map((item, index) => ({
      item: item && typeof item === 'object' && !Array.isArray(item) ? item : {},
      index,
      chapterNo: creationChapterNumber(item) || index + 1
    })).sort((left, right) => left.chapterNo - right.chapterNo || left.index - right.index);
    const textOf = item => [item.title, item.synopsis, item.goal, item.protagonistAction, item.opposition, item.informationChange, item.result, item.hook, item.line, item.payoff, item.reward, item.payoffEvent]
      .map(value => String(value == null ? '' : value)).join(' ');
    const validHook = value => hookTypes.includes(String(value || '').trim());
    const chooseHook = (item, chapterNo, previousType, nextType) => {
      const raw = String(item.hookType || '').trim();
      if (validHook(raw)) return raw;
      const text = textOf(item);
      let type = /反转|原来|竟然|真相|身份|误认|倒转|不是/.test(text)
        ? '反转'
        : /危机|追杀|封锁|围困|袭击|失去|濒死|崩塌|截断|扣押|阻止/.test(text)
          ? '危机'
          : /期待|即将|等待|线索|指向|入口|消息|名单|准备|传来|下一/.test(text)
            ? '期待'
            : hookTypes[Math.max(0, chapterNo - 1) % hookTypes.length];
      const blocked = new Set([previousType, nextType].filter(validHook));
      if (blocked.has(type)) {
        const start = hookTypes.indexOf(type);
        for (let offset = 1; offset < hookTypes.length; offset += 1) {
          const candidate = hookTypes[(start + offset) % hookTypes.length];
          if (!blocked.has(candidate)) { type = candidate; break; }
        }
      }
      return type;
    };
    const chooseIntensity = (item, hookType) => {
      const raw = Number(item.emotionIntensity);
      if (Number.isInteger(raw) && raw >= 0 && raw <= 10) return raw;
      const text = textOf(item);
      const base = { 悬念: 6, 危机: 8, 期待: 7, 反转: 8 }[hookType] || 6;
      const high = /高潮|决战|生死|突破|击败|反击|救出|夺回|守住|破局|成功|兑现/.test(text);
      const quiet = /准备|商议|调查|核对|整理|等待|抵达|寻找/.test(text) && !high;
      return Math.max(4, Math.min(10, base + (high ? 1 : 0) - (quiet ? 1 : 0)));
    };
    let previousType = '';
    let previousGap = 0;
    return list.map((entry, position) => {
      const source = entry.item;
      const nextSource = list[position + 1] && list[position + 1].item;
      const nextType = nextSource && validHook(nextSource.hookType) ? String(nextSource.hookType).trim() : '';
      const hookType = chooseHook(source, entry.chapterNo, previousType, nextType);
      const rawGap = Number(source.payoffGap);
      const hasPayoff = /获得|拿到|锁定|确认|破解|揭开|揭示|夺回|救出|击败|反击|突破|守住|成功|兑现|真相|完成|签下|赢得|破局|取回|找到/.test(textOf(source));
      const payoffGap = Number.isInteger(rawGap) && rawGap >= 0
        ? rawGap
        : hasPayoff ? 0 : Math.min(4, previousGap + 1);
      previousType = hookType;
      previousGap = payoffGap;
      return {
        ...source,
        chapterNo: entry.chapterNo,
        hookType,
        emotionIntensity: chooseIntensity(source, hookType),
        payoffGap
      };
    });
  }
  
  function mergeCreationChapterPlan(existing, additions, totalChapters) {
    const byNo = new Map();
    (Array.isArray(existing) ? existing : []).forEach(item => {
      const chapterNo = creationChapterNumber(item);
      if (chapterNo >= 1 && chapterNo <= totalChapters && !byNo.has(chapterNo)) byNo.set(chapterNo, item);
    });
    (Array.isArray(additions) ? additions : []).forEach(item => {
      const chapterNo = creationChapterNumber(item);
      if (chapterNo >= 1 && chapterNo <= totalChapters) byNo.set(chapterNo, item);
    });
    return normalizeCreationChapterPlanRhythm(
      [...byNo.entries()].sort((left, right) => left[0] - right[0])
        .map(item => normalizeCreationExpansionChapter(item[1], item[0]))
    );
  }
  
  function mergeCreationExpansionPayload(payload, generated, phase, totalChapters) {
    const output = JSON.parse(JSON.stringify(payload && typeof payload === 'object' ? payload : {}));
    const source = generated && typeof generated === 'object' && !Array.isArray(generated) ? generated : {};
    const additions = source.resources && typeof source.resources === 'object' ? { ...source, ...source.resources } : source;
    const firstList = (...values) => values.find(value => Array.isArray(value) && value.length) || [];
    if (phase === 'chapters') {
      const raw = firstList(additions.chapters, additions.chapterPlan);
      output.chapterPlan = mergeCreationChapterPlan(output.chapterPlan, raw.map((item, index) => normalizeCreationExpansionChapter(item, index + 1)), totalChapters);
      return output;
    }
    output.worldbuilding = mergeCreationUniqueList(output.worldbuilding, firstList(additions.worldbuilding, additions.world, additions.settings), 200);
    output.worldRules = mergeCreationUniqueList(output.worldRules, firstList(additions.worldRules, additions.rules), 160);
    output.characters = mergeCreationUniqueList(output.characters, firstList(additions.characters, additions.characterDesign), 200);
    output.characterLibrary = mergeCreationUniqueList(output.characterLibrary, firstList(additions.characterLibrary, additions.characterPlan, additions.characters), 240);
    output.relationships = mergeCreationUniqueList(output.relationships, firstList(additions.relationships), 300);
    output.storyTree = mergeCreationUniqueList(output.storyTree, firstList(additions.storyTree, additions.storyNodes), 400);
    output.conflictChain = mergeCreationUniqueList(output.conflictChain, firstList(additions.conflictChain, additions.conflicts), 400);
    output.rewardChain = mergeCreationUniqueList(output.rewardChain, firstList(additions.rewardChain, additions.rewards), 400);
    output.arcPlan = mergeCreationUniqueList(output.arcPlan, firstList(additions.arcPlan, additions.storyArcs, additions.arcs), 200);
    output.foreshadowLedger = mergeCreationUniqueList(output.foreshadowLedger, firstList(additions.foreshadowLedger, additions.foreshadowPlan, additions.foreshadows), 400);
    const generatedMap = additions.map && typeof additions.map === 'object' ? additions.map : {};
    const currentMap = output.map && typeof output.map === 'object' ? output.map : {};
    output.map = {
      ...currentMap,
      nodes: mergeCreationUniqueList(currentMap.nodes, generatedMap.nodes, 240),
      edges: mergeCreationUniqueList(currentMap.edges, generatedMap.edges, 480)
    };
    const generatedArchitecture = additions.architecture && typeof additions.architecture === 'object' ? additions.architecture : {};
    const generatedVolumes = firstList(additions.volumePlan, additions.volumes, generatedArchitecture.volumes, generatedArchitecture.volumeMap);
    output.volumePlan = mergeCreationVolumes(output.volumePlan, generatedVolumes, 100);
    const currentArchitecture = output.architecture && typeof output.architecture === 'object' ? output.architecture : {};
    output.architecture = {
      ...currentArchitecture,
      ...generatedArchitecture,
      volumes: mergeCreationVolumes(currentArchitecture.volumes || currentArchitecture.volumeMap, generatedVolumes, 100)
    };
    return output;
  }
  
  function creationForbiddenTerms(payload) {
    const forbidden = payload && payload.forbiddenCopy && typeof payload.forbiddenCopy === 'object' ? payload.forbiddenCopy : {};
    return [...new Set(['entities', 'events', 'quotedText', 'sequencePatterns', 'roleCombinations'].flatMap(key => Array.isArray(forbidden[key]) ? forbidden[key] : []).map(item => {
      if (typeof item === 'string') return item;
      return item && (item.term || item.name || item.title || item.description || item.sequence || item.role) || '';
    }).map(String).map(item => item.trim()).filter(item => item.length >= 2))].slice(0, 500);
  }
  
  function creationChapterContext(payload, chapterNo) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const plan = p.creationPlan || {};
    const chapters = Array.isArray(p.chapterPlan) ? p.chapterPlan : [];
    const current = chapters[Math.max(0, Number(chapterNo) - 1)] || {};
    const lines = Array.isArray(plan.lines) ? plan.lines : [];
    return {
      chapterNo: Number(chapterNo) || 1,
      title: String(current.title || current.name || ('第' + chapterNo + '章')).slice(0, 160),
      goal: String(current.goal || current.synopsis || current.beat || '').slice(0, 1000),
      linePriority: lines,
      premise: p.bookPremise || {},
      authorDna: p.authorDna || {},
      characters: Array.isArray(p.characters) ? p.characters.slice(0, 20) : [],
      characterLibrary: Array.isArray(p.characterLibrary) ? p.characterLibrary.slice(0, 20) : [],
      mainline: p.mainline || {},
      storyTree: Array.isArray(p.storyTree) ? p.storyTree.slice(0, 40) : [],
      conflictChain: Array.isArray(p.conflictChain) ? p.conflictChain.slice(0, 40) : [],
      rewardChain: Array.isArray(p.rewardChain) ? p.rewardChain.slice(0, 40) : [],
      volumePlan: Array.isArray(p.volumePlan) ? p.volumePlan.slice(0, 20) : [],
      arcPlan: Array.isArray(p.arcPlan) ? p.arcPlan.slice(0, 30) : [],
      scenePlan: Array.isArray(p.scenePlan) ? p.scenePlan.filter(item => !item || Number(item.chapterNo || item.chapter) === Number(chapterNo)).slice(0, 30) : [],
      goldenFinger: p.goldenFinger || {},
      openForeshadows: Array.isArray(p.foreshadowLedger) ? p.foreshadowLedger.filter(item => item && item.status !== 'paid_off').slice(0, 20) : [],
      rules: Array.isArray(p.worldRules) ? p.worldRules.slice(0, 20) : [],
      retentionRules: Array.isArray(p.retentionRules) ? p.retentionRules : [],
      reviewPlan: p.reviewPlan || {}
    };
  }
  
  function creationPlanProjection(payload) {
    const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const list = (value, limit) => Array.isArray(value) ? value.slice(0, limit) : [];
    const sample = (value, head = 12, tail = 12) => {
      if (!Array.isArray(value)) return [];
      if (value.length <= head + tail) return value.slice();
      return [...value.slice(0, head), ...value.slice(-tail)];
    };
    const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const map = object(p.map);
    const coverage = creationPlanCoverage(p);
    const chapterPlan = normalizeCreationChapterPlanRhythm(p.chapterPlan);
    return {
      schemaVersion: String(p.schemaVersion || ''),
      creationPlan: object(p.creationPlan),
      retentionRules: list(p.retentionRules, 12),
      taskConstraints: object(p.taskConstraints),
      bookPremise: object(p.bookPremise),
      authorDna: object(p.authorDna),
      architecture: object(p.architecture),
      opening: object(p.opening),
      goldenFinger: object(p.goldenFinger),
      worldbuilding: list(p.worldbuilding, 160),
      worldRules: list(p.worldRules, 160),
      map: { nodes: list(map.nodes, 160), edges: list(map.edges, 240) },
      characters: list(p.characters, 200),
      characterLibrary: list(p.characterLibrary, 200),
      mainline: object(p.mainline),
      storyTree: list(p.storyTree, 300),
      conflictChain: list(p.conflictChain, 300),
      rewardChain: list(p.rewardChain, 300),
      relationships: list(p.relationships, 300),
      volumePlan: list(p.volumePlan, 100),
      arcPlan: list(p.arcPlan, 160),
      chapterPlan: sample(chapterPlan, 12, 12),
      scenePlan: sample(p.scenePlan, 12, 12),
      foreshadowLedger: list(p.foreshadowLedger, 80),
      reviewPlan: object(p.reviewPlan),
      planningState: object(p.planningState),
      coverage: {
        targets: coverage.targets,
        counts: coverage.counts,
        completedThrough: coverage.completedThrough,
        missingChapterCount: coverage.missingChapters.length,
        invalidChapterCount: coverage.invalidChapters.length,
        duplicateChapterCount: coverage.duplicateChapters.length,
        missingResources: coverage.missingResources
      },
      sourceBoundary: {
        originalContentExcluded: true,
        forbiddenTermCount: creationForbiddenTerms(p).length
      }
    };
  }
  
  function creationPlanHasContent(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.some(item => creationPlanHasContent(item));
    if (typeof value === 'object') return Object.values(value).some(item => creationPlanHasContent(item));
    return false;
  }
  
  function creationPlanIssue(layer, code, severity, message, field, suggestion, source) {
    return {
      id: 'creation-plan-' + String(layer || 'unknown') + '-' + String(code || 'issue'),
      layer: String(layer || 'structure'),
      code: String(code || 'issue'),
      severity: ['blocker', 'warning', 'info'].includes(String(severity)) ? String(severity) : 'warning',
      message: String(message || '').slice(0, 500),
      field: String(field || '').slice(0, 160),
      suggestion: String(suggestion || '').slice(0, 500),
      source: String(source || 'local')
    };
  }
  
  function reviewCreationPlan(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const issues = [];
    const checksByLayer = new Map(CREATION_PLAN_REVIEW_LAYERS.map(layer => [layer, []]));
    const add = (layer, code, severity, message, field, suggestion) => {
      const issue = creationPlanIssue(layer, code, severity, message, field, suggestion, 'local');
      issues.push(issue);
      checksByLayer.get(layer)?.push({ code, status: severity === 'blocker' ? 'failed' : 'needs_review', field, detail: message });
    };
    const pass = (layer, code, field, detail) => checksByLayer.get(layer)?.push({ code, status: 'passed', field, detail });
    const architecture = p.architecture && typeof p.architecture === 'object' ? p.architecture : {};
    const map = p.map && typeof p.map === 'object' ? p.map : {};
    const architectureVolumes = Array.isArray(architecture.volumes) ? architecture.volumes : Array.isArray(architecture.volumeMap) ? architecture.volumeMap : [];
    const hasStructure = architectureVolumes.length
      || (Array.isArray(p.volumePlan) && p.volumePlan.length)
      || (Array.isArray(p.storyTree) && p.storyTree.length);
    if (!creationPlanHasContent(p.creationPlan) || !hasStructure) {
      add('structure', 'missing_structure', 'blocker', '缺少整体架构、分卷规划或故事树，无法形成从总纲到故事树的结构链路', 'architecture/volumePlan/storyTree', '补齐分卷目标、阶段转折和故事树节点');
    } else pass('structure', 'structure_present', 'architecture/volumePlan/storyTree', '整体架构资产已提供');
    if (!Array.isArray(p.storyTree) || !p.storyTree.length) add('structure', 'missing_story_tree', 'blocker', '故事树为空，章节规划缺少上游结构节点', 'storyTree', '为每个主要阶段补充父节点、目标、冲突和结果');
    else pass('structure', 'story_tree_present', 'storyTree', '故事树已提供');
  
    if ((!Array.isArray(p.worldbuilding) || !p.worldbuilding.length) && (!Array.isArray(p.worldRules) || !p.worldRules.length)) add('worldbuilding', 'missing_world', 'blocker', '世界观与世界规则均为空', 'worldbuilding/worldRules', '补齐世界运行规则、资源限制和关键空间');
    else pass('worldbuilding', 'world_present', 'worldbuilding/worldRules', '世界观或世界规则已提供');
    if (!Array.isArray(map.nodes) || map.nodes.filter(node => node && String(node.name || node.title || '').trim()).length < 3) add('worldbuilding', 'map_too_small', 'warning', '地图节点少于 3 个，场景级规划缺少空间约束', 'map.nodes', '补充至少三个可发生行动的空间节点');
    else pass('worldbuilding', 'map_present', 'map.nodes', '地图节点数量达到最低要求');
  
    if (!Array.isArray(p.characters) || !p.characters.some(item => item && String(item.name || item.role || '').trim())) add('characters', 'missing_characters', 'blocker', '人物库为空，无法进行人物目标、缺陷和弧光审核', 'characters', '至少补齐主角、主要阻力人物和关键关系人物');
    else pass('characters', 'characters_present', 'characters', '人物库已提供');
    if (!Array.isArray(p.characterLibrary) || !p.characterLibrary.length) add('characters', 'missing_character_library', 'warning', '人物库没有独立的功能索引', 'characterLibrary', '为主要人物补充功能、目标、缺陷和关系');
    else pass('characters', 'character_library_present', 'characterLibrary', '人物功能索引已提供');
  
    if (!creationPlanHasContent(p.mainline)) add('mainline', 'missing_mainline', 'blocker', '主线目标或终局承诺为空', 'mainline', '补齐主角主线目标、推进机制和结局承诺');
    else pass('mainline', 'mainline_present', 'mainline', '主线已提供');
    if (!Array.isArray(p.conflictChain) || !p.conflictChain.length) add('conflict', 'missing_conflict_chain', 'blocker', '冲突链为空，无法保证压力逐级升级', 'conflictChain', '补齐阶段压力、主角选择、代价和章节范围');
    else pass('conflict', 'conflict_chain_present', 'conflictChain', '冲突链已提供');
    if ((!Array.isArray(p.rewardChain) || !p.rewardChain.length) && !creationPlanHasContent(p.goldenFinger)) add('reward', 'missing_reward_chain', 'blocker', '爽点/回报链与核心回报机制均为空', 'rewardChain/goldenFinger', '补齐回报设置、铺垫、兑现和代价循环');
    else pass('reward', 'reward_chain_present', 'rewardChain/goldenFinger', '回报链或核心回报机制已提供');
  
    if (!Array.isArray(p.chapterPlan) || !p.chapterPlan.length) add('chapter', 'missing_chapter_plan', 'blocker', '章节级规划为空', 'chapterPlan', '为每章补充目标、阻力、信息变化、结果和章末钩子');
    else pass('chapter', 'chapter_plan_present', 'chapterPlan', '章节规划已提供');
    if (!Array.isArray(p.scenePlan) || !p.scenePlan.length) add('chapter', 'missing_scene_plan', 'warning', '场景级规划为空，章节目标无法继续落到场景', 'scenePlan', '为章节补充视角、场景目标、冲突和退出钩子');
    else pass('chapter', 'scene_plan_present', 'scenePlan', '场景规划已提供');
  
    // 分批规划完成后启用严格覆盖门禁；旧版手工 Bible 没有 planningState 时保持兼容。
    const strictCoverage = p.planningState && p.planningState.status === 'completed';
    if (strictCoverage) {
      const coverage = creationPlanCoverage(p);
      coverage.missingResources.forEach(item => add('structure', 'resource_coverage_shortfall', 'blocker', item.field + ' 仅有 ' + item.actual + ' 项，规模目标为 ' + item.target + ' 项', item.field, '继续运行规划扩展，补齐规模化创作资产'));
      if (!coverage.chaptersReady) {
        const missing = coverage.missingChapters.length;
        const invalid = coverage.invalidChapters.length;
        add('chapter', 'chapter_coverage_incomplete', 'blocker', '章节规划未形成连续完整覆盖：缺少 ' + missing + ' 章，字段不完整 ' + invalid + ' 章，重复 ' + coverage.duplicateChapters.length + ' 章', 'chapterPlan', '按缺口补齐每章标题、目标、主角行动、阻力、信息变化、结果和章末钩子');
      } else pass('chapter', 'chapter_coverage_complete', 'chapterPlan', '已连续覆盖第 1 至第 ' + coverage.plan.totalChapters + ' 章');
    }
  
    let seedGate = { hits: [], missing: [] };
    try { seedGate = creationBibleSeedValidation(p, creationForbiddenTerms(p)); } catch (_) {}
    seedGate.hits.forEach(hit => add('originality', 'forbidden_term', 'blocker', '规划实体命中原书禁止复用项「' + hit.term + '」', hit.field, '更换新作中的人物、地点、势力、物品或术语名称'));
    seedGate.missing.forEach(item => add('originality', 'seed_incomplete', 'blocker', '原创规划门禁未通过：' + item.reason, item.field, '补齐原创规划的最低结构要求'));
    if (!seedGate.hits.length && !seedGate.missing.length) pass('originality', 'originality_gate', 'forbiddenCopy', '未发现原书专名命中且原创最低结构完整');
  
    const layers = CREATION_PLAN_REVIEW_LAYERS.map(layer => {
      const layerIssues = issues.filter(issue => issue.layer === layer);
      const checks = checksByLayer.get(layer) || [];
      return { layer, status: layerIssues.some(issue => issue.severity === 'blocker') ? 'blocked' : layerIssues.length ? 'needs_revision' : 'passed', checks, issues: layerIssues };
    });
    const blockers = issues.filter(issue => issue.severity === 'blocker').length;
    return {
      version: '1.0', status: blockers ? 'blocked' : issues.length ? 'needs_revision' : 'passed',
      layers, issues: issues.slice(0, 100), blockerCount: blockers,
      warningCount: issues.filter(issue => issue.severity === 'warning').length,
      checkedAt: Date.now(), source: 'local'
    };
  }
  
  function normalizeCreationPlanReviewModel(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const direct = Array.isArray(source.issues) ? source.issues : Array.isArray(source.findings) ? source.findings : [];
    const fromLayers = Array.isArray(source.layers) ? source.layers.flatMap(layer => Array.isArray(layer && (layer.issues || layer.findings)) ? (layer.issues || layer.findings).map(issue => ({ ...issue, layer: issue && issue.layer || layer.layer || layer.name })) : []) : [];
    const issues = [...direct, ...fromLayers].map((item, index) => {
      const issue = item && typeof item === 'object' ? item : { message: item };
      return creationPlanIssue(issue.layer || 'structure', issue.code || 'model-' + (index + 1), issue.severity || issue.level || 'warning', issue.message || issue.description || issue.detail, issue.field || issue.path, issue.suggestion || issue.fix || issue.recommendation, 'model');
    }).filter(issue => issue.message).slice(0, 100);
    const patches = Array.isArray(source.patches) ? source.patches.slice(0, 30) : Array.isArray(source.revisions) ? source.revisions.slice(0, 30) : [];
    const requestedStatus = String(source.status || '').trim();
    const status = ['passed', 'needs_revision', 'blocked', 'unavailable'].includes(requestedStatus)
      ? requestedStatus
      : issues.some(issue => issue.severity === 'blocker') ? 'blocked' : issues.length ? 'needs_revision' : 'passed';
    return { version: '1.0', status, summary: String(source.summary || source.overview || '').slice(0, 1000), issues, patches, layers: Array.isArray(source.layers) ? source.layers.slice(0, 8) : [], source: 'model' };
  }
  
  function mergeCreationPlanReview(localReview, modelReview, finalLocalReview) {
    const local = localReview && typeof localReview === 'object' ? localReview : reviewCreationPlan({});
    const semantic = modelReview && typeof modelReview === 'object' ? modelReview : normalizeCreationPlanReviewModel({ status: 'unavailable' });
    const after = finalLocalReview && typeof finalLocalReview === 'object' ? finalLocalReview : local;
    const allIssues = [...(after.issues || []), ...(semantic.issues || [])];
    const seen = new Set();
    const issues = allIssues.filter(issue => {
      const key = [issue.layer, issue.code, issue.field, issue.message].join('\u0000');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 120);
    const layers = CREATION_PLAN_REVIEW_LAYERS.map(layer => {
      const layerIssues = issues.filter(issue => issue.layer === layer);
      const localLayer = (after.layers || []).find(item => item && item.layer === layer);
      return { layer, status: layerIssues.some(issue => issue.severity === 'blocker') ? 'blocked' : layerIssues.length ? 'needs_revision' : 'passed', checks: localLayer && localLayer.checks || [], issues: layerIssues };
    });
    const blockerCount = issues.filter(issue => issue.severity === 'blocker').length;
    const status = blockerCount
      ? 'blocked'
      : semantic.status === 'unavailable'
        ? 'unavailable'
        : issues.length ? 'needs_revision' : 'passed';
    return {
      version: '1.0', status, layers, issues,
      blockerCount, warningCount: issues.filter(issue => issue.severity === 'warning').length,
      summary: String(semantic.summary || '').slice(0, 1000), local: after, semantic, reviewedAt: Date.now()
    };
  }
  
  function normalizeCreationPlanPatchPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const segments = raw.startsWith('/')
      ? raw.slice(1).split('/').map(item => item.replace(/~1/g, '/').replace(/~0/g, '~'))
      : raw.replace(/\[(\d+)\]/g, '.$1').split('.');
    if (!segments.length || !CREATION_PLAN_PATCH_ROOTS.has(segments[0])) return null;
    if (segments.some(segment => !/^(?:[A-Za-z][A-Za-z0-9_-]*|\d+|-)$/.test(segment) || ['__proto__', 'prototype', 'constructor'].includes(segment))) return null;
    return segments;
  }
  
  function creationPlanPatchValueKind(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
  }
  
  function creationPlanPatchTypeMismatch(payload, path, value) {
    let current = payload;
    let expectedKind = '';
    for (let index = 0; index < path.length; index += 1) {
      const segment = path[index];
      const last = index === path.length - 1;
      if (last) {
        if (Array.isArray(current)) {
          if (/^\d+$/.test(segment) && Number(segment) < current.length) expectedKind = creationPlanPatchValueKind(current[Number(segment)]);
          else if ((segment === '-' || /^\d+$/.test(segment)) && current.length) expectedKind = creationPlanPatchValueKind(current[0]);
        } else if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, segment)) {
          expectedKind = creationPlanPatchValueKind(current[segment]);
        } else if (index === 0) {
          expectedKind = CREATION_PLAN_PATCH_ROOT_KINDS[segment] || '';
        }
        break;
      }
      if (Array.isArray(current)) {
        if (!/^\d+$/.test(segment) || Number(segment) >= current.length) break;
        current = current[Number(segment)];
      } else if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, segment)) {
        current = current[segment];
      } else {
        break;
      }
    }
    if (!expectedKind) return '';
    const actualKind = creationPlanPatchValueKind(value);
    return expectedKind === actualKind ? '' : '目标字段类型不匹配：期望 ' + expectedKind + '，收到 ' + actualKind;
  }
  
  function creationPlanPatchWouldShrink(payload, path, value, operation) {
    if (operation !== 'replace' || path.length !== 1 || !Array.isArray(value)) return '';
    const current = payload && typeof payload === 'object' ? payload[path[0]] : null;
    if (!Array.isArray(current) || value.length >= current.length) return '';
    return '不能用更短数组覆盖已有规划：当前 ' + current.length + ' 项，补丁仅含 ' + value.length + ' 项';
  }
  
  function applyCreationPlanPatches(payload, patches) {
    let output;
    try { output = JSON.parse(JSON.stringify(payload && typeof payload === 'object' ? payload : {})); } catch (_) { output = {}; }
    const applied = [], rejected = [];
    const list = Array.isArray(patches) ? patches.slice(0, 30) : [];
    list.forEach((patch, index) => {
      const item = patch && typeof patch === 'object' ? patch : {};
      const path = normalizeCreationPlanPatchPath(item.path || item.field);
      const op = String(item.op || 'replace').toLowerCase();
      if (!path || !['replace', 'add'].includes(op)) { rejected.push({ index, reason: '路径不在规划白名单或操作不支持' }); return; }
      let serialized = '';
      try { serialized = JSON.stringify(item.value); } catch (_) {}
      if (!serialized || serialized.length > 120000) { rejected.push({ index, reason: '补丁值为空或超过 120KB' }); return; }
      const typeMismatch = creationPlanPatchTypeMismatch(output, path, item.value);
      if (typeMismatch) { rejected.push({ index, reason: typeMismatch }); return; }
      const shrinkReason = creationPlanPatchWouldShrink(output, path, item.value, op);
      if (shrinkReason) { rejected.push({ index, reason: shrinkReason }); return; }
      let parent = output;
      let failed = false;
      for (let i = 0; i < path.length - 1; i += 1) {
        const segment = path[i];
        if (parent === null || parent === undefined || (typeof parent !== 'object')) { failed = true; break; }
        if (!(segment in parent)) {
          if (op !== 'add') { failed = true; break; }
          parent[segment] = /^\d+$/.test(path[i + 1]) || path[i + 1] === '-' ? [] : {};
        }
        parent = parent[segment];
      }
      const last = path[path.length - 1];
      if (failed || parent === null || typeof parent !== 'object') { rejected.push({ index, reason: '目标路径不存在' }); return; }
      if (Array.isArray(parent)) {
        if (last === '-') { if (op !== 'add') { rejected.push({ index, reason: '数组末尾只支持 add' }); return; } parent.push(item.value); }
        else if (!/^\d+$/.test(last) || Number(last) > 10000) { rejected.push({ index, reason: '数组下标非法' }); return; }
        else if (op === 'add') parent.splice(Number(last), 0, item.value);
        else if (Number(last) >= parent.length) { rejected.push({ index, reason: 'replace 目标不存在' }); return; }
        else parent[Number(last)] = item.value;
      } else {
        if (['__proto__', 'prototype', 'constructor'].includes(last)) { rejected.push({ index, reason: '禁止修改原型字段' }); return; }
        if (op === 'replace' && !Object.prototype.hasOwnProperty.call(parent, last)) { rejected.push({ index, reason: 'replace 目标不存在' }); return; }
        parent[last] = item.value;
      }
      applied.push({ index, op, path: '/' + path.join('/'), value: item.value });
    });
    return { payload: output, applied, rejected, changed: applied.length > 0 };
  }
  
  function eventChainLcsRatio(chainA, chainB) {
    const norm = ev => {
      if (typeof ev === 'string') return String(ev).replace(/[\s，。,.！!？?、]/g, '').slice(0, 40);
      if (!ev || typeof ev !== 'object') return '';
      const act = String(ev.action || ev.type || ev.eventType || '').slice(0, 20);
      const role = String(ev.role || ev.character || ev.subject || '').slice(0, 20);
      const result = String(ev.result || ev.outcome || ev.consequence || '').slice(0, 20);
      return (act + '|' + role + '|' + result).replace(/[\s]/g, '');
    };
    const MAX_EVENTS = 50;
    const a = (Array.isArray(chainA) ? chainA : []).map(norm).filter(Boolean).slice(-MAX_EVENTS);
    const b = (Array.isArray(chainB) ? chainB : []).map(norm).filter(Boolean).slice(0, MAX_EVENTS);
    if (a.length < 2 || b.length < 2) return null;
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
    return Math.min(1, dp[n][m] / Math.max(n, m));
  }
  
  function functionSetJaccard(setA, setB) {
    const collect = list => new Set((Array.isArray(list) ? list : []).flatMap(item => {
      if (typeof item === 'string') return [item.trim()].filter(Boolean);
      if (!item || typeof item !== 'object') return [];
      const tags = [item.role, item.function, item.functionType, item.type].map(v => (v == null ? '' : String(v)));
      if (Array.isArray(item.tags)) tags.push(...item.tags.map(String));
      if (Array.isArray(item.functions)) tags.push(...item.functions.map(String));
      return tags.flatMap(tag => String(tag).split(/[，,、/|]/));
    }).map(t => String(t).trim()).filter(t => t.length >= 2));
    const A = collect(setA), B = collect(setB);
    if (!A.size || !B.size) return null;
    let inter = 0;
    A.forEach(x => { if (B.has(x)) inter++; });
    return inter / (A.size + B.size - inter);
  }
  
  function computeStructuralSimilarity(payload, snapshots) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const src = p.sourceStructure && typeof p.sourceStructure === 'object' ? p.sourceStructure : {};
    const srcEvents = Array.isArray(src.events) ? src.events : [];
    const srcChars = Array.isArray(src.characters) ? src.characters : [];
    const ordered = (Array.isArray(snapshots) ? snapshots : []).filter(s => s && Array.isArray(s.recentFacts)).sort((a, b) => Number(a.chapterNo) - Number(b.chapterNo));
    const newEvents = ordered.length ? ordered.flatMap(s => s.recentFacts) : (Array.isArray(p.timeline) ? p.timeline : []);
    const newChars = Array.isArray(p.characters) ? p.characters : [];
    const ec = eventChainLcsRatio(newEvents, srcEvents);
    const fj = functionSetJaccard(newChars, srcChars);
    const blocked = (typeof ec === 'number' && ec > 0.7) || (typeof fj === 'number' && fj > 0.8);
    return { eventChainLcsRatio: ec, functionSetJaccard: fj, blocked };
  }
  
  function evaluateSomaticGate(content, contract) {
    const text = String(content || '');
    const hits = [];
    for (const m of text.matchAll(SOMATIC_REFLEX_PATTERN)) { hits.push(m[0]); if (hits.length >= 40) break; }
    const c = contract && typeof contract === 'object' ? contract : {};
    const rawLevel = [c.emotionIntensity, c.intensity, c.tension, c.energyLevel, c.rhythm && c.rhythm.intensity]
      .map(v => Number(v)).find(v => Number.isFinite(v));
    const level = Number.isFinite(rawLevel) ? Math.max(0, Math.min(10, rawLevel)) : 5;
    const perKilo = text.length ? Math.round(hits.length / Math.max(1, text.length / 1000) * 100) / 100 : 0;
    const metrics = { level, hits: hits.length, perKilo, samples: [...new Set(hits)].slice(0, 5) };
    let issue = null;
    if (hits.length >= 6) {
      issue = { severity: 'blocker', category: 'somatic', description: '躯体应激套话 ' + hits.length + ' 处（如「' + metrics.samples.join('」「') + '」），已形成模型条件反射式写法', suggestion: '改写为外部物理反馈或直接动作；低能级场景平稳拿放、平稳说话' };
    } else if (level <= 4 && hits.length >= 1) {
      issue = { severity: 'warning', category: 'somatic', description: '本章能级 ' + level + '（日常/低张力）却出现 ' + hits.length + ' 处躯体应激套话（「' + metrics.samples.join('」「') + '」）', suggestion: '低能级场景不写神经反射，删去或换成自然白描' };
    } else if (hits.length >= 3) {
      issue = { severity: 'warning', category: 'somatic', description: '躯体应激套话累计 ' + hits.length + ' 处（「' + metrics.samples.join('」「') + '」），超出能级 ' + level + ' 的合理配比', suggestion: '保留最多 1-2 处最关键的生理反应，其余改为物理客体或对白' };
    }
    return { issue, metrics };
  }
  
  function verifyModelAuditQuotes(items, content) {
    const normalize = value => String(value || '').replace(/\s+/g, '');
    const haystack = normalize(content);
    return (Array.isArray(items) ? items : []).filter(item => item && typeof item === 'object').map(item => {
      const quote = normalize(item.quote || item.position || '');
      if (!quote) return item;
      if (quote.length >= 4 && haystack.includes(quote)) return { ...item, verified: true };
      const next = { ...item, unverified: true };
      if (String(item.severity) === 'blocker') {
        next.severity = 'warning';
        next.description = '[引文未能在正文定位，已降级] ' + String(item.description || '');
      }
      return next;
    });
  }
  
  function creationOriginalityGate(payload, modelAudit, forbiddenIssues, snapshots, sourcePayload) {
    const metrics = modelAudit && modelAudit.structureMetrics && typeof modelAudit.structureMetrics === 'object' ? modelAudit.structureMetrics : {};
    const thresholds = { eventChainSimilarity: 0.35, roleCombinationSimilarity: 0.4, mapTopologySimilarity: 0.45, relationshipGraphSimilarity: 0.45, goldenFingerMechanismSimilarity: 0.35 };
    const names = Object.keys(thresholds);
    // 原书结构来源：优先取传入 sourcePayload 的 sourceStructure，其次取新书自身的 sourceStructure（由拆书简报 seed）
    const src = (sourcePayload && sourcePayload.sourceStructure) || (payload && payload.sourceStructure) || {};
    // 确定性计算：term/拓扑/角色组合 优先；机制与关系图无确定性来源，沿用模型估值
    const deterministic = {};
    const orderedSnapshots = (Array.isArray(snapshots) ? snapshots : []).filter(snapshot => snapshot && Array.isArray(snapshot.recentFacts)).sort((a, b) => Number(a.chapterNo) - Number(b.chapterNo));
    const newEvents = orderedSnapshots.flatMap(snapshot => snapshot.recentFacts).length ? orderedSnapshots.flatMap(snapshot => snapshot.recentFacts) : (payload && Array.isArray(payload.timeline) ? payload.timeline : []);
    const srcEvents = Array.isArray(src.events) && src.events.length ? src.events : Array.isArray(src.timeline) ? src.timeline : Array.isArray(src.framework && src.framework.events) ? src.framework.events : [];
    const ec = computeEventChainLCS(newEvents, srcEvents);
    if (Number.isFinite(ec)) deterministic.eventChainSimilarity = ec;
    const sourceCharacters = Array.isArray(src.characters) && src.characters.length ? src.characters : src.roles;
    const rc = computeRoleCombinationJaccard(payload && payload.characters, sourceCharacters);
    if (Number.isFinite(rc)) deterministic.roleCombinationSimilarity = rc;
    const sourceMap = src.map && Array.isArray(src.map.nodes) && src.map.nodes.length ? src.map : src.worldMap;
    const mp = computeMapTopologySimilarity(payload && payload.map, sourceMap);
    if (Number.isFinite(mp)) deterministic.mapTopologySimilarity = mp;
    const normalized = {};
    const missing = [];
    const used = {};
    names.forEach(name => {
      // 确定性优先
      if (typeof deterministic[name] === 'number' && Number.isFinite(deterministic[name])) {
        normalized[name] = deterministic[name]; used[name] = 'deterministic';
        return;
      }
      // 回退模型估值
      const rawValue = metrics[name];
      const value = rawValue === null || rawValue === undefined || rawValue === '' ? NaN : Number(rawValue);
      if (Number.isFinite(value) && value >= 0 && value <= 1) { normalized[name] = value; used[name] = 'model'; return; }
      missing.push(name); used[name] = 'missing';
    });
    const issues = [];
    if (forbiddenIssues.length) issues.push({ severity: 'blocker', category: 'originality', description: '禁止复制项命中率必须为 0', suggestion: '替换命中的原书专属名词、事件或序列' });
    names.forEach(name => {
      const value = normalized[name];
      if (Number.isFinite(value) && value >= thresholds[name]) issues.push({ severity: 'blocker', category: 'originality', metric: name, description: name + ' 达到 ' + value.toFixed(2) + '，超过门禁 ' + thresholds[name].toFixed(2), suggestion: '重写对应的具体事件、功能组合、拓扑关系或能力机制' });
    });
    if (missing.length) {
      issues.push({ severity: 'warning', category: 'originality', description: '结构级原创审计待正文事件、地图和关系数据齐备后执行：' + missing.join('、'), suggestion: '先完成本章正文和状态抽取，再运行结构原创审计' });
      return { status: issues.some(item => item.severity === 'blocker') ? 'blocked' : 'pending', forbiddenCopyHitRate: forbiddenIssues.length ? 1 : 0, thresholds, metrics: normalized, missing, issues, deterministic: { values: deterministic, used } };
    }
    return { status: issues.some(item => item.severity === 'blocker') ? 'blocked' : 'passed', forbiddenCopyHitRate: forbiddenIssues.length ? 1 : 0, thresholds, metrics: normalized, missing: [], issues, deterministic: { values: deterministic, used } };
  }
  
  function deterministicContractValidation(contract) {
    const c = contract && typeof contract === 'object' ? contract : {};
    const findings = [];
    const add = (field, ok, note) => { if (!ok) findings.push({ severity: 'blocker', category: 'contract', field, description: note }); };
    add('chapterNo', Number(c.chapterNo) > 0, 'chapterNo 必须为正整数');
    add('goal', String(c.goal || '').trim().length > 0, 'goal 不能为空');
    add('protagonistAction', String(c.protagonistAction || '').trim().length > 0, 'protagonistAction 不能为空（主角必须有主动动作）');
    add('opposition', String(c.opposition || '').trim().length > 0, 'opposition 不能为空（必须有阻力来源）');
    add('informationChange', String(c.informationChange || '').trim().length > 0, 'informationChange 不能为空（必须有信息变化）');
    add('irreversibleResult', String(c.irreversibleResult || '').trim().length > 0, 'irreversibleResult 不能为空（必须有不可逆结果）');
    const VALID_ACTIONS = ['plant', 'advance', 'reinforce', 'mislead', 'payoff', 'recover'];
    (Array.isArray(c.foreshadowActions) ? c.foreshadowActions : []).forEach((f, i) => {
      if (f && !VALID_ACTIONS.includes(String(f.action))) findings.push({ severity: 'warning', category: 'contract', field: 'foreshadowActions[' + i + ']', description: 'action 必须 ∈ [' + VALID_ACTIONS.join('|') + ']' });
    });
    return {
      status: findings.some(f => f.severity === 'blocker') ? 'failed' : (findings.length ? 'needs_review' : 'passed'),
      findings,
      blockerCount: findings.filter(f => f.severity === 'blocker').length
    };
  }
  
  function normalizeForbiddenMatchText(value) {
    return String(value || '').toLowerCase()
      .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/\s+/g, '');
  }
  
  function checkForbiddenTerms(text, forbiddenList) {
    const list = Array.isArray(forbiddenList) ? forbiddenList.map(String).filter(Boolean) : [];
    const body = String(text || '');
    if (!body || !list.length) return [];
    const normalizedBody = normalizeForbiddenMatchText(body);
    return list.filter(t => {
      if (t.length < 2) return false;
      return normalizedBody.includes(normalizeForbiddenMatchText(t));
    }).map(t => ({ severity: 'blocker', category: 'originality', term: t.slice(0, 60), description: '正文出现禁止复制项「' + t.slice(0, 60) + '」' }));
  }
  
  function characterNameOverlapIssues(payload) {
    const names = (Array.isArray(payload && payload.characters) ? payload.characters : [])
      .map(item => typeof item === 'string' ? item : item && (item.name || item.title) || '')
      .map(value => String(value).trim())
      .filter(Boolean);
    const issues = [];
    for (let leftIndex = 0; leftIndex < names.length; leftIndex += 1) {
      const left = names[leftIndex];
      const leftChars = new Set([...left].filter(char => /[\u4e00-\u9fff]/u.test(char)));
      if (!leftChars.size) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < names.length; rightIndex += 1) {
        const right = names[rightIndex];
        const shared = [...new Set([...right].filter(char => leftChars.has(char)))];
        if (shared.length) issues.push({ left, right, shared });
      }
    }
    return issues;
  }
  
  function creationBibleSeedValidation(payload, forbiddenTerms) {
    const clean = list => (Array.isArray(list) ? list : []).map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return item.term || item.name || item.title || item.value || '';
    }).map(item => String(item).trim()).filter(item => item.length >= 2);
    const terms = [...new Set(clean(forbiddenTerms))];
    // 只收集实体名称和关系两端名称；简介、分类和描述属于新作语义，不应误触发首版门禁。
    const checks = [];
    const addNames = (field, list, keys) => {
      (Array.isArray(list) ? list : []).forEach(item => {
        const values = typeof item === 'string' ? [item] : item && typeof item === 'object'
          ? keys.map(key => item[key]).filter(value => value !== undefined && value !== null)
          : [];
        values.map(value => String(value).trim()).filter(Boolean).forEach(value => checks.push({ field, value }));
      });
    };
    addNames('characters', payload && payload.characters, ['name', 'title']);
    addNames('worldbuilding', payload && payload.worldbuilding, ['name', 'title']);
    addNames('map.nodes', payload && payload.map && payload.map.nodes, ['name', 'title']);
    addNames('relationships', payload && payload.relationships, ['name', 'title', 'from', 'to', 'source', 'target']);
    const hits = [];
    const seen = new Set();
    checks.forEach(({ field, value }) => terms.forEach(term => {
      if (!value.includes(term)) return;
      const key = field + '\u0000' + value + '\u0000' + term;
      if (!seen.has(key)) { seen.add(key); hits.push({ field, value: value.slice(0, 120), term: term.slice(0, 60) }); }
    }));
    // 结构性缺失检查
    const missing = [];
    const charCount = (Array.isArray(payload && payload.characters) ? payload.characters : []).filter(c => c && String(c.name || c.title || '').trim()).length;
    if (charCount < 3) missing.push({ field: 'characters', reason: '人物 (' + charCount + ') 少于 3 个' });
    const nodeCount = (payload && payload.map && Array.isArray(payload.map.nodes) ? payload.map.nodes : []).filter(node => node && String(node.name || node.title || '').trim()).length;
    if (nodeCount < 3) missing.push({ field: 'map.nodes', reason: '地图节点 (' + nodeCount + ') 少于 3 个' });
    const gfType = String(payload && payload.goldenFinger && payload.goldenFinger.type || '').trim();
    if (!gfType) missing.push({ field: 'goldenFinger.type', reason: '金手指类型为空' });
    const nameOverlaps = characterNameOverlapIssues(payload);
    nameOverlaps.forEach(item => missing.push({ field: 'characters', reason: '人物姓名「' + item.left + '」与「' + item.right + '」共享汉字「' + item.shared.join('、') + '」，请重命名其中之一', code: 'name_overlap', names: [item.left, item.right], shared: item.shared }));
    return { ok: hits.length === 0 && missing.length === 0, hits, missing, nameOverlaps };
  }

  return {
    normalizeCreationPlan, creationPlanRules, normalizeBiblePayload, creationPlanTargets, creationPlanItemKey, creationNamedCount, creationChapterNumber, creationChapterTitle, creationChapterIsUsable, creationPlanCoverage, creationPlanText, creationPlanCompactList, creationPlanExpansionContext, creationPlanExpansionPrompt, mergeCreationUniqueList, mergeCreationVolumes, normalizeCreationExpansionChapter, normalizeCreationChapterPlanRhythm, mergeCreationChapterPlan, mergeCreationExpansionPayload, creationForbiddenTerms, creationChapterContext, creationPlanProjection, creationPlanHasContent, creationPlanIssue, reviewCreationPlan, normalizeCreationPlanReviewModel, mergeCreationPlanReview, normalizeCreationPlanPatchPath, creationPlanPatchValueKind, creationPlanPatchTypeMismatch, creationPlanPatchWouldShrink, applyCreationPlanPatches, eventChainLcsRatio, functionSetJaccard, computeStructuralSimilarity, evaluateSomaticGate, verifyModelAuditQuotes, creationOriginalityGate, deterministicContractValidation, normalizeForbiddenMatchText, checkForbiddenTerms, characterNameOverlapIssues, creationBibleSeedValidation
  };
}

module.exports = { createCreationPlanService };

