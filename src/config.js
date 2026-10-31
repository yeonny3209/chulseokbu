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
    staminaDrain: 8, // ~12 s of running (was 8 s)
    staminaRegen: 30,
    staminaResume: 20,
    interactRange: 2.3,
  },

  // ---- noise radius (meters) heard by the teacher ----
  noise: {
    crouch: 0,
    walk: 2,
    run: 9,
    door: 4,
    doorRusty: 10,
    drop: 10,
    throw: 14,
    hide: 4,
    dial: 3,
    breaker: 30,
    locked: 4,
  },

  // ---- flashlight ----
  flashlight: {
    drain: 0.3, // battery per second (a full battery lasts ~5.5 minutes)
    focusDrain: 6,
    focusTime: 1.0, // seconds of beam on face to stun
    flickerBelow: 15,
    batteryRestore: 50,
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
    viewDist: 12,
    viewDistLight: 18,
    senseRadius: 2.0,
    detectTime: 0.9, // overridden per difficulty (difficulty.detect)
    loseTime: 2.0,
    searchTime: 12,
    catchDist: 0.85,
    stunTimes: [4, 3, 2],
    hideProtect: 5, // seconds after hiding in which he can't "find" you
    respawnGrace: 15,
  },

  // view: sight distance multiplier · chase: his running speed (you run at 4.2, walk 2.5)
  // detect: seconds he must keep you in view before he starts the chase
  // openChance: chance he opens the hiding place you are in · breath: the hold-your-breath mechanic
  difficulty: {
    easy: { view: 0.6, chase: 2.9, detect: 1.5, openChance: 0.0, breath: false, label: '쉬움' },
    normal: { view: 0.85, chase: 3.3, detect: 1.0, openChance: 0.1, breath: false, label: '보통' },
    hard: { view: 1.1, chase: 3.8, detect: 0.6, openChance: 0.35, breath: true, label: '어려움' },
  },

  // ---- graphics presets ----
  quality: {
    low: { pixelRatio: 0.75, shadows: false, shadowMap: 512, post: false },
    medium: { pixelRatio: 1, shadows: true, shadowMap: 512, post: true },
    high: { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), shadows: true, shadowMap: 1024, post: true },
  },

  // ---- misc ----
  fogDensity: 0.04,
  ambient: 1.15,
  autoCheckpointEvery: 75, // seconds: a quiet moment with no teacher near saves progress by itself
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
