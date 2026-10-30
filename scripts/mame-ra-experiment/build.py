"""Build the isolated Pac-Man preview. Requires Python 3, Emscripten 3.1.57 and GNU make.
Never downloads a ROM. Normal Arcade assets are not touched.
"""
import argparse
import io
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emscripten', type=Path, required=True, help='Directory containing emcc and emar')
    parser.add_argument('--make', default='make')
    args = parser.parse_args()
    suffix = '.bat' if (args.emscripten / 'emcc.bat').exists() else ''
    emcc, emar = [args.emscripten.resolve() / (name + suffix) for name in ['emcc', 'emar']]
    CACHE.mkdir(exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    mame = source('libretro/mame2003-plus-libretro', MAME)
    rc = source('RetroAchievements/rcheevos', RCHEEVOS)
    replace(mame / 'Makefile', 'PLATCFLAGS += -D__EMSCRIPTEN__\n',
            'PLATCFLAGS += -D__EMSCRIPTEN__ -DSPLIT_CORE -Ddrv_pacman -Wno-cast-align\n')
    replace(mame / 'Makefile', '-include $(DEPFILES)', '# Isolated pinned build: skip dependency regeneration')
    replace(mame / 'Makefile.split', '# drivers\n', '''# drivers
ifneq (,$(filter $(INCLUDE_DRV),drv_pacman))
CPUS+=Z80@ S2650@
SOUNDS+=NAMCO_15XX@ SN76496@
SOURCES_C += $(CORE_DIR)/drivers/pacman.c $(CORE_DIR)/machine/mspacman.c $(CORE_DIR)/machine/pacplus.c $(CORE_DIR)/machine/jumpshot.c $(CORE_DIR)/machine/theglobp.c $(CORE_DIR)/machine/acitya.c $(CORE_DIR)/drivers/jrpacman.c $(CORE_DIR)/vidhrdw/pacman_vidhrdw.c $(CORE_DIR)/drivers/pengo.c
endif
''')
    # Emscripten builds an archive: include its libretro-common/zlib dependencies too.
    replace(mame / 'Makefile.split', 'ifeq ($(STATIC_LINKING),1)', 'ifeq (0,1)')
    replace(mame / 'src/driver_split.c', '#else\t/* DRIVER_RECURSIVE */', '''#else\t/* DRIVER_RECURSIVE */
#if defined(drv_pacman)
DRIVER(puckman)
DRIVER(pacman)
#endif''')
    run([args.make, '-j2', 'platform=emscripten', 'INCLUDE_DRV=drv_pacman',
         f'CC={emcc.as_posix()}', f'AR={emar.as_posix()}', 'GIT_VERSION=experimental'], cwd=mame)
    # Upstream names an ar archive .bc; clang requires the .a suffix when linking it.
    library = CACHE / 'pacman.a'
    shutil.copyfile(mame / 'mame2003_plus_libretro_emscripten.bc', library)
    run([emcc, 'scripts/mame-ra-experiment/host.c', library, f'-I{mame}/src/libretro-common/include',
         '-O2', '--no-entry', '-sMODULARIZE=1', '-sEXPORT_NAME=OSGMamePacman', '-sENVIRONMENT=web,node',
         '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432', '-sSTACK_SIZE=1048576', '-sFORCE_FILESYSTEM=1',
         '-sEXPORTED_RUNTIME_METHODS=["FS","cwrap","UTF8ToString"]', '-o', OUT / 'mame-pacman.js'])
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
