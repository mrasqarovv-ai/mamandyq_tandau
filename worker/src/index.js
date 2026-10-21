import { quizzes } from './quiz-bank.js';
import { ApiError, validateStart, validateSubmission, scoreQuiz, publicQuiz, formatTelegramMessage } from './core.js';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_DELIVERIES = 5;
const DAY = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const quizMap = new Map(quizzes.map(quiz => [quiz.id, quiz]));

function development(env) { return env.ENVIRONMENT === 'development'; }
function origins(env) { return String(env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean); }
function configured(env) {
  return { database: Boolean(env.DB), quizBank: quizzes.length > 0,
    telegram: Boolean(env.BOT_TOKEN && env.TEACHER_CHAT_ID),
    turnstile: Boolean(env.TURNSTILE_SECRET_KEY), environment: development(env) ? 'development' : 'production' };
}
function response(data, status, request, env) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
  const origin = request.headers.get('Origin');
  if (origin && origins(env).includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}
function requireOrigin(request, env) {
  if (!origins(env).includes(request.headers.get('Origin'))) {
    throw new ApiError(403, 'origin_not_allowed', 'Бұл сайттан сұрау қабылданбайды.');
  }
}
function requireDatabase(env) {
  if (!env.DB) throw new ApiError(503, 'database_not_configured', 'Нәтижелер сервері әлі бапталмаған.');
}
async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw new ApiError(415, 'json_required', 'JSON пішімі қажет.');
  }
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large', 'Сұрау тым үлкен.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_json', 'Сұрау бос.');
  const parts = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(413, 'body_too_large', 'Сұрау тым үлкен.'); }
      parts.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_json', 'JSON мәтіні жарамсыз.');
  }
}
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function verifyTurnstile(token, request, env) {
  if (development(env)) return;
  if (!env.TURNSTILE_SECRET_KEY) throw new ApiError(503, 'turnstile_not_configured', 'Мұғалімге жіберу қызметінің қорғанысы әлі бапталмаған.');
  if (!token) throw new ApiError(400, 'captcha_required', 'Қорғаныс тексеруін өтіңіз.');
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.set('remoteip', ip);
  let result;
  try {
    const checked = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form, signal: AbortSignal.timeout(8000),
    });
    if (!checked.ok) throw new Error('verification_unavailable');
    result = await checked.json();
  } catch { throw new ApiError(503, 'captcha_unavailable', 'Қорғаныс қызметі қолжетімсіз. Кейін қайталаңыз.'); }
  const hostname = new URL(request.headers.get('Origin')).hostname;
  if (!result.success || result.hostname !== hostname || result.action !== 'start_test') {
    throw new ApiError(403, 'captcha_failed', 'Қорғаныс тексеруі өтпеді. Қайта тексеріңіз.');
  }
}
async function consumeQuota(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || (development(env) ? 'local-development' : '');
  if (!ip) throw new ApiError(403, 'client_network_unavailable', 'Қосылу деректерін тексеру мүмкін болмады.');
  const salt = env.TURNSTILE_SECRET_KEY || env.BOT_TOKEN || 'local-development';
  const hash = await sha256(`${salt}:${ip}`);
  const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const row = await env.DB.prepare(`INSERT INTO rate_limits (ip_hash, hour_bucket, count) VALUES (?, ?, 1)
    ON CONFLICT(ip_hash, hour_bucket) DO UPDATE SET count = rate_limits.count + 1
    WHERE rate_limits.count < 120 RETURNING count`).bind(hash, bucket).first();
  if (!row) throw new ApiError(429, 'start_rate_limited', 'Бір желіден сағатына 120 тест бастауға болады. Кейін қайталаңыз.');
}
async function telegramRequest(env, method, body) {
  if (!env.BOT_TOKEN) return { ok: false, error: 'telegram_not_configured' };
  try {
    const result = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    const data = await result.json().catch(() => ({}));
    return result.ok && data.ok === true ? { ok: true } : { ok: false, error: `telegram_http_${result.status}` };
  } catch {
    // A fetch exception may contain the token-bearing URL. Never log it.
    return { ok: false, error: 'telegram_transport_error' };
  }
}
async function deliverNotification(env, attemptId) {
  if (!env.BOT_TOKEN || !env.TEACHER_CHAT_ID) return;
  const now = Date.now();
  const lease = await env.DB.prepare(`UPDATE notification_outbox SET status='sending',
      attempts=attempts+1, lease_until=?
    WHERE attempt_id=? AND attempts<? AND next_attempt_at<=?
      AND (status IN ('queued','retry') OR (status='sending' AND lease_until<?))
    RETURNING attempts`).bind(now + 45000, attemptId, MAX_DELIVERIES, now, now).first();
  if (!lease) return;
  const attempt = await env.DB.prepare('SELECT * FROM attempts WHERE id=? AND status=\'submitted\'').bind(attemptId).first();
  if (!attempt) return;
  const sent = await telegramRequest(env, 'sendMessage', {
    chat_id: String(env.TEACHER_CHAT_ID), text: formatTelegramMessage(attempt),
    link_preview_options: { is_disabled: true },
  });
  if (sent.ok) {
    await env.DB.prepare(`UPDATE notification_outbox SET status='sent',sent_at=?,lease_until=0,last_error=NULL
      WHERE attempt_id=? AND status='sending'`).bind(Date.now(), attemptId).run();
  } else {
    const failed = lease.attempts >= MAX_DELIVERIES;
    await env.DB.prepare(`UPDATE notification_outbox SET status=?,next_attempt_at=?,lease_until=0,last_error=?
      WHERE attempt_id=? AND status='sending'`).bind(failed ? 'failed' : 'retry',
      Date.now() + Math.min(3600000, 60000 * 2 ** (lease.attempts - 1)), sent.error, attemptId).run();
  }
}
async function storedResult(env, attempt) {
  const outbox = await env.DB.prepare('SELECT status FROM notification_outbox WHERE attempt_id=?').bind(attempt.id).first();
  const notification = outbox?.status === 'sent' ? 'sent' :
    !env.BOT_TOKEN || !env.TEACHER_CHAT_ID ? 'not_configured' :
    outbox?.status === 'failed' ? 'failed' : 'queued';
  return { attemptId: attempt.id, quizId: attempt.quiz_id, score: attempt.score,
    maxScore: attempt.max_score, correctCount: attempt.correct_count,
    questionCount: attempt.question_count, submittedAt: new Date(attempt.submitted_at).toISOString(), notification };
}
async function startAttempt(request, env) {
  requireOrigin(request, env); requireDatabase(env);
  const input = validateStart(await readBody(request), quizMap);
  await verifyTurnstile(input.turnstileToken, request, env);
  await consumeQuota(request, env);
  const quiz = quizMap.get(input.quizId);
  const maxScore = scoreQuiz(quiz, {}).maxScore;
  const now = Date.now(), expires = now + Math.max(1, Math.min(180, quiz.durationMinutes || 30)) * 60000;
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO attempts
    (id,quiz_id,quiz_title,quiz_version,student_code,grade,started_at,expires_at,max_score,question_count)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id, quiz.id, quiz.title, await sha256(JSON.stringify(quiz)),
    input.studentCode, input.grade, now, expires, maxScore, quiz.questions.length).run();
  return response({ attemptId: id, startedAt: new Date(now).toISOString(),
    expiresAt: new Date(expires).toISOString(), quiz: publicQuiz(quiz) }, 201, request, env);
}
async function submitAttempt(request, env, id) {
  requireOrigin(request, env); requireDatabase(env);
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new ApiError(404, 'attempt_not_found', 'Тест сессиясы табылмады.');
  const body = await readBody(request);
  let attempt = await env.DB.prepare('SELECT * FROM attempts WHERE id=?').bind(id).first();
  if (!attempt) throw new ApiError(404, 'attempt_not_found', 'Тест сессиясы табылмады.');
  if (attempt.status === 'submitted') return response(await storedResult(env, attempt), 200, request, env);
  const quiz = quizMap.get(attempt.quiz_id);
  if (!quiz || attempt.quiz_version !== await sha256(JSON.stringify(quiz))) {
    throw new ApiError(409, 'quiz_updated', 'Тест жаңартылған. Жаңа сессияны бастаңыз.');
  }
  const answers = validateSubmission(body, quiz);
  const now = Date.now();
  if (now > attempt.expires_at + 60000) throw new ApiError(410, 'attempt_expired', 'Тест уақыты аяқталған. Жаңа сессияны бастаңыз.');
  const result = scoreQuiz(quiz, answers);
  await env.DB.batch([
    env.DB.prepare(`UPDATE attempts SET status='submitted',submitted_at=?,score=?,correct_count=?
      WHERE id=? AND status='started' AND expires_at>=?`).bind(now, result.score, result.correctCount, id, now - 60000),
    env.DB.prepare(`INSERT OR IGNORE INTO notification_outbox (attempt_id)
      SELECT id FROM attempts WHERE id=? AND status='submitted'`).bind(id),
  ]);
  attempt = await env.DB.prepare('SELECT * FROM attempts WHERE id=?').bind(id).first();
  if (attempt.status !== 'submitted') throw new ApiError(410, 'attempt_expired', 'Тест уақыты аяқталған.');
  await deliverNotification(env, id);
  return response(await storedResult(env, attempt), 200, request, env);
}
function equalSecret(actual, expected) {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
async function telegramWebhook(request, env) {
  if (!equalSecret(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) {
    throw new ApiError(403, 'webhook_not_allowed', 'Қолжетімсіз.');
  }
  const update = await readBody(request);
  const message = update?.message;
  if (String(message?.chat?.id || '') === String(env.TEACHER_CHAT_ID || '') &&
      typeof message?.text === 'string' && /^\/(start|help)(?:@\w+)?(?:\s|$)/.test(message.text)) {
    // Only the configured teacher receives responses. Student/group messages are ignored.
    await telegramRequest(env, 'sendMessage', { chat_id: String(env.TEACHER_CHAT_ID),
      text: 'Өрлеу боты іске қосылған. Оқушы сайттағы мұғалімге жіберу режимінде тестті аяқтағанда, сервер есептеген балл осы чатқа келеді. Жеке дайындық режимі хабарлама жібермейді.' });
  }
  return response({ ok: true }, 200, request, env);
}

export default {
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname;
      if (request.method === 'OPTIONS') {
        requireOrigin(request, env);
        return new Response(null, { status: 204, headers: {
          'Access-Control-Allow-Origin': request.headers.get('Origin'),
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', 'Vary': 'Origin',
        } });
      }
      if (path === '/api/health' && request.method === 'GET') {
        const configuration = configured(env);
        let migrated = false;
        if (env.DB) { try { await env.DB.prepare('SELECT id FROM attempts LIMIT 1').first(); migrated = true; } catch { /* Readiness includes migration. */ } }
        return response({ ok: true, service: 'orleu-results-bot',
          ready: migrated && configuration.quizBank && configuration.telegram && (development(env) || configuration.turnstile),
          configuration: { ...configuration, database: migrated } }, 200, request, env);
      }
      if (path === '/api/quizzes' && request.method === 'GET') {
        return response({ quizzes: quizzes.map(publicQuiz) }, 200, request, env);
      }
      if (path === '/api/telegram/webhook' && request.method === 'POST') return await telegramWebhook(request, env);
      if (path === '/api/attempts/start' && request.method === 'POST') return await startAttempt(request, env);
      const submit = path.match(/^\/api\/attempts\/([^/]+)\/submit$/);
      if (submit && request.method === 'POST') return await submitAttempt(request, env, submit[1]);
      throw new ApiError(404, 'not_found', 'Бет табылмады.');
    } catch (error) {
      if (error instanceof ApiError) return response({ error: error.code, message: error.message }, error.status, request, env);
      // Never include raw DB/fetch errors, request data or token-bearing URLs.
      return response({ error: 'service_unavailable', message: 'Нәтижелер қызметі уақытша қолжетімсіз. Жауаптарыңызды сақтап, қайта жіберіңіз.' }, 503, request, env);
    }
  },
  async scheduled(_controller, env) {
    if (!env.DB) return;
    const now = Date.now();
    await env.DB.prepare(`UPDATE notification_outbox SET status='failed',lease_until=0,
      last_error='delivery_retry_limit' WHERE status='sending' AND attempts>=? AND lease_until<?`)
      .bind(MAX_DELIVERIES, now).run();
    if (env.BOT_TOKEN && env.TEACHER_CHAT_ID) {
      const rows = await env.DB.prepare(`SELECT attempt_id FROM notification_outbox
        WHERE attempts<? AND next_attempt_at<=?
          AND (status IN ('queued','retry') OR (status='sending' AND lease_until<?))
        ORDER BY next_attempt_at LIMIT 10`).bind(MAX_DELIVERIES, now, now).all();
      for (const item of rows.results || []) await deliverNotification(env, item.attempt_id);
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM rate_limits WHERE hour_bucket<?').bind(Math.floor(now / 3600000) - 48),
      env.DB.prepare('DELETE FROM notification_outbox WHERE attempt_id IN (SELECT id FROM attempts WHERE started_at<?)').bind(now - 30 * DAY),
      env.DB.prepare('DELETE FROM attempts WHERE started_at<?').bind(now - 30 * DAY),
    ]);
  },
};
