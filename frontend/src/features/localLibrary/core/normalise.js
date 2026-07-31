const MEDIA_ROLE = /^(?:disk|disc)\s*\d+|^(?:install|program|play|player|portrait|data\s*\d*|games?\s*disc|dungeon.*|populace|underworld)$/i;
const MACHINE = /^(?:AGA|OCS|ECS|CD32)$/i;

function titleCase(value) {
  return value.split(/\s+/).filter(Boolean).map((word) => {
    if (/^(UFO|II|III|IV|VI|VII|VIII|IX)$/i.test(word)) return word.toUpperCase();
    return `${word[0]?.toUpperCase() || ''}${word.slice(1)}`;
  }).join(' ');
}

function diskDetails(value) {
  const match = value.match(/\b(?:disk|disc)\s*(\d+)(?:\s*(?:of|\/|-)\s*(\d+))?\b/i);
  if (match) return { diskNumber: Number(match[1]), diskCount: match[2] ? Number(match[2]) : undefined };
  return {};
}

function classifyTags(tags) {
  const text = tags.join(' ').toLowerCase();
  const crack = tags.find((tag) => /^cr(?:\s|$)/i.test(tag));
  const crackGroup = crack?.replace(/^cr\s*/i, '').trim() || undefined;
  return {
    crackGroup,
    isCracked: Boolean(crack),
    isAlternate: tags.some((tag) => /^a\d*(?:\s|$)/i.test(tag)),
    isTrainer: /\b(?:t\s*\+\d+|trainer)\b/i.test(text),
    isHack: tags.some((tag) => /^h(?:\s|$)/i.test(tag) || /\bhack\b/i.test(tag)),
    isFix: tags.some((tag) => /^f(?:\s|$)/i.test(tag) || /\bfix\b/i.test(tag)),
    isBad: tags.some((tag) => /^b(?:\s|$)/i.test(tag) || /\bbad dump\b|\bcorrupt\b/i.test(tag)),
    isVirus: tags.some((tag) => /^v(?:\s|$)/i.test(tag) || /\bvirus\b/i.test(tag)),
    isInstalled: /\b(?:FD-HD|FD installed|installed|hard[- ]?drive|HD)\b/i.test(text),
  };
}

export function normaliseFilename(filename) {
  const stem = filename.replace(/\.[^.]+$/, '');
  const squareTags = [...stem.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim()).filter(Boolean);
  const parenthetical = [...stem.matchAll(/\(([^)]+)\)/g)].map((match) => match[1].trim()).filter(Boolean);
  const details = diskDetails(stem);
  const metadataStart = stem.search(/\s*[\[(]/);
  let rawTitle = metadataStart > 0 ? stem.slice(0, metadataStart) : stem;
  const titleHasCd32 = /\bCD32\b/i.test(rawTitle);
  const filenameMachines = [...rawTitle.matchAll(/(?:^|[_+\s-])(AGA|OCS|ECS|CD32)(?=$|[_+\s-])/gi)]
    .map((match) => match[1].toUpperCase());
  rawTitle = rawTitle.replace(/(?:^|[_+\s-])(?:AGA|OCS|ECS|CD32)(?=$|[_+\s-])/gi, ' ');
  const versionMatch = rawTitle.match(/(?:^|[_+\s-])v\s*([0-9]+(?:\.[0-9]+)+)(?=$|[_+\s-])/i);
  if (versionMatch) rawTitle = rawTitle.replace(versionMatch[0], ' ');
  rawTitle = rawTitle
    .replace(/\b(?:disk|disc)\s*\d+(?:\s*(?:of|\/|-)\s*\d+)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const yearIndex = parenthetical.findIndex((tag) => /^\d{4}(?:-\d{2}-\d{2})?$/.test(tag));
  const diskIndex = parenthetical.findIndex((tag) => /^(?:disk|disc)\s*\d+/i.test(tag));
  const diskRole = diskIndex >= 0 && MEDIA_ROLE.test(parenthetical[diskIndex + 1] || '')
    ? parenthetical[diskIndex + 1]
    : parenthetical.find((tag) => MEDIA_ROLE.test(tag) && !/^(?:disk|disc)/i.test(tag));
  const machine = parenthetical.filter((tag) => MACHINE.test(tag)).map((tag) => tag.toUpperCase());
  if (titleHasCd32 && !machine.includes('CD32')) machine.push('CD32');
  filenameMachines.forEach((model) => {
    if (!machine.includes(model)) machine.push(model);
  });

  const knownIndexes = new Set([yearIndex, yearIndex + 1, diskIndex]);
  if (diskRole && parenthetical[diskIndex + 1] === diskRole) knownIndexes.add(diskIndex + 1);
  const qualifiers = parenthetical.filter((tag, index) => (
    !knownIndexes.has(index) && !MACHINE.test(tag) && !MEDIA_ROLE.test(tag)
  ));
  const lower = stem.toLowerCase();

  return {
    cleanedTitle: titleCase(rawTitle.replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim() || stem),
    version: versionMatch?.[1],
    year: yearIndex >= 0 ? parenthetical[yearIndex] : undefined,
    publisher: yearIndex >= 0 ? parenthetical[yearIndex + 1] : undefined,
    region: qualifiers.find((tag) => /^(?:US|USA|EU|Europe|UK|DE|FR|JP|Japan|World)$/i.test(tag)),
    language: qualifiers.find((tag) => /^M\d+$/i.test(tag)),
    machine,
    qualifiers,
    diskRole,
    ...details,
    tags: squareTags,
    unknownTags: [...qualifiers, ...squareTags],
    isDemo: /\bdemo(?:-|\s|\))/i.test(lower),
    isBeta: /\bbeta\b/i.test(lower),
    ...classifyTags(squareTags),
  };
}
