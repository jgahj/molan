可以。这一轮我建议直接把前面的所有建议、你上传的完整审计方案，以及当前 `jgahj/molan` 的实际代码状态合成一份**“按仓库现状施工”的实施手册**，而不是再给一份抽象架构图。

先把一个关键判断定死：

> **不要推倒重写 Molan。**
>
> 当前仓库已经具备很多正确的基础设施：PG jobs/fencing、Token 预留与结算、SSE、取消上游请求、两遍 Humanizer、Genre Engine、Style System、Causal Debt、Evidence Audit、Creation Book、Memory、权限隔离等。你上传的方案也明确要求“现有零件收敛、接通、建立统一契约与回归门禁”，而不是重复造轮子。
>
> 这次真正要做的是：
>
> **把这些能力全部收编到唯一生产生成链，同时把“质量提高”从 Prompt 感觉变成可量化、可实验、可回滚的工程系统。**

---

# 一、最终目标架构：以后只允许这一条生产主链

```text
用户
 │
 ▼
编辑器 / 小说工作台
 │
 ▼
POST /api/generation-runs
 │
 ▼
Generation Orchestrator
 │
 ├── Idempotency
 ├── Auth / ACL
 ├── Budget Reservation
 └── Durable Job
 │
 ▼
┌─────────────────────────────────────┐
│         Deterministic FSM           │
│                                     │
│ REQUEST_VALIDATED                    │
│        ↓                            │
│ GENRE_RESOLVED                      │
│        ↓                            │
│ STYLE_RESOLVED                      │
│        ↓                            │
│ CONTEXT_BUILT                       │
│        ↓                            │
│ CONTRACT_VALIDATED                  │
│        ↓                            │
│ PRE_GENERATION_GUARD                │
│        ↓                            │
│ SCENE_PLANNING                      │
│        ↓                            │
│ GENERATING                           │
│        ↓                            │
│ DRAFT_RECEIVED                      │
│        ↓                            │
│ DETERMINISTIC_AUDIT                 │
│        ↓                            │
│ SEMANTIC_AUDIT                      │
│        ↓                            │
│ QUALITY_AUDIT                       │
│        ↓                            │
│ REVISION_DECISION                   │
│      ├──── ACCEPT                   │
│      ├──── REVISE                   │
│      ├──── HUMAN_REVIEW             │
│      └──── REJECT                   │
│        ↓                            │
│ COMMIT_GUARD                        │
│        ↓                            │
│ ATOMIC_COMMIT                       │
│        ↓                            │
│ STATE_UPDATE                        │
│        ↓                            │
│ SNAPSHOT                            │
│        ↓                            │
│ DONE                                │
└─────────────────────────────────────┘
 │
 ├── Event Stream → UI
 ├── Billing
 ├── Memory Projection
 ├── Quality Metrics
 ├── Benchmark
 └── Evolution Engine
```

这条链的核心原则只有一句：

> **模型生成内容，系统决定状态。**

这也是你上传方案里最关键的 Deterministic FSM 思路。

---

# 二、先确定“哪些现有代码保留，哪些迁移”

## 直接保留

| 现有能力                         | 处理                  |
| ---------------------------- | ------------------- |
| `lib/genre-engine.js`        | 保留，改成 Resolver      |
| `lib/style-system.js`        | 保留，升级为 Style Bundle |
| `lib/ai-flavor-detector.js`  | 保留，改成风险信号           |
| `lib/causal-debt-tracker.js` | 保留，接正式生成链           |
| `lib/evidence-review.js`     | 保留，升级证据协议           |
| `lib/project-scope.js`       | 保留                  |
| PG jobs/fencing              | **保留并作为生产任务基础**     |
| Token reservation/settlement | **保留**              |
| SSE                          | 保留                  |
| 两遍 Humanizer                 | **保留，但增加 ROI Gate** |
| Benchmark 系统                 | 保留，改成评测线            |
| `completion-library.js`      | 保留                  |
| `completion-editor.js`       | 保留 UI，不再让它拥有生成业务逻辑  |

---

## 需要收敛

这些能力现在存在重叠风险：

```text
server.js handleChat
completion-editor.js
pages/editor.js
pipeline-coordinator.js
generation-pipeline-coordinator.js
benchmark-pipeline.js
```

最终：

```text
正式写章
      ↓
Generation Orchestrator
```

只有这一条。

---

# 三、第一步不是改功能，而是建立“安全施工区”

建立：

```text
feature/generation-v2
```

并增加：

```env
MOLAN_GENERATION_V2=false
```

正式部署：

```text
V2关闭
```

仍走旧链。

测试环境：

```env
MOLAN_GENERATION_V2=true
```

以后所有改造都必须在这个开关下进行。

---

# 四、Phase 0：建立不可破坏基线

这是整个项目最容易被忽视、却最重要的一阶段。

新建：

```text
molan-home/data/evolution/
├── baseline/
│   ├── code-manifest.json
│   ├── prompt-manifest.json
│   ├── schema-manifest.json
│   ├── genre-manifest.json
│   ├── style-manifest.json
│   └── runtime-manifest.json
│
├── experiments/
├── regressions/
├── accepted/
├── rejected/
└── snapshots/
```

你上传方案已经明确要求每次生成记录代码、Pipeline、Genre、Style、Prompt、Bible、State 等版本。

---

## 4.1 Generation Manifest

标准：

```json
{
  "generationId": "gen_xxx",
  "projectId": "xxx",
  "branchId": "main",
  "chapterId": "chapter_28",

  "codeVersion": "gitsha",
  "pipelineVersion": "generation-v2.1",
  "genreEngineVersion": "genre-3",
  "styleVersion": "style-5",
  "benchmarkVersion": "benchmark-2",

  "modelId": "gpt-5.6-luna",
  "providerModel": "gpt-5.6-luna",

  "promptVersion": "writer-7",
  "storyBibleVersion": 12,
  "stateVersion": 27,

  "contextHash": "...",
  "contractHash": "...",
  "promptHash": "...",
  "outputHash": "...",

  "createdAt": 0
}
```

以后任何质量变化，都能够回答：

> “为什么这一章和上一版不一样？”

---

# 五、Phase 1：正式建立 Generation V2

新增：

```text
molan-home/lib/generation/
├── orchestrator.js
├── state-machine.js
├── run-context.js
├── idempotency.js
├── budget.js
├── contract.js
├── context.js
├── planner.js
├── writer.js
├── fact-extractor.js
├── deterministic-audit.js
├── semantic-audit.js
├── quality-audit.js
├── revision.js
├── commit.js
├── events.js
├── recovery.js
└── errors.js
```

你之前方案里的 `generation-v2` 和现在仓库已有 `generation-pipeline-coordinator` 不需要二选一。

正确方式：

```text
旧 generation-pipeline-coordinator
                ↓
        逐步迁移能力
                ↓
       generation/orchestrator
                ↓
       最终旧实现只剩兼容层
```

---

# 六、Phase 2：数据库——先建立 Generation Run

当前 PG 已经有 jobs / commit / audit / snapshots 等基础，不需要重新做一套 Job。

新增 migration：

```text
molan-home/db/migrations/0039_luna_generation_runs.sql
```

建议：

```sql
CREATE TABLE IF NOT EXISTS luna.generation_runs (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id uuid NOT NULL,

  branch_id uuid,
  chapter_id uuid,

  pipeline_version text NOT NULL,
  state text NOT NULL,

  attempt_no integer NOT NULL DEFAULT 0,

  idempotency_key text NOT NULL,
  request_hash text NOT NULL,

  contract_id uuid,
  context_snapshot_id uuid,

  model_id text NOT NULL DEFAULT '',
  provider_model text NOT NULL DEFAULT '',
  provider_request_id text DEFAULT '',

  prompt_hash text NOT NULL DEFAULT '',
  output_hash text NOT NULL DEFAULT '',

  reserved_cost_minor bigint NOT NULL DEFAULT 0,
  actual_cost_minor bigint NOT NULL DEFAULT 0,

  cancel_requested boolean NOT NULL DEFAULT false,

  lease_owner uuid,
  lease_until timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0,

  error_code text NOT NULL DEFAULT '',
  error_detail text NOT NULL DEFAULT '',

  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,

  PRIMARY KEY (workspace_id, project_id, id),

  CHECK (state IN (
    'created',
    'request_validated',
    'genre_resolved',
    'style_resolved',
    'context_built',
    'contract_validated',
    'pre_generation_guard',
    'scene_planning',
    'generating',
    'draft_received',
    'deterministic_audit',
    'semantic_audit',
    'quality_audit',
    'revision',
    'waiting_author',
    'committing',
    'committed',
    'cancel_requested',
    'cancelled',
    'paused',
    'failed',
    'provider_unknown',
    'needs_human'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS luna_generation_idempotency_idx
ON luna.generation_runs (
  workspace_id,
  project_id,
  idempotency_key
);

CREATE INDEX IF NOT EXISTS luna_generation_project_updated_idx
ON luna.generation_runs (
  workspace_id,
  project_id,
  updated_at DESC
);
```

