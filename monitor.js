'use strict';
/* PM monitor: manage a live session from any device. Logs in with Game PIN + PM passcode; everything to
   and from the host is sealed with a key derived from that passcode (Net.Seal), so other people on the
   public broker can neither read the player list nor send commands. Session data is also kept in this
   browser, so the PM can export reports after the host closes the room. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PHASE = { connecting: 'กำลังเปิดห้อง', lobby: 'รอผู้เล่น', ready: 'เตรียมคำถาม', question: 'กำลังตอบ', reveal: 'เฉลย', scoreboard: 'กระดานคะแนน', podium: 'จบเกม' };
  let S = null, net = null, conn = null, key = null, authed = false, toastT = 0, lastState = 0;

  const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); };
  const send = obj => { if (conn?.open && key) Net.Seal.seal(key, obj).then(pkt => conn.send(pkt), () => {}); };
  const cmd = (c, extra = {}) => send({ type: 'cmd', cmd: c, ...extra });

  /* ---------- login ---------- */
  const qpin = new URLSearchParams(location.search).get('pin');
  if (/^\d{6}$/.test(qpin || '')) $('#lpin').value = qpin;
  try { const saved = JSON.parse(sessionStorage.getItem('ziup-pm') || 'null'); if (saved) { $('#lpin').value ||= saved.pin; $('#lcode').value = saved.code; } } catch { /* ignore */ }
  ($('#lpin').value ? $('#lcode') : $('#lpin')).focus();

  const msg = (t, info) => { const m = $('#lmsg'); m.textContent = t; m.classList.toggle('info', !!info); };

  async function login(pin, code) {
    $('#lgo').disabled = true;
    msg('กำลังเชื่อมต่อห้อง…', true);
    try { net?.destroy(); } catch { /* ignore */ }
    net = new Net.Player();
    try {
      [conn, key] = await Promise.all([net.join(pin), Net.Seal.key(code, pin)]);
    } catch { conn = null; }
    if (!conn) { $('#lgo').disabled = false; return msg('ไม่พบห้อง PIN นี้ หรือเชื่อมต่อไม่ได้'); }
    authed = false;
    conn.on('data', onData);
    conn.on('close', () => { if (authed) { authed = false; S = null; render(); } });
    conn.on('reconnect', () => send({ type: 'hello' }));
    msg('กำลังตรวจสอบ passcode…', true);
    send({ type: 'hello' });
    setTimeout(() => { if (!authed && conn) { $('#lgo').disabled = false; msg('ผู้จัดไม่ตอบกลับ ลองใหม่อีกครั้ง'); } }, 15000);
    try { sessionStorage.setItem('ziup-pm', JSON.stringify({ pin, code })); } catch { /* ignore */ }
  }

  $('#login').addEventListener('submit', e => {
    e.preventDefault();
    const pin = $('#lpin').value.replace(/\D/g, ''), code = $('#lcode').value.trim();
    if (pin.length !== 6) return msg('Game PIN ต้องเป็นตัวเลข 6 หลัก');
    if (code.length < 6) return msg('passcode ยาวอย่างน้อย 6 ตัว');
    login(pin, code);
  });
  $('#relog').onclick = e => { e.preventDefault(); $('#nohost').hidden = true; $('#login').hidden = false; $('#lgo').disabled = false; msg(''); };

  let lastSaved = '', lastSaveAt = 0;
  async function onData(m) {
    if (m?.t === 'adm-denied') {
      $('#lgo').disabled = m.left <= 0;
      return msg(m.left > 0 ? `passcode ไม่ถูกต้อง (เหลือ ${m.left} ครั้ง)` : 'ใส่ passcode ผิดเกินกำหนด รีเฟรชหน้าแล้วลองใหม่');
    }
    if (m?.t !== 'adm') return;
    let d; try { d = await Net.Seal.open(key, m); } catch { return; }
    if (!authed) {
      authed = true;
      $('#login').hidden = true; $('#lgo').disabled = false; msg('');
      toast('เชื่อมต่อห้องแล้ว');
      cmd('history');
    }
    if (d.type === 'state') {
      S = d.state; lastState = Date.now();
      if (S) {
        // The host sends each player once; the session record is rebuilt from that list.
        S.joinedKeys = S.players.map(p => p.key);
        S.session = { ...S.session, players: [...S.players.map(p => ({ key: p.key, full: p.full, nick: p.nick, dept: p.dept, score: p.score, hist: p.hist, joinedAt: p.joinedAt, kicked: false })), ...(S.removed || [])] };
      }
      // Saving a two-thousand-player record on every update would stall the page: save when a
      // question ends or the game ends, and otherwise at most every 15 s.
      const mark = S?.session ? `${S.session.id}:${S.session.played}:${S.session.endedAt}` : '';
      if (S?.session?.startedAt && (mark !== lastSaved || Date.now() - lastSaveAt > 15000)) { Report.save(S.session); lastSaved = mark; lastSaveAt = Date.now(); }
      if (!S) toast('ผู้จัดปิดห้องแล้ว');
      render();
    } else if (d.type === 'history') {
      const have = new Set(Report.list().map(x => x.id));
      for (const x of d.list || []) if (!have.has(x.id)) cmd('getSession', { id: x.id });
    } else if (d.type === 'session' && d.s) {
      Report.save(d.s); renderHistory();
    }
  }
  setInterval(() => { if (authed) send({ type: 'hello' }); }, 10000);

  /* ---------- render ---------- */
  function render() {
    const live = authed && !!S;
    $('#dash').hidden = !live;
    $('#offHist').hidden = live;
    $('#nohost').hidden = live || !$('#login').hidden || !lastState;
    if (!live && $('#login').hidden && !lastState) $('#login').hidden = false;
    $('#ttl').textContent = live ? S.title : 'หน้า PM';
    $('#pin').hidden = !live; $('#phase').hidden = !live;
    if (live) { $('#pin').textContent = 'PIN ' + S.pin; $('#phase').textContent = PHASE[S.phase] || S.phase; }
    const adv = $('#advance'), skip = $('#skip');
    adv.disabled = !live || !['lobby', 'reveal', 'scoreboard', 'question'].includes(S.phase);
    adv.textContent = !live ? 'เริ่มเกม' : S.phase === 'lobby' ? 'เริ่มเกม' : S.phase === 'question' ? 'จบข้อนี้' : S.phase === 'scoreboard' && S.qi === S.total - 1 ? 'ประกาศผล' : 'ถัดไป';
    skip.disabled = !live || S.phase !== 'question';
    ['#rpOpen', '#rpCsv', '#rpHtml'].forEach(id => { $(id).disabled = !live; });
    renderHistory();
    if (!live) return;
    renderKpis(); renderPlayers(); renderPending(); renderRoster(); renderKicked();
  }

  function renderKpis() {
    const pl = S.players, online = pl.filter(p => p.connected).length;
    const inQ = S.phase === 'question';
    const rosterKeys = new Set(S.roster.names.map(Report.normName));
    const joined = new Set(S.joinedKeys);
    const notIn = S.roster.names.length ? [...rosterKeys].filter(k => !joined.has(k)).length : null;
    $('#kpis').innerHTML = `
      <div class="k"><span>ออนไลน์ / ทั้งหมด</span><b>${online} / ${pl.length}</b></div>
      <div class="k"><span>ข้อปัจจุบัน</span><b>${S.qi >= 0 ? S.qi + 1 : 0} / ${S.total}</b></div>
      <div class="k"><span>${inQ ? 'ตอบข้อนี้แล้ว' : 'ตอบถูกเฉลี่ย'}</span><b>${inQ ? `${pl.filter(p => p.answeredNow).length} / ${online}` : (S.played ? Math.round(pl.reduce((a, p) => a + p.correct, 0) / Math.max(1, pl.length * S.played) * 100) + '%' : '—')}</b></div>
      <div class="k ${S.pending.length ? 'alert' : ''}"><span>รออนุมัติ</span><b>${S.pending.length}</b></div>
      <div class="k"><span>ยังไม่เข้าจากรายชื่อ</span><b>${notIn ?? '—'}</b></div>`;
  }

  function renderPlayers() {
    const box = $('#players');
    const pl = S.players;
    $('#pcount').textContent = pl.length;
    $('#psub').textContent = `ออนไลน์ ${pl.filter(p => p.connected).length} คน`;
    const q = $('#q').value.trim().toLocaleLowerCase('th');
    const rows = pl.filter(p => !q || [p.full, p.nick, p.dept].join(' ').toLocaleLowerCase('th').includes(q));
    if (!rows.length) { box.innerHTML = `<div class="empty">${pl.length ? 'ไม่พบชื่อที่ค้นหา' : 'ยังไม่มีผู้เล่น'}</div>`; return; }
    const played = S.played;
    const CAP = 300;
    const more = rows.length - CAP;
    box.innerHTML = `${more > 0 ? `<div class="empty">แสดง ${CAP} คนแรกตามอันดับ จาก ${rows.length.toLocaleString()} · พิมพ์ชื่อในช่องค้นหาเพื่อหาคนอื่น</div>` : ''}<table>
      <thead><tr><th>#</th><th></th><th>ชื่อ-นามสกุล</th><th>หน่วยงาน</th><th>ข้อนี้</th><th class="r">ถูก</th><th class="r">คะแนน</th><th>รายข้อ</th><th></th></tr></thead>
      <tbody>${rows.slice(0, CAP).map(p => `
        <tr class="${p.connected ? '' : 'off'}">
          <td class="rk">${p.rank}</td>
          <td><span class="dot ${p.connected ? '' : 'off'}" title="${p.connected ? 'ออนไลน์' : 'หลุดการเชื่อมต่อ'}"></span></td>
          <td class="nm"><b>${esc(p.full)}</b><small>${esc(p.nick)}</small></td>
          <td>${esc(p.dept || '—')}</td>
          <td>${S.phase === 'question' ? `<span class="ans ${p.answeredNow ? 'yes' : ''}">${p.answeredNow ? 'ตอบแล้ว' : 'รอ…'}</span>` : '—'}</td>
          <td class="r">${p.correct}/${played}</td>
          <td class="r"><b>${p.score.toLocaleString()}</b></td>
          <td><div class="dots">${Array.from({ length: played }, (_, i) => { const x = p.hist[i]; return `<i class="${x && x.c != null ? (x.ok ? 'ok' : 'no') : ''}" title="ข้อ ${i + 1}"></i>`; }).join('')}</div></td>
          <td><button class="btn sm warn" data-kick="${esc(p.key)}">เตะออก</button></td>
        </tr>`).join('')}</tbody></table>`;
  }

  function renderPending() {
    const pend = S.pending;
    $('#pendN').textContent = pend.length;
    $('#pending').innerHTML = pend.length ? pend.map(p => `
      <div class="li"><div class="grow"><b>${esc(p.full)}</b><small>${esc(p.nick)}${p.dept ? ' · ' + esc(p.dept) : ''}</small></div>
        <button class="btn sm go" data-approve="${esc(p.key)}">อนุมัติ</button>
        <button class="btn sm warn" data-reject="${esc(p.key)}">ปฏิเสธ</button></div>`).join('') : '<div class="empty">ไม่มีคนรอ</div>';
  }

  function renderRoster() {
    const r = S.roster;
    if (document.activeElement !== $('#rosOnly')) $('#rosOnly').checked = r.only;
    $('#rosN').textContent = r.names.length;
    const joined = new Set(S.joinedKeys);
    const missing = r.names.filter(n => !joined.has(Report.normName(n))).length;
    $('#rosSub').textContent = r.names.length ? `เข้าแล้ว ${r.names.length - missing} · ยังไม่เข้า ${missing}` : '';
    const sorted = [...r.names].sort((a, b) => (joined.has(Report.normName(a)) - joined.has(Report.normName(b))) || a.localeCompare(b, 'th'));
    const RCAP = 400;
    $('#roster').innerHTML = r.names.length ? (sorted.length > RCAP ? `<div class="empty">แสดง ${RCAP} จาก ${sorted.length.toLocaleString()} รายชื่อ (คนที่ยังไม่เข้าก่อน)</div>` : '') + sorted.slice(0, RCAP).map(n => {
      const inn = joined.has(Report.normName(n));
      return `<div class="li"><div class="grow">${esc(n)}</div><span class="tag ${inn ? 'in' : 'out'}">${inn ? 'เข้าแล้ว' : 'ยังไม่เข้า'}</span><button class="btn sm" data-unroster="${esc(n)}" title="ลบจากรายชื่อ">✕</button></div>`;
    }).join('') : '<div class="empty">ยังไม่มีรายชื่อ ใครมีชื่อ-นามสกุลก็เข้าได้</div>';
  }

  function renderKicked() {
    const k = S.kicked;
    $('#kickN').textContent = k.length;
    $('#kicked').innerHTML = k.length ? k.map(p => `<div class="li"><div class="grow"><b>${esc(p.full)}</b><small>${esc(p.nick)}</small></div><button class="btn sm" data-unkick="${esc(p.key)}">ให้กลับเข้าได้</button></div>`).join('') : '<div class="empty">ไม่มี</div>';
  }

  function renderHistory() {
    const all = Report.list();
    const html = all.length ? all.map(s => {
      const A = Report.analyse(s);
      const d = new Date(s.startedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
      return `<div class="li"><div class="grow"><b>${esc(s.title)}</b><small>${esc(d)} · ${A.players.length} คน · ${A.n} ข้อ · ถูกเฉลี่ย ${Math.round(A.avgPct * 100)}%${s.endedAt ? '' : ' · ยังไม่จบ'}</small></div>
        <button class="btn sm dark" data-hopen="${esc(s.id)}">รายงาน</button>
        <button class="btn sm" data-hcsv="${esc(s.id)}">CSV</button>
        <button class="btn sm warn" data-hdel="${esc(s.id)}" title="ลบจากเครื่องนี้">✕</button></div>`;
    }).join('') : '<div class="empty">ยังไม่มีรายงานในเครื่องนี้</div>';
    $('#history').innerHTML = html; $('#history2').innerHTML = html;
  }

  /* ---------- actions ---------- */
  const setRoster = r => { if (!S) return toast('ต้องเชื่อมต่อห้องก่อน'); cmd('roster', { roster: r }); };
  $('#advance').onclick = () => cmd('advance');
  $('#skip').onclick = () => cmd('skip');
  $('#q').oninput = () => S && renderPlayers();
  $('#rpOpen').onclick = () => S && Report.open(S.session);
  $('#rpCsv').onclick = () => S && Report.downloadCsv(S.session);
  $('#rpHtml').onclick = () => S && Report.downloadHtml(S.session);
  $('#rosOnly').onchange = e => { setRoster({ ...S.roster, only: e.target.checked }); toast(e.target.checked ? 'เปิดโหมดอนุญาตเฉพาะรายชื่อ' : 'ปิดโหมดเฉพาะรายชื่อ ใครก็เข้าได้'); };
  $('#rosAdd').onclick = () => {
    if (!S) return;
    const add = $('#rosText').value.split(/\r?\n/).map(Report.cleanName).filter(n => n.split(' ').length >= 2);
    if (!add.length) return toast('ใส่ชื่อ-นามสกุล บรรทัดละ 1 คน');
    const have = new Set(S.roster.names.map(Report.normName));
    const fresh = add.filter(n => { const k = Report.normName(n); if (have.has(k)) return false; have.add(k); return true; });
    setRoster({ ...S.roster, names: [...S.roster.names, ...fresh] });
    $('#rosText').value = '';
    toast(`เพิ่ม ${fresh.length} รายชื่อ${add.length > fresh.length ? ` (ซ้ำ ${add.length - fresh.length})` : ''}`);
  };
  $('#rosClear').onclick = () => { if (S && confirm('ล้างรายชื่อทั้งหมด?')) setRoster({ ...S.roster, names: [] }); };

  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.kick) { const p = S?.players.find(x => x.key === d.kick); if (p && confirm(`นำ "${p.full}" ออกจากห้อง? เขาจะกลับเข้ามาไม่ได้จนกว่าคุณจะอนุญาต`)) cmd('kick', { key: d.kick }); }
    else if (d.approve) cmd('approve', { key: d.approve });
    else if (d.reject) cmd('reject', { key: d.reject });
    else if (d.unkick) cmd('unkick', { key: d.unkick });
    else if (d.unroster) setRoster({ ...S.roster, names: S.roster.names.filter(n => n !== d.unroster) });
    else if (d.hopen) { const s = Report.get(d.hopen); if (s) Report.open(s); }
    else if (d.hcsv) { const s = Report.get(d.hcsv); if (s) Report.downloadCsv(s); }
    else if (d.hdel) { if (confirm('ลบรายงานนี้ออกจากเครื่องนี้?')) { Report.remove(d.hdel); renderHistory(); } }
  });

  render();
})();
