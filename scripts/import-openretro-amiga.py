#!/usr/bin/env python3
"""Build compact, deterministic browser indexes from an FS-UAE/OpenRetro DB."""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import uuid
import zlib
from pathlib import Path

CONFIG_KEYS = {
    "accuracy", "amiga_model", "chip_memory", "chipset", "cpu", "fast_memory",
    "floppy_drive_count", "joystick_port_0_mode", "joystick_port_1_mode",
    "joystick_port_2_mode", "joystick_port_3_mode", "joystick_port_4_mode",
    "kickstart", "model", "serial_port", "slow_memory", "video_standard",
}
GAME_KEYS = {
    "developer", "game_name", "game_name_alt", "game_subtitle", "max_players",
    "min_players", "players", "publisher", "tags", "year",
}
RELEASE_KEYS = {
    "languages", "protection", "requirements", "variant_name", "variant_notice",
    "variant_warning", "whdload_args", "whdload_archive", "whdload_version",
}


def json_dump(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def decode_uuid(value: object) -> str:
    if isinstance(value, bytes) and len(value) == 16:
        return str(uuid.UUID(bytes=value))
    return str(uuid.UUID(str(value)))


def decode_record(value: object) -> dict:
    if isinstance(value, str):
        raw = value.encode("utf-8")
    elif isinstance(value, bytes):
        raw = value
    else:
        raise TypeError(f"unsupported data type {type(value).__name__}")
    try:
        raw = zlib.decompress(raw)
    except zlib.error:
        pass
    decoded = json.loads(raw.decode("utf-8"))
    if not isinstance(decoded, dict):
        raise ValueError("record is not a JSON object")
    return decoded


def parse_file_list(value: object) -> list[dict]:
    if not value:
        return []
    parsed = json.loads(value) if isinstance(value, str) else value
    if not isinstance(parsed, list):
        raise ValueError("file_list is not an array")
    result = []
    for position, item in enumerate(parsed, 1):
        if not isinstance(item, dict):
            continue
        sha1 = str(item.get("sha1", "")).strip().lower()
        if len(sha1) != 40 or any(char not in "0123456789abcdef" for char in sha1):
            continue
        result.append({
            "name": str(item.get("name") or f"disk-{position}"),
            "sha1": sha1,
            "size": int(item.get("size") or 0),
            "position": position,
        })
    return result


def selected(data: dict, keys: set[str]) -> dict:
    return {key: data[key] for key in sorted(keys) if data.get(key) not in (None, "")}


def import_database(source: Path, output: Path) -> dict[str, int]:
    uri = f"file:{source.resolve().as_posix()}?mode=ro"
    records: dict[str, dict] = {}
    malformed = 0
    with sqlite3.connect(uri, uri=True) as connection:
        for row_id, raw_uuid, raw_data in connection.execute("SELECT id, uuid, data FROM game ORDER BY id"):
            try:
                record_uuid = decode_uuid(raw_uuid)
                records[record_uuid] = decode_record(raw_data)
            except Exception as exc:  # a bad upstream row must not abort the build
                malformed += 1
                logging.warning("Skipping malformed game row %s: %s", row_id, exc)

    parent_ids = {str(data.get("parent_uuid")) for data in records.values() if data.get("parent_uuid")}
    games: dict[str, dict] = {}
    releases: dict[str, dict] = {}
    hashes: dict[str, list[dict]] = {}
    configs: dict[str, dict] = {}

    for record_uuid in sorted(records):
        data = records[record_uuid]
        parent_uuid = str(data.get("parent_uuid") or record_uuid)
        is_release = bool(data.get("parent_uuid"))
        config = selected(data, CONFIG_KEYS)
        if config:
            configs[record_uuid] = config
        if not is_release or record_uuid in parent_ids:
            title = data.get("game_name") or data.get("full_name") or data.get("x_name") or record_uuid
            games[record_uuid] = {
                "uuid": record_uuid,
                "title": str(title),
                "metadata": selected(data, GAME_KEYS),
            }
        if not is_release:
            continue
        try:
            media = parse_file_list(data.get("file_list"))
        except Exception as exc:
            malformed += 1
            logging.warning("Release %s has malformed file_list: %s", record_uuid, exc)
            media = []
        release = {
            "uuid": record_uuid,
            "parentUuid": parent_uuid,
            "name": str(data.get("variant_name") or data.get("x_name") or record_uuid),
            "media": [[item["name"], item["sha1"], item["size"], item["position"]] for item in media],
            "metadata": selected(data, RELEASE_KEYS),
        }
        releases[record_uuid] = release
        for item in media:
            # Compact tuple schema: release UUID, parent UUID, file name, disk position.
            hashes.setdefault(item["sha1"], []).append([
                record_uuid, parent_uuid, item["name"], item["position"],
            ])

    for matches in hashes.values():
        matches.sort(key=lambda item: (item[0], item[3], item[2]))
    game_list = sorted(games.values(), key=lambda item: item["uuid"])
    release_list = sorted(releases.values(), key=lambda item: item["uuid"])
    json_dump(output / "openretro-games.json", {"version": 1, "games": game_list})
    release_shards: dict[str, list] = {}
    for release in release_list:
        release_shards.setdefault(release["uuid"][:2], []).append(release)
    for prefix in sorted(release_shards):
        json_dump(output / "releases" / f"{prefix}.json", {
            "version": 1, "releases": release_shards[prefix],
        })
    json_dump(output / "openretro-releases.json", {
        "version": 1,
        "shardPrefixLength": 2,
        "pathTemplate": "releases/{prefix}.json",
        "shards": {prefix: len(release_shards[prefix]) for prefix in sorted(release_shards)},
    })
    shard_dir = output / "hashes"
    shards: dict[str, dict] = {}
    for sha1, matches in hashes.items():
        shards.setdefault(sha1[:2], {})[sha1] = matches
    for prefix in sorted(shards):
        json_dump(shard_dir / f"{prefix}.json", {"version": 1, "hashes": shards[prefix]})
    json_dump(output / "openretro-hash-index.json", {
        "version": 1,
        "algorithm": "sha1",
        "shardPrefixLength": 2,
        "pathTemplate": "hashes/{prefix}.json",
        "shards": {prefix: len(shards[prefix]) for prefix in sorted(shards)},
    })
    json_dump(output / "openretro-config-index.json", {"version": 1, "configs": configs})
    return {
        "records": len(records), "games": len(game_list), "releases": len(release_list),
        "hashes": len(hashes), "malformed": malformed,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="Amiga.sqlite")
    parser.add_argument("--output", default="frontend/public/data/amiga")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    stats = import_database(Path(args.source), Path(args.output))
    print(json.dumps(stats, sort_keys=True))


if __name__ == "__main__":
    main()
