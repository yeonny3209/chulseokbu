// The twist ending: the 2015 classroom, the real (old, tired) teacher, and "17번 — 이하늘".
import * as THREE from 'three';
import { S, clearSave } from './state.js';
import { NOTE_COUNT } from './story.js';
import { boardTexture, chartTexture, clockTexture } from './textures.js';
import { createTeacherModel } from './teacher.js';

const OX = 300; // the ending room lives far away from the school

export class Ending {
  constructor(game) {
    this.game = game;
    this.group = null;
    this.running = false;
    this.waitAnswer = false;
    this.writing = false;
    this.t = 0;
    this.lights = [];
    this.fade = false;
  }

  build() {
    if (this.group) return;
    const g = this.game;
    const grp = (this.group = new THREE.Group());
    const T = g.world.T;
    const mat = (map, color = 0xffffff, rough = 0.85) => new THREE.MeshStandardMaterial({ map, color, roughness: rough });
    const add = (geo, m, x, y, z, ry = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(OX + x, y, z);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      grp.add(mesh);
      return mesh;
    };
    const floorTex = T.floor.clone();
    floorTex.repeat.set(4.5, 4);
    floorTex.needsUpdate = true;
    const floor = add(new THREE.PlaneGeometry(9, 8), mat(floorTex, 0xd8d2b0, 0.5), 4.5, 0.01, 7);
    floor.rotation.x = -Math.PI / 2;
    const ceil = add(new THREE.PlaneGeometry(9, 8), mat(T.ceil), 4.5, 3, 7);
    ceil.rotation.x = Math.PI / 2;
    const wallMat = mat(T.wall, 0xe6e0c8);
    add(new THREE.BoxGeometry(9.2, 3, 0.2), wallMat, 4.5, 1.5, 11);
    add(new THREE.BoxGeometry(9.2, 3, 0.2), wallMat, 4.5, 1.5, 3);
    add(new THREE.BoxGeometry(0.2, 3, 8), wallMat, 0, 1.5, 7);
    add(new THREE.BoxGeometry(0.2, 3, 8), wallMat, 9, 1.5, 7);
    // board
    const board = add(new THREE.PlaneGeometry(3.8, 1.35), mat(boardTexture(['11월 13일 (금)', '야간자율학습 — 출석 확인'], { size: 26 }), 0xffffff, 0.9), 4.5, 1.6, 10.88, Math.PI);
    board.castShadow = false;
    // seating chart on the west wall; the name appears at the end
    this.chartMat = mat(chartTexture(16), 0xffffff, 0.9);
    const chart = add(new THREE.PlaneGeometry(1.1, 1.1), this.chartMat, 0.12, 1.7, 5.6, Math.PI / 2);
    chart.castShadow = false;
    const clock = add(new THREE.PlaneGeometry(0.5, 0.5), mat(clockTexture('10:17'), 0xffffff, 0.9), 0.12, 2.5, 4.0, Math.PI / 2);
    clock.castShadow = false;
    // desks
    const wood = mat(T.wood, 0xffffff, 0.7);
    for (const lz of [4.8, 6.1, 7.4]) {
      for (const lx of [1.5, 3.0, 6.0, 7.5]) {
        add(new THREE.BoxGeometry(0.6, 0.05, 0.45), wood, lx, 0.74, lz);
        add(new THREE.BoxGeometry(0.5, 0.7, 0.03), mat(T.metal), lx, 0.35, lz);
        add(new THREE.BoxGeometry(0.4, 0.04, 0.4), wood, lx, 0.44, lz - 0.55);
      }
    }
    add(new THREE.BoxGeometry(1.5, 0.78, 0.7), wood, 4.5, 0.39, 10.3);
    // bright fluorescent panels with warm light
    for (const [x, z] of [[2.2, 5], [4.5, 7.3], [6.8, 9.2]]) {
      const panel = add(new THREE.BoxGeometry(1.4, 0.05, 0.2), new THREE.MeshBasicMaterial({ color: 0xfff6de }), x, 2.96, z);
      panel.castShadow = false;
      const l = new THREE.PointLight(0xfff0d6, 70, 15, 2);
      l.position.set(OX + x, 2.7, z);
      grp.add(l);
      this.lights.push({ l, base: 70 });
    }
    // the teacher as he really is
    this.teacher = createTeacherModel('human');
    this.teacher.root.position.set(OX + 4.5, 0, 9.4);
    this.teacher.root.rotation.y = Math.PI;
    grp.add(this.teacher.root);
    g.scene.add(grp);
  }

