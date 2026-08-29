import * as THREE from 'three';
import { AudioController } from './audio.js';
import { Hud } from './hud.js';
import { GameClock } from './clock.js';
import { CardboardInput, orientationToQuaternion } from './input.js';
import { LevelManager } from './level.js';
import { GridSocket, FlyingDisc, DemoDisc, DiscTornado, setSharedTextures, FLY_HEIGHT } from './entities.js';
import { COLS, ROWS, TABLE_Y, GRID_CENTER_Z, GRID_MIN_X, GRID_MAX_X, GRID_MIN_Z, GRID_MAX_Z, PITCH } from './constants.js';

// Entry point is deliberately NOT this module's top-level code.
// diagnostics.js (zero Three.js dependency) is the actual page entry
// point and dynamically imports this file + calls startApp() only
// after the user taps START. That way a broken/slow Three.js CDN
// fetch or a WebGL init failure can never prevent the diagnostics
// checklist itself from running.

export function startApp() {
  // ---------------- Renderer / Scene ----------------
  // getViewportSize() prefers visualViewport over window.innerWidth/Height:
  // more reliable on mobile Safari, where browser-chrome show/hide can
  // change the visual viewport without the older values updating cleanly.
  // In standalone (Home Screen) mode there's no browser chrome and the
  // two converge, but this keeps things correct in a regular tab too.
  function getViewportSize() {
    const vv = window.visualViewport;
    return vv ? { w: vv.width, h: vv.height } : { w: window.innerWidth, h: window.innerHeight };
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  {
    const { w, h } = getViewportSize();
    renderer.setSize(w, h);
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05000a);

  // Head rig: rotation driven by device orientation. Two eye cameras hang
  // off it with a fixed IPD offset for the stereo split.
  const EYE_SEPARATION = 0.064;
  const rig = new THREE.Group();
  rig.position.set(0, 1.6, 0.4);
  scene.add(rig);

  const initialAspect = (() => { const { w, h } = getViewportSize(); return (w / 2) / h; })();

  const leftCamera = new THREE.PerspectiveCamera(75, initialAspect, 0.01, 50);
  leftCamera.position.set(-EYE_SEPARATION / 2, 0, 0);
  rig.add(leftCamera);

  const rightCamera = new THREE.PerspectiveCamera(75, initialAspect, 0.01, 50);
  rightCamera.position.set(EYE_SEPARATION / 2, 0, 0);
  rig.add(rightCamera);

  let viewW = 0, viewH = 0;

  function resize() {
    const { w, h } = getViewportSize();
    viewW = w; viewH = h;
    renderer.setSize(w, h);
    const aspect = (w / 2) / h;
    leftCamera.aspect = aspect; leftCamera.updateProjectionMatrix();
    rightCamera.aspect = aspect; rightCamera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
  }

  // Lighting
  scene.add(new THREE.HemisphereLight(0x9999ff, 0x220033, 0.9));
  const keyLight = new THREE.PointLight(0xff66ff, 1.2, 8);
  keyLight.position.set(0, 2.2, GRID_CENTER_Z);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0x00aaff, 0.8, 8);
  rimLight.position.set(0, 1.2, GRID_CENTER_Z - 2);
  scene.add(rimLight);

  // ---------------- Environment ----------------
  const loader = new THREE.TextureLoader();
  const discTexture = loader.load('./assets/images/disc_texture.png');
  const tornadoTexture = loader.load('./assets/images/tornado_texture.png');
  discTexture.colorSpace = THREE.SRGBColorSpace;
  tornadoTexture.colorSpace = THREE.SRGBColorSpace;
  setSharedTextures(discTexture, tornadoTexture);

  // Enclosing grid room (gold lines on black, matches reference art) —
  // replaces the old sky-sphere + separate floor circle with one
  // contained space, unlit on purpose so the lit table/game props read
  // clearly against it.
  const gridRoomTexture = loader.load('./assets/images/grid_room.png');
  gridRoomTexture.wrapS = THREE.RepeatWrapping;
  gridRoomTexture.wrapT = THREE.RepeatWrapping;
  gridRoomTexture.repeat.set(8, 8);
  gridRoomTexture.colorSpace = THREE.SRGBColorSpace;

  const ROOM_W = 12, ROOM_H = 6, ROOM_D = 12;
  const roomGeo = new THREE.BoxGeometry(ROOM_W, ROOM_H, ROOM_D);
  const roomMat = new THREE.MeshBasicMaterial({ map: gridRoomTexture, side: THREE.BackSide });
  const room = new THREE.Mesh(roomGeo, roomMat);
  room.position.set(0, ROOM_H / 2, GRID_CENTER_Z - 0.2);
  scene.add(room);

  const tableGeo = new THREE.BoxGeometry(
    (GRID_MAX_X - GRID_MIN_X) + 0.3, 0.04, (GRID_MAX_Z - GRID_MIN_Z) + 0.3
  );
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x140820, roughness: 0.5, metalness: 0.2 });
  const table = new THREE.Mesh(tableGeo, tableMat);
  table.position.set(0, TABLE_Y - 0.02, GRID_CENTER_Z);
  scene.add(table);

  // ---------------- HUD / Clock / Input ----------------
  const hud = new Hud(scene, rig);
  hud.setHudVisible(false);
  const gameClock = new GameClock();

  const tmpIconPos = new THREE.Vector3();
  const input = new CardboardInput(rig, () => hud.getPauseIconWorldPosition(tmpIconPos));

  // ---------------- Game state ----------------
  let gameState = 'LOBBY'; // LOBBY, PLAYING, PAUSED
  let score = 0;
  let highScore = parseInt(localStorage.getItem('tornadoConesVrHighScore')) || 0;
  let gridLights = [];
  let activeDisc = null;
  let rippleOrigin = { x: 0, z: 0 };
  let rippleStartMs = -9999;
  let streakRestores = 0;
  let activeStreakLights = [];
  let consecutiveSuccess = 0;
  let highlightedSocket = null;
  let lobbyGazedButton = null;
  let lastLobbyGazed = null;
  let audioMuted = false;
  let demoTornado = null;
  let demoDisc = null;
  let lastDemoTriggerMs = -99999;
  let lobbyDwellMs = 0;
  const lobbyButtonDrawState = { PLAY: false, SCORES: false, SOUND: false };
  const LOBBY_DWELL_MS = 1400;
  const DEMO_IDLE_RESPAWN_MS = 6000;
  const DEMO_BOUNDS = { minX: -3, maxX: 3, minZ: -6, maxZ: -0.6 };

  const world = { entities: [], tornadoes: [], balls: [], cubes: [] };
  const level = new LevelManager(scene, AudioController, gameClock, hud, world);

  function updateHighScore() {
    if (score > highScore) {
      highScore = score;
      localStorage.setItem('tornadoConesVrHighScore', highScore);
    }
    hud.drawHighScore(highScore);
  }
  updateHighScore();

  function loadScoreHistory() {
    try { return JSON.parse(localStorage.getItem('tornadoConesVrScores') || '[]'); }
    catch (e) { return []; }
  }

  function saveScoreToHistory(finalScore) {
    const list = loadScoreHistory();
    list.push(finalScore);
    list.sort((a, b) => b - a);
    const trimmed = list.slice(0, 5);
    localStorage.setItem('tornadoConesVrScores', JSON.stringify(trimmed));
    return trimmed;
  }

  level.onLevelComplete = () => { hud.announce('LEVEL UP!', '#00ffff'); };
  level.onBallRingCleared = () => {};

  function buildGrid() {
    gridLights.forEach(l => l.destroy(scene));
    gridLights = [];
    for (let i = 0; i < COLS * ROWS; i++) gridLights.push(new GridSocket(i, scene, gameClock));
  }

  function restoreRandomDisc() {
    const candidates = gridLights.filter(l => !l.hasDisc && !l.isRestoring);
    if (candidates.length === 0) return;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    target.restore(() => AudioController.playFlip());
    streakRestores++;
    activeStreakLights.push(target);
    if (streakRestores >= 2) activeStreakLights.forEach(l => l.setRing(true));
  }

  function launchDisc() {
    if (activeDisc) return;
    const available = gridLights.filter(l => l.hasDisc && !l.isRestoring);
    if (available.length === 0) return;

    let choice;
    if (highlightedSocket && highlightedSocket.hasDisc && !highlightedSocket.isRestoring) {
      choice = highlightedSocket;
    } else {
      choice = available[Math.floor(Math.random() * available.length)];
    }
    if (highlightedSocket) { highlightedSocket.setGazeHighlight(false); highlightedSocket = null; }

    choice.hasDisc = false;
    choice.updateVisuals();

    const idx = activeStreakLights.indexOf(choice);
    if (idx > -1) { choice.setRing(false); activeStreakLights.splice(idx, 1); }

    rippleOrigin = { x: choice.x, z: choice.z };
    rippleStartMs = gameClock.elapsed;

    AudioController.playLaunch();
    hud.announce('GO!', '#ffffff');

    activeDisc = new FlyingDisc(choice, scene, gameClock, AudioController, (status, color) => {
      hud.drawStatus(status, color, score);
    });

    activeDisc.onMature = () => restoreRandomDisc();

    activeDisc.onCatch = () => {
      score++;
      consecutiveSuccess++;
      if (streakRestores >= 5) hud.announce('STREAK!', '#ffd700');
      else if (consecutiveSuccess >= 2) hud.announce('COMBO x' + consecutiveSuccess, '#44ff44');
      else hud.announce('GO!', '#44ff44');
      level.onFlip();
      hud.drawStatus('DISC RENEWED', '#ffffff', score);
    };

    activeDisc.onMiss = () => {
      consecutiveSuccess = 0;
      score = Math.max(0, score - 1);
      updateHighScore();
      hud.drawStatus('DESTROYED!', '#ff4444', score);
    };

    activeDisc.onDestroyed = () => {
      activeDisc = null;
      const remaining = gridLights.filter(l => l.hasDisc || l.isRestoring).length;
      if (remaining === 0 && gameState === 'PLAYING') {
        saveScoreToHistory(score);
        hud.announce('YOU LOSE - ALL CONES LOST', '#ff4444');
        gameClock.after(3000, () => returnToLobby());
      }
    };
  }

  function dropActiveDisc() {
    if (!activeDisc) return;
    activeDisc.destroy('DROPPED', '#ffffff');
    streakRestores = 0;
    activeStreakLights.forEach(l => l.setRing(false));
    activeStreakLights.length = 0;
    hud.announce('DESTROYED!', '#ffffff');
  }

  function enterLobby() {
    gameState = 'LOBBY';
    lobbyGazedButton = null;
    lastLobbyGazed = null;
    lobbyDwellMs = 0;
    lastDemoTriggerMs = gameClock.elapsed;
    hud.setTitleVisible(true);
    hud.setLobbyVisible(true);
    hud.drawTitle();
    hud.drawPlayButton(false);
    hud.drawScoresButton(false);
    hud.drawSoundButton(!audioMuted, false);
    if (!demoTornado) demoTornado = new DiscTornado(1.0, scene, AudioController);
  }

  function startGame() {
    gameState = 'PLAYING';
    score = 0;
    consecutiveSuccess = 0;
    streakRestores = 0;
    activeStreakLights.length = 0;
    highlightedSocket = null;
    gameClock.clearAll();
    hud.setTitleVisible(false);
    hud.setLobbyVisible(false);
    hud.setHudVisible(true);
    hud.drawStatus('STANDBY', '#aaaaaa', score);

    if (demoDisc) { demoDisc.destroy(); demoDisc = null; }
    if (demoTornado) { demoTornado.destroy(); demoTornado = null; }

    buildGrid();
    level.init();

    gameClock.after(500, () => {
      if (gameState === 'PLAYING' && !activeDisc) launchDisc();
    });
  }

  function returnToLobby() {
    highlightedSocket = null;
    world.entities.forEach(e => e.destroy());
    world.entities.length = 0;
    world.tornadoes.length = 0;
    world.balls.length = 0;
    world.cubes.length = 0;
    if (activeDisc) activeDisc.destroy('GAME OVER', '#ffffff');
    gridLights.forEach(l => l.destroy(scene));
    gridLights = [];
    hud.setHudVisible(false);
    enterLobby();
  }

  function activateLobbyButton(name) {
    if (name === 'PLAY') {
      startGame();
    } else if (name === 'SCORES') {
      hud.toggleScoresPanel(loadScoreHistory());
    } else if (name === 'SOUND') {
      audioMuted = !audioMuted;
      AudioController.toggleSfx();
      AudioController.toggleMusic();
    }
  }

  function updateLobbyGaze(deltaMs) {
    rig.getWorldPosition(rayOrigin);
    rig.getWorldDirection(rayDir);
    let found = null;
    let bestAngle = Infinity;
    hud.getLobbyButtons().forEach(b => {
      b.mesh.getWorldPosition(gazeTable);
      gazeTable.sub(rayOrigin).normalize();
      const angle = rayDir.angleTo(gazeTable);
      if (angle < 0.17 && angle < bestAngle) { bestAngle = angle; found = b.name; }
    });

    if (found !== lastLobbyGazed) {
      lobbyDwellMs = 0;
      lastLobbyGazed = found;
    }
    lobbyGazedButton = found;
    hud.pulseLobbyButtons(found);

    let progress = 0;
    let fired = false;
    if (found) {
      lobbyDwellMs += deltaMs;
      progress = Math.min(lobbyDwellMs / LOBBY_DWELL_MS, 1);
      if (lobbyDwellMs >= LOBBY_DWELL_MS) {
        fired = true;
      }
    }

    ['PLAY', 'SCORES', 'SOUND'].forEach(name => {
      const isTarget = found === name && !fired;
      const p = isTarget ? progress : 0;
      if (isTarget || lobbyButtonDrawState[name]) {
        if (name === 'PLAY') hud.drawPlayButton(isTarget, p);
        else if (name === 'SCORES') hud.drawScoresButton(isTarget, p);
        else hud.drawSoundButton(!audioMuted, isTarget, p);
        lobbyButtonDrawState[name] = isTarget;
      }
    });

    if (fired) {
      const name = found;
      lobbyDwellMs = 0;
      lastLobbyGazed = null;
      lobbyGazedButton = null;
      activateLobbyButton(name);
    }
  }

  function spawnDemoDisc() {
    if (demoDisc) return;
    demoDisc = new DemoDisc(scene, 0, GRID_CENTER_Z, TABLE_Y + FLY_HEIGHT, DEMO_BOUNDS);
  }

  function togglePause() {
    if (gameState === 'PLAYING') {
      gameState = 'PAUSED';
      gameClock.setPaused(true);
      hud.announce('PAUSED', '#00ff00');
      AudioController.suspend();
    } else if (gameState === 'PAUSED') {
      gameState = 'PLAYING';
      gameClock.setPaused(false);
      hud.announce('GO!', '#00ff00');
      AudioController.resume();
    }
  }

  // ---------------- Input wiring ----------------
  input.onTrigger = () => {
    if (gameState === 'LOBBY') {
      AudioController.resume();
      if (!demoDisc) {
        spawnDemoDisc();
        lastDemoTriggerMs = gameClock.elapsed;
      }
      return;
    }
    if (gameState !== 'PLAYING') return;
    AudioController.resume();
    if (activeDisc) dropActiveDisc();
    else launchDisc();
  };

  input.onDwellComplete = () => {
    if (gameState === 'PLAYING' || gameState === 'PAUSED') togglePause();
  };

  // ---------------- Device orientation ----------------
  // Permission was already granted during the diagnostics phase before
  // startApp() was ever called, so this listener just works.
  let latestOrientation = { alpha: 0, beta: 0, gamma: 0 };
  let screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;

  window.addEventListener('deviceorientation', (e) => {
    latestOrientation.alpha = e.alpha;
    latestOrientation.beta = e.beta;
    latestOrientation.gamma = e.gamma;
  });
  window.addEventListener('orientationchange', () => {
    screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  });

  // ---------------- Main loop ----------------
  const clock3 = new THREE.Clock();
  const gazeTarget = new THREE.Vector3();
  const gazeTable = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3();

  function raycastToPlane(outVec, planeY) {
    rig.getWorldPosition(rayOrigin);
    rig.getWorldDirection(rayDir);
    const denom = rayDir.y;
    if (Math.abs(denom) < 0.05) return false;
    const t = (planeY - rayOrigin.y) / denom;
    if (t <= 0) return false;
    outVec.set(rayOrigin.x + rayDir.x * t, planeY, rayOrigin.z + rayDir.z * t);
    return true;
  }

  const SELECTION_RADIUS = PITCH * 0.7;

  function updateSocketHighlight() {
    let newTarget = null;
    if (raycastToPlane(gazeTable, TABLE_Y)) {
      let minD = Infinity;
      gridLights.forEach(l => {
        if (!l.hasDisc || l.isRestoring) return;
        const d = Math.hypot(l.x - gazeTable.x, l.z - gazeTable.z);
        if (d < minD) { minD = d; newTarget = l; }
      });
      if (newTarget && minD > SELECTION_RADIUS) newTarget = null;
    }
    if (newTarget !== highlightedSocket) {
      if (highlightedSocket) highlightedSocket.setGazeHighlight(false);
      if (newTarget) newTarget.setGazeHighlight(true);
      highlightedSocket = newTarget;
    }
  }

  function animate() {
    requestAnimationFrame(animate);

    const deltaMs = Math.min(clock3.getDelta(), 0.05) * 1000;
    gameClock.tick(deltaMs);
    const dt = gameClock.dtSeconds(deltaMs);
    const now = gameClock.elapsed;

    orientationToQuaternion(rig.quaternion, latestOrientation.alpha, latestOrientation.beta, latestOrientation.gamma, screenAngle);

    input.update(deltaMs);
    hud.drawPauseIcon(input.dwellProgress);

    if (gameState === 'LOBBY') {
      updateLobbyGaze(deltaMs);

      if (demoTornado) demoTornado.update(dt, now, demoDisc);

      if (demoDisc) {
        if (raycastToPlane(gazeTable, TABLE_Y + FLY_HEIGHT)) {
          const dx = gazeTable.x - demoDisc.x, dz = gazeTable.z - demoDisc.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.05) demoDisc.nudge(dx / dist, dz / dist, dt);
        }
        demoDisc.update(dt, demoTornado);
        if (demoDisc.done) {
          demoDisc = null;
          lastDemoTriggerMs = now;
        }
      } else if (now - lastDemoTriggerMs > DEMO_IDLE_RESPAWN_MS) {
        spawnDemoDisc();
        lastDemoTriggerMs = now;
      }
    }

    if (gameState === 'PLAYING' && !activeDisc) {
      updateSocketHighlight();
    } else if (highlightedSocket) {
      highlightedSocket.setGazeHighlight(false);
      highlightedSocket = null;
    }

    if (gameState === 'PLAYING' && dt > 0) {
      let steerDir = { x: 0, y: 0 };
      if (activeDisc && activeDisc.state === 'flying' && !activeDisc.isGreen) {
        if (raycastToPlane(gazeTarget, TABLE_Y + FLY_HEIGHT)) {
          const dx = gazeTarget.x - activeDisc.x;
          const dz = gazeTarget.z - activeDisc.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.03) steerDir = { x: dx / dist, y: dz / dist };
        }
      }

      if (activeDisc) activeDisc.update(dt, now, world.tornadoes, steerDir);

      world.entities.forEach(e => {
        if (e.type === 'ball') e.update(dt, activeDisc, world.tornadoes, gridLights);
        else if (e.type === 'tornado') e.update(dt, now, activeDisc);
        else if (e.type === 'cube') {
          e.update(dt, world.tornadoes, world.balls, activeDisc, {
            removeTornado: (i) => {
              const t = world.tornadoes[i]; t.destroy();
              world.tornadoes.splice(i, 1);
              const idx = world.entities.indexOf(t); if (idx > -1) world.entities.splice(idx, 1);
            },
            removeBall: (i) => {
              const b = world.balls[i]; b.destroy();
              world.balls.splice(i, 1);
              const idx = world.entities.indexOf(b); if (idx > -1) world.entities.splice(idx, 1);
            }
          });
        }
      });
      gridLights.forEach(l => l.update(now, world.tornadoes, rippleOrigin, rippleStartMs));
    }

    AudioController.updateListener(rig, gazeTarget);

    renderer.setScissorTest(true);
    const w = viewW, h = viewH;

    renderer.setScissor(0, 0, w / 2, h);
    renderer.setViewport(0, 0, w / 2, h);
    renderer.render(scene, leftCamera);

    renderer.setScissor(w / 2, 0, w / 2, h);
    renderer.setViewport(w / 2, 0, w / 2, h);
    renderer.render(scene, rightCamera);
  }

  if (!AudioController.isInit) AudioController.init();
  resize();
  enterLobby();
  animate();
}
