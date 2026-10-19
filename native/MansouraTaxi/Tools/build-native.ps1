#Requires -Version 5.1
<#
.SYNOPSIS
Build, import original assets, and package the Mansoura Taxi UE 5.6+ project.
.EXAMPLE
.\build-native.ps1 -EngineRoot 'D:\Epic Games\UE_5.6'
.NOTES
Requires an existing Unreal installation and VS 2022 C++ x64 tools/Windows SDK.
This does not install an engine, provision cloud hardware, or validate a GPU.
#>
[CmdletBinding()]
param(
    [string] $EngineRoot = $env:UE_ENGINE_ROOT,
    [ValidateSet('Development', 'Shipping')][string] $Configuration = 'Development',
    [string] $ArchiveDirectory,
    [switch] $PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-File([string] $Path, [string] $Description) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Description is missing: $Path" }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Invoke-Checked([string] $FilePath, [string[]] $Arguments, [string] $Step) {
    Write-Host "[$Step]"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE. Review the Unreal build log above." }
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This script packages Win64 and requires Windows.' }
    if ([string]::IsNullOrWhiteSpace($EngineRoot)) {
        throw "Unreal Engine is not configured. Supply -EngineRoot 'D:\Epic Games\UE_5.6' (or set UE_ENGINE_ROOT). No native build has run."
    }
    $ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
    $ProjectFile = Require-File (Join-Path $ProjectRoot 'MansouraTaxi.uproject') 'C++ project'
    $EngineRoot = (Resolve-Path -LiteralPath $EngineRoot).Path
    $BuildBat = Require-File (Join-Path $EngineRoot 'Engine\Build\BatchFiles\Build.bat') 'Unreal Build.bat'
    $RunUat = Require-File (Join-Path $EngineRoot 'Engine\Build\BatchFiles\RunUAT.bat') 'Unreal automation tool'
    $Editor = Require-File (Join-Path $EngineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe') 'UnrealEditor-Cmd.exe'
    $VersionFile = Require-File (Join-Path $EngineRoot 'Engine\Build\Build.version') 'Engine version metadata'
    $Version = Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json
    if ($Version.MajorVersion -ne 5 -or $Version.MinorVersion -lt 6) { throw 'This project requires Unreal Engine 5.6 or a later UE5 version.' }
    $Bootstrap = Require-File (Join-Path $PSScriptRoot 'bootstrap_editor.py') 'Editor content bootstrap'
    $ManifestFile = Require-File (Join-Path $ProjectRoot 'Content\Data\reference-assets.json') 'Export manifest; run node scripts/export-native-assets.mjs from the repository root'
    $Manifest = Get-Content -LiteralPath $ManifestFile -Raw | ConvertFrom-Json
    if (@($Manifest.entries).Count -eq 0) { throw 'The export manifest contains no meshes.' }
    foreach ($Entry in $Manifest.entries) {
        $null = Require-File (Join-Path $ProjectRoot $Entry.obj) 'Exported OBJ'
        $null = Require-File (Join-Path $ProjectRoot $Entry.mtl) 'Exported MTL'
    }

    $VsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $VsWhere = Require-File $VsWhere 'Visual Studio Installer vswhere.exe; install VS 2022 Desktop development with C++ and Game development with C++'
    $VsInstall = & $VsWhere '-latest' '-products' '*' '-version' '[17.0,18.0)' '-requires' 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64' '-property' 'installationPath'
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($VsInstall -join ''))) { throw 'VS 2022 x64 C++ compiler tools were not found. Install the C++ workloads and an engine-supported MSVC toolset.' }
    $VsInstall = ($VsInstall | Select-Object -First 1).Trim()
    $Compiler = Get-ChildItem -LiteralPath (Join-Path $VsInstall 'VC\Tools\MSVC') -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'bin\Hostx64\x64\cl.exe' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $Compiler) { throw "Visual Studio was found but its x64 compiler cl.exe is missing: $VsInstall" }
    $SdkInclude = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Include'
    $Sdk = Get-ChildItem -LiteralPath $SdkInclude -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Where-Object {
            (Test-Path -LiteralPath (Join-Path $_.FullName 'um\Windows.h') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName 'ucrt\stdio.h') -PathType Leaf)
        } | Select-Object -First 1
    if (-not $Sdk) { throw 'A Windows 10/11 C++ SDK was not found. Install an SDK supported by your Unreal version through Visual Studio Installer.' }
    Write-Host "Preflight passed: UE $($Version.MajorVersion).$($Version.MinorVersion), VS 2022 compiler, Windows SDK $($Sdk.Name)."
    if ($PreflightOnly) { Write-Host 'Preflight only: no compilation, import, or packaging was attempted.'; exit 0 }

    if ([string]::IsNullOrWhiteSpace($ArchiveDirectory)) { $ArchiveDirectory = Join-Path $ProjectRoot 'Packaged' }
    $ArchiveDirectory = [IO.Path]::GetFullPath($ArchiveDirectory)
    $null = New-Item -ItemType Directory -Path $ArchiveDirectory -Force
    Invoke-Checked $BuildBat @('-projectfiles', "-project=$ProjectFile", '-game', '-engine', '-progress') 'Generate project files'
    Invoke-Checked $BuildBat @('MansouraTaxiEditor', 'Win64', 'Development', "-Project=$ProjectFile", '-WaitMutex', '-NoHotReloadFromIDE') 'Compile editor target'

    $RunId = [Guid]::NewGuid().ToString('N')
    $PreviousRunId = $env:MANSOURA_BOOTSTRAP_RUN_ID
    try {
        $env:MANSOURA_BOOTSTRAP_RUN_ID = $RunId
        Invoke-Checked $Editor @($ProjectFile, "-ExecutePythonScript=$Bootstrap", '-unattended', '-nop4', '-nosplash', '-NullRHI', '-stdout', '-FullStdOutLogOutput', '-UTF8Output') 'Import assets and create map'
    } finally {
        $env:MANSOURA_BOOTSTRAP_RUN_ID = $PreviousRunId
    }
    $ReportFile = Require-File (Join-Path $ProjectRoot 'Saved\Native\bootstrap-result.json') 'Editor bootstrap result'
    $Report = Get-Content -LiteralPath $ReportFile -Raw | ConvertFrom-Json
    $ManifestHash = (Get-FileHash -LiteralPath $ManifestFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Report.status -ne 'success' -or $Report.runId -ne $RunId -or $Report.manifestSha256 -ne $ManifestHash) {
        throw "Editor content bootstrap did not produce a fresh successful result. Review $ReportFile and the Unreal log. Packaging was not attempted."
    }
    $null = Require-File (Join-Path $ProjectRoot 'Content\Mansoura\Maps\Mansoura.umap') 'Generated Mansoura map'
    Invoke-Checked $RunUat @('BuildCookRun', "-project=$ProjectFile", '-noP4', '-platform=Win64', "-clientconfig=$Configuration", '-build', '-cook', '-map=/Game/Mansoura/Maps/Mansoura', '-stage', '-pak', '-iostore', '-package', '-archive', "-archivedirectory=$ArchiveDirectory", '-utf8output', '-unattended') 'Build, cook, and package Win64'
    $PackagedExe = Get-ChildItem -LiteralPath $ArchiveDirectory -Filter 'MansouraTaxi.exe' -File -Recurse | Select-Object -First 1
    if (-not $PackagedExe) { throw "Automation returned success but MansouraTaxi.exe was not found under $ArchiveDirectory." }
    [ordered]@{
        status = 'packaged'
        builtAtUTC = [DateTime]::UtcNow.ToString('o')
        engineVersion = "$($Version.MajorVersion).$($Version.MinorVersion).$($Version.PatchVersion)"
        infrastructureBranch = "UE$($Version.MajorVersion).$($Version.MinorVersion)"
        configuration = $Configuration
        manifestSha256 = $ManifestHash
        bootstrapRunId = $RunId
        executable = $PackagedExe.FullName
        executableSha256 = (Get-FileHash -LiteralPath $PackagedExe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        streamingVerified = $false
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ArchiveDirectory 'native-build.json') -Encoding UTF8
    Write-Host "Native package created: $($PackagedExe.FullName)"
    Write-Host 'A package build does not verify graphics performance or a browser streaming session.'
    exit 0
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
