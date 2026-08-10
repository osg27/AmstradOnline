import unittest

from app.services.amiga_high_scores import (
    find_new_battle_squadron_scores,
    parse_battle_squadron_lodsco,
)


def table(rows):
    payload = bytearray()
    for index, (initials, score) in enumerate(rows, start=1):
        payload.extend(bytes((0, 123, 0, 90 + index)))
        payload.extend(f"{index:2d}. {initials:<3.3} {score:08d}".encode("ascii"))
    return bytes(payload)


class BattleSquadronParserTests(unittest.TestCase):
    def setUp(self):
        self.rows = [("AAA", 1_000_000 - index * 50_000) for index in range(12)]

    def test_parses_fixed_lodsco_rows(self):
        parsed = parse_battle_squadron_lodsco(table(self.rows))
        self.assertEqual(12, len(parsed))
        self.assertEqual({"initials": "AAA", "score": 1_000_000}, parsed[0])

    def test_finds_only_new_table_entry(self):
        current = [("YOU", 975_000), *self.rows[:-1]]
        self.assertEqual(
            [{"initials": "YOU", "score": 975_000}],
            find_new_battle_squadron_scores(table(current), table(self.rows)),
        )

    def test_rejects_wrong_file_shape(self):
        self.assertEqual([], parse_battle_squadron_lodsco(b"not a score file"))


if __name__ == "__main__":
    unittest.main()
