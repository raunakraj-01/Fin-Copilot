[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'CashFlowCopilot\tally-sync.json'),
  [switch]$Initialize,
  [switch]$InstallTask,
  [switch]$ParseOnly,
  [string]$InputXmlPath
)

$ErrorActionPreference = 'Stop'
$culture = [Globalization.CultureInfo]::InvariantCulture

function Write-Config {
  $directory = Split-Path -Parent $ConfigPath
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  Write-Host 'Create a sync device in Operations for the selected business, then paste its token below.'
  $api = (Read-Host 'API base URL (for example https://cashflow.example/api)').TrimEnd('/')
  $workspaceId = (Read-Host 'Business/workspace ID').Trim()
  $companyId = (Read-Host 'Tally company ID (must remain stable)').Trim()
  $tallyUrl = (Read-Host 'Tally XML URL [http://127.0.0.1:9000]').Trim()
  if (-not $tallyUrl) { $tallyUrl = 'http://127.0.0.1:9000' }
  $token = Read-Host 'Business-scoped sync token' -AsSecureString
  if ($api -notmatch '^https?://' -or $workspaceId -notmatch '^[a-f\d]{24}$' -or -not $companyId -or $token.Length -lt 20) {
    throw 'Configuration is incomplete. Check the API URL, workspace ID, company ID, and device token.'
  }
  [pscustomobject]@{ ApiBaseUrl = $api; WorkspaceId = $workspaceId; CompanyId = $companyId; TallyUrl = $tallyUrl.TrimEnd('/');
    DeviceToken = ConvertFrom-SecureString $token; StatePath = Join-Path $directory 'tally-sync-state.json' } |
    ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  Write-Host "Encrypted configuration saved to $ConfigPath for the current Windows user."
}

function Read-NodeText($Node, [string]$Name) {
  $child = $Node.SelectSingleNode("./$Name")
  if ($child) { return $child.InnerText.Trim() }
  return ''
}

function Parse-TallyDate([string]$Text) {
  if (-not $Text) { return $null }
  $value = $Text.Trim()
  foreach ($format in @('yyyyMMdd', 'yyyy-MM-dd', 'dd-MMM-yyyy')) {
    $parsed = [datetime]::MinValue
    if ([datetime]::TryParseExact($value, $format, $culture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$parsed)) {
      return $parsed.ToString('yyyy-MM-dd', $culture)
    }
  }
  $parsed = [datetime]::MinValue
  if ([datetime]::TryParse($value, $culture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$parsed)) { return $parsed.ToString('yyyy-MM-dd', $culture) }
  return $null
}

function Parse-TallyMoney([string]$Text) {
  if (-not $Text) { return $null }
  $value = [decimal]::Zero
  if (-not [decimal]::TryParse(($Text -replace ',', '').Trim(), [Globalization.NumberStyles]::Number -bor [Globalization.NumberStyles]::AllowLeadingSign,
    $culture, [ref]$value)) { return $null }
  return [long][math]::Round([math]::Abs($value) * 100, 0, [MidpointRounding]::AwayFromZero)
}

function Get-TallyXml {
  if ($InputXmlPath) { return [xml](Get-Content -LiteralPath $InputXmlPath -Raw) }
  $requestBody = @'
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Voucher Register</REPORTNAME>
    <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>
'@
  try {
    $response = Invoke-WebRequest -Uri $script:Config.TallyUrl -Method Post -ContentType 'text/xml; charset=utf-8' -Body $requestBody -TimeoutSec 20 -UseBasicParsing
  } catch {
    throw "Cannot read Tally XML at $($script:Config.TallyUrl). Open Tally, enable its local XML server, and retry. Details: $($_.Exception.Message)"
  }
  return [xml]$response.Content
}

