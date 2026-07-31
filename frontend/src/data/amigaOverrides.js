// Reviewable exceptions keyed by OpenRetro release UUID, SHA-1, or existing local game ID.
export const AMIGA_OVERRIDES = {};

export function findAmigaOverride(...keys) {
  return keys.map((key) => AMIGA_OVERRIDES[key]).find(Boolean) || null;
}
