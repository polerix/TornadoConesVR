import * as THREE from 'three';
import {
  COLS, ROWS, CELL, TABLE_Y, GRID_MIN_X, GRID_MAX_X, GRID_MIN_Z, GRID_MAX_Z,
  BOUNDARY_MARGIN, socketPosition
} from './constants.js';

// --- Tunables (VR-scale, chosen by feel — not a literal px->m conversion) ---
export const FLY_HEIGHT = 0.22;          // disc cruise altitude above table
export const LAUNCH_RISE_SPEED = 0.7;    // m/s
export const DISC_MOVE_SPEED = 0.55;     // m/s under thumbstick control
export const TIME_TO_GREEN = 5.0;        // seconds red before maturing
export const SUCTION_RATE = 3.0;         // exponential pull-to-tornado rate once green
export const TORNADO_BASE_R = 0.035;
export const TORNADO_TOP_R = 0.24;
export const TORNADO_HEIGHT = 0.5;
export const TORNADO_CHASE_SPEED_RED = 0.28;
export const TORNADO_CHASE_SPEED_GREEN = 0.45;
export const DISC_RADIUS = 0.11;

export function tornadoRadiusAtNormHeight(h) {
  return TORNADO_BASE_R + (TORNADO_TOP_R - TORNADO_BASE_R) * h;
}

let sharedDiscTexture = null;
let sharedTornadoTexture = null;
export function setSharedTextures(discTex, tornadoTex) {
  sharedDiscTexture = discTex;
  sharedTornadoTexture = tornadoTex;
}

