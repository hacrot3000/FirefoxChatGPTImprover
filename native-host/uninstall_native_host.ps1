[CmdletBinding()]
param(
    [ValidateSet('CurrentUser', 'AllUsers')]
    [string]$Scope = 'CurrentUser',

    [string]$InstallDir = '',

    [ValidatePattern('^[A-Za-z0-9_.-]+$')]
    [string]$HostName = 'com.duongtc.firefox_chat_assistant',

    [switch]$PurgeData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Remove-NativeMessagingRegistry {
    param(
        [Microsoft.Win32.RegistryHive]$Hive,
        [Microsoft.Win32.RegistryView]$View,
        [string]$Name
    )
    $base = $null
    try {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $View)
        $keyPath = "Software\Mozilla\NativeMessagingHosts\$Name"
        $base.DeleteSubKeyTree($keyPath, $false)
    }
    finally {
        if ($null -ne $base) { $base.Dispose() }
    }
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    if ($Scope -eq 'AllUsers') {
        $InstallDir = Join-Path $env:ProgramData 'FirefoxChatAIAssistant\native-host'
    }
    else {
        $InstallDir = Join-Path $env:LOCALAPPDATA 'FirefoxChatAIAssistant\native-host'
    }
}
$InstallDir = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($InstallDir))
$hive = if ($Scope -eq 'AllUsers') {
    [Microsoft.Win32.RegistryHive]::LocalMachine
} else {
    [Microsoft.Win32.RegistryHive]::CurrentUser
}
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    try {
        Remove-NativeMessagingRegistry -Hive $hive -View $view -Name $HostName
    }
    catch {
        if ([Environment]::Is64BitOperatingSystem) { throw }
    }
}

if (Test-Path -LiteralPath $InstallDir) {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
}
if ($PurgeData -and -not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $stateRoot = Join-Path $env:LOCALAPPDATA 'FirefoxChatAIAssistant\state'
    if (Test-Path -LiteralPath $stateRoot) {
        Remove-Item -LiteralPath $stateRoot -Recurse -Force
    }
}

Write-Host 'Removed the Firefox Native Messaging registration and installed Native Host copy.'
if ($PurgeData) {
    Write-Host 'Removed Native Host state, receipts and logs for the current Windows user.'
} else {
    Write-Host 'Command logs and relocation receipts were preserved. Use -PurgeData to remove them.'
}
