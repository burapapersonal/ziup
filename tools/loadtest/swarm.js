// One load-test machine's share of players: N bots join a live room and play until the host ends it.
// usage: node swarm.js <pin> <bots> <tag> [brokerUrl]   — prints one JSON line of metrics at the end.
const { bot, newMetrics, stat } = require('./botlib');
const [pin, n = '100', tag = 'x', url = 'wss://orca.bcg-ecop.net/ziup-mqtt'] = process.argv.slice(2);
const N = +n, M = newMetrics();
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const t0 = Date.now();
  const all = [];
  // spread the joins over ~30 s, like a room scanning a QR code
  for (let i = 0; i < N; i++) { all.push(bot({ url, pin, i, tag, M, giveUpMs: 120000 })); await sleep(30000 / N); }
  await Promise.all(all);
  console.error(`${tag}: ${M.welcome}/${N} joined in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  // play until the host's final message reaches everyone who joined, or 25 minutes
  const stop = Date.now() + 25 * 60000;
  while (Date.now() < stop && M.ends < M.welcome) await sleep(2000);
  await sleep(3000);
  const spread = Object.fromEntries(Object.entries(M.qArrive).map(([q, a]) => [q, { n: a.length, first: Math.min(...a), last: Math.max(...a) }]));
  console.log(JSON.stringify({ tag, n: N, welcome: M.welcome, joinFail: M.joinFail, join: stat(M.joinMs), joinMs: M.joinMs, ackMs: M.ackMs,
    results: M.results, boards: M.boards, ends: M.ends, closed: M.closed, reconnects: M.reconnects, errors: M.errors, qArrive: spread }));
  for (const s of all) (await s).c?.end(true);
  setTimeout(() => process.exit(0), 1000);
})();
