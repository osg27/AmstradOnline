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

// Console 11: 8 KB Z80 system RAM, then 32 KB linear cartridge RAM.
// The CPU's C000/E000 mirrors are not duplicated in the achievement address space.
export function readMasterSystemMemory(core, address, length) {
  if (!core || !Number.isInteger(address) || !Number.isInteger(length)
    || address < 0 || length < 1 || address + length > 0xa000) return null;
  const ram = core._ra_get_work_ram?.() || 0;
  const save = core._ra_get_save_ram?.() || 0;
  if (!ram) return null;
  const result = new Uint8Array(length);
  for (let index = 0; index < length; index++) {
    const offset = address + index;
    if (offset < 0x2000) result[index] = core.HEAPU8[ram + offset];
    else if (save) result[index] = core.HEAPU8[save + offset - 0x2000];
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

// SNES: 128 KB WRAM, followed by the cartridge's exposed SRAM/BW-RAM.
// Both are linear native byte arrays. SA-1 I-RAM is not exposed by this build.
export function readSnesMemory(core, address, length) {
  if (!core?.HEAPU8 || !core._ra_memory_data || !core._ra_memory_size
    || !Number.isInteger(address) || !Number.isInteger(length)
    || address < 0 || length < 1 || address + length > 0xa0000) return null;
  const ram = core._ra_memory_data(2), ramSize = core._ra_memory_size(2);
  if (!ram || ramSize !== 0x20000 || ram + ramSize > core.HEAPU8.length) return null;
  const save = core._ra_memory_data(0), saveSize = core._ra_memory_size(0);
  const result = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const at = address + i;
    if (at < 0x20000) result[i] = core.HEAPU8[ram + at];
    else if (save > 0 && saveSize > 0 && at - 0x20000 < saveSize && save + saveSize <= core.HEAPU8.length) result[i] = core.HEAPU8[save + at - 0x20000];
    else return i ? result.subarray(0, i) : null;
  }
  return result;
}

// NES CPU address space. Mirror the 2 KB RAM, then follow FCEUmm's live Page[]
// pointers for cartridge RAM/ROM. Never invoke hardware read handlers.
export function readNesMemory(core, address, length) {
  const heap = core?.HEAPU8;
  if (!heap || !core._ra_memory_data || !core._ra_memory_size || !core._ra_nes_pages || !core._ra_nes_unmapped
    || !Number.isInteger(address) || !Number.isInteger(length)
    || address < 0 || length < 1 || address + length > 0x10000) return null;
  const ram = core._ra_memory_data(2), size = core._ra_memory_size(2);
  const pages = core._ra_nes_pages(), unmapped = core._ra_nes_unmapped();
  if (!ram || size !== 0x800 || ram + size > heap.length || pages <= 0 || pages + 128 > heap.length
    || unmapped <= 0 || unmapped + 8192 > heap.length) return null;
  const view = new DataView(heap.buffer, heap.byteOffset, heap.byteLength);
  const result = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const at = address + i;
    if (at < 0x2000) { result[i] = heap[ram + (at & 0x7ff)]; continue; }
    if (at >= 0x4020) {
      const base = view.getUint32(pages + (at >>> 11) * 4, true);
      const pointer = (base + at) >>> 0;
      if (base && pointer < heap.length && !(pointer >= unmapped && pointer < unmapped + 8192)) {
        result[i] = heap[pointer]; continue;
      }
    }
    return i ? result.subarray(0, i) : null;
  }
  return result;
}
