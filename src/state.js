// Single mutable game-progress object. Everything that must survive a checkpoint lives here.
import { CFG, DEFAULT_SETTINGS } from './config.js';

export const S = {};

export function resetState() {
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, {
    flags: {}, // story / puzzle flags
    keys: {}, // carried keys & key items
    collected: {}, // picked-up item ids
    notes: {}, // read note ids
    doorOpen: {},
    doorUnlocked: {},
    battery: CFG.flashlight.startBattery,
    held: null, // throwable type in hand
    objective: 'start',
    stage: 'start',
    cp: null, // {id, f, x, z, yaw}
    deaths: 0,
    time: 0,
  });
}
resetState();

export const settings = { ...DEFAULT_SETTINGS };
const SK = 'chulseokbu.settings.v1';
const GK = 'chulseokbu.save.v1';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SK);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch (e) { /* storage unavailable */ }
}
export function saveSettings() {
  try { localStorage.setItem(SK, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

export function writeSave() {
  try { localStorage.setItem(GK, JSON.stringify(S)); } catch (e) { /* ignore */ }
}
export function readSave() {
  try {
    const raw = localStorage.getItem(GK);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
export function hasSave() {
  const s = readSave();
  return !!(s && s.cp);
}
export function clearSave() {
  try { localStorage.removeItem(GK); } catch (e) { /* ignore */ }
}
export function loadSaveInto() {
  const s = readSave();
  if (!s) return false;
  resetState();
  Object.assign(S, s);
  return true;
}
