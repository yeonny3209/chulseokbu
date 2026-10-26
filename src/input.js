// Keyboard + mouse state. Uses event.code so it works with a Korean IME turned on.
export class Input {
  constructor(el, game) {
    this.game = game;
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();
    this.dx = 0;
    this.dy = 0;
    this.left = false;
    this.right = false;
    this.leftClicked = false;
    this.locked = false;

    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.left = this.right = false; });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) { this.dx += e.movementX; this.dy += e.movementY; }
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.left = true; if (this.locked) this.leftClicked = true; }
      if (e.button === 2) this.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.left = false;
      if (e.button === 2) this.right = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      game.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => game.onLockChange(false, true));
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }

  lock() {
    try {
      const p = this.el.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* unsupported */ }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  endFrame() {
    this.pressed.clear();
    this.dx = 0;
    this.dy = 0;
    this.leftClicked = false;
  }
}
