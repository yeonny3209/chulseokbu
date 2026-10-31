// Furniture, hiding places, items and story props for every room and corridor.
import * as THREE from 'three';
import { ROOMS, CORRIDOR_HIDES, MOD_W, BLD_W, fy, doorX } from './layout.js';
import { boardTexture, clockTexture, chartTexture, paperTexture, plateTexture } from './textures.js';
import { S, settings } from './state.js';
import { CFG } from './config.js';

const TIER_MAX = { story: 3, easy: 3, normal: 3, hard: 1 }; // how many batteries are placed

export function furnish(world) {
  const g = world.game;
  const tierMax = TIER_MAX[settings.difficulty] || 2;

  const ctx = (f, m, room) => ({
    w: world, f, m, room, y0: fy(f),
    X: (lx) => m * MOD_W + lx,
    Z: (lz) => 3 + lz,
  });

  // ---------------------------------------------------------------- primitives
  const solid = (b) => { world.solids.push(b); };

  function decal(tex, x, y, z, w, h, face, emissive = 0.06) {
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: emissive });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    if (face === '-z') m.rotation.y = Math.PI;
    else if (face === '+x') m.rotation.y = Math.PI / 2;
    else if (face === '-x') m.rotation.y = -Math.PI / 2;
    world.group.add(m);
    return m;
  }

  function studentDesk(c, lx, lz) {
    const x = c.X(lx), z = c.Z(lz), y = c.y0;
    world.box('wood', x - 0.3, y + 0.72, z - 0.23, x + 0.3, y + 0.76, z + 0.23, 0);
    for (const [dx, dz] of [[-0.27, -0.2], [0.27, -0.2], [-0.27, 0.2], [0.27, 0.2]]) {
      world.box('metal', x + dx - 0.015, y, z + dz - 0.015, x + dx + 0.015, y + 0.72, z + dz + 0.015, 0);
    }
    world.box('wood', x - 0.2, y + 0.42, z - 0.72, x + 0.2, y + 0.45, z - 0.34, 0);
    world.box('wood', x - 0.2, y + 0.45, z - 0.74, x + 0.2, y + 0.85, z - 0.71, 0);
    solid({ min: [x - 0.3, y, z - 0.74], max: [x + 0.3, y + 0.8, z + 0.23] });
  }

  function classDesks(c, opts = {}) {
    const cols = [1.2, 2.7, 6.3, 7.8];
    const rows = opts.rows || [2.6, 3.9, 5.2, 6.5];
    let n = 0;
    for (const lz of rows) {
      for (const lx of cols) {
        n++;
        if (opts.sparse && n % 3 === 0) continue;
        studentDesk(c, lx, lz);
      }
    }
  }

  function podium(c, lx = 4.5, lz = 7.3) {
    const x = c.X(lx), z = c.Z(lz), y = c.y0;
    world.box('wood', x - 0.75, y + 0.74, z - 0.35, x + 0.75, y + 0.79, z + 0.35, 0);
    world.box('wood', x - 0.72, y, z - 0.32, x + 0.72, y + 0.74, z + 0.32, 2);
    return { x, z, top: y + 0.8 };
  }

  function board(c, lines, opts) {
    return decal(boardTexture(lines, opts), c.X(4.5), c.y0 + 1.6, 11 - 0.12, 3.8, 1.35, '-z', 0.07);
  }

  /** Locker. dirZ=+1: against a wall at zWall facing +z; dirZ=-1: facing -z. */
  function locker(f, x, zWall, dirZ, hide = null) {
    const y = fy(f);
    const z0 = dirZ > 0 ? zWall : zWall - 0.5;
    const z1 = dirZ > 0 ? zWall + 0.5 : zWall;
    world.box('metal', x - 0.35, y, z0, x + 0.35, y + 2.0, z1, 2);
    const fz = dirZ > 0 ? zWall + 0.505 : zWall - 0.505;
    const mat = new THREE.MeshStandardMaterial({ map: world.T.locker, roughness: 0.6, metalness: 0.2 });
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 1.96), mat);
    door.position.set(x, y + 1.0, fz);
    if (dirZ < 0) door.rotation.y = Math.PI;
    world.group.add(door);
    if (hide) {
      world.addHide({
        id: hide, f, kind: 'locker', x, z: zWall + 0.25 * dirZ,
        cam: { x, y: y + 1.5, z: zWall + 0.25 * dirZ },
        yaw: dirZ > 0 ? Math.PI : 0,
        exit: { x, z: zWall + 1.2 * dirZ },
        tx: x, ty: y + 1.0, tz: zWall + 0.9 * dirZ, range: 1.9,
      });
    }
  }

  function lockerBank(f, xc, zWall, dirZ, hideId) {
    locker(f, xc - 0.72, zWall, dirZ);
    locker(f, xc, zWall, dirZ, hideId);
    locker(f, xc + 0.72, zWall, dirZ);
  }

  /** Teacher-desk hiding place: crouch under it, look out through the knee hole. */
  function deskHide(c, id, lx = 4.5, lz = 7.3, yaw = 0) {
    const x = c.X(lx), z = c.Z(lz), y = c.y0;
    world.box('wood', x - 0.8, y + 0.72, z - 0.4, x + 0.8, y + 0.78, z + 0.4, 0);
    world.box('wood', x - 0.8, y, z - 0.4, x - 0.7, y + 0.72, z + 0.4, 0);
    world.box('wood', x + 0.7, y, z - 0.4, x + 0.8, y + 0.72, z + 0.4, 0);
    world.box('wood', x - 0.7, y, z + 0.3, x + 0.7, y + 0.72, z + 0.4, 0);
    solid({ min: [x - 0.8, y, z - 0.4], max: [x + 0.8, y + 0.78, z + 0.4] });
    world.addHide({
      id, f: c.f, kind: 'desk', x, z,
      cam: { x, y: y + 0.55, z: z - 0.05 }, yaw,
      exit: { x, z: z - 1.1 },
      tx: x, ty: y + 0.6, tz: z - 0.9, range: 1.6,
    });
  }

  function longTable(c, lx, lz, len = 2.4, h = 0.78) {
    const x = c.X(lx), z = c.Z(lz), y = c.y0;
    world.box('wood', x - len / 2, y + h - 0.05, z - 0.4, x + len / 2, y + h, z + 0.4, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      world.box('metal', x + sx * (len / 2 - 0.1) - 0.03, y, z + sz * 0.33 - 0.03, x + sx * (len / 2 - 0.1) + 0.03, y + h - 0.05, z + sz * 0.33 + 0.03, 0);
    }
    solid({ min: [x - len / 2, y, z - 0.4], max: [x + len / 2, y + h, z + 0.4] });
  }

  function crate(c, x, z, s = 0.8, h = 0.8) {
    world.box('wood', x - s / 2, c.y0, z - s / 2, x + s / 2, c.y0 + h, z + s / 2, 2);
  }

  function shelf(c, x0, z0, x1, z1, h = 2.0) {
    const y = c.y0;
    world.box('wood', x0, y, z0, x1, y + h, z1, 2);
  }

  function addClock(c, wallLx, y = 2.35) {
    decal(clockTexture(CFG.clockTime), c.X(wallLx), c.y0 + y, c.Z(0.13), 0.4, 0.4, '+z');
  }

  const addItem = (def) => world.addItem(def);
  const bat = (id, tier, f, x, yy, z, label = '건전지') => {
    if (tier > tierMax) return;
    addItem({ id, type: 'battery', f, x, y: fy(f) + yy, z, label, kind: 'battery' });
  };
  const thr = (id, type, f, x, yy, z) => {
    const label = { chalk: '분필 상자', can: '빈 캔', slipper: '실내화' }[type];
    addItem({ id, type, f, x, y: fy(f) + yy, z, label, kind: 'throw', rot: Math.random() * 3 });
  };

  // ---------------------------------------------------------------- room builders
  const B = {};

  B.class = (c) => {
    classDesks(c, { sparse: !!c.room.empty });
    podium(c);
    board(c, c.room.empty ? ['', '        …'] : ['오늘의 급훈', '  성실 · 정직 · 협동'], { size: 28 });
    decal(plateTexture('성실 · 정직', { size: 24, bg: '#c9b78a' }), c.X(4.5), c.y0 + 2.4, 11 - 0.12, 1.2, 0.34, '-z', 0.08);
    addClock(c, 8.2);
  };

  B.toilet = (c) => {
    const { w, f } = c;
    const y = c.y0;
    // three stalls along the back wall
    for (let i = 0; i < 3; i++) {
      const x0 = c.X(1.8 + i * 1.9);
      w.box('metal', x0 - 0.95, y + 0.3, c.Z(5.0), x0 - 0.91, y + 1.9, 11 - 0.1, 2);
      w.box('metal', x0 + 0.91, y + 0.3, c.Z(5.0), x0 + 0.95, y + 1.9, 11 - 0.1, 2);
      w.box('metal', x0 - 0.91, y + 0.3, c.Z(5.0), x0 + 0.91, y + 1.9, c.Z(5.04), 2);
      w.box('white', x0 - 0.2, y, 11 - 0.7, x0 + 0.2, y + 0.4, 11 - 0.25, 2);
    }
    const mid = c.X(1.8 + 1.9);
    w.addHide({
      id: `stall_${f}_${c.m}`, f, kind: 'stall', x: mid, z: 10.0,
      cam: { x: mid, y: y + 1.15, z: 10.1 }, yaw: 0,
      exit: { x: mid, z: c.Z(3.6) },
      tx: mid, ty: y + 1.0, tz: c.Z(3.9), range: 2.0,
    });
    // sinks + a mirror that shows nothing
    for (let i = 0; i < 3; i++) w.box('white', c.X(0.12), y + 0.8, c.Z(1.4 + i * 1.1), c.X(0.5), y + 0.9, c.Z(2.1 + i * 1.1), 2);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.1), new THREE.MeshStandardMaterial({ color: 0x030508, roughness: 0.08, metalness: 0.95 }));
    mirror.rotation.y = Math.PI / 2;
    mirror.position.set(c.X(0.12), y + 1.65, c.Z(2.8));
    w.group.add(mirror);
    w.addInteract({
      id: `mirror_${f}_${c.m}`, f, x: c.X(0.6), y: y + 1.5, z: c.Z(2.8), range: 2.4,
      prompt: () => '거울 [E]',
      use: () => {
        S.flags.mirrorSeen = true;
        g.ui.toast('거울을 들여다본다. 아무것도 비치지 않는다.');
        g.audio.play('chalk', { gain: 0.25 });
        g.events.mirrorLook();
      },
    });
    if (c.room.sign === '여자화장실') {
      w.addNote(4, f, c.X(0.7), y + 0.93, c.Z(2.2), { flat: true, lines: ['하늘아 어디 있어', '하늘아 어디 있어', '하늘아 어디 있어'] });
    }
  };

  B.lab = (c) => {
    const y = c.y0;
    for (const lz of [2.8, 5.0]) for (const lx of [2.0, 5.0, 7.3]) longTable(c, lx, lz, 2.0, 0.9);
    board(c, ['실험 일지', '날짜: ____', '(사건이 일어난 날을 적을 것)'], { size: 26 });
    // reagent cabinet with a dial lock on the east wall
    const cx = c.X(8.75), cz = c.Z(6.0);
    world.box('metal', c.X(8.3), y, cz - 0.9, c.X(8.9), y + 1.9, cz + 0.9, 2);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.7), new THREE.MeshStandardMaterial({ color: 0x4d5b57, roughness: 0.5, metalness: 0.4 }));
    door.rotation.y = -Math.PI / 2;
    door.position.set(c.X(8.29), y + 1.0, cz);
    world.group.add(door);
    world.addInteract({
      id: 'labcab', f: c.f, x: c.X(8.0), y: y + 1.2, z: cz, range: 2.4,
      prompt: () => (S.keys.fuse || S.collected.fuse ? '시약장 (비어 있다)' : '시약장 — 번호 자물쇠 [E]'),
      enabled: () => true,
      use: () => g.events.openLabCabinet(),
    });
    world.addNote(3, c.f, c.X(5.0), y + 0.92, c.Z(2.8), { flat: true, lines: ['우리 학교 괴담', '1. 10시 17분에', '2. 대답하면 안 된다', '3. 빛을 싫어한다'] });
    addClock(c, 1.0);
  };

  B.prep = (c) => {
    const y = c.y0;
    shelf(c, c.X(0.3), c.Z(6.4), c.X(8.7), c.Z(7.2), 1.0);
    shelf(c, c.X(0.3), c.Z(0.8), c.X(0.9), c.Z(5.4), 1.9);
    crate(c, c.X(6.5), c.Z(2.4), 0.8, 0.6);
    crate(c, c.X(7.6), c.Z(2.8), 0.7, 0.5);
    void y;
  };

  B.music = (c) => {
    const y = c.y0;
    // grand piano body
    world.box('black', c.X(1.0), y, c.Z(5.4), c.X(3.2), y + 0.95, c.Z(7.6), 2);
    for (const lz of [1.6, 2.8]) for (const lx of [4.5, 6.0, 7.5]) {
      world.box('wood', c.X(lx) - 0.2, y + 0.42, c.Z(lz) - 0.2, c.X(lx) + 0.2, y + 0.46, c.Z(lz) + 0.2, 0);
      solid({ min: [c.X(lx) - 0.2, y, c.Z(lz) - 0.2], max: [c.X(lx) + 0.2, y + 0.85, c.Z(lz) + 0.2] });
    }
    board(c, ['♪', '5선 위의 이름들'], { size: 28 });
    c.pianoTop = y + 0.97;
  };

  B.library = (c) => {
    const y = c.y0;
    for (const lx of [1.2, 2.4, 5.6, 6.8]) shelf(c, c.X(lx), c.Z(0.9), c.X(lx) + 0.45, c.Z(6.5), 2.1);
    shelf(c, c.X(7.8), c.Z(4.0), c.X(8.7), c.Z(4.6), 1.0); // counter
    world.addNote(5, c.f, c.X(8.3), y + 1.02, c.Z(4.3), { flat: true, lines: ['[대출 기록]', '2학년 3반 17번', '이하늘', '미반납'] });
    thr('thr_lib', 'slipper', c.f, c.X(4.0), 0.05, c.Z(7.4));
  };

  B.broadcast = (c) => {
    const y = c.y0;
    // console desk
    world.box('metal', c.X(2.0), y, c.Z(5.8), c.X(7.0), y + 0.95, c.Z(6.8), 2);
    world.box('black', c.X(2.4), y + 0.95, c.Z(5.9), c.X(6.6), y + 1.1, c.Z(6.6), 0);
    world.box('wood', c.X(1.0), y, c.Z(1.2), c.X(1.5), y + 1.6, c.Z(2.6), 2);
    // ON AIR light
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.25), new THREE.MeshBasicMaterial({ map: plateTexture('ON AIR', { bg: '#7a0b0b', fg: '#ffd0d0', size: 44 }), color: 0xdd2222 }));
    sign.position.set(c.X(4.5), y + 2.3, c.Z(0.12));
    world.group.add(sign);
    const red = new THREE.PointLight(0xff2020, 3.5, 7, 2);
    red.position.set(c.X(4.5), y + 2.2, c.Z(0.7));
    world.group.add(red);
    world.addInteract({
      id: 'bell', f: c.f, x: c.X(4.5), y: y + 1.1, z: c.Z(5.2), range: 2.4,
      prompt: () => (S.flags.bellPending ? '종이 울린다…' : '교내 종 버튼 [E]'),
      enabled: () => !!S.flags.power,
      use: () => g.events.pressBell(),
    });
    world.addNote(6, c.f, c.X(3.0), y + 1.12, c.Z(6.2), { flat: true, lines: ['11/13 (금) 방송부', '장비 창고 정리', '하늘이 혼자 남음', '말했는데… 들었을까.'] });
  };

  B.storage = (c) => {
    const y = c.y0;
    shelf(c, c.X(0.3), c.Z(0.8), c.X(0.9), c.Z(7.4), 2.0);
    shelf(c, c.X(8.1), c.Z(0.8), c.X(8.7), c.Z(7.4), 2.0);
    crate(c, c.X(5.5), c.Z(6.0), 0.8, 0.8);
    crate(c, c.X(6.5), c.Z(3.4), 0.7, 0.5);
    world.addNote(7, c.f, c.X(4.6), y + 0.0 + 0.02, c.Z(5.2), { flat: true, lines: ['선생님 문 잠그지 마세요', '아직 안에 있어요', '…계단 불이 꺼졌어요'] });
    addItem({ id: 'phone', type: 'phone', f: c.f, x: c.X(5.5), y: y + 0.83, z: c.Z(6.0), label: '낡은 휴대폰', kind: 'phone' });
  };

  B.office = (c) => {
    const y = c.y0;
    for (const lz of [2.6, 4.6]) for (const lx of [2.2, 6.8]) {
      world.box('metal', c.X(lx) - 0.7, y + 0.7, c.Z(lz) - 0.4, c.X(lx) + 0.7, y + 0.76, c.Z(lz) + 0.4, 0);
      world.box('metal', c.X(lx) - 0.7, y, c.Z(lz) - 0.4, c.X(lx) - 0.6, y + 0.7, c.Z(lz) + 0.4, 0);
      world.box('metal', c.X(lx) + 0.6, y, c.Z(lz) - 0.4, c.X(lx) + 0.7, y + 0.7, c.Z(lz) + 0.4, 0);
      solid({ min: [c.X(lx) - 0.7, y, c.Z(lz) - 0.4], max: [c.X(lx) + 0.7, y + 0.76, c.Z(lz) + 0.4] });
    }
    world.addNote(10, c.f, c.X(6.8), y + 0.78, c.Z(4.6), { flat: true, lines: ['11월 13일.', '올해도 출석을 불렀다.', '17번만 대답이 없다.', '문을 잠그기 전에…'] });
    addClock(c, 7.6, 2.2);
    // safe by the west wall, close to the door (short run for the final chase)
    const sx = c.X(0.5), sz = c.Z(2.0);
    world.box('metal', sx - 0.35, y, sz - 0.4, sx + 0.35, y + 0.8, sz + 0.4, 2);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 14), new THREE.MeshStandardMaterial({ color: 0xcfa24a, emissive: 0x6a4a10, roughness: 0.4, metalness: 0.7 }));
    dial.rotation.z = Math.PI / 2;
    dial.position.set(sx + 0.36, y + 0.5, sz);
    world.group.add(dial);
    world.addInteract({
      id: 'safe', f: c.f, x: sx + 0.8, y: y + 0.5, z: sz, range: 2.3,
      prompt: () => (S.flags.safeOpen ? '금고 (비어 있다)' : '금고 — 다이얼 [E]'),
      use: () => g.events.openSafe(),
    });
    // office speakers
    world.box('black', c.X(4.3), y + 2.5, 11 - 0.25, c.X(4.7), y + 2.8, 11 - 0.1, 0);
  };

  B.admin = (c) => {
    classDesks(c, { sparse: true, rows: [2.6, 4.5] });
    podium(c, 4.5, 7.0);
  };

  B.infirm = (c) => {
    const y = c.y0;
    for (let i = 0; i < 3; i++) {
      const x0 = c.X(1.0 + i * 2.6);
      world.box('white', x0, y + 0.3, c.Z(4.2), x0 + 0.95, y + 0.55, c.Z(6.4), 2);
      world.box('metal', x0, y, c.Z(4.2), x0 + 0.06, y + 0.3, c.Z(4.26), 0);
      // curtain
      const cur = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.8), new THREE.MeshStandardMaterial({ color: 0x5a6f78, roughness: 1, side: THREE.DoubleSide }));
      cur.position.set(x0 + 0.5, y + 1.3, c.Z(3.5));
      world.group.add(cur);
    }
    world.box('metal', c.X(7.6), y, c.Z(1.2), c.X(8.7), y + 1.8, c.Z(1.7), 2);
    world.addNote(9, c.f, c.X(1.45), y + 0.57, c.Z(5.3), { flat: true, lines: ['처방 메모', '윤석진 (51세)', '수면제 14일분', '"아이가 대답한다"'] });
    // the curtain around the middle bed: pulling it back is the 2nd scare
    const cur = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), new THREE.MeshStandardMaterial({ color: 0x66808a, roughness: 1, side: THREE.DoubleSide }));
    cur.position.set(c.X(4.1), y + 1.25, c.Z(3.6));
    world.group.add(cur);
    world.curtainMesh = cur;
    world.addInteract({
      id: 'curtain', f: c.f, x: c.X(4.1), y: y + 1.2, z: c.Z(3.0), range: 2.2,
      prompt: () => '커튼 걷기 [E]',
      enabled: () => !S.flags.curtain,
      use: () => g.events.pullCurtain(cur),
    });
  };

  B.canteen = (c) => {
    for (const lz of [2.4, 4.2, 6.0]) for (const lx of [2.4, 6.6]) longTable(c, lx, lz, 3.2, 0.75);
    world.addNote(12, c.f, c.X(2.4), c.y0 + 0.77, c.Z(4.2), { flat: true, lines: ['수빈아, 나 방송부', '끝나고 갈게. 먼저 가.', '— 하늘'] });
  };

  B.boiler = (c) => {
    const y = c.y0;
    world.box('metal', c.X(1.0), y, c.Z(1.0), c.X(3.0), y + 2.4, c.Z(3.0), 2);
    world.box('metal', c.X(5.0), y, c.Z(4.0), c.X(8.0), y + 1.6, c.Z(6.5), 2);
  };

  // ---------------------------------------------------------------- build all rooms
  for (let f = 0; f < 3; f++) {
    ROOMS[f].forEach((room, m) => {
      const c = ctx(f, m, room);
      B[room.type]?.(c);
      room.ctx = c;
    });
  }

  // ---------------------------------------------------------------- hiding places in rooms
  const rc = (f, m) => ROOMS[f][m].ctx;
  lockerBank(1, rc(1, 1).X(7.6), 11, -1, 'lk_2f_room1');
  deskHide(rc(1, 4), 'dh_2f_m4', 4.5, 7.3);
  lockerBank(2, rc(2, 0).X(7.6), 11, -1, 'lk_3f_room0');
  deskHide(rc(2, 4), 'dh_3f_m4', 4.5, 7.3);
  deskHide(rc(2, 5), 'dh_3f_m5', 4.5, 7.3);
  deskHide(rc(0, 4), 'dh_1f_m4', 4.5, 7.3);
  deskHide(rc(0, 5), 'dh_1f_m5', 4.5, 7.3);

  // ---------------------------------------------------------------- corridors
  for (let f = 0; f < 3; f++) {
    const y = fy(f);
    CORRIDOR_HIDES[f].forEach((x, i) => lockerBank(f, x, 0, +1, `lk_${f}_c${i}`));
    // clock in each corridor
    decal(clockTexture(CFG.clockTime), f === 1 ? 18 : f === 2 ? 54 : 46, y + 2.3, 0.115, 0.45, 0.45, '+z');
  }
  // 2F landmarks
  world.addFixture({ f: 1, x: 44, y: fy(1) + 1.25, z: 0.45, w: 1.3, d: 0.3, color: 0x39c28c, base: 0.55, exit: true });
  world.addFixture({ f: 0, x: 36, y: 2.4, z: 0.3, w: 0.9, d: 0.15, color: 0x38e070, base: 0.9, exit: true });

  // note 2 on the 2F corridor board
  decal(boardTexture(['  게시판', '', ' 가정통신문', ' 2016년 3월호'], { size: 24, lh: 36 }), 24, fy(1) + 1.5, 0.115, 1.8, 0.8, '+z', 0.15);
  world.addNote(2, 1, 24, fy(1) + 1.0, 0.13, { flat: false, lines: ['가정통신문', '2015년 11월 13일', '실종 신고', '이름: ■■■'] });

  // breaker box on the 3F corridor wall
  const bx = 58, by = fy(2) + 1.5;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.16), new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.5, metalness: 0.5 }));
  box.position.set(bx, by, 0.2);
  world.group.add(box);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: 0xaa2222 }));
  lamp.position.set(bx, by + 0.3, 0.29);
  world.group.add(lamp);
  world.addInteract({
    id: 'breaker', f: 2, x: bx, y: by, z: 0.5, range: 2.4,
    prompt: () => (S.flags.power ? '배전함 (작동 중)' : S.keys.fuse ? '퓨즈 끼우기 [E]' : '배전함 — 퓨즈가 없다'),
    use: () => g.events.useBreaker(),
  });

  // shutter (west stair, 2F -> 1F) and fallen desks (east stair) block the way down
  const shutterMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 1.5), new THREE.MeshStandardMaterial({ color: 0x555a5e, roughness: 0.6, metalness: 0.6 }));
  shutterMesh.position.set(-0.15, fy(1) + 1.2, 2.25);
  world.group.add(shutterMesh);
  world.addGate({ id: 'shutter', min: [-0.35, fy(1), 1.5], max: [-0.0, fy(1) + 2.4, 3.0], mesh: shutterMesh, isActive: () => !S.flags.shutterOpen });
  const desksMesh = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.75, 0.5), world.mats.wood);
    d.position.set(BLD_W + 0.35 + (i % 2) * 0.1, fy(1) + 0.38 + Math.floor(i / 2) * 0.7, 1.7 + i * 0.25);
    d.rotation.set(Math.random() * 0.5, Math.random() * 3, Math.random() * 0.5);
    desksMesh.add(d);
  }
  world.group.add(desksMesh);
  world.addGate({ id: 'desks', min: [BLD_W - 0.0, fy(1), 1.5], max: [BLD_W + 0.7, fy(1) + 2.4, 3.0], mesh: desksMesh, isActive: () => true });

  // fallen bookshelf in the 1F corridor for the final chase
  const shelfMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.0), world.mats.wood);
  shelfMesh.position.set(22.5, 0.9, 2.45);
  shelfMesh.rotation.z = 0.35;
  world.group.add(shelfMesh);
  world.solids.push({ min: [21.8, 0, 1.95], max: [23.2, 1.5, 3.0] }); // leaves a 1.8 m gap along the south wall

  // entrance doors (chained)
  const doorL = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.4, metalness: 0.5 }));
  doorL.position.set(35.25, 1.25, 0);
  const doorR = doorL.clone();
  doorR.position.set(36.75, 1.25, 0);
  const chain = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 0.14), new THREE.MeshStandardMaterial({ color: 0x777b7f, roughness: 0.3, metalness: 0.9 }));
  chain.position.set(36, 1.2, 0.1);
  const frontGrp = new THREE.Group();
  frontGrp.add(doorL, doorR, chain);
  world.group.add(frontGrp);
  world.addGate({ id: 'front', min: [34.5, 0, -0.15], max: [37.5, 2.6, 0.15], mesh: frontGrp, isActive: () => !S.flags.frontOpen, los: true });
  world.addInteract({
    id: 'frontdoor', f: 0, x: 36, y: 1.2, z: 0.6, range: 2.6,
    prompt: () => (S.keys.frontKey ? '현관 열기 [E]' : '현관문 — 쇠사슬로 잠겨 있다'),
    use: () => g.events.exitDoor(),
  });

  // stairwell mirror on the first landing
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.5), new THREE.MeshStandardMaterial({ color: 0x030508, roughness: 0.08, metalness: 0.95 }));
  sm.rotation.y = Math.PI / 2;
  sm.position.set(-7.88, 1.75 + 1.6, 1.5);
  world.group.add(sm);
  world.addInteract({
    id: 'mirror_stair', f: 0, x: -7.2, y: 1.75 + 1.6, z: 1.5, range: 1.7,
    prompt: () => '거울 [E]',
    use: () => { S.flags.mirrorSeen = true; g.ui.toast('계단참의 거울. 아무것도 비치지 않는다.'); g.events.mirrorLook(); },
  });

  // ---------------------------------------------------------------- items
  // 2F
  addItem({ id: 'flashlight', type: 'flashlight', f: 1, x: 33.3, y: fy(1) + 0.8, z: 8.2, label: '손전등', kind: 'flashlight' });
  addItem({ id: 'sciKey', type: 'key', f: 1, x: 9 + 5.3, y: fy(1) + 0.83, z: 10.3, label: '과학실 열쇠', kind: 'key', key: 'sciKey' });
  bat('bat_1', 1, 1, 24.3, 0.8, 6.9);
  bat('bat_2', 2, 1, 41.6, 0.83, 10.3);
  bat('bat_3', 3, 1, 66, 0.05, 8.2);
  bat('bat_4', 1, 1, 47, 0.05, 2.4);
  thr('thr_1', 'chalk', 1, 20, 0.05, 1.1);
  thr('thr_2', 'can', 1, 38.7, 0.8, 6.9);
  thr('thr_3', 'slipper', 1, 58, 0.05, 2.2);
  thr('thr_4', 'chalk', 1, 21.5, 0.05, 4.4);
  // 3F
  addItem({ id: 'officeKey', type: 'key', f: 2, x: 5.3, y: fy(2) + 0.83, z: 10.3, label: '교무실 열쇠', kind: 'key', key: 'officeKey' });
  bat('bat_5', 1, 2, 8, 0.05, 2.3);
  bat('bat_6', 2, 2, 15.3, 0.8, 8.2);
  bat('bat_7', 3, 2, 42.3, 0.8, 8.2);
  thr('thr_5', 'can', 2, 30, 0.05, 2.2);
  thr('thr_6', 'chalk', 2, 20, 0.05, 5.0);
  // 1F
  bat('bat_9', 2, 0, 15.3, 0.8, 7.5);
  bat('bat_11', 1, 0, 60, 0.05, 2.3);
  thr('thr_7', 'can', 0, 26, 0.05, 2.2);
  thr('thr_8', 'chalk', 0, 40.5, 0.05, 6.0);

  // note on the music-room piano and the first note in the start room
  const music = rc(2, 2);
  world.addNote(8, 2, music.X(2.2), music.pianoTop + 0.01, music.Z(6.5), { flat: true, lines: ['윤 선생님께', '이제 그만 놓아주세요', '선생님 잘못이 아니에요', '— 박 선생'] });
  const start = rc(1, 3);
  world.addNote(1, 1, start.X(1.2), fy(1) + 0.79, start.Z(3.9), { flat: true, lines: ['윤쌤 요즘 이상해', '야자 끝나도 출석을', '부른대. 17번은 꼭', '두 번씩…'] });
  // seating chart (the 17th name is scratched out) and clock
  decal(chartTexture(16), start.X(0.12), fy(1) + 1.7, start.Z(4.5), 0.9, 0.9, '+x', 0.22);
  decal(clockTexture(CFG.clockTime), start.X(0.12), fy(1) + 2.45, start.Z(2.4), 0.45, 0.45, '+x', 0.2);
}
