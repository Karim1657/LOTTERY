'use strict';
// .env লোড (কোনো লাইব্রেরি ছাড়া)
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*([^#]*?)\s*(#.*)?$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const { all, get, run, tx, getSettings, setSetting, changeBalance, HttpError, now } = require('./db');
const bot = require('./bot');
const L = require('./lottery');
const events = require('./events');

const PORT = +process.env.PORT || 3000;
const DEV = process.env.DEV_MODE === '1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD সেট করা নেই — এডমিন লগইন বন্ধ থাকবে');
const taka = L.taka;
const UPLOADS = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, 'data', 'lottery.db')), 'uploads');
function removeLogo(key) {
  const cur = getSettings()[key + '_logo'];
  if (cur && cur.startsWith('/uploads/')) { try { fs.unlinkSync(path.join(UPLOADS, path.basename(cur))); } catch {} }
}
const LEGACY_METHODS = { bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' };
function getPaymentMethods() {
  const s = getSettings();
  try {
    const a = JSON.parse(s.payment_methods || '[]');
    if (Array.isArray(a) && a.length) return a.map(x => ({
      key: String(x.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g,'_'),
      name: String(x.name || '').trim().slice(0,60),
      number: String(x.number || '').trim().slice(0,120),
      enabled: x.enabled !== false,
      logo: String(x.logo || '')
    })).filter(x => x.key && x.name);
  } catch {}
  return Object.entries(LEGACY_METHODS).map(([key,name]) => ({key,name,number:s[key+'_number']||'',enabled:!!s[key+'_number'],logo:s[key+'_logo']||''}));
}
function savePaymentMethods(list) { setSetting('payment_methods', JSON.stringify(list)); }
function methodName(key) { return (getPaymentMethods().find(m => m.key === key) || {}).name || key; }
function safePhone(v) {
  const p = String(v || '').trim().replace(/[\s-]/g,'');
  if (!p) return '';
  if (/^\+8801\d{9}$/.test(p)) return '0' + p.slice(4);
  if (/^01\d{9}$/.test(p)) return p;
  throw new HttpError(400, 'ফোন নাম্বার সঠিক নয়');
}
function saveImageData(data, prefix, maxBytes = 2e6) {
  const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!m) throw new HttpError(400, 'সঠিক ছবি দিন');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > maxBytes) throw new HttpError(400, 'ছবির আকার ২MB-এর মধ্যে হতে হবে');
  const magic = {png:[0x89,0x50],jpeg:[0xff,0xd8],webp:[0x52,0x49],gif:[0x47,0x49]}[m[1]];
  if (buf[0] !== magic[0] || buf[1] !== magic[1]) throw new HttpError(400, 'ছবির ফাইল সঠিক নয়');
  fs.mkdirSync(UPLOADS, { recursive: true });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return '/uploads/' + name;
}

// ---------- টেলিগ্রাম initData যাচাই ----------
function verifyInitData(initData) {
  if (!initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash'); if (!hash) return null;
  p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN || '').digest();
  const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return { user: JSON.parse(p.get('user')), start_param: p.get('start_param') || '' }; } catch { return null; }
}
function upsertUser(tg, startParam) {
  const id = Number(tg.id);
  let u = get('SELECT * FROM users WHERE id=?', id);
  if (!u) {
    let ref = null;
    const m = /^ref_?(\d+)$/.exec(startParam || '');
    if (m && Number(m[1]) !== id && get('SELECT 1 x FROM users WHERE id=?', Number(m[1]))) ref = Number(m[1]);
    run('INSERT INTO users(id,first_name,last_name,username,referred_by,created_at,last_seen) VALUES(?,?,?,?,?,?,?)',
      id, tg.first_name || '', tg.last_name || '', tg.username || '', ref, now(), now());
  } else {
    const fresh = Date.now() - new Date(u.last_seen || 0).getTime() > 60000;
    const changed = u.first_name !== (tg.first_name || '') || u.last_name !== (tg.last_name || '') || u.username !== (tg.username || '');
    if (fresh || changed) run('UPDATE users SET first_name=?,last_name=?,username=?,last_seen=? WHERE id=?',
      tg.first_name || '', tg.last_name || '', tg.username || '', now(), id);
  }
  return get('SELECT * FROM users WHERE id=?', id);
}
function authUser(req) {
  let info = verifyInitData(req.headers['x-init-data']);
  if (!info && DEV && req.headers['x-dev-user']) {
    const id = Number(req.headers['x-dev-user']);
    info = { user: { id, first_name: 'Dev' + id, username: 'dev' + id }, start_param: req.headers['x-dev-start'] || '' };
  }
  if (!info) throw new HttpError(401, 'টেলিগ্রাম থেকে অ্যাপ খুলুন');
  const u = upsertUser(info.user, info.start_param);
  if (u.banned) throw new HttpError(403, 'আপনার অ্যাকাউন্ট ব্লক করা হয়েছে। সাপোর্টে যোগাযোগ করুন।');
  return u;
}

