// Shared spatial constants (meters). The grid is a "tabletop" 1.8m x 1.8m
// surface floating at chest height, 1 to 2.6m in front of the player's
// tracked origin. This replaces the old 920x920px CSS-pixel game space.

export const COLS = 6;
export const ROWS = 6;
export const CELL = 0.22;
export const GAP = 0.06;
export const PITCH = CELL + GAP; // 0.28

export const TABLE_Y = 1.0;
export const GRID_CENTER_Z = -1.8;

export const GRID_HALF = (COLS * PITCH - GAP) / 2; // 0.81
export const GRID_MIN_X = -GRID_HALF;
export const GRID_MAX_X = GRID_HALF;
export const GRID_MIN_Z = GRID_CENTER_Z - GRID_HALF;
export const GRID_MAX_Z = GRID_CENTER_Z + GRID_HALF;

// Soft boundary margin outside the grid before hard clamp
export const BOUNDARY_MARGIN = PITCH;

export function socketPosition(index) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const x = (col * PITCH) - GRID_HALF + CELL / 2;
  const z = (row * PITCH) + GRID_MIN_Z + CELL / 2;
  return { x, z };
}
