# 历史桥接档案

`postgres-memory-bridge.js.txt` 保留已退出运行链的 PG 快照灌入 SQL 兼容库实现，仅用于历史核对，不能作为迁移命令执行。归档时已逐项核对并保留此前未提交的 PureJsDatabase import/new 改动；没有把该兼容实现重新接入生产。

当前记忆与文风请求使用原生异步 MemoryStore、PostgresMemoryStore 和文风仓储。实际旧库迁移仍需显式执行上级目录的迁移命令，并遵循备份与核对流程。
