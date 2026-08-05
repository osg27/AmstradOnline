import fs from 'node:fs';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/generate-nes-vip-catalog.mjs <archive-listing.html> <catalog.json>');
}

const decodeHtml = (value) => value
  .replaceAll('&amp;', '&')
  .replaceAll('&#039;', "'")
  .replaceAll('&quot;', '"')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

const html = fs.readFileSync(inputPath, 'utf8');
const games = [];
const rowPattern = /<tr><td><a href="[^"]+">([^<]+\.nes)<\/a><td><td>[^<]*<td id="size">(\d+)<\/tr>/gi;
for (const match of html.matchAll(rowPattern)) {
  const memberPath = decodeHtml(match[1]);
  games.push({
    member_path: memberPath,
    file_name: memberPath.split('/').at(-1),
    bytes: Number(match[2]),
  });
}
games.sort((left, right) => left.member_path.localeCompare(right.member_path));
if (!games.length) throw new Error('No NES members found in archive listing');
fs.writeFileSync(outputPath, `${JSON.stringify(games, null, 2)}\n`);
console.log(`Wrote ${games.length} NES catalogue entries`);