---

# 七、再建 Stage Run

不要把所有过程全部塞在 generation_runs。

再建：

```sql
CREATE TABLE IF NOT EXISTS luna.generation_stage_runs (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  generation_id uuid NOT NULL,

  stage text NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1,

  status text NOT NULL,

  input_hash text NOT NULL DEFAULT '',
  output_hash text NOT NULL DEFAULT '',

  prompt_tokens bigint,
  completion_tokens bigint,
  reasoning_tokens bigint,
  cached_tokens bigint,

  reserved_cost_minor bigint NOT NULL DEFAULT 0,
  actual_cost_minor bigint NOT NULL DEFAULT 0,

  provider_request_id text DEFAULT '',

  error_code text NOT NULL DEFAULT '',

  started_at timestamptz,
  finished_at timestamptz,

  PRIMARY KEY (
    workspace_id,
    project_id,
    generation_id,
    stage,
    attempt_no
)
);
```

这样以后能看到：

```text
生成第28章

CONTEXT_BUILD       0.3s
SCENE_PLAN          3.2s
WRITER              48.8s
DETERMINISTIC       0.2s
SEMANTIC_AUDIT      9.3s
HUMANIZER           36.1s
COMMIT              0.1s
```

---

# 八、再建 Idempotency

单独建：

```sql
CREATE TABLE IF NOT EXISTS luna.generation_idempotency (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,

  idempotency_key text NOT NULL,

  request_hash text NOT NULL,
  generation_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (
    workspace_id,
    project_id,
    idempotency_key
  )
);
```

---

# 九、Idempotency 的真实运行规则

客户端：

```http
Idempotency-Key: gen_8f7e...
```

服务端：

```js
const key = req.headers['idempotency-key'];
```

然后：

```text
不存在
→ 创建 generation

存在 + requestHash 一样
→ 返回已有 generation

存在 + requestHash 不一样
→ 409 IDEMPOTENCY_KEY_REUSED
```

---

# 十、特别重要：`/api/chat` 不删除，但不能再负责正式写章

现在 `handleChat()` 有很多正常能力：

```text
Skill 注入
Style
Character Material
Prompt Injection
Billing
SSE
Two Pass
```

这些都不要废掉。

但是正式正文生成改为：

```text
POST /api/generation-runs
```

`/api/chat` 以后只做：

```text
普通聊天
咨询
工具
局部辅助
非正式生成
```

对于历史客户端发来的：

```json
{
  "creationMode": true,
  "stage": "writing"
}
```

可以在 V2 开启时：

```text
/api/chat
   ↓
内部转入
   ↓
handleGenerationCreate()
```

而不是让它再执行一套独立 FSM。

这可以做到**旧页面兼容，新系统统一**。

---

# 十一、Phase 3：状态机必须写死，不让模型控制

创建：

```js
const TRANSITIONS = {
  created: ['request_validated', 'cancel_requested'],
  request_validated: ['genre_resolved', 'failed'],
  genre_resolved: ['style_resolved', 'failed'],
  style_resolved: ['context_built', 'failed'],
  context_built: ['contract_validated', 'failed'],
  contract_validated: ['pre_generation_guard', 'failed'],
  pre_generation_guard: ['scene_planning', 'generating', 'needs_human'],
  scene_planning: ['generating', 'failed'],
  generating: ['draft_received', 'paused', 'cancel_requested', 'provider_unknown'],
  draft_received: ['deterministic_audit', 'failed'],
  deterministic_audit: ['semantic_audit', 'revision', 'rejected'],
  semantic_audit: ['quality_audit', 'revision', 'waiting_author'],
  quality_audit: ['revision', 'committing', 'waiting_author'],
  revision: ['deterministic_audit', 'needs_human'],
  committing: ['committed', 'provider_unknown', 'failed'],
  cancel_requested: ['cancelled', 'provider_unknown'],
  paused: ['generating', 'cancelled'],
  needs_human: ['committing', 'cancelled'],
  waiting_author: ['committing', 'cancelled']
};
```

然后：

```js
function transition(run, next) {
  const allowed = TRANSITIONS[run.state] || [];
  if (!allowed.includes(next)) {
    throw new PipelineError(
      'INVALID_STATE_TRANSITION',
      `${run.state} -> ${next}`
    );
  }

  return {
    ...run,
    state: next,
    updatedAt: Date.now()
  };
}
```

---

# 十二、永远不允许模型返回这种东西

```json
{
  "nextStep": "rewrite"
}
```

直接修改系统状态。

模型输出只能：

```json
{
  "content": "...",
  "findings": [],
  "facts": [],
  "stateCandidates": []
}
```

而：

```text
系统
 ↓
根据 audit status
 ↓
决定是否 revision
```

---

# 十三、Phase 4：题材系统——彻底解决默认玄幻

当前代码里存在：

```js
effectiveGenre = ... || '玄幻'
```

这个必须取消。

你上传方案已经把正确策略写得很明确：高置信度自动、中等置信度给候选、低置信度必须确认。

---

## 新增

```text
lib/genre/resolver.js
lib/genre/profile.js
lib/genre/compiler.js
lib/genre/budget.js
lib/genre/audit-policy.js
```

---

# 十四、Genre Resolver

```js
function resolveGenre(input) {
  const candidates = detectGenreCandidates(input);

  if (!candidates.length) {
    return {
      status: 'uncertain',
      confidence: 0,
      candidates: []
    };
  }

  const top = candidates[0];

  if (top.confidence >= 0.85) {
    return {
      status: 'resolved',
      confidence: top.confidence,
      genre: top.genre,
      subgenre: top.subgenre || ''
    };
  }

  if (top.confidence >= 0.60) {
    return {
      status: 'needs_choice',
      confidence: top.confidence,
      candidates: candidates.slice(0, 3)
    };
  }

  return {
    status: 'uncertain',
    confidence: top.confidence,
    candidates: candidates.slice(0, 3)
  };
}
```

---

# 十五、最终 Genre Profile

不要只存：

```json
{
  "genre": "玄幻"
}
```

改成：

```json
{
  "genreFamily": "玄幻",
  "subGenre": "传统玄幻",

  "narrativeMode": "成长升级",
  "pov": "third-limited",

  "tone": "热血克制",
  "pacing": "fast",

  "dialogueProfile": {
    "targetRatio": 0.22,
    "turnDistribution": {
      "short": 0.55,
      "medium": 0.35,
      "long": 0.10
    }
  },

  "descriptionProfile": {
    "sensory": 0.72,
    "metaphor": 0.45,
    "environment": 0.50
  },

  "tensionModel": {
    "type": "rising-release",
    "start": 0.35,
    "peak": 0.88,
    "end": 0.68
  },

  "payoffPolicy": {
    "combat": true,
    "loot": true,
    "relationship": true,
    "mystery": false
  },

  "auditPolicy": {
    "requireExternalEvent": false,
    "requireConflict": true,
    "requireInformationChange": true
  },

  "budgetProfile": {
    "defaultTargetChars": 2600,
    "minChars": 2100,
    "maxChars": 3200
  }
}
```

---

# 十六、必须把“题材”和“文风”分开

最终：

```text
GenreProfile
+
NarrativeProfile
+
StyleProfile
+
CharacterVoiceProfile
+
SceneProfile
+
CommercialProfile
```

组成：

```text
StyleBundle
```

这样同样是都市：

```text
都市 + 商战 + 冷峻
```

和：

```text
都市 + 日常 + 治愈
```

不是同一个生成器。

你上传方案已经明确要求把题材、叙事、文风、节奏、POV、语言分别建模。

---

# 十七、Phase 5：Style DNA

增加：

```text
lib/style/style-dna.js
lib/style/character-voice.js
lib/style/style-bundle.js
```

Style DNA：

```json
{
  "sentence": {},
  "paragraph": {},
  "dialogue": {},
  "narration": {},
  "description": {},
  "emotion": {},
  "pacing": {},
  "viewpoint": {},
  "characterVoice": {},
  "metaphor": {},
  "sensory": {},
  "humor": {},
  "subtext": {},
  "informationRelease": {},
  "hook": {},
  "payoff": {}
}
```

不是：

```text
“像某作者”
```

而是：

```text
“采用什么语言决策”
```

这也是你之前“真正的闭环创书”想解决的核心。

---

# 十八、作者风格标签必须脱敏成机制

内部可以有：

```text
route-A
route-B
route-C
```

甚至继续保留：

```text
sourceBookStyleId
```

