[CmdletBinding()]
param(
    [string]$Server = '192.168.2.202',
    [string]$SshUser = 'war12oc',
    [string]$ProjectPath = '/opt/FDHChecker',
    [string]$Branch = 'agent/add-local-ai',
    [ValidateSet('backend', 'frontend', 'all')]
    [string]$Target = 'backend',
    [switch]$Backup
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    throw 'ไม่พบคำสั่ง ssh กรุณาติดตั้ง Windows OpenSSH Client ก่อน deploy'
}

function ConvertTo-BashLiteral([string]$Value) {
    if ($Value -notmatch '^[A-Za-z0-9_./ -]+$') {
        throw "ค่าที่ส่งไปยังเซิร์ฟเวอร์มีอักขระที่ไม่รองรับ: $Value"
    }
    return "'$Value'"
}

$pm2Apps = switch ($Target) {
    'backend' { 'fdh-backend' }
    'frontend' { 'fdh-frontend' }
    'all' { 'fdh-backend fdh-frontend' }
}
$backupValue = if ($Backup) { '1' } else { '0' }

$remoteCommand = @(
    'cd ' + (ConvertTo-BashLiteral $ProjectPath)
    'FDH_DEPLOY_BRANCH=' + (ConvertTo-BashLiteral $Branch) +
        ' FDH_PM2_APPS=' + (ConvertTo-BashLiteral $pm2Apps) +
        ' FDH_DEPLOY_BACKUP=' + (ConvertTo-BashLiteral $backupValue) +
        ' bash deploy/scripts/deploy-app.sh'
) -join ' && '

Write-Host "Deploy $Target ไปยัง $SshUser@$Server ($Branch)" -ForegroundColor Cyan
Write-Host 'หาก SSH key ยังไม่ถูกติดตั้ง ระบบจะถามรหัสผ่านโดยไม่แสดงตัวอักษร' -ForegroundColor DarkGray

& ssh -o ConnectTimeout=15 -o ServerAliveInterval=30 -t "$SshUser@$Server" $remoteCommand
if ($LASTEXITCODE -ne 0) {
    throw "Deploy ไม่สำเร็จ (ssh exit code $LASTEXITCODE)"
}

Write-Host 'Deploy สำเร็จ และ health checks ผ่านแล้ว' -ForegroundColor Green
