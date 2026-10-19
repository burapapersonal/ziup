'use strict';
/* CyberQuiz Live — Kahoot-style live quiz.
   Static site (GitHub Pages ok). Realtime via public MQTT brokers (net.js): the host's browser is the game server,
   players connect to it using the 6-digit PIN. */


const SHAPES = ['tri', 'dia', 'cir', 'sq'];
const COLORS = ['#d01937', '#1368ce', '#a87300', '#1f7a0a'];
const LETTERS = ['A', 'B', 'C', 'D'];
const AV_COLORS = ['#ff3d71', '#00c48c', '#ffaa00', '#0095ff', '#a259ff', '#ff6b35', '#00b8c9', '#e84393'];
const TIME_CHOICES = [5, 10, 20, 30, 45, 60, 90, 120];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

function render(html, cls = '') {
  app.className = cls;
  app.innerHTML = `<div class="screen">${html}</div>`;
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const shape = (i, size = 40, cls = '') =>
  `<svg class="shp ${cls}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><use href="#s-${SHAPES[i]}"/></svg>`;

function hash(s) { let h = 7; for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); }
function avatar(name, size = 44) {
  const h = hash(name), c = AV_COLORS[h % AV_COLORS.length], s = SHAPES[(h >> 4) % 4];
  const initial = esc(([...name.trim()][0] || '?').toUpperCase());
  return `<svg class="avatar" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="50" cy="50" r="48" fill="${c}"/>
    <use href="#s-${s}" x="56" y="54" width="40" height="40" style="color:#fff" opacity=".28"/>
    <text x="50" y="52" dy=".35em" text-anchor="middle" font-size="48" font-weight="800" fill="#fff">${initial}</text></svg>`;
}

function countUp(el, to, ms = 900, from = 0) {
  if (!el) return;
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e).toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function confetti(n = 150) {
  const box = document.createElement('div');
  box.className = 'confetti';
  const palette = [...COLORS, '#b06bff', '#3cf7c8', '#ffffff', '#ff7ad9'];
  let html = '';
  for (let i = 0; i < n; i++) {
    const c = palette[i % palette.length], s = 8 + Math.random() * 12;
    const piece = [
      `<rect x="3" y="0" width="10" height="16" rx="2" fill="${c}"/>`,
      `<circle cx="8" cy="8" r="7" fill="${c}"/>`,
      `<polygon points="0,15 8,1 16,15" fill="${c}"/>`,
      `<path d="M0 8 Q4 0 8 8 T16 8" stroke="${c}" stroke-width="3" fill="none"/>`
    ][i % 4];
    html += `<svg viewBox="0 0 16 16" style="left:${Math.random() * 100}vw;width:${s}px;height:${s}px;--d:${2.6 + Math.random() * 2.6}s;--dl:${Math.random() * 1.4}s;--dx:${(Math.random() - .5) * 260}px;--r:${Math.random() * 1440 - 720}deg">${piece}</svg>`;
  }
  box.innerHTML = html;
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 7000);
}

/* ---------------- Sound (tiny WebAudio synth, no files) ---------------- */
const Sound = {
  ctx: null, on: true,
  beep(freq = 440, dur = .12, type = 'sine', vol = .15, when = 0) {
    if (!this.on) return;
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + .02);
    } catch { /* audio unavailable */ }
  },
  tick() { this.beep(1000, .04, 'square', .04); },
  pop() { this.beep(620, .07, 'sine', .14); this.beep(930, .07, 'sine', .1, .05); },
  go() { this.beep(523, .12, 'triangle', .14); this.beep(784, .25, 'triangle', .14, .1); },
  correct() { [523, 659, 784, 1047].forEach((f, i) => this.beep(f, .2, 'triangle', .15, i * .08)); },
  wrong() { this.beep(240, .25, 'sawtooth', .07); this.beep(170, .4, 'sawtooth', .07, .18); },
  gong() { this.beep(196, .9, 'sine', .2); this.beep(392, .6, 'triangle', .06); },
  fanfare() { [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.beep(f, .28, 'triangle', .14, i * .15)); }
};

