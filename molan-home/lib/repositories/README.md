# 原生 JSON 领域仓储

`JsonFileRepository(directory)` 提供 accounts、novels、memory、styles、generation、ledger 六个内部存储域。
每个域支持异步 `get(scope, id)`、`list(scope)`、`put(scope, record, expectedRevision)` 和软删除 `remove`。
accounts 的 scope 为 null，其余域为项目 ID。路径由 ID 的 SHA-256 派生，原 ID 保留在记录中。

事务使用 `transaction(scopes, callback, expectedRevisions)`，callback 通过 tx.get/list/put/remove 访问隔离副本。
callback 内不要调用仓储的异步域方法。记录 revision 从 1 递增，expectedRevision=0 表示首次创建。
跨文件提交先写 `.commit.json`，再原子替换文件；中断后拒绝继续访问，须关闭并重新打开完成恢复。
损坏文件、写盘失败均报错。ledger 记录不可覆写或删除。close 必须等待后调用，释放进程锁。

该实现限定一个进程写入；不支持多实例部署，生产多实例使用 PostgreSQL。
存储域是内部接口，**不提供 HTTP 鉴权**，调用方必须先校验租户、成员角色和项目权限。
当前作为已验证的仓储基础模块，尚未替换服务器旧同步 SQL 调用和 PG 记忆快照桥接；不能据此声称存储迁移完成。

`fsync` 保证临时文件内容先落盘，文件名切换由 rename 执行；目录元数据在掉电时的耐久性依赖宿主文件系统。
不提供网络共享盘上的原子性或硬件断电的绝对保证。

长篇 Soak CLI 已接入 `lib/evolution/soak-json-store.js`：`--state` 现在指定新 JSON 仓储目录，不能指向旧数据库文件。
本地仅支持单实例，租约在同一事务内检查 owner、有效期与 fencing token；已有数据库文件不会自动转换。
质量评测可将 `lib/evolution/quality-loop-json-store.js` 的 `createJsonQualityLoopStore(directory)` 作为 store 注入 `runQualityLoop`。
结算与不可变账本同事务保存，同输入幂等重放，已结算的不同报告禁止覆盖。

## 应用领域适配器

`JsonAppRepository` 在上述内部接口上提供账户、哈希会话、小说、成员权限、资料版本及费用预占与结算。
显式设置 `MOLAN_APP_STORE=json` 后，服务器认证及小说接口使用 `data/app-json/`；目录可由 `MOLAN_DATA_DIR` 移至隔离位置。
应用仓储、记忆、文风和生成任务共享同一实例时须传入 `repository`，关闭时只由持有者释放进程锁。

普通聊天的预占使用按账户 ID 哈希派生的独立作用域，项目调用仍校验项目消费权限。
预占与账户扣款、结算退款与不可变流水、过期预占释放均在跨文件事务内完成；实际费用不能超过预占额度。
充值通过 `adjustCredits` 使用账户 CAS 并记录不可变调整流水。`listTokenUsage` 是最多 1000 项的列表，累计统计使用完整的 `summarizeTokenUsage`。
会话仅存令牌哈希，支持撤销和有效期检查；普通及管理会话用途保持分离。

本次接入为显式模式。旧库不会自动导入到新目录，启动发现旧权威数据时须先执行明确迁移流程。
尚有未迁移业务，不能将该开关等同于整个运行链已清除 SQL，也不要直接切换已有数据的服务。
