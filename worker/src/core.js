export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(body, allowed) {
  if (!object(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    throw new ApiError(400, 'invalid_fields', 'Сұрау өрістері жарамсыз.');
  }
}

export function validateStart(body, quizMap) {
  exactFields(body, ['quizId', 'studentCode', 'grade', 'turnstileToken']);
  if (typeof body.quizId !== 'string' || !quizMap.has(body.quizId)) {
    throw new ApiError(404, 'quiz_not_found', 'Тест табылмады.');
  }
  if (typeof body.studentCode !== 'string' ||
      !/^[\p{L}\p{N}_-]{2,30}$/u.test(body.studentCode)) {
    throw new ApiError(400, 'invalid_student_code', 'Оқушы коды 2–30 әріптен, саннан, _ немесе - белгісінен тұруы керек.');
  }
  const quiz = quizMap.get(body.quizId);
  if (!Number.isInteger(body.grade) || body.grade < 5 || body.grade > 8 || body.grade !== quiz.grade) {
    throw new ApiError(400, 'invalid_grade', 'Сынып тест сыныбына сәйкес болуы керек.');
  }
  if (body.turnstileToken !== undefined &&
      (typeof body.turnstileToken !== 'string' || body.turnstileToken.length > 2048)) {
    throw new ApiError(400, 'invalid_captcha', 'Қорғаныс тексеруін қайта өтіңіз.');
  }
  return { quizId: body.quizId, studentCode: body.studentCode, grade: body.grade,
    turnstileToken: body.turnstileToken || '' };
}

export function validateSubmission(body, quiz) {
  exactFields(body, ['answers']);
  if (!object(body.answers)) {
    throw new ApiError(400, 'invalid_answers', 'Жауаптар тізімі жарамсыз.');
  }
  const questions = new Map(quiz.questions.map(question => [question.id, question]));
  const answers = {};
  for (const [id, option] of Object.entries(body.answers)) {
    const question = questions.get(id);
    if (!question || typeof option !== 'string' || !question.options.some(item => item.id === option)) {
      throw new ApiError(400, 'invalid_answer', 'Белгісіз сұрақ немесе жауап нұсқасы.');
    }
    answers[id] = option;
  }
  return answers;
}

export function scoreQuiz(quiz, answers) {
  let score = 0, maxScore = 0, correctCount = 0;
  for (const question of quiz.questions) {
    const points = question.points ?? 1;
    if (!Number.isInteger(points) || points <= 0 ||
        !question.options.some(item => item.id === question.correctOptionId)) {
      throw new ApiError(503, 'invalid_quiz_key', 'Тесттің ресми жауап кілті тексеруді қажет етеді.');
    }
    maxScore += points;
    if (answers[question.id] === question.correctOptionId) {
      score += points;
      correctCount += 1;
    }
  }
  return { score, maxScore, correctCount, questionCount: quiz.questions.length };
}

export function publicQuiz(quiz) {
  return {
    id: quiz.id, title: quiz.title, grade: quiz.grade, subject: quiz.subject,
    year: quiz.year, stage: quiz.stage, language: quiz.language,
    durationMinutes: quiz.durationMinutes,
    sourceDocumentIds: quiz.sourceDocumentIds || [],
    answerSourceIds: quiz.answerSourceIds || [],
    questionCount: quiz.questions.length,
    maxScore: quiz.questions.reduce((sum, question) => sum + (question.points ?? 1), 0),
    questions: quiz.questions.map(question => ({
      id: question.id, number: question.number, text: question.text,
      points: question.points ?? 1,
      options: question.options.map(option => ({ id: option.id, text: option.text })),
      source: question.source,
    })),
  };
}

export function formatTelegramMessage(attempt) {
  const seconds = Math.max(0, Math.round((attempt.submitted_at - attempt.started_at) / 1000));
  const percentage = attempt.max_score ? Math.round(attempt.score * 100 / attempt.max_score) : 0;
  const code = String(attempt.student_code).replace(/[\r\n]/g, ' ').slice(0, 30);
  const title = String(attempt.quiz_title).replace(/[\r\n]/g, ' ').slice(0, 180);
  return [
    'Өрлеу · Жаңа тест нәтижесі',
    `Оқушы коды: ${code}`,
    `Сынып: ${attempt.grade}`,
    `Тест: ${title}`,
    `Балл: ${attempt.score} / ${attempt.max_score} (${percentage}%)`,
    `Дұрыс жауап: ${attempt.correct_count} / ${attempt.question_count}`,
    `Уақыт: ${Math.floor(seconds / 60)} мин ${seconds % 60} с`,
    `Нәтиже ID: ${attempt.id}`,
    'Бұл — дайындық нәтижесі; ресми олимпиада бағасы емес.',
  ].join('\n');
}
