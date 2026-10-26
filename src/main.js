// 출석부 (Roll Call) — entry point. Wires renderer, world, player, teacher, audio, UI, networking and the main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CFG } from './config.js';
import { S, resetState, settings, loadSettings, hasSave, clearSave, loadSaveInto, applyShared } from './state.js';
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
import { Net, MAX_PLAYERS } from './net/net.js';
import { PLAYER_COLORS } from './net/remote.js';
import { FLOOR_NAMES, START, fy } from './layout.js';
import { damp, dist2D } from './util.js';

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

// ---------------------------------------------------------------- RPC table
// One-shot effects the host sends to everyone (or to one player). Same names on every machine.
const RPC = {
  toast: (g, t, ms) => g.ui.toast(t, ms),
  hint: (g, t, ms) => g.ui.hint(t, ms),
  subtitle: (g, t, ms, f) => g.ui.subtitle(t, ms, f),
  objective: (g, k) => g.ui.setObjective(k),
  pa: (g, text) => { g.audio.pa(text); g.ui.subtitle(`방송: "${text}"`, 3200); },
  flash: (g, ms) => g.ui.flash(ms),
  shake: (g, v) => { g.shake = Math.max(g.shake, v); },
  fade: (g, o, ms) => g.ui.fade(o, ms),
  play: (g, name, opts) => g.audio.play(name, opts || {}),
  play3d: (g, name, pos, gain = 1, rate = 1) => g.audio.play(name, { pos, gain, rate, ...g.occlusion(pos[0], pos[1], pos[2]) }),
  bell: (g, gain) => g.audio.bell(gain),
  voice: (g, text, vol) => g.audio.say(text, { vol }),
  say: (g, text, loud, pos) => g.teacher.sayLocal(text, loud, pos),
  chaseAlert: (g) => g.chaseAlert(),
  pickEffect: (g, id) => g.events.localPickupEffect(id),
  readNote: (g, id) => g.events.readNote(id),
  phoneUI: (g, on) => g.ui.phone(on),
  blackout: (g, on) => { S.flags.blackout = on; },
  ghostWindow: (g, on) => g.events.ghostWindow(on),
  quietScare: (g) => g.events.quietScare(),
  minBattery: (g, v) => { S.battery = Math.max(S.battery, v); },
  grabbed: (g) => g.player.onGrabbed(),
  setDowned: (g, on) => g.player.setDowned(on),
  respawn: (g, x, y, z, yaw) => g.player.respawn(x, y, z, yaw),
  wipeFade: (g) => { g.ui.fade(1, 1200); g.ui.toast('모두 쓰러졌다…', 2500); },
  ending: (g) => g.startEnding(),
};

class Game {
  constructor() {
    loadSettings();
    this.mode = 'menu';
    this.shake = 0;
    this.fps = 60;
    this.debugOn = false;
    this.noteId = null;
    this.settingsFrom = 'screen-start';
    this.difficultyBuilt = null;
    this.wiping = false;
    this.hudT = 0;
    this.remoteSpots = [];
    this.remoteSpotUsed = [];

    this.net = new Net(this);
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
    // Browsers stop drawing hidden tabs. With friends the world must keep running (the host
    // simulates it for everybody), so a timer keeps stepping the game while this tab is hidden.
    setInterval(() => {
      if (!document.hidden || !this.mp) return;
      const now = performance.now();
      const dt = Math.min((now - (this.lastT || now)) / 1000, 0.1);
      this.lastT = now;
      try { this.tick(dt); } catch (e) { console.error(e); }
      this.input.endFrame();
    }, 50);
  }

  get mp() { return this.net.active; }

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

