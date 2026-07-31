import { describe, expect, it } from 'vitest';
import { c64CanonicalTitle } from './c64Title';

describe('C64 scene title canonicalization', () => {
  it.each([
    ['1942.D64', '1942'],
    ['1942.Elite.+2-BAM.zip', '1942'],
    ['1942.Elite.+7hpd-REM.zip', '1942'],
    ['1942_v1.Capcom.+2-MHI.zip', '1942'],
    ['10th_Frame.Access.d-REM.zip', '10th Frame'],
    ['Zaxxon.Synsoft.zip', 'Zaxxon'],
    ['Zork_2_fastloader.Infocom.zip', 'Zork 2'],
    ['Yie_Ar_Kung_Fu_2.Imagine.p-DD.zip', 'Yie Ar Kung Fu 2'],
    ['Zak McKracken (Disk2).d64', 'Zak McKracken'],
    ['B.C. Bill.crt', 'B.C. Bill'],
  ])('maps %s to %s', (fileName, expected) => {
    expect(c64CanonicalTitle(fileName)).toBe(expected);
  });
});
