@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install
  if errorlevel 1 pause & exit /b 1
)

start "Decision Bench Browser" cmd /c "timeout /t 3 >nul & start http://localhost:3000/"
call npm run dev -- --port 3000
pause
