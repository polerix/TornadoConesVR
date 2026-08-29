import * as THREE from 'three';
import { AudioController } from './audio.js';
import { Hud } from './hud.js';
import { GameClock } from './clock.js';
import { CardboardInput, orientationToQuaternion } from './input.js';
import { LevelManager } from './level.js';
import { GridSocket, FlyingDisc, setSharedTextures, FLY_HEIGHT } from './entities.js';
import { COLS, ROWS, TABLE_Y, GRID_CENTER_Z, GRID_MIN_X, GRID_MAX_X, GRID_MIN_Z, GRID_MAX_Z, PITCH } from './constants.js';

// Entry point is deliberately NOT this module's top-level code.
// diagnostics.js (zero Three.js dependency) is the actual page entry
// point and dynamically imports this file + calls startApp() only
// after the user taps START. That way a broken/slow Three.js CDN
// fetch or a WebGL init failure can never prevent the diagnostics
// checklist itself from running.

export function startApp() {
  // ---------------- Renderer / Scene ----------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
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

  const leftCamera = new THREE.PerspectiveCamera(75, (window.innerWidth / 2) / window.innerHeight, 0.01, 50);
  leftCamera.position.set(-EYE_SEPARATION / 2, 0, 0);
  rig.add(leftCamera);

  const rightCamera = new THREE.PerspectiveCamera(75, (window.innerWidth / 2) / window.innerHeight, 0.01, 50);
  rightCamera.position.set(EYE_SEPARATION / 2, 0, 0);
  rig.add(rightCamera);

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    const aspect = (window.innerWidth / 2) / window.innerHeight;
    leftCamera.aspect = aspect; leftCamera.updateProjectionMatrix();
    rightCamera.aspect = aspect; rightCamera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

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
  const bgTexture = loader.load('./assets/images/backgroundart.png');
  discTexture.colorSpace = THREE.SRGBColorSpace;
  tornadoTexture.colorSpace = THREE.SRGBColorSpace;
  bgTexture.colorSpace = THREE.SRGBColorSpace;
  setSharedTextures(discTexture, tornadoTexture);

  const skyGeo = new THREE.SphereGeometry(15, 32, 32);
  const skyMat = new THREE.MeshBasicMaterial({ map: bgTexture, side: THREE.BackSide });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  const floorGeo = new THREE.CircleGeometry(6, 48);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0510, roughness: 0.9 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

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
  let gameState = 'START'; // START, PLAYING, PAUSED
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
        hud.announce('YOU LOSE - ALL CONES LOST', '#ff4444');
        gameClock.after(3000, () => endToStart());
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

  function startGame() {
    gameState = 'PLAYING';
    score = 0;
    consecutiveSuccess = 0;
    streakRestores = 0;
    activeStreakLights.length = 0;
    highlightedSocket = null;
    gameClock.clearAll();
    hud.setTitleVisible(false);
    hud.setHudVisible(true);
    hud.drawStatus('STANDBY', '#aaaaaa', score);

    buildGrid();
    level.init();

    gameClock.after(500, () => {
      if (gameState === 'PLAYING' && !activeDisc) launchDisc();
    });
  }

  function endToStart() {
    gameState = 'START';
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
    hud.setTitleVisible(true);
    hud.drawTitle();
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
    if (gameState === 'START') { startGame(); return; } // restart after game over
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
    const w = window.innerWidth, h = window.innerHeight;

    renderer.setScissor(0, 0, w / 2, h);
    renderer.setViewport(0, 0, w / 2, h);
    renderer.render(scene, leftCamera);

    renderer.setScissor(w / 2, 0, w / 2, h);
    renderer.setViewport(w / 2, 0, w / 2, h);
    renderer.render(scene, rightCamera);
  }

  if (!AudioController.isInit) AudioController.init();
  resize();
  startGame();
  animate();
}
