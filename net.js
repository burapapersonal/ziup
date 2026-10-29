'use strict';
/* Realtime transport over MQTT (WebSocket/TLS).
   Host and players both connect *out* to a broker, so different networks, 4G and NAT don't matter.
   The host stays the game server. Objects mimic the small part of PeerJS the app used:
   host emits 'connection' with Conn objects; Conn has .peer, .open, .send(), .close(), on('data'|'close').

   Two networks:
   - 'o' (default): our own broker on ORCA. The host logs in (ziuphost + host password); players are
     anonymous and the broker's ACL holds each one to its own inbox h/<id> and private channel p/<id>,
     so nobody can answer as someone else, read other players, or fake what players see. Scales to
     thousands: no rate limit, so the host sends each player its own message.
   - 'p': public brokers, the fallback (~100 players). They rate-limit each connection, so per-player
     messages are bundled into `_multi` packets on the shared `all` topic. */
const Net = (() => {
  const NETS = {
    o: { urls: ['wss://orca.bcg-ecop.net/ziup-mqtt'], private: true },
    p: { urls: ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'], private: false }
  };
  // Tests point our network at a local broker through this browser's storage; a link cannot.
  try { const u = localStorage.getItem('ziup-broker-o'); if (u) NETS.o.urls = [u]; } catch { /* ignore */ }
  const HOST_USER = 'ziuphost';
  const ROOT = 'ziup/v1/';
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const enc = o => JSON.stringify(o);
  const dec = b => {
    try {
      const s = typeof b === 'string' ? b : new TextDecoder().decode(b);
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  };

  class Emitter {
    constructor() { this.h = {}; }
    on(e, f) { (this.h[e] ||= []).push(f); return this; }
    emit(e, ...a) { for (const f of this.h[e] || []) { try { f(...a); } catch (err) { console.error(err); } } }
  }

  // Resolve with a connected client, or reject after `timeout` (mqtt.js would otherwise retry forever).
  // A refused login rejects at once with 'auth' rather than retrying.
  function connectBroker(url, opts, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const c = mqtt.connect(url, { keepalive: 20, reconnectPeriod: 2000, connectTimeout: timeout, clean: true, ...opts });
      const t = setTimeout(() => { c.end(true); reject(new Error('timeout ' + url)); }, timeout);
      c.once('connect', () => { clearTimeout(t); resolve(c); });
      c.on('error', e => { if (e?.code === 4 || e?.code === 5 || e?.code === 134 || e?.code === 135) { clearTimeout(t); c.end(true); reject(new Error('auth')); } });
    });
  }

  function subscribe(c, topic, qos = 1) {
    return new Promise(res => c.subscribe(topic, { qos }, () => res()));
  }

  // Wait briefly for the retained room flag on this broker.
  function roomIsOpen(c, base, wait) {
    return new Promise(res => {
      let done = false;
      const top = base + 'room';
      const h = (t, b) => { if (t === top) fin(!!dec(b)?.open); };
      const fin = v => { if (done) return; done = true; c.removeListener('message', h); res(v); };
      c.on('message', h);
      c.subscribe(top, { qos: 1 });
      setTimeout(() => fin(false), wait);
    });
  }

  class Conn extends Emitter {
    constructor(client, topic, id, wrap) {
      super();
      this.client = client; this.topic = topic; this.peer = id; this.open = true; this.wrap = wrap;
    }
    send(m) { if (this.open) this.client.publish(this.topic, enc(this.wrap ? this.wrap(m) : m), { qos: 1 }); }
    close() { if (!this.open) return; this.send({ t: '_close' }); this._close(); }
    _close() { if (!this.open) return; this.open = false; this.emit('close'); }
  }

  // Host-side connection. On our broker a send goes straight to the player's private channel;
  // on public brokers it is queued and flushed in batches (see Host.flush).
  class HostConn extends Conn {
    constructor(host, client, id) { super(client, null, id); this.host = host; }
    send(m) {
      if (!this.open) return;
      // QoS 0: thousands of these leave at once, and an acknowledgement for each would double the
      // traffic on the host's link. Delivery still rides the TCP socket to the broker.
      if (this.host.private) this.client.publish(this.host.base + 'p/' + this.peer, enc(m), { qos: 0 });
      else this.host.enqueue(this.client, this.peer, m);
    }
  }

  // Public brokers rate-limit each connection (EMQX drops above ~10 msg/s), so there the host never
  // publishes one message per player. Per-player messages are bundled into one `_multi` packet on
  // the room's `all` topic every FLUSH_MS, and messages for everyone go out once as `_all`.
  const FLUSH_MS = 250;

  class Host extends Emitter {
    constructor(net = 'o') {
      super();
      this.net = NETS[net] ? net : 'o'; this.private = NETS[this.net].private;
      this.clients = []; this.conns = new Map(); this.closed = false; this.queue = new Map(); this.timer = 0;
    }

    enqueue(client, id, m) {
      let q = this.queue.get(client);
      if (!q) this.queue.set(client, q = {});
      (q[id] ||= []).push(m);
      this.timer ||= setTimeout(() => this.flush(), FLUSH_MS);
    }

    flush() {
      clearTimeout(this.timer); this.timer = 0;
      for (const [c, each] of this.queue) c.publish(this.base + 'all', enc({ t: '_multi', each }), { qos: 1 });
      this.queue.clear();
    }

    // Same message for every player: one publish per broker. Pending per-player messages go first to keep order.
    broadcast(m) {
      this.flush();
      for (const c of this.clients) c.publish(this.base + 'all', enc({ t: '_all', m }), { qos: 1 });
    }

    // true = room claimed; false = PIN already in use; throws when no broker is reachable,
    // or Error('auth') when our broker refuses the host password.
    async open(pin, pass) {
      this.base = ROOT + pin + '/';
      const will = { topic: this.base + 'room', payload: enc({ open: false }), qos: 1, retain: true };
      const login = this.private ? { username: HOST_USER, password: pass || '' } : {};
      const res = await Promise.allSettled(NETS[this.net].urls.map(u => connectBroker(u, { clientId: 'zh_' + rid(), will, ...login })));
      this.clients = res.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (!this.clients.length) {
        if (res.some(r => r.reason?.message === 'auth')) throw new Error('auth');
        throw new Error('ต่อเซิร์ฟเวอร์ไม่ได้');
      }
      if (await roomIsOpen(this.clients[0], this.base, 900)) { this.destroy(); return false; }
      for (const c of this.clients) await this.wire(c);
      return true;
    }

    async wire(c) {
      const announce = () => c.publish(this.base + 'room', enc({ open: true, ts: Date.now() }), { qos: 1, retain: true });
      // On our broker each player writes to h/<its id>, and the broker guarantees the id is its own.
      // QoS 0 here: thousands of answers can land at once, and a QoS 1 subscription would make the
      // broker hold them behind its in-flight window; the socket is reliable while it is up.
      const inbox = this.private ? this.base + 'h/+' : this.base + 'h';
      const inQos = this.private ? 0 : 1;
      await subscribe(c, inbox, inQos);
      announce();
      c.on('connect', () => { if (!this.closed) { c.subscribe(inbox, { qos: inQos }); announce(); } });
      c.on('message', (topic, buf) => {
        let from;
        const env = dec(buf);
        if (this.private) {
          if (!topic.startsWith(this.base + 'h/')) return;
          from = topic.slice(this.base.length + 2);
        } else {
          if (topic !== this.base + 'h') return;
          from = env?.from;
        }
        if (!env || typeof from !== 'string' || !from || !env.m) return;
        let conn = this.conns.get(from);
        if (env.m.t === '_bye') { conn?._close(); return; }
        if (!conn || !conn.open) {
          conn = new HostConn(this, c, from);
          this.conns.set(from, conn);
          this.emit('connection', conn);
        }
        conn.client = c; // answer through the broker this player is using
        conn.emit('data', env.m);
      });
    }

    destroy() {
      this.flush();
      this.closed = true;
      for (const c of this.clients) {
        try { c.publish(this.base + 'room', '', { qos: 1, retain: true }); } catch { /* ignore */ }
        setTimeout(() => c.end(true), 400);
      }
    }
  }

  class Player extends Emitter {
    // Resolves with a Conn to the host, or null when no reachable broker has this room.
    // `prefer` is the network named in the join link; a PIN typed by hand tries ours first, then public.
    async join(pin, prefer) {
      const order = prefer === 'p' ? ['p', 'o'] : ['o', 'p'];
      this.dead = false;
      for (const net of order) {
        if (this.dead) return null;
        const conn = await this.joinOn(net, pin);
        if (conn) return conn;
      }
      return null;
    }

    async joinOn(net, pin) {
      const { urls, private: priv } = NETS[net];
      const base = ROOT + pin + '/';
      const id = 'zp_' + rid();
      const inbox = priv ? base + 'h/' + id : base + 'h';
      const wrap = priv ? m => ({ m }) : m => ({ from: id, m });
      // Try every broker at once; keep the first one that has this room open.
      const will = { topic: inbox, payload: enc(wrap({ t: '_bye' })), qos: 1 };
      let c, tries;
      // A busy broker sometimes answers slowly: retry a few rounds before giving up,
      // but stop at once when a broker answered and the room simply isn't there.
      for (let round = 0; round < 3 && !c && !this.dead; round++) {
        tries = urls.map(async url => {
          const cl = await connectBroker(url, { clientId: id, will }, 8000);
          if (await roomIsOpen(cl, base, 3000)) return cl;
          cl.end(false); // graceful: a forced close would fire our will and drop us from the game
          throw new Error('no room');
        });
        try { c = await Promise.any(tries); } catch (agg) {
          if (agg.errors?.some(e => e.message === 'no room')) return null;
        }
      }
      if (!c) return null;
      tries.forEach(t => t.then(o => { if (o !== c) o.end(false); }, () => {}));
      if (this.dead) { c.end(true); return null; }
      this.client = c;
      const conn = new Conn(c, inbox, id, wrap);
      await subscribe(c, base + 'all');
      if (priv) await subscribe(c, base + 'p/' + id);
      const deliver = m => { if (m?.t === '_close') conn._close(); else if (m) conn.emit('data', m); };
      c.on('message', (t, b) => {
        if (t === base + 'all') {
          const pk = dec(b);
          if (pk?.t === '_all') deliver(pk.m);
          else if (pk?.t === '_multi') (pk.each?.[id] || []).forEach(deliver);
        } else if (priv && t === base + 'p/' + id) deliver(dec(b));
        else if (t === base + 'room' && !dec(b)?.open) conn._close();
      });
      c.on('connect', () => conn.emit('reconnect'));
      this.conn = conn; this.base = base; this.id = id; this.inbox = inbox; this.wrap = wrap; this.net = net;
      return conn;
    }

    destroy() {
      this.dead = true;
      const c = this.client;
      if (!c) return;
      try { c.publish(this.inbox, enc(this.wrap({ t: '_bye' })), { qos: 1 }); } catch { /* ignore */ }
      setTimeout(() => c.end(true), 300);
    }
  }

  /* ---------- PM channel encryption ----------
     PM (monitor) traffic crosses a public broker, so it is gzip-compressed and sealed with AES-GCM.
     The key is derived from the PM passcode + room PIN (PBKDF2); the passcode itself is never sent. */
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const pipe = async (u8, Stream) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new Stream('gzip'))).arrayBuffer());
  const Seal = {
    async key(pass, pin) {
      const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new TextEncoder().encode('ziup-pm:' + pin), iterations: 150000, hash: 'SHA-256' },
        raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    },
    async seal(key, obj) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const zipped = await pipe(new TextEncoder().encode(JSON.stringify(obj)), CompressionStream);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, zipped));
      return { t: 'adm', iv: b64(iv), ct: b64(ct) };
    },
    async open(key, pkt) {
      const zipped = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(pkt.iv) }, key, unb64(pkt.ct)));
      return JSON.parse(new TextDecoder().decode(await pipe(zipped, DecompressionStream)));
    }
  };

  return { Host, Player, Seal, NETS };
})();
