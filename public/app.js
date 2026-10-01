'use strict';
const tg = window.Telegram && Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor('#0f1226'); tg.setBackgroundColor('#0f1226'); } catch {} }
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bn = n => Number(n).toLocaleString('bn-BD');
const tk = n => '৳' + bn(n);
const dt = s => new Date(s).toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' });
const ST = { pending: 'অপেক্ষমাণ', approved: 'অনুমোদিত', rejected: 'বাতিল', paid: 'পরিশোধিত', drawn: 'ড্র সম্পন্ন', cancelled: 'বাতিল', open: 'চলমান' };
const TYPE = { deposit: 'ডিপোজিট', withdraw: 'উত্তোলন', withdraw_refund: 'উত্তোলন ফেরত', ticket_buy: 'টিকিট ক্রয়', prize: 'পুরস্কার', refund: 'রিফান্ড', admin_adjust: 'এডমিন সমন্বয়', bonus: 'বোনাস', referral: 'রেফারেল বোনাস' };
const ORD = ['১ম', '২য়', '৩য়', '৪র্থ', '৫ম', '৬ষ্ঠ', '৭ম', '৮ম', '৯ম', '১০ম'];
const rankName = i => ORD[i] || bn(i + 1) + 'তম';

let ME = null, S = null, tab = 'home';
let depScreenshot = '';
const BRAND = { bkash: ['#e2136e', 'bKash'], nagad: ['#f6921e', 'Nagad'], rocket: ['#8c3494', 'Rocket'] };
function logoOf(m) {
  if (m.logo) return m.logo;
  const [c, t] = BRAND[m.key] || ['#7c5cff', m.name];
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${c}"/><text x="50" y="60" font-size="${t.length > 5 ? 22 : 26}" font-family="Arial" font-weight="700" fill="#fff" text-anchor="middle">${t}</text></svg>`);
}
const pmVal = {};
function pmPicker(id, list) {
  pmVal[id] = pmVal[id] && list.some(m => m.key === pmVal[id]) ? pmVal[id] : list[0] && list[0].key;
  return `<div class="pm" id="${id}">${list.map(m => `<button type="button" class="${pmVal[id] === m.key ? 'on' : ''}" onclick="pmPick('${id}','${m.key}',this)"><img src="${esc(logoOf(m))}" alt=""><span>${esc(m.name)}</span></button>`).join('')}</div>`;
}
function pmPick(id, key, el) { pmVal[id] = key; document.querySelectorAll('#' + id + ' button').forEach(b => b.classList.toggle('on', b === el)); }
const devId = new URLSearchParams(location.search).get('dev');

async function api(path, body) {
  const headers = { 'content-type': 'application/json', 'x-init-data': (tg && tg.initData) || '' };
  if (devId) { headers['x-dev-user'] = devId; const st = new URLSearchParams(location.search).get('start'); if (st) headers['x-dev-start'] = st; }
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'সমস্যা হয়েছে');
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3200); }
function resultPopup(title, message, icon) {
  openSheet(`<div class="card" style="text-align:center;padding:28px 18px"><div style="font-size:52px">${icon}</div><h3 style="font-size:21px">${esc(title)}</h3><p class="mut" style="line-height:1.7">${esc(message)}</p><button class="btn" onclick="closeSheet()">ঠিক আছে</button></div>`);
}
async function guard(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message); } finally { if (btn) btn.disabled = false; }
}
function openSheet(html) { $('#sheetIn').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; }

