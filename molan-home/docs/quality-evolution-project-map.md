# 小说质量闭环项目侦察报告

更新时间：2026-09-24

## 范围与结论

本报告限定于 `molan-home/`。没有递归读取受保护的小说原文目录，也没有执行生成小说与 Benchmark 的比较。当前 Git 工作区含大量既有修改和未跟踪文件，本报告只描述检查时可见的文件。

项目已有生成、拆书、Benchmark、质量画像、审计和实验资产。主要缺口不是再建一套平行目录，而是结果可信度与闭环接线：一部分历史评测代码把示例结论写死，缺少输入时仍能报 PASS；全量人工评读、外部比较结论和可复核的跨题材泛化结果尚未完成。

## 能力地图

| 模块 | 位置 | 输入 | 输出与复用结论 |
| --- | --- | --- | --- |
| 章节创作入口 | `pages/editor.js`、`completion-editor.js` | 用户需求、创作圣经、章节上下文 | 复用现有编辑器流程；包含章节规划、生成、审稿和提交接口 |
| 生成与审稿 | `lib/benchmark-pipeline.js`、`server.js` | 题材、章节合同、角色/实体状态、模型参数 | 生成草稿、证据审稿、最多两轮局部修订及待审状态；可复用 |
| 拆书入口 | `pages/dissect.js`、`server.js` | 导入小说、拆书任务参数 | 拆书任务、章节事实与创作上下文；可复用 |
| 参考库索引 | `scripts/build-industrial-benchmark-system.mjs`、`data/benchmark-database/`、`data/genre-baselines/` | 参考小说文件清单、已有特征和质量样本 | Benchmark 池、题材基线、质量差距与证据索引；库已有，但本轮未重扫原文 |
| Benchmark 查询/构建 | `lib/benchmark-database.js`、`scripts/build-comparable-benchmarks.mjs`、`scripts/build-genre-baselines-statistical.mjs` | 题材、子类、结构条件和质量画像 | 相似 Benchmark、质量分布和类别基线；可复用 |
| 参考小说画像 | `lib/novel-quality-profiler.js`、`lib/benchmark-metrics.js` | 章节文本、书目元数据 | 20 维 NovelQualityProfile、文本指纹和统计证据；可复用，部分语义维度依赖词典启发式 |
| 生成小说标准化 | `lib/generated-novel-preprocessor.js` | 生成稿、Prompt、创作计划、Story Bible、版本参数 | 多粒度 GeneratedNovelProfile 与版本溯源；本轮移除自动 Benchmark 比较，保留独立质量向量 |
| 缺陷检测 | `lib/defect-detector.js` | 带样本编号和来源版本的画像、生成记录 | 历史规则只接受显式样本编号及匹配画像；其他样本为 `NEEDS_MORE_DATA`，不再套用固定缺陷 |
| 根因分析 | `lib/root-cause-analyzer.js` | 带样本编号的缺陷报告、生成记录、Prompt、审计证据 | 历史 ID 映射只用于指定样本；未映射缺陷会阻断全局裁决和归因比例 |
| 优化与变更记录 | `data/evaluation-input/optimization-plans/`、`optimization-plan.json` | 根因、缺陷优先级、修改计划 | 优化任务和变更日志；文件资产已有，自动执行器没有形成受控的通用闭环 |
| 同条件实验 | `lib/experiment-controller.js`、`lib/experiment-evaluator.js`、`scripts/run-local-benchmark-session.mjs` | 冻结的需求、圣经、基准、模型和版本 | 本地控制器与外部结果校验器保持独立；外部 v2 结果必须通过有效性闸门，才可被自进化控制器采纳 |
| 回归集 | `lib/regression-testing-engine.js` | 逐例历史结论、当前结论、证据引用 | 10 类 RegressionReport；现已要求逐例提供证据，缺失时为 BLOCKED |
| 泛化审计 | `lib/generalization-detector.js` | 质量收益、相似度、多样性、原创性及回归证据 | 12 项趋同检查；现改为证据汇总器，缺少输入时为 NEEDS_MORE_DATA |
| 自进化控制器 | `lib/self-evolution-controller.js`、`scripts/run-self-evolution-cycle.mjs` | 缺陷、根因、优化、外部有效性、回归和泛化阶段产物 | 仅接受带证据的 `VALID_FOR_PAIRED_AB` v2 结果；不接入本地 Control/Treatment 裁决 |
| 整合报告 | `lib/assessment-report.js`、`scripts/build-assessment-report.mjs` | 显式提供的评测阶段报告包 | 输出 `molan-assessment-v1` 的 JSON 和 15 节 Markdown；缺项标记未知，不读取默认历史样本 |
| 质量向量 | `lib/quality-vectors.js` | 质量画像、DefectReport、RootCauseReport | 未评估维度保持 `null/unknown`；只有显式列入 `assessed_dimensions` 的空维度才可记为 0；已诊断但无强度时保留诊断状态并令数值未知 |
| 数据库 | `server.js`、`data/benchmark-database/`、`db/migrations/` | 小说、章节、创作圣经、审计、基准资产 | SQLite/PostgreSQL 应用数据表及 Benchmark SQLite/JSON 数据；闭环报告目前仍以文件 JSON 为主 |
| API 与评测 UI | `server.js`、`benchmark-review.html`、`benchmark-review.js` | 用户请求、Benchmark 过滤条件、待评结果 | `/api/benchmark/*` 提供基线、画像、生成、审稿及比较入口；本轮没有调用比较端点 |
| 反馈与纠错 | `correction-policy.js`、`lib/correction-library.js`、`pages/editor.js` | 用户纠错、候选规则、审核状态 | 纠错策略、规则库与回流接口；可复用 |

