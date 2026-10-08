# 墨阑项目工程交接文档 (HANDOVER.md)

> 本文档用于跨会话、跨代理（GPT / AGY 及 Subagents）协作时记录系统演进基线、架构决策、验证事实与后续待办。  
> 遵循 `AGENTS.md` 规则，后续任何功能新增、架构重构或缺陷修复，必须在此文档同步追加/更新记录。

---

## 零、项目核心架构与文件骨架速查索引 (Curated Project Map)

> **新会话/切换窗口必读**：本索引用于快速定位核心模块职责，避免大范围扫描文件浪费 Token。

```text
molan-home/
├── lib/
│   ├── composition/                    # 创作策略体系 (V3 / Phase 2 核心)
│   │   ├── compiler/                   # 策略编译与注意力裁剪
│   │   │   ├── strategy-compiler.js    # 策略总编译器 (Spec -> StrategyIR -> Lowering -> Tiering)
│   │   │   └── attention-tiering.js    # 4级注意力分级裁剪 (保底水位线, P0事实保护)
│   │   ├── corpus/                     # 语料挖掘、证据卡与知识包发布
│   │   │   ├── archetype-discoverer.js # 原型发现与频次/模式挖掘
│   │   │   ├── evidence-catalog.js     # 策略卡证据目录 (带热重载检测)
│   │   │   ├── package-publisher.js    # 知识包发布器 (校验和保护与相对路径解析)
│   │   │   └── strategy-miner.js       # 离线批量语料特征提取
│   │   ├── debt/                       # 因果债务状态机与不可变账本
│   │   │   ├── story-debt-ledger.js    # 纯追加事件账本 (Append-only JSONL)
│   │   │   ├── debt-reconciliation.js  # 状态跃迁与伏笔回收真实对账 (反投机真值)
│   │   │   └── debt-types.js           # 债务类型与聚合器
│   │   ├── evaluation/                 # 实验协同与质量评测
│   │   │   └── experiment-engine.js    # 5维元组协同提升度记录 (JSONL 追加写与恢复)
│   │   ├── ir/                         # 创作策略中间表示 (StrategyIR)
│   │   │   ├── strategy-ir.js          # IR 结构规范与版本 Provenance 绑定
│   │   │   └── ir-lowering.js          # 多模型专属降级渲染 (Claude XML / GPT Markdown / DeepSeek)
│   │   └── profiles/                   # 5 维创作维度配置与兼容性
│   │       ├── profile-registry.js     # 维度注册中心 (Genre/Style/Goal/Focus/Hook)
│   │       ├── hook-profile.js         # 钩子规范与确定性 Debt ID 生成 (SHA-256)
│   │       └── compatibility-matrix.js # 5 维协同矩阵与局部文风调制
│   ├── generation/                     # 正文生成引擎
│   │   ├── content-engine.js           # 草稿请求装配 (buildDraftRequest 幂等去重入模)、生成调度
│   │   └── context-budget.js           # 供应商上下文窗口预算断言 (assertContextBudget)
│   └── scene-planner.js                # 细纲场景规划与冲突推进
├── services/                           # 业务服务层
│   ├── model-call-service.js           # 全站通用模型调用客户端 (内部 HTTP 路由与流解析)
│   ├── creation-chapter-service.js     # 章节生成编排入口
│   └── creation-plan-service.js        # 创作计划与大纲服务
└── test/                               # 核心自动化测试集 (Node 22 运行)
    ├── e2e-phase2-engine.test.js       # Phase 2 引擎 4 梯队 60 项 E2E 验收用例
    ├── adversarial-attention-tiering.test.js # 注意力裁剪对抗性极限压力测试 (35 项)
    └── phase2-engine-enhancements.test.js    # 边界 ??、确定性 Debt ID、单一真相等 26 项回归测试
```

---

## 阶段记录：Phase 2 引擎确定性加固与运行时闭环收敛 (2026-10-08)


### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 |
| :--- | :---: | :--- |
| `molan-home/lib/composition/compiler/strategy-compiler.js` | 缺陷修复 | 统一将 `maxTotalTokens`、`targetChars` 等数值默认回退从 `\|\|` 替换为 `??`，避免合法数值 `0` 被短路重置。 |
| `molan-home/lib/composition/profiles/hook-profile.js` | 架构加固 | 新增 `generateHookDebtId`，拔除 `Date.now()`，改为基于 `(projectId, chapterId, chapterNo, profileId, hookSeed)` 生成 SHA-256 确定性哈希切片；修复 `chapterNo: 0`（序章）被短路为 1 的问题。 |
| `molan-home/lib/composition/compiler/attention-tiering.js` | 算法重排 | 引入 `immediateContextFloorTokens`（保底 64~256 tokens）；重排紧缩阶段：超额时**优先压制 Tier 1（世界观法则），保护 Tier 4（即时前情与现场行动）不归零**，防止大模型发生“因果失忆”。 |
| `molan-home/lib/generation/content-engine.js` | 闭环连通 | 在 `buildDraftRequest` 组装层安全打通 `attention`（Tier 1/3）入模；实现针对 `ir-lowering.js` 已生成策略卡的**细粒度幂等去重（`rule`/`name` 签名比对）**，杜绝提示词双重重复膨胀；确保完整 Prompt 接受 `assertContextBudget` 预检与 `promptHash` 审计。 |
| `molan-home/lib/composition/evaluation/experiment-engine.js` | 存储持久化 | 增加 `persistencePath` 磁盘日志配置，实现追加写 JSONL（`appendSynergyRecord`）、启动容错恢复（`loadSynergyRecords`）与快照刷盘（`flushSynergyRecords`）；`getSynergyLift` 增强支持 5 维元组对象直接查询。 |
| `molan-home/test/phase2-engine-enhancements.test.js` | 自动化测试 | 新增 16 项针对数值 0、确定性 Debt ID、即时 Floor 保底、防膨胀去重及 JSONL 恢复的回归测试。 |

---

### 二、设计决策与权衡 (Decisions & Trade-offs)

1. **采纳项的决策原由**：
   - **`??` 边界保护 (P0-2)**：`options.maxTotalTokens = 0` 原先会被短路为 `6000`，使底层 `FINAL_BUDGET_ASSERT` 抛错防线被穿透，属于高危静默失效，必须改用空值合并。
   - **确定性 Hook Debt ID (P0-5)**：`StoryDebtLedger` 是纯追加不可变账本。使用 `Date.now()` 会导致重试、网络抖动、重放时重复注册大量幽灵债务，确定性哈希是实现事件溯源幂等的前提。
   - **Attention 组装位置选择 (P0-1)**：
     - *驳回方案*：原提案建议在底层通用客户端 `services/model-call-service.js` 强制追加拼接。该方案已被推翻，因其不仅造成全站分层污染，还会导致上层 `assertContextBudget` 预检与 Manifest `promptHash` 审计完全失真，且会与多模型下沉渲染出的《创作圣经》及证据卡产生双重全文本重复。
     - *采纳方案*：在领域层 `content-engine.js:buildDraftRequest` 完成幂等去重合并后再触发预算断言与签名。
   - **即时保底水位线 (P0-3)**：小说创作中“上一刻发生了什么”具有最高因果优先级。在极低预算下，牺牲远期世界观也绝不能清空即时因果。

2. **暂缓与驳回项的考量**：
   - **暂缓 Composition Planner (P1-8)**：当前已具备 `scene-planner.js` 与 `creation-plan-service.js`。在生成前再生硬插入额外一轮 LLM Planning 会引入 15~30s 延迟与额外单点故障，属于过度设计。
   - **暂缓 5 维高阶边际兼容性张量 (P1-9)**：当前尚未持久化沉淀充足的真实生成与接受度样本，推演高阶张量属于数学空转；现有通配符键已足敷使用。
   - **驳回 Profile Registry 粗暴返回 UNRESOLVED 裸对象 (P0-4)**：下游编译器和渲染器强依赖完整 Profile 结构（如 `spec.style.name`）；粗暴改为未解析对象会使数十个已有单元测试直接因 `TypeError` 崩溃。维持现有 `strict: true` 报错机制，非严格模式下走题材推导与中性默认值。

---

### 三、验证证据与测试数据

