import * as THREE from 'three';

// Cardboard 3-DoF input: device-orientation gaze direction, a single
// monolithic trigger (screen tap / viewer's conductive lever, which
// browsers surface as an ordinary touchstart/click), and gaze-dwell
// for pause since there's no second button to bind it to.

const DWELL_TIME_MS = 1200;
const DWELL_ANGLE_DEG = 9;

export class CardboardInput {
  constructor(rig, pauseIconWorldGetter) {
    this.rig = rig;
    this.getPauseIconWorldPos = pauseIconWorldGetter;

    this.onTrigger = null;      // () => void
    this.onDwellComplete = null; // () => void

    this.dwellProgress = 0; // 0..1, exposed for reticle hover visuals
    this._dwellMs = 0;

    this._forward = new THREE.Vector3();
    this._toIcon = new THREE.Vector3();
    this._rigWorldPos = new THREE.Vector3();

    const fire = (e) => {
      // Ignore taps on the permission/overlay UI — only canvas taps are gameplay triggers
      if (e.target && e.target.closest && e.target.closest('#vr-enter-overlay')) return;
      this.onTrigger && this.onTrigger();
    };
    window.addEventListener('touchstart', fire, { passive: true });
    window.addEventListener('mousedown', fire);
  }

  update(deltaMs) {
    // Dwell-to-pause: look at the head-locked pause icon for DWELL_TIME_MS
    this.rig.getWorldDirection(this._forward);
    this.rig.getWorldPosition(this._rigWorldPos);
    const iconWorldPos = this.getPauseIconWorldPos();

    this._toIcon.copy(iconWorldPos).sub(this._rigWorldPos).normalize();
    const angle = THREE.MathUtils.radToDeg(this._forward.angleTo(this._toIcon));

    if (angle < DWELL_ANGLE_DEG) {
      this._dwellMs += deltaMs;
      this.dwellProgress = Math.min(this._dwellMs / DWELL_TIME_MS, 1);
      if (this._dwellMs >= DWELL_TIME_MS) {
        this._dwellMs = 0;
        this.dwellProgress = 0;
        this.onDwellComplete && this.onDwellComplete();
      }
    } else {
      this._dwellMs = 0;
      this.dwellProgress = 0;
    }
  }
}

// --- Device orientation -> quaternion (standard W3C DeviceOrientation algorithm) ---
const EULER = new THREE.Euler();
const Q0 = new THREE.Quaternion();
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 around X
const ZEE = new THREE.Vector3(0, 0, 1);

export function orientationToQuaternion(out, alphaDeg, betaDeg, gammaDeg, screenAngleDeg) {
  const alpha = THREE.MathUtils.degToRad(alphaDeg || 0);
  const beta = THREE.MathUtils.degToRad(betaDeg || 0);
  const gamma = THREE.MathUtils.degToRad(gammaDeg || 0);
  const orient = THREE.MathUtils.degToRad(screenAngleDeg || 0);

  EULER.set(beta, alpha, -gamma, 'YXZ');
  out.setFromEuler(EULER);
  out.multiply(Q1);
  out.multiply(Q0.setFromAxisAngle(ZEE, -orient));
  return out;
}

export async function requestMotionPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      return result === 'granted';
    } catch (e) {
      return false;
    }
  }
  // Non-iOS or older browsers: no permission gate, assume available if the event exists
  return typeof DeviceOrientationEvent !== 'undefined';
}
