#!/usr/bin/env pwsh
#requires -Version 7.0
<#
.SYNOPSIS
    Butler demo CLI (#102): one entry point for the local demo stack defined in
    demo/docker-compose.yml (Azurite + Butler.API + Caddy serving the hub).

.DESCRIPTION
    The PowerShell 7 twin of demo/demo.sh. Both scripts accept the same
    subcommands and print the same text, so keep every fixed string below
    byte-identical to the one in demo.sh. See demo/README.md.

      up      Build the hub export if needed, start the stack and wait until
              every service is healthy.
      down    Stop the stack. The Azurite data in demo/.data/azurite is kept.
      status  Show each container's state and health, the hub URL and the
              dataset id.
      logs    Show the stack logs. Extra arguments go to docker compose logs.

    There is deliberately no param() block: PowerShell would try to bind
    pass-through arguments such as `logs -f api` as its own parameters.

.EXAMPLE
    pwsh demo/demo.ps1 up
.EXAMPLE
    ./demo/demo.ps1 logs -f api
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$ComposeFile = Join-Path $PSScriptRoot 'docker-compose.yml'
$UiDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'Butler.UI'

$HubUrl = 'http://localhost:8080'
$DatasetUrl = "$HubUrl/api/api/system/dataset"
$WaitTimeout = '300'

# Subcommand registry, in usage order.
# To add a subcommand: add an entry here and an Invoke-Demo<Name> function
# below (and the same entry and handler in demo.sh, plus a row in
# demo/README.md).
$Commands = [ordered]@{
    up     = 'Build the hub export if needed, start the stack and wait until it is healthy'
    down   = 'Stop the stack (data in demo/.data/azurite is kept)'
    status = 'Show container health, the hub URL and the dataset id'
    logs   = 'Show the stack logs (extra arguments go to docker compose logs)'
}

# Files and folders under Butler.UI/ that the hub export is built from.
$UiSources = @('App.tsx', 'index.ts', 'app.json', 'package.json', 'package-lock.json', 'tsconfig.json',
    'design-tokens.json', 'src', 'public', 'assets', 'scripts/pwa-export.js')

function Write-Out([string]$Line) { [Console]::Out.WriteLine($Line) }
function Write-Err([string]$Line) { [Console]::Error.WriteLine($Line) }

function Write-Usage {
    Write-Err 'Usage: demo <command> [args]'
    Write-Err ''
    Write-Err 'Commands:'
    foreach ($name in $Commands.Keys) {
        Write-Err ('  {0,-9} {1}' -f $name, $Commands[$name])
    }
}

# Native output is never captured (it would end up in a return value), so
# every handler reports its exit code through $script:ExitCode instead.
$script:ExitCode = 0

function Invoke-Compose([string[]]$ComposeArgs) {
    & docker compose -f $ComposeFile @ComposeArgs
    $script:ExitCode = $LASTEXITCODE
}

# Returns 'missing', 'stale' or 'fresh' for the hub export in Butler.UI/dist.
function Get-ExportState {
    $markerPath = Join-Path (Join-Path $UiDir 'dist') 'index.html'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        return 'missing'
    }
    $marker = Get-Item -LiteralPath $markerPath -Force
    $paths = @($UiSources | ForEach-Object { Join-Path $UiDir $_ } | Where-Object { Test-Path -LiteralPath $_ })
    if ($paths.Count -eq 0) {
        return 'fresh'
    }
    $newer = Get-ChildItem -LiteralPath $paths -Recurse -File -Force |
        Where-Object { $_.LastWriteTimeUtc -gt $marker.LastWriteTimeUtc } |
        Select-Object -First 1
    if ($newer) { return 'stale' }
    return 'fresh'
}

# npm ci is needed when node_modules is missing or older than the lockfile.
function Test-NeedsNpmCi {
    $modules = Join-Path $UiDir 'node_modules'
    $installed = Join-Path $modules '.package-lock.json'
    if (-not (Test-Path -LiteralPath $modules -PathType Container)) { return $true }
    if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { return $true }
    $lock = Get-Item -LiteralPath (Join-Path $UiDir 'package-lock.json') -Force
    return $lock.LastWriteTimeUtc -gt (Get-Item -LiteralPath $installed -Force).LastWriteTimeUtc
}

