"""Independent release checks for the Kazakhstan-history-only edition.

Answer letters are read again from the downloaded official key transcription,
independently of the curated quiz JSON. The tests deliberately fail if unrelated
subjects or an unmatched answer key are reintroduced into a release.
"""
import csv
import json
import re
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
CHOICES = str.maketrans({'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E'})
# Visually checked against original 14582cf2adb5cb86ef56.pdf, page 2.
# pdftotext interleaves the three columns of q13's multi-line header, so
# whitespace removal alone cannot recover those column headings in order.
AUDITED_TABLE_HEADERS = {
    ('14582cf2adb5cb86ef56', 13): [
        'Мемлекеттің жоғары лауазымдылардың бірі',
        'Сот ісін басқарған',
        'Алым-салық жинаумен айналысты',
    ],
}


def compact(value):
    return ''.join(value.split())


def official_answers(source, grade):
    """Reparse only the explicitly identified official key table formats."""
    text, identifier = source['text'], source['id']
    result = {}
    if identifier in {'093eb81bcc67e6bb96b6', 'bd64d05ea6a4cb857573'}:
        for line in text.splitlines():
            match = re.match(r'^\s*(\d+)\s*([A-EАВСЕ])(?:\s|$)', line)
            if match:
                result[int(match[1])] = match[2].translate(CHOICES)
    elif identifier == '7cd302e8554191305202':
        for line in text.splitlines():
            match = re.match(r'^\s*(\d+)\s*([A-EАВСЕ])\s+([A-EАВСЕ])\s*$', line)
            if match:
                result[int(match[1])] = match[2 if grade == 5 else 3].translate(CHOICES)
    elif identifier == 'f071418ae6c039e2bb76':
        for line in text.splitlines():
            cells = line.split('\t')
            if len(cells) != 6 or not cells[0].isdigit():
                continue
            number = int(cells[0])
            if number != int(cells[3]):
                raise ValueError('The two grade columns have different question numbers')
            cell = cells[1 if grade == 5 else 4]
            match = re.fullmatch(r'\d+([A-EАВСЕ])', cell)
            if not match:
                raise ValueError('Unrecognized official answer table cell')
            result[number] = match[1].translate(CHOICES)
    else:
        raise ValueError(f'An independent parser is needed for official key {identifier}')
    if set(result) != set(range(1, 31)):
        raise ValueError(f'Official key {identifier} does not contain exactly questions 1–30')
    return result


