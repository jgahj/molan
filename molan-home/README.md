# 墨阑 · 工业级 AI 小说创作编译器平台 (Molan Home)

> **项目定位**：基于“单一真相、状态机驱动、可回放审计与持续闭环学习”理念构建的高张力中文网络小说工业级创作引擎。

---

## 一、系统核心架构 (Canonical Architecture)

墨阑采用分层创作编译器架构，将作者意图从离散输入逐步编译为带有严格 Token 预算、因果注意力与模型定制渲染的唯一真实请求包（`RenderedPromptPackage`）：

```text
                  用户输入 / 章节大纲
                          │
                          ▼
             ┌─────────────────────────┐
             │     CompositionSpec     │
             │   题材 · 文风 · 目标    │
             │   侧重点 · 钩子 · 契约  │
             └────────────┬────────────┘
                          ▼
             ┌─────────────────────────┐
             │       StrategyIR        │  ◄── 绑定 Profile 版本与知识包 Provenance
             └────────────┬────────────┘
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
   多模型专属降级渲染 (IR Lowering)    4级注意力裁剪 (Attention Tiering)
   (Claude XML / GPT / DeepSeek)      (保底水位线 · P0 事实优先保护)
             │                         │
             └────────────┬────────────┘
                          ▼
             ┌─────────────────────────┐
             │  RenderedPromptPackage  │  ◄── 唯一真实 Provider 请求
             │  Canonical 3-Messages   │      (绑定 promptDigest 与 Context Budget)
             └────────────┬────────────┘
                          ▼
             ┌─────────────────────────┐
             │   Provider (LLM 客户端) │
             └────────────┬────────────┘
                          ▼
                     正文草稿 Draft
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
    确定性门禁 (L0 Audit)     因果与状态跃迁真值 (L1 Audit)
    (字数 / AI味套话惩罚)     (StoryDebtLedger 债务回收与推进)
             │                         │
             └────────────┬────────────┘
                          ▼
             ┌─────────────────────────┐
             │ Quality Gate (复合证据包)│  ◄── Fail-Closed 严格门禁
             └────────────┬────────────┘
                          │
                 ┌────────┴────────┐
                 ▼                 ▼
             通过 (Commit)     未达标 (Revise)
                 │
                 ▼
       Experiment Engine (协同提升度追加写日志)
                 │
                 ▼
     知识反哺 (StrategyCard / Compatibility Matrix)
```

---

## 二、生产入口与调用链 (Single Production Chain)

墨阑严格执行**单一生产主链**，所有生产代码禁止绕过调度器直接拼接 Prompt：

1. **唯一生产生成接口**：`POST /api/generation-runs`
   - 幂等性保障：必须携带 `Idempotency-Key` 请求头；
   - 租约生命周期：由仓储统一管理状态机租赁。
2. **唯一生产编排器**：[`lib/generation/orchestrator.js`](lib/generation/orchestrator.js)
   - 驱动状态流转：`created` → `request_validated` → `context_built` → `generating` → `audited` → `committing` → `committed`。
3. **唯一正文起草引擎**：[`lib/generation/content-engine.js`](lib/generation/content-engine.js)
   - 组装 `RenderedPromptPackage` 规范消息包，由 `services/model-call-service.js` 原样透传。
4. **历史/废弃组件隔离**：
   - 历史单体流水线已物理隔离至 `lib/legacy/`；
   - 生产 CI 门禁（`scripts/production-import-audit.mjs`）实施静态 AST 扫描，严禁反向引入废弃模块；
   - 历史组件挂载 `lib/legacy/legacy-telemetry.js` 实施调用生命周期遥测与平滑治理。

---

## 三、核心模块索引

| 目录 / 文件 | 核心职责 |
| :--- | :--- |
| **`lib/composition/`** | **创作策略体系 (Phase 2 核心)** |
| ├── `compiler/` | `strategy-compiler.js` (策略总编译器)、`attention-tiering.js` (注意力4级裁剪) |
| ├── `corpus/` | `archetype-discoverer.js` (原型挖掘)、`evidence-catalog.js` (证据目录热重载) |
| ├── `debt/` | `story-debt-ledger.js` (不可变追加写因果账本)、`debt-reconciliation.js` (状态跃迁真实对账) |
| ├── `evaluation/` | `experiment-engine.js` (5维元组协同提升度记录，JSONL 持久化与脏状态追踪) |
| ├── `ir/` | `strategy-ir.js` (IR 结构与版本绑定)、`ir-lowering.js` (模型专属语法降级渲染) |
| └── `profiles/` | `profile-registry.js` (5维创作维度与来源追踪)、`hook-profile.js` (确定性 SHA-256 Debt ID) |
| **`lib/generation/`** | **生成编排与质量门禁** |
| ├── `content-engine.js` | 规范化 `buildDraftRequest` 单一真相装配与草稿生成 |
| ├── `context-budget.js` | 上下文窗口预算断言（`assertContextBudget`） |
| ├── `orchestrator.js` | 状态机核心编排驱动器 |
| └── `quality-assessment.js` | 4层解耦质量评估实体（Fail-Closed 严格门禁） |
| **`services/`** | **业务服务层** |
| ├── `model-call-service.js` | 底座通用模型调用客户端（支持规范 messages 透传） |
| └── `generation-service.js` | 章节生成协调与复合多切片裁判证据包（Opening/Middle/Climax/Ending） |

---

## 四、开发与运行规范

### 1. 环境依赖
- **Node.js**：版本 `>= 22.5.0`（开发环境统一使用 `tools/node22_runtime/node.exe`，禁止依赖宿主未知 Node 版本）。
- **包管理**：使用 `npm ci` 确保与 `package-lock.json` 强一致。

### 2. 启动服务
```bash
# 启动本地开发服务 (默认 3000 端口)
npm start

# 指定端口启动
PORT=8080 npm start
```

### 3. 本地模型配置
通过环境变量注入密钥（前端不接触密钥）：
```bash
DEEPSEEK_API_KEY=sk-xxxx npm start
```
或在 `data/config.json` 中配置 `platformModels` 与 `modelPolicy`。

---

## 五、自动化测试与 CI 门禁

系统拥有完备的测试套件与静态防伪审计，提交代码前必须确保 **100% 通过**：

```bash
# 1. 核心自动化单元与集成测试 (250+ 用例)
npm test

# 2. 生产架构依赖隔离审计 (确保无非法引用 legacy 废弃模块)
npm run audit:production-imports

# 3. 黄金数据集任务全量验证 (80 项经典网络小说创作基准用例)
npm run audit:golden

# 4. CI 一键完整流水线
npm run ci
```

---

## 六、交接与工程规范

遵循根目录 `AGENTS.md` 规则：
- 任何架构重构或缺陷修复，必须使用 Node 22 真实执行测试套件，杜绝伪造测试数据；
- 修改完成后必须在 [`HANDOVER.md`](HANDOVER.md) 同步追加记录（包含架构索引、改动范围、决策考量与验证证据）；
- 确认全量测试绿灯后，规范提交 Git 并推送远程仓库。
