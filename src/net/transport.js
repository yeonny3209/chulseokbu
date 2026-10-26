// Connection layer. Two interchangeable transports with the same tiny interface:
//  - "peer":  real WebRTC through PeerJS (free public signalling server, no hosting needed)
//  - "local": BroadcastChannel between tabs of the same browser (used for testing: add ?net=local)
// A connection looks like { id, send(msg), close(), onmessage, onclose }.
const PREFIX = 'chulseokbu-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

class Conn {
  constructor(id, sendFn, closeFn) {
    this.id = id;
    this._send = sendFn;
    this._close = closeFn;
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
  }

  send(msg) {
    if (this.open) {
      try { this._send(msg); } catch (e) { console.warn('send failed', e); }
    }
  }

  close() {
    if (!this.open) return;
    this.open = false;
    try { this._close && this._close(); } catch (e) { /* already closed */ }
  }
}

// ------------------------------------------------------------------ PeerJS (WebRTC)
// Works across different networks: STUN finds each player's public address, and when a router
// blocks direct connections (strict NAT) the TURN relays carry the data instead.
const ICE = {
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
      // public fallback relay (also on 443/TCP so it passes strict firewalls)
      {
        urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
  },
};

async function peerHost(code, onConn) {
  const { Peer } = await import('peerjs');
  const peer = new Peer(PREFIX + code, ICE);
  await new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', reject);
  });
  peer.on('connection', (c) => {
    const conn = new Conn(c.peer, (m) => c.send(m), () => c.close());
    c.on('data', (d) => conn.onmessage && conn.onmessage(d));
    c.on('close', () => { conn.open = false; conn.onclose && conn.onclose(); });
    c.on('error', () => { conn.open = false; conn.onclose && conn.onclose(); });
    if (c.open) onConn(conn);
    else c.on('open', () => onConn(conn));
  });
  return { close: () => peer.destroy() };
}

async function peerJoin(code) {
  const { Peer } = await import('peerjs');
  const peer = new Peer(undefined, ICE);
  await new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', reject);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('연결 시간이 초과되었다. 코드를 확인해 주세요.')), 15000);
    const c = peer.connect(PREFIX + code, { reliable: true });
    const fail = (e) => { clearTimeout(timer); reject(e); };
    peer.on('error', fail);
    c.on('error', fail);
    c.on('open', () => {
      clearTimeout(timer);
      const conn = new Conn('host', (m) => c.send(m), () => { c.close(); peer.destroy(); });
      c.on('data', (d) => conn.onmessage && conn.onmessage(d));
      c.on('close', () => { conn.open = false; conn.onclose && conn.onclose(); });
      resolve(conn);
    });
  });
}

// ------------------------------------------------------------------ BroadcastChannel (same browser)
function localHost(code, onConn) {
  const bc = new BroadcastChannel(PREFIX + code);
  const conns = new Map();
  bc.onmessage = (e) => {
    const m = e.data;
    if (!m || m.to !== 'host') return;
    if (m.kind === 'hello') {
      const conn = new Conn(m.from, (d) => bc.postMessage({ to: m.from, from: 'host', kind: 'data', data: d }), () => bc.postMessage({ to: m.from, from: 'host', kind: 'bye' }));
      conns.set(m.from, conn);
      bc.postMessage({ to: m.from, from: 'host', kind: 'welcome' });
      onConn(conn);
    } else if (m.kind === 'data') {
      const c = conns.get(m.from);
      if (c && c.onmessage) c.onmessage(m.data);
    } else if (m.kind === 'bye') {
      const c = conns.get(m.from);
      if (c) { c.open = false; c.onclose && c.onclose(); }
    }
  };
  return Promise.resolve({ close: () => bc.close() });
}

function localJoin(code) {
  return new Promise((resolve, reject) => {
    const id = `c${Math.random().toString(36).slice(2, 8)}`;
    const bc = new BroadcastChannel(PREFIX + code);
    let conn = null;
    const timer = setTimeout(() => reject(new Error('방을 찾을 수 없다. 코드를 확인해 주세요.')), 4000);
    bc.onmessage = (e) => {
      const m = e.data;
      if (!m || m.to !== id) return;
      if (m.kind === 'welcome') {
        clearTimeout(timer);
        conn = new Conn('host', (d) => bc.postMessage({ to: 'host', from: id, kind: 'data', data: d }), () => { bc.postMessage({ to: 'host', from: id, kind: 'bye' }); bc.close(); });
        resolve(conn);
      } else if (m.kind === 'data') {
        if (conn && conn.onmessage) conn.onmessage(m.data);
      } else if (m.kind === 'bye' && conn) {
        conn.open = false;
        conn.onclose && conn.onclose();
      }
    };
    bc.postMessage({ to: 'host', from: id, kind: 'hello' });
  });
}

export function hostRoom(kind, code, onConn) {
  return kind === 'local' ? localHost(code, onConn) : peerHost(code, onConn);
}

export function joinRoom(kind, code) {
  return kind === 'local' ? localJoin(code) : peerJoin(code);
}
