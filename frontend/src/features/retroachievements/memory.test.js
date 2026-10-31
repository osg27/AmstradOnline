import { describe, expect, it } from 'vitest';
import { readMegaDriveMemory, readMasterSystemMemory, readCpcMemory, readSnesMemory } from './memory';
import { attachSnesFrames } from './snesFrameBridge';

function core(save = 0x11000) {
  return { HEAPU8: new Uint8Array(0x21000), _ra_get_work_ram: () => 0x1000, _ra_get_save_ram: () => save };
}

describe('SNES achievement memory', () => {
  function snes(saveSize = 0x2000) {
    return { HEAPU8: new Uint8Array(0x51000),
      _ra_memory_data: id => id === 2 ? 0x1000 : id === 0 ? 0x21000 : 0,
      _ra_memory_size: id => id === 2 ? 0x20000 : id === 0 ? saveSize : 0 };
  }
  it('reads little-endian WRAM and cartridge SRAM across the boundary', () => {
    const module = snes();
    module.HEAPU8.set([0x34, 0x12], 0x1000);
    module.HEAPU8[0x20fff] = 7;
    module.HEAPU8.set([8, 9], 0x21000);
    expect([...readSnesMemory(module, 0, 2)]).toEqual([0x34, 0x12]);
    expect([...readSnesMemory(module, 0x1ffff, 3)]).toEqual([7, 8, 9]);
    expect([...readSnesMemory(module, 0x20000, 2)]).toEqual([8, 9]);
  });
  it('fails closed for absent SRAM, extra SA-1 I-RAM and invalid heap bounds', () => {
    expect(readSnesMemory(snes(0), 0x20000, 1)).toBeNull();
    expect(readSnesMemory(snes(0), 0x1ffff, 2)).toHaveLength(1);
    expect(readSnesMemory(snes(), 0x22000, 1)).toBeNull();
    expect(readSnesMemory(snes(), 0x21fff, 2)).toHaveLength(1);
    for (const [address, length] of [[-1, 1], [0xa0000, 1], [0, 0], [0.5, 1], [0, 1.5]]) {
      expect(readSnesMemory(snes(), address, length)).toBeNull();
    }
    const invalid = snes(); invalid._ra_memory_data = () => 0x50000;
    expect(readSnesMemory(invalid, 0, 1)).toBeNull();
    expect(readSnesMemory({}, 0, 1)).toBeNull();
  });
  it('checks only advancing native frames and does not replay paused frames', () => {
    let counter = 0, checks = 0, paused = false;
    const module = { ...snes(), _get_current_frame_count: () => counter };
    expect(attachSnesFrames(module, { frame: () => checks++ }, () => paused)).toBe(true);
    module.osgRAFrame(); expect(checks).toBe(0);
    counter++; module.osgRAFrame(); expect(checks).toBe(1);
    module.osgRAFrame(); expect(checks).toBe(1);
    paused = true; counter++; module.osgRAFrame(); expect(checks).toBe(1);
    paused = false; module.osgRAFrame(); expect(checks).toBe(1);
    counter++; module.osgRAFrame(); expect(checks).toBe(2);
    expect(attachSnesFrames({}, null, () => false)).toBe(false);
  });
});

describe('Mega Drive achievement memory', () => {
  it('preserves the raw Genesis Plus GX layout expected by existing achievement sets', () => {
    const module = core();
    module.HEAPU8.set([0x34, 0x12, 0x78, 0x56], 0x1000);
    expect([...readMegaDriveMemory(module, 0, 4)]).toEqual([0x34, 0x12, 0x78, 0x56]);
    expect([...readMegaDriveMemory(module, 1, 2)]).toEqual([0x12, 0x78]);
  });
  it('crosses from RAM to unswapped cartridge SRAM', () => {
    const module = core();
    module.HEAPU8[0x1000 + 0xffff] = 7;
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


describe('CPC achievement memory', () => {
  const cpc = (model = 2, expansion = false) => ({ pv: { aM: Array(0x90000).fill(0), T: [0x10000, 0x14000, 0x18000, 0x1c000] }, qG: model, oU: { p: expansion } });
  it('reads physical RAM without following CPU bank switching or ROM overlays', () => {
    const machine = cpc();
    machine.pv.aM[0x20] = 12; machine.pv.aM[0x10020] = 34;
    expect([...readCpcMemory(machine, 0x20, 1)]).toEqual([12]);
    expect([...readCpcMemory(machine, 0x10020, 1)]).toEqual([34]);
  });
  it('reads byte and word boundaries across the base and extended RAM', () => {
    const machine = cpc();
    machine.pv.aM[0xffff] = 0x34; machine.pv.aM[0x10000] = 0x12;
    expect([...readCpcMemory(machine, 0xffff, 2)]).toEqual([0x34, 0x12]);
  });
  it('does not expose uninstalled memory as fake zeroes', () => {
    expect(readCpcMemory(cpc(0), 0x10000, 1)).toBeNull();
    expect(readCpcMemory(cpc(), 0x20000, 1)).toBeNull();
    expect(readCpcMemory(cpc(), 0x1ffff, 2)).toHaveLength(1);
    expect(readCpcMemory(cpc(2, true), 0x8ffff, 1)).toHaveLength(1);
    expect(readCpcMemory(cpc(2, true), 0x90000, 1)).toBeNull();
    expect(readCpcMemory(cpc(), -1, 1)).toBeNull();
  });
});


describe('Master System achievement memory', () => {
  it('reads the 8 KB Z80 RAM without swapping bytes or duplicating CPU mirrors', () => {
    const module = core(); module.HEAPU8.set([0x34, 0x12], 0x1000);
    expect([...readMasterSystemMemory(module, 0, 2)]).toEqual([0x34, 0x12]);
    module.HEAPU8[0x1000 + 0x2000] = 99;
    module.HEAPU8[0x11000] = 7;
    expect([...readMasterSystemMemory(module, 0x2000, 1)]).toEqual([7]);
    expect(readMasterSystemMemory(module, 0xc000, 1)).toBeNull();
  });
  it('maps cartridge RAM after system RAM and handles the boundary', () => {
    const module = core(); module.HEAPU8[0x1000 + 0x1fff] = 4;
    module.HEAPU8.set([5, 6], 0x11000);
    expect([...readMasterSystemMemory(module, 0x1fff, 3)]).toEqual([4, 5, 6]);
    module.HEAPU8[0x11000 + 0x7fff] = 8;
    expect([...readMasterSystemMemory(module, 0x9fff, 1)]).toEqual([8]);
    expect(readMasterSystemMemory(module, 0x9fff, 2)).toBeNull();
  });
  it('reports unavailable RAM instead of providing fake values', () => {
    expect(readMasterSystemMemory(core(0), 0x2000, 1)).toBeNull();
    expect(readMasterSystemMemory(core(0), 0x1fff, 2)).toHaveLength(1);
    const module = core(); module._ra_get_work_ram = () => 0;
    expect(readMasterSystemMemory(module, 0, 1)).toBeNull();
  });
});