async function refreshMe() {
  const d = await api('/api/me'); ME = d.user; S = d.settings;
  $('#bal').textContent = tk(ME.balance); $('#uname').textContent = ME.name; document.title = 'BD LOTTERY';
  const n = $('#notice'); n.hidden = !S.announcement; n.textContent = '📢 ' + S.announcement;
}
async function go(t) {
  tab = t;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#view').innerHTML = '<div class="empty">লোড হচ্ছে…</div>';
  try { await refreshMe(); await views[t](); } catch (e) { $('#view').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// ---------- হোম ----------
const views = {};
const p2 = n => String(n).padStart(2, '0');
const bd2 = n => p2(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
function cdParts(iso) {
  const ms = Math.max(0, new Date(iso) - Date.now()), t = Math.floor(ms / 1000);
  return { ms, d: Math.floor(t / 86400), h: Math.floor(t % 86400 / 3600), m: Math.floor(t % 3600 / 60), s: t % 60 };
}
// বড় কাউন্টডাউন (দিন : ঘণ্টা : মিনিট : সেকেন্ড) — প্রতি সেকেন্ডে লাইভ আপডেট
function cdHtml(iso) {
  const c = cdParts(iso);
  const u = (k, v, l) => `<div class="cdu"><b data-k="${k}">${bd2(v)}</b><span>${l}</span></div>`;
  return `<div class="cd" data-cd="${esc(iso)}"><div class="cdt">⏳ ড্র শুরু হতে বাকি</div><div class="cdr">${u('d', c.d, 'দিন')}<i>:</i>${u('h', c.h, 'ঘণ্টা')}<i>:</i>${u('m', c.m, 'মিনিট')}<i>:</i>${u('s', c.s, 'সেকেন্ড')}</div></div>`;
}
let _cdReload = 0;
setInterval(() => {
  document.querySelectorAll('[data-cd]').forEach(el => {
    const c = cdParts(el.dataset.cd);
    if (c.ms <= 0) {
      if (!el.classList.contains('done')) { el.classList.add('done'); el.querySelector('.cdt').textContent = '🎰 ড্র হচ্ছে… ফলাফল শিগগিরই'; }
      if (tab === 'home' && Date.now() - _cdReload > 20000 && $('#sheet').hidden) { _cdReload = Date.now(); go('home'); }
      return;
    }
    el.classList.toggle('urgent', c.ms < 3600e3);
    for (const k of ['d', 'h', 'm', 's']) { const b = el.querySelector(`[data-k="${k}"]`), v = bd2(c[k]); if (b && b.textContent !== v) { b.textContent = v; if (k === 's') { b.classList.remove('tick'); void b.offsetWidth; b.classList.add('tick'); } } }
  });
}, 1000);
views.home = async () => {
  if (S.maintenance) { $('#view').innerHTML = '<div class="empty">🛠 অ্যাপ এখন রক্ষণাবেক্ষণে আছে। কিছুক্ষণ পর আসুন।</div>'; return; }
  const { open, past } = await api('/api/lotteries');
  let h = '<h3 style="margin-top:4px">🔥 চলমান লটারি</h3>';
  h += open.length ? open.map(l => `
    <div class="card lot" onclick="openLottery(${l.id})">
      <div class="row"><span class="title">${esc(l.title)}</span></div>
      ${cdHtml(l.draw_time)}
      <div class="prize">${tk(l.prizes[0])} <span class="small mut">১ম পুরস্কার</span></div>
      <div class="small mut">মোট ${bn(l.prizes.length)}টি পুরস্কার • সর্বমোট ${tk(l.prize_total)}</div>
      <div class="lamps">${Array.from({length:12},(_,i)=>`<i class="${i < Math.round(l.sold / l.max_tickets * 12) ? 'on' : ''}"></i>`).join('')}</div>
      <div class="row small mut"><span>${bn(l.sold)}/${bn(l.max_tickets)} টিকিট বিক্রি</span><span>${l.mine ? '🎫 আপনার: ' + bn(l.mine) : ''}</span></div>
      <div class="row" style="margin-top:10px"><b>টিকিট: ${tk(l.ticket_price)}</b><button class="btn sm">কিনুন</button></div>
    </div>`).join('') : '<div class="empty">এখন কোনো লটারি চালু নেই</div>';
  h += '<h3>🏆 সাম্প্রতিক ফলাফল</h3>';
  h += past.length ? past.map(l => `
    <div class="card"><div class="row"><b>${esc(l.title)}</b><span class="pill ${l.status}">${ST[l.status]}</span></div>
    <div class="small mut">${l.drawn_at ? dt(l.drawn_at) : ''}</div>
    ${l.status === 'drawn' ? l.winners.map(w => `<div class="row" style="margin-top:6px"><span>${rankName(w.rank - 1)}: <b>#${bn(w.number)}</b> ${w.me ? '<span class="gold">(আপনি!)</span>' : esc(w.name)}</span><b class="gold">${tk(w.prize)}</b></div>`).join('') : '<div class="small mut" style="margin-top:6px">টাকা ফেরত দেওয়া হয়েছে</div>'}
    </div>`).join('') : '<div class="empty">এখনো কোনো ফলাফল নেই</div>';
  $('#view').innerHTML = h;
};

let pick = { sel: new Set(), mode: 'random', qty: 1, lot: null, taken: new Set() };
async function openLottery(id) {
  const d = await api('/api/lottery/' + id); const l = d.lottery;
  pick = { sel: new Set(), mode: 'random', qty: 1, lot: l, taken: new Set(d.taken) };
  renderBuy(d.mine);
}
function renderBuy(mine) {
  const l = pick.lot, left = l.max_tickets - l.sold; window._mine = mine;
  const board = l.max_tickets <= 300
    ? `<div class="small mut">💡 ফাঁকা বক্সে ক্লিক করুন — জ্বলে উঠবে, জ্বলন্ত নাম্বারই আপনার টিকিট</div>
       <div class="grid" id="board">${Array.from({ length: l.max_tickets }, (_, i) => i + 1).map(n =>
        `<button class="${pick.taken.has(n) ? 'taken' : ''}" ${pick.taken.has(n) ? 'disabled' : ''} onclick="togglePick(${n},this)">${bn(n)}</button>`).join('')}</div>`
    : '<div id="typed"><label>নাম্বার লিখুন (কমা দিয়ে, যেমন 5,12,99)</label><input oninput="typedNums(this.value)"></div>';
  openSheet(`
    <div class="row"><b style="font-size:18px">${esc(l.title)}</b><button class="btn sec sm" onclick="closeSheet()">✕</button></div>
    <p class="mut small">${esc(l.description)}</p>
    <div class="card">${l.prizes.map((p, i) => `<div class="row"><span>🏅 ${rankName(i)} পুরস্কার</span><b class="gold">${tk(p)}</b></div>`).join('')}</div>
    ${cdHtml(l.draw_time)}
    <div class="small mut">ড্র: ${dt(l.draw_time)} • বাকি টিকিট: ${bn(left)}${l.max_per_user ? ' • জনপ্রতি সর্বোচ্চ ' + bn(l.max_per_user) : ''}</div>
    ${mine.length ? `<div style="margin:10px 0">আপনার টিকিট: ${mine.map(m => `<span class="tk">#${bn(m.number)}</span>`).join('')}</div>` : ''}
    <div class="tabs" style="margin-top:12px"><button id="tabR" onclick="setMode('random')">🎲 র‍্যান্ডম</button><button id="tabP" onclick="setMode('pick')">🔢 নাম্বার বাছাই</button></div>
    <div class="qty" id="qtyBox"><button onclick="qty(-1)">−</button><b id="qv">1</b><button onclick="qty(1)">+</button></div>
    ${board}
    <div class="row" style="margin:8px 0"><span>মোট (<span id="cnt">0</span>টি)</span><b class="gold" style="font-size:20px" id="tot"></b></div>
    <div class="small mut" style="margin-bottom:12px">আপনার ব্যালেন্স: ${tk(ME.balance)}</div>
    <button class="btn" id="buyBtn" onclick="buy(this)">🎟 টিকিট কিনুন</button>`);
  updSummary();
}
function updSummary() {
  const l = pick.lot, left = l.max_tickets - l.sold, pk = pick.mode === 'pick';
  const count = pk ? pick.sel.size : pick.qty;
  $('#cnt').textContent = bn(count); $('#tot').textContent = tk(count * l.ticket_price); $('#qv').textContent = bn(pick.qty);
  $('#buyBtn').disabled = count < 1 || left < 1;
  $('#tabR').classList.toggle('on', !pk); $('#tabP').classList.toggle('on', pk);
  $('#qtyBox').hidden = pk; const t = $('#typed'); if (t) t.hidden = !pk;
}
function setMode(m) {
  pick.mode = m;
  if (m === 'random') { pick.sel.clear(); document.querySelectorAll('#board .sel').forEach(b => b.classList.remove('sel')); }
  updSummary();
}
function qty(d) { pick.qty = Math.max(1, Math.min(100, pick.qty + d)); updSummary(); }
function togglePick(n, el) {
  pick.mode = 'pick';
  pick.sel.has(n) ? pick.sel.delete(n) : pick.sel.add(n);
  el.classList.toggle('sel', pick.sel.has(n)); updSummary();
}
function typedNums(v) { pick.sel = new Set(v.split(/[,\s]+/).map(Number).filter(n => n > 0)); updSummary(); }
function ticketPopup(lot, r) {
  openSheet(`<div class="popx">
    <div class="popx-ic">🎉</div><h3>টিকিট কেনা সফল!</h3>
    <p class="mut small">শুভকামনা! আপনার ভাগ্য উজ্জ্বল হোক 🍀</p>
    <div class="tkt">
      <div class="tkt-top"><span>🎰 BD LOTTERY</span><b>${esc(lot.title)}</b></div>
      <div class="tkt-nums">${r.numbers.slice(0, 30).map(n => `<span>#${bn(n)}</span>`).join('')}${r.numbers.length > 30 ? `<span>+${bn(r.numbers.length - 30)}</span>` : ''}</div>
      <div class="tkt-cut"></div>
      <div class="tkt-row"><span>টিকিট সংখ্যা</span><b>${bn(r.numbers.length)}টি</b></div>
      <div class="tkt-row"><span>মোট খরচ</span><b class="gold">${tk(r.cost)}</b></div>
      <div class="tkt-row"><span>বাকি ব্যালেন্স</span><b>${tk(r.balance)}</b></div>
      <div class="tkt-row"><span>ড্র</span><b>${dt(lot.draw_time)}</b></div>
    </div>
    <p class="small mut">ড্রের ফলাফল বটে ও অ্যাপে জানানো হবে। "টিকিট" ট্যাবে সব টিকিট দেখুন।</p>
    <button class="btn" onclick="closeSheet()">ঠিক আছে</button></div>`);
  try { window.lightAt && lightAt(innerWidth / 2, innerHeight / 2, 'box'); } catch {}
}
function buy(btn) {
  guard(async () => {
    const body = pick.mode === 'pick' ? { numbers: [...pick.sel] } : { count: pick.qty };
    const r = await api('/api/lottery/' + pick.lot.id + '/buy', body);
    const lot = pick.lot;
    closeSheet(); await go(tab); ticketPopup(lot, r);
  }, btn);
}

// ---------- টিকিট ----------
views.tickets = async () => {
  const { tickets } = await api('/api/my/tickets');
  if (!tickets.length) { $('#view').innerHTML = '<div class="empty">আপনি এখনো কোনো টিকিট কেনেননি</div>'; return; }
  const g = {}; tickets.forEach(t => (g[t.lottery_id] ||= { title: t.title, status: t.status, list: [] }).list.push(t));
  $('#view').innerHTML = Object.values(g).map(x => `
    <div class="card"><div class="row"><b>${esc(x.title)}</b><span class="pill ${x.status}">${ST[x.status]}</span></div>
    <div style="margin-top:8px">${x.list.map(t => `<span class="tk ${t.prize ? 'win' : ''}">#${bn(t.number)}${t.prize ? ' 🏆 ' + tk(t.prize) : ''}</span>`).join('')}</div></div>`).join('');
};

// ---------- ওয়ালেট ----------
let wtab = 'dep';
views.wallet = async () => {
  const hist = await api('/api/my/history');
  const M = S.methods;
  
  const dep = `
    <div class="card"><div class="small mut" style="margin-bottom:6px">${esc(S.deposit_note)}</div>
      ${M.map(m => `<div class="pay"><span style="display:flex;align-items:center;gap:10px"><img class="pmi" src="${esc(logoOf(m))}" alt="">${m.name} (Personal)</span><b onclick="navigator.clipboard&&navigator.clipboard.writeText('${esc(m.number)}');toast('কপি হয়েছে')">${esc(m.number)} 📋</b></div>`).join('') || '<div class="empty">কোনো পেমেন্ট মাধ্যম সেট করা নেই</div>'}
      ${S.deposit_bonus_percent ? `<div class="chip gold" style="margin-top:8px">🎁 ডিপোজিটে ${bn(S.deposit_bonus_percent)}% বোনাস</div>` : ''}</div>
    <div class="card"><label>মাধ্যম</label>${pmPicker('dm', M)}
      <label>পরিমাণ (৳${bn(S.min_deposit)} – ৳${bn(S.max_deposit)})</label><input id="da" type="number" inputmode="numeric">
      <label>যে নাম্বার থেকে পাঠিয়েছেন</label><input id="ds" inputmode="tel" placeholder="01XXXXXXXXX">
      <label>আপনার ফোন নাম্বার</label><input id="dp" inputmode="tel" value="${esc(ME.phone||'')}" placeholder="01XXXXXXXXX">
      <label>ট্রানজেকশন আইডি (TrxID)</label><input id="dt" placeholder="যেমন: 9A7B6C5D4E">
      <label>পেমেন্ট স্ক্রিনশট <b class="gold">* আবশ্যক</b></label>
      <input id="dshot" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange="readDepositShot(this)">
      <div id="shotStatus" class="small mut">স্ক্রিনশট না দিলে ডিপোজিট সাবমিট হবে না।</div>
      <button class="btn" onclick="deposit(this)">⬇️ ডিপোজিট জমা দিন</button></div>`;
  const wd = `
    <div class="card"><div class="small mut">সর্বনিম্ন ৳${bn(S.min_withdraw)} • সর্বোচ্চ ৳${bn(S.max_withdraw)} • ফি ${bn(S.withdraw_fee_percent)}%</div>
      <label>মাধ্যম</label>${pmPicker('wm', S.all_methods)}
      <label>পরিমাণ</label><input id="wa" type="number" inputmode="numeric" oninput="wfee()">
      <div id="wf" class="small mut" style="margin:-4px 0 8px"></div>
      <label>যে একাউন্টে টাকা পাবেন</label><input id="wn" inputmode="text" placeholder="মোবাইল/ব্যাংক একাউন্ট">
      <label>আপনার ফোন নাম্বার</label><input id="wp" inputmode="tel" value="${esc(ME.phone||'')}" placeholder="01XXXXXXXXX">
      <button class="btn" onclick="withdraw(this)">⬆️ উত্তোলনের অনুরোধ</button></div>`;
  const reqs = [...hist.deposits.map(d => ({ ...d, k: 'dep' })), ...hist.withdrawals.map(d => ({ ...d, k: 'wd' }))].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const hi = `
    <h3>অনুরোধসমূহ</h3>${reqs.length ? reqs.map(r => `<div class="card"><div class="row"><b>${r.k === 'dep' ? '⬇️ ডিপোজিট' : '⬆️ উত্তোলন'} ${tk(r.amount)}</b><span class="pill ${r.status}">${ST[r.status]}</span></div>
      <div class="small mut">${dt(r.created_at)}${r.trx_id ? ' • ' + esc(r.trx_id) : ''}${r.k === 'wd' ? ' • ফি ' + tk(r.fee) + ' • ' + esc(r.number) : ''}${r.note ? '<br>নোট: ' + esc(r.note) : ''}</div></div>`).join('') : '<div class="empty">কিছু নেই</div>'}
    <h3>লেনদেনের ইতিহাস</h3>${hist.transactions.map(t => `<div class="card row"><div><b>${TYPE[t.type] || t.type}</b><div class="small mut">${esc(t.note)} • ${dt(t.created_at)}</div></div><b class="${t.amount > 0 ? 'ok' : 'bad'}">${t.amount > 0 ? '+' : ''}${tk(t.amount)}</b></div>`).join('') || '<div class="empty">কিছু নেই</div>'}`;
  $('#view').innerHTML = `<div class="card" style="text-align:center"><div class="mut small">বর্তমান ব্যালেন্স</div><div style="font-size:34px;font-weight:800;color:var(--gold)">${tk(ME.balance)}</div></div>
    <div class="tabs"><button class="${wtab === 'dep' ? 'on' : ''}" onclick="wtab='dep';go('wallet')">⬇️ ডিপোজিট</button><button class="${wtab === 'wd' ? 'on' : ''}" onclick="wtab='wd';go('wallet')">⬆️ উত্তোলন</button></div>
    ${wtab === 'dep' ? dep : wd}${hi}`;
};
function wfee() { const a = +$('#wa').value || 0, f = Math.ceil(a * S.withdraw_fee_percent / 100); $('#wf').textContent = a ? `ফি ${tk(f)} • আপনি পাবেন ${tk(Math.max(0, a - f))}` : ''; }
function readDepositShot(input) {
  const f=input.files&&input.files[0]; if(!f){depScreenshot='';return;}
  const img=new Image(); const url=URL.createObjectURL(f);
  img.onload=()=>{const c=document.createElement('canvas');const max=1400;const r=Math.min(1,max/Math.max(img.width,img.height));c.width=Math.max(1,Math.round(img.width*r));c.height=Math.max(1,Math.round(img.height*r));c.getContext('2d').drawImage(img,0,0,c.width,c.height);depScreenshot=c.toDataURL('image/jpeg',.78);$('#shotStatus').textContent='✅ স্ক্রিনশট প্রস্তুত হয়েছে';URL.revokeObjectURL(url);};
  img.src=url;
}
const deposit = btn => guard(async () => {
  if(!depScreenshot) throw new Error('ডিপোজিটের স্ক্রিনশট আপলোড করুন');
  const r = await api('/api/deposit', { method: pmVal.dm, amount: +$('#da').value, sender_number: $('#ds').value.trim(), trx_id: $('#dt').value.trim(), phone: $('#dp').value.trim(), screenshot: depScreenshot });
  await go('wallet'); resultPopup('ডিপোজিট সিস্টেম', r.message, '⬇️'); depScreenshot='';
}, btn);
function withdrawPopup(amount, receive, method, number) {
  openSheet(`<div class="popx">
    <div class="popx-ic">💸</div><h3>উত্তোলনের অনুরোধ জমা হয়েছে</h3>
    <p class="mut small">আপনার অনুরোধ এডমিনের কাছে পৌঁছেছে। যাচাই শেষে টাকা পাঠানো হবে এবং বটে জানানো হবে।</p>
    <div class="tkt">
      <div class="tkt-top"><span>🎰 BD LOTTERY</span><b>⬆️ উত্তোলন রসিদ</b></div>
      <div class="tkt-row"><span>মাধ্যম</span><b>${esc(method)}</b></div>
      <div class="tkt-row"><span>একাউন্ট</span><b>${esc(number)}</b></div>
      <div class="tkt-row"><span>উত্তোলন</span><b>${tk(amount)}</b></div>
      <div class="tkt-row"><span>ফি</span><b>${tk(amount - receive)}</b></div>
      <div class="tkt-cut"></div>
      <div class="tkt-row"><span>আপনি পাবেন</span><b class="gold" style="font-size:20px">${tk(receive)}</b></div>
      <div class="tkt-row"><span>অবস্থা</span><span class="pill pending">⏳ অপেক্ষমাণ</span></div>
    </div>
    <button class="btn" onclick="closeSheet()">ঠিক আছে</button></div>`);
}
const withdraw = btn => guard(async () => {
  const amount = +$('#wa').value, number = $('#wn').value.trim(), mkey = pmVal.wm;
  const r = await api('/api/withdraw', { method: mkey, amount, number, phone: $('#wp').value.trim() });
  const m = (S.all_methods.find(x => x.key === mkey) || {}).name || mkey;
  await go('wallet'); withdrawPopup(amount, r.receive, m, number);
}, btn);

function openTg(u) { try { if (tg && /^https?:\/\/t\.me\//.test(u)) { tg.openTelegramLink(u); return false; } } catch {} return true; }
window._rating = 0;
const STAR_TXT = ['', '😞 খুব খারাপ', '😕 খারাপ', '😐 মোটামুটি', '😊 ভালো', '🤩 চমৎকার'];
function setReview(n) {
  window._rating = n;
  document.querySelectorAll('.stars button').forEach((b, i) => { b.classList.toggle('on', i < n); });
  const l = $('#starLbl'); if (l) l.textContent = STAR_TXT[n] || '';
}
async function submitReview() {
  if (!window._rating) return toast('একটি স্টার নির্বাচন করুন');
  await guard(async () => {
    const r = await api('/api/reviews', { rating: window._rating, text: $('#reviewText').value });
    toast(r.message); await go('profile');
  });
}
const starsStr = n => '★'.repeat(n) + '☆'.repeat(5 - n);
async function reviewBlock() {
  let d; try { d = await api('/api/reviews'); } catch { return ''; }
  window._rating = d.mine ? d.mine.rating : 0;
  return `<div class="card"><b>⭐ রেটিং ও রিভিউ</b>
    <div class="row" style="margin:6px 0"><span class="small mut">গড় রেটিং</span><b class="gold">${d.stats.count ? '★ ' + bn(d.stats.avg.toFixed(1)) + ' / ৫ (' + bn(d.stats.count) + ' জন)' : 'এখনো কেউ রেটিং দেননি'}</b></div>
    <div class="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${n <= window._rating ? 'on' : ''}" onclick="setReview(${n})" aria-label="${n} স্টার">★</button>`).join('')}</div>
    <div id="starLbl" class="small gold" style="text-align:center;min-height:18px">${STAR_TXT[window._rating] || ''}</div>
    <textarea id="reviewText" rows="3" maxlength="500" placeholder="আপনার মতামত লিখুন (ঐচ্ছিক)">${esc(d.mine ? d.mine.text : '')}</textarea>
    <button class="btn" onclick="submitReview()">${d.mine ? '✏️ রিভিউ আপডেট করুন' : '⭐ রিভিউ জমা দিন'}</button>
    ${d.items.length ? `<div style="margin-top:12px;max-height:260px;overflow:auto">${d.items.map(r => `<div class="rv"><div class="row"><b>${esc(r.first_name || r.username || 'User')}</b><span class="gold">${starsStr(r.rating)}</span></div>${r.text ? `<div class="small" style="margin-top:3px">${esc(r.text)}</div>` : ''}<div class="small mut">${dt(r.created_at)}</div></div>`).join('')}</div>` : ''}
  </div>`;
}
// ---------- প্রোফাইল ----------
async function statsBlock() {
  let d; try { d = await api('/api/my/stats'); } catch { return ''; }
  const box = (ic, l, v, sub) => `<div class="st"><div class="st-ic">${ic}</div><div class="st-l">${l}</div><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const lots = d.tickets.lotteries;
  return `<div class="card"><b>📊 আমার হিস্টরি</b>
    <div class="stg">
      ${box('⬇️', 'মোট ডিপোজিট', tk(d.deposit.total), bn(d.deposit.count) + ' বার' + (d.deposit.pending ? ' • ' + bn(d.deposit.pending) + 'টি অপেক্ষমাণ' : ''))}
      ${box('⬆️', 'মোট উত্তোলন', tk(d.withdraw.total), bn(d.withdraw.count) + ' বার' + (d.withdraw.pending_count ? ' • ' + tk(d.withdraw.pending) + ' অপেক্ষমাণ' : ''))}
      ${box('🎫', 'কেনা টিকিট', bn(d.tickets.count) + 'টি', 'খরচ ' + tk(d.tickets.spent))}
      ${box('🏆', 'জেতা টিকিট', bn(d.wins.count) + 'টি', 'মোট ' + tk(d.wins.total))}
      ${box('🔁', 'মোট লেনদেন', bn(d.transactions) + ' বার', '')}
      ${box('💰', 'মোট জেতা', tk(ME.total_won), '')}
    </div>
    ${d.wins.items.length ? `<div class="small mut" style="margin:10px 0 4px">🏆 জেতা টিকিট নাম্বার</div><div>${d.wins.items.map(w => `<span class="tk win" title="${esc(w.title)}">#${bn(w.number)} • ${rankName(w.rank - 1)} • ${tk(w.prize)}</span>`).join('')}</div>` : ''}
    ${lots.length ? `<div class="small mut" style="margin:10px 0 4px">🎫 কেনা টিকিটের নাম্বার</div>${lots.map(l => `<div class="hl"><div class="row"><b>${esc(l.title)}</b><span class="small mut">${bn(l.count)}টি</span></div><div>${l.numbers.slice(0, 60).map(n => `<span class="tk ${n.prize ? 'win' : ''}">#${bn(n.number)}</span>`).join('')}${l.numbers.length > 60 ? `<span class="small mut"> +${bn(l.numbers.length - 60)}</span>` : ''}</div></div>`).join('')}` : '<div class="small mut" style="margin-top:8px">এখনো কোনো টিকিট কেনেননি</div>'}
  </div>`;
}
views.profile = async () => {
  const stHtml = await statsBlock();
  const rvHtml = await reviewBlock();
  const link = S.bot_username ? `https://t.me/${S.bot_username}?start=ref${ME.id}` : '';
  $('#view').innerHTML = `
    <div class="card"><b>${esc(ME.name)}</b><div class="small mut">ID: ${ME.id}</div>
      <div class="row" style="margin-top:10px"><span>মোট জেতা</span><b class="gold">${tk(ME.total_won)}</b></div></div>
    ${stHtml}
    <div class="card"><b>🎁 বন্ধুকে রেফার করুন</b>
      <p class="small mut">আপনার লিংকে যোগ দিয়ে কেউ প্রথম ডিপোজিট করলে আপনি পাবেন ${tk(S.referral_bonus)} বোনাস।</p>
      <div class="row small"><span>রেফার করেছেন</span><b>${bn(ME.referrals)} জন</b></div>
      ${link ? `<input readonly value="${esc(link)}" onclick="this.select()"><button class="btn sec" onclick="navigator.clipboard&&navigator.clipboard.writeText('${esc(link)}');toast('লিংক কপি হয়েছে')">লিংক কপি করুন</button>` : '<div class="small mut">রেফার লিংক এখনো চালু হয়নি</div>'}</div>
    ${rvHtml}
    ${S.support_channel || S.support_link ? `<div class="card sup"><b>🛟 সাপোর্ট চ্যানেল</b><p class="small mut">কোনো সমস্যা বা প্রশ্ন থাকলে আমাদের সাপোর্ট চ্যানেলে যোগ দিন।</p>${S.support_channel ? `<a class="btn" style="display:block;text-align:center;text-decoration:none" href="${esc(S.support_channel)}" target="_blank" onclick="return openTg(this.href)">📢 সাপোর্ট চ্যানেলে যোগ দিন</a>` : ''}</div>` : ''}
    ${S.support_link ? `<a class="btn sec" style="display:block;text-align:center;text-decoration:none" href="${esc(S.support_link)}" target="_blank">💬 সাপোর্টে যোগাযোগ</a>` : ''}
    <div class="card" style="margin-top:12px"><b>নিয়মাবলী</b><ul class="small mut" style="padding-left:18px;line-height:1.7">
      <li>ডিপোজিট ম্যানুয়ালি যাচাই করে ব্যালেন্সে যোগ করা হয়।</li><li>ভুল TrxID দিলে ডিপোজিট বাতিল হতে পারে।</li>
      <li>উত্তোলন এডমিন যাচাই করে পাঠান; ফি প্রযোজ্য।</li><li>ন্যূনতম টিকিট বিক্রি না হলে লটারি বাতিল হয়ে টাকা ফেরত যায়।</li>
      <li>লটারি খেলা ঝুঁকিপূর্ণ — সামর্থ্যের মধ্যে খেলুন।</li></ul></div>`;
};
go('home');
