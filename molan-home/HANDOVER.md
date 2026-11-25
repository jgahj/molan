# 墨阑项目工程交接文档 (HANDOVER.md)

> 本文档用于跨会话、跨代理（GPT / AGY 及 Subagents）协作时记录系统演进基线、架构决策、验证事实与后续待办。  
> 遵循 AGENTS.md 规则，后续任何功能新增、架构重构或缺陷修复，必须在此文档同步追加/更新记录（新阶段记录请插入在「零、项目核心架构与文件骨架速查索引」**下方**，保持骨架索引永久置顶）。  
> 早期完整历史记录已无损归档至：[docs/HANDOVER_ARCHIVE_2026.md](./docs/HANDOVER_ARCHIVE_2026.md)。

---

## 零、项目核心架构与文件骨架速查索引 (Curated Project Map)

> **新会话/切换窗口必读**：本索引用于快速定位核心模块职责，避免大范围扫描文件浪费 Token。

```text
molan-home/
├── data/                               # 数据存储中心与持久化仓储
│   ├── lora-training/                  # 1276本真人小说 v2 零假模板 LoRA 微调数据集 (书本级隔离, Alpaca/ShareGPT/dataset_info)
│   ├── legacy-archive/                 # 历史平铺数据与历史评测归档目录 (含 README.md)
│   ├── strategy-knowledge-base/        # 策略知识库 (LRU 3包滚动机制与激活包保护)
│   └── molan.db                        # SQLite 单一真实主库 (已 VACUUM 瘦身至 17MB)
├── training/                           # LoRA 微调脚手架与云端/本地一键部署套件
│   ├── colab/molan_qwen25_7b_lora_colab.ipynb # Google Colab 免费版 T4 防断线/防OOM 一键 Qwen2.5-7B QLoRA 工作台 (v2)
│   ├── train_lora_llamafactory.yaml    # LLaMA-Factory 行业标准微调配置文件
│   ├── train_unsloth.py                # Unsloth 极速省显存训练脚本 (支持 16GB/24GB 显卡)
│   ├── run_autodl.sh                   # AutoDL / 算力云一键全自动化环境配置与训练脚本
│   ├── Modelfile                       # 本机 Ollama 免显卡运行模板 (AMD 8845HS 核显/CPU 秒级启动)
│   └── README_TRAINING_GUIDE.md        # Google Colab 免费 T4 与 AutoDL 云端微调部署教程
├── lib/
│   ├── composition/                    # 创作策略体系 (V3 / Phase 2 核心)
│   │   ├── compiler/                   # 策略编译与注意力裁剪
│   │   │   ├── strategy-compiler.js    # 策略总编译器 (Spec -> StrategyIR -> Lowering -> Tiering)
│   │   │   └── attention-tiering.js    # 4级注意力分级裁剪 (保底水位线, P0事实保护)
│   │   ├── corpus/                     # 语料挖掘、证据卡与知识包发布
│   │   │   ├── archetype-discoverer.js # 原型发现与频次/模式挖掘
│   │   │   ├── evidence-catalog.js     # 策略卡证据目录 (基于 __dirname 寻址与热重载检测)
│   │   │   ├── package-publisher.js    # 知识包发布器 (相对路径根因解析、LRU 3包保留与碎片清理)
│   │   │   ├── prompt-experiment-extractor.js # 全库1279本章节抽样与双模提示词提取器
│   │   │   ├── prompt-experiment-runner.js    # 四象限对照实验批处理调度器与质量评估引擎
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
│   ├── generation/                     # 正文生成引擎 (M1~M5 核心)
│   │   ├── content-engine.js           # 草稿请求装配 (buildDraftRequest 幂等去重入模、CompositionV3 自动合成与 evidence-catalog 注入)、生成调度
│   │   ├── context-budget.js           # 供应商上下文窗口预算断言 (assertContextBudget)
│   │   ├── context.js                  # 八层上下文编译器 (assembleContext)、8维大纲审计指标闭环、提示词防污染黑名单
│   │   ├── inplace-sanitizer.js        # 题材中立的体感反应规整与句法净味后处理
│   │   ├── manifest.js                 # 回放清单生成器 (buildGenerationManifest)、WeakSet 循环引用免疫保护
│   │   ├── orchestrator.js             # 正文生成编排器、生命周期流转、getReplay 显式跨层透传 outlineAudit 与双重持久化
│   │   ├── quality-assessment.js       # 质量评测与 fail-closed 门禁
│   │   ├── quality-gate.js             # 质量门禁判定引擎
│   │   └── run-context.js              # 生成运行态参数规范化 (useCompositionV3 / judgeReasoningEffort / targetChars)
│   ├── model/
│   │   └── model-registry.js           # 统一大模型能力注册表 (GPT / DeepSeek / Claude / Gemini 3.x-4 / ACP 模型上下文与分词比率)
│   ├── memory-context.js               # 长篇记忆上下文 (selectRelevantPlans 多维打分提炼、数值0/空串防假值坍塌、writingPackage 提升入模)
│   ├── scene-planner.js                # 细纲场景规划器 (三态完备度识别、事件链推导、因果硬围栏阻断与自愈剪枝)
│   ├── security-guard.js               # 端到端防套取提示词检测与系统安全硬围栏 (Fail-Fast探针拦截, 硬围栏注入)
│   └── legacy/                         # 历史组件平滑治理与隔离
│       ├── generation-pipeline-coordinator.js # 历史生成流水线 (已隔离)
│       └── legacy-telemetry.js         # 历史废弃模块调用生命周期遥测器
├── routes/                             # 领域路由与处理器分发层 (Phase 1 ~ Phase 4 模块化解耦)
│   ├── auth.js                         # 认证路由器 (含 register-config / send-verify-code / register / login / profile / logout)
│   ├── dissection-handlers.js          # 拆书领域处理器工厂 (含 26+ 端点实现与紧凑序列化工具)
│   ├── creation-books.js               # 创书领域路由器 (分发 17+ 新书/圣经/状态快照/扩展/合同端点)
│   ├── creation-book-handlers.js       # 创书领域处理器工厂 (解耦核心包生成、计划扩写与审核并发锁)
│   ├── dissections.js                  # 拆书领域路由器
│   ├── character-handlers.js           # 角色领域处理器工厂 (列表、补丁、合并、导出与作品导入)
│   ├── project-asset-handlers.js       # 项目资产/工程整包与提示词编译处理器工厂
│   ├── admin-handlers.js               # 纠错库与管理审计处理器工厂 (含 6 项纠错与素材审批端点)
│   ├── debt-knowledge-handlers.js      # 因果债务与文风健康处理器工厂 (含 8 项因果债务与文风检测端点)
│   ├── generation-handlers.js          # 生成领域处理器工厂 (模型目录、Token计量、健康检查与对话桥接)
│   ├── generation.js                   # 生成领域路由器
│   ├── admin.js                        # 管理后台路由器
│   ├── knowledge.js                    # 知识与因果债务路由器
│   └── projects.js                     # 项目与角色路由器
├── services/                           # 业务服务层
│   ├── auth-account-service.js         # 账户认证、会话与邮箱验证码注册服务
│   ├── email-verification-service.js   # 6 位数字邮箱验证码生命周期、冷却与防爆破校验服务
│   ├── smtp-mail-service.js            # 零依赖 SMTP 发信与 sub2api PG settings 自动只读配置解析器
│   ├── json-persistence-service.js     # 无竞争原子 JSON 落盘、高频账本节流异步刷盘与受控 debugWarn 服务
│   ├── zhuque-detector-service.js      # 朱雀官方 AIGC 检测网关客户端（带 SHA-256 内存缓存与超时降级）
│   ├── zhuque-closed-loop-service.js   # 多候选择优 + 诊断改写 + 短黄段定点修补真值闭环服务
│   ├── acp-transport-service.js        # 官方 Antigravity ACP (JSON-RPC over stdio) 本地传输适配器与会话池
│   ├── chat-service.js                 # 对话与两遍去 AI 味精修总控 (SSE 行缓冲、OpenAI/DeepSeek/ACP 统一分发、自检闸门多轮择优改写)
│   ├── generation-service.js           # 生成服务 (buildCanonicalOutlineContext、两遍精修与真实文学盲评串联)
│   ├── humanize-policy-service.js      # 第二遍去 AI 味精修提示词与题材/目标字数约束构建
│   ├── model-call-service.js           # 全站通用模型调用客户端 (内部 HTTP 路由与流解析)
│   ├── model-selection-service.js      # 用户模型解析与思考强度归一化
│   ├── creation-chapter-service.js     # 章节生成编排入口
│   └── creation-plan-service.js        # 创作计划与大纲服务
├── scripts/acp-login.js & acp-login.bat # 官方 ACP OAuth 一次登录与模型能力探测脚本
├── pages/local-open-auth.js            # 独立子页本地免登录会话共享引导模块 (`MolanLocalOpenAuth`)
├── pages/auth.css                      # 主页一致宣纸墨黑风认证页统一样式（支持 theme-dim 暗色模式）
├── pages/login.html & js/login.js      # 主页风格一致登录页与 CSP 外移交互脚本
├── pages/register.html & js/register.js # 两步邮箱验证码注册页（自动发码 + 60s 重发冷却）与 CSP 外移脚本
└── test/                               # 核心自动化测试集 (Node 22 运行，全量真实通过)
    ├── email-verification-register.test.js # SMTP 发信、sub2api 配置回退、6位验证码注册闭环与页面 UI/CSP 专测 (6 项)
    ├── account-deletion.test.js           # 自主匿名化注销账号、释放邮箱安全重注册与权限拦截测试 (3 项)
    ├── editor-bootstrap-creation-book.test.js # 编辑器直连 Generation V2 伴生创作书自动引导与圣经校验隔离测试 (4 项)
    ├── local-open-access.test.js              # 本地免登录开放模式 (`MOLAN_LOCAL_OPEN_ACCESS=1`) 与生产安全隔离测试 (2 项)
    ├── acp-transport.test.js                  # 官方 Antigravity ACP 传输、权限拒绝、OAuth未登录拦截与 chat-service 集成测试 (5 项)
    ├── package-publisher-lru.test.js          # 发布器路径隔离、LRU 滚动保留与激活保护测试 (3 项)
    ├── workbench-editor-fusion.test.js        # 创作坞站、AI增强开关、防提示词套取与双向联动测试 (29 项全量通过)
    ├── reviewer-m3-m4-adversarial.test.js     # M3/M4 对抗审查加固专测 (20 项)
    ├── replay-manifest-8dim-audit.test.js      # M4 8维大纲回放指标闭环与 getReplay 暴露专项测试 (3 项)
    ├── outline-memory-and-metrics.test.js      # M4 8维指标与记忆入模专项测试 (3 项)
    ├── memory-plan-elevation.test.js          # M3 长篇记忆多维计划提炼与八层编译器提升入模专项测试 (14 项)
    ├── challenger-m3-adversarial.test.js      # M3 对抗探针测试套件 (14 项)
    ├── challenger-outline2-m3-adversarial.test.js # M3 极端边界对抗测试 (16 项)
    ├── challenger-outline2-m3-2-adversarial.test.js # M3 综合对抗测试 (16 项)
    ├── scene-planner-tiered-audit.test.js      # M2 场景规划三态完备度与因果硬围栏阻断专项测试 (27 项)
    ├── challenger-m2-causal-adversarial.test.js # M2 因果硬围栏对抗测试套件 (16 项)
    ├── challenger-outline2-m2-adversarial.test.js # M2 极端畸形与剪枝对抗套件 (9 项)
    ├── chapter-outline-context-audit.test.js    # M1 大纲一等公民、章节位置冲突阻断、上下文深度合并与去重专项测试 (4 项)
    ├── chapter-outline-context-deepening.test.js # M1 分层大纲契约深入验收测试 (11 项)
    ├── challenger-m1-outline-adversarial.test.js # M1 大纲位置冲突与深度合并对抗测试 (11 项)
    ├── m1-adversarial-probe.test.js           # M1 对抗探针测试 (11 项)
    ├── empirical-adversarial-challenge-r2.test.js # 实证对抗挑战测试 (13 项)
    ├── reviewer-m5-adversarial.test.js        # M5 终局对抗加固与边界防御专测 (12 项)
    ├── challenger-m5-adversarial.test.js      # M5 状态机单向流与无冗余审计对抗测试 (6 项)
    ├── challenger-m5-2-adversarial.test.js    # M5 极限流转与质检门禁对抗测试 (9 项)
    ├── routes-dissection.test.js              # 拆书路由与处理器契约测试
    ├── routes-creation-books.test.js          # 创书路由与处理器契约测试
    ├── routes-phase2-projects-characters.test.js # Phase 2 角色与项目资产路由契约测试
    ├── routes-phase3-admin-debt.test.js       # Phase 3 管理纠错与因果债务路由契约测试
    ├── routes-phase4-generation.test.js       # Phase 4 生成、计量与健康检查路由契约测试
    ├── corpus-prompt-experiments.test.js      # 1279本全库抽样、双模提示词提取与四象限实验测试
    ├── e2e-phase2-engine.test.js              # Phase 2 引擎 4 梯队 60 项 E2E 验收用例
    ├── adversarial-attention-tiering.test.js  # 注意力裁剪对抗性极限压力测试 (35 项)
    ├── phase2-engine-enhancements.test.js     # 边界 ??、确定性 Debt ID、来源解耦与遥测等 30 项回归测试
    ├── living-prose-optimization.test.js      # 《小说原本》零AI味范本注入、《纠错库》靶向诊断与全题材去AI味优化 (10 项)
    ├── humanize-gate.test.js                  # 自检闸门多轮改写与历史最优下发专项测试 (3 项)
    ├── lora-dataset-and-pipeline.test.js      # 1276本真人小说 v2 数据集防泄露/零截断与 Colab T4 Notebook 校验测试 (8 项)
    ├── real-corpus-style-deai.test.js         # 全库1279本真实风格指纹、PMF词表、零破碎样本与纯统计降AI专测 (5 项)
    ├── system-optimization-suite.test.js      # 首屏异步竞态修复、679KB懒加载、无竞争节流落盘、仓储/双编辑器拆解专测 (5 项)
    └── auth-persistence-and-latency.test.js   # 登录态持久化、异步Scrypt、内存缓存与小说秒开专项测试 (5 项)
```

---

## 阶段记录：注册邮箱 SMTP 配置同步与红框消除——对接 sub2api Docker 容器并持久化至本地 config.json (2026-11-25)

> 背景：用户在本地 `http://localhost:3000` 注册墨阑工作台时，界面提示红框警告 `未检测到运行中的 Docker / sub2api-postgres 容器，请先启动 Docker 中的 sub2api，或在 data/config.json / 环境变量中配置 SMTP`。用户确认已在 `sub2api` 项目中配置过发信邮箱（选项 B）。经排查，用户本机 Docker Desktop 此前未启动导致 PostgreSQL 容器未处于监听状态。在用户启动 Docker Desktop 后，自动读取 `sub2api-postgres` 容器中的 `settings` 表并将 SMTP 配置无损落盘至 `molan-home/data/config.json`，实现墨阑即便在后续 Docker 关闭时也能独立稳定发送 6 位注册验证码。

### 一、改动范围与核心逻辑

| 涉及模块 / 目标 | 动作类型 | 关键改动点与核心操作 |
| :--- | :---: | :--- |
| `molan-home/data/config.json` | 配置落盘 | 通过 `molan-home/scripts/sync-sub2api-smtp.mjs` 从运行中的 `sub2api-postgres` 容器提取 `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `smtp_from`, `smtp_from_name`, `smtp_use_tls`，并安全合并写入本地 `data/config.json`（密码仅本地持久化，受 `.gitignore` 保护不入版本控制）。 |
| `molan-home/routes/auth.js` & `services/smtp-mail-service.js` | 服务就绪验证 | `GET /api/auth/register-config` 实时感知 `config.json` 中的 `smtp` 字段，响应返回 `emailConfigured: true` 且 `emailStatusReason: ""`。前端注册弹窗顶部红色告警框彻底消除。 |

### 二、设计决策与权衡

1. **从 Docker 直读改为落盘 `config.json` 的双保险设计**：
   - 依赖 Docker 运行时读取会受到 Docker Desktop 开关状态的强约束（启动慢、占用内存）。
   - 一次性同步并将脱敏解析后的配置落盘到 `data/config.json`，使得墨阑服务在日常使用时无需常驻启动 Docker Desktop 或依赖 SSH 隧穿，降低系统资源损耗。
2. **密码与敏感信息硬围栏**：
   - 同步脚本与测试全程绝不打印真实密码/授权码，仅在控制台与日志中输出 `passwordSaved: true`，符合项目安全硬围栏标准。

### 三、真实验证证据

1. **配置同步命令与输出**：
   ```bash
   tools/node22_runtime/node.exe molan-home/scripts/sync-sub2api-smtp.mjs
   ```
   输出：
   ```json
   {
     "ok": true,
     "source": "sub2api-docker",
     "host": "smtp.qq.com",
     "port": 465,
     "from": "1271055010@qq.com",
     "fromName": "顶点api",
     "useTLS": true,
     "passwordSaved": true,
     "target": "C:\\Users\\lyh\\Desktop\\小说专属网页\\molan-home\\data\\config.json"
   }
   ```
2. **接口健康与配置校验**：
   - `GET http://127.0.0.1:3000/api/auth/register-config` 状态码 200：
     `{"ok":true,"registrationEnabled":true,"emailVerifyEnabled":true,"emailConfigured":true,"emailStatusReason":"","countdownSeconds":60,"codeLength":6,"codeExpiresMinutes":15,"siteName":"墨阑 AI 小说"}`
3. **UI 视觉实证**：
   - 浏览器子代理访问 `http://localhost:3000/#login` 切换至注册标签，截图确认原红色告警框已彻底消失，两步验证注册表单（账号信息与邮箱验证）渲染完整规范。
   - 截图存证：`C:/Users/lyh/.gemini/antigravity/brain/36be6919-5f88-4ac0-8c6f-7e567fc53cb4/browser_evidence/be2641d5-0719-4452-aa4e-00289aa69908/final_step_14.png`
4. **自动化测试套件回归**：
   - 运行：`tools/node22_runtime/node.exe --test molan-home/test/email-verification-register.test.js molan-home/test/auth-account-service.test.js`
   - 结果：12 tests, 12 pass, 0 fail, 100% 真实通过。

---

## 阶段记录：Google Colab 免费版 T4 小说模型训练全链路重构——v2 零假模板/书本级防泄露数据集与防断线防 OOM Notebook 落地 (2026-11-25)

