// Another human player as seen from this machine: network state + a small avatar with a flashlight.
// It also exposes the same fields the teacher AI reads from the local Player (pos, hidden, flashOn, ...).
import * as THREE from 'three';
import { CFG } from '../config.js';
import { settings } from '../state.js';
import { FLOOR_H } from '../layout.js';

export const PLAYER_COLORS = [0xd85a5a, 0x5aa0d8, 0xd8c35a, 0x6fd88a, 0xb07ad8, 0xd8885a];

function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d');
  x.font = "bold 30px 'Malgun Gothic', sans-serif";
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 6;
  x.strokeStyle = 'rgba(0,0,0,0.85)';
  x.strokeText(text, 128, 32);
  x.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  x.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(1.1, 0.275, 1);
  return sp;
}

export class RemotePlayer {
  constructor(game, id, name, idx) {
    this.game = game;
    this.id = id;
    this.name = name;
    this.idx = idx;
    this.color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.camY = CFG.player.eye;
    this.hiddenId = 0;
    this.flashOn = false;
    this.focus = false;
    this.crouch = false;
    this.running = false;
    this.moving = false;
    this.holding = false;
    this.downed = false;
    this.rv = 0; // id of the downed player this one is reviving
    this.rp = 0; // revive progress (0..1) while this player is down
    this.hideTime = 0;
    this.breathRisk = 0;
    this.invuln = 0;
    this.fresh = true;
    this.stepDist = 0;
    this.avatar = this.buildAvatar();
    this.slot = game.claimRemoteSpot();
    game.scene.add(this.avatar);
  }

  // ---- interface shared with the local Player (read by the teacher AI) ----
  get hidden() {
    return this.hiddenId ? this.game.world.hides.find((h) => h.id === this.hiddenId) || null : null;
  }

  get floor() {
    return this.game.world.floorOf(this.pos.y + 0.5);
  }

  get frozen() { return false; }
  get reviving() { return this.rv; }
  get grabbed() { return false; }

