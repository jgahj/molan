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
    └── phase2-engine-enhancements.test.js    # 边界 ??、确定性 Debt ID、Floor 保底等 16 项回归测试
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
