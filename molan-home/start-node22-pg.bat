@echo off
cd /d "%~dp0"
rem Connect local development to the cloud PostgreSQL database through SSH.
set MOLAN_DB_BACKEND=postgres
set MOLAN_PG_ENABLED=1
set MOLAN_PG_HOST=127.0.0.1
set MOLAN_PG_PORT=55433
set MOLAN_PG_DATABASE=molan
set MOLAN_PG_USER=novel_runtime
set MOLAN_PG_PASSWORD_FILE=%LOCALAPPDATA%\molan-postgresql\cloud-runtime-password.txt
set MOLAN_PG_RUNTIME_ROLE=novel_app
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-node22-pg.ps1"
