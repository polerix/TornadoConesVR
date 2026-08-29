# Tornado Cones VR (Cardboard)

Web-based Google Cardboard build of [tornado-cones](https://github.com/polerix/tornado-cones), built with Three.js. Runs in mobile Safari — no app store, no build step, no Unity/Xcode.

Play by standing at a floating tabletop grid: launch a disc, survive while it's RED (steer it by looking where you want it to go), let go once it turns GREEN so the tornado sucks it in. Levels add more tornadoes, homing balls, and a renewal cube, same as the original CSS3D game.

## Why Cardboard, not WebXR
This started as a Quest/WebXR rewrite (see commit history) using controller thumbstick/trigger/grip input. The actual target hardware turned out to be a Google Cardboard viewer on iPhone — no controller, no thumbstick, no analog trigger, and iOS Safari's WebXR support is inconsistent-to-absent. So this is a full second pass: manual side-by-side stereo rendering via two `THREE.PerspectiveCamera`s instead of a WebXR session, and `DeviceOrientationEvent` for head tracking instead of the WebXR Device API. The core game logic (`entities.js`, `level.js`, `audio.js`, `clock.js`, `constants.js`) didn't need to change — only the render and input layers did.

## Controls (3-DoF gaze, matches standard Cardboard input model)
- **Lobby**: look at PLAY / HIGH SCORES / SOUND, pull the trigger to select. No blind tap-to-start — you have to actually be looking at something.
- **In-game — look at a disc socket** — while no disc is in flight, gazing near an available socket highlights it; the trigger launches that specific disc instead of a random one
- **In-game — look** — while the disc is red, it steers toward wherever you're looking on the table
- **Trigger** (screen tap / viewer's built-in lever) — launch the highlighted disc / drop the active one
- **Look at the pause icon** in the corner and hold your gaze ~1.2s — pause/resume
- Game over returns you to the Lobby, not a hard restart

## Lobby
Persistent hub, not a bypassed title screen — matches the "Lobby as central application state" architecture rather than "startup screen you skip past." First launch and every subsequent return-from-game both land here.

- **PLAY / HIGH SCORES / SOUND** — selected by **dwell**, not trigger-click: hold your gaze steady on a button for ~1.4s and a fill bar animates across it, confirming on completion. This is deliberate: it's the same "be still to select" language as the in-game pause icon, and it's discoverable by *watching it happen* rather than reading instructions — the fill bar IS the tutorial.
- **Demo disc**: a decorative, non-scored disc bounces around the room off the walls, chased by a tornado on the stage exactly like real gameplay — same red→green→caught color language, same tornado-chase visuals, different physics (bounces instead of grid-clamping, since it roams the whole room). Pull the trigger while none is active to launch one yourself; look near it while it flies to nudge its direction (weaker, cumulative pull — not full control, doesn't fight you like a stuck controller). If the player never touches the trigger, one launches on its own after ~6s idle, so the mechanic is visible even to someone who hasn't found the trigger yet. This is the answer to "show, don't tell" for a device with no on-screen buttons.
- **HIGH SCORES** panel shows the local top 5 (stored in `localStorage`, single-device only — not a real leaderboard).

Deliberately scoped down from a full native-Cardboard-SDK lobby architecture: no QR viewer calibration (no web equivalent, no lens distortion correction at all — see Environment below), no separate Tutorial room (the demo disc + dwell bars serve that purpose by demonstration), no Settings room beyond the one sound toggle.

## Core gameplay change: tug-of-war steering
The tornado now passively pulls a red (uncaught) disc toward itself the entire time it's in flight, not just once it turns green. Previously the red phase was free-roam — sit anywhere safely, no urgency. Now standing still means drifting into the tornado; you have to actively counter-steer (look away from the pull) continuously. `TORNADO_PULL_SPEED` (0.18 m/s) is set below `DISC_MOVE_SPEED` (0.55 m/s) so active counter-steering reliably wins — the tension is about *sustained attention*, not a fight you can lose by playing correctly. Worth retuning that gap if it feels too easy or too twitchy once actually tested in the headset.

## Environment
Replaced the old photographic sky-sphere background with an enclosing grid room (gold lines on black, procedurally generated, tileable) matching the reference art — the game now reads as happening inside a defined space rather than floating in a skybox. The room is unlit (`MeshBasicMaterial`) on purpose so the actually-lit table and game props read clearly against it.

## Fullscreen — use Add to Home Screen, not the Fullscreen API
`document.fullscreenEnabled` reports `false` on both Safari and Chrome-for-iOS on iPhone (Chrome-iOS is WebKit underneath — same restriction). The Fullscreen API is a dead end here; iOS refuses it for regular page elements regardless of what triggers the call.

The actual fix is standalone home-screen launch, which is a different iOS mechanism entirely and does remove all browser chrome:

1. Open the site in Safari
2. Tap Share → **Add to Home Screen**
3. Confirm **"Open as Web App"** is toggled on (this is the default on iOS 26+; on older versions any site with a proper manifest — which this repo now has — gets standalone treatment automatically)
4. Launch from the **Home Screen icon**, not from Safari itself

`index.html` now ships `manifest.json`, `apple-mobile-web-app-capable`, and icon meta tags to make this work. The diagnostics screen's fullscreen row checks `navigator.standalone` / `display-mode: standalone` and passes automatically once you're actually running from the Home Screen icon. The START button still attempts `requestFullscreen()` with vendor-prefix fallbacks as a no-cost extra try, but don't expect it to succeed in a normal Safari tab — that's the platform, not this code.

## Run it
Static site, HTTPS required for `DeviceOrientationEvent` permission prompts on iOS:

```
npx serve .
```

GitHub Pages works (enable Pages on this repo, `main` / root). Open the URL in Safari, tap "Enable Motion & Enter," allow the motion permission prompt, rotate to landscape, put the phone in the viewer.

## What's simplified vs. a native Cardboard SDK build
- **No lens barrel distortion correction.** True Cardboard apps pre-warp the framebuffer to counter the viewer's lens pincushion (per the Cardboard viewer profile / QR calibration code). This build renders flat side-by-side stereo with no distortion pass. It'll look correct-ish through the lenses but not calibrated — a real distortion shader pass is the natural next step if it feels off through the ABACUSBrands lenses specifically.
- **No viewer profile / QR calibration.** IPD is a fixed 64mm constant, not read from a scanned viewer profile.
- **No positional tracking.** This is 3-DoF (rotation only, matching how Cardboard actually works) — leaning your head doesn't move the view, only looking around does.

## File layout
```
index.html          entry point, permission-gate overlay, orientation warning
js/main.js           stereo rig/cameras, device orientation, gaze raycasting, game state, main loop
js/entities.js        GridSocket, FlyingDisc, DiscTornado, GreenBall, OrangeCube (unchanged from WebXR pass)
js/level.js           LevelManager (unchanged)
js/hud.js             canvas-texture HUD panels + head-locked reticle and pause-dwell icon
js/input.js            device-orientation quaternion math, tap trigger, gaze-dwell pause
js/audio.js            Web Audio procedural SFX + positional panners (unchanged)
js/clock.js            pause-aware game clock + delayed-callback scheduler (unchanged)
js/constants.js        shared world-scale numbers (unchanged)
assets/                textures, fonts, music
```

## Known gaps / next pass
- **Untested on-device.** Built and syntax-checked in a sandbox with no phone, no Cardboard viewer, no way to trigger `deviceorientation` events. The steering feel, dwell angle threshold (9°), and dwell time (1.2s) are first-guess numbers — expect to retune after the first real test.
- If steering feels twitchy or the dead-ahead ray-plane intersection misbehaves near the horizon (looking level rather than down at the table), that math (`raycastToTable` in `main.js`) is the first place to look.
- iOS motion permission: if the prompt doesn't appear or gets silently denied, check Settings → Safari → Motion & Orientation Access.