## 生成调用链

1. 用户在编辑器输入创作需求，前端读取当前书籍、章节上下文、Story Bible 与题材配置。
2. 编辑器通过 `/api/creation-books`、`/chapter-contract` 等接口保存创作状态并形成章节约束。
3. `completion-editor.js` 调用 `/api/benchmark/baseline` 取得题材提示，再调用 `/api/benchmark/generate`。
4. `server.js` 将请求交给 `lib/benchmark-pipeline.js`：生成草稿，执行确定性检查与证据审稿，必要时做有限局部修订；未通过时保留待审，不自动伪装为通过。
5. 正式章节经 `/api/creation-books/:id/:chapter/commit` 提交，并绑定正文哈希、审计凭证和因果债务状态。
6. 生成结果可由 `generated-novel-preprocessor.js` 形成标准画像。其质量画像与 Benchmark 比较现分离，比较结论留待外部评判。

## 当前评测与参考数据链

- 参考语料目录由项目资料指向 `../资源库/小说原本/`。`data/evaluation-input/2026-09-22/corpus-manifest.json` 记录 48 个题材目录、1276 个文件；字符数是字节估算，且该清单明确标注完整语料的章节数 `UNVERIFIED`。
- 已有 6 个基线池索引、样本画像、生成运行凭证、证据索引和确定性评测输入。文件清单与哈希可用于后续溯源。
- 小说原文章节切分已有脚本和局部样本资产；全量参考库的作者、榜单、收藏/推荐、发表时间与完结状态未在本次限定输入包中找到，标记 `NOT_FOUND`。
- 有手工盲评包与结果绑定协议；人工配对结果、评审一致性统计和全量真人审读凭证仍待提供。P0/P3/P4 历史验收记录明确记载了未完成项。
- 旧 `regression-report.*`、`generalization-report.*`、`self-evolution-report.*` 含固定样例结论，且旧 runner 会把它们落盘；本轮将 runner 改为显式输入、标准输出或独占新路径。旧报告未覆盖或重写，不作为新验收证据。

## 结构与数据库线索

- 小说和拆书表在 `server.js` 初始化，包括 `novels`、`dissection_chapters`、`dissection_chapter_facts`。
- 创作流程表包括 `creation_books`、`creation_bibles`、`creation_bible_versions`、`creation_state_snapshots`、`creation_chapter_audits`、`benchmark_commit_receipts` 等。
- Benchmark 构建脚本还定义 `benchmark_runs`、`benchmark_books`、`evaluation_results`、`quality_gaps`、`root_causes`、`optimization_tasks` 等 SQLite 表。
- 评测 API 已有 `/api/benchmark/database/summary`、`/comparable`、`/baseline`、`/profile/extract`、`/profile/compare`、`/defects/detect` 与盲评比较路由。比较路由在本轮只盘点，没有执行。

## 缺口与后续接线

1. 外部模型的生成稿 vs Benchmark 判断以及 Step 12 对照/实验组判断尚未提供；缺这两类输入时，缺陷、采纳和泛化结论应保持未评估。
2. DefectReport 与 RootCauseReport 当前含特定样例规则，后续需让检测条目逐条绑定输入证据与样本版本，再推广到任意题材。
3. P3 人工盲评目前能收集并绑定结果；配对偏好汇总、维度差异及评审一致性报告 `NOT_FOUND`。
4. 当前没有可靠证据证明系统已自动改写生成代码、按同条件重新生成、并将可复现的结果提交到统一长期账本。自进化 runner 现只接受一份完整输入包并汇总外部评测结果。
5. 质量画像包含确定性词典和启发式代理。语义因果、情绪、人物关系、原创性等维度仍需有证据的语义审阅，不能将规则命中率直接解释为文学质量。

## 本轮实现

- 在 `lib/quality-vectors.js` 增加 16 维 QualityVector、7 维 DefectVector 和 5 维 RootCauseVector。每个值保留来源/状态，未提供的评分不会被补成 0。
- 参考和生成画像、缺陷与根因报告现在携带相应向量；向量只保留证据定位信息，不复制原文。
- `generated-novel-preprocessor.js` 不再自动生成 Benchmark 比较报告。
- 回归、泛化、自进化脚本不再自动读取旧固定样例并覆盖根目录报告。缺证据分别报告 `BLOCKED` 或 `NEEDS_MORE_DATA`。
- 新增 `lib/evaluation-validity-gate.js`：按模式检查七项有效性材料和证据 ID 绑定；`experiment-evaluator.js` 升级到 v2，自进化只接受 `VALID_FOR_PAIRED_AB`。
- 新增整合报告构建器，生成规范 JSON、15 节 Markdown、优化/实验计划和证据索引；CLI 只读显式 `--input`，仅在显式 `--out-dir` 下用 `wx` 新建文件。
- 历史缺陷/根因规则要求显式样本编号；缺陷器还校验画像标题与生成版本。未覆盖缺陷会使根因报告进入 `NEEDS_MORE_DATA`，不生成全局比例或结论。
- 两个历史分析 CLI 默认只返回阻塞结果；只有指定历史样本才加载固定规则，只有指定输出目录才写报告，且使用 `wx` 防止覆盖。
- 本轮没有生成小说、运行小说比较、修改受保护原文、部署或覆盖已有评测报告。