但生成 Prompt 不写：

```text
“模仿 XX 作者”
```

而编译为：

```text
资源精算
+
低信息公开度
+
高因果代价
+
克制情绪
+
具体器物损耗
+
低修辞密度
```

你上传的文件也明确要求从“模仿作者”转向“机制提取 → Style DNA → 原创生成”。

---

# 十九、Phase 6：章节合同

你现在已经有 Chapter Contract，这是很重要的基础。

升级为：

```json
{
  "chapterId": "c28",
  "chapterGoal": "...",

  "genreProfileId": "...",
  "styleBundleId": "...",

  "pov": "third-limited",
  "viewpointCharacter": "char_01",

  "allowedKnowledge": [
    "fact_11",
    "fact_18"
  ],

  "forbiddenKnowledge": [
    "fact_90"
  ],

  "characters": [
    "char_01",
    "char_07"
  ],

  "relationshipChange": {
    "char_01:char_07": "+0.18"
  },

  "informationReveal": [
    "clue_17"
  ],

  "causalDebt": [
    "debt_8"
  ],

  "requiredPayoff": [],

  "mustNot": [],

  "tension": {
    "start": 0.28,
    "peak": 0.76,
    "end": 0.61
  },

  "wordBudget": {
    "targetChars": 2800,
    "minChars": 2300,
    "maxChars": 3400
  }
}
```

---

# 二十、修复“阶段必须变化”的误伤

不能只判断：

```text
ExternalEvent
```

必须允许：

```text
ExternalEventChange
InformationChange
RelationshipChange
CharacterChange
ResourceChange
GoalChange
KnowledgeChange
CausalChange
```

至少有一类变化即可。

例如：

```text
两个人喝茶
```

也可以合法成为：

```text
关系变化
+
新信息
+
新承诺
+
新债务
```

你上传的方案已经明确指出这个问题。

---

# 二十一、不要所有题材强制“爽点”

`checkPayoffExecution()` 这种规则要成为：

```text
genreProfile.auditPolicy.payoffPolicy
```

例如：

```json
{
  "combat": true,
  "loot": true,
  "romance": false,
  "mystery": false,
  "relationship": true
}
```

不能再把“对手受挫、战利品验货”当成所有小说的通用规则。

---

# 二十二、Phase 7：上下文编译器

这是质量链里非常重要的一刀。

新增：

```text
lib/generation/context.js
```

统一：

```js
assembleContext({
  bible,
  state,
  contract,
  genre,
  style,
  debts,
  timeline,
  recentText,
  benchmarkSamples,
  budget
});
```

---

# 二十三、上下文优先级固定为：

```text
P0
├── Scene Contract
├── Hard State
├── POV Knowledge
├── Immediate Timeline
└── Active Causal Debt

P1
├── 当前人物
├── 当前地点
├── 当前世界规则
├── 当前关系
└── 当前卷状态

P2
├── 最近章节
├── 相关伏笔
└── 风格样本

P3
├── 远期剧情
└── 历史信息
```

你上传的方案也是要求 L0-L7 分层召回。

---

# 二十四、Context Plan 必须可复现

每次生成保存：

```json
{
  "contextPlanVersion": "3",

  "requiredBlocks": [],
  "includedBlocks": [],
  "truncatedBlocks": [],
  "omittedBlocks": [],

  "promptTokens": 0,
  "dynamicTokens": 0,
  "outputReserve": 0,

  "contextHash": "..."
}
```

这样以后出现：

> “为什么第 32 章突然忘记了第 20 章？”

可以直接看：

```text
第32章
↓
context planner
↓
第20章的信息被裁掉
```

而不是猜。

---

# 二十五、千万不要把整本书塞 Prompt

正确：

```text
全书事实
↓
索引

当前章
↓
召回

当前场景
↓
精确状态

当前人物
↓
声音

当前任务
↓
Contract
```

而不是：

```text
100万字全文
→ model
```

---

# 二十六、Phase 8：Hard State Ledger

建立：

```text
lib/story-state/
├── entities.js
├── state.js
├── timeline.js
├── ownership.js
├── relationship.js
└── invariants.js
```

每个角色：

```json
{
  "alive": true,
  "location": "city_03",

  "power": {
    "system": "cultivation",
    "tier": "foundation_2"
  },

  "body": {
    "rightArm": "disabled"
  },

  "faction": "f_03",

  "possessions": [
    "item_88"
  ],

  "knowledge": [
    "fact_18"
  ]
}
```

---

# 二十七、不要存整块状态，要记录 Delta

例如上一章：

```text
境界：筑基二层
灵石：18
地点：赤城
```

本章：

```json
{
  "power": "+1",
  "spiritStones": "-5",
  "location": "赤城→黑石镇"
}
```

后续只需要注入：

```text
最近状态
+
变化量
```

而不是重新塞整套历史。

---

# 二十八、Phase 9：时间线使用区间

不要只有：

```text
timestamp
```

加入：

```json
{
  "start": "day_21 07:00",
  "end": "day_22 18:00",

  "location": "red_city",

  "travel": {
    "to": "black_stone_town",
    "distance": 120,
    "durationHours": 36
  }
}
```

这样：

```text
角色 A
07:00 赤城

角色 A
09:00 黑石镇
```

如果物理上不可能，就在 Pre-generation Guard 阶段拦截。

你上传的方案也把时间线、地点、移动成本定义为硬约束。

---

# 二十九、Phase 10：Causal Debt + Narrative Debt

你已经有：

```text
causal-debt-tracker
```

继续保留，但增加：

```text
Promise
Relationship
Information
CharacterArc
WorldExplanation
Conflict
Emotion
```

例如：

```json
{
  "id": "debt_21",
  "type": "promise",

  "seedChapter": 8,

  "expectedSpan": 5,

  "resolveBefore": 14,

  "priority": 0.84,

  "status": "OPEN"
}
```

---

# 三十、再加一个很重要的新层：Narrative Debt

这是我建议你一定加进去的。

例如：

```text
第 12 章
主角答应帮助角色 B
```

这不一定是传统伏笔。

但它形成：

```text
Promise Debt
```

以后可以自动召回。

再如：

```text
角色 A 与 B
第 18 章发生重大冲突
```

后面：

```text
连续 4 章完全没关系
```

系统记录：

```text
Relationship Debt
```

这对于“人物像人”非常重要。

---

# 三十一、Phase 11：正式 Scene Planner

不要默认：

```text
一章 = 一次模型请求
```

标准：

```text
Chapter Contract
↓
Scene 1
↓
Scene 2
↓
Scene 3
...
```

一般：

```text
普通网文：4–8
悬疑：3–7
快节奏爽文：5–10
文学慢节奏：2–4
```

这里不是死数字。

由 Genre Profile 决定。

---

# 三十二、Scene Contract

例如：

```json
{
  "sceneId": "s4",

  "purpose": "推进关系",

  "goal": "让主角意识到对方不是背叛者",

  "characters": [
    "char_01",
    "char_07"
  ],

  "location": "old_hospital",

  "knowledgeBoundary": {
    "pov": "char_01",
    "knows": ["fact_1", "fact_3"],
    "cannotKnow": ["fact_8"]
  },

  "emotion": {
    "start": 0.31,
    "peak": 0.71,
    "end": 0.52
  },

  "mustAdvance": [
    "relationship_4",
    "clue_8"
  ]
}
```

---

# 三十三、如果已有明确 Scene Contract，就不要再次调用 Planner

这是一项很重要的稳定性优化：

```text
已有场景合同
→ 直接 Writer

没有
→ Planner
```

不要：

```text
每章
→ Planner
→ 再由模型重新决定原本已经确定好的剧情
```

这样可以减少：

```text
漂移
+
成本
+
延迟
```

---

# 三十四、Phase 12：Writer

Writer 只拿：

```text
StyleBundle
+
GenreProfile
+
SceneContract
+
HardState
+
Context
+
CausalDebt
```

不拿：

```text
评分器内部规则
```

更不能拿：

```text
“为了得 90 分”
```

之类的指令。

---

# 三十五、正文 Prompt 的固定组成顺序

```text
SYSTEM CORE
↓
GENRE PROFILE
↓
STYLE DNA
↓
CHARACTER VOICE
↓
WORLD INVARIANTS
↓
HARD STATE
↓
CHAPTER CONTRACT
↓
SCENE CONTRACT
↓
CAUSAL DEBT
↓
RECENT TEXT
↓
USER TEMPORARY REQUEST
```

顺序稳定。

不要每次随机。

这也是 Prompt Cache 真正有价值的基础。

---

# 三十六、Character Voice Contract

这是你“人味”系统最值得加的一层。

