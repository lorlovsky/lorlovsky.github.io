# One-time setup so the website (lorlovsky.github.io) can log in through an ngrok tunnel to this PC.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ngrok = Join-Path $PSScriptRoot 'tools\ngrok.exe'
if (-not (Test-Path $ngrok)) { throw 'tools\ngrok.exe is missing.' }

Write-Host ''
Write-Host '1. Sign up / log in at https://dashboard.ngrok.com'
Write-Host '2. Copy your Authtoken from:  https://dashboard.ngrok.com/get-started/your-authtoken'
Write-Host '3. Copy your free static domain from:  https://dashboard.ngrok.com/domains'
Write-Host ''
$secure = Read-Host 'Paste your ngrok authtoken' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
& $ngrok config add-authtoken $token | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ngrok did not accept that authtoken.' }

$domain = (Read-Host 'Paste your ngrok domain (e.g. something.ngrok-free.app)').Trim() -replace '^https?://', '' -replace '/.*$', ''
if ($domain -notmatch '^[a-z0-9.-]+$') { throw 'That does not look like a domain.' }

# Save the domain for Start Account Server.cmd (.env is ignored by Git).
$envFile = Join-Path $PSScriptRoot '.env'
$lines = @(if (Test-Path $envFile) { [IO.File]::ReadAllLines($envFile) | Where-Object { $_ -notmatch '^NOTCHDROP_NGROK_DOMAIN=' } })
[IO.File]::WriteAllLines($envFile, $lines + "NOTCHDROP_NGROK_DOMAIN=$domain")

# Point the public website at the tunnel.
$configFile = Join-Path $PSScriptRoot 'config.js'
$config = [IO.File]::ReadAllText($configFile) -replace "const webApi = '[^']*';", "const webApi = 'https://$domain';"
[IO.File]::WriteAllText($configFile, $config)

Write-Host ''
Write-Host "Done. Website account server: https://$domain"
Write-Host 'Now commit and push config.js to GitHub so lorlovsky.github.io uses it.'
Write-Host ''
