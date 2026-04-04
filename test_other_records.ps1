$response = Invoke-WebRequest -Uri 'http://localhost:3506/api/hosxp/kidney-monitor?startDate=2026-03-20&endDate=2026-03-21' -UseBasicParsing
$data = $response.Content | ConvertFrom-Json

# Find the record with OTHER
$otherRecords = $data.data | Where-Object { $_.insuranceGroup -eq 'OTHER' }

Write-Host "=== Records with 'OTHER' insuranceGroup ==="
$otherRecords | ForEach-Object {
    Write-Host ""
    Write-Host "HN: $($_.hn)"
    Write-Host "VN: $($_.vn)"
    Write-Host "Patient: $($_.patientName)"
    Write-Host "Insurance Type: $($_.insuranceType)"
    Write-Host "Insurance Group: $($_.insuranceGroup)"
    Write-Host "hipdata_code: $($_.hipdata_code)"
}

Write-Host ""
Write-Host "Total records with OTHER: $($otherRecords.Count)"
