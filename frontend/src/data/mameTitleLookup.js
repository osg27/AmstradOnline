import mame2003PlusTitles from './mame2003PlusTitles';
import mameTitleOverrides from './mameTitleOverrides';

const mergedMameTitles = {
  ...mame2003PlusTitles,
  ...mameTitleOverrides,
};

export function getMameTitleDatabase() {
  return mergedMameTitles;
}

export function getMameTitleMetadata(romKey) {
  return mergedMameTitles[String(romKey || '').toLowerCase()] || null;
}
