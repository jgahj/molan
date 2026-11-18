@echo off
cd /d "%~dp0"
"%~dp0..\tools\node22_runtime\node.exe" scripts\acp-login.js %*
pause
