#!/usr/bin/env node
/** Telegram setup helper. Tokens are read without echo and never printed. */
function maskedPrompt(label) {
  if (!process.stdin.isTTY) {
    throw new Error('Интерактивті терминал қажет немесе мәнді қауіпсіз орта айнымалысына орнатыңыз.');
  }
  return new Promise((resolve, reject) => {
    const wasRaw = process.stdin.isRaw;
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let value = '';
    const finish = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(Boolean(wasRaw));
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') { finish(); reject(new Error('Тоқтатылды.')); return; }
        if (character === '\r' || character === '\n') { finish(); resolve(value.trim()); return; }
        if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character >= ' ') value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const command = process.argv[2];
  if (!['get-chat-id', 'set-webhook', 'delete-webhook'].includes(command)) {
    console.log('node scripts/telegram-admin.mjs get-chat-id');
    console.log('node scripts/telegram-admin.mjs set-webhook --url=https://YOUR-WORKER.workers.dev/api/telegram/webhook');
    console.log('node scripts/telegram-admin.mjs delete-webhook');
    return;
  }
  const token = process.env.BOT_TOKEN || await maskedPrompt('BotFather токені (экранда көрсетілмейді): ');
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('BotFather токенінің пішімі жарамсыз.');
  async function call(method, body) {
    let response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error('Telegram желісіне қосылу мүмкін болмады. Токен журналға жазылған жоқ.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      if (response.status === 409) throw new Error('Webhook орнатылған. get-chat-id алдында delete-webhook командасын орындаңыз.');
      throw new Error(`Telegram сұрауы өтпеді (HTTP ${response.status}). Токен мен ботқа қолжетімділікті тексеріңіз.`);
    }
    return data.result;
  }
  if (command === 'get-chat-id') {
    const updates = await call('getUpdates', { timeout: 0, allowed_updates: ['message'] });
    const chats = new Map();
    for (const update of updates) {
      const chat = update.message?.chat;
      if (chat?.id !== undefined) chats.set(String(chat.id), chat.type);
    }
    if (!chats.size) console.log('Чат табылмады. Telegram-да өз ботыңызды ашып, /start жіберіңіз де, осы команданы қайталаңыз.');
    for (const [id, type] of chats) console.log(`chat_id: ${id} (${type})`);
    return;
  }
  if (command === 'delete-webhook') {
    await call('deleteWebhook', { drop_pending_updates: false });
    console.log('Webhook алынды. Нәтижелерді sendMessage арқылы жіберу жалғаса береді.');
    return;
  }
  const argument = process.argv.slice(3).find(item => item.startsWith('--url='));
  let url;
  try { url = new URL(argument?.slice(6)); } catch { throw new Error('--url=https://YOUR-WORKER.workers.dev/api/telegram/webhook қажет.'); }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/api/telegram/webhook' || url.search || url.hash) {
    throw new Error('Webhook HTTPS болуы керек, жолы /api/telegram/webhook.');
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ||
    await maskedPrompt('Worker-ге орнатылған TELEGRAM_WEBHOOK_SECRET (көрсетілмейді): ');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw new Error('Webhook құпиясы 32–256 латын әрпі/сан/_/- таңбасы болуы керек.');
  await call('setWebhook', { url: url.href, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true });
  console.log('Webhook орнатылды. Бот /start және /help командаларына тек мұғалім чатында жауап береді.');
}

main().catch(error => {
  // Only errors created above reach this branch; do not print raw fetch objects.
  console.error(error.message);
  process.exitCode = 1;
});
