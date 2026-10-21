import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateStart,
  validateSubmission,
  scoreQuiz,
  publicQuiz,
  formatTelegramMessage,
} from '../src/core.js';

// Deliberately synthetic test-only data. Never included in the published bank.
const quiz = {
  id: 'fixture-quiz-only',
  title: 'Synthetic unit-test fixture only',
  grade: 5,
  subject: 'natural-science',
  year: '2025–2026',
  language: 'kk',
  durationMinutes: 20,
  questions: [
    {
      id: 'fixture-q1', number: 1, text: 'Fixture question one', points: 1,
      options: [{ id: 'A', text: 'Fixture A' }, { id: 'B', text: 'Fixture B' }],
      correctOptionId: 'A',
      source: { documentId: 'fixture-source-not-published', pageNumber: 1 },
    },
    {
      id: 'fixture-q2', number: 2, text: 'Fixture question two', points: 2,
      options: [{ id: 'A', text: 'Fixture A' }, { id: 'B', text: 'Fixture B' }],
      correctOptionId: 'B',
      source: { documentId: 'fixture-source-not-published', pageNumber: 2 },
    },
  ],
};
const bank = new Map([[quiz.id, quiz]]);
const start = () => ({
  quizId: quiz.id,
  studentCode: 'ST_5-001',
  grade: 5,
  turnstileToken: 'test-only-turnstile-token',
});

test('start accepts a student code and a grade matching the selected quiz', () => {
  const result = validateStart(start(), bank);
  assert.equal(result.quizId, quiz.id);
  assert.equal(result.studentCode, 'ST_5-001');
  assert.equal(result.grade, 5);
  assert.equal(result.turnstileToken, 'test-only-turnstile-token');
});

