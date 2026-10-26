// All textures are painted on <canvas> at startup so the game needs no image files.
// To use real photo textures later, replace the returned textures here.
import * as THREE from 'three';

export const TEX_M = 2; // meters covered by one texture repeat

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, w, h, count, minA, maxA, size = 1, dark = true) {
  for (let i = 0; i < count; i++) {
    const a = minA + Math.random() * (maxA - minA);
    ctx.fillStyle = dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

function stains(ctx, w, h, n, color) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 8 + Math.random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

export function makeTextures() {
  const T = {};

  // corridor / room floor: faded green-gray vinyl tiles
  {
    const c = cv(256, 256);
    const x = c.getContext('2d');
    const n = 4;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = 78 + Math.floor(Math.random() * 16);
        x.fillStyle = `rgb(${v - 10},${v + 4},${v - 6})`;
        x.fillRect((i * 256) / n, (j * 256) / n, 256 / n, 256 / n);
      }
    }
    x.strokeStyle = 'rgba(0,0,0,0.5)';
    x.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      x.beginPath(); x.moveTo((i * 256) / n, 0); x.lineTo((i * 256) / n, 256); x.stroke();
      x.beginPath(); x.moveTo(0, (i * 256) / n); x.lineTo(256, (i * 256) / n); x.stroke();
    }
    stains(x, 256, 256, 6, 'rgba(20,18,10,0.35)');
    speckle(x, 256, 256, 900, 0.05, 0.25, 2);
    T.floor = tex(c);
  }

  // wall: dirty off-white plaster
  {
    const c = cv(256, 256);
    const x = c.getContext('2d');
    x.fillStyle = '#9d9a8b';
    x.fillRect(0, 0, 256, 256);
    stains(x, 256, 256, 10, 'rgba(60,50,30,0.30)');
    stains(x, 256, 256, 4, 'rgba(255,255,255,0.10)');
    speckle(x, 256, 256, 1400, 0.03, 0.18, 2);
    x.fillStyle = 'rgba(30,50,40,0.35)'; // dado paint band
    x.fillRect(0, 150, 256, 50);
    T.wall = tex(c);
  }

  // ceiling tile
  {
    const c = cv(256, 256);
    const x = c.getContext('2d');
    x.fillStyle = '#8c8a7e';
    x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(0,0,0,0.5)';
    x.lineWidth = 3;
    x.strokeRect(0, 0, 256, 256);
    x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 256); x.moveTo(0, 128); x.lineTo(256, 128); x.stroke();
    stains(x, 256, 256, 5, 'rgba(70,55,20,0.4)');
    speckle(x, 256, 256, 700, 0.05, 0.2, 2);
    T.ceil = tex(c);
  }

  // concrete (stairs, slab edges)
  {
    const c = cv(256, 256);
    const x = c.getContext('2d');
    x.fillStyle = '#6f6e68';
    x.fillRect(0, 0, 256, 256);
    stains(x, 256, 256, 12, 'rgba(0,0,0,0.25)');
    speckle(x, 256, 256, 1800, 0.05, 0.25, 2);
    T.concrete = tex(c);
  }

  // wood (desks, doors, shelves)
  {
    const c = cv(256, 256);
    const x = c.getContext('2d');
    x.fillStyle = '#6b4a2e';
    x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) {
      x.strokeStyle = `rgba(${20 + Math.random() * 30},${10 + Math.random() * 20},0,${0.1 + Math.random() * 0.25})`;
      x.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * 256;
      x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(80, y + Math.random() * 10 - 5, 170, y + Math.random() * 10 - 5, 256, y); x.stroke();
    }
    speckle(x, 256, 256, 500, 0.05, 0.2, 2);
    T.wood = tex(c);
  }

  // door: darker painted wood
  {
    const c = cv(128, 256);
    const x = c.getContext('2d');
    x.fillStyle = '#5a3c26';
    x.fillRect(0, 0, 128, 256);
    x.strokeStyle = 'rgba(0,0,0,0.5)';
    x.lineWidth = 4;
    x.strokeRect(14, 14, 100, 90);
    x.strokeRect(14, 120, 100, 122);
    speckle(x, 128, 256, 600, 0.05, 0.25, 2);
    T.door = tex(c, false);
  }

  // locker: grey-green metal with slits
  {
    const c = cv(128, 256);
    const x = c.getContext('2d');
    x.fillStyle = '#3e4d43';
    x.fillRect(0, 0, 128, 256);
    x.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < 6; i++) x.fillRect(24, 22 + i * 9, 80, 3);
    x.fillStyle = '#9a9a8c';
    x.fillRect(100, 124, 8, 24);
    x.strokeStyle = 'rgba(0,0,0,0.6)';
    x.lineWidth = 4;
    x.strokeRect(2, 2, 124, 252);
    stains(x, 128, 256, 5, 'rgba(60,30,10,0.35)');
    speckle(x, 128, 256, 500, 0.05, 0.3, 2);
    T.locker = tex(c, false);
  }

  // dull metal
  {
    const c = cv(128, 128);
    const x = c.getContext('2d');
    x.fillStyle = '#585b5e';
    x.fillRect(0, 0, 128, 128);
    speckle(x, 128, 128, 700, 0.05, 0.3, 2);
    T.metal = tex(c);
  }

  // black glass / mirror that shows nothing
  {
    const c = cv(64, 64);
    const x = c.getContext('2d');
    x.fillStyle = '#05070a';
    x.fillRect(0, 0, 64, 64);
    speckle(x, 64, 64, 80, 0.05, 0.1, 1, false);
    T.mirror = tex(c, false);
  }

  return T;
}

