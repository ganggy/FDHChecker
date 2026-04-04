#!/usr/bin/env pwsh

# FDH Rect - Frontend Quick Start Script
# PowerShell version

Write-Host "`n" -ForegroundColor Green
Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║     FDH RECT - FRONTEND STARTUP SCRIPT (PowerShell)           ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host "`n"

# Set working directory
$projectPath = "d:\react\fdh_rect"
Set-Location $projectPath

Write-Host "📁 Working Directory: $projectPath`n" -ForegroundColor Cyan

# Check if package.json exists
if (!(Test-Path "package.json")) {
    Write-Host "❌ package.json not found in $projectPath" -ForegroundColor Red
    Write-Host "Please run this script from the correct directory`n" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "✅ Found package.json`n" -ForegroundColor Green

# Check and install dependencies if needed
if (!(Test-Path "node_modules")) {
    Write-Host "📦 node_modules not found - Installing dependencies..." -ForegroundColor Yellow
    Write-Host "This may take 2-3 minutes on first run`n" -ForegroundColor Yellow
    
    npm install
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n❌ npm install failed" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "`n✅ Dependencies installed successfully`n" -ForegroundColor Green
} else {
    Write-Host "✅ Dependencies already installed`n" -ForegroundColor Green
}

# Display system info
Write-Host "📊 System Information:" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:3001 (Already running)" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:3507 (Starting...)`n" -ForegroundColor Yellow

Write-Host "🚀 Starting Vite Development Server...`n" -ForegroundColor Cyan

# Start the development server
Write-Host "Waiting for build to complete (30-60 seconds)...`n" -ForegroundColor Yellow

npm run dev

Write-Host "`n❌ Development server stopped" -ForegroundColor Red
Read-Host "Press Enter to exit"
