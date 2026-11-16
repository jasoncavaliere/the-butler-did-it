#!/usr/bin/env pwsh
#requires -Version 7.0
<#
.SYNOPSIS
    Provisions a factory-reset Android hub tablet over adb (#128): installs the
    Fully Kiosk Browser EMM APK, makes Fully the device owner, pushes the Butler
    Fully settings file (#129) with the start URL filled in, and keeps the
    screen on while plugged in. Then it prints the steps left to do on the
    tablet.

.DESCRIPTION
    The PowerShell 7 twin of demo/tablet/provision-tablet.sh. Both scripts
    accept the same flags, run the same adb commands in the same order and
    print the same text, so keep every fixed string below byte-identical to
    the one in provision-tablet.sh. demo/ci/check-provision-tablet.sh checks
    both against a fake adb. See demo/tablet/README.md.

      --apk      The Fully EMM APK (default: demo/tablet/fully-emm.apk).
      --url      The hub URL the tablet opens (default: the URL demo share
                 prints).
      --dry-run  Print every adb command and run none.

    Every check runs before the first change. The pushed copy of the settings
    file has no kiosk PIN line: the PIN is set by hand on the tablet.

    There is deliberately no param() block, so --flags land in $args as they
    do in demo/demo.ps1.

.EXAMPLE
    pwsh demo/tablet/provision-tablet.ps1 --url https://host.tailnet.ts.net
.EXAMPLE
    pwsh demo/tablet/provision-tablet.ps1 --dry-run
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$SettingsSrc = Join-Path $PSScriptRoot 'fully-settings.json'
$DevicePath = '/sdcard/Download/fully-settings.json'
$OwnerPackage = 'com.fullykiosk.emm'
$OwnerComponent = 'com.fullykiosk.emm/de.ozerov.fully.DeviceOwnerReceiver'
$Usage = 'Usage: provision-tablet [--apk <path>] [--url <url>] [--dry-run]'

function Write-Out([string]$Line) { [Console]::Out.WriteLine($Line) }
function Write-Err([string]$Line) { [Console]::Error.WriteLine($Line) }

# Native output that is not captured goes straight to the console, so every
# step reports its exit code through $script:ExitCode instead of a return value.
$script:ExitCode = 0
$script:TmpDir = $null

# Returns the path of the tailscale CLI, or $null (as in demo/demo.ps1).
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

# Returns @{ Url; Reason }: the URL demo share prints (https:// +
# CertDomains[0]), or why it is not available. Runs only tailscale status
# --json, never tailscale serve: the lookup is copied from Invoke-DemoShare.
function Get-ShareUrl {
    $ts = Find-Tailscale
    if (-not $ts) { return @{ Url = ''; Reason = 'Tailscale is not installed' } }
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
    if ($state -cne 'Running') { return @{ Url = ''; Reason = "Tailscale backend state: $state" } }
    if (-not $name) { return @{ Url = ''; Reason = 'Tailscale reports no HTTPS name' } }
    return @{ Url = "https://$name"; Reason = '' }
}

# Every adb call is announced on stdout first; a dry run only announces it.
function Write-Announce([string[]]$AdbArgs) { Write-Out ('> adb ' + ($AdbArgs -join ' ')) }

# Runs adb with its output captured (stdout and stderr, without carriage
# returns). Returns @{ Out; Rc }.
function Invoke-AdbCapture([string[]]$AdbArgs) {
    $lines = & adb @AdbArgs 2>&1 | ForEach-Object { "$_" }
    $rc = $LASTEXITCODE
    $text = (@($lines) -join "`n").Replace("`r", '').TrimEnd("`n")
    return @{ Out = $text; Rc = $rc }
}

function Invoke-Provision([object[]]$Arguments) {
    # Phase 1: arguments.
    $apk = Join-Path $PSScriptRoot 'fully-emm.apk'
    $url = ''
    $urlGiven = $false
    $dryRun = $false
    $i = 0
    while ($i -lt $Arguments.Count) {
        $arg = [string]$Arguments[$i]
        switch -CaseSensitive ($arg) {
            '--apk' {
                if ($i + 1 -ge $Arguments.Count) {
                    Write-Err '--apk needs a value.'
                    Write-Err $Usage
                    $script:ExitCode = 2
                    return
                }
                $apk = [string]$Arguments[$i + 1]
                $i += 2
            }
            '--url' {
                if ($i + 1 -ge $Arguments.Count) {
                    Write-Err '--url needs a value.'
                    Write-Err $Usage
                    $script:ExitCode = 2
                    return
                }
                $url = [string]$Arguments[$i + 1]
                $urlGiven = $true
                $i += 2
            }
            '--dry-run' {
                $dryRun = $true
                $i += 1
            }
            { $_ -ceq '-h' -or $_ -ceq '--help' } {
                Write-Out $Usage
                $script:ExitCode = 0
                return
            }
            default {
                Write-Err "Unknown argument: $arg"
                Write-Err $Usage
                $script:ExitCode = 2
                return
            }
        }
    }

    # Phase 2: local checks. Nothing on the tablet is touched yet.
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) {
        Write-Err "Fully APK not found: $apk"
        Write-Err 'Download the Fully Kiosk Browser EMM APK (package com.fullykiosk.emm) from https://www.fully-kiosk.com/docs/en/getting-started/downloads and save it as demo/tablet/fully-emm.apk, or pass its path with --apk.'
        $script:ExitCode = 1
        return
    }

    if (-not $urlGiven) {
        $share = Get-ShareUrl
        if (-not $share.Url) {
            Write-Err "No --url given, and the demo share URL is not available ($($share.Reason)). Run demo/demo.sh share first, or pass --url <hub url>."
            $script:ExitCode = 1
            return
        }
        $url = $share.Url
    }

    # The character check matches the one in provision-tablet.sh, where it
    # also keeps the sed replacement safe (no &, |, \).
    if ($url -cnotmatch '\Ahttps?://[A-Za-z0-9._~:/-]+\z') {
        Write-Err "--url must be an http:// or https:// URL made of letters, digits and . _ ~ : / - only (got: $url)."
        $script:ExitCode = 2
        return
    }
    Write-Out "Start URL: $url"

    # The filled copy lives only in this temp dir, which is removed on exit.
    $script:TmpDir = Join-Path ([IO.Path]::GetTempPath()) ('butler-tablet-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $script:TmpDir
    $settingsCopy = Join-Path $script:TmpDir 'fully-settings.json'
    $text = [IO.File]::ReadAllText($SettingsSrc)
    $text = [regex]::Replace($text, '(?m)^[ \t]*"kioskPin"[ \t]*:.*\r?\n', '')
    $text = $text.Replace('__START_URL__', $url)
    [IO.File]::WriteAllText($settingsCopy, $text, [Text.UTF8Encoding]::new($false))
    if ($text.Contains('__START_URL__')) {
        Write-Err 'Could not fill in the start URL in fully-settings.json.'
        $script:ExitCode = 1
        return
    }

    # Phase 3: adb itself (not needed for a dry run).
    if (-not $dryRun -and -not (Get-Command adb -CommandType Application -ErrorAction SilentlyContinue)) {
        Write-Err 'adb was not found. Install Android platform-tools from https://developer.android.com/tools/releases/platform-tools and put adb on your PATH.'
        $script:ExitCode = 1
        return
    }

    # Phase 4: read-only queries.
    Write-Announce @('devices')
    if (-not $dryRun) {
        $cap = Invoke-AdbCapture @('devices')
        if ($cap.Rc -ne 0) {
            Write-Err "adb devices failed (exit $($cap.Rc)). Nothing was changed."
            $script:ExitCode = 1
            return
        }
        $devices = @()
        foreach ($line in ($cap.Out -split "`n")) {
            $t = $line.Trim(" `t".ToCharArray())
            if ($t -eq '') { continue }
            if ($t.StartsWith('List of devices attached', [StringComparison]::Ordinal)) { continue }
            if ($t.StartsWith('*', [StringComparison]::Ordinal)) { continue }
            $devices += $t
        }
        if ($devices.Count -eq 0) {
            Write-Err "No Android device is connected. Plug in the tablet, turn on USB debugging, accept the prompt on the tablet, then check 'adb devices'."
            $script:ExitCode = 1
            return
        }
        if ($devices.Count -gt 1) {
            Write-Err "More than one Android device is connected ($($devices.Count)). Unplug every device except the hub tablet, then run this again."
            $script:ExitCode = 1
            return
        }
        $fields = @($devices[0] -split '[ \t]+')
        $state = if ($fields.Count -gt 1) { $fields[1] } else { '' }
        if ($state -cne 'device') {
            Write-Err "The tablet is connected but adb reports it as '$state', not 'device'. Accept the USB debugging prompt on the tablet (or reconnect the cable), then run this again."
            $script:ExitCode = 1
            return
        }
    }

    $ownerSet = $false
    Write-Announce @('shell', 'dumpsys', 'device_policy')
    if (-not $dryRun) {
        $cap = Invoke-AdbCapture @('shell', 'dumpsys', 'device_policy')
        # Match only the package= line inside the "Device Owner:" block: a Fully
        # that is only a device admin is listed elsewhere in the dump too (#323).
        # The block ends at a blank line or a line indented no deeper than its header.
        $inOwner = $false
        $headIndent = 0
        foreach ($line in ($cap.Out -split "`n")) {
            $t = $line.Trim(" `t".ToCharArray())
            $indent = $line.Length - $line.TrimStart(" `t".ToCharArray()).Length
            if ($inOwner -and ($t -eq '' -or $indent -le $headIndent)) { $inOwner = $false }
            if ($t -ceq 'Device Owner:') { $inOwner = $true; $headIndent = $indent; continue }
            if ($inOwner -and $t -ceq "package=$OwnerPackage") { $ownerSet = $true }
        }
    }

    Write-Announce @('shell', 'dumpsys', 'account')
    if (-not $dryRun) {
        $cap = Invoke-AdbCapture @('shell', 'dumpsys', 'account')
        # One "Accounts: N" line per Android user.
        $found = [regex]::Matches($cap.Out, '(?m)^[ \t]*Accounts:[ \t]*([0-9]+)')
        if ($found.Count -eq 0) {
            Write-Err "Could not read the tablet's accounts (no 'Accounts:' line in adb shell dumpsys account). Nothing was changed."
            $script:ExitCode = 1
            return
        }
        [long]$accounts = 0
        foreach ($m in $found) { $accounts += [long]$m.Groups[1].Value }
        # The no-accounts rule only gates set-device-owner, so an account does not
        # stop a re-run once Fully is the device owner (#324).
        if ($accounts -gt 0 -and -not $ownerSet) {
            Write-Err "The tablet has $accounts account(s) on it (adb shell dumpsys account). Device owner can only be set when no account exists: factory reset the tablet, skip every account sign-in, then run this again."
            $script:ExitCode = 1
            return
        }
    }

    # Phase 5: changes.
    Write-Announce @('install', '-r', $apk)
    if (-not $dryRun) {
        & adb install -r $apk
        $rc = $LASTEXITCODE
        if ($rc -ne 0) {
            Write-Err "adb install failed (exit $rc). Nothing else was changed."
            $script:ExitCode = $rc
            return
        }
    }

    if ($ownerSet) {
        Write-Out 'Fully is already the device owner; skipping set-device-owner.'
    }
    else {
        Write-Announce @('shell', 'dpm', 'set-device-owner', $OwnerComponent)
        if (-not $dryRun) {
            $cap = Invoke-AdbCapture @('shell', 'dpm', 'set-device-owner', $OwnerComponent)
            if ($cap.Out) { Write-Out $cap.Out }
            # Older adb returns 0 from adb shell even when dpm fails, so require Success.
            if ($cap.Rc -ne 0 -or -not $cap.Out.Contains('Success')) {
                Write-Err 'set-device-owner failed (see above). The usual causes are an account on the tablet or another device owner: factory reset the tablet and run this again.'
                $script:ExitCode = 1
                return
            }
        }
    }

    Write-Announce @('push', $settingsCopy, $DevicePath)
    if (-not $dryRun) {
        & adb push $settingsCopy $DevicePath
        $rc = $LASTEXITCODE
        if ($rc -ne 0) {
            Write-Err "adb push failed (exit $rc)."
            $script:ExitCode = $rc
            return
        }
    }

    Write-Announce @('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '7')
    if (-not $dryRun) {
        & adb shell settings put global stay_on_while_plugged_in 7
        $rc = $LASTEXITCODE
        if ($rc -ne 0) {
            Write-Err "Could not set stay_on_while_plugged_in (exit $rc)."
            $script:ExitCode = $rc
            return
        }
    }

    if ($dryRun) {
        Write-Out 'Dry run: no adb command was run.'
        $script:ExitCode = 0
        return
    }

    # Phase 6: what is left to do by hand.
    Write-Out 'Done. Remaining manual steps on the tablet:'
    Write-Out '  1. Open Fully, grant the permissions it asks for, and activate the PLUS license. On Android 13 or later, if a setting is blocked as restricted: App info for Fully > three-dot menu > Allow restricted settings.'
    Write-Out '  2. If you connect over Tailscale, install it now: the device owner is set, so adding an account is safe from here on. A re-run of this script still works after that: it skips the account check because Fully is already the device owner.'
    Write-Out '  3. In Fully: Other Settings > Import Settings from File > Download/fully-settings.json.'
    Write-Out '  4. Set your kiosk PIN in Kiosk Mode > Kiosk Mode PIN. This script never pushes a PIN; do not reuse the organizer PIN.'
    Write-Out '  5. Turn on kiosk mode and, when Fully asks, make it the default Home app.'
    Write-Out '  6. Restart the tablet: it should open on the hub. Then pair it (Pair this tablet, after the organizer signs in).'
    Write-Out 'See demo/tablet/README.md.'
}

try {
    Invoke-Provision -Arguments $args
}
finally {
    if ($script:TmpDir -and (Test-Path -LiteralPath $script:TmpDir)) {
        Remove-Item -LiteralPath $script:TmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
exit $script:ExitCode
