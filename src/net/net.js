// Multiplayer session. The host runs the whole game (teacher, story, puzzles); everyone else
// moves their own character locally and sends it to the host, who relays the world to all.
//   client -> host : {t:'p'} own state, {t:'req'} actions, {t:'hide'}, {t:'noise'}, {t:'sfx'}
//   host -> client : {t:'snap'} players + teacher (15 Hz), {t:'shared'} progress, {t:'rpc'} one-shot effects
import { S, getShared, applyShared } from '../state.js';
import { hostRoom, joinRoom, makeCode } from './transport.js';
import { RemotePlayer } from './remote.js';

export const MAX_PLAYERS = 6;
const SEND_HZ = 15;

export class Net {
  constructor(game) {
    this.game = game;
    this.kind = new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'peer';
    this.reset();
  }

  reset() {
    this.role = 'solo';
    this.myId = 'host';
    this.myIdx = 0;
    this.myName = '플레이어';
    this.code = '';
    this.room = null;
    this.hostConn = null;
    this.conns = new Map();
    this.remotes = new Map();
    this.lobby = [];
    this.started = false;
    this.sendT = 0;
    this.lastShared = '';
    this.welcome = null;
    this.onLobby = null;
    this.onLost = null;
  }

  get active() { return this.role !== 'solo'; }
  get isClient() { return this.role === 'client'; }
  get isHost() { return this.role !== 'client'; }

  emitLobby() { if (this.onLobby) this.onLobby(this.lobby); }

  // ------------------------------------------------------------------ host side
  async host(name) {
    this.leave();
    this.role = 'host';
    this.myId = 'host';
    this.myIdx = 0;
    this.myName = name;
    let err = null;
    for (let i = 0; i < 6 && !this.room; i++) {
      const code = makeCode();
      try {
        this.room = await hostRoom(this.kind, code, (conn) => this.onConn(conn));
        this.code = code;
      } catch (e) {
        err = e;
      }
    }
    if (!this.room) {
      this.role = 'solo';
      throw err || new Error('방을 만들 수 없다.');
    }
    this.lobby = [{ id: 'host', name, idx: 0 }];
    this.emitLobby();
    return this.code;
  }

  onConn(conn) {
    conn.onmessage = (m) => this.onHostMsg(conn, m);
    conn.onclose = () => this.onPeerLeft(conn.id);
  }

  onHostMsg(conn, m) {
    if (m.t === 'hello') {
      if (this.started || this.lobby.length >= MAX_PLAYERS) {
        conn.send({ t: 'reject', why: this.started ? '이미 시작된 방이다.' : '방이 가득 찼다. (최대 6명)' });
        setTimeout(() => conn.close(), 300);
        return;
      }
      const idx = [0, 1, 2, 3, 4, 5].find((i) => !this.lobby.some((p) => p.idx === i));
      const p = { id: conn.id, name: String(m.name || '플레이어').slice(0, 12), idx };
      this.lobby.push(p);
      this.conns.set(conn.id, conn);
      conn.send({ t: 'welcome', id: conn.id, idx, lobby: this.lobby });
      this.broadcastLobby();
      return;
    }
    if (!this.conns.has(conn.id)) return;
    const g = this.game;
    switch (m.t) {
      case 'p': {
        const r = this.remotes.get(conn.id);
        if (r) r.applyState({ ...m.s, d: undefined, rp: undefined });
        break;
      }
      case 'req': g.events.hostAct(m.a, m.d || {}, conn.id); break;
      case 'hide': {
        const r = this.remotes.get(conn.id);
        const h = g.world.hides.find((x) => x.id === m.id);
        if (r && h) {
          if (m.on) { r.hiddenId = h.id; r.hideTime = 0; r.breathRisk = 0; r.pos.set(m.x, m.y, m.z); g.teacher.onPlayerHide(h, r); }
          else { r.hiddenId = 0; g.teacher.onPlayerUnhide(h); }
        }
        break;
      }
      case 'noise': g.teacher.hear(m.x, m.y, m.z, m.r, m.k); break;
      case 'sfx':
        // a sound a player made (e.g. a thrown can landing): everyone else hears it too
        g.runRPC('play3d', [m.n, m.pos, m.g]);
        this.broadcast({ t: 'rpc', n: 'play3d', a: [m.n, m.pos, m.g] }, conn.id);
        break;
      default: break;
    }
  }

  onPeerLeft(id) {
    const wasIn = this.lobby.find((p) => p.id === id);
    this.lobby = this.lobby.filter((p) => p.id !== id);
    this.conns.delete(id);
    const r = this.remotes.get(id);
    if (r) { r.dispose(); this.remotes.delete(id); }
    if (!wasIn) return;
    if (this.started) this.game.onPlayerLeft(wasIn);
    else { this.broadcastLobby(); }
  }

