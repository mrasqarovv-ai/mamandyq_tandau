"""Protect question provenance and the official answer pairing used for scores."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class VerifiedQuizzes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.quizzes = json.loads((ROOT/'data/quizzes.json').read_text())['quizzes']
        cls.keys = json.loads((ROOT/'data/practice-keys.json').read_text())
        cls.documents = {d['id']:d for d in json.loads((ROOT/'data/archive.json').read_text())['documents']}

    def test_unique_ids_and_complete_valid_keys(self):
        self.assertGreater(len(self.quizzes), 0)
        self.assertEqual(len({q['id'] for q in self.quizzes}),len(self.quizzes))
        for quiz in self.quizzes:
            mapping = self.keys[quiz['id']]
            self.assertEqual(set(mapping), {q['id'] for q in quiz['questions']})
            self.assertEqual(len(mapping),len(quiz['questions']))
            for question in quiz['questions']:
                self.assertGreater(question['points'],0)
                self.assertIn(mapping[question['id']],{o['id'] for o in question['options']})
                self.assertEqual(len({o['id'] for o in question['options']}),len(question['options']))

    def test_all_question_and_option_words_come_from_originals(self):
        for quiz in self.quizzes:
            for question in quiz['questions']:
                source = self.documents[question['source']['documentId']]
                original = ''.join(source['text'].split())
                self.assertIn(''.join(question['text'].split()),original)
                for option in question['options']:
                    self.assertIn(''.join(option['text'].split()),original)

    def test_official_answer_sources_match_grade_year_stage_subject(self):
        for quiz in self.quizzes:
            self.assertTrue(quiz['answerSourceIds'])
            for source_id in quiz['answerSourceIds']:
                key = self.documents[source_id]
                self.assertEqual(key['grade'],quiz['grade'])
                self.assertEqual(key['year'],quiz['year'])
                self.assertEqual(key['stage'],quiz['stage'])
                self.assertEqual(key['subject'],quiz['subject'])
                self.assertIn(key['materialType'],{'answers','solutions'})


if __name__ == '__main__':
    unittest.main()