function Get-Vouchers($Document) {
  $nodes = $Document.SelectNodes('//VOUCHER')
  if (-not $nodes -or $nodes.Count -eq 0) { throw 'Tally returned no voucher rows. No local records were removed or changed.' }
  $result = @()
  foreach ($voucher in $nodes) {
    $voucherType = Read-NodeText $voucher 'VOUCHERTYPENAME'
    $category = if ($voucherType -match '(?i)^sales?') { 'receivable' } elseif ($voucherType -match '(?i)^purchases?') { 'payable' } else { continue }
    $sourceId = Read-NodeText $voucher 'MASTERID'
    if (-not $sourceId) { $sourceId = Read-NodeText $voucher 'GUID' }
    if (-not $sourceId) { throw "A $voucherType voucher has no stable MASTERID or GUID; refusing a non-idempotent sync." }
    $date = Parse-TallyDate (Read-NodeText $voucher 'DATE')
    if (-not $date) { throw "Voucher $sourceId has an invalid DATE. Correct it in Tally before syncing." }
    $external = Read-NodeText $voucher 'CASHFLOW_INVOICENUMBER'
    if (-not $external) { $external = Read-NodeText $voucher 'VOUCHERNUMBER' }
    $counterparty = Read-NodeText $voucher 'CASHFLOW_PARTY'
    if (-not $counterparty) { $counterparty = Read-NodeText $voucher 'PARTYLEDGERNAME' }
    if (-not $counterparty) {
      $party = $voucher.SelectSingleNode(".//*[self::ALLLEDGERENTRIES.LIST or self::LEDGERENTRIES.LIST][ISPARTYLEDGER='Yes']")
      if ($party) { $counterparty = Read-NodeText $party 'LEDGERNAME' }
    }
    if (-not $counterparty) { $counterparty = 'Tally counterparty pending review' }
    $totalPaise = Parse-TallyMoney (Read-NodeText $voucher 'CASHFLOW_AMOUNT')
    $hasCustomTotal = $null -ne $totalPaise
    if (-not $hasStructuredBalance) {
      $entry = $voucher.SelectSingleNode(".//*[self::ALLLEDGERENTRIES.LIST or self::LEDGERENTRIES.LIST][ISPARTYLEDGER='Yes']")
      if ($entry) { $totalPaise = Parse-TallyMoney (Read-NodeText $entry 'AMOUNT') }
    }
    if (-not $totalPaise -or $totalPaise -le 0) { continue }
    $settledPaise = Parse-TallyMoney (Read-NodeText $voucher 'CASHFLOW_SETTLED')
    $hasCustomSettled = $null -ne $settledPaise
    $outstandingPaise = Parse-TallyMoney (Read-NodeText $voucher 'CASHFLOW_OUTSTANDING')
    if ($null -ne $outstandingPaise) { $settledPaise = $totalPaise - $outstandingPaise }
    if ($null -eq $settledPaise) { $settledPaise = 0 }
    $dueDate = Parse-TallyDate (Read-NodeText $voucher 'CASHFLOW_DUEDATE')
    $hasStructuredBalance = $hasCustomTotal -and ($hasCustomSettled -or $null -ne $outstandingPaise) -and $null -ne $dueDate
    if ($settledPaise -lt 0 -or $settledPaise -gt $totalPaise) { throw "Voucher $sourceId has inconsistent settled and total amounts." }
    if (-not $dueDate) { $dueDate = $date }
    $expectedDate = Parse-TallyDate (Read-NodeText $voucher 'CASHFLOW_EXPECTEDDATE')
    if (-not $expectedDate) { $expectedDate = $dueDate }
    $status = if ($settledPaise -eq $totalPaise) { 'paid' } elseif ($settledPaise -gt 0) { 'partial' } else { 'open' }
    $settlementField = if ($settledPaise -eq $totalPaise) { Read-NodeText $voucher 'CASHFLOW_CLEAREDDATE' } else { '' }
    $clearedDate = Parse-TallyDate $settlementField
    $versionSource = Read-NodeText $voucher 'ALTERID'
    $xmlBytes = [Text.Encoding]::UTF8.GetBytes($voucher.OuterXml)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $contentHash = ([BitConverter]::ToString($sha.ComputeHash($xmlBytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    $version = if ($versionSource) { "$versionSource-$contentHash" } else { $contentHash }
    $item = [ordered]@{ category = $category; externalId = $external; counterparty = $counterparty.Substring(0, [math]::Min(200, $counterparty.Length));
      description = $voucherType; sourceSystem = 'tally_export'; amountPaise = $totalPaise; settledPaise = $settledPaise; status = $status;
      dueDate = $dueDate; expectedDate = $expectedDate; confidenceState = if ($hasStructuredBalance -and ($status -ne 'paid' -or $clearedDate)) { 'verified' } else { 'needs_review' } }
    $row = [ordered]@{ sourceId = $sourceId; version = $version; item = $item }
    if ($clearedDate -and $settledPaise -eq $totalPaise -and $hasStructuredBalance) { $row.paymentEvidence = @{ clearedDate = $clearedDate; amountPaise = $totalPaise } }
    $result += [pscustomobject]$row
  }
  if ($result.Count -eq 0) { throw 'Tally had no supported Sales or Purchase vouchers with valid amounts. No sync batch was sent.' }
  return $result
}

function Get-PlainToken([string]$Encrypted) {
  $secure = ConvertTo-SecureString $Encrypted
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Send-Api([string]$Path, $Body) {
  $token = Get-PlainToken $script:Config.DeviceToken
  try {
    return Invoke-RestMethod -Uri "$($script:Config.ApiBaseUrl)/workspaces/$($script:Config.WorkspaceId)/sync/$Path" -Method Post `
      -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20 -Compress) -TimeoutSec 30
  } finally { $token = $null }
}

if ($Initialize) { Write-Config; exit 0 }
if ($ParseOnly) {
  if (-not $InputXmlPath) { throw '-ParseOnly requires -InputXmlPath so it never contacts a live Tally server.' }
  @(Get-Vouchers (Get-TallyXml)) | ConvertTo-Json -Depth 20
  exit 0
}
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Sync configuration is missing. Run this script once with -Initialize. Expected: $ConfigPath" }
$script:Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($InstallTask) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy RemoteSigned -File `"$PSCommandPath`" -ConfigPath `"$ConfigPath`""
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName 'CashFlow Copilot Tally Sync' -Action $action -Trigger $trigger -Description 'Read-only Tally sync for CashFlow Copilot' -Force | Out-Null
  Write-Host 'Scheduled a read-only sync every 30 minutes for the current Windows user.'
  exit 0
}

$runId = [guid]::NewGuid().ToString()
$startedAt = [datetime]::UtcNow
$pendingCount = 0
$appliedCount = 0
try {
  Send-Api 'runs' @{ runId = $runId; companyId = $script:Config.CompanyId; status = 'running'; startedAt = $startedAt.ToString('o') } | Out-Null
  $document = Get-TallyXml
  $rows = @(Get-Vouchers $document)
  $state = if (Test-Path -LiteralPath $script:Config.StatePath) { Get-Content -LiteralPath $script:Config.StatePath -Raw | ConvertFrom-Json } else { [pscustomobject]@{ sourceIds = @() } }
  $currentIds = @($rows | ForEach-Object { $_.sourceId })
  $currentSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($id in $currentIds) { [void]$currentSet.Add($id) }
  $deletedRows = @()
  foreach ($priorId in @($state.sourceIds)) {
    if (-not $currentSet.Contains([string]$priorId)) {
      $deletedRows += [pscustomobject]@{ sourceId = [string]$priorId; version = "deleted-$runId"; deleted = $true }
      $pendingCount++
    }
  }
  $allRows = @($rows) + @($deletedRows)
  for ($offset = 0; $offset -lt $allRows.Count; $offset += 500) {
    $count = [math]::Min(500, $allRows.Count - $offset)
    $chunk = @($allRows[$offset..($offset + $count - 1)])
    $result = Send-Api 'batches' @{ companyId = $script:Config.CompanyId; batchId = [guid]::NewGuid().ToString(); rows = $chunk }
    $appliedCount += [int]$result.count
  }
  $state = [pscustomobject]@{ sourceIds = $currentIds; lastSnapshotAt = [datetime]::UtcNow.ToString('o') }
  $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $script:Config.StatePath -Encoding UTF8
  Send-Api 'runs' @{ runId = $runId; companyId = $script:Config.CompanyId; status = 'succeeded'; startedAt = $startedAt.ToString('o');
    completedAt = [datetime]::UtcNow.ToString('o'); pendingCount = $pendingCount; appliedCount = $appliedCount } | Out-Null
  Write-Host "Sync succeeded: $appliedCount row(s) sent; $pendingCount deletion(s) require owner review."
} catch {
  $message = $_.Exception.Message
  try { Send-Api 'runs' @{ runId = $runId; companyId = $script:Config.CompanyId; status = 'failed'; startedAt = $startedAt.ToString('o');
    completedAt = [datetime]::UtcNow.ToString('o'); pendingCount = $pendingCount; appliedCount = $appliedCount; errorCode = 'SYNC_FAILED'; errorMessage = $message.Substring(0, [math]::Min(500, $message.Length)) } | Out-Null }
  catch { Write-Error "The sync failed and the error could not be reported to the API: $message. Report error: $($_.Exception.Message)"; exit 1 }
  Write-Error $message
  exit 1
}
