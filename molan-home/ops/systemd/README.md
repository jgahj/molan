# systemd 单元说明（2026-10-19 P2-6 补齐）

## 现状

| 文件 | 作用 | 安装位置 |
|---|---|---|
| `molan-postgres.conf` | 主服务 `molan.service` 的 drop-in（PG 连接环境变量） | `/etc/systemd/system/molan.service.d/molan-postgres.conf` |
| `molan-worker.service` | PG 任务 worker（依赖 `molan.service`） | `/etc/systemd/system/molan-worker.service` |
| `molan-backup.service` | 每日 pg_dump 备份（oneshot，30min 超时） | `/etc/systemd/system/molan-backup.service` |
| `molan-backup.timer` | 备份调度（每日 03:30，Persistent 补跑） | `/etc/systemd/system/molan-backup.timer` |

> 注意：主服务单元 `molan.service` 本体目前只存在于 ECS 本机，未纳入仓库。
> 重建环境时需先在 ECS 上 `systemctl cat molan.service` 导出留档，或按 drop-in 推断重建
> （ExecStart = `/usr/local/bin/node --no-warnings /opt/molan/server.js`，`After=postgresql.service`）。

## 备份链路安装（此前备份脚本存在但从未自动执行）

```bash
sudo cp molan-home/ops/systemd/molan-backup.service /etc/systemd/system/
sudo cp molan-home/ops/systemd/molan-backup.timer /etc/systemd/system/
sudo mkdir -p /var/backups/molan && sudo chown molan:molan /var/backups/molan
sudo systemctl daemon-reload
sudo systemctl enable --now molan-backup.timer
systemctl list-timers molan-backup.timer   # 验证下次触发时间
```

恢复演练（手动，不会写到源库——库名强制 `molan_restore_drill_` 前缀）：

```bash
cd /opt/molan && node scripts/postgres-backup.mjs restore-drill
```