> 背景：用户需要使用 `资源库/小说原本` 数据在 Google Colab（免费版 T4，16GB 显存 / 12.7GB 内存）上微调自己的 Qwen2.5-7B-Instruct 小说模型。前置审计发现旧版 `build_lora_dataset.mjs` 存在写死 120 字假粗稿诱发幻觉、脏人名抽取、测试目录混入、样本级打乱导致验证泄露及超 2048 截断 4 大硬伤，且旧版 Colab Notebook 存在免费版导出 GGUF 易 OOM、无断点续训、未开启 `train_on_responses_only`、未挂载验证集及推理测试未套 ChatML 模板等 5 项隐患。经用户确认后实施全链路 v2 升级。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/scripts/build_lora_dataset.mjs` | 数据集引擎 v2 重构 | 1. 彻底移除 `buildRoughDraftForPass2` 写死假粗稿模板，改为 **70% 真实前文续写 (`novel_continuation`) + 30% 干净节拍写作 (`outline_expansion`)**，且两任务切片互不重叠；<br>2. 新增 `SKIP_DIRS` 自动排除 `测试` 目录（有效扫描 1,276 本），强化 `NON_NAME_REGEX` + `INVALID_NAME_CHAR_REGEX` 人名净滤；<br>3. 改为**书本级隔离切分**（1,213 训练书 / 63 验证书，0% 跨集重叠），并支持 `--genres=` 题材筛选；<br>4. 全量产出 2,135 条训练 + 117 条验证样本（总正文 268.6 万字，均长 1,812 字 / 最大 2,176 字 / 超过 2,400 字 0 条），`train_sharegpt.jsonl` 体积由 40.8 MB 压缩至 11.07 MB。 |
| `molan-home/training/colab/molan_qwen25_7b_lora_colab.ipynb` | Colab T4 防断线/防 OOM 工作台 v2 | 1. Google Drive 优先读数（`MyDrive/molan-lora/data/`），首次缺失支持网页上传并自动转存云盘；<br>2. 启用 Unsloth 官方 Colab 兼容安装与 `SFTConfig` + `train_on_responses_only`（仅正文算 Loss，屏蔽 system/user 提示词）；<br>3. 挂载独立验证集（`eval_dataset=val_dataset`, `eval_steps=50`）、`is_bfloat16_supported()` 自适应 T4 `fp16` / L4/A100 `bf16`；<br>4. 内置 `find_latest_checkpoint(OUT_DIR)` 自动断点续训，完训立即先备份轻量化 LoRA（~150MB）到云盘；<br>5. 修复推理试写为标准 ChatML 模板；导出 GGUF 前释放 `trainer`/数据集与显存并限制 `maximum_memory_usage=0.4`，附带 **Cell 10 独立重启恢复导出单元**彻底规避 T4 12.7GB RAM 崩溃风险。 |
| `molan-home/training/README_TRAINING_GUIDE.md`<br>`molan-home/data/lora-training/{dataset_summary.json,val_alpaca.json,val_sharegpt.jsonl}`<br>`molan-home/test/lora-dataset-and-pipeline.test.js` | 文档同步 + v2 数据资产 + 自动化校验 | 同步补充 Google Colab 免费版 T4 章节与 v2 数据指标；新增 2 项契约测试校验 `book_level_zero_leakage`、零假粗稿、0 截断风险、排除 `测试` 题材及 Colab Notebook 全部防断线/防 OOM 防护配置。 |

### 二、设计决策与权衡

1. **放弃硬编码假粗稿，采用“真实前文续写 + 真实节拍写作”**：零合成噪音，确保 7B 模型 LoRA 权重 100% 贴合真实网文的剧情连贯性、对话密度与自然段长，避免模型学坏无视指令瞎编。
2. **LoRA `r=32 / alpha=64` + `MAX_SEQ_LENGTH=2048` + 2 Epochs（~267 步）**：在免费版 T4 16GB 显存下兼顾文风迁移力与防过拟合，全程约 35~50 分钟即可在单次免费会话内跑完。

### 三、真实验证证据

- **数据集重建**：`tools/node22_runtime/node.exe molan-home/scripts/build_lora_dataset.mjs` → 1,276 本有效小说（排除 3 本测试），2,135 训练 / 117 验证（书本级 0% 泄露），最大总长 2,176 字（0 条超 2,400），`train_sharegpt.jsonl` 11.07 MB。
- **Notebook 语法校验**：Python `ast.parse` 校验全部 10 个代码单元 → `Python AST syntax OK across all 10 code cells!`。
- **专项测试**：`tools/node22_runtime/node.exe --no-warnings --test molan-home/test/lora-dataset-and-pipeline.test.js` → **8/8 pass, 0 fail**。
- **全量回归**：`tools/node22_runtime/node.exe --no-warnings --test molan-home/test/*.test.js` → **2,304 tests / 74 suites / 2,291 pass / 0 fail / 13 skipped (23.3s)**。

---

## 阶段记录：全站 7 大系统性优化落地——根除首屏脚本竞态与 679KB 懒加载、48 题材去 AI 联动、无竞争节流落盘、仓储与双编辑器拆解及交接文档置顶瘦身 (2026-11-25)

> 背景：全站体检定位出 P0–P2 共 7 项工程优化点，用户指示全部落地完成并保持 100% 零回归。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/boot-scripts.js`<br>`molan-home/app-boot.js`<br>`molan-home/test/static-file-allowlist.test.js` | 首屏竞态根除 + 679KB 路由懒加载（P0-1） | 1. 在 `boot-scripts.js` 与 `loadLazyScript` 中显式声明 `s.async = false`，彻底消除浏览器动态脚本默认乱序执行导致公网环境下 `workspace-completion.js` 抢跑漏调 `.install()` 的线上竞态 Bug；<br>2. 将 **679KB（10,654 行）** 的 `completion-editor.js` 纳入 `app-boot.js` `LAZY_ROUTE_SCRIPTS`（按 `['editor', 'outline', 'knowledge']` 路由按需拉取），非编辑器首屏 JS 载荷立减 **~60%（679KB）**，与既有 `completion-import.js`/`completion-admin.js` 合计首屏减重 **~1,072KB**。 |
| `molan-home/pages/site.js` | 去 AI 味工具打通 48 桶真实题材指纹（P0-2） | 新增 `#ml-deai-genre` 题材选择器与 `inferDeaiGenre(text, selected)`、`fetchGenreStyleHint(genre)`，告别朱雀深度模式硬编码 `'通用文学'`；普通流式模式与 `/api/deai-zhuque-loop` 均精准传递真实题材并注入对应原书纯统计锚点。 |
| `molan-home/services/json-persistence-service.js`<br>`molan-home/server.js`<br>`molan-home/services/chat-service.js`<br>`molan-home/services/local-database-bootstrap.js` | 无竞争原子落盘 + 异步节流刷盘 + 受控 `debugWarn`（P0-3 & P1-5） | 1. 新增 `uniqueTempPath`（`${pid}.${ts}_${nonce}.tmp`）与 `writeJsonAtomicSync`/`writeJsonAtomicAsync`，彻底消灭共享固定 `.tmp` 互踩隐患；<br>2. 新增 `createThrottledJsonStore` 接管 622KB+ 的 `token_usage.json`：内存即时一致、`unref` 定时器 1.2s 合并异步刷盘、`process.once('exit')` 同步兜底，消除每次对话结算阻塞主事件循环；<br>3. 新增受控 `debugWarn`（`MOLAN_DEBUG=1` 启用）接入 JSON 读取、PG 通知解析、SQLite 迁移与流式净味回退路径。 |
| `molan-home/lib/repositories/postgres-generation-run-methods.js`<br>`molan-home/lib/postgres-repository.js`<br>`molan-home/pages/js/editor-shared-core.js`<br>`molan-home/completion-editor.js`<br>`molan-home/pages/editor.js`<br>`molan-home/pages/editor.html` | PG 仓储子模块拆分 + 双编辑器共享核心抽离（P1-4） | 1. 按 `createPostgresLabJobMethods` 同款事务注入模式将 Generation Run 全部 16 个方法（~770 行）拆入 `postgres-generation-run-methods.js`，`postgres-repository.js` 从 **7,488 行瘦身至 6,725 行**；<br>2. 新增 UMD 共享核心 `pages/js/editor-shared-core.js`（`MolanEditorShared`），统一抽离 SPA `completion-editor.js` 与独立页 `pages/editor.js` 重复的角色原型推断引擎与安全转义工具，同时修复 `pages/editor.html` 历史遗留过期版本戳并纳入 `check-frontend-stamp.mjs` 统一门禁（`20261125_perf_arch_opt_v1`）。 |
| `.gitignore`<br>`molan-home/HANDOVER.md`<br>`molan-home/docs/HANDOVER_ARCHIVE_2026.md`<br>`molan-home/test/system-optimization-suite.test.js` | 45.9MB 冗余清理 + 交接文档索引置顶与无损归档（P2-6 & P2-7） | 1. 清理废弃的 **45.9MB** `data/molan.db.backup-1791645204369`，将未跟踪 `output/` 移入本地忽略归档 `data/legacy-archive/output-samples-202611`，加固 `.gitignore`（`*.db.*`、`output/`、`legacy-archive/`）；<br>2. 将 `HANDOVER.md`【零、项目核心架构与文件骨架速查索引】永久置顶至第 9 行并补齐最新模块；早期 2,948 行阶段记录无损归档至 `docs/HANDOVER_ARCHIVE_2026.md`，主文件从 **3,866 行精简至 ~960 行**；<br>3. 新增 5 项专项测试 `test/system-optimization-suite.test.js`。 |

### 二、设计决策与权衡

1. **只清理无引用冗余，不动被测实验资产**：前置引用扫描确认 `data/genre-lab` 与 `data/corpus-prompt-experiments` 仍被现有契约测试读取，予以完整保留，仅清理无引用的 45.9MB 旧库备份与未跟踪 `output/`，确保零破坏。
2. **节流刷盘使用 `.unref()` + `exit` 同步兜底**：既避免定时器挂住 `node --test` 进程退出，又保证内存中实时读取零陈旧、异常退出零丢账。

### 三、真实验证证据

- **语法与门禁**：13 个修改/新增脚本 `tools/node22_runtime/node.exe --check` 全部 `SYNTAX OK`；`production-import-audit.mjs`（240 文件，exit=0）；`check-frontend-stamp.mjs`（`20261125_perf_arch_opt_v1`，exit=0）。
- **专项测试**：`system-optimization-suite`、`csp-tightening`、`creation-main-flow`、`feature-audit`、`workbench-editor-fusion`、`deai-tool-stop-slop`、`production-import-audit`、`static-file-allowlist` → **80/80 pass, 0 fail**。
- **全量回归**：`tools/node22_runtime/node.exe --no-warnings --test --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"` → **`2511 tests / 74 suites / 2495 pass / 0 fail / 16 skipped`（耗时 39.6s，基线 2506 → +5）**。

---

## 阶段记录：Colab 版 Qwen2.5-7B 真人网文 LoRA 训练包（全库 48 题材）(2026-11-25)

> 背景：用户确认用 Google Colab 基于项目 `资源库/小说原本` 训练模型，并明确授权本次语料用于训练；选定「7B 一步到位 / 全库 48 题材 / LoRA 适配器 + q4_k_m GGUF」。`manifest.json` 中 1,279 本语料仍全部标记 `modelProcessingAllowed=false`，本次仅按用户本次明确指令执行，语料只读、产物不公开分发。

### 一、改动范围与核心逻辑

| 涉及文件 | 改动类型 | 关键点 |
| :--- | :---: | :--- |
| `molan-home/data/lora-training/train_alpaca.json`、`train_sharegpt.jsonl` | 重建（gitignored） | 原文件本地缺失且被 `.gitignore` 排除；用 `build_lora_dataset.mjs` 从 1,279 本重新生成 5,345 条训练样本（验证集 281 条不变）。 |
| `molan-home/training/colab/molan_qwen25_7b_lora_colab.ipynb` | 新增 | 11 单元 Colab Notebook：官方 2026 Unsloth 依赖组合 → Drive 挂载 → 数据上传 → `unsloth/Qwen2.5-7B-Instruct-bnb-4bit` 4-bit QLoRA（r=64/alpha=128/全线性）→ chat template 渲染与超长过滤 → `UnslothTrainer` 2 epoch（T4 用 fp16、batch=2、accum=8、每 100 步存档）→ 保存适配器 + q4_k_m GGUF → 试生成 → Ollama 接入说明。 |

### 二、设计决策与权衡

1. **Colab 免费 T4 用 QLoRA 而非 16-bit LoRA**：7B 全精度约需 60GB 显存；预量化 4-bit 基座 + Unsloth 梯度检查点可压到 16GB 内，`fp16=True`/`bf16=False` 适配 Turing 架构。
2. **沿用 Unsloth 2026 官方安装组合与 `UnslothTrainer`**：旧 `train_unsloth.py` 的 `SFTTrainer(dataset_text_field=...)` 与 `unsloth[colab-new] git+` 安装方式已滞后；Notebook 改用 `transformers==4.57.3`/`trl==0.22.2`/`datasets==4.3.0` 与 `UnslothTrainingArguments`。
3. **产物双份**：LoRA 适配器约 100MB 便于后续换基座；q4_k_m GGUF 约 4.5GB 可直接用本机 AMD 8845HS + Ollama 推理。GGUF 转换失败时自动保留适配器，不阻断交付。
4. **不在本会话启动 Colab**：本环境无 Google 账号授权，只交付可运行 Notebook；训练 loss、朱雀检测效果须由用户在 Colab 实跑后回填。

### 三、真实验证证据

- 数据集重建：`tools/node22_runtime/node.exe molan-home/scripts/build_lora_dataset.mjs` → 扫描 1,279/1,279 本，5,626 样本 / 1,136.2 万字，训练 5,345 / 验证 281，exit=0。
- Notebook 结构：`JSON.parse` 通过，nbformat=4 / 11 cells / 9 code cells；安装正则与 escape 校验通过。
- Python 语法：临时校验脚本剔除 `!`/`%` 魔法命令后对 9 个代码单元做 `ast.parse` → `checked=9 errors=0`。
- **未执行**：Colab 实际训练、GGUF 导出、朱雀复检（需用户登录 Google 账号手动运行）。

---

## 阶段记录：全库 1,279 本真实《小说原本》风格提取重建 + 清理模拟假包 + 升级网文去 AI 味策略与工具链 (2026-11-25)

> 背景：审计发现 `molan-home/data/` 多项旧风格数据存在严重陈旧、抽样过窄或造假问题：① `data/strategy-knowledge-base` 当前激活包 `corpus_20261010_8327` 竟出自临时测试目录 `Temp\molan-mock-corpus-vgjDeD\传统玄幻\凡人求道录.txt`（仅 1 本假书、2 章）；② `style-fingerprints.json` 停留在 2026-09-06、漏扫 244 本、未过滤标题/广告且未统一单双换行口径；③ `paragraph-samples.json` 中 1,046 条存在错误匿名化破坏语义；④ `ai-flavor-lexicon.json` 仅抽样 48 本且 `correction-policy` 拆词绕过 PMF 误伤高频日常词。用户拍板执行【方案 C】并确认风格使用边界：**仅向降 AI 提示词注入纯统计风格指纹 + 真实高低频词谱 + 网文叙事规律，绝不注入原书正文段落（零串味/抄袭风险）**。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/scripts/build-style-fingerprints.mjs`<br>`molan-home/data/style-fingerprints.json` | 全库 1,279 本真实风格指纹重建 | 升级 `listArchiveBuckets`/`accumulateStyleLine`/`finalizeFingerprint`：只读覆盖 48 个题材桶 + 根目录 3 本长篇共 **1,279 本（0 失败，有效清洗 8,100 万字）**；过滤章节标题/水印/作者感言，统一按有效自然行统计段长，补齐 `primaryGenre`，新增 `sentenceLenCv`、`paragraphLenCv`、`shortSentenceRatio`、`longSentenceRatio`、`directPsychPerKilo`、`aiGluePerKilo`、`modalParticlePerKilo` 真实抗 AI 维度（100% 向下兼容 `style-fingerprints-1`）。 |
| `molan-home/scripts/mine-ai-flavor-lexicon.mjs`<br>`molan-home/data/ai-flavor-lexicon.json` | 全库 8,284 万字真实 PMF 词表重建 | 从 48 本抽样升级为 **1,279 本（82,843,103 字）100% 全量只读扫描**；修复 `correction-policy` 正则拆词绕过 PMF 导致误杀“还是/一声/一点/一枚/顺着/停了”等 54 个日常高频词的缺陷，产出 548 条全库实证词表（422 `block` + 126 `watch`）。 |
| `molan-home/lib/character-material.js`<br>`molan-home/scripts/build-paragraph-samples-pro.mjs`<br>`molan-home/data/paragraph-samples.json` | 修复匿名化切词漏洞与重建干净样本库 | 在 `isParagraphNameCandidate` 新增 `ANON_SPLIT_VERB_PAIRS`（防止把“蓝曦浅笑”劈成 `【人X】笑`）及高歧义单字姓防护；构建脚本叠加 `isBrokenAnonymizedText` 与 `max-flavor-score=35` 门禁，重跑保留 2,194 条样本，破碎匿名化占位符从 1,046 条降至 **0 条**。 |
| `molan-home/scripts/rebuild-strategy-knowledge-base.mjs`<br>`molan-home/data/strategy-knowledge-base/` | 删除 Mock 假包并发布真实全库策略包 | 新增重建脚本消费 1,279 本真实指纹与全库 PMF 词表，通过 `PackagePublisher` 原子发布 `corpus_real_1279_20261125`（4 条 A 级纯统计抗 AI 叙事策略，零原书原文拷贝），彻底删除历史临时目录假包 `corpus_20261010_8327`。 |
| `molan-home/lib/style-fingerprint.js`<br>`molan-home/services/humanize-policy-service.js`<br>`molan-home/skills/humanizer/SKILL.md`<br>`molan-home/pages/site.js`<br>`molan-home/completion-platform.js`<br>`molan-home/app-boot.js`<br>17 个版本戳前端文件 | 网文去 AI 味策略与工具链全线升级 | 1. `lib/style-fingerprint.js` 新增 `EXTENDED_PROFILE_FIELDS` 聚合与 `buildDeaiStyleFingerprintBlock(genre)`（纯统计风格锚点，零原书段落拷贝）；<br>2. `services/humanize-policy-service.js` 在改写系统消息中接入 `buildDeaiStyleFingerprintBlock(genre)`，支持 `styleOnly`/`includeLivingExemplars:false`/`MOLAN_HUMANIZE_NO_EXEMPLARS=1` 零原段注入，并新增「体感动作替代心理报幕」「对白身份口语化」「严禁造错别字/毁标点/古今穿越换词机械洗稿」硬约束；<br>3. `skills/humanizer/SKILL.md`、`pages/site.js`、`completion-platform.js`、`app-boot.js` 同步融合 1,279 本网文去 AI 味专项规则（完整保留 Stop AI Slop 契约），前端版本戳统一升级至 `20261125_real_style_deai_v1`。 |
| `molan-home/test/real-corpus-style-deai.test.js` | 新增专项测试 | 5 项测试锁死：1,279 本真实风格指纹及扩展突发度字段、8,284 万字真实 PMF 词表防高频词误伤、`strategy-knowledge-base` 清除 mock 假包并激活真实包、`paragraph-samples.json` 零破碎匿名化、`humanize-policy-service` 零原段注入纯统计锚点闭环。 |

### 二、设计决策与权衡

1. **纯统计风格锚点替代原书段落拷贝**：直接向提示词灌入原书原文易引发串味、撞车和匿名化破碎污染；改用 1,279 本真实原书聚合出的句长突发度（CV）、段长参差度、对话占比、比喻/心理报幕红线与 8,284 万字 PMF 词谱，既能有效拉高困惑度与突发度，又彻底杜绝抄袭隐患。
2. **禁止低级机械洗稿，兼顾防检测与读者体验**：实测对照市面机械降重版（毁坏引号标点、把“月俸”洗成“月工资”、把“药苗”洗成“药品苗”甚至出现药田凭空多出桌子的穿帮）与本套 1,279 本真实仙侠风格重构版：重构版在 100% 保留全部剧情事实、规范中文标点与修仙语域的前提下，本地 AI 味综合分从 **38 → 0**，句长标准差比从 **0.47 → 0.97**（完美贴合 51 本真实仙侠原书均值 17.6 字），直白心理报幕 `4 → 0`、机械对话标签 `11 → 0`。
3. **只读保护与全量零回归**：`资源库/小说原本` 全程只读未做任何改动；所有 JSON Schema 与 Stop AI Slop、10 月 4 日默认单遍起草基线保持 100% 向下兼容。

### 三、真实验证证据

- **数据重建实测**：
  - `node22_runtime/node.exe molan-home/scripts/build-style-fingerprints.mjs --all` → 覆盖 48 桶 **1,279 本 / 0 失败 / 0.81 亿有效字**；
  - `node22_runtime/node.exe molan-home/scripts/mine-ai-flavor-lexicon.mjs` → 全量扫描 **1,279 本 / 82,843,103 字**，548 条（422 block / 126 watch / 54 高频日常词安全剔除）；
  - `node22_runtime/node.exe molan-home/scripts/build-paragraph-samples-pro.mjs --books-per-bucket 8 --groups-per-book 8 --max-flavor-score 35` → 保留 2,194 段，破碎匿名化 **0 条**；
  - `node22_runtime/node.exe molan-home/scripts/rebuild-strategy-knowledge-base.mjs` → 删除 mock 假包 `corpus_20261010_8327`，发布激活 `corpus_real_1279_20261125`。
- **语法与门禁**：全部修改脚本 `node.exe --check` → `ALL SYNTAX OK`；`production-import-audit.mjs`（238 文件，exit=0）；`check-frontend-stamp.mjs`（`20261125_real_style_deai_v1`，exit=0）。
- **专项测试（8 套件）**：`real-corpus-style-deai`、`style-fingerprint`、`ai-flavor-detector`、`deai-tool-stop-slop`、`living-prose-optimization`、`humanize-gate`、`zhuque-closed-loop`、`package-publisher-lru` → **50/50 pass, 0 fail (5.6s)**。
- **全量回归**：`tools/node22_runtime/node.exe --no-warnings --test --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"` → **`2506 tests / 74 suites / 2490 pass / 0 fail / 16 skipped`（耗时 39.6s，基线 2501 → +5）**。

---

## 阶段记录：新增用户自主注销账号功能（匿名化注销 + 密码/邮箱二次确认）(2026-11-25)

> 背景：用户要求增加注销账号功能，并确认三项核心规则：① 匿名化注销（清除个人资料与密码、释放邮箱可重新注册、撤销所有会话，作品与用量账本保留为匿名数据，不触碰外键）；② 仅需输入当前登录邮箱文字 + 登录密码确认；③ 禁止注销管理员账号与本地免登录默认账号（`local@molan.local`）。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/lib/postgres-repository.js` | 新增匿名化注销仓储方法 | 新增 `runtimeDeactivateAccount({ userId })`：在事务中将 `luna.runtime_accounts` 目标行更新为墓碑邮箱（`deleted-<uuid>@deleted.molan.invalid`）、清空 `name`（`'已注销用户'`）/ `avatar` / `bio` / `default_model` / `salt`、`pwd='!deactivated'`、`credits=0`，并在 SQL 条件 `WHERE id = $1::uuid AND role <> 'admin'` 中硬性排除管理员。 |
| `molan-home/services/auth-account-service.js`<br>`molan-home/routes/auth.js`<br>`molan-home/server.js` | 注销接口与重注册冲突防护 | 1. 新增 `POST /api/auth/delete-account`（`handleDeleteAccount`）：限流（10 次窗口）、校验登录态、拒绝管理员（`403`）与本地免登录账号（`403`）、校验 `confirmEmail` 与 `verifyPasswordAsync`、调用 `runtimeDeactivateAccount` 并撤销内存与 PG 全量会话（`revokeAuthSessions`）；<br>2. 增强 `insertUserIfAbsent`：当释放后的邮箱再次注册时，若原 `stableUserId(email)` 已被墓碑账户占用，自动派生全新独立 `userId`，避免主键冲突并杜绝新账号继承旧数据。 |
| `molan-home/completion-platform.js`<br>`molan-home/pages/account.js`<br>`molan-home/boot-head.js` / `boot-scripts.js` / `index.html` / `pages/*.html` | 前端危险操作区与确认弹窗 | 1. 主工作台 `#account`「登录安全」页签新增「危险操作 · 注销账号」卡片与确认弹窗（`deleteAccount()`），输入当前登录邮箱与密码后完成注销并清空本地会话跳回登录页；<br>2. 独立子页 `pages/account.js` 账户设置弹窗底部新增「注销账号」危险确认面板；<br>3. 前端缓存版本戳同步升级至 `20261125_account_delete_v1`。 |
| `molan-home/test/account-deletion.test.js` | 新增专项测试 | 3 项测试：匿名化注销释放邮箱/撤销会话/防重登及释放后安全重注册（派生新 ID）、未登录 `401`/管理员 `403`/本地免登录账号 `403` 拦截、SPA/独立弹窗/PG 仓储接线契约校验。 |

### 二、真实验证证据

- **语法与门禁**：`node.exe --check` 覆盖全部修改脚本均 `SYNTAX OK`；`production-import-audit.mjs`（238 文件，exit=0）；`check-frontend-stamp.mjs`（`20261125_account_delete_v1`，exit=0）。
- **专项测试**：`test/account-deletion.test.js` + `test/email-verification-register.test.js` + `test/csp-tightening.test.js` → **15/15 pass, 0 fail**。
- **全量回归**：`tools/node22_runtime/node.exe --no-warnings --test --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"` → **`2501 tests / 74 suites / 2485 pass / 0 fail / 16 skipped`（耗时 39.9s，基线 2498 → +3）**。

---

## 阶段记录：修复本地注册跳过邮箱验证码问题——补齐 sub2api Docker 容器回退与强制校验开关 (2026-11-24)

> 背景：用户实测本地 `http://127.0.0.1:3000` 注册时未发送邮箱验证码。实机根因排查确认两点：① 本机 `127.0.0.1:25432` 被无关软件 `OSService\public\pgsql` 占用（报 `password authentication failed for user "sub2api"`），且本地 `sub2api/deploy/docker-compose.yml` 中的 `sub2api-postgres` 容器默认不向宿主机暴露 5432/25432 端口，当时 Docker Desktop 也处于 Stopped 状态、ECS `8.138.128.184` 不可达；② `start-node22.bat` / `start-node22-pg.bat` 未显式设置 `MOLAN_EMAIL_VERIFY_ENABLED=1`，导致 SMTP 未连通时 `getPolicy()` 自动将 `emailVerifyEnabled` 降级为 `false` 从而静默跳过验证码步骤。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/services/smtp-mail-service.js` | 新增 Docker 容器回退与诊断 | 在 TCP 直连 `sub2api` PG 失败（如 Windows 25432 端口冲突或本地 Docker 未暴露端口）时，自动回退执行只读 `docker exec sub2api-postgres psql -AtF "\t"` 读取 `settings` 表 SMTP 参数；新增 `getLastDiagnostic()` 输出不含密钥的中文诊断信息（如提示 Docker Desktop / `sub2api-postgres` 未启动）。 |
| `molan-home/services/email-verification-service.js` | 透传非敏感诊断 | `getPolicy()` 新增 `emailStatusReason` 字段，通过 `GET /api/auth/register-config` 透传给前端提示。 |
| `molan-home/start-node22.bat`<br>`molan-home/start-node22-pg.bat`<br>`molan-home/start-node22-pg.ps1` | 启动强制开启验证与隧道避让 | 两个启动脚本默认设置 `MOLAN_EMAIL_VERIFY_ENABLED=1`，杜绝本地运行态静默绕过邮箱验证码；`start-node22-pg.ps1` 额外转发 `127.0.0.1:25433 -> 127.0.0.1:25432` 并默认 `MOLAN_SUB2API_PG_PORT=25433`，避开 Windows 本机 25432 冲突。 |
| `molan-home/pages/js/register.js`<br>`molan-home/completion-platform.js`<br>`molan-home/boot-head.js` / `boot-scripts.js` / `index.html` / `pages/*.html` | 前端诊断展示与版本戳升级 | SPA 与独立注册页优先展示服务端返回的 `emailStatusReason`；缓存版本戳统一升级至 `20261124_smtp_docker_v1`。 |
| `molan-home/scripts/sync-sub2api-smtp.mjs` | 新增同步工具 | 一键只读提取运行中 `sub2api`（TCP 或 Docker）的 SMTP 配置并写入 `.gitignore` 忽略的 `data/config.json`（绝不打印密码），同步一次后即使关闭 Docker Desktop 墨阑仍可独立发码。 |
| `molan-home/test/email-verification-register.test.js` | 新增回归断言 | 新增 1 项专项测试：模拟 Windows `25432` 冲突触发 `docker exec sub2api-postgres` 回退成功解析 SMTP，以及 Docker 未启动时返回准确诊断信息。 |

### 二、真实验证证据

- **语法与门禁**：`node.exe --check` 全部通过；`production-import-audit.mjs`（238 文件，exit=0）；`check-frontend-stamp.mjs`（`20261124_smtp_docker_v1`，exit=0）。
- **专项测试**：`test/email-verification-register.test.js` + `test/csp-tightening.test.js` → **12/12 pass, 0 fail (1.24s)**。
- **全量回归**：`tools/node22_runtime/node.exe --no-warnings --test --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"` → **`2498 tests / 74 suites / 2482 pass / 0 fail / 16 skipped`（耗时 41.2s，基线 2497 → +1）**。
- **实机服务复验**：重启本地 `start-node22.bat` 后实测 `GET http://127.0.0.1:3000/api/auth/register-config` 返回 `emailVerifyEnabled: true`、`emailConfigured: false`、`emailStatusReason: "未检测到运行中的 Docker / sub2api-postgres 容器..."`，不再静默跳过邮箱验证。

---

## 阶段记录：全站 UI 细节系统性打磨、信息架构精简、登录注册一体化整合与墨阑设计体系深度统一 (2026-11-24)

> 背景：基于 `pages/tokens.css` 墨阑文人水墨风单一真源（Light/Dark），分三步完成全站视觉打磨、信息架构极简提效与登录注册一体化整合：第一轮彻底修复深浅色对比度、跨页风格割裂、按钮遮挡、图标缺失与旧版滤镜冲突；第二轮按渐进式披露原则完成编辑器三栏默认与专注写作模式、顶栏「更多」收纳、AI 侧栏分层与双列参数、一屏侧栏折叠 + 全局 `Ctrl+K` 快速命令面板、以及双工作台默认作家视图；第三轮将「6 位邮箱验证码两步注册 + 密码登录」完整打通到主工作台 SPA（`#login` / `#register` / `#account` / 顶栏 / 侧栏 / `Ctrl+K`）与独立子页，统一缓存戳至 `20261124_ui_auth_v3`，同时 100% 保持主体内容与测试契约零破坏。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/pages/tokens.css`<br>`molan-home/pages/shell.css`<br>`molan-home/index.html`<br>`molan-home/boot-head.js`<br>`molan-home/boot-scripts.js` | 语义令牌、极简布局与版本戳升级 | 1. 新增三层语义令牌 `--ink-inverted`、`--surface-header`、`--surface-active`、`--surface-dark-card`、`--danger-line`、`--blog-cover-1/2/3`，根治深色模式下 12+ 处白字白底隐患；<br>2. 新增 `.editor-preview.zen-mode`（740px 居中专注稿纸）、`.editor-more-menu`（顶栏二级分组菜单）、`.ai-params-grid`（2×2 紧凑参数网格）、`.chat-chip-groups`（双行防裁切分层芯片）、`.side-more-group`（侧栏次级折叠区）、`.cmdk-backdrop/.cmdk-dialog`（全局 `Ctrl+K` 命令面板）以及 `.top-auth-group`/`.auth-steps`/`.auth-code-input`（登录注册两步验证样式）；<br>3. 侧栏从 5 组 19 项精简为「创作中心 / 当前作品资料 / 效率工具」+ 可折叠「更多与账户服务」（含普通用户登录 + 注册新账号），常规 1280×800 屏幕一屏免滚动；顶栏新增 `快速跳转 Ctrl K` 与未登录态 `#topAuthActions`（登录/注册直达）；全站前端缓存版本戳统一升级至 `20261124_ui_auth_v3`。 |
| `molan-home/app-boot.js`<br>`molan-home/completion-editor.js`<br>`molan-home/completion-platform.js` | 编辑器三栏/专注模式、`Ctrl+K` 与 SPA 登录注册闭环 | 1. **编辑器默认三栏 + 专注写作模式**：`#editorWorkbenchDock` 默认折叠，释放 +300px 正文空间；顶栏从 23 个平铺按钮精简为核心高频项 + `#editorMoreMenu` 二级分组弹窗（排版/质检与档案/文件与返回）；新增 `toggleEditorZenMode()`（`Ctrl+\` 切换 / `Esc` 退出）；<br>2. **AI 侧栏分层与双列参数**：输入框上方拆清“上下文开关行”与“快捷指令行”，彻底消除横向裁切；`创作参数` 抽屉将锁死的写作预设收敛为单行只读标识，高频 4 项改为 2×2 紧凑网格；补全三大 AI 侧栏视图 `mountIconsSafe()`，修复双对勾、双绑定与窄屏 `resize` 自动收拢；<br>3. **SPA 登录注册一体化闭环**：`completion-platform.js` 升级 `loginPage()`/`renderAuth()`/`authSubmit()`/`resendAuthCode()`，自动查询 `GET /api/auth/register-config`，支持 6 位邮箱验证码两步注册（`POST /api/auth/send-verify-code` + 60s 倒计时重发 + `429 retryAfter` 平滑接管 + `verifyCode` 校验提交）与离线直连注册兼容；新增 `window.MolanOpenAuth(mode)`、`#register` 路由别名、`#account` 动态标题与登录安全区“切换账号/注册新账号”入口；`app-boot.js` `Ctrl+K` 命令面板内置「登录 / 切换账号」与「注册新账号」直达项并透传 `error.retryAfter`。 |
| `molan-home/pages/molan-shell.js`<br>`molan-home/pages/molan-ui.css`<br>`molan-home/pages/auth.css`<br>`molan-home/pages/js/login.js`<br>`molan-home/pages/js/register.js`<br>`molan-home/pages/site.js` | 独立子页 Shell / 认证页深度统一 | 1. `molan-shell.js` 同步三核心区 + 折叠次级导航（补齐 `register.html` 入口），自动恢复并跨标签同步 `molan_theme`（兼容 `'dim'`/`'dark'`），补齐头像首字母回退；<br>2. `auth.css`、`login.js`、`register.js` 对齐 `tokens.css` 语义令牌（`--surface-header` / `--ink-inverted` / `--surface-dark-card`），同时兼容 `body.theme-dim` 与 `html.dark` 并支持跨标签页 `storage` 主题实时同步；<br>3. `molan-ui.css` 完整覆盖独立页及登录页深色高对比样式；`site.js` 移除旧版 `filter: invert(1)` 暗色滤镜冲突，修复登录页错误提示暗色对比度与密码显隐图标切换，教程注册引导链接直指 `./register.html`。 |
| `molan-home/pages/project-docs.html`<br>`molan-home/pages/project-docs.css`<br>`molan-home/pages/project-docs.js`<br>`molan-home/pages/story-workbench.html`<br>`molan-home/pages/story-workbench.css`<br>`molan-home/pages/story-workbench.js` | 嵌入式双工作台去绿换墨 + 默认作家视图 | 1. 彻底替换历史森林绿主题为 `tokens.css` 水墨风，实时同步宿主深浅色，嵌入 iframe 时自动折叠冗余顶栏；<br>2. `project-docs.html` 编辑弹窗将 18 行原始 `JSON 资料负载` 收纳进 `<details class="docs-advanced-box">`；`story-workbench.html` 将底层投影同步、补偿撤销与事件日志折叠进 `<details>`，并将 `not_found` 映射为友好中文提示。 |
| `molan-home/pages/docs.html`<br>`molan-home/pages/blog.html`<br>`molan-home/pages/pricing.html`<br>`molan-home/pages/tools.html`<br>`molan-home/pages/admin-login.html`<br>`molan-home/pages/js/admin-login.js`<br>`molan-home/test/email-verification-register.test.js` | 独立页精修与自动化契约锁死 | 修复 `docs.html`/`blog.html` 浅色模式激活态“全部”按钮白字白底、收敛 `pricing.html` 重复面包屑与状态框内边距、隐藏 `tools.html` 分类栏滚动条并统一水墨 CTA、修正 `admin-login.html` 样式加载顺序与主题同步；新增 SPA 两步注册与全局登录注册入口断言测试（7 项）。 |

### 二、设计决策与权衡

1. **三层语义反色令牌 + 渐进式披露**：既从根源一次性解决深色模式反色对比度问题，又通过“默认三栏 + 顶栏二级菜单 + 侧栏次级折叠 + 作家视图折叠 JSON”在不删除任何功能的前提下显著降低界面噪音。
2. **主工作台 SPA 与独立认证页双轨统一**：用户在主工作台可通过顶栏、`Ctrl+K`、侧栏折叠区或 `#account` 安全页直接完成登录/两步邮箱验证注册，同时保留 `pages/login.html` 与 `pages/register.html` 独立直达页，两端共享同一套 `/api/auth/register-config`、`/api/auth/send-verify-code`、`/api/auth/register` 契约与墨阑宣纸墨黑设计体系。
3. **零破坏兼容既有测试与 CSP 门禁**：完整保留 `workbench-editor-fusion.test.js`、`memory-workbench-integration.test.js`、`deai-tool-stop-slop.test.js`、`creation-main-flow.test.js`、`project-material-schema.test.js`、`email-verification-register.test.js` 与 `csp-tightening.test.js` 的全部 DOM/文案/零内联脚本契约。

### 三、真实验证证据

- **语法、导入隔离与版本戳门禁**：
  - 全部修改脚本 `tools/node22_runtime/node.exe --check` → 全部 `SYNTAX OK`；
  - `scripts/check-frontend-stamp.mjs` → 退出码 `0`（统一版本戳 `20261124_ui_auth_v3`）；
  - `scripts/production-import-audit.mjs` → 已扫描 238 文件，退出码 `0`。
- **全量与专项自动化测试**：
  - 全量无回归套件：`tools/node22_runtime/node.exe --no-warnings --test --test-concurrency=4 "molan-home/test/*.test.js" "molan-home/test/*.test.mjs" "molan-home/test/*.test.cjs"` → **`2497 tests / 74 suites / 2481 pass / 0 fail / 16 skipped`**（耗时 `46.4s`，较前基线 `2496` 新增 +1 项 SPA 登录注册集成断言）；
  - 最终微调后 6 套件复跑（`email-verification-register`、`csp-tightening`、`feature-audit`、`workbench-editor-fusion`、`memory-workbench-integration`、`deai-tool-stop-slop`）→ **`63 tests / 63 pass / 0 fail`**。
- **实机服务与浏览器视觉复验（`http://127.0.0.1:3000`）**：
  - 重启本地 Node 22 服务后实测 `GET /api/auth/register-config` → `200 OK` JSON；
  - 实机浏览器核验通过：侧栏一屏免滚动、`Ctrl+K` 检索「登录 / 切换账号」与「注册新账号」、SPA `#login` 登录/注册两 tab（深浅色）、`#account` 登录安全入口、独立 `pages/login.html` 与 `pages/register.html` 深浅色视觉与零控制台错误。

---

## 阶段记录：结合 sub2api 邮箱验证注册体系 + 主页一致宣纸墨黑风登录/注册页 (2026-11-24)

> 背景：用户确认三项架构决策：① 采用与 `sub2api` 一致的「6 位邮箱数字验证码」两步注册流（提交邮箱密码后自动发码，输入 6 位码完成注册）；② 方案 A 复用 `sub2api` SMTP 配置（环境变量/本地配置优先，自动只读回退查询同机 `sub2api` PostgreSQL `settings` 表）；③ 将 `login.html` 与独立 `register.html` 统一升级为主页 `index.html` 的宣纸墨黑文人风格（含 `theme-dim` 暗色同步）。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/services/smtp-mail-service.js` | 新增零依赖邮件服务 | `createSmtpMailService`、`sendSmtpEmailWithConfig`、`buildSMTPMessage`、`buildVerifyCodeEmailHtml`。纯 Node.js（`node:net`/`node:tls`）实现 SMTP 客户端，复刻 `sub2api` 连接策略（`useTLS=true` 先试隐式 TLS 465，遇明文问候自动强制升级 STARTTLS 587；`useTLS=false` 机会式 STARTTLS；支持 `AUTH PLAIN` + `AUTH LOGIN` 回退、防 CRLF 邮件头注入、UTF-8 MIME 标题与 Base64 墨阑宣纸风 HTML 邮件）。SMTP 配置按 `MOLAN_SMTP_*` → `data/config.json` `smtp` → 自动只读回退查询 `sub2api` PG `settings` 表（`smtp_host/port/username/password/from/from_name/use_tls`，60s 缓存，自动将 `Sub2API` 发件名品牌化为 `墨阑 AI 小说`）。 |
| `molan-home/services/email-verification-service.js` | 新增验证码服务 | `createEmailVerificationService`、`generateSixDigitCode`。`crypto.randomInt` 生成 6 位数字码、15 分钟过期、60 秒冷却（`429` + `retryAfter`）、最多 5 次试错锁废、`crypto.timingSafeEqual` 常量时间比对、发信失败自动回滚不误锁冷却；`getPolicy()` 实现自动/显式模式开关（`MOLAN_EMAIL_VERIFY_ENABLED`）。 |
| `molan-home/services/auth-account-service.js`<br>`molan-home/routes/auth.js`<br>`molan-home/server.js` | 认证接口扩展 | 新增 `GET /api/auth/register-config`、`POST /api/auth/send-verify-code`（发码前校验邮箱未注册，避免已注册邮箱消耗发信额度，返回 `409`）；`POST /api/auth/register` 支持 `verifyCode`/`verify_code` 校验，开启邮箱验证且未配置 SMTP 时 fail-closed 返回 `503`，离线测试无 SMTP 时保持向后兼容。`server.js` 仅修改 4979/5760 行附近，不触碰 `production-import-audit.mjs` 行号白名单锚点。 |
| `molan-home/pages/auth.css`<br>`molan-home/pages/register.html`<br>`molan-home/pages/js/register.js`<br>`molan-home/pages/login.html`<br>`molan-home/pages/js/login.js`<br>`molan-home/pages/site.js` | 统一宣纸墨黑 UI 与两步注册交互 | 新建 `pages/auth.css` 与独立注册页 `pages/register.html` + `pages/js/register.js`，同步升级 `pages/login.html` + `pages/js/login.js`：复用 `tokens.css` 与主页同款顶栏、深墨 `"墨"` 字水印概览板、`6px` 表单控件与 `molan_theme` (`theme-dim`) 暗色同步。注册页自动探测 `/api/auth/register-config`：Step 1 填写邮箱/昵称/密码/确认密码后点击提交即自动发码并切入 Step 2（6 位等宽验证码框、支持粘贴清洗、60s 倒计时重发、返回修改邮箱）。全部脚本外移满足零内联 CSP。 |
| `molan-home/boot-head.js`<br>`molan-home/boot-scripts.js`<br>`molan-home/index.html`<br>`molan-home/pages/*.html`<br>`molan-home/scripts/check-frontend-stamp.mjs` | 缓存戳同步 | 统一升级前端缓存版本戳至 `20261124_emailverify_v1`，并将 `pages/auth.css` 与 `pages/js/register.js` 纳入 `STAMPED_ASSETS` 门禁。 |
| `molan-home/test/email-verification-register.test.js` | 新增专项测试 | 6 项测试：SMTP 邮件头防注入与 HTML 渲染、本地真实 TCP Mock SMTP 服务器 `AUTH PLAIN` + `AUTH LOGIN` 端到端发信、`env > config.json > sub2api PG` 配置优先级与缓存、验证码冷却/过期/5 次试错锁废/单次消费/发信失败回滚、认证路由闭环与 fail-closed/向后兼容、页面 UI/CSP/暗色主题结构断言。 |

### 二、设计决策与权衡

1. **零新增 npm 依赖复用 `sub2api` SMTP**：采用 Node.js 原生 `node:net`/`node:tls` SMTP 客户端 + 既有 `pg` 依赖只读查询 `sub2api` `settings` 表，不引入第三方邮件库，离线打包与 ECS 部署零额外依赖；同时避免 HTTP 代理调用 `sub2api` 发码接口导致的跨系统用户表冲突与品牌错位。
2. **Fail-Closed 安全与零回归兼得**：检测到有效 SMTP 配置或显式设置 `MOLAN_EMAIL_VERIFY_ENABLED=1` 时强制校验 6 位邮箱验证码（无 SMTP 时拒绝绕过返回 `503`）；在本地无 SMTP 的既有 PG 集成测试环境中自动兼容原有直连注册，确保既有 2,490 项测试零回归。
3. **不把密钥写进仓库**：`sub2api` PG 密码仅从运行期环境变量（`MOLAN_SUB2API_DATABASE_URL` / `MOLAN_SUB2API_PG_PASSWORD`）或运行主机上的 `MOLAN_SUB2API_ENV_FILE`（默认探查 `/opt/sub2api/deploy/.env` 等路径）动态读取，绝不硬编码入代码。

### 三、真实验证证据

- **语法检查**：`tools/node22_runtime/node.exe --check` 覆盖 `server.js`、`routes/auth.js`、`services/smtp-mail-service.js`、`services/email-verification-service.js`、`services/auth-account-service.js`、`pages/js/login.js`、`pages/js/register.js`、`pages/site.js`、`test/email-verification-register.test.js` → 全部 `SYNTAX OK`。
- **专项测试**：`tools/node22_runtime/node.exe --no-warnings --test "test/email-verification-register.test.js" "test/csp-tightening.test.js" "test/feature-audit.test.mjs"` → **24/24 pass, 0 fail (1.27s)**。
- **全量回归**：`tools/node22_runtime/node.exe --no-warnings --test --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"` → **`2496 tests / 74 suites / 2480 pass / 0 fail / 16 skipped`（耗时 40.7s，基线 2490 → +6）**。
- **门禁审计**：`production-import-audit.mjs`（238 文件，exit=0）、`check-frontend-stamp.mjs`（`20261124_emailverify_v1`，exit=0）、`audit-golden-suite.mjs`（80 tasks，exit=0）、`scanInteractiveControls` 对 `pages/login.html` 与 `pages/register.html` 扫描 **unmapped=0**。

### 四、运维启用提示

- **云端 ECS（同机运行 `sub2api`）**：只要 `/opt/sub2api/deploy/.env`（或通过 `MOLAN_SUB2API_ENV_FILE` / `MOLAN_SUB2API_PG_PASSWORD` 指定）存在且 `sub2api` 的 PostgreSQL 监听 `127.0.0.1:25432`，墨阑启动后即自动只读复用 `sub2api` 后台已配置的 SMTP 参数并开启 6 位邮箱验证码注册。
- **独立环境变量覆盖**：也可显式设置 `MOLAN_SMTP_HOST/PORT/USERNAME/PASSWORD/FROM/FROM_NAME/USE_TLS` 及 `MOLAN_EMAIL_VERIFY_ENABLED=1`。

---

## 阶段记录：接入朱雀官方 AIGC 检测真值闭环（EdgeOne Makers @makers/zhuque-text）(2026-11-20)

> 背景：用户选择路线 B（朱雀真值闭环），确认「仅开关开启时外发章节正文」、凭证只走环境变量、每章最多额外 2 轮改写。官方文档确认接口为 `POST https://ai-gateway.edgeone.link/v1/providers/zhuque-text/classify`，Bearer `MAKERS_MODELS_KEY`，Body `{text,is_merge}`，返回 `labels_ratio`（0=人工/1=AI/2=疑似）、`segment_labels[]`、`softmax_confidence`、`makers_models_usage.total_tokens`（真实扣费口径）。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/services/zhuque-detector-service.js` | 新增服务层 | 封装官方接口：`isZhuqueConfigured`、`detectZhuque`、`normalizeResponse`、`zhuqueGateReached`、`resetZhuqueCache`。无 Key 直接返回 null；短于 350 字不请求；SHA-256 文本哈希内存缓存（10 分钟 / 128 条）避免重复扣费；12s 超时、HTTP/网络异常一律返回可降级结果而不抛出；`segment_labels[].conf` 直接就是网页版 AIGC 值（真机实测样章片段2 `conf=0.3753` 对报告 `0.3758`），**不可做 1-conf 反转**；`labels_ratio['1']+['2']` 映射为 `aiScore`。 |
| `molan-home/services/chat-service.js` | 闸门判定源替换 | `createChatService` 新增可注入 `zhuqueFetch`（测试用）。`handleHumanizeRoundEnd` 改为 async：每轮完成后若配置了 Key 则调用朱雀；真值成功时**全绿判定 + 择优**全部改用真实分数（`selectedBy:'zhuque'`），失败则原样回退本地代理（`selectedBy:'local'`）。`gate` 元信息新增 `sources`/`zhuqueScores`/`zhuqueTokens`/`selectedRound`；SSE `gate_retry` 控制事件新增 `scoreSource`/`zhuqueScore`/`greenRatio`；下一轮诊断携带 `zhuqueReport` 定点改写。无 Key 或闸门关闭时行为逐字不变，零回归。 |
| `molan-home/test/zhuque-detector.test.js` | 新增专项测试 | 6 项：开关、响应归一化、全绿阈值、短文本拒绝、缓存命中、HTTP/网络异常降级。 |
| `molan-home/test/humanize-gate.test.js` | 扩展集成测试 | `buildService` 支持 `env`/`zhuqueFetch`；新增 2 项：真值达标按 AIGC 择优下发（断言 URL/Bearer/片段分数/扣费 token/SSE 来源）、接口异常自动降级本地信号。原 3 项测试保持通过。 |

### 二、设计决策与权衡

1. **只替换判定源，不重写管线**：复用既有两遍生成、多轮缓冲下发、跨轮诊断传递和择优逻辑，风险面收敛到一个判定函数；`MOLAN_HUMANIZE_GATE_ROUNDS=0` 或未配置 Key 时完全不调用外部接口。
2. **真值优先而非本地代理**：实测本地 `computeAiFlavorScore` 对生成样章 38 分、对朱雀全绿的《登徒子之剑》原作第 0 章 35 分，几乎无法区分；继续优化代理无意义。
3. **失败降级而非阻断**：朱雀接口超时/限流/鉴权失败时只记日志并退回本地信号，保证写作可用性；不把检测的 `makers_models_usage` 混入模型积分结算（它不是模型生成 token）。
4. **缓存护栏**：同文本 10 分钟内不重复检测，避免多轮重试与并发把每月 50 万免费额度耗尽。

### 三、真实验证证据

- 语法：`tools/node22_runtime/node.exe --check services/zhuque-detector-service.js`、`--check services/chat-service.js`、`--check test/*.test.js` 均 SYNTAX OK。
- 专项：`node22_runtime/node.exe --test test/zhuque-detector.test.js test/humanize-gate.test.js` → **11 tests / 11 pass / 0 fail**。
- 全量：`node22_runtime/node.exe --no-warnings --test --test-concurrency=4 "molan-home/test/*.test.js" "molan-home/test/*.test.mjs" "molan-home/test/*.test.cjs"` → **2486 tests / 74 suites / 2470 pass / 0 fail / 16 skipped**（基线 2478 → +8，耗时 56s）。
- **真实接口联调已完成**：用户提供 Key 后实测两段文本。生成样章：`labels_ratio={0:0.2118,1:0,2:0.7882}`、`aiScore=78.8`、`riskConfidence=0.9125`、三段 AIGC=0.7349/0.3753/0.6927（与网页报告 0.7217/0.3758/0.6554 基本吻合）；真人原作第0章：`labels_ratio={0:0.6174,1:0,2:0.3826}`、`aiScore=38.3`、`riskConfidence=0.4985`、四段 AIGC=0.5758/0.1923/0.5699/0.2655。两次调用共扣 makers token 约 11,495。实测确认 `conf` 即 AIGC 值，已修正映射并重跑全部测试通过。
- **预期边界**：真人原作第0章在这套 API 下也不是字面 100% 全绿（61.74% 人工 / 38.26% 疑似），但 `aiScore` 与生成稿差距显著（38.3 vs 78.8）。闸门仍按严格全绿阈值判定，收敛难度需实测评估。

### 四、启用方式 / 待办

- 必须同时满足：`MAKERS_MODELS_KEY` 已注入环境变量，且 `MOLAN_HUMANIZE_GATE_ROUNDS >= 1`（当前启动脚本方案 A 默认 0，需显式改回 2）。
- 可选微调：`MOLAN_ZHUQUE_MIN_GREEN_RATIO`（默认 0.99）、`MOLAN_ZHUQUE_MAX_SEGMENT_AIGC`（默认 0.5）、`MOLAN_ZHUQUE_API_URL`（默认官方地址）。
- 待用户配置 Key 后：真实联调 → 按报告核对 `aiScore`/`greenRatio` 与网页版 AIGC 值的一致性 → 决定是否把阈值放宽到 0.98 以提高收敛率。

### 五、后续小实验：P0 诊断透传 + 绿色锚点定点改写（2026-11-20）

- **P0 断点修复**：`buildSecondPassBody` 现把 `zhuqueReport` 传给 `buildHumanizePassMessages`；`humanize-policy-service.js` 将超线片段（AIGC ≥ 0.50）的序号、起始位置与分值写进改写提示词，模型不再盲改。集成测试新增断言：提示词必须包含“朱雀官方检测”。全量回归复跑 **2486 tests / 2470 pass / 0 fail / 16 skipped**。
- **绿色锚点实验**：从 `paragraph-samples.json` 抽 14 段真人片段，用朱雀真机筛出 2 段 AIGC≈0.000 的锚点（《凡人修仙传》《山海提灯》）。用 `gpt-6-luna` 按正向风格锚改写样章黄段（原 AIGC 0.7194 / label 2），要求保留字数、短句口语、不补比喻与情绪解释。
- **实验结果**：改写后 AIGC **0.0691 / label 0 / greenRatio 1 / aiScore 0**，433 字。证明“真机绿色锚点 + 定点改写”能把黄段打到全绿，路线可行。实验脚本与结果留在系统 Temp（`zhuque_analysis/`），未进入项目。
- **下一步候选**：把该实验固化为 P2 定点修补循环（绿段保留、黄段重写、拼接复检），并把锚点库从 2 段扩到按题材/场景索引的规模。

### 六、真实生成管线纯自主全绿验证（用户要求：不注入抽取的真人片段）(2026-11-20)

- 用户明确边界：禁止把 `小说原本` 抽取的段落注入提示词，必须跑真实生成管线，验收为每段 label=0 且 conf<0.5。
- 实验脚本用 `compileDraftPrompt` + `buildDraftRequest`（`disableLivingExemplars:true`、`useCompositionV3:false`）生成起草提示词，实测起草提示词与改写提示词均**不含真人参照**。
- `gpt-6-luna` 对同一场景生成 3 个候选（temperature 0.82 / 0.95 / 1.05）：
  - 0.82：AIGC 0.6355，label 2，aiScore 100
  - 0.95：三段 0.7771 / 0.3363 / 0.5002，aiScore 30.3，人工占比 69.7%（最优候选）
  - 1.05：两段 0.5655 / 0.2465，aiScore 31.4，人工占比 68.64%
- 取最优候选，仅把朱雀分段诊断（无真人片段、`includeLivingExemplars:false`）交给 `buildHumanizePassMessages`，以 temperature 1.0 改写：**AIGC 0.2729 / label 0 / greenRatio 1 / aiScore 0 / 全绿通过**，1878 字。
- **结论**：在完全不注入真人抽取文本的前提下，真实生成 + 多候选真值择优 + 纯诊断改写即可达到严格全绿。下一步应把该链路产品化（多候选调度、诊断改写 pass、严格闸门），而非继续做提示词负面规则。
- 实验脚本与三份全文结果在系统 Temp `zhuque_analysis/real_generation_experiment.json`，未进入项目。

### 七、闭环产品化：多候选 + 诊断改写 + 按位置定点修补（2026-11-20）

| 文件 | 变更 |
| :--- | :--- |
| `molan-home/services/zhuque-closed-loop-service.js` | 新增闭环服务：`run()` 先按可配温度生成 3 个候选（默认 0.82/0.95/1.05），朱雀真值择优；未全绿则做最多 2 轮整段诊断改写；仍卡短黄段时按 `segment_labels[].position=[start,length]` 取上下文窗口（前后各 220 字）做定点修补并拼接复检，最多 3 轮。全程 `disableLivingExemplars:true` / `includeLivingExemplars:false`，不注入抽取的真人片段。 |
| `molan-home/server.js` | 新增 opt-in 端点 `POST /api/zhuque-closed-loop`。仅当 `MOLAN_ZHUQUE_CLOSED_LOOP=1` 且 `MAKERS_MODELS_KEY` 存在时可用；鉴权后调用闭环服务，返回正文、全绿判定、候选分数、改写/修补轨迹与 token 用量。现有 `/api/chat` 行为完全不变。 |
| `molan-home/test/zhuque-closed-loop.test.js` | 新增 4 项测试：温度/轮数边界、多候选+诊断改写全绿、短黄段定点修补、首轮全绿跳过改写。 |

- **真机产品化验证**：直接调用产品化服务（gpt-6-luna + 官方朱雀），候选最低 aiScore 13.4（短黄段 0.5099）；两轮整段改写降到 28.0 后仍有一个 0.57 的短段；**第 1 轮定点修补即全绿**：AIGC 0.2635 / label 0 / greenRatio 1 / aiScore 0 / 1968 字。证明定点修补层是严格全绿的必要组件。
- **启用方式**：`MOLAN_ZHUQUE_CLOSED_LOOP=1` + `MAKERS_MODELS_KEY`；可选 `MOLAN_ZHUQUE_CANDIDATE_TEMPERATURES`、`MOLAN_ZHUQUE_REWRITE_ROUNDS`(默认2)、`MOLAN_ZHUQUE_SEGMENT_REPAIR_ROUNDS`(默认3)、`MOLAN_ZHUQUE_REWRITE_TEMPERATURE`(默认1.0)、`MOLAN_ZHUQUE_MIN_GREEN_RATIO`(0.99)、`MOLAN_ZHUQUE_MAX_SEGMENT_AIGC`(0.5)。
- **验证**：专项 14/14 pass；全量 **2490 tests / 74 suites / 2474 pass / 0 fail / 16 skipped**（基线 2486 → +4，耗时 49s）。

---

## 阶段记录：方案 A 落地——精准回退小说生成管线至 10 月 4 日黄金基线（单遍极质高张力起草，告别机械改写与套词灌水）(2026-11-20)

> 背景与用户指示：用户上传了《桃花剑仙》（佳云泽“防封道”搞笑反差吐槽、顾凝欣千年无情道破防心动、云光仙子识海吃瓜）优质章节文本，并明确指示回退到生成该文本的黄金版本管线（对应 Git commit `741eebf`，2026-10-04 20:18:43）。用户拍板执行【方案 A】：精准回退提示词约束与生成管线，保留 10 月中旬以来的全部编辑器工作台、SQLite/PostgreSQL 持久化防崩溃与安全硬围栏等基础设施。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/start-node22.bat`<br>`molan-home/start-node22-pg.bat` | 启动脚本默认配置回退 | 1. 将 `MOLAN_TWO_PASS_HUMANIZE` 默认值从 `1` 改回 `0`，全面恢复 10月4日 单遍极质起草模式；<br>2. 移除强制 `MOLAN_HUMANIZE_MODEL_ID=gpt-6-luna`，解除模型锁死，用户可在前端自由选择任意模型（Gemini 3.8 Flash、GPT-6 Luna 等）；<br>3. 将自检闸门 `MOLAN_HUMANIZE_GATE_ROUNDS` 默认值从 `2` 改回 `0`（关闭闸门），消除多轮强制重写延迟。 |
| `molan-home/services/humanize-policy-service.js` | 提示词边界纯净化回退 | 1. 彻底剔除 11 月中旬强加的机械化朱雀统计指标枷锁（“段均严格20~40字”、“强制清零破折号”、“必须反复灌入大水词‘什么/自己/没有/这个/知道/已经’”、“砍掉AI套路四件套”等）；<br>2. 恢复 10 月 4 日 11 条黄金文学修订边界：<br>   - 第 3 条：“保留人物自己的情绪与判断。直接心理、必要背景说明和明确转场都可使用……”；<br>   - 第 5 条：“删除重复而无效的情绪解释，不把普通词语出现当作错误，也不把所有情绪替换成咬牙、手抖等身体动作”；<br>   - 第 7 条：“保留对白中的关心、误会、尴尬、玩笑和直接请求，不强制每句话都有机锋或配微动作”；<br>   - 第 8 条：“短段和单句成段本身不是缺陷。按完整的动作、感受或思考分段，不强制每段句数，不为降低检测分机械合并或扩写”；<br>   - 第 9 条：“叙事节奏清爽凌厉，打破匀速平推（形成高困惑度与长短句剧烈落差）……”；<br>3. User 消息精简为原汁原味的自然指令，不再向大模型灌输“按网文手感拼凑大水词”的负向暗示。 |
| `molan-home/services/chat-service.js` | 采样温度回归黄金区间 | Pass 2 改写温度从 1.04 强行高温回退至天然黄金采样温度（`0.82 ~ 0.85`），消除高温导致的逻辑涣散与人物失真；单遍主流程保持 `0.82`。 |
| `molan-home/services/generation-service.js` | V2 管线默认起草解绑 | `twoPassHumanize` 参数默认逻辑由强行 `true` 改回 `Boolean(input.twoPassHumanize) || (process.env.MOLAN_TWO_PASS_HUMANIZE === '1')`，使单遍起草成为默认主流。 |

### 二、设计决策与权衡

1. **为什么 10 月 4 日的版本能写出高灵动感小说**：
   - 在 10 月 4 日的 `741eebf` 基准中，系统全局默认停用两遍洗稿（`MOLAN_TWO_PASS_HUMANIZE=0`），采用“单遍极质高张力起草”。
   - 模型在单遍写作中拥有连贯的上下文、统一的人物性格和从容的铺垫节奏。佳云泽内心独白（“老子修的是防封道啊！”）、顾凝欣纯情破防与娇嗔怒怼、云光仙子识海吃瓜的层次感得以浑然一体。
   - 11 月中旬引入的朱雀指标机械约束（段均字数死限、禁止情绪定义、强制复现大水词）本质上是对文字的“统计学阉割”，导致生动诙谐的对白和内心戏被抹平为干瘪枯燥的机械流水账。
2. **为什么不全部回退 Git Commit（方案 A 优于 方案 B/C）**：
   - 10 月 4 日至今，系统沉淀了大量关键稳定性架构：Editor Workbench 多标签联动、划选浮动改写菜单、PostgreSQL/SQLite 双持久化引擎、任务租约防崩溃重试、以及安全隔离硬围栏；
   - 若粗暴执行 `git reset --hard 741eebf`，将丢失上述全部健壮性资产，退回脆弱单库架构；
   - 方案 A 精准剔除了提示词与洗稿配置中的畸形约束，保留全部工程健壮性底座，兼具“灵动文风”与“企业级稳定性”。

### 三、真实验证证据

- **语法检测**：
  - `tools/node22_runtime/node.exe --check molan-home/services/chat-service.js`：SYNTAX OK
  - `tools/node22_runtime/node.exe --check molan-home/services/generation-service.js`：SYNTAX OK
  - `tools/node22_runtime/node.exe --check molan-home/services/humanize-policy-service.js`：SYNTAX OK
- **专项测试验证**：
  - `test/two-pass-humanize.test.js`：**7/7 pass, 0 fail (3476ms)**
  - `test/humanize-gate.test.js`：**3/3 pass, 0 fail (867ms)**
  - `test/correction-policy.test.js`：**10/10 pass, 0 fail (305ms)**
  - `test/living-prose-optimization.test.js`：**18/18 pass, 0 fail (5051ms)**
  - `test/lora-dataset-and-pipeline.test.js`：**6/6 pass, 0 fail (40ms)**
- **全量无回归测试套件验证**：
  - `tools/node22_runtime/node.exe --no-warnings --test --test-concurrency=4 "molan-home/test/*.test.js" "molan-home/test/*.test.mjs" "molan-home/test/*.test.cjs"`
  - **`2478 tests / 74 suites / 2462 pass / 0 fail / 16 skipped`**（全部 2,478 项测试 0 失败，耗时 49.8s）。

---

## 阶段记录：方案 2 落地——1,279 本真人小说全量微调数据集构建与 Qwen2.5-7B LoRA 云端/本地一体化训练与部署方案 (2026-11-20)

> 背景与用户拍板：经过 14 轮朱雀实测与《桃花剑仙》PDF 报告对比（0% 红 / 14.14% 绿 / 85.86% 黄），证实通用闭源大模型（GPT-6 / Gemini-3.8）通过纯 Prompt 或高熵分块回译的物理极限是“稳定全黄（0% 红，0% 绿，AIGC 值 0.65~0.75）”，无法稳定突破 `< 0.50` 全绿大门。用户明确指示执行【方案 2】：基于 `资源库/小说原本` 的 1,279 本真人小说构建高突发度微调数据集，微调 Qwen2.5-7B 开源模型，从底层彻底重塑 Token 条件转移概率矩阵。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/scripts/build_lora_dataset.mjs` | 新增核心工具 | 全库 1,279 本小说（48 题材）只读扫描提取引擎。实现：1. 智能编码回退（UTF-8/UTF-8-BOM/UTF-16/GB18030/GBK）；2. 广告、水印、感言、章名与噪音剔除；3. 统计特征门禁（段均长 18~52 字，对白比 8%~72%，过滤 AI 套词）；4. 构造两大去AI核心任务：`de_ai_humanize`（Pass 2 洗稿降AI）与 `outline_expansion`（Pass 1 细纲高突发度扩写）；5. 确定性洗牌（Seeded Shuffle）与 95%/5% 训练集/验证集切分；6. 输出标准 Alpaca、ShareGPT/ChatML 双格式与 LLaMA-Factory `dataset_info.json`。 |
| `molan-home/data/lora-training/` | 新增数据集资产 | 1. `train_alpaca.json`（38.69MB，5,345 条样本）；<br>2. `val_alpaca.json`（2.03MB，281 条样本）；<br>3. `train_sharegpt.jsonl`（38.91MB，5,345 条）；<br>4. `val_sharegpt.jsonl`（2.05MB，281 条）；<br>5. `dataset_info.json`（LLaMA-Factory 注册配置）；<br>6. `dataset_summary.json`（全库 1,279 本 / 5,626 样本 / 1,136.2 万字 / 818 万 tokens 统计摘要）。 |
| `molan-home/training/train_lora_llamafactory.yaml`<br>`molan-home/training/train_unsloth.py`<br>`molan-home/training/run_autodl.sh`<br>`molan-home/training/Modelfile`<br>`molan-home/training/README_TRAINING_GUIDE.md` | 新增训练与部署脚手架 | 1. `train_lora_llamafactory.yaml`：行业标准配置（Qwen2.5-7B-Instruct，LoRA rank=64, alpha=128, all-linear, lr=2e-4, bf16）；<br>2. `train_unsloth.py`：Unsloth 极速省显存微调脚本，节省 70% 显存，支持 16GB/24GB 显卡，自带 GGUF 转换；<br>3. `run_autodl.sh`：AutoDL / 算力云一键全自动化脚本（国内高速拉取模型、安装环境、微调、权重合并至 GGUF 导出，单卡 4090 约 45 分钟，花费 ~2 元）；<br>4. `Modelfile`：Ollama 本机免显卡运行模板，利用 AMD 8845HS 16 线程与 28.8GB 内存以 20~30 字/秒零成本运行；<br>5. `README_TRAINING_GUIDE.md`：详尽中文操作手册。 |
| `molan-home/lib/model/model-registry.js` | 模型能力注册 | 注册 `molan-humanizer-7b`（contextWindow=32768, recommendedRole='humanizer', cjkTokenRatio=0.65）及别名 `molan-humanizer`、`qwen2.5-7b-lora`、`molan-lora`。 |
| `molan-home/test/lora-dataset-and-pipeline.test.js` | 新增自动化测试 | 6 项自动化测试：模型注册能力与别名解析断言、生成数据集存在性与非空校验、Alpaca 结构与正文质感校验、ShareGPT 消息格式校验、dataset_info 格式校验、训练脚手架完备性校验。 |

### 二、设计决策与权衡

1. **为什么治本必须靠 LoRA 而非继续 Prompt 工程**：
   - 朱雀检测（基于腾讯 Hunyuan 骨干）的核心分类逻辑基于文本的困惑度与突发度曲率（Log-Likelihood Curvature）。通用商用闭源模型（GPT-4/6、Gemini）由于经过大规模 RLHF 对齐，Token 转移高度平滑，无论通过 Prompt 如何约束词汇，长程概率曲率依然落入 0.50~0.95 疑似AI（全黄天花板）。
   - 1,279 本真人小说微调将真实作家的短句、白话实体复现、非对称段落与语法跳跃性直接写进 Qwen2.5 注意力层权重，使得模型生成时自然落在高突发度区间，朱雀分类器因此直接给出 `< 0.50` 绿标。
2. **硬件算力分工决策（云端低成本微调 + 本机零成本高吞吐推理）**：
   - 用户机器为 AMD Ryzen 7 8845HS（核显 Radeon 780M，无独立 NVIDIA CUDA 显卡）。Windows 下缺乏对核显的 ROCm 支持，本地微调极其缓慢且有 OOM 风险；
   - 决策：在 AutoDL 上租用单卡 RTX 4090 仅需 ~1.8 元/小时，全量 5,345 条样本跑 2 个 Epoch 约 45 分钟，总花费约 2 元人民币；
   - 训练后导出 4-bit 量化 GGUF（约 4.5GB），下载回本地后直接利用 AMD 8845HS 的 16 线程与 28.8GB 内存通过 Ollama 本地运行（20~30 字/秒），无需长期付费租用云端服务器，兼顾极低成本与高吞吐。
3. **数据安全与只读保护**：
   - `资源库/小说原本` 遵循受保护约定，仅执行内存流式只读读取，绝不改动、覆盖或删除任何原始书籍文件。

### 三、真实验证证据

- **数据集生成实测**：
  - `tools/node22_runtime/node.exe molan-home/scripts/build_lora_dataset.mjs`：
  - 扫描全库 1,279 本小说原本（100% 成功），抽取 5,626 条样本、1,136.2 万字，耗时 11.0 秒。
  - 产出训练集 5,345 条（`train_alpaca.json` 38.69MB / `train_sharegpt.jsonl` 38.91MB），验证集 281 条（`val_alpaca.json` 2.03MB / `val_sharegpt.jsonl` 2.05MB）。
- **专项测试验证**：
  - `tools/node22_runtime/node.exe --no-warnings --test "molan-home/test/lora-dataset-and-pipeline.test.js"`：**6/6 pass, 0 fail (136ms)**。
- **全量无回归测试套件验证**：
  - `tools/node22_runtime/node.exe --no-warnings --test --test-concurrency=4 "molan-home/test/*.test.js" "molan-home/test/*.test.mjs" "molan-home/test/*.test.cjs"`：
  - **`2478 tests / 74 suites / 2462 pass / 0 fail / 16 skipped`**（基线 2472 项 -> 2478 项，新增 6 项测试，0 失败，耗时 49.0s）。

---

## 阶段记录：Pass 2 自检闸门（多轮择优改写，专破朱雀疑似AI）+ 全程 gpt-6-luna (2026-11-19)

> 背景：用户提供朱雀类检测报告（人工特征 85.86% / 疑似AI 14.14% / AI特征 0%），要求"生成小说全绿、用 gpt-6-luna"。
> Phase 0 取证：8845HS 核显 3GB 无法训练/推理 7B，用户放弃 LoRA 微调；语料授权元数据 `modelProcessingAllowed:false`，不改语料；确定走"零训练强化 Pass 2"路线 + 本地代理自检闸门。
> 关键认知：本地 `computeAiFlavorScore`（0-100）与外部朱雀报告百分比是两套体系，闸门只保证"本地代理信号最优"，不承诺外部报告 100% 全绿。

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/services/chat-service.js` | 新增自检闸门 | 在 `handleChat` 内新增闸门状态（`humanizeGateMaxRounds`/`humanizeRound`/`humanizeBestText`/`humanizeBestScore`/`humanizeRoundScores`/`humanizeUsageTotal`/桥接 `relayHumanizeLaunch`）。Pass 2 改写后由 `handleHumanizeRoundEnd` 跑本地朱雀代理评分（`humanizeGateReached`：score<12 且 block/glue/结构/flatCadence/压缩词汇全清零），未达标则以本轮稿+本轮实测诊断为 input 再改一轮，最多 N 轮；全程缓冲（`passthrough:false`），仅收敛时 `flushDraftAsSSE` 下发历史最优版本，前端无重复正文。闸门关闭时 `passthrough:true` + 原 `handleSecondPassEnd` 单轮逻辑逐字保留，零回归。闸门轮数由 `input.humanizeGateMaxRounds` 或 `MOLAN_HUMANIZE_GATE_ROUNDS` 显式开启（默认 0=关闭）。`finalizeUsage` 改用累计 `humanizeUsageTotal` 保证多轮计费准确。 |
| `molan-home/start-node22.bat`<br>`start-node22-pg.bat` | 配置固化 | 新增 `MOLAN_HUMANIZE_MODEL_ID=gpt-6-luna`（Pass 2 强制；Pass 1 由前端选 gpt-6-luna，`resolveSecondPassRoute` 同模型时回退 primaryRoute 正好是 gpt-6-luna）+ `MOLAN_HUMANIZE_GATE_ROUNDS=2`（额外改写上限）。 |
| `molan-home/test/humanize-gate.test.js` | 新增专项测试 | 3 项：未达标多轮改写→达标择优下发且无重复正文、轮次用尽下发历史最优、`gateRounds=0` 单轮零回归。 |

### 二、设计决策与权衡

- **同族两遍**：Pass 1=Pass 2=gpt-6-luna，失去跨家族（Gemini→GPT）多样性去味优势，靠闸门多轮 + 跨轮靶向诊断传递补回一部分。选择依据是用户明确指定"全程 gpt-6-luna"。
- **闸门默认关闭**：仅在环境变量显式配置时启用，保护测试与其他调用方的单轮行为，避免 SSE 分块方式变更带来的回归风险。真实运行环境由启动脚本显式打开。
- **本地代理而非外部 API**：用户未提供朱雀接口密钥，闸门用项目现成 `computeAiFlavorScore` + `zhuqueSignals`；已预留未来接外部真实分数的可能（改 `humanizeGateReached` 判定源即可）。
- **择优回退**：多轮中若后续轮反而变差，取分数最低轮下发；空输出/异常回退到历史最优而非总是初稿。

### 三、真实验证证据

- `node --check services/chat-service.js`：SYNTAX OK。
- 闸门专项：`node22_runtime/node.exe --test test/humanize-gate.test.js`：**3/3 pass**。日志实证 `score 30→不达标→retry→score 8→达标收敛`，`roundScores=[30,8]`、`reached=true`。
- 全量回归：`node22_runtime/node.exe --test test/*.test.js test/*.test.mjs test/*.test.cjs`：**2472 tests / 73 suites / 2456 pass / 0 fail / 16 skipped**（基线 2468 → 新增 4，零失败）。

### 四、待确认 / 运维提醒

- 前端 Pass 1 需在模型选择里设为 gpt-6-luna（默认模型由管理项 `currentDefaultModel` 控制，未在代码里越权覆盖用户偏好）。
- 若部署到 ECS（systemd）需注入同样的 `MOLAN_HUMANIZE_MODEL_ID=gpt-6-luna`、`MOLAN_HUMANIZE_GATE_ROUNDS=2`、`MOLAN_TWO_PASS_HUMANIZE=1` 环境变量才生效；本次未部署。
- "全绿"验收仍以外部朱雀报告为准；建议对同一初稿跑"闸门开/关"对照，确认外部疑似AI 是否实际下降。

---

## 阶段记录：全量 1,279 本真人小说语料 60 维对比与 `gpt-6-luna` / `gemini-3.8-flash` 专属校准 (2026-11-19)

### 一、全量语料实测发现（`资源库/小说原本` 1,279 本 / 3,821 切片 / 49 题材）

| 维度 | 1,279 本真人小说（P25..中位..P75） | 此前 AI 样本 | 根因修正方向 |
| :--- | :---: | :---: | :--- |
| **平均段长 `paraMean`** | `22.5 .. 27.6 .. 35.0` 字（76% ≤40 字，81~150 字段中位数 `0%`） | `42.3 ~ 55.6` 字 | 停止强行合并为 90~180 字散文大方块，恢复手机网文 1~2 句（24~38 字）轻快分段 |
| **每段句数 `sentsPerPara`** | `1.06 .. 1.14 .. 1.27` 句（`97%` 纯叙述段为 1 句多逗号顺完） | `1.78 ~ 2.33` 句 | 取消对正常 1 句叙述段的负分误杀，仅对 `<=14` 字空泛碎断语保留 `C07-02` 告警 |
| **词汇密度 `bigramTTR`** | **`0.780 .. 0.810 .. 0.830`**（49 题材全部 `<=0.822`） | **`0.860 ~ 0.900`** | 放开高频日常词自然复现（`什么/自己/没有/这个/知道/已经/怎么/时候/还是/不过/他她我你`），打破 AI 过度浓缩感 |
| **“的”字与标点分布** | `的=30.4/k`、`句号=29.0/k`、`逗句比=1.94`、`感叹号=2.8/k`、`省略号=1.3/k`、`破折号=0.0` | `的=3.6~10.5`、`句号=38~50`、`感叹号=0` | 恢复日常“的”字（20~32/k）、多逗号流畅长句（>45 字占 10~19%）与自然感叹/省略号，保持破折号清零 |

### 二、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/services/chat-service.js` | 严格模型约束 | 移除 `gpt-5.6-sol`/`gpt-5.6-luna`/`gpt-5.6-terra` 自动路由，默认异构 Pass-2 仅使用 **`gpt-6-luna`**（`reasoning_effort: 'low'`、`presence_penalty: 0`、`frequency_penalty: 0`），失败时回退原 Pass-1 模型（`gemini-3.8-flash-acp` / `gemini-3.8-flash`）。 |
| `molan-home/lib/ai-flavor-detector.js`<br>`molan-home/correction-policy.js`<br>`molan-home/lib/character-material.js` | 1,279 本语料基线校准 | 1. `ai-flavor-detector.js` 在 `zhuqueSignals` 新增 `bigramTtr`、`overCompressedVocabRisk`（`>=0.855`）、`paraMean`，取消正常单句叙述段扣分并将 `overPolishedSensoryRisk` 阈值对齐真人 `deMod` 分布（`>=38`）；<br>2. `correction-policy.js` 将 `C07-02` 收敛至 `<=14` 字过短碎段，`[标点指纹]` 改为破折号清零 + 感叹号合理区间；<br>3. `character-material.js` `maxDeMod` 默认放宽至 `34`（匹配真人 P75=`31.6`），避免过滤掉 80% 真实网文范本。 |
| `molan-home/services/humanize-policy-service.js` | Pass-2 改写边界全面对齐真人共性 | 重写 `buildHumanizePassMessages` 诊断与 9 条改写边界：对齐段均 `25~38` 字、多逗号顺口长句、放开大白话高频词复现（目标 `bigramTTR 0.78~0.83`）、正常用“的”字、清零破折号与去 AI 套路四件套；保留 `不强制每段句数`。 |
| `molan-home/test/living-prose-optimization.test.js`<br>`index.html` / `boot-*.js` / `pages/*.html` | 测试同步与版本戳递增 | 方案 B 单测切换为 `gemini-3.8-flash-acp → gpt-6-luna` 异构路由与 502 回退校验；前端受保护资产版本戳同步递增至 `20261119_human1279_v1`。 |

### 三、真实验证证据

- **1,279 本基线对比实测（仅用允许模型）**：
  - `gpt-6-luna(low)` 直接按 1,279 本真人共性生成（`1449` 字，`30.1s`）：`paraMean = 30.8`、`sentsPerPara = 1.06`、`maxConsecNarr = 11`、`periodsPerK = 30.4`、`commaPeriodRatio = 2.50`、`pronounsPerK = 21.4`、**`bigramTTR = 0.814`**（全指标落入 1,279 本真人 P25~P75 核心带）。
  - Live Generation V2 端到端闭环（`http://127.0.0.1:3000`，`pid: 47964`，`waiting_author`，`121.5s`）：日志 `[chat] two-pass completed first=gemini-3.8-flash-acp second=gpt-6-luna hetero=true score=19->23 chars=1564`，`flavorScore = 23`（`passed = true`）、`flatClusterCount = 0`、`llmGluePerKilo = 0`、`correctionFindings = 0`、`deModifierPerKilo = 23.78`。
- **全量回归与审计（最终代码编辑后执行）**：
  - `..\tools\node22_runtime\node.exe --no-warnings --test --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"`：**`2469 tests | 73 suites | 2453 pass | 0 fail | 16 skipped`**（耗时 `37166.68ms`）；
  - `production-import-audit.mjs`（234 文件）、`audit-golden-suite.mjs`（80 tasks）、`check-frontend-stamp.mjs`（`20261119_human1279_v1`）全部退出码 `0`。

---

## 阶段记录：方案 B 二次标定——零罚项原词复现、`gpt-5.6-sol` 首选与真实绿色样本双轨规则 (2026-11-18)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/services/chat-service.js` | 异构优先级调优与清零避重罚项 | 1. 基于真实可用性消融实测（`deepseek-v4-flash/pro` 402、`gpt-5.5/5.4` 下线、`gpt-6-luna` `effort=none` 段长趋平），将异构 Pass-2 默认优先级调整为 **`gpt-5.6-sol → gpt-5.6-luna → gpt-6-luna(low) → gpt-5.6-terra`**；<br>2. 将 `buildSecondPassBody` 温度提升至 **`1.04`**，并**清零 `presence_penalty` / `frequency_penalty`（均置 `0`）**，取消迫使模型做“铁盒子 → 旧铁箱/这东西”同义词轮换避重的 AI 平滑指纹，还原真人大白话直接复现核心实体词的习惯。 |
| `molan-home/services/humanize-policy-service.js` | 双题材绿色范式重构 | 对标用户实测朱雀可过绿真实样章提炼 9 条改写边界：`禁止同义词避重`、`砍掉天气引子/外貌三件套/静音转场/暗处凝视收尾`、`实操试错步骤 + 允许动作后跟 4~12 字客观结果短行`（同时保留 `不强制每段句数`）；并按题材启用**`轻喜/脑洞/甜宠` 高困惑度口语吐槽反差通道**与**主流题材纯实体白描动作链通道**，在 `user` 提示强化兼顾 `120~200` 字长细段与 `4~25` 字短行，防止均长方块段落。 |
| `molan-home/test/living-prose-optimization.test.js` | 回归断言同步 | 更新方案 B 异构 Pass-2 测试断言以验证 `temperature >= 1.0` 且 `presence_penalty === 0`、`frequency_penalty === 0`。 |

### 二、真实验证证据

- **Live 端到端完整闭环实测**（`http://127.0.0.1:3000`，`pid: 32760`，Generation V2 `urban_martial`，状态 `waiting_author`）：
  - 服务日志确认：`[chat] two-pass completed first=gemini-3.8-flash-acp second=gpt-5.6-sol hetero=true score=22->44 chars=1149`（本地分值因全篇采用《凡人》式偏短干脆句导致句长标准差比降至 `0.5267`）；
  - 核心朱雀防红指纹：**`deModifierPerKilo = 3.6397`**、`paragraphUniformity = 0.6095`、`llmGluePerKilo = 0`、`exclamationCount = 0`、`dashCount = 0`、`correctionFindings = 0`、`qualityScore = 0.88`。
- **全量回归与审计（最终代码编辑后执行）**：
  - `..\tools\node22_runtime\node.exe --no-warnings --test --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"`：**`2469 tests | 73 suites | 2453 pass | 0 fail | 16 skipped`**（耗时 `38361.06ms`）；
  - `production-import-audit.mjs`（234 文件）、`audit-golden-suite.mjs`（80 tasks）、`check-frontend-stamp.mjs`（`20261118_living_v4`）全部退出码 `0`。
  - Live 服务健康检查：`ok: true, db: "ready", novels: 1, activeChatStreams: 0`。

---

## 阶段记录：方案 B「跨模型异构高温 Pass 2 + 低修饰《小说原本》大白话重构」(2026-11-18)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/services/chat-service.js` | 跨家族异构 Pass-2 路由与缓存回退修复 | 1. 新增 `resolveRouteForModel` 与 `resolveSecondPassRoute(excludeIds)`：在 Pass 1 属于 Gemini 模型且开启两遍模式时（排除 `benchmarkProtocol`/`editorOnly`/`mock` 占位与 unit-test 单模型桩），按优先级（`gpt-5.6-luna → deepseek-v4-flash → gpt-5.5 → gpt-5.4` 或 `input.reviseModelId`/`MOLAN_HUMANIZE_MODEL_ID`）自动切换至非 Gemini 异构模型执行 Pass 2，发送高温（`>=0.93`）与 `presence_penalty`/`frequency_penalty`（`>=0.25`），非 ACP 推理模型 Pass 2 默认使用 `low` 推理强度以兼顾耗时；<br>2. 修复 `isUnsupportedCacheError(statusCode, text, fbBody)` 检查 `fallbackBody` 而非仅检查 Pass-1 闭包 `cacheFallbackBodyObj`，并在异构 Pass-2 请求中跳过 `prompt_cache_options: { mode: 'explicit' }`，根除 `HTTP 400: prompt_cache_options is not supported on this model`；<br>3. 增加 `failedHeteroIds` 多级回退与错误诊断透传（先尝试下一顺位异构模型，若仍未输出则回退 Pass-1 原模型或初稿），并在 `molan_rewrite` 与 `molan_usage.aiFlavor.rewrite` 记录 `secondPassModelId`/`heterogeneous`/`heteroFallbackUsed`。 |
| `molan-home/services/humanize-policy-service.js`<br>`molan-home/lib/ai-flavor-detector.js`<br>`molan-home/correction-policy.js` | 抗朱雀标点限流、碎行合并与 Pass-2 结构重构 | 1. `ai-flavor-detector.js` 在 `zhuqueSignals` 新增 `exclamationCount`、`dashCount`、`exclamationPerKilo`、`dashPerKilo`、`punctuationOverloadRisk`（感叹号 >4.5/k 或破折号 >3/k 计罚）；<br>2. `correction-policy.js` `buildTargetedCorrectionGuidance` 扫描并注入 `[标点指纹]` 告警（限制整章感叹号 <=2、破折号 <=1）；<br>3. `humanize-policy-service.js` `buildHumanizePassMessages` 将实时统计警报（单句独立旁白数、连续均长句簇数、“的+名词”千字密度、感叹号/破折号数）置于 `user` 消息首行，并在改写边界 1~9 强化“重讲句法语序、合并单句旁白碎行（最多留 <=3 处，同时不强制每段句数）、45~85 字长复句穿插 3~9 字极短口语、感叹号<=2/破折号<=1、放宽口语省略但严禁错别字乱码”及 `maxDeModifierPerKilo: 15` 范本约束。 |
| `molan-home/lib/character-material.js` | 低修饰语《小说原本》示范优选 | 新增 `countExemplarDeModifiers`，在 `buildLivingProseExemplarBlock` 优先筛选“……的+名词”低密度（默认 `<=16`/千字，支持 `options.maxDeModifierPerKilo`）的零 AI 味原著大白话样本，候选不足时回退完整 `zeroFlavor` 池。 |
| `molan-home/test/living-prose-optimization.test.js` | 方案 B 回归与异构路由测试 | 新增方案 B 综合测试（第 18 项）：校验 `maxDeModifierPerKilo` 范本筛选、`punctuationOverloadRisk`/`[标点指纹]` 检测、`Gemini ACP Pass 1 → gpt-5.6-luna HTTP Pass 2` 跨家族自动路由，以及异构 HTTP 502 时无损回退原 ACP 模型的闭环。 |
| `molan-home/index.html`<br>`boot-head.js`/`boot-scripts.js`/`pages/*.html` | 版本戳同步递增 | 因 `correction-policy.js` 与 `character-material.js` 属受保护前端资产，版本戳由 `20261118_living_v3` 同步递增至 `20261118_living_v4`。 |

### 二、设计决策与权衡

- **选用方案 B（非 Gemini 异构 Pass 2 + 低修饰《小说原本》重写）而非继续纯 Gemini 单家族调参**：实测朱雀 AI 检测对单家族 Gemini ACP 固定解码路径下的分布平滑度与情绪标点（感叹号/破折号）极度敏感；通过 Pass 1 Gemini 生成剧情底稿、Pass 2 跨家族由 `gpt-5.6-luna`（高温 `0.93`、`reasoning_effort: 'low'`）结合实测指标警报重讲句法，可显着打散原家族概率峰并保留 100% 事实，且异构上游失败时自动回退保障不中断创作。

### 三、真实验证证据

- **Live 端到端跨模型实测**（`http://127.0.0.1:3000`，`pid: 43108`，Generation V2 `urban_martial`）：
  - 服务日志确认执行路径：`[chat] two-pass completed first=gemini-3.8-flash-acp second=gpt-5.6-luna hetero=true score=19->16 chars=1387`；
  - 产出 `1387` 字实测样章指标：**`flavorScore = 16`（`passed = true`）**、`sentenceStdRatio = 0.8603`、`paragraphUniformity = 0.7224`、`sentenceBurstiness.cv = 0.6333`（`4~66` 字、`flatClusterCount = 1`）、`deModifierPerKilo = 11.2697`、`plainShortRatio = 0.4211`、`llmGluePerKilo = 0`、`exclamationCount = 0`、`dashCount = 0`、`correctionFindings = 0`。
- **全量回归与审计（最终编辑后执行）**：
  - `..\tools\node22_runtime\node.exe --no-warnings --test --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"`：**`2469 tests | 73 suites | 2453 pass | 0 fail | 16 skipped`**（耗时 `37504.4ms`）；
  - `production-import-audit.mjs`（234 文件）、`audit-golden-suite.mjs`（80 tasks）、`check-frontend-stamp.mjs`（`20261118_living_v4`）全部退出码 `0`。
  - Live 服务清理后健康检查：`ok: true, db: "ready", postgres.serverVersion: "18.6", novels: 1, activeChatStreams: 0`。

---

## 阶段记录：破除 Gemini 过度精雕定语腔与恢复《小说原本》自然段长错落 (2026-11-18)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/lib/composition/ir/ir-lowering.js`<br>`molan-home/lib/composition/corpus/evidence-catalog.js`<br>`molan-home/correction-policy.js` | 去过度感官精雕提示 | 解除多层提示中强制“每句感官锚点 + 物理修饰定语 + 三逗号动作结果”的雕琢导向：修改 `renderForGemini`、`evidence-catalog.js`（`card_sensory_living_detail`、`card_sentence_cadence_breathing`、`card_suspense_physical_clue`）及 `UNIVERSAL_CORRECTION_POLICY_PROMPT` 核心指南，改为主张“至少一半以上叙述句直白说事、一页只留 1~2 处核心锚点、允许 10~45 字口语短段与长段自然错落”。 |
| `molan-home/lib/ai-flavor-detector.js`<br>`molan-home/services/humanize-policy-service.js` | 定语过载诊断与 Pass-2 降雕琢 | `ai-flavor-detector.js` 在 `metrics.zhuqueSignals` 新增 `deModifierPerKilo`（“……的+名词”千字密度）、`plainShortRatio`（<=16字平实短直句占比）与 `overPolishedSensoryRisk`；`humanize-policy-service.js` 在命中过载时注入实测告警，并在改写边界 8/9 要求删掉日常器物冗余视觉定语、放开真人网文长短段差与讲故事口吻，严禁以错别字/乱码凑分。 |
| `molan-home/lib/character-material.js` | 范本过滤加严 | `EXEMPLAR_AI_CLICHE_GUARD` 新增过滤强煽情套话（如 `空气里弥漫`/`若有若无`/`如在吞咽`/`火烧火燎`/`鲜花着锦`/`十八层地狱`），使抽选的《小说原本》参照更贴近真实网文口吻。 |
| `molan-home/index.html`<br>`boot-head.js`/`boot-scripts.js`/`pages/*.html` | 版本戳同步递增 | 因 `correction-policy.js` 与 `character-material.js` 属受保护前端资产，版本戳由 `20261118_living_v2` 同步递增至 `20261118_living_v3`。 |

### 二、真实验证证据

- **Live 对照实测**（`http://127.0.0.1:3000`，`pid: 35304`，`gemini-3.8-flash-acp`，同提示词 `urban_martial`）：
  - 与上一版（`1396` 字、`paragraphCV = 0.426`、`deModifierPerKilo = 35.77`、`aiScore = 27`）相比，新样本（`946` 字，`waiting_author`，`quality.score = 0.88`，`passed = true`）将 **`deModifierPerKilo` 降至 `26`（降幅 ~27%）**、`paragraphCV` 提升至 **`0.5471`**、`aiScore` 降至 **`8`**、`scanCount = 0`、`textureScore = 100`。
- **全量回归与审计（最终编辑后执行）**：
  - `..\tools\node22_runtime\node.exe --no-warnings --test --test-reporter=spec --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"`：`2468 tests | 73 suites | 2452 pass | 0 fail | 16 skipped`（耗时 `37871.8ms`）；`production-import-audit.mjs`（234 文件）、`audit-golden-suite.mjs`（80 tasks）、`check-frontend-stamp.mjs`（`20261118_living_v3`）均退出码 `0`。

---

## 阶段记录：《纠错库》全链路接通与抗 AI 检测统计学特征（高困惑度+高突发性）强化 (2026-11-18)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/services/generation-service.js`<br>`molan-home/services/model-call-service.js`<br>`molan-home/services/chat-service.js` | 修复 V2 两遍《纠错库》断层 | 1. 定位并修复核心断层：此前 `content-engine.js` 传递 `stage: 'writer'`（非 `'writing'`）且 `model-call-service.js` 对 `requireComplete: true` 自动附加 `benchmarkProtocol = 'benchmark-local-v2'`，导致 `chat-service.js` 中 `correctionEnabled` 与 `twoPassHumanize` 双双失效（《纠错库》与 Pass 2 均未实际运行）；<br>2. `generation-service.js` 将内部 `writer` 调用规范映射为 `stage: 'writing'` 并传入 `disableBenchmarkProtocol: true`（保留 `requireComplete: true` 完整性校验，不干扰独立 `benchmark` 对照路由）；<br>3. `chat-service.js` 在 `twoPassHumanize` 已剥离第一遍纠错的前提下，对 `>=200` 字初稿默认强制进入 Pass 2《纠错库》靶向改写（除非显式 `allowSkipHumanize: true`），同时接入 `zhuqueSignals` 风险判定。 |
| `molan-home/correction-policy.js` | 泛化《纠错库》规则与靶向对照 | 1. 扩充 `UNIVERSAL_CORRECTION_RULES` 泛化捕获《逆天重生》以外任意新书中的同类病灶：`R-01` 声音装饰模板（`发出……的钝响/闷响/脆响`）、`R-04` 情绪压回二次解释（`吸了口气把……压回`）、`R-13` `视线落在/转向`、`R-14` `嘴角扯起/翘起/挑起`、`R-41` 隐形翻译腔修饰链（`某种类似……般`、`悄无声息地`、`硬生生`、`平静得有些`、`正顺着……往……涌`）；<br>2. 优化 `UNIVERSAL_CORRECTION_POLICY_PROMPT` 解除“每段固定 60~120 字”的机械分镜引导；`buildTargetedCorrectionGuidance` 新增一般“盯”字超限（`R-46`）与单句独立段超标（`C07-02`）定位及 `EXTRA_CORRECTION_PAIR_BY_RULE` 原句→改写示例。 |
| `molan-home/lib/ai-flavor-detector.js`<br>`molan-home/lib/style/human-texture.js`<br>`molan-home/lib/style-fingerprint.js` | 朱雀统计维度与题材指纹对齐 | 1. `style-fingerprint.js` 新增 `GENRE_FINGERPRINT_ALIASES`，打通 `modern_romance`、`urban_martial`、`xuanhuan`、`suspense` 等英文 UI 题材 ID 与 `style-fingerprints.json` 真实语料桶匹配；<br>2. `ai-flavor-detector.js` 新增 `LLM_GLUE_TERMS`（大模型高概率平滑连接/修饰词）与 `analyzeSentenceBurstiness`（句长极差、变异系数与连续均长句簇），输出 `metrics.zhuqueSignals`；<br>3. `human-texture.js` 新增泛化情绪压回、翻译腔与 `single_sentence_paragraph_overflow` 检测（保留干净物理音 `发出一声脆响` 不误伤）。 |
| `molan-home/services/humanize-policy-service.js` | Pass-2 困惑度/突发性重构 | `buildHumanizePassMessages` 将 `zhuqueSignals`（`llmGlueHits`、句长突发性 CV、连续均长句簇、`C07-02` 孤立单句数）注入实测诊断，并在改写边界 8/9/11 条要求拉开长段（130~240 字）与短句（3~12 字）落差、清零模型连接词与“电影镜头收尾模板”，严禁靠错别字/乱码凑分。 |
| `molan-home/test/living-prose-optimization.test.js` | 新增端到端回归用例 | 新增 2 项测试（累计 17 项），覆盖英文题材指纹桶命中、泛化《纠错库》与朱雀维度命中，以及 `chat-service` `>=200` 字初稿不跳过第二遍《纠错库》改写。 |

### 二、真实验证证据与前后对比数据

- **同一提示词基线 vs 优化后端到端对比**（`http://127.0.0.1:3000`，`pid: 39528`，`gemini-3.8-flash-acp`，`urban_martial`）：
  - **优化前基线**（`1035` 字）：《纠错库》命中 `11` 处（`R-01`/`R-04`/`R-13`/`R-14`/`R-41`）、肌理分 `18`（9 条套路 + 单句段溢出 `6` 处）、LLM 高频胶水词 `5.994/千字`（6 处）、连续均长句簇 `2` 组、`uniformCadenceRisk = true`。
  - **优化后实跑**（`1396` 字，`waiting_author`，`quality.score = 0.88`，`passed = true`）：《纠错库》命中降至 **`0` 处**、肌理分升至 **`100` 分**（0 条套路）、LLM 高频胶水词降至 **`0/千字`**、连续均长句簇降至 **`0` 组**、句长极差 `71 → 94`（`7~101` 字，CV `0.5503 → 0.5966`）、孤立单句叙述段 `6 → 3` 处、`uniformCadenceRisk = false`。
  - **外部网站验证边界说明**：已通过内置浏览器在 `https://matrix.tencent.com/ai-detect/ai_gen` 核实游客模式可免费检测 `>350` 字文本（无需账号登录），但点击 `立即检测` 后弹出腾讯人机验证码（`captcha.gtimg.com`）；遵循安全规则不绕过验证码，未直接代点提交外部检测。
- **全量回归与审计（最终编辑后执行）**：
  - `..\tools\node22_runtime\node.exe --no-warnings --test --test-reporter=spec --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"`：`2468 tests | 73 suites | 2452 pass | 0 fail | 16 skipped`（耗时 `37855.5ms`）；`test/living-prose-optimization.test.js`（17 项）、`test/human-texture.test.js`、`test/correction-policy.test.js`（共 30 项）全通过；`production-import-audit.mjs`、`audit-golden-suite.mjs`、`check-frontend-stamp.mjs` 均通过。

---

## 阶段记录：全题材「活人感」生成管线深度优化——打通《小说原本》范本与《纠错库》靶向精修闭环 (2026-11-18)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/lib/character-material.js` | 原著活人示范与匿名化纠偏 | 1. 修复 `isParagraphNameCandidate` / `ANON_NAME_TAIL_BLOCK` / `ANON_FALSE_POSITIVE_PHRASES` 与 `isBrokenAnonymizedText`，阻止将“那是/于是/那个/全区频/鱼竿/马上走”等误伤成破碎 `【人X】` 占位符；`normalizeCharacterMaterialRequest` 显式保留 `includeParagraphExemplars`；<br>2. 新增 `PARAGRAPH_GENRE_ALIASES`（覆盖全部中文子类及 `modern_romance` / `scifi_apocalypse` / `suspense` 等界面英语 ID）、`EXEMPLAR_AI_CLICHE_GUARD`、`EXEMPLAR_NOISE_GUARD`（过滤作者求票/寄存脑子等非正文噪音）、`isCleanExemplarSample` 与 **`buildLivingProseExemplarBlock`**：从源自《资源库/小说原本》的 48 类 `paragraph-samples.json` 中抽选 `flavorScore === 0`（零 AI 味）的干净真人原著片段（直接采用纯净原文而非破损 `【人X】` 替换，并继续接入 12 字防抄袭重叠扫描）；<br>3. `buildCharacterMaterialBlock` 在 `raw` 与 `auto` 模式下均支持按 `includeParagraphExemplars: true` 直接注入原著活人笔触参照。 |
| `molan-home/lib/generation/corpus-archetypes.js` | 46 题材语料经验打通 | 升级 `compileGenreDirective` 与 `compileStyleDirective`：新增 `EMPIRICAL_GENRE_ALIASES`（含界面 `GENRE_FAMILY_MAP` 英文键映射）、`STYLE_NAME_ALIASES` 与中文子题材精确/包含匹配，解决此前传入中文题材名或界面家族 ID 无法命中 `corpus-empirical-rules.json` 46 类 1276 部小说经验规则的问题。 |
| `molan-home/lib/composition/ir/ir-lowering.js` | Gemini 家族专属下沉渲染 & P4 渲染补齐 | 1. `resolveModelFamily` 新增识别 `gemini`，新增 `renderForGemini` 专属渲染器（强调活人对话、感官细节与长短句呼吸）；<br>2. 修复 `cascade.P4_GENRE_POLICY` 遗漏 `genre.description` 导致 46 类语料经验法则在 V3 编译链路静默丢失的断层。 |
| `molan-home/lib/composition/compiler/strategy-compiler.js`<br>`molan-home/lib/composition/corpus/evidence-catalog.js` | 通用活人策略卡补全 & 家族透传 | `compileChapterStrategy` 显式透传 `modelFamily`；`evidence-catalog.js` 新增 3 张跨题材 A 级策略卡（`card_living_dialogue_subtext` 活人口语潜台词、`card_sensory_living_detail` 日常感官anchors、`card_sentence_cadence_breathing` 句式呼吸参差律）。 |
| `molan-home/lib/generation/content-engine.js`<br>`molan-home/lib/generation/run-context.js` | 题材自适应风格、原著示范与 V2 入参透传 | 1. `run-context.js` `normalizeGenerationRequest` 透传 `novelGenre`/`genreFamily`/`writingStyle`/`styleArchetype`/`chapterFunction`/`chapterFocus`/`endingHook` 并将默认 `modelParams.temperature` 统一为 `0.85`；<br>2. `compileDraftPrompt` 过滤 `neutral_default` 兜底风格包，取消非冷硬题材被锁死 `laobai_restrained`（“老白冷硬克制”），按题材自动匹配风格与 `genre.family`、去除 `defaultStateDelta` 模板套话并在 V3 与非 V3 回退分支均注入 `buildLivingProseExemplarBlock`；`buildDraftRequest` 默认起草 `temperature` 设为 `0.85`。 |
| `molan-home/lib/generation/inplace-sanitizer.js` | 上下文保真纠偏 | 将 `template_smile` 拆分为敌意冷笑与温和/日常笑意两组替换，避免把言情/日常笑容改写为“冷冷吐出半句话”；修复 `dead_silence` 替换为中性安静描写，绝不凭空编造“雨水滴落声”。 |
| `molan-home/correction-policy.js`<br>`molan-home/lib/correction-library.js` | 《纠错库》去玄幻硬编码 & 靶向诊断对齐 | 1. 通用化 `R-47`/`R-50`，移除“功德簿墙/圣王/符箓/道法破绽”等单一题材预设词，全面适配言情、都市、悬疑、历史、科幻、玄幻等全题材；<br>2. 修复 `RULE_TYPE_HINTS` 错配（如 `R-14-template-smile` 对齐 `搭配不当`、`R-20-contrast-cliche` 对齐 `对比句式`）与 `scanRepetition` 的 `currentCount` 读取；扩充 `sanitizeCorrectionCaseName` 脱敏范围；<br>3. 新增导出 **`buildTargetedCorrectionGuidance`**：结合 `scanUniversalCorrectionRisks` 实测命中与 `cases.json` 217 条《纠错库.md》人工案例，输出脱敏后的逐项病灶定位与「原句 → 修正句」对照示范。 |
| `molan-home/services/humanize-policy-service.js`<br>`molan-home/services/chat-service.js` | Pass-2 靶向诊断与原著示范闭环 | 1. `buildHumanizePassMessages` 修复 `structuralRisks`（对象计数）、`sentenceStdRatio`/`paragraphUniformity` 与 `analyzeHumanTexture().cliches` 读取，传参对齐 `maxExcerptChars`，确保实测诊断、《纠错库》对照与《小说原本》范本完整送入 Pass 2；<br>2. `chat-service.js` 为 `writing` 写作请求开启 `includeParagraphExemplars` 且在 `precompiledPrompt` 已含范本时不重复双份注入；在 `handleFirstPassEnd` 联跑 `scanUniversalCorrectionRisks` 与 `analyzeHumanTexture` 触发 Pass 2，在 `handleSecondPassEnd` 记录 `correctionHitsBefore`/`After`，并为推理模型留足 `secondMaxTokens`（`>= 6144`）。 |
| `molan-home/services/generation-service.js`<br>`molan-home/completion-editor.js`<br>`molan-home/start-node22*.bat` | V2 入口参数补全、语法修复 & 缓存戳升级 | `generation-service.js` 在 `passedStyle.source === 'neutral_default'` 时不覆盖自适应题材风格，并默认构造 `characterMaterial`（`mode: 'raw'`, `includeParagraphExemplars: true`）；修复 `completion-editor.js` `runChapterWorkflowV2` 重复声明 `stageNode` 导致的语法报错，透传 `characterMaterial`、思考强度与界面题材/风格/功能/侧重点/钩子；`start-node22.bat` / `start-node22-pg.bat` 默认启用 `MOLAN_TWO_PASS_HUMANIZE=1`；前端版本戳升级至 `20261118_living_v1`。 |
| `molan-home/test/living-prose-optimization.test.js` | 新增自动化验证 | 新增 15 项全链路单测、语法校验与 `chat-service` Pass-1/Pass-2 集成测试，覆盖零 AI 味原著样本筛选、噪音与破碎占位符过滤、防抄袭、46 题材与英文 ID 命中、Gemini 渲染、`run-context` 透传、自适应文风、纠错库靶向诊断对齐、Pass-2 诊断透传及单份范本去重。 |

### 二、设计决策与权衡

1. **优先复用零 AI 味《小说原本》整段范本（`buildLivingProseExemplarBlock`），不额外叠加耗时审校模型调用**：
   - 原 `strong` 模式在每次写章前会触发最多 3 次外部 `character-material-review` 审校模型请求，延迟高且受外部分片审批门禁限制（`profilesPublished: false` 时直接无样本可用）。
   - 本次改为从 `data/paragraph-samples.json`（源自《资源库/小说原本》48 个题材分类）直接按题材与场景过滤出 `flavorScore === 0` 且语法未破损的真人名作片段（每章 2 段），同时保留 `scanCharacterMaterialOverlap` 12 字重叠防抄袭扫描，零额外网络延迟即可向模型提供真实活人语感参照。
2. **保持 `isTwoPassHumanizeEnabled` 单元默认行为契约，通过启动脚本与 Generation V2 入参默认开启**：
   - `test/two-pass-humanize.test.js` 显式断言未传标志且未设环境变量时 `isTwoPassHumanizeEnabled('writing', {}) === false`。因此保留函数默认签名不变，由 `generation-service.js`（已显式 `twoPassHumanize: true`）及 `start-node22.bat` / `start-node22-pg.bat`（默认 `MOLAN_TWO_PASS_HUMANIZE=1`）在真实运行态开启两遍精修，兼顾向后兼容性与实效。
3. **Pass 2 精修由“全量否定规则堆砌”改为“逐篇实测病灶 + 纠错库原句对照 + 原著活人示范”**：
   - 仅堆砌几十条“禁止 XX”容易让模型缩手缩脚、把对白压干；改为把本篇初稿真实命中的《纠错库》条文/套词、`cases.json` 中的具体「原句 → 修正句」改法以及同题材零 AI 味原著示范一并交给 Pass 2 编辑，既精准切除 AI 腔又保留各题材应有的人物温度与节奏。

### 三、真实验证证据与测试数据

- **全量测试套件**（`..\tools\node22_runtime\node.exe --no-warnings --test --test-reporter=spec --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"`）：`2466 tests | 73 suites | 2450 pass | 0 fail | 16 skipped`。
- **专项测试**（`.\tools\node22_runtime\node.exe --test molan-home/test/living-prose-optimization.test.js`）：`15 tests | 15 pass | 0 fail`。
- **全量 JS 语法检查**：813 个 `.js/.mjs/.cjs` 文件 `node -c` 校验 0 错误（已修复 `completion-editor.js` 重复声明 `stageNode` 问题）。
- **架构与门禁审计**：
  - `.\tools\node22_runtime\node.exe molan-home\scripts\check-frontend-stamp.mjs`：通过（`20261118_living_v1` 放行，exit 0）。
  - `.\tools\node22_runtime\node.exe molan-home\scripts\production-import-audit.mjs`：通过（扫描 234 个生产核心文件，零违规，exit 0）。
  - `.\tools\node22_runtime\node.exe molan-home\scripts\audit-golden-suite.mjs`：通过（`GOLDEN INPUT SUITE PASS tasks=80`，exit 0）。
  - `.\tools\node22_runtime\node.exe molan-home\scripts\audit-features.mjs`：8 个核心功能合约 `contracts=8, failed_contracts=0, unknown_markers=0`（因历史已有 `unmapped_controls=49` 导航/外围 UI 控件基线返回 exit 1）。
- **本机 PG 18.6 + Live 服务重启与跨题材端到端生成实测**（`http://127.0.0.1:3000`，`pid: 29172`，`MOLAN_TWO_PASS_HUMANIZE=1`、`gemini-3.8-flash-acp`）：
  - **青春甜宠 (`modern_romance`)**：任务 `c8e14f07-6d04-4245-a18e-47f4438d5fc9`，生成 `1310` 字，`quality.score = 0.88`、`passed = true`、`errorCode: ""`，未回落为冷硬风格，`【人X】` 破损占位符 `0` 处，对白与细节自然生动；
  - **悬疑探案 (`suspense`)**：任务 `0e99b9c8-0926-4077-aa5a-0037ae5a1735`，耗时 `195.0s` 进入 `needs_human`，生成 `1150` 字，`errorCode: ""`、`【人X】` 占位符 `0` 处（氛围克制、试探对话自然）；
  - **东方仙侠 (`xuanhuan`)**：任务 `b63d2946-435a-42d5-9210-c346b11221b7`，耗时 `115.1s` 进入 `waiting_author`，生成 `1462` 字，`quality.score = 0.88`、`passed = true`、`errorCode: ""`、`【人X】` 占位符 `0` 处；
  - 测试临时作品已全部 `DELETE` 清理，数据库保持 `novels: 1`。

---

## 阶段记录：前端永久缓存破除与本地会话自动补齐自查交付 (2026-11-18)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/app-boot.js` | 会话异步补齐与 401 自愈 | 1. `backendState.localOpenAccess` 初始值改为 `null`（未知待探测），并通过 `localOpenSessionPromise` 去重并发 `ensureLocalOpenSession` 调用，探测 `POST /api/auth/local-session`（404 置 `false`，200 置 `true` 并写入凭证）；<br>2. `backendRequest` 在 `backendState.localOpenAccess !== false` 下遇 `401` 自动尝试一次本地开放会话自愈重试；<br>3. `requestChatText` 在 `!backendState.token` 时先异步执行 `await ensureLocalOpenSession(true)` 再判定凭证。 |
| `molan-home/completion-editor.js` | 创作书/保存/V2 引导凭证自愈 | 将 `creationRequest` 转为 `async`，并与 `persistNovelScenePatch`、`persistNovel`、`ensureGenerationV2CreationBook` 统一接入：若 `!backend.token` 则先调用 `await window.ensureMolanLocalSession(true)` 并重新读取 `getBackend()`，彻底消除“当前账户未连接创作书服务”的初始化竞态与误报。 |
| `molan-home/index.html`<br>`molan-home/boot-head.js`<br>`molan-home/boot-scripts.js`<br>`molan-home/pages/*.html` (13 页) | 前端版本戳全量递增 | 因 `services/static-service.js` 对带 `?v=...` 的静态脚本统一返回 `Cache-Control: public, max-age=31536000, immutable`，将版本戳由 `20261020_fix_v1` 全量升级至 `20261118_open_v1`，确保浏览器普通刷新即可加载最新免登录与 V2 代码。 |

### 二、设计决策与权衡

1. **升级 `?v=` 版本戳而非削弱 `immutable` 缓存头**：保留 `static-service.js` 对静态资源的长期不可变缓存性能优势，仅通过更新版本戳 `20261118_open_v1` 精确穿透旧版浏览器缓存，同步满足 `scripts/check-frontend-stamp.mjs` 发布门禁要求。
2. **异步按需补齐而非盲目屏蔽报错**：当用户点击时机早于 `bootstrapBackend()` 异步完成或本地 Token 过期时，`creationRequest` / `persistNovel` / `ensureGenerationV2CreationBook` / `requestChatText` 与 `backendRequest` 自动尝试 `ensureLocalOpenSession(true)` 一次；若服务端未开启免登录（404）仍会严格抛出提示，不削弱生产隔离。

### 三、真实验证证据与测试数据

- **全量测试套件**（`..\tools\node22_runtime\node.exe --no-warnings --test --test-reporter=spec --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"`）：`2451 tests | 73 suites | 2435 pass | 0 fail | 16 skipped`（耗时 `35347.1158ms`）。
- **架构与基准审计**：
  - `..\tools\node22_runtime\node.exe scripts/production-import-audit.mjs`：扫描 234 个生产核心文件，退出码 `0`（零反向依赖）。
  - `..\tools\node22_runtime\node.exe scripts/audit-golden-suite.mjs`：通过（`GOLDEN INPUT SUITE PASS tasks=80`，8 大题材各 10 项，退出码 `0`）。
  - `..\tools\node22_runtime\node.exe scripts/check-frontend-stamp.mjs`：版本戳随提交校验通过。
- **本机 PG 18.6 + Live 服务端端到端自查**（`http://127.0.0.1:3000`）：
  - `/api/health`：`db: "ready"`、`postgres.status: "ready"`、`database: "molan"`、`serverVersion: "18.6"`、`tableCount: 84`、`models: 20`、`novels: 1`。
  - `/api/generation-runs/capabilities`：`{"generationV2":true,"code":null,"commit":true,"pauseResume":true,"recovery":true,"storageMode":"postgres"}`。
  - **Generation V2 实跑生成**：任务 `d2ec9483-5a50-4fb1-9c22-cc581e6b49c3` 经真实模型调用完成 `created -> generating -> quality_audit -> waiting_author` 全状态流转，`errorCode: ""`、`errorDetail: ""`，并在 `luna.generation_runs` 落地 344 字正文草稿（测试临时作品已软删除清理，当前作品库保持干净）。

---

## 阶段记录：编辑器作品直连 Generation V2 伴生创作书自动引导修复 (2026-11-18)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/completion-editor.js` | 前端引导与ID解析修复 | 1. 新增 `buildEditorSeedBible(state, prompt)`：从作品 `state.knowledge.entities` 与 `state.outline` 提取真实已有角色、地点和世界观设定（不虚构占位人物）；<br>2. 修复 `ensureGenerationV2CreationBook` 与 `runChapterWorkflow`：未保存草稿先持久化获取服务端 `novelId`/`revision`，传入 `editorBootstrap: true` 与真实提取的 `bible`（替代原先错误传递的布尔值 `generated: true`），并补齐读取 `creationData.book && creationData.book.id`。 |
| `molan-home/services/postgres-creation-http-service.js` | 后端安全放行与幂等复用 | `handlePostgresCreationBooksCreate` 对携带 `editorBootstrap: true` 且绑定了已验证自有 `novelId`（无 `sourceDissectionId`）的请求：<br>1. 若该 `novelId` 已有关联创作书，直接幂等复用（`reused: true`）；<br>2. 保留禁止复制项（`forbidden_entity_hit`）与人物重字（`character_name_overlap`）拦截门禁，仅豁免 3 角色 / 3 地图节点 / 金手指必填项缺失拦截，标准创书流程门禁保持不变。 |
| `molan-home/test/editor-bootstrap-creation-book.test.js` | 自动化测试 | 新增 4 项测试覆盖标准创书门禁、编辑器引导豁免与重字拦截、同 `novelId` 复用及 `completion-editor.js` 契约。 |

### 二、验证证据与测试数据

- **全量测试套件**（`tools/node22_runtime/node.exe`）：`2451 tests | 73 suites | 2435 pass | 0 fail | 16 skipped`
- **架构审计**：`scripts/production-import-audit.mjs` 通过（234 个生产文件合规）
- **本机 PG 18.6 实机 HTTP 端到端校验**：`POST /api/novels` → `POST /api/creation-books`（`editorBootstrap: true` 空圣经）→ `GET /api/creation-books/:id/state`（`bibleVersion: 1`, `stateVersion: 0`）→ 二次引导自动复用（`reused: true`）全部通过。

---

## 阶段记录：本地免登录自由开放模式落地 (`MOLAN_LOCAL_OPEN_ACCESS=1`) (2026-11-18)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/server.js` | 开关与自动会话 | 新增 `isLocalOpenAccessEnabled()`（仅当 `!PUBLIC_MODE && NODE_ENV !== 'production' && MOLAN_LOCAL_OPEN_ACCESS === '1'` 时生效）：<br>1. 新增 `ensureLocalOpenAccount()`：PG 就绪时自动幂等创建/读取全权管理员账号（默认 `local@molan.local`，可用 `MOLAN_LOCAL_ACCOUNT_EMAIL` 覆盖），无 PG 时返回内存全权账号与 `localMemoryOnly` 标记；<br>2. 新增 `POST /api/auth/local-session`（`handleLocalSession`）：返回 `localOpenAccess: true`、`token`、`adminToken` 与 `user`；<br>3. `dispatchRequest` 为未带有效 Token 的请求自动挂载 `req.molanLocalOpenAuth`；为无 PG 本地运行态兜底 `reserveCredits` / `settleTokenUsage` / `recordDispatchAttempt` / `getPostgresUsageSummary` / `nativeSkillCatalog`。 |
| `molan-home/services/auth-account-service.js` | 鉴权回退扩展 | `createAuthAccountService` 新增可选 `resolveFallbackAuth`，使 `getAuthUser(req, expectedScope)` 在未持有效会话时回退至本地全权账号（且允许全权账号跨 `client`/`admin` 域访问）；`handleProfile` 在 `localMemoryOnly` 下安全更新内存资料。 |
| `molan-home/services/model-selection-service.js` | 全模型解锁 | `createModelSelectionService` 新增可选 `allowAllModels`，开启本地开放模式后 `canChooseModel(user)` 对所有身份均放行全部模型选择。 |
| `molan-home/routes/auth.js` & `services/cloud-proxy-service.js` | 路由与状态 | `routes/auth.js` 注册 `POST /api/auth/local-session`；`handleLocalSyncStatus` 暴露 `localOpenAccess` 标志供前端自动识别。 |
| `molan-home/app-boot.js` & `completion-platform.js` | SPA 免登录自动装配 | `bootstrapBackend()` 检测到 `localOpenAccess` 且缺少 `token`/`adminToken` 时自动调用 `ensureLocalOpenSession()` 写入凭证并触发 `molan:auth-changed`；`renderPage` 不再把 `/admin` 重定向到 `admin-login`；侧栏显示“本地全权模式”与无限积分。 |
| `molan-home/pages/local-open-auth.js` 及各独立子页 | 独立页面免登录 | 新增共享引导模块 `MolanLocalOpenAuth.ensureLocalSession`，接入 `account.js`、`site.js`、`dissect.js`、`skills.js`、`admin.js`、`story-workbench.js`、`project-docs.js`、`xuanhuan-blind.js`、`xuanhuan-reading.js` 及对应 `pages/*.html`（`tools/dissect/skills/novels/editor/admin/story-workbench/project-docs/xuanhuan-blind/xuanhuan-reading`），打开任意独立子页均可直接自由使用全功能。 |
| `molan-home/start-node22.bat` & `start-node22-pg.bat` | 本地启动默认开启 | `start-node22.bat` 自动拉起本机 PostgreSQL 18.6（`%LOCALAPPDATA%\molan-postgresql` 端口 `55432`、`molan` 库 84 张表）并默认开启 `MOLAN_LOCAL_OPEN_ACCESS=1`、`MOLAN_GENERATION_V2=1`、`MOLAN_LOCAL_ONLY=1`、`MOLAN_ALLOW_LOCAL_MODELS=1`；`start-node22-pg.bat` 同步补充相同本地开放与 V2 参数（均支持外部变量覆盖）。 |
| `molan-home/test/local-open-access.test.js` | 自动化测试 | 新增 2 项端到端测试：验证 `MOLAN_LOCAL_OPEN_ACCESS=1` 下免登录直通 `/api/models`、`/api/auth/local-session`、`/api/auth/me`、`/api/admin/auth/me`、`/api/metrics`、`/api/chat` 与全模型选择；同时验证关闭开关或 `PUBLIC_MODE=1` 时仍严格执行 `401/403`。 |

---

### 二、设计决策与权衡 (Decisions & Trade-offs)

1. **采用环境开关 + 自动签发本地全权会话（方案 A）而非硬编码删除所有鉴权**：
   - *决策依据*：后端为 PG-only 架构，PostgreSQL RLS 与表外键要求 `actorUserId` 对应真实账户记录，且全库 2400+ 测试与 10 余个独立页面深度依赖 `ml_token` 与 `canChooseModel`。通过 `MOLAN_LOCAL_OPEN_ACCESS=1`（且受 `!PUBLIC_MODE && NODE_ENV !== 'production'` 护栏约束）在启动时自动注入全权本地会话，既让全站 SPA 与所有独立子页 100% 免登录自由开放，又完整保留既有安全测试契约和一键恢复登录态的能力。

---

### 三、验证证据与测试数据

- **测试运行时**：`tools/node22_runtime/node.exe` (Node.js v22.23.2)
- **执行命令与真实结果**：
  1. 专项测试：
     ```powershell
     .\tools\node22_runtime\node.exe --no-warnings --test molan-home/test/local-open-access.test.js
     # 2 tests, 2 passed, 0 failed
     ```
  2. 全量测试套件（最后一次代码改动后）：
     ```powershell
     .\tools\node22_runtime\node.exe --no-warnings --test --test-reporter=spec --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"
     # tests 2447 | suites 73 | pass 2431 | fail 0 | skipped 16 (duration_ms 34540)
     ```
  3. 架构与黄金用例审计：
     - `scripts/production-import-audit.mjs`：PASS（234 个生产文件合规，exit 0）
     - `scripts/audit-golden-suite.mjs`：PASS（80 项任务全部通过，exit 0）
  4. 本机 PostgreSQL 18.6 实机联调（`127.0.0.1:55432` -> `molan` 库，51 项迁移全部应用，84 张表）：
     - `/api/health`：`db: "ready"`、`pgAvailable: true`、`tableCount: 84`
     - `/api/generation-runs/capabilities`：`generationV2: true`、`commit: true`、`pauseResume: true`、`recovery: true`、`storageMode: "postgres"`
     - `/api/local-sync/status` & `/api/models` & `/api/novels` & `/api/admin/overview`：`localOpenAccess: true`、`role: "admin"`、`canChooseModel: true`、`defaultModel: "gemini-4-hydrogen"`、`novelsOk: true`、`adminOk: true`

---

## 阶段记录：Plan B 创作链路并入主线与本机官方 Antigravity ACP 协议接入 (2026-11-18)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `main` (`exp/plan-b` 合入) | 分支合并 (`b304798`) | 经 Original (`main`) / Plan A (`exp/plan-a`) / Plan B (`exp/plan-b`) 30 篇十题材全量实测对比后，确认 **Plan B** 合并进 `main`：启用 `CompositionV3` 自动 StrategyIR 降阶与 `evidence-catalog` 注入、解耦两遍去 AI 味精修、题材中立 `inplace-sanitizer.js`、真实双裁判文学质量评估及 SSE 行缓冲对齐修复。 |
| `molan-home/services/acp-transport-service.js` | 新增传输服务 | 实现官方 Antigravity ACP (`tools/antigravity-acp/agy_acp_server.exe` v1.5.0，SHA-256 校验通过) JSON-RPC 2.0 over stdio 持久化进程管理器：<br>1. 隔离空目录 `data/acp-sandbox` 作为会话 `cwd`，并在 `initialize` 禁用文件读写与终端能力、自动拒绝 `session/request_permission`，确保纯文本写作不碰工作区文件；<br>2. 动态对齐 `session/new` 返回的 `configOptions`（`model` 与 `thought_level`/`reasoning_effort`）并调用 `session/set_config_option`；<br>3. 将 `session/update` 的 `agent_thought_chunk` / `agent_message_chunk` 与最终用量实时转为 OpenAI 兼容 SSE 流，无缝复用 `chat-service.js` 全套两遍精修、计费与中止链；<br>4. 未登录时精确映射 `-32000` 为 `503 ACP_AUTH_REQUIRED`，提示运行 `acp-login.bat`。 |
| `molan-home/services/chat-service.js` | 路由兼容拓展 | 新增 `openAcpUpstream` 注入与 `isAcp` (`pm.provider === 'antigravity-acp'`) 分支：不要求外部 HTTP `apiKey`/`baseURL`，透传 `modelConfig` 与 `reasoningEffort`（默认支持 `pm.defaultReasoningEffort` / `'high'`），保持 `resolveUpstreamModelForReasoning` 不篡改 ACP 模型名。 |
| `molan-home/lib/model/model-registry.js` | 注册表扩展 | 新增官方 Antigravity 主力模型能力条目：`gemini-4-hydrogen`（1M 上下文、`low/medium/high`）、`gemini-4-argon`、`claude-opus-5-5`、`claude-sonnet-5-5`、`claude-opus-4-6-thinking`、`claude-sonnet-4-6`、`gpt-oss-120b-medium`，并在 `TOKENIZER_RATIOS` 补充 `gemini` 分词比率。 |
| `molan-home/services/model-selection-service.js` | 推理档位收敛 | `reasoningEffortsForModel` 优先尊重平台配置中显式声明的 `pm.reasoningEfforts`（如 `gemini-4-hydrogen` 的 3 档 `low/medium/high`），同时完全兼容现有 Gemini 3.x 测试契约。 |
| `molan-home/server.js` | 服务接线与清理 | `loadPlatformModels` 透传 `defaultReasoningEffort` / `acpCommand` / `acpProxy`；初始化 `acpTransportService` 并将 `openAcpUpstream` 注入 `createChatService`；在 `stopLocalWorkers` 优雅退出时调用 `acpTransportService.close()`。 |
| `molan-home/completion-editor.js` | 前端默认适配 | `completionModelMeta` 与 `renderCompletionThinkingSelector` 识别 `gemini-4-*`、`claude-opus/sonnet-5-5` 并默认偏好 `'high'` 思考强度。 |
| `molan-home/start-node22.bat` | 本地启动环境 | 默认设置 `MOLAN_ALLOW_LOCAL_MODELS=1` 适配纯本机运行环境。 |
| `molan-home/scripts/acp-login.js` & `acp-login.bat` | 登录引导工具 | 提供一键触发官方 `oauth-personal` 浏览器 OAuth 认证并回显在线 `configOptions` 模型清单的工具。 |
| `molan-home/data/config.json` *(不入库)* | 本地运行配置 | 依据官方 `agy_acp_server.exe` 登录后实测返回的 `configOptions` 精准收敛为 3 个实际可用 ACP 模型（`gemini-4-hydrogen`、`gemini-4-argon`、`gemini-3.8-flash-acp`，3 档 `low/medium/high`），默认模型切为 `gemini-4-hydrogen`（`high`）；完整保留原有 GPT-6-Luna 等中转模型作为备用。 |
| `molan-home/test/acp-transport.test.js` | 自动化测试 | 新增 5 项测试（模型能力边界、配置档位映射、Mock stdio ACP 流式/权限拒止/用量、未认证 `ACP_AUTH_REQUIRED`、`chat-service` 路由端到端验证）。 |

---

### 二、设计决策与权衡 (Decisions & Trade-offs)

1. **采用官方 ACP Binary (`agy_acp_server.exe`) + 适配层复用 `chat-service` SSE 通道**：
   - *方案选择*：未侵入修改 `chat-service.js` 的两遍精修、计费或流式状态机，而是让 `acp-transport-service.js` 在本地持久化管理 `agy_acp_server.exe` 子进程并将 ACP `session/update` 翻译为标准 SSE 流，从而使 Plan B 的 Pass 1 / Pass 2 / DualJudge / Dissection 全链路零重复实现地工作于官方 ACP 协议上。
   - *风险阻断与防范*：官方 ACP 底层是带工作区感知的 Agent 运行时。为此强制传入隔离空目录 `data/acp-sandbox` 作为 `cwd`、关闭 `fs/terminal` 能力、自动拒绝 `session/request_permission`、并在系统消息前附带纯文本写作帧，防止代理读取源码或触发工具调用；同时保留现有 `gpt-6-luna` 等 HTTP 中转模型，避免单一配额受限时无回退渠道。
2. **保留 `exp/plan-a` 分支且不删除实验记录**：`main` 仅快进合并 `exp/plan-b` 后叠加 ACP 接入，`exp/plan-a` 继续留在本地分支持仓以便回溯。
3. **本机首次 OAuth 前置说明**：`agy_acp_server.exe` 独立校验 `C:\Users\lyh\.gemini\antigravity-acp` 下的官方凭据；严禁绕过或复制其他目录凭据，未完成初次登录时由 `503 ACP_AUTH_REQUIRED` 明确指引用户执行一次 `molan-home\acp-login.bat`。

---

### 三、验证证据与测试数据

- **测试运行时**：`tools/node22_runtime/node.exe` (Node.js v22.23.2)
- **执行命令与真实结果**：
  1. ACP 专项测试（最后一次代码改动后）：
     ```powershell
     .\tools\node22_runtime\node.exe --test molan-home/test/acp-transport.test.js
     # 5 tests, 5 passed, 0 failed
     ```
  2. 全量测试套件（最后一次代码改动后）：
     ```powershell
     .\tools\node22_runtime\node.exe --no-warnings --test --test-reporter=spec --test-concurrency=4 "test/*.test.js" "test/*.test.mjs" "test/*.test.cjs"
     # tests 2445 | suites 73 | pass 2429 | fail 0 | skipped 16 (duration_ms 35958)
     ```
     *(注：16 项跳过为无 live PostgreSQL 时的 11 项 PG 集成测试及需 `MOLAN_SLOW_TESTS=1` 的慢测试等默认跳过项)*
  3. 官方 ACP 实机联网联调（OAuth 登录后）：
     - `scripts/acp-login.js` 实测 `session/new` 返回可用模型 `gemini-4-argon`、`gemini-4-hydrogen`、`gemini-3.8-flash` 与思考档位 `low / medium / high`；
     - `acpTransportService.openUpstream` 实测 `gemini-4-hydrogen (high)` 正文流式生成（`status=200`、`119` 字、`prompt_tokens=12961, completion_tokens=1561, reasoning_tokens=1443`）及 `response_format: { type: 'json_object' }` 纯净 JSON 评审返回（`status=200`、`score=0.88`、`reasoning_tokens=239`）。
  4. CI 架构与黄金用例审计：
     - `scripts/production-import-audit.mjs`：PASS（234 个生产文件合规，exit 0）
     - `scripts/audit-golden-suite.mjs`：PASS（80 项任务全部通过，exit 0）
  4. 服务装配校验：`server.js` 实载验证 `currentDefaultModel() === 'gemini-4-hydrogen'`、`provider === 'antigravity-acp'`、`defaultReasoningEffort === 'high'`、`contextWindowTokens === 1000000`。

---

## 阶段记录：多标签创作坞站、浮动划选菜单与正文写回全链路融合闭环与对抗加固 (2026-10-11 Round 3 终审完备)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心函数 / 接口 |
| :--- | :---: | :--- |
| `molan-home/completion-editor.js` | 核心实现与对抗加固 (R3终局) | 1. **DOM 骨架完整对齐**：在 `renderEditorPage` 中补齐常驻创作坞站 `#editorWorkbenchDock`（大纲、设定、记忆、工具四面板）、顶部药丸 Tab 切换组 `#editorDockTabs`、坞站折叠/展开按钮 `#editorDockToggle`、正文划选浮动菜单 `#editorSelectionMenu`（5 工具直通）以及 AI 对话气泡动作区（`apply-paper`、`copy`）。<br>2. **生命周期与作品真实数据绑定**：实现 `renderWorkbenchDock`、`renderWorkbenchOutline`（消费 `chapterSequence` 并通过安全的 `chapterName` 解析目标章节，绑定 `getProjectForeshadows` 伏笔台账）、`renderWorkbenchKnowledge`（聚合 `getProjectCharacters` 真实字段，世界观设定默认保真为 `设定` 而非降级为 `地点`，支持即时检索与类型过滤）、`renderWorkbenchMemory`（消费场景目标、前情约束与文风规约）、`injectPromptContext`（一键带参引用至提示词、持久化至 `sessionStorage` 提示词草稿、触发响应式文风检测并同步 `runtime.aiOpen = true`）。<br>3. **动态题材与文风注入**：重构文风预设注入器，动态绑定 `state.genreFamily`、`state.novelGenre`、`state.writingStyle` 与 `state.perspective`，根除硬编码玄幻偏见。<br>4. **正文清洗与四种写回模式**：重构 `extractRevisedProse`，剥离多层 Markdown 围栏、`【改写稿】` 及 20+ 种模型变体标记、无括号 Markdown 标题标记（`### 改写稿`）、附加括号说明以及各种层级的 Markdown 解释说明区块（`### 修改说明`、`## 优化说明`、`**写作建议**` 等）；重构 `applyTextToEditorPaper`，支持 `replace`/`cursor`/`append`/`insert` 模式，清理 `.editor-empty-copy` 空场景占位符，支持跨行/跨段落（`startBlock !== endBlock`）时完整替换所有选中块并保留前后缀，避免产生孤儿空段落或非法嵌套 `<p>`，并在根容器层级插入单段落时强制执行 `<p>` 标签包裹；同步更新 DOM、内存状态 `scene.content`、`preview.editorBody`、字数重算与 `markEditorDirty(true)`；暴露 `window.applyTextToEditorPaper`。<br>5. **独立 AI 工具箱平滑降级与状态防卫**：实现 `executeDockTool`，增加防重复并发锁与离线平滑降级；在气泡采纳与快捷工具点击中加入 `runtime.editorBusy` 与流式/系统状态拦截防御；气泡采纳提取时将 `<br>` 还原为换行符 `\n`，保证多段落格式保真，并清洗状态标签；`captureEditorSelection` 在折叠时显式清空 `lastEditorSelectedText`，杜绝幽灵旧选区泄漏；移动端遮罩点击联动移除 `dock-open` 并重置坞站状态。 |
| `molan-home/index.html` | 接口与状态闭环 (R3对齐) | 1. 暴露 `window.applyTextToEditorPaper = applyTextToEditorPaper;` 与 `window.extractRevisedProse = extractRevisedProse;`。<br>2. 对齐 `extractRevisedProse` 全量 20+ 标记、Markdown 标题识别与多级说明截断；对齐气泡采纳 `<br>` 换行还原、状态守卫及过滤；对齐实体过滤规则支持 `设定` 类型。 |
| `molan-home/test/workbench-editor-fusion.test.js` | 自动化测试加固 (R3拓展) | 扩展至 25 大对抗测试套件（全量真实通过）：<br>1~21. 包含常驻坞站骨架、生命周期消费、清洗写回机制、事件委托闭环、标记变体截断、根级单段 `<p>` 包裹、选区隔离、移动端遮罩与离线降级等套件；<br>22. 对抗与边界验证：`extractRevisedProse` Markdown 多级标题说明截断与纯正文保真；<br>23. 对抗与边界验证：`applyTextToEditorPaper` 跨段落范围选区替换与 DOM 块级保真；<br>24. 对抗与边界验证：`captureEditorSelection` 折叠光标清空陈旧选区与防幽灵选区；<br>25. 对抗与边界验证：AI 气泡富文本换行提取保真与实体默认分类保真。 |

---

### 二、设计决策与权衡 (Decisions & Trade-offs)

1. **采纳项的决策原由**：
   - **双模容器平滑兼容（`.completion-editor-content` vs `.editor-paper`）**：在真实小说全量沉浸编辑模式（`completion-editor.js`）下，正文容器为包含卷章标题与场景内容的 `.completion-editor-content`；而在独立预览模式下为直接的 `.editor-paper`。`applyTextToEditorPaper` 采用分级降级寻址，优先锁定真实可编辑容器，保证写回正文与光标/选区定位在任何模式下均 100% 精准无误。
   - **DOM 与内存状态双向同步**：不仅操作正文 DOM，还同步将清洗后的文本写入 `state.volumes[...].chapters[...].scenes[...].content` 与 `previewState.editorBody`，联动字数统计组件并调用 `markEditorDirty(true)` 触发版本快照持久化，彻底消除“正文界面变了但刷新后丢失”的数据断层。
   - **跨段落多块替换自愈与根级裸文本包裹**：在 contenteditable 中，若跨段落选区被替换，必须将从 `startBlock` 到 `endBlock` 的所有中间节点整体替换，保留首块的前缀与尾块的后缀，避免产生孤儿空 `<p>` 节点；单段落且处于容器根级时强制包装为 `<p>`，彻底杜绝 DOM 结构坍塌。
   - **AI 气泡富文本换行还原**：针对 DOM 中 `${esc(text).replace(/\n/g, '<br>')}` 渲染的富文本气泡，提取时将 `<br>` 节点还原为 `\n`，解决 `Node.textContent` 丢弃 `<br>` 导致的多段落被融合成单行的排版故障。
   - **陈旧选区折叠清理**：光标一旦发生折叠，立即清空 `lastEditorSelectedText` 缓存，防止用户再次点击工具箱“读取选中文本”时读取到上一次的历史划选内容。
   - **空场景占位符自动自愈清理**：空场景包含 `.editor-empty-copy` 占位符文字（“从这里开始输入当前场景正文。”）。在采纳正文前先将其安全移除，杜绝占位文字与正式小说正文拼接到一起的重大缺陷。
   - **真实数据模型无缝对齐**：全面对齐墨阑核心真实数据结构（`plantedChapterId`/`targetChapterId`/`description` 与 `personality`/`intro`/`notes`），世界观规则与概念保真为 `设定` 分类，确保切换真实小说时角色、设定与伏笔信息 100% 完整展示。
   - **标记清洗自愈机制（`extractRevisedProse`）**：针对各类主流大模型（DeepSeek/Qwen/Claude/GPT）输出附带的代码围栏、各类建议稿前缀及 Markdown 标题说明（`### 修改说明` 等），采用多维自愈算法剥离 20+ 种格式标记与非正文解释，确保写回正文的只有纯净自然段。

2. **暂缓与驳回项的考量**：
   - **驳回：硬编码题材预设**：原实现将文风注入固定为“长篇水墨玄幻”，破坏了都市、科幻等非玄幻题材。采纳方案动态提取作品题材族、文风与叙事视角。
   - **驳回：生成中允许点击写入正文**：原实现未阻断未就绪状态，点击会导致“正在整理上下文...”或半截文字被写入正文。采纳方案在 `editorBusy` 与系统通知态硬阻断。
   - **暂缓：坞站面板自由拖拽与分栏宽度持久化**：当前左侧 320px 坞站已适配桌面折叠与移动端抽屉（`<=820px`）双断点。引入自由拖拽缩放分栏会大幅增加 CSS 与交互复杂度，暂缓至后续 UI 深度打磨阶段。

---

### 三、验证证据与测试数据

- **测试运行时**：`tools/node22_runtime/node.exe` (Node.js v22.23.2)
- **执行命令与结果**：
  1. 坞站与工作台融合深度测试套件（含 Round 3 对抗加固用例）：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test molan-home/test/workbench-editor-fusion.test.js
     # 25 tests, 25 passed, 0 failed (100% 真实通过, duration: ~106ms)
     ```
  2. 编辑器侧边栏、题材级联与依赖测试套件：
     ```powershell
     & "..\tools\node22_runtime\node.exe" --test molan-home/test/genre-cascading-selection.test.js molan-home/test/editor-only-sources.test.js molan-home/test/editor-sidebar.test.js
     # 18 tests, 18 passed, 0 failed (100% 真实通过, duration: ~180ms)
     ```
  3. 全量关联测试用例汇总：
     - **融合与编辑器专测通过数**：**43 / 43 passed (100% 真实通过，0 失败)**。
     - **基准编辑器回归测试通过数**：`test/benchmark-editor.test.js` **56 / 56 passed (100% 真实通过)**。
     - **测试集总计**：**99 / 99 passed (100% 真实通过，0 失败，0 跳过)**。
     - **语法检查 (--check)**：`completion-editor.js` 与 `workbench-editor-fusion.test.js` 0 error。
- **工作区状态验证**：
  - `git status` 确认受控修改文件为 `completion-editor.js`、`index.html`、`test/workbench-editor-fusion.test.js` 与 `HANDOVER.md`，受保护数据目录（`books/`, `raws/`, `deploy_tmp/`, `tmp-booktest/`）绝对零触碰。

---

### 四、已知限制与后续待办 (Known Limits & Backlog)

1. **富文本选区细粒度行内格式继承**：目前 `applyTextToEditorPaper` 在跨段落选区替换时保留文本段落结构（`<p>`），若原选区中包含特殊的加粗、斜体等内联样式标签，替换后将以新段落格式为准。
2. **多语言离线高质量改写库**：当前独立 AI 工具箱的高质量平滑降级针对中文玄幻与都市网文进行了特色定制，在网络不可用时可平滑体验；后续可根据小说的实际题材动态定制离线降级模板。

---

## 阶段记录：持久化任务前置影响评估与择优调研准则 (/learn 规则落地) (2026-10-09)

### 一、改动范围与核心逻辑

| 涉及模块 / 文件 | 改动类型 | 关键改动点与核心准则 |
| :--- | :---: | :--- |
| `AGENTS.md` | 规则持久化 | 新增【任务前置影响评估与择优调研准则】章节：<br>1. **零负面影响与风险阻断前置审查**：正式执行前全面评估是否“无负面影响、只有积极影响”，若有破坏既有功能或引入副作用风险，严禁擅自实施并主动向用户说明；<br>2. **多维调研与更优方案前置探索**：制定技术实现前，通过联网搜索、官方文档检索或成熟架构对比探索行业最佳解法；<br>3. **主动提请用户决策**：凡在执行前发现存在潜在负面影响或发现明显更优方案，必须主动汇报并请示用户裁决。 |

---

### 二、设计决策与权衡 (Decisions & Trade-offs)

1. **采纳项的决策原由**：
   - **行为准则通用化 (Workspace Rule)**：该准则针对整个工程协作生命周期（无论是架构重构、功能新增还是脚本调度），属于通用的高优先级行为规范，因此直接落脚于工作区根目录 `AGENTS.md`。
   - **零负面影响绝对防线**：在复杂的长周期项目中，任何欠缺评估的修改都可能造成分层污染、静默损坏单测或引起隐性回归故障。前置阻断并主动请示，能够从根源消除“以好心做坏事”的风险。
   - **探索最优解避免闭门造车**：通过主动联网与横向比对，确保技术方案具备先进性与最佳实践水准，避免陷入局部最优或低效冗余实现。

2. **工件流闭环流程保障**：
   - 严格遵循 `/learn` 规范，预先生成 `learning_proposal.md` 工件，经用户审核批准后再行生效，确保所有规范演进均具备清晰的共识与可溯源性。

---

### 三、验证证据与测试数据

- **测试运行时**：`tools/node22_runtime/node.exe` (Node.js v22)
- **执行命令与结果**：
  ```powershell
  & "..\tools\node22_runtime\node.exe" --test test/chapter-outline-context-audit.test.js test/phase2-engine-enhancements.test.js test/corpus-prompt-experiments.test.js
  # tests 52, suites 15, pass 52, fail 0 (100% 通过)
  ```
- **工作区状态验证**：
  - `git status` 确认仅受控更新 `AGENTS.md` 与 `molan-home/HANDOVER.md`，无任何未预期残留。

---

---

> 更早阶段历史记录（Phase 2 引擎加固及之前共 2948 行）完整保存在 [docs/HANDOVER_ARCHIVE_2026.md](./docs/HANDOVER_ARCHIVE_2026.md)。
