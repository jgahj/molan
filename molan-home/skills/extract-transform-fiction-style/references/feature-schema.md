# Fiction Style Feature Schema

Use these axes to prevent vague labels such as “高级”“自然”“有网感” from replacing actual instructions. Populate only supported fields.

## Evidence Model

Every trait should contain:

```json
{
  "feature_id": "thought.causal_explicitness",
  "rule": "紧迫场景中的思绪允许省略和跳跃，不完整展开初衷、触发点与结论。",
  "rule_type": "preference",
  "scope": ["urgent_scene", "close_pov"],
  "exceptions": ["因果信息会改变读者对行动可行性的判断"],
  "evidence_refs": ["E-001", "E-014"],
  "evidence_count": 2,
  "confidence": 0.91,
  "priority": 85,
  "status": "confirmed",
  "positive_example": "念头刚起，院外第三遍钟已经响了。",
  "counterexample": "他本想留下，因为担心妹妹，所以看到伤痕后又改变了决定。"
}
```

Allowed `rule_type` values: `hard_rule`, `preference`, `tendency`, `avoidance`, `open_choice`.

Allowed `status` values: `candidate`, `confirmed`, `hard_rule`, `conflicted`, `retired`, `unknown`.

Confidence guide:

- `0.95-1.00`: newest explicit mandatory correction or repeatedly reconfirmed hard rule;
- `0.80-0.94`: explicit preference or multiple accepted edits;
- `0.60-0.79`: repeated sample behavior without explicit confirmation;
- `0.40-0.59`: plausible inference from limited evidence;
- below `0.40`: retain as unknown or a question, not an active rule.

## Feature Axes

### 1. Viewpoint And Distance

- person and tense;
- focal character;
- narrative distance;
- viewpoint switching rules;
- access to other characters' thoughts;
- sensory and judgment filtering.

### 2. Information Filtering

- what the viewpoint character can know;
- evidence-to-conclusion limits;
- timing of explanations;
- treatment of withheld information;
- tolerance for narrator commentary.

### 3. Sentence Rhythm

- typical sentence length;
- short/medium/long sentence distribution;
- fragments and ellipses;
- parallelism tolerance;
- transition density;
- variation by action, dialogue, reflection, and description.

### 4. Paragraph Rhythm

- paragraph length distribution;
- single-line dialogue or impact beats;
- one-function-per-paragraph preference;
- alternation of action, speech, thought, explanation, and result;
- whitespace and chapter pacing.

### 5. Diction And Register

- modern, classical, colloquial, formal, lyrical, or technical balance;
- preferred verbs and concrete nouns;
- intensifier tolerance;
- idiom and metaphor use;
- genre terminology density;
- profanity, particles, honorifics, and address forms.

### 6. Dialogue And Character Voice

- dialogue ratio;
- speech length;
- interruptions, omissions, and overlap;
- character-specific particles, titles, syntax, and vocabulary;
- relation between speech and immediate goal;
- dialogue tag and gesture policy.

### 7. Thought Texture

- direct thought versus narrated judgment;
- complete reasoning versus flashes and omissions;
- causal explicitness;
- self-awareness and unreliability;
- emotional versus tactical thought;
- tolerance for explanatory internal monologue.

### 8. Exposition

- acceptable exposition density;
- phenomenon-first versus explanation-first order;
- distribution through action, memory, dialogue, or narrator summary;
- number of rules introduced in one beat;
- treatment of exceptions and background systems.

### 9. Object And Environment Description

- number of selected details;
- functional versus decorative detail;
- static inventory versus interaction-led description;
- spatial clarity;
- whether details affect choice, mood, evidence, or later action.

### 10. Emotion

- direct labels versus observable behavior;
- bodily signals;
- mixed emotions;
- restraint level;
- recovery speed after emotional shocks;
- relationship expression through practical acts.

### 11. Characterization

- traits shown through choice, speech rhythm, bias, habits, and cost;
- balance among ordinary vulnerability, aspirational principle, and dangerous obsession;
- consistency versus situational contradiction;
- how competence and flaws appear under pressure;
- whether narrator labels are allowed.

### 12. Conflict And Reversal

- scene goals and opposing incentives;
- pressure sources;
- power and status constraints;
- required setup for reversals;
- opponent intelligence and error model;
- cost of success;
- amount of reasoning disclosed to the reader.

### 13. Physical, Combat, And Power Mechanics

- action entry point and anatomical ownership;
- path, resistance, failure point, and consequence;
- consistency of injury, energy, range, timing, and environment;
- difference between observed effect and inferred mechanism;
- amount of technical explanation.

### 14. Foreshadowing And Evidence

- clue visibility;
- fair-play requirements;
- evidence preservation behavior;
- distinction among clue, hypothesis, confirmation, and proof;
- timing of callbacks and reveals.

### 15. Endings

- preferred hook type: immediate pressure, decision, discovery, cost, arrival, or unanswered action;
- tolerance for narrator forecasts;
- specificity of target and consequence;
- chapter-level versus scene-level closure.

### 16. Forbidden And Caution Patterns

For every forbidden pattern record:

- exact structural problem;
- why it harms this style;
- scope;
- exceptions;
- preferred replacement;
- positive and negative examples.

Avoid blacklisting common words without context. Most problems arise from function, frequency, or syntax rather than a word's mere presence.

## Separate Data Objects

Keep these objects independent:

