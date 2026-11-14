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
      logs    Follow the API and Caddy (web) logs, last 100 lines each.
              --api shows only the API. Any other argument goes to
              docker compose logs as-is and turns off the default
              --follow --tail 100.
      share   Share the hub on your tailnet over HTTPS (tailscale serve
              --bg 8080) and print its https://<host>.<tailnet>.ts.net URL
              and a QR code for the tablet.
      unshare Turn off tailscale serve. The hub stays on
              http://localhost:8080.

    There is deliberately no param() block: PowerShell would try to bind
    pass-through arguments such as `logs -f api` as its own parameters.

.EXAMPLE
    pwsh demo/demo.ps1 up
.EXAMPLE
    ./demo/demo.ps1 logs --api
.EXAMPLE
    ./demo/demo.ps1 logs --api --no-color --since 10m
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$ComposeFile = Join-Path $PSScriptRoot 'docker-compose.yml'
# Bind-mounted at /app/logs in the api container (#107): its rolling log files.
$LogsDir = Join-Path (Join-Path $PSScriptRoot '.data') 'logs'
$UiDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'Butler.UI'

$HubUrl = 'http://localhost:8080'
$DatasetUrl = "$HubUrl/api/api/system/dataset"
$WaitTimeout = '300'

# Subcommand registry, in usage order.
# To add a subcommand: add an entry here and an Invoke-Demo<Name> function
# below (and the same entry and handler in demo.sh, plus a row in
# demo/README.md).
$Commands = [ordered]@{
    up      = 'Build the hub export if needed, start the stack and wait until it is healthy'
    down    = 'Stop the stack (data in demo/.data/azurite is kept)'
    status  = 'Show container health, the hub URL and the dataset id'
    logs    = 'Follow the API and Caddy logs (--api: API only; extra arguments go to docker compose logs)'
    share   = 'Share the hub on your tailnet over HTTPS (tailscale serve) and print its URL and a QR code'
    unshare = 'Turn off tailscale serve (the hub stays on http://localhost:8080)'
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

# The API container runs as a non-root user, so on a Linux engine it cannot
# write a bind-mount folder that Docker creates as root. Create it first and
# make it world-writable. A failure only warns: the stack still works, only
# the API's log files may be missing.
function Initialize-LogsDir {
    $ok = $true
    try {
        New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
        if (-not $IsWindows) {
            & chmod 0777 $LogsDir 2>$null
            if ($LASTEXITCODE -ne 0) { $ok = $false }
        }
    }
    catch {
        $ok = $false
    }
    if (-not $ok) {
        Write-Err 'Could not make demo/.data/logs writable for the API container; its log files may be missing. Fix it with: sudo chmod 777 demo/.data/logs'
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

    Initialize-LogsDir
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

# Default: follow the api and web (Caddy) logs, last 100 lines each. --api
# narrows to the API. Any other argument goes to docker compose logs as-is and
# turns off the default --follow --tail 100 (pass -f to follow).
function Invoke-DemoLogs([string[]]$LogArgs) {
    $services = @('api', 'web')
    $pass = @()
    foreach ($arg in @($LogArgs)) {
        if ($null -eq $arg) { continue }
        if ($arg -ceq '--api') {
            $services = @('api')
        }
        else {
            $pass += $arg
        }
    }
    if ($pass.Count -eq 0) {
        $pass = @('--follow', '--tail', '100')
    }
    Invoke-Compose (@('logs') + $pass + $services)
}

# Returns the path of the tailscale CLI, or $null when it is not installed.
function Find-Tailscale {
    $cmd = Get-Command tailscale -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    $mac = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
    if (Test-Path -LiteralPath $mac -PathType Leaf) { return $mac }
    if ($env:ProgramFiles) {
        $win = Join-Path (Join-Path $env:ProgramFiles 'Tailscale') 'tailscale.exe'
        if (Test-Path -LiteralPath $win -PathType Leaf) { return $win }
    }
    return $null
}

function Write-TailscaleMissing {
    Write-Err 'Tailscale is not installed (no tailscale command found). Install it from https://tailscale.com/download and sign in.'
    $script:ExitCode = 1
}

# Prints a terminal QR code of the URL. The QR output is never captured, and a
# missing tool or a failed QR command only prints a hint: the URL is already
# on screen.
function Write-Qr([string]$Url) {
    $rc = 1
    try {
        if (Get-Command qrencode -ErrorAction SilentlyContinue) {
            & qrencode -t ansiutf8 $Url
            $rc = $LASTEXITCODE
        }
        elseif (Get-Command npx -ErrorAction SilentlyContinue) {
            # qrcode-terminal's bin reads stdin (not argv) when stdin is not a TTY.
            $Url | & npx --yes --loglevel=error --no-update-notifier qrcode-terminal@0.12.0
            $rc = $LASTEXITCODE
        }
    }
    catch {
        $rc = 1
    }
    if ($rc -ne 0) {
        Write-Err 'Could not print a QR code (install qrencode, or let npx reach the npm registry). Type the URL above on the tablet instead.'
    }
}

# Service workers need a secure context, so a tablet must reach the hub over
# HTTPS. tailscale serve proxies https://<host>.<tailnet>.ts.net to
# http://127.0.0.1:8080, which Caddy keeps serving for the desktop browser.
function Invoke-DemoShare {
    $ts = Find-Tailscale
    if (-not $ts) {
        Write-TailscaleMissing
        return
    }
    # The status JSON is captured on purpose: it is parsed below.
    $state = ''
    $name = ''
    try {
        $json = (& $ts status --json 2>$null) -join "`n"
        if ($LASTEXITCODE -eq 0 -and $json) {
            $status = $json | ConvertFrom-Json
            if ($status -and $status.PSObject.Properties['BackendState'] -and $status.BackendState) {
                $state = [string]$status.BackendState
            }
            # CertDomains, not Self.DNSName: DNSName also appears under every peer.
            if ($status -and $status.PSObject.Properties['CertDomains'] -and $status.CertDomains) {
                $domains = @($status.CertDomains)
                if ($domains.Count -gt 0 -and $domains[0]) { $name = [string]$domains[0] }
            }
        }
    }
    catch {
        $state = ''
        $name = ''
    }
    if (-not $state) { $state = 'unavailable' }
    if ($state -cne 'Running') {
        Write-Err "Tailscale is installed but not logged in (backend state: $state). Run 'tailscale up' or sign in from the Tailscale app, then run share again."
        $script:ExitCode = 1
        return
    }
    if (-not $name) {
        Write-Err 'Tailscale reports no HTTPS name for this machine. Enable MagicDNS and HTTPS Certificates on the DNS page of the Tailscale admin console, then run share again.'
        $script:ExitCode = 1
        return
    }
    Write-Out 'Sharing http://localhost:8080 on your tailnet (tailscale serve --bg 8080) ...'
    & $ts serve --bg 8080
    $script:ExitCode = $LASTEXITCODE
    if ($script:ExitCode -ne 0) {
        Write-Err 'tailscale serve failed. On Linux, allow your user once with ''sudo tailscale set --operator=$USER'', then run share again.'
        return
    }
    $url = "https://$name"
    Write-Out "Hub on your tailnet: $url"
    Write-Out 'Scan this on the tablet (it must be signed in to the same tailnet):'
    Write-Qr $url
    Write-Out 'The tablet needs the stack running (up). Run unshare to stop sharing.'
}

# Turns off only the HTTPS 443 handler that share set up; `serve reset` would
# also wipe any other serve config the user has.
function Invoke-DemoUnshare {
    $ts = Find-Tailscale
    if (-not $ts) {
        Write-TailscaleMissing
        return
    }
    & $ts serve --https=443 --set-path=/ off
    $script:ExitCode = $LASTEXITCODE
    if ($script:ExitCode -ne 0) {
        Write-Err 'Could not turn off tailscale serve (was it on?). Check with ''tailscale serve status''.'
        return
    }
    Write-Out 'Tailscale sharing is off. The hub is still at http://localhost:8080.'
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
        'share' { Invoke-DemoShare }
        'unshare' { Invoke-DemoUnshare }
    }
}

Invoke-Main -Arguments $args
exit $script:ExitCode
