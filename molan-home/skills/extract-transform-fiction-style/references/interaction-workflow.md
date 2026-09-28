# Question-Led Interaction Workflow

Use this workflow only when discovery or calibration is needed. Do not delay a direct application request if the current evidence already supports the requested rewrite.

## 1. Intake

Accept any combination of:

- one or more fiction samples;
- original and user-edited versions;
- a correction library;
- explicit likes, dislikes, and forbidden expressions;
- general writing notes;
- an existing profile or writing prompt;
- target genre, audience, or platform constraints.

First state what evidence was received and what is missing. Do not ask for information already supplied. If there is only one short sample, label the initial result provisional.

## 2. Scope Question

Resolve whether the user wants:

- the style of this single passage;
- the stable style across several passages;
- the user's preferred style inferred from corrections;
- a target style for future writing;
- a transformation profile that maps source prose to target prose.

Also identify what must be excluded: project canon, genre conventions, deliberate one-scene effects, quotations, or another author's distinctive content.

## 3. Initial Extraction

Produce an initial profile with three buckets:

- `confirmed`: directly stated or repeatedly demonstrated;
- `provisional`: plausible but under-evidenced;
- `unknown`: important axes with no reliable evidence.

Select questions by impact, uncertainty, and disagreement:

`question_priority = output_impact × uncertainty × evidence_conflict`

Ask no more than three questions per round. Skip low-impact cosmetic uncertainty until major choices are resolved.

## 4. Question Forms

### Contrast question

Use when two behaviors both appear in samples:

> 冲突场景中，你更偏向“短句直接推进动作”，还是“保留少量判断句解释人物选择”？两者都在样文中出现，我需要确认哪一种是常态。

### Boundary question

Use when a rule may be too broad:

> 你反对的是所有“不是A，而是B”句式，还是只反对它承担空洞强调、工整说理时的用法？

### Priority question

Use when two desired traits compete:

> 当“信息清楚”和“保留悬念”冲突时，当前小说更优先哪一项？哪些信息必须立刻讲清？

### Counterexample question

Use when a claimed rule conflicts with accepted prose:

> 你删过完整心理推导，但保留了这一处因果解释。这里被保留，是因为它影响角色行动，还是因为节奏较慢时可以解释得更完整？

## 5. A/B Micro-Rewrite

Use A/B tests when abstract labels fail to distinguish preferences.

Requirements:

- Keep plot facts, viewpoint, length, and information content as equal as possible.
- Change only one or two named axes.
- Keep each Chinese version around 100-250 characters unless the user requests otherwise.
- Label the changed axes without declaring one version better.
- Ask what specific phrase or effect caused the preference.

Example test axes:

- explicit versus fragmentary internal thought;
- dialogue-led versus narration-led exposition;
- sparse versus concrete body mechanics;
- restrained versus heightened emotional delivery;
- compressed versus varied sentence rhythm.

## 6. Update After Every Answer

Return a compact update:

```text
已确认：紧急场景先处理时限目标，次要解释延后。
适用范围：追赶、逃亡、抢救、限时考核等场景。
例外：次要信息会立刻改变行动选择时，可先说明一句。
置信度：0.92（明确纠错 + 2处改稿）
```

Then either ask the next high-impact question or proceed to a test application.

## 7. Freeze Criteria

Freeze a profile version when:

- all high-impact axes are confirmed or explicitly left flexible;
- contradictions have a precedence or scope rule;
- hard rules have positive replacement instructions;
- representative examples exist for subtle rules;
- one normal case and one stress case produce acceptable output, when testing is possible.

Do not treat freezing as permanent. Future corrections create a new version and retain the old version in history.

## 8. Recommended Depth

- `quick`: one extraction pass, zero or one question round, no mandatory A/B test.
- `standard`: initial extraction, up to three question rounds, one test rewrite.
- `deep`: full ledger, repeated A/B calibration, normal and stress tests, portable export.

The user may stop questioning at any time. Continue with conservative defaults and mark unresolved fields.
