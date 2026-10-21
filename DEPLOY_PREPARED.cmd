@echo off
cd /d "%~dp0"
node tools\deploy-prepared.cjs dist\deploy-2026-10-21T16-21-10-963Z
if errorlevel 1 (
  echo Deployment was not accepted. See the error above.
) else (
  echo Upload accepted. Check build and deployment status in Railway.
)
pause