```json
{
  "characterId": "c1",

  "speech": {
    "sentenceLength": "short-medium",
    "directness": 0.30,
    "humor": 0.70,
    "formality": 0.20,
    "questionFrequency": 0.40
  },

  "behavior": {
    "hesitation": 0.60,
    "riskAversion": 0.80,
    "impulsiveness": 0.20
  },

  "subtext": {
    "frequency": 0.80,
    "directEmotion": 0.25
  },

  "physicalTells": [],
  "verbalHabits": [],
  "taboos": []
}
```

---

# 三十七、再加 Relationship Voice

同一个人物：

```text
对敌人
对爱人
对父母
对师父
对下属
```

不能一个声音。

所以：

```text
CharacterVoice
+
RelationshipVoice
```

一起编译。

---

# 三十八、Phase 13：AI 味检测重新定位

你现在的 `ai-flavor-detector` 有：

```text
sentence std
TTR
paragraph CV
lexicon
structural patterns
```

这些全部保留。

但：

```text
AIFlavor ≠ 坏文章
```

所以最终：

```text
AIFlavorScore
```

只是：

```text
risk signal
```

不能直接：

```text
score < threshold
→ rewrite
```

---

# 三十九、正确的 Humanizer Decision

```text
Draft
 ↓
AIFlavor
 ↓
StyleFit
 ↓
CharacterVoice
 ↓
SemanticStability
```

只有：

```text
AI flavor 高
AND
存在可定位风险
AND
重写预期收益 > 风险
```

才进入 Humanizer。

否则直接出稿。

---

# 四十、当前两遍 Humanizer 保留，但增加 ROI

你当前服务器已经实现：

```text
第一遍
→ AI flavor
→ 如果通过直接返回

不通过
→ 第二遍
```

这个设计不要删。

增加：

```json
{
  "firstPassScore": 82,
  "secondPassScore": 59,

  "dialogueDelta": 0.03,
  "styleDelta": 0.01,
  "continuityDelta": 0,

  "extraCost": 0.31,

  "semanticChanges": 3,

  "roi": 6.5
}
```

如果长期发现：

```text
AI flavor ↓
但 dialogue ↓
character ↓
```

就自动把 Humanizer 从“默认策略”降级成“特定场景策略”。

---

# 四十一、绝不能因为去 AI 味而牺牲真实文学特征

你当前质量资料已经发现：

```text
对白不足
比喻偏低
节奏偏冲
```

所以以后禁止：

```text
降低 AI 味
→ 大量删修辞
→ 大量删形容
→ 大量短句
→ 大量动作
```

否则得到的是：

```text
不像 AI
但也不像好小说
```

---

# 四十二、Phase 14：Deterministic Audit

先跑：

```text
0 模型成本
```

检查：

```text
正文为空
字数
章节结构
重复
角色状态
地点
时间
所有权
能力
世界规则
Forbidden Copy
JSON
合同
```

通过后再：

```text
Semantic Audit
```

---

# 四十三、Evidence Audit 必须变成证据协议

以后每个问题必须有：

```json
{
  "issueId": "audit_12",

  "severity": "blocker",
  "category": "character",

  "quote": "他抬起已经断掉的右手",

  "quoteHash": "...",

  "chapterId": "c28",
  "sceneId": "s3",

  "sourceFactId": "fact_88",

  "problem": "右手状态为 disabled",

  "fixHint": "改为左手或删除动作"
}
```

---

# 四十四、证据找不到就不能拿去修

```js
if (!text.includes(issue.quote)) {
  issue.status = 'unverified';
}
```

然后：

```text
unverified
→ 不进入 rewrite
```

而是：

```text
needs_review
```

你上传的方案也明确要求“审计必须可定位”，这是防止假审计最关键的一步。

---

# 四十五、局部重写取代整章重写

错误：

```text
3000字
↓
1个问题
↓
整章重写
```

正确：

```text
问题 quote
↓
定位段落
↓
前后各 1–2 段
↓
局部 rewrite
↓
重新拼接
```

---

# 四十六、Rewrite API

新增：

```text
POST /api/generation-runs/:id/revision
```

请求：

```json
{
  "issueId": "audit_12",

  "quote": "原句",

  "replacementWindow": {
    "before": "...",
    "target": "...",
    "after": "..."
  }
}
```

模型只返回：

```json
{
  "quote": "原句",
  "replacement": "新句",
  "preservedFacts": [
    "fact_1",
    "fact_2"
  ]
}
```

---

# 四十七、每次局部修订都做 Meaning Preservation

比较：

```text
before
after
```

抽取：

```text
角色
地点
时间
数字
物品
关系
事实
事件
```

如果关键语义发生变化：

```text
REWRITE_REJECTED
```

---

# 四十八、严格限制修订轮数

建议：

```text
maxRevisionRounds = 2
```

如果：

```text
2 次后
同一 blocker 还存在
```

则：

```text
NEEDS_HUMAN
```

绝不能：

```text
模型一直循环
```

---

# 四十九、Phase 15：Quality Vector

不要只给：

```text
86分
```

正式保存：

```json
{
  "opening": {},
  "plot": {},
  "pacing": {},
  "character": {},
  "relationship": {},
  "emotion": {},
  "causality": {},
  "foreshadowing": {},
  "payoff": {},
  "dialogue": {},
  "description": {},
  "language": {},
  "humanTexture": {},
  "aiFlavor": {},
  "consistency": {},
  "originality": {},
  "readerDrive": {},
  "genreFit": {},
  "styleFit": {}
}
```

每个：

```json
{
  "value": 0.82,
  "confidence": 0.91,
  "source": "deterministic|heuristic|model|human",
  "evidence": []
}
```

你上传方案要求的 QualityVector 正好适合做正式质量数据结构。

---

# 五十、Quality / GenreFit / StyleFit / Originality 必须分开

绝不能：

```text
Benchmark越像
→ Quality越高
```

必须：

```text
Quality
GenreFit
StyleFit
Originality
```

四条独立轴。

真正好的结果：

```text
Quality ↑
GenreFit ↑
StyleFit ↑
Originality 不下降
```

---

# 五十一、Phase 16：生成后自动更新 Story State

正式写完：

```text
正文
↓
Fact Extractor
↓
State Delta
↓
Timeline Delta
↓
Relationship Delta
↓
Foreshadow Delta
↓
Causal Debt Delta
```

例如：

```json
{
  "entityChanges": [],
  "timelineChanges": [],
  "relationshipChanges": [],
  "foreshadowChanges": [],
  "debtChanges": []
}
```

---

# 五十二、Atomic Commit

一次 DB transaction：

```text
manuscript revision
+
facts
+
entity state
+
timeline
+
relations
+
foreshadows
+
causal debts
+
outline state
+
generation run
+
audit reference
+
billing reference
+
outbox
```

一起提交。

绝不能出现：

```text
正文保存成功
但状态没更新
```

---

# 五十三、你现有 PG `commits` 表直接利用

当前 PG 已经有：

```text
commits
commit_items
audits
context_snapshots
manuscript_revisions
```

这部分非常适合直接接入。

所以这次不要重新设计 Commit Domain。

只需要让：

```text
generation-v2/commit.js
```

调用现有 commit infrastructure。

---

# 五十四、CAS 一定保留

提交：

```text
baseProjectRevision
```

数据库：

```sql
UPDATE ...
WHERE revision = expectedRevision;
```

如果：

```text
0 rows
```

返回：

```http
409 CONFLICT
```

前端显示：

```text
你的作品已被其他操作更新

[查看差异]
[刷新并重试]
```

而不是静默覆盖。

---

# 五十五、Outline ↔ Manuscript 双向闭环

生成后：

```text
正文
↓
Fact Delta
↓
Story State
↓
Outline Impact
```

如果正文改变了：

```text
角色
时间
关系
关键事件
```

系统自动查：

```text
后续 10–30 章
```

只更新：

```text
Affected Outline Nodes
```

不要直接批量重写后续正文。

---

# 五十六、Relationship Ledger

新增：

```text
relationLedger
```

结构：

```json
{
  "source": "c1",
  "target": "c7",

  "type": "enemy",

  "strength": 0.83,

  "reason": [
    "夺取宗门资源"
  ],

  "lastChangedChapter": 18,

  "nextPlannedChange": {
    "chapter": 21,
    "target": "truce"
  }
}
```

这样：

```text
上一章恨得要死
下一章突然互相关心
```

可以直接检出。

---

# 五十七、Phase 17：原创性四层检测

不要只查 forbidden terms。

最终：

```text
L1 词面
L2 段落/句段
L3 事件链
L4 人物功能结构
```

---

# 五十八、结构级原创检测

从原书提取：

```text
事件序列
人物功能
资源机制
冲突结构
升级机制
```

生成书提取：

```text
同类结构
```

计算：

```text
Event Chain Similarity
Character Function Similarity
Resource Mechanism Similarity
Conflict Pattern Similarity
```

