// RetroAchievements console 1: 64 KB system RAM, then 64 KB cartridge RAM.
// Existing Genesis sets use raw Genesis Plus GX memory (word-swizzled on
// little-endian hosts), NOT 68000 CPU bus byte order. Do not XOR addresses.
// https://github.com/RetroAchievements/rcheevos/issues/302
export function readMegaDriveMemory(core, address, length) {
  if (!core || !Number.isInteger(address) || !Number.isInteger(length) || address < 0 || length < 1 || address + length > 0x20000) return null;
  const ram = core._ra_get_work_ram?.() || 0;
  const save = core._ra_get_save_ram?.() || 0;
  if (!ram) return null;
  const result = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    const offset = address + index;
    if (offset < 0x10000) result[index] = core.HEAPU8[ram + offset];
    else if (save) result[index] = core.HEAPU8[save + offset - 0x10000];
    else return index ? result.subarray(0, index) : null;
  }
  return result;
}

// Caprice32 exposes physical RAM, without CPU bank mapping or ROM overlays.
// CPCBox's pv.aM has that same linear layout; pv.T is only the CPU bank view.
export function readCpcMemory(cpc, address, length) {
  const ram = cpc?.pv?.aM;
  const size = cpc?.oU?.p ? 0x90000 : [2, 4].includes(cpc?.qG) ? 0x20000 : 0x10000;
  if (!ram || ram.length < size || !Number.isInteger(address) || !Number.isInteger(length)
    || address < 0 || length < 1 || address >= size) return null;
  const available = Math.min(length, size - address);
  return Uint8Array.from(ram.slice(address, address + available));
}