// ---------------- Grid Socket ----------------
export class GridSocket {
  constructor(index, scene, clock) {
    this.index = index;
    this.clock = clock;
    const { x, z } = socketPosition(index);
    this.x = x; this.z = z;
    this.hasDisc = true;
    this.isRestoring = false;
    this.ringActive = false;
    this.idlePhase = Math.random() * Math.PI * 2;

    const geo = new THREE.CylinderGeometry(CELL / 2, CELL / 2, 0.01, 24);
    const mat = new THREE.MeshStandardMaterial({
      map: sharedDiscTexture,
      color: 0xffffff,
      emissive: 0x000000,
      roughness: 0.6
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x, TABLE_Y, z);
    scene.add(this.mesh);

    this.ringGeo = new THREE.RingGeometry(CELL / 2 + 0.005, CELL / 2 + 0.02, 24);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    this.ringMesh = new THREE.Mesh(this.ringGeo, this.ringMat);
    this.ringMesh.rotation.x = -Math.PI / 2;
    this.ringMesh.position.set(x, TABLE_Y + 0.006, z);
    this.ringMesh.visible = false;
    scene.add(this.ringMesh);

    this._restorePhase = 0; // 0..1 during flip
  }

  updateVisuals() {
    const mat = this.mesh.material;
    if (this.hasDisc) {
      mat.color.setHex(0xffffff);
      mat.emissive.setHex(0x000000);
    } else {
      mat.color.setHex(0x333333);
      mat.emissive.setHex(0x000000);
    }
  }

  setRing(active) {
    this.ringActive = active;
    this.ringMesh.visible = active;
  }

  restore(onFlip) {
    if (this.hasDisc || this.isRestoring) return;
    this.isRestoring = true;
    this._restoreStart = this.clock.elapsed;
    if (onFlip) onFlip();

    this.clock.after(400, () => {
      this.hasDisc = true;
      this.updateVisuals();
    });
    this.clock.after(800, () => {
      this.isRestoring = false;
    });
  }

  update(nowMs, tornadoes, rippleOrigin, rippleStartMs) {
    let h = 0;

    // Ripple from the last launch/restore point
    const age = nowMs - rippleStartMs;
    if (age >= 0 && age <= 3000) {
      const dx = this.x - rippleOrigin.x;
      const dz = this.z - rippleOrigin.z;
      const dist = Math.hypot(dx, dz);
      const speed = 0.006;
      const frequency = 12;
      const decay = 0.003;
      const phase = dist * frequency - age * speed;
      const amplitude = 0.02 * Math.exp(-decay * age);
      h += Math.sin(phase) * amplitude;
    }

    // Tornado proximity wobble
    if (tornadoes.length > 0) {
      let minDist = Infinity;
      tornadoes.forEach(t => {
        const d = Math.hypot(this.x - t.x, this.z - t.z);
        if (d < minDist) minDist = d;
      });
      const influenceRadius = 1.0;
      if (minDist < influenceRadius) {
        const normalized = 1 - (minDist / influenceRadius);
        const influence = Math.pow(normalized, 2) * 0.015;
        const chaosPhase = (nowMs * 0.01) + (this.x * 8) + (this.z * 8);
        h += Math.sin(chaosPhase) * influence;
      }
    }

    const ambient = Math.sin((nowMs * 0.0015) + (this.x * 4) + (this.z * 4)) * 0.001;
    h += ambient;

    if (this.hasDisc) {
      h += Math.sin((nowMs * 0.002) + this.idlePhase) * 0.0015;
    }

    this.mesh.position.y = TABLE_Y + h;
    this.ringMesh.position.y = TABLE_Y + h + 0.006;

    // Flip animation: rotate on X, swap state handled via clock.after above
    if (this.isRestoring) {
      const t = Math.min((nowMs - this._restoreStart) / 800, 1);
      this.mesh.rotation.x = t * Math.PI * 2;
    } else {
      this.mesh.rotation.x = 0;
    }
  }

  destroy(scene) {
    scene.remove(this.mesh);
    scene.remove(this.ringMesh);
  }
}

// ---------------- Flying Disc (player-controlled) ----------------
export class FlyingDisc {
  constructor(originSocket, scene, clock, audio, onStatusChange) {
    this.scene = scene;
    this.clock = clock;
    this.audio = audio;
    this.onStatusChange = onStatusChange;

    this.x = originSocket.x;
    this.z = originSocket.z;
    this.y = TABLE_Y;

    this.state = 'launching'; // launching, flying, captured, dying
    this.isGreen = false;
    this.timer = 0; // seconds
    this.hasTriggeredRespawn = false;
    this.captureTimer = 0;
    this.idlePhase = Math.random() * 100;

    const geo = new THREE.CylinderGeometry(DISC_RADIUS, DISC_RADIUS, 0.02, 24);
    const mat = new THREE.MeshStandardMaterial({ map: sharedDiscTexture, color: 0xff4444, roughness: 0.4 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(this.x, this.y, this.z);
    scene.add(this.mesh);

    this.audioHandle = audio.createDiscLoop();
  }

  setColor(hex) {
    this.mesh.material.color.setHex(hex);
  }

  update(dt, nowMs, tornadoes, thumbstick) {
    if (this.state === 'dying') return;

    if (this.state === 'captured') {
      this.captureTimer += dt;
      const duration = 1.0;
      const progress = Math.min(this.captureTimer / duration, 1.0);
      const scale = 1.0 - progress;

      let tx = 0, tz = -1.8;
      if (tornadoes.length > 0) { tx = tornadoes[0].x; tz = tornadoes[0].z; }
      this.x += (tx - this.x) * 0.12;
      this.z += (tz - this.z) * 0.12;
      this.y = Math.max(TABLE_Y, this.y - 0.35 * dt);

      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.scale.setScalar(Math.max(scale, 0.001));

      if (progress >= 1.0) {
        this.destroy('DISC RENEWED', '#ffffff');
      }
      return;
    }

    if (this.state === 'launching') {
      this.y += LAUNCH_RISE_SPEED * dt;
      const targetY = TABLE_Y + FLY_HEIGHT;
      if (this.y >= targetY) {
        this.y = targetY;
        this.state = 'flying';
        this.onStatusChange('AVOID TORNADO!', '#ff4444');
      }
    } else if (this.state === 'flying') {
      if (!this.isGreen) {
        this.timer += dt;
        if (this.timer > TIME_TO_GREEN) {
          this.isGreen = true;
          this.setColor(0x44ff44);
          this.onStatusChange('LET GO!', '#44ff44');
          if (!this.hasTriggeredRespawn) {
            this.hasTriggeredRespawn = true;
            this.onMature && this.onMature();
          }
        }
      }

      if (this.isGreen) {
        // Suction toward nearest tornado
        let target = null, minD = Infinity;
        tornadoes.forEach(t => {
          const d = Math.hypot(t.x - this.x, t.z - this.z);
          if (d < minD) { minD = d; target = t; }
        });
        if (target) {
          const k = 1 - Math.exp(-SUCTION_RATE * dt);
          this.x += (target.x - this.x) * k;
          this.z += (target.z - this.z) * k;
        }
      } else {
        // Thumbstick control (red state only)
        let speed = DISC_MOVE_SPEED;

        const distOut = Math.max(
          0,
          GRID_MIN_X - this.x, this.x - GRID_MAX_X,
          GRID_MIN_Z - this.z, this.z - GRID_MAX_Z
        );

        if (distOut > 0) {
          const factor = Math.min(distOut / BOUNDARY_MARGIN, 1.0);
          speed *= (1 - Math.pow(factor, 0.5) * 0.8);
          this.setColor(lerpColor(0xff4444, 0x4488ff, factor));
        } else {
          this.setColor(0xff4444);
        }

        this.x += thumbstick.x * speed * dt;
        this.z += thumbstick.y * speed * dt;

        const limMinX = GRID_MIN_X - BOUNDARY_MARGIN;
        const limMaxX = GRID_MAX_X + BOUNDARY_MARGIN;
        const limMinZ = GRID_MIN_Z - BOUNDARY_MARGIN;
        const limMaxZ = GRID_MAX_Z + BOUNDARY_MARGIN;
        this.x = Math.max(limMinX, Math.min(limMaxX, this.x));
        this.z = Math.max(limMinZ, Math.min(limMaxZ, this.z));
      }

      // Collision with any tornado
      const normH = FLY_HEIGHT / TORNADO_HEIGHT;
      let hit = false;
      tornadoes.forEach(t => {
        const tR = tornadoRadiusAtNormHeight(Math.min(normH, 1)) * t.scale;
        const hitR = (tR * 0.9) + (DISC_RADIUS * 0.9);
        const dist = Math.hypot(this.x - t.x, this.z - t.z);
        if (dist < hitR) hit = true;
      });

      if (hit) {
        if (this.isGreen) {
          this.onCatch && this.onCatch();
          this.state = 'captured';
          this.captureTimer = 0;
          this.onStatusChange('DISC RENEWED', '#ffffff');
        } else {
          this.onMiss && this.onMiss();
          this.destroy('DESTROYED!', '#ff4444');
          return;
        }
      }
    }

    const idleBob = Math.sin(nowMs * 0.003 + this.idlePhase) * 0.005;
    this.mesh.position.set(this.x, this.y + idleBob, this.z);

    if (this.audioHandle && this.audioHandle.panner) {
      this.audio.updatePanner(this.audioHandle.panner, this.mesh.position);
    }
  }

  destroy(status, color) {
    if (this.state === 'dying') return;
    this.state = 'dying';
    if (this.audioHandle) { try { this.audioHandle.osc.stop(); } catch (e) {} }
    this.onStatusChange(status, color);
    this.scene.remove(this.mesh);
    this.onDestroyed && this.onDestroyed();
  }
}

function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// ---------------- Disc Tornado ----------------
export class DiscTornado {
  constructor(scale, scene, audio) {
    this.type = 'tornado';
    this.scale = scale;
    this.audio = audio;
    this.x = 0;
    this.z = GRID_MIN_Z + (GRID_MAX_Z - GRID_MIN_Z) / 2;
    this.angle = 0;

    this.group = new THREE.Group();
    scene.add(this.group);
    this.scene = scene;

    this.segments = [];
    const segmentCount = 16;
    for (let i = 0; i < segmentCount; i++) {
      const h = i / segmentCount;
      const r = tornadoRadiusAtNormHeight(h) * scale;
      const geo = new THREE.CylinderGeometry(r, r, 0.004, 20);
      const mat = new THREE.MeshStandardMaterial({
        map: sharedTornadoTexture,
        color: 0xcc66ff,
        transparent: true,
        opacity: 0.75,
        roughness: 0.5
      });
      const seg = new THREE.Mesh(geo, mat);
      seg.position.y = h * TORNADO_HEIGHT * scale;
      seg.userData.baseY = seg.position.y;
      seg.userData.h = h;
      this.group.add(seg);
      this.segments.push(seg);
    }

    this.audioHandle = audio.createTornadoLoop();
  }

  update(dt, nowMs, activeDisc) {
    this.angle += 0.6 * dt;

    if (activeDisc && activeDisc.state === 'flying') {
      const dx = activeDisc.x - this.x;
      const dz = activeDisc.z - this.z;
      const dist = Math.hypot(dx, dz);
      const speed = activeDisc.isGreen ? TORNADO_CHASE_SPEED_GREEN : TORNADO_CHASE_SPEED_RED;
      if (dist > 0.05) {
        this.x += (dx / dist) * speed * dt;
        this.z += (dz / dist) * speed * dt;
      }
    } else {
      this.x = Math.sin(nowMs * 0.0004) * 0.3;
      this.z = (GRID_MIN_Z + GRID_MAX_Z) / 2 + Math.cos(nowMs * 0.0004) * 0.3;
    }

    this.group.position.set(this.x, TABLE_Y, this.z);

    this.segments.forEach((seg, i) => {
      const wobbleAmt = seg.userData.h * 0.03;
      const wobbleX = Math.sin(this.angle + i * 0.5) * wobbleAmt;
      const wobbleZ = Math.cos(this.angle + i * 0.5) * wobbleAmt;
      seg.position.x = wobbleX;
      seg.position.z = wobbleZ;
      seg.rotation.y = this.angle * 2 + i * 0.3;
    });

    if (this.audioHandle && this.audioHandle.panner) {
      this.audio.updatePanner(this.audioHandle.panner, this.group.position);
    }
  }

  destroy() {
    if (this.audioHandle) { try { this.audioHandle.osc.stop(); } catch (e) {} }
    this.scene.remove(this.group);
  }
}

// ---------------- Green Ball (bouncing, homes to player or tornado) ----------------
export class GreenBall {
  constructor(targetType, scene) {
    this.type = 'ball';
    this.targetType = targetType;
    this.scene = scene;

    const geo = new THREE.SphereGeometry(0.035, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color: 0x55ff55, emissive: 0x116611, roughness: 0.3 });
    this.mesh = new THREE.Mesh(geo, mat);
    scene.add(this.mesh);

    this.x = (Math.random() - 0.5) * 1.4;
    this.z = GRID_MIN_Z + Math.random() * (GRID_MAX_Z - GRID_MIN_Z);
    this.y = 0.6;
    this.vy = 0;
    this.gravity = 2.6;
    this.bounceVel = 1.7;
    this.speed = 0.4;
  }

  update(dt, activeDisc, tornadoes, gridLights) {
    let tx = 0, tz = (GRID_MIN_Z + GRID_MAX_Z) / 2;

    if (this.targetType === 'player' && activeDisc && activeDisc.state === 'flying') {
      tx = activeDisc.x; tz = activeDisc.z;
    } else if (this.targetType === 'tornado' && tornadoes.length > 0) {
      let minD = Infinity;
      tornadoes.forEach(t => {
        const d = Math.hypot(t.x - this.x, t.z - this.z);
        if (d < minD) { minD = d; tx = t.x; tz = t.z; }
      });
    }

    const dx = tx - this.x, dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05) {
      this.x += (dx / dist) * this.speed * dt;
      this.z += (dz / dist) * this.speed * dt;
    }

    this.vy -= this.gravity * dt;
    this.y += this.vy * dt;

    if (this.y <= 0) {
      this.y = 0;
      this.vy = this.bounceVel;

      // Check landing on a ringed socket
      let closest = null, closestD = Infinity;
      gridLights.forEach(l => {
        const d = Math.hypot(this.x - l.x, this.z - l.z);
        if (d < closestD) { closestD = d; closest = l; }
      });
      if (closest && closestD < 0.09 && closest.ringActive) {
        closest.setRing(false);
        this.onRingCleared && this.onRingCleared(closest);
      }
    }

    this.mesh.position.set(this.x, TABLE_Y + this.y, this.z);
  }

