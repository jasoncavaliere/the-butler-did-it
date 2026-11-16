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

      up      Build the hub export if needed, start the stack, wait until
              every service is healthy, then run the smoke suite (Liveness
              and Endpoints) with the host .NET SDK and print Demo ready.
              Needs the .NET 10 SDK (#103).
      down    Stop the stack. The Azurite data in demo/.data/azurite is kept.
      reset   Delete the demo data in demo/.data/azurite, start the stack
              again, sign in with BUTLER_DEMO_PIN and seed the demo
              household, which also changes the dataset id. Asks nothing,
              and refuses to run against anything but the local demo stack.
      snapshot <name>
              Stop Azurite, copy demo/.data/azurite to
              demo/.data/snapshots/<name>, then start Azurite again. The
              API and the hub keep running.
      restore <name>
              Stop the stack, replace demo/.data/azurite with the snapshot,
              start it again, sign in with BUTLER_DEMO_PIN and change the
              dataset id. Snapshot dates do not move.
      snapshots
              List the snapshots in demo/.data/snapshots, newest first,
              with their dates.
      status  Show each container's state and health, the hub URL and the
              dataset id.
      logs    Follow the API and Caddy (web) logs, last 100 lines each.
              --api shows only the API. Any other argument goes to
              docker compose logs as-is and turns off the default
              --follow --tail 100. Naming a service (azurite, api or
              web), as in `logs -f azurite`, shows only that service.
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
    pwsh demo/demo.ps1 reset
.EXAMPLE
    pwsh demo/demo.ps1 snapshot prospect-acme
.EXAMPLE
    ./demo/demo.ps1 logs --api
.EXAMPLE
    ./demo/demo.ps1 logs --api --no-color --since 10m
.EXAMPLE
    ./demo/demo.ps1 logs -f azurite
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$ComposeFile = Join-Path $PSScriptRoot 'docker-compose.yml'
# The services in docker-compose.yml (#190). Naming one of these narrows
# logs to the services named. Keep in step with the compose file and with
# COMPOSE_SERVICES in demo.sh (demo/ci/check-logs-args.sh fails on drift).
$ComposeServices = @('azurite', 'api', 'web')
# Bind-mounted at /app/logs in the api container (#107): its rolling log files.
$LogsDir = Join-Path (Join-Path $PSScriptRoot '.data') 'logs'
$UiDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'Butler.UI'
# The hub export's freshness marker. A failed build deletes it (#183), so the
# next up rebuilds instead of reporting a broken export as up to date.
$ExportMarker = Join-Path (Join-Path $UiDir 'dist') 'index.html'
# The EXPO_PUBLIC_* values up builds the hub export with.
$DemoApiBaseUrl = '/api'
$DemoAuthProvider = 'pin'
# up writes this stamp after each successful build (#184), so an export built
# another way (for example by hand, without EXPO_PUBLIC_API_BASE_URL=/api) is
# rebuilt instead of served. demo.sh writes the same bytes: these two lines,
# LF only, with a final LF.
$ExportStamp = Join-Path (Join-Path $UiDir 'dist') '.demo-build-env'
$ExportStampText = ("EXPO_PUBLIC_API_BASE_URL=$DemoApiBaseUrl", "EXPO_PUBLIC_AUTH_PROVIDER=$DemoAuthProvider") -join "`n"
# Git-ignored; holds BUTLER_DEMO_PIN, the organizer PIN (#105). Compose reads it.
$EnvFile = Join-Path $PSScriptRoot '.env'

$HubUrl = 'http://localhost:8080'
$DatasetUrl = "$HubUrl/api/api/system/dataset"
# reset (#98) signs the organizer in with the PIN, then seeds the demo household.
$PinSignInUrl = "$HubUrl/api/auth/pin/sign-in"
$SeedUrl = "$HubUrl/api/demo/seed"
# restore (#99) copies a snapshot back, then changes the dataset id through
# this organizer-only endpoint. Snapshots live in git-ignored demo/.data.
$RegenerateUrl = "$HubUrl/api/demo/dataset/regenerate"
$SnapshotsDir = Join-Path (Join-Path $PSScriptRoot '.data') 'snapshots'
# A snapshot name: a letter or digit, then up to 63 letters, digits, '.', '_'
# or '-'. \z, not $: .NET's $ also matches before a trailing newline.
$SnapshotNamePattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\z'
$WaitTimeout = '300'

# The smoke step up runs once the stack is healthy (#103): the smoke suite,
# run with the host .NET SDK from Butler.API/ (so global.json applies), through
# the Caddy proxy. The trailing slash matters: without it, the suite's relative
# URLs drop /api. The storage string is the well-known public Azurite
# devstoreaccount1 key (not a secret, the same one docker-compose.yml gives
# the api), pointed at Azurite's loopback-only host port 10012.
$ApiDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'Butler.API'
$SmokeBaseUrl = "$HubUrl/api/"
$SmokeStorageConnectionString = 'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:10012/devstoreaccount1;'
$SmokeProject = 'src/Butler.Api.SmokeTests/Butler.Api.SmokeTests.csproj'
# Liveness (read-only) and Endpoints (#92's Rooms round trip, in a throwaway
# smoke-rooms-<guid> household). Never Demo: the seeded household stays as is.
$SmokeFilter = 'Category=Liveness|Category=Endpoints'
$SmokeLogger = 'console;verbosity=normal'
$DemoReady = "Demo ready: hub $HubUrl | API $HubUrl/api/health | Swagger http://localhost:5108/swagger"

# Subcommand registry, in usage order.
# To add a subcommand: add an entry here and an Invoke-Demo<Name> function
# below (and the same entry and handler in demo.sh, plus a row in
# demo/README.md).
$Commands = [ordered]@{
    up        = 'Build the hub export if needed, start the stack, wait until it is healthy and run the smoke suite'
    down      = 'Stop the stack (data in demo/.data/azurite is kept)'
    reset     = 'Delete the demo data, restart the stack, re-seed the demo household and change the dataset id'
    snapshot  = 'Save a copy of the demo data in demo/.data/snapshots/<name> (stops Azurite while it copies)'
    restore   = 'Replace the demo data with a snapshot, restart the stack and change the dataset id'
    snapshots = 'List the snapshots in demo/.data/snapshots with their dates'
    status    = 'Show container health, the hub URL and the dataset id'
    logs      = 'Follow the API and Caddy logs (--api: API only; extra arguments go to docker compose logs)'
    share     = 'Share the hub on your tailnet over HTTPS (tailscale serve) and print its URL and a QR code'
    unshare   = 'Turn off tailscale serve (the hub stays on http://localhost:8080)'
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

# Returns the state of the hub export in Butler.UI/dist, checked in this order:
#   missing   - no dist/index.html.
#   stale     - a source file is newer than dist/index.html.
#   unstamped - up's build stamp (#184) is absent, older than dist/index.html,
#               or holds other settings (CRs and trailing newlines ignored).
#   fresh     - none of the above.
function Get-ExportState {
    $markerPath = $ExportMarker
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        return 'missing'
    }
    $marker = Get-Item -LiteralPath $markerPath -Force
    $paths = @($UiSources | ForEach-Object { Join-Path $UiDir $_ } | Where-Object { Test-Path -LiteralPath $_ })
    if ($paths.Count -gt 0) {
        $newer = Get-ChildItem -LiteralPath $paths -Recurse -File -Force |
            Where-Object { $_.LastWriteTimeUtc -gt $marker.LastWriteTimeUtc } |
            Select-Object -First 1
        if ($newer) { return 'stale' }
    }
    if (-not (Test-Path -LiteralPath $ExportStamp -PathType Leaf)) {
        return 'unstamped'
    }
    if ($marker.LastWriteTimeUtc -gt (Get-Item -LiteralPath $ExportStamp -Force).LastWriteTimeUtc) {
        return 'unstamped'
    }
    # Get-Content -Raw returns $null for an empty file, hence the [string] cast.
    $stamp = ([string](Get-Content -LiteralPath $ExportStamp -Raw)) -replace "`r", ''
    if ($stamp.TrimEnd("`n") -cne $ExportStampText) {
        return 'unstamped'
    }
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
        # Expo inlines EXPO_PUBLIC_* at bundle time; /api keeps the hub same-origin,
        # and pin makes the hub sign the organizer in on the PIN pad (#105).
        # EXPO_PUBLIC_BUILD_SHA stamps the hub with the same git SHA as the API (#126).
        $previous = $env:EXPO_PUBLIC_API_BASE_URL
        $previousProvider = $env:EXPO_PUBLIC_AUTH_PROVIDER
        $previousSha = $env:EXPO_PUBLIC_BUILD_SHA
        # The stamp is written only after a successful build (#184).
        Remove-Item -LiteralPath $ExportStamp -Force -ErrorAction SilentlyContinue
        $env:EXPO_PUBLIC_API_BASE_URL = $DemoApiBaseUrl
        $env:EXPO_PUBLIC_AUTH_PROVIDER = $DemoAuthProvider
        $env:EXPO_PUBLIC_BUILD_SHA = $env:BUTLER_BUILD_SHA
        try {
            & npm run build:web
            $script:ExitCode = $LASTEXITCODE
        }
        finally {
            $env:EXPO_PUBLIC_API_BASE_URL = $previous
            $env:EXPO_PUBLIC_AUTH_PROVIDER = $previousProvider
            $env:EXPO_PUBLIC_BUILD_SHA = $previousSha
        }
        if ($script:ExitCode -ne 0) {
            # build:web runs expo export and then pwa-export.js, so a failure in the
            # second step leaves a new index.html behind. Delete it (#183): the export
            # is then missing, and the next up rebuilds it.
            Remove-Item -LiteralPath $ExportMarker -Force -ErrorAction SilentlyContinue
            Write-Err 'Hub export build failed.'
            return
        }
        # Same bytes as demo.sh: UTF-8 without a BOM, LF only, a final LF.
        [System.IO.File]::WriteAllText($ExportStamp, $ExportStampText + "`n", [System.Text.UTF8Encoding]::new($false))
    }
    finally {
        Pop-Location
    }
}

