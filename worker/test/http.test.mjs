import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { quizzes } from '../src/quiz-bank.js';

const origin = 'http://127.0.0.1:8000';
const quiz = quizzes[0];
assert.ok(quiz?.questions?.length, 'HTTP tests require the real verified quiz bank');
const migration = readFileSync(new URL('../migrations/0001_results.sql', import.meta.url), 'utf8');

// Exercise the actual migration and SQL with SQLite rather than mocking rows.
class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values);
    return row ? (column ? row[column] : row) : null;
  }
  async all() { return { success: true, results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}
class D1Database {
  constructor() { this.raw = new DatabaseSync(':memory:'); this.raw.exec('PRAGMA foreign_keys=ON;'); this.raw.exec(migration); }
  prepare(sql) { return new D1Statement(this.raw, sql); }
  async batch(statements) {
    this.raw.exec('BEGIN');
    try {
      const results = statements.map(statement => {
        const result = this.raw.prepare(statement.sql).run(...statement.values);
        return { success: true, meta: { changes: Number(result.changes) } };
      });
      this.raw.exec('COMMIT');
      return results;
    } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
  close() { this.raw.close(); }
}
function environment(t, overrides = {}) {
  const DB = new D1Database();
  t.after(() => DB.close());
  return { DB, ENVIRONMENT: 'development', ALLOWED_ORIGINS: origin, ...overrides };
}
function request(path, body, options = {}) {
  return new Request(`https://results.example${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    ...options,
    // Merge headers after other options so callers can override a single header.
    headers: { Origin: origin, 'Content-Type': 'application/json', ...options.headers },
  });
}
const correctAnswers = () => Object.fromEntries(quiz.questions.map(question => [question.id, question.correctOptionId]));
const startBody = () => ({ quizId: quiz.id, studentCode: 'INTEG_501', grade: quiz.grade });
async function start(env) {
  const response = await worker.fetch(request('/api/attempts/start', startBody()), env);
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  return data;
}
async function submit(env, id, answers = correctAnswers()) {
  const response = await worker.fetch(request(`/api/attempts/${id}/submit`, { answers }), env);
  return { response, data: await response.json() };
}
function tableCount(env, table) { return env.DB.raw.prepare(`SELECT count(*) AS count FROM ${table}`).get().count; }

test('health is honest when Telegram secrets have not been supplied', async t => {
  const env = environment(t);
  const response = await worker.fetch(request('/api/health'), env);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.configuration.database, true);
  assert.equal(data.configuration.quizBank, true);
  assert.equal(data.configuration.telegram, false);
  assert.equal(data.ready, false);
  assert.equal(JSON.stringify(data).includes('BOT_TOKEN'), false);
});

test('public HTTP catalog excludes server answer keys', async t => {
  const response = await worker.fetch(request('/api/quizzes'), environment(t));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.quizzes.length, quizzes.length);
  assert.equal(JSON.stringify(data).includes('correctOptionId'), false);
});

test('real SQLite start → submit → replay returns the server score once', async t => {
  const env = environment(t);
  const started = await start(env);
  assert.match(started.attemptId, /^[a-f0-9-]{36}$/i);
  assert.ok(Date.parse(started.expiresAt) > Date.parse(started.startedAt));
  assert.equal(JSON.stringify(started.quiz).includes('correctOptionId'), false);
  const result = await submit(env, started.attemptId);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.score, result.data.maxScore);
  assert.equal(result.data.correctCount, quiz.questions.length);
  assert.equal(result.data.notification, 'not_configured');
  assert.equal(tableCount(env, 'notification_outbox'), 1);
  const replay = await submit(env, started.attemptId, {});
  assert.deepEqual(replay.data, result.data);
  assert.equal(tableCount(env, 'notification_outbox'), 1);
});

test('client cannot forge a grade or an earned score', async t => {
  const env = environment(t);
  const badStart = await worker.fetch(request('/api/attempts/start', { ...startBody(), grade: 8 }), env);
  assert.equal(badStart.status, 400);
  const started = await start(env);
  const forged = await worker.fetch(request(`/api/attempts/${started.attemptId}/submit`, { answers: {}, score: 999 }), env);
  assert.equal(forged.status, 400);
  assert.equal(tableCount(env, 'notification_outbox'), 0);
  const honest = await submit(env, started.attemptId, {});
  assert.equal(honest.response.status, 200);
  assert.equal(honest.data.score, 0);
});

test('unknown origins cannot create or submit attempts', async t => {
  const env = environment(t);
  const denied = await worker.fetch(request('/api/attempts/start', startBody(), { headers: { Origin: 'https://untrusted.example' } }), env);
  assert.equal(denied.status, 403);
  assert.equal(tableCount(env, 'attempts'), 0);
  const allowed = await start(env);
  const deniedSubmit = await worker.fetch(request(`/api/attempts/${allowed.attemptId}/submit`, { answers: correctAnswers() }, { headers: { Origin: 'https://untrusted.example' } }), env);
  assert.equal(deniedSubmit.status, 403);
  assert.equal(tableCount(env, 'notification_outbox'), 0);
});

test('allowed preflight returns the exact origin and rejects an unknown origin', async t => {
  const env = environment(t);
  const accepted = await worker.fetch(request('/api/attempts/start', undefined, { method: 'OPTIONS' }), env);
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get('Access-Control-Allow-Origin'), origin);
  const denied = await worker.fetch(request('/api/attempts/start', undefined, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } }), env);
  assert.equal(denied.status, 403);
});

test('production cannot bypass missing Turnstile configuration', async t => {
  const env = environment(t, { ENVIRONMENT: 'production' });
  const response = await worker.fetch(request('/api/attempts/start', startBody()), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'turnstile_not_configured');
  assert.equal(tableCount(env, 'attempts'), 0);
});

test('production verifies Turnstile host and action, not merely success', async t => {
  const env = environment(t, { ENVIRONMENT: 'production', TURNSTILE_SECRET_KEY: 'TEST_ONLY_NOT_REAL' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, hostname: 'wrong.example', action: 'start_test' }));
  const response = await worker.fetch(request('/api/attempts/start', { ...startBody(), turnstileToken: 'test-only-token' }, { headers: { 'CF-Connecting-IP': '192.0.2.1' } }), env);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'captcha_failed');
});

test('production starts a real attempt after valid Turnstile verification', async t => {
  const env = environment(t, { ENVIRONMENT: 'production', TURNSTILE_SECRET_KEY: 'TEST_ONLY_NOT_REAL' });
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    return Response.json({ success: true, hostname: '127.0.0.1', action: 'start_test' });
  });
  const response = await worker.fetch(request('/api/attempts/start', { ...startBody(), turnstileToken: 'test-only-token' }, { headers: { 'CF-Connecting-IP': '192.0.2.1' } }), env);
  assert.equal(response.status, 201);
  const savedRate = env.DB.raw.prepare('SELECT * FROM rate_limits').get();
  assert.match(savedRate.ip_hash, /^[a-f0-9]{64}$/);
  assert.equal(savedRate.ip_hash.includes('192.0.2.1'), false);
});

test('streamed body over 16 KiB is rejected even without Content-Length', async t => {
  const env = environment(t);
  const response = await worker.fetch(request('/api/attempts/start', JSON.stringify({ content: 'X'.repeat(16 * 1024 + 1) })), env);
  assert.equal(response.status, 413);
  assert.equal(tableCount(env, 'attempts'), 0);
});

test('non-JSON and malformed JSON bodies are rejected before persistence', async t => {
  const env = environment(t);
  const wrongType = await worker.fetch(request('/api/attempts/start', startBody(), { headers: { 'Content-Type': 'text/plain' } }), env);
  assert.equal(wrongType.status, 415);
  const malformed = await worker.fetch(request('/api/attempts/start', '{"bad":'), env);
  assert.equal(malformed.status, 400);
  assert.equal(tableCount(env, 'attempts'), 0);
});

test('expired attempts cannot be graded or put into the notification queue', async t => {
  const env = environment(t);
  const attempt = await start(env);
  env.DB.raw.prepare('UPDATE attempts SET expires_at=? WHERE id=?').run(Date.now() - 61000, attempt.attemptId);
  const result = await submit(env, attempt.attemptId);
  assert.equal(result.response.status, 410);
  assert.equal(tableCount(env, 'notification_outbox'), 0);
});

test('hourly quota is atomic and retains no raw IP address', async t => {
  const env = environment(t);
  for (let index = 0; index < 120; index++) await start(env);
  const denied = await worker.fetch(request('/api/attempts/start', startBody()), env);
  assert.equal(denied.status, 429);
  assert.equal(tableCount(env, 'attempts'), 120);
  assert.equal(env.DB.raw.prepare('SELECT count FROM rate_limits').get().count, 120);
});

test('successful Telegram delivery is marked sent and replay sends no second message', async t => {
  const env = environment(t, { BOT_TOKEN: 'TEST_ONLY_NOT_REAL', TEACHER_CHAT_ID: '123456' });
  let messages = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(url.startsWith('https://api.telegram.org/bot'));
    assert.ok(url.endsWith('/sendMessage'));
    const body = JSON.parse(options.body);
    assert.equal(body.chat_id, '123456');
    assert.equal(body.parse_mode, undefined);
    assert.ok(body.text.includes('INTEG_501'));
    messages++;
    return Response.json({ ok: true });
  });
  const attempt = await start(env);
  const result = await submit(env, attempt.attemptId);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.notification, 'sent');
  assert.equal(messages, 1);
  assert.equal(env.DB.raw.prepare('SELECT status,attempts FROM notification_outbox').get().status, 'sent');
  const replay = await submit(env, attempt.attemptId, {});
  assert.equal(replay.data.notification, 'sent');
  assert.equal(messages, 1);
});

test('Telegram failure stays queued for a cron retry instead of claiming delivery', async t => {
  const env = environment(t, { BOT_TOKEN: 'TEST_ONLY_NOT_REAL', TEACHER_CHAT_ID: '123456' });
  let succeeds = false, calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return succeeds ? Response.json({ ok: true }) : Response.json({ ok: false }, { status: 503 });
  });
  const attempt = await start(env);
  const result = await submit(env, attempt.attemptId);
  assert.equal(result.data.notification, 'queued');
  let row = env.DB.raw.prepare('SELECT * FROM notification_outbox').get();
  assert.equal(row.status, 'retry');
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, 'telegram_http_503');
  succeeds = true;
  env.DB.raw.prepare('UPDATE notification_outbox SET next_attempt_at=0').run();
  await worker.scheduled({}, env);
  row = env.DB.raw.prepare('SELECT * FROM notification_outbox').get();
  assert.equal(row.status, 'sent');
  assert.equal(row.attempts, 2);
  assert.equal(calls, 2);
});

test('outbox stops after five failures and does not leak a token-bearing exception', async t => {
  const env = environment(t, { BOT_TOKEN: 'TEST_ONLY_NOT_REAL', TEACHER_CHAT_ID: '123456' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('https://api.telegram.org/botTEST_ONLY_NOT_REAL/sendMessage'); });
  const attempt = await start(env);
  await submit(env, attempt.attemptId);
  env.DB.raw.prepare("UPDATE notification_outbox SET attempts=4,status='retry',next_attempt_at=0").run();
  await worker.scheduled({}, env);
  const row = env.DB.raw.prepare('SELECT * FROM notification_outbox').get();
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 5);
  assert.equal(row.last_error, 'telegram_transport_error');
  assert.equal(JSON.stringify(row).includes('TEST_ONLY_NOT_REAL'), false);
  await worker.scheduled({}, env);
  assert.equal(calls, 2);
});

test('webhook rejects an invalid secret and ignores non-teacher chats', async t => {
  const env = environment(t, { BOT_TOKEN: 'TEST_ONLY_NOT_REAL', TEACHER_CHAT_ID: '123456', TELEGRAM_WEBHOOK_SECRET: 'TEST_ONLY_WEBHOOK_SECRET' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ ok: true }); });
  const denied = await worker.fetch(request('/api/telegram/webhook', { message: { chat: { id: 123456 }, text: '/start' } }), env);
  assert.equal(denied.status, 403);
  const ignored = await worker.fetch(request('/api/telegram/webhook', { message: { chat: { id: 999999 }, text: '/start' } }, { headers: { 'X-Telegram-Bot-Api-Secret-Token': 'TEST_ONLY_WEBHOOK_SECRET' } }), env);
  assert.equal(ignored.status, 200);
  assert.equal(calls, 0);
  const accepted = await worker.fetch(request('/api/telegram/webhook', { message: { chat: { id: 123456 }, text: '/start' } }, { headers: { 'X-Telegram-Bot-Api-Secret-Token': 'TEST_ONLY_WEBHOOK_SECRET' } }), env);
  assert.equal(accepted.status, 200);
  assert.equal(calls, 1);
});

test('concurrent submissions persist one result and lease one Telegram delivery', async t => {
  const env = environment(t, { BOT_TOKEN: 'TEST_ONLY_NOT_REAL', TEACHER_CHAT_ID: '123456' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return Response.json({ ok: true });
  });
  const attempt = await start(env);
  const [first, second] = await Promise.all([
    submit(env, attempt.attemptId, correctAnswers()),
    submit(env, attempt.attemptId, {}),
  ]);
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(first.data.score, second.data.score);
  assert.equal(tableCount(env, 'notification_outbox'), 1);
  assert.equal(calls, 1);
  assert.equal(env.DB.raw.prepare('SELECT status FROM notification_outbox').get().status, 'sent');
});

test('scheduled retention removes old attempts and outbox rows while preserving recent data', async t => {
  const env = environment(t);
  const old = await start(env);
  await submit(env, old.attemptId, {});
  const recent = await start(env);
  await submit(env, recent.attemptId, {});
  env.DB.raw.prepare('UPDATE attempts SET started_at=? WHERE id=?')
    .run(Date.now() - 31 * 24 * 60 * 60 * 1000, old.attemptId);
  await worker.scheduled({}, env);
  assert.equal(tableCount(env, 'attempts'), 1);
  assert.equal(tableCount(env, 'notification_outbox'), 1);
  assert.equal(env.DB.raw.prepare('SELECT id FROM attempts').get().id, recent.attemptId);
});
