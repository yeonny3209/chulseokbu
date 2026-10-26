// Jump scares. Each scare is a short timeline that runs on the machine of the player who gets
// scared (the host just tells them to start via the 'scare' RPC).
//
// What makes these work:
//   1. The quiet before: everything goes silent and the lights die (anticipation).
//   2. The lights flicker back on in bursts, and each time the figure is closer.
//   3. The hit: huge scream + sub-bass, the face fills the screen, the view zooms, strobe, shake.
//   4. The aftermath: ringing ears, muffled sound, racing heart, a beat of darkness.
import * as THREE from 'three';
import { S, settings } from './state.js';
import { createTeacherModel } from './teacher.js';

export class Scares {
  constructor(game) {
    this.game = game;
    this.model = createTeacherModel('ghoul');
    this.root = this.model.root;
    this.root.visible = false;
    game.scene.add(this.root);
    this.light = new THREE.PointLight(0xbfd2e8, 0, 8, 2);
    game.scene.add(this.light);
    this.steps = [];
    this.t = 0;
    this.running = null;
    this.cool = 0;
    this.jitter = 0;
  }

  get busy() { return !!this.running; }

  /** kind: 'advance' | 'behind' | 'slam'. */
  run(kind, p = {}) {
    if (this.running) return;
    const g = this.game;
    this.running = kind;
    this.t = 0;
    this.steps = [];
    const at = (t, fn) => this.steps.push({ t, fn, done: false });
    const lights = (on) => { S.flags.blackout = !on; };
    const sting = (name, gain = 1, extra = {}) => g.audio.play(name, { bus: 'sting', gain, jitter: 0.02, ...extra });

    if (kind === 'advance') {
      // the lights flicker on in bursts; each time the figure stands closer — then it is on you
      const D = p.d || 9;
      const far = Math.max(3, D);
      const mid = Math.max(2, D * 0.45);
      g.audio.duck(3.8);
      g.player.flashLock = 3.8;
      at(0.0, () => { lights(false); sting('click', 0.8); });
      at(0.15, () => { sting('heart', 1.1); });
      at(0.9, () => { sting('heart', 1.3); });
      at(1.4, () => { lights(true); this.place(far); sting('click', 0.9); sting('static', 0.12); });
      at(1.56, () => { lights(false); this.hide(); });
      at(2.25, () => { lights(true); this.place(mid); sting('click', 0.9); sting('breathClose', 0.5); });
      at(2.41, () => { lights(false); this.hide(); });
      at(3.0, () => { lights(true); this.place(0.95); this.slam(); });
      at(3.6, () => this.aftermath());
    } else if (kind === 'behind') {
      // silence, breathing right behind you, you spin round — it is already there
      g.audio.duck(2.6);
      g.player.flashLock = 2.6;
      at(0.0, () => { sting('heart', 1.0); });
      at(0.8, () => { sting('heart', 1.3); sting('breathClose', 0.8, { pos: this.behindPos(0.6), ref: 0.6 }); });
      at(1.7, () => { sting('breathClose', 1.0, { pos: this.behindPos(0.4), ref: 0.5 }); });
      at(2.1, () => {
        lights(true);
        const q = this.place(1.0, 'behind');
        g.player.forceLookAt(q.x, g.player.pos.y + 1.7, q.z, 0.5);
        this.slam();
      });
      at(2.7, () => this.aftermath());
    } else {
      // 'slam': no waiting, straight to the hit (e.g. the chase begins)
      at(0.0, () => { this.slam(); });
      at(0.6, () => this.aftermath());
    }
  }

  behindPos(d) {
    const p = this.game.player;
    const f = p.forward();
    return [p.pos.x - f.x * d, p.pos.y + 1.4, p.pos.z - f.z * d];
  }

  /** Put the figure `d` metres in front of (or behind) the player, as far as the line of sight allows. */
  place(d, side = 'front') {
    const g = this.game;
    const p = g.player;
    const f = p.forward();
    f.y = 0;
    f.normalize();
    if (side === 'behind') f.multiplyScalar(-1);
    const e = p.eye();
    let use = d;
    // pull it closer until it stands in the open (not inside a wall)
    while (use > 0.8 && !g.world.los(e.x, e.y, e.z, e.x + f.x * use, e.y, e.z + f.z * use)) use -= 0.5;
    const x = p.pos.x + f.x * use;
    const z = p.pos.z + f.z * use;
    const m = this.model;
    this.root.position.set(x, p.pos.y, z);
    this.root.rotation.y = Math.atan2(p.pos.x - x, p.pos.z - z);
    this.root.scale.setScalar(1);
    m.body.rotation.x = 0.25 + (d < 2 ? 0.25 : 0);
    m.armL.rotation.x = -1.5;
    m.armR.rotation.x = -1.35;
    m.head.rotation.y = 0;
    this.root.visible = true;
    this.light.position.set(x - f.x * 0.9, p.pos.y + 1.9, z - f.z * 0.9);
    this.light.intensity = d < 2 ? 22 : 12;
    return { x, z };
  }

  hide() {
    this.root.visible = false;
    this.light.intensity = 0;
  }

  /** Stop a running scare (the player was caught, restarted, left the game…). */
  cancel() {
    this.running = null;
    this.steps = [];
    this.hide();
    S.flags.blackout = false;
  }

  /** The hit. */
  slam() {
    const g = this.game;
    const calm = settings.reduceShake;
    const sting = (name, gain) => g.audio.play(name, { bus: 'sting', gain, jitter: 0.02 });
    sting('scream', 1.0);
    sting('sub', 1.2);
    sting('stinger', 1.0);
    g.scareFx(1);
    g.ui.faceSlam(calm ? 450 : 750, calm);
    if (!calm) {
      g.ui.flash(90, '#fff');
      setTimeout(() => g.ui.flash(90, '#d00'), 150);
    }
    this.jitter = 0.7;
  }

  aftermath() {
    const g = this.game;
    this.hide();
    S.flags.blackout = false;
    g.audio.muffle(3.2);
    g.audio.ringing(0.5);
    g.fearBoost = 3;
    g.player.flashLock = 0.5;
    this.running = null;
    this.cool = 6;
  }

  update(dt) {
    if (this.cool > 0) this.cool -= dt;
    if (!this.running) { if (this.root.visible) this.hide(); return; }
    this.t += dt;
    for (const s of this.steps) {
      if (!s.done && this.t >= s.t) { s.done = true; s.fn(); }
    }
    // the figure trembles violently right after the hit
    if (this.root.visible && this.jitter > 0) {
      this.jitter -= dt;
      const j = this.jitter > 0 ? 0.05 : 0;
      this.model.head.rotation.z = (Math.random() - 0.5) * 0.9;
      this.model.neck.rotation.z = 0.55 + (Math.random() - 0.5) * 0.5;
      this.root.position.x += (Math.random() - 0.5) * j;
      this.root.position.z += (Math.random() - 0.5) * j;
    }
  }
}