# The API container runs as a non-root user, so on a Linux engine it cannot
# write a bind-mount folder that Docker creates as root. Create it first and
# make it world-writable. A folder that is already world-writable is fine even
# when this user cannot chmod it (it is root-owned). Otherwise up warns on
# stdout (#193) that the API file log is off and prints the command that
# fixes it: the user takes back ownership of demo/.data. The stack still
# starts, the exit code is unchanged, and the script never runs sudo. Keep
# the warning byte-identical to ensure_logs_dir in demo.sh.
function Initialize-LogsDir {
    $ok = $true
    try {
        New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
        if (-not $IsWindows) {
            & chmod 0777 $LogsDir 2>$null
            if ($LASTEXITCODE -ne 0) {
                # Already open to everyone (write and search) is good enough.
                $open = $null
                $open = & find $LogsDir -maxdepth 0 -perm -0003 2>$null
                if (-not $open) { $ok = $false }
            }
        }
    }
    catch {
        $ok = $false
    }
    if (-not $ok) {
        Write-Out 'WARNING: The API file log is off. up could not make demo/.data/logs writable for the API container.'
        Write-Out 'demo/.data is probably owned by root from an earlier run. The stack still starts, without the API log files.'
        Write-Out 'To fix it, run down, then this from the repo root, then up again:'
        Write-Out '  sudo chown -R "$(id -u):$(id -g)" demo/.data'
    }
}