- **测试运行时**：`tools/node22_runtime/node.exe` (Node.js v22)
- **执行命令与结果**：
  1. 专项增强套件：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/phase2-engine-enhancements.test.js
     # 16 tests, 16 passed, 0 failed (duration: ~60ms)
     ```
  2. Phase 2 E2E 与对抗性剪裁核心测试：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/e2e-phase2-engine.test.js test/adversarial-attention-tiering.test.js
     # 95 tests, 95 passed, 0 failed (duration: ~1150ms)
     ```
  3. 全局关联与回归套件：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/composition-profiles.test.js test/composition-debt-ledger.test.js test/orchestrator-brain-consolidation.test.js test/milestone-4-strategy-provenance-lowering.test.js test/strategy-compiler.test.js test/content-engine.test.js test/context-plan-replay-p4.test.js test/replay-manifest.test.js
     # 87 tests, 87 passed, 0 failed (duration: ~1220ms)
     ```
  - **总计通过自动化测试用例**：**198 / 198 passed (100% 通过，0 失败)**。

---

### 四、已知限制与后续待办 (Known Limits & Backlog)

1. **已知限制**：
   - `ExperimentEngine` 的 JSONL 持久化采用单机同步追加写（`fs.appendFileSync`），适用于当前单节点架构；未来若扩展为多实例或多进程并发写入同一日志，需引入文件排他锁机制。
   - 当调用方传入极端极小 Token 预算（如 `< 10`）时，为满足不可逾越的底层 `FINAL_BUDGET_ASSERT` 硬断言，Tier 4 仍会被迫截断至空。
2. **后续建议待办**：
   - **接入真实数据反馈闭环**：当正文生成完成并触发用户审核/接受事件时，调用 `experimentEngine.recordCompatibilitySynergy` 将实际提升度追加沉淀到磁盘日志；
   - **Prompt 渲染器标签正交化微调**：进一步理顺 `ir-lowering.js` 特定模型渲染器（Claude XML / GPT Markdown）与 `tierAttention` 策略卡的分工边界。

---

## 阶段记录：Phase 2 提案完整归档与架构演进加固 (2026-10-08)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 |
| :--- | :---: | :--- |
| `molan-home/PHASE2_ARCHITECTURE_PROPOSAL.md` | 文档归档 | 完整生成并归档用户提出的 10 项 Phase 2 引擎架构审查建议原始提案。 |
| `molan-home/lib/composition/profiles/profile-registry.js` | 契约加固 (P0-4) | `resolveCompositionSpec` 支持 `allowUnresolved: true` 返回安全结构化未解析对象（带 `reason: 'style_not_selected'` 等）；非严格模式下保持合法默认属性对象，杜绝下游编译器发生 `TypeError` 崩溃。 |
| `molan-home/lib/composition/evaluation/experiment-engine.js` | 评测升级 (P0-6) | `evaluateCandidate` 将正则词频降级为 `l0Prescreen`；新增接收 `debtReconciliation` / `stateDelta` 提取 `l1Structural` 结构真值，并对关键词堆砌且无状态位移的样本实施投机张力折扣。 |
| `molan-home/lib/generation/content-engine.js` | 接口规范 (P1-2) | `buildDraftRequest` 正式输出符合规范的 `renderedPromptPackage` 结构体，统一系统与用户提示词、注意力与预算装配。 |
| `molan-home/test/phase2-engine-enhancements.test.js` | 自动化测试 | 新增 5 项针对 `allowUnresolved` 契约、`inferred` 兜底、L1 结构对账及 `renderedPromptPackage` 的端到端测试。 |

### 二、技术决策与权衡（负面影响分析）

1. **为什么不能粗暴改 Profile Registry 默认返回 UNRESOLVED 裸对象 (P0-4 负面影响)**：
   - 下游 `strategy-compiler` 与 `ir-lowering` 强依赖完整 Profile 对象（如 `spec.style.name`、`spec.style.stableDna`）。
   - 若在非 strict 模式下直接把缺省维度改为 `{ resolved: false, mode: 'unresolved' }` 裸对象，会导致已有数十个单测与生产调用读取 `undefined` 字段直接报 `TypeError` 崩溃。
   - **本次解决方案**：显式传入 `allowUnresolved: true` 时返回结构完备的未解析对象；默认非 strict 时保持安全推导兜底，strict 模式严格抛出 `ProfileResolutionError`。
2. **为什么在线生成不能引入 L2 双盲在线裁判 (P0-6 负面影响)**：
   - 每次生成章节若再阻塞调用双盲 LLM 评测，会额外增加 20~40 秒的大模型网络耗时，大幅增加网络中断与超时故障率。
   - **本次解决方案**：接入系统既有的 `debt-reconciliation.js` 真实状态位移检查作为 L1 结构真值，将词频降为 L0 前筛，零网络延迟防范投机套利。
3. **为什么坚决暂缓前置 Composition Planner (P1-8 负面影响)**：
   - 系统已有 `scene-planner.js` 与 `creation-plan-service.js`。在生成前再生硬堆一层 Planning LLM 属于过度工程化，首字延迟增加 15~30s 且增加断点。

### 三、验证证据与测试数据

- **测试运行时**：`tools/node22_runtime/node.exe` (Node.js v22)
- **执行命令与结果**：
  1. 增强回归套件（21 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/phase2-engine-enhancements.test.js
     # 21 tests, 21 passed, 0 failed (duration: ~50ms)
     ```
  2. Phase 2 E2E 与对抗性剪裁核心测试（95 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/e2e-phase2-engine.test.js test/adversarial-attention-tiering.test.js
     # 95 tests, 95 passed, 0 failed (duration: ~950ms)
     ```
  3. 全局关联单测套件（87 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/composition-profiles.test.js test/composition-debt-ledger.test.js test/orchestrator-brain-consolidation.test.js test/milestone-4-strategy-provenance-lowering.test.js test/strategy-compiler.test.js test/content-engine.test.js test/context-plan-replay-p4.test.js test/replay-manifest.test.js
     # 87 tests, 87 passed, 0 failed (duration: ~1130ms)
     ```
  - **总计自动化测试用例**：**203 / 203 passed (100% 全部通过，0 失败)**。



