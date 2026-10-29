// A quiz player bot speaking the private-broker protocol (net.js, network 'o').
// Records timings into the shared metrics object M.
const mqtt = require('mqtt');
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function newMetrics() {
  return { joinMs: [], joinFail: 0, welcome: 0, ackMs: [], qArrive: {}, results: 0, boards: 0, ends: 0, closed: 0, errors: {}, reconnects: 0 };
}

// opts: { url, pin, i, tag, M, answerDelay: [minMs, maxMs], giveUpMs }
function bot(opts) {
  const { url, pin, i, tag = 'b', M } = opts;
  const [dMin, dMax] = opts.answerDelay || [500, 7000];
  return new Promise(resolve => {
    const base = `ziup/v1/${pin}/`;
    const id = 'zp_' + rid() + i;
    const inbox = base + 'h/' + id, priv = base + 'p/' + id;
    const t0 = Date.now();
    const st = { id, joined: false, sentAt: 0, c: null };
    const send = m => c.publish(inbox, JSON.stringify({ m }), { qos: 1 });
    const c = mqtt.connect(url, {
      clientId: id, keepalive: 20, reconnectPeriod: 3000, connectTimeout: 20000, clean: true,
      will: { topic: inbox, payload: JSON.stringify({ m: { t: '_bye' } }), qos: 1 }
    });
    st.c = c;
    const no = String(i).padStart(4, '0');
    const join = () => send({ t: 'join', name: `${tag}${no}`, full: `บอท ${tag}ทดสอบ${no}`, dept: ['IT', 'การเงิน', 'บุคคล', 'กฎหมาย'][i % 4], token: 'tok' + id });
    const giveUp = setTimeout(() => { if (!st.joined) { M.joinFail++; resolve(st); } }, opts.giveUpMs || 90000);
    let started = false, connects = 0;
    c.on('error', e => { M.errors[e.message] = (M.errors[e.message] || 0) + 1; });
    c.on('connect', () => {
      if (connects++) { M.reconnects++; if (st.joined) join(); }
      c.subscribe([base + 'room', base + 'all', priv], { qos: 1 });
    });
    const handle = m => {
      if (!m) return;
      switch (m.t) {
        case 'welcome':
          if (!st.joined) { st.joined = true; M.welcome++; M.joinMs.push(Date.now() - t0); clearTimeout(giveUp); resolve(st); }
          break;
        case 'question': {
          (M.qArrive[m.qi] ||= []).push(Date.now());
          const opts2 = m.options.map(o => o.i);
          const choice = Math.random() < 0.7 ? opts2[Math.min(1, opts2.length - 1)] : opts2[Math.floor(Math.random() * opts2.length)];
          setTimeout(() => { st.sentAt = Date.now(); send({ t: 'answer', qi: m.qi, choice }); }, dMin + Math.random() * (dMax - dMin));
          break;
        }
        case 'answered': if (st.sentAt) { M.ackMs.push(Date.now() - st.sentAt); st.sentAt = 0; } break;
        case 'R': M.results++; if (m.qi != null) ((M.resArrive ||= {})[m.qi] ||= []).push(Date.now()); break;
        case 'showboard': M.boards++; break;
        case 'end': M.ends++; break;
        case 'error': M.errors['host: ' + m.msg] = (M.errors['host: ' + m.msg] || 0) + 1; break;
        case '_close': M.closed++; break;
      }
    };
    c.on('message', (t, b) => {
      let pk; try { pk = JSON.parse(b.toString() || 'null'); } catch { return; }
      if (t === base + 'room') { if (pk?.open && !started) { started = true; join(); } return; }
      if (t === priv) return handle(pk);
      if (t === base + 'all' && pk?.t === '_all') handle(pk.m);
    });
  });
}

const stat = a => {
  if (!a.length) return 'n=0';
  const s = [...a].sort((x, y) => x - y), q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `n=${s.length} p50=${q(.5)}ms p95=${q(.95)}ms max=${s[s.length - 1]}ms`;
};

module.exports = { bot, newMetrics, stat };
