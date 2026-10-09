@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing the optional NotchDrop desktop runtime...
  call npm.cmd install
  if errorlevel 1 (
    echo Installation failed. Check your internet connection and Node.js installation.
    pause
    exit /b 1
  )
)
start "NotchDrop" "node_modules\electron\dist\electron.exe" "desktop\main.cjs"
