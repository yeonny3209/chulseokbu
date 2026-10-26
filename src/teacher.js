// The teacher: procedural model + state machine (patrol / investigate / search / chase / stunned / grab / scripted).
import * as THREE from 'three';
import { CFG } from './config.js';
import { S, settings } from './state.js';
import { clamp, angleDiff, dist2D, pick, rand, lerp } from './util.js';
import { faceTexture } from './textures.js';
import { ATTEND_LINES } from './story.js';
import { FLOOR_H, fy } from './layout.js';

const T = CFG.teacher;

// ---------------------------------------------------------------- model
export function createTeacherModel(kind = 'ghoul') {
  const ghoul = kind === 'ghoul';
  const s = ghoul ? 1 : 0.7; // real, old teacher is smaller
  const suit = new THREE.MeshStandardMaterial({ color: ghoul ? 0x15161a : 0x4a4d52, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: ghoul ? 0x8a877c : 0xc9a98a, roughness: 0.9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: ghoul ? 0x050505 : 0xdedbd2, roughness: 1 });
  const root = new THREE.Group();
  const body = new THREE.Group(); // leans when running
  root.add(body);
  const add = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.11 * s, 1.1 * s, 0); legR.position.set(0.11 * s, 1.1 * s, 0);
  add(new THREE.BoxGeometry(0.15 * s, 1.1 * s, 0.17 * s), suit, 0, -0.55 * s, 0, legL);
  add(new THREE.BoxGeometry(0.15 * s, 1.1 * s, 0.17 * s), suit, 0, -0.55 * s, 0, legR);
  add(new THREE.BoxGeometry(0.16 * s, 0.07 * s, 0.3 * s), new THREE.MeshStandardMaterial({ color: 0x050505 }), 0, -1.08 * s, 0.06 * s, legL);
  add(new THREE.BoxGeometry(0.16 * s, 0.07 * s, 0.3 * s), new THREE.MeshStandardMaterial({ color: 0x050505 }), 0, -1.08 * s, 0.06 * s, legR);
  body.add(legL, legR);

  const torso = add(new THREE.BoxGeometry(0.42 * s, 0.78 * s, 0.24 * s), suit, 0, 1.5 * s, 0);
  add(new THREE.BoxGeometry(0.1 * s, 0.5 * s, 0.01), new THREE.MeshStandardMaterial({ color: 0x8a1f1f }), 0, 1.5 * s, 0.125 * s);

  const armLen = ghoul ? 1.35 : 0.8;
  const mkArm = (x) => {
    const a = new THREE.Group();
    a.position.set(x * s, 1.85 * s, 0);
    add(new THREE.BoxGeometry(0.09 * s, armLen * s, 0.09 * s), suit, 0, -armLen * s / 2, 0, a);
    add(new THREE.BoxGeometry(0.1 * s, 0.16 * s, 0.07 * s), skin, 0, -armLen * s - 0.05, 0, a);
    body.add(a);
    return a;
  };
  const armL = mkArm(-0.27), armR = mkArm(0.27);
  // attendance book (left) and long ruler (right)
  const book = add(new THREE.BoxGeometry(0.2 * s, 0.03, 0.28 * s), new THREE.MeshStandardMaterial({ color: 0x7a1f1f }), 0, -armLen * s - 0.12, 0.08, armL);
  const ruler = add(new THREE.BoxGeometry(0.035, 0.012, 1.0), new THREE.MeshStandardMaterial({ color: 0x9c7a45 }), 0, -armLen * s - 0.1, 0.45, armR);

  // neck bent sideways + head
  const neck = new THREE.Group();
  neck.position.set(0, 1.9 * s, 0);
  neck.rotation.z = ghoul ? 0.55 : 0.1;
  body.add(neck);
  add(new THREE.CylinderGeometry(0.05 * s, 0.06 * s, 0.32 * s, 8), skin, 0, 0.14 * s, 0, neck);
  const head = new THREE.Group();
  head.position.set(0, 0.32 * s, 0);
  neck.add(head);
  const skull = add(new THREE.SphereGeometry(0.14 * s, 14, 12), skin, 0, 0.1 * s, 0, head);
  skull.scale.set(0.9, ghoul ? 1.25 : 1.1, 1);
  const hair = add(new THREE.SphereGeometry(0.145 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, 0.14 * s, -0.01, head);
  hair.scale.set(0.92, ghoul ? 1.3 : 1.1, 1.02);
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(kind), roughness: 0.9 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2 * s, 0.26 * s), faceMat);
  face.position.set(0, 0.1 * s, 0.128 * s);
  head.add(face);

  const scale = ghoul ? 1 : 1;
  root.scale.setScalar(scale);
  return { root, body, torso, legL, legR, armL, armR, head, neck, ruler, book, height: ghoul ? 2.4 : 1.7 };
}