然后：

```text
低
→ pass

中
→ review

高
→ block / human review
```

**不要把“和原书相似”直接等价为“不合格”。**

因为你本来就希望从原书学习机制。

真正要防的是：

```text
换名字后的等价复刻
```

---

# 五十九、Phase 18：小说原本 Benchmark 闭环

你之前最重要的目标就是：

```text
小说原本
→ 比较
→ 找缺陷
→ 找根因
→ 优化生成
→ 再比较
```

现在正式做成：

```text
Benchmark Builder
      ↓
Genre Baseline
      ↓
Style DNA
      ↓
Generated Chapter
      ↓
Quality Profiler
      ↓
Benchmark Comparator
      ↓
Defect Vector
      ↓
Root Cause Engine
      ↓
Optimization Hypothesis
      ↓
A/B
      ↓
Regression
      ↓
Accepted Knowledge
```

这正是你上传方案最后要求的持续进化闭环。

---

# 六十、Benchmark 不能只比较“一本书对一本书”

你现在已经有：

```text
genre-baselines
genre-evidence
benchmark-database
benchmark-review
```

全部保留。

但比较改成：

```text
Generated Novel
↓
同题材 Benchmark Pool
↓
P25
P50
P75
↓
差距
```

例如：

```text
Dialogue ratio
P50 = 0.24
Generated = 0.11

Pacing deviation
P50 = 0.18
Generated = 0.43
```

这才知道：

> 到底低于同题材一般水平多少。

---

# 六十一、Root Cause Engine

新增：

```text
lib/quality/root-cause.js
```

不要：

```text
对白少
→ 增加对白
```

而要：

```text
对白少
↓
对白 turn 少
↓
因为 Scene Contract 没有双方目标
↓
因为 Planner 没有 DialogueObjective
↓
因为 Dialogue Contract 缺失
```

最后真正修改：

```text
Scene Planner
+
Character Voice
+
Dialogue Objective
```

而不是：

```text
Prompt：对白写长一点
```

---

# 六十二、Optimization Experiment

增加：

```text
Hypothesis
Control
Treatment
Metrics
Regression
Decision
```

例如：

```text
Experiment:
EXP-0031

Hypothesis:
加入 DialogueObjective 能提升人物对白质量
```

Control：

```text
旧 Scene Planner
```

Treatment：

```text
新 Scene Planner + DialogueObjective
```

控制：

```text
同一 Bible
同一 Scene
同一 model
同一参数
```

测：

```text
Dialogue
Subtext
CharacterVoice
AIFlavor
Continuity
Cost
Latency
```

---

# 六十三、必须有 Shadow Mode

```text
Production Prompt
      │
      ├── 实际生成
      │
      └── Shadow Prompt
             ↓
          后台评测
```

Shadow：

```text
不影响用户结果
不改变 state
不改变 billing
```

只记录：

```text
quality
style
continuity
cost
latency
```

---

# 六十四、实验接受条件

建议初始门槛：

```text
目标指标提升 >= 5%
AND
无 blocker 回归
AND
GenreFit 下降 <= 2%
AND
StyleFit 下降 <= 2%
AND
Originality 不恶化
AND
稳定性不下降
AND
成本增加 <= 15%
```

这只是**初始工程门槛**，第一轮黄金集跑完后再用实际分布校准。

---

# 六十五、Phase 19：真正的评测四层

## Layer 1

完全确定性：

```text
字数
重复
实体
事实
时间
版本
权限
引用
状态
JSON
```

## Layer 2

启发式：

```text
AI Flavor
句长
段长
对白
节奏
Hook
```

## Layer 3

LLM Judge：

```text
人物
情绪
潜台词
因果
阅读驱动力
文学质量
```

## Layer 4

人工盲评：

```text
A稿
B稿
匿名
```

你上传的方案明确要求机器硬门禁、软指标、LLM Judge、真人盲评四层。

---

# 六十六、评测线必须和生成线隔离

生产：

```text
Planner
→ Writer
→ Audit
→ Revision
→ Commit
```

评测：

```text
Generated
→ Profiler
→ Benchmark
→ Judge
→ Human
```

生成模型**不能看到最终评分器内部细则**。

否则很容易变成：

```text
为了得分写小说
```

你上传的方案也特别指出这一点。

---

# 六十七、Phase 20：当前 `completion-editor.js` 怎么改

原则：

```text
completion-editor.js
```

以后只负责：

```text
显示
发送请求
接收事件
更新 UI
```

不再负责：

```text
判断下一阶段
决定重试
决定 commit
决定 audit
直接调用模型
```

---

# 六十八、前端只做这件事

```js
async function generateChapter() {
  const idempotencyKey = crypto.randomUUID();

  const response = await fetch('/api/generation-runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'Authorization': 'Bearer ' + backendState.token
    },
    body: JSON.stringify({
      projectId,
      chapterId,
      modelId,
      userInstruction
    })
  });

  // 服务器返回 runId
}
```

后续：

```text
GET /api/generation-runs/:id
```

或者：

```text
GET /api/generation-runs/:id/events
```

---

# 六十九、UI 不再用 `busy=true` 代表真正状态

应该：

```text
generationRun.state
```

直接驱动 UI。

例如：

```text
GENERATING
→ 正文生成中

DETERMINISTIC_AUDIT
→ 检查事实与合同

SEMANTIC_AUDIT
→ 深度校验

REVISION
→ 正在修订

COMMITTING
→ 正在保存

COMMITTED
→ 已完成
```

这样 UI 永远不会：

```text
看起来生成结束
实际后台还在跑
```

---

# 七十、你历史 UI 审计里发现的问题怎么处理

之前的：

```text
刷新后小说列表不加载
/api/novels 摘要错误
paused 状态错误
editor 自动打开问题
```

根据当前仓库代码，这里面已有一些明显的后续修复迹象，例如当前 `completion-library.js` 的 `install()` 已主动触发 `refreshData(false, true)`，而当前 `statusOf()` 也已经识别 `paused`。

所以：

> **这些历史问题现在不要重复修复，而要转成永久回归测试。**

这一点非常重要。

历史报告只能说明：

```text
过去发生过
```

不能说明：

```text
现在一定还发生
```

也不能说明：

```text 已经永久不会再发生
```

---

# 七十一、Feature Contract Registry

这是你要求“显示出来的功能必须真的实现”的最佳方案。

新建：

```text
data/feature-contracts.json
```

例如：

```json
{
  "AI_GENERATE": {
    "displayName": "AI续写",
    "ui": true,
    "api": true,
    "backend": true,
    "persistence": true,
    "streaming": true,
    "cancel": true,
    "retry": true,
    "audit": true,
    "billing": true,
    "test": true
  }
}
```

每个功能：

```text
UI
↓
Event
↓
API
↓
Service
↓
DB
↓
Result
↓
UI
```

任何断点：

```text
PARTIAL
```

不能：

```text
IMPLEMENTED
```

---

# 七十二、所有按钮要做真实履约测试

例如：

```text
[生成]
→ generation_runs +1

[停止]
→ cancel_requested=true

[继续]
→ 新 attempt

[审计]
→ audit row

[提交]
→ commit row + manuscript revision

[回滚]
→ revision restored

[刷新]
→ server state

[导出]
→ actual file
```

---

# 七十三、Phase 21：本地无损保存——IndexedDB WAL

这个很重要。

你现在编辑器核心保存仍然以 debounce + server/local state 为主。

对于：

```text
百万字
长章节
网络抖动
浏览器刷新
断电
```

不够。

增加：

```text
lib/client/local-wal.js
```

使用：

```text
IndexedDB
```

保存：

```json
{
  "opId": "op_xxx",
  "projectId": "p1",
  "chapterId": "c28",

  "baseRevision": 18,

  "patch": [
    {
      "type": "replace",
      "path": "/scenes/2/content",
      "value": "..."
    }
  ],

  "createdAt": 0
}
```

---

# 七十四、保存流程

```text
用户输入
↓
200~300ms
↓
IndexedDB WAL
↓
UI继续工作
↓
后台同步
↓
服务器 ACK
↓
WAL 标记已提交
```

服务器没响应：

```text
WAL 保留
```

刷新：

```text
WAL replay
```

因此：

```text
不会丢输入
```

---

# 七十五、服务端不要继续整本 PUT 大 JSON

长期：

```text
POST /api/novels/:id/patch
```

成为主保存接口。

而不是：

```text
PUT /api/novels/:id
body = 整本小说 state
```

整本 JSON 保留作：

```text
backup / migration / snapshot
```

而不是高频写入方式。

---

# 七十六、Phase 22：百万字编辑器

必须：

```text
Virtualized Chapter Tree
```

正文只保持：

```text
当前章
前章
后章
```