/** Generic text painter used by boards, plates, posters. */
export function paintTexture(w, h, draw) {
  const c = cv(w, h);
  draw(c.getContext('2d'), w, h);
  return tex(c, false);
}

export function boardTexture(lines = [], opts = {}) {
  return paintTexture(512, 192, (x, w, h) => {
    x.fillStyle = '#1f3a2e';
    x.fillRect(0, 0, w, h);
    stains(x, w, h, 14, 'rgba(255,255,255,0.08)');
    x.fillStyle = 'rgba(235,235,225,0.85)';
    x.textAlign = opts.align || 'left';
    x.font = `${opts.size || 30}px 'Malgun Gothic', sans-serif`;
    const px = opts.align === 'center' ? w / 2 : 22;
    lines.forEach((ln, i) => x.fillText(ln, px, 48 + i * (opts.lh || 38)));
    // chalk smudges
    x.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 40; i++) x.fillRect(Math.random() * w, Math.random() * h, 40, 2);
    x.strokeStyle = '#6b4a2e';
    x.lineWidth = 10;
    x.strokeRect(0, 0, w, h);
  });
}

export function plateTexture(text, opts = {}) {
  return paintTexture(256, 96, (x, w, h) => {
    x.fillStyle = opts.bg || '#d9d6c4';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#333';
    x.lineWidth = 4;
    x.strokeRect(2, 2, w - 4, h - 4);
    x.fillStyle = opts.fg || '#222';
    x.font = `bold ${opts.size || 40}px 'Malgun Gothic', sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2 + 2);
  });
}

export function paperTexture(lines, opts = {}) {
  return paintTexture(256, 256, (x, w, h) => {
    x.fillStyle = opts.bg || '#cfc8aa';
    x.fillRect(0, 0, w, h);
    stains(x, w, h, 4, 'rgba(90,70,30,0.25)');
    x.fillStyle = '#2d2a20';
    x.font = `${opts.size || 17}px 'Malgun Gothic', sans-serif`;
    lines.forEach((ln, i) => x.fillText(ln, 14, 30 + i * 22));
  });
}

export function clockTexture(time = '10:17') {
  return paintTexture(128, 128, (x, w, h) => {
    x.fillStyle = '#d9d6c8';
    x.beginPath(); x.arc(64, 64, 62, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#222'; x.lineWidth = 5; x.stroke();
    x.fillStyle = '#222';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      x.fillRect(64 + Math.sin(a) * 52 - 2, 64 - Math.cos(a) * 52 - 2, 4, 4);
    }
    const [hh, mm] = time.split(':').map(Number);
    const ha = (((hh % 12) + mm / 60) / 12) * Math.PI * 2;
    const ma = (mm / 60) * Math.PI * 2;
    x.lineWidth = 6;
    x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.sin(ha) * 30, 64 - Math.cos(ha) * 30); x.stroke();
    x.lineWidth = 3;
    x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.sin(ma) * 46, 64 - Math.cos(ma) * 46); x.stroke();
  });
}

export function chartTexture(erasedIndex = 16) {
  // seating chart: the 17th name is scratched out
  return paintTexture(256, 256, (x, w, h) => {
    x.fillStyle = '#d6d1bb';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#222';
    x.font = "bold 16px 'Malgun Gothic'";
    x.fillText('2학년 3반 자리 배치표', 14, 24);
    const names = ['김민', '이도', '박서', '최우', '정하', '한결', '오준', '윤아', '서진', '강호', '임솔', '송이', '배건', '류하', '문별', '신우', '이하늘', '조은', '권도', '남예'];
    x.font = "13px 'Malgun Gothic'";
    for (let i = 0; i < 20; i++) {
      const cx = 14 + (i % 4) * 60;
      const cy = 48 + Math.floor(i / 4) * 40;
      x.strokeStyle = '#555';
      x.strokeRect(cx, cy, 54, 30);
      if (i === erasedIndex) {
        x.fillStyle = '#d6d1bb';
        x.fillRect(cx + 1, cy + 1, 52, 28);
        x.fillStyle = 'rgba(80,80,80,0.5)';
        for (let k = 0; k < 8; k++) x.fillRect(cx + 4 + Math.random() * 40, cy + 6 + Math.random() * 14, 8, 2);
      } else {
        x.fillStyle = '#222';
        x.fillText(names[i], cx + 6, cy + 20);
      }
    }
  });
}

export function glowTexture(color = '255,255,255') {
  return paintTexture(64, 64, (x, w, h) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${color},1)`);
    g.addColorStop(1, `rgba(${color},0)`);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

export function faceTexture(kind = 'ghoul') {
  return paintTexture(256, 256, (x, w, h) => {
    if (kind === 'ghoul') {
      x.fillStyle = '#9b988c'; // pale, dead skin
      x.fillRect(0, 0, w, h);
      stains(x, w, h, 14, 'rgba(0,0,0,0.35)');
      x.fillStyle = '#020202'; // empty eye sockets
      x.beginPath(); x.ellipse(82, 108, 24, 34, 0.15, 0, 7); x.fill();
      x.beginPath(); x.ellipse(174, 108, 24, 34, -0.15, 0, 7); x.fill();
      x.fillStyle = '#1a0606'; // thin long mouth
      x.beginPath(); x.ellipse(128, 190, 54, 8, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.5)';
      x.lineWidth = 3;
      x.beginPath(); x.moveTo(128, 120); x.lineTo(122, 160); x.stroke();
    } else {
      x.fillStyle = '#c9a98a'; // the real, tired old man
      x.fillRect(0, 0, w, h);
      stains(x, w, h, 10, 'rgba(90,50,30,0.25)');
      x.fillStyle = '#2a2018';
      x.beginPath(); x.arc(86, 112, 8, 0, 7); x.fill();
      x.beginPath(); x.arc(170, 112, 8, 0, 7); x.fill();
      x.strokeStyle = '#6b4a35'; x.lineWidth = 4;
      x.beginPath(); x.moveTo(98, 196); x.quadraticCurveTo(128, 186, 158, 196); x.stroke();
      x.lineWidth = 2;
      for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(60, 72 + i * 6); x.lineTo(110, 72 + i * 6); x.stroke(); x.beginPath(); x.moveTo(146, 72 + i * 6); x.lineTo(196, 72 + i * 6); x.stroke(); }
    }
  });
}
