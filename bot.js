'use strict';
// টেলিগ্রাম বট (কোনো লাইব্রেরি ছাড়া, সরাসরি Bot API)
const TOKEN = process.env.BOT_TOKEN || '';
const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method, body) {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`${API}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    return await r.json();
  } catch (e) { console.error('[bot]', method, e.message); return null; }
}
const notify = (chatId, text) => call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
const channelBroadcast = (chatId, text) => call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });

async function broadcast(ids, text, onProgress) {
  let ok = 0, fail = 0;
  for (const id of ids) {
    const r = await notify(id, text);
    r && r.ok ? ok++ : fail++;
    await new Promise(res => setTimeout(res, 40)); // ~25 মেসেজ/সেকেন্ড, লিমিটের নিচে
  }
  return { ok, fail };
}

function startBot({ onStart }) {
  if (!TOKEN) { console.warn('[bot] BOT_TOKEN নেই — বট বন্ধ, শুধু ওয়েব চলছে'); return; }
  const url = process.env.WEBAPP_URL;
  if (url) call('setChatMenuButton', { menu_button: { type: 'web_app', text: '🎟 লটারি', web_app: { url } } });
  if (process.env.BOT_POLLING === '0') return;
  call('deleteWebhook', {});
  let offset = 0;
  (async function loop() {
    for (;;) {
      const r = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
      if (!r || !r.ok) { await new Promise(res => setTimeout(res, 3000)); continue; }
      for (const u of r.result) {
        offset = u.update_id + 1;
        const m = u.message; if (!m || !m.text || m.chat.type !== 'private') continue;
        try { onStart && onStart(m); } catch (e) { console.error(e); }
        if (/^\/(start|help)/.test(m.text) && url) {
          await call('sendMessage', {
            chat_id: m.chat.id, parse_mode: 'HTML',
            text: '🎟 <b>লটারিতে স্বাগতম!</b>\nনিচের বাটনে চাপ দিয়ে অ্যাপ খুলুন।',
            reply_markup: { inline_keyboard: [[{ text: '🎟 লটারি খুলুন', web_app: { url } }]] },
          });
        }
      }
    }
  })();
}
module.exports = { notify, broadcast, channelBroadcast, startBot };