# Returns the organizer PIN (#105): BUTLER_DEMO_PIN from the environment if
# set, otherwise the last BUTLER_DEMO_PIN= line of demo/.env (quotes stripped).
function Get-DemoPin {
    if ($env:BUTLER_DEMO_PIN) {
        return $env:BUTLER_DEMO_PIN
    }
    if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
        return ''
    }
    $pin = ''
    foreach ($line in Get-Content -LiteralPath $EnvFile) {
        if ($line -match '^\s*BUTLER_DEMO_PIN\s*=\s*(.*)$') {
            $pin = $Matches[1].TrimEnd() -replace '^["'']', '' -replace '["'']$', ''
        }
    }
    return $pin
}

# The Demo API refuses to start without a 4-6 digit PIN, so fail fast, before
# npm or docker run.
function Test-DemoPin {
    if ((Get-DemoPin) -cmatch '^[0-9]{4,6}$') {
        return $true
    }
    Write-Err 'demo/.env must set BUTLER_DEMO_PIN to a 4-6 digit PIN. See demo/README.md.'
    $script:ExitCode = 1
    return $false
}

# Build version (#126): set BUTLER_BUILD_SHA to the git short SHA, unless the
# shell already set it. Compose passes it to the API image build and
# Invoke-ExportBuild stamps it into the hub. Outside a git checkout (or without
# git) it stays empty, and both report "dev". Prints nothing.
function Set-BuildSha {
    if ($env:BUTLER_BUILD_SHA) { return }
    $sha = ''
    try {
        $out = & git -C (Split-Path -Parent $PSScriptRoot) rev-parse --short HEAD 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) { $sha = "$out".Trim() }
    }
    catch {
        $sha = ''
    }
    $env:BUTLER_BUILD_SHA = $sha
}