DOM。

章节切换：

```text
server
+
IndexedDB
```

加载。

---

# 七十七、全文搜索

新增：

```text
Web Worker
+
Inverted Index
```

结构：

```text
term
→ chapterIds
→ sceneIds
→ offsets
```

搜索：

```text
“规则怪谈”
```

直接：

```text
index lookup
```

而不是：

```text
1000章 DOM regex
```

---

# 七十八、全书替换绝对不能 `replaceAll`

必须：

```text
Search
↓
Match Preview
↓
Create ChangeSet
↓
Review
↓
Apply
```

保存：

```text
before
after
chapter
revision
operator
timestamp
```

这样：

```text
Ctrl+Z
```

才真正可实现。

---

# 七十九、Phase 23：UI 统一

当前已经有：

```text
pages/molan-ui.css
```

不要再造第三套设计系统。

建立：

```text
pages/tokens.css
```

最终所有页面只使用：

```css
--ink
--ink-soft
--paper
--canvas
--line
--line-strong
--muted
--green
--blue
--amber
--danger

--space-1
--space-2
--space-3
--space-4
--space-6
--space-8

--radius-sm
--radius-md

--font-sans
--font-serif
--font-mono
```

---

# 八十、编辑器目前最需要清理的是“视觉体系分裂”

现在：

```text
molan-ui.css
+
styles.css
+
editor.html inline CSS
+
大量 JS inline style
```

不要一次全重写。

采用：

```text
Step 1
建立 design tokens

Step 2
editor.css 改成引用 tokens

Step 3
inline style → class

Step 4
旧变量 alias

Step 5
删除 legacy CSS
```

---

# 八十一、编辑器最终视觉层级

```text
顶部：
作品 / 保存状态 / 模型 / AI

左侧：
章节

中间：
正文

右侧：
AI / 审计 / 设定

高级：
上下文 / 成本 / Benchmark
```

不要同时显示：

```text
十几个高级功能
```

因为：

> 功能多不等于操作简单。

---

# 八十二、生成流程 UI

实际显示：

```text
生成第28章

✓ 读取章节合同
✓ 检查人物状态
✓ 构建上下文
✓ 规划场景
● 生成正文
○ 确定性审计
○ 语义审计
○ 文风检查
○ 局部修订
○ 提交
```

当前任务：

```text
场景 4 / 6
```

成本：

```text
输入 8.2K
输出 3.1K
累计 0.42 credits
```

---

# 八十三、AI 思考过程不要直接展示

不要：

```text
模型内部 CoT
```

只展示：

```text
阶段状态
```

例如：

```text
正在检查人物连续性
正在构建当前场景上下文
正在做语义审计
```

---

# 八十四、Phase 24：错误处理必须标准化

建立：

```text
lib/generation/errors.js
```

标准错误：

```text
GENRE_UNCERTAIN
STYLE_UNCERTAIN
CONTEXT_OVERFLOW
CONTRACT_INVALID
STATE_CONFLICT
MODEL_TIMEOUT
MODEL_429
MODEL_5XX
MODEL_EMPTY
MODEL_TRUNCATED
MODEL_CONTENT_BLOCKED
USAGE_UNKNOWN
PROVIDER_UNKNOWN
AUDIT_BLOCKED
REVISION_EXHAUSTED
BUDGET_EXCEEDED
IDEMPOTENCY_KEY_REUSED
```

---

# 八十五、模型失败重试矩阵

| 错误               | 自动重试     |
| ---------------- | -------- |
| 429              | 是        |
| 502              | 是        |
| 503              | 是        |
| timeout          | 限次       |
| invalid JSON     | 结构修复 1 次 |
| empty            | 限次       |
| truncated        | 有明确原因才重试 |
| usage unknown    | **否**    |
| provider unknown | **否**    |
| commit unknown   | **否**    |

---

# 八十六、Unknown 状态一定不能自动换 requestId 重跑

例如：

```text
请求已经发给模型
↓
服务器断网
↓
不知道模型是否已经生成
```

状态：

```text
PROVIDER_UNKNOWN
```

必须：

```text
核验
↓
确认
```

而不能：

```text
换 requestId
↓
重新生成
↓
重复扣费
```

你上传方案对此已经明确强调。

---

# 八十七、Phase 25：取消/暂停

当前服务器已有：

```text
AbortController
res.close
upstream destroy
```

这些保留。

再向下延伸：

```text
UI Stop
↓
POST /generation/:id/cancel
↓
cancel_requested = true
↓
worker heartbeat
↓
AbortController.abort()
↓
provider request destroy
↓
job=cancelled
↓
billing release
```

---

# 八十八、Pause 不等于 Cancel

建议：

### Cancel

```text
立即停止
不继续
```

### Pause

```text
保存 partial draft
保存 stage checkpoint
停止当前 provider
状态 = paused
```

Resume：

```text
从 checkpoint 继续
```

这比简单：

```text
AbortController.abort()
```

更符合“长期生成任务”。

---

# 八十九、Phase 26：分布式限流

你当前 `allowChatRate()`、`acquireChatSlot()` 还是进程内状态。

单实例没问题。

多实例：

```text
A
B
C
```

就可能分别允许并发。

第一阶段不要急着上 Redis。

既然 PG 已经是生产权威状态，先做：

```text
generation_concurrency
```

或基于：

```text
luna.jobs
```

判断用户并发。

以后真实规模上来，再引入 Redis。

---

# 九十、Phase 27：观察性

这是前面计划里很容易遗漏、但生产稳定性非常关键的一项。

统一：

```text
traceId
requestId
generationId
stageId
providerRequestId
```

所有日志：

```json
{
  "traceId": "...",
  "requestId": "...",
  "generationId": "...",
  "stage": "writer",
  "state": "generating",
  "durationMs": 48321
}
```

这样一旦用户说：

> “第 32 章生成失败了。”

可以直接查：

```text
generationId
↓
stage
↓
provider
↓
billing
↓
audit
↓
commit
```

---

# 九十一、再补一个容易被忽略的生产能力：模型 Provider 健康评分

每个模型记录：

```text
successRate
timeoutRate
emptyRate
truncationRate
averageLatency
averageCost
contextErrorRate
```

但不要拿历史数据做自动“聪明切模型”。

先用于：

```text
管理员
+
Routing Policy
```

这样比较可控。

---

# 九十二、再补一个你方案里没有明确单独强调的安全项：Provider SSRF

因为你的平台允许 OpenAI-compatible Provider / baseURL。

必须限制：

```text
禁止请求 localhost
禁止 127.0.0.1
禁止 0.0.0.0
禁止私有网段
禁止 metadata endpoint
```

例如：

```text
169.254.169.254
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
127.0.0.0/8
::1
```

只允许管理员配置过的 Provider endpoint。

这是 SaaS 必须补的一项。

---

# 九十三、再补：XSS / HTML 正文安全

你现在很多 UI 会：

```js
innerHTML = ...
```

虽然有 `esc()` 之类的保护，但最终必须统一：

```text
用户内容
→ 永远 textContent

需要 Markdown
→ Markdown sanitizer

允许 HTML
→ 白名单 sanitizer
```

尤其：

```text
AI 生成内容
小说正文
用户导入文本
```

绝不能直接信任。

---

# 九十四、Prompt Injection 不只是关键词检测

你已有：

```text
injectPromptInjectionGuard()
```

继续保留。

但真正的架构应该：

```text
Instruction Channel
+
Data Channel
```

原著文本：

```xml
<source_data>
...
</source_data>
```

永远被视为：

```text
DATA
```

不是：

```text
INSTRUCTION
```

---

# 九十五、Source Book 不要直接进生成模型

正确：

```text
小说原本
↓
拆书
↓
结构特征
↓
Style DNA
↓
Narrative Mechanism
↓
Benchmark
↓
生成
```

不要：

```text
小说原本全文
↓
生成模型
```

这样能够同时解决：

```text
版权风险
Prompt Injection
上下文膨胀
结构性复制
```

---

# 九十六、Phase 28：长篇 Soak Test

必须真正执行：

```text
3章
10章
20章
50章
100章
```

而不是只测：

```text
第1章
```

---

# 九十七、每 10 章统计一次

```text
continuity errors
relationship drift
character drift
power drift
timeline errors
foreshadow orphan
causal debt age
style drift
AI flavor drift
dialogue drift
cost
latency
retry count
```

---

# 九十八、黄金集

第一阶段：

```text
玄幻 10
都市 10
悬疑 10
言情 10
历史 10
科幻 10
西幻 10
轻小说 10
```

共：

```text
80 个任务
```

你上传方案本身也提出了这个规模的黄金任务集。

---

# 九十九、每个黄金任务必须固定

```text
Bible
Outline
Chapter Contract
Context Snapshot
Model
Model params
Pipeline version
```

