$response = Invoke-WebRequest -Uri 'http://localhost:3506/api/hosxp/kidney-monitor?startDate=2026-03-20&endDate=2026-03-21' -UseBasicParsing
$data = $response.Content | ConvertFrom-Json

$otherCount = ($data.data | Where-Object { $_.insuranceGroup -eq 'OTHER' }).Count
$ucsCount = ($data.data | Where-Object { $_.insuranceGroup -eq 'UCS+SSS' }).Count
$ofcCount = ($data.data | Where-Object { $_.insuranceGroup -eq 'OFC+LGO' }).Count
$ucCount = ($data.data | Where-Object { $_.insuranceGroup -eq 'UC-EPO' }).Count

Write-Host "Total records: $($data.data.Count)"
Write-Host "UCS+SSS: $ucsCount"
Write-Host "OFC+LGO: $ofcCount"
Write-Host "UC-EPO: $ucCount"
Write-Host "OTHER: $otherCount"

if ($otherCount -gt 0) {
  Write-Host ""
  Write-Host "Records with OTHER:"
  ($data.data | Where-Object { $_.insuranceGroup -eq 'OTHER' }) | ForEach-Object {
    Write-Host "  HN: $($_.hn), Type: $($_.insuranceType)"
  }
}
