@echo off
cd /d "%~dp0"
rem Molan local watchdog: probes /api/health every 20s; restarts only after 3 consecutive failures.
rem Single instance: refuses to start if another watchdog window is already running.
set LOCK=%~dp0data\watchdog.lock
if not exist "%~dp0data" mkdir "%~dp0data"
if exist "%LOCK%" (
  for /f "tokens=1" %%p in ('type "%LOCK%"') do (
    tasklist /FI "PID eq %%p" 2>nul | findstr /I "cmd.exe" >nul && (
      echo [%date% %time%] another watchdog is running ^(pid %%p^), exit >> "%~dp0watchdog.log"
      exit /b 0
    )
  )
)
set MYPID=
for /f "usebackq tokens=2 delims==" %%a in (`wmic process where "Name='cmd.exe' and CommandLine like '%%watchdog-node22%%'" get ProcessId /value 2^>nul ^| findstr ProcessId`) do set MYPID=%%a
echo %MYPID%> "%LOCK%"
set FAILS=0
:loop
for %%f in ("%~dp0watchdog.log") do if %%~zf GTR 2000000 move /y "%~dp0watchdog.log" "%~dp0watchdog.log.1" >nul 2>&1
curl -s -o nul --max-time 4 http://127.0.0.1:3000/api/health
if errorlevel 1 (
  set /a FAILS+=1
) else (
  set FAILS=0
)
if %FAILS% GEQ 3 (
  echo [%date% %time%] health failed %FAILS% times, killing stale node on :3000 and restarting >> "%~dp0watchdog.log"
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do taskkill /PID %%p /F >nul 2>&1
  start "" /min "%~dp0start-node22.bat"
  set FAILS=0
  ping -n 16 127.0.0.1 >nul
)
ping -n 21 127.0.0.1 >nul
goto loop