这样才真正可 Replay。

---

# 一百、Replay 是整个优化闭环的基础

每一个 Generation Run：

```text
Replay
```

重新执行。

例如：

```text
V1
→ 生成

V2
→ 同样输入
→ 新 Prompt
```

然后：

```text
Quality V1
vs
Quality V2
```

---

# 一百零一、建立 Replay Manifest

```json
{
  "sourceGenerationId": "gen_123",

  "pipelineVersion": "generation-2.1",
  "promptVersion": "writer-7",

  "genreProfileVersion": "genre-4",
  "styleVersion": "style-8",

  "model": "gpt-5.6-luna",

  "parameters": {
    "temperature": 0.8,
    "maxTokens": 5000
  },

  "contextHash": "...",
  "contractHash": "..."
}
```

---

# 一百零二、Phase 29：Regression Gate

以后 Git Commit 不再只是：

```text
npm test
```

而是：

```text
npm test
↓
generation integration
↓
feature contracts
↓
golden subset
↓
literary regression
↓
genre regression
↓
style regression
↓
UI smoke
↓
performance smoke
↓
cost regression
```

---

# 一百零三、Regression 必须区分 8 类

```text
Engineering
Literary
Genre
Style
Humanity
Originality
Performance
Cost
```

例如：

```text
Engineering PASS
AIFlavor PASS
Dialogue FAIL
```

最终：

```text
REJECT
```

---

# 一百零四、Quality Regression 的真实规则

不要：

```text
总分 -1
```

就直接阻断。

而使用：

```text
hard gate
+
guard metrics
+
target metric
```

例如：

```text
连续性不能下降
原创性不能下降
成本不能爆炸
稳定性不能下降
```

只有目标指标改善才接纳。

---

# 一百零五、Phase 30：当前 server.js 不要立刻拆

这是很关键的一点。

当前 `server.js` 已经非常大。

但是千万不要：

```text
一次拆成 20 个模块
```

这样容易把现有稳定链打碎。

正确：

```text
server.js
↓
generation-api.js
↓
generation-orchestrator.js
```

先抽**一个垂直切片**。

生成链稳定以后：

```text
auth
billing
novels
dissection
benchmark
```

再逐步迁移。

---

# 一百零六、最终 server.js 应该只剩路由

目标：

```text
server.js
    ↓
router
    ↓
handlers
    ↓
services
```

而不是：

```text
server.js
= 整个系统
```

---

# 一百零七、Phase 31：`completion-editor.js` 的生成逻辑迁移顺序

不要删代码。

按这个顺序：

```text
① 原生成函数
② 改成 GenerationClient
③ 保留原 UI 事件
④ feature flag V2
⑤ V2 验证
⑥ 删除旧 provider 调用
⑦ 删除旧状态机
```

这样每一步都可以回滚。

---

# 一百零八、Phase 32：从 `state.generationRuns` 迁移到服务器

你当前前端仍维护：

```text
state.generationRuns
```

先不删。

改成：

```text
server generation_runs
→ 前端只保存最近 projection
```

迁移脚本：

```text
scripts/migrate-generation-runs.mjs
```

一次性转存旧记录。

---

# 一百零九、Phase 33：Novel State Source of Truth

最终必须定义：

```text
PostgreSQL
= Canonical Cloud Truth

SQLite
= Local Durable Truth

IndexedDB
= Browser Write-Ahead Buffer

Memory
= Cache

Frontend State
= Projection
```

不能再存在：

```text
A模块认为 localStorage是真相
B模块认为 SQLite
C模块认为 backendState
```

你上传方案也明确要求把这一层分工定死。

---

# 一百一十、Phase 34：UI 状态统一成 15 种

```text
EMPTY
LOADING
READY
STREAMING
SUCCESS
WARNING
ERROR
RETRYING
PAUSED
INTERRUPTED
UNKNOWN
CONFLICT
OFFLINE
SYNCING
COMMITTING
```

每一个 API 组件都必须映射其中一个。

---

# 一百一十一、尤其要处理 UNKNOWN

用户不能看到：

```text
生成失败
```

如果实际上：

```text
不知道 provider 到底成功没
```

应该：

```text
正在确认生成状态…
```

再进入：

```text
确认成功
```

或：

```text
确认失败
```

---

# 一百一十二、Phase 35：功能真实性自动检查

建立：

```text
scripts/audit-features.mjs
```

扫描：

```text
button
a
input
select
[data-action]
[data-feature]
```

然后检查：

```text
handler?
API?
backend?
DB?
state update?
test?
```

输出：

```text
FEATURE REPORT

AI_GENERATE      PASS
AI_STOP          PASS
AI_RETRY         PASS
EXPORT_EPUB      PARTIAL
GLOBAL_SEARCH    FAIL
```

这样未来不会再出现：

```text
按钮有了
功能没有
```

---

# 一百一十三、Phase 36：导出引擎

新增：

```text
lib/export/
├── document-model.js
├── txt.js
├── epub.js
└── docx.js
```

统一：

```text
Book
↓
ExportDocumentModel
↓
TXT / EPUB / DOCX
```

---

# 一百一十四、Phase 37：知识图谱成为 Projection

最终：

```text
Story State
     ↓
     ├── Knowledge Graph
     ├── Character Dashboard
     ├── Timeline
     ├── Foreshadow Board
     ├── Debt Board
     └── Outline
```

不要每个页面保存自己的一套事实。

---

# 一百一十五、Phase 38：多用户安全

你现在 PG 权限体系已经做了大量工作。

继续保证：

```text
workspace
+
project
+
member
+
role
+
capability
```

任何：

```text
GET
POST
PUT
PATCH
DELETE
```

都必须：

```text
auth
→ project scope
→ capability
```

---

# 一百一十六、Phase 39：Backup / Recovery

这也是“稳定性”经常没想到的一环。

至少：

```text
PG daily backup
PG point-in-time recovery
migration backup
pre-deploy snapshot
```

并且每月真正做一次：

```text
Restore Drill
```

不能只备份不恢复测试。

---

# 一百一十七、Phase 40：部署策略

永远：

```text
Build
↓
Local Tests
↓
Shadow
↓
Canary
↓
Production
```

第一阶段：

```text
V2 = 1%
```

第二阶段：

```text
10%
```

第三阶段：

```text
50%
```

最后：

```text
100%
```

---

# 一百一十八、自动回滚条件

任意出现：

```text
Provider Unknown ↑
Commit Conflict ↑
Empty Output ↑
Billing Failure ↑
State Drift ↑
Literary Regression ↑
```

超过基线阈值：

```text
自动关闭 Generation V2
```

恢复：

```text
旧生成链
```

---

# 一百一十九、最重要的“无副作用”规则

任何优化必须同时满足：

```text
目标指标改善
AND
无硬门禁回归
AND
GenreFit不显著下降
AND
StyleFit不显著下降
AND
Originality不显著下降
AND
稳定性不下降
AND
成本在预算
```

否则：

```text
REJECT
```

---

# 一百二十、真正施工顺序

不要按照“想到什么改什么”。

严格照这个顺序：

## Sprint 0

```text
Feature flag
Baseline
Golden dataset
Generation manifest
UI baseline
```

**不改生成质量。**

---

## Sprint 1

```text
Generation Run
Generation Stage
Idempotency
FSM
Recovery
Cancel
```

目标：

> **一条真实可靠的生成任务主链。**

---

## Sprint 2

```text
Genre Resolver
Genre Profile
Budget Profile
Audit Policy
```

目标：

> **不同题材不串味。**

---

## Sprint 3

```text
Style DNA
Style Bundle
Character Voice
Relationship Voice
```

目标：

> **不同文风明显不同。**

---

## Sprint 4

```text
Context Compiler
Hard State
Timeline
Ownership
Narrative Invariants
Causal Debt
Narrative Debt
```

目标：

> **长篇不乱。**

---

## Sprint 5

```text
Scene Contract
Scene Planner
Writer
```

目标：

> **一章不再是一团 Prompt。**

---

## Sprint 6

```text
Deterministic Audit
Evidence Audit
Local Rewrite
Meaning Preservation
Re-Audit
```

目标：

> **有问题只修问题区域。**

---

## Sprint 7

```text
Atomic Commit
Outline Sync
State Delta
Relationship Ledger
```

目标：

> **正文、状态、剧情、伏笔统一提交。**

---

## Sprint 8

```text
Quality Vector
Benchmark
Root Cause
Experiment
Shadow
Replay
```

目标：

> **开始真正自动优化。**

---

## Sprint 9

```text
IndexedDB WAL
Patch Save
Virtualization
Global Search
```

目标：

> **百万字可用。**

---

## Sprint 10

```text
UI tokens
UI state
Generation flow
Feature contracts
Playwright
```

