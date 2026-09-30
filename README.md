# Бағыт · Career Navigator AI v12

Қазақстан оқушылары мен ата-аналарына арналған мамандық және білім беру бағытын таңдауға көмектесетін Career Navigator жобасы.

## Архитектура

- **Frontend:** GitHub Pages (`index.html`, `assets/`, `config.js`)
- **AI backend:** Cloudflare Worker (`worker/`)
- **AI:** OpenAI Responses API
- **Өзекті ақпарат:** OpenAI Web Search
- **API key:** тек Cloudflare Secret ішінде сақталады, GitHub-та да, браузерде де болмайды

## Репозиторий

Бұл жоба `mrasqarovv-ai/mamandyq_tandau` репозиторийінде жарияланған.

GitHub Pages адресі Pages қосылғаннан кейін әдетте:

`https://mrasqarovv-ai.github.io/mamandyq_tandau/`

## AI-ды іске қосу

### 1. Cloudflare Worker deploy

Компьютерде Node.js LTS орнатып, репозиторийді clone/download жасаңыз. Содан кейін:

```powershell
cd worker
npm install
npx wrangler login
npx wrangler deploy
```

Deploy соңында шамамен мынадай адрес шығады:

`https://mamandyq-ai.YOUR-SUBDOMAIN.workers.dev`

### 2. OpenAI API key-ді Secret ретінде сақтау

```powershell
npx wrangler secret put OPENAI_API_KEY
```

API key-ді GitHub файлдарына, `config.js` немесе `wrangler.toml` ішіне жазбаңыз.

### 3. Worker-ды тексеру

Браузерде:

`https://mamandyq-ai.YOUR-SUBDOMAIN.workers.dev/health`

ашыңыз. Жауап шамамен:

```json
{"ok":true,"service":"mamandyq-ai","model":"gpt-5.6-luna"}
```

### 4. Frontend-ті Worker-ға қосу

`config.js` файлын ашып:

```js
window.MAMANDYQ_CONFIG = {
  AI_API_URL: "https://REPLACE-WITH-YOUR-WORKER.workers.dev/chat"
};
```

адресті өз Worker адресіңізге ауыстырыңыз:

```js
window.MAMANDYQ_CONFIG = {
  AI_API_URL: "https://mamandyq-ai.YOUR-SUBDOMAIN.workers.dev/chat"
};
```

Commit жасаңыз. GitHub Pages сайтты автоматты жаңартады.

## AI мүмкіндіктері

Бағыт AI:

- пайдаланушының қысқаша Career Navigator профилін контекст ретінде қолдана алады;
- мамандық, B-топ, ҰБТ, ЖОО және оқу маршруты туралы жауап береді;
- өзгеруі мүмкін ақпарат қажет болса, web search қолдана алады;
- web search қолданылған жауаптарда дереккөз сілтемелерін интерфейске қайтарады;
- 2026–2027 тарихи грант деректерін тек тарихи салыстыру ретінде түсіндіреді, кепілдік немесе ықтималдық ретінде көрсетпейді.

## Қауіпсіздік

- `OPENAI_API_KEY` тек Cloudflare Secret ішінде сақталады.
- `.env`, `.dev.vars` және secret файлдар `.gitignore` арқылы қорғалған.
- Worker CORS және rate limit қолданады.
- Public endpoint толық жасырын болмайды, сондықтан OpenAI Platform-та usage/budget limit орнатқан дұрыс.
- ЖСН, пароль, карта деректері және басқа құпия ақпаратты AI-ға жібермеңіз.

## Тексеру

AI іске қосылғаннан кейін:

1. `B057 туралы түсіндір.`
2. `Astana IT University туралы қазіргі ресми ақпаратты интернеттен тексер.`
3. `Менің профиліме қарап, ТОП-3 бағытты түсіндір.`

деген сұрақтармен тексеруге болады.

Толық checklist: `DEPLOY_CHECKLIST.md`.

---

Copyright © 2026 Бағыт · Career Navigator. Барлық құқықтар қорғалған.
