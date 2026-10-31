"""Add read-only memory exports to the pinned existing FCEUmm core 2.0.2.
No emulation instructions change; no ROMs are read or downloaded. Requires 7-Zip.
"""
import argparse
import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('core_bridge', Path(__file__).with_name('prepare-snes-core.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
PINS = {
    '': ('2506285b7d10c8edfee17961e83e44dbaed9b2389199844c2c097d16b3b0a6f1',
         '4e5b44a4bfffc6e640cb333821310c2f5b9b98f3adfd8c74b1e01460fe12ae87', 459, 2183088, 2174896),
    '-legacy': ('86b8aca214421da72b2eb4827c93bddc8bd35c5e529f141de74ab5c5f57c8b8e',
                'dba07936f4502e66cd1d31adfcea8102664c3c6d8fd947bf3c151a3c93e5e73c', 451, 2182768, 2174576),
}


def prepare(sevenzip):
    for variant, (wasm_hash, js_hash, imports, pages, unmapped) in PINS.items():
        folder = ROOT / '.tmp-nes-ra' / ('prepare' + variant)
        folder.mkdir(parents=True, exist_ok=True)
        source = ROOT / f'frontend/public/emulatorjs/data/cores/fceumm{variant}-wasm.data'
        subprocess.run([sevenzip, 'x', str(source), '-o' + str(folder), '-y'], check=True, capture_output=True)
        wasm = folder / 'fceumm_libretro.wasm'; js = folder / 'fceumm_libretro.js'
        assert hashlib.sha256(wasm.read_bytes()).hexdigest() == wasm_hash, 'Unexpected NES native build'
        assert hashlib.sha256(js.read_bytes()).hexdigest() == js_hash, 'Unexpected NES JS build'
        wasm.write_bytes(bridge.add_exports(wasm.read_bytes(), imports, (4360, 4361)))
        # Addresses come from this exact pinned binary's CartBR and ResetCartMapping,
        # not ROM-specific RAM guesses. Page[] is updated by the core's mappers.
        metadata = f'Module["_ra_nes_pages"]=()=>{pages};Module["_ra_nes_unmapped"]=()=>{unmapped};'
        js.write_text(bridge.patch_js(js.read_text(encoding='utf-8'), metadata), encoding='utf-8')
        output = ROOT / f'frontend/public/nes/fceumm-ra{variant}-wasm.data'
        if output.exists():
            output.unlink()
        files = ['build.json', 'core.json', 'license.txt', 'fceumm_libretro.js', 'fceumm_libretro.wasm']
        subprocess.run([sevenzip, 'a', '-t7z', '-mx=9', '-mtc=off', '-mta=off', '-mtm=off', str(output), *files],
                       cwd=folder, check=True, capture_output=True)
        print(f'Prepared {output.name} (emulation code unchanged)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    windows_tool = 'C:/Program Files/7-Zip/7z.exe'
    parser.add_argument('--sevenzip', default=windows_tool if Path(windows_tool).exists() else shutil.which('7z'))
    prepare(parser.parse_args().sevenzip)
