// A pause-aware clock plus a scheduler for delayed callbacks.
// The original game re-implemented setTimeout via chained rAF calls so that
// delays would freeze during PAUSED. Here everything ticks once per XR
// frame via GameClock.tick(), which is simpler and frame-rate independent.

export class GameClock {
  constructor() {
    this.elapsed = 0;   // ms, pause-aware "game time"
    this.paused = false;
    this._pending = []; // { fn, targetTime }
  }

  tick(deltaMs) {
    if (!this.paused) {
      this.elapsed += deltaMs;
      const now = this.elapsed;
      // Fire and remove due callbacks
      for (let i = this._pending.length - 1; i >= 0; i--) {
        if (now >= this._pending[i].targetTime) {
          const { fn } = this._pending[i];
          this._pending.splice(i, 1);
          fn();
        }
      }
    }
  }

  setPaused(v) { this.paused = v; }

  // dt in seconds for frame-rate independent movement (0 while paused)
  dtSeconds(deltaMs) {
    return this.paused ? 0 : deltaMs / 1000;
  }

  after(delayMs, fn) {
    this._pending.push({ fn, targetTime: this.elapsed + delayMs });
  }

  clearAll() {
    this._pending.length = 0;
  }
}
