// Waypoint graph for the teacher. Nodes sit on corridor centers, in front of doors, inside
// rooms and along the stair flights; A* finds routes (also between floors via stairs).
import { fy, MOD_W, N_MOD, BLD_W } from './layout.js';

export class Nav {
  constructor() {
    this.nodes = [];
    this.adj = new Map();
    this.byId = new Map();
    this.build();
  }

  add(id, x, y, z, f, kind) {
    const n = { id, x, y, z, f, kind };
    this.nodes.push(n);
    this.byId.set(id, n);
    this.adj.set(id, []);
    return n;
  }

  link(a, b) {
    const A = this.byId.get(a), B = this.byId.get(b);
    const d = Math.hypot(A.x - B.x, (A.y - B.y) * 1.0, A.z - B.z);
    this.adj.get(a).push({ to: b, d });
    this.adj.get(b).push({ to: a, d });
  }

  // helpers used by AI
  C = (f, m) => `C_${f}_${m}`;
  D = (f, m) => `D_${f}_${m}`;
  R = (f, m) => `R_${f}_${m}`;
  P = (f, m) => `P_${f}_${m}`;

  build() {
    for (let f = 0; f < 3; f++) {
      const y = fy(f);
      // corridor chain
      const chain = [];
      this.add(`CW_${f}`, 0.8, y, 1.5, f, 'corr');
      chain.push(`CW_${f}`);
      for (let m = 0; m < N_MOD; m++) {
        this.add(this.C(f, m), m * MOD_W + 4, y, 1.5, f, 'corr');
        chain.push(this.C(f, m));
        if (m < N_MOD - 1) {
          this.add(`M_${f}_${m}`, m * MOD_W + 8.5, y, 1.5, f, 'corr');
          chain.push(`M_${f}_${m}`);
        }
      }
      this.add(`CE_${f}`, BLD_W - 0.8, y, 1.5, f, 'corr');
      chain.push(`CE_${f}`);
      for (let i = 0; i < chain.length - 1; i++) this.link(chain[i], chain[i + 1]);

      // rooms
      for (let m = 0; m < N_MOD; m++) {
        this.add(this.D(f, m), m * MOD_W + 4, y, 3.6, f, 'door');
        this.add(this.R(f, m), m * MOD_W + 4.5, y, 6.3, f, 'room');
        this.add(this.P(f, m), m * MOD_W + 4.5, y, 8.8, f, 'room');
        this.link(this.C(f, m), this.D(f, m));
        this.link(this.D(f, m), this.R(f, m));
        this.link(this.R(f, m), this.P(f, m));
      }
    }

    // stairs: west (x<0) and east (x>72, mirrored)
    for (const side of ['W', 'E']) {
      const X = (x) => (side === 'W' ? x : BLD_W - x);
      const corrEnd = (f) => (side === 'W' ? `CW_${f}` : `CE_${f}`);
      for (let f = 0; f < 2; f++) {
        const y0 = fy(f);
        const a = [[-0.3, y0 + 0.2], [-3.3, y0 + 0.9], [-5.7, y0 + 1.7]];
        const b = [[-6.3, y0 + 1.95], [-3.0, y0 + 2.7], [-0.3, y0 + 3.45]];
        a.forEach(([x, y], i) => this.add(`${side}_A${f}_${i}`, X(x), y, 0.75, f, 'stair'));
        this.add(`${side}_L${f}`, X(-7), y0 + 1.75, 1.5, f, 'stair');
        b.forEach(([x, y], i) => this.add(`${side}_B${f}_${i}`, X(x), y, 2.25, f + 1, 'stair'));
        const chain = [corrEnd(f), `${side}_A${f}_0`, `${side}_A${f}_1`, `${side}_A${f}_2`, `${side}_L${f}`, `${side}_B${f}_0`, `${side}_B${f}_1`, `${side}_B${f}_2`, corrEnd(f + 1)];
        for (let i = 0; i < chain.length - 1; i++) this.link(chain[i], chain[i + 1]);
      }
    }
  }

  node(id) {
    return this.byId.get(id);
  }

  /** Nearest node to a 3D position (vertical distance weighs heavily). */
  nearest(x, y, z, kinds = null) {
    let best = null;
    let bd = Infinity;
    for (const n of this.nodes) {
      if (kinds && !kinds.includes(n.kind)) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2 + ((n.y - y) * 3) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** A* path as an array of node objects (inclusive). */
  path(fromId, toId) {
    if (fromId === toId) return [this.byId.get(fromId)];
    const open = new Set([fromId]);
    const came = new Map();
    const g = new Map([[fromId, 0]]);
    const goal = this.byId.get(toId);
    const h = (id) => {
      const n = this.byId.get(id);
      return Math.hypot(n.x - goal.x, (n.y - goal.y) * 2, n.z - goal.z);
    };
    const f = new Map([[fromId, h(fromId)]]);
    while (open.size) {
      let cur = null;
      let cf = Infinity;
      for (const id of open) {
        const v = f.get(id);
        if (v < cf) { cf = v; cur = id; }
      }
      if (cur === toId) {
        const out = [this.byId.get(cur)];
        while (came.has(cur)) { cur = came.get(cur); out.unshift(this.byId.get(cur)); }
        return out;
      }
      open.delete(cur);
      for (const e of this.adj.get(cur)) {
        const ng = g.get(cur) + e.d;
        if (ng < (g.get(e.to) ?? Infinity)) {
          came.set(e.to, cur);
          g.set(e.to, ng);
          f.set(e.to, ng + h(e.to));
          open.add(e.to);
        }
      }
    }
    return null;
  }
}
