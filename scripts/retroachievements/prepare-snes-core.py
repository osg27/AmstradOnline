"""Expose existing Snes9x RAM getters without recompiling or changing emulator code.

Pinned EmulatorJS core 2.0.2, both WebGL variants. Only the WASM export section
changes. A JS callback observes the existing Emscripten main-loop boundary.
Requires 7-Zip; run from any directory. No ROMs are read or downloaded.
"""
import argparse
import hashlib
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PINS = {
    '': ('2bc7b519bc185af151cc7ebc42c0a926a125be174c6467c24bb0495820adf0bf',
         '63f67204bd65e2362594899e2526e955b8ee620722f7e511a08498236098ee99', 459),
    '-legacy': ('c3b930598155256dae0e4f66f2bb05c5dd6fc2366fbb5048a34dd61db392d1cf',
                '245b3010e288e936ac06c40e67c9decf12bbfcb270fdcd5ef0bb68c59d0efb1c', 451),
}


def read_leb(data, offset):
    value = shift = 0
    while True:
        byte = data[offset]; offset += 1
        value |= (byte & 127) << shift
        if not byte & 128:
            return value, offset
        shift += 7


def leb(value):
    out = bytearray()
    while value >= 128:
        out.append((value & 127) | 128); value >>= 7
    out.append(value)
    return out


def sections(data):
    offset = 8
    while offset < len(data):
        kind = data[offset]; length, start = read_leb(data, offset + 1)
        yield kind, data[start:start + length]
        offset = start + length


def add_exports(data, imports, getters=(2192, 2193)):
    out = bytearray(data[:8])
    for kind, body in sections(data):
        if kind == 7:
            count, offset = read_leb(body, 0)
            extra = bytearray()
            # Binaryen's defined-function labels 2192/2193: native libretro
            # memory size/data. Absolute WASM indices also count imported funcs.
            for name, index in [('osg_ra_memory_size', imports + getters[0]), ('osg_ra_memory_data', imports + getters[1])]:
                encoded = name.encode()
                extra += leb(len(encoded)) + encoded + b'\0' + leb(index)
            body = leb(count + 2) + body[offset:] + extra
        out += bytes([kind]) + leb(len(body)) + body
    # Every instruction, global, import and data segment must remain identical.
    assert [(k, b) for k, b in sections(data) if k != 7] == [(k, b) for k, b in sections(out) if k != 7]
    return out


def patch_js(text, metadata=''):
    pattern = r'var _get_current_frame_count=Module\["_get_current_frame_count"\]=wasmExports\["[^"]+"\];'
    assert len(re.findall(pattern, text)) == 1
    text = re.sub(pattern, lambda m: m.group() + 'Module["_ra_memory_data"]=wasmExports["osg_ra_memory_data"];Module["_ra_memory_size"]=wasmExports["osg_ra_memory_size"];' + metadata, text)
    boundary = 'callUserCallback(func);for(var post of MainLoop.postMainLoop)'
    assert text.count(boundary) == 1
    return text.replace(boundary, 'callUserCallback(func);Module["osgRAFrame"]?.();for(var post of MainLoop.postMainLoop)')


def prepare(sevenzip):
    for variant, (wasm_hash, js_hash, imports) in PINS.items():
        folder = ROOT / '.tmp-snes-ra' / ('prepare' + variant)
        folder.mkdir(parents=True, exist_ok=True)
        source = ROOT / f'frontend/public/emulatorjs/data/cores/snes9x{variant}-wasm.data'
        subprocess.run([sevenzip, 'x', str(source), '-o' + str(folder), '-y'], check=True, capture_output=True)
        wasm = folder / 'snes9x_libretro.wasm'; js = folder / 'snes9x_libretro.js'
        assert hashlib.sha256(wasm.read_bytes()).hexdigest() == wasm_hash, 'Unexpected SNES native build'
        assert hashlib.sha256(js.read_bytes()).hexdigest() == js_hash, 'Unexpected SNES JS build'
        wasm.write_bytes(add_exports(wasm.read_bytes(), imports))
        js.write_text(patch_js(js.read_text(encoding='utf-8')), encoding='utf-8')
        output = ROOT / f'frontend/public/snes/snes9x-ra{variant}-wasm.data'
        if output.exists():
            output.unlink()  # Fixed task-owned artifact; never edits the source core.
        files = ['build.json', 'core.json', 'license.txt', 'snes9x_libretro.js', 'snes9x_libretro.wasm']
        subprocess.run([sevenzip, 'a', '-t7z', '-mx=9', '-mtc=off', '-mta=off', '-mtm=off', str(output),
                        *files], cwd=folder, check=True, capture_output=True)
        print(f'Prepared {output.name} (emulation code unchanged)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    windows_tool = 'C:/Program Files/7-Zip/7z.exe'
    parser.add_argument('--sevenzip', default=windows_tool if Path(windows_tool).exists() else shutil.which('7z'))
    prepare(parser.parse_args().sevenzip)
