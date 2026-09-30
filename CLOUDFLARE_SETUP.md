# Cloudflare Worker-ды іске қосу

Бұл репозиторийде `.github/workflows/deploy-worker.yml` дайын. Сізге кодпен жұмыс істеудің қажеті жоқ: GitHub-та үш Secret қосасыз, содан кейін workflow-ды іске қосасыз.

## 1. Cloudflare аккаунтын дайындау

1. Cloudflare Dashboard-қа кіріңіз.
2. **Workers & Pages** бөліміне кіріңіз.
3. Аккаунтыңыздың **Account ID** мәнін көшіріп алыңыз.
4. **API Tokens** бөліміне өтіңіз.
5. **Create Token** таңдаңыз.
6. `Edit Cloudflare Workers` шаблонын таңдаңыз немесе Workers-ды өңдеуге жеткілікті ең аз құқықтары бар token жасаңыз.
7. Token-ды тек осы Cloudflare аккаунтына шектеңіз.
8. Жасалған token мәнін бір рет көшіріп алыңыз.

## 2. OpenAI API key дайындау

OpenAI Platform-та API key жасаңыз. Кілтті ешқашан repository файлына, `config.js`, `wrangler.toml`, issue немесе chat ішіне жазбаңыз.

## 3. GitHub Secrets қосу

Repository:

`mrasqarovv-ai/mamandyq_tandau`

GitHub-та:

**Settings → Secrets and variables → Actions → New repository secret**

үш Secret жасаңыз:

- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare Account ID
- `CLOUDFLARE_API_TOKEN` — Cloudflare API Token
- `OPENAI_API_KEY` — OpenAI API key

Мәндер GitHub Actions Secret ішінде сақталады және repository кодында көрсетілмейді.

## 4. Deploy іске қосу

1. Repository ішінен **Actions** бөліміне кіріңіз.
2. Сол жақтан **Deploy AI Worker** таңдаңыз.
3. **Run workflow** → `main` → **Run workflow**.
4. Job жасыл белгімен аяқталғанша күтіңіз.

Workflow автоматты түрде:

1. `worker/` кодын Cloudflare Workers-қа deploy етеді;
2. `OPENAI_API_KEY` мәнін Worker Secret ретінде береді;
3. Cloudflare берген `https://...workers.dev` адресін алады;
4. repository-дегі `config.js` файлын автоматты түрде `/chat` endpoint-іне ауыстырады;
5. commit жасап, GitHub Pages сайтын қайта жаңартады.

Сондықтан Worker URL-ды қолмен `config.js` ішіне енгізудің қажеті жоқ.

## 5. Тексеру

Deploy біткен соң `config.js` ішіндегі `AI_API_URL` `REPLACE-WITH...` болмай, нақты Workers URL болуы тиіс.

Сайт:

`https://mrasqarovv-ai.github.io/mamandyq_tandau/`

Сайттағы **Бағыт AI** батырмасын ашып:

- `B057 туралы түсіндір`
- `Astana IT University туралы қазіргі ақпаратты интернеттен тексер`

деп тексеріңіз.

Екінші сұрақта ассистент қажет деп тапса OpenAI Web Search қолдана алады.

## 6. Қауіпсіздік

- API key-лерді чатқа жібермеңіз.
- Secret мәндерін кодқа commit етпеңіз.
- OpenAI Platform-та usage/budget limit орнатыңыз.
- Cloudflare API Token-ға тек қажетті Workers құқықтарын беріңіз.
- Егер token немесе key кездейсоқ жарияланса, оны дереу revoke жасап, жаңасын жасаңыз.
