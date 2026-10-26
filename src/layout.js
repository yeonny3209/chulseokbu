// School layout. Floor index: 0 = 1F, 1 = 2F (start), 2 = 3F.
// Each floor has 8 modules (9 m wide). Module m spans x = 9m .. 9m+9.
// Corridor runs along z = 0..3 (south). Rooms are on the north side, z = 3..11.
// Stairwells sit west (x -8..0) and east (x 72..80) of the corridor ends.
import { CFG } from './config.js';

export const FLOOR_H = CFG.floorH;
export const MOD_W = CFG.moduleW;
export const N_MOD = CFG.modules;
export const BLD_W = MOD_W * N_MOD; // 72

export const fy = (f) => f * FLOOR_H;
export const doorX = (m) => m * MOD_W + 4; // door center x of module m
export const roomX = (m, lx) => m * MOD_W + lx;
export const roomZ = (lz) => 3 + lz;
export const FLOOR_NAMES = ['1층', '2층', '3층'];

/** lock: null | key id | 'power' | 'storage' | 'never' */
export const ROOMS = {
  1: [
    { name: '남자화장실', type: 'toilet', sign: '남자화장실' },
    { name: '2-1', type: 'class', sign: '2학년 1반' },
    { name: '2-2', type: 'class', sign: '2학년 2반' },
    { name: '2-3', type: 'class', sign: '2학년 3반' },
    { name: '2-4', type: 'class', sign: '2학년 4반' },
    { name: '여자화장실', type: 'toilet', sign: '여자화장실' },
    { name: '과학실', type: 'lab', sign: '과학실', lock: 'sciKey' },
    { name: '과학준비실', type: 'prep', sign: '과학준비실' },
  ],
  2: [
    { name: '1-1', type: 'class', sign: '1학년 1반' },
    { name: '1-2', type: 'class', sign: '1학년 2반' },
    { name: '음악실', type: 'music', sign: '음악실' },
    { name: '도서관', type: 'library', sign: '도서관' },
    { name: '빈 교실', type: 'class', sign: '3학년 1반' },
    { name: '빈 교실', type: 'class', sign: '3학년 2반' },
    { name: '방송실', type: 'broadcast', sign: '방송실', lock: 'power' },
    { name: '장비 창고', type: 'storage', sign: '장비창고', lock: 'storage', window: true },
  ],
  0: [
    { name: '교무실', type: 'office', sign: '교무실', lock: 'officeKey' },
    { name: '행정실', type: 'admin', sign: '행정실' },
    { name: '보건실', type: 'infirm', sign: '보건실' },
    { name: '급식실', type: 'canteen', sign: '급식실' },
    { name: '빈 교실', type: 'class', sign: '1학년 3반' },
    { name: '빈 교실', type: 'class', sign: '1학년 4반' },
    { name: '창고', type: 'prep', sign: '창고' },
    { name: '보일러실', type: 'boiler', sign: '보일러실', lock: 'never', rusty: true },
  ],
};

// Corridor lockers the player can hide in (x positions along the south wall).
export const CORRIDOR_HIDES = {
  1: [14, 22, 40, 50, 60],
  2: [12, 30, 45, 66],
  0: [6, 20, 42, 56],
};

// Player start (2-3 classroom back rows, facing the door = -z)
export const START = { f: 1, x: 31.5, z: 8.6, yaw: 0 };

// Where the exit door is
export const FRONT_DOOR = { x: 36, z: 0 };
