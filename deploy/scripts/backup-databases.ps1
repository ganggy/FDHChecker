[CmdletBinding()]
param(
    [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [string]$EnvFile,
    [string]$BackupDir,
    [switch]$IncludeHosxp
)

$ErrorActionPreference = 'Stop'

if (-not $EnvFile) { $EnvFile = Join-Path $ProjectDir '.env' }
if (-not $BackupDir) { $BackupDir = Join-Path $ProjectDir 'backups' }

$projectPath = [System.IO.Path]::GetFullPath($ProjectDir)
$envPath = [System.IO.Path]::GetFullPath($EnvFile)
$backupRoot = [System.IO.Path]::GetFullPath($BackupDir)

if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw "Environment file is not readable: $envPath"
}

$fileSettings = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) { continue }
    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    $fileSettings[$name] = $value
}

function Get-Setting {
    param([string]$Name, [string]$FallbackName, [string]$DefaultValue)
    $value = [Environment]::GetEnvironmentVariable($Name)
    if (-not $value) { $value = $fileSettings[$Name] }
    if (-not $value -and $FallbackName) {
        $value = [Environment]::GetEnvironmentVariable($FallbackName)
        if (-not $value) { $value = $fileSettings[$FallbackName] }
    }
    if (-not $value) { $value = $DefaultValue }
    return [string]$value
}

$mysqldump = Get-Command mysqldump -ErrorAction SilentlyContinue
if (-not $mysqldump) { throw 'mysqldump was not found in PATH' }

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$destination = [System.IO.Path]::GetFullPath((Join-Path $backupRoot $stamp))
$rootPrefix = $backupRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
if (-not $destination.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Backup destination escaped the configured root: $destination"
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null

function Invoke-DatabaseDump {
    param(
        [string]$Label,
        [string]$HostName,
        [string]$UserName,
        [string]$Password,
        [string]$DatabaseName
    )
    foreach ($required in @{ Host = $HostName; User = $UserName; Password = $Password; Database = $DatabaseName }.GetEnumerator()) {
        if (-not $required.Value) { throw "$Label backup is missing $($required.Key)" }
    }

    $sqlPath = [System.IO.Path]::GetFullPath((Join-Path $destination "$Label.sql"))
    $gzipPath = "$sqlPath.gz"
    if (-not $sqlPath.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe backup target: $sqlPath"
    }

    $previousMysqlPassword = [Environment]::GetEnvironmentVariable('MYSQL_PWD')
    try {
        [Environment]::SetEnvironmentVariable('MYSQL_PWD', $Password)
        $dumpArguments = @(
            "--host=$HostName"
            "--user=$UserName"
            '--single-transaction'
            '--quick'
            '--routines'
            '--triggers'
            '--default-character-set=utf8mb4'
            "--result-file=$sqlPath"
            $DatabaseName
        )
        & $mysqldump.Source @dumpArguments
        if ($LASTEXITCODE -ne 0) { throw "mysqldump failed for $Label with exit code $LASTEXITCODE" }
        if (-not (Test-Path -LiteralPath $sqlPath) -or (Get-Item -LiteralPath $sqlPath).Length -eq 0) {
            throw "mysqldump produced an empty file for $Label"
        }

        $inputStream = [System.IO.File]::OpenRead($sqlPath)
        try {
            $outputStream = [System.IO.File]::Create($gzipPath)
            try {
                $gzipStream = [System.IO.Compression.GZipStream]::new($outputStream, [System.IO.Compression.CompressionLevel]::Optimal)
                try { $inputStream.CopyTo($gzipStream) } finally { $gzipStream.Dispose() }
            } finally { $outputStream.Dispose() }
        } finally { $inputStream.Dispose() }

        if ((Get-Item -LiteralPath $gzipPath).Length -eq 0) { throw "Compression produced an empty file for $Label" }
        Remove-Item -LiteralPath $sqlPath -Force
        Write-Host "Created $gzipPath"
    } finally {
        [Environment]::SetEnvironmentVariable('MYSQL_PWD', $previousMysqlPassword)
    }
}

$repstmDump = @{
    Label = 'repstm'
    HostName = Get-Setting 'REPSTM_HOST' 'HOSXP_HOST' '127.0.0.1'
    UserName = Get-Setting 'REPSTM_BACKUP_USER' 'REPSTM_USER' ''
    Password = Get-Setting 'REPSTM_BACKUP_PASSWORD' 'REPSTM_PASSWORD' ''
    DatabaseName = Get-Setting 'REPSTM_DB' '' 'repstminv'
}
Invoke-DatabaseDump @repstmDump

if ($IncludeHosxp -or (Get-Setting 'FDH_BACKUP_HOSXP' '' '0') -eq '1') {
    $hosxpDump = @{
        Label = 'hosxp'
        HostName = Get-Setting 'HOSXP_HOST' '' '127.0.0.1'
        UserName = Get-Setting 'HOSXP_BACKUP_USER' 'HOSXP_USER' ''
        Password = Get-Setting 'HOSXP_BACKUP_PASSWORD' 'HOSXP_PASSWORD' ''
        DatabaseName = Get-Setting 'HOSXP_DB' '' ''
    }
    Invoke-DatabaseDump @hosxpDump
}

Write-Host "Backup complete: $destination"
