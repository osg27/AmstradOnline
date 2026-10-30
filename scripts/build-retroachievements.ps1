param(
    [Parameter(Mandatory=$true)][string]$EmsdkPath,
    [string]$RcheevosPath,
    [string]$GenplusPath
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot/..").Path
if (-not $RcheevosPath) { $RcheevosPath = Join-Path $repoRoot '.tmp-rcheevos' }
if (-not $GenplusPath) { $GenplusPath = Join-Path $repoRoot 'wasm-genplus' }
$emcc = Join-Path $EmsdkPath 'upstream/emscripten/emcc.bat'
$toolchain = Join-Path $EmsdkPath 'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake'
$raRevision = '1433173220a7eaede6a9ed7a18e94117be1821e0'
$genRevision = '6090aff9e9b2f578cd28882bd4571d2e35b1d674'
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw 'Native build command failed.' } }
if (-not (Test-Path $emcc)) { throw 'Emscripten SDK not found. Tested with Emscripten 3.1.57.' }
if (-not (Test-Path $RcheevosPath)) {
    git clone https://github.com/RetroAchievements/rcheevos.git $RcheevosPath; Check-Exit
    git -C $RcheevosPath checkout $raRevision; Check-Exit
}
if ((git -c "safe.directory=$([IO.Path]::GetFullPath($RcheevosPath).Replace('\','/'))" -C $RcheevosPath rev-parse HEAD) -ne $raRevision) { throw 'Unexpected rcheevos revision.' }
if (-not (Test-Path $GenplusPath)) {
    git clone https://github.com/h1romas4/wasm-genplus.git $GenplusPath; Check-Exit
    git -C $GenplusPath checkout $genRevision; Check-Exit
}
if ((git -c "safe.directory=$([IO.Path]::GetFullPath($GenplusPath).Replace('\','/'))" -C $GenplusPath rev-parse HEAD) -ne $genRevision) { throw 'Unexpected wasm-genplus revision.' }
$genSource = Join-Path $GenplusPath 'src/main/c/wasm/wasm.c'
$genText = [IO.File]::ReadAllText($genSource)
if (-not $genText.Contains('ra_get_work_ram')) {
    # A pristine checkout needs the existing site changes (SMS, two pads, PAL) too.
    if (-not $genText.Contains('requested_system')) {
        git -c "safe.directory=$([IO.Path]::GetFullPath($GenplusPath).Replace('\','/'))" -C $GenplusPath apply --unidiff-zero (Join-Path $PSScriptRoot 'retroachievements/genplus-site.patch'); Check-Exit
    } else {
        [IO.File]::AppendAllText($genSource, "`n/* Old Style Gaming RetroAchievements memory bridge */`n" +
            [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'retroachievements/genplus-memory.c')))
    }
}
$output = Join-Path $repoRoot 'frontend/public/retroachievements'
New-Item -ItemType Directory -Force $output | Out-Null
$sources = @('rc_client.c','rc_util.c','rc_compat.c','rc_version.c') | ForEach-Object { Join-Path $RcheevosPath "src/$_" }
$sources += @(Get-ChildItem "$RcheevosPath/src/rcheevos/*.c","$RcheevosPath/src/rapi/*.c","$RcheevosPath/src/rhash/*.c" | ForEach-Object FullName)
& $emcc (Join-Path $PSScriptRoot 'retroachievements/client.c') @sources "-I$RcheevosPath/include" "-I$RcheevosPath/src" -DRC_DISABLE_LUA -O2 --no-entry `
    '-sMODULARIZE=1' '-sEXPORT_NAME=RACreateClient' '-sENVIRONMENT=web,node' '-sALLOW_MEMORY_GROWTH=1' '-sFILESYSTEM=0' `
    '-sEXPORTED_FUNCTIONS=["_malloc","_free"]' '-sEXPORTED_RUNTIME_METHODS=["cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8"]' `
    -o (Join-Path $output 'rc-client.js'); Check-Exit
Copy-Item "$RcheevosPath/LICENSE" "$output/LICENSE.txt"
cmake -S $GenplusPath -B "$GenplusPath/build" -G Ninja "-DCMAKE_TOOLCHAIN_FILE=$toolchain"; Check-Exit
cmake --build "$GenplusPath/build" --target genplus --parallel 2; Check-Exit
Copy-Item "$GenplusPath/src/main/js/genplus.js","$GenplusPath/src/main/js/genplus.wasm" "$repoRoot/frontend/public/megadrive/"
Push-Location "$repoRoot/frontend"
try { npm run build:retroachievements; Check-Exit } finally { Pop-Location }
