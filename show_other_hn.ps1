$response = Invoke-WebRequest -Uri 'http://localhost:3506/api/hosxp/kidney-monitor?startDate=2026-03-20&endDate=2026-03-21' -UseBasicParsing
$data = $response.Content | ConvertFrom-Json

$others = $data.data | Where-Object { $_.insuranceGroup -eq 'OTHER' }

Write-Host "Found $($others.Count) OTHER records"
Write-Host ""

$others | ForEach-Object {
  $hn = $_.hn
  Write-Host "=========================================="
  Write-Host "HN: $hn"
  Write-Host "Name: $($_.patientName)"
  Write-Host "Insurance Type: $($_.insuranceType)"
  
  # Try to read from database
  try {
    $dbconn = New-Object System.Data.SqlClient.SqlConnection
    # Since we're using MySQL, we'll just output what we have from the API
    Write-Host "Note: Need to check database separately"
  } catch {}
}
