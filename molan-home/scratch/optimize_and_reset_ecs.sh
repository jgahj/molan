#!/bin/bash
set -euo pipefail

echo "========================================================"
echo ">>> [1/6] 彻底清理云盘 Swapfile，消除磁盘 IOPS 瓶颈..."
echo "========================================================"
swapoff -a || true
rm -f /swapfile /swapfile_extra || true
sed -i '/swapfile/d' /etc/fstab || true

echo "========================================================"
echo ">>> [2/6] 启用 Linux 原生 ZRAM 内存压缩 (1.5GB, 零云盘 IOPS)..."
echo "========================================================"
swapoff /dev/zram0 2>/dev/null || true
if ! zramctl | grep -q 'zram0'; then
  zramctl /dev/zram0 -s 1536M -a lz4 || true
  mkswap /dev/zram0 || true
fi
swapon -p 100 /dev/zram0 2>/dev/null || true
sysctl -w vm.swappiness=10
sysctl -w vm.vfs_cache_pressure=50

echo "========================================================"
echo ">>> [3/6] 注入 PostgreSQL 14 低 IOPS 优化配置..."
echo "========================================================"
mkdir -p /etc/postgresql/14/main/conf.d
cat << 'EOF' > /etc/postgresql/14/main/conf.d/io_tune.conf
synchronous_commit = off
wal_writer_delay = 500ms
checkpoint_completion_target = 0.9
shared_buffers = 128MB
work_mem = 16MB
maintenance_work_mem = 64MB
effective_io_concurrency = 50
random_page_cost = 1.2
EOF
systemctl restart postgresql

echo "========================================================"
echo ">>> [4/6] 停止服务并重置运行时缓存与临时数据..."
echo "========================================================"
systemctl stop molan || true

# 清理 data 目录下的运行时临时数据库与拆书缓存（保留核心配置文件）
mkdir -p /opt/molan/data
find /opt/molan/data -maxdepth 1 -type f \( -name "*.db*" -o -name "dissection*" -o -name "test_*" \) -delete || true

# 清理 PostgreSQL 中的业务测试表数据，保持结构
su - postgres -c "psql -d molan -c '
  TRUNCATE TABLE dissections, character_library, dissection_versions,
                 dissection_chapters, dissection_units, dissection_entities,
                 dissection_foreshadows, dissection_summaries CASCADE;
'" || true

echo "========================================================"
echo ">>> [5/6] 部署 2核 2GB 内存守护与微服务直连..."
echo "========================================================"
mkdir -p /etc/systemd/system/molan.service.d
rm -f /etc/systemd/system/molan.service.d/upstream-proxy.conf || true

cat << 'EOF' > /etc/systemd/system/molan.service.d/memory-guard.conf
[Service]
Environment=NODE_OPTIONS=--max-old-space-size=600
MemoryHigh=800M
MemoryMax=1000M
EOF

# 确保 config.json 中指向云端高速 Nginx 代理
sed -i 's|http://192.220.47.188:8080/v1|http://129.204.195.26/v1|g' /opt/molan/data/config.json 2>/dev/null || true

echo "========================================================"
echo ">>> [6/6] 重新载入并启动墨阑服务..."
echo "========================================================"
systemctl daemon-reload
systemctl restart molan

echo ">>> 系统当前内存与磁盘状态:"
free -h
df -h /
echo ">>> 部署脚本执行完毕！"
