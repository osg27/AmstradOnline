"""Build isolated tournament .hi templates from hi2txt XML and genuine samples."""

import base64
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
XML_DIR = REPO_ROOT / "backend" / "app" / "data" / "hi2txt-xml"
ARCHIVE_MANIFEST = REPO_ROOT / "backend" / "app" / "data" / "mame_tournament_roms.json"
SIZE_MANIFEST = REPO_ROOT / "backend" / "app" / "data" / "mame_tournament_hi_sizes.json"
OUTPUT_PATH = REPO_ROOT / "backend" / "app" / "data" / "mame_tournament_hi_templates.json"
NAMES_PATH = REPO_ROOT / "backend" / "app" / "data" / "mame_tournament_names.json"


def structure_sizes(structure: ET.Element) -> set[int]:
    sizes: set[int] = set()
    for element in structure.findall("./check/size"):
        try:
            sizes.add(int(element.text or ""))
        except ValueError:
            continue
    return sizes


def load_definition(xml_path: Path) -> ET.Element:
    root = ET.parse(xml_path).getroot()
    seen = {xml_path.stem.lower()}
    while not root.findall("structure"):
        same_as = root.find("sameas")
        target = (same_as.get("id") if same_as is not None else "") or ""
        target = target.lower()
        if not target or target in seen:
            break
        seen.add(target)
        target_path = XML_DIR / f"{target}.xml"
        if not target_path.is_file():
            break
        root = ET.parse(target_path).getroot()
    return root


def score_ranges(structure: ET.Element) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    offset = 0

    def consume(elements: list[ET.Element]) -> int:
        nonlocal offset
        start = offset
        for element in elements:
            if element.tag == "elt":
                size = int(element.get("size", "0"))
                identifier = (element.get("id") or "").upper()
                if size <= 0:
                    raise ValueError("invalid element size")
                if "SCORE" in identifier and "POINTER" not in identifier:
                    ranges.append((offset, size))
                offset += size
            elif element.tag == "loop":
                count = int(element.get("count", "0"))
                if count <= 0:
                    raise ValueError("invalid loop count")
                children = list(element)
                for _ in range(count):
                    consume(children)
        return offset - start

    consume([element for element in structure if element.tag != "check"])
    return ranges


def find_samples(samples_root: Path) -> dict[str, list[Path]]:
    samples: dict[str, list[Path]] = {}
    for path in samples_root.rglob("*.hi"):
        samples.setdefault(path.stem.lower(), []).append(path)
    return samples


def build(samples_root: Path) -> tuple[dict[str, dict], dict[str, int]]:
    archive_roms = {
        Path(filename).stem.lower()
        for filename in json.loads(ARCHIVE_MANIFEST.read_text(encoding="utf-8-sig"))
    }
    expected_sizes = {
        rom_name.lower(): int(size)
        for rom_name, size in json.loads(SIZE_MANIFEST.read_text(encoding="utf-8-sig")).items()
    }
    samples = find_samples(samples_root)
    output: dict[str, dict] = {}
    stats = {"archive_roms": len(archive_roms), "compiled": 0, "no_sample": 0, "no_layout": 0}

    for rom_name in sorted(archive_roms):
        xml_path = XML_DIR / f"{rom_name}.xml"
        candidates = samples.get(rom_name, [])
        if not xml_path.is_file() or not candidates:
            stats["no_sample"] += 1
            continue
        try:
            root = load_definition(xml_path)
        except (ET.ParseError, OSError):
            stats["no_layout"] += 1
            continue

        compiled = None
        for sample_path in candidates:
            data = bytearray(sample_path.read_bytes())
            if len(data) != expected_sizes.get(rom_name):
                continue
            structure = next(
                (item for item in root.findall("structure") if len(data) in structure_sizes(item)),
                None,
            )
            if structure is None:
                continue
            try:
                ranges = score_ranges(structure)
            except (TypeError, ValueError):
                continue
            if not ranges or any(offset + size > len(data) for offset, size in ranges):
                continue
            for offset, size in ranges:
                data[offset:offset + size] = bytes(size)
            compiled = {
                "template": base64.b64encode(data).decode("ascii"),
                "score_rule": {"parser": "hi2txt", "minimum_score": 1},
            }
            break

        if compiled is None:
            stats["no_layout"] += 1
            continue
        output[rom_name] = compiled

    stats["compiled"] = len(output)
    return output, stats


def main() -> int:
    samples_root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO_ROOT / "hi2txt-xml" / "src" / "test" / "input"
    if not samples_root.is_dir():
        raise SystemExit(f"hi2txt sample directory not found: {samples_root}")
    output, stats = build(samples_root)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if len(sys.argv) > 2:
        metadata_path = Path(sys.argv[2]).resolve()
        names: dict[str, str] = {}
        for _event, element in ET.iterparse(metadata_path, events=("end",)):
            if element.tag == "game":
                rom_name = str(element.attrib.get("name") or "").lower()
                description = element.findtext("description") or ""
                if rom_name in output and description.strip():
                    names[rom_name] = description.strip()
                element.clear()
        NAMES_PATH.write_text(json.dumps(names, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        stats["named"] = len(names)
    print(json.dumps(stats, sort_keys=True))
    return 0 if output else 1


if __name__ == "__main__":
    raise SystemExit(main())
