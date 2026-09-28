@echo off
cd /d "%~dp0"
rem Molan local server launcher. Exits if port 3000 is already listening (single instance).
set MOLAN_PORT=%PORT%
if "%MOLAN_PORT%"=="" set MOLAN_PORT=3000
netstat -ano | findstr /R /C:":%MOLAN_PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [%date% %time%] port %MOLAN_PORT% already in use, skip start >> "%~dp0watchdog.log"
  exit /b 0
)
"%~dp0..\tools\node22_runtime\node.exe" --experimental-sqlite --no-warnings server.js
