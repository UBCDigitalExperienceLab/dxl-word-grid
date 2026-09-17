$ErrorActionPreference = "Stop"
$awsProfile = if ($env:AWS_PROFILE) { $env:AWS_PROFILE } else { "dev" }
$region = "ca-central-1"
$prefix = "dxl-word-grid-dev"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $root "package.json"))) {
  $root = Get-Location
}

Set-Location $root

# Build the bundle.
node scripts/package-lambdas.mjs

$fn = "$prefix-ws"
$zip = Join-Path $root "dist/lambdas/ws.zip"
Write-Host "Updating $fn from $zip"
aws --profile $awsProfile --region $region lambda update-function-code `
  --function-name $fn `
  --zip-file "fileb://$zip" | Out-Null
aws --profile $awsProfile --region $region lambda wait function-updated --function-name $fn

# Refresh environment (TABLE_NAME + optional PUBLIC_URL for join links).
$tableName = "$prefix-rooms"
$publicUrl = if ($env:PUBLIC_URL) { $env:PUBLIC_URL } else { "" }
$vars = "TABLE_NAME=$tableName"
if ($publicUrl) { $vars += ",PUBLIC_URL=$publicUrl" }
aws --profile $awsProfile --region $region lambda update-function-configuration `
  --function-name $fn `
  --environment "Variables={$vars}" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to update $fn environment" }

Write-Host "Lambda code deployed."
