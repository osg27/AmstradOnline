import unittest

from app.services.amiga_high_scores import (
    find_new_battle_squadron_scores,
    parse_battle_squadron_lodsco,
)
from app.highscores.amiga.extractors.battle_squadron import (
    InvalidBattleSquadronScoreData,
    extract,
)
from app.highscores.amiga.extractors.hybris import (
    InvalidHybrisScoreData,
    extract as extract_hybris,
)
from app.highscores.amiga.registry import get_extractor, resolve_extractor


def table(rows):
    payload = bytearray()
    for index, (initials, score) in enumerate(rows, start=1):
        payload.extend(bytes((0, 123, 0, 90 + index)))
        payload.extend(f"{index:2d}. {initials:<3.3} {score:08d}".encode("ascii"))
    return bytes(payload)


def encrypted_table(rows):
    payload = table(rows)
    return bytes(value ^ ((0xEF - index) & 0xFF) for index, value in enumerate(payload))


class BattleSquadronParserTests(unittest.TestCase):
    def setUp(self):
        self.rows = [("AAA", 1_000_000 - index * 50_000) for index in range(12)]

    def test_parses_fixed_lodsco_rows(self):
        parsed = parse_battle_squadron_lodsco(table(self.rows))
        self.assertEqual(12, len(parsed))
        self.assertEqual({"initials": "AAA", "score": 1_000_000}, parsed[0])

    def test_parses_encrypted_whdload_lodsco_rows(self):
        parsed = extract(encrypted_table(self.rows))
        self.assertEqual({"rank": 1, "name": "AAA", "score": 1_000_000}, parsed[0])

    def test_decrypts_captured_battle_squadron_record(self):
        encrypted = bytes.fromhex("ef95ed94cbdbc7c8aaa4b5c4d3d3d1d0efeeedec")
        decrypted = bytes(value ^ ((0xEF - index) & 0xFF) for index, value in enumerate(encrypted))
        self.assertEqual(b"\x00\x7b\x00x 1. MBP 01000000", decrypted)

    def test_finds_only_new_table_entry(self):
        current = [("YOU", 975_000), *self.rows[:-1]]
        self.assertEqual(
            [{"initials": "YOU", "score": 975_000}],
            find_new_battle_squadron_scores(table(current), table(self.rows)),
        )

    def test_rejects_wrong_file_shape(self):
        self.assertEqual([], parse_battle_squadron_lodsco(b"not a score file"))

    def test_generic_extractor_includes_rank_and_name(self):
        parsed = extract(table(self.rows))
        self.assertEqual({"rank": 1, "name": "AAA", "score": 1_000_000}, parsed[0])

    def test_generic_extractor_fails_explicitly_on_wrong_size(self):
        with self.assertRaisesRegex(InvalidBattleSquadronScoreData, "exactly 240 bytes"):
            extract(b"not a score file")

    def test_generic_extractor_rejects_wrong_embedded_rank(self):
        malformed = bytearray(table(self.rows))
        malformed[4:6] = b" 2"
        with self.assertRaisesRegex(InvalidBattleSquadronScoreData, "unexpected rank"):
            extract(bytes(malformed))

    def test_invalid_record_error_contains_safe_binary_preview(self):
        malformed = bytearray(table(self.rows))
        malformed[4:20] = b"\x00" * 16
        with self.assertRaisesRegex(InvalidBattleSquadronScoreData, "hex=007b005b000000"):
            extract(bytes(malformed))

    def test_registry_resolves_key_alias_and_title(self):
        self.assertEqual("LODSCO", get_extractor("battle_squadron").filename)
        self.assertEqual("battle-squadron", resolve_extractor("BattleSquadron_v1.6.1_0941.zip").key)


class HybrisParserTests(unittest.TestCase):
    def setUp(self):
        self.table = b"".join(
            f"{rank}.{score:08d}{name:<6.6}".encode("ascii")
            for rank, score, name in (
                (1, 50000, "MARTIN"),
                (2, 45000, "TORBEN"),
                (3, 40000, "TOM"),
                (4, 35000, "BILL"),
                (5, 30000, "MIKE"),
                (6, 25000, "DAVE"),
                (7, 20000, "GEORGE"),
                (8, 15000, "JIM"),
            )
        )

    def test_parses_whdload_hybrishigh_table(self):
        rows = extract_hybris(self.table)
        self.assertEqual(8, len(rows))
        self.assertEqual({"rank": 1, "name": "MARTIN", "score": 50000}, rows[0])

    def test_rejects_wrong_file_size(self):
        with self.assertRaisesRegex(InvalidHybrisScoreData, "exactly 128 bytes"):
            extract_hybris(b"not a score file")

    def test_registry_resolves_archive_versions_as_hybris(self):
        self.assertEqual("hybrishigh", get_extractor("hybris").filename)
        self.assertEqual("hybris", resolve_extractor("Hybris_v2.3_1457.lha").key)


if __name__ == "__main__":
    unittest.main()
