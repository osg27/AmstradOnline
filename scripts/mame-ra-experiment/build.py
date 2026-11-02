"""Build an isolated hardware adapter. Requires Python 3, Emscripten 3.1.57 and GNU make.
Never downloads a ROM. Normal Arcade assets are not touched.
"""
import argparse
import hashlib
import io
import re
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
MAME = 'df60f6466d678f38bcb978d73983c9c7ed2cba6e'
RCHEEVOS = '1433173220a7eaede6a9ed7a18e94117be1821e0'
OUT = ROOT / 'frontend/public/experiments/mame-ra'
CACHE = ROOT / '.tmp-mame-ra-build'


def source(repo, commit):
    destination = CACHE / (repo.split('/')[-1] + '-' + commit)
    if not destination.exists():
        url = f'https://codeload.github.com/{repo}/zip/{commit}'
        with urllib.request.urlopen(url, timeout=120) as response:
            archive = zipfile.ZipFile(io.BytesIO(response.read()))
        # Only GitHub archive members within this task cache are allowed.
        for member in archive.infolist():
            if not (CACHE / member.filename).resolve().is_relative_to(CACHE.resolve()):
                raise ValueError('Unsafe archive path')
        archive.extractall(CACHE)
    return destination


def replace(file, before, after):
    content = file.read_text()
    if after in content:
        return  # Already patched on a repeat build.
    if before not in content:
        raise ValueError(f'Pinned source changed: {file.name}')
    file.write_text(content.replace(before, after))


def run(arguments, cwd=ROOT):
    subprocess.run([str(arg) for arg in arguments], cwd=cwd, check=True)


