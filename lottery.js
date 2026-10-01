'use strict';
const crypto = require('crypto');
const { all, get, run, tx, changeBalance, HttpError, now } = require('./db');
const bot = require('./bot');
const events = require('./events');

const taka = n => '৳' + Number(n).toLocaleString('en-IN');

function parsePrizes(lot) { try { return JSON.parse(lot.prizes); } catch { return []; } }

function buyTickets(userId, lotteryId, count, wantedNumbers) {
  const res = buyTicketsTx(userId, lotteryId, count, wantedNumbers);
  events.ticketBought(userId, res.lot, res.numbers, res.cost);
  const { lot, ...out } = res; return out;
}
function buyTicketsTx(userId, lotteryId, count, wantedNumbers) {
  return tx(() => {
    const lot = get('SELECT * FROM lotteries WHERE id=?', lotteryId);
    if (!lot || lot.status !== 'open') throw new HttpError(400, 'এই লটারি এখন খোলা নেই');
    if (new Date(lot.draw_time) <= new Date()) throw new HttpError(400, 'এই লটারির সময় শেষ');
    const user = get('SELECT * FROM users WHERE id=?', userId);
    if (user.banned) throw new HttpError(403, 'আপনার অ্যাকাউন্ট ব্লক করা আছে');

    const nums = Array.isArray(wantedNumbers) ? [...new Set(wantedNumbers.map(Number))] : [];
    const qty = nums.length || Math.floor(Number(count));
    if (!(qty >= 1) || qty > 100) throw new HttpError(400, 'টিকিট সংখ্যা ১–১০০ এর মধ্যে দিন');

    const sold = get('SELECT COUNT(*) c FROM tickets WHERE lottery_id=?', lotteryId).c;
    if (sold + qty > lot.max_tickets) throw new HttpError(400, `মাত্র ${lot.max_tickets - sold}টি টিকিট বাকি আছে`);
    if (lot.max_per_user > 0) {
      const mine = get('SELECT COUNT(*) c FROM tickets WHERE lottery_id=? AND user_id=?', lotteryId, userId).c;
      if (mine + qty > lot.max_per_user) throw new HttpError(400, `একজন সর্বোচ্চ ${lot.max_per_user}টি টিকিট কিনতে পারবেন`);
    }
    const cost = qty * lot.ticket_price;
    if (user.balance < cost) throw new HttpError(400, `ব্যালেন্স কম। প্রয়োজন ${taka(cost)}`);

    let chosen = [];
    if (nums.length) {
      for (const n of nums) {
        if (!Number.isInteger(n) || n < 1 || n > lot.max_tickets) throw new HttpError(400, `ভুল নাম্বার: ${n}`);
        if (get('SELECT 1 x FROM tickets WHERE lottery_id=? AND number=?', lotteryId, n)) throw new HttpError(400, `#${n} নাম্বারটি আগেই বিক্রি হয়েছে`);
      }
      chosen = nums;
    } else {
      const taken = new Set(all('SELECT number FROM tickets WHERE lottery_id=?', lotteryId).map(r => r.number));
      const free = []; for (let i = 1; i <= lot.max_tickets; i++) if (!taken.has(i)) free.push(i);
      for (let i = 0; i < qty; i++) { const j = crypto.randomInt(free.length); chosen.push(free[j]); free.splice(j, 1); }
    }
    chosen.sort((a, b) => a - b);
    changeBalance(userId, -cost, 'ticket_buy', lotteryId, `${lot.title} — ${chosen.length}টি টিকিট`);
    for (const n of chosen) run('INSERT INTO tickets(lottery_id,user_id,number,created_at) VALUES(?,?,?,?)', lotteryId, userId, n, now());
    return { numbers: chosen, cost, balance: user.balance - cost, lot };
  });
}

/**
 * ড্র করা। manualNumbers = এডমিন নিজে বিজয়ী টিকিট নাম্বার দিলে (১ম, ২য়... ক্রমে)।
 * বাকি পুরস্কার এলোমেলো (crypto) ভাবে বাছাই হবে।
 */
