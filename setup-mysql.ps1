# Asks for the local MySQL login once and saves it to .env (ignored by Git).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host ''
Write-Host 'First-time setup: enter the MySQL login you use in MySQL Workbench / DBeaver.'
$user = Read-Host 'MySQL user [root]'
if (-not $user) { $user = 'root' }
$secure = Read-Host 'MySQL password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
# Quote the value so characters like # or spaces survive; pick a quote the password doesn't contain.
$quote = if ($password -notmatch "'") { "'" } elseif ($password -notmatch '"') { '"' } else { '`' }
$lines = @(
  '# Local MySQL login for the NotchDrop account server. Never commit this file.'
  'NOTCHDROP_MYSQL_HOST=127.0.0.1'
  'NOTCHDROP_MYSQL_PORT=3306'
  "NOTCHDROP_MYSQL_USER=$user"
  "NOTCHDROP_MYSQL_PASSWORD=$quote$password$quote"
  'NOTCHDROP_MYSQL_DATABASE=notchdb'
)
[IO.File]::WriteAllLines((Join-Path $PSScriptRoot '.env'), $lines)
Write-Host 'Saved to .env. Delete that file to enter the login again.'
Write-Host ''
