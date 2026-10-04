"""Extract explicitly tagged Spectrum front covers from LaunchBox Metadata.zip.

Usage: python scripts/import-spectrum-front-covers.py Metadata.zip output.json
Only metadata URLs are stored; no artwork or game files are redistributed.
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


def records(archive):
    with archive.open('Metadata.xml') as file:
        iterator = ET.iterparse(file, events=('start', 'end'))
        _, root = next(iterator)
        depth = 0
        for event, element in iterator:
            if event == 'start':
                depth += 1
            else:
                if depth == 1:
                    yield element
                    root.clear()
                depth -= 1


def build(archive):
    games = {}
    images = {}
    for entry in records(archive):
        if entry.tag == 'Game' and entry.findtext('Platform') == 'Sinclair ZX Spectrum':
            games[entry.findtext('DatabaseID')] = entry.findtext('Name')
        elif entry.tag == 'GameImage' and entry.findtext('Type') == 'Box - Front':
            game_id = entry.findtext('DatabaseID')
            if game_id not in games:
                continue
            filename = entry.findtext('FileName', '')
            if not re.fullmatch(r'[a-zA-Z0-9-]+\.(?:png|jpg|jpeg|webp)', filename):
                continue
            region = entry.findtext('Region', '')
            rank = {'United Kingdom': 0, 'Europe': 1, 'World': 2, '': 3}.get(region, 4)
            candidate = (rank, filename)
            if game_id not in images or candidate < images[game_id]:
                images[game_id] = candidate
    return {'provider': 'LaunchBox Games Database', 'source': 'https://gamesdb.launchbox-app.com/Metadata.zip',
            'type': 'Box - Front', 'platform': 'Sinclair ZX Spectrum',
            'covers': [{'title': games[key], 'id': key, 'url': 'https://images.launchbox-app.com/' + value[1]}
                       for key, value in sorted(images.items(), key=lambda item: games[item[0]].casefold())]}


if __name__ == '__main__':
    with zipfile.ZipFile(sys.argv[1]) as archive:
        result = build(archive)
    target = Path(sys.argv[2])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f"Exported {len(result['covers'])} tagged front covers")
