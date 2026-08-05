[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ToolDir = Join-Path $Root '.firefox-dev-tools'
if ($null -eq (Get-Command npm.cmd -ErrorAction SilentlyContinue) -and $null -eq (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found. Install Node.js LTS first.'
}
New-Item -ItemType Directory -Force -Path $ToolDir | Out-Null
& npm install --prefix $ToolDir web-ext
if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
$WebExt = Join-Path $ToolDir 'node_modules\.bin\web-ext.cmd'
if (-not (Test-Path -LiteralPath $WebExt -PathType Leaf)) { throw "web-ext was not installed: $WebExt" }
& $WebExt --version
Write-Host "PASS: Firefox add-on development tools installed at $ToolDir"
