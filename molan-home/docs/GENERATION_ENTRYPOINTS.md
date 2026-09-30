# 墨阑生成系统生产入口与调用链真理清单 (GENERATION_ENTRYPOINTS)

本文档明确记录墨阑工业级小说生成系统的唯一生产主链。严禁在生产链路上调用任何 `lib/legacy/` 废弃调度器。

## 1. 唯一生产生成调用链 (Single Production Chain)

```
[前端 UI]
  └─ 点击「生成下一章」 (completion-editor.js: sendEditorAI / data-action="ai-generate")
       │
[HTTP API]
  └─ POST /api/generation-runs (server.js: handleGenerationRuns)
       │ (注入幂等键 Idempotency-Key, 租约时长 leaseDurationMs)
       ▼
[运行时仓储]
  └─ SQLite / PostgreSQL 持久化创建 Generation Run
       │ (状态: created, 记录参数与快照)
       ▼
[状态机与编排器]
  └─ lib/generation/state-machine.js (唯一合规状态转移转移表)
  └─ lib/generation/orchestrator.js (唯一生产主编排器: advanceGenerationRun)
       │
       ├─ (1) request_validated: 校验入参格式、模型配额与工程边界
       ├─ (2) genre_resolved: 接入 lib/genre/genre-registry.js 解析写作机制
       ├─ (3) style_resolved: 接入 lib/style/style-registry.js 解析文风 Profile
       ├─ (4) context_built: 上下文预算校验 (lib/generation/context-budget.js)
       ├─ (5) contract_validated: 章节合同校验 (必须包含目标与因果约束)
       ├─ (6) pre_generation_guard: 事实硬前置拦截
       ├─ (7) scene_planning: 场景执行计划
       │
       ▼
[正文起草与质检引擎]
  └─ lib/generation/content-engine.js (generateDraft)
       │
       ├─ (8) generating: 调用模型提供商 (callModel) 获取正文
       ├─ (9) draft_received: 生产级流解析器 (stream-parser.js) 校验完成态
       ├─ (10) deterministic_audit: 长度与 AI 味特征检测
       ├─ (11) semantic_audit: 真实语义审计 (lib/generation/semantic-audit.js)
       │      └─ 视点越界与禁载知识拦截，必须有逐字 Quote 证据
       ├─ (12) revision: 局部精准修订 (lib/generation/revision.js)
       │      └─ 挂载 Invariant Snapshot 防止否定极性反转与实体变异
       └─ (13) quality_audit: 真实质量向量测量
              └─ 严禁虚假赋分，未测维度输出 NOT_MEASURED
       │
       ▼
[原子提交与投影]
  └─ committing -> committed
       └─ lib/generation/commit-projection.js (原子写入草稿或正文库，结算积分)
```

## 2. 隔离与废弃模块清单 (Legacy Excluded List)

以下模块已从生产链路中彻底剥离，严禁在 `server.js` 或 `lib/generation/*` 中反向引入：
1. `lib/legacy/pipeline-coordinator.js`: 旧单体流水线。
2. `lib/legacy/generation-pipeline-coordinator.js`: 历史生成管线。
3. `lib/real-novel-generator.js`: 仅作为离线实验与基准测试工具，严禁作为生产线上调用入口。

门禁脚本 `scripts/production-import-audit.mjs` 在 CI 流程中执行静态 AST 扫描，任何反向引入直接中止构建。
