// First-person player: movement, collision, flashlight, hiding, throwing, interaction.
import * as THREE from 'three';
import { CFG } from './config.js';
import { S, settings } from './state.js';
import { clamp, damp, angleDiff } from './util.js';
import { FLOOR_H } from './layout.js';

const P = CFG.player;
const FL = CFG.flashlight;

class Projectile {
  constructor(world, type, pos, vel) {
    this.world = world;
    this.type = type;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.mesh = world.makeItemMesh({ type });
    this.mesh.position.copy(pos);
    world.group.add(this.mesh);
    this.spin = new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9);
    this.dead = false;
    this.bounces = 0;
  }

  inside(x, y, z) {
    const w = this.world;
    const t = (b) => x > b.min[0] && x < b.max[0] && y > b.min[1] && y < b.max[1] && z > b.min[2] && z < b.max[2];
    for (const b of w.blockers) if (t(b)) return true;
    for (const b of w.solids) if (t(b)) return true;
    for (const b of w.dyn) if (b.active && t(b)) return true;
    return false;
  }

  update(dt, onLand) {
    const steps = 4;
    const h = dt / steps;
    for (let i = 0; i < steps && !this.dead; i++) {
      this.vel.y -= 14 * h;
      const nx = this.pos.x + this.vel.x * h;
      const ny = this.pos.y + this.vel.y * h;
      const nz = this.pos.z + this.vel.z * h;
      if (this.inside(nx, ny, nz)) {
        if (!this.inside(nx, this.pos.y, this.pos.z)) { this.pos.x = nx; this.vel.x *= -0.25; }
        else this.vel.x *= -0.25;
        if (!this.inside(this.pos.x, this.pos.y, nz)) { this.pos.z = nz; this.vel.z *= -0.25; }
        else this.vel.z *= -0.25;
        this.vel.y *= -0.2;
        this.bounces++;
        continue;
      }
      this.pos.set(nx, ny, nz);
      const g = this.world.groundAt(nx, nz, ny + 0.25);
      if (g > -Infinity && ny <= g + 0.04 && this.vel.y < 0) {
        this.pos.y = g + 0.04;
        this.dead = true;
        onLand(this);
      }
    }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.y += this.spin.y * dt;
    if (this.dead || this.bounces > 6) {
      this.dead = true;
      this.world.group.remove(this.mesh);
    }
  }
}

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3(); // x, feet y, z
    this.yaw = 0;
    this.pitch = 0;
    this.eyeY = P.eye;
    this.camY = P.eye;
    this.crouch = false;
    this.stamina = P.staminaMax;
    this.exhausted = false;
    this.flashOn = false;
    this.focus = false;
    this.hidden = null;
    this.hideTime = 0;
    this.holding = false;
    this.holdT = 0;
    this.holdCool = 0;
    this.breathRisk = 0;
    this.bob = 0;
    this.stepDist = 0;
    this.moving = false;
    this.running = false;
    this.noiseLevel = 0;
    this.target = null;
    this.frozen = false;
    this.projectiles = [];
    this.flickerT = 0;
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.spotDir = new THREE.Vector3(0, 0, -1);
    // multiplayer
    this.downed = false; // knocked down by the teacher, waiting to be revived
    this.grabbed = false; // being pulled by the teacher right now
    this.grabT = 0;
    this.invuln = 0;
    this.reviving = 0; // id of the downed friend this player is helping up
    this.rp = 0; // revive progress while this player is down (0..1)
    this.hideTime = 0;
  }

  get id() { return this.game.net.myId; }
  get floor() { return this.game.world.floorOf(this.pos.y + 0.5); }
  get height() { return this.crouch ? 1.15 : 1.7; }

  eye() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.camY, this.pos.z);
  }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  teleport(x, y, z, yaw = this.yaw) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.camY = P.eye;
    this.hidden = null;
    this.game.ui.hideOverlay(null);
  }

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    const g = this.game;
    const inp = g.input;

    // ---- look
    const sens = 0.0022 * settings.sensitivity;
    if (!this.frozen) {
      this.yaw -= inp.dx * sens;
      this.pitch -= inp.dy * sens * (settings.invertY ? -1 : 1);
      const k = 1.9 * dt;
      if (inp.down('ArrowLeft')) this.yaw += k;
      if (inp.down('ArrowRight')) this.yaw -= k;
      if (inp.down('ArrowUp')) this.pitch += k;
      if (inp.down('ArrowDown')) this.pitch -= k;
    }
    this.pitch = clamp(this.pitch, -1.45, 1.45);

    if (this.invuln > 0) this.invuln -= dt;
    if (this.grabbed) {
      this.updateGrabbed(dt);
    } else if (this.downed) {
      this.updateDowned(dt);
    } else if (this.hidden) {
      this.updateHidden(dt);
    } else if (!this.frozen) {
      this.updateMove(dt);
      this.updateInteract();
      if (inp.hit('KeyQ')) this.throwHeld();
    }

    this.updateFlashlight(dt);
    this.updateCamera(dt);
    for (const p of this.projectiles) p.update(dt, (pr) => this.onLand(pr));
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  updateMove(dt) {
    const g = this.game;
    const inp = g.input;
    const w = g.world;

    this.crouch = inp.down('KeyC') || inp.down('ControlLeft') || inp.down('ControlRight');
    let mx = 0, mz = 0;
    if (inp.down('KeyW')) mz -= 1;
    if (inp.down('KeyS')) mz += 1;
    if (inp.down('KeyA')) mx -= 1;
    if (inp.down('KeyD')) mx += 1;
    // touch stick adds an analog push (dead zone so a resting thumb does not creep)
    if (Math.hypot(inp.axisX, inp.axisY) > 0.12) { mx += inp.axisX; mz += inp.axisY; }
    const moving = mx !== 0 || mz !== 0;
    this.moving = moving;
    const wantRun = inp.down('ShiftLeft') || inp.down('ShiftRight');
    this.running = moving && wantRun && !this.crouch && !this.exhausted && this.stamina > 0 && mz < 0.5;

    let speed = this.crouch ? P.crouch : this.running ? P.run : P.walk;
    if (moving) {
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }
      speed *= Math.max(0.35, Math.min(1, len));
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // camera forward = (-sin, -cos); right = (cos, -sin)
      const dx = (mx * cos + mz * sin) * speed * dt;
      const dz = (-mx * sin + mz * cos) * speed * dt;
      if (!this.tryMove(this.pos.x + dx, this.pos.z + dz)) {
        if (!this.tryMove(this.pos.x + dx, this.pos.z)) this.tryMove(this.pos.x, this.pos.z + dz);
      }
      // footsteps & noise
      const stride = this.running ? 2.0 : this.crouch ? 1.2 : 1.6;
      this.stepDist += speed * dt;
      if (this.stepDist >= stride) {
        this.stepDist = 0;
        this.footstep();
      }
      this.bob += dt * (this.running ? 11 : 7) * (this.crouch ? 0.6 : 1);
    }

    // stamina
    if (this.running) {
      this.stamina = Math.max(0, this.stamina - P.staminaDrain * dt);
      if (this.stamina <= 0) this.exhausted = true;
    } else {
      this.stamina = Math.min(P.staminaMax, this.stamina + P.staminaRegen * (moving ? 0.7 : 1.3) * dt);
      if (this.exhausted && this.stamina >= P.staminaResume) this.exhausted = false;
    }
    const radius = this.crouch ? CFG.noise.crouch : this.running ? CFG.noise.run : moving ? CFG.noise.walk : 0;
    this.noiseLevel = this.running ? 3 : moving && !this.crouch ? 1 : 0;
    this.noiseRadius = radius;

    g.ui.setStamina((this.stamina / P.staminaMax) * 100, this.stamina < P.staminaMax - 1 || this.exhausted);
    g.ui.setNoise(this.noiseLevel);
  }

  tryMove(nx, nz) {
    const w = this.game.world;
    const feet = this.pos.y;
    const gnd = w.groundAt(nx, nz, feet + P.stepUp);
    if (gnd === -Infinity || gnd < feet - 0.7) return false;
    if (w.hitCircle(nx, nz, gnd, this.height, P.radius)) return false;
    this.pos.set(nx, gnd, nz);
    return true;
  }

  footstep() {
    const g = this.game;
    const p = this.pos;
    if (this.running) {
      g.audio.play('stepRun', { gain: 0.4 });
      g.noise(p.x, p.y, p.z, CFG.noise.run);
    } else if (!this.crouch) {
      g.audio.play('step', { gain: 0.05 });
      g.noise(p.x, p.y, p.z, CFG.noise.walk);
    }
  }

  // ------------------------------------------------------------------ interaction
  updateInteract() {
    const g = this.game;
    const w = g.world;
    const eye = this.eye();
    const fwd = this.forward();
    let best = null;
    let bestScore = -Infinity;
    for (const it of w.interacts) {
      if (it.enabled && !it.enabled()) continue;
      const dy = it.y - eye.y;
      if (Math.abs(dy) > 2.0) continue;
      const dx = it.x - eye.x, dz = it.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > (it.range ?? P.interactRange)) continue;
      const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (d || 1);
      if (dot < (d < 1.2 ? 0.4 : d < 2 ? 0.66 : 0.86) && d > 0.5) continue;
      const score = dot * 2 - d * 0.2;
      if (score > bestScore) {
        // sight check (stop a little short of the target so walls/doors it sits in don't block it)
        const margin = it.margin ?? 0.2;
        const k = d > margin + 0.05 ? 1 - margin / d : 0.05;
        if (!w.los(eye.x, eye.y, eye.z, eye.x + dx * k, eye.y + dy * k, eye.z + dz * k)) continue;
        bestScore = score;
        best = it;
      }
    }
    // a downed friend nearby: hold E to help them up
    this.reviving = 0;
    const friend = g.mp ? this.findDownedFriend() : null;
    if (friend) {
      this.reviving = g.input.down('KeyE') ? friend.id : 0;
      this.target = null;
      g.ui.setPrompt(friend.rp > 0.02 ? `${friend.name} 일으키는 중… ${Math.round(friend.rp * 100)}%` : `${friend.name} 구하기 — E 길게 누르기`);
      return;
    }
    this.target = best;
    g.ui.setPrompt(best ? best.prompt() : null);
    if (best && g.input.hit('KeyE')) {
      best.use();
    }
  }

  findDownedFriend() {
    let best = null, bd = 2.3;
    for (const r of this.game.net.remotes.values()) {
      if (!r.downed || r.hiddenId) continue;
      const d = Math.hypot(r.pos.x - this.pos.x, r.pos.z - this.pos.z);
      if (d < bd && Math.abs(r.pos.y - this.pos.y) < 1.5) { bd = d; best = r; }
    }
    return best;
  }

  // ------------------------------------------------------------------ being caught / down / revived
  /** The teacher has hold of us: pull the camera onto his face. */
  onGrabbed() {
    const g = this.game;
    this.grabbed = true;
    this.grabT = 0;
    this.frozen = true;
    this.flashOn = false;
    this.focus = false;
    this.grabTextShown = false;
    this.reviving = 0;
    if (this.hidden) {
      const h = this.hidden;
      this.hidden = null;
      this.hideTime = 0;
      this.pos.set(h.exit.x, h.f * FLOOR_H, h.exit.z);
      g.ui.hideOverlay(null);
      g.ui.breath(false);
    }
    this.camY = CFG.player.eye;
    g.audio.setChase(0);
    g.audio.play('stingerSoft', { gain: 0.9 });
    g.ui.setPrompt(null);
  }

  updateGrabbed(dt) {
    const g = this.game;
    const t = g.teacher;
    const head = new THREE.Vector3(t.pos.x, t.pos.y + 2.1, t.pos.z);
    const to = head.sub(this.eye());
    const wantYaw = Math.atan2(-to.x, -to.z);
    const wantPitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
    this.yaw += angleDiff(this.yaw, wantYaw) * Math.min(1, dt * 9);
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 9);
    this.grabT += dt;
    if (!g.mp && this.grabT > 0.9 && !this.grabFaded) { this.grabFaded = true; g.ui.fade(1, 250); }
    if (this.grabT > 1.3 && !this.grabTextShown) {
      this.grabTextShown = true;
      g.ui.caught(true);
      g.audio.say('찾았다.', { vol: 0.9, pitch: 0.2, rate: 0.55, interrupt: true });
    }
  }

  /** Multiplayer: knocked out. Friends can pull us up again. */
  setDowned(on) {
    const g = this.game;
    if (on === this.downed && !this.grabbed) return;
    this.downed = on;
    this.grabbed = false;
    this.grabFaded = false;
    this.frozen = on;
    g.ui.caught(false);
    g.ui.downOverlay(on);
    if (on) {
      this.flashOn = false;
      this.focus = false;
      this.crouch = false;
      this.running = false;
      this.moving = false;
      if (this.hidden) { this.hidden = null; g.ui.hideOverlay(null); }
      g.ui.setPrompt(null);
    } else {
      this.camY = CFG.player.eye;
      this.rp = 0;
    }
  }

  updateDowned(dt) {
    this.camY = damp(this.camY, 0.35, 4, dt);
    this.pitch = clamp(this.pitch, -0.6, 0.9);
    this.moving = false;
    this.running = false;
    this.game.ui.setPrompt(null);
    this.game.ui.setStamina(100, false);
    this.game.ui.setNoise(0);
    this.game.ui.setReviveBar(this.rp);
  }

  /** Back on our feet at a respawn point (team revive or checkpoint restart). */
  respawn(x, y, z, yaw) {
    const g = this.game;
    this.teleport(x, y, z, yaw);
    this.downed = false;
    this.grabbed = false;
    this.grabFaded = false;
    this.frozen = false;
    this.rp = 0;
    this.reviving = 0;
    this.invuln = 3;
    this.stamina = CFG.player.staminaMax;
    this.exhausted = false;
    this.flashOn = false;
    S.battery = Math.max(S.battery, 50);
    g.ui.caught(false);
    g.ui.downOverlay(false);
    g.ui.fade(0, 1400);
    g.ui.setBattery(S.battery, !!S.keys.flashlight);
  }

  // ------------------------------------------------------------------ network
  netState(id) {
    return {
      i: id, x: this.pos.x, y: this.pos.y, z: this.pos.z, a: this.yaw, b: this.pitch, cy: this.camY,
      h: this.hidden ? this.hidden.id : 0, f: this.flashOn ? 1 : 0, o: this.focus ? 1 : 0, c: this.crouch ? 1 : 0,
      r: this.running ? 1 : 0, hb: this.holding ? 1 : 0, d: this.downed ? 1 : 0, rp: this.rp, rv: this.reviving,
    };
  }

  /** What the host says about us (authoritative: down / revive progress). */
  applyNetSelf(s) {
    this.rp = s.rp || 0;
    if (!!s.d !== this.downed && !this.grabbed) this.setDowned(!!s.d);
  }

  // ------------------------------------------------------------------ hiding
  enterHide(h) {
    const g = this.game;
    if (this.hidden) return;
    this.hidden = h;
    this.hideTime = 0;
    this.holding = false;
    this.holdT = 0;
    this.breathRisk = 0;
    this.reviving = 0;
    this.flashOn = false;
    this.crouch = false;
    this.pos.set(h.cam.x, h.f * FLOOR_H, h.cam.z);
    this.yaw = h.yaw;
    this.pitch = 0;
    this.camY = h.cam.y - h.f * FLOOR_H;
    g.ui.hideOverlay(h.kind === 'desk' ? 'desk' : 'locker');
    g.ui.setPrompt(null);
    g.audio.play('doorClose', { gain: 0.25, rate: 1.4 });
    g.noise(this.pos.x, this.pos.y, this.pos.z, CFG.noise.hide);
    g.onPlayerHide(this, h);
  }

  exitHide() {
    const g = this.game;
    const h = this.hidden;
    if (!h) return;
    this.hidden = null;
    this.holding = false;
    g.ui.hideOverlay(null);
    g.ui.breath(false);
    const w = g.world;
    const fy = h.f * FLOOR_H;
    let ok = !w.hitCircle(h.exit.x, h.exit.z, fy, 1.7, P.radius);
    this.pos.set(ok ? h.exit.x : h.x, fy, ok ? h.exit.z : h.z);
    this.camY = P.eye;
    g.audio.play('creak', { gain: 0.35, rate: 1.5 });
    g.onPlayerUnhide(this, h);
  }

  updateHidden(dt) {
    const g = this.game;
    const inp = g.input;
    this.hideTime += dt;
    // limited view out of the hiding place
    const h = this.hidden;
    const d = angleDiff(h.yaw, this.yaw);
    this.yaw = h.yaw + clamp(d, -0.65, 0.65);
    this.pitch = clamp(this.pitch, -0.45, 0.45);
    this.moving = false;
    this.running = false;
    this.noiseLevel = 0;
    g.ui.setNoise(0);
    g.ui.setStamina(100, false);

    const diff = CFG.difficulty[settings.difficulty];
    const near = g.teacher.distanceTo(this.pos) < 3.2 && g.teacher.active;
    const breathOn = diff.breath && near;
    g.ui.breath(breathOn && !this.holding && this.holdCool <= 0);
    if (this.holdCool > 0) this.holdCool -= dt;
    this.holding = breathOn && inp.down('Space') && this.holdCool <= 0;
    if (this.holding) {
      this.holdT += dt;
      if (this.holdT > 8) { this.holding = false; this.holdCool = 2.5; this.holdT = 0; g.audio.play('breathOut', { gain: 0.6 }); }
    } else {
      this.holdT = Math.max(0, this.holdT - dt * 2);
    }
    g.ui.setPrompt('나가기 [E]');
    if (inp.hit('KeyE')) this.exitHide();
  }

  // ------------------------------------------------------------------ throwing
  throwHeld() {
    const g = this.game;
    if (!S.held || this.hidden) return;
    const dir = this.forward();
    const pos = this.eye().add(dir.clone().multiplyScalar(0.5));
    const vel = dir.multiplyScalar(8.5);
    vel.y += 1.6;
    this.projectiles.push(new Projectile(g.world, S.held, pos, vel));
    g.audio.play('whoosh', { gain: 0.5 });
    S.held = null;
    g.ui.setHeld(null);
  }

  onLand(pr) {
    const g = this.game;
    const p = pr.pos;
    g.sfx3d(pr.type === 'can' ? 'can' : 'thud', [p.x, p.y, p.z], pr.type === 'can' ? 1.0 : 0.8);
    g.noise(p.x, p.y, p.z, CFG.noise.throw, 'lure');
  }

  // ------------------------------------------------------------------ flashlight
  updateFlashlight(dt) {
    const g = this.game;
    const inp = g.input;
    const spot = g.spot;
    const canUse = !!S.keys.flashlight && S.battery > 0 && !this.hidden;
    if ((inp.leftClicked || inp.hit('KeyF')) && S.keys.flashlight && !this.hidden && !this.frozen && !g.menuOpen()) {
      if (S.battery > 0) {
        this.flashOn = !this.flashOn;
        g.audio.play('click', { gain: 0.5 });
      } else {
        g.audio.play('click', { gain: 0.3 });
      }
    }
    if (!canUse) this.flashOn = this.flashOn && canUse;
    this.focus = this.flashOn && (inp.right || inp.down('KeyR')) && !this.frozen && S.battery > 0;
    if (this.flashOn) {
      S.battery = Math.max(0, S.battery - (this.focus ? FL.focusDrain : FL.drain) * dt);
      if (S.battery <= 0) {
        this.flashOn = false;
        this.focus = false;
        g.audio.play('click', { gain: 0.5 });
        g.ui.toast('손전등이 꺼졌다…');
      }
    }
    // beam intensity with flicker when low
    this.flickerT += dt;
    let k = 1;
    if (this.flashOn && S.battery < FL.flickerBelow) {
      const n = Math.sin(this.flickerT * 47) * Math.sin(this.flickerT * 13.7);
      k = n > 0.55 ? 0.12 : 0.85 + 0.15 * Math.sin(this.flickerT * 90);
      if (S.battery < 6) k *= 0.7;
    }
    spot.visible = this.flashOn;
    spot.intensity = (this.focus ? FL.focusIntensity : FL.intensity) * k * settings.brightness;
    spot.angle = damp(spot.angle, this.focus ? FL.focusAngle : FL.angle, 14, dt);
    g.ui.setBattery(S.battery, !!S.keys.flashlight);
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt) {
    const g = this.game;
    const cam = g.camera;
    let target = this.hidden ? this.camY : this.crouch ? P.crouchEye : P.eye;
    if (!this.hidden) this.camY = damp(this.camY, target, 12, dt);
    let bobY = 0, bobX = 0;
    if (this.moving && !settings.reduceShake && !this.hidden) {
      const a = this.running ? 0.045 : this.crouch ? 0.012 : 0.022;
      bobY = Math.sin(this.bob * 2) * a;
      bobX = Math.cos(this.bob) * a * 0.6;
    }
    const shake = (g.shake || 0) * (settings.reduceShake ? 0.2 : 1);
    cam.position.set(this.pos.x + bobX, this.pos.y + this.camY + bobY, this.pos.z);
    cam.rotation.set(this.pitch + (Math.random() - 0.5) * shake * 0.03, this.yaw + (Math.random() - 0.5) * shake * 0.03, 0, 'YXZ');
    const targetFov = settings.fov + (this.running ? 4 : 0);
    if (Math.abs(cam.fov - targetFov) > 0.05) { cam.fov = damp(cam.fov, targetFov, 6, dt); cam.updateProjectionMatrix(); }

    // flashlight follows the camera with a little lag
    const fwd = this.forward();
    this.aimDir.copy(fwd);
    this.spotDir.lerp(fwd, 1 - Math.exp(-16 * dt)).normalize();
    const spot = g.spot;
    spot.position.set(this.pos.x + 0.12 * Math.cos(this.yaw), this.pos.y + this.camY - 0.12, this.pos.z - 0.12 * Math.sin(this.yaw));
    spot.target.position.copy(spot.position).addScaledVector(this.spotDir, 5);
    spot.target.updateMatrixWorld();
  }
}
