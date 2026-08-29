// Page entry point. Deliberately imports nothing that touches Three.js
// or the CDN, so this checklist can run and report status even if the
// 3D engine (main.js, and its Three.js fetch) fails or is slow.
// main.js is only ever loaded via dynamic import, after START is tapped.

import { requestMotionPermission } from './permission.js';

const LIVE_DATA_TIMEOUT_MS = 2500;

function setRow(name, status, fixText) {
  const row = document.querySelector(`.check-row[data-check="${name}"]`);
  if (!row) return;
  row.classList.remove('pass', 'fail', 'checking', 'warn');
  row.classList.add(status);
  const icon = row.querySelector('.check-icon');
  const fix = row.querySelector('.check-fix');
  icon.textContent = { pass: '\u2713', fail: '\u2717', checking: '\u2026', warn: '!' }[status] || '\u2022';
  fix.textContent = (status === 'fail' || status === 'warn') ? (fixText || '') : '';
}

function waitForLiveOrientationData(timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const handler = (e) => {
      if (e.alpha !== null || e.beta !== null || e.gamma !== null) {
        if (!done) { done = true; cleanup(); resolve(true); }
      }
    };
    const timer = setTimeout(() => {
      if (!done) { done = true; cleanup(); resolve(false); }
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('deviceorientation', handler);
    }
    window.addEventListener('deviceorientation', handler);
  });
}

function attemptFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (!request) {
    return Promise.reject(new Error('No requestFullscreen method exists on this browser at all.'));
  }
  const result = request.call(el);
  // Older WebKit prefixed versions don't return a Promise — normalize.
  return result && typeof result.then === 'function' ? result : Promise.resolve();
}

function run() {
  const grantBtn = document.getElementById('grant-motion-btn');
  const startBtn = document.getElementById('start-game-btn');
  const fixPanel = document.getElementById('motion-fix-panel');
  const overlay = document.getElementById('vr-enter-overlay');
  const rotateWarning = document.getElementById('rotate-warning');
  const loadErrorPanel = document.getElementById('load-error-panel');

  const state = { https: false, sensors: false, motion: false };

  state.https = !!window.isSecureContext;
  setRow('https', state.https ? 'pass' : 'fail',
    state.https ? '' : 'Serve this page over HTTPS (or via localhost).');

  state.sensors = typeof DeviceOrientationEvent !== 'undefined';
  setRow('sensors', state.sensors ? 'pass' : 'fail',
    state.sensors ? '' : "This browser doesn't expose device orientation. Use Safari on iPhone.");

  const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  setRow('fullscreen', fsSupported ? 'pass' : 'warn',
    fsSupported ? '' : 'Not supported on this browser. The game still works, just without hiding browser chrome.');

  setRow('motion', 'checking', '');

  function checkReady() {
    const ready = state.https && state.sensors && state.motion;
    startBtn.classList.toggle('hidden', !ready);
    grantBtn.classList.toggle('hidden', ready);
  }
  checkReady();

  grantBtn.addEventListener('click', async () => {
    setRow('motion', 'checking', '');
    fixPanel.classList.add('hidden');

    const granted = await requestMotionPermission();
    if (!granted) {
      state.motion = false;
      setRow('motion', 'fail', 'Permission denied or unavailable.');
      fixPanel.classList.remove('hidden');
      checkReady();
      return;
    }

    const gotData = await waitForLiveOrientationData(LIVE_DATA_TIMEOUT_MS);
    state.motion = gotData;
    if (gotData) {
      setRow('motion', 'pass', '');
      fixPanel.classList.add('hidden');
    } else {
      setRow('motion', 'fail', 'Permission granted but no sensor data arrived — likely blocked at the OS level.');
      fixPanel.classList.remove('hidden');
    }
    checkReady();
  });

  startBtn.addEventListener('click', async () => {
    let fsError = null;
    try {
      await attemptFullscreen();
    } catch (err) {
      fsError = err;
    }

    startBtn.disabled = true;
    startBtn.textContent = 'LOADING...';
    loadErrorPanel.classList.add('hidden');

    try {
      const mod = await import('./main.js');
      overlay.style.display = 'none';
      rotateWarning.classList.add('armed');
      mod.startApp();
      if (fsError) {
        console.warn('Fullscreen request failed:', fsError.message || fsError);
      }
    } catch (err) {
      startBtn.disabled = false;
      startBtn.textContent = 'START';
      loadErrorPanel.classList.remove('hidden');
      loadErrorPanel.textContent = 'Game engine failed to load: ' + (err && err.message ? err.message : String(err)) +
        ' — usually a blocked or slow CDN fetch. Check your connection and try again.';
    }
  });
}

run();
