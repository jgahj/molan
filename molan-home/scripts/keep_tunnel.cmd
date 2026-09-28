@echo off
:loop
ssh -i "%USERPROFILE%\.ssh\id_ed25519" -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ExitOnForwardFailure=yes -R 10809:127.0.0.1:7897 -N root@8.138.128.184
timeout /t 2 >nul
goto loop
