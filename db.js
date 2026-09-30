'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const file = process.env.DB_FILE || path.join(__dirname, 'data', 'lottery.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,               -- টেলিগ্রাম ইউজার আইডি
  first_name TEXT, last_name TEXT, username TEXT,
  balance INTEGER NOT NULL DEFAULT 0,   -- টাকা (পূর্ণসংখ্যা)
  banned INTEGER NOT NULL DEFAULT 0,
  referred_by INTEGER,
  total_deposit INTEGER NOT NULL DEFAULT 0,
  total_withdraw INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_seen TEXT
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS lotteries(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, description TEXT DEFAULT '',
  ticket_price INTEGER NOT NULL,
  max_tickets INTEGER NOT NULL,
  min_tickets INTEGER NOT NULL DEFAULT 0,   -- এর কম বিক্রি হলে ড্র বাতিল + রিফান্ড
  max_per_user INTEGER NOT NULL DEFAULT 0,  -- 0 = সীমাহীন
  prizes TEXT NOT NULL,                     -- JSON [১ম, ২য়, ৩য়...] টাকায়
  draw_time TEXT NOT NULL,
  auto_draw INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',      -- open | drawn | cancelled
  created_at TEXT NOT NULL, drawn_at TEXT
);
CREATE TABLE IF NOT EXISTS tickets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lottery_id INTEGER NOT NULL REFERENCES lotteries(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  number INTEGER NOT NULL,
  prize INTEGER NOT NULL DEFAULT 0, rank INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(lottery_id, number)
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE TABLE IF NOT EXISTS deposits(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, amount INTEGER NOT NULL,
  method TEXT NOT NULL, sender_number TEXT NOT NULL, trx_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', note TEXT DEFAULT '',
  created_at TEXT NOT NULL, processed_at TEXT
);
CREATE TABLE IF NOT EXISTS withdrawals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, amount INTEGER NOT NULL, fee INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL, number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | rejected
  note TEXT DEFAULT '', trx_id TEXT DEFAULT '',
  created_at TEXT NOT NULL, processed_at TEXT
);
CREATE TABLE IF NOT EXISTS transactions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, type TEXT NOT NULL,
  amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
  ref TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
`);

const DEFAULTS = {
  app_name: 'ভাগ্যচক্র লটারি',
  bkash_number: '01XXXXXXXXX',
  nagad_number: '01XXXXXXXXX',
  rocket_number: '',
  min_deposit: '50', max_deposit: '50000',
  min_withdraw: '100', max_withdraw: '25000',
  withdraw_fee_percent: '2',
  deposit_bonus_percent: '0',
  referral_bonus: '10',
  announcement: 'স্বাগতম! টিকিট কিনুন, ভাগ্য পরীক্ষা করুন।',
  maintenance: '0',
  support_link: '',
  bkash_logo: '', nagad_logo: '', rocket_logo: '',
  deposit_note: 'উপরের নাম্বারে "Send Money" করুন, তারপর নিচের ফর্ম পূরণ করুন।',
};
const now = () => new Date().toISOString();

for (const [k, v] of Object.entries(DEFAULTS)) {
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);
}

const all = (sql, ...p) => db.prepare(sql).all(...p).map(r => ({ ...r }));
const get = (sql, ...p) => { const r = db.prepare(sql).get(...p); return r ? { ...r } : undefined; };
const run = (sql, ...p) => db.prepare(sql).run(...p);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}
function getSettings() {
  const o = {}; for (const r of all('SELECT key,value FROM settings')) o[r.key] = r.value; return o;
}
function setSetting(k, v) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
}
/** ব্যালেন্স পরিবর্তন + লেনদেন লগ (tx() এর ভেতরে ডাকতে হবে) */
function changeBalance(userId, delta, type, ref = '', note = '') {
  const u = get('SELECT balance FROM users WHERE id=?', userId);
  if (!u) throw new HttpError(404, 'ইউজার পাওয়া যায়নি');
  const nb = u.balance + delta;
  if (nb < 0) throw new HttpError(400, 'পর্যাপ্ত ব্যালেন্স নেই');
  run('UPDATE users SET balance=? WHERE id=?', nb, userId);
  run('INSERT INTO transactions(user_id,type,amount,balance_after,ref,note,created_at) VALUES(?,?,?,?,?,?,?)',
    userId, type, delta, nb, String(ref), note, now());
  return nb;
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

module.exports = { db, all, get, run, tx, getSettings, setSetting, changeBalance, HttpError, now };
