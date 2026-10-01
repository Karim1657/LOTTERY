'use strict';
// ইভেন্ট ব্রডকাস্ট: ডিপোজিট, উত্তোলন, ড্রয়ের বিজয়ী, টিকিট ক্রয় — টেলিগ্রাম চ্যানেল + বট ইউজারদের কাছে।
// সেটিংস: event_broadcast_channel / event_broadcast_bot (0 = বন্ধ), broadcast_mask_names (0 = পুরো নাম)
const { all, get, getSettings } = require('./db');
const bot = require('./bot');

const taka = n => '৳' + Number(n).toLocaleString('en-IN');
const bn = n => Number(n).toLocaleString('bn-BD');
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const ORD = ['১ম', '২য়', '৩য়', '৪র্থ', '৫ম', '৬ষ্ঠ', '৭ম', '৮ম', '৯ম', '১০ম'];
const MEDAL = ['🥇', '🥈', '🥉'];

function nameOf(userId) {
  const u = get('SELECT first_name,last_name,username FROM users WHERE id=?', userId) || {};
  const full = ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.username || 'User';
  if (getSettings().broadcast_mask_names === '0') return esc(full);
  const a = Array.from(full);
  return esc(a.length <= 2 ? a[0] + '*' : a.slice(0, 2).join('') + '***');
}

// ইউজারের নাম + ইউজারনেম + আইডি — হালকা বর্ডার লাইনে সাজানো
function userCard(userId, extra = []) {
  const u = get('SELECT first_name,last_name,username FROM users WHERE id=?', userId) || {};
  const masked = getSettings().broadcast_mask_names !== '0';
  const uname = u.username ? (masked ? '@' + esc(Array.from(u.username).slice(0, 2).join('')) + '***' : '@' + esc(u.username)) : '—';
  const idStr = masked ? String(userId).slice(0, 2) + '*'.repeat(Math.max(3, String(userId).length - 2)) : String(userId);
  const rows = [`👤 <b>${nameOf(userId)}</b>`, `🔖 ${uname}`, `🆔 <code>${esc(idStr)}</code>`, ...extra];
  return `┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐\n${rows.map(r => '┆ ' + r).join('\n')}\n└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘`;
}

// ---------- সিরিয়াল কিউ (একটার পর একটা, টেলিগ্রাম লিমিট মেনে) ----------
const queue = []; let running = false;
function push(title, body) {
  if (queue.length >= 500) queue.shift();
  queue.push({ title, body });
  if (!running) pump();
}
async function pump() {
  running = true;
  while (queue.length) {
    const ev = queue.shift();
    try { await deliver(ev); } catch (e) { console.error('[events]', e.message); }
  }
  running = false;
}
async function deliver({ title, body }) {
  if (!bot.hasToken()) return;
  const s = getSettings();
  const rec = { at: new Date().toISOString(), title, channel: null, users: null };
  const cid = bot.normChannel(s.telegram_channel_id);
  if (s.event_broadcast_channel !== '0' && cid) {
    const footer = String(s.channel_broadcast_footer || '').trim();
    const msg = `╔════════════════════╗\n🎰 <b>BD LOTTERY</b>\n╠════════════════════╣\n${title}\n╠════════════════════╣\n${body}${footer ? `\n╠════════════════════╣\n${footer}` : ''}\n╚════════════════════╝`;
    const r = await bot.channelBroadcast(cid, msg);
    rec.channel = r && r.ok ? 'ok' : ((r && r.description) || 'নেটওয়ার্ক ত্রুটি');
    if (rec.channel !== 'ok') console.warn('[events] চ্যানেলে যায়নি:', rec.channel);
  }
  if (s.event_broadcast_bot !== '0') {
    const ids = all('SELECT id FROM users WHERE banned=0').map(r => r.id);
    rec.users = await bot.broadcast(ids, `🎰 <b>BD LOTTERY</b>\n\n${title}\n\n${body}`);
  }
  bot.stats.events = rec;
}

// ---------- ইভেন্টগুলো ----------
function ticketBought(userId, lot, numbers, cost) {
  try {
    const sold = get('SELECT COUNT(*) c FROM tickets WHERE lottery_id=?', lot.id).c;
    const list = numbers.length <= 10 ? `\n🔢 নাম্বার: ${numbers.map(n => '#' + bn(n)).join(', ')}` : '';
    push('🎟 <b>নতুন টিকিট ক্রয়</b>',
      `${userCard(userId)}\n🎟 কিনেছেন <b>${bn(numbers.length)}টি</b> টিকিট${list}\n🏷 লটারি: ${esc(lot.title)}\n💵 মোট: ${taka(cost)}\n📊 বিক্রি: ${bn(sold)}/${bn(lot.max_tickets)}`);
  } catch (e) { console.error('[events] ticket', e.message); }
}
function depositApproved(d) {
  try {
    push('⬇️ <b>ডিপোজিট সম্পন্ন</b>', `${userCard(d.user_id)}\n💰 পরিমাণ: <b>${taka(d.amount)}</b>\n🏦 মাধ্যম: ${esc(d.methodName || d.method)}`);
  } catch (e) { console.error('[events] deposit', e.message); }
}
function withdrawPaid(w, methodName) {
  try {
    push('⬆️ <b>উত্তোলন সম্পন্ন</b>', `${userCard(w.user_id)}\n💸 পরিমাণ: <b>${taka(w.amount - w.fee)}</b>\n🏦 মাধ্যম: ${esc(methodName || w.method)}`);
  } catch (e) { console.error('[events] withdraw', e.message); }
}
function drawResult(lot, winners) {
  try {
    const lines = winners.map(w => `${MEDAL[w.rank - 1] || '🏅'} <b>${ORD[w.rank - 1] || bn(w.rank) + 'তম'} পুরস্কার</b>\n${userCard(w.user_id, [`🎫 টিকিট #${bn(w.number)}`, `💰 <b>${taka(w.prize)}</b>`])}`);
    push('🏆 <b>লটারি ড্র ফলাফল</b>', `🎟 ${esc(lot.title)}\n\n${lines.join('\n\n')}\n\n🎉 সব বিজয়ীকে অভিনন্দন!`);
  } catch (e) { console.error('[events] draw', e.message); }
}

module.exports = { ticketBought, depositApproved, withdrawPaid, drawResult };
