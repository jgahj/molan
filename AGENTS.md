# 工作区约定
- 多项目工作区：先按任务确定目标，不扫描整个工作区。墨阑网页项目位于 molan-home/。
- 默认不搜索 books/、raws/、deploy_tmp/、tmp-booktest/、security-backup-*/、.uploads/、node_modules/、.git/ 和压缩包；确需读取时定向访问。
- books/、raws/、deploy_tmp/、tmp-booktest/ 为受保护数据目录，未经用户明确授权不得修改。

# 本机协作入口
- 项目 Node 命令使用 tools/node22_runtime/node.exe；不要误用 PATH 中的 Node 20。npm 命令需由该 Node 运行 npm-cli.js，并让子进程优先使用同一 Node。
- GPT/AGY 协作使用已安装的 agy-quota-rotator skill：scripts/Invoke-DevTool.ps1 固定 Node/npm/Python/AGY 入口；不修改全局 PATH，不依赖旧用户名目录的 npm shim。
- GPT/AGY 协作中 GPT 只规划分发和审计 diff/执行证据，AGY 执行实现、测试、构建和返修。任务单必须明确目标、输入输出、文件范围、允许命令与验收条件；不默认跳过权限。
- 派发前记录实际 Git 根并保存允许修改文件的内容基线；开发中间态不随意 stash、暂存。全部功能与测试验证通过后，方可进入交付提交流程。

# 子代理模型策略
- 子代理（Subagent）禁止使用除 Gemini 3.8 Flash 系列以外的模型（严禁使用 Pro 等模型）。
- 默认继承当前 3.8 Flash；仅针对简单阅读、轻量检索等纯轻量任务允许选用 flash_lite。

# 改动交接与文档维护约定
- **新会话/改动先查交接与结构**：开启新对话或开始改动前，必须首先读取 `molan-home/HANDOVER.md` 对齐当前进度与项目结构，禁止盲目大范围扫描工作区浪费 Token。
- **交接文档内置项目结构**：`molan-home/HANDOVER.md` 必须常驻精炼的【项目核心架构与文件骨架索引】，方便切换窗口时以最小 Token 开销快速定位模块职责。
- **真实交付防伪准则（禁止偷懒）**：每次修改必须确保是真实彻底完成任务。严禁因任务链长而跳过验证、偷懒减配或伪造测试通过数据。必须使用 `tools/node22_runtime/node.exe` 实际执行对应测试套件，产出真实的 Pass/Fail 证据。
- **交接文档四要素**：每次改动后必须同步更新 `HANDOVER.md`，完整记录：
  1. **项目核心结构与速查**：保持最新目录骨架与关键模块职责；
  2. **改动范围与核心逻辑**：明确改动的文件、函数与接口；
  3. **设计决策与权衡**：选型依据与驳回/暂缓方案的深层考量；
  4. **真实验证证据**：具体测试命令、运行日志与测试计数。

# 任务交付与 Git / GitHub 闭环
- 只有当以下 3 项全部达成后，方可执行交付：
  1. 代码修改完成且相关所有自动化测试 100% 真实通过；
  2. `molan-home/HANDOVER.md`（含项目结构与本次交接）已更新完毕；
  3. 工作区无未预期的意外修改。
- 确认修改无误后，规范执行本地 `git commit`，并推送到 GitHub 远程仓库（`git push`）。



