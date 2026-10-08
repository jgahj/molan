# Phase 2 引擎架构审查与改进建议

> 原始审查基线提交：`62c45667cd50c3ab37cd75ea64908da86f56ed45`  
> 当前项目阶段：架构基本成型，聚焦运行时闭环与硬断点收敛。

---

## 核心建议清单

### 1. P0：把 Attention 真正送进模型

现在链路是：

`StrategyIR → tierAttention() → attention`

但 `model-call-service.js` 最终构造 `messages` 时只用了：

```js
const messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: DYNAMIC_PROMPT_MARKER + '\n' + (o.userPrompt || '') },
  { role: 'user', content: o.jsonMode ? '请只返回一个合法 JSON 对象...' : '请直接输出内容，不要解释。' }
];
```

也就是说 `o.attention / o.tieredAttention` 根本没有进入真正的模型上下文。

这意味着现在所谓：

> Tier 1 永驻上下文  
> Tier 2 章节策略  
> Tier 3 证据卡  
> Tier 4 即时上下文

实际上有一部分只是**附带元数据**，模型未必看得到。

这是当前最该修的地方。

在 `molan-home/services/model-call-service.js` 增加：

```js
function renderAttentionContext(baseSystemPrompt, baseUserPrompt, attention = {}) {
  const tier1 = String(attention.tier1Permanent || '').trim();
  const tier2 = String(attention.tier2Strategy || '').trim();
  const tier3 = String(attention.tier3Evidence || '').trim();
  const tier4 = String(attention.tier4Immediate || '').trim();

  const systemParts = [];
  const userParts = [];

  if (tier1) {
    systemParts.push(`【P0·永驻事实与世界法则】
${tier1}`);
  }

  systemParts.push(String(baseSystemPrompt || '').trim());

  if (tier2 && !String(baseSystemPrompt || '').includes(tier2)) {
    systemParts.push(`【P1·本章策略】
${tier2}`);
  }

  if (tier3) {
    userParts.push(`【P2·实时证据】
${tier3}`);
  }

  userParts.push(String(baseUserPrompt || '').trim());

  if (tier4 && !String(baseUserPrompt || '').includes(tier4)) {
    userParts.push(`【P4·即时上下文】
${tier4}`);
  }

  return {
    systemPrompt: systemParts.filter(Boolean).join('\n\n'),
    userPrompt: userParts.filter(Boolean).join('\n\n')
  };
}
```

然后把：

```js
const messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: DYNAMIC_PROMPT_MARKER + '\n' + (o.userPrompt || '') },
  { role: 'user', content: o.jsonMode ? '请只返回一个合法 JSON 对象，不要任何解释或 Markdown 围栏。' : '请直接输出内容，不要解释。' }
];
```

改成：

```js
const attention = o.tieredAttention || o.attention || {};
const rendered = renderAttentionContext(
  systemPrompt,
  o.userPrompt || '',
  attention
);

const messages = [
  { role: 'system', content: rendered.systemPrompt },
  { role: 'user', content: DYNAMIC_PROMPT_MARKER + '\n' + rendered.userPrompt },
  {
    role: 'user',
    content: o.jsonMode
      ? '请只返回一个合法 JSON 对象，不要任何解释或 Markdown 围栏。'
      : '请直接输出内容，不要解释。'
  }
];
```

这样 Attention 才从“数据结构”变成“模型真正看到的内容”。

---

# 2. P0：修掉 `||` 导致的预算边界失真

`strategy-compiler.js` 目前：

```js
const maxTotalTokens =
  options.maxTotalTokens ||
  options.maxTokens ||
  params.maxTotalTokens ||
  params.maxTokens ||
  6000;
```

`content-engine.js` 也有相同模式。

这会导致：

```js
maxTotalTokens = 0
```

被当成“没传”，最后偷偷变成 `6000`。

直接统一为：

```js
const maxTotalTokens =
  options.maxTotalTokens ??
  options.maxTokens ??
  params.maxTotalTokens ??
  params.maxTokens ??
  6000;
```

`content-engine.js` 同样改：

```js
const maxTotalTokens =
  options.maxTotalTokens ??
  options.maxTokens ??
  req.maxTokens ??
  6000;
```

并顺便把下面所有类似：

```js
Number(x) || default
```

中涉及**合法 0 值**的地方全部检查一遍。

尤其是：

```text
maxTokens
maxTotalTokens
temperature
topP
seed
retryCount
timeout
budget
threshold
```

不是所有 `||` 都该改，但涉及数值边界的必须逐项审计。

---

# 3. P0：Attention 的裁剪顺序要改

现在 `attention-tiering.js` 的实际顺序是：

```text
A 删除 Tier3 evidence
B 压缩 Tier1
C 截断 Tier4 immediate
D 剪 Tier2
E 直接清空 Tier4
F 清空 Tier1
G 最后截 Tier2
```

这个逻辑最大的问题是：

**即时因果上下文 Tier4 不应该为了保住策略卡而优先被砍。**