// ---------------------------------------------------------------- AI
export class Teacher {
  constructor(game) {
    this.game = game;
    this.model = createTeacherModel('ghoul');
    this.group = this.model.root;
    this.group.visible = false;
    game.scene.add(this.group);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.heading = 0;
    this.active = false;
    this.state = 'idle';
    this.t = 0; // state timer
    this.path = [];
    this.speed = T.walk;
    this.onArrive = null;
    this.route = [];
    this.routeIdx = 0;
    this.routeName = '';
    this.waitT = 0;
    this.waitAction = null;
    this.awareness = 0;
    this.loseT = 0;
    this.lastKnown = null;
    this.noiseTarget = null;
    this.spots = [];
    this.spotIdx = 0;
    this.spotT = 0;
    this.spotRolled = false;
    this.knowsHide = null;
    this.stunCount = 0;
    this.focusT = 0;
    this.grace = 0;
    this.noDetect = false;
    this.seq = null;
    this.seqI = 0;
    this.stride = 0;
    this.phase = 0;
    this.rulerT = 0;
    this.chalkT = rand(6, 12);
    this.voiceT = rand(5, 9);
    this.stuckT = 0;
    this.lastPos = new THREE.Vector3();
    this.pending = null;
    this.catchCB = null;
    this.grabT = 0;
    this.lure = null;
    this.hideCheckT = 0;
  }

