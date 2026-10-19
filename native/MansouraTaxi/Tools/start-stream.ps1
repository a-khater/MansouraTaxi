#Requires -Version 5.1
<#
.SYNOPSIS
Launch an existing native package against verified loopback Pixel Streaming.
.EXAMPLE
.\start-stream.ps1 -PackagedExe '..\Packaged\Windows\MansouraTaxi.exe' -InfrastructureRoot 'D:\PixelStreamingInfrastructure' -EngineBranch UE5.6
.NOTES
The official UE5.6 signalling server does not expose a bind-address CLI flag.
Its --public_ip option is not a listening-interface restriction. This script
will not start that server's all-interface defaults. Prepare a loopback-bound
server manually with the matching official infrastructure, then rerun.
https://github.com/EpicGamesExt/PixelStreamingInfrastructure/tree/UE5.6
https://github.com/EpicGamesExt/PixelStreamingInfrastructure/blob/UE5.6/SignallingWebServer/README.md
#>
[CmdletBinding()]
param(
    [string] $PackagedExe,
    [string] $InfrastructureRoot,
    [string] $EngineBranch,
    [ValidateRange(1024, 65535)][int] $PlayerPort = 8080,
    [ValidateRange(1024, 65535)][int] $StreamerPort = 8888,
    [ValidateRange(640, 3840)][int] $Width = 1600,
    [ValidateRange(360, 2160)][int] $Height = 900,
    [switch] $PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-File([string] $Path, [string] $Description) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Description is missing: $Path" }
    return (Resolve-Path -LiteralPath $Path).Path
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This helper launches a packaged Win64 application and requires Windows.' }
    if ([string]::IsNullOrWhiteSpace($PackagedExe)) { throw 'Supply -PackagedExe with an existing packaged MansouraTaxi.exe. Build the native project on a suitable UE host first.' }
    $PackagedExe = Require-File $PackagedExe 'Packaged native executable'
    if ([IO.Path]::GetExtension($PackagedExe) -ne '.exe') { throw '-PackagedExe must be a Windows executable.' }
    $Metadata = $null
    $SearchDirectory = [IO.DirectoryInfo]([IO.Path]::GetDirectoryName($PackagedExe))
    for ($Depth = 0; $Depth -lt 6 -and $null -ne $SearchDirectory; $Depth++) {
        $Candidate = Join-Path $SearchDirectory.FullName 'native-build.json'
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
            $Metadata = Get-Content -LiteralPath $Candidate -Raw | ConvertFrom-Json
            break
        }
        $SearchDirectory = $SearchDirectory.Parent
    }
    if (-not $Metadata -or $Metadata.status -ne 'packaged') { throw 'native-build.json was not found above the executable. Package through build-native.ps1 so the engine branch and executable can be verified.' }
    if ($Metadata.infrastructureBranch -notmatch '^UE5\.[0-9]+$') { throw 'Package metadata contains an invalid Unreal infrastructure branch.' }
    if ([string]::IsNullOrWhiteSpace($EngineBranch)) { $EngineBranch = $Metadata.infrastructureBranch }
    if ($EngineBranch -ne $Metadata.infrastructureBranch) { throw "EngineBranch $EngineBranch does not match the recorded package branch $($Metadata.infrastructureBranch)." }
    $ExecutableHash = (Get-FileHash -LiteralPath $PackagedExe -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Metadata.executableSha256 -ne $ExecutableHash) { throw 'The executable does not match native-build.json. Use the recorded packaged executable or rebuild the package.' }
    if ([string]::IsNullOrWhiteSpace($InfrastructureRoot)) {
        throw "Supply -InfrastructureRoot with an existing official PixelStreamingInfrastructure clone checked out to $EngineBranch. This script does not provision a GPU host or clone/install services."
    }
    $InfrastructureRoot = (Resolve-Path -LiteralPath $InfrastructureRoot).Path
    $OfficialStart = Require-File (Join-Path $InfrastructureRoot 'SignallingWebServer\platform_scripts\cmd\start.bat') 'Official Epic signalling start.bat'
    $null = Require-File (Join-Path $InfrastructureRoot 'SignallingWebServer\package.json') 'Epic signalling package metadata'
    $Git = Get-Command git.exe -ErrorAction SilentlyContinue
    if (-not $Git) { throw 'Git is required to verify the infrastructure checkout matches the Unreal branch.' }
    $Branch = & $Git.Source '-C' $InfrastructureRoot 'symbolic-ref' '--quiet' '--short' 'HEAD' 2>$null
    $BranchCode = $LASTEXITCODE
    $MatchesBranch = $BranchCode -eq 0 -and ($Branch -join '').Trim() -eq $EngineBranch
    if (-not $MatchesBranch) {
        $Tags = & $Git.Source '-C' $InfrastructureRoot 'tag' '--points-at' 'HEAD' 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'InfrastructureRoot is not a readable Git checkout.' }
        $MatchesBranch = @($Tags | Where-Object { $_ -eq $EngineBranch -or $_.StartsWith($EngineBranch + '-') }).Count -gt 0
    }
    if (-not $MatchesBranch) { throw "Infrastructure checkout does not match $EngineBranch. Select the UE branch/tag that matches the engine used to package this executable." }
    $Remote = & $Git.Source '-C' $InfrastructureRoot 'remote' 'get-url' 'origin' 2>$null
    if ($LASTEXITCODE -ne 0 -or ($Remote -join '') -notmatch '(?i)github\.com[:/](EpicGamesExt|EpicGames)/PixelStreamingInfrastructure(?:\.git)?/?$') {
        throw 'Expected the official EpicGamesExt/EpicGames PixelStreamingInfrastructure origin. Review the clone before launching a native stream.'
    }
    if ($PlayerPort -eq $StreamerPort) { throw 'PlayerPort and StreamerPort must be different.' }
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { throw 'Get-NetTCPConnection is required to verify listener interfaces on this Windows host.' }

    $Listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
    $PlayerListeners = @($Listeners | Where-Object { $_.LocalPort -eq $PlayerPort })
    $StreamerListeners = @($Listeners | Where-Object { $_.LocalPort -eq $StreamerPort })
    if ($PlayerListeners.Count -eq 0 -or $StreamerListeners.Count -eq 0) {
        throw @"
No ready loopback signalling service was found on player port $PlayerPort and streamer port $StreamerPort. Nothing was launched.
Official launcher: $OfficialStart
First prepare the matching Epic server and frontend. Its HTTP/player, streamer, and SFU listeners must explicitly bind to 127.0.0.1. The UE5.6 CLI has no documented bind-host option; configure that branch's server bindings manually before using its official start.bat. --public_ip=127.0.0.1 does not restrict listeners. Then rerun this helper. No firewall rule or public port was opened.
"@
    }
    $ServerProcessIds = @($PlayerListeners + $StreamerListeners | Select-Object -ExpandProperty OwningProcess -Unique)
    $ServerListeners = @($Listeners | Where-Object { $ServerProcessIds -contains $_.OwningProcess })
    $UnsafeListeners = @($ServerListeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' })
    if ($UnsafeListeners.Count -gt 0) {
        $Endpoints = ($UnsafeListeners | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ', '
        throw "Signalling is not loopback-only ($Endpoints). Stop or reconfigure those listeners to 127.0.0.1 before retrying. The native executable was not launched."
    }
    $Frontend = "http://127.0.0.1:$PlayerPort/"
    $Response = Invoke-WebRequest -Uri $Frontend -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
    if ($Response.StatusCode -ne 200 -or [string]::IsNullOrWhiteSpace($Response.Content)) { throw "The player listener did not serve a frontend at $Frontend" }
    Write-Host "Preflight passed: $EngineBranch checkout, existing package, and 127.0.0.1-only signalling listeners."
    if ($PreflightOnly) { Write-Host 'Preflight only: no game process or stream was launched.'; exit 0 }

    # Every launch argument is a separate fixed token; no command string is
    # evaluated and no user-supplied shell arguments are forwarded.
    $GameArguments = @('-RenderOffscreen', '-AudioMixer', "-PixelStreamingURL=ws://127.0.0.1:$StreamerPort", '-Windowed', '-ForceRes', "-ResX=$Width", "-ResY=$Height", '-Unattended', '-NoSplash')
    $GameProcess = Start-Process -FilePath $PackagedExe -ArgumentList $GameArguments -WorkingDirectory ([IO.Path]::GetDirectoryName($PackagedExe)) -WindowStyle Hidden -PassThru
    if ($GameProcess.WaitForExit(2000)) { throw "Native application exited immediately (code $($GameProcess.ExitCode)). Check its Saved\Logs output and GPU/encoder support. No working stream has been verified." }
    Write-Host "Native process started (PID $($GameProcess.Id)). Browser frontend: $Frontend"
    Write-Host 'Connection, video frames, audio, and host GPU performance still require a browser check. This is a local session, not public hosting.'
    exit 0
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
