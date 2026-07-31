export const AMIGA_RESOLVER_VERSION = 1;

const DEFAULT = { model: 'A500', chipset: 'OCS', videoStandard: 'PAL', chipMemoryMb: 1, fastMemoryMb: 0, floppyDriveCount: 1, kickstartId: 'kickstart-1.3-a500', port0: 'mouse', port1: 'joystick' };

function normalize(source = {}) {
  const rawModel = String(source.amiga_model || source.model || source.machine || '').toUpperCase();
  const model = rawModel.includes('1200') || String(source.chipset).toUpperCase() === 'AGA' ? 'A1200'
    : rawModel.includes('600') ? 'A600' : rawModel.includes('500+') ? 'A500+' : rawModel.includes('500') ? 'A500' : undefined;
  return {
    ...(model && { model }),
    ...(source.chipset && { chipset: String(source.chipset).toUpperCase() }),
    ...(source.video_standard && { videoStandard: String(source.video_standard).toUpperCase() }),
    ...(source.chip_memory && { chipMemoryMb: Number(source.chip_memory) }),
    ...(source.fast_memory && { fastMemoryMb: Number(source.fast_memory) }),
    ...(source.floppy_drive_count && { floppyDriveCount: Number(source.floppy_drive_count) }),
    ...(source.joystick_port_0_mode && { port0: source.joystick_port_0_mode }),
    ...(source.joystick_port_1_mode && { port1: source.joystick_port_1_mode }),
  };
}

export function resolveAmigaConfiguration({ parent = {}, release = {}, inference = {}, override = {} } = {}) {
  const resolved = { ...DEFAULT, ...normalize(inference), ...normalize(parent), ...normalize(release), ...normalize(override), ...override };
  if (resolved.model === 'A1200' || resolved.chipset === 'AGA') {
    resolved.model = 'A1200'; resolved.chipset = 'AGA';
    resolved.kickstartId = override.kickstartId || 'kickstart-3.1-a1200';
  }
  resolved.sources = { fallback: DEFAULT, inference, parent, release, override };
  resolved.resolverVersion = AMIGA_RESOLVER_VERSION;
  return resolved;
}

export function translateToPuae(config) {
  const supported = {
    puae_model: config.model,
    puae_model_fd: config.model,
    puae_chipset: config.chipset,
    puae_chipmem_size: String(config.chipMemoryMb),
    puae_fastmem_size: String(config.fastMemoryMb),
    puae_floppy_multidrive: config.floppyDriveCount > 1 ? 'enabled' : 'disabled',
    puae_physical_keyboard_pass_through: 'enabled',
  };
  return { options: supported, unsupported: Object.keys(config.sources?.release || {}).filter((key) => !['amiga_model', 'model', 'chipset', 'chip_memory', 'fast_memory', 'floppy_drive_count'].includes(key)) };
}
