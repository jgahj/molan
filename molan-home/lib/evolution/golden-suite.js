'use strict';

const { buildReplayManifest, verifyReplayManifest } = require('./replay-manifest');

const MODEL = 'gpt-5.6-luna';
const MODEL_PARAMS = Object.freeze({ temperature: 0.8, topP: 0.9, maxTokens: 5000 });
const PIPELINE_VERSION = 'generation-v2.1';
const PROMPT_VERSION = 'writer-v7';

const GENRES = Object.freeze([
  { name: '玄幻', id: 'xuanhuan', world: '灵脉决定修行上限，宗门借灵矿维持边境封印。', protagonist: '沈砚', role: '守矿弟子', goal: '查清矿脉异动并阻止封印失稳', voice: '先问代价，再谈胜负；少用夸张断言。', ally: '顾青禾', rival: '陆惊鸿' },
  { name: '都市', id: 'urban', world: '旧城更新由街区听证、产权和有限预算共同决定。', protagonist: '许知远', role: '社区记者', goal: '核实拆迁争议并让受影响住户参与决策', voice: '用可核实细节说服人，不替当事人下结论。', ally: '林岚', rival: '周启明' },
  { name: '悬疑', id: 'mystery', world: '临河镇的渡口每晚封航，值守记录由三处独立保管。', protagonist: '闻溪', role: '县档案员', goal: '复原一份被篡改的渡口值守记录', voice: '观察具体物证，推断必须标出不确定处。', ally: '罗岑', rival: '蒋文川' },
  { name: '言情', id: 'romance', world: '两家经营的旧戏院即将停业，续租需要双方共同签字。', protagonist: '乔宁', role: '舞台监督', goal: '在戏院关闭前厘清家人和合伙人的真实打算', voice: '通过选择与停顿表达情绪，避免替对方读心。', ally: '陈叙', rival: '乔闻' },
  { name: '历史', id: 'historical', world: '漕运改道牵动仓储、税册和沿线州县的粮价。', protagonist: '顾惟安', role: '仓场书吏', goal: '查明一批赈粮账目与实物不符的原因', voice: '言行受身份和文书规矩约束，避免现代口吻。', ally: '沈禾', rival: '崔廷' },
  { name: '科幻', id: 'scifi', world: '近地航站实行分区供氧，维修权限与生命支持网络隔离。', protagonist: '唐澈', role: '舱段工程师', goal: '定位氧压异常并保住隔离舱内的乘员', voice: '先说明观测与限制，技术选择必须有代价。', ally: '季遥', rival: '马库斯' },
  { name: '西幻', id: 'western-fantasy', world: '群岛王国以潮汐钟塔协调航路，誓约会限制施法者。', protagonist: '艾琳', role: '港务见习官', goal: '查清钟塔偏差并避免船队误入暗礁海域', voice: '礼仪与利益并存，魔法遵守明确边界。', ally: '罗文', rival: '塞德里克' },
  { name: '轻小说', id: 'light-novel', world: '星见学园的社团预算由公开提案和学生投票决定。', protagonist: '夏川凛', role: '摄影社副社长', goal: '保住社团暗房并完成毕业展约定', voice: '轻快对话承载具体分歧，笑点不抹平后果。', ally: '白石遥', rival: '神谷奏' }
]);

