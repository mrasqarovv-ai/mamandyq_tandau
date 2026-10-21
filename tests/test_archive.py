"""Validate the shipped real archive and original-file integrity, offline."""
import hashlib
import json
import unittest
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


class ArchiveIntegrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = json.loads((ROOT / 'data/archive.json').read_text())

    def test_scope_and_honest_coverage(self):
        self.assertEqual(self.archive['schemaVersion'], 1)
        self.assertGreater(len(self.archive['documents']), 0)
        self.assertEqual({x['year'] for x in self.archive['coverage']},
                         {f'{y}–{y+1}' for y in range(2020, 2027)})
        self.assertTrue(all(x['status'] in {'partial', 'unverified', 'checked'}
                            for x in self.archive['coverage']))
        self.assertFalse(self.archive['statistics']['questionCountComplete'])

    def test_provenance_and_unique_records(self):
        ids = set()
        for record in self.archive['documents']:
            with self.subTest(id=record['id']):
                self.assertNotIn(record['id'], ids)
                ids.add(record['id'])
                self.assertIn(urlsplit(record['sourcePage']).hostname,
                              {'daryn.kz', 'www.daryn.kz'})
                self.assertIn(urlsplit(record['sourceUrl']).hostname,
                              {'daryn.kz', 'www.daryn.kz', 'drive.google.com', 'docs.google.com'})
                self.assertTrue(record['text'].strip())
                self.assertTrue(set(record['grades']).issubset({5, 6, 7, 8}))
                self.assertIn(record['language'], {'kk', 'ru', 'en', 'mixed', 'unknown'})
                self.assertIn(record['stage'], {'district', 'regional', 'republican', 'unknown'})

    def test_every_original_exists_and_matches_checksum(self):
        checked = set()
        for record in self.archive['documents']:
            target = (ROOT / record['fileUrl']).resolve()
            with self.subTest(id=record['id']):
                self.assertTrue(target.is_relative_to(ROOT / 'materials'))
                self.assertTrue(target.is_file())
                if target not in checked:
                    payload = target.read_bytes()
                    self.assertEqual(hashlib.sha256(payload).hexdigest(), record['sha256'])
                    if record['format'] == 'pdf':
                        self.assertTrue(payload.startswith(b'%PDF-'))
                    checked.add(target)

    def test_verified_questions_retain_their_original_words(self):
        count = 0
        for record in self.archive['documents']:
            for question in record.get('questions', []):
                count += 1
                self.assertTrue(question['text'].strip())
                self.assertIn('answer', question)
                # Whitespace can differ between PDF page and question extraction.
                original = ''.join(record['text'].split())
                self.assertIn(''.join(question['text'].split()), original)
        self.assertEqual(count, self.archive['statistics']['verifiedSegmentedQuestions'])


if __name__ == '__main__':
    unittest.main()
