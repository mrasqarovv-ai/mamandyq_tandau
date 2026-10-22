(() => {
  'use strict';
  const host = document.getElementById('assignment-app');
  if (!host) return;

  const PREFIX = 'orleu-history-assignment-v1:';
  const LAST_KEY = `${PREFIX}last`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const stages = { district: 'Аудандық / қалалық', regional: 'Облыстық', republican: 'Республикалық', unknown: 'Кезеңі нақтыланбаған' };
  const languages = { kk: 'Қазақша', ru: 'Орысша', mixed: 'Аралас', unknown: 'Тілі нақтыланбаған' };
  const checks = { pending: 'Әлі тексермедім', revise: 'Қайта қарау керек', checked: 'Өзім тексердім' };
  const memory = new Map();
  const recordWarnings = new Map();
  const state = { documents: [], quizzes: [], current: null, record: null, grade: '', reviewing: false, ready: false, pendingId: null, saved: false, warning: '' };
  const safeFile = value => /^materials\/[A-Za-z0-9._/-]+$/.test(String(value || '')) && !String(value).includes('..') ? String(value) : '';
  const safeUrl = (value, allowedHosts) => {
    try { const url = new URL(String(value)); return url.protocol === 'https:' && allowedHosts.includes(url.hostname) ? url.href : ''; }
    catch { return ''; }
  };
  const grades = doc => [...new Set([...(Array.isArray(doc.grades) ? doc.grades : []), doc.grade].map(Number).filter(n => [5, 6, 7, 8].includes(n)))];
  const gradeLabel = doc => grades(doc).length ? `${grades(doc).join('–')}-сынып` : 'Сыныбы нақтыланбаған';
  const title = doc => `Қазақстан тарихы · ${gradeLabel(doc)} · ${stages[doc.stage] || stages.unknown}`;
  const quizFor = doc => state.quizzes.find(quiz => (quiz.sourceDocumentIds || []).includes(doc.id));
  const emptyRecord = () => ({ answer: '', notes: '', status: 'draft', check: 'pending', updatedAt: '' });

  function readRecord(id) {
    if (memory.has(id)) return memory.get(id);
    let record = emptyRecord();
    try {
      const raw = localStorage.getItem(PREFIX + id);
      if (raw) {
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.answer !== 'string' || typeof value.notes !== 'string') throw new Error('Invalid saved assignment');
        record = { answer: value.answer, notes: value.notes, status: value.status === 'completed' ? 'completed' : 'draft', check: Object.hasOwn(checks, value.check) ? value.check : 'pending', updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '' };
      }
    } catch {
      recordWarnings.set(id, 'Браузердегі сақталған деректі оқу мүмкін болмады. Жаңа жазба енгізсең, оны жүктеп алып та сақта.');
    }
    memory.set(id, record);
    return record;
  }

  function rememberCurrent(id) {
    try { if (id) localStorage.setItem(LAST_KEY, id); else localStorage.removeItem(LAST_KEY); }
    catch { /* Answer saving reports storage failures separately. */ }
  }

  function saveRecord() {
    state.record.updatedAt = new Date().toISOString();
    memory.set(state.current.id, state.record);
    try {
      localStorage.setItem(PREFIX + state.current.id, JSON.stringify(state.record));
      state.saved = true;
      state.warning = '';
      recordWarnings.delete(state.current.id);
    } catch {
      state.saved = false;
      state.warning = 'Жауап браузерге сақталмады. Осы бет ашық тұрғанда мәтін жоғалмайды. «Жауапты жүктеу» арқылы көшірмесін сақта.';
      recordWarnings.set(state.current.id, state.warning);
    }
    updateSaveFeedback();
  }

  function updateSaveFeedback() {
    const feedback = host.querySelector('#assignment-save-status');
    if (feedback) {
      feedback.textContent = state.warning || (state.saved ? 'Жауап пен тексеру жазбалары осы браузерде сақталды.' : 'Жауапты енгізгенде осы браузерде автоматты сақталады.');
      feedback.classList.toggle('assignment-save-error', Boolean(state.warning));
    }
    const badge = host.querySelector('#assignment-work-status');
    if (badge) badge.textContent = state.record.status === 'completed' ? 'Аяқталды деп белгіленген' : 'Орындалып жатыр';
  }

  function header() {
    return `<div class="section-heading"><div><div class="eyebrow muted">ТҮПНҰСҚАМЕН ЖҰМЫС</div><h2>18 тапсырма жинағын орында<span>.</span></h2><p>Жауабыңды жаз, сақта және өзің тексер. Бұл режимде автоматты балл қойылмайды.</p></div></div>`;
  }

  function renderHome() {
    state.current = null;
    host.innerHTML = header() + `<p class="assignment-privacy">Жауаптар тек осы браузерде сақталады. Басқа құрылғыға көшпейді; браузер деректерін тазаласаң, өшеді. Ортақ құрылғыда жеке мәлімет жазба.</p>${state.warning ? `<p class="assignment-save-error" role="status">${escape(state.warning)}</p>` : ''}<div class="grade-tabs assignment-grades" role="group" aria-label="Орындауға арналған жинақтың сыныбы">${['', '5', '6', '7', '8'].map(grade => `<button data-assignment-grade="${grade}" class="${state.grade === grade ? 'selected' : ''}" aria-pressed="${state.grade === grade}">${grade ? `${grade}-сынып` : 'Барлық сынып'}</button>`).join('')}</div><p class="assignment-count" role="status">${state.documents.filter(doc => !state.grade || grades(doc).includes(Number(state.grade))).length} жинақ · Барлығы ${state.documents.length} түпнұсқа</p><div class="assignment-grid">${state.documents.filter(doc => !state.grade || grades(doc).includes(Number(state.grade))).map(doc => {
      const record = readRecord(doc.id), quiz = quizFor(doc);
      const progress = record.status === 'completed' ? 'Аяқталды · ' + checks[record.check] : recordWarnings.has(doc.id) ? 'Браузерде сақтау қолжетімсіз' : record.answer || record.notes ? 'Сақталған жұмыс бар' : 'Жаңа жұмыс';
      return `<article class="assignment-card" data-assignment-id="${escape(doc.id)}"><div class="assignment-meta"><span>${escape(gradeLabel(doc))}</span><span>${escape(languages[doc.language] || languages.unknown)}</span><span>${escape(doc.year)}</span></div><h3>${escape(stages[doc.stage] || stages.unknown)}</h3><p class="assignment-filename">${escape(doc.title.split(/\s*\/\s*/).pop())}</p><p class="assignment-key-note">${quiz ? 'Осы жинаққа ресми кілтпен бағаланатын тест те бар.' : 'Сәйкес ресми кілт тексерілмеген. Жауабыңды сақтап, өзің тексер.'}</p><p class="assignment-progress">${escape(progress)}</p><div class="assignment-card-actions"><button class="button button-dark" data-assignment-open="${escape(doc.id)}">${record.answer || record.notes ? 'Жұмысты жалғастыру' : 'Тапсырманы орындау'} →</button>${quiz ? `<a class="text-link" href="#practice" data-assignment-quiz="${escape(quiz.id)}">Ресми кілтпен тест ↗</a>` : ''}</div></article>`;
    }).join('')}</div>`;
    host.querySelectorAll('[data-assignment-grade]').forEach(button => button.onclick = () => { state.grade = button.dataset.assignmentGrade; renderHome(); });
    host.querySelectorAll('[data-assignment-open]').forEach(button => button.onclick = () => open(button.dataset.assignmentOpen));
    bindQuizLinks();
  }

  function bindQuizLinks() {
    host.querySelectorAll('[data-assignment-quiz]').forEach(link => link.onclick = () => {
      window.ORLEU_QUIZZES?.open(link.dataset.assignmentQuiz);
    });
  }

  function originalMarkup(doc) {
    const file = safeFile(doc.fileUrl);
    const page = safeUrl(doc.sourcePage, ['daryn.kz', 'www.daryn.kz']);
    const original = safeUrl(doc.sourceUrl, ['drive.google.com', 'daryn.kz', 'www.daryn.kz']);
    return `<div class="assignment-original"><h4>Түпнұсқа тапсырмалар</h4><p>Жауаптарды түпнұсқадағы нөмірлерімен жаз. Аралас құжаттағы қазақша не орысша бөлімді өзің таңда.</p><div class="assignment-source-links">${file ? `<a href="${escape(file)}" target="_blank" rel="noopener noreferrer">Құжатты ашу ↗</a><a href="${escape(file)}" download>Түпнұсқаны жүктеу ↓</a>` : ''}${original ? `<a href="${escape(original)}" target="_blank" rel="noopener noreferrer">Ресми файл ↗</a>` : ''}${page ? `<a href="${escape(page)}" target="_blank" rel="noopener noreferrer">daryn.kz дереккөзі ↗</a>` : ''}</div>${doc.format === 'pdf' && file ? `<iframe class="assignment-pdf" src="${escape(file)}" title="${escape(title(doc))} — түпнұсқа PDF" loading="lazy"></iframe>` : '<p class="assignment-format-note">DOCX құжатын жүктеп ашуға немесе төмендегі толық мәтінді оқуға болады.</p>'}<details class="assignment-text" ${doc.format !== 'pdf' ? 'open' : ''}><summary>Түпнұсқадан алынған толық мәтін</summary><p>Кестелер, суреттер және күрделі орналасу бастапқы құжатта сақталған. Мәтіннің орналасуы өзгеше болуы мүмкін.</p><pre>${escape(doc.text || '')}</pre></details>${Array.isArray(doc.extractionIssues) && doc.extractionIssues.length ? `<div class="assignment-source-notes">${doc.extractionIssues.map(note => `<p>${escape(note)}</p>`).join('')}</div>` : ''}</div>`;
  }

  function renderWorkspace(focus = false) {
    const doc = state.current, record = state.record, quiz = quizFor(doc);
    host.innerHTML = `<div class="assignment-work-heading"><div><div class="eyebrow muted">${state.reviewing ? 'ӨЗІҢДІ ТЕКСЕРУ' : 'ТАПСЫРМАНЫ ОРЫНДАУ'}</div><h2 id="assignment-heading" tabindex="-1">${escape(title(doc))}</h2><p>${escape(doc.year)} · ${escape(languages[doc.language] || languages.unknown)}</p></div><button class="button button-outline" id="assignment-return">← Барлық жинақ</button></div><div class="assignment-mode-note"><b>Автоматты балл қойылмайды.</b> ${quiz ? `Ресми кілтпен бағалану үшін <a href="#practice" data-assignment-quiz="${escape(quiz.id)}">осы жинақтың тестін аш</a>.` : 'Сәйкес ресми кілт тексерілмеген. Өз жауабыңды түпнұсқамен және оқу жазбаларыңмен салыстырып, тексеру белгісін өзің қой.'}</div><div class="assignment-work-tabs" role="group" aria-label="Жұмыс көрінісі"><button id="assignment-edit-tab" aria-pressed="${!state.reviewing}" class="${!state.reviewing ? 'selected' : ''}">Жауап жазу</button><button id="assignment-review-tab" aria-pressed="${state.reviewing}" class="${state.reviewing ? 'selected' : ''}">Өзімді тексеру</button><span id="assignment-work-status">${record.status === 'completed' ? 'Аяқталды деп белгіленген' : 'Орындалып жатыр'}</span></div><div class="assignment-work-grid">${originalMarkup(doc)}<div class="assignment-response"><h3>${state.reviewing ? 'Сенің жауабың' : 'Жауап парағы'}</h3>${state.reviewing ? `<div class="assignment-answer-preview" id="assignment-answer-preview">${record.answer ? escape(record.answer) : 'Әзірге жауап жазылмаған. «Жауап жазу» көрінісіне орал.'}</div><p class="assignment-help">Бұл — өзің жазған жауаптар. Сайт олардың дұрыстығын анықтамайды.</p>` : `<label for="assignment-answer">Жауаптарыңды сұрақ нөмірімен жаз</label><p class="assignment-help" id="assignment-answer-help">Мысалы: 1 — таңдаған нұсқаң немесе түсіндірмең. Бір жинақтың барлық жауабын осы параққа жазуға болады.</p><textarea id="assignment-answer" rows="14" aria-describedby="assignment-answer-help" spellcheck="false">${escape(record.answer)}</textarea>`}<label for="assignment-notes">Өзін-өзі тексеру жазбалары</label><p class="assignment-help" id="assignment-notes-help">Нені қайта оқу керек, қандай дерекпен салыстырдың және не түзеттің — өзің белгіле.</p><textarea id="assignment-notes" rows="5" aria-describedby="assignment-notes-help">${escape(record.notes)}</textarea><label for="assignment-self-check">Менің тексеру белгісі</label><select id="assignment-self-check">${Object.entries(checks).map(([key, label]) => `<option value="${key}" ${record.check === key ? 'selected' : ''}>${label}</option>`).join('')}</select><p class="assignment-help">Бұл белгіні оқушы өзі қояды; ресми баға болып саналмайды.</p><p id="assignment-save-status" class="assignment-save-status" role="status" aria-live="polite"></p><div class="assignment-response-actions"><button class="button button-orange" id="assignment-save">Сақтау</button><button class="button button-outline" id="assignment-complete">${record.status === 'completed' ? 'Орындауды жалғастыру' : 'Аяқталды деп белгілеу'}</button><button class="assignment-text-button" id="assignment-download">Жауапты жүктеу ↓</button></div><p class="assignment-privacy">Жауаптар тек осы браузерде сақталады. Басқа құрылғыға көшпейді; браузер деректерін тазаласаң, өшеді. Ортақ құрылғыда жеке мәлімет жазба.</p></div></div>`;
    host.querySelector('#assignment-return').onclick = () => { rememberCurrent(null); renderHome(); host.scrollIntoView({ block: 'start' }); };
    host.querySelector('#assignment-edit-tab').onclick = () => { state.reviewing = false; renderWorkspace(); };
    host.querySelector('#assignment-review-tab').onclick = () => { state.reviewing = true; renderWorkspace(); };
    const answerInput = host.querySelector('#assignment-answer');
    if (answerInput) answerInput.oninput = () => {
      record.answer = answerInput.value;
      record.status = 'draft';
      record.check = 'pending';
      host.querySelector('#assignment-self-check').value = 'pending';
      host.querySelector('#assignment-complete').textContent = 'Аяқталды деп белгілеу';
      saveRecord();
    };
    host.querySelector('#assignment-notes').oninput = event => { record.notes = event.target.value; saveRecord(); };
    host.querySelector('#assignment-self-check').onchange = event => { record.check = event.target.value; saveRecord(); };
    host.querySelector('#assignment-save').onclick = saveRecord;
    host.querySelector('#assignment-complete').onclick = () => { record.status = record.status === 'completed' ? 'draft' : 'completed'; saveRecord(); renderWorkspace(); };
    host.querySelector('#assignment-download').onclick = downloadAnswer;
    updateSaveFeedback();
    bindQuizLinks();
    if (focus) host.querySelector('#assignment-heading').focus({ preventScroll: true });
  }

  function downloadAnswer() {
    const record = state.record;
    const contents = `${title(state.current)}\n${state.current.year}\n${state.current.sourcePage}\n\nМенің жауабым\n${record.answer}\n\nӨзін-өзі тексеру жазбалары\n${record.notes}\n\nМенің тексеру белгісі: ${checks[record.check]}\nАвтоматты балл қойылмаған.\n`;
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `history-${state.current.id}-answers.txt`; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function open(id) {
    if (!state.ready) { state.pendingId = id; return; }
    const doc = state.documents.find(item => item.id === id);
    if (!doc) return;
    state.current = doc; state.record = readRecord(id); state.reviewing = false;
    state.warning = recordWarnings.get(id) || '';
    state.saved = Boolean(state.record.updatedAt) && !state.warning;
    rememberCurrent(id); renderWorkspace(true);
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  window.ORLEU_ASSIGNMENTS = Object.freeze({ open });
  host.innerHTML = '<p class="quiz-loading" role="status">Орындауға арналған жинақтар жүктелуде…</p>';
  (async () => {
    try {
      const results = await Promise.allSettled([fetch('data/archive.json'), fetch('data/quizzes.json')]);
      if (results[0].status !== 'fulfilled' || !results[0].value.ok) throw new Error('Archive unavailable');
      const archive = await results[0].value.json();
      state.documents = (Array.isArray(archive.documents) ? archive.documents : []).filter(doc => doc && typeof doc.id === 'string' && doc.subject === 'history' && doc.materialType === 'tasks' && safeUrl(doc.sourcePage, ['daryn.kz', 'www.daryn.kz']) && safeFile(doc.fileUrl) && typeof doc.title === 'string' && typeof doc.text === 'string');
      if (!state.documents.length) throw new Error('No verified assignments');
      if (results[1].status === 'fulfilled' && results[1].value.ok) {
        try {
          const bank = await results[1].value.json();
          state.quizzes = Array.isArray(bank.quizzes) ? bank.quizzes.filter(quiz => quiz && quiz.subject === 'history' && typeof quiz.id === 'string') : [];
        } catch { /* Optional scored-test links do not block the response workspace. */ }
      }
      state.ready = true;
      let last = state.pendingId;
      if (!last) { try { last = localStorage.getItem(LAST_KEY); } catch { /* Home remains available. */ } }
      if (last && state.documents.some(doc => doc.id === last)) open(last); else renderHome();
      window.dispatchEvent(new CustomEvent('orleu-assignments-ready'));
    } catch {
      host.innerHTML = header() + '<div class="quiz-empty"><h3>Жинақтарды жүктеу мүмкін болмады</h3><p>Интернет байланысын тексеріп, бетті қайта жүкте. Сақталған жауаптар браузерде қалады.</p><a class="button button-outline" href="#archive">Архивті ашу</a></div>';
    }
  })();
})();