const CHALLENGES = Object.freeze([
  { id: 'costly-solution', pressure: '可行方案会消耗一项后续急需的资源。', objective: '让主角比较眼前收益与后续代价，并作出可追责的选择。', evidence: '资源存量和消耗路径都能从输入状态核对。', constraint: '不得凭空补充足以解决危机的新资源。' },
  { id: 'competing-loyalties', pressure: '两名重要人物要求主角支持彼此冲突的安排。', objective: '推动关系变化，同时保留双方各自成立的理由。', evidence: '立场差异来自人物卡中可见的目标和旧承诺。', constraint: '不得把一方写成无理由的反派来简化冲突。' },
  { id: 'delayed-clue', pressure: '旧线索有了新解释，但现有证据仍不足以定案。', objective: '让线索推动行动并保留至少一种合理解释。', evidence: '线索引用必须对应上下文中的原始记录。', constraint: '不得让角色提前知道未披露的信息。' },
  { id: 'knowledge-boundary', pressure: '读者掌握的信息多于一名关键角色。', objective: '利用信息差制造选择压力，但不让角色违反已知事实。', evidence: '每项角色认知能映射到给定状态或本章发现。', constraint: '不得用全知叙述泄露角色尚未验证的结论。' },
  { id: 'timeline-constraint', pressure: '行动窗口短于完成全部计划所需的时间。', objective: '明确先后次序，并让延误产生可见影响。', evidence: '场景时间与时间线条目顺序一致。', constraint: '不得在场景间无说明地跳过关键时段。' },
  { id: 'resource-limit', pressure: '两项任务争用同一有限设备、地点或人手。', objective: '通过协调或取舍改变局面。', evidence: '冲突资源在故事圣经中有数量或占用状态。', constraint: '不得同时把互斥资源分配给两处。' },
  { id: 'relationship-shift', pressure: '一项合作条件被打破，旧关系需要重新谈判。', objective: '通过可观察的行为呈现信任变化。', evidence: '关系变化对应具体承诺、行动或拒绝。', constraint: '不得仅凭一句解释就把长期关系改写为相反状态。' },
  { id: 'failed-plan', pressure: '主角的既定计划遭遇符合规则的意外阻碍。', objective: '让失败改变下一步方案，而不是重置局面。', evidence: '阻碍可由世界规则或上下文状态推出。', constraint: '不得临时新增违反世界规则的能力。' },
  { id: 'foreshadow-payoff', pressure: '一条旧伏笔接近兑现，但兑现方式受当前条件限制。', objective: '部分回收伏笔并留下清晰的后续影响。', evidence: '回收点与伏笔登记的对象、时间或条件对应。', constraint: '不得宣称尚未触发的伏笔已经彻底解决。' },
  { id: 'irreversible-choice', pressure: '局势要求在信息不完整时作出不可逆选择。', objective: '展示选择依据、放弃项和至少一项持续后果。', evidence: '决策依赖的信息均在角色当前认知范围内。', constraint: '不得在章末撤销选择造成的事实变化。' }
]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function buildTask(profile, challenge, index) {
  const taskId = `golden-v1-${profile.id}-${challenge.id}`;
  const chapterIndex = 21 + index;
  const bible = {
    title: `${profile.name}固定回放任务 ${String(index + 1).padStart(2, '0')}`,
    genre: profile.name,
    world: profile.world,
    protagonist: { name: profile.protagonist, role: profile.role, goal: profile.goal, voiceRule: profile.voice },
    cast: [
      { name: profile.ally, role: '协作者', goal: '保留自己的选择权并验证关键信息。' },
      { name: profile.rival, role: '利益相反者', goal: '按可解释的自身利益推动另一种方案。' }
    ],
    canonRules: [
      '已确认事实不得因叙述方便而改写。',
      '能力、制度与资源限制必须在解决问题时继续生效。',
      '角色认知只包含已提供或本章实际获得的信息。'
    ],
    styleMechanism: profile.voice
  };
  const outline = {
    chapterIndex,
    previousSummary: `${profile.protagonist}发现现行安排存在一处无法解释的矛盾，并保留了原始凭据。`,
    currentGoal: challenge.objective,
    currentPressure: challenge.pressure,
    nextChapterHook: '本章选择将改变一项资源或关系的可用状态。',
    prohibitedResolution: challenge.constraint
  };
  const chapterContract = {
    targetChars: 2500,
    tolerance: 0.2,
    requiredBeats: [
      { id: 'grounding', requirement: '在开篇交代当前场景和紧迫目标。' },
      { id: 'evidence', requirement: challenge.evidence },
      { id: 'decision', requirement: '以角色行动落实一次有成本的选择。' },
      { id: 'consequence', requirement: '在结尾留下可持续到下一章的状态变化。' }
    ],
    sceneContract: [
      { id: 'inspect', goal: '核对矛盾与当前可用证据', exitCondition: '角色明确至少一个已知事实和一个未知点' },
      { id: 'negotiate', goal: '面对利益冲突并选择行动', exitCondition: '至少一项资源、关系或承诺发生可验证变化' }
    ],
    hardConstraints: [challenge.constraint, '不得改变人物身份、已确认时间线或既有世界规则。']
  };
  const contextSnapshot = {
    chapterIndex,
    priorChapterSummaries: [
      outline.previousSummary,
      `${profile.ally}提出了与${profile.rival}不同的处理办法，双方都尚未获得主角承诺。`
    ],
    storyState: {
      facts: [`${profile.protagonist}持有一份尚未验证的原始凭据。`, `${profile.rival}控制一项推进计划所需的关键条件。`],
      timeline: [{ at: `D${index + 1} 09:00`, event: '原始凭据被登记并封存' }, { at: `D${index + 1} 10:00`, event: '各方首次讨论处置方案' }],
      relationships: [{ from: profile.protagonist, to: profile.ally, status: '愿意协作但保留核验权' }, { from: profile.protagonist, to: profile.rival, status: '目标冲突，仍可谈判' }],
      resources: [{ name: '本阶段可用协作时段', remaining: 1, unit: '次' }],
      unresolvedForeshadows: [{ id: `foreshadow-${profile.id}-${index + 1}`, condition: '找到能够独立复核原始凭据的第三方' }],
      causalDebts: [{ id: `debt-${profile.id}-${index + 1}`, createdAtChapter: chapterIndex - 2, requiredPayoff: '说明前次选择对当前资源或关系造成的后果' }]
    },
    taskPressure: challenge.pressure,
    knownUnknowns: ['原始凭据是否足以支持当前推断', '利益相反者是否掌握未披露但可验证的信息']
  };
  const artifacts = {
    bible: { ref: `${taskId}:bible:v1`, snapshot: bible },
    outline: { ref: `${taskId}:outline:v1`, snapshot: outline },
    chapterContract: { ref: `${taskId}:chapter-contract:v1`, snapshot: chapterContract },
    contextSnapshot: { ref: `${taskId}:context:v1`, snapshot: contextSnapshot }
  };
  const modelParams = { ...MODEL_PARAMS };
  const replayManifest = buildReplayManifest({
    sourceGenerationId: taskId,
    pipelineVersion: PIPELINE_VERSION,
    promptVersion: PROMPT_VERSION,
    genreProfileVersion: 'genre-profile-v1',
    styleVersion: 'style-mechanisms-v1',
    model: MODEL,
    parameters: modelParams,
    artifacts
  });
  return deepFreeze({
    taskId,
    genre: profile.name,
    scenario: challenge.id,
    sourceGenerationId: taskId,
    bible,
    outline,
    chapterContract,
    contextSnapshot,
    artifacts,
    model: MODEL,
    modelParams,
    pipelineVersion: PIPELINE_VERSION,
    promptVersion: PROMPT_VERSION,
    genreProfileVersion: 'genre-profile-v1',
    styleVersion: 'style-mechanisms-v1',
    benchmarkId: `golden-input-v1:${profile.id}`,
    replayManifest
  });
}

function buildGoldenSuite() {
  const tasks = GENRES.flatMap(profile => CHALLENGES.map((challenge, index) => buildTask(profile, challenge, index)));
  return deepFreeze({
    schemaVersion: 'generation-golden-input-suite-v1',
    fixtureStatus: 'test_fixture',
    dataStatus: 'inputs_only',
    taskCount: tasks.length,
    tasksPerGenre: CHALLENGES.length,
    genres: GENRES.map(profile => profile.name),
    tasks
  });
}

function validateGoldenSuite(suite = buildGoldenSuite()) {
  const failures = [];
  if (!suite || suite.schemaVersion !== 'generation-golden-input-suite-v1' || !Array.isArray(suite.tasks)) {
    return { valid: false, failures: ['suite.schemaVersion'] };
  }
  if (suite.tasks.length !== 80 || suite.taskCount !== 80) failures.push('task_count');
  const counts = new Map(GENRES.map(profile => [profile.name, 0]));
  const ids = new Set();
  for (const task of suite.tasks) {
    if (ids.has(task.taskId)) failures.push(`duplicate:${task.taskId}`);
    ids.add(task.taskId);
    counts.set(task.genre, (counts.get(task.genre) || 0) + 1);
    for (const field of ['bible', 'outline', 'chapterContract', 'contextSnapshot', 'model', 'modelParams', 'pipelineVersion']) {
      if (task[field] == null) failures.push(`${task.taskId}:${field}`);
    }
    const replay = verifyReplayManifest(task.replayManifest, task.artifacts);
    if (!replay.valid) failures.push(`${task.taskId}:replay:${replay.mismatches.join(',')}`);
  }
  for (const [genre, count] of counts) if (count !== 10) failures.push(`${genre}:task_count:${count}`);
  return { valid: failures.length === 0, failures, taskCount: suite.tasks.length, genreCounts: Object.fromEntries(counts) };
}

module.exports = {
  GOLDEN_GENRES: Object.freeze(GENRES.map(profile => profile.name)),
  GOLDEN_MODEL: MODEL,
  GOLDEN_PIPELINE_VERSION: PIPELINE_VERSION,
  buildGoldenSuite,
  validateGoldenSuite
};