```text
style_profile       transferable prose behavior
canon_constraints   project facts and terminology
craft_constraints   accepted general storytelling logic
task_constraints    local output requirements
evidence_ledger     traceable sources and revisions
evaluation_cases    tests and expected behavior
```

This separation allows the same style to be applied to a different novel without importing the original story world.

## Dissection Output Modules (server expectations)

The dissection pipeline (server.js `DISSECTION_PHASES`) emits these top-level camelCase modules. Populate them according to the stage schema; do not rename fields.

### emotion (情绪与爽点分析)

```json
{
  "emotionCurve": [
    { "position": "第3章", "intensity": 7, "type": "紧张", "evidenceRefs": ["E-001"] }
  ],
  "tensionPeaks": [
    { "peak": "第12章打脸", "setup": "被羞辱", "pressure": "连续压制", "turn": "反杀", "release": "读者满足", "lengthChars": 8000 }
  ],
  "coolPoints": [
    { "position": "第20章", "cause": "同伴牺牲", "duration": "2章", "recovery": "主角觉醒" }
  ],
  "sellingPointList": [
    { "position": "第12章", "type": "打脸", "description": "当众羞辱者被反杀", "setup": "三章铺垫压抑" }
  ],
  "sellingPointTypes": [
    { "type": "打脸", "count": 5, "examplePosition": "第12章" }
  ],
  "sellingPointDistribution": [
    { "position": "第1-3章", "count": 1 },
    { "position": "第4-6章", "count": 2 }
  ],
  "emotionClosure": { "status": "满足", "suggestion": "可在结尾增加余韵" }
}
```

- `emotionCurve[].intensity` is 1-10.
- `type` examples: 期待 / 紧张 / 满足 / 愤怒 / 悲伤 / 轻松 / 压抑.
- `sellingPointTypes[].type` examples: 打脸 / 逆袭 / 揭秘 / 实力升级 / 情感治愈 / 身份反转 / 获得宝物 / 金手指显威.
- `sellingPointList` is the 爽点明细（位置/类型/描述/铺垫方式）; `sellingPointDistribution` is the 爽点分布表（区间/数量）for density charts.

### storyStructure (结构划分 / 起承转合)

```json
{
  "storyStructure": [
    { "stage": "开端", "range": "第1-3章", "goal": "阶段目标", "keyEvents": ["事件1"] }
  ]
}
```

### antagonists / minorRoles (反派体系 / 次要功能角色)

```json
{
  "antagonists": [
    { "name": "反派名", "motivation": "深层动机", "hierarchy": "层级", "conflicts": [{ "position": "第5章", "escalation": "升级点" }], "cliched": "否，动机充分", "note": "说明" }
  ],
  "minorRoles": [
    { "category": "挑衅者", "name": "角色名", "function": "制造冲突", "frequency": "每2-3章", "typicalUse": "刺激主角出手" }
  ]
}
```

- `antagonists` 无反派时返回空数组；`minorRoles[].category` ∈ 炮灰 / 挑衅者 / 传话人 / 工具人.

### reversalPatterns (高频反转套路)

```json
{
  "reversalPatterns": [
    { "type": "身份反转", "setup": "铺垫方式", "payoff": "反转点", "example": "实例概述", "frequency": "约每10章一次" }
  ]
}
```

### genre / sellingPoints (题材与卖点)

```json
{
  "genre": { "primary": "男频", "secondary": "玄幻", "tags": ["系统"] },
  "sellingPoints": [
    { "point": "身份反差", "evidenceRefs": ["E-001"] }
  ]
}
```

- `genre.primary` ∈ 男频 / 女频 / 短篇 / 短剧.
- `genre.secondary` is the sub-genre; `tags` are innovation labels.

### sentenceFingerprint (句式指纹 / 量化文风)

```json
{
  "avgSentenceLen": 18,
  "shortLongRatio": "6:4",
  "dialogueRatio": 0.3,
  "descriptionRatio": 0.25,
  "actionRatio": 0.3,
  "psychologyRatio": 0.15,
  "highFreqPatterns": ["短句断行"]
}
```

### reusableTemplates (可复用模板)

```json
{
  "openingTemplate": [{ "step": 1, "function": "身份反差", "wordAdvice": "200字内" }],
  "sceneTemplate": "铺垫→冲突→推进→钩子",
  "conflictEscalationTemplate": "小冲突→实力对比→打脸→伏笔",
  "goldenFingerTemplate": { "exists": true, "entryTiming": "第1章末", "way": "意外获得", "initialLimit": "每日一次", "growthNodes": ["第10章"] },
  "avoidList": [{ "type": "节奏崩坏", "position": "第30章", "note": "连续三章无事件" }]
}
```

### conflictStats / logicFlaws (冲突统计 / 逻辑漏洞)

```json
{
  "conflictStats": {
    "types": [
      { "type": "实力冲突", "count": 12, "examplePosition": "第5章" }
    ],
    "total": 15
  },
  "logicFlaws": [
    { "issue": "战力前后矛盾", "position": "第8章", "suggestion": "统一设定", "confidence": 0.5 }
  ]
}
```

- `conflictStats.types[].type` ∈ 人际冲突 / 实力冲突 / 阴谋冲突 / 内心冲突.

### chapterIndex (章节目录)

Server-computed chapter directory. Returned as part of the result; do not emit it from a stage — it is filled automatically from the sampled chunks.