小说生成里：

```text
世界法则
>
本章硬契约
>
当前状态 / 当前行动
>
即时承接
>
策略证据
>
远期背景
```

更合理的是：

```text
P0 绝对事实
P1 状态跃迁 + 本章目标
P2 即时因果上下文
P3 章节策略
P4 证据卡
P5 全局背景
```

所以建议把裁剪改成：

```text
1. Tier3 Evidence 卡
2. Tier1 非关键背景
3. Tier3 Evidence 再压缩
4. Tier4 只允许压缩，不允许在有业务上下文时直接归零
5. Tier2 非关键策略
6. Tier1 非关键内容归零
7. 最终才触发硬边界截断
```

另外增加一个：

```js
immediateContextFloorTokens
```

默认建议：

```js
const immediateContextFloorTokens = Math.min(
  256,
  Math.max(64, Math.floor(maxTotalTokens * 0.10))
);
```

规则：

```js
if (tier4Tokens > immediateContextFloorTokens) {
  // 允许压缩
}

if (tier4Tokens <= immediateContextFloorTokens) {
  // 禁止继续删除，除非 maxTotalTokens 本身不足以容纳 P0/P1
}
```

这样可以避免模型最后只剩：

> “本章要求强冲突、保持文风、制造钩子”

却不知道人物上一秒到底做了什么。

---

# 4. P0：Profile Registry 还有隐藏默认偏置

这个我在你最新代码里重新确认了。

`profile-registry.js` 仍存在：

```js
style = SEED_STYLES[0];
chapterGoal = SEED_GOALS[0];
focus = SEED_FOCUSES[0];
hook = SEED_HOOKS[0];
```

虽然代码会把模式标记成 `inferred`，但这还是有问题：

用户没选文风，不应该自动变成第一个文风。

用户没指定：

```text
style
goal
focus
hook
```

真实语义应该是：

```text
UNRESOLVED
```

然后交给上层：

```text
显式选择
或者
根据小说/章节事实推导
```

而不是：

```text
没有 → Seed[0]
```

建议改成：

```js
if (strict) {
  throw new ProfileResolutionError(...);
}

style = {
  id: null,
  resolved: false,
  mode: 'unresolved',
  reason: 'style_not_selected'
};

styleMode = 'unresolved';
```

其他：

```text
goal
focus
hook
```

全部同理。

这样才真正符合你的“题材 + 文风 + 章节目标 + 侧重点 + 钩子独立组合”设计。

---

# 5. P0：Hook Debt ID 必须变成幂等 ID

现在：

```js
debtId: `hook_debt_${Date.now()}_${profile.id}`,
```

这个设计对：

```text
重试
恢复
Replay
并发
断线重连
租约迁移
```

都不安全。

同一个章节同一个钩子可能产生多个债务。

改成确定性：

```js
const crypto = require('node:crypto');

function deterministicHookDebtId(profile, chapterContext = {}) {
  const raw = [
    chapterContext.projectId || chapterContext.novelId || '',
    chapterContext.chapterId || '',
    chapterContext.chapterNo || '',
    profile.id || '',
    chapterContext.sourceSnapshotHash || '',
    chapterContext.hookSeed || ''
  ].join('|');

  return `hook_debt_${crypto
    .createHash('sha256')
    .update(raw, 'utf8')
    .digest('hex')
    .slice(0, 24)}`;
}
```

然后：

```js
debtId: deterministicHookDebtId(profile, chapterContext),
```

这样：

```text
第一次生成
= 同一个 ID

重试
= 同一个 ID

恢复
= 同一个 ID

Replay
= 同一个 ID
```

这对你现在已经做好的 append-only `StoryDebtLedger` 非常重要。

---

# 6. P0：Experiment Engine 不要再把“出现某词”当质量真相

现在 `experiment-engine.js` 的主要评价仍是：

```js
causalHits
sensoryHits
tensionHits
AI_FLAVOR_CLICHE_PATTERNS
```

例如：

```js
/死战|杀机|危险|危机|变数/
```

出现得越多，张力分越高。

这是典型的：

> **指标可被模型投机。**

模型完全可以故意写：

> 杀机越来越浓，危险越来越近，危机一触即发。

结果指标变高，小说反而更 AI。

所以这些指标应该降级为：

```text
cheap pre-screen
```

不能作为真正的 Experiment Truth。

实验 Engine 应改成四层：

```text
L0 Deterministic
    字数 / 格式 / 硬事实 / 契约

L1 Structural
    状态是否真的改变
    冲突是否真的推进
    Hook 是否产生信息缺口
    伏笔是否新增/推进/回收

L2 Blind Judge
    A/B 双盲独立评价

L3 User Outcome
    阅读完成率
    修改率
    重生成率
    人工接受率
```

最终：

```text
最终实验收益 =
结构结果
+
盲评结果
+
实际用户结果
```

词频只能参与 L0/L1 的预筛。

---

# 7. P1：实验结果不能只存在 `Map`

目前：

```js
this.synergyRecords = new Map();
```