/* ---------------- SVG art ---------------- */
const Art = {
  logo: () => `
  <svg class="logo" viewBox="0 0 520 200" role="img" aria-label="CyberQuiz Live">
    <g transform="translate(20 10)">
      <g class="orbit">
        <use href="#s-tri" x="-6" y="70" width="26" height="26" style="color:${COLORS[0]}"/>
        <use href="#s-dia" x="74" y="-10" width="26" height="26" style="color:${COLORS[1]}"/>
        <use href="#s-cir" x="154" y="70" width="24" height="24" style="color:${COLORS[2]}"/>
        <use href="#s-sq" x="74" y="152" width="24" height="24" style="color:${COLORS[3]}"/>
      </g>
      <path class="shield-fill" d="M87 22 146 44v42c0 38-25 63-59 75C53 149 28 124 28 86V44Z" fill="url(#gShield)"/>
      <path class="shield-line" d="M87 22 146 44v42c0 38-25 63-59 75C53 149 28 124 28 86V44Z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
      <path class="shield-check" d="M62 90l18 18 34-38" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
      <rect class="shield-scan" x="28" y="22" width="118" height="6" fill="url(#gSweep)"/>
    </g>
    <text class="logo-t1" x="205" y="98" fill="url(#gText)">CyberQuiz</text>
    <g class="logo-live" transform="translate(208 120)">
      <rect width="96" height="38" rx="19" fill="#e21b3c"/>
      <circle class="live-dot" cx="22" cy="19" r="7" fill="#fff"/>
      <text x="38" y="27" font-size="22" font-weight="800" fill="#fff">LIVE</text>
    </g>
  </svg>`,

  radar: () => `
  <svg class="radar" viewBox="0 0 200 200" aria-hidden="true">
    <defs><clipPath id="rclip"><circle cx="100" cy="100" r="90"/></clipPath></defs>
    <circle cx="100" cy="100" r="90" fill="#0b1f3a" fill-opacity=".55" stroke="#3cf7c8" stroke-opacity=".5" stroke-width="2"/>
    <g fill="none" stroke="#3cf7c8" stroke-opacity=".22">
      <circle cx="100" cy="100" r="60"/><circle cx="100" cy="100" r="30"/>
      <path d="M10 100H190M100 10V190"/>
    </g>
    <g clip-path="url(#rclip)">
      <path d="M100 100 L190 100 A90 90 0 0 0 163.6 36.4Z" fill="url(#gSweep)">
        <animateTransform attributeName="transform" type="rotate" from="0 100 100" to="360 100 100" dur="3s" repeatCount="indefinite"/>
      </path>
    </g>
    <g fill="#ff4d6d" filter="url(#glow)">
      <circle cx="140" cy="62" r="5"><animate attributeName="opacity" values="0;1;0" dur="3s" begin=".4s" repeatCount="indefinite"/></circle>
      <circle cx="62" cy="134" r="4"><animate attributeName="opacity" values="0;1;0" dur="3s" begin="1.6s" repeatCount="indefinite"/></circle>
      <circle cx="128" cy="150" r="4"><animate attributeName="opacity" values="0;1;0" dur="3s" begin="2.3s" repeatCount="indefinite"/></circle>
    </g>
    <path d="M100 74 118 81v13c0 12-8 20-18 24-10-4-18-12-18-24V81Z" fill="url(#gShield)" stroke="#fff" stroke-width="2.5"/>
  </svg>`,

  loader: () => `
  <svg class="loader" viewBox="0 0 220 60" aria-hidden="true">
    ${SHAPES.map((s, i) => `<use href="#s-${s}" x="${10 + i * 52}" y="14" width="40" height="40" style="color:${COLORS[i]};animation-delay:${i * .12}s"/>`).join('')}
  </svg>`,

  check: () => `
  <svg class="fb-icon ok" viewBox="0 0 160 160" aria-hidden="true">
    <circle cx="80" cy="80" r="56" fill="none" stroke="#7dffb0" stroke-width="2">
      <animate attributeName="r" values="56;100" dur="2.2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values=".7;0" dur="2.2s" repeatCount="indefinite"/></circle>
    <g class="burst" stroke="#fff" stroke-width="6" stroke-linecap="round">
      ${Array.from({ length: 10 }, (_, i) => `<line x1="80" y1="14" x2="80" y2="2" transform="rotate(${i * 36} 80 80)"/>`).join('')}
    </g>
    <circle class="ring" cx="80" cy="80" r="56" fill="#fff" fill-opacity=".14" stroke="#fff" stroke-width="8"/>
    <path class="mark" d="M54 82l18 18 36-40" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  cross: () => `
  <svg class="fb-icon bad" viewBox="0 0 160 160" aria-hidden="true">
    <g class="cracks" stroke="#ffb3c1" stroke-width="3" fill="none" stroke-linecap="round">
      <path d="M14 40 32 52 28 66"/><path d="M146 116 128 110 132 96"/><path d="M138 30 124 44"/>
    </g>
    <circle class="ring" cx="80" cy="80" r="56" fill="#fff" fill-opacity=".14" stroke="#fff" stroke-width="8"/>
    <path class="mark" d="M58 58l44 44" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
    <path class="mark m2" d="M102 58l-44 44" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
  </svg>`,

  clock: () => `
  <svg class="fb-icon late" viewBox="0 0 160 160" aria-hidden="true">
    <circle class="ring" cx="80" cy="80" r="56" fill="#fff" fill-opacity=".14" stroke="#fff" stroke-width="8"/>
    <path d="M80 50v32l20 12" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 80 80" to="360 80 80" dur="2.5s" repeatCount="indefinite"/>
    </path>
  </svg>`,

  pulse: (inner = '') => `
  <div class="pulse-wrap">
    <svg viewBox="0 0 200 200" aria-hidden="true">
      ${[0, 1, 2].map(i => `<circle cx="100" cy="100" r="40" fill="none" stroke="#fff" stroke-width="3">
        <animate attributeName="r" values="40;96" dur="2.4s" begin="${i * .8}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values=".7;0" dur="2.4s" begin="${i * .8}s" repeatCount="indefinite"/></circle>`).join('')}
    </svg>
    <div class="pulse-inner">${inner}</div>
  </div>`,

  flame: () => `<svg class="flame" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9Z" fill="#ffb347"/></svg>`,

  bolt: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="#3cf7c8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7Z"/></svg>`,

  readyRing: (n) => `
  <div class="gr-ring">
    <svg viewBox="0 0 240 240" aria-hidden="true">
      <circle cx="120" cy="120" r="80" fill="rgba(0,0,0,.28)" stroke="rgba(255,255,255,.14)" stroke-width="10"/>
      <circle class="gr-fg" cx="120" cy="120" r="80" fill="none" stroke="#3cf7c8" stroke-width="10" stroke-linecap="round" transform="rotate(-90 120 120)"/>
      <g class="gr-orbit">
        <polygon points="120,6 132,26 108,26" fill="${COLORS[0]}"/>
        <polygon points="234,120 222,132 210,120 222,108" fill="${COLORS[1]}"/>
        <circle cx="120" cy="222" r="11" fill="#ffcf3f"/>
        <rect x="8" y="109" width="22" height="22" rx="3" fill="${COLORS[3]}"/>
      </g>
    </svg>
    <div class="gr-num"><small>ข้อที่</small><b>${n}</b></div>
  </div>`,

  trophy: () => `
  <svg class="trophy" viewBox="0 0 120 120" aria-hidden="true">
    <defs><clipPath id="tclip"><path d="M34 14h52v26c0 16-12 28-26 28S34 56 34 40Z"/></clipPath></defs>
    <path d="M34 22H16c0 18 8 28 20 30M86 22h18c0 18-8 28-20 30" fill="none" stroke="url(#gGold)" stroke-width="7" stroke-linecap="round"/>
    <path d="M34 14h52v26c0 16-12 28-26 28S34 56 34 40Z" fill="url(#gGold)"/>
    <rect x="-40" y="10" width="26" height="70" fill="url(#gShine)" clip-path="url(#tclip)" transform="skewX(-20)">
      <animate attributeName="x" values="-40;140" dur="2.6s" repeatCount="indefinite"/>
    </rect>
    <rect x="54" y="66" width="12" height="18" fill="#d48a00"/>
    <rect x="38" y="84" width="44" height="12" rx="3" fill="url(#gGold)"/>
    <rect x="30" y="96" width="60" height="14" rx="4" fill="#7a4a00"/>
    <path d="M60 24l4 9 10 1-7.5 6.5 2.5 9.5-9-5.2-9 5.2 2.5-9.5L46 34l10-1Z" fill="#fff" opacity=".9"/>
  </svg>`,

  medal: (rank) => {
    const g = ['gGold', 'gSilver', 'gBronze'][rank - 1];
    return `<svg class="medal" viewBox="0 0 100 120" aria-hidden="true">
      <path d="M30 0h16l14 40H44ZM70 0H54L40 40h16Z" fill="${['#e21b3c', '#1368ce', '#26890c'][rank - 1]}"/>
      <circle cx="50" cy="74" r="38" fill="url(#${g})" stroke="#fff" stroke-opacity=".6" stroke-width="3"/>
      <circle cx="50" cy="74" r="28" fill="none" stroke="#000" stroke-opacity=".15" stroke-width="3"/>
      <text x="50" y="76" dy=".35em" text-anchor="middle" font-size="36" font-weight="800" fill="#3a2600" fill-opacity=".8">${rank}</text>
    </svg>`;
  }
};

/* ---------------- Quiz storage ---------------- */
const Store = {
  KEY: 'cyberquiz-quiz',
  load() {
    try {
      const q = JSON.parse(localStorage.getItem(this.KEY));
      if (q && Array.isArray(q.questions) && q.questions.length) return q;
    } catch { /* ignore */ }
    return structuredClone(window.DEFAULT_QUIZ);
  },
  save(q) { try { localStorage.setItem(this.KEY, JSON.stringify(q)); } catch { /* ignore */ } }
};

function normalizeQuiz(q) {
  if (!q || !Array.isArray(q.questions)) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
  return {
    title: String(q.title || 'Quiz').slice(0, 80),
    questions: q.questions.map(x => ({
      text: String(x.text || ''),
      options: [0, 1, 2, 3].map(i => String((x.options || [])[i] || '')),
      correct: Math.min(3, Math.max(0, Number(x.correct) || 0)),
      time: TIME_CHOICES.includes(Number(x.time)) ? Number(x.time) : 20
    }))
  };
}

function validateQuiz(q) {
  if (!q.questions.length) return 'ต้องมีอย่างน้อย 1 คำถาม';
  for (const [n, x] of q.questions.entries()) {
    if (!x.text.trim()) return `ข้อ ${n + 1}: ยังไม่ได้ใส่คำถาม`;
    if (x.options.filter(o => o.trim()).length < 2) return `ข้อ ${n + 1}: ต้องมีตัวเลือกอย่างน้อย 2 ข้อ`;
    if (!x.options[x.correct].trim()) return `ข้อ ${n + 1}: คำตอบที่ถูกต้องเป็นช่องว่าง`;
  }
  return null;
}

/* ================================================================
   HOME
   ================================================================ */
function homeView(prefillPin = '') {
  Host.teardown();
  Player.teardown();
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem('cq-player') || '{}'); } catch { /* ignore */ }
  const pin = prefillPin || '';
  const name = saved.name || '';
  render(`
    <div class="home">
      <div class="hero">${Art.logo()}</div>
      <form class="card join-card" id="joinForm" autocomplete="off">
        <h2>เข้าร่วมเกม</h2>
        <label class="field">
          <span>Game PIN</span>
          <input id="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="••••••" value="${esc(pin)}" required>
        </label>
        <label class="field">
          <span>ชื่อเล่น</span>
          <input id="nick" maxlength="16" placeholder="ชื่อที่จะโชว์บนจอ" value="${esc(name)}" required>
        </label>
        <button class="btn btn-big btn-go" type="submit">
          <span>เข้าร่วม</span>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </form>
      <button class="btn btn-ghost host-link" id="toHost">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        สร้างห้อง / จัดการคำถาม (ผู้จัด)
      </button>
    </div>`, 'v-home');

  const pinEl = $('#pin');
  pinEl.addEventListener('input', () => { pinEl.value = pinEl.value.replace(/\D/g, '').slice(0, 6); });
  (pin ? $('#nick') : pinEl).focus();
  $('#joinForm').addEventListener('submit', e => {
    e.preventDefault();
    const p = pinEl.value.trim(), n = $('#nick').value.replace(/\s+/g, ' ').trim();
    if (p.length !== 6) return toast('Game PIN ต้องเป็นตัวเลข 6 หลัก');
    if (!n) return toast('ใส่ชื่อเล่นก่อนนะ');
    Sound.pop();
    Player.join(p, n);
  });
  $('#toHost').addEventListener('click', () => editorView());
}

/* ================================================================
   EDITOR (host)
   ================================================================ */
let quiz = Store.load();

function editorView() {
  Host.teardown();
  const qHtml = (q, n) => `
    <article class="qcard" data-n="${n}">
      <div class="qcard-head">
        <span class="qnum">${n + 1}</span>
        <select data-k="time" aria-label="เวลา">
          ${TIME_CHOICES.map(t => `<option value="${t}" ${t === q.time ? 'selected' : ''}>${t} วิ</option>`).join('')}
        </select>
        <div class="qtools">
          <button class="icon-btn" data-act="up" title="เลื่อนขึ้น" ${n === 0 ? 'disabled' : ''}>▲</button>
          <button class="icon-btn" data-act="down" title="เลื่อนลง" ${n === quiz.questions.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="icon-btn" data-act="dup" title="ทำสำเนา">⧉</button>
          <button class="icon-btn danger" data-act="del" title="ลบ">✕</button>
        </div>
      </div>
      <textarea data-k="text" rows="2" placeholder="พิมพ์คำถาม...">${esc(q.text)}</textarea>
      <div class="opt-grid">
        ${q.options.map((o, i) => `
          <label class="opt-edit ${q.correct === i ? 'is-correct' : ''}" style="--c:${COLORS[i]}">
            <span class="opt-shape">${shape(i, 22)}</span>
            <input data-k="opt" data-i="${i}" value="${esc(o)}" placeholder="ตัวเลือก ${LETTERS[i]}${i > 1 ? ' (ไม่บังคับ)' : ''}">
            <input type="radio" name="c${n}" data-k="correct" data-i="${i}" ${q.correct === i ? 'checked' : ''} title="คำตอบที่ถูก">
          </label>`).join('')}
      </div>
    </article>`;

  render(`
    <div class="editor">
      <header class="ed-bar">
        <button class="btn btn-ghost" id="back">← หน้าแรก</button>
        <input class="ed-title" id="title" value="${esc(quiz.title)}" maxlength="80" aria-label="ชื่อชุดคำถาม">
        <button class="btn btn-go" id="launch">▶ เปิดห้อง</button>
      </header>
      <p class="ed-hint">กดวงกลมทางขวาของตัวเลือกเพื่อกำหนดคำตอบที่ถูก · บันทึกอัตโนมัติในเบราว์เซอร์นี้</p>
      <div class="qlist">${quiz.questions.map(qHtml).join('')}</div>
      <div class="ed-actions">
        <button class="btn" id="add">＋ เพิ่มคำถาม</button>
        <button class="btn btn-ghost" id="export">ส่งออก JSON</button>
        <label class="btn btn-ghost">นำเข้า JSON<input type="file" id="import" accept=".json,application/json" hidden></label>
        <button class="btn btn-ghost danger" id="reset">รีเซ็ตเป็นชุดเริ่มต้น</button>
      </div>
    </div>`, 'v-editor');

  const save = () => Store.save(quiz);
  $('#back').onclick = () => homeView();
  $('#title').oninput = e => { quiz.title = e.target.value; save(); };
  $('#add').onclick = () => {
    quiz.questions.push({ text: '', options: ['', '', '', ''], correct: 0, time: 20 });
    save(); editorView();
    const last = $$('.qcard').pop(); last.scrollIntoView({ behavior: 'smooth' }); $('textarea', last).focus();
  };
  $('#export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(quiz, null, 2)], { type: 'application/json' }));
    a.download = (quiz.title || 'quiz').replace(/[^\p{L}\p{N}_-]+/gu, '_') + '.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#import').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { quiz = normalizeQuiz(JSON.parse(await f.text())); save(); editorView(); toast('นำเข้าเรียบร้อย'); }
    catch (err) { toast('นำเข้าไม่สำเร็จ: ' + err.message); }
  };
  $('#reset').onclick = () => {
    if (!confirm('ล้างคำถามทั้งหมดแล้วกลับไปใช้ชุดเริ่มต้น?')) return;
    quiz = structuredClone(window.DEFAULT_QUIZ); save(); editorView();
  };
  $('#launch').onclick = () => {
    const err = validateQuiz(quiz);
    if (err) return toast(err);
    Host.open(structuredClone(quiz));
  };

  const list = $('.qlist');
  list.addEventListener('input', e => {
    const card = e.target.closest('.qcard'); if (!card) return;
    const q = quiz.questions[+card.dataset.n], k = e.target.dataset.k;
    if (k === 'text') q.text = e.target.value;
    else if (k === 'opt') q.options[+e.target.dataset.i] = e.target.value;
    else if (k === 'time') q.time = +e.target.value;
    else if (k === 'correct') {
      q.correct = +e.target.dataset.i;
      $$('.opt-edit', card).forEach((el, i) => el.classList.toggle('is-correct', i === q.correct));
    }
    save();
  });
  list.addEventListener('change', e => { if (e.target.dataset.k === 'time') { quiz.questions[+e.target.closest('.qcard').dataset.n].time = +e.target.value; save(); } });
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const n = +b.closest('.qcard').dataset.n, qs = quiz.questions;
    if (b.dataset.act === 'up' && n > 0) [qs[n - 1], qs[n]] = [qs[n], qs[n - 1]];
    else if (b.dataset.act === 'down' && n < qs.length - 1) [qs[n + 1], qs[n]] = [qs[n], qs[n + 1]];
    else if (b.dataset.act === 'dup') qs.splice(n + 1, 0, structuredClone(qs[n]));
    else if (b.dataset.act === 'del') { if (qs.length === 1) return toast('ต้องมีอย่างน้อย 1 คำถาม'); if (!confirm(`ลบข้อ ${n + 1}?`)) return; qs.splice(n, 1); }
    save(); editorView();
  });
}

/* ================================================================
   HOST — the host browser is the game server
   ================================================================ */
const Host = {
  peer: null, pin: '', quiz: null, qs: [], players: new Map(), byPeer: new Map(),
  phase: 'idle', qi: -1, qStart: 0, raf: 0, timer: 0, answers: new Map(), lastSec: -1,

  open(q) {
    this.teardown();
    this.quiz = q;
    this.qs = q.questions.map(x => ({ ...x, idx: x.options.map((o, i) => o.trim() ? i : -1).filter(i => i >= 0) }));
    this.players = new Map(); this.byPeer = new Map();
    this.phase = 'connecting';
    render(`<div class="center">${Art.loader()}<h2>กำลังสร้างห้อง...</h2></div>`, 'v-host');
    this.createPeer(0);
    window.addEventListener('beforeunload', this.onUnload);
    document.addEventListener('keydown', this.onKey);
  },

  teardown() {
    clearTimeout(this.timer); cancelAnimationFrame(this.raf);
    if (this.peer) {
      for (const p of this.players.values()) this.send(p, { t: 'closed' });
      const peer = this.peer; this.peer = null;
      setTimeout(() => { try { peer.destroy(); } catch { /* ignore */ } }, 300);
    }
    this.phase = 'idle';
    $('#hostDock')?.remove(); $('#adminPanel')?.remove();
    window.removeEventListener('beforeunload', this.onUnload);
    document.removeEventListener('keydown', this.onKey);
  },

  onUnload(e) { if (Host.phase !== 'idle' && Host.players.size) { e.preventDefault(); e.returnValue = ''; } },
  onKey(e) {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') {
      const b = $('[data-next]'); if (b) { e.preventDefault(); b.click(); }
    }
  },

  async createPeer(tries) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    const net = new Net.Host();
    try {
      const claimed = await net.open(pin);
      if (this.phase !== 'connecting') return net.destroy();
      if (!claimed) {
        if (tries < 6) return this.createPeer(tries + 1);
        throw new Error('สุ่ม PIN ไม่สำเร็จ');
      }
      net.on('connection', c => this.onConn(c));
      this.peer = net; this.pin = pin; this.lobby();
    } catch (e) {
      if (this.phase !== 'connecting') return;
      render(`<div class="center"><h2>เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ</h2><p class="muted">${esc(e.message)} — ตรวจสอบอินเทอร์เน็ต แล้วลองใหม่</p>
        <div class="row"><button class="btn" id="retry">ลองใหม่</button><button class="btn btn-ghost" id="back">กลับ</button></div></div>`, 'v-host');
      $('#retry').onclick = () => Host.open(this.quiz);
      $('#back').onclick = () => editorView();
    }
  },

  send(p, msg) { if (p.conn && p.conn.open) { try { p.conn.send(msg); } catch { /* ignore */ } } },
  broadcast(msg) {
    if (typeof msg === 'function') { for (const p of this.players.values()) this.send(p, msg(p)); return; }
    try { this.peer?.broadcast(msg); } catch { /* ignore */ }
  },
  connectedCount() { let n = 0; for (const p of this.players.values()) if (p.connected) n++; return n; },
  ranking() { return [...this.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'th')); },

  onConn(conn) {
    conn.on('data', m => this.onMsg(conn, m));
    conn.on('close', () => this.onClose(conn));
    conn.on('error', () => this.onClose(conn));
  },

  onClose(conn) {
    const p = this.byPeer.get(conn.peer);
    this.byPeer.delete(conn.peer);
    if (!p || p.conn !== conn) return;
    p.connected = false;
    if (this.phase === 'lobby') { this.players.delete(p.key); this.lobbyUpdate(); }
    else if (this.phase === 'question') this.updateAnswerCount();
    this.refreshAdmin();
  },

  onMsg(conn, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') return this.onJoin(conn, m);
    const p = this.byPeer.get(conn.peer);
    if (!p) return;
    if (m.t === 'answer') {
      if (this.phase !== 'question' || m.qi !== this.qi || this.answers.has(p.key)) return;
      const q = this.qs[this.qi], c = Number(m.choice);
      if (!q.idx.includes(c)) return;
      this.answers.set(p.key, { choice: c, elapsed: (performance.now() - this.qStart) / 1000 });
      this.send(p, { t: 'answered' });
      Sound.beep(700 + this.answers.size * 20, .05, 'sine', .06);
      this.updateAnswerCount();
    }
  },

  onJoin(conn, m) {
    const name = String(m.name || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    const token = String(m.token || '');
    const deny = msg => { try { conn.send({ t: 'error', msg }); } catch { /* ignore */ } setTimeout(() => conn.close(), 400); };
    if (!name) return deny('กรุณาใส่ชื่อ');
    const key = name.toLocaleLowerCase('th');
    let p = this.players.get(key), isNew = false;
    if (p && p.token !== token) return deny('ชื่อนี้มีคนใช้แล้ว ลองชื่ออื่นนะ');
    if (!p) {
      if (this.phase === 'podium') return deny('เกมจบไปแล้ว');
      if (this.players.size >= 300) return deny('ห้องเต็มแล้ว');
      p = { key, name, token, score: 0, streak: 0, rank: 0, conn: null, connected: false };
      this.players.set(key, p); isNew = true;
    }
    if (p.conn && p.conn !== conn) { this.byPeer.delete(p.conn.peer); try { p.conn.close(); } catch { /* ignore */ } }
    p.conn = conn; p.connected = true; this.byPeer.set(conn.peer, p);

    this.send(p, { t: 'welcome', name: p.name, score: p.score, title: this.quiz.title, started: this.phase !== 'lobby' });
    const q = this.qs[this.qi];
    if (this.phase === 'ready') this.send(p, { t: 'getready', qi: this.qi, total: this.qs.length });
    else if (this.phase === 'question') {
      if (this.answers.has(p.key)) this.send(p, { t: 'answered' });
      else this.send(p, this.questionMsg(q, q.time * 1000 - (performance.now() - this.qStart)));
    }
    if (this.phase === 'lobby') { if (isNew) Sound.pop(); this.lobbyUpdate(isNew ? p : null); }
    else if (this.phase === 'question') this.updateAnswerCount();
    this.refreshAdmin();
  },

  /* ---------- Admin dock (QR + player management during the game) ---------- */
  dock() {
    if ($('#hostDock')) return this.refreshAdmin();
    const d = document.createElement('div');
    d.id = 'hostDock';
    d.innerHTML = `
      <button class="dock-btn" id="dockQr" title="แสดง QR ให้คนเข้าร่วมเพิ่ม">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 14h3v3h-3ZM18 18h3v3h-3ZM18 14h3M14 18v3" stroke="currentColor" stroke-width="2"/></svg>
        <span>QR · ${this.pin}</span></button>
      <button class="dock-btn" id="dockPl" title="จัดการผู้เล่น">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="9" cy="8" r="4" fill="currentColor"/><path d="M1 21c0-4.4 3.6-7 8-7s8 2.6 8 7Z" fill="currentColor"/></svg>
        <b id="dockN">0</b></button>`;
    document.body.appendChild(d);
    $('#dockQr').onclick = () => this.panel('qr');
    $('#dockPl').onclick = () => this.panel('players');
    this.refreshAdmin();
  },

  panel(kind) {
    $('#adminPanel')?.remove();
    const p = document.createElement('div');
    p.id = 'adminPanel';
    p.dataset.kind = kind;
    p.innerHTML = `<div class="ap-box card"><button class="icon-btn ap-x" title="ปิด">✕</button><div class="ap-body"></div></div>`;
    document.body.appendChild(p);
    p.addEventListener('click', e => {
      if (e.target === p || e.target.closest('.ap-x')) return p.remove();
      const k = e.target.closest('[data-kick]');
      if (k) this.kick(k.dataset.kick);
    });
    if (kind === 'qr') {
      $('.ap-body', p).innerHTML = `<h2>สแกนเพื่อเข้าร่วม</h2><div class="qr" id="qr2"></div><div class="pin-big">${this.pin.slice(0, 3)} ${this.pin.slice(3)}</div><p class="muted">${esc(location.host + location.pathname)}</p>`;
      try { new QRCode($('#qr2'), { text: this.joinUrl(), width: 260, height: 260, colorDark: '#1a0b3d', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); } catch { /* ignore */ }
    } else this.refreshAdmin();
  },

  refreshAdmin() {
    const n = $('#dockN'); if (n) n.textContent = `${this.connectedCount()}/${this.players.size}`;
    const p = $('#adminPanel');
    if (!p || p.dataset.kind !== 'players') return;
    const rank = this.ranking();
    $('.ap-body', p).innerHTML = `
      <h2>ผู้เล่น (${this.connectedCount()} ออนไลน์ / ${rank.length})</h2>
      <div class="ap-list">
        ${rank.length ? rank.map((x, i) => `
          <div class="ap-row ${x.connected ? '' : 'off'}">
            <span class="ap-rank">${i + 1}</span>${avatar(x.name, 30)}
            <span class="ap-name">${esc(x.name)}</span>
            <span class="ap-st" title="${x.connected ? 'ออนไลน์' : 'หลุดการเชื่อมต่อ'}"></span>
            ${this.phase === 'question' ? `<span class="ap-ans">${this.answers.has(x.key) ? '✔ ตอบแล้ว' : '…'}</span>` : ''}
            <span class="ap-score">${x.score.toLocaleString()}</span>
            <button class="icon-btn danger" data-kick="${esc(x.key)}" title="เตะออก">✕</button>
          </div>`).join('') : '<p class="muted">ยังไม่มีผู้เล่น</p>'}
      </div>`;
  },

  kick(key) {
    const p = this.players.get(key); if (!p) return;
    if (!confirm(`เตะ "${p.name}" ออกจากห้อง?`)) return;
    this.send(p, { t: 'kicked' });
    this.players.delete(key);
    if (p.conn) { this.byPeer.delete(p.conn.peer); setTimeout(() => { try { p.conn.close(); } catch { /* ignore */ } }, 300); }
    this.lobbyUpdate(); this.refreshAdmin(); this.updateAnswerCount();
  },

  /* ---------- Lobby ---------- */
  joinUrl() { return `${location.origin}${location.pathname}?pin=${this.pin}`; },

  lobby() {
    this.phase = 'lobby';
    const url = this.joinUrl();
    const pinFmt = this.pin.slice(0, 3) + ' ' + this.pin.slice(3);
    render(`
      <div class="lobby">
        <header class="lobby-top">
          <div class="join-info card">
            <div class="ji-text">
              <div class="muted">เข้าร่วมที่ <b>${esc(location.host + location.pathname)}</b></div>
              <div class="pin-label">Game PIN:</div>
              <div class="pin-big" id="pinBig">${pinFmt}</div>
              <button class="btn btn-ghost btn-sm" id="copy">คัดลอกลิงก์</button>
            </div>
            <div class="qr" id="qr" title="${esc(url)}"></div>
          </div>
        </header>
        <div class="lobby-mid">
          <h1 class="quiz-title">${esc(this.quiz.title)}</h1>
          <div class="lobby-bar">
            <div class="pcount"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="9" cy="8" r="4" fill="currentColor"/><path d="M1 21c0-4.4 3.6-7 8-7s8 2.6 8 7Z" fill="currentColor"/><circle cx="18" cy="7" r="3" fill="currentColor" opacity=".6"/><path d="M17 13c3.5 0 6 2 6 6h-4" fill="currentColor" opacity=".6"/></svg><b id="pc">0</b></div>
            <div class="row">
              <button class="icon-btn lg" id="snd" title="เสียง">${Sound.on ? '🔊' : '🔇'}</button>
              <button class="icon-btn lg" id="fs" title="เต็มจอ">⛶</button>
              <button class="btn btn-go btn-big" id="start" data-next>เริ่มเกม</button>
            </div>
          </div>
          <div class="chips" id="chips"><div class="waiting">${Art.loader()}<p>รอผู้เล่นเข้าร่วม...</p></div></div>
        </div>
        <button class="btn btn-ghost btn-sm lobby-back" id="cancel">ยกเลิกห้อง</button>
      </div>`, 'v-host v-lobby');

    try {
      new QRCode($('#qr'), { text: url, width: 220, height: 220, colorDark: '#1a0b3d', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    } catch { $('#qr').textContent = url; }
    $('#copy').onclick = () => navigator.clipboard?.writeText(url).then(() => toast('คัดลอกลิงก์แล้ว'), () => toast(url));
    $('#snd').onclick = e => { Sound.on = !Sound.on; e.currentTarget.textContent = Sound.on ? '🔊' : '🔇'; };
    $('#fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    $('#start').onclick = () => this.startGame();
    $('#cancel').onclick = () => { if (confirm('ปิดห้องนี้? ผู้เล่นทั้งหมดจะถูกตัดการเชื่อมต่อ')) editorView(); };
    $('#chips').addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      this.kick(chip.dataset.key);
    });
    this.lobbyUpdate();
    this.dock();
  },

  lobbyUpdate(newP) {
    if (this.phase !== 'lobby') return;
    const chips = $('#chips'), pc = $('#pc');
    if (!chips) return;
    pc.textContent = this.players.size;
    pc.parentElement.classList.remove('bump'); void pc.offsetWidth; pc.parentElement.classList.add('bump');
    if (!this.players.size) { chips.innerHTML = `<div class="waiting">${Art.loader()}<p>รอผู้เล่นเข้าร่วม...</p></div>`; return; }
    const existing = new Set($$('.chip', chips).map(c => c.dataset.key));
    $('.waiting', chips)?.remove();
    for (const c of $$('.chip', chips)) if (!this.players.has(c.dataset.key)) c.remove();
    for (const p of this.players.values()) {
      if (existing.has(p.key)) continue;
      const el = document.createElement('button');
      el.className = 'chip' + (newP === p ? ' pop' : '');
      el.dataset.key = p.key;
      el.title = 'คลิกเพื่อเตะออก';
      el.innerHTML = `${avatar(p.name, 34)}<span>${esc(p.name)}</span>`;
      chips.appendChild(el);
    }
  },

  /* ---------- Game flow ---------- */
  startGame() {
    if (!this.players.size && !confirm('ยังไม่มีผู้เล่น เริ่มเลยไหม?')) return;
    for (const p of this.players.values()) { p.score = 0; p.streak = 0; }
    this.qi = -1;
    this.next();
  },

  next() {
    this.qi++;
    if (this.qi >= this.qs.length) return this.podium();
    this.ready();
  },

  ready() {
    this.phase = 'ready';
    const q = this.qs[this.qi];
    this.broadcast({ t: 'getready', qi: this.qi, total: this.qs.length });
    render(`
      <div class="intro">
        <div class="intro-num"><span>ข้อ</span><b>${this.qi + 1}</b><span>/ ${this.qs.length}</span></div>
        <h1 class="intro-q">${esc(q.text)}</h1>
        <svg class="intro-bar" viewBox="0 0 600 14" preserveAspectRatio="none" aria-hidden="true">
          <rect width="600" height="14" rx="7" fill="#fff" fill-opacity=".15"/>
          <rect class="fill" width="600" height="14" rx="7" fill="#fff"/>
        </svg>
      </div>`, 'v-host v-intro');
    Sound.go();
    this.timer = setTimeout(() => this.question(), 4200);
  },

  questionMsg(q, remain) {
    return { t: 'question', qi: this.qi, total: this.qs.length, text: q.text, time: q.time, remain: Math.max(0, remain), options: q.idx.map(i => ({ i, text: q.options[i] })) };
  },

  question() {
    this.phase = 'question';
    this.answers = new Map();
    const q = this.qs[this.qi];
    const C = 2 * Math.PI * 52;
    render(`
      <div class="qscreen">
        <header class="qbar">
          <span class="badge">${this.qi + 1} / ${this.qs.length}</span>
          <h1 class="qtext">${esc(q.text)}</h1>
          <button class="btn btn-ghost btn-sm" id="skip" data-next>ข้าม ⏭</button>
        </header>
        <div class="qmid">
          <div class="timer" id="timer">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" class="tr-bg"/>
              <circle cx="60" cy="60" r="52" class="tr-fg" id="tring" stroke-dasharray="${C}" stroke-dashoffset="0" transform="rotate(-90 60 60)"/>
            </svg>
            <b id="tnum">${q.time}</b>
          </div>
          <div class="qart">${Art.radar()}</div>
          <div class="acount"><b id="ac">0</b><span>คำตอบ</span><small id="acof">จาก ${this.connectedCount()}</small></div>
        </div>
        <div class="opts">
          ${q.idx.map((i, k) => `
            <div class="opt" style="--c:${COLORS[i]};--k:${k}">
              ${shape(i, 44)}<span>${esc(q.options[i])}</span>
            </div>`).join('')}
        </div>
      </div>`, 'v-host v-question');
    $('#skip').onclick = () => this.endQuestion();

    this.broadcast(this.questionMsg(q, q.time * 1000));
    this.qStart = performance.now();
    this.lastSec = -1;
    const ring = $('#tring'), num = $('#tnum'), timerEl = $('#timer');
    const loop = now => {
      if (this.phase !== 'question') return;
      const remain = Math.max(0, q.time - (now - this.qStart) / 1000);
      ring.setAttribute('stroke-dashoffset', C * (1 - remain / q.time));
      const sec = Math.ceil(remain);
      if (sec !== this.lastSec) {
        this.lastSec = sec; num.textContent = sec;
        if (sec <= 5 && sec > 0) { timerEl.classList.add('hurry'); Sound.tick(); num.classList.remove('beat'); void num.offsetWidth; num.classList.add('beat'); }
      }
      if (remain <= 0) return this.endQuestion();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },

  updateAnswerCount() {
    if (this.phase !== 'question') return;
    this.refreshAdmin();
    const ac = $('#ac'), of = $('#acof');
    if (ac) { ac.textContent = this.answers.size; ac.classList.remove('beat'); void ac.offsetWidth; ac.classList.add('beat'); }
    const live = this.connectedCount();
    if (of) of.textContent = `จาก ${live}`;
    let allIn = live > 0;
    for (const p of this.players.values()) if (p.connected && !this.answers.has(p.key)) { allIn = false; break; }
    if (allIn) { clearTimeout(this.timer); this.timer = setTimeout(() => this.endQuestion(), 600); }
  },

  endQuestion() {
    if (this.phase !== 'question') return;
    this.phase = 'reveal';
    cancelAnimationFrame(this.raf); clearTimeout(this.timer);
    const q = this.qs[this.qi];
    const counts = [0, 0, 0, 0];
    const prevOrder = this.ranking().map(p => p.key);
    for (const p of this.players.values()) {
      const a = this.answers.get(p.key);
      if (a) counts[a.choice]++;
      const ok = !!a && a.choice === q.correct;
      p.answered = !!a;
      if (ok) {
        p.streak++;
        const base = Math.round(1000 * (1 - Math.min(1, a.elapsed / q.time) / 2));
        const bonus = Math.min((p.streak - 1) * 100, 500);
        p.last = base + bonus; p.score += p.last;
      } else { p.streak = 0; p.last = 0; }
      p.ok = ok;
    }
    const rank = this.ranking();
    rank.forEach((p, i) => { p.prevRank = prevOrder.indexOf(p.key) + 1; p.rank = i + 1; });
    let fastest = null;
    for (const p of this.players.values()) {
      const a = this.answers.get(p.key);
      if (a && a.choice === q.correct && (!fastest || a.elapsed < fastest.t)) fastest = { name: p.name, t: a.elapsed };
    }
    this.stats = { counts, nCorrect: counts[q.correct], fastest, total: rank.length };
    rank.forEach((p, i) => this.send(p, {
      t: 'result', ok: p.ok, answered: p.answered, points: p.last, score: p.score, streak: p.streak,
      rank: p.rank, total: rank.length, correctText: q.options[q.correct], correct: q.correct,
      ahead: i > 0 ? { name: rank[i - 1].name, gap: rank[i - 1].score - p.score } : null
    }));

    const max = Math.max(1, ...counts);
    const nCorrect = counts[q.correct];
    render(`
      <div class="qscreen reveal">
        <header class="qbar">
          <span class="badge">${this.qi + 1} / ${this.qs.length}</span>
          <h1 class="qtext">${esc(q.text)}</h1>
          <button class="btn btn-go" id="nextBtn" data-next>ถัดไป →</button>
        </header>
        <div class="chart">
          ${q.idx.map((i, k) => `
            <div class="bar-col ${i === q.correct ? 'right' : 'dim'}" style="--c:${COLORS[i]};--h:${counts[i] / max};--k:${k}">
              <div class="bar-num">${counts[i]}</div>
              <div class="bar"><div class="bar-fill"></div></div>
              <div class="bar-foot">${shape(i, 28)}${i === q.correct ? '<svg class="tick" viewBox="0 0 24 24" width="26" height="26"><path d="M4 12l5 5L20 6" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</div>
            </div>`).join('')}
        </div>
        <p class="reveal-sum">${nCorrect} จาก ${this.players.size} คนตอบถูก</p>
        <div class="opts">
          ${q.idx.map((i, k) => `
            <div class="opt ${i === q.correct ? 'right' : 'dim'}" style="--c:${COLORS[i]};--k:${k}">
              ${shape(i, 44)}<span>${esc(q.options[i])}</span>
              ${i === q.correct ? '<svg class="tick" viewBox="0 0 24 24" width="34" height="34"><path d="M4 12l5 5L20 6" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
            </div>`).join('')}
        </div>
      </div>`, 'v-host v-reveal');
    Sound.gong();
    this.refreshAdmin();
    $('#nextBtn').onclick = () => this.scoreboard();
  },

  scoreboard() {
    this.phase = 'scoreboard';
    const rank = this.ranking();
    const top = rank.slice(0, 5);
    const max = Math.max(1, top[0]?.score || 1);
    const last = this.qi === this.qs.length - 1;
    const q = this.qs[this.qi];
    const st = this.stats || { counts: [0, 0, 0, 0], nCorrect: 0, fastest: null, total: rank.length };
    const pct = st.total ? Math.round(st.nCorrect / st.total * 100) : 0;
    const C = 2 * Math.PI * 48;
    const bmax = Math.max(1, ...st.counts);
    const moveOf = p => (this.qi > 0 && p.prevRank) ? p.prevRank - p.rank : 0;

    rank.forEach((p, i) => this.send(p, {
      t: 'board', qi: this.qi, total: this.qs.length, last, rank: p.rank, players: rank.length,
      move: moveOf(p), score: p.score, gain: p.last || 0, streak: p.streak,
      around: rank.slice(Math.max(0, i - 1), i + 2).map(x => ({ rank: x.rank, name: x.name, score: x.score, me: x === p })),
      ahead: i > 0 ? { name: rank[i - 1].name, gap: rank[i - 1].score - p.score } : null
    }));

    const arrow = mv => mv > 0
      ? `<span class="mv up"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 4l7 8h-4v8H9v-8H5Z" fill="currentColor"/></svg>${mv}</span>`
      : mv < 0 ? `<span class="mv down"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 20l7-8h-4V4H9v8H5Z" fill="currentColor"/></svg>${-mv}</span>`
      : `<span class="mv same">—</span>`;

    render(`
      <div class="board2">
        <section class="b-left">
          <header class="board-head">
            <h1>กระดานคะแนน</h1>
            <span class="badge">หลังข้อ ${this.qi + 1} / ${this.qs.length}</span>
          </header>
          <ol class="ranks">
            ${top.length ? top.map((p, i) => `
              <li class="rank-row" style="--k:${i};--w:${Math.max(.12, p.score / max)}">
                <span class="rbar"></span>
                <span class="rk">${i + 1}</span>
                ${avatar(p.name, 50)}
                <span class="rn"><span class="rn-t">${esc(p.name)}</span>${p.streak >= 2 ? `<em class="streak">${Art.flame()}${p.streak} ข้อ</em>` : ''}</span>
                ${arrow(moveOf(p))}
                <span class="rg">+${(p.last || 0).toLocaleString()}</span>
                <span class="rs" data-score="${p.score}" data-from="${p.score - (p.last || 0)}">0</span>
              </li>`).join('') : '<li class="muted">ไม่มีผู้เล่น</li>'}
          </ol>
          ${rank.length > 5 ? `<p class="muted more">และผู้เล่นอีก ${rank.length - 5} คน · ดูอันดับตัวเองได้ในมือถือ</p>` : ''}
        </section>
        <aside class="b-right">
          <div class="card sum">
            <div class="muted">สรุปข้อนี้</div>
            <div class="sum-top">
              <svg class="donut" viewBox="0 0 120 120" role="img" aria-label="ตอบถูก ${pct}%">
                <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="14"/>
                <circle class="donut-fg" cx="60" cy="60" r="48" fill="none" stroke="#3cf7c8" stroke-width="14" stroke-linecap="round"
                  style="--len:${(C * pct / 100).toFixed(1)};--C:${C.toFixed(1)}" transform="rotate(-90 60 60)"/>
                <text x="60" y="69" text-anchor="middle" font-size="26" font-weight="800" fill="#fff">${pct}%</text>
              </svg>
              <div class="sum-nums">
                <b>${st.nCorrect} / ${st.total}</b>
                <span>คนตอบถูก</span>
                ${st.fastest ? `<small>เร็วสุด ${st.fastest.t.toFixed(1)} วิ · ${esc(st.fastest.name)}</small>` : ''}
              </div>
            </div>
            <div class="mini-bars">
              ${q.idx.map((i, k) => `
                <div class="mb ${i === q.correct ? 'right' : ''}" style="--c:${COLORS[i]};--h:${st.counts[i] / bmax};--k:${k}">
                  <b>${st.counts[i]}</b><div class="mb-fill"></div>${shape(i, 16)}
                </div>`).join('')}
            </div>
          </div>
          <div class="answer-card">
            <div class="ac-head"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z"/><path d="M9 12l2 2 4-4"/></svg>คำตอบที่ถูก</div>
            <div class="ac-body">${shape(q.correct, 22)}<span>${esc(q.options[q.correct])}</span></div>
            <small>หยุด · ยืนยัน · แจ้ง</small>
          </div>
          <button class="btn btn-go btn-big" id="nextBtn" data-next>${last ? 'ประกาศผล' : 'ข้อถัดไป'}
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </aside>
      </div>`, 'v-host v-board');
    $$('.rs').forEach((el, i) => setTimeout(() => countUp(el, +el.dataset.score, 1000, +el.dataset.from), 250 + i * 120));
    Sound.pop();
    $('#nextBtn').onclick = () => this.next();
  },

  podium() {
    this.phase = 'podium';
    const rank = this.ranking();
    this.broadcast(p => ({ t: 'end', rank: p.rank, score: p.score, total: rank.length, top: rank.slice(0, 3).map(x => x.name) }));
    const slot = (p, place) => p ? `
      <div class="pod pod-${place}">
        <div class="pod-who">
          ${place === 1 ? Art.trophy() : ''}
          ${avatar(p.name, place === 1 ? 84 : 66)}
          <div class="pod-name">${esc(p.name)}</div>
          <div class="pod-score">${p.score.toLocaleString()}</div>
        </div>
        <div class="pod-block">${Art.medal(place)}</div>
      </div>` : `<div class="pod pod-${place} empty"><div class="pod-block"></div></div>`;
    render(`
      <div class="podium">
        <h1 class="podium-title">${esc(this.quiz.title)}</h1>
        <div class="pods">${slot(rank[1], 2)}${slot(rank[0], 1)}${slot(rank[2], 3)}</div>
        ${rank.length > 3 ? `<details class="all-ranks"><summary>ดูอันดับทั้งหมด (${rank.length} คน)</summary><ol>${rank.map(p => `<li><b>${esc(p.name)}</b><span>${p.score.toLocaleString()}</span></li>`).join('')}</ol></details>` : ''}
        <div class="row center-row">
          <button class="btn" id="again">เล่นอีกรอบ (ห้องเดิม)</button>
          <button class="btn btn-ghost" id="csv">ดาวน์โหลดผล CSV</button>
          <button class="btn btn-ghost" id="close">ปิดห้อง</button>
        </div>
      </div>`, 'v-host v-podium');
    Sound.fanfare();
    setTimeout(() => confetti(), 2600);
    setTimeout(() => confetti(90), 4200);
    $('#again').onclick = () => {
      this.phase = 'lobby';
      for (const [k, p] of this.players) if (!p.connected) this.players.delete(k);
      for (const p of this.players.values()) { p.score = 0; p.streak = 0; this.send(p, { t: 'welcome', name: p.name, score: 0, title: this.quiz.title }); }
      this.lobby();
    };
    $('#csv').onclick = () => {
      const rows = [['rank', 'name', 'score'], ...rank.map(p => [p.rank, p.name, p.score])];
      const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'quiz-results.csv'; a.click();
    };
    $('#close').onclick = () => editorView();
  }
};

