#!/usr/bin/env pwsh
#requires -Version 7.0
<#
.SYNOPSIS
    Starts a full local Butler.API development session: a repo-local Azurite
    Table Storage emulator plus the API running in Development against it.

.DESCRIPTION
    Butler persists to Azure Table Storage (Engineering Contract 7.3). This
    script mirrors the deployed shape locally so you exercise the real
    Table-backed repositories instead of the in-memory fallback:

      1. Starts Azurite (the Azure Storage emulator) with its data under a
         git-ignored .azurite/ folder in this directory.
      2. Points the API at it via Storage__ConnectionString=UseDevelopmentStorage=true.
      3. Runs the API in Development (Swagger at /swagger).

    Azurite comes from a local/global npm install; if it is not found the script
    falls back to `npx azurite` (downloads on first use). Both need Node.js.

    You do NOT need this script for a quick run or for tests: with no storage
    configured the API falls back to an in-memory seed store automatically
    (`dotnet run --project src/Butler.Api`, `dotnet test`).

.PARAMETER SkipAzurite
    Run the API in Development but do not start Azurite. Without a configured
    connection the API uses its in-memory fallback store.

.EXAMPLE
    ./Start-LocalSession.ps1
.EXAMPLE
    ./Start-LocalSession.ps1 -SkipAzurite
#>
[CmdletBinding()]
param(
    [switch]$SkipAzurite
)

$ErrorActionPreference = 'Stop'
$scriptRoot = $PSScriptRoot
$azuriteProcess = $null

function Resolve-AzuriteCommand {
    if (Get-Command azurite -ErrorAction SilentlyContinue) {
        return @{ File = 'azurite'; Prefix = @() }
    }
    if (Get-Command npx -ErrorAction SilentlyContinue) {
        return @{ File = 'npx'; Prefix = @('--yes', 'azurite') }
    }
    throw "Azurite was not found. Install it with 'npm install -g azurite' (needs Node.js), or pass -SkipAzurite to run against the in-memory store."
}

try {
    if (-not $SkipAzurite) {
        $dataDir = Join-Path $scriptRoot '.azurite'
        New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

        $azurite = Resolve-AzuriteCommand
        $arguments = $azurite.Prefix + @('--silent', '--location', $dataDir, '--tableHost', '127.0.0.1')

        Write-Host "Starting Azurite (Table Storage emulator) with data in $dataDir ..." -ForegroundColor Cyan
        $azuriteProcess = Start-Process -FilePath $azurite.File -ArgumentList $arguments -PassThru -NoNewWindow

        # Give the emulator a moment to bind its ports before the API connects.
        Start-Sleep -Seconds 2

        $env:Storage__ConnectionString = 'UseDevelopmentStorage=true'
        Write-Host "API will use Azurite via UseDevelopmentStorage=true." -ForegroundColor Cyan
    }
    else {
        Write-Host "Skipping Azurite: the API will use its in-memory fallback store." -ForegroundColor Yellow
    }

    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    Write-Host "Starting Butler.API (Development) ... press Ctrl+C to stop." -ForegroundColor Green
    dotnet run --project (Join-Path $scriptRoot 'src/Butler.Api')
}
finally {
    if ($azuriteProcess -and -not $azuriteProcess.HasExited) {
        Write-Host "Stopping Azurite ..." -ForegroundColor Cyan
        Stop-Process -Id $azuriteProcess.Id -ErrorAction SilentlyContinue
    }
}