这个是临时缓存，不是学习系统。

进程重启后：

```text
全部消失
```

你的目标是：

```text
实验
→ StrategyCard
→ Compatibility Matrix
→ Evidence Package
→ Hot Reload
→ 下一次生成
```

所以建议增加：

```text
strategy_experiment_ledger
strategy_card_stats
strategy_synergy_stats
strategy_package_version
```

最低字段：

```text
experimentId
storyId
chapterId
tupleHash
strategyId
controlStrategyId

modelA
modelB

promptDigestA
promptDigestB
sourceSnapshotHash

causalDelta
literaryDelta
tensionDelta
aiFlavorDelta
judgeDelta
userOutcomeDelta

accepted
rejected

createdAt
packageVersion
```

特别要保存：

```text
sourceSnapshotHash
promptDigest
model
temperature
seed
profileVersions
knowledgePackageVersion
```

否则以后根本无法判断：

> 到底是策略变好了，还是模型变好了？

---

# 8. P1：把“Composition Planner”正式插进生成前

你现在已经有：

```text
Profile
→ StrategyIR
→ Lowering
→ Attention
→ Writer
```

但还缺一层非常关键的：

```text
Composition Planner
```

我建议正式变成：

```text
用户输入
 ↓
Composition Planner
 ↓
CompositionSpec
 ↓
StrategyIR
 ↓
IR Lowering
 ↓
Attention Compiler
 ↓
Rendered Prompt Package
 ↓
Provider
 ↓
Deterministic Audit
 ↓
Semantic Audit
 ↓
Quality Gate
 ↓
Experiment
 ↓
Knowledge Update
```

Planner 输出不要生成正文，只生成：

```json
{
  "genre": {},
  "style": {},
  "chapterGoal": {},
  "focus": {},
  "hook": {},

  "dominantBehavior": [],
  "supportingBehavior": [],

  "scenePlan": [],

  "stateBefore": {},
  "stateDelta": {},
  "readerExpectation": [],

  "forbiddenAssumptions": [],
  "evidenceCards": []
}
```

这一步会让你的“完全可控章节生成”真正成立。

---

# 9. P1：建立“5维组合”之外的兼容性学习

你现在理论上已经能够组合：

```text
题材 × 文风 × 章节目标 × 侧重点 × 钩子
```

但不要把重点放在：

> 我有多少种 Genre？

真正有价值的是：

```text
Genre + Style
Genre + Goal
Goal + Focus
Goal + Hook
Style + Focus
Style + Hook
```

再进一步：

```text
Genre + Style + Goal
Genre + Goal + Focus
Style + Goal + Hook
Genre + Goal + Focus + Hook
```

最终才是：

```text
5-Tuple Compatibility
```

举个实际例子。

同样是：

```text
玄幻
```

开篇：

```text
Goal = 破局
Focus = 冲突
Hook = 危机
```

和中段：

```text
Goal = 信息揭露
Focus = 对话
Hook = 悬疑
```

根本不是同一种写法。

所以你的真正知识库应该学习：

> **组合条件下，哪个写法有效。**

这才是你这个系统最有价值的壁垒。

---

# 10. 你现在最该冻结的版本架构

我建议从现在开始明确：

```text
LEGACY
旧 Prompt / 旧生成链
↓

COMPAT
仅兼容旧项目

CANONICAL
Composition Planner
↓
CompositionSpec
↓
StrategyIR
↓
Lowering
↓
Attention
↓
RenderedPromptPackage
↓
Provider
↓
Audit
↓
Experiment
↓
Knowledge
```

以后任何新增功能，都不能再直接往：

```text
content-engine.js
```

里面塞一套新的 Prompt 逻辑。

---

## 最终优先级

真正实施顺序，我建议锁死成：

```text
P0-1  Attention 真正进入 Provider messages
P0-2  修复所有预算 || 默认问题
P0-3  重排 Attention 裁剪顺序 + Immediate Floor
P0-4  消除 Profile Seed[0] 隐式偏置
P0-5  Hook Debt 改成确定性幂等 ID
P0-6  Experiment Engine 降级词频指标，增加结构真值
P0-7  实验结果持久化
```

然后：

```text
P1-1  Composition Planner
P1-2  RenderedPromptPackage 单一真实发送对象
P1-3  5维组合兼容性学习
P1-4  旧生成链生命周期治理
P1-5  服务器模块化
```

还有一个非常重要的判断：你最新提交已经专门准备了 **60 个 Phase 2 E2E 测试，但当前 `TEST_READY.md` 里仍是 16/60 通过、44 个等待里程碑实现**。所以现在最不应该做的是继续往上盖功能；应该先把这 44 个测试对应的运行时断点逐个消掉，再进入真正的质量进化阶段。

这次我尝试直接在 GitHub 建优化分支，但当前 GitHub 集成返回 `403 Resource not accessible by integration`，因此没有擅自修改你的远程仓库。当前建议已经针对最新代码精确到文件/函数级，可以直接落地。
