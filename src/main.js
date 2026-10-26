// 출석부 (Roll Call) — entry point. Wires renderer, world, player, teacher, audio, UI and the main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CFG } from './config.js';
import { S, resetState, settings, loadSettings, hasSave, readSave, writeSave, clearSave, loadSaveInto } from './state.js';
import { World } from './world.js';
import { furnish } from './rooms.js';
import { Nav } from './nav.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Teacher } from './teacher.js';
import { Events } from './events.js';
import { Ending } from './ending.js';
import { FLOOR_NAMES, START, fy } from './layout.js';
import { clamp, damp } from './util.js';

const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: 1 }, grain: { value: 0.05 }, ca: { value: 0.0012 }, fear: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, vignette, grain, ca, fear; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c, c);
      vec2 off = c * (ca + fear * 0.004) * (1.0 + d * 6.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float vig = 1.0 - smoothstep(0.10, 0.50, d * (1.0 + fear * 1.3) * vignette);
      col *= mix(1.0, vig, 0.85);
      col += (rnd(vUv * 1000.0) - 0.5) * grain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

const ACTIVE_MODES = ['play', 'inv', 'note', 'dial', 'dead', 'ending'];

class Game {
  constructor() {
    loadSettings();
    this.mode = 'menu';
    this.shake = 0;
    this.fps = 60;
    this.debugOn = false;
    this.noteId = null;
    this.prevMode = 'play';
    this.settingsFrom = 'screen-start';
    this.difficultyBuilt = null;

    this.initRenderer();
    this.ui = new UI(this);
    this.audio = new AudioSys();
    this.input = new Input(this.renderer.domElement, this);
    this.buildWorld();
    this.player = new Player(this);
    this.teacher = new Teacher(this);
    this.events = new Events(this);
    this.ending = new Ending(this);
    this.applySettings();
    this.wireUI();
    this.player.teleport(START.x, fy(START.f), START.z, START.yaw);
    window.__g = this;
    window.__S = S; // debugging aid
    this.refreshMenu();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ setup
  initRenderer() {
    const app = document.getElementById('app');
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    app.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020304);
    this.scene.fog = new THREE.FogExp2(0x030405, CFG.fogDensity);
    this.camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.05, 140);
    this.scene.add(this.camera);

    this.ambient = new THREE.AmbientLight(0x4a5870, CFG.ambient);
    this.scene.add(this.ambient);

    const FL = CFG.flashlight;
    this.spot = new THREE.SpotLight(0xfff1d6, FL.intensity, FL.distance, FL.angle, 0.55, 2);
    this.spot.shadow.bias = -0.0004;
    this.spot.shadow.normalBias = 0.02;
    this.spot.shadow.camera.near = 0.2;
    this.scene.add(this.spot, this.spot.target);
    this.spot.visible = false;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.film = new ShaderPass(FilmShader);
    this.composer.addPass(this.film);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && ['play', 'inv'].includes(this.mode)) this.pause(); });
  }

  buildWorld() {
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.lightPool.forEach((l) => this.scene.remove(l));
    }
    this.world = new World(this);
    this.world.build();
    furnish(this.world);
    this.world.finalize();
    this.nav = this.nav || new Nav();
    this.difficultyBuilt = settings.difficulty;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applySettings() {
    const q = CFG.quality[settings.quality] || CFG.quality.medium;
    this.quality = q;
    this.renderer.setPixelRatio(q.pixelRatio);
    this.composer.setPixelRatio(q.pixelRatio);
    this.renderer.toneMappingExposure = settings.brightness;
    const wasShadow = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = q.shadows;
    this.spot.castShadow = q.shadows;
    this.spot.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    if (this.spot.shadow.map) { this.spot.shadow.map.dispose(); this.spot.shadow.map = null; }
    if (wasShadow !== q.shadows) this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.resize();
    this.audio.applyVolumes();
  }

  // ------------------------------------------------------------------ UI wiring
  wireUI() {
    const ui = this.ui;
    const $ = ui.$;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (mobile) {
      ui.show('mobile-warn', true);
      $('btn-new').disabled = true;
      $('btn-continue').disabled = true;
    }
    $('btn-new').onclick = () => this.startNew();
    $('btn-continue').onclick = () => this.continueGame();
    $('btn-settings').onclick = () => this.openSettings('screen-start');
    $('btn-pause-settings').onclick = () => this.openSettings('screen-pause');
    $('btn-settings-close').onclick = () => { ui.show('screen-settings', false); ui.show(this.settingsFrom, true); };
    $('btn-resume').onclick = () => this.resume();
    $('btn-restart-cp').onclick = () => { ui.hideAllScreens(); this.audio.resume(); this.restartFromCheckpoint(false); };
    $('btn-menu').onclick = () => this.toMenu();
    $('btn-end-menu').onclick = () => location.reload();
    $('screen-note').onclick = () => this.closeOverlay();
    $('dial-try').onclick = () => ui.tryDial();
    $('dial-close').onclick = () => this.closeDial();
  }

  refreshMenu() {
    const has = hasSave();
    this.ui.$('btn-continue').disabled = !has || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  }

  openSettings(from) {
    this.settingsFrom = from;
    this.ui.syncSettings();
    this.ui.show(from, false);
    this.ui.show('screen-settings', true);
  }

  // ------------------------------------------------------------------ game flow
  startNew() {
    this.audio.init();
    clearSave();
    resetState();
    if (this.difficultyBuilt !== settings.difficulty) this.buildWorld();
    this.events.resetTriggers();
    this.ui.hideAllScreens();
    this.ui.showHud(true);
    this.endingCleanup();
    this.mode = 'play';
    this.input.lock();
    this.player.flashOn = false;
    this.player.frozen = false;
    this.player.stamina = CFG.player.staminaMax;
    this.events.begin();
    this.ui.setBattery(S.battery, false);
    this.ui.setHeld(null);
    this.audio.resume();
  }

  continueGame() {
    this.audio.init();
    if (!loadSaveInto()) return this.startNew();
    if (this.difficultyBuilt !== settings.difficulty) this.buildWorld();
    this.ui.hideAllScreens();
    this.ui.showHud(true);
    this.endingCleanup();
    this.mode = 'play';
    this.input.lock();
    this.applyCheckpoint(false);
    this.audio.resume();
  }

  /** Put the player at the saved checkpoint and rebuild world/teacher state from S. */
  applyCheckpoint(fromDeath) {
    const cp = S.cp || { x: START.x, y: fy(START.f), z: START.z, yaw: START.yaw };
    this.player.teleport(cp.x, cp.y, cp.z, cp.yaw);
    this.player.flashOn = false;
    this.player.frozen = false;
    this.player.stamina = CFG.player.staminaMax;
    this.player.exhausted = false;
    this.world.applyState();
    this.events.rearmTriggers();
    this.events.onRestore(fromDeath);
    this.ui.setBattery(S.battery, !!S.keys.flashlight);
    this.ui.setHeld(S.held);
    this.ui.flashObjective();
  }

  /** Caught (or "restart from checkpoint"): reload the last checkpoint, keep the counters. */
  restartFromCheckpoint(died = true) {
    const deaths = S.deaths + (died ? 1 : 0);
    const time = S.time;
    if (!loadSaveInto()) {
      resetState();
    }
    S.deaths = deaths;
    S.time = time;
    this.ui.caught(false);
    this.ui.fade(1, 0);
    this.mode = 'play';
    this.input.lock();
    this.applyCheckpoint(true);
    this.ui.fade(0, 1400);
  }

  onCaught() {
    if (this.mode === 'ending') return;
    this.restartFromCheckpoint(true);
  }

  pause() {
    if (!['play', 'inv'].includes(this.mode)) return;
    this.ui.show('screen-inv', false);
    this.prevMode = this.mode;
    this.mode = 'pause';
    this.ui.show('screen-pause', true);
    this.input.unlock();
    this.audio.suspend();
  }

  resume() {
    this.ui.show('screen-pause', false);
    this.ui.show('screen-settings', false);
    this.mode = 'play';
    this.input.lock();
    this.audio.resume();
  }

  toMenu() {
    this.ui.hideAllScreens();
    this.ui.showHud(false);
    this.mode = 'menu';
    this.ui.show('screen-start', true);
    this.refreshMenu();
    this.audio.resume();
    this.player.teleport(START.x, fy(START.f), START.z, START.yaw);
    this.teacher.activate(false);
  }

  endingCleanup() {
    this.scene.fog.density = CFG.fogDensity;
    this.ambient.intensity = CFG.ambient;
  }

  menuOpen() {
    return this.mode === 'menu' || this.mode === 'pause';
  }

  onLockChange(locked, error = false) {
    if (error) {
      this.ui.hint('마우스 잠금을 사용할 수 없다 — 방향키로도 시점을 돌릴 수 있다.', 6000);
      return;
    }
    if (!locked && ['play', 'inv'].includes(this.mode)) this.pause();
  }

  // ------------------------------------------------------------------ overlays
  openNote(id, fromInventory) {
    this.noteId = id;
    if (fromInventory) this.ui.show('screen-inv', false);
    this.mode = 'note';
    this.ui.openNote(id);
    this.ui.setPrompt(null);
  }

  closeOverlay() {
    if (this.mode !== 'note') return;
    this.ui.closeNote();
    this.mode = 'play';
    const id = this.noteId;
    this.noteId = null;
    if (!this.input.locked) this.input.lock();
    this.events.onNoteClosed(id);
  }

  openDial(opts) {
    this.mode = 'dial';
    this.input.unlock();
    this.ui.setPrompt(null);
    this.ui.openDial({
      ...opts,
      onSuccess: () => {
        this.mode = 'play';
        this.input.lock();
        opts.onSuccess();
      },
    });
  }

  closeDial() {
    this.ui.closeDial();
    if (this.mode === 'dial') this.mode = 'play';
    this.input.lock();
  }

  toggleInventory() {
    if (this.mode === 'play') {
      this.mode = 'inv';
      this.ui.renderInventory();
      this.ui.show('screen-inv', true);
    } else if (this.mode === 'inv') {
      this.mode = 'play';
      this.ui.show('screen-inv', false);
    }
  }

  startEnding() {
    this.ui.setPrompt(null);
    this.ending.start();
  }

  // ------------------------------------------------------------------ shared helpers
  noise(x, y, z, radius, kind = 'player') {
    if (this.teacher) this.teacher.hear(x, y, z, radius, kind);
  }

  /** Muffling options for a sound at (x,y,z) as heard by the player. */
  occlusion(x, y, z) {
    const e = this.player.eye();
    if (Math.abs(y - e.y) > 2.4) return { occ: 2 };
    return this.world.los(e.x, e.y, e.z, x, y, z) ? { occ: 0 } : { occ: 1 };
  }

  // ------------------------------------------------------------------ main loop
  loop() {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min((now - (this.lastT || now)) / 1000, 0.05);
    this.lastT = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;
    try {
      this.tick(dt);
    } catch (e) {
      console.error(e);
    }
    this.render(dt);
    this.input.endFrame();
  }

  tick(dt) {
    const inp = this.input;
    if (inp.hit('F1')) { this.debugOn = !this.debugOn; if (!this.debugOn) this.ui.debug(''); }

    // global keys
    if (inp.hit('Escape')) {
      if (this.mode === 'dial') this.closeDial();
      else if (this.mode === 'note') this.closeOverlay();
      else if (this.mode === 'play' || this.mode === 'inv') this.pause();
    }
    if (this.mode === 'note' && (inp.hit('KeyE') || inp.hit('Enter') || inp.hit('Space'))) this.closeOverlay();
    if (this.mode === 'dial' && inp.hit('Enter')) this.ui.tryDial();
    if ((this.mode === 'play' || this.mode === 'inv') && inp.hit('Tab')) this.toggleInventory();

    if (!ACTIVE_MODES.includes(this.mode)) return;

    this.player.frozen = ['note', 'dial', 'dead', 'ending'].includes(this.mode) || this.teacher.state === 'grab';
    if (this.mode === 'play' || this.mode === 'inv') S.time += dt;

    this.player.update(dt);
    this.teacher.update(dt);
    const p = this.player;
    this.world.update(dt, p.pos.x, p.pos.z, p.floor);
    this.events.update(dt);
    if (this.mode === 'ending') this.ending.update(dt);

    // ambience reacting to the teacher
    const fear = this.mode === 'ending' ? 0 : this.teacher.fear();
    this.fear = damp(this.fear || 0, fear, 3, dt);
    const fwd = p.forward();
    this.audio.setListener(p.pos.x, p.pos.y + p.camY, p.pos.z, fwd.x, fwd.z);
    if (this.mode !== 'ending') this.audio.heart(dt, this.fear);
    if (this.teacher.state !== 'chase' && this.teacher.state !== 'grab' && this.audio.chaseLevel > 0) this.audio.setChase(0);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (this.teacher.state === 'chase') this.shake = Math.max(this.shake, 0.25);

    this.ui.floorLabel(this.mode === 'ending' ? '' : FLOOR_NAMES[p.floor]);
    if (this.debugOn) {
      const t = this.teacher;
      this.ui.debug(
        `fps ${this.fps.toFixed(0)}  mode ${this.mode}\npos ${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(2)}, ${p.pos.z.toFixed(1)}  floor ${p.floor}\n` +
        `teacher ${t.active ? t.state : 'off'} @ ${t.pos.x.toFixed(1)}, ${t.pos.y.toFixed(1)}, ${t.pos.z.toFixed(1)}  aware ${t.awareness.toFixed(2)}\n` +
        `fear ${this.fear.toFixed(2)}  battery ${S.battery.toFixed(0)}  stamina ${p.stamina.toFixed(0)}\n` +
        `cp ${S.cp ? S.cp.id : '-'}  stage obj ${S.objective}  deaths ${S.deaths}`,
      );
    }
  }

  render(dt) {
    const f = this.film.uniforms;
    f.time.value = (f.time.value + dt) % 100;
    f.fear.value = this.fear || 0;
    f.grain.value = 0.045 + (this.fear || 0) * 0.05;
    f.vignette.value = this.player.hidden ? 1.4 : 1;
    if (this.quality.post) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}

try {
  new Game();
} catch (e) {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:0;z-index:999;background:#000;color:#f66;padding:20px;white-space:pre-wrap">게임을 시작할 수 없습니다 (WebGL 필요).\n${e && e.message}</pre>`);
}