/* ================================================================
   PLAYER
   ================================================================ */
const Player = {
  peer: null, conn: null, pin: '', name: '', token: '', score: 0, raf: 0, state: 'idle', joinTimer: 0,

  teardown() {
    cancelAnimationFrame(this.raf); clearTimeout(this.joinTimer);
    this.state = 'idle';
    const peer = this.peer; this.peer = null; this.conn = null;
    if (peer) try { peer.destroy(); } catch { /* ignore */ }
  },

  getToken() {
    try {
      let t = sessionStorage.getItem('cq-token');
      if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('cq-token', t); }
      return t;
    } catch { return this.token || (this.token = Math.random().toString(36).slice(2)); }
  },

  join(pin, name) {
    this.teardown();
    this.pin = pin; this.name = name; this.token = this.getToken();
    this.state = 'joining';
    render(`<div class="center">${Art.loader()}<h2>กำลังเชื่อมต่อห้อง ${esc(pin)}...</h2></div>`, 'v-player');
    const net = new Net.Player();
    this.peer = net;
    const fail = msg => {
      if (this.peer !== net || this.state !== 'joining') return;
      this.teardown(); homeView(pin); toast(msg, 4500);
    };
    this.joinTimer = setTimeout(() => fail('เชื่อมต่อไม่สำเร็จ — ตรวจ PIN และอินเทอร์เน็ต แล้วลองใหม่'), 40000);
    net.join(pin).then(conn => {
      if (this.peer !== net) return;
      if (!conn) return fail('ไม่พบห้อง PIN นี้ — ผู้จัดอาจยังไม่เปิดห้อง หรือเน็ตบล็อกการเชื่อมต่อ');
      this.conn = conn;
      const hello = () => conn.send({ t: 'join', name: this.name, token: this.token });
      conn.on('data', m => this.onMsg(m));
      conn.on('close', () => this.lost(conn));
      conn.on('reconnect', hello); // network blip: re-attach to the same player slot
      hello();
    }, () => fail('เชื่อมต่อไม่สำเร็จ — ลองสลับ Wi‑Fi / 4G แล้วลองใหม่'));
  },

  lost(conn) {
    if (conn !== this.conn || ['idle', 'ended', 'joining'].includes(this.state)) return;
    this.state = 'lost';
    cancelAnimationFrame(this.raf);
    render(`
      <div class="center">
        ${Art.clock()}
        <h2>การเชื่อมต่อหลุด</h2>
        <p class="muted">คะแนนของคุณยังอยู่ — กดเชื่อมต่อใหม่ด้วยชื่อเดิม</p>
        <div class="row"><button class="btn btn-go" id="re">เชื่อมต่อใหม่</button><button class="btn btn-ghost" id="home">หน้าแรก</button></div>
      </div>`, 'v-player');
    $('#re').onclick = () => this.join(this.pin, this.name);
    $('#home').onclick = () => homeView();
  },

  send(m) { if (this.conn?.open) try { this.conn.send(m); } catch { /* ignore */ } },

  topbar(extra = '') {
    return `<header class="p-top">${avatar(this.name, 34)}<span class="p-name">${esc(this.name)}</span>${extra}<span class="p-score">${this.score.toLocaleString()}</span></header>`;
  },

  onMsg(m) {
    if (!m || typeof m !== 'object') return;
    clearTimeout(this.joinTimer);
    cancelAnimationFrame(this.raf);
    switch (m.t) {
      case 'error':
        this.state = 'joining'; // let fail() handle it
        this.teardown(); homeView(this.pin); toast(m.msg, 4500);
        break;
      case 'kicked':
        this.state = 'ended'; this.teardown(); homeView(); toast('คุณถูกผู้จัดนำออกจากห้อง');
        break;
      case 'closed':
        this.state = 'ended'; this.teardown(); homeView(); toast('ผู้จัดปิดห้องแล้ว');
        break;
      case 'welcome':
        this.state = 'wait'; this.name = m.name; this.score = m.score || 0;
        try { sessionStorage.setItem('cq-player', JSON.stringify({ name: this.name, pin: this.pin })); } catch { /* ignore */ }
        if (history.replaceState) history.replaceState(null, '', location.pathname);
        render(`
          ${this.topbar()}
          <div class="center grow">
            ${Art.pulse(avatar(this.name, 96))}
            <h2>${m.started ? 'กลับเข้าเกมแล้ว!' : 'เข้าห้องแล้ว!'}</h2>
            <p class="muted">${m.started ? 'รอข้อถัดไปสักครู่...' : 'เห็นชื่อตัวเองบนจอไหม? รอผู้จัดเริ่มเกม'}</p>
            <p class="p-title">${esc(m.title || '')}</p>
          </div>`, 'v-player v-pwait');
        Sound.pop();
        break;
      case 'getready':
        this.state = 'ready';
        render(`
          ${this.topbar(`<span class="p-q">ข้อ ${m.qi + 1}/${m.total}</span>`)}
          <div class="center grow pready">
            ${Art.readyRing(m.qi + 1)}
            <h1>เตรียมตัว!</h1>
            <p class="muted">คำถามกำลังขึ้นบนจอใหญ่ มองจอแล้วรอกดได้เลย</p>
            ${Art.loader()}
            <div class="tip">${Art.bolt()}<span>ตอบเร็ว = คะแนนเยอะ ตอบถูกติดกันได้โบนัสสูงสุด +500</span></div>
          </div>`, 'v-player v-pready');
        break;
      case 'board':
        this.state = 'board'; this.board(m);
        break;
      case 'question':
        this.state = 'question'; this.question(m);
        break;
      case 'answered':
        this.state = 'answered';
        render(`
          ${this.topbar()}
          <div class="center grow">
            ${Art.pulse('<svg viewBox="0 0 24 24" width="64" height="64"><path d="M3 12l18-9-6 18-3-7Z" fill="#fff"/></svg>')}
            <h2>ส่งคำตอบแล้ว!</h2>
            <p class="muted">รอดูว่าใครเร็วที่สุด...</p>
          </div>`, 'v-player v-pwait');
        break;
      case 'result':
        this.state = 'result'; this.result(m);
        break;
      case 'end':
        this.state = 'ended'; this.end(m);
        break;
    }
  },

  question(m) {
    this.lastPick = null;
    render(`
      ${this.topbar(`<span class="p-q">ข้อ ${m.qi + 1}/${m.total}</span>`)}
      <svg class="p-timer" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect id="ptb" width="100" height="4" fill="#fff"/></svg>
      <p class="p-qtext">${esc(m.text)}</p>
      <div class="p-opts n${m.options.length}">
        ${m.options.map((o, k) => `
          <button class="p-opt" data-i="${o.i}" style="--c:${COLORS[o.i]};--k:${k}">
            ${shape(o.i, 54)}<span>${esc(o.text)}</span>
          </button>`).join('')}
      </div>`, 'v-player v-panswer');
    const t0 = performance.now(), total = m.time * 1000, bar = $('#ptb');
    const loop = now => {
      const left = Math.max(0, m.remain - (now - t0));
      bar.setAttribute('width', (left / total) * 100);
      if (left > 0) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    $('.p-opts').addEventListener('click', e => {
      const b = e.target.closest('.p-opt'); if (!b || this.state !== 'question') return;
      this.state = 'sent';
      this.lastPick = { i: +b.dataset.i, text: $('span', b).textContent };
      b.classList.add('chosen');
      $$('.p-opt').forEach(x => x !== b && x.classList.add('faded'));
      navigator.vibrate?.(30);
      Sound.pop();
      this.send({ t: 'answer', qi: m.qi, choice: +b.dataset.i });
    });
  },

  result(m) {
    const from = this.score;
    this.score = m.score;
    const cls = m.ok ? 'ok' : 'bad';
    const title = m.ok ? 'ถูกต้อง!' : m.answered ? 'ยังไม่ถูก' : 'หมดเวลา!';
    const icon = m.ok ? Art.check() : m.answered ? Art.cross() : Art.clock();
    const lostStreak = (this.streak || 0) >= 2;
    this.streak = m.streak;
    const pick = this.lastPick;
    const sub = m.ok
      ? (m.streak >= 2 ? `<div class="streak-pill">${Art.flame()} ตอบถูกติดกัน ${m.streak} ข้อ</div>` : '')
      : `<p class="muted">${lostStreak ? 'สถิติตอบถูกติดกันหายไปแล้ว ข้อหน้าเอาใหม่!' : 'ไม่เป็นไร ข้อหน้าเอาใหม่!'}</p>
         <div class="ans-box">
           <small>คำตอบที่ถูกคือ</small>
           <div class="ans-right" style="--c:${COLORS[m.correct]}">${shape(m.correct, 26)}<b>${esc(m.correctText)}</b></div>
           ${pick ? `<div class="ans-mine" style="--c:${COLORS[pick.i]}">${shape(pick.i, 20)}<span>คุณตอบ: ${esc(pick.text)}</span></div>` : ''}
         </div>`;
    render(`
      ${this.topbar()}
      <div class="center grow fb fb-${cls}">
        ${icon}
        <h1>${title}</h1>
        ${sub}
        <div class="pts">${m.ok ? '+<b id="pts">0</b>' : '<b>+0</b>'}</div>
        <p class="rank-line">คุณอยู่อันดับ <b>${m.rank}</b> จาก ${m.total}</p>
        ${m.ahead ? `<p class="muted">ตามหลัง <b>${esc(m.ahead.name)}</b> อยู่ ${m.ahead.gap.toLocaleString()} คะแนน</p>` : m.rank === 1 ? '<p class="muted">คุณนำอยู่!</p>' : ''}
      </div>`, `v-player v-pfb ${cls}`);
    if (m.ok) { countUp($('#pts'), m.points, 800); Sound.correct(); navigator.vibrate?.([40, 40, 40]); }
    else { Sound.wrong(); navigator.vibrate?.(200); }
    const sc = $('.p-score'); if (sc) countUp(sc, m.score, 900, from);
  },

  board(m) {
    const from = this.score;
    this.score = m.score;
    const tier = m.rank <= 3 ? ['gGold', 'gSilver', 'gBronze'][m.rank - 1] : null;
    const ink = m.rank <= 3 ? ['#3a2600', '#23283a', '#2a1200'][m.rank - 1] : '#fff';
    const mv = m.move > 0 ? `<div class="mv-pill up"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4l7 8h-4v8H9v-8H5Z" fill="currentColor"/></svg>ขึ้นมา ${m.move} อันดับ</div>`
      : m.move < 0 ? `<div class="mv-pill down"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20l7-8h-4V4H9v8H5Z" fill="currentColor"/></svg>ตกลง ${-m.move} อันดับ</div>`
      : m.qi > 0 ? '<div class="mv-pill same">รักษาอันดับไว้ได้</div>' : '';
    render(`
      ${this.topbar(`<span class="p-q">หลังข้อ ${m.qi + 1}/${m.total}</span>`)}
      <div class="center grow pboard">
        <div class="kicker">อันดับของคุณ</div>
        <div class="rank-medal">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <g fill="#fff">
              <path d="M100 4l3 9 9 3-9 3-3 9-3-9-9-3 9-3Z"><animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite"/></path>
              <path d="M176 60l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"><animate attributeName="opacity" values="0;1;0" dur="2s" begin=".7s" repeatCount="indefinite"/></path>
              <path d="M22 140l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"><animate attributeName="opacity" values="0;1;0" dur="2s" begin="1.3s" repeatCount="indefinite"/></path>
            </g>
            <circle cx="100" cy="100" r="74" fill="${tier ? `url(#${tier})` : '#46178f'}" stroke="#fff" stroke-opacity=".7" stroke-width="5"/>
            <circle cx="100" cy="100" r="58" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="4"/>
          </svg>
          <div class="rm-num" style="color:${ink}"><span>#</span><b>${m.rank}</b></div>
        </div>
        ${mv}
        <div class="stat3">
          <div><small>คะแนนรวม</small><b id="bs">${from.toLocaleString()}</b></div>
          <div><small>ข้อนี้</small><b class="g">+${m.gain.toLocaleString()}</b></div>
          <div><small>ถูกติดกัน</small><b class="o">${m.streak}</b></div>
        </div>
        <div class="around">
          ${m.around.map((x, k) => `
            <div class="ar-row ${x.me ? 'me' : ''}" style="--k:${k}">
              <span class="ar-rk">${x.rank}</span>${avatar(x.name, 30)}
              <span class="ar-n">${esc(x.name)}${x.me ? ' (คุณ)' : ''}</span>
              <span class="ar-s">${x.score.toLocaleString()}</span>
            </div>`).join('')}
        </div>
        <p class="gap-line">${m.ahead ? `อีก <b>${m.ahead.gap.toLocaleString()}</b> คะแนนจะแซง ${esc(m.ahead.name)}` : m.players > 1 ? 'คุณนำอยู่! รักษาไว้ให้ได้' : ''}</p>
        <div class="live-hint"><i></i>ดูกระดานคะแนนบนจอใหญ่ · ${m.last ? 'กำลังจะประกาศผล' : 'ข้อถัดไปกำลังมา'}</div>
      </div>`, 'v-player v-pboard');
    countUp($('#bs'), m.score, 900, from);
    Sound.pop();
  },

  end(m) {
    this.score = m.score;
    const medal = m.rank <= 3 ? Art.medal(m.rank) : '';
    const msg = m.rank === 1 ? 'แชมป์!' : m.rank <= 3 ? 'ขึ้นโพเดียม!' : m.rank <= Math.ceil(m.total / 2) ? 'เยี่ยมมาก!' : 'ขอบคุณที่ร่วมเล่น!';
    render(`
      ${this.topbar()}
      <div class="center grow">
        ${medal || Art.pulse(avatar(this.name, 96))}
        <h1>${msg}</h1>
        <p class="rank-line">อันดับ <b>${m.rank}</b> จาก ${m.total}</p>
        <div class="pts"><b>${m.score.toLocaleString()}</b> คะแนน</div>
        <p class="muted">หยุด · ยืนยัน · แจ้ง</p>
        <button class="btn btn-ghost" id="home">หน้าแรก</button>
      </div>`, 'v-player v-pend');
    $('#home').onclick = () => homeView();
    if (m.rank <= 3) { confetti(120); Sound.fanfare(); }
  }
};

/* ---------------- boot ---------------- */
(function boot() {
  const pin = new URLSearchParams(location.search).get('pin') || '';
  if (typeof mqtt === 'undefined') {
    render(`<div class="center"><h2>โหลดไลบรารีไม่สำเร็จ</h2><p class="muted">ตรวจสอบอินเทอร์เน็ต แล้วรีเฟรชหน้า</p></div>`);
    return;
  }
  homeView(/^\d{6}$/.test(pin) ? pin : '');
})();
