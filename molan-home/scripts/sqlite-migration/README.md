# 隔离的 SQLite 迁移工具

这些工具仅用于旧库盘点、克隆和迁移，不应由生产服务或普通 CI 导入。
原 npm 命令保持不变，脚本路径移至本目录。需 Node.js 22.5+ 的旧库读取支持。

1. 停止旧库写入，使用 `npm run db:sqlite:clone -- <source> <target.sqlite>` 生成一致性快照；不要直接复制有未 checkpoint WAL 的库。
2. 显式传入 `--source <target.sqlite>` 和项目外的 `--report <report.json>`。全量迁移默认只读盘点；`--apply` 才写入目标 PG。
3. 核对源完整性、记录数量、关联归属、行哈希及迁移报告；不分配归属的记录必须隔离，不能借迁移赋予其他用户权限。
4. 使用 `npm run db:pg:reconcile-sqlite-full -- --source <target.sqlite> --run-id <id>` 复核。对账失败不能切换权威数据源。

本次仅隔离脚本及修正引用路径，未执行任何真实数据迁移，也未自动备份、删除或修改旧库。

## 精读与盲测旧库

先停止写入。`migrate-lab-jobs.mjs` 只在显式调用时读取旧库，先通过 `VACUUM INTO` 生成包含 WAL 已提交内容的一致备份，再检查任务 ID、owner、盲测评分与 case 关联。备份和报告必须使用新的路径，不允许覆盖。

```powershell
node scripts/sqlite-migration/migrate-lab-jobs.mjs --kind blind --source C:/migration/blind.db --backup C:/migration/blind-backup.sqlite --target C:/migration/native --report C:/migration/blind-report.json
```

默认只生成备份和盘点报告，不创建目标仓储；增加 `--apply` 后，全部任务和独立评分在一个原生 JSON 事务中导入，关闭并重开仓储核对数量与完整内容哈希。报告不修改证据或推断评分；外部 corpus 中 scene 的存在性仍需人工复核。

目标默认必须不存在。将第二个库合入已存在的原生应用仓储时必须显式添加 `--merge --apply`；此时新记录仍要求 revision=0，重复任务或评分会使整个导入回滚。报告同时检查已存在记录没有变化。共享 JSON 模式的目标是 `MOLAN_DATA_DIR` 下的 `app-json`，独立 lab 默认目标为 `lab-jobs-json`（或显式 `MOLAN_LAB_JOB_DIR`）；以实际部署配置为准，不能用新空仓储替代已有账户与小说。

导入报告检查通过后，由操作者将旧 `.db`、`-wal`、`-shm` 文件移到备份目录，保留原库与备份供回退。服务检测到旧权威文件仍会拒绝初始化 lab，不会自动删除、重命名或忽略它们。工具禁止写入受保护的 books/raws/deploy_tmp/tmp-booktest 目录。本轮只验证临时夹具，未迁移用户真实数据。