class HistoryOnlyRelease(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = json.loads((ROOT/'data/archive.json').read_text())
        cls.documents = {d['id']: d for d in cls.archive['documents']}
        cls.quizzes = json.loads((ROOT/'data/quizzes.json').read_text())['quizzes']
        cls.keys = json.loads((ROOT/'data/practice-keys.json').read_text())

    def test_archive_and_public_source_report_contain_only_history(self):
        self.assertGreater(len(self.documents), 0)
        self.assertEqual({d['subject'] for d in self.documents.values()}, {'history'})
        report = json.loads((ROOT/'data/sources.json').read_text())
        self.assertEqual({d['subject'] for d in report['documents']}, {'history'})
        self.assertEqual({d['id'] for d in report['documents']}, set(self.documents))
        for document in self.documents.values():
            self.assertIn(urlsplit(document['sourcePage']).hostname, {'daryn.kz', 'www.daryn.kz'})

    def test_only_referenced_history_originals_are_shipped(self):
        referenced = {(ROOT/d['fileUrl']).resolve() for d in self.documents.values()}
        shipped = {p.resolve() for p in (ROOT/'materials').iterdir() if p.is_file()}
        self.assertEqual(shipped, referenced, 'Unrelated or missing originals in the public directory')

    def test_coverage_report_has_no_other_subject_rows(self):
        with (ROOT/'data/coverage.csv').open(encoding='utf-8-sig', newline='') as handle:
            rows = list(csv.DictReader(handle))
        self.assertTrue(rows)
        self.assertEqual({row['Пән'] for row in rows}, {'Қазақстан тарихы'})

    def test_downloadable_word_contains_exactly_the_history_archive(self):
        with zipfile.ZipFile(ROOT/'downloads/daryn-archive.docx') as archive:
            self.assertIsNone(archive.testzip())
            document = ET.fromstring(archive.read('word/document.xml'))
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        paragraphs = [''.join(p.itertext()) for p in document.findall('.//w:p', ns)]
        text = '\n'.join(paragraphs)
        identifiers = set(re.findall(r'Архив идентификаторы:\s*([A-Za-z0-9_-]+)', text))
        self.assertEqual(identifiers, set(self.documents),
                         'The Word download must be regenerated after removing other subjects')

    def test_quiz_questions_and_options_have_exact_history_provenance(self):
        self.assertGreaterEqual(len(self.quizzes), 4)
        for quiz in self.quizzes:
            with self.subTest(quiz=quiz['id']):
                self.assertEqual(quiz['subject'], 'history')
                self.assertTrue(quiz['sourceDocumentIds'])
                self.assertTrue(quiz['answerSourceIds'])
                self.assertNotIn('Жаратылыстану', quiz['title'])
                for question in quiz['questions']:
                    original = self.documents[question['source']['documentId']]
                    self.assertEqual(original['subject'], 'history')
                    self.assertEqual(original['year'], quiz['year'])
                    self.assertEqual(original['stage'], quiz['stage'])
                    self.assertIn(quiz['grade'], original.get('grades') or [original.get('grade')])
                    raw = compact(original['text'])
                    self.assertIn(compact(question['text']), raw)
                    for option in question['options']:
                        self.assertIn(compact(option['text']), raw)
                    if question.get('sourceTable'):
                        table = question['sourceTable']
                        self.assertIn(compact(question['tableQuestionText']), raw)
                        self.assertEqual({r['optionId'] for r in table['rows']},
                                         {o['id'] for o in question['options']})
                        audited = AUDITED_TABLE_HEADERS.get((original['id'], int(question['source']['questionNumber'])))
                        if audited:
                            self.assertEqual(table['headers'], audited)
                            for heading in audited:
                                for word in heading.split():
                                    self.assertIn(word, original['text'])
                        else:
                            for heading in table['headers']:
                                self.assertIn(compact(heading), raw)
                        for row in table['rows']:
                            self.assertEqual(len(row['cells']), len(table['headers']))
                            for cell in row['cells']:
                                self.assertIn(compact(cell), raw)

    def test_every_answer_is_rederived_from_its_official_grade_column(self):
        for quiz in self.quizzes:
            with self.subTest(quiz=quiz['id']):
                self.assertEqual(len(quiz['answerSourceIds']), 1)
                source = self.documents[quiz['answerSourceIds'][0]]
                self.assertEqual(source['subject'], 'history')
                self.assertEqual(source['year'], quiz['year'])
                self.assertEqual(source['stage'], quiz['stage'])
                self.assertIn(quiz['grade'], source.get('grades') or [source.get('grade')])
                expected = official_answers(source, quiz['grade'])
                for question in quiz['questions']:
                    number = int(question['source']['questionNumber'])
                    self.assertEqual(self.keys[quiz['id']][question['id']], expected[number])

    def test_original_weighted_scoring_has_not_been_flattened(self):
        for quiz in self.quizzes:
            with self.subTest(quiz=quiz['id']):
                self.assertEqual(len(quiz['questions']), 30)
                self.assertEqual(sum(q['points'] for q in quiz['questions']), 50)
                original = self.documents[quiz['sourceDocumentIds'][0]]['text']
                self.assertRegex(original, r'1\s*[-–]\s*15')
                self.assertRegex(original, r'16\s*[-–]\s*25')
                key_source = self.documents[quiz['answerSourceIds'][0]]
                official_points = {}
                if key_source['id'] == 'f071418ae6c039e2bb76':
                    # This official XLSX explicitly gives every question's
                    # weight, including q25=2 despite a typo in the grade-6
                    # task document's final section heading ("25–30").
                    for line in key_source['text'].splitlines():
                        cells = line.split('\t')
                        if len(cells) == 6 and cells[0].isdigit():
                            official_points[int(cells[0])] = int(cells[2 if quiz['grade'] == 5 else 5])
                    self.assertEqual(set(official_points), set(range(1, 31)))
                if not re.search(r'26\s*[-–]\s*30', original):
                    self.assertEqual(quiz['grade'], 6)
                    self.assertEqual(key_source['id'], 'f071418ae6c039e2bb76')
                    self.assertRegex(original, r'25\s*[-–]\s*30')
                    note = ' '.join(str(quiz.get(field, '')) for field in
                                    ('sourceNote', 'sourceNotes', 'scoringNote', 'description'))
                    self.assertTrue('25' in note and '26' in note,
                                    'The original heading/key disagreement needs an explicit source note')
                for question in quiz['questions']:
                    number = int(question['source']['questionNumber'])
                    expected = official_points[number] if official_points else (1 if number <= 15 else 2 if number <= 25 else 3)
                    self.assertEqual(question['points'], expected)

    def test_worker_uses_the_same_verified_questions_and_weights(self):
        bank = (ROOT/'worker/src/quiz-bank.js').read_text()
        payload = bank.split('export const quizzes = ', 1)[1].rsplit(';', 1)[0]
        server = {q['id']: q for q in json.loads(payload)}
        self.assertEqual(set(server), {q['id'] for q in self.quizzes})
        for quiz in self.quizzes:
            worker_quiz = server[quiz['id']]
            self.assertEqual(worker_quiz['subject'], 'history')
            self.assertEqual(len(worker_quiz['questions']), len(quiz['questions']))
            for public, private in zip(quiz['questions'], worker_quiz['questions']):
                self.assertEqual(public['id'], private['id'])
                self.assertEqual(public['text'], private['text'])
                self.assertEqual(public['options'], private['options'])
                self.assertEqual(public['points'], private['points'])
                self.assertEqual(private['correctOptionId'], self.keys[quiz['id']][public['id']])


if __name__ == '__main__':
    unittest.main()
