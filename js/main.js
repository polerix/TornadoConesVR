import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { AudioController } from './audio.js';
import { Hud } from './hud.js';
import { GameClock } from './clock.js';
import { ControllerInput } from './input.js';
import { LevelManager } from './level.js';
import {
  GridSocket, FlyingDisc, setSharedTextures
} from './entities.js';
import { COLS, ROWS, TABLE_Y, GRID_CENTER_Z, GRID_MIN_X, GRID_MAX_X, GRID_MIN_Z, GRID_MAX_Z } from './constants.js';

// ---------------- Renderer / Scene / Camera ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05000a);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0, 1.6, 0.4);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Lighting
scene.add(new THREE.HemisphereLight(0x9999ff, 0x220033, 0.9));
const keyLight = new THREE.PointLight(0xff66ff, 1.2, 8);
keyLight.position.set(0, 2.2, GRID_CENTER_Z);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x00aaff, 0.8, 8);
rimLight.position.set(0, 1.2, GRID_CENTER_Z - 2);
scene.add(rimLight);

// ---------------- VR Button / support check ----------------
const overlay = document.getElementById('vr-enter-overlay');
const buttonSlot = document.getElementById('vr-button-slot');
const unsupportedMsg = document.getElementById('vr-unsupported');

if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (supported) {
      const btn = VRButton.createButton(renderer);
      buttonSlot.appendChild(btn);
    } else {
      unsupportedMsg.style.display = 'block';
    }
  }).catch(() => { unsupportedMsg.style.display = 'block'; });
} else {
  unsupportedMsg.style.display = 'block';
}

renderer.xr.addEventListener('sessionstart', () => {
  overlay.style.display = 'none';
  if (!AudioController.isInit) AudioController.init();
});
renderer.xr.addEventListener('sessionend', () => {
  overlay.style.display = 'flex';
});

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
floor.position.y = 0;
scene.add(floor);

const tableGeo = new THREE.BoxGeometry(
  (GRID_MAX_X - GRID_MIN_X) + 0.3,
  0.04,
  (GRID_MAX_Z - GRID_MIN_Z) + 0.3
);
const tableMat = new THREE.MeshStandardMaterial({ color: 0x140820, roughness: 0.5, metalness: 0.2 });
const table = new THREE.Mesh(tableGeo, tableMat);
table.position.set(0, TABLE_Y - 0.02, GRID_CENTER_Z);
scene.add(table);

// ---------------- HUD / Clock / Input / Audio-managed state ----------------
const hud = new Hud(scene);
hud.setHudVisible(false);
const gameClock = new GameClock();
const input = new ControllerInput(renderer, scene);

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
let lastRumble = 0;

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

level.onLevelComplete = () => {
  input.hapticBoth(0.7, 120);
  gameClock.after(80, () => input.hapticBoth(0.7, 120));
};
level.onBallRingCleared = () => input.hapticBoth(0.5, 40);

function buildGrid() {
  gridLights.forEach(l => l.destroy(scene));
  gridLights = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    gridLights.push(new GridSocket(i, scene, gameClock));
  }
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
  const available = gridLights.filter(l => l.hasDisc);
  if (available.length === 0) return;

  const choice = available[Math.floor(Math.random() * available.length)];
  choice.hasDisc = false;
  choice.updateVisuals();

  const idx = activeStreakLights.indexOf(choice);
  if (idx > -1) {
    choice.setRing(false);
    activeStreakLights.splice(idx, 1);
  }

  rippleOrigin = { x: choice.x, z: choice.z };
  rippleStartMs = gameClock.elapsed;

  input.hapticBoth(0.6, 90);
  AudioController.playLaunch();
  hud.announce('GO!', '#ffffff');

  activeDisc = new FlyingDisc(choice, scene, gameClock, AudioController, (status, color) => {
    hud.drawStatus(status, color, score);
  });

  activeDisc.onMature = () => restoreRandomDisc();

  activeDisc.onCatch = () => {
    score++;
    consecutiveSuccess++;
    input.hapticBoth(0.8, 150);

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
    input.hapticBoth(0.8, 150);
    AudioController.resume();
  }
}

// ---------------- Input wiring ----------------
input.onTriggerDown = (handedness) => {
  if (gameState === 'START') {
    if (!AudioController.isInit) AudioController.init();
    startGame();
    return;
  }
  if (gameState !== 'PLAYING') return;
  if (handedness !== 'right') return;

  AudioController.resume();
  if (activeDisc) dropActiveDisc();
  else launchDisc();
};

input.onGripDown = () => {
  if (gameState === 'PLAYING' || gameState === 'PAUSED') togglePause();
};

// ---------------- Main loop ----------------
const clock3 = new THREE.Clock();
const listenerFwd = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const deltaMs = Math.min(clock3.getDelta(), 0.05) * 1000;
  gameClock.tick(deltaMs);
  const dt = gameClock.dtSeconds(deltaMs);
  const now = gameClock.elapsed;

  input.update();

  if (gameState === 'PLAYING' && dt > 0) {
    if (activeDisc) {
      activeDisc.update(dt, now, world.tornadoes, input.thumbstick);

      // Boundary rumble
      const outOfBounds =
        activeDisc.x < GRID_MIN_X || activeDisc.x > GRID_MAX_X ||
        activeDisc.z < GRID_MIN_Z || activeDisc.z > GRID_MAX_Z;
      if (outOfBounds && now - lastRumble > 60) {
        input.haptic('right', 0.3, 20);
        lastRumble = now;
      }
    }
    world.entities.forEach(e => {
      if (e.type === 'ball') {
        e.update(dt, activeDisc, world.tornadoes, gridLights);
      } else if (e.type === 'tornado') {
        e.update(dt, now, activeDisc);
      } else if (e.type === 'cube') {
        e.update(dt, world.tornadoes, world.balls, activeDisc, {
          removeTornado: (i) => {
            const t = world.tornadoes[i];
            t.destroy();
            world.tornadoes.splice(i, 1);
            const idx = world.entities.indexOf(t);
            if (idx > -1) world.entities.splice(idx, 1);
          },
          removeBall: (i) => {
            const b = world.balls[i];
            b.destroy();
            world.balls.splice(i, 1);
            const idx = world.entities.indexOf(b);
            if (idx > -1) world.entities.splice(idx, 1);
          }
        });
      }
    });
    gridLights.forEach(l => l.update(now, world.tornadoes, rippleOrigin, rippleStartMs));
  }

  if (renderer.xr.isPresenting) {
    AudioController.updateListener(renderer.xr.getCamera(camera), listenerFwd);
  } else {
    AudioController.updateListener(camera, listenerFwd);
  }

  renderer.render(scene, camera);
});
