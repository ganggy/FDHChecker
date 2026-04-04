#!/usr/bin/env pwsh

# Kill any existing npm server processes
Write-Host "🛑 Stopping existing servers..." -ForegroundColor Yellow
Get-Process | Where-Object { $_.ProcessName -like "*npm*" -or $_.ProcessName -like "*node*" } | Stop-Process -Force -ErrorAction SilentlyContinue

# Wait a moment
Start-Sleep -Seconds 2

# Start the server
Write-Host "🚀 Starting backend server with increased connection pool (30)..." -ForegroundColor Green
npm run server

Write-Host "✅ Backend server started!" -ForegroundColor Green
