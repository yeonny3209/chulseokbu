// Story flow: pickups, notes, puzzles, scripted scenes, jump scares, checkpoints, final chase.
//
// Multiplayer rule: ONLY the host (or the solo player) runs the story. Anything a player does that
// changes the shared world goes through act() -> hostAct(). Effects everybody must see/hear are sent
// with game.rpc(); effects for one person with game.rpcTo(actor, ...). See main.js for the RPC table.
import * as THREE from 'three';
import { CFG } from './config.js';
import { S, writeSave, getShared } from './state.js';
import { BROADCAST, NOTE_COUNT } from './story.js';
import { fy, START } from './layout.js';
import { createTeacherModel } from './teacher.js';
import { NEW_GAME_SPOTS } from './net/remote.js';
import { rand, pick, dist2D } from './util.js';

export class Events {
  constructor(game) {
    this.game = game;
    this.timers = [];
    this.triggers = [];
    this.bcT = rand(60, 100);
    this.cpSnap = null; // multiplayer: shared state at the last checkpoint
    this.safeActor = null;
    this.ghost = createTeacherModel('ghoul');
    this.ghost.root.visible = false;
    game.scene.add(this.ghost.root);
    this.ghostLight = new THREE.PointLight(0xc8d4e0, 0, 6, 2);
    game.scene.add(this.ghostLight);
    this.ghostMode = null;
    this.ghostT = 0;
    this.ghostSeen = 0;
    this.buildTriggers();
  }

  after(sec, fn) {
    this.timers.push({ t: sec, fn });
  }

  clearTimers() {
    this.timers = [];
  }

  nameOf(actor) {
    const net = this.game.net;
    if (actor === net.myId) return net.myName;
    const p = net.lobby.find((x) => x.id === actor);
    return p ? p.name : '누군가';
  }

  playerOf(actor) {
    const g = this.game;
    if (actor === g.net.myId) return g.player;
    return g.net.remotes.get(actor) || g.player;
  }

  // ------------------------------------------------------------------ actions (client -> host)
  /** Do something that changes the shared world. Clients ask the host, the host just does it. */
  act(name, data = {}) {
    const g = this.game;
    if (g.net.isClient) g.net.request(name, data);
    else this.hostAct(name, data, g.net.myId);
  }

