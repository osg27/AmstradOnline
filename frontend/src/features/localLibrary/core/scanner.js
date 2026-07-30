import { sha256 } from './hash';
import { normaliseFilename } from './normalise';
import { detectPlatform, isSupportedExtension } from './platform';

export async function scanFiles(inputFiles, options = {}) {
  const platform = options.platform || 'amiga';
  const candidates = Array.from(inputFiles).filter((file) => (
    isSupportedExtension(file.name.split('.').pop() || '', platform)
  ));
  const scanned = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const file = candidates[index];
    options.onProgress?.(index, candidates.length, file.name);
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const parsed = normaliseFilename(file.name);
    let hash;
    if (options.hashFiles) hash = await sha256(file);
    scanned.push({
      id: `${platform}:${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`,
      file,
      name: file.name,
      path: file.webkitRelativePath || file.name,
      extension,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      sha256: hash,
      platform: detectPlatform(extension, platform),
      ...parsed,
    });
    if (index % 25 === 24) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  options.onProgress?.(candidates.length, candidates.length, 'Complete');
  return scanned;
}

