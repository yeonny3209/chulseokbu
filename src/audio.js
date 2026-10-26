// Audio: every sound is synthesised at startup (no files needed). Positional sounds use
// HRTF panners so the teacher can be located with headphones. Voices use the browser TTS
// as a placeholder until real recordings exist. To use recordings later, drop .mp3/.ogg
// files in /public/sounds and load them in loadFiles().
import { CFG } from './config.js';
import { settings } from './state.js';
import { clamp, rand } from './util.js';

const R = () => Math.random() * 2 - 1;

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.buf = {};
    this.heartT = 0;
    this.voices = [];
    this.ttsOK = false;
    this.chaseLevel = 0;
    this.lastSpeak = 0;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.applyVolumes();
    this.build();
    this.startAmbience();
    this.ready = true;
    if ('speechSynthesis' in window) {
      const load = () => {
        this.voices = speechSynthesis.getVoices();
        this.ttsOK = this.voices.some((v) => v.lang && v.lang.toLowerCase().startsWith('ko'));
      };
      load();
      speechSynthesis.onvoiceschanged = load;
    }
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = settings.volMaster;
    this.sfx.gain.value = settings.volSfx;
    this.music.gain.value = settings.volMusic;
  }

  suspend() { this.ctx?.suspend(); window.speechSynthesis?.pause(); }
  resume() { this.ctx?.resume(); window.speechSynthesis?.resume(); }

  // ------------------------------------------------------------------ synthesis
  build() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const mk = (dur, fn) => {
      const n = Math.floor(sr * dur);
      const b = ctx.createBuffer(1, n, sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = fn(i / sr, i, n);
      return b;
    };
    const B = this.buf;
    const lpf = (a) => { let y = 0; return (x) => (y += (x - y) * a); };
    const saw = (hz0, f) => { let ph = 0; return (t) => { ph += (2 * Math.PI * f(t, hz0)) / sr; return ((ph / (2 * Math.PI)) % 1) * 2 - 1; }; };

    { const l = lpf(0.12); B.step = mk(0.14, (t) => l(R()) * Math.exp(-t * 38) * 2.4); }
    { const l = lpf(0.25); B.stepRun = mk(0.16, (t) => l(R()) * Math.exp(-t * 28) * 3.0); }
    { const l = lpf(0.05); B.stepHeavy = mk(0.3, (t) => (l(R()) * 4 + Math.sin(t * 2 * Math.PI * 55) * 0.6) * Math.exp(-t * 14)); }
    { const s = saw(0, (t) => 170 + 130 * t + Math.sin(t * 38) * 14); const l = lpf(0.2); B.creak = mk(0.9, (t) => (s(t) * 0.35 + l(R()) * 0.5) * Math.sin(Math.min(1, t / 0.08) * 1.57) * Math.exp(-t * 2.2)); }
    { const s = saw(0, (t) => 85 + 70 * t + Math.sin(t * 22) * 9); const l = lpf(0.1); B.creakHeavy = mk(2.0, (t) => (s(t) * 0.45 + l(R()) * 0.7) * Math.min(1, t / 0.15) * Math.exp(-t * 1.2)); }
    { const l = lpf(0.2); B.doorClose = mk(0.4, (t) => (Math.sin(t * 2 * Math.PI * 85) * 0.9 + l(R()) * 0.7) * Math.exp(-t * 14)); }
    B.unlock = mk(0.3, (t) => (t < 0.05 ? Math.sin(t * 2 * Math.PI * 1900) : t > 0.12 && t < 0.17 ? Math.sin(t * 2 * Math.PI * 1300) : 0) * Math.exp(-(t % 0.12) * 60) * 0.7);
    B.rattle = mk(0.5, (t) => R() * (((t * 14) % 1) < 0.25 ? 1 : 0.1) * Math.exp(-t * 5) * 0.8);
    B.click = mk(0.06, (t) => R() * Math.exp(-t * 90) * 0.9);
    B.pickup = mk(0.22, (t) => Math.sin(t * 2 * Math.PI * (700 + 1400 * t)) * Math.exp(-t * 14) * 0.5);
    { const l = lpf(0.35); B.paper = mk(0.35, (t) => l(R()) * Math.sin(Math.min(1, t / 0.05) * 1.57) * Math.exp(-t * 9) * 1.2); }
    B.knock = mk(0.25, (t) => (Math.sin(t * 2 * Math.PI * 130) * 0.9 + R() * 0.25) * Math.exp(-t * 22));
    B.ruler = mk(0.22, (t) => (Math.sin(t * 2 * Math.PI * 880) * 0.5 + Math.sin(t * 2 * Math.PI * 1320) * 0.3 + R() * 0.3) * Math.exp(-t * 38));
    { const h = lpf(0.9); B.chalk = mk(0.9, (t) => { const x = R(); const hp = x - h(x); return hp * (0.5 + 0.5 * Math.sin(t * 90)) * Math.sin(Math.min(1, t / 0.06) * 1.57) * Math.exp(-t * 3.2) * 0.9; }); }
    { const l = lpf(0.07); B.thud = mk(0.35, (t) => (Math.sin(t * 2 * Math.PI * 70) * 0.8 + l(R()) * 0.8) * Math.exp(-t * 16)); }
    B.can = mk(0.9, (t) => (Math.sin(t * 2 * Math.PI * 1250) + Math.sin(t * 2 * Math.PI * 1790) * 0.7 + Math.sin(t * 2 * Math.PI * 2430) * 0.5) * Math.exp(-t * 9) * 0.35 * (1 + 0.5 * Math.sin(t * 60)));
    { const l = lpf(0.03); B.whoosh = mk(0.4, (t) => l(R()) * 4 * Math.sin(t * Math.PI / 0.4) ** 2); }
    B.heart = mk(0.5, (t) => (Math.sin(t * 2 * Math.PI * 52) * Math.exp(-t * 18) + (t > 0.17 ? Math.sin((t - 0.17) * 2 * Math.PI * 46) * Math.exp(-(t - 0.17) * 20) * 0.7 : 0)) * 1.4);
    { const l = lpf(0.18); B.breathIn = mk(1.3, (t) => l(R()) * Math.sin((t / 1.3) * Math.PI) ** 2 * 0.9); B.breathOut = B.breathIn; }
    { const l = lpf(0.2); B.stinger = mk(2.2, (t) => { const n = l(R()) * 1.3; const s = (Math.sin(t * 2 * Math.PI * 233) + Math.sin(t * 2 * Math.PI * 247.5) + Math.sin(t * 2 * Math.PI * (330 - t * 60))) * 0.38; return (n + s) * Math.exp(-t * 2.0) * Math.min(1, t / 0.01); }); }
    { const l = lpf(0.1); B.stingerSoft = mk(2.6, (t) => (l(R()) * 0.6 + Math.sin(t * 2 * Math.PI * 110) * 0.6 + Math.sin(t * 2 * Math.PI * 116) * 0.5) * Math.sin(Math.min(1, t / 0.4) * 1.57) * Math.exp(-t * 1.3)); }
    { const l = lpf(0.3); B.spot = mk(0.9, (t) => (l(R()) * 0.9 + Math.sin(t * 2 * Math.PI * (2600 - 1900 * t)) * 0.6) * Math.exp(-t * 4)); }
    { const l = lpf(0.04); B.boom = mk(2.6, (t) => (Math.sin(t * 2 * Math.PI * (50 - t * 12)) * 1.1 + l(R()) * 1.2) * Math.exp(-t * 2.2)); }
    { const l = lpf(0.08); B.slam = mk(0.9, (t) => (Math.sin(t * 2 * Math.PI * 60) * 1.0 + l(R()) * 1.6) * Math.exp(-t * 7)); }
    { const bp = lpf(0.4); const hp = lpf(0.03); B.static = mk(0.8, (t) => { const x = R(); return (bp(x) - hp(x)) * 1.5 * (0.7 + 0.3 * Math.sin(t * 40)); }); }
    B.paOn = mk(0.25, (t) => (R() * 0.5 + Math.sin(t * 2 * Math.PI * 180)) * Math.exp(-t * 18) * (t < 0.03 ? 1.2 : 0.7));
    { const l = lpf(0.3); const s = saw(0, (t) => 40 + 280 * Math.min(1, t / 1.0)); B.powerOn = mk(1.8, (t) => (s(t) * 0.5 + Math.sin(t * 2 * Math.PI * 120) * 0.5) * Math.min(1, t / 0.9) * Math.exp(-Math.max(0, t - 1.0) * 5) + (t > 1.0 && t < 1.12 ? l(R()) * 2.5 : 0)); }
    { const l = lpf(0.15); B.metal = mk(1.6, (t) => (Math.sin(t * 2 * Math.PI * 330) * 0.35 + Math.sin(t * 2 * Math.PI * 541) * 0.3 + l(R()) * 1.0 * (((t * 9) % 1) < 0.5 ? 1 : 0.3)) * Math.exp(-t * 2.6)); }
    B.phone = mk(0.7, (t) => Math.sin(t * 2 * Math.PI * (t < 0.3 ? 1100 : 880)) * (((t * 7) % 1) < 0.6 ? 1 : 0) * Math.exp(-t * 2) * 0.3);
    B.murmur = mk(1.2, (t) => { const f = 105 + Math.sin(t * 5.5) * 7; return (Math.sin(t * 2 * Math.PI * f) + 0.5 * Math.sin(t * 2 * Math.PI * f * 3.1) + 0.3 * Math.sin(t * 2 * Math.PI * f * 5.2)) * Math.sin((t / 1.2) * Math.PI) * 0.4; });
    B.loopNoise = mk(4, () => R());
  }

  startAmbience() {
    const ctx = this.ctx;
    const mkLoop = (buf, type, freq, gain, q = 0.7) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.sfx);
      src.start();
      return { src, f, g };
    };
    this.windLoop = mkLoop(this.buf.loopNoise, 'bandpass', 420, 0.05, 0.6);
    mkLoop(this.buf.loopNoise, 'lowpass', 110, 0.25);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 0.035;
    lfo.connect(lg); lg.connect(this.windLoop.g.gain);
    lfo.start();
    // low drone
    for (const hz of [55, 55.8, 82.7]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = 0.03;
      o.connect(g); g.connect(this.sfx);
      o.start();
    }
    // chase layer (silent until chaseLevel rises)
    this.chaseGain = ctx.createGain();
    this.chaseGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    const tlfo = ctx.createOscillator();
    tlfo.frequency.value = 3.3;
    const tg = ctx.createGain();
    tg.gain.value = 0.3;
    tlfo.connect(tg); tg.connect(trem.gain);
    for (const hz of [55, 82.4, 58]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz;
      o.connect(lp);
      o.start();
    }
    lp.connect(trem); trem.connect(this.chaseGain); this.chaseGain.connect(this.music);
    tlfo.start();
  }

  // ------------------------------------------------------------------ playback
  /** pos: [x,y,z] for positional audio. opts: gain, rate, jitter, lp (lowpass hz), occ (0/1/2), loop */
  play(name, o = {}) {
    if (!this.ready) return null;
    const b = this.buf[name];
    if (!b) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = (o.rate || 1) * (1 + (o.jitter ?? 0.06) * R());
    src.loop = !!o.loop;
    let node = src;
    let lp = o.lp;
    let gain = o.gain ?? 1;
    if (o.occ === 1) { lp = Math.min(lp || 99999, 650); gain *= 0.55; }
    else if (o.occ === 2) { lp = Math.min(lp || 99999, 380); gain *= 0.32; }
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g);
    node = g;
    if (o.pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = o.ref ?? 2;
      p.maxDistance = 120;
      p.rolloffFactor = o.rolloff ?? 1.35;
      p.positionX.value = o.pos[0];
      p.positionY.value = o.pos[1];
      p.positionZ.value = o.pos[2];
      node.connect(p);
      node = p;
    }
    node.connect(o.bus === 'music' ? this.music : this.sfx);
    src.start();
    return { src, gain: g };
  }

  setListener(x, y, z, fx, fz) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Four-note school chime (딩동댕동). */
  bell(gain = 0.5) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.05;
    [392, 329.6, 349.2, 261.6].forEach((hz, i) => {
      for (const [mul, a] of [[1, 1], [2.01, 0.4], [2.76, 0.25], [4.1, 0.12]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = hz * 2 * mul;
        const g = ctx.createGain();
        const t0 = now + i * 0.62;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.18 * a * gain, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
        o.connect(g); g.connect(this.sfx);
        o.start(t0);
        o.stop(t0 + 1.7);
      }
    });
  }

  piano(hz, delay = 0, dur = 3.0, gain = 0.25) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    for (const [mul, a, type] of [[1, 1, 'triangle'], [2, 0.35, 'sine'], [3, 0.12, 'sine']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain * a, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.music);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    }
  }

  endingMusic() {
    const seq = [261.6, 329.6, 392, 523.3, 392, 329.6, 293.7, 349.2, 440, 587.3, 440, 349.2, 261.6, 329.6, 392, 523.3];
    seq.forEach((hz, i) => this.piano(hz, 0.4 + i * 0.9, 3.6, 0.2));
  }

  setChase(level) {
    this.chaseLevel = level;
    if (this.chaseGain) this.chaseGain.gain.setTargetAtTime(level * 0.16, this.ctx.currentTime, 0.4);
  }

  /** Heartbeat driven by fear 0..1 (call each frame). */
  heart(dt, fear) {
    if (!this.ready || fear < 0.12) { this.heartT = 0; return; }
    this.heartT -= dt;
    if (this.heartT <= 0) {
      this.play('heart', { gain: 0.35 + fear * 0.9, jitter: 0.02 });
      this.heartT = 1.05 - fear * 0.65;
    }
  }

  // ------------------------------------------------------------------ voice
  say(text, { vol = 1, pitch = 0.1, rate = 0.72, interrupt = false } = {}) {
    if (!CFG.useTTS || !('speechSynthesis' in window)) return false;
    if (!this.ttsOK) return false;
    const v = clamp(vol * settings.volVoice * settings.volMaster, 0, 1);
    if (v < 0.03) return true;
    if (interrupt || speechSynthesis.speaking) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    const ko = this.voices.find((x) => x.lang && x.lang.toLowerCase().startsWith('ko'));
    if (ko) u.voice = ko;
    u.pitch = pitch;
    u.rate = rate;
    u.volume = v;
    speechSynthesis.speak(u);
    return true;
  }

  /** School PA: static, then the (placeholder) voice. */
  pa(text, vol = 0.9) {
    this.play('paOn', { gain: 0.5 });
    this.play('static', { gain: 0.25 });
    if (!this.say(text, { vol, pitch: 0.55, rate: 0.8, interrupt: true })) this.play('murmur', { gain: 0.5, rate: 1.3 });
  }
}