// ---------- এডমিন সেশন ----------
const sessions = new Map();
function authAdmin(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) { sessions.delete(t); throw new HttpError(401, 'লগইন করুন'); }
}
const loginFails = new Map();

// ---------- ইনপুট হেল্পার ----------
const int = (v, name, min = 0, max = 1e9) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} সঠিক নয়`);
  return n;
};
const str = (v, name, max = 200) => {
  const s = String(v ?? '').trim();
  if (!s || s.length > max) throw new HttpError(400, `${name} সঠিক নয়`);
  return s;
};
const userName = u => (u.first_name + ' ' + (u.last_name || '')).trim() || u.username || String(u.id);
const maskName = n => n.length <= 2 ? n[0] + '*' : n.slice(0, 2) + '***';

function lotteryView(l, uid) {
  const sold = get('SELECT COUNT(*) c FROM tickets WHERE lottery_id=?', l.id).c;
  const mine = uid ? get('SELECT COUNT(*) c FROM tickets WHERE lottery_id=? AND user_id=?', l.id, uid).c : 0;
  const prizes = L.parsePrizes(l);
  return { ...l, prizes, sold, mine, prize_total: prizes.reduce((a, b) => a + b, 0) };
}

// ================= ইউজার API =================
const userRoutes = {
  'GET /api/me': (req, u) => {
    const s = getSettings();
    const pub = {
      app_name: s.app_name, announcement: s.announcement, maintenance: s.maintenance === '1',
      min_deposit: +s.min_deposit, max_deposit: +s.max_deposit, min_withdraw: +s.min_withdraw, max_withdraw: +s.max_withdraw,
      withdraw_fee_percent: +s.withdraw_fee_percent, deposit_bonus_percent: +s.deposit_bonus_percent,
      referral_bonus: +s.referral_bonus, support_link: s.support_link, support_channel: s.support_channel, deposit_note: s.deposit_note,
      methods: getPaymentMethods().filter(m => m.enabled && m.number).map(m => ({key:m.key,name:m.name,number:m.number,logo:m.logo})),
      all_methods: getPaymentMethods().filter(m => m.enabled).map(m => ({key:m.key,name:m.name,logo:m.logo})),
      review: get('SELECT ROUND(AVG(rating),1) avg, COUNT(*) count FROM reviews') || {avg:0,count:0},
      bot_username: process.env.BOT_USERNAME || '',
    };
    const refs = get('SELECT COUNT(*) c FROM users WHERE referred_by=?', u.id).c;
    return { user: { id: u.id, name: userName(u), phone: u.phone || '', balance: u.balance, total_won: u.total_won, referrals: refs }, settings: pub };
  },
  'GET /api/reviews': (req, u) => {
    const stat = get('SELECT ROUND(AVG(rating),1) avg, COUNT(*) count FROM reviews') || {avg:0,count:0};
    return { stats: { avg: Number(stat.avg || 0), count: Number(stat.count || 0) },
      mine: get('SELECT rating,text FROM reviews WHERE user_id=?', u.id) || null,
      items: all(`SELECT r.rating,r.text,r.created_at,u.first_name,u.username FROM reviews r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 50`) };
  },
  'POST /api/reviews': (req, u, p, b) => {
    const rating = int(b.rating, 'রেটিং', 1, 5);
    const text = String(b.text || '').trim().slice(0, 500);
    const t = now();
    run(`INSERT INTO reviews(user_id,rating,text,created_at,updated_at) VALUES(?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET rating=excluded.rating,text=excluded.text,updated_at=excluded.updated_at`,
      u.id, rating, text, t, t);
    return { ok:true, message:'⭐ আপনার রিভিউ সংরক্ষণ করা হয়েছে।' };
  },
  'GET /api/lotteries': (req, u) => {
    const open = all("SELECT * FROM lotteries WHERE status='open' ORDER BY draw_time").map(l => lotteryView(l, u.id));
    const past = all("SELECT * FROM lotteries WHERE status IN ('drawn','cancelled') ORDER BY drawn_at DESC LIMIT 50").map(l => {
      const v = lotteryView(l, u.id);
      v.winners = all(`SELECT t.rank, t.number, t.prize, t.user_id, us.first_name, us.username FROM tickets t JOIN users us ON us.id=t.user_id
                       WHERE t.lottery_id=? AND t.rank IS NOT NULL ORDER BY t.rank`, l.id)
        .map(w => ({ rank: w.rank, number: w.number, prize: w.prize, name: ((w.first_name || '') + (w.username ? ' @' + w.username : '')).trim() || 'User', me: w.user_id === u.id }));
      return v;
    });
    return { open, past };
  },
  'GET /api/lottery/:id': (req, u, p) => {
    const l = get('SELECT * FROM lotteries WHERE id=?', int(p.id, 'id'));
    if (!l) throw new HttpError(404, 'পাওয়া যায়নি');
    const taken = all('SELECT number FROM tickets WHERE lottery_id=?', l.id).map(r => r.number);
    const mine = all('SELECT number, prize, rank FROM tickets WHERE lottery_id=? AND user_id=? ORDER BY number', l.id, u.id);
    return { lottery: lotteryView(l, u.id), taken, mine };
  },
  'POST /api/lottery/:id/buy': (req, u, p, b) => {
    if (getSettings().maintenance === '1') throw new HttpError(503, 'অ্যাপ এখন রক্ষণাবেক্ষণে আছে');
    return L.buyTickets(u.id, int(p.id, 'id'), b.count, b.numbers);
  },
  'GET /api/my/tickets': (req, u) => ({
    tickets: all(`SELECT t.number, t.prize, t.rank, t.created_at, l.id lottery_id, l.title, l.status, l.draw_time
                  FROM tickets t JOIN lotteries l ON l.id=t.lottery_id WHERE t.user_id=? ORDER BY t.id DESC LIMIT 200`, u.id),
  }),
  'GET /api/my/history': (req, u) => ({
    transactions: all('SELECT type,amount,balance_after,note,created_at FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100', u.id),
    deposits: all('SELECT id,amount,method,trx_id,status,note,created_at FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 50', u.id),
    withdrawals: all('SELECT id,amount,fee,method,number,status,note,created_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 50', u.id),
  }),
  'POST /api/deposit': (req, u, p, b) => {
    const s = getSettings();
    const method = str(b.method, 'মাধ্যম', 40);
    const pm = getPaymentMethods().find(m => m.key === method && m.enabled && m.number);
    if (!pm) throw new HttpError(400, 'মাধ্যম সঠিক নয়');
    const amount = int(b.amount, 'পরিমাণ', +s.min_deposit, +s.max_deposit);
    const sender = str(b.sender_number, 'প্রেরকের নাম্বার', 30);
    const trx = str(b.trx_id, 'TrxID', 60);
    const phone = safePhone(b.phone);
    if (!phone) throw new HttpError(400, 'ফোন নাম্বার দিন');
    if (!b.screenshot) throw new HttpError(400, 'ডিপোজিটের স্ক্রিনশট আবশ্যক');
    const screenshot = saveImageData(b.screenshot, 'dep', 2e6);
    if (get('SELECT 1 x FROM deposits WHERE trx_id=?', trx)) throw new HttpError(400, 'এই ট্রানজেকশন আইডি আগেই জমা দেওয়া হয়েছে');
    if (get("SELECT COUNT(*) c FROM deposits WHERE user_id=? AND status='pending'", u.id).c >= 5)
      throw new HttpError(400, 'একসাথে সর্বোচ্চ ৫টি ডিপোজিট অপেক্ষমাণ রাখা যাবে');
    run('UPDATE users SET phone=? WHERE id=?', phone, u.id);
    run('INSERT INTO deposits(user_id,amount,method,sender_number,trx_id,screenshot,created_at) VALUES(?,?,?,?,?,?,?)', u.id, amount, method, sender, trx, screenshot, now());
    return { ok: true, message: '⬇️ ডিপোজিট সিস্টেমে আপনার অনুরোধ সফলভাবে জমা হয়েছে। স্ক্রিনশটসহ এডমিন যাচাই করবেন।' };
  },
  'POST /api/withdraw': (req, u, p, b) => {
    const s = getSettings();
    const method = str(b.method, 'মাধ্যম', 40);
    const pm = getPaymentMethods().find(m => m.key === method && m.enabled);
    if (!pm) throw new HttpError(400, 'মাধ্যম সঠিক নয়');
    const amount = int(b.amount, 'পরিমাণ', +s.min_withdraw, +s.max_withdraw);
    const number = str(b.number, 'নাম্বার', 120);
    const phone = safePhone(b.phone);
    if (!phone) throw new HttpError(400, 'ফোন নাম্বার দিন');
    const fee = Math.ceil(amount * (+s.withdraw_fee_percent) / 100);
    tx(() => {
      if (get("SELECT COUNT(*) c FROM withdrawals WHERE user_id=? AND status='pending'", u.id).c >= 3)
        throw new HttpError(400, 'আপনার ৩টি উত্তোলন অপেক্ষমাণ আছে');
      changeBalance(u.id, -amount, 'withdraw', '', `${pm.name} ${number}`);
      run('UPDATE users SET phone=? WHERE id=?', phone, u.id);
      run('INSERT INTO withdrawals(user_id,amount,fee,method,number,created_at) VALUES(?,?,?,?,?,?)', u.id, amount, fee, method, number, now());
    });
    return { ok: true, receive: amount - fee, message: `⬆️ উত্তোলন সিস্টেমে আপনার অনুরোধ জমা হয়েছে। ফি ${taka(fee)} বাদে আপনি পাবেন ${taka(amount - fee)}।` };
  },

};

// ================= এডমিন API =================
const A = {
  'GET /admin/api/reviews': () => {
    const stat = get('SELECT ROUND(AVG(rating),1) avg, COUNT(*) count FROM reviews') || {avg:0,count:0};
    return { stats:{avg:Number(stat.avg||0),count:Number(stat.count||0)},
      items: all(`SELECT r.rating,r.text,r.created_at,u.id user_id,u.first_name,u.username,u.phone FROM reviews r JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 200`) };
  },
  'GET /admin/api/stats': () => {
    const c = (sql, ...p) => get(sql, ...p).c ?? 0;
    return {
      users: c('SELECT COUNT(*) c FROM users'), banned: c('SELECT COUNT(*) c FROM users WHERE banned=1'),
      balances: c('SELECT COALESCE(SUM(balance),0) c FROM users'),
      pending_deposits: c("SELECT COUNT(*) c FROM deposits WHERE status='pending'"),
      pending_deposit_sum: c("SELECT COALESCE(SUM(amount),0) c FROM deposits WHERE status='pending'"),
      pending_withdrawals: c("SELECT COUNT(*) c FROM withdrawals WHERE status='pending'"),
      pending_withdraw_sum: c("SELECT COALESCE(SUM(amount-fee),0) c FROM withdrawals WHERE status='pending'"),
      total_deposit: c("SELECT COALESCE(SUM(amount),0) c FROM deposits WHERE status='approved'"),
      total_withdraw: c("SELECT COALESCE(SUM(amount-fee),0) c FROM withdrawals WHERE status='paid'"),
      withdraw_fees: c("SELECT COALESCE(SUM(fee),0) c FROM withdrawals WHERE status='paid'"),
      ticket_sales: c("SELECT COALESCE(-SUM(amount),0) c FROM transactions WHERE type='ticket_buy'"),
      refunds: c("SELECT COALESCE(SUM(amount),0) c FROM transactions WHERE type='refund'"),
      prizes_paid: c("SELECT COALESCE(SUM(amount),0) c FROM transactions WHERE type='prize'"),
      open_lotteries: c("SELECT COUNT(*) c FROM lotteries WHERE status='open'"),
    };
  },
  'GET /admin/api/users': (req, q) => {
    const like = `%${(q.q || '').trim()}%`;
    const page = Math.max(1, +q.page || 1), per = 30;
    const where = q.q ? 'WHERE CAST(id AS TEXT) LIKE ? OR first_name LIKE ? OR username LIKE ?' : '';
    const args = q.q ? [like, like, like] : [];
    return {
      total: get(`SELECT COUNT(*) c FROM users ${where}`, ...args).c,
      users: all(`SELECT * FROM users ${where} ORDER BY id DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, ...args),
    };
  },
  'GET /admin/api/users/:id': (req, q, p) => {
    const u = get('SELECT * FROM users WHERE id=?', int(p.id, 'id', 1, 1e15));
    if (!u) throw new HttpError(404, 'ইউজার নেই');
    return {
      user: u,
      referrals: get('SELECT COUNT(*) c FROM users WHERE referred_by=?', u.id).c,
      tickets: all(`SELECT t.number,t.prize,t.rank,t.created_at,l.title,l.status FROM tickets t JOIN lotteries l ON l.id=t.lottery_id WHERE t.user_id=? ORDER BY t.id DESC LIMIT 100`, u.id),
      transactions: all('SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100', u.id),
      deposits: all('SELECT * FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 50', u.id),
      withdrawals: all('SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 50', u.id),
    };
  },
  'POST /admin/api/users/:id/balance': (req, q, p, b) => {
    const id = int(p.id, 'id', 1, 1e15); const amt = int(b.amount, 'পরিমাণ', -1e8, 1e8);
    if (!amt) throw new HttpError(400, 'পরিমাণ 0 হতে পারে না');
    const nb = tx(() => changeBalance(id, amt, 'admin_adjust', '', String(b.note || 'এডমিন সমন্বয়').slice(0, 200)));
    bot.notify(id, `${amt > 0 ? '➕' : '➖'} এডমিন আপনার ব্যালেন্স ${taka(Math.abs(amt))} ${amt > 0 ? 'যোগ' : 'কর্তন'} করেছেন। বর্তমান ব্যালেন্স: ${taka(nb)}`);
    return { balance: nb };
  },
  'POST /admin/api/users/:id/ban': (req, q, p, b) => {
    const id = int(p.id, 'id', 1, 1e15);
    run('UPDATE users SET banned=? WHERE id=?', b.banned ? 1 : 0, id);
    bot.notify(id, b.banned ? '🚫 আপনার অ্যাকাউন্ট ব্লক করা হয়েছে।' : '✅ আপনার অ্যাকাউন্ট আনব্লক করা হয়েছে।');
    return { ok: true };
  },
  'POST /admin/api/users/:id/message': (req, q, p, b) => {
    bot.notify(int(p.id, 'id', 1, 1e15), str(b.text, 'মেসেজ', 3500)); return { ok: true };
  },
  'POST /admin/api/broadcast': async (req, q, p, b) => {
    const text = str(b.text, 'মেসেজ', 3500);
    const s = getSettings();
    if (b.channel) {
      const cid = bot.normChannel(s.telegram_channel_id);
      if (!cid) throw new HttpError(400, 'টেলিগ্রাম চ্যানেল আইডি সেট করা নেই (সেটিংস → Telegram Channel ID)');
      if (!bot.hasToken()) throw new HttpError(400, 'BOT_TOKEN সেট করা নেই');
      const footer = String(s.channel_broadcast_footer || '').trim();
      const msg = `╔════════════════════╗\n🎰 <b>BD LOTTERY</b>\n╠════════════════════╣\n📢 <b>অফিসিয়াল ঘোষণা</b>\n\n${text}${footer ? `\n╠════════════════════╣\n${footer}` : ''}\n╚════════════════════╝`;
      const r = await bot.channelBroadcast(cid, msg);
      if (!r || !r.ok) throw new HttpError(400, 'চ্যানেলে যায়নি: ' + ((r && r.description) || 'নেটওয়ার্ক ত্রুটি') + ' — বটকে চ্যানেলে অ্যাডমিন বানিয়েছেন তো?');
      return { ok: true, queued: 0, channel: cid };
    }
    const ids = all('SELECT id FROM users WHERE banned=0').map(r => r.id);
    bot.broadcast(ids, `🎰 <b>BD LOTTERY</b>\n\n${text}`).then(r => console.log('[broadcast]', r));
    return { ok: true, queued: ids.length, channel: null };
  },
  'GET /admin/api/broadcast-status': () => ({ token: bot.hasToken(), channel: bot.normChannel(getSettings().telegram_channel_id), last: bot.stats.events, lastError: bot.stats.lastError }),
  'GET /admin/api/payment-methods': () => ({ items: getPaymentMethods() }),
  'POST /admin/api/payment-methods': (req, q, p, b) => {
    const list = getPaymentMethods();
    const key = String(b.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g,'_');
    const name = str(b.name, 'মাধ্যমের নাম', 60);
    const number = String(b.number || '').trim().slice(0,120);
    if (!key) throw new HttpError(400, 'মাধ্যমের key দরকার');
    if (list.some(x => x.key === key && x.key !== String(b.original_key || ''))) throw new HttpError(409, 'এই key ইতিমধ্যে আছে');
    const original = String(b.original_key || '').trim();
    const i = list.findIndex(x => x.key === original);
    const item = { key, name, number, enabled: b.enabled !== false, logo: i >= 0 ? list[i].logo : '' };
    if (i >= 0) list[i] = item; else list.push(item);
    savePaymentMethods(list); return { ok:true, item };
  },
  'POST /admin/api/payment-methods/delete': (req, q, p, b) => {
    const key = String(b.key || '').trim();
    const list = getPaymentMethods().filter(x => x.key !== key);
    savePaymentMethods(list); return { ok:true };
  },
  // ---- ডিপোজিট ----
  'GET /admin/api/deposits': (req, q) => ({
    items: all(`SELECT d.*, u.first_name, u.username, u.phone FROM deposits d JOIN users u ON u.id=d.user_id
                ${q.status ? 'WHERE d.status=?' : ''} ORDER BY d.id DESC LIMIT 200`, ...(q.status ? [q.status] : [])),
  }),
  'POST /admin/api/deposits/:id/approve': (req, q, p, b) => {
    const s = getSettings(); const amountOverride = b.amount != null && b.amount !== '' ? int(b.amount, 'পরিমাণ', 1, 1e8) : null;
    const d = tx(() => {
      const d = get('SELECT * FROM deposits WHERE id=?', int(p.id, 'id'));
      if (!d) throw new HttpError(404, 'পাওয়া যায়নি');
      if (d.status !== 'pending') throw new HttpError(400, 'ইতিমধ্যে প্রক্রিয়া হয়েছে');
      const amount = amountOverride ?? d.amount;
      run("UPDATE deposits SET status='approved', amount=?, processed_at=?, note=? WHERE id=?", amount, now(), String(b.note || ''), d.id);
      changeBalance(d.user_id, amount, 'deposit', d.id, `${methodName(d.method)} TrxID ${d.trx_id}`);
      run('UPDATE users SET total_deposit=total_deposit+? WHERE id=?', amount, d.user_id);
      const bonusPct = +s.deposit_bonus_percent;
      if (bonusPct > 0) changeBalance(d.user_id, Math.floor(amount * bonusPct / 100), 'bonus', d.id, `ডিপোজিট বোনাস ${bonusPct}%`);
      const first = get("SELECT COUNT(*) c FROM deposits WHERE user_id=? AND status='approved'", d.user_id).c === 1;
      const u = get('SELECT referred_by FROM users WHERE id=?', d.user_id);
      if (first && u.referred_by && +s.referral_bonus > 0) {
        changeBalance(u.referred_by, +s.referral_bonus, 'referral', d.user_id, 'রেফারেল বোনাস');
        bot.notify(u.referred_by, `🎁 আপনার রেফার করা বন্ধু প্রথম ডিপোজিট করেছেন। বোনাস ${taka(+s.referral_bonus)} যোগ হয়েছে!`);
      }
      return { ...d, amount };
    });
    events.depositApproved({ ...d, methodName: methodName(d.method) });
    bot.notify(d.user_id, `✅ আপনার ${taka(d.amount)} ডিপোজিট অনুমোদিত হয়েছে এবং ব্যালেন্সে যোগ করা হয়েছে।`);
    return { ok: true };
  },
  'POST /admin/api/deposits/:id/reject': (req, q, p, b) => {
    const d = get('SELECT * FROM deposits WHERE id=?', int(p.id, 'id'));
    if (!d || d.status !== 'pending') throw new HttpError(400, 'প্রক্রিয়া করা যাবে না');
    run("UPDATE deposits SET status='rejected', processed_at=?, note=? WHERE id=?", now(), String(b.note || ''), d.id);
    bot.notify(d.user_id, `❌ আপনার ${taka(d.amount)} ডিপোজিট (TrxID ${d.trx_id}) বাতিল হয়েছে।${b.note ? '\nকারণ: ' + b.note : ''}`);
    return { ok: true };
  },
  // ---- উত্তোলন ----
  'GET /admin/api/withdrawals': (req, q) => ({
    items: all(`SELECT w.*, u.first_name, u.username, u.phone FROM withdrawals w JOIN users u ON u.id=w.user_id
                ${q.status ? 'WHERE w.status=?' : ''} ORDER BY w.id DESC LIMIT 200`, ...(q.status ? [q.status] : [])),
  }),
  'POST /admin/api/withdrawals/:id/approve': (req, q, p, b) => {
    const w = get('SELECT * FROM withdrawals WHERE id=?', int(p.id, 'id'));
    if (!w || w.status !== 'pending') throw new HttpError(400, 'প্রক্রিয়া করা যাবে না');
    run("UPDATE withdrawals SET status='paid', processed_at=?, note=?, trx_id=? WHERE id=?", now(), String(b.note || ''), String(b.trx_id || '').slice(0, 40), w.id);
    run('UPDATE users SET total_withdraw=total_withdraw+? WHERE id=?', w.amount - w.fee, w.user_id);
    events.withdrawPaid(w, methodName(w.method));
    bot.notify(w.user_id, `✅ আপনার উত্তোলন সম্পন্ন! ${methodName(w.method)} (${w.number}) এ ${taka(w.amount - w.fee)} পাঠানো হয়েছে।${b.trx_id ? '\nTrxID: ' + b.trx_id : ''}`);
    return { ok: true };
  },
  'POST /admin/api/withdrawals/:id/reject': (req, q, p, b) => {
    const w = tx(() => {
      const w = get('SELECT * FROM withdrawals WHERE id=?', int(p.id, 'id'));
      if (!w || w.status !== 'pending') throw new HttpError(400, 'প্রক্রিয়া করা যাবে না');
      run("UPDATE withdrawals SET status='rejected', processed_at=?, note=? WHERE id=?", now(), String(b.note || ''), w.id);
      changeBalance(w.user_id, w.amount, 'withdraw_refund', w.id, 'উত্তোলন বাতিল — ফেরত');
      return w;
    });
    bot.notify(w.user_id, `❌ আপনার ${taka(w.amount)} উত্তোলন বাতিল হয়েছে, টাকা ব্যালেন্সে ফেরত দেওয়া হয়েছে।${b.note ? '\nকারণ: ' + b.note : ''}`);
    return { ok: true };
  },
  // ---- লটারি ----
  'GET /admin/api/lotteries': () => ({ items: all('SELECT * FROM lotteries ORDER BY id DESC LIMIT 100').map(l => lotteryView(l)) }),
  'GET /admin/api/lotteries/:id': (req, q, p) => {
    const l = get('SELECT * FROM lotteries WHERE id=?', int(p.id, 'id'));
    if (!l) throw new HttpError(404, 'পাওয়া যায়নি');
    return {
      lottery: lotteryView(l),
      tickets: all(`SELECT t.number,t.rank,t.prize,t.user_id,u.first_name,u.username FROM tickets t JOIN users u ON u.id=t.user_id WHERE t.lottery_id=? ORDER BY t.number`, l.id),
    };
  },
  'POST /admin/api/lotteries': (req, q, p, b) => {
    const f = lotteryFields(b);
    const r = run(`INSERT INTO lotteries(title,description,ticket_price,max_tickets,min_tickets,max_per_user,prizes,draw_time,auto_draw,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)`, f.title, f.description, f.ticket_price, f.max_tickets, f.min_tickets, f.max_per_user, JSON.stringify(f.prizes), f.draw_time, f.auto_draw, now());
    return { id: Number(r.lastInsertRowid) };
  },
  'PUT /admin/api/lotteries/:id': (req, q, p, b) => {
    const l = get('SELECT * FROM lotteries WHERE id=?', int(p.id, 'id'));
    if (!l || l.status !== 'open') throw new HttpError(400, 'শুধু খোলা লটারি এডিট করা যায়');
    const f = lotteryFields(b);
    const sold = get('SELECT COUNT(*) c FROM tickets WHERE lottery_id=?', l.id).c;
    if (sold > 0 && (f.ticket_price !== l.ticket_price || f.max_tickets < l.max_tickets))
      throw new HttpError(400, 'টিকিট বিক্রি শুরু হলে দাম বদলানো বা মোট টিকিট কমানো যাবে না');
    run(`UPDATE lotteries SET title=?,description=?,ticket_price=?,max_tickets=?,min_tickets=?,max_per_user=?,prizes=?,draw_time=?,auto_draw=? WHERE id=?`,
      f.title, f.description, f.ticket_price, f.max_tickets, f.min_tickets, f.max_per_user, JSON.stringify(f.prizes), f.draw_time, f.auto_draw, l.id);
    return { ok: true };
  },
  'POST /admin/api/lotteries/:id/draw': (req, q, p, b) => ({ winners: L.drawLottery(int(p.id, 'id'), Array.isArray(b.numbers) ? b.numbers : []) }),
  'POST /admin/api/lotteries/:id/cancel': (req, q, p, b) => { L.cancelLottery(int(p.id, 'id'), String(b.reason || '')); return { ok: true }; },
  'POST /admin/api/lotteries/:id/reuse': (req, q, p, b) => {
    const l = get('SELECT * FROM lotteries WHERE id=?', int(p.id, 'id'));
    if (!l || !['drawn','cancelled'].includes(l.status)) throw new HttpError(400, 'শুধু ড্র/বাতিল হওয়া লটারি পুনরায় ব্যবহার করা যাবে');
    const dt = new Date(b.draw_time || Date.now() + 86400000);
    if (isNaN(dt)) throw new HttpError(400, 'ড্র এর সময় সঠিক নয়');
    const title = String(b.title || l.title).slice(0,100);
    const r = run(`INSERT INTO lotteries(title,description,ticket_price,max_tickets,min_tickets,max_per_user,prizes,draw_time,auto_draw,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)`, title, l.description, l.ticket_price, l.max_tickets, l.min_tickets, l.max_per_user, l.prizes, dt.toISOString(), l.auto_draw, now());
    return { ok:true, id:Number(r.lastInsertRowid) };
  },
  // ---- লেনদেন ও সেটিংস ----
  'GET /admin/api/transactions': (req, q) => ({
    items: all(`SELECT t.*, u.first_name, u.username FROM transactions t JOIN users u ON u.id=t.user_id
                ${q.type ? 'WHERE t.type=?' : ''} ORDER BY t.id DESC LIMIT 300`, ...(q.type ? [q.type] : [])),
  }),
  'POST /admin/api/payment-logo': (req, q, p, b) => {
    const key = String(b.key || '').trim();
    const list = getPaymentMethods(); const item = list.find(x => x.key === key);
    if (!item) throw new HttpError(400, 'মাধ্যম সঠিক নয়');
    if (b.remove) { item.logo=''; savePaymentMethods(list); return { ok:true,url:'' }; }
    const url = saveImageData(b.data, 'pm_'+key, 1.5e6);
    if (item.logo && item.logo.startsWith('/uploads/')) { try { fs.unlinkSync(path.join(UPLOADS,path.basename(item.logo))); } catch {} }
    item.logo=url; savePaymentMethods(list); return {ok:true,url};
  },
  'GET /admin/api/settings': () => ({ settings: getSettings() }),
  'POST /admin/api/settings': (req, q, p, b) => {
    const cur = getSettings();
    for (const [k, v] of Object.entries(b)) if (k in cur && !k.endsWith('_logo')) setSetting(k, String(v).slice(0, 1000));
    return { ok: true };
  },
};
function lotteryFields(b) {
  const prizes = (Array.isArray(b.prizes) ? b.prizes : String(b.prizes || '').split(/[,\s]+/)).filter(x => x !== '').map(x => int(x, 'পুরস্কার', 1, 1e9));
  if (!prizes.length) throw new HttpError(400, 'কমপক্ষে ১টি পুরস্কার দিন');
  const max_tickets = int(b.max_tickets, 'মোট টিকিট', 1, 100000);
  if (prizes.length > max_tickets) throw new HttpError(400, 'পুরস্কার সংখ্যা মোট টিকিটের বেশি');
  const dt = new Date(b.draw_time); if (isNaN(dt)) throw new HttpError(400, 'ড্র এর সময় সঠিক নয়');
  return {
    title: str(b.title, 'শিরোনাম', 100), description: String(b.description || '').slice(0, 500),
    ticket_price: int(b.ticket_price, 'টিকিট মূল্য', 1, 1e7), max_tickets,
    min_tickets: int(b.min_tickets || 0, 'ন্যূনতম টিকিট', 0, max_tickets), max_per_user: int(b.max_per_user || 0, 'জনপ্রতি সীমা', 0, 100000),
    prizes, draw_time: dt.toISOString(), auto_draw: b.auto_draw ? 1 : 0,
  };
}

