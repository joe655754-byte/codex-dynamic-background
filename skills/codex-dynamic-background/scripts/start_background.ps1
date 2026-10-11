[CmdletBinding(DefaultParameterSetName = 'Start')]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$BundleDirectory,
    [Parameter(ParameterSetName = 'Stop')]
    [switch]$Stop,
    [Parameter(ParameterSetName = 'Status')]
    [switch]$Status
)

$ErrorActionPreference = 'Stop'
$bundle = [IO.Path]::GetFullPath($BundleDirectory)
if (-not (Test-Path -LiteralPath $bundle -PathType Container)) { throw "The prepared bundle directory does not exist: $bundle" }
$runtime = Join-Path $bundle '.runtime'
$profile = Join-Path $bundle '.profile'
$stateFile = Join-Path $runtime 'state.json'
$statusFile = Join-Path $runtime 'status.json'
$stopFile = Join-Path $runtime 'stop.request'
$injectorPath = Join-Path $PSScriptRoot 'runtime\injector.mjs'

function Read-JsonFile([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
    }
    return $null
}

function Quote-NativeArgument([string]$Value) {
    # Windows command-line quoting, including trailing backslashes and spaces.
    $quoted = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $quoted = [regex]::Replace($quoted, '(\\+)$', '$1$1')
    return '"' + $quoted + '"'
}

function Get-ProfileArgument([string]$CommandLine) {
    $match = [regex]::Match($CommandLine, '(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+))')
    if (-not $match.Success) { return $null }
    $value = if ($match.Groups[1].Success) { $match.Groups[1].Value } elseif ($match.Groups[2].Success) { $match.Groups[2].Value } else { $match.Groups[3].Value }
    try { return [IO.Path]::GetFullPath($value) } catch { return $null }
}

