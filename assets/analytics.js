/* Бағыт anonymous analytics + feedback.
   No phone, email, surname or survey answers are sent to analytics. */
(function () {
  'use strict';

  const cfg = window.MAMANDYQ_CONFIG || {};
  const API_URL = cfg.SUPABASE_URL;
  const API_KEY = cfg.SUPABASE_PUBLISHABLE_KEY;
  if (!API_URL || !API_KEY) {
    console.warn('[Бағыт analytics] Supabase config is missing.');
    return;
  }

  const CLIENT_KEY = 'bagyt_client_id';
  const SESSION_KEY = 'bagyt_active_session_id';
  const SESSION_ROLE_KEY = 'bagyt_active_session_role';

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getClientId() {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  }

  function getSessionId() {
    return localStorage.getItem(SESSION_KEY) || '';
  }

  function currentLang() {
    try { return (typeof app !== 'undefined' && app.lang) || localStorage.getItem('cn6_lang') || 'kk'; }
    catch (_) { return localStorage.getItem('cn6_lang') || 'kk'; }
  }

  function currentRole() {
    try { return (typeof app !== 'undefined' && app.role) || localStorage.getItem(SESSION_ROLE_KEY) || null; }
    catch (_) { return localStorage.getItem(SESSION_ROLE_KEY) || null; }
  }

  async function post(table, payload) {
    const res = await fetch(API_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: {
        'apikey': API_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload),
      keepalive: true
    });
    if (!res.ok) {
      const text = await res.text().catch(function () { return ''; });
      throw new Error('Analytics request failed (' + res.status + '): ' + text.slice(0, 180));
    }
    return true;
  }

  let sessionReady = Promise.resolve(null);

  function beginSession(role, isResume) {
    let sessionId = getSessionId();
    if (!isResume || !sessionId) {
      sessionId = uuid();
      localStorage.setItem(SESSION_KEY, sessionId);
      localStorage.setItem(SESSION_ROLE_KEY, role || '');
    }
    const clientId = getClientId();

    if (!isResume || !localStorage.getItem('bagyt_session_created_' + sessionId)) {
      sessionReady = post('sessions', {
        id: sessionId,
        client_id: clientId,
        role: role || null,
        referrer: document.referrer ? document.referrer.slice(0, 500) : null,
        user_agent: navigator.userAgent ? navigator.userAgent.slice(0, 500) : null,
        lang: currentLang(),
        metadata: { source: 'bagyt_web' }
      }).then(function () {
        localStorage.setItem('bagyt_session_created_' + sessionId, '1');
        return sessionId;
      }).catch(function (err) {
        console.warn('[Бағыт analytics]', err);
        return null;
      });
    } else {
      sessionReady = Promise.resolve(sessionId);
    }

    sessionReady.then(function (id) {
      if (id) recordEvent(isResume ? 'survey_resumed' : 'survey_started', { role: role || null }, true);
    });
    return sessionId;
  }

  function ensureSession() {
    const existing = getSessionId();
    if (existing) return sessionReady.then(function () { return existing; });
    const id = beginSession(currentRole(), true);
    return sessionReady.then(function () { return id; });
  }

  function eventOnceKey(sessionId, name) {
    return 'bagyt_evt_' + sessionId + '_' + name;
  }

  async function recordEvent(name, data, once) {
    try {
      const sessionId = await ensureSession();
      if (!sessionId) return false;
      const key = eventOnceKey(sessionId, name);
      if (once && localStorage.getItem(key)) return true;
      await post('events', {
        session_id: sessionId,
        client_id: getClientId(),
        event_name: name,
        event_data: data || {}
      });
      if (once) localStorage.setItem(key, '1');
      return true;
    } catch (err) {
      console.warn('[Бағыт analytics]', err);
      return false;
    }
  }

  const I18N = {
    kk: {
      privacy: 'Сервисті жақсарту үшін сауалнаманың басталуы, аяқталуы және кері байланыс сияқты анонимді статистика сақталады. Байланыс деректері жиналмайды.',
      title: 'Бағыт туралы пікіріңіз',
      intro: 'Нәтиже сізге қаншалықты пайдалы болды? Пікіріңіз сервисті жақсартуға көмектеседі.',
      useful: 'Нәтиже қаншалықты пайдалы болды?',
      found: 'Өзіңізге сәйкес бағыт таптыңыз ба?',
      foundYes: 'Иә, бір бағыт таптым',
      foundSeveral: 'Бірнеше нұсқа таптым',
      foundNo: 'Әлі анықтай алмадым',
      clear: 'Келесі қадам не екенін түсіндіңіз бе?',
      yes: 'Иә', partly: 'Ішінара', no: 'Жоқ',
      comment: 'Сервисте нені жақсартуға болады? (міндетті емес)',
      placeholder: 'Қысқаша пікіріңіз...',
      send: 'Пікірді жіберу',
      need: 'Үш негізгі сұраққа жауап беріңіз.',
      sending: 'Жіберіліп жатыр…',
      thanks: 'Рақмет! Пікіріңіз сақталды.',
      error: 'Пікірді жіберу мүмкін болмады. Интернетті тексеріп, қайта көріңіз.'
    },
    ru: {
      privacy: 'Для улучшения сервиса сохраняется обезличенная статистика прохождения и обратная связь. Контактные данные не собираются.',
      title: 'Ваше мнение о «Бағыт»',
      intro: 'Насколько результат оказался полезным? Ваш ответ поможет улучшить сервис.',
      useful: 'Насколько полезным был результат?',
      found: 'Удалось найти подходящее направление?',
      foundYes: 'Да, нашёл(а) одно направление',
      foundSeveral: 'Нашёл(а) несколько вариантов',
      foundNo: 'Пока не определился(ась)',
      clear: 'Стало понятнее, что делать дальше?',
      yes: 'Да', partly: 'Частично', no: 'Нет',
      comment: 'Что можно улучшить в сервисе? (необязательно)',
      placeholder: 'Короткий комментарий...',
      send: 'Отправить отзыв',
      need: 'Ответьте на три основных вопроса.',
      sending: 'Отправляем…',
      thanks: 'Спасибо! Ваш отзыв сохранён.',
      error: 'Не удалось отправить отзыв. Проверьте интернет и попробуйте ещё раз.'
    },
    en: {
      privacy: 'To improve the service, we store anonymous completion statistics and feedback. Contact details are not collected.',
      title: 'Your feedback on Bagyt',
      intro: 'How useful was your result? Your feedback helps us improve the service.',
      useful: 'How useful was the result?',
      found: 'Did you find a suitable direction?',
      foundYes: 'Yes, one clear direction',
      foundSeveral: 'I found several options',
      foundNo: 'Not yet',
      clear: 'Is your next step clearer now?',
      yes: 'Yes', partly: 'Partly', no: 'No',
      comment: 'What should we improve? (optional)',
      placeholder: 'Short comment...',
      send: 'Send feedback',
      need: 'Please answer the three main questions.',
      sending: 'Sending…',
      thanks: 'Thank you! Your feedback was saved.',
      error: 'Could not send feedback. Check your connection and try again.'
    }
  };

  function tr() {
    return I18N[currentLang()] || I18N.kk;
  }

  function injectPrivacyNote() {
    const home = document.getElementById('home');
    if (!home || document.getElementById('bagyt-privacy-note')) return;
    const lead = home.querySelector('.lead');
    if (!lead) return;
    const note = document.createElement('div');
    note.id = 'bagyt-privacy-note';
    note.className = 'bagyt-privacy-note';
    note.innerHTML = '<span aria-hidden="true">🔒</span><span>' + tr().privacy + '</span>';
    lead.insertAdjacentElement('afterend', note);
  }

  function feedbackDoneKey(sessionId) {
    return 'bagyt_feedback_' + sessionId;
  }

  function radioGroup(name, items) {
    return '<div class="bagyt-options">' + items.map(function (item) {
      return '<label class="bagyt-option"><input type="radio" name="' + name + '" value="' + item[0] + '"><span>' + item[1] + '</span></label>';
    }).join('') + '</div>';
  }

  function renderFeedbackCard() {
    const result = document.getElementById('result');
    if (!result || document.getElementById('bagyt-feedback')) return;
    const sessionId = getSessionId();
    if (!sessionId) return;

    const d = tr();
    const box = document.createElement('div');
    box.id = 'bagyt-feedback';
    box.className = 'card bagyt-feedback';

    if (localStorage.getItem(feedbackDoneKey(sessionId))) {
      box.innerHTML = '<h3>' + d.title + '</h3><p class="bagyt-feedback-success">✓ ' + d.thanks + '</p>';
      result.appendChild(box);
      return;
    }

    box.innerHTML =
      '<h3>' + d.title + '</h3>' +
      '<p class="mu">' + d.intro + '</p>' +
      '<fieldset><legend>' + d.useful + '</legend><div class="bagyt-rating">' +
        [1,2,3,4,5].map(function (n) { return '<label><input type="radio" name="bagyt_useful" value="' + n + '"><span>' + n + '</span></label>'; }).join('') +
      '</div></fieldset>' +
      '<fieldset><legend>' + d.found + '</legend>' + radioGroup('bagyt_found', [['yes',d.foundYes],['several',d.foundSeveral],['no',d.foundNo]]) + '</fieldset>' +
      '<fieldset><legend>' + d.clear + '</legend>' + radioGroup('bagyt_clear', [['yes',d.yes],['partly',d.partly],['no',d.no]]) + '</fieldset>' +
      '<label class="bagyt-comment"><span>' + d.comment + '</span><textarea id="bagyt-feedback-comment" maxlength="1200" rows="4" placeholder="' + d.placeholder + '"></textarea></label>' +
      '<button type="button" class="btn" id="bagyt-feedback-send">' + d.send + '</button>' +
      '<p id="bagyt-feedback-status" class="small" aria-live="polite"></p>';

    result.appendChild(box);
    const btn = document.getElementById('bagyt-feedback-send');
    if (btn) btn.addEventListener('click', submitFeedback);
  }

  async function submitFeedback() {
    const d = tr();
    const btn = document.getElementById('bagyt-feedback-send');
    const status = document.getElementById('bagyt-feedback-status');
    const useful = document.querySelector('input[name="bagyt_useful"]:checked');
    const found = document.querySelector('input[name="bagyt_found"]:checked');
    const clear = document.querySelector('input[name="bagyt_clear"]:checked');
    const commentEl = document.getElementById('bagyt-feedback-comment');

    if (!useful || !found || !clear) {
      if (status) { status.className = 'small status bad'; status.textContent = d.need; }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = d.sending; }
    if (status) status.textContent = '';

    try {
      const sessionId = await ensureSession();
      await post('feedback', {
        session_id: sessionId,
        client_id: getClientId(),
        useful_score: Number(useful.value),
        found_direction: found.value,
        next_step_clear: clear.value,
        comment: (commentEl && commentEl.value.trim()) ? commentEl.value.trim().slice(0, 1200) : null
      });
      localStorage.setItem(feedbackDoneKey(sessionId), '1');
      await recordEvent('feedback_submitted', { useful_score: Number(useful.value), found_direction: found.value, next_step_clear: clear.value }, true);
      const box = document.getElementById('bagyt-feedback');
      if (box) box.innerHTML = '<h3>' + d.title + '</h3><p class="bagyt-feedback-success">✓ ' + d.thanks + '</p>';
    } catch (err) {
      console.warn('[Бағыт analytics]', err);
      if (btn) { btn.disabled = false; btn.textContent = d.send; }
      if (status) { status.className = 'small status bad'; status.textContent = d.error; }
    }
  }

  function completionSummary() {
    const out = { role: currentRole(), lang: currentLang() };
    try {
      if (typeof app !== 'undefined' && app.answers) {
        out.grade = app.answers.grade || null;
        out.pair = app.answers.pair || null;
      }
      if (typeof profiles !== 'undefined' && currentRole() && profiles[currentRole()] && profiles[currentRole()].profile) {
        const p = profiles[currentRole()].profile;
        out.top_professions = (p.professions || []).slice(0, 3).map(function (x) { return x.id; });
      }
    } catch (_) {}
    return out;
  }

  function hookApp() {
    if (typeof startSurvey === 'function') {
      const originalStart = startSurvey;
      startSurvey = function () {
        if (typeof app !== 'undefined' && app.role) beginSession(app.role, false);
        return originalStart.apply(this, arguments);
      };
    }

    if (typeof resumeDraft === 'function') {
      const originalResume = resumeDraft;
      resumeDraft = function () {
        let role = currentRole();
        try {
          const draft = JSON.parse(localStorage.getItem('cn6_draft') || 'null');
          if (draft && draft.role) role = draft.role;
        } catch (_) {}
        beginSession(role, true);
        return originalResume.apply(this, arguments);
      };
    }

    if (typeof finishSurvey === 'function') {
      const originalFinish = finishSurvey;
      finishSurvey = function () {
        const result = originalFinish.apply(this, arguments);
        setTimeout(function () { recordEvent('survey_completed', completionSummary(), true); }, 0);
        return result;
      };
    }

    if (typeof go === 'function') {
      const originalGo = go;
      go = function (id) {
        const result = originalGo.apply(this, arguments);
        const map = {
          result: 'result_viewed',
          route: 'route_viewed',
          professions: 'professions_viewed',
          programs: 'programs_viewed',
          universities: 'universities_viewed',
          colleges: 'colleges_viewed'
        };
        if (map[id] && getSessionId()) recordEvent(map[id], { section: id }, true);
        if (id === 'result') setTimeout(renderFeedbackCard, 0);
        if (id === 'home') setTimeout(injectPrivacyNote, 0);
        return result;
      };
    }

    if (typeof renderHome === 'function') {
      const originalHome = renderHome;
      renderHome = function () {
        const result = originalHome.apply(this, arguments);
        setTimeout(injectPrivacyNote, 0);
        return result;
      };
    }
  }

  hookApp();
  injectPrivacyNote();
  if (typeof app !== 'undefined' && app.section === 'result') renderFeedbackCard();

  window.BAGYT_ANALYTICS = {
    recordEvent: recordEvent,
    renderFeedback: renderFeedbackCard
  };
})();
