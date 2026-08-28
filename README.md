# Tornado Cones VR

Full WebXR rewrite of [tornado-cones](https://github.com/polerix/tornado-cones), targeting the Quest Browser. Built on Three.js — no dependency on the old CSS3D/DOM implementation.

Play by standing at a floating tabletop grid: launch a disc, survive while it's RED, let go once it turns GREEN so the tornado sucks it in. Levels add more tornadoes, homing balls, and a renewal cube, same as the original.

## Controls (right-hand primary)
- **Right thumbstick** — steer the disc while it's red
- **Right trigger** — launch a disc / drop the active one
- **Either grip** — pause / resume
- Any trigger press on the title screen starts the run

## Run it
Static site, no build step. Serve the folder over HTTPS (WebXR requires a secure context) and open it in the Quest Browser:

```
npx serve .
```

GitHub Pages works too — enable Pages on this repo pointed at `main` / root.

## What changed vs. the original, and why
- **Full engine swap.** The original was CSS3D (`transform-style: preserve-3d`) faking depth with absolutely-positioned divs. This is real Three.js geometry in real 3D — no more faking a Z axis.
- **Input.** WASD + on-screen joystick → right thumbstick. Space (dual launch/drop) → right trigger. `P`/`Escape` pause → grip button.
- **HUD.** The old version used DOM overlays for score/status/announcer text. Quest Browser's WebXR `dom-overlay` support is inconsistent, so all HUD elements are now canvas-texture panels rendered in-scene.
- **Timing.** The original counted rAF frames (implicitly assuming ~60Hz) for things like "5 seconds until the disc turns green." Quest runs 72–120Hz, so everything here is delta-time based instead — frame-rate independent.
- **World scale.** Original grid was 920×920 CSS pixels. This is a ~1.8m × 1.8m tabletop at chest height, 1–2.6m in front of the player. Speeds and radii were re-tuned by feel for that physical scale, not literally converted from pixels.
- **Audio.** Same procedural Web Audio API sounds (oscillator-based flip/launch SFX, looping tracks), but panners now use real XYZ world meters instead of faked 2D game coordinates — genuine positional audio.
- **Haptics.** `navigator.vibrate` → WebXR gamepad `hapticActuators`.
- **Cut: attract/demo mode.** The original auto-played a demo after 2 minutes idle on the start screen. Doesn't translate to someone standing in a headset — cut for v1. Flag if you want a VR-appropriate replacement (e.g. an idle title-screen animation).
- **Cut: flat/non-VR fallback.** WebXR-only per spec — no desktop keyboard mode.

## File layout
```
index.html          entry point, importmap, VR-enter overlay
js/main.js           scene setup, WebXR session, game state, main loop
js/entities.js        GridSocket, FlyingDisc, DiscTornado, GreenBall, OrangeCube
js/level.js           LevelManager (spawn/level-up rules, unchanged from original)
js/hud.js             canvas-texture world-space HUD panels
js/input.js            controller thumbstick/trigger/grip/haptics
js/audio.js            Web Audio procedural SFX + positional panners
js/clock.js            pause-aware game clock + delayed-callback scheduler
js/constants.js        shared world-scale numbers
assets/                textures, fonts, music (carried over from tornado-cones)
```

## Known gaps / next pass
- No controller ray or hand-presence models — this is a tabletop game, not a hand-tracking demo, so it wasn't worth the extra asset loads. Worth revisiting if it feels disorienting without any visible controller representation.
- No haptic differentiation between quest2/quest3 controller profiles — uses the standard `hapticActuators[0]` API, should work on both but untested on real hardware.
- Untested on-device. This was built and syntax-checked in a sandbox with no WebXR runtime available — needs an actual Quest Browser pass before you trust any of the tuning numbers.