  destroy() { this.scene.remove(this.mesh); }
}

// ---------------- Orange Cube (drops in, absorbs nearby entities) ----------------
export class OrangeCube {
  constructor(scene) {
    this.type = 'cube';
    this.scene = scene;
    const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0x552200, transparent: true, opacity: 0.85 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.x = 0;
    this.z = (GRID_MIN_Z + GRID_MAX_Z) / 2;
    this.y = 1.2;
    scene.add(this.mesh);
  }

  update(dt, tornadoes, balls, activeDisc, cb) {
    if (this.y > 0) {
      this.y = Math.max(0, this.y - 0.9 * dt);
    }
    this.mesh.position.set(this.x, TABLE_Y + this.y, this.z);

    if (this.y < 0.18) {
      for (let i = tornadoes.length - 1; i >= 0; i--) {
        const t = tornadoes[i];
        if (Math.hypot(t.x - this.x, t.z - this.z) < 0.22) {
          cb.removeTornado(i);
        }
      }
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (Math.hypot(b.x - this.x, b.z - this.z) < 0.22) {
          cb.removeBall(i);
        }
      }
      if (activeDisc && activeDisc.state === 'flying' && Math.hypot(activeDisc.x - this.x, activeDisc.z - this.z) < 0.22) {
        activeDisc.destroy('ABSORBED BY CUBE', '#ffaa00');
      }
    }
  }

  destroy() { this.scene.remove(this.mesh); }
}
