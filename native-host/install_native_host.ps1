[CmdletBinding()]
param(
    [ValidateSet('CurrentUser', 'AllUsers')]
    [string]$Scope = 'CurrentUser',

    [string]$InstallDir = '',

    [ValidatePattern('^[A-Za-z0-9_.-]+$')]
    [string]$HostName = 'com.duongtc.firefox_chat_assistant',

    [switch]$SkipSelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-PythonExecutable {
    $probes = @(
        @{ Name = 'py.exe'; Args = @('-3') },
        @{ Name = 'python.exe'; Args = @() },
        @{ Name = 'python3.exe'; Args = @() },
        @{ Name = 'python'; Args = @() },
        @{ Name = 'python3'; Args = @() }
    )
    foreach ($probe in $probes) {
        $command = Get-Command $probe.Name -ErrorAction SilentlyContinue
        if ($null -eq $command) { continue }
        $arguments = @($probe.Args) + @('-c', 'import sys; print(sys.executable)')
        $resolved = (& $command.Source @arguments 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($resolved)) {
            return [System.IO.Path]::GetFullPath($resolved.Trim())
        }
    }
    throw 'Python 3 was not found. Install Python 3 and ensure py.exe or python.exe is available.'
}

function Set-NativeMessagingRegistry {
    param(
        [Microsoft.Win32.RegistryHive]$Hive,
        [Microsoft.Win32.RegistryView]$View,
        [string]$Name,
        [string]$ManifestPath
    )
    $base = $null
    $key = $null
    try {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $View)
        $keyPath = "Software\Mozilla\NativeMessagingHosts\$Name"
        $key = $base.CreateSubKey($keyPath, $true)
        if ($null -eq $key) { throw "Could not create registry key: $keyPath" }
        $key.SetValue('', $ManifestPath, [Microsoft.Win32.RegistryValueKind]::String)
    }
    finally {
        if ($null -ne $key) { $key.Dispose() }
        if ($null -ne $base) { $base.Dispose() }
    }
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$SourceHost = Join-Path $PSScriptRoot 'native_host.py'
$SourceManifest = Join-Path $PSScriptRoot 'manifest-template.json'
if (-not (Test-Path -LiteralPath $SourceHost -PathType Leaf)) { throw "Missing Native Host source: $SourceHost" }
if (-not (Test-Path -LiteralPath $SourceManifest -PathType Leaf)) { throw "Missing Native Host manifest template: $SourceManifest" }

$PythonPath = Resolve-PythonExecutable
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    if ($Scope -eq 'AllUsers') {
        if ([string]::IsNullOrWhiteSpace($env:ProgramData)) { throw 'ProgramData is not available.' }
        $InstallDir = Join-Path $env:ProgramData 'FirefoxChatAIAssistant\native-host'
    }
    else {
        if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'LOCALAPPDATA is not available.' }
        $InstallDir = Join-Path $env:LOCALAPPDATA 'FirefoxChatAIAssistant\native-host'
    }
}
$InstallDir = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($InstallDir))
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$HostPath = Join-Path $InstallDir 'native_host.py'
$LauncherPath = Join-Path $InstallDir 'native_host.cmd'
$ManifestPath = Join-Path $InstallDir "$HostName.json"
Copy-Item -LiteralPath $SourceHost -Destination $HostPath -Force

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$launcherContent = "@echo off`r`n`"$PythonPath`" -u `"$HostPath`" %*`r`n"
[System.IO.File]::WriteAllText($LauncherPath, $launcherContent, $utf8NoBom)

$manifest = Get-Content -LiteralPath $SourceManifest -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest.name = $HostName
$manifest.path = $LauncherPath
$manifestJson = $manifest | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($ManifestPath, $manifestJson + "`r`n", $utf8NoBom)

$hive = if ($Scope -eq 'AllUsers') {
    [Microsoft.Win32.RegistryHive]::LocalMachine
} else {
    [Microsoft.Win32.RegistryHive]::CurrentUser
}
$registeredViews = New-Object System.Collections.Generic.List[string]
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    try {
        Set-NativeMessagingRegistry -Hive $hive -View $view -Name $HostName -ManifestPath $ManifestPath
        $registeredViews.Add($view.ToString())
    }
    catch {
        if ([Environment]::Is64BitOperatingSystem) { throw }
    }
}

if (-not $SkipSelfTest) {
    & $PythonPath -u $HostPath --self-test
    if ($LASTEXITCODE -ne 0) { throw "Native Host self-test failed with exit code $LASTEXITCODE." }
}

Write-Host 'Installed/updated Firefox ChatAI Assistant Native Host for Windows:'
Write-Host "  scope:    $Scope"
Write-Host "  host:     $HostPath"
Write-Host "  launcher: $LauncherPath"
Write-Host "  manifest: $ManifestPath"
Write-Host "  registry: $($registeredViews -join ', ')"
Write-Host 'Reload the add-on or restart Firefox, then click Check Native Host in the Shell command group.'
