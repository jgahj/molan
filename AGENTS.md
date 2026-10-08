# 工作区约定
- 多项目工作区：先按任务确定目标，不扫描整个工作区。墨阑网页项目位于 molan-home/。
- 默认不搜索 books/、raws/、deploy_tmp/、tmp-booktest/、security-backup-*/、.uploads/、node_modules/、.git/ 和压缩包；确需读取时定向访问。
- books/、raws/、deploy_tmp/、tmp-booktest/ 为受保护数据目录，未经用户明确授权不得修改。

# 本机协作入口
- 项目 Node 命令使用 tools/node22_runtime/node.exe；不要误用 PATH 中的 Node 20。npm 命令需由该 Node 运行 npm-cli.js，并让子进程优先使用同一 Node。
- GPT/AGY 协作使用已安装的 agy-quota-rotator skill：scripts/Invoke-DevTool.ps1 固定 Node/npm/Python/AGY 入口；不修改全局 PATH，不依赖旧用户名目录的 npm shim。
- GPT/AGY 协作中 GPT 只规划分发和审计 diff/执行证据，AGY 执行实现、测试、构建和返修。任务单必须明确目标、输入输出、文件范围、允许命令与验收条件；不默认跳过权限。
- 派发前记录实际 Git 根并保存允许修改文件的内容基线；保护已有用户改动。Git 命令限定目标项目路径，不自动 stash、暂存或提交。

# 子代理模型策略
- 子代理（Subagent）禁止使用除 Gemini 3.8 Flash 系列以外的模型（严禁使用 Pro 等模型）。
- 默认继承当前 3.8 Flash；仅针对简单阅读、轻量检索等纯轻量任务允许选用 flash_lite。

