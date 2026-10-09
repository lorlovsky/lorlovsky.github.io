@echo off
cd /d "%~dp0"
if not exist "node_modules\mysql2" (
  echo Installing the MySQL driver...
  call npm install
)
if not exist ".env" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-mysql.ps1"
)
set "NGROK_DOMAIN="
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="NOTCHDROP_NGROK_DOMAIN" set "NGROK_DOMAIN=%%b"
if defined NGROK_DOMAIN (
  rem Requests from the website arrive through ngrok; trust its X-Forwarded-For for rate limiting.
  set "NOTCHDROP_TRUST_PROXY=true"
  set "NOTCHDROP_PUBLIC_URL=https://%NGROK_DOMAIN%"
  start "NotchDrop web tunnel (keep open)" "%~dp0tools\ngrok.exe" http 8083 --url=%NGROK_DOMAIN%
  echo Website login enabled through https://%NGROK_DOMAIN%
) else (
  echo Website login is off. Run "Setup Website Login.cmd" once to enable it.
)
echo NotchDrop accounts: http://localhost:8083
echo Keep this window open while using the local account server.
node server.cjs
if errorlevel 1 echo If the MySQL login was wrong, delete the .env file and run this again.
pause
