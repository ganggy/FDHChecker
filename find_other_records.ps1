$response = Invoke-WebRequest -Uri 'http://localhost:3506/api/hosxp/kidney-monitor?startDate=2026-03-20&endDate=2026-03-21' -UseBasicParsing
$data = $response.Content | ConvertFrom-Json

Write-Host "Records with OTHER insuranceGroup:"
$data.data | Where-Object { $_.insuranceGroup -eq 'OTHER' } | ForEach-Object {
  Write-Host ""
  Write-Host "HN: $($_.hn), VN: $($_.vn)"
  Write-Host "Name: $($_.patientName)"
  Write-Host "Type: $($_.insuranceType)"
  Write-Host "hipdata_code: $($_.hipdata_code)"
}
