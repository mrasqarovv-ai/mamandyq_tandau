// Бұл файлда ҚҰПИЯ кілт жоқ. Мұнда тек браузер қосылатын Worker адресі тұрады.
window.MAMANDYQ_CONFIG = {
  AI_API_URL: "https://mamandyq-ai.mr-asqarovv.workers.dev/chat"
};

// SEO enhancement for Google and other search engines.
// Маңызды: бұл жерде API key немесе басқа құпия дерек жоқ.
(function () {
  const title = 'Бағыт — мамандық таңдау тесті, кәсіби бағдар, ЖОО және грант';
  const description = 'Бағыт — Қазақстан оқушыларына арналған мамандық таңдау және кәсіби бағдар платформасы. Мамандық таңдау тестін өтіп, бейіндік пәндер, ҰБТ, білім беру бағдарламалары, ЖОО және грант мүмкіндіктерін зерттеңіз.';
  const keywords = 'мамандық таңдау, мамандық таңдау тесті, кәсіби бағдар, кәсіби бағдар тесті, профориентация, ҰБТ, ҰБТ мамандық таңдау, ЖОО, университет таңдау, грант, грантқа түсу, білім беру бағдарламасы, Қазақстан, 9 сынып мамандық таңдау, 10 сынып мамандық таңдау, 11 сынып мамандық таңдау, абитуриент';

  document.title = title;

  function setMeta(selector, attr, value) {
    let el = document.querySelector(selector);
    if (!el) {
      el = document.createElement('meta');
      if (selector.includes('property=')) {
        const m = selector.match(/property="([^"]+)"/);
        if (m) el.setAttribute('property', m[1]);
      } else {
        const m = selector.match(/name="([^"]+)"/);
        if (m) el.setAttribute('name', m[1]);
      }
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  }

  setMeta('meta[name="description"]', 'content', description);
  setMeta('meta[name="keywords"]', 'content', keywords);
  setMeta('meta[property="og:title"]', 'content', 'Бағыт — мамандық таңдау тесті және кәсіби бағдар');
  setMeta('meta[property="og:description"]', 'content', 'Мамандық таңдау тесті, кәсіби бағдар, ҰБТ, ЖОО және грант мүмкіндіктері — Қазақстан оқушыларына арналған бір платформада.');
  setMeta('meta[name="twitter:title"]', 'content', 'Бағыт — мамандық таңдау тесті және кәсіби бағдар');
  setMeta('meta[name="twitter:description"]', 'content', 'Мамандық таңдау, кәсіби бағдар, ҰБТ, ЖОО және грант мүмкіндіктері.');

  // Табиғи SEO мәтіні: кілт сөздерді жасырып қоюдың орнына,
  // қолданушыға пайдалы түсіндірме ретінде басты бетте көрсетіледі.
  function ensureSeoBlock() {
    const home = document.getElementById('home');
    if (!home || document.getElementById('seo-guide')) return;

    const block = document.createElement('div');
    block.id = 'seo-guide';
    block.className = 'card';
    block.setAttribute('aria-label', 'Мамандық таңдау және кәсіби бағдар туралы');
    block.innerHTML = `
      <h2>Мамандық таңдау және кәсіби бағдар</h2>
      <p><b>Бағыт</b> — Қазақстандағы 9–11 сынып оқушылары мен ата-аналарына арналған мамандық таңдау тесті және кәсіби бағдар платформасы. Қызығушылық пен қабілетке сай мамандықтарды зерттеп, бейіндік пәндер мен ҰБТ нәтижесіне байланысты білім беру бағдарламаларын қарауға болады.</p>
      <p>Платформа Қазақстандағы ЖОО нұсқаларын, білім беру бағдарламалары топтарын және грант бойынша тарихи көрсеткіштерді бір жерден салыстыруға көмектеседі. Нәтижелер шешімді сіздің орныңызға қабылдамайды — олар мамандық пен оқу бағытын саналы таңдауға арналған бағдар береді.</p>
      <div class="row wrap" aria-label="Негізгі мүмкіндіктер">
        <span class="tag">Мамандық таңдау тесті</span>
        <span class="tag">Кәсіби бағдар</span>
        <span class="tag">ҰБТ және бейіндік пәндер</span>
        <span class="tag">ЖОО таңдау</span>
        <span class="tag">Грант көрсеткіштері</span>
      </div>`;
    home.appendChild(block);
  }

  ensureSeoBlock();

  // Басты бет қайта рендерленсе, SEO блогын қайта қосамыз.
  const observer = new MutationObserver(() => {
    const home = document.getElementById('home');
    if (home && !document.getElementById('seo-guide')) ensureSeoBlock();
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
})();