function Get-OwnHelper($State) {
    if (-not $State -or -not $State.injectorPid -or -not $State.runId) { return $null }
    $helperPid = 0
    if (-not [int]::TryParse([string]$State.injectorPid, [ref]$helperPid) -or $helperPid -le 0) { return $null }
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $helperPid" -ErrorAction SilentlyContinue
    if (-not $candidate -or -not $candidate.CommandLine) { return $null }
    if ($candidate.CommandLine.IndexOf($injectorPath, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $candidate.CommandLine.IndexOf($runtime, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $candidate.CommandLine.IndexOf([string]$State.runId, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $null }
    return $candidate
}

function Get-RuntimeStatus($State) {
    $health = Read-JsonFile $statusFile
    $helper = Get-OwnHelper $State
    $fresh = $false
    if ($health -and $State -and $health.runId -eq $State.runId) {
        try { $fresh = ([DateTime]::UtcNow - [DateTime]::Parse($health.time).ToUniversalTime()).TotalSeconds -lt 12 } catch { }
    }
    $active = [bool]($helper -and $fresh -and $health.state -eq 'active' -and $health.advancing -and -not $health.paused -and $health.visibility -eq 'visible')
    [ordered]@{ active = $active; helperRunning = [bool]$helper; fresh = $fresh; playback = $health }
}

$previous = Read-JsonFile $stateFile
if ($Status) {
    Get-RuntimeStatus $previous | ConvertTo-Json -Depth 8
    exit 0
}
if ($Stop) {
    $helper = Get-OwnHelper $previous
    if (-not $helper) { Write-Host 'No background helper is running for this bundle.'; exit 0 }
    Set-Content -LiteralPath $stopFile -Value 'stop' -Encoding UTF8
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    do {
        Start-Sleep -Milliseconds 400
        $helper = Get-OwnHelper $previous
    } while ($helper -and [DateTime]::UtcNow -lt $deadline)
    if ($helper) { throw 'Stop was requested, but the helper has not finished cleanup. Codex was left open. Inspect .runtime/injector-error.log.' }
    Write-Host 'The background helper stopped. Its injected background was removed from reachable pages; Codex remains open.'
    exit 0
}

foreach ($file in @('wallpaper.mp4', 'poster.jpg', 'metadata.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $bundle $file) -PathType Leaf)) { throw "Required prepared bundle file is missing: $file" }
}
$metadata = Read-JsonFile (Join-Path $bundle 'metadata.json')
if (-not $metadata) { throw 'metadata.json is not a valid prepared bundle manifest.' }
$fit = if ($metadata.fit) { [string]$metadata.fit } else { 'contain' }
if ($fit -notin @('contain', 'cover')) { throw 'metadata.json fit must be contain or cover.' }
if (-not (Test-Path -LiteralPath $injectorPath -PathType Leaf)) { throw "The bundled runtime is missing: $injectorPath" }
$videoPath = Join-Path $bundle 'wallpaper.mp4'
$video = Get-Item -LiteralPath $videoPath
if ($video.Length -le 0 -or $video.Length -gt 300MB) { throw 'wallpaper.mp4 must be nonempty and no larger than 300 MB. Run prepare_video.py again.' }

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 22 or later is required. Install Node.js and ensure node.exe is on PATH.' }
$nodePath = $node.Source
$nodeMajor = & $nodePath -p 'Number(process.versions.node.split(".")[0])'
if ($LASTEXITCODE -ne 0 -or [int]$nodeMajor -lt 22) { throw 'Node.js 22 or later is required.' }

$codexPackage = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
if (-not $codexPackage) { throw 'The official OpenAI.Codex Windows Store package was not found. This runtime currently supports that Windows distribution.' }
$codexExecutable = $null
foreach ($relative in @('app\ChatGPT.exe', 'app\Codex.exe')) {
    $candidate = Join-Path $codexPackage.InstallLocation $relative
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $codexExecutable = $candidate; break }
}
if (-not $codexExecutable) { throw 'This Codex package has an unsupported launcher layout. Expected app/ChatGPT.exe or app/Codex.exe; the installation was left unchanged.' }

function Assert-ExistingWallpaperOwner($State, $Helper) {
    if (-not [string]::Equals([string]$State.profile, $profile, [StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals([string]$State.executable, $codexExecutable, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The running helper belongs to a different Codex executable or profile; it was left untouched.'
    }
    $existingPid = 0; $existingPort = 0
    if (-not [int]::TryParse([string]$State.codexPid, [ref]$existingPid) -or $existingPid -le 0 -or
        -not [int]::TryParse([string]$State.debugPort, [ref]$existingPort) -or $existingPort -lt 1024 -or $existingPort -gt 65535) {
        throw 'The running helper has no valid Codex PID or debugger port; it was left untouched.'
    }
    if (-not [string]::Equals($Helper.ExecutablePath, $nodePath, [StringComparison]::OrdinalIgnoreCase) -or
        $Helper.CommandLine.IndexOf($profile, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $Helper.CommandLine.IndexOf($codexExecutable, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'The running helper no longer matches this Node runtime, Codex executable, and profile.'
    }
    $owner = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    $metadata = Get-CimInstance Win32_Process -Filter "ProcessId = $existingPid" -ErrorAction SilentlyContinue
    if (-not $owner -or -not $metadata -or
        -not [string]::Equals($owner.Path, $codexExecutable, [StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals((Get-ProfileArgument $metadata.CommandLine), $profile, [StringComparison]::OrdinalIgnoreCase) -or
        $metadata.CommandLine -match '--type=' -or
        $metadata.CommandLine.IndexOf('--remote-debugging-address=127.0.0.1', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'The saved Codex PID is not the verified official main process for this profile.'
    }
    $portMatch = [regex]::Match($metadata.CommandLine, '--remote-debugging-port=(\d+)')
    if (-not $portMatch.Success -or [int]$portMatch.Groups[1].Value -ne $existingPort) {
        throw 'The saved debugger port no longer matches the verified Codex process.'
    }
    return [pscustomobject]@{ Process = $owner; Pid = $existingPid; Port = $existingPort }
}

function Test-ExistingLoopbackListeners([string[]]$Lines, [int]$Port, [int]$OwnerPid) {
    $listeners = @($Lines | ForEach-Object {
        $columns = $_.Trim() -split '\s+'
        if ($columns.Count -eq 5 -and $columns[0] -eq 'TCP' -and $columns[3] -eq 'LISTENING') {
            $separator = $columns[1].LastIndexOf(':')
            if ($separator -ge 0 -and $columns[1].Substring($separator + 1) -eq [string]$Port) {
                [pscustomobject]@{ LocalAddress = $columns[1]; OwningProcess = $columns[4] }
            }
        }
    })
    if (-not $listeners.Count) { return $false }
    foreach ($listener in $listeners) {
        if ($listener.LocalAddress -ne "127.0.0.1:$Port" -or [string]$listener.OwningProcess -ne [string]$OwnerPid) {
            throw 'The existing debugger port is no longer exclusively owned by the verified IPv4 loopback process.'
        }
    }
    return $true
}

function Test-ExistingLoopbackEndpoint([int]$Port, [int]$OwnerPid) {
    if (-not (Test-ExistingLoopbackListeners @(netstat.exe -ano -p tcp) $Port $OwnerPid)) { return $false }
    try { $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -MaximumRedirection 0 }
    catch { return $false }
    $socket = [Uri]$version.webSocketDebuggerUrl
    if ($socket.Scheme -ne 'ws' -or $socket.Host -notin @('127.0.0.1', 'localhost') -or $socket.Port -ne $Port) {
        throw 'The existing browser debugger endpoint no longer has a verified local socket.'
    }
    return $true
}

function Show-VerifiedCodexWindow($Owner) {
    $Owner.Refresh()
    if ($Owner.MainWindowHandle -ne [IntPtr]::Zero) {
        if (-not ('CodexWallpaper.WindowControl' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CodexWallpaper {
    public static class WindowControl {
        [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
    }
}
'@
        }
        [void][CodexWallpaper.WindowControl]::ShowWindowAsync($Owner.MainWindowHandle, 9)
        if ([CodexWallpaper.WindowControl]::SetForegroundWindow($Owner.MainWindowHandle)) { return }
    }
    # AppActivate accepts a numeric PID and does not need a window title.
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.AppActivate([int]$Owner.Id)
}

$existingHelper = Get-OwnHelper $previous
if ($existingHelper) {
    $verified = Assert-ExistingWallpaperOwner $previous $existingHelper
    # Reject a mismatched listener before touching the existing app window.
    $null = Test-ExistingLoopbackEndpoint $verified.Port $verified.Pid
    Show-VerifiedCodexWindow $verified.Process
    $resumeDeadline = [DateTime]::UtcNow.AddSeconds(35)
    $previousActiveTime = $null
    while ([DateTime]::UtcNow -lt $resumeDeadline) {
        $endpointReady = Test-ExistingLoopbackEndpoint $verified.Port $verified.Pid
        $existing = Get-RuntimeStatus $previous
        if (-not $existing.helperRunning) { throw 'The existing wallpaper helper exited while the window was being restored. Codex was left open.' }
        if ($existing.playback -and $existing.playback.state -eq 'stopped') { throw 'The existing wallpaper helper has stopped. Codex was left open.' }
        if ($endpointReady -and $existing.active) {
            if ($previousActiveTime -and $previousActiveTime -ne $existing.playback.time) {
                Write-Host 'The verified Codex wallpaper window is visible and playback advanced in two independent samples.'
                Write-Host 'After replacing wallpaper.mp4, run -Stop and start again to load the new video.'
                exit 0
            }
            $previousActiveTime = $existing.playback.time
        }
        Start-Sleep -Milliseconds 600
    }
    throw 'The verified wallpaper window was restored, but playback did not become active within 35 seconds. Check -Status and .runtime/injector-error.log; Codex was left open.'
}

New-Item -ItemType Directory -Path $runtime -Force | Out-Null
New-Item -ItemType Directory -Path $profile -Force | Out-Null
foreach ($stale in @($stopFile, $statusFile)) { if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale } }

$debugPort = $null
$profileProcess = $null
foreach ($candidate in (Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe' OR Name = 'Codex.exe'")) {
    if (-not [string]::Equals($candidate.ExecutablePath, $codexExecutable, [StringComparison]::OrdinalIgnoreCase)) { continue }
    if (-not [string]::Equals((Get-ProfileArgument $candidate.CommandLine), $profile, [StringComparison]::OrdinalIgnoreCase)) { continue }
    if ($candidate.CommandLine -match '--type=') { continue }
    $portMatch = [regex]::Match($candidate.CommandLine, '--remote-debugging-port=(\d+)')
    if (-not $portMatch.Success) { throw 'This bundle profile is open without a debugging port. Close that separate wallpaper window before retrying.' }
    $debugPort = [int]$portMatch.Groups[1].Value
    $profileProcess = $candidate
    break
}
if (-not $profileProcess) {
    $reservation = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $reservation.Start()
    $debugPort = $reservation.LocalEndpoint.Port
    $reservation.Stop()
    $appArguments = @('--remote-debugging-address=127.0.0.1', "--remote-debugging-port=$debugPort", "--user-data-dir=$profile", '--no-first-run')
    Start-Process -FilePath $codexExecutable -ArgumentList (($appArguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ') -WindowStyle Normal | Out-Null
} else { Write-Host 'Reusing this bundle''s verified Codex profile.' }

$deadline = [DateTime]::UtcNow.AddSeconds(45)
$ownerPid = $null
$lastReason = 'The local debugging endpoint has not appeared.'
while ([DateTime]::UtcNow -lt $deadline) {
    try {
        # Get-NetTCPConnection may block for over 20 seconds on a busy PC.
        # Keep every listener for the port; a wildcard/IPv6 row must fail.
        $listeners = @(netstat.exe -ano -p tcp | ForEach-Object {
            $columns = $_.Trim() -split '\s+'
            if ($columns.Count -eq 5 -and $columns[0] -eq 'TCP' -and $columns[3] -eq 'LISTENING') {
                $separator = $columns[1].LastIndexOf(':')
                if ($separator -ge 0 -and $columns[1].Substring($separator + 1) -eq [string]$debugPort) {
                    [pscustomobject]@{ LocalAddress = $columns[1]; OwningProcess = $columns[4] }
                }
            }
        })
        if (-not $listeners.Count -or @($listeners | Where-Object { $_.LocalAddress -ne "127.0.0.1:$debugPort" }).Count) { throw 'The debugger must listen only on IPv4 loopback.' }
        $ownerPidValue = 0
        if (-not [int]::TryParse([string]$listeners[0].OwningProcess, [ref]$ownerPidValue) -or $ownerPidValue -le 0) { throw 'The debugger listener has no valid owner PID.' }
        foreach ($listener in $listeners) { if ([string]$listener.OwningProcess -ne [string]$ownerPidValue) { throw 'The debugging port has multiple owners.' } }
        $owner = Get-Process -Id $ownerPidValue -ErrorAction SilentlyContinue
        if (-not $owner -or -not [string]::Equals($owner.Path, $codexExecutable, [StringComparison]::OrdinalIgnoreCase)) { throw 'The debugging port is not owned by the official Codex executable.' }
        $ownerMetadata = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPidValue"
        if (-not $ownerMetadata -or -not [string]::Equals((Get-ProfileArgument $ownerMetadata.CommandLine), $profile, [StringComparison]::OrdinalIgnoreCase)) { throw 'The debugging port belongs to another profile.' }
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$debugPort/json/version" -TimeoutSec 2 -MaximumRedirection 0
        $socket = [Uri]$version.webSocketDebuggerUrl
        if ($socket.Scheme -ne 'ws' -or $socket.Host -notin @('127.0.0.1', 'localhost') -or $socket.Port -ne $debugPort) { throw 'The endpoint has no verified local browser debugger socket.' }
        $ownerPid = $ownerPidValue
        break
    } catch { $lastReason = $_.Exception.Message; Start-Sleep -Milliseconds 500 }
}
if (-not $ownerPid) { throw "Codex did not expose a verified local debugging endpoint. $lastReason Close only the separately opened wallpaper window before retrying." }

$runId = [guid]::NewGuid().ToString()
$injectorArguments = @($injectorPath, '--port', [string]$debugPort, '--owner-pid', [string]$ownerPid,
    '--official-exe', $codexExecutable, '--video', $videoPath, '--runtime', $runtime, '--profile', $profile, '--run-id', $runId, '--fit', $fit)
$process = Start-Process -FilePath $nodePath -ArgumentList (($injectorArguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ') -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $runtime 'injector.log') -RedirectStandardError (Join-Path $runtime 'injector-error.log')
$newState = [ordered]@{ injectorPid = $process.Id; codexPid = $ownerPid; debugPort = $debugPort; profile = $profile;
    executable = $codexExecutable; runId = $runId; startedAt = [DateTime]::UtcNow.ToString('o') }
$newState | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8

$readyDeadline = [DateTime]::UtcNow.AddSeconds(35)
$previousActiveTime = $null
while ([DateTime]::UtcNow -lt $readyDeadline) {
    $process.Refresh()
    if ($process.HasExited) { throw 'The wallpaper helper exited. Read .runtime/injector-error.log.' }
    $health = Read-JsonFile $statusFile
    if ($health -and $health.runId -eq $runId -and $health.state -eq 'active' -and $health.advancing -and -not $health.paused -and $health.visibility -eq 'visible') {
        if ($previousActiveTime -and $previousActiveTime -ne $health.time) {
            Write-Host 'The dynamic background is active: two independent playback samples advanced.'
            Write-Host ('Verify two complete loops: node "' + (Join-Path $PSScriptRoot 'verify_playback.mjs') + '" --runtime "' + $runtime + '" --seconds 65')
            exit 0
        }
        $previousActiveTime = $health.time
    } elseif ($health -and $health.state -in @('stalled', 'stopped')) { throw "Wallpaper playback is $($health.state). Inspect .runtime/status.json and injector-error.log." }
    Start-Sleep -Milliseconds 400
}
throw 'The helper is running, but visible video playback was not verified. Keep the new Codex window visible and check -Status. Do not report the background as active yet.'
