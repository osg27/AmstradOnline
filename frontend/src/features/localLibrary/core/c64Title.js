const RELEASE_WORDS = /\b(?:original|fast\s*loader|loader|preview|trainer|trained|crack(?:ed)?|fixed?|docs?|manual|solution|walkthrough|remix|highscore|hiscore)\b.*$/i;
const MEDIA_SUFFIX = /\b(?:side|disk|disc|part)\s*[-_. ]*(?:\d+|[ab])(?:\s*(?:of|\/)\s*\d+)?\b.*$/i;
const SCENE_SUFFIX = /\s+(?:[+]\s*\d+[a-z]*|[-]\s*[a-z0-9]{2,})\b.*$/i;

export function c64CanonicalTitle(fileName) {
  const stem = String(fileName || '').replace(/\.[^.]+$/, '');
  const withoutTags = stem
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .trim();
  const dotParts = withoutTags.split(/\.+/).map((part) => part.trim()).filter(Boolean);
  const likelySceneTitle = dotParts.length > 1 && dotParts[0].replace(/[^a-z0-9]/gi, '').length > 1
    ? dotParts[0]
    : withoutTags;

  return likelySceneTitle
    .replace(/[_]+/g, ' ')
    .replace(MEDIA_SUFFIX, ' ')
    .replace(RELEASE_WORDS, ' ')
    .replace(/\bv(?:er(?:sion)?)?\s*[-_. ]*\d+\b.*$/i, ' ')
    .replace(SCENE_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
