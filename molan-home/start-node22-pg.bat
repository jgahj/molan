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
if "%MOLAN_LOCAL_ONLY%"=="" set MOLAN_LOCAL_ONLY=1
if "%MOLAN_ALLOW_LOCAL_MODELS%"=="" set MOLAN_ALLOW_LOCAL_MODELS=1
if "%MOLAN_LOCAL_OPEN_ACCESS%"=="" set MOLAN_LOCAL_OPEN_ACCESS=1
if "%MOLAN_GENERATION_V2%"=="" set MOLAN_GENERATION_V2=1
if "%MOLAN_TWO_PASS_HUMANIZE%"=="" set MOLAN_TWO_PASS_HUMANIZE=1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-node22-pg.ps1"