function drawLottery(lotteryId, manualNumbers = []) {
  const result = tx(() => {
    const lot = get('SELECT * FROM lotteries WHERE id=?', lotteryId);
    if (!lot) throw new HttpError(404, 'লটারি পাওয়া যায়নি');
    if (lot.status !== 'open') throw new HttpError(400, 'এই লটারি ইতিমধ্যে শেষ');
    const prizes = parsePrizes(lot);
    const tickets = all('SELECT * FROM tickets WHERE lottery_id=?', lotteryId);
    if (!tickets.length) throw new HttpError(400, 'কোনো টিকিট বিক্রি হয়নি — ড্র করা যাবে না (বাতিল করুন)');

    const byNumber = new Map(tickets.map(t => [t.number, t]));
    const winners = []; const used = new Set();
    for (const raw of manualNumbers) {
      if (raw === '' || raw == null) { winners.push(null); continue; }
      const n = Number(raw); const t = byNumber.get(n);
      if (!t) throw new HttpError(400, `#${n} নাম্বারের টিকিট বিক্রি হয়নি`);
      if (used.has(n)) throw new HttpError(400, `#${n} একাধিকবার দেওয়া হয়েছে`);
      used.add(n); winners.push(t);
    }
    const pool = tickets.filter(t => !used.has(t.number));
    const slots = Math.min(prizes.length, tickets.length);
    const final = [];
    for (let i = 0; i < slots; i++) {
      let t = winners[i];
      if (!t) { const j = crypto.randomInt(pool.length); t = pool.splice(j, 1)[0]; }
      final.push(t);
    }
    const out = [];
    final.forEach((t, i) => {
      const prize = prizes[i];
      run('UPDATE tickets SET prize=?, rank=? WHERE id=?', prize, i + 1, t.id);
      changeBalance(t.user_id, prize, 'prize', lotteryId, `${lot.title} — ${i + 1} নম্বর পুরস্কার`);
      run('UPDATE users SET total_won=total_won+? WHERE id=?', prize, t.user_id);
      out.push({ rank: i + 1, number: t.number, user_id: t.user_id, prize });
    });
    run("UPDATE lotteries SET status='drawn', drawn_at=? WHERE id=?", now(), lotteryId);
    return { lot, winners: out, participants: [...new Set(tickets.map(t => t.user_id))] };
  });
  // নোটিফিকেশন (ট্রানজাকশনের বাইরে)
  const winIds = new Set(result.winners.map(w => w.user_id));
  for (const w of result.winners)
    bot.notify(w.user_id, `🎉 <b>অভিনন্দন!</b>\n"${result.lot.title}" লটারিতে আপনার টিকিট <b>#${w.number}</b> ${w.rank} নম্বর পুরস্কার জিতেছে!\n💰 ${taka(w.prize)} আপনার ব্যালেন্সে যোগ হয়েছে।`);
  for (const uid of result.participants) if (!winIds.has(uid))
    bot.notify(uid, `🎟 "${result.lot.title}" লটারির ড্র সম্পন্ন হয়েছে। এবার আপনি জেতেননি, পরের বার শুভকামনা! অ্যাপে ফলাফল দেখুন।`);
  events.drawResult(result.lot, result.winners);
  return result.winners;
}

function cancelLottery(lotteryId, reason = '') {
  const users = tx(() => {
    const lot = get('SELECT * FROM lotteries WHERE id=?', lotteryId);
    if (!lot) throw new HttpError(404, 'লটারি পাওয়া যায়নি');
    if (lot.status !== 'open') throw new HttpError(400, 'এই লটারি ইতিমধ্যে শেষ/বাতিল');
    const per = all('SELECT user_id, COUNT(*) c FROM tickets WHERE lottery_id=? GROUP BY user_id', lotteryId);
    for (const p of per) changeBalance(p.user_id, p.c * lot.ticket_price, 'refund', lotteryId, `${lot.title} বাতিল — রিফান্ড`);
    run("UPDATE lotteries SET status='cancelled', drawn_at=? WHERE id=?", now(), lotteryId);
    return { lot, per };
  });
  for (const p of users.per)
    bot.notify(p.user_id, `↩️ "${users.lot.title}" লটারি বাতিল হয়েছে।${reason ? '\nকারণ: ' + reason : ''}\n${taka(p.c * users.lot.ticket_price)} আপনার ব্যালেন্সে ফেরত দেওয়া হয়েছে।`);
}

/** প্রতি ৩০ সেকেন্ডে চলে: সময় শেষ হওয়া লটারি অটো-ড্র / ন্যূনতম টিকিট না হলে বাতিল */
function autoTick() {
  const due = all("SELECT * FROM lotteries WHERE status='open' AND auto_draw=1 AND draw_time<=?", now());
  for (const lot of due) {
    try {
      const sold = get('SELECT COUNT(*) c FROM tickets WHERE lottery_id=?', lot.id).c;
      if (sold === 0 || sold < lot.min_tickets) cancelLottery(lot.id, 'ন্যূনতম টিকিট বিক্রি হয়নি');
      else drawLottery(lot.id);
      console.log('[auto] লটারি #' + lot.id + ' প্রক্রিয়া সম্পন্ন');
    } catch (e) { console.error('[auto]', lot.id, e.message); }
  }
}
module.exports = { buyTickets, drawLottery, cancelLottery, autoTick, parsePrizes, taka };