  eye() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.camY, this.pos.z);
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  // ---- network ----
  applyState(s) {
    this.target.set(s.x, s.y, s.z);
    if (this.fresh) { this.pos.copy(this.target); this.fresh = false; }
    this.yaw = s.a;
    this.pitch = s.b;
    this.camY = s.cy;
    this.hiddenId = s.h || 0;
    this.flashOn = !!s.f;
    this.focus = !!s.o;
    this.crouch = !!s.c;
    this.running = !!s.r;
    this.holding = !!s.hb;
    this.rv = s.rv || 0;
    if (s.d !== undefined) this.downed = !!s.d; // snapshots from the host are authoritative
    if (s.rp !== undefined) this.rp = s.rp;
  }

  netState() {
    return {
      i: this.id, x: this.pos.x, y: this.pos.y, z: this.pos.z, a: this.yaw, b: this.pitch, cy: this.camY,
      h: this.hiddenId, f: this.flashOn ? 1 : 0, o: this.focus ? 1 : 0, c: this.crouch ? 1 : 0, r: this.running ? 1 : 0,
      hb: this.holding ? 1 : 0, d: this.downed ? 1 : 0, rp: this.rp, rv: this.rv,
    };
  }

  // ---- avatar ----
  buildAvatar() {
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a98a, roughness: 0.9 });
    const add = (geo, mat, x, y, z, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    this.body = new THREE.Group();
    g.add(this.body);
    add(new THREE.BoxGeometry(0.42, 0.62, 0.24), cloth, 0, 1.12, 0, this.body);
    add(new THREE.BoxGeometry(0.17, 0.78, 0.2), dark, -0.11, 0.39, 0, this.body);
    add(new THREE.BoxGeometry(0.17, 0.78, 0.2), dark, 0.11, 0.39, 0, this.body);
    add(new THREE.BoxGeometry(0.11, 0.55, 0.12), cloth, -0.27, 1.12, 0, this.body);
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 1.52, 0);
    this.body.add(this.headPivot);
    add(new THREE.SphereGeometry(0.13, 12, 10), skin, 0, 0.05, 0, this.headPivot);
    // arm holding the flashlight
    this.armR = new THREE.Group();
    this.armR.position.set(0.27, 1.38, 0);
    this.body.add(this.armR);
    add(new THREE.BoxGeometry(0.11, 0.5, 0.12), cloth, 0, -0.2, 0.1, this.armR);
    this.torchMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 8), this.torchMat);
    torch.rotation.x = Math.PI / 2;
    torch.position.set(0, -0.38, 0.28);
    this.armR.add(torch);
    this.label = labelSprite(this.name, this.color);
    this.label.position.set(0, 2.0, 0);
    g.add(this.label);
    g.visible = false;
    return g;
  }

  update(dt) {
    const g = this.game;
    const prev = this.pos.clone();
    this.pos.lerp(this.target, 1 - Math.exp(-16 * dt));
    const moved = Math.hypot(this.pos.x - prev.x, this.pos.z - prev.z);
    this.moving = moved / Math.max(dt, 0.001) > 0.3;
    if (g.net.role === 'host') this.hideTime = this.hiddenId ? this.hideTime + dt : 0;
    if (this.invuln > 0) this.invuln -= dt;

    // footsteps others can hear (walking is nearly silent, running is not)
    if (moved > 0 && !this.hiddenId && !this.downed) {
      this.stepDist += moved;
      const stride = this.running ? 2.0 : this.crouch ? 1.2 : 1.6;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        if (this.running) g.audio.play('stepRun', { pos: [this.pos.x, this.pos.y + 0.2, this.pos.z], gain: 0.4, ...g.occlusion(this.pos.x, this.pos.y + 1, this.pos.z) });
        else if (!this.crouch) g.audio.play('step', { pos: [this.pos.x, this.pos.y + 0.2, this.pos.z], gain: 0.05 });
      }
    }

    // avatar pose
    const av = this.avatar;
    const show = !this.hiddenId && this.game.net.started;
    av.visible = show;
    av.position.copy(this.pos);
    av.rotation.y = this.yaw + Math.PI; // model faces +z, camera yaw 0 faces -z
    const lying = this.downed;
    this.body.rotation.x = lying ? -Math.PI / 2 : 0;
    this.body.position.y = lying ? 0.15 : this.crouch ? -0.35 : 0;
    this.headPivot.rotation.x = -this.pitch * 0.6;
    this.armR.rotation.x = -Math.PI / 2 - this.pitch * 0.7;
    this.torchMat.color.setHex(this.flashOn && !lying ? 0xfff2cc : 0x333333);
    const dist = g.player.pos.distanceTo(this.pos);
    this.label.visible = dist < 16;
    this.label.position.y = lying ? 0.7 : this.crouch ? 1.6 : 2.0;

    // flashlight beam
    const spot = g.remoteSpots[this.slot];
    if (spot) {
      const on = this.flashOn && show && !lying;
      const e = this.eye();
      const f = this.forward();
      spot.position.copy(e).addScaledVector(f, 0.3);
      spot.target.position.copy(e).addScaledVector(f, 5);
      spot.target.updateMatrixWorld();
      spot.intensity = on ? (this.focus ? 220 : 90) * settings.brightness : 0;
      spot.angle = this.focus ? 0.14 : 0.45;
    }
  }

  dispose() {
    const g = this.game;
    g.scene.remove(this.avatar);
    const spot = g.remoteSpots[this.slot];
    if (spot) spot.intensity = 0;
    g.releaseRemoteSpot(this.slot);
  }
}

export const NEW_GAME_SPOTS = [
  [30.7, 9.2], [31.5, 9.2], [32.3, 9.2], [30.7, 8.2], [31.5, 8.2], [32.3, 8.2],
];
export const START_Y = FLOOR_H;