# The smoke step needs the host .NET SDK (#103), so fail fast, before npm or
# docker run. A dotnet with no SDK (a runtime-only install) counts as none.
function Test-DotnetSdk {
    $found = $false
    if (Get-Command dotnet -CommandType Application -ErrorAction SilentlyContinue) {
        try {
            # Captured on purpose: only checked, never printed.
            $sdks = @(& dotnet --list-sdks 2>$null)
            if ($LASTEXITCODE -eq 0) {
                $found = @($sdks | Where-Object { ([string]$_).Trim() }).Count -gt 0
            }
        }
        catch {
            $found = $false
        }
    }
    if ($found) {
        return $true
    }
    Write-Err 'The .NET SDK is required for the smoke step that up runs, and none was found. Install the .NET 10 SDK, then run up again. See demo/README.md.'
    $script:ExitCode = 1
    return $false
}

# Builds the hub export if needed, starts the stack and waits until every
# service is healthy. up runs the smoke suite after it; reset does not.
function Start-DemoStack {
    Set-BuildSha
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
        'unstamped' {
            Write-Out 'Hub export was not built with the demo settings; building Butler.UI/dist ...'
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

# The smoke step (#103): runs the Liveness and Endpoints smoke tests against
# the running stack. Their output streams through and is kept in memory; a
# failure names each failed test (in order, once each) on stderr. The
# settings go to dotnet only through its environment, so the PIN is never in
# argv or printed. Same lines as run_smoke in demo.sh.
function Invoke-Smoke {
    Write-Out "Running the smoke suite against $SmokeBaseUrl ..."
    $lines = [System.Collections.Generic.List[string]]::new()
    $names = @{
        BUTLER_SMOKE_BASE_URL                  = $SmokeBaseUrl
        BUTLER_SMOKE_STORAGE_CONNECTION_STRING = $SmokeStorageConnectionString
        BUTLER_SMOKE_ORGANIZER_PIN             = [string](Get-DemoPin)
        MSBUILDTERMINALLOGGER                  = 'off'
        DOTNET_NOLOGO                          = '1'
    }
    $saved = @{}
    foreach ($name in $names.Keys) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name)
        [Environment]::SetEnvironmentVariable($name, $names[$name])
    }
    Push-Location -LiteralPath $ApiDir
    try {
        # Native stderr arrives as ErrorRecords, hence the [string] cast.
        & dotnet test $SmokeProject --filter $SmokeFilter --logger $SmokeLogger 2>&1 | ForEach-Object {
            $line = [string]$_
            $lines.Add($line)
            Write-Out $line
        }
        $script:ExitCode = $LASTEXITCODE
    }
    catch {
        $script:ExitCode = 1
    }
    finally {
        Pop-Location
        foreach ($name in $saved.Keys) {
            [Environment]::SetEnvironmentVariable($name, $saved[$name])
        }
    }
    if ($script:ExitCode -eq 0) {
        Write-Out $DemoReady
        return
    }
    # VSTest prints "  Failed <test name> [<duration>]" once per failed test.
    $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($line in $lines) {
        if (($line -replace "`r", '') -cmatch '^\s*Failed (.*) \[[^\]\[]*\]$') {
            $failed = $Matches[1]
            if ($seen.Add($failed)) {
                Write-Err "Smoke check failed: $failed"
            }
        }
    }
    Write-Err 'Demo is not ready: the smoke suite failed. Run the logs command to see why.'
    $script:ExitCode = 1
}

