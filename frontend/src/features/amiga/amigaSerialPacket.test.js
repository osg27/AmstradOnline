import { describe, expect, it } from 'vitest';
import { decodeAmigaSerialPacket, encodeAmigaSerialPacket } from './amigaSerialPacket';

describe('Amiga Link serial packets', () => {
  it('round-trips 10-bit SERDAT words, keeping the ninth data bit', () => {
    // Stunt Car Racer sends 8 data bits + odd parity in bit 8 + stop bit in bit 9.
    const words = [0x212, 0x356, 0x234, 0x300, 0x240, 0x300, 0x2e3, 0x280, 0x347, 0x1ff];
    expect(decodeAmigaSerialPacket(encodeAmigaSerialPacket(words))).toEqual(words);
  });

  it('masks words to 10 bits', () => {
    expect(decodeAmigaSerialPacket(encodeAmigaSerialPacket([0xffff]))).toEqual([0x3ff]);
  });

  it('treats untagged packets as legacy bytes', () => {
    expect(decodeAmigaSerialPacket(new Uint8Array([0x41]))).toEqual([0x41]);
    expect(decodeAmigaSerialPacket(new Uint8Array([0x02, 0x10]))).toEqual([0x02, 0x10]);
  });
});