  broadcastLobby() {
    this.broadcast({ t: 'lobby', lobby: this.lobby });
    this.emitLobby();
  }

  /** Host: close the lobby and tell everyone to start. */
  startGame(diff) {
    this.started = true;
    this.createRemotes();
    this.broadcast({ t: 'start', diff, lobby: this.lobby });
  }

  createRemotes() {
    for (const p of this.lobby) {
      if (p.id === this.myId || this.remotes.has(p.id)) continue;
      this.remotes.set(p.id, new RemotePlayer(this.game, p.id, p.name, p.idx));
    }
  }

  // ------------------------------------------------------------------ client side
  async join(code, name) {
    this.leave();
    this.role = 'client';
    this.myName = name;
    this.code = code.toUpperCase().trim();
    try {
      this.hostConn = await joinRoom(this.kind, this.code);
    } catch (e) {
      this.role = 'solo';
      throw e;
    }
    this.hostConn.onmessage = (m) => this.onClientMsg(m);
    this.hostConn.onclose = () => this.onHostLost();
    const welcomed = new Promise((resolve, reject) => {
      this.welcome = { resolve, reject };
      setTimeout(() => reject(new Error('방장이 응답하지 않는다.')), 8000);
    });
    this.hostConn.send({ t: 'hello', name });
    try {
      await welcomed;
    } catch (e) {
      this.leave();
      throw e;
    }
  }

  onClientMsg(m) {
    const g = this.game;
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.myIdx = m.idx;
        this.lobby = m.lobby;
        if (this.welcome) { this.welcome.resolve(); this.welcome = null; }
        this.emitLobby();
        break;
      case 'reject':
        if (this.welcome) { this.welcome.reject(new Error(m.why)); this.welcome = null; }
        break;
      case 'lobby': this.lobby = m.lobby; this.emitLobby(); break;
      case 'start': this.started = true; g.onMPStart(m); break;
      case 'snap': this.applySnap(m); break;
      case 'shared': applyShared(m.s); g.world.syncFromState(); break;
      case 'rpc': g.runRPC(m.n, m.a); break;
      default: break;
    }
  }

  onHostLost() {
    if (this.role !== 'client') return;
    const cb = this.onLost;
    this.leave();
    if (cb) cb();
  }

  applySnap(m) {
    const g = this.game;
    const seen = new Set();
    for (const s of m.p) {
      if (s.i === this.myId) {
        if (g.player) g.player.applyNetSelf(s);
        continue;
      }
      seen.add(s.i);
      let r = this.remotes.get(s.i);
      if (!r) {
        const info = this.lobby.find((p) => p.id === s.i);
        if (!info) continue;
        r = new RemotePlayer(g, info.id, info.name, info.idx);
        this.remotes.set(info.id, r);
      }
      r.applyState(s);
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) { r.dispose(); this.remotes.delete(id); }
    }
    g.teacher.applyNet(m.tc);
  }

  // ------------------------------------------------------------------ sending
  sendHost(msg) { if (this.hostConn) this.hostConn.send(msg); }
  sendTo(id, msg) { const c = this.conns.get(id); if (c) c.send(msg); }
  broadcast(msg, exceptId = null) {
    for (const [id, c] of this.conns) if (id !== exceptId) c.send(msg);
  }

  /** Client asks the host to perform an action. */
  request(a, d) { this.sendHost({ t: 'req', a, d }); }

  update(dt) {
    if (!this.active || !this.started) return;
    for (const r of this.remotes.values()) r.update(dt);
    this.sendT += dt;
    if (this.sendT < 1 / SEND_HZ) return;
    this.sendT = 0;
    const g = this.game;
    const mine = g.player.netState(this.myId);
    if (this.role === 'client') {
      this.sendHost({ t: 'p', s: mine });
    } else {
      const arr = [mine];
      for (const r of this.remotes.values()) arr.push(r.netState());
      this.broadcast({ t: 'snap', p: arr, tc: g.teacher.netSnapshot() });
      const sh = JSON.stringify(getShared());
      if (sh !== this.lastShared) {
        this.lastShared = sh;
        this.broadcast({ t: 'shared', s: JSON.parse(sh) });
      }
    }
  }

  /** Leave the room (closes the connection, removes avatars). */
  leave() {
    for (const r of this.remotes.values()) r.dispose();
    for (const c of this.conns.values()) c.close();
    if (this.hostConn) { const c = this.hostConn; this.hostConn = null; c.onclose = null; c.close(); }
    if (this.room) { this.room.close(); this.room = null; }
    const cb = this.onLobby;
    this.reset();
    this.onLobby = cb;
  }
}

export { S };
