#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [openRetroPath, catverPath, outputPath] = process.argv.slice(2);
if (!openRetroPath || !catverPath || !outputPath) {
  console.error('Usage: node scripts/generate-genre-index.mjs <openretro-games.json> <catver.ini> <output.json>');
  process.exit(2);
}

const GENRES = [
  ['Beat em up', ['beatemup', 'brawler', 'wrestling']],
  ['Fighting', ['fighter', 'fighting', 'karate', 'boxing', 'versus']],
  ['Platform', ['platform', 'jumper', 'stomp']],
  ['Shoot em up', ['shootemup', 'shmup']],
  ['Shooter', ['shooter', 'gun', 'crosshair', 'lightgun', 'defender', 'asteroids']],
  ['Racing', ['racing', 'driving', 'car', 'motorcycle', 'motorcyle']],
  ['Sports', ['sports', 'football', 'soccer', 'tennis', 'golf', 'cricket', 'baseball', 'basketball', 'athletics', 'olympics']],
  ['RPG', ['rpg', 'roleplaying', 'dungeoncrawler']],
  ['Strategy', ['strategy', 'wargame', 'turnbased', 'manager']],
  ['Adventure', ['adventure', 'actionadventure', 'graphicadventure', 'textadventure']],
  ['Puzzle', ['puzzle', 'logic', 'fallingblocks', 'tilearrangement', 'batandball']],
  ['Simulation', ['simulation', 'flightsimulator', 'simulation']],
  ['Maze', ['maze', 'pacman', 'labyrinth']],
  ['Board and Card', ['board', 'cards', 'chess', 'casino', 'mahjong', 'quiz']],
  ['Rhythm', ['rhythm', 'music', 'dance']],
  ['Educational', ['educational', 'alphabet']],
];

function normalized(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/\s*[\[(](?:aga|cd32|amiga|whdload|tosec|adf).*?[\])]/giu, ' ')
    .replace(/\s*\([^)]*(?:europe|usa|us|japan|world|rev|set|disk|disc)[^)]*\)/giu, ' ')
    .replace(/^the\s+/iu, '')
    .replace(/\bthe$/iu, '')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function genresFromWords(words) {
  const values = new Set(String(words || '').toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean));
  const compact = String(words || '').toLowerCase().replace(/[^a-z0-9]+/gu, '');
  const matches = GENRES
    .filter(([, aliases]) => aliases.some((alias) => values.has(alias) || compact.includes(alias)))
    .map(([genre]) => genre);
  return [...new Set(matches)].slice(0, 3);
}

function genresFromCatver(category) {
  const primary = String(category || '').split('/')[0].replace(/\*.*?\*/gu, '').trim().toLowerCase();
  const aliases = {
    driving: 'Racing', fighter: 'Fighting', maze: 'Maze', multigame: 'Compilation',
    pinball: 'Pinball', platform: 'Platform', puzzle: 'Puzzle', quiz: 'Board and Card',
    rhythm: 'Rhythm', shooter: 'Shooter', sports: 'Sports', tabletop: 'Board and Card',
  };
  return aliases[primary] ? [aliases[primary]] : genresFromWords(category);
}

const openRetro = JSON.parse(await readFile(path.resolve(openRetroPath), 'utf8'));
const titleGenres = {};
for (const game of openRetro.games || []) {
  const genres = genresFromWords(game.metadata?.tags);
  if (!genres.length) continue;
  for (const title of [game.title, game.metadata?.game_name, game.metadata?.game_name_alt]) {
    const key = normalized(title);
    if (key && !titleGenres[key]) titleGenres[key] = genres;
  }
}

const catver = await readFile(path.resolve(catverPath), 'utf8');
const mameGenres = {};
let inCategory = false;
for (const line of catver.split(/\r?\n/u)) {
  if (line.trim() === '[Category]') { inCategory = true; continue; }
  if (inCategory && /^\[/u.test(line)) break;
  if (!inCategory || !line.includes('=')) continue;
  const [rom, ...categoryParts] = line.split('=');
  const genres = genresFromCatver(categoryParts.join('='));
  if (rom.trim() && genres.length) mameGenres[rom.trim().toLowerCase()] = genres;
}

await writeFile(path.resolve(outputPath), `${JSON.stringify({ version: 1, titles: titleGenres, mame: mameGenres })}\n`);
console.log(`Wrote ${Object.keys(titleGenres).length} title and ${Object.keys(mameGenres).length} MAME genre entries.`);