function Invoke-DemoUp {
    if (-not (Test-DemoPin)) { return }
    if (-not (Test-DotnetSdk)) { return }
    Start-DemoStack
    if ($script:ExitCode -ne 0) { return }
    Invoke-Smoke
}

function Invoke-DemoDown {
    Write-Out 'Stopping the demo stack (data in demo/.data/azurite is kept) ...'
    # Never -v: the Azurite data must survive.
    Invoke-Compose @('down')
    if ($script:ExitCode -ne 0) { return }
    Write-Out 'Demo stack stopped.'
}

# Returns the API's current dataset id, or '' when the API is not there.
function Get-DatasetId {
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
    return $dataset
}

# reset (#98), snapshot and restore (#99) touch the demo data, so they run
# only against the local demo stack: a local Docker engine, the butler-demo
# compose project, an api that stores its data in the azurite service, and
# Azurite's data in demo/.data/azurite. -Verb names the command in the
# message. Writes why to stderr and returns $false otherwise. Same checks and
# text as check_local_target in demo.sh.
function Test-LocalTarget([string]$Verb) {
    $reason = ''
    $endpoint = [string]$env:DOCKER_HOST
    if (-not $endpoint) {
        # Captured on purpose: the endpoint is checked below.
        try {
            $out = & docker context inspect --format '{{.Endpoints.docker.Host}}' 2>$null
            $endpoint = if ($LASTEXITCODE -eq 0 -and $out) { (@($out) -join "`n").Trim() } else { '' }
        }
        catch {
            $endpoint = ''
        }
    }
    if (-not ($endpoint.StartsWith('unix://', [StringComparison]::Ordinal) -or
            $endpoint.StartsWith('npipe://', [StringComparison]::Ordinal))) {
        $shown = if ($endpoint) { $endpoint } else { 'unknown' }
        $reason = "the Docker engine is not local ($shown)"
    }
    if (-not $reason) {
        # Captured on purpose, and never printed: the rendered config holds
        # BUTLER_DEMO_PIN from demo/.env.
        $config = @()
        $rc = 1
        try {
            $config = @(& docker compose -f $ComposeFile config 2>$null)
            $rc = $LASTEXITCODE
        }
        catch {
            $rc = 1
        }
        $lines = @($config | ForEach-Object { ([string]$_) -replace "`r", '' })
        if ($rc -ne 0) {
            $reason = 'demo/docker-compose.yml could not be rendered'
        }
        elseif (@($lines -ceq 'name: butler-demo').Count -eq 0) {
            $reason = 'the compose project is not butler-demo'
        }
        elseif (@($lines -cmatch '^ +Storage__ConnectionString: .*;TableEndpoint=http://azurite:10002/devstoreaccount1;').Count -eq 0) {
            $reason = 'the api does not use the azurite service for storage'
        }
        elseif (@($lines -cmatch '^ +source: .*[/\\]demo[/\\]\.data[/\\]azurite$').Count -eq 0) {
            $reason = 'the Azurite data folder is not demo/.data/azurite'
        }
    }
    if ($reason) {
        Write-Err "Refusing to ${Verb}: $reason. $Verb only runs against the local demo stack."
        $script:ExitCode = 1
        return $false
    }
    return $true
}