---

## 阶段记录：工作区无关项目与历史过时废弃内容彻底清理 (2026-10-08)

### 一、改动范围与核心逻辑

| 涉及模块 / 路径 | 改动类型 | 清理对象与核心逻辑 |
| :--- | :---: | :--- |
| `ai-novel-landing/`、`maliang-writer-restore/`、`maliangwriter-clone/` | 彻底移除 | 移除 2026-07 早期外部克隆与独立原型项目（含独立 package.json、server.js 及静态 HTML/CSS），与墨阑主工程无关，彻底消除全局符号冲突与搜索干扰。 |
| `DeterminFlow_借鉴落地方案_2026-08-19.md`、`UI_审计报告_2026-08-18.md`、`enhanced_prompt_maliangwriter.md` | 彻底移除 | 移除早期草稿、原型审计及马良提示词历史文档。 |
| 根目录 `_*.py`、`build_authorized_character_library.py`、中间 JSON（`nl_tree.json`、`novel_list.json`、`novels_pool.json`、`types_novels.json`） | 彻底移除 | 移除历史一次性爬虫探针、探测脚本与数十兆中间 JSON 缓冲池，主项目全链路零依赖。 |
| `资源库/scripts/_probe_*.py`（共 39 个探针）、`_test_pipeline.py`、`_test_out/` | 彻底移除 | 移除历史镜像站、起点、全本探测脚本及测试输出目录。 |
| `资源库/scripts/muye.js`、`library.js`、`fanqie-probe.py` | 彻底移除 | 移除番茄小说前端逆向分析遗留的 3.9MB + 158KB 打包 JS 产物及对应探针脚本，剥离外来无用大体积资产。 |
| `.gitignore` | 规则精简 | 移除已删除文件 `!molan-deploy-current.txt` 的废弃反向忽略规则。 |

### 二、技术决策与权衡（负面影响分析）

1. **彻底解除全局污染与 Token 浪费**：
   - 工作区根目录此前堆积大量与 `molan-home` 无关的项目目录（`ai-novel-landing/`、`maliang*`）和 4MB+ 的外部 JS 逆向打包文件（`muye.js`、`library.js`），在 Agent 启动或全局 Grep 检索时造成严重的无关命中与 Token 浪费。
2. **保护核心生产资产与数据边界**：
   - 严格保护核心数据目录 `资源库/小说原本/`、工程级工具链 `scripts/`、写作 Skill `write-high-tension-fiction/`、核心参考规约 `纠错库.md` 及评测基准文件（`quality-report.md`、`optimization-plan.json` 等）。
3. **闭环暂存与原子化提交流程**：
   - 前序尝试仅在工作区中留下未暂存删除状态，极易被并发任务或分支检出静默撤销。本次对清理集合完成显式暂存与验证，确保工程交付闭环。

### 三、验证证据与测试数据

