@echo off
cd /d "%~dp0"
if not exist "node_modules\mysql2" (
  echo Installing the MySQL driver...
  call npm install
)
if not exist ".env" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-mysql.ps1"
)
echo NotchDrop accounts: http://localhost:8083
echo Keep this window open while using the local account server.
node server.cjs
if errorlevel 1 echo If the MySQL login was wrong, delete the .env file and run this again.
pause
