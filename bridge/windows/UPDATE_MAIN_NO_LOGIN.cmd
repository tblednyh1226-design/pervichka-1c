@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0guest-main-agent.ps1" -Update
echo.
pause
