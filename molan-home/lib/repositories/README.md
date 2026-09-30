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
