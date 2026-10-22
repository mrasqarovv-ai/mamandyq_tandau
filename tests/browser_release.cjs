/* Full browser release check. Run against the static HTTP server:
 * RELEASE_BASE_URL=http://127.0.0.1:8000 node tests/browser_release.cjs
 * Install Playwright separately or set PLAYWRIGHT_MODULE to its module path.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch { playwright = require('/workspace/.daryn-test/node_modules/playwright'); }
const ROOT = path.resolve(__dirname, '..');
const archive = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/archive.json')));
const tasks = archive.documents.filter(document => document.materialType === 'tasks');
const quizzes = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/quizzes.json'))).quizzes;
const keys = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/practice-keys.json')));
const base = (process.env.RELEASE_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '') + '/';
const artifacts = process.env.RELEASE_ARTIFACT_DIR;
const errors = [];
const requests = [];
const started = Date.now();

function observe(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
}
async function ready(page) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-quiz-choose]').first().waitFor();
  await page.waitForFunction(() => Boolean(window.ORLEU_ASSIGNMENTS));
  await page.locator('#assignment-app .assignment-card, #assignment-answer').first().waitFor();
}
async function newPage(browser, width = 1440, script, scriptArgument) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  if (script) await context.addInitScript(script, scriptArgument);
  const page = await context.newPage();
  observe(page);
  await ready(page);
  return { context, page };
}
async function beginQuiz(page, quiz) {
  await page.locator(`[data-quiz-choose="${quiz.id}"]`).click();
  assert.equal(await page.locator('[name="quiz-mode"][value="teacher"]').count(), 0);
  await page.locator('#quiz-start-button').click();
  await page.locator('#quiz-clock-value').waitFor();
}
async function finishQuiz(page) {
  await page.locator('#quiz-request-finish').click();
  await page.locator('#quiz-confirm-finish').click();
  await page.locator('.quiz-result-score').waitFor();
}
async function chooseAnswers(page, quiz, choose) {
  for (let index = 0; index < quiz.questions.length; index++) {
    const question = quiz.questions[index];
    await page.locator(`[data-quiz-question="${index}"]`).click();
    const answer = choose(question, index);
    if (answer) await page.locator(`[name="quiz-answer"][value="${answer}"]`).check();
  }
}
async function noOverflow(page, label) {
  const sizes = await page.evaluate(() => ({ viewport: innerWidth,
    html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(sizes.html <= sizes.viewport + 1 && sizes.body <= sizes.viewport + 1,
    `${label}: horizontal page overflow ${JSON.stringify(sizes)}`);
}
async function screenshot(page, name) {
  if (!artifacts) return;
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true });
}

async function verifyOriginalDownloads(browser) {
  const context = await browser.newContext();
  for (const document of archive.documents) {
    const response = await context.request.get(new URL(document.fileUrl, base).href);
    assert.equal(response.status(), 200, `Original ${document.id}`);
    const digest = crypto.createHash('sha256').update(await response.body()).digest('hex');
    assert.equal(digest, document.sha256, `Original SHA-256 ${document.id}`);
  }
  for (const file of ['downloads/daryn-archive.docx', 'data/coverage.csv', 'data/sources.json']) {
    const response = await context.request.get(new URL(file, base).href);
    assert.equal(response.status(), 200, file);
    assert.ok((await response.body()).length > 100, `Empty download ${file}`);
  }
  await context.close();
  console.log('PASS HTTP: 25 original checksums, Word and source/coverage downloads');
}

async function verifyOfficialQuizzes(browser) {
  assert.equal(quizzes.length, 6);
  await Promise.all(quizzes.map(async quiz => {
    const { context, page } = await newPage(browser);
    await beginQuiz(page, quiz);
    await chooseAnswers(page, quiz, question => keys[quiz.id][question.id]);
    assert.equal(await page.locator('.quiz-question-grid .answered').count(), 30);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#quiz-clock-value').waitFor();
    assert.equal(await page.locator('.quiz-question-grid .answered').count(), 30);
    await finishQuiz(page);
    assert.equal(await page.locator('.quiz-result-score strong').textContent(), '50');
    assert.match(await page.locator('.quiz-result-score').textContent(), /50\s*\/\s*50/);
    await page.locator('#quiz-review').click();
    assert.equal(await page.locator('.quiz-review-question.is-correct').count(), 30);
    assert.equal(await page.locator('.official-correct').count(), 30);
    assert.equal(await page.locator('#quiz-review-panel .quiz-source-table').count(),
      quiz.questions.filter(question => question.sourceTable).length);
    await page.locator('#quiz-source-links a').first().waitFor();
    assert.equal(await page.locator('#quiz-source-links a').count(),
      quiz.sourceDocumentIds.length + quiz.answerSourceIds.length);
    if (quiz.sourceNote || quiz.sourceNotes) assert.ok(await page.locator('.quiz-source-note').count());
    assert.match(await page.locator('.quiz-notification').textContent(), /жіберілген жоқ/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.quiz-history').waitFor();
    assert.match(await page.locator('.quiz-history').textContent(), /50\s*\/\s*50/);
    await context.close();
  }));
  const quiz = quizzes[0];
  for (const mode of ['wrong', 'empty', 'mixed']) {
    const { context, page } = await newPage(browser);
    await beginQuiz(page, quiz);
    if (mode !== 'empty') await chooseAnswers(page, quiz, (question, index) => {
      if (mode === 'mixed') return [0, 15, 25].includes(index) ? keys[quiz.id][question.id] : null;
      return question.options.find(option => option.id !== keys[quiz.id][question.id]).id;
    });
    await finishQuiz(page);
    assert.equal(await page.locator('.quiz-result-score strong').textContent(), mode === 'mixed' ? '6' : '0');
    await page.locator('#quiz-review').click();
    assert.equal(await page.locator('.quiz-review-question.is-correct').count(), mode === 'mixed' ? 3 : 0);
    await context.close();
  }
  const { context, page } = await newPage(browser);
  await page.clock.install();
  await beginQuiz(page, quiz);
  await page.clock.fastForward(quiz.durationMinutes * 60000 + 1000);
  await page.locator('.quiz-result-score').waitFor();
  assert.equal(await page.locator('.quiz-result-score strong').textContent(), '0');
  assert.match(await page.locator('.quiz-result-main').textContent(), /УАҚЫТ АЯҚТАЛДЫ/);
  await context.close();
  console.log('PASS official tests: all 180 answers 50/50, wrong/empty 0/50, weighted 6/50, timer, restore, source tables and review');
}

const PREFIX = 'orleu-history-assignment-v1:';
const answerFor = document => `1 — ${document.id}\n2 — Дерек пен оқиғаны салыстырдым.\n3 — <img src=x onerror="window.answerExecuted=true">`;
const notesFor = document => `Қайта қараған дерегім: ${document.year}. ${document.id}`;
async function openCollection(page, document) {
  await page.evaluate(id => window.ORLEU_ASSIGNMENTS.open(id), document.id);
  await page.locator('#assignment-answer').waitFor();
}
async function assertNotebookHasNoScore(page) {
  assert.equal(await page.locator('#assignment-app .quiz-result-score, #assignment-app #quiz-clock-value, #assignment-app [name="quiz-mode"]').count(), 0);
  assert.equal(await page.locator('#assignment-app .official-correct, #assignment-app .is-correct, #assignment-app .is-incorrect').count(), 0);
  assert.match(await page.locator('.assignment-mode-note').textContent(), /Автоматты балл қойылмайды/);
  assert.equal(await page.evaluate(() => window.answerExecuted), undefined, 'Answer HTML must stay text');
}

async function verifyCollections(browser) {
  const { context, page } = await newPage(browser);
  assert.equal(tasks.length, 18);
  assert.equal(await page.locator('#assignment-app .assignment-card').count(), 18);
  assert.equal(await page.locator('#assignment-app [data-assignment-quiz]').count(), 6);
  for (const grade of [7, 8]) {
    await page.locator(`#assignment-app [data-assignment-grade="${grade}"]`).click();
    assert.equal(await page.locator('#assignment-app .assignment-card').count(), 1);
    assert.match(await page.locator('#assignment-app .assignment-card').textContent(), new RegExp(`${grade}-сынып`));
  }
  await page.locator('#assignment-app [data-assignment-grade=""]').click();
  for (const document of tasks) {
    await page.locator(`#assignment-app [data-assignment-open="${document.id}"]`).click();
    assert.equal(await page.locator('#assignment-answer').inputValue(), '');
    assert.equal(await page.locator('.assignment-text pre').textContent(), document.text,
      `Full exact source text ${document.id}`);
    assert.equal(await page.locator('.assignment-source-links a[download]').getAttribute('href'), document.fileUrl);
    assert.equal(await page.locator(`.assignment-source-links a[href="${document.sourcePage}"]`).count(), 1);
    assert.equal(await page.locator(`.assignment-source-links a[href="${document.sourceUrl}"]`).count(), 1);
    assert.equal(await page.locator('.assignment-pdf').count(), document.format === 'pdf' ? 1 : 0);
    if (document.format === 'pdf') assert.equal(await page.locator('.assignment-pdf').getAttribute('src'), document.fileUrl);
    await page.locator('#assignment-answer').fill(answerFor(document));
    await page.locator('#assignment-notes').fill(notesFor(document));
    await page.locator('#assignment-self-check').selectOption('checked');
    await page.locator('#assignment-complete').click();
    assert.match(await page.locator('#assignment-save-status').textContent(), /браузерде сақталды/);
    await page.locator('#assignment-review-tab').click();
    assert.equal(await page.locator('#assignment-answer-preview').textContent(), answerFor(document));
    await assertNotebookHasNoScore(page);
    const record = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), PREFIX + document.id);
    assert.equal(record.answer, answerFor(document));
    assert.equal(record.notes, notesFor(document));
    assert.equal(record.status, 'completed');
    assert.equal(record.check, 'checked');
    for (const key of ['score', 'maxScore', 'correctCount', 'correctOptionId', 'notification']) assert.ok(!(key in record), `No generated ${key}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#assignment-answer').waitFor();
    assert.equal(await page.locator('#assignment-answer').inputValue(), answerFor(document));
    assert.equal(await page.locator('#assignment-notes').inputValue(), notesFor(document));
    assert.equal(await page.locator('#assignment-self-check').inputValue(), 'checked');
    assert.match(await page.locator('#assignment-work-status').textContent(), /Аяқталды/);
    await page.locator('#assignment-return').click();
  }
  assert.equal(await page.locator('.quiz-history').count(), 0, 'Notebooks do not create scored results');
  assert.equal(await page.locator('#assignment-app .assignment-progress').filter({ hasText: 'Аяқталды' }).count(), 18);
  const document = tasks.find(task => task.grade === 7);
  // Archive card and reader entry points must lead into the same saved work.
  await page.locator('#archive [data-grade="7"]').click();
  await page.locator(`#document-list [data-assignment-open="${document.id}"]`).click();
  assert.equal(await page.locator('#assignment-answer').inputValue(), answerFor(document));
  await page.locator('#archive [data-grade="8"]').click();
  const grade8 = tasks.find(task => task.grade === 8);
  await page.locator(`#document-list [data-open="${grade8.id}"]`).click();
  await page.locator(`#reader-dialog [data-assignment-open="${grade8.id}"]`).click();
  assert.equal(await page.locator('#reader-dialog').getAttribute('open'), null);
  assert.equal(await page.locator('#assignment-answer').inputValue(), answerFor(grade8));
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#assignment-download').click();
  const download = await downloadPromise;
  const downloaded = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(downloaded.includes(answerFor(grade8)) && downloaded.includes(notesFor(grade8)));
  assert.match(downloaded, /Автоматты балл қойылмаған/);
  // Editing after manual review must reset the learner's previous check mark.
  await page.locator('#assignment-answer').fill(answerFor(grade8) + '\n4 — Жаңа түзету');
  assert.equal(await page.locator('#assignment-self-check').inputValue(), 'pending');
  assert.match(await page.locator('#assignment-work-status').textContent(), /Орындалып жатыр/);
  const second = await context.newPage(); observe(second); await ready(second);
  assert.equal(await second.locator('#assignment-answer').inputValue(), answerFor(grade8) + '\n4 — Жаңа түзету');
  const storageState = await context.storageState();
  await context.close();
  // Restore persisted browser storage in a fresh context, with no in-memory module state.
  const restored = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } });
  const restoredPage = await restored.newPage(); observe(restoredPage); await ready(restoredPage);
  for (const task of tasks) {
    await openCollection(restoredPage, task);
    assert.equal(await restoredPage.locator('#assignment-answer').inputValue(),
      answerFor(task) + (task.id === grade8.id ? '\n4 — Жаңа түзету' : ''));
    assert.equal(await restoredPage.locator('#assignment-notes').inputValue(), notesFor(task));
  }
  await restored.close();
  console.log('PASS 18 collections: exact originals, independent autosave/reload/new-tab/restored browser, manual review, archive/reader entries, export, no automatic scores');
}

async function verifyStorageFailures(browser) {
  const document = tasks.find(task => task.grade === 7);
  const blocked = await newPage(browser, 1440, () => {
    Storage.prototype.setItem = function () { throw new DOMException('Blocked for verification', 'QuotaExceededError'); };
  });
  await openCollection(blocked.page, document);
  await blocked.page.locator('#assignment-answer').fill('1 — Сақтау бұғатталғандағы жауап');
  assert.match(await blocked.page.locator('#assignment-save-status').textContent(), /сақталмады/);
  await blocked.page.locator('#assignment-return').click();
  await openCollection(blocked.page, document);
  assert.equal(await blocked.page.locator('#assignment-answer').inputValue(), '1 — Сақтау бұғатталғандағы жауап');
  assert.match(await blocked.page.locator('#assignment-save-status').textContent(), /сақталмады/,
    'Reopening an unsaved in-memory record must not claim durable saving');
  await blocked.page.locator('#assignment-review-tab').click();
  assert.equal(await blocked.page.locator('#assignment-answer-preview').textContent(), '1 — Сақтау бұғатталғандағы жауап');
  await blocked.context.close();
  const corrupt = await newPage(browser, 1440, ({ key }) => localStorage.setItem(key, '{broken-json'), { key: PREFIX + document.id });
  await openCollection(corrupt.page, document);
  assert.equal(await corrupt.page.locator('#assignment-answer').inputValue(), '');
  assert.match(await corrupt.page.locator('#assignment-save-status').textContent(), /оқу мүмкін болмады/);
  await corrupt.page.locator('#assignment-answer').fill('1 — Қалпына келтірілген жауап');
  assert.match(await corrupt.page.locator('#assignment-save-status').textContent(), /браузерде сақталды/);
  await corrupt.context.close();
  const context = await browser.newContext();
  await context.route('**/data/practice-keys.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  const page = await context.newPage(); observe(page); await ready(page);
  await openCollection(page, document);
  await page.locator('#assignment-answer').fill('Ресми кілт жүктелмесе де орындау ашық.');
  assert.match(await page.locator('#assignment-save-status').textContent(), /браузерде сақталды/);
  await assertNotebookHasNoScore(page);
  await context.close();
  const missingCatalog = await browser.newContext();
  await missingCatalog.route('**/data/quizzes.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  const catalogPage = await missingCatalog.newPage(); observe(catalogPage);
  await catalogPage.goto(base, { waitUntil: 'domcontentloaded' });
  await catalogPage.locator('#assignment-app .assignment-card').first().waitFor();
  assert.equal(await catalogPage.locator('#assignment-app .assignment-card').count(), 18);
  await openCollection(catalogPage, document);
  await catalogPage.locator('#assignment-answer').fill('Тест каталогы жүктелмесе де жинақ ашық.');
  assert.match(await catalogPage.locator('#assignment-save-status').textContent(), /браузерде сақталды/);
  await missingCatalog.close();
  console.log('PASS storage/availability: blocked writes remain visibly unsaved, corrupt data recovery, missing keys/catalog do not block collections');
}

