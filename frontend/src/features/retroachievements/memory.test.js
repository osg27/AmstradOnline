import { describe, expect, it } from 'vitest';
import { readMegaDriveMemory } from './memory';

function core(save = 0x11000) {
  return { HEAPU8: new Uint8Array(0x21000), _ra_get_work_ram: () => 0x1000, _ra_get_save_ram: () => save };
}

describe('Mega Drive achievement memory', () => {
  it('reads byte-swapped 68000 RAM in CPU order, including multi-byte operands', () => {
    const module = core();
    module.HEAPU8.set([0x34, 0x12, 0x78, 0x56], 0x1000);
    expect([...readMegaDriveMemory(module, 0, 4)]).toEqual([0x12, 0x34, 0x56, 0x78]);
    expect([...readMegaDriveMemory(module, 1, 2)]).toEqual([0x34, 0x56]);
  });
  it('crosses from RAM to unswapped cartridge SRAM', () => {
    const module = core();
    module.HEAPU8[0x1000 + 0xfffe] = 7;
    module.HEAPU8.set([8, 9], 0x11000);
    expect([...readMegaDriveMemory(module, 0xffff, 3)]).toEqual([7, 8, 9]);
  });
  it('reports unmapped SRAM and out-of-range reads as unavailable', () => {
    const module = core(0);
    expect(readMegaDriveMemory(module, 0x10000, 1)).toBeNull();
    expect(readMegaDriveMemory(module, 0xffff, 2)).toHaveLength(1);
    for (const [address, length] of [[-1, 1], [0x1ffff, 2], [0, 0], [0.5, 1]]) {
      expect(readMegaDriveMemory(module, address, length)).toBeNull();
    }
  });
});
