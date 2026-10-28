import pytest

from app.services.mame_high_scores import MameNoPlayerScore, parse_configured_hi, parse_dkong_hi


# Captured from the browser after a 25,700-point Splatterhouse run (OSS).
SPLATTER_HI = bytes.fromhex(
    "000350012e2e2e20000330012e2e2e20000300012e2e2e20000280012e2e2e20"
    "000257024f535320000250012e2e2e20000230012e2e2e20000200012e2e2e"
)


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
