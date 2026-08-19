#!/usr/bin/env node

import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const sourceRoot = valueAfter('--source');
const outputRoot = valueAfter('--output');
const cataloguePath = valueAfter('--catalogue');
if (!sourceRoot || !outputRoot || !cataloguePath) {
  console.error('Usage: node scripts/import-amiga-boxart.mjs --source <folder> --output <folder> --catalogue <openretro-games.json>');
  process.exit(2);
}

function slug(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'unknown';
}

function cleanArtworkTitle(fileName) {
  return path.basename(fileName, path.extname(fileName))
    .replace(/\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?=-\d+$)/iu, '')
    .replace(/-\d{2}$/u, '')
    .replace(/\s*[([]\s*(?:AGA|CD32)\s*[)\]]/giu, '')
    .replaceAll('_', ' ')
    .replace(/\s+/gu, ' ').trim();
}

function matchKey(value) {
  return slug(value).replace(/^(?:the)-/u, '').replace(/-the$/u, '');
}

const sourceFiles = (await readdir(path.resolve(sourceRoot), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/iu.test(entry.name));
const catalogue = JSON.parse(await readFile(path.resolve(cataloguePath), 'utf8'));
const catalogueKeys = new Set();
for (const game of catalogue.games || []) {
  for (const title of [game.title, game.metadata?.game_name, game.metadata?.game_name_alt]) {
    if (title) catalogueKeys.add(matchKey(title));
  }
}

const targetDir = path.join(path.resolve(outputRoot), 'boxart', 'amiga', 'by-title');
const reportDir = path.join(path.resolve(outputRoot), 'reports', 'amiga-boxart');
await mkdir(targetDir, { recursive: true });
await mkdir(reportDir, { recursive: true });
const matched = [];
const unmatched = [];
const collisions = [];
const used = new Map();

for (const entry of sourceFiles) {
  const title = cleanArtworkTitle(entry.name);
  const key = slug(title);
  const destinationName = `${key}${path.extname(entry.name).toLowerCase().replace('.jpeg', '.jpg')}`;
  if (used.has(destinationName)) {
    collisions.push(`${entry.name},${used.get(destinationName)},${destinationName}`);
    continue;
  }
  used.set(destinationName, entry.name);
  await copyFile(path.join(path.resolve(sourceRoot), entry.name), path.join(targetDir, destinationName));
  const row = `${entry.name},${title},${destinationName}`;
  (catalogueKeys.has(matchKey(title)) ? matched : unmatched).push(row);
}

await writeFile(path.join(reportDir, 'matched.csv'), `source,title,destination\n${matched.join('\n')}\n`);
await writeFile(path.join(reportDir, 'unmatched.csv'), `source,title,destination\n${unmatched.join('\n')}\n`);
await writeFile(path.join(reportDir, 'collisions.csv'), `source,existing,destination\n${collisions.join('\n')}\n`);
console.log(`Imported ${used.size} images: ${matched.length} catalogue matches, ${unmatched.length} unmatched, ${collisions.length} collisions.`);
