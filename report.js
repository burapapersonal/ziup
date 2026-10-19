'use strict';
/* Session records and reports.
   The host browser is the only place that sees every answer, so it keeps the session record in
   localStorage (no server/database needed) and builds reports from it: a standalone printable HTML
   page (save as PDF from the browser) and an Excel-friendly CSV. */
const Report = (() => {
  const LET = ['A', 'B', 'C', 'D'];
  const KEY = 'ziup-sessions';
  const MAX_KEEP = 40;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = ts => ts ? new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const pct = x => Math.round(x * 100) + '%';
  const sec = x => x == null ? '—' : x.toFixed(1) + ' วิ';

  /* ---------- names: one person = one normalized full name ---------- */
  const TITLES = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i;
  const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim();
  const normName = s => cleanName(s).replace(TITLES, '').toLocaleLowerCase('th').replace(/\s+/g, ' ');
  // Roster lives in this browser so it survives between sessions; host and monitor share it.
  const ROSTER_KEY = 'ziup-roster';
  function loadRoster() {
    try { const r = JSON.parse(localStorage.getItem(ROSTER_KEY) || 'null'); if (r && Array.isArray(r.names)) return { only: !!r.only, names: r.names }; } catch { /* ignore */ }
    return { only: false, names: [] };
  }
  function saveRoster(r) { try { localStorage.setItem(ROSTER_KEY, JSON.stringify({ only: !!r.only, names: r.names })); } catch { /* ignore */ } }

  /* ---------- storage ---------- */
  function list() {
    try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  function save(sess) {
    try {
      const all = list().filter(x => x.id !== sess.id);
      all.unshift(sess);
      localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX_KEEP)));
    } catch { /* storage full or blocked: report can still be downloaded live */ }
  }
  function get(id) { return list().find(x => x.id === id) || null; }
  function remove(id) { try { localStorage.setItem(KEY, JSON.stringify(list().filter(x => x.id !== id))); } catch { /* ignore */ } }

  /* ---------- analysis ---------- */
  function analyse(s) {
    const n = Math.min(s.played ?? 0, s.questions.length);
    const players = (s.players || []).map(p => {
      const h = p.hist || [];
      let correct = 0, answered = 0, tsum = 0;
      for (let i = 0; i < n; i++) {
        const x = h[i];
        if (x && x.c != null) { answered++; tsum += x.t || 0; if (x.ok) correct++; }
      }
      return { ...p, correct, answered, avgT: answered ? tsum / answered : null, pct: n ? correct / n : 0 };
    }).sort((a, b) => b.score - a.score || b.correct - a.correct || String(a.full).localeCompare(String(b.full), 'th'));
    players.forEach((p, i) => { p.rank = i + 1; });
    const qs = s.questions.slice(0, n).map((q, i) => {
      const counts = [0, 0, 0, 0]; let ok = 0, ans = 0, tsum = 0;
      for (const p of players) {
        const x = p.hist?.[i];
        if (x && x.c != null) { counts[x.c]++; ans++; tsum += x.t || 0; if (x.ok) ok++; }
      }
      return { ...q, i, counts, ok, ans, pct: players.length ? ok / players.length : 0, avgT: ans ? tsum / ans : null };
    });
    const avgPct = players.length ? players.reduce((a, p) => a + p.pct, 0) / players.length : 0;
    const avgScore = players.length ? Math.round(players.reduce((a, p) => a + p.score, 0) / players.length) : 0;
    const hardest = qs.length ? qs.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;
    const easiest = qs.length ? qs.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    const dist = Array(n + 1).fill(0);
    players.forEach(p => dist[p.correct]++);
    const pass = players.filter(p => p.pct >= (s.passPct ?? 0.6)).length;
    return { n, players, qs, avgPct, avgScore, hardest, easiest, dist, pass };
  }

  const tone = p => (p >= 0.7 ? 'good' : p >= 0.4 ? 'mid' : 'bad');

  /* ---------- HTML report ---------- */
  function html(s) {
    const A = analyse(s);
    const passPct = s.passPct ?? 0.6;
    const distMax = Math.max(1, ...A.dist);
    const dur = s.endedAt && s.startedAt ? Math.round((s.endedAt - s.startedAt) / 60000) + ' นาที' : 'ยังไม่จบเกม';
    const qHead = A.qs.map(q => `<th class="qc" title="${esc(q.text)}">${q.i + 1}</th>`).join('');
    const cell = (p, i) => {
      const x = p.hist?.[i];
      if (!x || x.c == null) return `<td class="qc na" title="ไม่ได้ตอบ">–</td>`;
      const tip = `ตอบ ${LET[x.c]} · ${sec(x.t)} · ${x.pts || 0} คะแนน`;
      return `<td class="qc ${x.ok ? 'ok' : 'no'}" title="${esc(tip)}">${x.ok ? '✓' : '✗'}</td>`;
    };

    return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>รายงานผล · ${esc(s.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Prompt:wght@500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --navy:#14233B; --orange:#A94A14; --slate:#46546A; --bg:#F5F3EE; --card:#FCFBF8; --line:#E2DDD3; --peach:#FBEFD9;
          --good:#1f7a3d; --good-bg:#dff3e5; --mid:#8a5a00; --mid-bg:#fbefd2; --bad:#b4232c; --bad-bg:#fbe1e3; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--navy); font: 14px/1.5 'IBM Plex Sans Thai', system-ui, sans-serif; }
  .page { max-width: 1180px; margin: 0 auto; padding: 36px 28px 60px; }
  h1, h2, .k b, .num { font-family: 'Prompt', 'IBM Plex Sans Thai', sans-serif; }
  .kicker { color: var(--orange); font: 600 13px 'Prompt', sans-serif; letter-spacing: 3px; text-transform: uppercase; }
  h1 { font-size: 32px; margin: 6px 0 6px; line-height: 1.25; }
  .meta { color: var(--slate); display: flex; flex-wrap: wrap; gap: 6px 22px; }
  .meta b { color: var(--navy); font-weight: 600; }
  .toolbar { display: flex; gap: 10px; margin: 18px 0 4px; flex-wrap: wrap; }
  .toolbar button { font: 600 14px 'Prompt', sans-serif; border: 0; border-radius: 10px; padding: 10px 18px; cursor: pointer; background: var(--navy); color: #fff; }
  .toolbar button.alt { background: #fff; color: var(--navy); box-shadow: inset 0 0 0 1px var(--line); }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin: 26px 0; }
  .k { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px 18px; }
  .k span { color: var(--slate); font-size: 13px; }
  .k b { display: block; font-size: 30px; line-height: 1.2; margin-top: 4px; }
  .k small { color: var(--slate); }
  .k.hero { background: var(--navy); color: #fff; border-color: var(--navy); }
  .k.hero span, .k.hero small { color: #e8dccb; }
  section { margin-top: 30px; }
  h2 { font-size: 20px; margin: 0 0 12px; display: flex; align-items: baseline; gap: 10px; }
  h2 small { font: 400 13px 'IBM Plex Sans Thai', sans-serif; color: var(--slate); }
  .panel { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 6px 0; overflow: hidden; }
  .qrow { display: grid; grid-template-columns: 44px minmax(0, 1fr) 210px 180px 70px; gap: 16px; align-items: center; padding: 12px 18px; border-bottom: 1px solid var(--line); }
  .qrow:last-child { border-bottom: 0; }
  .qrow .num { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--peach); color: var(--orange); font-weight: 700; }
  .qrow .qt { font-weight: 600; }
  .qrow .qa { color: var(--slate); font-size: 13px; margin-top: 2px; }
  .qrow .qa b { color: var(--good); font-weight: 600; }
  .bar { height: 12px; border-radius: 6px; background: #ece7dd; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 6px; }
  .bar.good i { background: var(--good); } .bar.mid i { background: #d39b1c; } .bar.bad i { background: var(--bad); }
  .pc { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
  .pc b { font-family: 'Prompt', sans-serif; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .chips span { font-size: 12px; padding: 2px 7px; border-radius: 6px; background: #ece7dd; color: var(--slate); }
  .chips span.right { background: var(--good-bg); color: var(--good); font-weight: 600; }
  .tm { text-align: right; color: var(--slate); font-size: 13px; }
  .dist { display: flex; align-items: flex-end; gap: 8px; height: 150px; padding: 16px 18px 0; }
  .dist div { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 4px; font-size: 12px; color: var(--slate); }
  .dist i { width: 100%; max-width: 54px; border-radius: 6px 6px 0 0; background: var(--navy); min-height: 3px; }
  .dist .pass i { background: var(--good); }
  .dist b { font-family: 'Prompt'; color: var(--navy); }
  .dist-x { display: flex; gap: 8px; padding: 6px 18px 14px; font-size: 12px; color: var(--slate); }
  .dist-x span { flex: 1; text-align: center; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 9px 10px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: middle; }
  thead th { font: 600 12px 'Prompt', sans-serif; color: var(--slate); background: #f1ede5; position: sticky; top: 0; }
  td.rk { font-family: 'Prompt'; font-weight: 700; width: 40px; text-align: center; }
  tr.top1 td.rk { color: #b07d00; } tr.top2 td.rk { color: #6b7488; } tr.top3 td.rk { color: #9a4f18; }
  td.nm b { display: block; } td.nm small { color: var(--slate); }
  td.r, th.r { text-align: right; white-space: nowrap; }
  .qc { width: 30px; padding: 6px 2px; text-align: center; font-weight: 700; }
  td.qc.ok { background: var(--good-bg); color: var(--good); }
  td.qc.no { background: var(--bad-bg); color: var(--bad); }
  td.qc.na { color: #b3ad9f; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill.good { background: var(--good-bg); color: var(--good); } .pill.mid { background: var(--mid-bg); color: var(--mid); } .pill.bad { background: var(--bad-bg); color: var(--bad); }
  .tblwrap { overflow-x: auto; }
  .legend { display: flex; gap: 16px; color: var(--slate); font-size: 12px; margin-top: 10px; flex-wrap: wrap; }
  .legend i { display: inline-block; width: 14px; height: 14px; border-radius: 4px; vertical-align: -2px; margin-right: 5px; }
  footer { margin-top: 36px; color: var(--slate); font-size: 12px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  .empty { padding: 26px; text-align: center; color: var(--slate); }
  @media (max-width: 760px) { .qrow { grid-template-columns: 40px minmax(0, 1fr); } .qrow > :nth-child(n+3) { grid-column: 2; } }
  @page { size: A4 landscape; margin: 12mm; }
  @media print {
    body { background: #fff; font-size: 11.5px; }
    .page { max-width: none; padding: 0; }
    .toolbar { display: none; }
    .k, .panel { break-inside: avoid; }
    tr { break-inside: avoid; }
    thead th { position: static; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head>
<body><div class="page">
  <div class="kicker">รายงานผลแบบทดสอบ</div>
  <h1>${esc(s.title)}</h1>
  <div class="meta">
    <span>วันที่ <b>${esc(fmtDate(s.startedAt))}</b></span>
    <span>ระยะเวลา <b>${esc(dur)}</b></span>
    <span>จำนวนข้อ <b>${A.n}${A.n < s.questions.length ? ` จาก ${s.questions.length}` : ''}</b></span>
    <span>ห้อง <b>${esc(s.pin || '—')}</b></span>
  </div>
  <div class="toolbar">
    <button onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button>
    <button class="alt" onclick="(function(){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([document.getElementById('csvdata').value],{type:'text/csv;charset=utf-8'}));a.download=${esc(JSON.stringify(fileBase(s) + '.csv'))};a.click();})()">ดาวน์โหลด Excel (CSV)</button>
  </div>

  <div class="kpis">
    <div class="k hero"><span>ผู้เข้าร่วม</span><b>${A.players.length} คน</b><small>ทำครบทุกข้อ ${A.players.filter(p => p.answered === A.n).length} คน</small></div>
    <div class="k"><span>ตอบถูกเฉลี่ย</span><b>${pct(A.avgPct)}</b><small>เฉลี่ย ${(A.avgPct * A.n).toFixed(1)} จาก ${A.n} ข้อ</small></div>
    <div class="k"><span>ผ่านเกณฑ์ ${pct(passPct)}</span><b>${A.pass} คน</b><small>${A.players.length ? pct(A.pass / A.players.length) : '0%'} ของผู้เข้าร่วม</small></div>
    <div class="k"><span>คะแนนเฉลี่ย</span><b>${A.avgScore.toLocaleString()}</b><small>สูงสุด ${(A.players[0]?.score || 0).toLocaleString()}</small></div>
    <div class="k"><span>ข้อที่ตอบผิดมากที่สุด</span><b>${A.hardest ? 'ข้อ ' + (A.hardest.i + 1) : '—'}</b><small>${A.hardest ? 'ถูกเพียง ' + pct(A.hardest.pct) : ''}</small></div>
  </div>

  <section>
    <h2>ผลรายข้อ <small>เรียงตามลำดับคำถาม · แถบสีเขียว ≥70% · เหลือง 40–69% · แดง &lt;40%</small></h2>
    <div class="panel">
      ${A.qs.length ? A.qs.map(q => `
      <div class="qrow">
        <div class="num">${q.i + 1}</div>
        <div><div class="qt">${esc(q.text)}</div><div class="qa">คำตอบที่ถูก: <b>${LET[q.correct]}. ${esc(q.options[q.correct])}</b></div></div>
        <div><div class="pc"><span>ตอบถูก</span><b>${q.ok}/${A.players.length} · ${pct(q.pct)}</b></div><div class="bar ${tone(q.pct)}"><i style="width:${(q.pct * 100).toFixed(1)}%"></i></div></div>
        <div class="chips">${q.options.map((o, i) => o.trim() ? `<span class="${i === q.correct ? 'right' : ''}" title="${esc(o)}">${LET[i]} ${q.counts[i]}</span>` : '').join('')}<span title="ไม่ได้ตอบ">– ${A.players.length - q.ans}</span></div>
        <div class="tm">เฉลี่ย<br>${sec(q.avgT)}</div>
      </div>`).join('') : '<div class="empty">ยังไม่มีข้อที่เล่นจบ</div>'}
    </div>
  </section>

  <section>
    <h2>การกระจายจำนวนข้อที่ตอบถูก <small>สีเขียว = ผ่านเกณฑ์</small></h2>
    <div class="panel">
      <div class="dist">${A.dist.map((c, k) => `<div class="${A.n && k / A.n >= passPct ? 'pass' : ''}"><b>${c}</b><i style="height:${(c / distMax * 100).toFixed(1)}%"></i></div>`).join('')}</div>
      <div class="dist-x">${A.dist.map((_, k) => `<span>${k}</span>`).join('')}</div>
    </div>
  </section>

  <section>
    <h2>ผลรายบุคคล <small>${A.players.length} คน · เรียงตามคะแนน</small></h2>
    <div class="panel tblwrap">
      ${A.players.length ? `<table>
        <thead><tr><th>#</th><th>ชื่อ-นามสกุล</th><th>หน่วยงาน</th><th class="r">คะแนน</th><th class="r">ถูก</th><th>ผล</th><th class="r">เวลาเฉลี่ย</th>${qHead}</tr></thead>
        <tbody>${A.players.map(p => `
          <tr class="top${p.rank}">
            <td class="rk">${p.rank}</td>
            <td class="nm"><b>${esc(p.full)}</b><small>${esc(p.nick || '')}${p.kicked ? ' · ถูกนำออก' : ''}</small></td>
            <td>${esc(p.dept || '—')}</td>
            <td class="r"><b>${(p.score || 0).toLocaleString()}</b></td>
            <td class="r">${p.correct}/${A.n}</td>
            <td><span class="pill ${tone(p.pct)}">${pct(p.pct)}</span></td>
            <td class="r">${sec(p.avgT)}</td>
            ${A.qs.map(q => cell(p, q.i)).join('')}
          </tr>`).join('')}
        </tbody></table>` : '<div class="empty">ไม่มีผู้เข้าร่วม</div>'}
    </div>
    <div class="legend"><span><i style="background:var(--good-bg)"></i>ตอบถูก</span><span><i style="background:var(--bad-bg)"></i>ตอบผิด</span><span><i style="background:#ece7dd"></i>ไม่ได้ตอบ / เข้าห้องหลังข้อนั้น</span><span>ชี้ที่ช่องเพื่อดูตัวเลือกที่ตอบและเวลา</span></div>
  </section>

  <footer><span>สร้างจาก ZIUP Live Quiz</span><span>สร้างรายงานเมื่อ ${esc(fmtDate(Date.now()))}</span></footer>
</div>
<textarea id="csvdata" hidden>${esc(csv(s))}</textarea>
</body></html>`;
  }

  /* ---------- CSV (Excel opens UTF-8 with BOM) ---------- */
  function csv(s) {
    const A = analyse(s);
    const head = ['อันดับ', 'ชื่อ-นามสกุล', 'ชื่อเล่น', 'หน่วยงาน', 'คะแนน', 'ตอบถูก', 'จำนวนข้อ', 'ร้อยละ', 'เวลาเฉลี่ย (วินาที)', 'สถานะ'];
    A.qs.forEach(q => head.push(`ข้อ ${q.i + 1} ผล`, `ข้อ ${q.i + 1} ตอบ`, `ข้อ ${q.i + 1} วินาที`));
    const rows = [head];
    for (const p of A.players) {
      const r = [p.rank, p.full, p.nick || '', p.dept || '', p.score || 0, p.correct, A.n, Math.round(p.pct * 100), p.avgT == null ? '' : p.avgT.toFixed(1), p.kicked ? 'ถูกนำออก' : ''];
      A.qs.forEach(q => {
        const x = p.hist?.[q.i];
        if (!x || x.c == null) r.push('ไม่ได้ตอบ', '', '');
        else r.push(x.ok ? 'ถูก' : 'ผิด', `${LET[x.c]}. ${q.options[x.c]}`, (x.t || 0).toFixed(1));
      });
      rows.push(r);
    }
    return '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  }

  function fileBase(s) {
    const d = new Date(s.startedAt || Date.now());
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `ziup-${ds}-${String(s.title || 'quiz').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40)}`;
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  return {
    list, save, get, remove, analyse, html, csv, cleanName, normName, loadRoster, saveRoster,
    open(s) { const w = window.open(URL.createObjectURL(new Blob([html(s)], { type: 'text/html' })), '_blank'); if (!w) download(fileBase(s) + '.html', html(s), 'text/html'); },
    downloadHtml(s) { download(fileBase(s) + '.html', html(s), 'text/html;charset=utf-8'); },
    downloadCsv(s) { download(fileBase(s) + '.csv', csv(s), 'text/csv;charset=utf-8'); }
  };
})();