  hostAct(name, d, actor) {
    const g = this.game;
    switch (name) {
      case 'door': { const door = g.world.doors.find((x) => x.id === d.id); if (door) g.world.doorAction(door, actor); break; }
      case 'pickup': { const it = g.world.items.find((x) => x.id === d.id); if (it) this.hostPickup(it, actor); break; }
      case 'storage': this.hostStorage(); break;
      case 'lab': this.hostLab(actor); break;
      case 'safe': this.hostSafe(actor); break;
      case 'breaker': this.hostBreaker(actor); break;
      case 'bell': this.hostBell(actor); break;
      case 'curtain': this.hostCurtain(actor); break;
      case 'exit': this.hostExit(actor); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ lifecycle
  /** New game (solo or multiplayer host). */
  begin() {
    const g = this.game;
    this.clearTimers();
    this.hideGhost();
    this.resetTriggers();
    const spot = g.mp ? NEW_GAME_SPOTS[g.net.myIdx] : [START.x, START.z];
    g.player.teleport(spot[0], fy(START.f), spot[1], START.yaw);
    g.ui.fade(1, 0);
    g.teacher.reset();
    g.teacher.activate(false);
    g.ui.setHeld(null);
    if (g.mp) {
      // everybody starts with their own flashlight
      S.keys.flashlight = true;
      S.collected.flashlight = true;
      g.ui.setObjective('corridor');
    } else {
      g.ui.setObjective('start');
    }
    g.world.applyState();
    this.after(0.4, () => g.rpc('fade', 0, 2500));
    this.after(1.2, () => g.rpc('play', 'chalk', { gain: 0.5 }));
    this.after(2.6, () => g.rpc('bell', 0.45));
    this.after(7.5, () => g.rpc('pa', BROADCAST.prologue));
    this.after(3.2, () => g.rpc('hint', g.mp ? 'WASD 이동 · E 조사하기 — 모두 손전등을 들고 시작한다. 같이 교실을 나가자.' : 'WASD 이동 · E 조사하기 · 책상 위의 물건을 찾아라', 7000));
  }

  /** Multiplayer client entering the game (the host runs the story). */
  beginClient() {
    const g = this.game;
    this.clearTimers();
    this.hideGhost();
    const spot = NEW_GAME_SPOTS[g.net.myIdx];
    g.player.teleport(spot[0], fy(START.f), spot[1], START.yaw);
    g.ui.fade(1, 0);
    S.keys.flashlight = true;
    g.ui.setObjective('corridor');
    g.ui.setHeld(null);
    g.world.applyState();
    this.after(0.4, () => g.ui.fade(0, 2500));
  }

  /** After loading a checkpoint (death or Continue). Host/solo only. */
  onRestore(fromDeath) {
    const g = this.game;
    this.clearTimers();
    this.hideGhost();
    g.world.applyState();
    g.ui.setHeld(S.held);
    g.teacher.reset();
    g.ui.setObjective(S.objective);
    this.respawnTeacher();
    if (S.flags.attendStarted && !S.flags.attendDone && !S.flags.finalStarted) this.after(9, () => this.startAttendance());
    if (S.flags.finalStarted && !S.flags.ended) this.after(1.2, () => this.finalChaseTeacher());
    this.bcT = rand(60, 100);
    if (fromDeath && !g.mp) this.after(0.2, () => g.ui.fade(0, 1200));
  }

  /** Put the teacher somewhere far from the players after a restart. */
  respawnTeacher() {
    const g = this.game;
    const t = g.teacher;
    const ref = S.cp ? { x: S.cp.x, z: S.cp.z, y: S.cp.y } : { x: g.player.pos.x, z: g.player.pos.z, y: g.player.pos.y };
    const f = Math.max(0, Math.min(2, Math.round(ref.y / CFG.floorH)));
    t.activate(false);
    if (S.flags.finalStarted) return;
    if (f === 1 && !S.flags.attendDone) return; // tutorial teacher not out yet
    const route = f === 1 ? 'f2' : f === 2 ? (S.flags.bellRung ? 'f3' : 'f3guard') : 'f1';
    let best = null, bd = -1;
    for (const n of g.nav.nodes) {
      if (n.kind !== 'corr' || Math.abs(n.y - fy(f)) > 0.5) continue;
      const d = dist2D(n.x, n.z, ref.x, ref.z);
      if (d > bd) { bd = d; best = n; }
    }
    if (!best) return;
    t.activate(true);
    t.placeAtNode(best.id, 0);
    t.setRoute(route);
    t.startPatrol();
    t.grace = CFG.teacher.respawnGrace;
  }

  update(dt) {
    const g = this.game;
    for (const tm of this.timers) tm.t -= dt;
    const due = this.timers.filter((tm) => tm.t <= 0);
    if (due.length) {
      this.timers = this.timers.filter((tm) => tm.t > 0);
      due.forEach((tm) => tm.fn());
    }
    this.updateGhost(dt);
    if (g.net.isClient) return; // the host runs the story
    this.checkTriggers();
    // school PA now and then
    if (!S.flags.finalStarted && g.mode === 'play') {
      this.bcT -= dt;
      if (this.bcT <= 0) {
        this.bcT = rand(70, 120);
        const f = g.player.floor;
        const key = f === 1 ? pick(['f2_a', 'f2_b']) : f === 2 ? (S.flags.power ? 'power' : 'f3_arrive') : 'f1_rand';
        g.rpc('pa', BROADCAST[key]);
      }
    }
  }

  // ------------------------------------------------------------------ checkpoints
  /** Host: remember progress. `at` = the player whose position becomes the restart point. */
  checkpoint(id, silent = false, at = null) {
    const g = this.game;
    const p = at || g.player;
    S.cp = { id, x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw || 0 };
    if (g.mp) this.cpSnap = JSON.stringify(getShared());
    else writeSave();
    if (!silent) g.rpc('hint', '✎ 자동 저장', 1800);
  }

  // ------------------------------------------------------------------ pickups / notes
  /** E pressed on an item. */
  pickup(item) {
    const g = this.game;
    if (S.collected[item.id]) return;
    if (item.kind === 'throw' && S.held) { g.ui.toast('이미 손에 들고 있다.'); return; }
    this.act('pickup', { id: item.id });
  }

  /** Host: an actor grabbed an item. */
  hostPickup(item, actor) {
    const g = this.game;
    if (S.collected[item.id]) return;
    S.collected[item.id] = true;
    item.mesh.visible = false;
    g.rpcTo(actor, 'pickEffect', item.id);
    const who = g.mp ? `${this.nameOf(actor)}: ` : '';
    const at = this.playerOf(actor);
    switch (item.kind) {
      case 'flashlight':
        S.keys.flashlight = true;
        g.rpc('objective', 'corridor');
        break;
      case 'key':
        S.keys[item.key] = true;
        g.rpc('toast', `${who}${item.label}를 얻었다.`);
        if (item.key === 'sciKey') {
          g.rpc('objective', 'sciKey');
          this.checkpoint('cp_key', false, at);
        }
        if (item.key === 'officeKey') {
          g.rpc('objective', 'officeKey');
          this.after(2.5, () => {
            S.flags.shutterOpen = true;
            g.rpc('play', 'metal', { pos: [-1, fy(1) + 1.5, 2], gain: 1.0 });
            g.rpc('toast', '서쪽 계단 쪽에서 셔터가 올라가는 소리가 들렸다.', 4200);
          });
          this.checkpoint('cp_officekey', false, at);
        }
        break;
      case 'phone':
        S.keys.phone = true;
        this.hostPhoneScare(actor);
        break;
      default:
        break;
    }
  }

  /** On the machine of the player who picked it up. */
  localPickupEffect(id) {
    const g = this.game;
    const item = g.world.items.find((i) => i.id === id);
    if (!item) return;
    g.audio.play('pickup', { gain: 0.6 });
    switch (item.kind) {
      case 'flashlight':
        g.player.flashOn = true;
        g.ui.toast('손전등을 얻었다. (좌클릭/F: 켜기/끄기, 우클릭/R: 집중광)', 4500);
        break;
      case 'battery':
        S.battery = Math.min(100, S.battery + CFG.flashlight.batteryRestore);
        g.ui.toast(`건전지를 갈아 끼웠다. (배터리 ${Math.round(S.battery)}%)`);
        break;
      case 'throw':
        S.held = item.type;
        g.ui.setHeld(S.held);
        g.ui.toast(`${item.label}을(를) 집었다. (Q: 던지기 — 소리로 유인)`);
        break;
      default:
        break;
    }
  }

  readNote(id, fromInventory = false) {
    const g = this.game;
    S.notes[id] = true;
    g.audio.play('paper', { gain: 0.6 });
    g.openNote(id, fromInventory);
    if (id === 6 && !S.flags.storageOpen) this.act('storage');
    if (id === 2) this.after(0.1, () => g.ui.hint('날짜를 기억해 두자 — 11월 13일', 6000));
  }

  hostStorage() {
    const g = this.game;
    if (S.flags.storageOpen) return;
    S.flags.storageOpen = true;
    this.after(1.2, () => {
      g.rpc('play3d', 'unlock', [67, fy(2) + 1, 3], 0.8);
      g.rpc('toast', '복도 쪽에서 철컥, 하고 잠금이 풀리는 소리가 났다.', 4200);
    });
  }

  /** Called when any note/overlay closes (local). */
  onNoteClosed(id) {
    const g = this.game;
    if (!g.mp && id === 11 && S.flags.safeOpen && !S.flags.finalStarted) this.startFinalChase();
    if (Object.keys(S.notes).length === NOTE_COUNT && !S.flags.allNotes) {
      S.flags.allNotes = true;
      g.ui.toast('모든 쪽지를 모았다.', 3500);
    }
  }

  // ------------------------------------------------------------------ puzzles
  openLabCabinet() {
    const g = this.game;
    if (S.keys.fuse || S.collected.fuse) { g.ui.toast('시약장 안은 비어 있다.'); return; }
    g.openDial({
      title: '시약장 — 4자리 번호 자물쇠',
      code: '1113',
      hintKey: 'lab',
      onSuccess: () => this.act('lab'),
    });
  }

  hostLab(actor) {
    const g = this.game;
    if (S.keys.fuse || S.collected.fuse) return;
    S.keys.fuse = true;
    S.collected.fuse = true;
    g.rpc('toast', '시약장 안에서 퓨즈를 찾았다.', 4000);
    g.rpc('objective', 'fuse');
    this.checkpoint('cp_fuse', false, this.playerOf(actor));
  }

  openSafe() {
    const g = this.game;
    if (S.flags.safeOpen) { g.ui.toast('금고는 비어 있다.'); return; }
    g.openDial({
      title: '금고 — 4자리 다이얼',
      code: '2217',
      hintKey: 'safe',
      onSuccess: () => this.act('safe'),
    });
  }

  hostSafe(actor) {
    const g = this.game;
    if (S.flags.safeOpen) return;
    S.flags.safeOpen = true;
    S.keys.frontKey = true;
    S.keys.book = true;
    this.safeActor = actor;
    g.rpc('toast', '금고가 열렸다. 현관 열쇠와 2015년 출석부가 들어 있다.', 4500);
    if (g.mp) {
      // with friends the chase starts on a timer (everyone must be ready to run)
      this.after(0.4, () => g.rpcTo(actor, 'readNote', 11));
      this.after(7, () => this.startFinalChase());
    } else {
      this.after(0.4, () => this.readNote(11));
    }
  }

  useBreaker() {
    this.act('breaker');
  }

  hostBreaker(actor) {
    const g = this.game;
    if (S.flags.power) { g.rpcTo(actor, 'toast', '이미 전원이 들어와 있다.'); return; }
    if (!S.keys.fuse) { g.rpcTo(actor, 'toast', '퓨즈가 필요하다.'); return; }
    S.keys.fuse = false;
    S.flags.power = true;
    g.rpc('play', 'powerOn', { gain: 1.0 });
    g.rpc('flash', 260);
    g.rpc('toast', '전원이 들어왔다.');
    g.noise(58, fy(2), 1.5, CFG.noise.breaker, 'breaker');
    g.rpc('objective', 'power');
    this.after(3, () => g.rpc('pa', BROADCAST.power));
    this.after(1.0, () => this.checkpoint('cp_power', false, this.playerOf(actor)));
    // the teacher comes to see who touched the power
    const t = g.teacher;
    if (t.active && t.floor === 2) {
      t.hear(58, fy(2), 1.5, 999, 'breaker');
    } else {
      t.relocateWhenUnseen('CW_2', 'f3guard', {
        delay: 6, heading: Math.PI / 2,
        cb: () => { t.hear(58, fy(2), 1.5, 999, 'breaker'); },
      });
    }
  }

  pressBell() {
    this.act('bell');
  }

  hostBell() {
    const g = this.game;
    if (S.flags.bellPending) return;
    S.flags.bellPending = true;
    g.rpc('toast', '버튼을 눌렀다. 잠시 후 종이 울린다… 방을 나가 숨어라.', 4500);
    g.rpc('objective', 'broadcast');
    this.after(12, () => {
      S.flags.bellPending = false;
      S.flags.bellRung = true;
      g.rpc('bell', 0.8);
      g.noise(58.5, fy(2), 7, 9999, 'bell');
      const t = g.teacher;
      t.setRoute('f3');
      if (t.active && t.floor === 2) t.hear(58.5, fy(2), 7, 9999, 'bell');
    });
  }

  pullCurtain() {
    this.act('curtain');
  }

  hostCurtain(actor) {
    const g = this.game;
    if (S.flags.curtain) return;
    S.flags.curtain = true;
    if (g.world.curtainMesh) g.world.curtainMesh.visible = false;
    g.rpcTo(actor, 'play', 'paper', { gain: 0.5, rate: 0.7 });
    g.rpcTo(actor, 'toast', '커튼 뒤에는 아무도 없다.');
    this.after(2.2, () => g.rpcTo(actor, 'quietScare'));
  }

  exitDoor() {
    this.act('exit');
  }

  hostExit(actor) {
    const g = this.game;
    if (!S.keys.frontKey) {
      g.rpcTo(actor, 'play', 'metal', { gain: 0.4, pos: [36, 1, 0.5] });
      g.rpcTo(actor, 'toast', '쇠사슬로 단단히 잠겨 있다.');
      return;
    }
    S.flags.frontOpen = true;
    S.flags.ended = true;
    g.rpc('play', 'unlock', { gain: 1 });
    g.rpc('play', 'metal', { gain: 0.8 });
    g.rpc('ending');
  }

  // ------------------------------------------------------------------ scares
  hideGhost() {
    this.ghost.root.visible = false;
    this.ghostLight.intensity = 0;
    this.ghostMode = null;
  }

  /** JS #1 (host): lights die, a face fills the storage-room door window — for everybody. */
  hostPhoneScare(actor) {
    const g = this.game;
    if (S.flags.js1) return;
    S.flags.js1 = true;
    g.rpcTo(actor, 'phoneUI', true);
    g.rpcTo(actor, 'play', 'phone', { gain: 0.7 });
    this.after(2.6, () => {
      g.rpcTo(actor, 'phoneUI', false);
      g.rpc('blackout', true);
      g.rpc('play', 'click', { gain: 0.8 });
    });
    this.after(3.4, () => {
      g.rpc('ghostWindow', true);
      g.rpc('play', 'stinger', { gain: 1.0 });
      g.rpc('flash', 180);
      g.rpc('shake', 1);
    });
    this.after(4.9, () => {
      g.rpc('ghostWindow', false);
      g.rpc('blackout', false);
      g.rpc('play', 'click', { gain: 0.8 });
      g.rpcTo(actor, 'toast', '…이제 나가자.', 3000);
      this.checkpoint('cp_phone', true, this.playerOf(actor));
    });
  }

  ghostWindow(on) {
    if (!on) { this.hideGhost(); return; }
    const gh = this.ghost.root;
    gh.scale.setScalar(1.8);
    gh.position.set(67.4, fy(2) - 2.6, 2.7);
    gh.rotation.y = 0;
    gh.visible = true;
    this.ghostLight.position.set(67.1, fy(2) + 1.7, 3.9);
    this.ghostLight.intensity = 16;
    this.ghostMode = 'window';
  }

  /** JS #2 (only for the person who pulled the curtain): he is standing in the doorway, gone when you look. */
  quietScare() {
    const g = this.game;
    const gh = this.ghost.root;
    gh.scale.setScalar(1);
    gh.position.set(22, 0, 3.7);
    gh.rotation.y = 0; // facing +z, toward the beds
    gh.visible = true;
    this.ghostMode = 'watch';
    this.ghostT = 0;
    this.ghostSeen = 0;
    g.audio.play('stingerSoft', { gain: 0.9 });
  }

  updateGhost(dt) {
    if (this.ghostMode !== 'watch') return;
    const g = this.game;
    const p = g.player;
    this.ghostT += dt;
    const to = new THREE.Vector3(this.ghost.root.position.x - p.pos.x, 0, this.ghost.root.position.z - p.pos.z).normalize();
    const f = p.forward();
    f.y = 0; f.normalize();
    if (to.dot(f) > 0.78) this.ghostSeen += dt; else this.ghostSeen = Math.max(0, this.ghostSeen - dt);
    if (this.ghostSeen > 0.35 || this.ghostT > 6) {
      this.hideGhost();
      g.audio.play('doorClose', { gain: 0.5, rate: 0.6 });
    }
  }

  // ------------------------------------------------------------------ final chase (host)
  startFinalChase() {
    const g = this.game;
    if (S.flags.finalStarted) return;
    S.flags.finalStarted = true;
    g.rpc('minBattery', 40);
    g.rpc('objective', 'escape');
    this.checkpoint('cp_safe', true, this.playerOf(this.safeActor || g.net.myId));
    g.rpc('play', 'stinger', { gain: 1 });
    g.rpc('pa', BROADCAST.chase);
    g.rpc('flash', 200);
    g.rpc('shake', 1);
    this.after(1.2, () => this.finalChaseTeacher());
  }

  finalChaseTeacher() {
    const g = this.game;
    const t = g.teacher;
    t.reset();
    t.activate(true);
    t.placeAtNode('W_L0', Math.PI / 2);
    t.setRoute('f1office');
    t.grace = 0;
    t.noDetect = false;
    g.rpc('play3d', 'slam', [-2, 1.5, 1.5], 1);
    g.rpc('play', 'boom', { gain: 0.6 });
    t.startChase(true);
  }

  // ------------------------------------------------------------------ first sight, tutorial, triggers
  /** The teacher walks into 2-1 and calls the roll while the players have to hide. */
  startAttendance() {
    const g = this.game;
    const t = g.teacher;
    S.flags.attendStarted = true;
    t.reset();
    t.activate(true);
    t.placeAtNode('C_1_4', -Math.PI / 2);
    t.grace = 0;
    g.rpc('hint', '복도에서 발소리와 출석 부르는 소리가 가까워진다…', 5000);
    this.after(6, () => g.rpc('hint', '숨어라! 사물함이나 책상 근처에서 [E]', 9000));
    t.runScript([
      { go: 'D_1_1', speed: 2.0 },
      { go: 'R_1_1', speed: 1.2 },
      { go: 'P_1_1', speed: 1.1 },
      { wait: 1.2, face: 0 },
      { lines: ['1번.', '2번.', '3번.', '…', '15번.', '16번.', '17번.', '17번…?', '17번, 대답해.'], gap: 1.5 },
      { wait: 1.5, face: 0 },
      { go: 'D_1_1', speed: 1.3 },
      { go: 'C_1_2', speed: 1.3 },
    ], {
      detect: true,
      done: () => {
        S.flags.attendDone = true;
        t.setRoute('f2');
        t.startPatrol();
        g.rpc('hint', '선생님은 이제 복도를 순찰한다.', 4500);
      },
    });
  }

  buildTriggers() {
    const g = this.game;
    const T = this.triggers;
    const add = (o) => T.push({ once: true, done: false, ...o });

    // leaving the start room: first glimpse of the teacher far away
    add({
      id: 'leaveStart', f: 1, x0: 28, x1: 35, z0: 0, z1: 2.8,
      cond: () => !!S.keys.flashlight,
      fn: (p) => {
        S.flags.firstSight = true;
        this.checkpoint('cp_start', false, p);
        const t = g.teacher;
        t.reset();
        t.activate(true);
        t.placeAtNode('C_1_6', Math.PI / 2);
        t.runScript([
          { wait: 1.0, face: Math.PI / 2 },
          { go: 'C_1_7', speed: 1.1 },
          { go: 'D_1_7', speed: 1.0 },
          { call: () => { t.activate(false); } },
        ], { detect: false });
        g.rpc('objective', 'corridor');
        this.after(3, () => g.rpc('voice', '…17번.', 0.6));
        this.after(6, () => g.rpc('hint', '복도 끝을 지나가는 그림자… 소리를 죽이고 움직이자. (Shift 달리기는 소리가 크다)', 8000));
      },
    });

    // 2-1: the attendance scene (hiding tutorial)
    add({
      id: 'room21', f: 1, x0: 9.5, x1: 17.5, z0: 3.4, z1: 10.6,
      cond: () => !g.teacher.active && !S.flags.attendDone,
      fn: () => this.startAttendance(),
    });

    // safety net: if nobody ever goes into 2-1, the teacher starts patrolling anyway
    add({
      id: 'attendFallback', f: 1, x0: 0, x1: 72, z0: 0, z1: 11,
      cond: () => S.flags.firstSight && !S.flags.attendDone && !g.teacher.active && S.time > 0,
      fn: () => {
        this.after(150, () => {
          if (S.flags.attendDone || g.teacher.state === 'scripted') return;
          S.flags.attendDone = true;
          this.respawnTeacher();
        });
      },
    });

    // lab entered
    add({
      id: 'lab', f: 1, x0: 54, x1: 63, z0: 3.4, z1: 10.6,
      fn: (p) => { if (!S.keys.fuse && !S.collected.fuse) g.rpc('objective', 'lab'); this.checkpoint('cp_lab', true, p); },
    });

    // arrival on 3F
    add({
      id: 'arrive3F', f: 2, x0: 0, x1: 72, z0: 0, z1: 11,
      fn: (p) => {
        S.flags.reached3F = true;
        this.checkpoint('cp_3f', false, p);
        this.after(5, () => g.rpc('pa', BROADCAST.f3_arrive));
        if (!S.flags.power) g.rpc('hint', '3층은 정전이다. 복도 배전함에 퓨즈를 끼워야 한다.', 7000);
        g.teacher.relocateWhenUnseen('CW_2', 'f3guard', { delay: 22, heading: Math.PI / 2 });
      },
    });

    // arrival on 1F
    add({
      id: 'arrive1F', f: 0, x0: 0, x1: 72, z0: 0, z1: 11,
      fn: (p) => {
        S.flags.reached1F = true;
        this.checkpoint('cp_1f', false, p);
        if (S.keys.officeKey) g.rpc('objective', 'office');
        this.after(4, () => g.rpc('pa', BROADCAST.f1_arrive));
        g.teacher.relocateWhenUnseen('CE_0', 'f1', { delay: 18, heading: -Math.PI / 2 });
      },
    });

    // quiet scares / ambience
    const amb = (id, f, x0, x1, z0, z1, fn) => add({ id, f, x0, x1, z0, z1, fn, ambient: true });
    amb('amb_chalk', 1, 18, 27, 3.4, 10.6, () => g.rpc('play3d', 'chalk', [22.5, fy(1) + 1.5, 10.5], 0.9));
    amb('amb_locker', 1, 44, 52, 0, 2.8, () => g.rpc('play3d', 'slam', [20, fy(1) + 1, 0.5], 0.7, 1.2));
    amb('amb_knock', 2, 14, 24, 0, 2.8, () => { [0, 0.5, 1.0].forEach((d) => this.after(d, () => g.rpc('play3d', 'knock', [22, fy(2) + 1.2, 3.2], 1.0))); });
    amb('amb_door', 2, 36, 46, 0, 2.8, () => {
      const d = g.world.doorAt(2, 2);
      if (d && d.open) g.world.setDoor(d, false);
      else g.rpc('play3d', 'creak', [22, fy(2) + 1, 3], 0.8);
    });
    amb('amb_static', 0, 26, 34, 0, 2.8, () => { g.rpc('play', 'static', { gain: 0.5 }); g.rpc('play', 'murmur', { gain: 0.5, rate: 0.7 }); });
    amb('amb_steps', 0, 48, 56, 0, 2.8, () => g.rpc('play3d', 'stepHeavy', [40, fy(0) + 0.2, 1.5], 0.5));
  }

  checkTriggers() {
    const g = this.game;
    for (const p of g.allPlayers()) {
      if (p.hidden || p.downed) continue;
      const f = p.floor;
      for (const tr of this.triggers) {
        if (tr.done || tr.f !== f) continue;
        if (p.pos.x < tr.x0 || p.pos.x > tr.x1 || p.pos.z < tr.z0 || p.pos.z > tr.z1) continue;
        if (tr.cond && !tr.cond()) continue;
        tr.done = true;
        tr.fn(p);
      }
    }
  }

  /** Flags must be re-armed on a new game. */
  resetTriggers() {
    for (const tr of this.triggers) tr.done = false;
  }

  /** After loading a save, re-arm only the triggers that have not been satisfied yet. */
  rearmTriggers() {
    const done = {
      leaveStart: !!S.flags.firstSight,
      room21: !!S.flags.attendStarted || !!S.flags.attendDone,
      attendFallback: !!S.flags.attendDone,
      lab: !!(S.keys.fuse || S.collected.fuse),
      arrive3F: !!S.flags.reached3F,
      arrive1F: !!S.flags.reached1F,
    };
    for (const tr of this.triggers) tr.done = tr.ambient ? false : !!done[tr.id];
  }
}
