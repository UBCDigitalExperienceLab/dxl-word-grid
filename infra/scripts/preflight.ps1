$ErrorActionPreference = "Stop"
$prefix = "dxl-word-grid-dev"
$profile = if ($env:AWS_PROFILE) { $env:AWS_PROFILE } else { "dev" }
$region = "ca-central-1"

Write-Host "Read-only inventory for prefix $prefix in $region (profile $profile)"

$tables = aws --profile $profile --region $region dynamodb list-tables --query TableNames --output text
$functions = aws --profile $profile --region $region lambda list-functions --query "Functions[].FunctionName" --output text
$apis = aws --profile $profile --region $region apigatewayv2 get-apis --query "Items[].Name" --output text
$roles = aws --profile $profile --region $region iam list-roles --query "Roles[].RoleName" --output text

$wanted = @(
  "$prefix-rooms",
  "$prefix-ws",
  "$prefix-lambda"
)

$haystack = "$tables $functions $apis $roles"
$collisions = @()
foreach ($name in $wanted) {
  if ($haystack -match [regex]::Escape($name)) {
    $collisions += $name
  }
}

Write-Host "Existing tables: $tables"
Write-Host "Collisions: $($collisions -join ', ')"

if ($collisions.Count -gt 0) {
  Write-Error "Name collision(s). Refusing to apply. Choose a new prefix."
  exit 2
}

Write-Host "Prefix appears free. Safe to create isolated resources only."
exit 0