    // other players' flashlights: created once (the light count must never change at runtime)
    for (let i = 0; i < MAX_PLAYERS - 1; i++) {
      const s = new THREE.SpotLight(0xfff1d6, 0, 20, 0.45, 0.6, 2);
      s.castShadow = false;
      this.scene.add(s, s.target);
      this.remoteSpots.push(s);
      this.remoteSpotUsed.push(false);
    }

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.film = new ShaderPass(FilmShader);
    this.composer.addPass(this.film);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && !this.mp && ['play', 'inv'].includes(this.mode)) this.pause(); });
  }

  claimRemoteSpot() {
    const i = this.remoteSpotUsed.indexOf(false);
    const slot = i < 0 ? 0 : i;
    this.remoteSpotUsed[slot] = true;
    return slot;
  }

  releaseRemoteSpot(i) {
    this.remoteSpotUsed[i] = false;
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
      $('btn-mp').disabled = true;
    }
    $('btn-new').onclick = () => this.startNew();
    $('btn-continue').onclick = () => this.continueGame();
    $('btn-settings').onclick = () => this.openSettings('screen-start');
    $('btn-pause-settings').onclick = () => this.openSettings('screen-pause');
    $('btn-settings-close').onclick = () => { ui.show('screen-settings', false); ui.show(this.settingsFrom, true); };
    $('btn-resume').onclick = () => this.resume();
    $('btn-restart-cp').onclick = () => {
      ui.hideAllScreens();
      if (this.mp) { this.mode = 'play'; this.input.lock(); this.teamRestart(false); } else { this.audio.resume(); this.restartFromCheckpoint(false); }
    };
    $('btn-menu').onclick = () => this.toMenu();
    $('btn-end-menu').onclick = () => location.reload();
    $('screen-note').onclick = () => this.closeOverlay();
    $('dial-try').onclick = () => ui.tryDial();
    $('dial-close').onclick = () => this.closeDial();

    // multiplayer
    $('btn-mp').onclick = () => { ui.hideAllScreens(); ui.showMP(); };
    $('btn-mp-back').onclick = () => { ui.hideAllScreens(); ui.show('screen-start', true); };
    $('btn-mp-host').onclick = () => this.mpHost();
    $('btn-mp-join').onclick = () => this.mpJoin();
    $('btn-lobby-start').onclick = () => this.startMPHost();
    $('btn-lobby-leave').onclick = () => this.leaveRoom();
    $('btn-enter').onclick = () => this.enterMPGame();
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

  // ------------------------------------------------------------------ multiplayer: lobby
  async mpHost() {
    const ui = this.ui;
    const name = ui.mpName();
    ui.mpStatus('방을 만드는 중…');
    this.audio.init();
    try {
      this.net.onLobby = (list) => ui.renderLobby(list, true, this.net.code, this.net.kind);
      const code = await this.net.host(name);
      this.net.onLost = null;
      ui.hideAllScreens();
      ui.show('screen-lobby', true);
      ui.renderLobby(this.net.lobby, true, code, this.net.kind);
    } catch (e) {
      console.warn(e);
      ui.mpStatus('방을 만들 수 없다. 인터넷 연결을 확인해 주세요.');
    }
  }

  async mpJoin() {
    const ui = this.ui;
    const code = ui.mpCode();
    if (code.length < 4) { ui.mpStatus('방 코드를 입력해 주세요.'); return; }
    ui.mpStatus('접속하는 중…');
    this.audio.init();
    try {
      this.net.onLobby = (list) => ui.renderLobby(list, false, this.net.code, this.net.kind);
      await this.net.join(code, ui.mpName());
      this.net.onLost = () => this.onHostLost();
      ui.hideAllScreens();
      ui.show('screen-lobby', true);
      ui.renderLobby(this.net.lobby, false, this.net.code, this.net.kind);
    } catch (e) {
      console.warn(e);
      ui.mpStatus(`접속할 수 없다: ${(e && e.message) || '방을 찾을 수 없다.'}`);
    }
  }

  leaveRoom() {
    this.net.leave();
    this.ui.hideAllScreens();
    this.ui.show('screen-start', true);
    this.refreshMenu();
  }

  onHostLost() {
    if (this.mode === 'credits') return;
    this.ui.hideAllScreens();
    this.ui.showHud(false);
    this.ui.downOverlay(false);
    this.ui.hideOverlay(null);
    this.player.respawn(START.x, fy(START.f), START.z, START.yaw);
    this.teacher.reset();
    this.teacher.activate(false);
    this.mode = 'menu';
    this.input.unlock();
    this.ui.show('screen-start', true);
    this.ui.toast('방장과 연결이 끊어졌다.', 5000);
    this.refreshMenu();
  }

  /** Host pressed Start. */
  startMPHost() {
    this.audio.init();
    resetState();
    if (this.difficultyBuilt !== settings.difficulty) this.buildWorld();
    this.ui.hideAllScreens();
    this.ui.showHud(true);
    this.endingCleanup();
    this.mode = 'play';
    this.input.lock();
    this.player.flashOn = false;
    this.player.frozen = false;
    this.player.downed = false;
    this.player.grabbed = false;
    this.player.stamina = CFG.player.staminaMax;
    this.net.startGame(settings.difficulty);
    this.events.begin();
    this.ui.setBattery(S.battery, true);
    this.audio.resume();
  }

  /** Client: the host started the game. Build the same world and wait for a click (pointer lock needs one). */
  onMPStart(msg) {
    settings.difficulty = msg.diff; // not saved: only for this session
    if (this.difficultyBuilt !== msg.diff) this.buildWorld();
    resetState();
    this.events.resetTriggers();
    this.net.lobby = msg.lobby;
    this.net.createRemotes();
    this.endingCleanup();
    this.ui.hideAllScreens();
    this.ui.show('screen-enter', true);
  }

  enterMPGame() {
    this.ui.show('screen-enter', false);
    this.ui.showHud(true);
    this.mode = 'play';
    this.input.lock();
    this.player.flashOn = false;
    this.player.stamina = CFG.player.staminaMax;
    this.events.beginClient();
    this.ui.setBattery(S.battery, true);
    this.audio.resume();
  }

  // ------------------------------------------------------------------ game flow (solo)
  startNew() {
    this.net.leave();
    this.audio.init();
    clearSave();
    resetState();
    if (this.difficultyBuilt !== settings.difficulty) this.buildWorld();
    this.ui.hideAllScreens();
    this.ui.showHud(true);
    this.endingCleanup();
    this.mode = 'play';
    this.input.lock();
    this.player.flashOn = false;
    this.player.frozen = false;
    this.player.downed = false;
    this.player.grabbed = false;
    this.player.stamina = CFG.player.staminaMax;
    this.events.begin();
    this.ui.setBattery(S.battery, false);
    this.ui.setHeld(null);
    this.audio.resume();
  }

  continueGame() {
    this.net.leave();
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
    this.player.downed = false;
    this.player.grabbed = false;
    this.player.stamina = CFG.player.staminaMax;
    this.player.exhausted = false;
    this.world.applyState();
    this.events.rearmTriggers();
    this.events.onRestore(fromDeath);
    this.ui.setBattery(S.battery, !!S.keys.flashlight);
    this.ui.setHeld(S.held);
    this.ui.flashObjective();
  }

  /** Solo: caught (or "restart from checkpoint"): reload the last checkpoint, keep the counters. */
  restartFromCheckpoint(died = true) {
    const deaths = S.deaths + (died ? 1 : 0);
    const time = S.time;
    if (!loadSaveInto()) resetState();
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
    this.mode = 'pause';
    this.ui.$('btn-restart-cp').classList.toggle('hidden', this.net.isClient);
    this.ui.show('screen-pause', true);
    this.input.unlock();
    if (!this.mp) this.audio.suspend(); // with friends the world keeps running
  }

  resume() {
    this.ui.show('screen-pause', false);
    this.ui.show('screen-settings', false);
    this.mode = 'play';
    this.input.lock();
    this.audio.resume();
  }

  toMenu() {
    if (this.mp) this.net.leave();
    this.ui.hideAllScreens();
    this.ui.showHud(false);
    this.ui.downOverlay(false);
    this.ui.hideOverlay(null);
    this.mode = 'menu';
    this.ui.show('screen-start', true);
    this.refreshMenu();
    this.audio.resume();
    this.player.respawn(START.x, fy(START.f), START.z, START.yaw);
    this.teacher.reset();
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

  // ------------------------------------------------------------------ multiplayer: players & rules
  allPlayers() {
    const list = [this.player];
    if (this.mp) for (const r of this.net.remotes.values()) list.push(r);
    return list;
  }

  /** Run an effect here and (if we are the host) on every other player. */
  rpc(name, ...args) {
    const f = RPC[name];
    if (f) f(this, ...args);
    if (this.net.role === 'host') this.net.broadcast({ t: 'rpc', n: name, a: args });
  }

  /** Run an effect only for one player. */
  rpcTo(id, name, ...args) {
    if (id === this.net.myId) {
      const f = RPC[name];
      if (f) f(this, ...args);
    } else if (this.net.role === 'host') {
      this.net.sendTo(id, { t: 'rpc', n: name, a: args });
    }
  }

  runRPC(name, args) {
    const f = RPC[name];
    if (f) f(this, ...(args || []));
  }

  /** A sound the local player causes that everyone should hear. */
  sfx3d(name, pos, gain = 1) {
    if (this.net.role === 'host') {
      this.rpc('play3d', name, pos, gain);
    } else {
      RPC.play3d(this, name, pos, gain);
      if (this.net.role === 'client') this.net.sendHost({ t: 'sfx', n: name, pos, g: gain });
    }
  }

  noise(x, y, z, radius, kind = 'player') {
    if (this.net.isClient) this.net.sendHost({ t: 'noise', x, y, z, r: radius, k: kind });
    else if (this.teacher) this.teacher.hear(x, y, z, radius, kind);
  }

  chaseAlert() {
    this.audio.play('spot', { gain: 0.9 });
    this.audio.say('17번!', { vol: 1, pitch: 0.2, rate: 0.9, interrupt: true });
    this.ui.subtitle('"17번!"', 1800);
    this.shake = Math.max(this.shake, 0.6);
  }

  onPlayerHide(p, h) {
    if (this.net.isClient) this.net.sendHost({ t: 'hide', id: h.id, on: 1, x: p.pos.x, y: p.pos.y, z: p.pos.z });
    else this.teacher.onPlayerHide(h, p);
  }

  onPlayerUnhide(p, h) {
    if (this.net.isClient) this.net.sendHost({ t: 'hide', id: h.id, on: 0 });
    else this.teacher.onPlayerUnhide(h);
  }

  /** Host: the teacher caught `p`. */
  onGrabbed(p) {
    if (p === this.player) this.player.onGrabbed();
    else this.rpcTo(p.id, 'grabbed');
  }

  /** Host (multiplayer): `p` is knocked down. If everybody is down the team restarts. */
  onVictimDown(p) {
    p.downed = true;
    p.rp = 0;
    if (p === this.player) this.player.setDowned(true);
    else this.rpcTo(p.id, 'setDowned', true);
    this.checkWipe();
  }

  checkWipe() {
    if (this.wiping) return;
    const all = this.allPlayers();
    if (all.length && all.every((q) => q.downed)) this.teamWipe();
  }

  teamWipe() {
    this.wiping = true;
    this.rpc('wipeFade');
    this.events.after(2.4, () => { this.wiping = false; this.teamRestart(true); });
  }

  /** Host: everybody goes back to the last checkpoint. */
  teamRestart(died) {
    const deaths = S.deaths + (died ? 1 : 0);
    if (this.events.cpSnap) {
      applyShared(JSON.parse(this.events.cpSnap));
    } else {
      // no checkpoint yet: back to the very start
      const keepCp = S.cp;
      resetState();
      S.keys.flashlight = true;
      S.collected.flashlight = true;
      S.cp = keepCp;
    }
    S.deaths = deaths;
    const cp = S.cp || { x: START.x, y: fy(START.f), z: START.z, yaw: START.yaw };
    this.world.applyState();
    this.events.rearmTriggers();
    const list = this.allPlayers();
    const taken = [];
    list.forEach((p, i) => {
      // first free spot around the checkpoint (not inside a wall, not on top of a friend)
      let x = cp.x, z = cp.z;
      if (i > 0) {
        search:
        for (const r of [0.8, 0.55, 1.1]) {
          for (let k = 0; k < 8; k++) {
            const a = ((i + k) / 8) * Math.PI * 2;
            const cx = cp.x + Math.cos(a) * r, cz = cp.z + Math.sin(a) * r;
            if (this.world.hitCircle(cx, cz, cp.y, 1.7, CFG.player.radius)) continue;
            if (taken.some((t) => Math.hypot(t[0] - cx, t[1] - cz) < 0.6)) continue;
            x = cx; z = cz;
            break search;
          }
        }
      }
      taken.push([x, z]);
      if (p !== this.player) { p.downed = false; p.invuln = 3; p.rp = 0; p.hideTime = 0; }
      this.rpcTo(p.id, 'respawn', x, cp.y, z, cp.yaw);
    });
    this.net.lastShared = '';
    this.events.onRestore(true);
    this.ui.setHeld(S.held);
  }

  onPlayerLeft(info) {
    this.ui.toast(`${info.name}님이 나갔다.`, 3500);
    if (this.net.role === 'host') this.checkWipe();
  }

  /** Host: help downed players up when a friend holds E next to them. */
  updateRevive(dt) {
    const all = this.allPlayers();
    for (const d of all) {
      if (!d.downed || d.hidden) continue;
      let helper = null;
      for (const h of all) {
        if (h === d || h.downed || h.grabbed) continue;
        if (h.reviving === d.id && dist2D(h.pos.x, h.pos.z, d.pos.x, d.pos.z) < 2.6 && Math.abs(h.pos.y - d.pos.y) < 1.5) { helper = h; break; }
      }
      d.rp = helper ? Math.min(1, (d.rp || 0) + dt / 3) : Math.max(0, (d.rp || 0) - dt * 0.5);
      if (d.rp >= 1) {
        d.rp = 0;
        d.invuln = 4;
        if (d === this.player) this.player.setDowned(false);
        else { d.downed = false; this.rpcTo(d.id, 'setDowned', false); }
        this.rpcTo(d.id, 'toast', '동료가 일으켜 주었다.');
      }
    }
  }

  /** Client: the host sent new shared progress. */
  onSharedChanged() {
    if (this.ui.shownObjective !== S.objective) this.ui.setObjective(S.objective);
    this.ui.setHeld(S.held);
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
    if (this.mode === 'ending' || this.mode === 'credits') return;
    this.ui.setPrompt(null);
    this.ending.start();
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

    const live = ACTIVE_MODES.includes(this.mode) || (this.mp && this.mode === 'pause');
    if (!live) return;

    const p = this.player;
    p.frozen = ['note', 'dial', 'dead', 'ending', 'pause'].includes(this.mode) || p.grabbed || p.downed;
    if (this.mode === 'play' || this.mode === 'inv' || (this.mp && this.mode === 'pause')) S.time += dt;

    p.update(dt);
    this.net.update(dt);
    this.teacher.update(dt);
    this.world.update(dt, p.pos.x, p.pos.z, p.floor);
    this.events.update(dt);
    if (this.mp && !this.net.isClient) this.updateRevive(dt);
    if (this.mode === 'ending') this.ending.update(dt);

    // ambience reacting to the teacher
    const fear = this.mode === 'ending' ? 0 : this.teacher.fear();
    this.fear = damp(this.fear || 0, fear, 3, dt);
    const fwd = p.forward();
    this.audio.setListener(p.pos.x, p.pos.y + p.camY, p.pos.z, fwd.x, fwd.z);
    if (this.mode !== 'ending') this.audio.heart(dt, this.fear);
    const chasing = this.mode !== 'ending' && this.teacher.active && this.teacher.state === 'chase';
    if (chasing !== this._chasing) { this._chasing = chasing; this.audio.setChase(chasing ? 1 : 0); }
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (chasing) this.shake = Math.max(this.shake, 0.25);

    this.ui.floorLabel(this.mode === 'ending' ? '' : FLOOR_NAMES[p.floor]);
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.4; this.updatePlayersHud(); }
    if (this.debugOn) {
      const t = this.teacher;
      this.ui.debug(
        `fps ${this.fps.toFixed(0)}  mode ${this.mode}  net ${this.net.role}${this.mp ? ` ${this.net.code} players ${this.allPlayers().length}` : ''}\n` +
        `pos ${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(2)}, ${p.pos.z.toFixed(1)}  floor ${p.floor}\n` +
        `teacher ${t.active ? t.state : 'off'} @ ${t.pos.x.toFixed(1)}, ${t.pos.y.toFixed(1)}, ${t.pos.z.toFixed(1)}  aware ${t.awareness.toFixed(2)}\n` +
        `fear ${this.fear.toFixed(2)}  battery ${S.battery.toFixed(0)}  stamina ${p.stamina.toFixed(0)}\n` +
        `cp ${S.cp ? S.cp.id : '-'}  obj ${S.objective}  deaths ${S.deaths}`,
      );
    }
  }

  updatePlayersHud() {
    if (!this.mp) { this.ui.setPlayersHud(null); return; }
    const list = this.allPlayers().map((q) => ({
      name: q === this.player ? this.net.myName : q.name,
      color: PLAYER_COLORS[(q === this.player ? this.net.myIdx : q.idx) % PLAYER_COLORS.length],
      downed: q.downed,
      me: q === this.player,
    }));
    this.ui.setPlayersHud(list);
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
