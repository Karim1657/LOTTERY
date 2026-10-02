'use strict';
// ৩ডি টিল্ট + ক্লিকে লাইটিং সিস্টেম (ইউজার অ্যাপ ও এডমিন)
(function () {
  const st = document.createElement('div'); st.className = 'stage';
  st.innerHTML = '<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div><div class="floor"></div>';
  document.body.prepend(st);

  // পয়েন্টার অনুযায়ী ৩ডি টিল্ট ও শিন
  let last = null;
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' && e.buttons === 0) return;
    const el = e.target.closest && e.target.closest('.card,.stat');
    if (last && last !== el) reset(last);
    if (!el || el.querySelector('input,select,textarea')) { if (last) { reset(last); last = null; } return; } last = el;
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.classList.add('tilt');
    el.style.setProperty('--ry', ((x - .5) * 10).toFixed(2) + 'deg');
    el.style.setProperty('--rx', ((.5 - y) * 8).toFixed(2) + 'deg');
    el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%'); el.style.setProperty('--sh', 1);
  }, { passive: true });
  function reset(el) { el.classList.remove('tilt'); ['--rx', '--ry', '--sh'].forEach(k => el.style.removeProperty(k)); }
  document.addEventListener('pointerup', e => { if (e.pointerType === 'touch' && last) { const l = last; setTimeout(() => reset(l), 350); last = null; } });
  document.addEventListener('pointerleave', () => { if (last) { reset(last); last = null; } }, true);

  // আলো জ্বালানো
  const add = (cls, x, y, css) => {
    const d = document.createElement('div'); d.className = cls; d.style.left = x + 'px'; d.style.top = y + 'px';
    for (const k in css) d.style.setProperty(k, css[k]);
    document.body.appendChild(d); setTimeout(() => d.remove(), 1000); return d;
  };
  function light(x, y, kind) {
    const C = { box: '255,201,77', ok: '46,204,143', bad: '255,92,122', pri: '176,107,255' }[kind] || '176,107,255';
    const big = kind === 'box';
    add('lightfx', x, y, { '--lc': `rgba(${C},.75)`, '--ls': big ? 16 : 9, '--ld': big ? '.8s' : '.6s' });
    add('ring', x, y, { '--lc': `rgba(${C},1)` });
    if (big) for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12 + Math.random() * .4, d = 40 + Math.random() * 50;
      add('spark', x, y, { '--lc': `rgb(${C})`, '--dx': Math.cos(a) * d + 'px', '--dy': Math.sin(a) * d + 'px' });
    }
  }
  window.lightAt = light;
  const SEL = '.grid button:not(.taken),.btn,button.b,button.g,.card,.stat,.pay,.tk,nav button,.tabs button,.qty button,.chip,.empty,.box,.top button,.bal';
  document.addEventListener('pointerdown', e => {
    const el = e.target.closest && e.target.closest(SEL); if (!el || el.disabled) return;
    const kind = el.matches('.grid button') ? 'box' : el.matches('.ok,button.ok') ? 'ok' : el.matches('.bad,button.bad') ? 'bad' : 'pri';
    light(e.clientX, e.clientY, kind);
    if (kind === 'box') { el.classList.remove('glowpulse'); void el.offsetWidth; el.classList.add('glowpulse'); }
    try { const h = window.Telegram && Telegram.WebApp.HapticFeedback; h && h.impactOccurred(kind === 'box' ? 'medium' : 'light'); } catch {}
  });
})();
