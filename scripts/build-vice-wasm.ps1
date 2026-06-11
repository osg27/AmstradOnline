param(
    [string]$EmsdkPath = "C:\Users\pagma\Desktop\Repos\emsdk",
    [string]$ViceJsPath = "$PSScriptRoot\..\vice.js"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$viceRoot = (Resolve-Path $ViceJsPath).Path
$sourceRoot = Join-Path $viceRoot "vice-2.4"
$emscripten = Join-Path $EmsdkPath "upstream\emscripten"
$bash = "C:\msys64\usr\bin\bash.exe"

function Convert-ToMsysPath([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path).Replace("\", "/")
    return "/" + $fullPath.Substring(0, 1).ToLowerInvariant() + $fullPath.Substring(2)
}

if (-not (Test-Path (Join-Path $sourceRoot "src\config.h"))) {
    throw "Patched and configured VICE 2.4 source was not found at $sourceRoot"
}

$mainSource = Join-Path $sourceRoot "src\main.c"
$mainText = Get-Content -LiteralPath $mainSource -Raw
$mainText = $mainText.Replace(
    "emscripten_set_main_loop(maincpu_mainloop, 0, 0);",
    "emscripten_set_main_loop(maincpu_mainloop, 0, 1);"
)
Set-Content -LiteralPath $mainSource -Value $mainText -NoNewline

$emscriptenMsys = Convert-ToMsysPath $emscripten
$viceMsys = Convert-ToMsysPath $viceRoot
$repoMsys = Convert-ToMsysPath $repoRoot
$python = Get-ChildItem (Join-Path $EmsdkPath "python") -Recurse -Filter python.exe |
    Select-Object -First 1 -ExpandProperty FullName

$env:HOME = "$viceMsys/.tmp"
$env:TMPDIR = "$viceMsys/.tmp"
$env:PYTHON = Convert-ToMsysPath $python
$env:EMSDK_PYTHON = $env:PYTHON

$compile = "cd '$viceMsys/vice-2.4' && make x64 -j4 CFLAGS='-O2 -sUSE_SDL=1' LDFLAGS='-sUSE_SDL=1 -sLEGACY_GL_EMULATION --js-library ../../library-vice.js'"
& $bash -lc $compile
if ($LASTEXITCODE -ne 0) { throw "VICE object compilation failed." }

$objectFolders = @(
    "src", "src/arch/sdl", "src/c64", "src/c64/cart", "src/core",
    "src/diskimage", "src/drive", "src/drive/iec", "src/drive/iec/c64exp",
    "src/drive/iec/plus4exp", "src/drive/iec128dcr", "src/drive/iecieee",
    "src/drive/ieee", "src/drive/tcbm", "src/fileio", "src/fsdevice",
    "src/gfxoutputdrv", "src/iecbus", "src/imagecontents", "src/lib/p64",
    "src/monitor", "src/parallel", "src/platform", "src/printerdrv",
    "src/raster", "src/rs232drv", "src/rtc", "src/serial", "src/sid",
    "src/sounddrv", "src/tape", "src/userport", "src/vdrive", "src/vicii",
    "src/video"
)
$objects = ($objectFolders | ForEach-Object { "../vice-2.4/$_/*.o" }) -join " "
$exports = "[_autostart_autodetect,_file_system_attach_disk,_file_system_detach_disk,_joystick_set_value_and,_joystick_set_value_or,_keyboard_key_pressed,_keyboard_key_released,_machine_trigger_reset,_main,_malloc,_free]"
$runtimeExports = "[ccall,cwrap,FS]"
$output = "$repoMsys/frontend/public/c64/vice.js"

$link = "cd '$viceMsys/fs-x64' && '$emscriptenMsys/emcc' -O2 -o '$output' -sASSERTIONS=2 -sUSE_SDL=1 -sLEGACY_GL_EMULATION -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sEXPORTED_FUNCTIONS='$exports' -sEXPORTED_RUNTIME_METHODS='$runtimeExports' --js-library ../library-vice.js --embed-file bin@/bin $objects"
& $bash -lc $link
if ($LASTEXITCODE -ne 0) { throw "VICE WebAssembly link failed." }

icacls (Join-Path $repoRoot "frontend\public\c64\vice.js") /inheritance:e | Out-Null
icacls (Join-Path $repoRoot "frontend\public\c64\vice.wasm") /inheritance:e | Out-Null
Write-Host "Standalone VICE WASM runtime written to frontend/public/c64"
