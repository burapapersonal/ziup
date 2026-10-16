'use strict';
/* Realtime transport over public MQTT brokers (WebSocket/TLS).
   Host and players both connect *out* to a broker, so different networks, 4G and NAT don't matter.
   The host stays the game server: it listens on every broker at once, so a player can reach it
   through whichever broker their network allows. Objects mimic the small part of PeerJS the app used:
   host emits 'connection' with Conn objects; Conn has .peer, .open, .send(), .close(), on('data'|'close'). */
const Net = (() => {
  const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
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
  function connectBroker(url, opts, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const c = mqtt.connect(url, { keepalive: 20, reconnectPeriod: 2000, connectTimeout: timeout, clean: true, ...opts });
      const t = setTimeout(() => { c.end(true); reject(new Error('timeout ' + url)); }, timeout);
      c.once('connect', () => { clearTimeout(t); resolve(c); });
    });
  }

  function subscribe(c, topic) {
    return new Promise(res => c.subscribe(topic, { qos: 1 }, () => res()));
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

  class Host extends Emitter {
    constructor() { super(); this.clients = []; this.conns = new Map(); this.closed = false; }

    // true = room claimed; false = PIN already in use; throws when no broker is reachable
    async open(pin) {
      this.base = ROOT + pin + '/';
      const will = { topic: this.base + 'room', payload: enc({ open: false }), qos: 1, retain: true };
      const res = await Promise.allSettled(BROKERS.map(u => connectBroker(u, { clientId: 'zh_' + rid(), will })));
      this.clients = res.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (!this.clients.length) throw new Error('ต่อเซิร์ฟเวอร์ไม่ได้');
      if (await roomIsOpen(this.clients[0], this.base, 900)) { this.destroy(); return false; }
      for (const c of this.clients) await this.wire(c);
      return true;
    }

    async wire(c) {
      const announce = () => c.publish(this.base + 'room', enc({ open: true, ts: Date.now() }), { qos: 1, retain: true });
      await subscribe(c, this.base + 'h');
      announce();
      c.on('connect', () => { if (!this.closed) { c.subscribe(this.base + 'h', { qos: 1 }); announce(); } });
      c.on('message', (topic, buf) => {
        if (topic !== this.base + 'h') return;
        const env = dec(buf);
        if (!env || typeof env.from !== 'string' || !env.m) return;
        let conn = this.conns.get(env.from);
        if (env.m.t === '_bye') { conn?._close(); return; }
        if (!conn || !conn.open) {
          conn = new Conn(c, this.base + 'p/' + env.from, env.from);
          this.conns.set(env.from, conn);
          this.emit('connection', conn);
        }
        conn.client = c; // answer through the broker this player is using
        conn.emit('data', env.m);
      });
    }

    destroy() {
      this.closed = true;
      for (const c of this.clients) {
        try { c.publish(this.base + 'room', '', { qos: 1, retain: true }); } catch { /* ignore */ }
        setTimeout(() => c.end(true), 400);
      }
    }
  }

  class Player extends Emitter {
    // Resolves with a Conn to the host, or null when no reachable broker has this room.
    async join(pin) {
      const base = ROOT + pin + '/';
      const id = 'zp_' + rid();
      this.dead = false;
      // Try every broker at once; keep the first one that has this room open.
      const will = { topic: base + 'h', payload: enc({ from: id, m: { t: '_bye' } }), qos: 1 };
      const tries = BROKERS.map(async url => {
        const c = await connectBroker(url, { clientId: id, will }, 8000);
        if (await roomIsOpen(c, base, 3000)) return c;
        c.end(false); // graceful: a forced close would fire our will and drop us from the game
        throw new Error('no room');
      });
      let c;
      try { c = await Promise.any(tries); } catch { return null; }
      tries.forEach(t => t.then(o => { if (o !== c) o.end(false); }, () => {}));
      if (this.dead) { c.end(true); return null; }
      {
        this.client = c;
        const conn = new Conn(c, base + 'h', id, m => ({ from: id, m }));
        await subscribe(c, base + 'p/' + id);
        c.on('message', (t, b) => {
          if (t === base + 'p/' + id) {
            const m = dec(b);
            if (!m) return;
            if (m.t === '_close') conn._close(); else conn.emit('data', m);
          } else if (t === base + 'room' && !dec(b)?.open) conn._close();
        });
        c.on('connect', () => conn.emit('reconnect'));
        this.conn = conn; this.base = base; this.id = id;
        return conn;
      }
      return null;
    }

    destroy() {
      this.dead = true;
      const c = this.client;
      if (!c) return;
      try { c.publish(this.base + 'h', enc({ from: this.id, m: { t: '_bye' } }), { qos: 1 }); } catch { /* ignore */ }
      setTimeout(() => c.end(true), 300);
    }
  }

  return { Host, Player };
})();
