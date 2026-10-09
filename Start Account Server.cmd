@echo off
cd /d "%~dp0"
if not exist "node_modules\mysql2" (
  echo Installing the MySQL driver...
  call npm install
)
if not exist ".env" (
  echo No .env file found. Copy .env.example to .env and enter your MySQL password.
)
echo NotchDrop accounts: http://localhost:8083
echo Keep this window open while using the local account server.
node server.cjs
pause
