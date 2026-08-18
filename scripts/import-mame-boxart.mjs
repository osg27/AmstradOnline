#!/usr/bin/env node

import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mameTitles from '../frontend/src/data/mame2003PlusTitles.js';

const REGION_PRIORITY = [
  'Main', 'World', 'Europe', 'United Kingdom', 'United States', 'North America',
  'Japan', 'Asia', 'France', 'Germany', 'Italy', 'Spain', 'Brazil',
  'China', 'Hong Kong', 'Korea', 'Taiwan', 'Russia',
];

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const sourceRoot = valueAfter('--source');
const outputRoot = valueAfter('--output');
const missingTitlesFile = valueAfter('--missing-titles');
const mameXmlFile = valueAfter('--mame-xml');
const shouldCopy = args.includes('--copy');
const additionalOnly = args.includes('--additional-only');

if (!sourceRoot || !outputRoot) {
  console.error('Usage: node scripts/import-mame-boxart.mjs --source <folder> --output <folder> [--copy]');
  process.exit(2);
}

function csv(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function cleanArtworkTitle(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/-\d{2}$/u, '')
    .replaceAll('_', ' ')
    .trim();
}

function artworkVariant(filename) {
  const match = path.basename(filename, path.extname(filename)).match(/-(\d{2})$/u);
  return match ? Number(match[1]) : 0;
}

function cleanMameTitle(title) {
  return title
    .replace(/\s*\([^)]*\)/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalized(title) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/&/gu, ' and ')
    .replace(/\bthe\b$/iu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function compact(title) {
  return normalized(title).replaceAll(' ', '');
}

function acronymKeys(title) {
  const tokens = normalized(title).split(' ').filter(Boolean);
  const keys = new Set();
  for (let length = 2; length <= tokens.length; length += 1) {
    const key = tokens.slice(0, length).map((token) => token[0]).join('');
    if (key.length >= 3) keys.add(key);
  }
  return keys;
}

function titleAliases(title) {
  const cleaned = cleanMameTitle(title);
  return new Set([
    cleaned,
    ...cleaned.split(/\s+\/\s+/u).map((part) => part.trim()),
  ].filter(Boolean));
}

async function readMameXml(filename) {
  if (!filename) return new Map();
  const xml = await readFile(path.resolve(filename), 'utf8');
  const machines = new Map();
  const pattern = /<(?:machine|game)\s+([^>]*\bname="([^"]+)"[^>]*)>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/(?:machine|game)>/gu;
  for (const match of xml.matchAll(pattern)) {
    const clone = match[1].match(/\bcloneof="([^"]+)"/u)?.[1] ?? '';
    const description = match[3]
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>');
    machines.set(match[2].toLowerCase(), { description, parent: clone.toLowerCase() });
  }
  return machines;
}

async function collectPngs(root) {
  const found = [];
  for (const region of REGION_PRIORITY) {
    const regionDir = region === 'Main' ? root : path.join(root, region);
    let entries = [];
    try {
      entries = await readdir(regionDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.png') {
        found.push({ region, name: entry.name, source: path.join(regionDir, entry.name) });
      }
    }
  }
  return found;
}

const artwork = await collectPngs(path.resolve(sourceRoot));
const artworkByTitle = new Map();
for (const item of artwork) {
  const key = normalized(cleanArtworkTitle(item.name));
  if (!key) continue;
  const choices = artworkByTitle.get(key) ?? [];
  choices.push(item);
  artworkByTitle.set(key, choices);
}

const childrenByParent = new Map();
for (const [rom, metadata] of Object.entries(mameTitles)) {
  const parent = metadata.parent || rom;
  const entries = childrenByParent.get(parent) ?? [];
  entries.push({ rom, title: metadata.title });
  childrenByParent.set(parent, entries);
}

const matches = [];
const ambiguous = [];
const usedSources = new Set();
for (const [parent, variants] of childrenByParent) {
  const parentTitle = mameTitles[parent]?.title ?? variants[0].title;
  const parentKey = normalized(cleanMameTitle(parentTitle));
  const parentCandidates = [...(artworkByTitle.get(parentKey) ?? [])];
  const titleKeys = new Set(variants.map((variant) => normalized(cleanMameTitle(variant.title))));
  const candidates = [];
  for (const key of titleKeys) {
    for (const item of artworkByTitle.get(key) ?? []) candidates.push(item);
  }
  const pool = parentCandidates.length ? parentCandidates : candidates;
  const unique = [...new Map(pool.map((item) => [item.source, item])).values()];
  if (!unique.length) continue;
  unique.sort((a, b) => (
    REGION_PRIORITY.indexOf(a.region) - REGION_PRIORITY.indexOf(b.region)
    || artworkVariant(a.name) - artworkVariant(b.name)
    || a.name.localeCompare(b.name)
  ));
  const bestRank = REGION_PRIORITY.indexOf(unique[0].region);
  const equallyPreferred = unique.filter((item) => (
    REGION_PRIORITY.indexOf(item.region) === bestRank
    && artworkVariant(item.name) === artworkVariant(unique[0].name)
  ));
  const distinctTitles = new Set(equallyPreferred.map((item) => normalized(cleanArtworkTitle(item.name))));
  if (!parentCandidates.length && distinctTitles.size > 1) {
    ambiguous.push({ parent, candidates: equallyPreferred.map((item) => item.source).join(' | ') });
    continue;
  }
  const selected = unique[0];
  matches.push({ parent, title: parentTitle, ...selected });
  usedSources.add(selected.source);
}