  get floor() { return this.game.world.floorOf(this.pos.y + 0.5); }
  get nav() { return this.game.nav; }
  get eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + 2.1, this.pos.z); }
  get diff() { return CFG.difficulty[settings.difficulty]; }

  distanceTo(v) { return Math.hypot(v.x - this.pos.x, (v.y - this.pos.y) * 0.5, v.z - this.pos.z); }

  // ------------------------------------------------------------ placement / control
  place(x, y, z, heading = 0) {
    this.pos.set(x, y, z);
    this.heading = heading;
    this.group.position.copy(this.pos);
    this.group.rotation.y = heading;
    this.path = [];
    this.lastPos.copy(this.pos);
  }

  placeAtNode(id, heading = this.heading) {
    const n = this.nav.node(id);
    this.place(n.x, n.y, n.z, heading);
  }

  activate(show = true) {
    this.active = show;
    this.group.visible = show;
    if (!show) this.state = 'idle';
  }

  setRoute(name) {
    this.routeName = name;
    this.route = this.buildRoute(name);
    this.routeIdx = 0;
  }

  /** Routes are lists of nodes; `attend` entries stop at the podium and call the roll. */
  buildRoute(name) {
    const n = this.nav;
    const mk = (f, visits) => {
      const out = [];
      for (const [m, attend] of visits) {
        out.push({ id: n.C(f, m) });
        if (attend) {
          out.push({ id: n.D(f, m) }, { id: n.R(f, m) }, { id: n.P(f, m), attend: true }, { id: n.R(f, m) }, { id: n.D(f, m) }, { id: n.C(f, m) });
        }
      }
      return out;
    };
    switch (name) {
      case 'f2': return mk(1, [[3, false], [4, true], [6, false], [7, true], [5, false], [2, true], [1, false], [0, false]]);
      case 'f3guard': return mk(2, [[0, true], [1, false], [2, false], [1, true]]);
      case 'f3': return mk(2, [[0, true], [1, false], [3, false], [4, true], [5, false], [6, false], [7, false], [5, true], [3, true], [2, false]]);
      case 'f1': return mk(0, [[3, false], [4, true], [5, false], [6, true], [5, false], [3, true], [2, false], [1, true], [0, false]]);
      case 'f1office': return mk(0, [[0, true], [1, false], [2, false], [1, false]]);
      default: return [];
    }
  }

  startPatrol() {
    this.state = 'patrol';
    this.path = [];
    this.waitT = 0;
    this.noDetect = false;
    this.seq = null;
    this.lure = null;
    this.awareness = 0;
    if (!this.route.length) this.setRoute('f2');
    // resume from the route node nearest to us
    const here = this.nav.nearest(this.pos.x, this.pos.y, this.pos.z);
    let bi = 0, bd = Infinity;
    this.route.forEach((r, i) => {
      const nn = this.nav.node(r.id);
      const d = Math.hypot(nn.x - here.x, nn.z - here.z, (nn.y - here.y) * 3);
      if (d < bd) { bd = d; bi = i; }
    });
    this.routeIdx = bi;
  }

  /** Walk to a nav node. */
  goTo(id, speed, cb = null) {
    const start = this.nav.nearest(this.pos.x, this.pos.y, this.pos.z);
    const p = this.nav.path(start.id, id);
    this.setPath(p, speed, cb);
  }

  /** Walk to a free position (path to nearest node, then straight). */
  goToPos(x, y, z, speed, cb = null) {
    const start = this.nav.nearest(this.pos.x, this.pos.y, this.pos.z);
    const end = this.nav.nearest(x, y, z);
    const p = this.nav.path(start.id, end.id) || [];
    this.setPath(p, speed, cb, { x, z });
  }

  setPath(nodes, speed, cb, tail = null) {
    let list = (nodes || []).map((n) => ({ x: n.x, z: n.z }));
    if (list.length > 1) {
      const d0 = dist2D(this.pos.x, this.pos.z, list[0].x, list[0].z);
      const d01 = dist2D(list[0].x, list[0].z, list[1].x, list[1].z);
      if (dist2D(this.pos.x, this.pos.z, list[1].x, list[1].z) < d01 && d0 > 0.5) list.shift();
    }
    if (tail) list.push(tail);
    this.path = list;
    this.speed = speed;
    this.onArrive = cb;
  }

  /** Move along the path. Returns true when the path is finished. */
  follow(dt) {
    if (!this.path.length) return true;
    const w = this.path[0];
    const dx = w.x - this.pos.x, dz = w.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      this.path.shift();
      if (!this.path.length) return true;
      return false;
    }
    const step = Math.min(d, this.speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.turnTo(Math.atan2(dx, dz), dt, this.state === 'chase' ? 9 : 4.5);
    this.stride += step;
    return false;
  }

  turnTo(target, dt, rate = 5) {
    const d = angleDiff(this.heading, target);
    this.heading += clamp(d, -rate * dt, rate * dt);
  }

  snapGround() {
    const g = this.game.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.75);
    if (g > -Infinity) this.pos.y = g;
  }

  // ------------------------------------------------------------ perception
  /** Player eye (or hiding spot camera). */
  playerEye() { return this.game.player.eye(); }

  hasLOS(maxD = 40) {
    const p = this.game.player;
    const e = this.eyePos;
    const pe = this.playerEye();
    if (Math.abs(pe.y - e.y) > 3.2) return false;
    if (Math.hypot(pe.x - e.x, pe.z - e.z) > maxD) return false;
    return this.game.world.los(e.x, e.y, e.z, pe.x, pe.y, pe.z);
  }

  canSee() {
    const g = this.game;
    const p = g.player;
    if (!this.active || this.grace > 0 || this.noDetect) return false;
    if (p.hidden && this.knowsHide !== p.hidden.id) return false;
    const d = dist2D(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
    const maxD = (p.flashOn ? T.viewDistLight : T.viewDist) * this.diff.view;
    const sense = T.senseRadius * this.diff.view;
    if (d > maxD) return false;
    const ang = Math.abs(angleDiff(this.heading, Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z)));
    const inCone = ang < (T.viewAngleDeg * Math.PI) / 360;
    if (!inCone && d > sense) return false;
    return this.hasLOS(maxD);
  }

  /** Called for every noise the player (or a thrown item) makes. */
  hear(x, y, z, radius, kind) {
    if (!this.active || this.grace > 0 || this.state === 'chase' || this.state === 'grab' || this.state === 'stunned' || this.state === 'scripted') return;
    const dy = Math.abs(y - this.pos.y);
    const eff = radius * (dy > 2.5 ? 0.45 : 1);
    const d = dist2D(x, z, this.pos.x, this.pos.z);
    if (d > eff) return;
    if (this.state === 'search' && kind !== 'lure' && this.lure) return;
    if (this.state === 'investigate' && this.noiseTarget) {
      const cur = dist2D(this.noiseTarget.x, this.noiseTarget.z, this.pos.x, this.pos.z);
      if (kind !== 'lure' && kind !== 'bell' && d > cur) return;
    }
    this.seq = null;
    this.noiseTarget = { x, y, z, kind };
    this.lure = kind === 'lure' || kind === 'bell' ? { t: kind === 'bell' ? 24 : 6.5 } : null;
    this.state = 'investigate';
    this.awareness = 0;
    this.t = 0;
    this.goToPos(x, y, z, kind === 'bell' ? 3.0 : T.investigate, () => this.beginSearch(this.lure ? this.lure.t : T.searchTime * 0.6));
    this.game.audio.play('knock', { pos: [this.pos.x, this.pos.y + 1, this.pos.z], gain: 0.15, ...this.game.occlusion(this.pos.x, this.pos.y + 1, this.pos.z) });
  }

  onPlayerHide(h) {
    if (!this.active) return;
    this.knowsHide = null;
    if (this.state === 'chase' && this.hasLOS(20)) this.knowsHide = h.id;
    else if (this.canSeeNoHide()) this.knowsHide = h.id;
  }

  canSeeNoHide() {
    const p = this.game.player;
    const d = dist2D(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
    if (d > T.viewDist) return false;
    const ang = Math.abs(angleDiff(this.heading, Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z)));
    return ang < 0.7 && this.hasLOS(T.viewDist);
  }

  onPlayerUnhide() { this.knowsHide = null; }

  // ------------------------------------------------------------ state transitions
  startChase(announce = true) {
    if (this.state === 'chase') return;
    const g = this.game;
    this.seq = null;
    this.lure = null;
    this.state = 'chase';
    this.t = 0;
    this.loseT = 0;
    this.stunCount = 0;
    this.path = [];
    this.lastKnown = g.player.pos.clone();
    if (announce) {
      g.audio.play('spot', { gain: 0.9 });
      g.audio.say('17번!', { vol: 1, pitch: 0.2, rate: 0.9, interrupt: true });
      g.ui.subtitle('"17번!"', 1800);
      g.shake = 0.6;
    }
    g.audio.setChase(1);
  }

  beginSearch(time = T.searchTime) {
    const g = this.game;
    this.state = 'search';
    this.t = 0;
    this.searchLen = time;
    this.path = [];
    this.spotT = 0;
    this.spotIdx = -1;
    this.spotRolled = false;
    // hiding places near here (same floor), nearest first
    const f = this.floor;
    this.spots = g.world.hides
      .filter((h) => h.f === f && dist2D(h.x, h.z, this.pos.x, this.pos.z) < 9)
      .sort((a, b) => dist2D(a.x, a.z, this.pos.x, this.pos.z) - dist2D(b.x, b.z, this.pos.x, this.pos.z))
      .slice(0, 3);
    if (this.knowsHide) {
      const sp = g.world.hides.find((h) => h.id === this.knowsHide);
      if (sp) this.spots = [sp, ...this.spots.filter((s) => s !== sp)];
    }
    g.audio.setChase(0);
  }

  stun(dur) {
    this.state = 'stunned';
    this.t = 0;
    this.stunDur = dur;
    this.path = [];
    this.game.audio.play('creakHeavy', { pos: [this.pos.x, this.pos.y + 1.5, this.pos.z], gain: 0.7, rate: 0.7 });
    this.game.audio.say('윽…', { vol: 0.8, pitch: 0.1, rate: 0.6 });
  }

  grab() {
    if (this.state === 'grab') return;
    const g = this.game;
    this.state = 'grab';
    this.t = 0;
    this.path = [];
    g.player.frozen = true;
    g.player.flashOn = false;
    g.audio.setChase(0);
    g.audio.play('stingerSoft', { gain: 0.9 });
    g.ui.setPrompt(null);
    this.game.inputLocked = true;
    if (g.player.hidden) {
      const h = g.player.hidden;
      // drag the player out in front of the teacher
      this.place(h.exit.x, g.player.pos.y, h.exit.z, this.heading);
      g.player.hidden = null;
      g.ui.hideOverlay(null);
      g.ui.breath(false);
      g.player.camY = CFG.player.eye;
      this.turnTo(Math.atan2(h.x - h.exit.x, h.z - h.exit.z), 99, 99);
    }
  }

  // ------------------------------------------------------------ voice & foley
  say(text, loud = 1) {
    const g = this.game;
    const p = g.player;
    const d = this.distanceTo(p.pos);
    const sameFloor = Math.abs(p.pos.y - this.pos.y) < 2.5;
    let vol = clamp(1 - d / (sameFloor ? 34 : 18), 0, 1) * loud;
    if (!g.world.los(this.eyePos.x, this.eyePos.y, this.eyePos.z, p.eye().x, p.eye().y, p.eye().z)) vol *= 0.5;
    if (vol < 0.05) return;
    const spoke = g.audio.say(text, { vol, pitch: 0.12, rate: 0.7 });
    if (!spoke) g.audio.play('murmur', { pos: [this.pos.x, this.pos.y + 2, this.pos.z], gain: vol * 0.7, rate: rand(0.8, 1.1) });
    if (d < 22 && sameFloor) g.ui.subtitle(`선생님: "${text}"`, 2400);
  }

  foley(dt, moving) {
    const g = this.game;
    const occ = () => g.occlusion(this.pos.x, this.pos.y + 1, this.pos.z);
    const at = [this.pos.x, this.pos.y + 0.2, this.pos.z];
    // footsteps
    const strideLen = this.state === 'chase' ? 1.6 : 1.0;
    if (moving && this.stride > strideLen) {
      this.stride = 0;
      g.audio.play('stepHeavy', { pos: at, gain: this.state === 'chase' ? 0.9 : 0.55, rate: this.state === 'chase' ? 1.15 : 1, ...occ() });
    }
    if (this.state === 'patrol' || this.state === 'search' || this.state === 'investigate') {
      this.rulerT -= dt;
      if (this.rulerT <= 0 && moving) {
        this.rulerT = rand(0.9, 1.7);
        const side = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
        const wall = side.multiplyScalar(0.8);
        g.audio.play('ruler', { pos: [this.pos.x + wall.x, this.pos.y + 1.0, this.pos.z + wall.z], gain: 0.7, ...occ() });
      }
      this.chalkT -= dt;
      if (this.chalkT <= 0) {
        this.chalkT = rand(9, 16);
        g.audio.play('chalk', { pos: [this.pos.x, this.pos.y + 1.3, this.pos.z], gain: 0.6, ...occ() });
      }
      this.voiceT -= dt;
      if (this.voiceT <= 0) {
        this.voiceT = rand(7, 12);
        this.say(pick(ATTEND_LINES));
      }
    }
  }

  // ------------------------------------------------------------ main update
  update(dt) {
    const g = this.game;
    this.updatePending(dt);
    if (!this.active) return;
    if (this.grace > 0) this.grace -= dt;
    this.t += dt;
    const prev = this.pos.clone();

    this.openDoors();

    switch (this.state) {
      case 'patrol': this.updatePatrol(dt); break;
      case 'investigate': this.updateInvestigate(dt); break;
      case 'search': this.updateSearch(dt); break;
      case 'chase': this.updateChase(dt); break;
      case 'stunned': this.updateStunned(dt); break;
      case 'grab': this.updateGrab(dt); break;
      case 'scripted': this.updateScripted(dt); break;
      default: break;
    }

    this.snapGround();
    const moved = Math.hypot(this.pos.x - prev.x, this.pos.z - prev.z) > 0.002;
    this.foley(dt, moved);
    this.detect(dt);
    this.stunCheck(dt);
    this.breathCheck(dt);
    this.stuckCheck(dt, moved);
    this.animate(dt, moved);
  }

  detect(dt) {
    if (this.state === 'chase' || this.state === 'grab' || this.state === 'stunned' || this.state === 'idle') return;
    if (this.canSee()) {
      const p = this.game.player;
      const d = dist2D(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
      this.awareness += dt * (d < 6 ? 2.2 : 1);
      this.headLook = true;
      if (this.awareness >= T.detectTime) this.startChase();
    } else {
      this.awareness = Math.max(0, this.awareness - dt * 0.8);
    }
  }

  openDoors() {
    const w = this.game.world;
    const f = this.floor;
    for (const d of w.doors) {
      if (d.f !== f || d.open || d.lock === 'never') continue;
      if (Math.abs(d.cx - this.pos.x) < 2.0 && Math.abs(this.pos.z - 3) < 1.7) w.setDoor(d, true, false);
    }
  }

  updatePending(dt) {
    if (!this.pending) return;
    this.pending.t -= dt;
    if (this.pending.t > 0) return;
    const g = this.game;
    const p = g.player;
    const n = this.nav.node(this.pending.id);
    const far = dist2D(n.x, n.z, p.pos.x, p.pos.z) > 16 || Math.abs(n.y - p.pos.y) > 2.5;
    const seen = g.world.los(n.x, n.y + 2, n.z, p.eye().x, p.eye().y, p.eye().z) && dist2D(n.x, n.z, p.pos.x, p.pos.z) < 30;
    if (far && !seen) {
      const pd = this.pending;
      this.pending = null;
      this.activate(true);
      this.placeAtNode(pd.id, pd.heading ?? 0);
      this.setRoute(pd.route);
      this.startPatrol();
      this.grace = 0;
      this.noDetect = false;
      if (pd.cb) pd.cb();
    } else {
      this.pending.t = 2.5;
    }
  }

  /** Move to another floor/location once the player is not looking. */
  relocateWhenUnseen(nodeId, route, { delay = 0, heading = 0, cb = null } = {}) {
    this.pending = { id: nodeId, route, t: delay, heading, cb };
  }

  // ---- patrol
  updatePatrol(dt) {
    if (this.waitT > 0) {
      this.waitT -= dt;
      this.updateWaiting(dt);
      return;
    }
    if (!this.path.length) {
      if (!this.route.length) return;
      const r = this.route[this.routeIdx];
      this.routeIdx = (this.routeIdx + 1) % this.route.length;
      this.goTo(r.id, T.walk, () => {
        if (r.attend) {
          this.waitT = rand(7, 11);
          this.waitAction = 'attend';
          this.attendLine = 0;
          this.turnTo(0, 1, 99); // face the board
        } else if (Math.random() < 0.35) {
          this.waitT = rand(1.2, 2.4);
          this.waitAction = 'look';
        }
      });
    }
    if (this.follow(dt)) {
      this.path = [];
      if (this.onArrive) { const cb = this.onArrive; this.onArrive = null; cb(); }
    }
  }

  updateWaiting(dt) {
    if (this.waitAction === 'attend') {
      this.attendT = (this.attendT || 0) - dt;
      if (this.attendT <= 0) {
        this.attendT = rand(1.6, 2.4);
        this.say(pick(ATTEND_LINES));
        this.game.audio.play('chalk', { pos: [this.pos.x, this.pos.y + 1.2, this.pos.z], gain: 0.5, ...this.game.occlusion(this.pos.x, this.pos.y + 1, this.pos.z) });
      }
    } else if (this.waitAction === 'look') {
      this.turnTo(this.heading + Math.sin(this.t * 1.6) * 1.2, dt, 2);
    }
  }

  // ---- investigate
  updateInvestigate(dt) {
    if (this.follow(dt)) {
      this.path = [];
      if (this.onArrive) { const cb = this.onArrive; this.onArrive = null; cb(); }
      else this.beginSearch();
    }
  }

  // ---- search
  updateSearch(dt) {
    this.searchT = (this.searchT || 0);
    if (this.t < 2.2) {
      this.turnTo(this.heading + Math.sin(this.t * 2.2) * 1.4, dt, 3);
      return;
    }
    if (this.t > this.searchLen + 2.2) {
      this.endSearch();
      return;
    }
    // walk through the nearby hiding places one by one
    if (this.spotIdx === -1) { this.spotIdx = 0; this.startSpot(); }
    if (this.spotIdx >= this.spots.length) {
      if (this.t > Math.min(this.searchLen, 6) + 2.2) this.endSearch();
      else this.turnTo(this.heading + dt * 1.2, dt, 3);
      return;
    }
    const sp = this.spots[this.spotIdx];
    if (this.path.length) {
      if (this.follow(dt)) { this.path = []; this.spotT = 0; this.spotRolled = false; }
      return;
    }
    // standing in front of the hiding place
    this.spotT += dt;
    this.turnTo(Math.atan2(sp.x - this.pos.x, sp.z - this.pos.z), dt, 4);
    if (!this.spotRolled && this.spotT > 0.8) {
      this.spotRolled = true;
      const g = this.game;
      g.audio.play('knock', { pos: [sp.x, this.pos.y + 1, sp.z], gain: 0.8, ...g.occlusion(sp.x, this.pos.y + 1, sp.z) });
      g.audio.play('creak', { pos: [sp.x, this.pos.y + 1, sp.z], gain: 0.5, rate: 1.4 });
      const p = g.player;
      if (p.hidden && p.hidden.id === sp.id && p.hideTime > T.hideProtect) {
        if (this.knowsHide === sp.id || Math.random() < this.diff.openChance) { this.grab(); return; }
      }
    }
    if (this.spotT > 2.2) {
      this.spotIdx++;
      if (this.spotIdx < this.spots.length) this.startSpot();
    }
  }

  startSpot() {
    const sp = this.spots[this.spotIdx];
    if (!sp) return;
    this.goToPos(sp.exit.x, this.pos.y, sp.exit.z, T.search);
  }

  endSearch() {
    this.knowsHide = null;
    this.lure = null;
    this.stunCount = 0;
    this.startPatrol();
  }

  // ---- chase
  updateChase(dt) {
    const g = this.game;
    const p = g.player;
    const speed = this.diff.chase;
    const los = !p.hidden || this.knowsHide === p.hidden.id ? this.hasLOS(34) : false;
    if (los) {
      this.loseT = 0;
      this.lastKnown = p.pos.clone();
    } else {
      this.loseT += dt;
    }
    if (p.hidden && this.knowsHide === p.hidden.id) {
      // he saw you hide: go straight to the spot
      const h = p.hidden;
      this.speed = speed;
      const d = dist2D(this.pos.x, this.pos.z, h.exit.x, h.exit.z);
      if (d < 1.1) {
        g.audio.play('slam', { pos: [h.x, this.pos.y + 1, h.z], gain: 0.9 });
        this.grab();
        return;
      }
      this.moveToward(h.exit.x, h.exit.z, speed, dt, true);
      return;
    }
    const d = dist2D(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
    if (los && Math.abs(p.pos.y - this.pos.y) < 1.8) {
      if (d < T.catchDist) { this.grab(); return; }
      if (d < 8 || this.directClear(p.pos.x, p.pos.z)) {
        this.path = [];
        this.moveToward(p.pos.x, p.pos.z, speed, dt, true);
        return;
      }
    }
    // follow a route to where we last saw them
    if (!this.path.length || this.t % 1 < dt) {
      const lk = this.lastKnown || p.pos;
      this.speed = speed;
      const start = this.nav.nearest(this.pos.x, this.pos.y, this.pos.z);
      const end = this.nav.nearest(lk.x, lk.y, lk.z);
      this.setPath(this.nav.path(start.id, end.id), speed, null, { x: lk.x, z: lk.z });
    }
    if (this.follow(dt)) {
      this.path = [];
      if (this.loseT > T.loseTime || !los) {
        if (this.loseT > 0.8) {
          this.noiseTarget = this.lastKnown;
          this.beginSearch(T.searchTime);
        }
      }
    }
    if (this.loseT > T.loseTime + 6) this.beginSearch(T.searchTime);
  }

  directClear(x, z) {
    return this.game.world.los(this.pos.x, this.pos.y + 1.0, this.pos.z, x, this.pos.y + 1.0, z);
  }

  moveToward(x, z, speed, dt, chasing) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.turnTo(Math.atan2(dx, dz), dt, chasing ? 10 : 5);
    this.stride += step;
  }

  // ---- stun
  updateStunned(dt) {
    if (this.t > this.stunDur) {
      const g = this.game;
      if (this.hasLOS(20) && !g.player.hidden) { this.state = 'chase'; this.t = 0; this.loseT = 0; g.audio.setChase(1); }
      else this.beginSearch(T.searchTime);
    }
  }

  stunCheck(dt) {
    const g = this.game;
    const p = g.player;
    if (!p.focus || !p.flashOn || this.state === 'stunned' || this.state === 'grab' || this.state === 'scripted') { this.focusT = Math.max(0, this.focusT - dt * 2); return; }
    const head = new THREE.Vector3(this.pos.x, this.pos.y + 2.15, this.pos.z);
    const eye = p.eye();
    const to = head.clone().sub(eye);
    const d = to.length();
    if (d > 12) { this.focusT = Math.max(0, this.focusT - dt * 2); return; }
    const ang = to.normalize().angleTo(p.forward());
    if (ang < 0.16 && g.world.los(eye.x, eye.y, eye.z, head.x, head.y, head.z)) {
      this.focusT += dt;
      if (this.focusT >= CFG.flashlight.focusTime) {
        this.focusT = 0;
        const dur = T.stunTimes[Math.min(this.stunCount, T.stunTimes.length - 1)];
        this.stunCount++;
        if (dur > 0) this.stun(dur);
        else g.ui.toast('빛에 익숙해졌다…');
      }
    } else {
      this.focusT = Math.max(0, this.focusT - dt * 2);
    }
  }

  // ---- breathing near a hiding player
  breathCheck(dt) {
    const p = this.game.player;
    if (!p.hidden || !this.diff.breath) { if (p.breathRisk > 0) p.breathRisk = Math.max(0, p.breathRisk - dt * 0.3); return; }
    const d = dist2D(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
    if (d < 2.6 && Math.abs(p.pos.y - this.pos.y) < 2 && this.state !== 'idle') {
      if (!p.holding && p.hideTime > T.hideProtect) {
        p.breathRisk += dt * (this.state === 'search' ? 0.5 : 0.28);
        if (Math.random() < dt * 1.5) this.game.audio.play('breathOut', { gain: 0.25 + p.breathRisk * 0.5, rate: 1.2 });
        if (p.breathRisk >= 1) { this.knowsHide = p.hidden.id; this.grab(); }
      }
    } else p.breathRisk = Math.max(0, p.breathRisk - dt * 0.4);
  }

  stuckCheck(dt, moved) {
    if (this.path.length && !moved) this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 1.5 && this.path.length) {
      const w = this.path.shift();
      this.pos.x = w.x; this.pos.z = w.z;
      this.stuckT = 0;
    }
  }

  // ---- grab
  updateGrab(dt) {
    const g = this.game;
    const p = g.player;
    // pull the camera onto the teacher's face
    const head = new THREE.Vector3(this.pos.x, this.pos.y + 2.1, this.pos.z);
    const eye = p.eye();
    const to = head.sub(eye);
    const wantYaw = Math.atan2(-to.x, -to.z);
    const wantPitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
    p.yaw += angleDiff(p.yaw, wantYaw) * Math.min(1, dt * 9);
    p.pitch += (wantPitch - p.pitch) * Math.min(1, dt * 9);
    this.turnTo(Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z), dt, 12);
    const d = dist2D(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
    if (d > 0.8) this.moveToward(p.pos.x, p.pos.z, 3, dt, true);
    if (this.t > 0.9 && !this.grabDone) {
      this.grabDone = true;
      g.ui.fade(1, 250);
    }
    if (this.t > 1.3 && !this.caughtShown) {
      this.caughtShown = true;
      g.ui.caught(true);
      g.audio.say('찾았다.', { vol: 0.9, pitch: 0.2, rate: 0.55, interrupt: true });
    }
    if (this.t > 3.6) {
      this.grabDone = false;
      this.caughtShown = false;
      g.onCaught();
    }
  }

  // ---- scripted sequences
  /** steps: {go:nodeId,speed} | {wait:s, say?:string} | {lines:[...], gap} | {face:rad} | {call:fn} | {hide:true} */
  runScript(steps, { detect = true, done = null } = {}) {
    this.state = 'scripted';
    this.seq = steps;
    this.seqI = 0;
    this.seqStarted = false;
    this.seqDone = done;
    this.noDetect = !detect;
    this.path = [];
    this.awareness = 0;
  }

  updateScripted(dt) {
    if (!this.seq) { this.startPatrol(); return; }
    const step = this.seq[this.seqI];
    if (!step) {
      const cb = this.seqDone;
      this.seq = null;
      this.noDetect = false;
      this.startPatrol();
      if (cb) cb();
      return;
    }
    if (!this.seqStarted) {
      this.seqStarted = true;
      this.seqT = 0;
      this.lineI = 0;
      if (step.go) this.goTo(step.go, step.speed || T.walk);
      if (step.pos) this.goToPos(step.pos[0], step.pos[1], step.pos[2], step.speed || T.walk);
      if (step.call) { step.call(); this.nextStep(); return; }
      if (step.hide) { this.activate(false); this.state = 'scripted'; this.nextStep(); return; }
      if (step.face !== undefined) this.heading = step.face;
      if (step.say) this.say(step.say);
    }
    this.seqT += dt;
    if (step.go || step.pos) {
      if (this.follow(dt)) { this.path = []; this.nextStep(); }
    } else if (step.lines) {
      const gap = step.gap || 1.5;
      if (this.seqT >= this.lineI * gap && this.lineI < step.lines.length) {
        const ln = step.lines[this.lineI++];
        this.say(ln, 1.1);
        this.game.audio.play('chalk', { pos: [this.pos.x, this.pos.y + 1.2, this.pos.z], gain: 0.5, ...this.game.occlusion(this.pos.x, this.pos.y + 1, this.pos.z) });
      }
      if (this.seqT >= step.lines.length * gap + 0.5) this.nextStep();
    } else if (step.wait !== undefined) {
      if (step.face !== undefined) this.turnTo(step.face, dt, 4);
      if (this.seqT >= step.wait) this.nextStep();
    } else {
      this.nextStep();
    }
  }

  nextStep() {
    this.seqI++;
    this.seqStarted = false;
  }

  // ------------------------------------------------------------ animation
  animate(dt, moved) {
    const m = this.model;
    const chasing = this.state === 'chase';
    const stunned = this.state === 'stunned';
    const grabbing = this.state === 'grab';
    if (moved) this.phase += dt * (chasing ? 11 : 5.2);
    const sw = Math.sin(this.phase);
    const amp = moved ? (chasing ? 0.95 : 0.5) : 0;
    m.legL.rotation.x = sw * amp;
    m.legR.rotation.x = -sw * amp;
    const lean = chasing ? 0.38 : grabbing ? 0.25 : 0.06;
    m.body.rotation.x = lerp(m.body.rotation.x, lean, Math.min(1, dt * 6));
    let aL = -sw * amp * 0.28, aR = sw * amp * 0.28;
    if (stunned) { aL = -2.6; aR = -2.6; }
    else if (grabbing) { aL = -1.5; aR = -1.5; }
    else if (chasing) { aL = -sw * 1.0 - 0.3; aR = sw * 1.0 - 0.3; }
    else if (this.waitAction === 'attend' && this.waitT > 0) { aR = -1.2 + Math.sin(this.t * 3) * 0.2; }
    m.armL.rotation.x = lerp(m.armL.rotation.x, aL, Math.min(1, dt * 10));
    m.armR.rotation.x = lerp(m.armR.rotation.x, aR, Math.min(1, dt * 10));
    // head slowly follows the player; stays tilted
    const p = this.game.player;
    const want = clamp(angleDiff(this.heading, Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z)), -1.1, 1.1);
    m.head.rotation.y = lerp(m.head.rotation.y, this.state === 'patrol' || this.state === 'search' ? want * 0.7 : want, Math.min(1, dt * 1.6));
    m.neck.rotation.z = 0.55 + Math.sin(this.t * 0.8) * 0.08;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
  }

  // ------------------------------------------------------------ queries for the game
  /** 0..1 how afraid the player should be right now. */
  fear() {
    if (!this.active) return 0;
    const p = this.game.player;
    if (this.state === 'chase' || this.state === 'grab') return 1;
    const d = this.distanceTo(p.pos);
    if (Math.abs(p.pos.y - this.pos.y) > 2.5) return d < 8 ? 0.3 : 0;
    return clamp(1 - d / 22, 0, 1) * (this.state === 'idle' ? 0 : 0.85);
  }

  reset() {
    this.state = 'idle';
    this.path = [];
    this.seq = null;
    this.pending = null;
    this.knowsHide = null;
    this.awareness = 0;
    this.stunCount = 0;
    this.lure = null;
    this.waitT = 0;
    this.grabDone = false;
    this.caughtShown = false;
  }
}
