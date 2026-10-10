[CmdletBinding()]
param([string]$Destination)
$ErrorActionPreference = 'Stop'
if (-not $Destination) {
    $Destination = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.agents\skills\codex-dynamic-background'
}
$sourceDirectory = Join-Path $PSScriptRoot 'skills\codex-dynamic-background'
$destinationDirectory = [IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath (Join-Path $sourceDirectory 'SKILL.md') -PathType Leaf)) { throw 'Skill source is incomplete.' }
if (Test-Path -LiteralPath $destinationDirectory) { throw "Destination already exists: $destinationDirectory. Preserve your existing skill before updating it." }
$parentDirectory = Split-Path -Parent $destinationDirectory
New-Item -ItemType Directory -Path $parentDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceDirectory -Destination $destinationDirectory -Recurse
Write-Host "Installed codex-dynamic-background to $destinationDirectory"
