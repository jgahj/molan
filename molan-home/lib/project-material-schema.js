'use strict';

(function exposeProjectMaterialSchema(root, factory) {
  const schema = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = schema;
  if (root) root.MOLAN_PROJECT_MATERIAL_SCHEMA = schema;
})(typeof globalThis === 'undefined' ? this : globalThis, function createProjectMaterialSchema() {
  const definitions = [
    ['A01', '书名、副标题、笔名', 'basic_positioning', 'profile', ['profile.title', 'profile.subtitle', 'profile.penName']],
    ['A02', '题材及复合类型', 'basic_positioning', 'profile', ['profile.primaryGenre', 'profile.genreTags', 'profile.genreCapabilities']],
    ['A03', '主题、立意、内核', 'basic_positioning', 'profile', ['profile.theme', 'profile.centralQuestion', 'profile.counterTheme', 'profile.themePlotRefs']],
    ['A04', '作品基调', 'basic_positioning', 'profile', ['profile.tone', 'profile.toneExceptions']],
    ['A05', '目标读者、核心卖点、钩子', 'basic_positioning', 'profile', ['profile.audience', 'profile.sellingPoints', 'profile.marketingHooks']],
    ['A06', '总字数与完结规划', 'basic_positioning', 'profile', ['profile.targetWordRange', 'profile.completionMilestones', 'profile.endingDeadline']],
    ['A07', '短简介、长简介、宣传文案', 'publication', 'publication', ['copy.shortSynopsis', 'copy.longSynopsis', 'copy.platformVariants', 'copy.spoilerLevel']],
    ['B01', '时代、文明、底层法则', 'worldbuilding', 'worldbuilding', ['world.era', 'world.civilization', 'world.foundationRules']],
    ['B02', '地理地图、距离、地貌', 'worldbuilding', 'place', ['place.parentId', 'place.terrain', 'travel.distance', 'travel.duration', 'travel.method']],
    ['B03', '势力与阵营关系', 'worldbuilding', 'faction', ['faction.goals', 'faction.resources', 'faction.members', 'relation.validRange']],
    ['B04', '力量体系与升级限制', 'worldbuilding', 'power-system', ['power.levels', 'power.transitions', 'power.upperBounds', 'power.costs', 'power.exceptions']],
    ['B05', '风俗律法货币语言信仰阶级', 'worldbuilding', 'culture', ['culture.kind', 'culture.description', 'culture.placeRefs', 'culture.validRange']],
    ['B06', '历史事件与年代纪年', 'worldbuilding', 'history-event', ['calendar.definition', 'event.storyTime', 'event.orderConstraints', 'event.sources']],
    ['B07', '金手指系统禁忌世界限制', 'worldbuilding', 'world-rule', ['rule.trigger', 'rule.scope', 'rule.limit', 'rule.cost', 'rule.exception']],
    ['C01', '人物姓名年龄外貌身份', 'characters', 'character', ['person.name', 'person.aliases', 'person.birthTime', 'person.ageRange', 'person.appearance', 'person.identities']],
    ['C02', '性格优缺点执念底线弧光', 'characters', 'character', ['person.traits', 'person.strengths', 'person.flaws', 'person.obsessions', 'person.boundaries', 'arc.milestones']],
    ['C03', '背景家庭与创伤', 'characters', 'character', ['person.background', 'person.familyRelations', 'person.pastEventRefs', 'person.wounds']],
    ['C04', '短期中期终极目标', 'characters', 'character', ['goal.horizon', 'goal.objective', 'goal.obstacle', 'goal.status', 'goal.validRange']],
    ['C05', '人物能力技能金手指装备', 'characters', 'character', ['person.abilityRefs', 'person.itemRefs', 'fact.acquiredAt', 'fact.ownership']],
    ['C06', '语言风格习惯口头禅', 'characters', 'character', ['person.voice', 'person.habits', 'person.catchphrases', 'person.emotionStyle']],
    ['C07', '重要配角', 'characters', 'character', ['person.roleTags', 'person.importance', 'person.stageFunctions']],
    ['C08', '分阶段反派', 'characters', 'character', ['person.antagonistStage', 'person.resources', 'person.knowledge', 'person.oppositionGoals']],
    ['C09', '路人与次要角色', 'characters', 'character', ['person.importance', 'person.function', 'person.minimumCard']],
    ['C10', '人物关系表', 'characters', 'relation', ['relation.sourceId', 'relation.targetId', 'relation.type', 'relation.visibility', 'relation.validRange']],
    ['C11', '人物出场顺序表', 'characters', 'plot-node', ['appearance.personId', 'appearance.sceneId', 'appearance.kind', 'appearance.narrativeOrder']],
    ['D01', '全书故事梗概', 'plot_outlines', 'outline', ['plot.incitingEvent', 'plot.development', 'plot.turns', 'plot.climax', 'plot.ending']],
    ['D02', '主线辅线感情线悬疑线', 'plot_outlines', 'storyline', ['storyline.type', 'storyline.priority', 'storyline.nodeRefs']],
    ['D03', '全书关键事件节点', 'plot_outlines', 'event', ['event.prerequisites', 'event.consequences', 'event.planRef', 'event.actualRefs']],
    ['D04', '结局设定', 'plot_outlines', 'outline', ['ending.kind', 'ending.characterOutcomes', 'ending.requiredPayoffs', 'ending.openQuestions']],
    ['D05', '卷名章节区间本卷字数', 'plot_outlines', 'plot-node', ['volume.title', 'volume.chapterRefs', 'volume.wordTarget', 'volume.actualWordCount']],
    ['D06', '本卷目标与冲突', 'plot_outlines', 'plot-node', ['volume.goal', 'volume.conflict', 'volume.result']],
    ['D07', '本卷事件与高潮', 'plot_outlines', 'plot-node', ['volume.eventRefs', 'volume.climaxRef', 'volume.turningPoints']],
    ['D08', '卷末伏笔与下一卷引子', 'plot_outlines', 'plot-node', ['volume.foreshadowRefs', 'volume.nextVolumeRef', 'volume.endingHook']],
    ['D09', '本章事件与冲突', 'plot_outlines', 'plot-node', ['chapter.goal', 'chapter.events', 'chapter.conflict', 'chapter.stateChange']],
    ['D10', '本章看点爽点情绪点', 'plot_outlines', 'plot-node', ['chapter.highlights', 'chapter.emotionGoal', 'chapter.payoffPlan']],
    ['D11', '本章出场人物与场景', 'plot_outlines', 'scene', ['scene.castIds', 'scene.placeId', 'scene.povId', 'scene.storyTime']],
    ['D12', '本章伏笔埋设与回收', 'plot_outlines', 'foreshadow', ['chapter.foreshadowActions', 'foreshadow.plannedChapterIds', 'foreshadow.actualEvidenceRefs']],
    ['D13', '章末钩子', 'plot_outlines', 'plot-node', ['chapter.endingMode', 'chapter.hook', 'chapter.transition']],
    ['E01', '物品道具', 'special_materials', 'item', ['item.properties', 'item.ownerId', 'item.placeId', 'item.state', 'item.eventRefs']],
    ['E02', '技能招式', 'special_materials', 'ability', ['ability.effect', 'ability.preconditions', 'ability.cost', 'ability.limit', 'ability.systemId']],
    ['E03', '场景环境素材', 'special_materials', 'material', ['material.placeId', 'material.weather', 'material.timeCondition', 'material.povCondition', 'material.text']],
    ['E04', '伏笔清单', 'special_materials', 'foreshadow', ['foreshadow.id', 'foreshadow.plantPlan', 'foreshadow.payoffPlan', 'foreshadow.status', 'foreshadow.evidence', 'foreshadow.deferralReason']],
    ['E05', '名场面与台词', 'special_materials', 'highlight', ['highlight.text', 'highlight.speakerId', 'highlight.sceneId', 'highlight.usageStatus', 'highlight.source']],
    ['E06', '术语名词表', 'special_materials', 'term', ['term.canonicalName', 'term.aliases', 'term.definition', 'term.scope', 'term.disambiguation']],
    ['F01', '故事时间与年龄记录', 'writing_management', 'timeline', ['event.storyTime', 'event.narrativeOrder', 'event.recordedAt', 'person.birthTime']],
    ['F02', '写作进度与卡点', 'writing_management', 'writing-task', ['task.chapterId', 'task.status', 'task.blocker', 'task.nextAction', 'task.assigneeId']],
    ['F03', '设定纠错记录', 'writing_management', 'issue', ['issue.evidenceRefs', 'issue.affectedRefs', 'issue.resolution', 'issue.review', 'issue.authorDecision']],
    ['F04', '章节正文', 'writing_management', 'manuscript', ['manuscript.text', 'manuscript.richContent', 'manuscript.hash', 'manuscript.status', 'manuscript.revision']],
    ['F05', '番外与后记', 'publication', 'manuscript', ['manuscript.kind', 'manuscript.continuityId', 'manuscript.numberingPolicy', 'manuscript.canonApplicability']]
  ];

  const categories = [
    { id: 'basic_positioning', label: '作品基础定位', zone: 'base' },
    { id: 'worldbuilding', label: '世界观设定', zone: 'world' },
    { id: 'characters', label: '人物设定', zone: 'characters' },
    { id: 'plot_outlines', label: '剧情大纲', zone: 'outline' },
    { id: 'special_materials', label: '专项细节设定', zone: 'materials' },
    { id: 'writing_management', label: '写作执行与管理', zone: 'management' },
    { id: 'publication', label: '发布与后期', zone: 'publication' }
  ];

  const fieldLabels = {
    title: '标题', subtitle: '副标题', penName: '笔名', primaryGenre: '主类型', genreTags: '复合题材标签',
    genreCapabilities: '题材能力配置', theme: '主题', centralQuestion: '核心问题', counterTheme: '反主题',
    themePlotRefs: '关联剧情节点', tone: '作品基调', toneExceptions: '基调例外', audience: '目标读者',
    sellingPoints: '核心卖点', marketingHooks: '宣传钩子', targetWordRange: '总字数范围',
    completionMilestones: '完结里程碑', endingDeadline: '完结时间', shortSynopsis: '短简介',
    longSynopsis: '长简介', platformVariants: '平台文案版本', spoilerLevel: '剧透等级', era: '时代',
    civilization: '文明', foundationRules: '底层法则', parentId: '上级地点', terrain: '地貌',
    distance: '距离', duration: '行程时长', method: '交通方式', goals: '目标', resources: '掌握资源',
    members: '成员', validRange: '有效范围', levels: '层级', transitions: '升级条件', upperBounds: '能力上限',
    costs: '使用代价', exceptions: '例外', kind: '类型', description: '描述', placeRefs: '关联地点',
    definition: '定义', storyTime: '故事时间', orderConstraints: '顺序约束', sources: '来源', trigger: '触发条件',
    scope: '适用范围', limit: '限制', cost: '代价', exception: '例外', name: '名称', aliases: '别名',
    birthTime: '出生时间', ageRange: '年龄范围', appearance: '外貌', identities: '身份', traits: '性格特征',
    strengths: '优点', flaws: '缺点', obsessions: '执念', boundaries: '底线', milestones: '成长节点',
    background: '背景', familyRelations: '家庭关系', pastEventRefs: '过往事件', wounds: '创伤', horizon: '目标阶段',
    objective: '目标内容', obstacle: '阻碍', status: '状态', abilityRefs: '能力与技能', itemRefs: '装备与道具',
    acquiredAt: '获得时间', ownership: '掌握/所有权', voice: '语言风格', habits: '习惯', catchphrases: '口头禅',
    emotionStyle: '情绪表达', roleTags: '角色标签', importance: '重要程度', stageFunctions: '阶段作用',
    antagonistStage: '反派阶段', knowledge: '掌握信息', oppositionGoals: '对立目标', function: '剧情功能',
    minimumCard: '精简人物卡', sourceId: '关系起点', targetId: '关系对象', type: '关系类型', visibility: '公开/秘密',
    personId: '人物', sceneId: '场景', narrativeOrder: '叙事顺序', incitingEvent: '起因', development: '发展',
    turns: '关键转折', climax: '高潮', ending: '结局', priority: '优先级', nodeRefs: '关联剧情节点',
    prerequisites: '前置条件', consequences: '后续影响', planRef: '计划记录', actualRefs: '实际事件',
    characterOutcomes: '人物结局', requiredPayoffs: '必须回收的伏笔', openQuestions: '开放问题', chapterRefs: '章节范围',
    wordTarget: '目标字数', actualWordCount: '实际字数', goal: '目标', conflict: '核心冲突', result: '结果',
    eventRefs: '关联事件', climaxRef: '高潮事件', turningPoints: '转折节点', foreshadowRefs: '关联伏笔',
    nextVolumeRef: '下一卷', endingHook: '卷末钩子', events: '事件', stateChange: '状态变化', highlights: '看点与爽点',
    emotionGoal: '情绪目标', payoffPlan: '回报/回收计划', castIds: '出场人物', placeId: '地点', povId: '视角人物',
    foreshadowActions: '伏笔埋设/回收', plannedChapterIds: '计划章节', actualEvidenceRefs: '实际回收证据',
    endingMode: '章末类型', hook: '章末钩子', transition: '下章引子', properties: '物品属性', ownerId: '持有人',
    state: '当前状态', effect: '效果', preconditions: '前置条件', systemId: '所属体系', weather: '天气',
    timeCondition: '时间条件', povCondition: '视角条件', text: '正文内容', id: '稳定标识', plantPlan: '埋设计划',
    payoffPlan: '回收计划', evidence: '证据', deferralReason: '延期/放弃理由', speakerId: '说话者', usageStatus: '使用状态',
    source: '来源', canonicalName: '标准名称', disambiguation: '歧义说明', recordedAt: '记录时间', chapterId: '章节',
    blocker: '卡点', nextAction: '下一步', assigneeId: '负责人', evidenceRefs: '证据引用', affectedRefs: '受影响对象',
    resolution: '解决方案', review: '复核意见', authorDecision: '作者裁决', richContent: '富文本正文', hash: '正文哈希',
    revision: '版本', continuityId: '故事线版本', numberingPolicy: '编号规则', canonApplicability: '正史适用性'
  };

  const numberFields = new Set(['volume.wordTarget', 'volume.actualWordCount', 'appearance.narrativeOrder', 'person.importance', 'event.narrativeOrder', 'manuscript.revision']);
  const booleanFields = new Set(['power.notApplicable']);
  const arrayFields = new Set([
    'profile.genreTags', 'profile.sellingPoints', 'profile.marketingHooks', 'profile.completionMilestones',
    'power.levels', 'power.transitions', 'power.exceptions', 'person.aliases', 'person.traits', 'person.strengths',
    'person.flaws', 'person.obsessions', 'person.boundaries', 'arc.milestones', 'person.roleTags',
    'person.stageFunctions', 'person.catchphrases', 'person.resources', 'person.oppositionGoals', 'term.aliases',
    'chapter.highlights', 'volume.turningPoints', 'ending.openQuestions'
  ]);
  const jsonFields = new Set([
    'profile.targetWordRange', 'profile.toneExceptions', 'copy.platformVariants', 'faction.goals', 'faction.resources',
    'relation.validRange', 'power.upperBounds', 'power.costs', 'culture.validRange', 'calendar.definition',
    'event.orderConstraints', 'rule.trigger', 'rule.limit', 'rule.cost', 'rule.exception', 'person.identities',
    'person.ageRange', 'person.familyRelations', 'goal.validRange', 'fact.ownership', 'person.knowledge',
    'person.minimumCard', 'plot.turns', 'ending.characterOutcomes', 'chapter.events', 'chapter.stateChange',
    'chapter.foreshadowActions', 'item.properties', 'event.prerequisites', 'event.consequences', 'person.antagonistStage',
    'manuscript.richContent', 'manuscript.hash'
  ]);
  const referenceFields = new Set([
    'profile.themePlotRefs', 'place.parentId', 'faction.members', 'culture.placeRefs', 'event.sources',
    'person.pastEventRefs', 'person.abilityRefs', 'person.itemRefs', 'storyline.nodeRefs', 'event.planRef',
    'event.actualRefs', 'ending.requiredPayoffs', 'volume.chapterRefs', 'volume.eventRefs', 'volume.climaxRef',
    'volume.foreshadowRefs', 'volume.nextVolumeRef', 'foreshadow.plannedChapterIds',
    'foreshadow.actualEvidenceRefs', 'appearance.personId', 'appearance.sceneId', 'scene.castIds', 'scene.placeId',
    'scene.povId', 'item.ownerId', 'item.placeId', 'item.eventRefs', 'ability.systemId', 'foreshadow.evidence',
    'highlight.speakerId', 'highlight.sceneId', 'material.placeId', 'issue.evidenceRefs', 'issue.affectedRefs'
  ]);
  const pluralReferences = new Set([
    'profile.themePlotRefs', 'faction.members', 'culture.placeRefs', 'event.sources', 'person.pastEventRefs',
    'person.abilityRefs', 'person.itemRefs', 'storyline.nodeRefs', 'event.actualRefs', 'ending.requiredPayoffs',
    'volume.chapterRefs', 'volume.eventRefs', 'volume.foreshadowRefs', 'chapter.foreshadowActions',
    'foreshadow.plannedChapterIds', 'foreshadow.actualEvidenceRefs', 'scene.castIds', 'item.eventRefs',
    'foreshadow.evidence', 'issue.evidenceRefs', 'issue.affectedRefs'
  ]);

  const requirementById = Object.create(null);
  const requirements = definitions.map(([id, label, categoryId, kind, fieldPaths]) => {
    const fields = fieldPaths.map(path => {
      const key = path.slice(path.lastIndexOf('.') + 1);
      const type = referenceFields.has(path) ? (pluralReferences.has(path) ? 'references' : 'reference')
        : booleanFields.has(path) ? 'boolean'
          : numberFields.has(path) ? 'number'
            : arrayFields.has(path) ? 'array'
              : jsonFields.has(path) ? 'json'
                : /(description|development|incitingEvent|centralQuestion|counterTheme|theme|foundationRules|appearance|background|wounds|voice|emotionStyle|objective|obstacle|conflict|result|ending|hook|transition|trigger|limit|cost|exception|text|definition|resolution|nextAction|blocker|plantPlan|payoffPlan|deferralReason|stateChange|preconditions|effect|endingHook)$/i.test(key)
                  ? 'textarea' : 'text';
      return Object.freeze({ path, label: fieldLabels[key] || key, type });
    });
    const requirement = Object.freeze({ id, label, categoryId, kind, fieldPaths: Object.freeze([...fieldPaths]), fields: Object.freeze(fields) });
    requirementById[id] = requirement;
    return requirement;
  });
  const categoryById = Object.fromEntries(categories.map(category => [category.id, category]));
  const fieldsByKind = Object.create(null);
  for (const requirement of requirements) {
    fieldsByKind[requirement.kind] ||= Object.create(null);
    for (const field of requirement.fields) fieldsByKind[requirement.kind][field.path] = field;
  }

  function invalid(code, message) {
    return Object.assign(new Error(message), { code, status: 422 });
  }

  function validateValue(value, field) {
    if (field.type === 'text' || field.type === 'textarea') return typeof value === 'string';
    if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (field.type === 'boolean') return typeof value === 'boolean';
    if (field.type === 'array') return Array.isArray(value);
    if (field.type === 'json') return value !== null && typeof value === 'object';
    if (field.type === 'reference') return typeof value === 'string' || isReferenceObject(value);
    if (field.type === 'references') return Array.isArray(value) && value.every(item => typeof item === 'string' || isReferenceObject(item));
    return false;
  }

  function isReferenceObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
      typeof (value.resourceId || value.id) === 'string' && typeof (value.resourceKind || value.kind) === 'string';
  }

  function validatePayload(kind, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('resource_payload_invalid', '资料负载必须是 JSON 对象');
    const ids = payload.requirementIds === undefined ? [] : payload.requirementIds;
    if (!Array.isArray(ids) || ids.length > requirements.length || new Set(ids).size !== ids.length) {
      throw invalid('requirement_ids_invalid', '资料需求标记无效');
    }
    for (const id of ids) {
      const requirement = requirementById[String(id)];
      if (!requirement || requirement.kind !== kind) throw invalid('requirement_kind_mismatch', '需求与资料类型不匹配');
    }
    if (payload.requirementId !== undefined && ids.length === 0) {
      const requirement = requirementById[String(payload.requirementId)];
      if (!requirement || requirement.kind !== kind) throw invalid('requirement_kind_mismatch', '需求与资料类型不匹配');
    }
    if (payload.requirementData === undefined) return payload;
    if (!payload.requirementData || typeof payload.requirementData !== 'object' || Array.isArray(payload.requirementData)) {
      throw invalid('requirement_data_invalid', '需求字段必须是对象');
    }
    const fieldMap = fieldsByKind[kind] || {};
    for (const [path, value] of Object.entries(payload.requirementData)) {
      const field = fieldMap[path];
      if (field && value !== null && value !== '' && !validateValue(value, field)) {
        throw invalid('requirement_field_type_invalid', `字段 ${path} 的类型无效`);
      }
    }
    return payload;
  }

  function collectReferences(payload, kind) {
    const data = payload && payload.requirementData;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    const fieldMap = fieldsByKind[kind] || {};
    const references = [];
    for (const [path, value] of Object.entries(data)) {
      const field = fieldMap[path];
      if (!field || !['reference', 'references'].includes(field.type) || value == null || value === '') continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item === 'string' && item.trim()) references.push({ id: item.trim(), kind: '' });
        else if (isReferenceObject(item)) references.push({ id: String(item.resourceId || item.id).trim(), kind: String(item.resourceKind || item.kind).trim().toLowerCase() });
      }
    }
    return references;
  }

  function requirementsForCategory(categoryId) {
    return requirements.filter(requirement => requirement.categoryId === categoryId);
  }

  function getRequirement(id) {
    return requirementById[String(id)] || null;
  }

  return Object.freeze({
    version: 1,
    categories: Object.freeze(categories.map(Object.freeze)),
    requirements: Object.freeze(requirements),
    categoryById: Object.freeze(categoryById),
    requirementById: Object.freeze(requirementById),
    requirementsForCategory,
    getRequirement,
    validatePayload,
    collectReferences,
    fieldsByKind: Object.freeze(fieldsByKind)
  });
});
