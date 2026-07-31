import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { resolveAmigaConfiguration, translateToPuae } from './configuration';
import { identifyKickstart, resolveKickstart } from './kickstarts';
import { createAmigaLaunchManifest } from './manifest';
import { decodeHashMatches, groupIdentifiedMedia, inspectAmigaFile } from './openretro';
import { canonicalAmigaPlatform, selectAmigaRuntime } from './runtime';

describe('Amiga OpenRetro identification', () => {
  it('decodes compact SHA-1 matches and preserves multi-disk order', () => {
    const matches = decodeHashMatches('b'.repeat(40), [['release', 'parent', 'Disk 2.adf', 2]]);
    const grouped = groupIdentifiedMedia([
      { name: 'two.adf', sha1: 'b'.repeat(40) }, { name: 'one.adf', sha1: 'a'.repeat(40) },
    ], [...matches, ...decodeHashMatches('a'.repeat(40), [['release', 'parent', 'Disk 1.adf', 1]])]);
    expect(grouped[0].media.map((item) => item.diskNumber)).toEqual([1, 2]);
  });

  it('hashes the media inside a ZIP rather than the archive', async () => {
    const zipped = zipSync({ 'Game.adf': new Uint8Array([1, 2, 3]), 'readme.txt': new Uint8Array([4]) });
    const results = await inspectAmigaFile(new File([zipped], 'game.zip'));
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Game.adf');
    expect(results[0].sha1).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('Amiga configuration', () => {
  it('inherits parent values and gives release then manual override precedence', () => {
    const config = resolveAmigaConfiguration({
      parent: { amiga_model: 'A500', video_standard: 'NTSC' },
      release: { chipset: 'AGA', video_standard: 'PAL' },
      override: { fastMemoryMb: 8 },
    });
    expect(config).toMatchObject({ model: 'A1200', chipset: 'AGA', videoStandard: 'PAL', fastMemoryMb: 8, kickstartId: 'kickstart-3.1-a1200' });
  });

  it('selects PUAE for both A500 and A1200 without using disk count', () => {
    expect(selectAmigaRuntime({ model: 'A500' }).engine).toBe('puae');
    expect(selectAmigaRuntime({ model: 'A1200' }).engine).toBe('puae');
    expect(canonicalAmigaPlatform('amiga_aga')).toBe('amiga');
  });

  it('translates supported PUAE options and reports unsupported source values', () => {
    const config = resolveAmigaConfiguration({ release: { amiga_model: 'A1200', cpu: '68020' } });
    const result = translateToPuae(config);
    expect(result.options.puae_model).toBe('A1200');
    expect(result.unsupported).toContain('cpu');
  });
});

describe('Kickstart and manifest', () => {
  it('matches a Kickstart by SHA-1 and reports missing requirements', async () => {
    const file = new File([new Uint8Array([9, 8, 7])], 'anything.bin');
    const cryptoHash = await crypto.subtle.digest('SHA-1', await file.arrayBuffer());
    const checksum = [...new Uint8Array(cryptoHash)].map((value) => value.toString(16).padStart(2, '0')).join('');
    const result = await identifyKickstart(file, [{ id: 'fake', sha1: checksum }]);
    expect(result.kickstart.id).toBe('fake');
    expect(resolveKickstart('other', [result]).status).toBe('missing');
  });

  it('creates a local-data-free ordered multiplayer launch manifest', () => {
    const config = resolveAmigaConfiguration();
    const manifest = createAmigaLaunchManifest({ gameId: 'g', releaseId: 'r', media: [{ sha1: 'b', diskNumber: 2 }, { sha1: 'a', diskNumber: 1 }], config, kickstart: { sha1: 'k' } });
    expect(manifest.media.map((item) => item.diskNumber)).toEqual([1, 2]);
    expect(JSON.stringify(manifest)).not.toMatch(/path|handle|bytes/i);
  });
});
