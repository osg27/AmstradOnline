function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function variantKey(file) {
  return [
    file.version || '',
    file.year || '',
    file.publisher?.toLowerCase() || '',
    [...file.machine].sort().join('+'),
    file.language || '',
    file.region || '',
    file.diskCount || 1,
    file.isDemo ? 'demo' : 'retail',
    file.isBeta ? 'beta' : 'final',
    file.isCracked ? `cr-${file.crackGroup || 'unknown'}` : 'original',
    file.isAlternate ? file.tags.find((tag) => /^a\d*/i.test(tag)) : '',
    file.isTrainer ? 'trainer' : '',
    file.isHack ? 'hack' : '',
    file.isFix ? 'fix' : '',
    file.isBad ? 'bad' : '',
    file.isVirus ? 'virus' : '',
    file.isInstalled ? file.tags.find((tag) => /FD|HD|installed/i.test(tag)) || 'installed' : '',
  ].join('::');
}

function compatibilityKey(file) {
  return [
    file.version || '',
    file.year || '',
    file.publisher?.toLowerCase() || '',
    [...file.machine].sort().join('+'),
    file.language || '',
    file.region || '',
    file.diskCount || 1,
    file.isDemo ? 'demo' : 'retail',
    file.isBeta ? 'beta' : 'final',
    file.isInstalled ? file.tags.find((tag) => /FD|HD|installed/i.test(tag)) || 'installed' : '',
  ].join('::');
}

function modifierKey(file) {
  return [
    file.isCracked ? `cr-${file.crackGroup || 'unknown'}` : 'original',
    file.isAlternate ? file.tags.find((tag) => /^a\d*/i.test(tag)) : '',
    file.isTrainer ? 'trainer' : '',
    file.isHack ? 'hack' : '',
    file.isFix ? 'fix' : '',
    file.isBad ? 'bad' : '',
    file.isVirus ? 'virus' : '',
  ].join('::');
}

const CLEAN_MODIFIER_KEY = ['original', '', '', '', '', '', ''].join('::');

function scoreRelease(media, complete, consistentCount) {
  let score = complete ? 100 : -200;
  if (consistentCount) score += 30;
  const markedBad = media.some((file) => file.isBad);
  const markedVirus = media.some((file) => file.isVirus);
  if (!markedBad && !markedVirus) score += 25;
  if (media.every((file) => !file.isCracked && !file.isAlternate && !file.isTrainer && !file.isHack && !file.isFix)) score += 20;
  else if (media.some((file) => file.isCracked) && !markedBad && !markedVirus) score += 10;
  if (media.some((file) => file.isAlternate)) score -= 5;
  if (media.some((file) => file.isTrainer)) score -= 15;
  if (media.some((file) => file.isHack)) score -= 15;
  if (media.some((file) => file.isDemo)) score -= 40;
  if (media.some((file) => file.isBeta)) score -= 30;
  if (markedBad) score -= 100;
  if (markedVirus) score -= 100;
  return score;
}

function releaseLabel(media, expected) {
  const first = media[0];
  const parts = [
    first.isDemo ? 'Demo' : first.isBeta ? 'Beta' : first.year?.slice(0, 4),
    ...first.machine,
    first.language,
    `${expected} disk${expected === 1 ? '' : 's'}`,
    first.isCracked ? first.crackGroup || 'Cracked' : 'Original',
  ];
  if (first.isInstalled) parts.push(first.tags.find((tag) => /FD|HD|installed/i.test(tag)));
  return unique(parts).join(' · ');
}

function makeRelease(files) {
  const expected = Math.max(1, ...files.map((file) => file.diskCount || file.diskNumber || 1));
  const warnings = [];
  const byDisk = new Map();
  files.forEach((file) => {
    const disk = file.diskNumber || 1;
    if (byDisk.has(disk)) warnings.push(`Multiple files claim disk ${disk}.`);
    else byDisk.set(disk, file);
  });
  for (let disk = 1; disk <= expected; disk += 1) {
    if (!byDisk.has(disk)) warnings.push(`Disk ${disk} is missing.`);
  }
  const counts = unique(files.map((file) => file.diskCount));
  if (counts.length > 1) warnings.push('Disk totals conflict.');
  const media = [...byDisk.values()].sort((left, right) => (left.diskNumber || 1) - (right.diskNumber || 1));
  const complete = media.length === expected && !warnings.some((warning) => warning.includes('missing'));
  const signature = variantKey(files[0]);
  return {
    id: `${slug(files[0].cleanedTitle)}-${slug(signature)}`,
    label: releaseLabel(media, expected),
    score: scoreRelease(media, complete, counts.length <= 1),
    isComplete: complete,
    isDefaultCandidate: complete && !media.some((file) => file.isBad || file.isVirus),
    warnings,
    metadata: {
      version: files[0].version,
      year: files[0].year,
      publisher: files[0].publisher,
      region: files[0].region,
      language: files[0].language,
      machine: files[0].machine,
      tags: unique(media.flatMap((file) => file.tags)),
      isDemo: files[0].isDemo,
      isBeta: files[0].isBeta,
    },
    media,
  };
}

export function groupGames(files) {
  const games = new Map();
  files.forEach((file) => {
    const gameKey = `${file.platform}:${file.cleanedTitle.toLowerCase()}`;
    if (!games.has(gameKey)) games.set(gameKey, []);
    games.get(gameKey).push(file);
  });

  return [...games.values()].map((gameFiles) => {
    const families = new Map();
    gameFiles.forEach((file) => {
      const key = compatibilityKey(file);
      if (!families.has(key)) families.set(key, []);
      families.get(key).push(file);
    });
    const releases = [...families.values()].flatMap((family) => {
      const variants = new Map();
      family.forEach((file) => {
        const key = modifierKey(file);
        if (!variants.has(key)) variants.set(key, []);
        variants.get(key).push(file);
      });
      const clean = variants.get(CLEAN_MODIFIER_KEY) || [];
      return [...variants.entries()].map(([key, variantFiles]) => {
        if (key === CLEAN_MODIFIER_KEY) return makeRelease(variantFiles);
        const occupied = new Set(variantFiles.map((file) => file.diskNumber || 1));
        const compatibleShared = clean.filter((file) => !occupied.has(file.diskNumber || 1));
        const release = makeRelease([...variantFiles, ...compatibleShared]);
        if (compatibleShared.length) {
          release.warnings.push('Compatible unmodified data disks were shared with this alternative release.');
        }
        return release;
      });
    })
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
    const defaultRelease = releases.find((release) => release.isDefaultCandidate)
      || releases.find((release) => release.isComplete)
      || releases[0];
    const warnings = [];
    if (!releases.some((release) => release.isComplete)) warnings.push('No complete release is available.');
    if (defaultRelease && !defaultRelease.isDefaultCandidate) warnings.push('The automatic default has quality warnings.');
    return {
      id: `${gameFiles[0].platform}-${slug(gameFiles[0].cleanedTitle)}`,
      title: gameFiles[0].cleanedTitle,
      platform: gameFiles[0].platform,
      defaultReleaseId: defaultRelease?.id || '',
      releases,
      warnings,
    };
  }).sort((left, right) => left.title.localeCompare(right.title));
}

export function findDuplicates(files) {
  const hashes = new Map();
  files.filter((file) => file.sha256).forEach((file) => {
    if (!hashes.has(file.sha256)) hashes.set(file.sha256, []);
    hashes.get(file.sha256).push(file);
  });
  return [...hashes.entries()].filter(([, entries]) => entries.length > 1)
    .map(([hash, entries]) => ({ sha256: hash, canonical: entries[0], duplicates: entries.slice(1) }));
}