  start() {
    const g = this.game;
    this.build();
    this.running = true;
    this.t = 0;
    g.mode = 'ending';
    g.teacher.activate(false);
    g.teacher.reset();
    g.audio.setChase(0);
    g.ui.hideOverlay(null);
    g.ui.setPrompt(null);
    g.ui.showHud(false);
    g.player.frozen = true;
    g.player.flashOn = false;
    g.player.teleport(OX + 2.0 + (g.net.myIdx || 0) * 1.0, 0, 5.4, Math.PI);
    g.scene.fog.density = 0.012;
    g.ambient.intensity = 1.8;
    g.ui.fade(0, 0);
    g.ui.flash(2600);
    g.audio.play('boom', { gain: 0.5 });

    const E = g.events;
    E.clearTimers();
    E.after(2.2, () => this.speak('15번.', 0.85));
    E.after(4.4, () => this.speak('16번.', 0.85));
    E.after(8.0, () => this.speak('…17번.', 0.75));
    E.after(10.4, () => this.speak('이하늘.', 0.7));
    E.after(12.4, () => { this.waitAnswer = true; });
  }

  speak(text, pitch = 0.8, rate = 0.62) {
    const g = this.game;
    if (!g.audio.say(text, { vol: 0.95, pitch, rate, interrupt: true })) {
      g.audio.play('murmur', { gain: 0.6, rate: pitch > 1 ? 1.6 : 0.85 });
    }
    g.ui.subtitle(text, 3200, true);
  }

  answer() {
    const g = this.game;
    if (!this.waitAnswer) return;
    this.waitAnswer = false;
    g.ui.setPrompt(null);
    this.speak('…네.', 1.6, 0.6);
    const E = g.events;
    E.after(3.2, () => { this.writing = true; g.audio.play('chalk', { gain: 0.25, rate: 0.7 }); });
    E.after(4.8, () => this.speak('늦어서 미안하다.', 0.8, 0.55));
    E.after(9.0, () => this.speak('이제 집에 가자.', 0.8, 0.55));
    E.after(13.0, () => { this.writing = false; this.fade = true; });
    E.after(16.0, () => { this.chartMat.map = chartTexture(-1); this.chartMat.needsUpdate = true; });
    E.after(18.0, () => { g.audio.endingMusic(); g.ui.fade(1, 3500); });
    E.after(23.5, () => this.finish());
  }

  finish() {
    const g = this.game;
    this.running = false;
    clearSave();
    g.mode = 'credits';
    g.input.unlock();
    g.ui.endScreen({
      time: S.time,
      deaths: S.deaths,
      notes: Object.keys(S.notes).length,
      bonus: Object.keys(S.notes).length >= NOTE_COUNT,
    });
  }

  update(dt) {
    if (!this.running) return;
    this.t += dt;
    const g = this.game;
    if (this.waitAnswer) {
      g.ui.setPrompt('[ E ]  대답한다');
      if (g.input.hit('KeyE')) this.answer();
    }
    const m = this.teacher;
    m.neck.rotation.z = 0.1 + Math.sin(this.t * 0.7) * 0.03;
    m.armR.rotation.x = this.writing ? -1.5 + Math.sin(this.t * 7) * 0.18 : 0;
    m.head.rotation.x = this.waitAnswer ? 0.15 : 0;
    if (this.fade) {
      this.lights.forEach((o, i) => { o.l.intensity = Math.max(0, o.l.intensity - dt * (o.base / (3 + i * 2.5))); });
      g.ambient.intensity = Math.max(0.05, g.ambient.intensity - dt * 0.12);
    }
  }
}
