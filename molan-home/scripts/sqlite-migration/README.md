# 隔离的 SQLite 迁移工具

这些工具仅用于旧库盘点、克隆和迁移，不应由生产服务或普通 CI 导入。
原 npm 命令保持不变，脚本路径移至本目录。需 Node.js 22.5+ 的旧库读取支持。

1. 停止旧库写入，使用 `npm run db:sqlite:clone -- <source> <target.sqlite>` 生成一致性快照；不要直接复制有未 checkpoint WAL 的库。
2. 显式传入 `--source <target.sqlite>` 和项目外的 `--report <report.json>`。全量迁移默认只读盘点；`--apply` 才写入目标 PG。
3. 核对源完整性、记录数量、关联归属、行哈希及迁移报告；不分配归属的记录必须隔离，不能借迁移赋予其他用户权限。
4. 使用 `npm run db:pg:reconcile-sqlite-full -- --source <target.sqlite> --run-id <id>` 复核。对账失败不能切换权威数据源。

本次仅隔离脚本及修正引用路径，未执行任何真实数据迁移，也未自动备份、删除或修改旧库。
