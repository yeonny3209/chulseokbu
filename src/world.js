// Builds the school (walls, floors, stairs, doors, lights) from layout.js and answers
// physics questions (ground height, collision, line of sight).
// Furniture and story props are added by rooms.js through the helpers below.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';
import { makeTextures, TEX_M, plateTexture, paperTexture, glowTexture } from './textures.js';
import { ROOMS, FLOOR_H as H, MOD_W, N_MOD, BLD_W, fy, doorX } from './layout.js';
import { S } from './state.js';
import { clamp, segHitsBox } from './util.js';

const WALL_T = 0.1; // half thickness

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.T = makeTextures();
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.blockers = []; // walls & slabs: block movement and sight
    this.solids = []; // furniture & steps: block movement only
    this.dyn = []; // doors & gates (have .active)
    this.walk = []; // walkable surfaces
    this.buckets = {};
    this.doors = [];
    this.gates = [];
    this.interacts = [];
    this.hides = [];
    this.items = [];
    this.fixtures = [];
    this.notesMeshes = {};
    this.lightPool = [];
    this.flickerT = 0;

    const T = this.T;
    const std = (map, rough = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: rough, ...extra });
    this.mats = {
      wall: std(T.wall, 0.95),
      floor: std(T.floor, 0.55),
      ceil: std(T.ceil, 1),
      concrete: std(T.concrete, 1),
      wood: std(T.wood, 0.8),
      metal: std(T.metal, 0.5, { metalness: 0.35 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.6 }),
      win: new THREE.MeshBasicMaterial({ color: 0x0b121c }),
      cloth: new THREE.MeshStandardMaterial({ color: 0x6d6a60, roughness: 1 }),
      white: new THREE.MeshStandardMaterial({ color: 0xaaa89a, roughness: 0.9 }),
      green: new THREE.MeshStandardMaterial({ color: 0x2c4235, roughness: 0.9 }),
    };
    this.texM = { wall: TEX_M, floor: TEX_M, ceil: TEX_M, concrete: TEX_M, wood: 1.2, metal: 1.5, black: 1, win: 1, cloth: 1, white: 1, green: 1 };
  }

  // ------------------------------------------------------------------ geometry helpers
  _geo(bucket, geo) {
    (this.buckets[bucket] ||= []).push(geo);
  }

  /** Axis-aligned box. collide: 0 none, 1 blocker (movement+sight), 2 solid (movement only). */
  box(bucket, x0, y0, z0, x1, y1, z1, collide = 1) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const m = this.texM[bucket] || 2;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, (uv.getX(k) * dims[f][0]) / m, (uv.getY(k) * dims[f][1]) / m);
      }
    }
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this._geo(bucket, g);
    const b = { min: [x0, y0, z0], max: [x1, y1, z1] };
    if (collide === 1) this.blockers.push(b);
    else if (collide === 2) this.solids.push(b);
    return b;
  }

  /** Horizontal plane. up=true faces +y (floor), false faces -y (ceiling). */
  plane(bucket, x0, z0, x1, z1, y, up = true) {
    const w = x1 - x0, d = z1 - z0;
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    const uv = g.attributes.uv;
    const m = this.texM[bucket] || 2;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / m, (uv.getY(i) * d) / m);
    g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    this._geo(bucket, g);
  }

  /** Vertical plane on a wall. nz: +1 faces +z, -1 faces -z. */
  vplane(bucket, cx, cy, cz, w, h, nz = 1) {
    const g = new THREE.PlaneGeometry(w, h);
    if (nz < 0) g.rotateY(Math.PI);
    g.translate(cx, cy, cz);
    this._geo(bucket, g);
  }

  /** Dynamic collider with an active flag (doors, gates). */
  addDyn(min, max, opts = {}) {
    const d = { min, max, active: opts.active ?? true, los: opts.los ?? true };
    this.dyn.push(d);
    return d;
  }

  /** A walkable top surface (axis aligned). */
  addWalk(minX, maxX, minZ, maxZ, top) {
    this.walk.push({ minX, maxX, minZ, maxZ, top });
  }

  mesh(geo, mat, x, y, z, opts = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (opts.ry) m.rotation.y = opts.ry;
    if (opts.rx) m.rotation.x = opts.rx;
    m.castShadow = opts.cast ?? true;
    m.receiveShadow = true;
    (opts.parent || this.group).add(m);
    return m;
  }

  // ------------------------------------------------------------------ shell
  build() {
    this.buildSlabs();
    for (let f = 0; f < 3; f++) this.buildFloorWalls(f);
    this.buildStairwell('W');
    this.buildStairwell('E');
    this.buildDoors();
    this.buildFixtures();
    this.buildLightPool();
  }

  buildSlabs() {
    for (let s = 0; s <= 3; s++) {
      const top = s * H;
      this.box('concrete', -0.1, top - 0.5, -0.1, BLD_W + 0.1, top, 11.1, 1);
      if (s <= 2) {
        this.addWalk(0, BLD_W, 0, 11, top);
        this.plane('floor', 0, 0, BLD_W, 11, top + 0.002, true);
      }
      if (s >= 1) this.plane('ceil', 0, 0, BLD_W, 11, top - 0.5 - 0.002, false);
    }
  }

  buildFloorWalls(f) {
    const y0 = fy(f);
    const y1 = y0 + CFG.wallH;
    const t = WALL_T;
    // south wall (corridor outside); entrance gap on 1F
    if (f === 0) {
      this.box('wall', -t, y0, -t, 34.5, y1, t);
      this.box('wall', 37.5, y0, -t, BLD_W + t, y1, t);
      this.box('wall', 34.5, y0 + 2.6, -t, 37.5, y1, t); // lintel over entrance
    } else {
      this.box('wall', -t, y0, -t, BLD_W + t, y1, t);
    }
    // back wall
    this.box('wall', -t, y0, 11 - t, BLD_W + t, y1, 11 + t);
    // corridor / room wall with door openings
    for (let m = 0; m < N_MOD; m++) {
      const x0 = m * MOD_W;
      const dx0 = x0 + 3.5;
      const dx1 = x0 + 4.5;
      this.box('wall', x0 - (m === 0 ? t : 0), y0, 3 - t, dx0, y1, 3 + t);
      this.box('wall', dx1, y0, 3 - t, x0 + MOD_W + (m === N_MOD - 1 ? t : 0), y1, 3 + t);
      this.box('wall', dx0, y0 + CFG.doorH, 3 - t, dx1, y1, 3 + t);
    }
    // walls between rooms
    for (let m = 0; m <= N_MOD; m++) {
      const x = m * MOD_W;
      this.box('wall', x - t, y0, 3 + t, x + t, y1, 11 - t);
    }
    // moonlit windows (decor only)
    for (let m = 0; m < N_MOD; m++) {
      for (const dx of [2.2, 6.8]) {
        this.vplane('win', m * MOD_W + dx, y0 + 1.75, t + 0.01, 1.5, 1.2, 1);
        this.vplane('win', m * MOD_W + dx, y0 + 1.75, 11 - t - 0.01, 1.5, 1.2, -1);
      }
    }
  }

  buildStairwell(side) {
    const mx = side === 'W' ? (x) => x : (x) => BLD_W - x; // mirror x for the east side
    const bx = (x0, x1) => (side === 'W' ? [x0, x1] : [BLD_W - x1, BLD_W - x0]);
    const t = WALL_T;
    const top = 3 * H;
    // outer walls, full height
    let [a, b] = bx(-8 - t, 0);
    this.box('wall', a, -0.5, -t, b, top, t);
    this.box('wall', a, -0.5, 3 - t, b, top, 3 + t);
    [a, b] = bx(-8 - t, -8 + t);
    this.box('wall', a, -0.5, -t, b, top, 3 + t);
    // ground slab and roof
    [a, b] = bx(-8, 0);
    this.box('concrete', a, -0.5, 0, b, 0, 3, 1);
    this.addWalk(a, b, 0, 3, 0);
    this.plane('floor', a, 0, b, 3, 0.002, true);
    this.box('concrete', a - t, top - 0.5, -t, b, top, 3 + t, 1);
    this.plane('ceil', a, 0, b, 3, top - 0.5 - 0.002, false);

    for (let f = 0; f < 2; f++) {
      const y0 = fy(f);
      const mid = y0 + 1.75;
      // landing
      [a, b] = bx(-8, -6);
      this.box('concrete', a, mid - 0.3, 0, b, mid, 3, 2);
      this.addWalk(a, b, 0, 3, mid);
      this.plane('floor', a, 0, b, 3, mid + 0.002, true);
      for (let i = 1; i <= 10; i++) {
        // flight A: floor f -> landing, along z 0..1.5, heading away from the corridor
        const topA = y0 + (1.75 * i) / 10;
        [a, b] = bx(-i * 0.6, -(i - 1) * 0.6);
        this.box('concrete', a, topA - 1.0, 0, b, topA, 1.5, 2);
        this.addWalk(a, b, 0, 1.5, topA);
        // flight B: landing -> floor f+1, along z 1.5..3, heading toward the corridor
        const topB = mid + (1.75 * i) / 10;
        [a, b] = bx(-6 + (i - 1) * 0.6, -6 + i * 0.6);
        this.box('concrete', a, topB - 1.0, 1.5, b, topB, 3, 2);
        this.addWalk(a, b, 1.5, 3, topB);
      }
      void mx;
    }
    // a faint green exit sign at the corridor end of each floor
    for (let f = 0; f < 3; f++) {
      const x = side === 'W' ? 1.2 : BLD_W - 1.2;
      this.addFixture({ f, x, y: fy(f) + 2.55, z: 1.5, w: 0.5, d: 0.12, color: 0x38e070, base: 0.9, exit: true });
    }
  }

  buildDoors() {
    const T = this.T;
    for (let f = 0; f < 3; f++) {
      const y0 = fy(f);
      ROOMS[f].forEach((room, m) => {
        const hx = m * MOD_W + 3.5;
        const id = `d_${f}_${m}`;
        const grp = new THREE.Group();
        grp.position.set(hx, y0, 3);
        const doorMat = new THREE.MeshStandardMaterial({ map: T.door, roughness: 0.8, color: room.rusty ? 0x8a5a3a : 0xffffff });
        if (room.window) {
          const parts = [
            [1.0, 1.2, 0.06, 0.5, 0.6],
            [1.0, 0.15, 0.06, 0.5, 1.975],
            [0.2, 0.7, 0.06, 0.1, 1.55],
            [0.2, 0.7, 0.06, 0.9, 1.55],
          ];
          for (const [w, h, d, px, py] of parts) {
            const mm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), doorMat);
            mm.position.set(px, py, 0);
            mm.castShadow = true;
            grp.add(mm);
          }
          const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.7), new THREE.MeshBasicMaterial({ color: 0x0a1018, transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
          glass.position.set(0.5, 1.55, 0);
          grp.add(glass);
        } else {
          const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.05, 0.06), doorMat);
          panel.position.set(0.5, 1.025, 0);
          panel.castShadow = true;
          panel.receiveShadow = true;
          grp.add(panel);
        }
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.12), this.mats.metal);
        handle.position.set(0.9, 1.0, 0);
        grp.add(handle);
        this.group.add(grp);

        const col = this.addDyn([hx, y0, 3 - 0.08], [hx + 1.0, y0 + CFG.doorH, 3 + 0.08]);
        const door = { id, f, m, room, group: grp, lock: room.lock || null, rusty: !!room.rusty, ang: 0, open: false, col, cx: doorX(m), cz: 3, y0 };
        this.doors.push(door);

        // sign above the door (corridor side)
        const plate = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 0.34),
          new THREE.MeshStandardMaterial({ map: plateTexture(room.sign, { size: room.sign.length > 5 ? 30 : 40 }), roughness: 0.8, emissive: 0x1a1a1a, emissiveMap: null }),
        );
        plate.material.emissiveMap = plate.material.map;
        plate.position.set(doorX(m), y0 + 2.45, 3 - 0.12);
        plate.rotation.y = Math.PI;
        this.group.add(plate);

        // interaction
        this.interacts.push({
          id,
          f,
          x: door.cx,
          y: y0 + 1.3,
          z: 3.0,
          range: 2.4,
          margin: 0.4,
          prompt: () => this.doorPrompt(door),
          use: () => this.useDoor(door),
        });
      });
    }
  }

  isLocked(door) {
    if (!door.lock) return false;
    if (S.doorUnlocked[door.id]) return false;
    if (door.lock === 'power') return !S.flags.power;
    if (door.lock === 'storage') return !S.flags.storageOpen;
    return true;
  }

  doorPrompt(door) {
    if (door.open) return '문 닫기 [E]';
    if (this.isLocked(door)) {
      if (door.lock === 'never') return '굳게 잠겨 있다';
      if (door.lock === 'power') return '전자 잠금 — 전원이 꺼져 있다';
      if (door.lock === 'storage') return '잠겨 있다';
      return S.keys[door.lock] ? '열쇠로 열기 [E]' : '잠겨 있다 (열쇠 필요)';
    }
    return '문 열기 [E]';
  }

  /** Player pressed E on a door. The host decides what happens (multiplayer-safe). */
  useDoor(door) {
    this.game.events.act('door', { id: door.id });
  }

  /** Host only: open/close/unlock a door on behalf of `actor`. */
  doorAction(door, actor) {
    const g = this.game;
    if (door.open) {
      this.setDoor(door, false, true);
      return;
    }
    if (this.isLocked(door)) {
      if (door.lock && S.keys[door.lock] && door.lock !== 'never') {
        S.doorUnlocked[door.id] = true;
        g.rpcTo(actor, 'toast', '열쇠로 문을 열었다.');
        g.rpc('play3d', 'unlock', [door.cx, door.y0 + 1, 3], 1);
        this.setDoor(door, true, true);
        return;
      }
      g.rpc('play3d', 'rattle', [door.cx, door.y0 + 1, 3], 0.8);
      g.noise(door.cx, door.y0 + 1, 3, CFG.noise.locked);
      g.rpcTo(actor, 'toast', door.lock === 'never' ? '굳게 잠겨 있다. 열리지 않는다.' : '잠겨 있다.');
      return;
    }
    this.setDoor(door, true, true);
  }

  setDoor(door, open, byPlayer = false, instant = false) {
    if (door.open === open && !instant) return;
    door.open = open;
    S.doorOpen[door.id] = open;
    door.col.active = !open;
    if (instant) {
      door.ang = open ? -Math.PI / 2 : 0;
      door.group.rotation.y = door.ang;
    }
    if (!instant) {
      const pos = [door.cx, door.y0 + 1.0, 3];
      this.game.audio.play(door.rusty && open ? 'creakHeavy' : open ? 'creak' : 'doorClose', { pos });
      if (byPlayer) this.game.noise(door.cx, door.y0 + 1, 3, door.rusty ? CFG.noise.doorRusty : CFG.noise.door);
    }
  }

  doorAt(f, m) {
    return this.doors.find((d) => d.f === f && d.m === m);
  }

  // ------------------------------------------------------------------ fixtures & lights
  addFixture({ f, x, y, z, w = 1.3, d = 0.18, color = 0xcfe6d8, base = 1, gate = null, flick = false, exit = false, on = true }) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), mat);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    const fx = { f, x, y, z, mesh, mat, color: new THREE.Color(color), base, gate, flick, exit, on, phase: Math.random() * 100, cur: 0 };
    this.fixtures.push(fx);
    return fx;
  }

  buildFixtures() {
    const onSets = { 1: [1, 3, 5, 7], 2: [0, 1, 2, 3, 4, 5, 6, 7], 0: [0, 2, 4, 6] };
    for (let f = 0; f < 3; f++) {
      for (let m = 0; m < N_MOD; m++) {
        const isOn = onSets[f].includes(m);
        this.addFixture({
          f, x: m * MOD_W + 4.5, y: fy(f) + 2.96, z: 1.5,
          on: isOn, gate: f === 2 ? 'power' : null, flick: m % 2 === 1, base: 0.9,
        });
      }
    }
  }

  buildLightPool() {
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xcfe6d8, 0, 13, 2);
      l.castShadow = false;
      this.scene.add(l);
      this.lightPool.push(l);
    }
  }

  fixtureOn(fx) {
    if (!fx.on) return false;
    if (fx.gate && !S.flags[fx.gate]) return false;
    if (S.flags.blackout && !fx.exit) return false; // scare blackout: every light dies (green exit signs stay)
    return true;
  }

  updateLights(dt, px, pz, pf) {
    this.flickerT += dt;
    const near = [];
    for (const fx of this.fixtures) {
      let level = this.fixtureOn(fx) ? fx.base : 0;
      if (level > 0 && fx.flick) {
        const n = Math.sin(this.flickerT * 31 + fx.phase) * Math.sin(this.flickerT * 7.3 + fx.phase * 2);
        if (n > 0.78) level *= 0.15;
        else level *= 0.92 + 0.08 * Math.sin(this.flickerT * 55 + fx.phase);
      }
      fx.cur = level;
      fx.mat.color.copy(fx.color).multiplyScalar(level * (fx.exit ? 0.9 : 1.6));
      if (level > 0 && (fx.f === pf || fx.exit)) {
        const d = Math.hypot(fx.x - px, fx.z - pz);
        if (d < 26) near.push({ fx, d });
      }
    }
    near.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.lightPool.length; i++) {
      const l = this.lightPool[i];
      const n = near[i];
      if (!n) { l.intensity = 0; continue; }
      const fx = n.fx;
      l.position.set(fx.x, fx.y - 0.25, fx.z);
      l.color.copy(fx.color);
      l.distance = fx.exit ? 9 : 13;
      l.intensity = (fx.exit ? 5 : 26) * fx.cur;
    }
  }

  // ------------------------------------------------------------------ finalize
  finalize() {
    for (const [bucket, list] of Object.entries(this.buckets)) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      const m = new THREE.Mesh(merged, this.mats[bucket]);
      m.castShadow = bucket !== 'win';
      m.receiveShadow = true;
      this.group.add(m);
    }
    this.buckets = {};
  }

  setShadows(on) {
    this.group.traverse((o) => { if (o.isMesh) o.castShadow = on && o.castShadow !== false ? true : false; });
  }

  // ------------------------------------------------------------------ registries used by rooms.js
  addInteract(o) {
    this.interacts.push({ range: 2.3, ...o });
    return o;
  }

  addGate({ id, min, max, mesh, isActive, los = false }) {
    const col = this.addDyn(min, max, { los });
    const g = { id, col, mesh, isActive };
    this.gates.push(g);
    return g;
  }

  addHide(h) {
    this.hides.push(h);
    this.interacts.push({
      id: h.id, f: h.f, x: h.tx ?? h.x, y: h.ty ?? 1.0, z: h.tz ?? h.z, range: h.range ?? 1.9,
      prompt: () => '숨기 [E]',
      use: () => this.game.player.enterHide(h),
      enabled: () => !this.game.player.hidden,
    });
    return h;
  }

  /** Pickup item registered with an interact entry. */
  addItem(def) {
    const mesh = this.makeItemMesh(def);
    mesh.position.set(def.x, def.y, def.z);
    this.group.add(mesh);
    const item = { ...def, mesh };
    this.items.push(item);
    this.interacts.push({
      id: def.id, f: def.f, x: def.x, y: def.y + 0.1, z: def.z, range: 2.2,
      enabled: () => !S.collected[def.id],
      prompt: () => `줍기: ${def.label}`,
      use: () => this.game.events.pickup(item),
    });
    return item;
  }

  makeItemMesh(def) {
    const grp = new THREE.Group();
    const glow = (c, k = 0.35) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.5, metalness: 0.3 });
    let m;
    switch (def.type) {
      case 'key': {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 14), glow(0xd8b44a, 0.5));
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.012), glow(0xd8b44a, 0.5));
        shaft.position.x = 0.08;
        ring.rotation.x = Math.PI / 2;
        grp.add(ring, shaft);
        break;
      }
      case 'battery':
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.13, 10), glow(0x6a9a3a, 0.45));
        m.rotation.z = Math.PI / 2;
        grp.add(m);
        break;
      case 'fuse':
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 8), glow(0xe8d8a0, 0.6));
        m.rotation.z = Math.PI / 2;
        grp.add(m);
        break;
      case 'chalk':
        grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.1), glow(0xe8e4d4, 0.25)));
        break;
      case 'can':
        grp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.11, 10), glow(0x9aa4aa, 0.3)));
        break;
      case 'slipper':
        grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.1), glow(0x3a5fa0, 0.3)));
        break;
      case 'book':
        grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.3), glow(0x7a1f1f, 0.35)));
        break;
      case 'flashlight':
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.2, 10), glow(0x2f3438, 0.4));
        m.rotation.z = Math.PI / 2;
        grp.add(m);
        break;
      case 'phone':
        grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.14), glow(0x1c2630, 0.6)));
        break;
      default:
        grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), glow(0xffffff)));
    }
    grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    if (def.rot) grp.rotation.y = def.rot;
    // a faint glint so important items can be spotted in the dark
    const glint = { flashlight: 0.55, key: 0.4, fuse: 0.4, phone: 0.35, book: 0.35 }[def.type];
    if (glint) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex ||= glowTexture('255,235,190'), blending: THREE.AdditiveBlending, transparent: true, opacity: glint, depthWrite: false }));
      sp.scale.setScalar(0.16);
      sp.position.y = 0.06;
      grp.add(sp);
    }
    return grp;
  }

  /** Paper note prop. flat: lying on a surface; otherwise stuck on a wall facing +z (rotY to turn). */
  addNote(id, f, x, y, z, { flat = true, rotY = 0, lines = [] } = {}) {
    const mat = new THREE.MeshStandardMaterial({ map: paperTexture(lines.length ? lines : ['…']), roughness: 0.9, emissive: 0x2a2820, emissiveIntensity: 0.6 });
    mat.emissiveMap = mat.map;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.27), mat);
    m.position.set(x, y, z);
    if (flat) { m.rotation.x = -Math.PI / 2; m.rotation.z = rotY; } else { m.rotation.y = rotY; }
    this.group.add(m);
    this.notesMeshes[id] = m;
    this.interacts.push({
      id: `note_${id}`, f, x, y, z, range: 2.2,
      prompt: () => '쪽지 읽기 [E]',
      use: () => this.game.events.readNote(id),
    });
  }

  // ------------------------------------------------------------------ physics queries
  floorOf(y) {
    return clamp(Math.round(y / H), 0, 2);
  }

  groundAt(x, z, maxTop) {
    let best = -Infinity;
    for (const s of this.walk) {
      if (s.top <= maxTop && s.top > best && x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) best = s.top;
    }
    return best;
  }

  /** Does a body circle at (x,z) standing at `feet` with height h overlap any collider? */
  hitCircle(x, z, feet, h, r) {
    const y0 = feet + 0.35;
    const y1 = feet + h - 0.1;
    const test = (b) => {
      if (b.max[1] < y0 || b.min[1] > y1) return false;
      const cx = clamp(x, b.min[0], b.max[0]);
      const cz = clamp(z, b.min[2], b.max[2]);
      const dx = x - cx, dz = z - cz;
      return dx * dx + dz * dz < r * r;
    };
    for (const b of this.blockers) if (test(b)) return true;
    for (const b of this.solids) if (test(b)) return true;
    for (const b of this.dyn) if (b.active && test(b)) return true;
    return false;
  }

  /** Line of sight between two points (true = clear). */
  los(ax, ay, az, bx, by, bz) {
    for (const b of this.blockers) if (segHitsBox(ax, ay, az, bx, by, bz, b)) return false;
    for (const b of this.dyn) if (b.active && b.los && segHitsBox(ax, ay, az, bx, by, bz, b)) return false;
    return true;
  }

  // ------------------------------------------------------------------ per-frame & state
  update(dt, px, pz, pf) {
    for (const d of this.doors) {
      const target = d.open ? -Math.PI / 2 : 0;
      if (Math.abs(d.ang - target) > 0.001) {
        const speed = (d.rusty ? 1.6 : 3.4) * dt;
        d.ang += clamp(target - d.ang, -speed, speed);
        d.group.rotation.y = d.ang;
      }
    }
    for (const g of this.gates) {
      const on = g.isActive();
      g.col.active = on;
      if (g.mesh) g.mesh.visible = on;
    }
    this.updateLights(dt, px, pz, pf);
  }

  /** Sync visuals with the (possibly just loaded) save state. */
  applyState() {
    for (const d of this.doors) {
      const open = !!S.doorOpen[d.id];
      d.open = open;
      d.col.active = !open;
      d.ang = open ? -Math.PI / 2 : 0;
      d.group.rotation.y = d.ang;
    }
    for (const it of this.items) it.mesh.visible = !S.collected[it.id];
    if (this.curtainMesh) this.curtainMesh.visible = !S.flags.curtain;
  }

  /** Client: the host sent new shared progress — make doors/items match (animated, with sound). */
  syncFromState() {
    for (const d of this.doors) {
      const open = !!S.doorOpen[d.id];
      if (d.open !== open) this.setDoor(d, open, false);
    }
    for (const it of this.items) it.mesh.visible = !S.collected[it.id];
    if (this.curtainMesh) this.curtainMesh.visible = !S.flags.curtain;
    this.game.onSharedChanged();
  }
}
