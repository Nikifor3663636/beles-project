@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or newer and try again.
  pause
  exit /b 1
)
if not exist node_modules\acorn\package.json (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Beles website: http://localhost:3000
echo Admin panel:   http://localhost:3000/admin
echo Keep this window open while using the website. Press Ctrl+C to stop.
node server.cjs
if errorlevel 1 pause
