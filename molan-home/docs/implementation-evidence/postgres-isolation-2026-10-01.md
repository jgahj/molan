# PostgreSQL 真实实例验证

2026-10-01 在专用临时集群验证，未连接或更改用户已有数据库。实际版本 PostgreSQL 18.6；运行时位于 `C:/Users/lyh/AppData/Local/molan-postgresql/pgsql-18.6/pgsql/bin`，监听 `127.0.0.1:55439`，数据库 `molan_quality_acceptance_20261001`。集群数据目录为 `%TEMP%/molan-quality-pg-20261001-342de1b1f58040f3a8309bac3da3c992/data`。密码保存在集群目录临时文件，本文及输出不记录密码。

原来的 `C:/ProgramData/OSService/public/pgsql/bin` 是17.5，不能打开18的数据。切换匹配18.6运行时后复用既有集群，没有重建数据目录。

实际执行并通过：

- `scripts/postgres-runtime-smoke.mjs`：保存读取、多用户授权和撤权、profile/resource CAS、资源投影冲突、Bible版本、生成任务两轮fencing租约、审计章节提交回执、软删除恢复。
- `scripts/postgres-isolation-smoke.mjs`：确认运行角色无superuser/BYPASSRLS，直接SQL的跨用户读取及写入均不可见，用户事务修改回滚，LOCAL actor GUC不泄露到下一事务。
- `scripts/postgres-billing-smoke.mjs`：预算预占和结算幂等、释放账本、超额保护。
- `scripts/postgres-worker-smoke.mjs`：独立worker进程、Bible落库、provider attempt、预算结算与未知成本、旧fencing拒绝。使用本地stub供应商，未调用模型，不是文学质量验证。
- `scripts/postgres-memory-smoke.mjs`：原生记忆标准表适配、跨用户隔离、作者审批、版本冲突、正文与记忆同事务、提交幂等重放、非法操作回滚及数据库异常后的完整回滚；projection 同步通过。
- `scripts/postgres-style-smoke.mjs`：原生文风版本历史、CAS 冲突拒绝、无效写入后版本保持、跨用户读取及写入拒绝；实际保存内容与版本一致。

执行Node24.19.0，环境配置 `MOLAN_PG_ENABLED=1`、host/port/database如上、`MOLAN_PG_USER=novel_runtime`、`MOLAN_PG_PASSWORD_FILE`指向临时runtime密码文件；worker使用 `novel_worker_runtime` 和临时worker密码文件。真实角色与事务检查由 `pg` 驱动发往该隔离实例，无mock替代。

后续原生仓储验证：

- 在该隔离实例应用 `0042_luna_lab_jobs.sql`；lab 的 CAS、评分不可覆盖、跨用户 RLS、普通运行账户范围恢复和 worker-only 全局恢复通过。reading HTTP 首次请求只恢复该 owner 的任务，第二次请求不会重新中断 running 任务；blind 和其他用户任务保持原状态。
- 人物字典查询使用显式 runtime role、稳定 actor GUC 和只读事务，真实 owner 可见、outsider 不可见。
- `scripts/postgres-runtime-smoke.mjs` 新增章节质量报告检查：真实持久审计被读取为 `JUDGED`，缺证据旧式审计保持 null；同项目两部创作书报告隔离，未授权 actor 查询返回不可见。fixture 审计用于存储契约验证，不代表真实文学评测。扩展闭环通过；本次执行使用现有 Node20。
