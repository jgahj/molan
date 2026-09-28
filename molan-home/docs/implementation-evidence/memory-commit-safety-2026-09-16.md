# SQLite 记忆提交安全：阶段结果

日期：2026-09-16。归属 T01 数据止损，涉及 T03 权限、T11 提交约束的现有入口修复；**不表示这些完整工作包或全系统验收完成**。当前用户明确继续 SQLite，本轮未改造或切换 PostgreSQL。

## 实际改动

- `lib/memory-commit-guard.js`：新增分支状态头、追加式审批记录、持久提交回执；审批哈希绑定作品、分支、候选哈希、状态基线、操作、依赖、风险和报告。
- `lib/memory-system.js`：锁内检查基线，记忆/流水/状态头/回执/outbox 同事务；事实与认知插入不再覆盖同 ID 历史；流水保存实际生成的记录 ID。
- `lib/memory-routes.js`：复用项目与工作区成员授权；只读角色不能审批或提交；畸形审批/提交 JSON 不再降级为默认同意；支持 `Idempotency-Key`；冲突 409、非法引用/操作 422。
- 运行查询不存在或无权时返回 404；只返回获权任务的有限状态字段。不再编造阶段事件，现阶段返回空事件和 `eventHistoryAvailable: false`。
- 新增 `test/memory-commit-safety.test.js`，调整记忆单测、路由请求桩及真实 HTTP 项目隔离回归。

新增表仅通过初始化代码创建：`memory_branch_heads`、`memory_approvals`、`memory_commit_receipts`。本轮执行均使用内存库或临时目录数据库，未初始化真实用户库。

## 实际验证

先执行新增的 6 个失败夹具：5 失败、1 通过，复现旧基线重复提交、审批失效未检查、回执缺失、未知操作/依赖静默接受和跨作品引用问题。

最终命令（项目目录执行）：

```powershell
& ../tools/node22_runtime/node.exe --experimental-sqlite --no-warnings --test test/memory-commit-safety.test.js test/memory-system.test.js test/memory-style-api.test.js test/style-system.test.js test/project-scope.test.js test/benchmark-pipeline.test.js test/benchmark-http.test.js
```

结果：**42 通过、0 失败、0 跳过**。包括：

- 同分支旧基线拒绝、不同分支独立推进、重复初始化保留版本。
- 同键重放、异载荷冲突、重放别名占用、已提交内容不重复审批。
- outbox 故障注入后记忆、流水、状态头和回执一起回滚。
- 自动记录 ID、跨作品/跨分支引用、重复 ID 覆盖拒绝。
- 真实回环 HTTP：未授权用户 404、作者审批与提交、原回执重放、outbox 不重复、请求哈希冲突 409。
- 本地模拟供应商生成管线回归；未发生真实模型调用或推理费用。

`memory-style-api.test.js` 是请求桩加真实内存 SQLite，已纠正其原来“全量端到端验证”的名称。真实 HTTP 证据来自 `project-scope.test.js` 与 `benchmark-http.test.js`。未运行浏览器、生产服务、全量测试、多进程竞争或 PG 验收。

## 代码与夹具绑定

Node `v22.23.2`。工作树基于 `e34d0ca4f650b4ec50bd3bee62663bfd4d412096`，含用户原有未提交改动，不能仅以 HEAD 代表测试代码。最终文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| lib/memory-commit-guard.js | 046B508DC61DAED1ED2FBBAD81512584DB5AC99810045E329B65C53B1B31DDEE |
| lib/memory-system.js | 9B0DDFF42C28FDA906D6DF39F7F8725B09E1A904DA401281BAA3B3B9CAC1F780 |
| lib/memory-routes.js | 02574E4A268C17D9DAC510F9C6CBD2C119BDD465C79DAC609C21D9C2C34B1AF0 |
| test/memory-commit-safety.test.js | 5DFB7991667F12AF216FF67FFD7885B733175B2687B6597C1AC9D1FF0F7C8D45 |
| test/memory-system.test.js | 06C7F58093590820480C080A145EF68854B3C1AD22F27F1CDD24B33B81D17485 |
| test/memory-style-api.test.js | F206C171BF3CDF8A2485D86086E2234A32512B5B5B94010CF6980199B45A57D3 |
| test/project-scope.test.js | 9806AA110979612F4451B75602732F9F1DE39990F89859F0958B8D1F479085F1 |

## 兼容边界、未完成项与恢复

- 旧的未提交审批没有内容绑定，必须重新审批；旧已提交变更若无持久回执，返回 `LEGACY_COMMIT_REQUIRES_RECONCILIATION`，不伪造成功回执。
- 尚未映射为显式项目成员的旧 book ID 被拒绝访问；不得以只验证登录的方式放开。
- `candidateHash` 目前仍是变更集字段，本阶段**未完成**与正式正文版本、圣经/配置当前版本的数据库关联及原子提交。审批哈希保护不等于真实正文已核验。
- `dependencies` 本阶段检查同分支已提交的前置变更集 ID；部分操作审批及操作级依赖图尚未实现。
- 状态头用于当前记忆提交路径，尚未统一旧正文提交与撤销路径。版本化补偿撤销、消费者、防漂移、事件恢复仍待实施，`queued` 不等于已同步。
- 七类资料 UI、认知/时间/披露完整语义、文风定向修订和真实长篇质量均未在本阶段宣称完成。
- 未重启用户服务、未迁移真实数据、未提交或部署。若撤回代码，仅逆向本轮补丁，保留用户原有改动及新增表中的历史；不得整文件恢复、删除表或恢复旧库覆盖后续写入。

下一实施项：将已保存正文版本与记忆变更集关联，再接编辑器创建/确认/提交入口及投影消费。完整 G1–G5 门禁：**不可放行**，本阶段仅提供上述限定范围证据。
