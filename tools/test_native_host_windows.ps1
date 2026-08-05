[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$HostName = 'com.duongtc.firefox_chat_assistant.integration_test'
$InstallDir = Join-Path ([System.IO.Path]::GetTempPath()) ("fci-native-host-" + [Guid]::NewGuid().ToString('N'))

function Invoke-PythonScript {
    param([Parameter(Mandatory = $true)][string]$ScriptPath)
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
        & $command.Source @($probe.Args) $ScriptPath
        return $LASTEXITCODE
    }
    throw 'Python 3 was not found for the Windows integration contract test.'
}

try {
    & (Join-Path $Root 'native-host\install_native_host.ps1') -Scope CurrentUser -InstallDir $InstallDir -HostName $HostName
    if ($LASTEXITCODE -ne 0) { throw 'Windows Native Host installer failed.' }

    $manifestPath = Join-Path $InstallDir "$HostName.json"
    $launcherPath = Join-Path $InstallDir 'native_host.cmd'
    $hostPath = Join-Path $InstallDir 'native_host.py'
    foreach ($path in @($manifestPath, $launcherPath, $hostPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing installed file: $path" }
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.name -ne $HostName) { throw 'Installed manifest name is incorrect.' }
    if ($manifest.path -ne $launcherPath) { throw 'Installed manifest launcher path is incorrect.' }

    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $key = $base.OpenSubKey("Software\Mozilla\NativeMessagingHosts\$HostName")
            if ($null -eq $key) { throw "Missing registry key in $view view." }
            try {
                if ($key.GetValue('') -ne $manifestPath) { throw "Incorrect registry manifest path in $view view." }
            }
            finally { $key.Dispose() }
        }
        finally { $base.Dispose() }
    }

    $contractExit = Invoke-PythonScript -ScriptPath (Join-Path $Root 'tests\test_phase28_v02825_windows_native_host.py')
    if ($contractExit -ne 0) { throw "Cross-platform Windows Native Host contract test failed with exit code $contractExit." }
    Write-Host 'PASS: Windows Native Host install, dual registry-view registration and runtime contracts'
}
finally {
    try {
        & (Join-Path $Root 'native-host\uninstall_native_host.ps1') -Scope CurrentUser -InstallDir $InstallDir -HostName $HostName
    }
    catch {
        Write-Warning "Integration-test cleanup failed: $($_.Exception.Message)"
    }
}
