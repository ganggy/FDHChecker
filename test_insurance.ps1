$response = Invoke-WebRequest -Uri 'http://localhost:3506/api/hosxp/kidney-monitor?startDate=2026-03-20&endDate=2026-03-21' -UseBasicParsing
$data = $response.Content | ConvertFrom-Json
Write-Host "=== First Record ==="
Write-Host "HN: $($data.data[0].hn)"
Write-Host "Name: $($data.data[0].patientName)"
Write-Host "Insurance Group: $($data.data[0].insuranceGroup)"
Write-Host "Insurance Type: $($data.data[0].insuranceType)"
Write-Host ""
Write-Host "=== All insuranceGroup values ==="
$data.data | Select-Object -First 5 | ForEach-Object {
    Write-Host "HN: $($_.hn), Group: $($_.insuranceGroup), Type: $($_.insuranceType)"
}