# reset (#98): stop the stack, delete the Azurite data, start it again, sign
# in with the PIN and seed the demo household, which also changes the dataset
# id. Asks nothing. Takes no arguments and, like up and down, ignores extras.
function Invoke-DemoReset {
    if (-not (Test-DemoPin)) { return }
    if (-not (Test-LocalTarget -Verb 'reset')) { return }
    $old = Get-DatasetId
    if (-not $old) { $old = 'unavailable' }

    Write-Out 'Stopping the demo stack ...'
    # Never -v. Azurite saves its store on SIGINT, so delete only after down.
    Invoke-Compose @('down')
    if ($script:ExitCode -ne 0) {
        Write-Err 'Could not stop the demo stack. Nothing was deleted.'
        return
    }
    # Delete inside the azurite container: on Linux the files are root-owned,
    # and demo/.data/logs must survive.
    Write-Out 'Deleting the demo data in demo/.data/azurite ...'
    Invoke-Compose @('run', '--rm', '--no-deps', '-T', '--entrypoint', 'find', 'azurite', '/data', '-mindepth', '1', '-delete')
    if ($script:ExitCode -ne 0) {
        Write-Err 'Could not delete the demo data in demo/.data/azurite.'
        return
    }

    Start-DemoStack
    if ($script:ExitCode -ne 0) { return }

    # Sign in once, after up (a restart drops PIN tokens), with no retry: five
    # wrong PINs lock sign-in.
    Write-Out 'Signing in with the demo PIN ...'
    $token = ''
    try {
        $body = @{ pin = [string](Get-DemoPin) } | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Method Post -Uri $PinSignInUrl -ContentType 'application/json' -Body $body -TimeoutSec 30
        if ($response -and $response.PSObject.Properties['token'] -and $response.token) {
            $token = [string]$response.token
        }
    }
    catch {
        $token = ''
    }
    if (-not $token) {
        Write-Err 'PIN sign-in failed. Check BUTLER_DEMO_PIN in demo/.env, then run reset again.'
        $script:ExitCode = 1
        return
    }

    Write-Out 'Seeding the demo household ...'
    try {
        $null = Invoke-RestMethod -Method Post -Uri $SeedUrl -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 120
    }
    catch {
        Write-Err 'Seeding the demo household failed. Run the logs command to see why.'
        $script:ExitCode = 1
        return
    }

    $new = Get-DatasetId
    if (-not $new -or $new -ceq $old) {
        Write-Err 'The dataset id did not change after the reset. Run the logs command to see why.'
        $script:ExitCode = 1
        return
    }
    Write-Out "Dataset: $old -> $new"
    Write-Out "Demo reset complete: the demo household is seeded at $HubUrl"
    Write-Out 'Sign in with the PIN and pair the tablet again: the reset cleared organizer sessions and hub pairings.'
}

# snapshot and restore (#99) take exactly one name. Writes the usage or the
# name rule to stderr, sets exit code 2 and returns $false otherwise. The rule
# also keeps the name safe as a container path. Same text as
# check_snapshot_name in demo.sh.
function Test-SnapshotName([string]$Verb, [string[]]$NameArgs) {
    if (@($NameArgs).Count -ne 1) {
        Write-Err "Usage: demo $Verb <name>"
        $script:ExitCode = 2
        return $false
    }
    if (-not ([string]$NameArgs[0] -cmatch $SnapshotNamePattern)) {
        Write-Err "Snapshot names use letters, digits, '.', '_' and '-', start with a letter or digit, and are at most 64 characters."
        $script:ExitCode = 2
        return $false
    }
    return $true
}

# Created on the host before docker mounts it, so docker does not create a
# root-owned mount point.
function Initialize-SnapshotsDir {
    try {
        $null = New-Item -ItemType Directory -Force -Path $SnapshotsDir
        return $true
    }
    catch {
        Write-Err 'Could not create demo/.data/snapshots.'
        $script:ExitCode = 1
        return $false
    }
}

# snapshot (#99): stop only Azurite (it saves its store on SIGINT), copy
# demo/.data/azurite to demo/.data/snapshots/<name>, start Azurite again. The
# api and web keep running, so the organizer stays signed in. The copy runs
# inside an azurite container: on Linux the files are root-owned. cp -R, not
# -a, so the new folder's date is the snapshot time (snapshots lists it).
function Invoke-DemoSnapshot([string[]]$SnapshotArgs) {
    if (-not (Test-SnapshotName -Verb 'snapshot' -NameArgs $SnapshotArgs)) { return }
    $name = [string]$SnapshotArgs[0]
    if (Test-Path -LiteralPath (Join-Path $SnapshotsDir $name)) {
        Write-Err "Snapshot $name already exists in demo/.data/snapshots. Pick another name, or delete that folder first."
        $script:ExitCode = 1
        return
    }
    if (-not (Test-LocalTarget -Verb 'snapshot')) { return }
    if (-not (Initialize-SnapshotsDir)) { return }

    Write-Out 'Stopping Azurite ...'
    Invoke-Compose @('stop', 'azurite')
    if ($script:ExitCode -ne 0) {
        Write-Err 'Could not stop Azurite. No snapshot was taken.'
        return
    }

    Write-Out "Copying demo/.data/azurite to demo/.data/snapshots/$name ..."
    $mount = "${SnapshotsDir}:/snapshots"
    Invoke-Compose @('run', '--rm', '--no-deps', '-T', '-v', $mount, '--entrypoint', 'cp', 'azurite', '-R', '/data', "/snapshots/$name")
    $copyCode = $script:ExitCode
    if ($copyCode -ne 0) {
        Write-Err "Could not copy demo/.data/azurite to demo/.data/snapshots/$name."
        # Best effort: drop the partial copy, then still start Azurite.
        Invoke-Compose @('run', '--rm', '--no-deps', '-T', '-v', $mount, '--entrypoint', 'rm', 'azurite', '-rf', "/snapshots/$name")
    }

    Write-Out 'Starting Azurite ...'
    Invoke-Compose @('up', '-d', '--no-deps', '--wait', '--wait-timeout', $WaitTimeout, 'azurite')
    if ($script:ExitCode -ne 0) {
        Write-Err 'Azurite did not become healthy. Run the logs command to see why.'
        return
    }
    if ($copyCode -ne 0) {
        $script:ExitCode = $copyCode
        return
    }
    Write-Out "Snapshot saved: demo/.data/snapshots/$name"
}