const reportRoot = path.resolve(outputRoot);
await mkdir(reportRoot, { recursive: true });
await writeFile(
  path.join(reportRoot, 'matched.csv'),
  ['rom,title,region,source,destination', ...matches.map((item) => [
    item.parent, item.title, item.region, item.source, `${item.parent}.png`,
  ].map(csv).join(','))].join('\n'),
);
await writeFile(
  path.join(reportRoot, 'ambiguous.csv'),
  ['rom,candidates', ...ambiguous.map((item) => [item.parent, item.candidates].map(csv).join(','))].join('\n'),
);
const unused = artwork.filter((item) => !usedSources.has(item.source));
await writeFile(
  path.join(reportRoot, 'unused-artwork.csv'),
  ['region,title,source', ...unused.map((item) => [item.region, cleanArtworkTitle(item.name), item.source].map(csv).join(','))].join('\n'),
);

if (shouldCopy && !additionalOnly) {
  const imageRoot = path.join(reportRoot, 'by-rom');
  await mkdir(imageRoot, { recursive: true });
  await Promise.all(matches.map((item) => copyFile(item.source, path.join(imageRoot, `${item.parent}.png`))));
}

let additionalSummary = null;
if (missingTitlesFile) {
  const xmlMachines = await readMameXml(mameXmlFile);
  const missingTitles = (await readFile(path.resolve(missingTitlesFile), 'utf8'))
    .split(/\r?\n/u)
    .map((title) => title.trim())
    .filter(Boolean);
  const additionalMatches = [];
  const additionalAmbiguous = [];
  for (const missingTitle of missingTitles) {
    const rom = compact(missingTitle);
    const machine = xmlMachines.get(rom);
    const canonicalRom = machine?.parent || rom;
    const canonicalMachine = xmlMachines.get(canonicalRom) || machine;
    const aliases = canonicalMachine ? titleAliases(canonicalMachine.description) : new Set([missingTitle]);
    const aliasKeys = new Set([...aliases].map(normalized));
    const exact = artwork.filter((item) => aliasKeys.has(normalized(cleanArtworkTitle(item.name))));
    const acronymTargets = new Set([...aliases].flatMap((alias) => [...acronymKeys(alias), compact(alias)]));
    const acronym = exact.length ? [] : artwork.filter((item) => (
      acronymTargets.has(compact(cleanArtworkTitle(item.name)))
      || acronymKeys(cleanArtworkTitle(item.name)).has(compact([...aliases][0]))
    ));
    const candidates = exact.length ? exact : acronym;
    const uniqueTitles = new Set(candidates.map((item) => normalized(cleanArtworkTitle(item.name))));
    if (!candidates.length) continue;
    if (uniqueTitles.size > 1) {
      additionalAmbiguous.push({ rom, missingTitle, candidates: candidates.map((item) => item.source).join(' | ') });
      continue;
    }
    candidates.sort((a, b) => (
      REGION_PRIORITY.indexOf(a.region) - REGION_PRIORITY.indexOf(b.region)
      || artworkVariant(a.name) - artworkVariant(b.name)
      || a.name.localeCompare(b.name)
    ));
    additionalMatches.push({
      rom,
      canonicalRom,
      missingTitle,
      canonicalTitle: canonicalMachine?.description || missingTitle,
      method: exact.length ? 'exact-xml' : 'acronym',
      ...candidates[0],
    });
  }
  await writeFile(
    path.join(reportRoot, 'additional-matched.csv'),
    ['rom,parent_rom,missing_title,canonical_title,artwork_title,method,source,destination', ...additionalMatches.map((item) => [
      item.rom, item.canonicalRom, item.missingTitle, item.canonicalTitle, cleanArtworkTitle(item.name), item.method, item.source, `${item.rom}.png`,
    ].map(csv).join(','))].join('\n'),
  );
  await writeFile(
    path.join(reportRoot, 'additional-ambiguous.csv'),
    ['rom,missing_title,candidates', ...additionalAmbiguous.map((item) => [
      item.rom, item.missingTitle, item.candidates,
    ].map(csv).join(','))].join('\n'),
  );
  if (shouldCopy) {
    const additionalRoot = path.join(reportRoot, 'additional-by-rom');
    await mkdir(additionalRoot, { recursive: true });
    await Promise.all(additionalMatches.map((item) => copyFile(item.source, path.join(additionalRoot, `${item.rom}.png`))));
  }
  additionalSummary = {
    missingTitles: missingTitles.length,
    matched: additionalMatches.length,
    ambiguous: additionalAmbiguous.length,
  };
}

console.log(JSON.stringify({
  catalogueParents: childrenByParent.size,
  artworkFiles: artwork.length,
  matchedParents: matches.length,
  ambiguousParents: ambiguous.length,
  unusedArtworkFiles: unused.length,
  copied: shouldCopy,
  additional: additionalSummary,
  output: reportRoot,
}, null, 2));
