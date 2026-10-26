export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function dist2D(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

/** Segment (a→b) vs axis-aligned box {min:[x,y,z], max:[x,y,z]} (slab method). */
export function segHitsBox(ax, ay, az, bx, by, bz, box) {
  let tmin = 0;
  let tmax = 1;
  const o = [ax, ay, az];
  const d = [bx - ax, by - ay, bz - az];
  for (let i = 0; i < 3; i++) {
    const mn = box.min[i];
    const mx = box.max[i];
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn || o[i] > mx) return false;
    } else {
      let t1 = (mn - o[i]) / d[i];
      let t2 = (mx - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}분 ${String(s).padStart(2, '0')}초`;
}
