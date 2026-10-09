# Project: 资源库小说全库章节提示词提取与四象限对照实验系统

## Architecture
本系统构建全库 1279 部小说单章随机采样、双模提示词提取（极简/完整）、四象限对照实验数据集矩阵归档、批处理生成调度与 5 维客观质量比对系统。

```
资源库/小说原本/ (1279 本只读 TXT)
      │
      ▼
[CorpusChapterSampler] (M1) ──► 1279 本图书 100% 覆盖采样 (Mulberry32 PRNG + 复合正则分章 + 容错保底)
      │
      ▼
[DualPromptExtractor]  (M2) ──► 双模提示词智能提炼:
      │                           ├─ 极简提示词 (150~300 字: 核心起承转合 + 题材文风)
      │                           └─ 完整提示词 (全规格: 角色动机 + 冲突分镜 + 因果债务 + 墨阑5D + 4级注意力)
      ▼
[QuadrantMatrixArchiver] (M3) ──► 4 象限对照实验数据集落盘与归档:
      │                           ├─ data/corpus-prompt-experiments/<genre>/<bookId>.json & .md
      │                           ├─ manifest.json (带 AWAITING_HUMAN_CONFIRMATION 状态门禁)
      │                           ├─ index.jsonl (1279 行轻量索引流)
      │                           └─ REVIEW_CATALOG.md & QUALITY_SPOTCHECK_REPORT.md
      ▼
[CorpusBatchRunner & Evaluator] (M4) ──► 批处理生成调度器与五维质量评估套件:
                                          ├─ 调度执行: Q1/Q2 (墨阑链路) vs Q3/Q4 (大模型直出)
                                          ├─ 机制保证: 并发池、断点续传 Journal、指数退避、Dry-run/Mock/Real
                                          ├─ 5 维度量: 篇幅遵从度、文风指纹拟合度、冲突密度、AI味惩罚、原著相似度
                                          └─ 差量评估: 成对差量提升度矩阵与报告
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | 1279 本全库遍历与路径解析 | 遍历 48 个题材目录 (1276 本) + 根目录 (3 本)，映射 49 个题材桶，100% 零遗漏 | M1 | Survey (Explorer 1, 3) |
| F2 | 确定性 Mulberry32 随机抽样 | 基于 masterSeed + 相对路径哈希隔离，可重现抽取有效章节 | M1 | Survey (Explorer 1) |
| F3 | 复合分章引擎与噪音过滤 | 支持汉字、数字前缀、括号等多元章节头，过滤感言/通知/目录等杂质，门禁 >= 1000 字符 | M1 | Survey (Explorer 1) |
| F4 | 渐进式保底抽样策略 | 针对全书短章/未切分流水文本实施 Graceful Fallback，达成 1279/1279 (100%) 成功率 | M1 | Survey (Explorer 1) |
| F5 | 采样元数据标准模式 | 输出包含 sampleId, bookTitle, author, category, chapterNo, originalText 等的规范记录 | M1 | Survey (Explorer 1, 2) |
| F6 | 极简提示词提取引擎 | 严格输出 150~300 字，含核心起承转合情节 (120~240字) + 题材文风标签 | M2 | Survey (Explorer 2) |
| F7 | 完整提示词提取引擎 | 包含角色人设与动机、3段冲突分镜、因果债务与末尾钩子、墨阑 5D 参数配置 | M2 | Survey (Explorer 2) |
| F8 | 注意力 4 层分级装配预览 | 将完整提示词映射至 Tier 1 (永驻)、Tier 2 (策略)、Tier 3 (证据卡)、Tier 4 (即时因果) | M2 | Survey (Explorer 2) |
| F9 | 双模提示词混合提取管线 | 本地启发式前筛 (<1ms, 0 Token) + LLM 结构化提取 + 确定性回退兜底，支持 Dry-run | M2 | Survey (Explorer 2) |
| F10 | 分类分桶结构化持久化 | 在 `data/corpus-prompt-experiments/<genre>/` 存储 JSON (机器可读) 与 Markdown (人工审阅) | M3 | Survey (Explorer 2, 3) |
| F11 | 四象限对照实验任务装配 | 规范配置 Q1 (墨阑+极简)、Q2 (墨阑+完整)、Q3 (直出+极简)、Q4 (直出+完整) 任务契约 | M3 | Survey (Explorer 3) |
| F12 | 全局清单与流式索引生成 | 产出 manifest.json、index.jsonl、REVIEW_CATALOG.md 与 QUALITY_SPOTCHECK_REPORT.md | M3 | Survey (Explorer 3) |
| F13 | 第一阶段人工确认硬门禁 | manifest 标记 AWAITING_HUMAN_CONFIRMATION，未获显式 --confirm-phase1-approved 禁止正文生成 | M3, M4 | Survey (Explorer 3) |
| F14 | 批处理生成调度器 | 具备并发池控制 (concurrency)、断点续传 (quadrant-journal.jsonl)、指数退避 Jitter | M4 | Survey (Explorer 3) |
| F15 | 多运行模式支持 | 支持 --dry-run (纯装配与预算断言)、--mock (虚构作家 0 Token 跑通全链路)、--real (生产接入) | M4 | Survey (Explorer 3) |
| F16 | 五维客观质量比对引擎 | 篇幅遵从度、9维文风拟合度、因果冲突推进密度、AI味惩罚、原著 8-gram 相似度 | M4 | Survey (Explorer 3) |
| F17 | 成对差量提升度矩阵与报告 | 自动计算 Q1-Q3、Q2-Q4、Q2-Q1、Q4-Q3 差量向量，输出 EVALUATION_REPORT.md | M4 | Survey (Explorer 3) |
| F18 | 全量 E2E 自动化测试闭环 | 覆盖 Tiers 1-4 全部测试用例，100% 真实通过，系统原有基线零回归 | Final | Survey (All) |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | 语料单章采样与结构化解析器 | 实现 `corpus-chapter-sampler.js`，支持 1279 本书复合分章、种子抽样、保底策略与元数据构建 | none | PLANNED |
| M2 | 双模提示词智能提取管线 | 实现 `dual-prompt-extractor.js`，提供极简提示词 (150-300字) 与完整提示词 (5D+注意力) 提取 | M1 | PLANNED |
| M3 | 四象限实验矩阵归档与分步门禁 | 实现 `quadrant-matrix-archiver.js`，全库生成 1279 份数据集，落盘 manifest、index、报告并建立硬门禁 | M1, M2 | PLANNED |
| M4 | 批处理调度器与质量比对套件 | 实现 `corpus-batch-runner.js` 与 `corpus-quality-evaluator.js`，支持断点续传、三模运行与 5 维度量 | M2, M3 | PLANNED |
| Final | E2E 测试验收与交付闭环 | 运行并通过 E2E 测试套件，更新 HANDOVER.md，确保 Node 22 下 100% 绿色交付 | M1, M2, M3, M4, E2E | PLANNED |

## Interface Contracts

### 1. `CorpusChapterSampler` ↔ `DualPromptExtractor`
- **输入**: `CorpusChapterSampler.sampleBook(bookPath, options)`
- **输出**: `SampledChapterRecord`:
  ```typescript
  {
    sampleId: string;
    bookId: string;
    bookTitle: string;
    bookAuthor: string | null;
    category: string;
    sourceFilePath: string;
    chapterIndex: number;
    chapterTitle: string;
    charCount: number;
    rawTextLength: number;
    originalText: string;
    sampleSeed: number;
  }
  ```

### 2. `DualPromptExtractor` ↔ `QuadrantMatrixArchiver`
- **输入**: `DualPromptExtractor.extractDualPrompts(sampleRecord, options)`
- **输出**: `ChapterDualPromptEntity`:
  ```typescript
  {
    sampleMetadata: SampledChapterRecord;
    prompts: {
      minimal: {
        plotSummary: string;
        genreTag: string;
        styleTone: string;
        assembledPrompt: string; // 150~300 字
        charCount: number;
      };
      comprehensive: {
        characters: object;
        conflictBeats: object;
        storyDebts: object;
        hook: object;
        molan5D: object;
        attentionTieringGuidance: object;
        assembledFullPromptText: string;
      };
    };
    heuristicFeatures: object;
    provenance: object;
  }
  ```

### 3. `QuadrantMatrixArchiver` ↔ `CorpusBatchRunner`
- **输入**: `data/corpus-prompt-experiments/` 数据集与 `manifest.json`
- **门禁守卫**: `manifest.phaseStatus === 'APPROVED'` 或 CLI 提供 `--confirm-phase1-approved`，否则拦截正文生成。
- **任务契约**: 单书 4 象限任务 (`Q1`, `Q2`, `Q3`, `Q4`)，入参为同源 `minimal` 或 `comprehensive` 提示词。

### 4. `CorpusBatchRunner` ↔ `CorpusQualityEvaluator`
- **输入**: 生成的正文结果 (`generationOutput`) 与采样原著章节 (`originalText`)
- **输出**: `EvaluationResult`:
  ```typescript
  {
    wordCountCompliance: number; // 0 ~ 100%
    styleFitScore: number;        // 0 ~ 100
    conflictForceDensity: number; // 0.0 ~ 1.0
    aiPenaltyScore: number;       // 0 ~ 100
    novelSimilarity8Gram: number; // 0.0 ~ 1.0
  }
  ```

## Code Layout
- `molan-home/lib/composition/corpus/corpus-chapter-sampler.js`: 1279 本图书遍历、复合分章、Mulberry32 随机抽样
- `molan-home/lib/composition/corpus/dual-prompt-extractor.js`: 极简 (150-300字) 与完整 (5D + 注意力) 提示词提炼
- `molan-home/lib/composition/corpus/quadrant-matrix-archiver.js`: 4 象限任务装配、按题材分桶落盘、manifest 与抽检报告
- `molan-home/lib/composition/corpus/corpus-batch-runner.js`: 批处理调度器、并发池、断点 Journal、指数退避、门禁守卫
- `molan-home/lib/composition/corpus/corpus-quality-evaluator.js`: 5 维质量度量与成对差量提升分析
- `molan-home/scripts/run-corpus-prompt-pipeline.mjs`: CLI 执行入口 (支持 extract, generate, evaluate, spotcheck)
- `molan-home/test/corpus-prompt-experiments.test.js`: 单元与集成测试套件
- `molan-home/test/e2e-corpus-prompt-quadrant.test.js`: 4 象限端到端完整链路验证测试
