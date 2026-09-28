# Cross-Platform Portability Specification

The portable package must preserve behavior without relying on one vendor's prompt syntax, tools, memory system, or hidden reasoning.

## Required Bundle

Create these UTF-8 files:

```text
STYLE_PROFILE.json
STYLE_GUIDE.md
PORTABLE_PROMPT.md
EVALUATION_CASES.md
```

Optional adapters may be added only after the neutral files exist:

```text
adapters/openai.md
adapters/anthropic.md
adapters/gemini.md
adapters/local-model.md
```

Adapters should only map neutral sections into platform fields. They must not change the canonical rules.

## STYLE_PROFILE.json

Validate against `assets/style-profile.schema.json` when possible. Use:

- ASCII keys;
- UTF-8 values;
- explicit arrays instead of comma-separated strings;
- numeric confidence and priority;
- stable evidence IDs;
- separate `style_profile` and `canon_constraints`;
- ISO 8601 timestamps;
- semantic profile versions when maintaining history.

Do not store hidden reasoning. `rationale` should be a concise, reviewable explanation.

## STYLE_GUIDE.md

Write for humans. Include:

1. Scope and intended use.
2. Style identity in plain language.
3. Hard rules.
4. Soft preferences.
5. Feature-axis guidance.
6. Forbidden patterns and replacements.
7. Positive examples and counterexamples.
8. Unknowns and exceptions.
9. Version and evidence summary.

An editor should be able to understand the style without reading JSON.

## PORTABLE_PROMPT.md

Base this file on `assets/portable-style-skill-template.md`. It must contain only model-neutral instructions and placeholders. Do not require:

- proprietary system-role syntax;
- function or tool calls;
- hidden chain-of-thought;
- persistent memory;
- a specific context-window size;
- vendor-specific temperature or sampling controls.

Request concise evidence and decisions, never private reasoning traces.

## EVALUATION_CASES.md

Include at least:

- one normal transformation case;
- one dialogue-heavy case;
- one exposition-heavy case;
- one urgent action or conflict case;
- one ambiguity case that should trigger a question or conservative preservation;
- one canon-separation case ensuring names and plot do not leak into unrelated output.

For each case provide:

```text
Case ID
Input purpose
Active parameters
Rules under test
Expected observable behaviors
Failure indicators
Optional reference output
```

Judge observable output, not exact wording. Different models need not produce identical sentences; they should make the same high-level choices.

## Deterministic Precedence

All implementations must resolve instruction conflicts in this order:

1. Newest explicit user correction.
2. Factual and canon preservation.
3. Hard style rules.
4. Current task constraints.
5. Confirmed soft preferences above threshold.
6. Model defaults.

When two rules at the same level conflict, prefer the narrower scope. If scope is equal, prefer higher confidence; then higher priority; then newer evidence. Ask the user if the choice materially changes the result and `uncertainty_policy` is `ask`.

## Parameter Contract

Every portable implementation should recognize:

| Parameter | Values | Meaning |
| --- | --- | --- |
| `mode` | identify, analyze, define, calibrate, apply, dissect, export | Requested operation |
| `interaction_depth` | quick, standard, deep | Discovery effort |
| `style_strength` | 0-100 | Intensity of confirmed prose traits |
| `preserve_plot` | boolean | Keep events and causal outcomes |
| `preserve_pov` | boolean | Keep source viewpoint |
| `preserve_terms` | boolean | Keep names and project terminology |
| `preserve_length` | strict, flexible, free | Length tolerance |
| `dialogue_density` | inherit, low, medium, high, or 0-100 | Dialogue target |
| `exposition_density` | inherit, low, medium, high, or 0-100 | Exposition target |
| `thought_explicitness` | inherit, low, medium, high, or 0-100 | Completeness of internal reasoning |
| `rhythm_variation` | inherit, low, medium, high, or 0-100 | Sentence and paragraph variation |
| `description_density` | inherit, low, medium, high, or 0-100 | Descriptive detail target |
| `de_ai_strength` | 0-100 | Aggressiveness against templated patterns |
| `evidence_threshold` | 0.00-1.00 | Minimum confidence for active soft rules |
| `uncertainty_policy` | ask, preserve, conservative | Behavior under ambiguity |
| `output_bundle` | markdown, json, prompt, full | Requested output form |

Platform adapters may translate values but must preserve their meaning.

## Compatibility Test

Run the same evaluation cases on each target model with the same profile and parameters. Compare:

- hard-rule violations;
- canon leakage;
- information preservation;
- viewpoint consistency;
- dialogue differentiation;
- causal and evidence integrity;
- forbidden-pattern frequency;
- human preference ratings.

If models diverge, clarify the neutral rule or add examples before adding vendor-specific workarounds.
