# 本地 PostgreSQL 验证记录

## 已完成

- 官方 EDB Windows x64 binaries：PostgreSQL `18.6`。
- 二进制目录：`C:\Users\lyh\AppData\Local\molan-postgresql\pgsql-18.6\pgsql\bin`。
- 数据目录：`C:\Users\lyh\AppData\Local\molan-postgresql\data-18.6`。
- 本地监听：`127.0.0.1:55432`。
- 隔离开发库：`molan_v2_dev_20260915`；隔离验收库：`molan_v2_acceptance_20260917_cd5689`。
- 验收库已应用 `db/migrations/0001` 至 `0025`，共 61 张表；`migrate-postgres.mjs --check` 返回无待迁移。
- 密码文件只保存在：`C:\Users\lyh\AppData\Local\molan-postgresql\postgres-password.txt`，未写入项目。
- 本地受限登录角色密码只保存在：`C:\Users\lyh\AppData\Local\molan-postgresql\novel-runtime-password.txt`，未写入项目。
- 独立 worker 登录角色密码只保存在：`C:\Users\lyh\AppData\Local\molan-postgresql\novel-worker-password.txt`，未写入项目。

## 实测结果

- PostgreSQL 报告版本为 `18.6`。
- 验收库 schema 有 61 张表。
- `project_resources` 已启用并强制启用 RLS。
- `novel_app` 为 `NOBYPASSRLS`；独立的 `novel_acl_owner` 仅用于安全定义函数和表所有权。
- 两个 workspace/project 的同名资料在受限角色下互不可见；无 `app.user_id` 时返回 0 行。
- 受控 workspace/project 创建和 project owner 转移函数已在受限角色下执行成功。
- migration 可重复执行，不包含业务表删除、清空或项目原稿迁移操作。
- `lib/postgres-repository.js` 使用单连接事务、事务级 `app.user_id`、稳定 legacy ID 映射、CAS、软删除恢复、资料版本和成员权限操作。
- 显式设置 `MOLAN_DB_BACKEND=postgres` 后，小说、结构化资料、工作区、成员、资料包和创作书读写使用 PostgreSQL；未设置时继续使用 SQLite。
- `scripts/postgres-http-smoke.mjs` 在真实 PostgreSQL HTTP 服务上通过：登录隔离、协作者 ACL、正文与资料 CAS、资料包恢复、Bible、章节审计/提交、任务持久化。
- 同一 HTTP 烟测逐项验证 49 项资料的创建、跨请求读取、CAS 更新和两个历史版本往返。
- PostgreSQL 记忆/文风 API 已打通；真实 HTTP 烟测通过正文候选、记忆抽取、改写合同复核、变更集审批/提交、投影同步，以及文风档案版本更新和审计。JSONB 数组按 JSON 文本写入，避免被驱动误编码为 PostgreSQL 数组。
- 作品资料中心的浏览器验收逐项打开 49 项需求并核对字段；A01 字段可录入、同步 JSON 并保存。桌面与 390px 移动视口无横向溢出。
- `scripts/postgres-multi-instance-smoke.mjs` 验证双连接池、跨池会话撤销和 RLS；新增的两个独立 Node 进程同时写同一版本，稳定形成一次成功、一次 `revision_conflict`。
- `scripts/postgres-app-instance-smoke.mjs` 在隔离验收库启动两个独立 HTTP 应用进程，验证跨实例注册/登录、共享会话、会话撤销、项目读写与跨租户拒绝；分别停止并重启实例后，存活/恢复实例仍可继续读取作品。
- 独立 worker 进程烟测通过：任务领取、Bible 落库、供应商尝试记录、`provider_unknown` 防重发和 fencing 拒绝。
- `scripts/migrate-sqlite-projects.mjs` 已在隔离 SQLite fixture 完成首次导入、备份和幂等重跑验证；冲突只记录，不覆盖目标已有修改。
- 默认全量回归为 `798` 项测试、`796` 通过、`0` 失败、`2` 跳过；PG HTTP、双进程和 worker 烟测使用隔离验收库及本地 stub。

## 尚未完成

- 认证账户、拆书旧接口、创书旧任务、模型用量和费用账本仍保留 SQLite 兼容路径，尚未完成全量 PostgreSQL 切换。
- PG 模式的创作书 Bible、确定性章节合同、审计、正文提交和状态快照已接入 PostgreSQL；核心模型任务与分批模型扩展仍沿用现有 SQLite 任务兼容路径，待后续接入持久 PG jobs/worker。
- 创书核心任务的状态更新会串行同步到 PG `jobs/job_events`；进程重启后的未知状态会保留为 `provider_unknown`，不会自动重发。
- PG 预算仓储已支持整数额度预占、同任务幂等、实际费用结算、释放和超额拒绝；真实供应商费用对账仍未执行。
- SQLite/JSON 到 PostgreSQL 的真实用户作品迁移、影子读取、正式切换和回退演练尚未执行；隔离 fixture 验证不代表真实数据已迁移。
- 两个完整 HTTP 应用进程的跨实例会话、撤销、停止/重启接管已在隔离本地库直接交替请求验证；尚未接入正式负载均衡器或多主机环境，代理配置、网络分区、连接排空及生产故障演练仍未执行。
- 真实付费模型调用和真人文学质量验收未执行；当前 PG/浏览器/回归测试不构成文学质量结论。

## 本地命令

```powershell
$env:MOLAN_PG_HOST = '127.0.0.1'
$env:MOLAN_PG_PORT = '55432'
$env:MOLAN_PG_DATABASE = 'molan_v2_dev_20260915'
$env:MOLAN_PG_USER = 'postgres'
$env:MOLAN_PG_PASSWORD_FILE = 'C:\Users\lyh\AppData\Local\molan-postgresql\postgres-password.txt'
$env:MOLAN_ALLOW_POSTGRES_MIGRATION = '1'
node scripts/migrate-postgres.mjs --check
node scripts/migrate-postgres.mjs --apply
```

应用运行时建议使用 `novel_runtime` 登录角色，并设置：

```powershell
$env:MOLAN_DB_BACKEND = 'postgres'
$env:MOLAN_PG_USER = 'novel_runtime'
$env:MOLAN_PG_PASSWORD_FILE = 'C:\Users\lyh\AppData\Local\molan-postgresql\novel-runtime-password.txt'
$env:MOLAN_PG_RUNTIME_ROLE = 'novel_app'
```

已提供 `start-node22-pg.bat`，会读取项目外的本地角色密码文件并启动 PG 模式；`start-node22.bat` 仍保持原 SQLite 启动方式。

多实例 HTTP 验收使用 `npm run db:pg:app-instance-smoke`。脚本要求 `MOLAN_PG_DATABASE` 或 `MOLAN_PG_URL` 的数据库名包含 `acceptance` 或 `test`，否则拒绝启动；它会在系统临时目录创建并清理共享 SQLite 兼容数据，不调用模型。

`migrate-postgres.mjs --apply` 只允许显式设置 `MOLAN_ALLOW_POSTGRES_MIGRATION=1` 的本机目标；脚本不接受远程迁移。
