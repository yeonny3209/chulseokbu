// DOM-based interface: HUD, menus, note viewer, number-lock dials, inventory, endings.
import { CFG } from './config.js';
import { NOTES, NOTE_COUNT, OBJECTIVES, HINTS } from './story.js';
import { S, settings, saveSettings } from './state.js';
import { fmtTime } from './util.js';

const ITEM_LABELS = {
  flashlight: '손전등',
  sciKey: '과학실 열쇠',
  fuse: '퓨즈',
  officeKey: '교무실 열쇠',
  frontKey: '현관 열쇠',
  book: '2015년 출석부',
  phone: '낡은 휴대폰',
};
const HELD_LABELS = { chalk: '분필 상자', can: '빈 캔', slipper: '실내화' };
const PLAYER_COLORS_HEX = ['d85a5a', '5aa0d8', 'd8c35a', '6fd88a', 'b07ad8', 'd8885a'];

export class UI {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.el = {
      hud: $('hud'), prompt: $('prompt'), toast: $('toast'), hint: $('hintline'), sub: $('subtitle'),
      obj: $('objective'), bat: $('battery'), batFill: $('battery-fill'), batText: $('battery-text'),
      stam: $('stamina'), stamFill: $('stamina-fill'), noise: $('noise'), held: $('held'),
      breath: $('breath'), floor: $('floorlabel'), debug: $('debug'), fade: $('fade'), flash: $('flash'),
      hideOv: $('hide-overlay'), phone: $('phone'),
    };
    this.timers = {};
    this.dial = null;
    this.buildSettings();
  }

  // -------------------------------------------------------------- generic helpers
  _timed(key, el, ms) {
    el.classList.add('on');
    clearTimeout(this.timers[key]);
    if (ms) this.timers[key] = setTimeout(() => el.classList.remove('on'), ms);
  }

  show(id, on = true) {
    this.$(id).classList.toggle('hidden', !on);
  }

  hideAllScreens() {
    for (const id of ['screen-start', 'screen-pause', 'screen-settings', 'screen-note', 'screen-dial', 'screen-inv', 'screen-caught', 'screen-end', 'screen-mp', 'screen-lobby', 'screen-enter']) this.show(id, false);
  }

  // -------------------------------------------------------------- multiplayer screens
  showMP() {
    const saved = (() => { try { return localStorage.getItem('chulseokbu.name') || ''; } catch (e) { return ''; } })();
    const inp = this.$('mp-name');
    if (!inp.value) inp.value = saved;
    this.$('mp-status').textContent = '';
    this.show('screen-mp', true);
  }

  mpName() {
    let n = this.$('mp-name').value.trim().slice(0, 12);
    if (!n) n = `플레이어${Math.floor(Math.random() * 90 + 10)}`;
    this.$('mp-name').value = n;
    try { localStorage.setItem('chulseokbu.name', n); } catch (e) { /* ignore */ }
    return n;
  }

  mpCode() {
    return this.$('mp-code').value.trim().toUpperCase();
  }

  mpStatus(text) {
    this.$('mp-status').textContent = text;
  }

  renderLobby(list, isHost, code, kind) {
    this.$('lobby-code').textContent = code;
    this.$('lobby-count').textContent = `${list.length} / 6`;
    const ul = this.$('lobby-list');
    ul.innerHTML = '';
    list.forEach((p, i) => {
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = `#${PLAYER_COLORS_HEX[p.idx % PLAYER_COLORS_HEX.length]}`;
      li.append(dot, document.createTextNode(` ${p.name}${i === 0 ? '  (방장)' : ''}`));
      ul.append(li);
    });
    this.$('btn-lobby-start').classList.toggle('hidden', !isHost);
    this.$('lobby-wait').classList.toggle('hidden', isHost);
    this.$('lobby-local').classList.toggle('hidden', kind !== 'local');
  }

  setPlayersHud(list) {
    const el = this.$('players');
    if (!list) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = '';
    for (const p of list) {
      const row = document.createElement('div');
      row.className = `prow${p.downed ? ' down' : ''}${p.me ? ' me' : ''}`;
      const dot = document.createElement('i');
      dot.style.background = `#${p.color.toString(16).padStart(6, '0')}`;
      row.append(dot, document.createTextNode(` ${p.name}${p.info ? ` · ${p.info}` : ''}${p.downed ? ' ↓' : ''}`));
      el.append(row);
    }
  }

  downOverlay(on) {
    this.$('down-overlay').classList.toggle('hidden', !on);
    if (!on) this.setReviveBar(0);
  }

  setReviveBar(v) {
    const bar = this.$('revive');
    bar.classList.toggle('on', v > 0.01);
    this.$('revive-fill').style.width = `${Math.round(v * 100)}%`;
  }

  showHud(on) {
    this.show('hud', on);
    if (this.game.touch) this.game.touch.setVisible(on);
  }

  // -------------------------------------------------------------- HUD
  setPrompt(text) {
    if (text === this._prompt) return;
    this._prompt = text;
    this.el.prompt.textContent = this.tr(text) || '';
    this.el.prompt.classList.toggle('on', !!text);
  }

  /** On phones, mention on-screen buttons instead of keys. */
  tr(t) {
    if (!t || !this.game.isTouch) return t;
    return t
      .replace('좌클릭/F: 켜기/끄기, 우클릭/R: 집중광', '손전등 버튼: 켜기/끄기, 집중광 버튼')
      .replace('Q: 던지기', '던지기 버튼')
      .replace('[Q 던지기]', '[던지기 버튼]')
      .replace('WASD 이동 · E 조사하기', '왼쪽 화면 드래그: 이동 · 조사 버튼')
      .replace('(Shift 달리기는 소리가 크다)', '(달리기는 소리가 크다)')
      .replace('[ E ]', '(조사 버튼)')
      .replace('[E]', '(조사)')
      .replace('E 길게 누르기', '조사 버튼 길게');
  }

  toast(text, ms = 3400) {
    this.el.toast.textContent = this.tr(text);
    this._timed('toast', this.el.toast, ms);
  }

  hint(text, ms = 6000) {
    this.el.hint.textContent = this.tr(text);
    this._timed('hint', this.el.hint, ms);
  }

  subtitle(text, ms = 2600, force = false) {
    if (!settings.subtitles && !force) return;
    this.el.sub.textContent = text;
    this._timed('sub', this.el.sub, ms);
  }

  setObjective(key) {
    S.objective = key;
    this.shownObjective = key;
    const text = OBJECTIVES[key] || key;
    this.el.obj.textContent = `▸ ${text}`;
    this.el.obj.classList.add('on');
    clearTimeout(this.timers.obj);
    this.timers.obj = setTimeout(() => this.el.obj.classList.remove('on'), 9000);
  }

  flashObjective() {
    this.el.obj.classList.add('on');
    clearTimeout(this.timers.obj);
    this.timers.obj = setTimeout(() => this.el.obj.classList.remove('on'), 6000);
  }

  setBattery(v, visible) {
    this.el.bat.classList.toggle('on', visible);
    this.el.bat.classList.toggle('low', v < 20);
    this.el.batFill.style.width = `${Math.max(0, v)}%`;
    this.el.batText.textContent = `${Math.round(v)}%`;
  }

  setStamina(v, visible) {
    this.el.stam.classList.toggle('on', visible);
    this.el.stamFill.style.width = `${v}%`;
  }

  setNoise(level) {
    const n = this.el.noise;
    n.classList.toggle('on', level > 0);
    n.classList.remove('l1', 'l2', 'l3');
    if (level > 0) n.classList.add(`l${level}`);
  }

  setHeld(type) {
    this.el.held.textContent = type ? this.tr(`손에 든 것: ${HELD_LABELS[type]}  [Q 던지기]`) : '';
  }

  breath(on) {
    this.el.breath.classList.toggle('on', on);
  }

  floorLabel(t) {
    this.el.floor.textContent = t;
  }

  fade(opacity, ms = 600) {
    this.el.fade.style.transition = `opacity ${ms}ms`;
    this.el.fade.style.opacity = String(opacity);
  }

  flash(ms = 120) {
    const f = this.el.flash;
    f.style.transition = 'none';
    f.style.opacity = '0.9';
    requestAnimationFrame(() => {
      f.style.transition = `opacity ${ms}ms`;
      f.style.opacity = '0';
    });
  }

  phone(on) {
    this.el.phone.classList.toggle('hidden', !on);
  }

  hideOverlay(kind) {
    const o = this.el.hideOv;
    o.classList.toggle('hidden', !kind);
    o.classList.toggle('desk', kind === 'desk');
  }

  debug(text) {
    this.el.debug.textContent = text;
  }

  // -------------------------------------------------------------- notes
  openNote(id) {
    const n = NOTES[id];
    this.$('note-title').textContent = n.title;
    this.$('note-text').textContent = n.text;
    this.show('screen-note', true);
  }

  closeNote() {
    this.show('screen-note', false);
  }

  // -------------------------------------------------------------- dial lock
  openDial({ title, code, hintKey, onSuccess }) {
    this.dial = { code, digits: [0, 0, 0, 0], onSuccess, opened: performance.now(), hintKey };
    this.$('dial-title').textContent = title;
    this.$('dial-msg').textContent = '';
    this.$('dial-hint').textContent = '';
    this.renderDial();
    this.show('screen-dial', true);
    clearTimeout(this.timers.dialHint);
    this.timers.dialHint = setTimeout(() => {
      if (this.dial) this.$('dial-hint').textContent = HINTS[hintKey] || '';
    }, 40000);
  }

  renderDial() {
    const box = this.$('dial-digits');
    box.innerHTML = '';
    this.dial.digits.forEach((d, i) => {
      const col = document.createElement('div');
      col.className = 'digit';
      const up = document.createElement('button');
      up.textContent = '▲';
      const num = document.createElement('div');
      num.className = 'num';
      num.textContent = String(d);
      const dn = document.createElement('button');
      dn.textContent = '▼';
      up.onclick = () => this.turnDial(i, 1);
      dn.onclick = () => this.turnDial(i, -1);
      col.onwheel = (e) => { e.preventDefault(); this.turnDial(i, e.deltaY < 0 ? 1 : -1); };
      col.append(up, num, dn);
      box.append(col);
    });
  }

  turnDial(i, dir) {
    this.dial.digits[i] = (this.dial.digits[i] + dir + 10) % 10;
    this.game.audio.play('click', { gain: 0.6 });
    this.game.noise(this.game.player.pos.x, this.game.player.pos.y, this.game.player.pos.z, CFG.noise.dial);
    this.renderDial();
  }

  tryDial() {
    if (!this.dial) return;
    const guess = this.dial.digits.join('');
    if (guess === this.dial.code) {
      const cb = this.dial.onSuccess;
      this.closeDial();
      this.game.audio.play('unlock', { gain: 0.9 });
      cb();
    } else {
      this.$('dial-msg').textContent = '열리지 않는다.';
      this.game.audio.play('rattle', { gain: 0.5 });
    }
  }

  closeDial() {
    clearTimeout(this.timers.dialHint);
    this.dial = null;
    this.show('screen-dial', false);
  }

  // -------------------------------------------------------------- inventory
  renderInventory() {
    this.$('inv-objective').textContent = OBJECTIVES[S.objective] || '';
    const list = this.$('inv-items');
    list.innerHTML = '';
    const have = Object.keys(S.keys).filter((k) => S.keys[k]);
    if (!have.length) list.innerHTML = '<li class="dim">없음</li>';
    for (const k of have) list.insertAdjacentHTML('beforeend', `<li>${ITEM_LABELS[k] || k}</li>`);
    if (S.held) list.insertAdjacentHTML('beforeend', `<li>손에 든 것: ${HELD_LABELS[S.held]}</li>`);
    const notes = this.$('inv-notes');
    notes.innerHTML = '';
    let count = 0;
    for (const id of Object.keys(NOTES)) {
      if (S.notes[id]) {
        count++;
        const li = document.createElement('li');
        li.textContent = NOTES[id].title;
        li.style.cursor = 'pointer';
        li.onclick = () => this.game.events.readNote(+id, true);
        notes.append(li);
      } else {
        notes.insertAdjacentHTML('beforeend', '<li class="dim">？？？</li>');
      }
    }
    this.$('inv-notecount').textContent = `(${count}/${NOTE_COUNT})`;
  }

  // -------------------------------------------------------------- caught / ending
  caught(show) {
    this.show('screen-caught', show);
  }

  endScreen({ time, deaths, notes, bonus }) {
    this.hideAllScreens();
    this.showHud(false);
    this.$('end-title').textContent = '출석부';
    this.$('credits').textContent =
      '기획 · 개발   —\n\n사운드: 직접 합성 (Web Audio)\n텍스처: 직접 제작 (Canvas)\n3D: Three.js\n\n— 17번, 대답해. —';
    this.$('stats').innerHTML =
      `클리어 시간 ${fmtTime(time)}<br>잡힌 횟수 ${deaths}회<br>찾은 쪽지 ${notes}/${NOTE_COUNT}`;
    const news = this.$('news');
    news.classList.toggle('hidden', !bonus);
    if (bonus) {
      news.innerHTML =
        '[뉴스] 철거를 앞둔 폐교 지하 보일러실에서 11년 전 실종 학생의 유해가 발견됐습니다.<br>경찰은 발견 전날 밤 학교를 찾은 전 담임교사가 "아이가 대답했다"고 진술했다고 밝혔습니다.';
    }
    this.show('screen-end', true);
  }

  // -------------------------------------------------------------- settings
  buildSettings() {
    const form = this.$('settings-form');
    const rows = [
      ['sensitivity', '마우스 감도', 'range', { min: 0.3, max: 2.5, step: 0.05 }],
      ['invertY', '상하 반전', 'check'],
      ['volMaster', '전체 음량', 'range', { min: 0, max: 1, step: 0.05 }],
      ['volSfx', '효과음', 'range', { min: 0, max: 1, step: 0.05 }],
      ['volMusic', '음악', 'range', { min: 0, max: 1, step: 0.05 }],
      ['volVoice', '목소리', 'range', { min: 0, max: 1, step: 0.05 }],
      ['brightness', '밝기', 'range', { min: 0.6, max: 1.8, step: 0.05 }],
      ['quality', '그래픽 품질', 'select', { options: [['low', '낮음'], ['medium', '중간'], ['high', '높음']] }],
      ['fov', '시야각', 'range', { min: 60, max: 100, step: 1 }],
      ['difficulty', '난이도 (새 게임부터)', 'select', { options: Object.entries(CFG.difficulty).map(([k, v]) => [k, v.label]) }],
      ['subtitles', '자막', 'check'],
      ['reduceShake', '화면 흔들림 줄이기', 'check'],
    ];
    for (const [key, label, type, opt] of rows) {
      const row = document.createElement('div');
      row.className = 'setting';
      const lab = document.createElement('span');
      lab.textContent = label;
      let input;
      if (type === 'range') {
        input = document.createElement('input');
        input.type = 'range';
        Object.assign(input, opt);
        input.value = settings[key];
        input.oninput = () => { settings[key] = parseFloat(input.value); this.commitSettings(); };
      } else if (type === 'check') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!settings[key];
        input.onchange = () => { settings[key] = input.checked; this.commitSettings(); };
      } else {
        input = document.createElement('select');
        for (const [v, t] of opt.options) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          input.append(o);
        }
        input.value = settings[key];
        input.onchange = () => { settings[key] = input.value; this.commitSettings(); };
      }
      input.dataset.key = key;
      row.append(lab, input);
      form.append(row);
    }
  }

  syncSettings() {
    for (const el of this.$('settings-form').querySelectorAll('[data-key]')) {
      const v = settings[el.dataset.key];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    }
  }

  commitSettings() {
    saveSettings();
    this.game.applySettings();
  }
}
