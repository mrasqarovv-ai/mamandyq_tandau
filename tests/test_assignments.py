"""Release invariants for the original collections and the scored subset."""
import json
import unittest
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


class AssignmentCollections(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.documents = json.loads((ROOT / 'data/archive.json').read_text())['documents']
        cls.tasks = [document for document in cls.documents if document['materialType'] == 'tasks']
        cls.quizzes = json.loads((ROOT / 'data/quizzes.json').read_text())['quizzes']
        cls.keys = json.loads((ROOT / 'data/practice-keys.json').read_text())

    def test_all_eighteen_original_collections_are_available(self):
        self.assertEqual(len(self.tasks), 18)
        self.assertEqual(len({task['id'] for task in self.tasks}), 18)
        self.assertEqual({grade for task in self.tasks for grade in task['grades']}, {5, 6, 7, 8})
        for task in self.tasks:
            with self.subTest(document=task['id']):
                self.assertEqual(task['subject'], 'history')
                self.assertIn(urlsplit(task['sourcePage']).hostname, {'daryn.kz', 'www.daryn.kz'})
                self.assertTrue(task['text'].strip())
                self.assertTrue((ROOT / task['fileUrl']).is_file())

    def test_exactly_six_official_tests_retain_complete_keys(self):
        expected = {f'history-{grade}-{stage}-2025-2026'
                    for grade in (5, 6) for stage in ('district', 'regional', 'republican')}
        self.assertEqual({quiz['id'] for quiz in self.quizzes}, expected)
        self.assertEqual(set(self.keys), expected)
        self.assertEqual(sum(len(quiz['questions']) for quiz in self.quizzes), 180)
        for quiz in self.quizzes:
            self.assertEqual(len(quiz['questions']), 30)
            self.assertEqual(sum(question['points'] for question in quiz['questions']), 50)
            self.assertEqual(set(self.keys[quiz['id']]), {question['id'] for question in quiz['questions']})

    def test_unpaired_collections_have_no_generated_official_answers(self):
        paired = {identifier for quiz in self.quizzes for identifier in quiz['sourceDocumentIds']}
        self.assertEqual(len(paired), 6)
        unpaired = [task for task in self.tasks if task['id'] not in paired]
        self.assertEqual(len(unpaired), 12)
        self.assertEqual({grade for task in unpaired for grade in task['grades']}, {5, 6, 7, 8})
        # Whole original documents remain the source of truth. No guessed
        # question segmentation or answer data is introduced for notebooks.
        for task in unpaired:
            self.assertEqual(task.get('questions', []), [])
            self.assertNotIn('score', task)
            self.assertNotIn('correctOptionId', task)


if __name__ == '__main__':
    unittest.main()
