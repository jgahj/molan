@echo off
cd /d "%~dp0"
rem Molan local server launcher. Exits if port 3000 is already listening (single instance).
set MOLAN_PORT=%PORT%
if "%MOLAN_PORT%"=="" set MOLAN_PORT=3000
if "%MOLAN_ALLOW_LOCAL_MODELS%"=="" set MOLAN_ALLOW_LOCAL_MODELS=1
if "%MOLAN_LOCAL_ONLY%"=="" set MOLAN_LOCAL_ONLY=1
if "%MOLAN_LOCAL_OPEN_ACCESS%"=="" set MOLAN_LOCAL_OPEN_ACCESS=1
if "%MOLAN_GENERATION_V2%"=="" set MOLAN_GENERATION_V2=1
if "%MOLAN_TWO_PASS_HUMANIZE%"=="" set MOLAN_TWO_PASS_HUMANIZE=1
rem 全程 gpt-6-luna：Pass 2 强制用 gpt-6-luna 改写；Pass 1 请在前端选 gpt-6-luna（默认模型由一个管理项控制，不在此处覆盖用户偏好）
if "%MOLAN_HUMANIZE_MODEL_ID%"=="" set MOLAN_HUMANIZE_MODEL_ID=gpt-6-luna
rem 自检闸门：Pass 2 改写后本地朱雀代理分未达标时额外再改的轮数（0=关闭，最多4）
if "%MOLAN_HUMANIZE_GATE_ROUNDS%"=="" set MOLAN_HUMANIZE_GATE_ROUNDS=2

set "LOCAL_PG_BIN=%LOCALAPPDATA%\molan-postgresql\pgsql-18.6\pgsql\bin"
set "LOCAL_PG_DATA=%LOCALAPPDATA%\molan-postgresql\data-18.6"
set "LOCAL_PG_LOG=%LOCALAPPDATA%\molan-postgresql\postgres-55432.log"
set "LOCAL_PG_PASS=%LOCALAPPDATA%\molan-postgresql\novel-runtime-password.txt"

if exist "%LOCAL_PG_BIN%\pg_ctl.exe" if exist "%LOCAL_PG_DATA%\PG_VERSION" (
  netstat -ano | findstr /R /C:":55432 .*LISTENING" >nul 2>&1
  if errorlevel 1 (
    "%LOCAL_PG_BIN%\pg_ctl.exe" -D "%LOCAL_PG_DATA%" -l "%LOCAL_PG_LOG%" -o "-p 55432" start >nul 2>&1
  )
  if "%MOLAN_DB_BACKEND%"=="" set MOLAN_DB_BACKEND=postgres
  if "%MOLAN_PG_ENABLED%"=="" set MOLAN_PG_ENABLED=1
  if "%MOLAN_PG_HOST%"=="" set MOLAN_PG_HOST=127.0.0.1
  if "%MOLAN_PG_PORT%"=="" set MOLAN_PG_PORT=55432
  if "%MOLAN_PG_DATABASE%"=="" set MOLAN_PG_DATABASE=molan
  if "%MOLAN_PG_USER%"=="" set MOLAN_PG_USER=novel_runtime
  if "%MOLAN_PG_PASSWORD_FILE%"=="" if exist "%LOCAL_PG_PASS%" set "MOLAN_PG_PASSWORD_FILE=%LOCAL_PG_PASS%"
  if "%MOLAN_PG_RUNTIME_ROLE%"=="" set MOLAN_PG_RUNTIME_ROLE=novel_app
)

netstat -ano | findstr /R /C:":%MOLAN_PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [%date% %time%] port %MOLAN_PORT% already in use, skip start >> "%~dp0watchdog.log"
  exit /b 0
)
"%~dp0..\tools\node22_runtime\node.exe" --experimental-sqlite --no-warnings server.js