async function verifyResponsive(browser) {
  for (const width of [320, 390, 768, 1440]) {
    const { context, page } = await newPage(browser, width);
    await noOverflow(page, `${width}px home/list`);
    await screenshot(page, `list-${width}`);
    const document = tasks.find(task => task.grade === 7);
    await openCollection(page, document);
    await page.locator('#assignment-answer').fill('1 — Ұзын жауап '.repeat(300));
    await noOverflow(page, `${width}px notebook`);
    await page.locator('#assignment-review-tab').click();
    await noOverflow(page, `${width}px review`);
    await screenshot(page, `review-${width}`);
    const quiz = quizzes.find(item => item.questions.some(question => question.sourceTable)) || quizzes[0];
    await beginQuiz(page, quiz);
    const table = quiz.questions.findIndex(question => question.sourceTable);
    if (table >= 0) await page.locator(`[data-quiz-question="${table}"]`).click();
    await noOverflow(page, `${width}px official quiz/table`);
    await screenshot(page, `quiz-${width}`);
    await finishQuiz(page);
    await page.locator('#quiz-review').click();
    await noOverflow(page, `${width}px scored result/review`);
    await context.close();
  }
  console.log('PASS responsive: list, notebook, manual review, official quiz/table/results at 320/390/768/1440px');
}

async function main() {
  const browser = await playwright.chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    await verifyOriginalDownloads(browser);
    await verifyCollections(browser);
    await verifyStorageFailures(browser);
    await verifyOfficialQuizzes(browser);
    await verifyResponsive(browser);
    assert.deepEqual(errors, [], 'JavaScript page errors');
    assert.equal(requests.filter(url => /\/api\/attempts(?:\/|$)/.test(url)).length, 0,
      'Self practice must not submit teacher attempts');
    console.log(JSON.stringify({ status: 'PASS', finishedAt: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - started) / 1000), collections: tasks.length,
      officialTests: quizzes.length, officialQuestions: 180, jsErrors: errors.length }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