for (const invalid of [null, [], 'text', 17]) {
  test(`start rejects non-object body ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => validateStart(invalid, bank));
  });
}

test('start rejects unknown quiz IDs rather than inventing a test', () => {
  assert.throws(() => validateStart({ ...start(), quizId: 'missing-real-quiz' }, bank));
});

for (const grade of [4, 9, 5.5, '5', null, 6]) {
  test(`start rejects a grade outside the selected quiz: ${JSON.stringify(grade)}`, () => {
    assert.throws(() => validateStart({ ...start(), grade }, bank));
  });
}

for (const studentCode of ['', 'A', 'A'.repeat(31), 'student code', '<script>', 42, null]) {
  test(`start rejects an invalid student code ${JSON.stringify(studentCode)}`, () => {
    assert.throws(() => validateStart({ ...start(), studentCode }, bank));
  });
}

test('student codes can contain Kazakh letters without requesting real names', () => {
  assert.equal(validateStart({ ...start(), studentCode: 'ОҚ_501' }, bank).studentCode, 'ОҚ_501');
});

test('start rejects client-supplied score and unrecognized fields', () => {
  assert.throws(() => validateStart({ ...start(), score: 999 }, bank));
  assert.throws(() => validateStart({ ...start(), chatId: 'attacker-chat' }, bank));
});

test('start rejects invalid or unbounded Turnstile token values', () => {
  assert.throws(() => validateStart({ ...start(), turnstileToken: {} }, bank));
  assert.throws(() => validateStart({ ...start(), turnstileToken: 'X'.repeat(10000) }, bank));
});

test('submission accepts known answer IDs and unanswered questions', () => {
  assert.deepEqual(validateSubmission({ answers: { 'fixture-q1': 'A' } }, quiz), { 'fixture-q1': 'A' });
  assert.deepEqual(validateSubmission({ answers: {} }, quiz), {});
});

for (const body of [null, [], {}, { answers: null }, { answers: [] }, { answers: 'A' }]) {
  test(`submission rejects malformed answers ${JSON.stringify(body)}`, () => {
    assert.throws(() => validateSubmission(body, quiz));
  });
}

test('submission rejects unknown questions and options', () => {
  assert.throws(() => validateSubmission({ answers: { 'unpublished-question': 'A' } }, quiz));
  assert.throws(() => validateSubmission({ answers: { 'fixture-q1': 'C' } }, quiz));
  assert.throws(() => validateSubmission({ answers: { 'fixture-q1': 0 } }, quiz));
});

test('submission rejects a forged score and a substituted quiz ID', () => {
  assert.throws(() => validateSubmission({ answers: {}, score: 999 }, quiz));
  assert.throws(() => validateSubmission({ answers: {}, quizId: 'other-test' }, quiz));
});

test('server scoring uses the official bank key and question weights', () => {
  const result = scoreQuiz(quiz, { 'fixture-q1': 'A', 'fixture-q2': 'B' });
  assert.equal(result.score, 3);
  assert.equal(result.maxScore, 3);
  assert.equal(result.correctCount, 2);
  assert.equal(result.questionCount, 2);
});

test('wrong or absent answers earn no points', () => {
  const blank = scoreQuiz(quiz, {});
  assert.equal(blank.score, 0);
  assert.equal(blank.correctCount, 0);
  assert.equal(blank.maxScore, 3);
  const partial = scoreQuiz(quiz, { 'fixture-q1': 'B', 'fixture-q2': 'B' });
  assert.equal(partial.score, 2);
  assert.equal(partial.correctCount, 1);
});

test('validation and scoring do not modify submitted answers or the bank', () => {
  const before = structuredClone(quiz);
  const input = { answers: { 'fixture-q1': 'A' } };
  const originalInput = structuredClone(input);
  scoreQuiz(quiz, validateSubmission(input, quiz));
  publicQuiz(quiz);
  assert.deepEqual(quiz, before);
  assert.deepEqual(input, originalInput);
});

test('public quiz has no private answer-key fields and preserves question text', () => {
  const result = publicQuiz(quiz);
  assert.equal(result.questions.length, quiz.questions.length);
  assert.equal(result.questionCount, quiz.questions.length);
  assert.equal(result.maxScore, 3);
  assert.equal(JSON.stringify(result).includes('correctOptionId'), false);
  assert.equal(result.questions[0].text, quiz.questions[0].text);
  assert.deepEqual(result.questions[0].options, quiz.questions[0].options);
  assert.deepEqual(result.questions[0].source, quiz.questions[0].source);
});

test('server refuses a broken bank key rather than grading against a guessed answer', () => {
  const invalid = structuredClone(quiz);
  invalid.questions[0].correctOptionId = 'MISSING';
  assert.throws(() => scoreQuiz(invalid, {}), error => error.status === 503);
});

for (const points of [-1, 0, 0.5, '1']) {
  test(`server refuses invalid question weights ${JSON.stringify(points)}`, () => {
    const invalid = structuredClone(quiz);
    invalid.questions[0].points = points;
    assert.throws(() => scoreQuiz(invalid, {}), error => error.status === 503);
  });
}

const attempt = {
  id: 'fixture-attempt-only',
  student_code: 'ST_5-001',
  grade: 5,
  quiz_title: 'Synthetic unit-test fixture only',
  score: 2,
  max_score: 3,
  correct_count: 1,
  question_count: 2,
  started_at: 1_700_000_000_000,
  submitted_at: 1_700_000_125_000,
};

test('teacher notification includes only the actual server result and student code', () => {
  const message = formatTelegramMessage(attempt);
  for (const expected of ['ST_5-001', 'Сынып: 5', '2 / 3 (67%)', '1 / 2',
    '2 мин 5 с', 'fixture-attempt-only']) {
    assert.ok(message.includes(expected), expected);
  }
  assert.ok(message.includes('дайындық нәтижесі'));
});

test('notification normalizes line breaks and does not leak unrelated secret fields', () => {
  const message = formatTelegramMessage({
    ...attempt,
    student_code: 'A\nB',
    quiz_title: 'Fixture\r\ncontinued',
    bot_token: 'TEST_ONLY_SECRET_SENTINEL',
    answers: { 'fixture-q1': 'A' },
  });
  assert.ok(message.includes('Оқушы коды: A B\n'));
  assert.ok(message.includes('Тест: Fixture  continued\n'));
  assert.equal(message.includes('TEST_ONLY_SECRET_SENTINEL'), false);
  assert.equal(message.includes('fixture-q1'), false);
});

test('zero maximum and negative elapsed time remain finite in a notification', () => {
  const message = formatTelegramMessage({ ...attempt, score: 0, max_score: 0,
    submitted_at: attempt.started_at - 1000 });
  assert.ok(message.includes('0 / 0 (0%)'));
  assert.ok(message.includes('0 мин 0 с'));
  assert.equal(/NaN|Infinity/.test(message), false);
});