- **测试运行时**：`tools/node22_runtime/node.exe` (Node.js v22)
- **执行命令与结果**：
  1. Phase 2 增强回归套件（21 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/phase2-engine-enhancements.test.js
     # 21 tests, 21 passed, 0 failed (duration: ~50ms)
     ```
  2. Phase 2 E2E 与对抗性剪裁核心测试（95 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/e2e-phase2-engine.test.js test/adversarial-attention-tiering.test.js
     # 95 tests, 95 passed, 0 failed (duration: ~950ms)
     ```
  3. 全局关联单测套件（87 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/composition-profiles.test.js test/composition-debt-ledger.test.js test/orchestrator-brain-consolidation.test.js test/milestone-4-strategy-provenance-lowering.test.js test/strategy-compiler.test.js test/content-engine.test.js test/context-plan-replay-p4.test.js test/replay-manifest.test.js
     # 87 tests, 87 passed, 0 failed (duration: ~1130ms)
     ```
  4. 写作 Skill 与纠错库加载合同（6 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" test/editor-only-sources.test.js
     # 6 tests, 6 passed, 0 failed
     ```
  5. 生产导入架构审计：
     ```powershell
     & "..\tools\node22_runtime\node.exe" scripts/production-import-audit.mjs
     # 扫描 220 个生产文件，依赖隔离合规无异常 (PASS)
     ```
  6. 黄金数据集任务验证：
     ```powershell
     & "..\tools\node22_runtime\node.exe" scripts/audit-golden-suite.mjs
     # 80 个黄金任务全部验证通过 (PASS)
     ```
  - **总计核心自动化测试用例**：**209 / 209 passed (100% 全部通过，0 失败)**。

---

## 阶段记录：单一真相加固、Token 预算模型统合与 Fail-Closed 质检 (2026-10-08)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 |
| :--- | :---: | :--- |
| `molan-home/services/model-call-service.js` | 单一真相 (P0-1) | `callMolanChat` 增加对外部提供 `messages` / `renderedPromptPackage.messages` 的优先直接透传支持，彻底消除底层二次拆解与隐藏 Prompt 指令注入，保障请求与 `promptHash` 绝对同构。 |
| `molan-home/lib/generation/content-engine.js` | 契约对齐 (P0-1) | `buildDraftRequest` 输出规范化 3-message `canonicalMessages`（含最终输出指令），将 `promptBudget` 预算断言与 `promptDigest`（完整哈希）严格绑定到该真实请求体；`generateDraft` 原封不动透传 `messages` 与 `renderedPromptPackage`。 |
| `molan-home/lib/composition/compiler/attention-tiering.js` | 预算统合 (P0-2) | `estimateTokens` 增加接收 `options.modelId` / `options.model`，优先联动 `model-registry.js` 获取模型能力库专属的 CJK / 非 CJK 折算比率，消除 Attention 预算与 Context Budget 之间的分词器计算分歧。 |
| `molan-home/lib/generation/quality-assessment.js` | 严格门禁 (P0-3) | 彻底消除 `style` 与 `aiFlavor` 未测量即默认为 `passed: true` / `clean` / `0.85` 的假绿灯漏洞；未提供数据时明确标记为 `NOT_MEASURED` 且分数置 0；未跑评委时文学层标为 `unmeasured`；严格模式 (`strict: true`) 下存在 `NOT_MEASURED` 层直接 Fail-Closed 阻断。 |
| `molan-home/lib/composition/debt/story-debt-ledger.js` | 幂等加固 (P0-4) | 拔除 `createDebt` 中普通债务的 `Date.now() + Math.random()` 非确定性随机 ID，实现模块级与类静态方法 `generateDeterministicDebtId`，基于 `(storyId, chapterNo, chapterId, debtType, originEntity, summary, seed)` 生成 20 位 SHA-256 确定性哈希切片，确保 Replay、Retry 与断线恢复时账本绝对幂等。 |
| `molan-home/lib/composition/evaluation/experiment-engine.js` | 观测加固 (P1-6) | `appendSynergyRecord` 与 `flushSynergyRecords` 写盘失败时严禁静默吞异常，增加告警日志输出并置位 `this._dirty = true` 与 `this._failedRecords` 追踪，提供 `isDirty()` 与 `getFailedRecords()` 状态观测接口。 |
| `molan-home/services/generation-service.js` | 视野增强 (P1-8) | 新增 `buildJudgeEvidencePacket`，将原先单一的 `slice(0, 4000)` 粗暴前序截断替换为覆盖【章节开篇 1500 字 + 中段推进与高潮 1300 字 + 章末转折与钩子 1200 字】的复合证据包（Composite Evidence Packet），赋予质量裁判宏观章节视野。 |
| `molan-home/test/phase2-engine-enhancements.test.js` | 自动化测试 | 新增 Suite 8（5 项回归测试，总数增至 26 项），全面覆盖 canonical 3-message、模型能力分词对齐、质检 fail-closed、普通债务确定性 ID 与实验引擎写盘脏状态追踪。 |

