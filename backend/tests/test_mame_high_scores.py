from app.services.mame_high_scores import parse_dkong_hi


def test_dkong_parser_reads_only_the_five_score_slots(tmp_path):
    data = bytearray(179)
    data[10:13] = bytes.fromhex("000090")  # Would decode as the false 900,000 when scanned.
    data[29:32] = bytes.fromhex("009004")  # 49,000 in little-endian packed BCD.
    score_file = tmp_path / "dkong.hi"
    score_file.write_bytes(data)

    scores = parse_dkong_hi(score_file)

    assert [(entry.score, entry.rank_in_game) for entry in scores] == [(49000, 1)]
