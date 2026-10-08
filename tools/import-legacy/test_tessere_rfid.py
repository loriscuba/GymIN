import unittest

from tessere_rfid import associazioni, converti_codice, genera_sql


class TestTessereRfid(unittest.TestCase):
    def test_tessere_reali(self):
        self.assertEqual(converti_codice("0540006035015"), "0003827938")
        self.assertEqual(converti_codice("0920015850900"), "0009419561")

    def test_codici_non_validi(self):
        for c in ("", "123", "abc0006035015", "0009999999999"):
            self.assertIsNone(converti_codice(c))

    def test_associazioni_esclude_ambigui(self):
        rows = [
            {"COD_TESS": "0540006035015", "COD_CLI": "2840"},
            {"COD_TESS": "0540006035015", "COD_CLI": "2840"},
            {"COD_TESS": "0920015850900", "COD_CLI": "2429"},
            {"COD_TESS": "0920015850900", "COD_CLI": "9999"},
            {"COD_TESS": "1", "COD_CLI": "5"},
        ]
        ok, ambigui, scartati = associazioni(rows)
        self.assertEqual(ok, [("0003827938", "2840")])
        self.assertEqual(set(ambigui), {"0009419561"})
        self.assertEqual(scartati, 1)

    def test_sql(self):
        sql = genera_sql([("0003827938", "2840")], "test")
        self.assertIn("('0003827938','2840')", sql)
        self.assertIn("insert into test.tessere", sql)
        with self.assertRaises(ValueError):
            genera_sql([], "x;drop")


if __name__ == "__main__":
    unittest.main()
