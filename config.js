// Browser-ға арналған public/publishable баптаулар. Мұнда secret/service-role key жоқ.
window.MAMANDYQ_CONFIG = {
  AI_API_URL: "https://mamandyq-ai.mr-asqarovv.workers.dev/chat",
  SUPABASE_URL: "https://fmgcrhghunpyafghdzfp.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_X58QoClreM9QT0_UrQdudQ_uHjXsdR-"
};

// Goal-first SEO and visible explanatory block.
(function () {
  const title = 'Бағыт — мамандық таңдау және мақсатқа жету маршруты';
  const description = 'Бағыт — 9–11 сынып оқушыларына арналған кәсіби бағдар және білім маршруты платформасы. Өзіңді таны, БББ мен ЖОО мақсатын таңда, ҰБТ нәтижеңді тарихи дерекпен салыстыр және A/B/C жеке әрекет жоспарын құр.';
  const keywords = 'мамандық таңдау, кәсіби бағдар, мақсатқа жету, жеке маршрут, қалай түсуге болады, ҰБТ жоспары, ЖОО таңдау, грант, білім беру бағдарламасы, A B C жоспар, оқушы ата-ана салыстыру, Қазақстан';

  document.title = title;

  function setMeta(selector, attr, value) {
    let el = document.querySelector(selector);
    if (!el) {
      el = document.createElement('meta');
      const prop = selector.match(/property="([^"]+)"/);
      const name = selector.match(/name="([^"]+)"/);
      if (prop) el.setAttribute('property', prop[1]);
      if (name) el.setAttribute('name', name[1]);
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  }

  setMeta('meta[name="description"]', 'content', description);
  setMeta('meta[name="keywords"]', 'content', keywords);
  setMeta('meta[property="og:title"]', 'content', 'Бағыт — мақсатқа жету жолын құратын кәсіби бағдар платформасы');
  setMeta('meta[property="og:description"]', 'content', description);
  setMeta('meta[name="twitter:title"]', 'content', 'Бағыт — мақсатқа жету маршруты');
  setMeta('meta[name="twitter:description"]', 'content', 'Өзіңді таны → мақсат таңда → айырманы көр → A/B/C жеке маршрут құр.');

  function ensureSeoBlock() {
    const home = document.getElementById('home');
    if (!home || document.getElementById('seo-guide')) return;
    const block = document.createElement('div');
    block.id = 'seo-guide';
    block.className = 'card';
    block.setAttribute('aria-label', 'Мамандық таңдау және мақсатқа жету жолы');
    block.innerHTML = `
      <h2>Мамандық таңдау және мақсатқа жету жолы</h2>
      <p><b>Бағыт</b> екі түрлі жағдайда көмектеседі: мақсаты әлі анық емес оқушы қызығушылық, қабілет және құндылық арқылы өзін таниды; ал мақсаты бар оқушы нақты БББ мен ЖОО-ны таңдап, қазіргі нәтижесі мен тарихи бағдар арасындағы айырманы көреді.</p>
      <p>Сервис жай ғана «қайда түсуге болады?» деген тізім бермейді. Ол негізгі мақсатқа арналған <b>A жоспарын</b>, сол бағыттағы балама ЖОО үшін <b>B жоспарын</b> және сол бейіндік пәндермен ашылатын балама білім бағдарламалары үшін <b>C жоспарын</b> құрады. Тарихи грант көрсеткіштері кепілдік емес, тек салыстыру ориентирі ретінде көрсетіледі.</p>
      <div class="row wrap" aria-label="Негізгі мүмкіндіктер">
        <span class="tag">Өзіңді тану</span>
        <span class="tag">Мақсат пен ЖОО</span>
        <span class="tag">ҰБТ прогресі</span>
        <span class="tag">A/B/C маршрут</span>
        <span class="tag">Оқушы–ата-ана салыстыру</span>
      </div>`;
    home.appendChild(block);
  }

  ensureSeoBlock();
  const observer = new MutationObserver(() => {
    const home = document.getElementById('home');
    if (home && !document.getElementById('seo-guide')) ensureSeoBlock();
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
})();

// Feedback card discoverability: keep feedback near the top of the result page.
(function () {
  function promoteFeedback() {
    const result = document.getElementById('result');
    const card = document.getElementById('bagyt-feedback');
    if (!result || !card) return;
    const note = result.querySelector('.note');
    if (note && card.previousElementSibling !== note) note.insertAdjacentElement('afterend', card);
    card.classList.add('bagyt-feedback-prominent');
    card.setAttribute('aria-label', 'Бағыт кері байланысы');
  }
  const style = document.createElement('style');
  style.textContent = '.bagyt-feedback-prominent{border:2px solid var(--ac)!important;box-shadow:0 8px 24px rgba(0,0,0,.08)}';
  document.head.appendChild(style);
  const feedbackObserver = new MutationObserver(() => window.setTimeout(promoteFeedback, 0));
  if (document.body) feedbackObserver.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(promoteFeedback, 0);
})();
