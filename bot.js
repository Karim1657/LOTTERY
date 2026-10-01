'use strict';
// টেলিগ্রাম বট (কোনো লাইব্রেরি ছাড়া, সরাসরি Bot API)
const TOKEN = process.env.BOT_TOKEN || '';
const API = `https://api.telegram.org/bot${TOKEN}`;

const stats = { events: null, lastError: null };
const hasToken = () => !!TOKEN && !/PUT-YOUR-BOT-TOKEN/.test(TOKEN);

// চ্যানেল আইডি স্বাভাবিক করা: @name, t.me/name, -100123..., 123... সব চলবে
function normChannel(v) {
  let c = String(v ?? '').trim();
  if (!c) return '';
  c = c.replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me)\//i, '').replace(/^\/+|\/+$/g, '');
  if (/^-?\d+$/.test(c)) return c;
  return c.startsWith('@') ? c : '@' + c;
}

async function call(method, body, _retry) {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`${API}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    const j = await r.json();
    if (j && !j.ok) {
      // টেলিগ্রামের রেট-লিমিট: নির্দিষ্ট সময় অপেক্ষা করে আবার চেষ্টা
      if (j.error_code === 429 && !_retry) {
        const wait = ((j.parameters && j.parameters.retry_after) || 2) * 1000;
        await new Promise(res => setTimeout(res, Math.min(wait, 30000)));
        return call(method, body, true);
      }
      if (method === 'sendMessage') stats.lastError = j.description;
    }
    return j;
  } catch (e) { console.error('[bot]', method, e.message); stats.lastError = e.message; return null; }
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
  if (!hasToken()) { console.warn('[bot] BOT_TOKEN নেই — বট বন্ধ, শুধু ওয়েব চলছে'); return; }
  const url = process.env.WEBAPP_URL;
  if (url) call('setChatMenuButton', { menu_button: { type: 'web_app', text: '🎟 BD LOTTERY', web_app: { url } } });
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
            text: '🎟 <b>BD LOTTERY-তে স্বাগতম!</b>\nনিচের বাটনে চাপ দিয়ে অ্যাপ খুলুন।',
            reply_markup: { inline_keyboard: [[{ text: '🎟 লটারি খুলুন', web_app: { url } }]] },
          });
        }
      }
    }
  })();
}
module.exports = { notify, broadcast, channelBroadcast, startBot, hasToken, normChannel, stats };
