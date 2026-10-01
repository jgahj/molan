# 原生仓储操作

## 本地 JSON

显式设置 `MOLAN_APP_STORE=json`。应用账户和小说关联状态位于 `MOLAN_DATA_DIR/app-json`；精读与盲测任务复用该仓储。独立 lab 使用 `MOLAN_LAB_JOB_DIR`，未设置时为 `MOLAN_DATA_DIR/lab-jobs-json`。

单个目录只允许一个写入进程。第二实例拒绝写入；损坏文档和损坏锁文件直接报错。不要删除正在使用的 `.writer.lock`。未完成 `.commit.json` 由下次仓储启动恢复；恢复前只读审计拒绝给出完整结论。写入失败向调用方返回错误，不当作保存成功。

`node scripts/check-db.mjs --data-dir <app-json目录>` 只读检查结构、领域计数和待恢复日志，不打开仓储写锁。日志待恢复或损坏文件使命令返回非零状态。不要把 SQLite 文件重命名为 JSON。

旧 `molan.db` 或非空 `xuanhuan-lab/reading.db`、`blind.db` 不会自动覆盖或作为新空库加载；需要显式迁移。`scripts/sqlite-migration/migrate-lab-jobs.mjs` 提供精读/盲测一致性备份、关联盘点与原子导入，默认只备份盘点，`--apply` 才导入；已有目标必须显式 `--merge`，重复记录整体回滚，不覆盖评分。完整操作见同目录 README，禁止绕过旧库检测启动空仓储。

## PostgreSQL

生产需要明确配置 PostgreSQL，连接失败不会降级到 JSON。新增实验任务表要求应用 `0042_luna_lab_jobs.sql`，使用既有运行角色与 RLS；迁移必须在明确本机目标上显式执行 `db:pg:apply`，先备份。本文不授权线上部署。

精读任务中的 `owner` 保留原用户标识；email 标识必须另带真实 `actorUserId`，不能用 email 的哈希冒充已有用户主键。批量恢复只由 worker 执行，普通用户只可恢复自己所属任务。

素材人名词典使用 PG 时要求 `MOLAN_CHARACTER_DICTIONARY_USER_ID`。读取在只读事务内设置运行角色与用户身份，仅包含该用户可见的角色资料。

## 精读审计

`node scripts/audit-xuanhuan-reading.cjs <jobId>` 要求 `MOLAN_LAB_AUDIT_OWNER`。PG 还要求 email owner 对应的 `MOLAN_LAB_AUDIT_ACTOR_USER_ID`；本地目录由应用存储模式与 `MOLAN_LAB_JOB_DIR` 决定。审计只读，不恢复日志，不执行模型调用；检查来源与用量完整性，不证明文学质量。

重启时供应商在途结果或费用未确认的任务为 `needs_review`，不会自动重发。已保存阶段保留，人工核对前不能恢复未知调用。

后台任务写盘失败时，经过 owner 校验的单任务轮询返回 503；同一执行不再发起后续模型调用。关闭流程先等待 lab workers，再释放其它仓储与共享 JSON 写锁；任何写回或清理失败都会保留非零退出状态，超时未完成也以失败退出。

## 质量证据

历史描述统计构建脚本不运行测试或模型 A/B，其质量晋级结论为 `BLOCKED`、测试计数为 `null`。真实评测必须使用可回放正文任务、固定配置版本和费用上限；普通 Golden 输入检查通过不等于质量提升。

本地默认兼容链、部分创作扩展操作与普通旧测试仍在迁移。显式 JSON 路径通过的冒烟不能代替整个 P0–P3 最终验收。

聊天 HTTP 编排已抽至 `services/chat-service.js`，入口负责注入账户、预算、模型传输与并发服务。客户端断连会取消上游并释放账户并发槽；已发送请求但没有完整供应商用量时，费用预占保持 `provider_unknown`，费用为 `null`，不能由过期回收器退款。两遍生成中任一遍缺用量也按未知处理，已知部分用量只作诊断；后续可信完整用量可幂等结算。JSON 冒烟覆盖断连、后续请求、重启保留及缺失任一遍用量，使用本地合成供应商，不构成真实模型质量证据。当前聊天链尚无派发前持久化调用日志，调用之后写盘失败的恢复保护仍需补齐。

未关联小说的原生创作书使用 owner+book 独立分区，支持列表、Bible CAS、状态、债务和质量报告，不创建占位小说。未关联时章节合同与提交明确返回 `CREATION_PROJECT_REQUIRED`；该能力不代表全部旧创作接口已迁移。

`node scripts/postgres-billing-smoke.mjs` 在同一隔离库通过未知费用预占、跨 actor 查询隔离、过期不退款和后续精确结算幂等。未知态只允许完整、非负安全整数 Token 用量解除；负数、小数、溢出或部分调用用量继续保持待核对。未执行付费供应商调用。

可重放 PG 文风 HTTP 合同冒烟：显式配置隔离测试库的 `MOLAN_PG_HOST/PORT/DATABASE/USER` 和密码文件后运行 `node scripts/postgres-native-style-routes-smoke.mjs`。脚本只接受名称含 test/acceptance 的库，会写入唯一测试记录，不执行模型调用；不得指向生产库。

PG HTTP 章节提交定向复验：在相同隔离库配置下，设置 `MOLAN_PG_HTTP_SMOKE_STAGE=creation-commit` 后运行 `node scripts/postgres-http-smoke.mjs`。脚本验证旧审稿缺证据时拒绝提交且不写快照，以及合成 Generation V2 存储证据经 HTTP 提交后的版本与正文哈希。成功结果明确标注阶段和 `synthetic-storage-contract`，不代表模型生成或文学质量通过。取消该环境变量执行完整 HTTP 冒烟；2026-10-01 在本机 PostgreSQL 18.6 隔离库通过完整流程，包括权限、CAS、记忆/文风/债务、任务持久化及软删除恢复。模型响应与章节质量证据为合成夹具，没有真实文学 A/B。数据库名必须含 test/acceptance，连接 URL 若设置则以 URL 中的实际库名核验，不能靠另填库名绕过。