# restore (#99): stop the stack (down, so the api container is recreated and
# provisions its tables against the restored data), replace demo/.data/azurite
# with the snapshot inside an azurite container, start the stack as reset
# does, sign in with the PIN and change the dataset id, so the hub drops its
# offline cache. The snapshot itself is never changed, so restore repeats.
function Invoke-DemoRestore([string[]]$RestoreArgs) {
    if (-not (Test-SnapshotName -Verb 'restore' -NameArgs $RestoreArgs)) { return }
    $name = [string]$RestoreArgs[0]
    if (-not (Test-DemoPin)) { return }
    if (-not (Test-Path -LiteralPath (Join-Path $SnapshotsDir $name) -PathType Container)) {
        Write-Err "No snapshot named $name in demo/.data/snapshots. Run the snapshots command to list them."
        $script:ExitCode = 1
        return
    }
    if (-not (Test-LocalTarget -Verb 'restore')) { return }

    Write-Out 'Stopping the demo stack ...'
    # Never -v. Azurite saves its store on SIGINT, so replace it only after down.
    Invoke-Compose @('down')
    if ($script:ExitCode -ne 0) {
        Write-Err 'Could not stop the demo stack. Nothing was restored.'
        return
    }

    Write-Out "Restoring demo/.data/azurite from demo/.data/snapshots/$name ..."
    Invoke-Compose @('run', '--rm', '--no-deps', '-T', '--entrypoint', 'find', 'azurite', '/data', '-mindepth', '1', '-delete')
    if ($script:ExitCode -eq 0) {
        # "/." copies the snapshot's contents into /data, not a folder named after it.
        Invoke-Compose @('run', '--rm', '--no-deps', '-T', '-v', "${SnapshotsDir}:/snapshots", '--entrypoint', 'cp', 'azurite', '-R', "/snapshots/$name/.", '/data')
    }
    if ($script:ExitCode -ne 0) {
        Write-Err "Could not restore demo/.data/azurite from demo/.data/snapshots/$name. Run restore again, or reset."
        return
    }

    Start-DemoStack
    if ($script:ExitCode -ne 0) { return }

    # The id the restored data holds (the API reads it from storage).
    $snap = Get-DatasetId
    if (-not $snap) { $snap = 'unavailable' }

    # Sign in once, after the restart, with no retry: five wrong PINs lock
    # sign-in.
    Write-Out 'Signing in with the demo PIN ...'
    $token = ''
    try {
        $body = @{ pin = [string](Get-DemoPin) } | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Method Post -Uri $PinSignInUrl -ContentType 'application/json' -Body $body -TimeoutSec 30
        if ($response -and $response.PSObject.Properties['token'] -and $response.token) {
            $token = [string]$response.token
        }
    }
    catch {
        $token = ''
    }
    if (-not $token) {
        Write-Err 'PIN sign-in failed. Check BUTLER_DEMO_PIN in demo/.env, then run restore again.'
        $script:ExitCode = 1
        return
    }

    Write-Out 'Changing the dataset id ...'
    $returned = ''
    try {
        $response = Invoke-RestMethod -Method Post -Uri $RegenerateUrl -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 30
        if ($response -and $response.PSObject.Properties['datasetId'] -and $response.datasetId) {
            $returned = [string]$response.datasetId
        }
    }
    catch {
        $returned = ''
    }
    if (-not $returned) {
        Write-Err 'Changing the dataset id failed. Run the logs command to see why.'
        $script:ExitCode = 1
        return
    }

    $new = Get-DatasetId
    if (-not $new -or $new -cne $returned -or $new -ceq $snap) {
        Write-Err 'The dataset id did not change after the restore. Run the logs command to see why.'
        $script:ExitCode = 1
        return
    }
    Write-Out "Dataset: $snap -> $new"
    Write-Out "Restore complete: the demo data matches snapshot $name at $HubUrl"
    Write-Out 'Sign in with the PIN again: the restore restarted the API. Tablets paired after the snapshot was taken must pair again, and the new dataset id makes the hub drop its offline cache and queued writes.'
}

