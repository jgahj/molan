#!/usr/bin/env bash
# Molan 反向隧道常驻（Git Bash / 本地运行）
# ECS 127.0.0.1:10809 -> 本机 Clash 127.0.0.1:7897
# ssh 断开后每 5 秒自动重连（断网/休眠/Clash 重启均自愈）
KEY="$USERPROFILE/.ssh/id_ed25519"
while true; do
  ssh -i "$KEY" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R 10809:127.0.0.1:7897 \
      -N root@8.138.128.184
  sleep 5
done
