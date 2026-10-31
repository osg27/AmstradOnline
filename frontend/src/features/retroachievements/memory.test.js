import { describe, expect, it } from 'vitest';
import { readMegaDriveMemory, readMasterSystemMemory, readCpcMemory, readSnesMemory, readNesMemory } from './memory';
import { attachSnesFrames } from './snesFrameBridge';

function core(save = 0x11000) {
  return { HEAPU8: new Uint8Array(0x21000), _ra_get_work_ram: () => 0x1000, _ra_get_save_ram: () => save };
}

describe('NES achievement memory', () => {
  function nes() {
    const module = { HEAPU8: new Uint8Array(0x50000), _ra_memory_data: () => 0x1000,
      _ra_memory_size: () => 0x800, _ra_nes_pages: () => 0x4000, _ra_nes_unmapped: () => 0x5000 };
    const view = new DataView(module.HEAPU8.buffer);
    for (let page = 0; page < 32; page++) view.setUint32(0x4000 + page * 4, (0x5000 - page * 0x800) >>> 0, true);
    return { module, map: (address, pointer) => view.setUint32(0x4000 + (address >>> 11) * 4, (pointer - address) >>> 0, true) };
  }
  it('maps all four internal RAM mirrors and wraps at each 2 KB boundary', () => {
    const { module } = nes();
    module.HEAPU8[0x1000] = 3; module.HEAPU8[0x17ff] = 7;
    for (const address of [0, 0x800, 0x1000, 0x1800]) expect([...readNesMemory(module, address, 1)]).toEqual([3]);
    expect([...readNesMemory(module, 0x7ff, 2)]).toEqual([7, 3]);
  });
  it('follows current cartridge RAM and ROM banks instead of a stale SRAM copy', () => {
    const { module, map } = nes();
    map(0x6000, 0x10000); map(0x7800, 0x11800); map(0x8000, 0x20000);
    module.HEAPU8[0x10000] = 1; module.HEAPU8[0x11fff] = 2;
    module.HEAPU8[0x20000] = 9; module.HEAPU8[0x30000] = 10;
    expect([...readNesMemory(module, 0x6000, 1)]).toEqual([1]);
    expect([...readNesMemory(module, 0x7fff, 2)]).toEqual([2, 9]);
    map(0x8000, 0x30000);
    expect([...readNesMemory(module, 0x8000, 1)]).toEqual([10]);
  });
  it('rejects hardware registers, unmapped sentinel pages and invalid pointers', () => {
    const { module, map } = nes();
    for (const [address, length] of [[0x2000, 1], [0x4016, 1], [0x4020, 1], [0x6000, 1], [-1, 1], [0xffff, 2], [0, 0], [0.5, 1]]) {
      expect(readNesMemory(module, address, length)).toBeNull();
    }
    expect(readNesMemory(module, 0x1fff, 2)).toHaveLength(1);
    map(0x6000, 0x60000); expect(readNesMemory(module, 0x6000, 1)).toBeNull();
    expect(readNesMemory({}, 0, 1)).toBeNull();
  });
});

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
