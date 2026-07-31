export function selectAmigaRuntime(configuration = {}) {
  const model = String(configuration.model || '').toUpperCase();
  const chipset = String(configuration.chipset || '').toUpperCase();
  if (model === 'A1200' || chipset === 'AGA') {
    return { roomSystem: 'amiga_aga', engine: 'puae', profile: 'A1200' };
  }
  return { roomSystem: 'amiga', engine: 'puae', profile: model || 'A500' };
}

export function canonicalAmigaPlatform(system) {
  return system === 'amiga_aga' ? 'amiga' : system;
}
