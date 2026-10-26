// On-screen controls for phones/tablets. They feed the same Input object the keyboard uses:
//  - drag on the left half  -> floating analog stick (move)
//  - drag on the right half -> look around
//  - buttons                -> the same keys (E, F, Q, R, Space, Shift, C, Tab, Esc)
export function isTouchDevice() {
  const ua = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  return ua || (coarse && navigator.maxTouchPoints > 0);
}

const LOOK_SPEED = 1.7; // touch pixels -> mouse-like counts
const STICK_R = 62;

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.input.touch = true;
    this.moveId = null;
    this.lookId = null;
    this.origin = { x: 0, y: 0 };
    this.last = { x: 0, y: 0 };

    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.className = 'hidden';
    root.innerHTML = `
      <div id="touch-zone"></div>
      <div id="stick-base" class="hidden"><div id="stick-knob"></div></div>
      <div id="touch-btns"></div>`;
    document.body.appendChild(root);
    this.zone = root.querySelector('#touch-zone');
    this.base = root.querySelector('#stick-base');
    this.knob = root.querySelector('#stick-knob');
    this.btns = root.querySelector('#touch-btns');

    this.bindZone();
    this.buildButtons();
    // no pinch-zoom / double-tap zoom / long-press menu while playing
    for (const ev of ['gesturestart', 'gesturechange', 'contextmenu']) document.addEventListener(ev, (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  setVisible(on) {
    this.root.classList.toggle('hidden', !on);
    if (!on) this.releaseAll();
  }

  releaseAll() {
    this.moveId = this.lookId = null;
    this.input.axisX = this.input.axisY = 0;
    this.base.classList.add('hidden');
    for (const code of ['KeyE', 'KeyR', 'Space']) this.input.keys.delete(code);
  }

  // ---------------------------------------------------------------- move / look
  bindZone() {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { z.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (e.clientX < window.innerWidth * 0.46 && this.moveId === null) {
        this.moveId = e.pointerId;
        this.origin = { x: e.clientX, y: e.clientY };
        this.base.style.left = `${e.clientX}px`;
        this.base.style.top = `${e.clientY}px`;
        this.knob.style.transform = 'translate(-50%, -50%)';
        this.base.classList.remove('hidden');
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.last = { x: e.clientX, y: e.clientY };
      }
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.moveId) {
        let dx = e.clientX - this.origin.x;
        let dy = e.clientY - this.origin.y;
        const len = Math.hypot(dx, dy);
        if (len > STICK_R) { dx = (dx / len) * STICK_R; dy = (dy / len) * STICK_R; }
        this.input.axisX = dx / STICK_R;
        this.input.axisY = dy / STICK_R;
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (e.pointerId === this.lookId) {
        this.input.dx += (e.clientX - this.last.x) * LOOK_SPEED;
        this.input.dy += (e.clientY - this.last.y) * LOOK_SPEED;
        this.last = { x: e.clientX, y: e.clientY };
      }
    });
    const up = (e) => {
      if (e.pointerId === this.moveId) {
        this.moveId = null;
        this.input.axisX = this.input.axisY = 0;
        this.base.classList.add('hidden');
      }
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    z.addEventListener('pointerup', up);
    z.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------- buttons
  buildButtons() {
    const inp = this.input;
    const make = (label, cls, kind, code) => {
      const b = document.createElement('button');
      b.className = `tbtn ${cls}`;
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        if (kind === 'hold') { inp.keys.add(code); inp.pressed.add(code); b.classList.add('on'); }
        else if (kind === 'tap') { inp.pressed.add(code); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 120); }
        else if (kind === 'toggle') {
          if (inp.keys.has(code)) { inp.keys.delete(code); b.classList.remove('on'); } else { inp.keys.add(code); b.classList.add('on'); }
        }
      });
      const release = (e) => {
        e.preventDefault();
        if (kind === 'hold') { inp.keys.delete(code); b.classList.remove('on'); }
      };
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      this.btns.appendChild(b);
      return b;
    };
    make('조사', 'act', 'hold', 'KeyE');
    make('손전등', 'torch', 'tap', 'KeyF');
    make('집중광', 'focus', 'hold', 'KeyR');
    make('던지기', 'throw', 'tap', 'KeyQ');
    make('숨 참기', 'breath', 'hold', 'Space');
    make('달리기', 'run', 'toggle', 'ShiftLeft');
    make('웅크리기', 'crouch', 'toggle', 'KeyC');
    make('소지품', 'inv', 'tap', 'Tab');
    make('메뉴', 'menu', 'tap', 'Escape');
  }
}
