param(
    [string]$EmsdkPath = "C:\Users\pagma\Desktop\Repos\emsdk",
    [string]$BuildPath = "$PSScriptRoot\..\puae-wasm-build"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$buildRoot = [System.IO.Path]::GetFullPath($BuildPath)
$emscripten = Join-Path $EmsdkPath "upstream\emscripten"
$bash = "C:\msys64\usr\bin\bash.exe"

function Convert-ToMsysPath([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path).Replace("\", "/")
    return "/" + $fullPath.Substring(0, 1).ToLowerInvariant() + $fullPath.Substring(2)
}

if (-not (Test-Path $buildRoot)) {
    git clone https://github.com/EmulatorJS/build.git $buildRoot
}

Push-Location $buildRoot
try {
    if (-not (Test-Path "compile\RetroArch")) {
        git clone --depth 1 https://github.com/EmulatorJS/RetroArch.git compile/RetroArch
    }
    if (-not (Test-Path "compile\puae")) {
        git clone --depth 1 https://github.com/EmulatorJS/libretro-uae.git compile/puae
    }

    # The browser build has no pthreads, so CD32's Akiko and CD audio threads
    # are run cooperatively from the emulator loop instead.
    $cd32Patch = Join-Path $repoRoot "patches\puae-cd32-no-threads.patch"
    cmd /c "git -C compile/puae apply --check `"$cd32Patch`" 2>nul"
    if ($LASTEXITCODE -eq 0) {
        git -C compile/puae apply $cd32Patch
        if ($LASTEXITCODE -ne 0) { throw "Could not apply $cd32Patch" }
    }

    $env:EMSDK = $EmsdkPath.Replace("\", "/")
    $env:EM_CONFIG = (Join-Path $EmsdkPath ".emscripten").Replace("\", "/")
    $env:EMSDK_NODE = (Join-Path $EmsdkPath "node\22.16.0_64bit\bin\node.exe").Replace("\", "/")
    $env:EMSDK_PYTHON = (Join-Path $EmsdkPath "python\3.13.3_64bit\python.exe").Replace("\", "/")
    $env:PATH = "$emscripten;$EmsdkPath\node\22.16.0_64bit\bin;$EmsdkPath\python\3.13.3_64bit;C:\Program Files\Git\cmd;C:\msys64\usr\bin;C:\Windows\System32"

    $emscriptenMsys = Convert-ToMsysPath $emscripten
    $emcc = "$emscriptenMsys/emcc"
    $emxx = "$emscriptenMsys/em++"
    $emar = "$emscriptenMsys/emar"

    Push-Location "compile\puae"
    try {
        & $bash -c "make clean platform=emscripten >/dev/null 2>&1; make -j4 platform=emscripten CC=$emcc CXX=$emxx AR=$emar 2>&1"
        if ($LASTEXITCODE -ne 0) { throw "PUAE core compilation failed." }
    } finally {
        Pop-Location
    }

    Copy-Item "compile\puae\puae_libretro_emscripten.bc" "compile\RetroArch\libretro_emscripten.a" -Force
    & $bash -c "make -C compile/RetroArch -f Makefile.emulatorjs clean TARGET=puae_libretro.js >/dev/null 2>&1; make -C compile/RetroArch -f Makefile.emulatorjs -j4 TARGET=puae_libretro.js CC=$emcc CXX=$emxx LD=$emcc AR=$emar 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "PUAE browser runtime link failed." }

    $output = Join-Path $repoRoot "frontend\public\puae-wasm"
    New-Item -ItemType Directory -Force $output | Out-Null
    Copy-Item "compile\RetroArch\puae_libretro.js" $output -Force
    Copy-Item "compile\RetroArch\puae_libretro.wasm" $output -Force
    Write-Host "PUAE WASM runtime written to $output"
} finally {
    Pop-Location
}
