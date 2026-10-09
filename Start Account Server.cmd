@echo off
cd /d "%~dp0"
echo NotchDrop accounts: http://localhost:8083
echo Keep this window open while using the local account server.
node server.cjs
pause
