@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0allow-lan.ps1" -LanIp "%~1" -NodeExe "%~2"
exit /b %ERRORLEVEL%
