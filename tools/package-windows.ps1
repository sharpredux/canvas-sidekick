param([switch]$SkipBuild, [string]$MakeNSIS = "makensis.exe")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    if (!$SkipBuild) {
        cargo build --locked --release --features auth --bin canvas-sidekick --bin canvas-sidekick-auth
        if ($LASTEXITCODE -ne 0) { throw "Native Windows build failed" }
    }
    $version = (Select-String -Path Cargo.toml -Pattern '^version = "([^"]+)"').Matches[0].Groups[1].Value
    $output = Join-Path $root "artifacts\packages"
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    $binaries = Join-Path $root "target\release"
    foreach ($name in @("canvas-sidekick.exe", "canvas-sidekick-auth.exe")) {
        if (!(Test-Path (Join-Path $binaries $name))) { throw "Missing release executable: $name" }
    }
    $notices = Join-Path $output "notices"
    python tools/package-notices.py $notices
    if ($LASTEXITCODE -ne 0) { throw "Dependency notice collection failed" }
    foreach ($portable in @($false, $true)) {
        $arguments = @("/DVERSION=$version", "/DOUTPUT=$output", "/DBINARIES=$binaries", "/DNOTICES=$notices", "/DROOT=$root")
        if ($portable) { $arguments += "/DPORTABLE" }
        & $MakeNSIS @arguments "packaging\windows\candidate.nsi"
        if ($LASTEXITCODE -ne 0) { throw "NSIS package failed" }
    }
    Get-ChildItem $output -Filter *.exe | Get-FileHash -Algorithm SHA256 | Format-Table
    Write-Output "Candidate packages created; nothing installed. WebView2 Runtime and Windows acceptance checks are required."
} finally { Pop-Location }
