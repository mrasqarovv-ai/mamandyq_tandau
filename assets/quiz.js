(() => {
  'use strict';

  const root = document.getElementById('quiz-app');
  if (!root) return;
  // Frequent timer changes should not announce the entire app every second.
  root.removeAttribute('aria-live');

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const HISTORY_KEY = 'orleu-kazakhstan-history-results-v1';
  const ACTIVE_KEY = 'orleu-kazakhstan-history-active-v1';
  const configuration = window.ORLEU_CONFIG || {};
  let apiBase = '';
  try {
    const url = new URL(String(configuration.apiBaseUrl || ''));
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      apiBase = url.href.replace(/\/$/, '').replace(/\/api$/, '');
    }
  } catch { /* An absent API configuration means local self-practice. */ }
  const teacherAvailable = Boolean(apiBase && String(configuration.turnstileSiteKey || '').trim());
  const state = { quizzes: [], keys: {}, current: null, position: 0, answers: {}, mode: 'self', status: 'loading', result: null, error: '', confirm: false, turnstileToken: '' };
  let interval, challengeWidget, challengePromise, sourceDocuments;

  function readHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value.filter(item => state.quizzes.some(quiz => quiz.id === item.quizId)).slice(0, 25) : [];
    } catch { return []; }
  }

  function saveActive() {
    if (!state.current || !['active', 'submitting', 'submission-error'].includes(state.status)) return;
    try {
      sessionStorage.setItem(ACTIVE_KEY, JSON.stringify({
        quizId: state.current.id, mode: state.mode, answers: state.answers,
        startedAt: state.startedAt, expiresAt: state.expiresAt,
        attemptId: state.attemptId || null, position: state.position
      }));
    } catch { /* The current page remains usable without session storage. */ }
  }

  function clearActive() {
    try { sessionStorage.removeItem(ACTIVE_KEY); } catch { /* Storage can be disabled. */ }
  }

  function rememberResult() {
    const history = readHistory();
    const id = state.attemptId || `local-${state.startedAt}-${state.current.id}`;
    const item = { id, quizId: state.current.id, title: state.current.title,
      score: state.result.score, maxScore: state.result.maxScore,
      submittedAt: state.result.submittedAt || new Date().toISOString(),
      notification: state.result.notification || 'self' };
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify([item, ...history.filter(x => x.id !== id)].slice(0, 25))); }
    catch { /* Result is still displayed if this browser cannot store history. */ }
  }

  function timeLabel(milliseconds) {
    const total = Math.max(0, Math.ceil(milliseconds / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function dateLabel(value) {
    try { return new Intl.DateTimeFormat('kk-KZ', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
    catch { return ''; }
  }

  function validQuiz(quiz) {
    return quiz && typeof quiz.id === 'string' && typeof quiz.title === 'string' &&
      quiz.subject === 'history' && [5, 6, 7, 8].includes(quiz.grade) && Number(quiz.durationMinutes) > 0 &&
      Array.isArray(quiz.questions) && quiz.questions.length > 0 &&
      quiz.questions.every(question => typeof question.id === 'string' && typeof question.text === 'string' &&
        Number(question.points) > 0 && Array.isArray(question.options) && question.options.length >= 2 &&
        question.options.every(option => typeof option.id === 'string' && typeof option.text === 'string'));
  }

  function header() {
    return '<div class="section-heading"><div><div class="eyebrow muted">ҚАЗАҚСТАН ТАРИХЫНАН БІЛІМІҢДІ БАЙҚА</div><h2>Өзіңді сынап көр<span>.</span></h2><p>Дарынның тарих тапсырмалары. Ресми жауап кілті. Өз қарқыныңдағы дайындық.</p></div><span class="status-pill">Дарынның түпнұсқа материалдары</span></div>';
  }

  function historyMarkup() {
    const items = readHistory();
    if (!items.length) return '';
    return `<div class="quiz-history"><div class="quiz-history-heading"><h3>Соңғы нәтижелерім</h3><button class="quiz-text-button" id="quiz-clear-history">Журналды тазалау</button></div><p>Тек осы браузерде сақталады.</p><div class="quiz-history-list">${items.slice(0, 5).map(item => `<div><span><b>${escape(item.title)}</b><small>${escape(dateLabel(item.submittedAt))}</small></span><strong>${escape(item.score)} / ${escape(item.maxScore)}</strong></div>`).join('')}</div></div>`;
  }

  function renderHome() {
    removeChallenge();
    const archiveOnlyGrades = [5, 6, 7, 8].filter(grade => !state.quizzes.some(quiz => quiz.grade === grade));
    const coverageNote = archiveOnlyGrades.length ? `<p class="quiz-scope-note">${archiveOnlyGrades.join('–')}-сынып материалдарын <a href="#archive">Қазақстан тарихы архивінен</a> қара. Ресми кілті расталмаған топтамаға автоматты баға қойылмайды.</p>` : '';
    root.innerHTML = header() + (state.quizzes.length ? `<div class="quiz-card-grid">${state.quizzes.map(quiz => {
      const max = quiz.questions.reduce((sum, q) => sum + Number(q.points), 0);
      return `<article class="quiz-start-card"><div class="quiz-card-top"><span class="subject-badge">Қазақстан тарихы</span><span>${escape(quiz.grade)}-сынып</span></div><h3>${escape(quiz.title)}</h3><p>Түпнұсқаның ${quiz.questions.length} сұрағынан тұратын жаттығу. Жауаптар ресми кілтпен салыстырылады.</p><div class="quiz-card-facts"><span>${quiz.questions.length} сұрақ</span><span>${escape(quiz.durationMinutes)} минут</span><span>${max} балл</span></div><div class="quiz-card-year">${escape(quiz.year)} · ${quiz.language === 'kk' ? 'Қазақша' : quiz.language === 'ru' ? 'Орысша' : 'Түпнұсқа тілінде'}</div><button class="button button-dark" data-quiz-choose="${escape(quiz.id)}">Тестті бастау <span aria-hidden="true">→</span></button></article>`;
    }).join('')}</div><p class="quiz-mode-notice">${teacherAvailable ? 'Өзіндік дайындықты немесе келісіміңмен нәтижені мұғалімге жіберу режимін таңдауға болады.' : 'Қазір өзіндік дайындық қолжетімді. Мұғалімге Telegram арқылы жіберу әлі қосылмаған.'}</p>${coverageNote}` : '<div class="quiz-empty"><h3>Тарих тесттері әзірге жүктелмеді</h3><p>Тек Дарынның ресми жауап кілтімен салыстырылған тарих тапсырмалары тестке қосылады.</p></div>') + historyMarkup();
    root.querySelectorAll('[data-quiz-choose]').forEach(button => button.addEventListener('click', () => {
      state.current = state.quizzes.find(q => q.id === button.dataset.quizChoose);
      state.mode = 'self'; state.status = 'setup'; state.error = ''; state.turnstileToken = '';
      renderSetup();
    }));
    const clear = root.querySelector('#quiz-clear-history');
    if (clear) clear.addEventListener('click', () => {
      try { localStorage.removeItem(HISTORY_KEY); } catch { /* Nothing to clear. */ }
      renderHome();
    });
  }

  function sourceNotesMarkup(quiz) {
    const notes = [quiz.sourceNote, ...(Array.isArray(quiz.sourceNotes) ? quiz.sourceNotes : [])]
      .filter(note => typeof note === 'string' && note.trim());
    return notes.length ? `<div class="quiz-source-note"><b>Түпнұсқа туралы ескерту</b>${[...new Set(notes)].map(note => `<p>${escape(note)}</p>`).join('')}</div>` : '';
  }

  function renderSetup() {
    const quiz = state.current;
    root.innerHTML = header() + `<div class="quiz-setup"><button class="quiz-text-button" id="quiz-back">← Тесттерге оралу</button><h3>${escape(quiz.title)}</h3><div class="quiz-setup-info"><span>${quiz.questions.length} сұрақ</span><span>${escape(quiz.durationMinutes)} минут</span><span>Ең жоғары балл: ${quiz.questions.reduce((sum, question) => sum + Number(question.points), 0)}</span></div>${sourceNotesMarkup(quiz)}<p>Бастағаннан кейін уақыт есептеледі. Сұрақтарға кез келген ретпен жауап бере аласың. Соңында нәтижені және ресми дұрыс жауаптарды көресің.</p><form id="quiz-setup-form"><label class="quiz-mode-choice"><input type="radio" name="quiz-mode" value="self" ${state.mode === 'self' ? 'checked' : ''}><span><b>Өзіндік дайындық</b><small>Нәтиже тек осы браузерде қалады.</small></span></label>${teacherAvailable ? `<label class="quiz-mode-choice"><input type="radio" name="quiz-mode" value="teacher" ${state.mode === 'teacher' ? 'checked' : ''}><span><b>Нәтижені мұғалімге жіберу</b><small>Тест аяқталғанда балл Telegram арқылы жіберіледі.</small></span></label>` : '<p class="quiz-mode-notice">Мұғалімге жіберу әлі қосылмаған. Өзіндік дайындықты бастауға болады.</p>'}<div id="quiz-teacher-settings" ${state.mode === 'teacher' ? '' : 'hidden'}><label class="quiz-input-label" for="quiz-student-code">Оқушы коды</label><input id="quiz-student-code" name="studentCode" type="text" autocomplete="off" minlength="2" maxlength="30" placeholder="Мысалы, 5A_12" ${state.mode === 'teacher' ? 'required' : ''}><p class="quiz-field-help">Телефон, ЖСН немесе толық аты-жөніңді жазба. Мұғалімге таныс қысқа код жеткілікті.</p><label class="quiz-consent"><input id="quiz-consent" type="checkbox" ${state.mode === 'teacher' ? 'required' : ''}>Нәтижені мұғалімге Telegram арқылы жіберуге келісемін</label><div id="quiz-turnstile"></div><p class="quiz-field-help">Жіберілетін деректер: оқушы коды, сынып, тест атауы, жиналған балл және орындаған уақыт.</p></div><div class="quiz-error" id="quiz-setup-error" role="alert" ${state.error ? '' : 'hidden'}>${escape(state.error)}</div><div class="quiz-setup-actions"><button type="submit" class="button button-orange" id="quiz-start-button">Дайынмын, бастаймын →</button></div></form></div>`;
    root.querySelector('#quiz-back').onclick = () => { state.current = null; state.status = 'home'; renderHome(); };
    root.querySelectorAll('[name=quiz-mode]').forEach(input => input.addEventListener('change', () => {
      state.mode = input.value;
      state.error = ''; state.turnstileToken = '';
      removeChallenge(); renderSetup();
    }));
    root.querySelector('#quiz-setup-form').addEventListener('submit', start);
    if (state.mode === 'teacher') loadChallenge();
  }

  function removeChallenge() {
    if (challengeWidget !== undefined && window.turnstile) {
      try { window.turnstile.remove(challengeWidget); } catch { /* It may already be removed. */ }
    }
    challengeWidget = undefined;
  }

  async function loadChallenge() {
    const host = root.querySelector('#quiz-turnstile');
    if (!host) return;
    try {
      if (!window.turnstile) {
        if (!challengePromise) challengePromise = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.async = true;
          const timeout = setTimeout(() => reject(new Error('Challenge timeout')), 15000);
          script.onload = () => { clearTimeout(timeout); resolve(); };
          script.onerror = () => { clearTimeout(timeout); reject(new Error('Challenge load failed')); };
          document.head.append(script);
        }).catch(error => { challengePromise = null; throw error; });
        await challengePromise;
      }
      if (!host.isConnected || state.mode !== 'teacher') return;
      challengeWidget = window.turnstile.render(host, {
        sitekey: String(configuration.turnstileSiteKey), theme: 'light', action: 'start_test',
        callback: token => { state.turnstileToken = token; },
        'expired-callback': () => { state.turnstileToken = ''; },
        'error-callback': () => { state.turnstileToken = ''; showSetupError('Қауіпсіздік тексеруі өтпеді. Тексеруді қайта орындаңыз.'); }
      });
    } catch { showSetupError('Қауіпсіздік тексеруі жүктелмеді. Байланысты тексеріңіз немесе өзіндік дайындықты таңдаңыз.'); }
  }

  function showSetupError(message) {
    state.error = message;
    const error = root.querySelector('#quiz-setup-error');
    if (error) { error.textContent = message; error.hidden = false; }
  }

  async function api(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(apiBase + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal, credentials: 'omit'
      });
      let data;
      try { data = await response.json(); } catch { throw new Error('Серверден түсініксіз жауап келді. Қайта байқап көріңіз.'); }
      if (!response.ok) {
        if (response.status === 429) throw new Error('Сұрау саны шектелді. Біраздан кейін қайта байқап көріңіз.');
        if (response.status === 403) throw new Error('Қауіпсіздік тексеруі немесе сайтқа рұқсат расталмады. Бетті жаңартып қайталаңыз.');
        if (response.status === 410) throw new Error('Тесттің жіберу мерзімі аяқталған. Жаңа тест бастаңыз.');
        throw new Error('Нәтиже қабылданбады. Байланысты тексеріп, қайта жіберіңіз.');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Сервермен байланыс үзілді. Интернетті тексеріп, қайта байқап көріңіз.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function start(event) {
    event.preventDefault();
    const button = root.querySelector('#quiz-start-button');
    if (state.mode === 'teacher') {
      const code = root.querySelector('#quiz-student-code').value.trim();
      if (!/^[\p{L}\p{N}_-]{2,30}$/u.test(code)) return showSetupError('Оқушы коды 2–30 әріптен, саннан, _ немесе - белгісінен тұруы керек.');
      if (!root.querySelector('#quiz-consent').checked) return showSetupError('Нәтижені мұғалімге жіберуге келісім беріңіз.');
      if (!state.turnstileToken) return showSetupError('Алдымен қауіпсіздік тексеруін аяқтаңыз.');
      button.disabled = true; button.textContent = 'Тест ашылуда…';
      try {
        const result = await api('/api/attempts/start', { quizId: state.current.id, studentCode: code, grade: state.current.grade, turnstileToken: state.turnstileToken });
        if (!validQuiz(result.quiz) || result.quiz.id !== state.current.id || typeof result.attemptId !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('Сервер тестті дұрыс ашпады. Мұғалімге хабарлаңыз.');
        state.current = { ...state.current, ...result.quiz }; state.attemptId = result.attemptId;
        state.startedAt = result.startedAt || new Date().toISOString(); state.expiresAt = result.expiresAt;
      } catch (error) {
        showSetupError(error.message); button.disabled = false; button.textContent = 'Дайынмын, бастаймын →';
        state.turnstileToken = ''; if (window.turnstile && challengeWidget !== undefined) window.turnstile.reset(challengeWidget);
        return;
      }
    } else {
      const keys = state.keys[state.current.id];
      if (!keys || !state.current.questions.every(q => q.options.some(option => option.id === keys[q.id]))) return showSetupError('Бұл тесттің ресми жауап кілті жүктелмеді. Бетті қайта жүктеңіз.');
      state.expired = false; state.attemptId = null; state.startedAt = new Date().toISOString();
      state.expiresAt = new Date(Date.now() + Number(state.current.durationMinutes) * 60000).toISOString();
    }
    state.expired = false; removeChallenge(); state.answers = {}; state.position = 0; state.error = ''; state.confirm = false; state.status = 'active';
    saveActive(); renderActive(); startClock();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function answeredCount() { return state.current.questions.filter(q => state.answers[q.id]).length; }

  function questionMarkup(question) {
    const table = question.sourceTable;
    const hasTable = table && Array.isArray(table.headers) && table.headers.length > 0 &&
      table.headers.every(header => typeof header === 'string') && Array.isArray(table.rows) &&
      table.rows.length > 0 && table.rows.every(row => typeof row.optionId === 'string' &&
        Array.isArray(row.cells) && row.cells.length === table.headers.length &&
        row.cells.every(cell => typeof cell === 'string'));
    if (!hasTable) return `<div class="quiz-question-text">${escape(question.text)}</div>`;
    const introduction = typeof question.tableQuestionText === 'string' ? question.tableQuestionText : question.text;
    const caption = `${question.number || ''}-сұрақтың түпнұсқа кестесі`;
    return `<div class="quiz-question-text">${escape(introduction)}</div><div class="quiz-source-table" role="region" aria-label="${escape(caption)}" tabindex="0"><table><caption>${escape(caption)}</caption><thead><tr><th scope="col">Нұсқа</th>${table.headers.map(header => `<th scope="col">${escape(header)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row => `<tr><th scope="row">${escape(row.optionId)}</th>${row.cells.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function renderActive(focusQuestion = false) {
    const quiz = state.current, question = quiz.questions[state.position], count = answeredCount();
    root.innerHTML = `<div class="quiz-running-heading"><div><div class="eyebrow muted">${state.mode === 'teacher' ? 'МҰҒАЛІМГЕ ЖІБЕРІЛЕТІН ТЕСТ' : 'ӨЗІНДІК ДАЙЫНДЫҚ'}</div><h2>${escape(quiz.title)}</h2></div><div class="quiz-clock" aria-label="Қалған уақыт"><span>Қалған уақыт</span><strong id="quiz-clock-value">${timeLabel(Date.parse(state.expiresAt) - Date.now())}</strong></div></div><div class="quiz-run-layout"><aside class="quiz-question-map"><div class="quiz-map-heading"><b>Сұрақтар</b><span>${count} / ${quiz.questions.length}</span></div><div class="quiz-question-grid">${quiz.questions.map((q, index) => `<button class="${state.position === index ? 'current' : ''} ${state.answers[q.id] ? 'answered' : ''}" data-quiz-question="${index}" aria-label="${index + 1}-сұрақ${state.answers[q.id] ? ', жауап берілген' : ''}" ${state.position === index ? 'aria-current="true"' : ''}>${index + 1}</button>`).join('')}</div><div class="quiz-map-legend"><span>● Жауап берілген</span><span>○ Жауап берілмеген</span></div><button class="button button-dark" id="quiz-request-finish">Тестті аяқтау</button><p>${state.mode === 'teacher' ? 'Аяқтағанда нәтижені сервер есептеп, мұғалімге жібереді.' : 'Өзіндік нәтиже мұғалімге жіберілмейді.'}</p></aside><div class="quiz-question-card"><div class="quiz-question-top"><span>${state.position + 1} / ${quiz.questions.length} сұрақ</span><span>${escape(question.points)} балл</span></div><h3 id="quiz-question-heading" tabindex="-1">${escape(question.number || state.position + 1)}-сұрақ</h3>${questionMarkup(question)}<fieldset class="quiz-options"><legend class="quiz-sr-only">Жауап нұсқасын таңдаңыз</legend>${question.options.map((option, index) => `<label class="quiz-option ${state.answers[question.id] === option.id ? 'selected' : ''}"><input type="radio" name="quiz-answer" value="${escape(option.id)}" id="quiz-option-${index}" ${state.answers[question.id] === option.id ? 'checked' : ''}><span class="quiz-option-letter">${escape(option.id)}</span><span>${escape(option.text)}</span></label>`).join('')}</fieldset><div class="quiz-question-actions"><button class="button button-outline" id="quiz-previous" ${state.position === 0 ? 'disabled' : ''}>← Алдыңғы</button><button class="quiz-text-button" id="quiz-clear-answer" ${state.answers[question.id] ? '' : 'disabled'}>Жауапты өшіру</button><button class="button button-dark" id="quiz-next" ${state.position === quiz.questions.length - 1 ? 'hidden' : ''}>Келесі →</button>${state.position === quiz.questions.length - 1 ? '<button class="button button-orange" id="quiz-last-finish">Аяқтау →</button>' : ''}</div></div></div>${state.confirm ? `<div class="quiz-finish-confirm" role="alert"><div><h3>Тестті аяқтауға дайынсың ба?</h3><p>${quiz.questions.length - count ? `${quiz.questions.length - count} сұраққа жауап берілмеген. Оларға 0 балл есептеледі.` : 'Барлық сұраққа жауап берілді.'} ${state.mode === 'teacher' ? 'Нәтиже мұғалімге жіберіледі.' : 'Нәтиже тек осы браузерде сақталады.'}</p></div><div><button class="button button-outline" id="quiz-continue">Жалғастыру</button><button class="button button-orange" id="quiz-confirm-finish">Иә, аяқтау</button></div></div>` : ''}`;
    root.querySelectorAll('[data-quiz-question]').forEach(button => button.onclick = () => navigate(Number(button.dataset.quizQuestion)));
    root.querySelectorAll('[name=quiz-answer]').forEach(input => input.addEventListener('change', () => {
      state.answers[question.id] = input.value; saveActive(); renderActive();
      const same = [...root.querySelectorAll('[name=quiz-answer]')].find(element => element.value === input.value); same?.focus();
    }));
    root.querySelector('#quiz-clear-answer').onclick = () => { delete state.answers[question.id]; saveActive(); renderActive(); };
    root.querySelector('#quiz-previous').onclick = () => navigate(state.position - 1);
    root.querySelector('#quiz-next').onclick = () => navigate(state.position + 1);
    const ask = () => { state.confirm = true; renderActive(); root.querySelector('.quiz-finish-confirm').scrollIntoView({ behavior: 'smooth', block: 'center' }); root.querySelector('#quiz-continue').focus(); };
    root.querySelector('#quiz-request-finish').onclick = ask;
    const last = root.querySelector('#quiz-last-finish'); if (last) last.onclick = ask;
    if (state.confirm) { root.querySelector('#quiz-continue').onclick = () => { state.confirm = false; renderActive(); }; root.querySelector('#quiz-confirm-finish').onclick = () => finish(false); }
    if (focusQuestion) root.querySelector('#quiz-question-heading').focus({ preventScroll: true });
  }

  function navigate(position) {
    if (position < 0 || position >= state.current.questions.length) return;
    state.position = position; state.confirm = false; saveActive(); renderActive(true);
  }

  function startClock() {
    clearInterval(interval);
    const tick = () => {
      if (state.status !== 'active') return;
      const remaining = Date.parse(state.expiresAt) - Date.now();
      const clock = root.querySelector('#quiz-clock-value');
      if (clock) { clock.textContent = timeLabel(remaining); clock.parentElement.classList.toggle('is-short', remaining < 120000); }
      if (remaining <= 0) finish(true);
    };
    interval = setInterval(tick, 1000); tick();
  }

  function scoreLocally() {
    let score = 0, maxScore = 0, correctCount = 0;
    const keys = state.keys[state.current.id];
    for (const question of state.current.questions) {
      maxScore += Number(question.points);
      if (keys[question.id] === state.answers[question.id]) { score += Number(question.points); correctCount++; }
    }
    return { score, maxScore, correctCount, questionCount: state.current.questions.length, notification: 'self', submittedAt: new Date().toISOString() };
  }

  async function finish(expired) {
    if (!['active', 'submission-error'].includes(state.status)) return;
    clearInterval(interval); state.status = 'submitting'; state.expired = Boolean(expired || state.expired); saveActive();
    root.innerHTML = header() + '<div class="quiz-empty" role="status"><h3>Нәтиже есептелуде…</h3><p>Жауаптарыңды тексеріп жатырмыз.</p></div>';
    try {
      let result;
      if (state.mode === 'teacher') {
        result = await api(`/api/attempts/${encodeURIComponent(state.attemptId)}/submit`, { answers: state.answers });
        if (![result.score, result.maxScore, result.correctCount, result.questionCount].every(Number.isFinite) || result.score < 0 || result.score > result.maxScore || result.questionCount !== state.current.questions.length) throw new Error('Сервер нәтижесі дұрыс емес. Қайта жіберіп көріңіз.');
      } else result = scoreLocally();
      state.result = result; state.status = 'result'; clearActive(); rememberResult(); renderResult();
    } catch (error) {
      state.error = error.message; state.status = 'submission-error'; saveActive(); renderSubmissionError();
    }
  }

  function renderSubmissionError() {
    root.innerHTML = header() + `<div class="quiz-empty quiz-submission-error"><h3>Нәтиже әлі жіберілген жоқ</h3><p role="alert">${escape(state.error)}</p><p>Жауаптарың осы қойындыда сақталған. Қайта жіберу жаңа нәтиже жасамайды.</p><div class="quiz-result-actions"><button class="button button-orange" id="quiz-retry-submit">Қайта жіберу</button><button class="button button-outline" id="quiz-abandon-attempt">Тесттерге оралу</button></div><div id="quiz-abandon-confirm" class="quiz-abandon-confirm" hidden><p>Оралсаң, осы қойындыдағы жіберілмеген жауаптар өшеді. Серверде бұрын қабылданған нәтиже жойылмайды.</p><button class="button button-outline" id="quiz-confirm-abandon">Жауаптарды өшіріп, оралу</button></div></div>`;
    root.querySelector('#quiz-retry-submit').onclick = () => finish(state.expired);
    root.querySelector('#quiz-abandon-attempt').onclick = () => { root.querySelector('#quiz-abandon-confirm').hidden = false; };
    root.querySelector('#quiz-confirm-abandon').onclick = () => { clearActive(); state.current = null; state.result = null; state.answers = {}; state.status = 'home'; state.expired = false; renderHome(); };
  }

  function notificationLabel() {
    if (state.mode === 'self') return { text: 'Бұл — өзіндік дайындық нәтижесі. Мұғалімге Telegram арқылы жіберілген жоқ.', type: 'local' };
    const status = state.result.notification;
    if (status === 'sent') return { text: 'Нәтиже мұғалімге Telegram арқылы жіберілді.', type: 'sent' };
    if (status === 'queued') return { text: 'Нәтиже серверде сақталды. Telegram-ға жіберу кезекте тұр; жеткізілгені әлі расталған жоқ.', type: 'pending' };
    if (status === 'not_configured') return { text: 'Нәтиже серверде сақталды, бірақ Telegram әлі бапталмаған. Мұғалімге хабарлаңыз.', type: 'pending' };
    return { text: 'Нәтиже серверде сақталды, бірақ Telegram-ға жеткізілгені расталмады. Мұғалімге хабарлаңыз.', type: 'pending' };
  }

  function renderResult() {
    const result = state.result, quiz = state.current;
    const unanswered = quiz.questions.length - answeredCount();
    const notification = notificationLabel();
    root.innerHTML = header() + `<div class="quiz-result"><div class="quiz-result-main"><span class="quiz-result-star" aria-hidden="true">✦</span><div class="eyebrow muted">${state.expired ? 'УАҚЫТ АЯҚТАЛДЫ' : 'ТЕСТ АЯҚТАЛДЫ'}</div><h3>Әр талпыныс — алға қадам.</h3><p>${escape(quiz.title)}</p><div class="quiz-result-score"><strong>${escape(result.score)}</strong><span>/ ${escape(result.maxScore)} балл</span></div><div class="quiz-result-facts"><span><b>${escape(result.correctCount)}</b> дұрыс жауап</span><span><b>${quiz.questions.length - result.correctCount - unanswered}</b> қате жауап</span><span><b>${unanswered}</b> жауап берілмеген</span></div></div><div class="quiz-notification ${notification.type}" role="status">${escape(notification.text)}</div><div class="quiz-result-actions"><button class="button button-dark" id="quiz-review">Жауаптарды талдау ↓</button><button class="button button-outline" id="quiz-return-home">Басқа тест таңдау</button></div><div id="quiz-review-panel" class="quiz-review-panel" hidden></div>${sourceNotesMarkup(quiz)}<div id="quiz-source-links" class="quiz-source-links"></div></div>`;
    root.querySelector('#quiz-return-home').onclick = () => { state.current = null; state.result = null; state.status = 'home'; state.expired = false; renderHome(); };
    root.querySelector('#quiz-review').onclick = () => {
      const panel = root.querySelector('#quiz-review-panel');
      panel.hidden = !panel.hidden;
      root.querySelector('#quiz-review').textContent = panel.hidden ? 'Жауаптарды талдау ↓' : 'Талдауды жасыру ↑';
      if (!panel.hidden) { renderReview(panel); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    };
    renderSourceLinks();
  }

  function renderReview(panel) {
    const key = state.keys[state.current.id];
    if (!key) { panel.innerHTML = '<p class="quiz-field-help">Ресми жауап кілті бұл браузерге жүктелмеді. Түпнұсқа дереккөзді төменнен қараңыз.</p>'; return; }
    panel.innerHTML = state.current.questions.map((question, index) => {
      const correct = key[question.id], chosen = state.answers[question.id], isCorrect = chosen === correct;
      return `<details class="quiz-review-question ${isCorrect ? 'is-correct' : 'is-incorrect'}"><summary><span>${index + 1}-сұрақ</span><span>${isCorrect ? '✓ Дұрыс' : chosen ? 'Қате' : 'Жауап берілмеген'}</span></summary>${questionMarkup(question)}<div class="quiz-review-options">${question.options.map(option => `<p class="${option.id === correct ? 'official-correct' : ''}"><b>${escape(option.id)}.</b> ${escape(option.text)}${option.id === correct ? ' <span>✓ Ресми дұрыс жауап</span>' : ''}${option.id === chosen && option.id !== correct ? ' <span>← Сенің жауабың</span>' : ''}</p>`).join('')}</div></details>`;
    }).join('');
  }

  async function renderSourceLinks() {
    const host = root.querySelector('#quiz-source-links'), quiz = state.current;
    if (!host) return;
    try {
      if (!sourceDocuments) {
        const response = await fetch('data/sources.json');
        if (!response.ok) return;
        sourceDocuments = (await response.json()).documents;
      }
      if (!host.isConnected || !Array.isArray(sourceDocuments)) return;
      const ids = [...(quiz.sourceDocumentIds || []), ...(quiz.answerSourceIds || [])];
      const documents = ids.map(id => sourceDocuments.find(d => d.id === id)).filter(Boolean);
      host.innerHTML = `<b>Түпнұсқа дереккөздер</b>${documents.map((document, index) => {
        const file = String(document.fileUrl || '');
        if (!/^materials\/[A-Za-z0-9._/-]+$/.test(file) || file.includes('..')) return '';
        return `<a href="${escape(file)}" target="_blank" rel="noopener noreferrer">${index < (quiz.sourceDocumentIds || []).length ? 'Тапсырмалардың түпнұсқасы' : 'Ресми жауап кілті'} (${escape(String(document.format || '').toUpperCase())}) ↗</a>`;
      }).join('')}<small>Мәтін мен жауаптар осы ресми құжаттардан алынған. Тест сұрақтары тек «Дарын» жариялаған Қазақстан тарихы құжаттарынан алынған.</small>`;
    } catch { /* Main result remains available without the provenance index. */ }
  }

  async function initialise() {
    root.innerHTML = header() + '<p class="quiz-loading" role="status">Тесттер жүктелуде…</p>';
    try {
      const results = await Promise.allSettled([fetch('data/quizzes.json'), fetch('data/practice-keys.json')]);
      if (results[0].status !== 'fulfilled' || !results[0].value.ok) throw new Error('Quiz archive unavailable');
      const data = await results[0].value.json();
      state.quizzes = (Array.isArray(data.quizzes) ? data.quizzes : []).filter(validQuiz);
      if (results[1].status === 'fulfilled' && results[1].value.ok) {
        const keys = await results[1].value.json();
        state.keys = keys.keys || keys;
      }
      try {
        const active = JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || 'null');
        const quiz = active && state.quizzes.find(q => q.id === active.quizId);
        if (quiz && ['self', 'teacher'].includes(active.mode) && Number.isFinite(Date.parse(active.expiresAt)) &&
            (active.mode === 'self' || (teacherAvailable && typeof active.attemptId === 'string')) &&
            (active.mode !== 'self' || state.keys[quiz.id])) {
          state.current = quiz; state.mode = active.mode; state.startedAt = active.startedAt; state.expiresAt = active.expiresAt; state.attemptId = active.attemptId;
          state.answers = {};
          for (const q of quiz.questions) if (q.options.some(option => option.id === active.answers?.[q.id])) state.answers[q.id] = active.answers[q.id];
          state.position = Math.max(0, Math.min(quiz.questions.length - 1, Number(active.position) || 0));
          state.status = 'active'; renderActive(); startClock(); return;
        }
      } catch { clearActive(); }
      state.status = 'home'; renderHome();
    } catch {
      state.status = 'error';
      root.innerHTML = header() + '<div class="quiz-empty"><h3>Тарих тесттерін жүктеу мүмкін болмады</h3><p>Интернет байланысын тексеріп, бетті қайта жүктеңіз. Архив кітапханасын пайдалануға болады.</p></div>';
    }
  }

  initialise();
})();
