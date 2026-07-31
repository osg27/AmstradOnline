import { sha1 } from '../localLibrary/core/hash';

export const KICKSTART_CATALOGUE = [
  { id: 'kickstart-1.3-a500', model: 'A500', version: '1.3 (34.5)', sha1: '891e9a547772fe0c6c19b610baf8bc4ea7fcb785', puaeFilename: 'kick34005.A500', description: 'Kickstart 1.3 for A500' },
  { id: 'kickstart-3.1-a1200', model: 'A1200', version: '3.1 (40.68)', sha1: '646773759326fbac3b2311fd8c8793eea8a28e87', puaeFilename: 'kick40068.A1200', description: 'Kickstart 3.1 for A1200/AGA' },
];

export async function identifyKickstart(file, catalogue = KICKSTART_CATALOGUE) {
  const checksum = await sha1(file);
  return { file, checksum, kickstart: catalogue.find((item) => item.sha1 === checksum) || null };
}

export function resolveKickstart(requiredId, detected) {
  const match = detected.find((item) => item.kickstart?.id === requiredId);
  return match ? { status: 'available', ...match } : { status: 'missing', requiredId };
}
