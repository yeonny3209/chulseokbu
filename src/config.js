// Every tunable number lives here. Edit and reload — no other file needs to change.
export const CFG = {
  // ---- building (meters) ----
  floorH: 3.5,
  wallH: 3.0,
  moduleW: 9,
  modules: 8,
  corridorW: 3,
  roomDepth: 8,
  doorW: 1.0,
  doorH: 2.1,

  // ---- player ----
  player: {
    eye: 1.62,
    crouchEye: 1.05,
    radius: 0.28,
    walk: 2.5,
    run: 4.2,
    crouch: 1.3,
    stepUp: 0.6,
    staminaMax: 100,
    staminaDrain: 12,
    staminaRegen: 20,
    staminaResume: 25,
    interactRange: 2.3,
  },

  // ---- noise radius (meters) heard by the teacher ----
  noise: {
    crouch: 0,
    walk: 2,
    run: 12,
    door: 6,
    doorRusty: 15,
    drop: 10,
    throw: 14,
    hide: 4,
    dial: 3,
    breaker: 30,
    locked: 4,
  },

  // ---- flashlight ----
  flashlight: {
    drain: 0.5, // battery per second
    focusDrain: 8,
    focusTime: 1.5, // seconds of beam on face to stun
    flickerBelow: 20,
    batteryRestore: 40,
    startBattery: 100,
    intensity: 220,
    focusIntensity: 520,
    distance: 28,
    angle: 0.5,
    focusAngle: 0.13,
  },

  // ---- teacher ----
  teacher: {
    height: 2.4,
    walk: 1.3,
    investigate: 2.0,
    search: 1.6,
    chase: 3.6,
    viewAngleDeg: 70,
    viewDist: 15,
    viewDistLight: 25,
    senseRadius: 2.5,
    detectTime: 0.5,
    loseTime: 3.0,
    searchTime: 15,
    catchDist: 1.0,
    stunTimes: [3, 2, 0],
    hideProtect: 3, // seconds after hiding in which he can't "find" you
    respawnGrace: 10,
  },

  difficulty: {
    easy: { view: 0.7, chase: 3.2, openChance: 0.0, breath: false, label: '쉬움' },
    normal: { view: 1.0, chase: 3.6, openChance: 0.2, breath: true, label: '보통' },
    hard: { view: 1.2, chase: 4.0, openChance: 0.4, breath: true, label: '어려움' },
  },

  // ---- graphics presets ----
  quality: {
    low: { pixelRatio: 0.75, shadows: false, shadowMap: 512, post: false },
    medium: { pixelRatio: 1, shadows: true, shadowMap: 512, post: true },
    high: { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), shadows: true, shadowMap: 1024, post: true },
  },

  // ---- misc ----
  fogDensity: 0.045,
  ambient: 0.95,
  useTTS: true, // placeholder voice until real recordings exist (see public/sounds)
  clockTime: '10:17',
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  invertY: false,
  volMaster: 0.9,
  volSfx: 1.0,
  volMusic: 0.7,
  volVoice: 1.0,
  brightness: 1.0,
  quality: 'medium',
  fov: 75,
  difficulty: 'normal',
  subtitles: true,
  reduceShake: false,
};