目标：

> **界面显示的每个功能都真实履约。**

---

## Sprint 11

```text
10章
20章
50章
100章
```

跑长篇。

目标：

> **证明不是“第一章很好”，而是真的能够持续写。**

---

# 一百二十一、建议第一批实际修改的文件

按当前仓库：

```text
molan-home/
├── lib/
│   ├── generation/
│   │   ├── orchestrator.js        ← 新建
│   │   ├── state-machine.js       ← 新建
│   │   ├── run-context.js         ← 新建
│   │   ├── idempotency.js         ← 新建
│   │   ├── contract.js            ← 新建
│   │   ├── context.js             ← 新建
│   │   ├── writer.js              ← 新建
│   │   ├── revision.js            ← 新建
│   │   └── commit.js              ← 新建
│   │
│   ├── genre/
│   │   ├── resolver.js            ← 新建
│   │   ├── profile.js             ← 新建
│   │   └── compiler.js            ← 新建
│   │
│   └── style/
│       ├── style-dna.js           ← 新建
│       ├── character-voice.js     ← 新建
│       └── style-bundle.js        ← 新建
│
├── db/migrations/
│   └── 0039_luna_generation_runs.sql
│
├── server.js                      ← 第一阶段只加 facade/route
├── completion-editor.js           ← 改成 API client
├── completion-library.js          ← 加回归，不大改
├── app.js                         ← 移除写章重复入口
├── pages/editor.js                ← 收敛为 UI orchestration
│
├── pages/
│   └── tokens.css
│
├── data/
│   ├── evolution/
│   ├── feature-contracts.json
│   ├── genre-baselines/
│   └── style-dna/
│
└── test/
    ├── generation/
    ├── genre/
    ├── style/
    ├── regression/
    ├── e2e/
    └── longform/
```

---

# 一百二十二、第一批不能改的文件/能力

为了降低副作用，第一阶段：

**不要动：**

```text
PG ACL
PG billing functions
PG worker fencing
现有 token settlement
现有 project scope
现有 auth session
```

除非新的 Generation Run 只是“接入”。

这能最大限度保证已有 SaaS 基础设施不被新小说功能带崩。

---

# 一百二十三、第一阶段完成后的“硬验收”

新建一本：

```text
都市
职场
冷峻
第三人称
```

生成第 1 章。

检查：

```text
generation_run = 1
stage_runs > 0
billing = 1
audit = 1
manuscript revision = 1
state snapshot = 1
```

然后：

```text
双击生成
```

必须：

```text
generation_run = 1
```

而不是 2。

---

# 一百二十四、然后故意制造失败

## 角色已经死亡

正文：

```text
死者说话
```

应该：

```text
PRE_GENERATION_GUARD
→ blocker
→ 不调用 Writer
```

---

## 故意制造状态冲突

```text
baseRevision = 17
server = 18
```

结果：

```text
409
```

---

## 故意断网

```text
Provider 已调用
客户端断开
```

检查：

```text
generation = interrupted / provider_unknown
```

不能：

```text
自动再烧一次
```

---

# 一百二十五、第二阶段多题材验收

至少：

```text
玄幻
都市
悬疑
历史
言情
科幻
西幻
轻小说
```

每种：

```text
3 个任务
```

共：

```text
24 个任务
```

检查：

```text
GenreProfile
Budget
Pacing
Dialogue
Description
Audit
```

不能发生：

```text
都市出现修炼模板
悬疑被强行塞爽点
言情被强制动作化
历史套现代口语
```

---

# 一百二十六、第三阶段风格验收

至少：

```text
热血
冷峻
诙谐
克制
苍凉
轻快
史诗
日常
```

同一题材：

```text
不同 StyleBundle
```

生成同一个章节合同。

结果应该能在：

```text
句长
段长
对白
节奏
感官
修辞
情绪
人物声音
```

层面形成可检测差异。

不是：

```text
8篇只是换几个形容词
```

---

# 一百二十七、第四阶段质量验收

每个任务同时记录：

```text
QualityVector
BenchmarkDiff
DefectVector
RootCause
```

于是你可以得到：

```text
该章问题：
对白低

根因：
DialogueObjective 缺失

实验：
EXP-31

版本：
Planner 2.1

结果：
对白 +18%
人物声音 +9%
AIFlavor -3%
成本 +8%

结论：
ACCEPT
```

这才是真正意义上的：

> “AI 自己越写越好。”

---

# 一百二十八、最终 Definition of Done

项目只有在下面这一整条跑通以后，才算这一轮优化真正完成：

```text
创建小说
↓
设置题材
↓
设置文风
↓
导入/建立世界观
↓
建立人物
↓
建立大纲
↓
建立伏笔
↓
生成章节合同
↓
生成 Scene Contract
↓
预检
↓
正文
↓
事实抽取
↓
状态更新
↓
确定性审计
↓
语义审计
↓
Quality Profile
↓
必要时局部修订
↓
复审
↓
CAS Commit
↓
更新 Timeline
↓
更新 Relation
↓
更新 Causal Debt
↓
更新 Outline Impact
↓
Billing Settlement
↓
Generation Completed
```

然后再：

```text
刷新页面
↓
全部数据恢复
```

再：

```text
断网
↓
恢复
↓
继续
```

再：

```text
100章
↓
状态不崩
↓
人物不崩
↓
文风不崩
↓
伏笔不丢
↓
因果不丢
```

最后：

```text
Benchmark
↓
找到不足
↓
Root Cause
↓
Experiment
↓
Shadow
↓
Regression
↓
Accepted
↓
进入下一版系统
```

---

# 一百二十九、你这套 Molan 最终真正应该长成什么样

最终不是：

```text
Prompt 工厂
```

也不是：

```text
AI 聊天框
```

而是：

```text
               小说原本
                  │
                  ▼
          Benchmark Builder
                  │
         ┌────────┴────────┐
         ▼                 ▼
     Genre Baseline      Style DNA
         │                 │
         └────────┬────────┘
                  ▼
          Generation Engine
                  │
         ┌────────┴─────────┐
         ▼                  ▼
      Story State        Contracts
         │                  │
         └────────┬─────────┘
                  ▼
               Writer
                  │
                  ▼
           Deterministic Audit
                  │
                  ▼
            Semantic Audit
                  │
                  ▼
            Quality Vector
                  │
             ┌────┴────┐
             ▼         ▼
          Accept      Revise
             │         │
             │     Local Rewrite
             │         │
             │       Re-Audit
             │         │
             └────┬────┘
                  ▼
              Atomic Commit
                  │
                  ▼
            Benchmark Compare
                  │
                  ▼
             Root Cause
                  │
                  ▼
           Optimization Experiment
                  │
                  ▼
              Shadow / A-B
                  │
                  ▼
              Regression
                  │
          ┌───────┴────────┐
          ▼                ▼
       Reject            Accept
                           │
                           ▼
                     Knowledge Update
                           │
                           └────→ 下一轮
```

---

# 一百三十、最关键的 12 条原则，建议直接写进项目 `ARCHITECTURE.md`

```text
1. 正式正文生成只有一个入口。

2. 模型永远不能决定系统下一状态。

3. Story State 是唯一故事事实源。

4. Generation Run 是唯一生成任务事实源。

5. PostgreSQL 是云端权威状态源。

6. IndexedDB 负责浏览器写入缓冲，不负责最终真相。

7. Genre 与 Style 永远分离。

8. AI Flavor 是风险信号，不是文学质量。

9. Benchmark 相似度不等于小说质量。

10. 审计问题必须有可定位证据。

11. 局部问题默认局部修订，禁止无脑整章重写。

12. 没有 Regression 的优化不能进入生产。
```

---

## 最后，把你现在真正的施工优先级压缩成一句话

**第一刀：**

```text
Generation Run
+
FSM
+
Idempotency
+
Recovery
+
唯一入口
```

**第二刀：**

```text
Genre Resolver
+
Style Bundle
+
Chapter/Scene Contract
```

**第三刀：**

```text
Hard State
+
Timeline
+
Debt
+
Evidence Audit
+
Local Rewrite
+
Atomic Commit
```

**第四刀：**

```text
Quality Vector
+
Benchmark
+
Root Cause
+
Experiment
+
Shadow
+
Regression
```

**第五刀：**

```text
IndexedDB WAL
+
百万字虚拟化
+
UI 统一
+
Feature Contract
```

**第六刀才是：**

```text
100章长篇验收
→ 正式关闭旧写章链
```

这样做的好处是，你现在已经投入的大量代码、数据库、Skill、语料库和审计逻辑都不用推倒；真正发生的是**从“很多优秀零件”升级成“一条唯一、可重复、可验证、可回滚的工业级生产线”**。而这正是你上传方案最终指向的目标。 
