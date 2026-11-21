[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\backups'))

$ErrorActionPreference = 'Stop'
if (-not $env:MONGODB_URI) { throw 'Set MONGODB_URI in the current environment before running a database backup.' }
$dump = Get-Command mongodump -ErrorAction SilentlyContinue
if (-not $dump) { throw 'mongodump was not found. Install MongoDB Database Tools and retry.' }
$target = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $target | Out-Null
$stamp = [datetime]::UtcNow.ToString('yyyyMMdd-HHmmssZ')
$archive = Join-Path $target "cashflow-$stamp.archive.gz"
& $dump.Source --uri=$env:MONGODB_URI --gzip --archive=$archive
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $archive)) { throw 'mongodump failed. No verified archive was created.' }
$digest = Get-FileHash -Algorithm SHA256 -LiteralPath $archive
[pscustomobject]@{ archive = $archive; sha256 = $digest.Hash; createdAtUtc = [datetime]::UtcNow.ToString('o') } |
  ConvertTo-Json | Set-Content -LiteralPath "${archive}.sha256.json" -Encoding UTF8
Write-Host "Backup completed. Archive: $archive"
Write-Host "SHA-256: $($digest.Hash)"