### 二、设计决策与权衡（负面影响分析与叫停项）

1. **为什么坚决叫停在线生成链路引入 L2 双盲 LLM 裁判 (P0-5 负面影响)**：
   - 章节生成本身属于 15~30 秒的长耗时链路。若同步串联引入 A/B 双盲 LLM 评委，每次生成将额外增加 20~40 秒的大模型网络等待，且翻倍消耗 Token 成本；一旦评委调用发生超时或断网，将导致整章生成直接崩溃。
   - **本次解决方案**：在线主链坚持采用零网络延迟的 L0 规则预筛 + L1 债务与状态位移结构对账（`debt-reconciliation.js`）；双盲评测仅适合作为离线 Benchmark 或异步 Worker 任务。
2. **为什么坚决叫停前置 Composition Planner LLM (优化.txt 第十三条-1 负面影响)**：
   - 系统内部已有 `scene-planner.js` 与 `creation-plan-service.js` 负责镜头与场景推进。再生硬插入一层 LLM Planning 属于过度工程化，首字延迟严重翻倍且引入新一轮幻觉断点。
3. **为什么坚决叫停 5D 边际张量数学推演 (优化.txt 第十三条-2 负面影响)**：
   - 在缺乏海量真实用户接受/修改反馈样本的前提下，提前推演 5 维高阶张量属于“空中楼阁”和数学空转；当前应聚焦夯实追加写 JSONL 实验日志基础。
4. **为什么坚持在 `content-engine.js` 装配 RenderedPromptPackage 而非在底座拼接 (P0-1 负面影响)**：
   - 底座 `model-call-service.js` 承担全站公共调用（包括拆书、题材判别、设定解析等）。若在底座强制追加 Attention 规则，会污染全站非正文调用，且导致领域层算好的 `assertContextBudget` 与 `promptHash` 审计完全失效。本次方案由 `buildDraftRequest` 组装完成包含输出格式的唯一真实 messages，底座直接原样透传。

### 三、验证证据与测试数据

- **测试运行时**：`tools/node22_runtime/node.exe` (Node.js v22)
- **执行命令与结果**：
  1. Phase 2 增强回归套件（26 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/phase2-engine-enhancements.test.js
     # 26 tests, 26 passed, 0 failed (duration: ~170ms)
     ```
  2. Phase 2 E2E 与对抗性剪裁核心测试（95 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/e2e-phase2-engine.test.js test/adversarial-attention-tiering.test.js
     # 95 tests, 95 passed, 0 failed (duration: ~1220ms)
     ```
  3. 全局关联与回归套件（124 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test test/composition-profiles.test.js test/composition-debt-ledger.test.js test/orchestrator-brain-consolidation.test.js test/milestone-4-strategy-provenance-lowering.test.js test/strategy-compiler.test.js test/content-engine.test.js test/context-plan-replay-p4.test.js test/replay-manifest.test.js test/quality-assessment.test.js test/generation-quality-gate.test.js
     # 124 tests, 124 passed, 0 failed (duration: ~1150ms)
     ```
  4. 写作 Skill 与纠错库加载合同（6 项）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" test/editor-only-sources.test.js
     # 6 tests, 6 passed, 0 failed (duration: ~188ms)
     ```
  5. 生产架构依赖隔离审计：
     ```powershell
     & "..\tools\node22_runtime\node.exe" scripts/production-import-audit.mjs
     # 扫描 220 个生产文件，依赖隔离合规无异常 (PASS)
     ```
  6. 黄金数据集全量任务验证：
     ```powershell
     & "..\tools\node22_runtime\node.exe" scripts/audit-golden-suite.mjs
     # 80 个黄金任务全部验证通过 (PASS)
     ```
  - **总计核心自动化测试用例**：**251 / 251 passed (100% 全部通过，0 失败)**。

---
