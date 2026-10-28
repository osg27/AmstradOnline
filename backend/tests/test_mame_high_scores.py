import pytest
import base64
import json
from pathlib import Path

from app.services.mame_high_scores import (
    MameNoPlayerScore, parse_configured_hi, parse_dkong_hi,
    parse_tournament_hi_scores, load_supported_mame_games,
    load_tournament_mame_hi_sizes, load_tournament_mame_roms,
)


# Captured from the browser after a 25,700-point Splatterhouse run (OSS).
SPLATTER_HI = bytes.fromhex(
    "000350012e2e2e20000330012e2e2e20000300012e2e2e20000280012e2e2e20"
    "000257024f535320000250012e2e2e20000230012e2e2e20000200012e2e2e"
)


def test_splatter_tournament_configuration_starts_clean_and_reads_player_score(tmp_path):
    data_dir = Path(__file__).resolve().parents[1] / "app" / "data"
    templates = json.loads((data_dir / "mame_tournament_hi_templates.json").read_text())
    config = templates["splatter"]
    template = base64.b64decode(config["template"], validate=True)
    assert "splatter.zip" in load_tournament_mame_roms()
    assert any(game[0] == "splatter" for game in load_supported_mame_games())
    assert len(template) == load_tournament_mame_hi_sizes()["splatter"] == 63
    score_file = tmp_path / "splatter.hi"
    score_file.write_bytes(template)
    assert parse_tournament_hi_scores(score_file, config["score_rule"]) == []

    # Preserve the game's row metadata/separators, but clear every old score/name.
    for index in range(8):
        start = index * 8
        assert template[start + 3] == SPLATTER_HI[start + 3]
        assert template[start + 4:start + 7] == b"..."
    score_file.write_bytes(SPLATTER_HI)
    assert any(score.score == 25700 for score in parse_tournament_hi_scores(score_file, config["score_rule"]))
    played = bytearray(template)
    played[56:59] = bytes.fromhex("000257")
    score_file.write_bytes(played)
    assert [(score.score, score.rank_in_game) for score in parse_tournament_hi_scores(score_file, config["score_rule"])] == [(25700, 8)]


def test_splatter_reads_captured_player_score_and_excludes_higher_factory_scores(tmp_path):
    score_file = tmp_path / "splatter.hi"
    score_file.write_bytes(SPLATTER_HI)

    scores = parse_configured_hi(score_file, "splatter")

    assert [(entry.score, entry.initials, entry.rank_in_game) for entry in scores] == [(25700, "OSS", 5)]


def test_splatter_rejects_factory_only_table(tmp_path):
    data = bytearray(SPLATTER_HI)
    data[36:39] = b"..."
    score_file = tmp_path / "splatter.hi"
    score_file.write_bytes(data)

    with pytest.raises(MameNoPlayerScore):
        parse_configured_hi(score_file, "splatter")


def test_splatter_reads_final_row_without_trailing_separator(tmp_path):
    data = bytearray(SPLATTER_HI)
    data[36:39] = b"..."
    data[60:63] = b"OSS"
    score_file = tmp_path / "splatter.hi"
    score_file.write_bytes(data)

    scores = parse_configured_hi(score_file, "splatter")

    assert [(entry.score, entry.initials, entry.rank_in_game) for entry in scores] == [(20000, "OSS", 8)]


def test_splatter_accepts_player_score_matching_a_factory_value(tmp_path):
    data = bytearray(SPLATTER_HI)
    data[32:35] = bytes.fromhex("000350")
    score_file = tmp_path / "splatter.hi"
    score_file.write_bytes(data)

    scores = parse_configured_hi(score_file, "splatter")

    assert [(entry.score, entry.initials) for entry in scores] == [(35000, "OSS")]


def test_dkong_parser_reads_only_the_five_score_slots(tmp_path):
    data = bytearray(179)
    data[10:13] = bytes.fromhex("000090")  # Would decode as the false 900,000 when scanned.
    data[29:32] = bytes.fromhex("009004")  # 49,000 in little-endian packed BCD.
    score_file = tmp_path / "dkong.hi"
    score_file.write_bytes(data)

    scores = parse_dkong_hi(score_file)

    assert [(entry.score, entry.rank_in_game) for entry in scores] == [(49000, 1)]