def main():
    global CACHE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emscripten', type=Path, required=True, help='Directory containing emcc and emar')
    parser.add_argument('--make', default='make')
    parser.add_argument('--game', choices=['pacman', 'sf2ce'], default='pacman')
    args = parser.parse_args()
    cps1 = args.game == 'sf2ce'
    if cps1:
        CACHE = ROOT / '.tmp-cps1-ra-build'
    suffix = '.bat' if (args.emscripten / 'emcc.bat').exists() else ''
    emcc, emar = [args.emscripten.resolve() / (name + suffix) for name in ['emcc', 'emar']]
    CACHE.mkdir(exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    mame = source('libretro/mame2003-plus-libretro', MAME)
    rc = source('RetroAchievements/rcheevos', RCHEEVOS)
    if cps1:
        cps = mame / 'src/drivers/cps1.c'
        content = cps.read_text()
        if 'ROM_START( sf2ceold )' not in content:
            old_rom = re.search(r'ROM_START\( sf2ce \).*?ROM_END', content, re.S).group()
            old_game = next(line for line in content.splitlines() if re.search(r'GAMEC\(1992, sf2ce,\s+0,', line))
            new_rom = old_rom.replace('"sf2ce.23"', '"s92e_23b.8f"').replace('3f846b74', '0aaa1a3a').replace('c8d7a01b626771870123f1663a01a81f9c8fe582', '774a2b52f7c1876c0e10d8d57a0850ad2d016cf6')
            new_rom = new_rom.replace('"sf2ce.22"', '"s92_22b.7f"').replace('99f1cca4', '2bbe15ed').replace('64111eba81d743fc3fd51d7a89cd0b2eefcc900d', 'a8e2edef62fa99c5ef701b28bfb6bc42f3af183d')
            content = content.replace(old_rom, new_rom + '\n\n' + old_rom.replace('ROM_START( sf2ce )', 'ROM_START( sf2ceold )'))
            content = content.replace(old_game, old_game.replace('World 920313', 'World 920513') + '\n' + old_game.replace('sf2ce,', 'sf2ceold,', 1))
            cps.write_text(content)
        video = mame / 'src/vidhrdw/cps1_vidhrdw.c'
        content = video.read_text()
        if '{"sf2ceold"' not in content:
            row = next(line for line in content.splitlines() if '{"sf2ce",' in line)
            video.write_text(content.replace(row, row + '\n' + row.replace('"sf2ce"', '"sf2ceold"')))
    driver = 'drv_cps1_ra' if cps1 else 'drv_pacman'
    replace(mame / 'Makefile', 'PLATCFLAGS += -D__EMSCRIPTEN__\n',
            f'PLATCFLAGS += -D__EMSCRIPTEN__ -DSPLIT_CORE -D{driver} -Wno-cast-align\n')
    replace(mame / 'Makefile', '-include $(DEPFILES)', '# Isolated pinned build: skip dependency regeneration')
    if cps1:
        replace(mame / 'Makefile.split', '# drivers\n', '''# drivers
ifneq (,$(filter $(INCLUDE_DRV),drv_cps1_ra))
CPUS+=M68000@ Z80@
SOUNDS+=YM2151_ALT@ OKIM6295@ QSOUND@
SOURCES_C += $(CORE_DIR)/drivers/cps1.c $(CORE_DIR)/vidhrdw/cps1_vidhrdw.c $(CORE_DIR)/machine/kabuki.c
endif
''')
    else:
        replace(mame / 'Makefile.split', '# drivers\n', '''# drivers
ifneq (,$(filter $(INCLUDE_DRV),drv_pacman))
CPUS+=Z80@ S2650@
SOUNDS+=NAMCO_15XX@ SN76496@
SOURCES_C += $(CORE_DIR)/drivers/pacman.c $(CORE_DIR)/machine/mspacman.c $(CORE_DIR)/machine/pacplus.c $(CORE_DIR)/machine/jumpshot.c $(CORE_DIR)/machine/theglobp.c $(CORE_DIR)/machine/acitya.c $(CORE_DIR)/drivers/jrpacman.c $(CORE_DIR)/vidhrdw/pacman_vidhrdw.c $(CORE_DIR)/drivers/pengo.c
endif
''')
    # Emscripten builds an archive: include its libretro-common/zlib dependencies too.
    replace(mame / 'Makefile.split', 'ifeq ($(STATIC_LINKING),1)', 'ifeq (0,1)')
    registrations = '''#else\t/* DRIVER_RECURSIVE */
#if defined(drv_cps1_ra)
DRIVER(sf2ce)
DRIVER(sf2ceold)
#endif''' if cps1 else '''#else\t/* DRIVER_RECURSIVE */
#if defined(drv_pacman)
DRIVER(puckman)
DRIVER(pacman)
#endif'''
    replace(mame / 'src/driver_split.c', '#else\t/* DRIVER_RECURSIVE */', registrations)
    config_files = ['Makefile', 'Makefile.split', 'src/driver_split.c']
    if cps1:
        config_files += ['src/drivers/cps1.c', 'src/vidhrdw/cps1_vidhrdw.c']
    signature = hashlib.sha256(b''.join((mame / name).read_bytes() for name in config_files)).hexdigest()
    marker = mame / '.osg-build-config'
    if not marker.exists() or marker.read_text() != signature:
        # Compiler flags affect every object. Only remove build outputs inside this task cache.
        for artifact in (mame / 'src').rglob('*.o'):
            if not artifact.resolve().is_relative_to(CACHE.resolve()):
                raise ValueError('Build output outside isolated cache')
            artifact.unlink()
        marker.write_text(signature)
    run([args.make, '-j2', 'platform=emscripten', f'INCLUDE_DRV={driver}',
         f'CC={emcc.as_posix()}', f'AR={emar.as_posix()}', 'GIT_VERSION=experimental'], cwd=mame)
    # Upstream names an ar archive .bc; clang requires the .a suffix when linking it.
    library = CACHE / (args.game + '.a')
    shutil.copyfile(mame / 'mame2003_plus_libretro_emscripten.bc', library)
    native_name = 'mame-cps1' if cps1 else 'mame-pacman'
    run([emcc, 'scripts/mame-ra-experiment/host.c', library, f'-I{mame}/src/libretro-common/include',
         *(['-DOSG_CPS1_RA'] if cps1 else []),
         '-O2', '--no-entry', '-sMODULARIZE=1', f'-sEXPORT_NAME={"OSGMameCps1" if cps1 else "OSGMamePacman"}', '-sENVIRONMENT=web,node',
         '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432', '-sSTACK_SIZE=1048576', '-sFORCE_FILESYSTEM=1',
         '-sEXPORTED_RUNTIME_METHODS=["FS","cwrap","UTF8ToString"]', '-o', OUT / (native_name + '.js')])
    sources = [rc / 'src' / name for name in ['rc_client.c', 'rc_util.c', 'rc_compat.c', 'rc_version.c']]
    for folder in ['rcheevos', 'rapi', 'rhash']:
        sources.extend(sorted((rc / 'src' / folder).glob('*.c')))
    run([emcc, 'scripts/retroachievements/client.c', *sources, f'-I{rc}/include', f'-I{rc}/src',
         '-DRC_DISABLE_LUA', '-DOSG_MAME_RA_EXPERIMENT', '-O2', '--no-entry', '-sMODULARIZE=1',
         '-sEXPORT_NAME=OSGMameRA', '-sENVIRONMENT=web,node', '-sALLOW_MEMORY_GROWTH=1', '-sFILESYSTEM=0',
         '-sEXPORTED_FUNCTIONS=["_malloc","_free"]',
         '-sEXPORTED_RUNTIME_METHODS=["cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8"]',
         '-o', OUT / 'rc-client.js'])
    shutil.copyfile(mame / 'LICENSE.md', OUT / 'MAME-LICENSE.md')
    shutil.copyfile(rc / 'LICENSE', OUT / 'RCHEEVOS-LICENSE.txt')


if __name__ == '__main__':
    main()