function Invoke-ExportBuild {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Err 'npm was not found. Install Node 22 to build the hub export.'
        $script:ExitCode = 1
        return
    }
    Push-Location -LiteralPath $UiDir
    try {
        if (Test-NeedsNpmCi) {
            Write-Out 'Installing Butler.UI dependencies (npm ci) ...'
            & npm ci --no-audit --no-fund --loglevel=error
            $script:ExitCode = $LASTEXITCODE
            if ($script:ExitCode -ne 0) {
                Write-Err 'Hub export build failed.'
                return
            }
        }
        # Expo inlines EXPO_PUBLIC_* at bundle time; /api keeps the hub same-origin.
        $previous = $env:EXPO_PUBLIC_API_BASE_URL
        $env:EXPO_PUBLIC_API_BASE_URL = '/api'
        try {
            & npm run build:web
            $script:ExitCode = $LASTEXITCODE
        }
        finally {
            $env:EXPO_PUBLIC_API_BASE_URL = $previous
        }
        if ($script:ExitCode -ne 0) {
            Write-Err 'Hub export build failed.'
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-DemoUp {
    $rebuilt = $false
    switch (Get-ExportState) {
        'fresh' {
            Write-Out 'Hub export is up to date (Butler.UI/dist).'
        }
        'missing' {
            Write-Out 'Hub export is missing; building Butler.UI/dist ...'
            $rebuilt = $true
        }
        'stale' {
            Write-Out 'Hub export is older than its sources; building Butler.UI/dist ...'
            $rebuilt = $true
        }
    }
    if ($rebuilt) {
        Invoke-ExportBuild
        if ($script:ExitCode -ne 0) { return }
    }

    Write-Out 'Starting the demo stack ...'
    Invoke-Compose @('up', '-d', '--build', '--wait', '--wait-timeout', $WaitTimeout)
    if ($script:ExitCode -eq 0 -and $rebuilt) {
        # A build replaces the dist folder; a running Caddy keeps serving the old one.
        Write-Out 'Recreating web to serve the new export ...'
        Invoke-Compose @('up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', $WaitTimeout, 'web')
    }
    if ($script:ExitCode -ne 0) {
        Write-Err 'Demo stack did not become healthy. Run the logs command to see why.'
        return
    }
    Write-Out "Demo stack is up and healthy: $HubUrl"
}

function Invoke-DemoDown {
    Write-Out 'Stopping the demo stack (data in demo/.data/azurite is kept) ...'
    # Never -v: the Azurite data must survive.
    Invoke-Compose @('down')
    if ($script:ExitCode -ne 0) { return }
    Write-Out 'Demo stack stopped.'
}

function Invoke-DemoStatus {
    # The rows are captured on purpose: they are reformatted below.
    $rows = @(& docker compose -f $ComposeFile ps --all --format "{{.Service}}`t{{.State}}`t{{.Health}}")
    $script:ExitCode = $LASTEXITCODE
    if ($script:ExitCode -ne 0) { return }
    $rows = @($rows | Where-Object { $_ -and $_.Trim() })
    if ($rows.Count -eq 0) {
        Write-Out 'Stack is not running.'
    }
    else {
        Write-Out ('{0,-9} {1,-9} {2}' -f 'SERVICE', 'STATE', 'HEALTH')
        foreach ($row in $rows) {
            $parts = @($row -split "`t") + @('', '', '')
            $health = if ($parts[2]) { $parts[2] } else { '-' }
            Write-Out ('{0,-9} {1,-9} {2}' -f $parts[0], $parts[1], $health)
        }
    }
    Write-Out ''
    Write-Out "Hub:     $HubUrl"
    $dataset = ''
    try {
        $response = Invoke-RestMethod -Uri $DatasetUrl -TimeoutSec 3
        if ($response -and $response.PSObject.Properties['datasetId'] -and $response.datasetId) {
            $dataset = [string]$response.datasetId
        }
    }
    catch {
        $dataset = ''
    }
    if (-not $dataset) { $dataset = 'unavailable' }
    Write-Out "Dataset: $dataset"
}

function Invoke-DemoLogs([string[]]$LogArgs) {
    Invoke-Compose (@('logs') + $LogArgs)
}

function Invoke-Main([object[]]$Arguments) {
    if ($Arguments.Count -eq 0) {
        Write-Usage
        $script:ExitCode = 2
        return
    }
    $name = [string]$Arguments[0]
    [string[]]$rest = @($Arguments | Select-Object -Skip 1 | ForEach-Object { [string]$_ })
    # Case-sensitive, like demo.sh ([ordered] keys are case-insensitive).
    if (-not ($Commands.Keys -ccontains $name)) {
        Write-Err "Unknown command: $name"
        Write-Err ''
        Write-Usage
        $script:ExitCode = 2
        return
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Err 'docker was not found. Install Docker Desktop (or Docker Engine with the Compose v2 plugin).'
        $script:ExitCode = 1
        return
    }
    switch -CaseSensitive ($name) {
        'up' { Invoke-DemoUp }
        'down' { Invoke-DemoDown }
        'status' { Invoke-DemoStatus }
        'logs' { Invoke-DemoLogs -LogArgs $rest }
    }
}

Invoke-Main -Arguments $args
exit $script:ExitCode