// ================= রাউটার =================
function compile(table) {
  return Object.entries(table).map(([key, fn]) => {
    const [method, pattern] = key.split(' ');
    const names = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    return { method, re, names, fn };
  });
}
const userR = compile(userRoutes), adminR = compile(A);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' };

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > limit) { reject(new HttpError(413, 'অনেক বড়')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { reject(new HttpError(400, 'ভুল JSON')); } });
  });
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  try {
    // ---- API ----
    if (pathname.startsWith('/api/') || pathname.startsWith('/admin/api/')) {
      const isAdmin = pathname.startsWith('/admin/api/');
      if (isAdmin && req.method === 'POST' && pathname === '/admin/api/login') {
        const ip = req.socket.remoteAddress; const f = loginFails.get(ip) || { n: 0, t: 0 };
        if (f.n >= 5 && Date.now() - f.t < 600000) throw new HttpError(429, 'অনেকবার ভুল — ১০ মিনিট পর চেষ্টা করুন');
        const b = await readBody(req);
        const ok = ADMIN_PASSWORD && typeof b.password === 'string' &&
          b.password.length === ADMIN_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(b.password), Buffer.from(ADMIN_PASSWORD));
        if (!ok) { loginFails.set(ip, { n: f.n + 1, t: Date.now() }); throw new HttpError(401, 'পাসওয়ার্ড ভুল'); }
        loginFails.delete(ip);
        const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, Date.now() + 12 * 3600e3);
        return send(res, 200, { token: t });
      }
      const table = isAdmin ? adminR : userR;
      for (const r of table) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname); if (!m) continue;
        const params = {}; r.names.forEach((n, i) => params[n] = m[i + 1]);
        const body = req.method === 'GET' ? {} : await readBody(req, pathname === '/admin/api/payment-logo' || pathname === '/api/deposit' ? 4e6 : 1e6);
        if (isAdmin) { authAdmin(req); return send(res, 200, await r.fn(req, req.method === 'GET' ? Object.fromEntries(url.searchParams) : params, params, body)); }
        const u = authUser(req);
        return send(res, 200, await r.fn(req, u, params, body));
      }
      throw new HttpError(404, 'API পাওয়া যায়নি');
    }
    // ---- আপলোড করা ছবি ----
    if (pathname.startsWith('/uploads/')) {
      const f = path.join(UPLOADS, path.basename(pathname));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'image/png', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
      return fs.createReadStream(f).pipe(res);
    }
    // ---- স্ট্যাটিক ফাইল ----
    let rel = pathname === '/' ? '/index.html' : pathname;
    if (rel === '/admin' || rel === '/admin/') rel = '/admin/index.html';
    const file = path.join(__dirname, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!(e instanceof HttpError)) { console.error(e); }
    const code = e.status || (/UNIQUE/.test(e.message) ? 409 : 500);
    send(res, code, { error: e instanceof HttpError ? e.message : (code === 409 ? 'ডুপ্লিকেট এন্ট্রি' : 'সার্ভার ত্রুটি') });
  }
});

server.listen(PORT, () => console.log(`✅ সার্ভার চালু: http://localhost:${PORT}  |  এডমিন: /admin/  ${DEV ? '(DEV_MODE)' : ''}`));
bot.startBot({
  onStart: m => {
    const parts = m.text.split(' '); const ref = parts[1] || '';
    upsertUser(m.from, ref);
  },
});
setInterval(L.autoTick, 30000);
L.autoTick();
