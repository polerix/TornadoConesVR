import * as THREE from 'three';

// Reads right-hand thumbstick for movement, trigger for launch/drop,
// grip (either hand) for pause. No controller ray/hand models are
// rendered — this is a tabletop game, not a hand-presence experience.

export class ControllerInput {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.thumbstick = { x: 0, y: 0 };
    this._triggerWasDown = { left: false, right: false };
    this._gripWasDown = { left: false, right: false };

    this.onTriggerDown = null; // (handedness) => void
    this.onGripDown = null;    // (handedness) => void

    this.sources = {}; // handedness -> XRInputSource

    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      controller.addEventListener('connected', (e) => {
        const handedness = e.data.handedness || (i === 0 ? 'left' : 'right');
        this.sources[handedness] = e.data;
      });
      controller.addEventListener('disconnected', (e) => {
        const handedness = e.data && e.data.handedness;
        if (handedness && this.sources[handedness]) delete this.sources[handedness];
      });
      scene.add(controller);
    }
  }

  update() {
    this.thumbstick.x = 0;
    this.thumbstick.y = 0;

    for (const handedness of ['left', 'right']) {
      const src = this.sources[handedness];
      if (!src || !src.gamepad) continue;
      const gp = src.gamepad;

      // Movement: prefer right hand thumbstick
      if (handedness === 'right' && gp.axes && gp.axes.length >= 2) {
        // Touch controllers report thumbstick on the last two axes
        const ax = gp.axes[gp.axes.length - 2] || 0;
        const ay = gp.axes[gp.axes.length - 1] || 0;
        const deadzone = 0.15;
        this.thumbstick.x = Math.abs(ax) > deadzone ? ax : 0;
        this.thumbstick.y = Math.abs(ay) > deadzone ? ay : 0;
      }

      // Trigger = buttons[0], Grip = buttons[1] (standard XR mapping)
      const triggerDown = !!(gp.buttons[0] && gp.buttons[0].pressed);
      const gripDown = !!(gp.buttons[1] && gp.buttons[1].pressed);

      if (triggerDown && !this._triggerWasDown[handedness]) {
        this.onTriggerDown && this.onTriggerDown(handedness);
      }
      if (gripDown && !this._gripWasDown[handedness]) {
        this.onGripDown && this.onGripDown(handedness);
      }
      this._triggerWasDown[handedness] = triggerDown;
      this._gripWasDown[handedness] = gripDown;
    }
  }

  haptic(handedness, intensity, durationMs) {
    const src = this.sources[handedness];
    if (!src || !src.gamepad) return;
    const actuator = src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
    if (actuator && actuator.pulse) {
      actuator.pulse(Math.min(1, Math.max(0, intensity)), durationMs);
    }
  }

  hapticBoth(intensity, durationMs) {
    this.haptic('left', intensity, durationMs);
    this.haptic('right', intensity, durationMs);
  }
}
