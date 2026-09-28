@echo off
setlocal

cd /d "%~dp0"
title Molan Direct GPT Relay

where.exe ssh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] OpenSSH client was not found.
  echo Install Windows OpenSSH Client, then double-click this file again.
  pause
  exit /b 1
)

if not exist "%~dp0scripts\reverse_tunnel.ps1" (
  echo [ERROR] scripts\reverse_tunnel.ps1 was not found.
  pause
  exit /b 1
)

echo Starting Molan direct GPT relay...
echo ECS 127.0.0.1:10809  ^<--  Local direct relay: 127.0.0.1:7897
echo The local relay connects directly to codex.xiaoguo.work.
echo Keep this window open. Press Ctrl+C to stop the tunnel.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reverse_tunnel.ps1"
set "exitCode=%ERRORLEVEL%"

echo.
echo Tunnel process exited with code %exitCode%.
pause
exit /b %exitCode%