# snapshots (#99): list the snapshot folders, newest first (ties by name, in
# byte order), with their local dates. Skips files and folders that are not
# valid names. Ignores extra arguments, like status. Same lines as
# cmd_snapshots in demo.sh.
function Invoke-DemoSnapshots {
    $entries = [System.Collections.Generic.List[object]]::new()
    if (Test-Path -LiteralPath $SnapshotsDir -PathType Container) {
        foreach ($dir in @(Get-ChildItem -LiteralPath $SnapshotsDir -Directory -Force)) {
            if (-not ($dir.Name -cmatch $SnapshotNamePattern)) { continue }
            $entries.Add([pscustomobject]@{
                    Name  = $dir.Name
                    Epoch = [DateTimeOffset]::new($dir.LastWriteTimeUtc).ToUnixTimeSeconds()
                    When  = $dir.LastWriteTime.ToString('yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture)
                })
        }
    }
    if ($entries.Count -eq 0) {
        Write-Out 'No snapshots in demo/.data/snapshots. Take one with the snapshot command.'
        return
    }
    # Sort-Object is culture-aware; an ordinal comparison matches sort in demo.sh.
    $entries.Sort([Comparison[object]] {
            param($a, $b)
            if ($a.Epoch -ne $b.Epoch) { return $b.Epoch.CompareTo($a.Epoch) }
            return [string]::CompareOrdinal($a.Name, $b.Name)
        })
    Write-Out 'Snapshots in demo/.data/snapshots (newest first):'
    foreach ($entry in $entries) {
        Write-Out "  $($entry.When)  $($entry.Name)"
    }
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
    $dataset = Get-DatasetId
    if (-not $dataset) { $dataset = 'unavailable' }
    Write-Out "Dataset: $dataset"
}

# Default: follow the api and web (Caddy) logs, last 100 lines each. --api
# narrows the default to the API. Any other argument goes to docker compose
# logs as-is and turns off the default --follow --tail 100 (pass -f to
# follow). Naming a service from $ComposeServices (exact, case-sensitive
# match), as in `logs -f azurite`, shows only the services named (#190).
function Invoke-DemoLogs([string[]]$LogArgs) {
    $services = @('api', 'web')
    $pass = @()
    $named = $false
    foreach ($arg in @($LogArgs)) {
        if ($null -eq $arg) { continue }
        if ($arg -ceq '--api') {
            $services = @('api')
        }
        else {
            $pass += $arg
            if ($ComposeServices -ccontains $arg) { $named = $true }
        }
    }
    if ($pass.Count -eq 0) {
        $pass = @('--follow', '--tail', '100')
    }
    if ($named) {
        $services = @()
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
        'reset' { Invoke-DemoReset }
        'snapshot' { Invoke-DemoSnapshot -SnapshotArgs $rest }
        'restore' { Invoke-DemoRestore -RestoreArgs $rest }
        'snapshots' { Invoke-DemoSnapshots }
        'status' { Invoke-DemoStatus }
        'logs' { Invoke-DemoLogs -LogArgs $rest }
        'share' { Invoke-DemoShare }
        'unshare' { Invoke-DemoUnshare }
    }
}

Invoke-Main -Arguments $args
exit $script:ExitCode
