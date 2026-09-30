# 模型能力与上下文预算矩阵 (MODEL_CAPABILITY_MATRIX)

本矩阵由 `lib/model/model-registry.js` 统一管理，杜绝在各引擎散落编写 `if (model.includes('gpt'))` 导致配置分裂。

## 1. 纳管模型参数矩阵

| 模型标识 (modelId) | 显示名称 | 最大上下文 (Context Window) | 最大生成量 (Max Output) | 推理模型 (Reasoning) | 计费成本 (Credits/1k) | 支持特性 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `gpt-5.6-luna` | GPT-5.6 Luna (旗舰长篇) | 128,000 | 16,000 | 是 (支持推理控制) | 0.05 | JSON, Seed, Stream, Reasoning |
| `gpt-4o` | GPT-4o (通用生产) | 128,000 | 4,096 | 否 | 0.03 | JSON, Seed, Stream |
| `gpt-4o-mini` | GPT-4o Mini (快速质检) | 128,000 | 4,096 | 否 | 0.005 | JSON, Seed, Stream |
| `claude-3-5-sonnet` | Claude 3.5 Sonnet (高文学感) | 200,000 | 8,192 | 否 | 0.06 | JSON, Stream |
| `deepseek-chat` | DeepSeek V3 (高性价比) | 64,000 | 8,000 | 否 | 0.008 | JSON, Stream |
| `deepseek-reasoner`| DeepSeek R1 (深度因果链) | 64,000 | 8,000 | 是 | 0.015 | Stream, Reasoning |

## 2. 上下文预算规则 (`lib/generation/context-budget.js`)

1. **统一字符换算规范**：
   - 中文字符：按保守系数估算（中文字数 × 0.85），预留 15% 安全余量。
   - 非 CJK 字符：按英文词汇换算。
   - 所有接口禁止混用 `words` 与 `chars`，全量统一为 `targetChars`、`minChars`、`maxChars`。
2. **长文本保障**：
   - 彻底解除 `gpt-5.6-luna` 的 32k 历史截断限制，精准识别其 128k 上下文上限。
