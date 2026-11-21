[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$TargetUri,
  [switch]$DropExistingData,
  [switch]$ConfirmRestore
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRestore) { throw 'Restore was not started. Review the target, then pass -ConfirmRestore explicitly.' }
if ([string]::IsNullOrWhiteSpace($TargetUri)) { throw 'TargetUri cannot be empty.' }
$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
if (-not (Test-Path -LiteralPath "${archive}.sha256.json")) { throw 'The backup checksum sidecar is missing.' }
$metadata = Get-Content -LiteralPath "${archive}.sha256.json" -Raw | ConvertFrom-Json
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
if ($actual -ne $metadata.sha256) { throw 'Backup checksum does not match. Restore was stopped.' }
$restore = Get-Command mongorestore -ErrorAction SilentlyContinue
if (-not $restore) { throw 'mongorestore was not found. Install MongoDB Database Tools and retry.' }
Write-Host "Restore archive: $archive"
Write-Host 'Target URI is intentionally not echoed.'
Write-Host "Drop existing collections: $([bool]$DropExistingData)"
$arguments = @("--uri=$TargetUri", '--gzip', "--archive=$archive")
if ($DropExistingData) { $arguments += '--drop' }
& $restore.Source @arguments
if ($LASTEXITCODE -ne 0) { throw 'mongorestore failed. Check the destination database logs.' }
Write-Host 'Restore command completed. Run the application database check against the target before reopening it to users.'
