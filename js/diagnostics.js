// Startup diagnostics: verifies HTTPS, motion sensor availability, and
// actual live orientation data (not just permission-granted, since the
// iOS-level Settings > Safari > Motion & Orientation Access toggle can
// block events even after requestPermission() resolves 'granted').

import { requestMotionPermission } from './input.js';

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

export function initDiagnostics(onStart) {
  const grantBtn = document.getElementById('grant-motion-btn');
  const startBtn = document.getElementById('start-game-btn');
  const fixPanel = document.getElementById('motion-fix-panel');
  const overlay = document.getElementById('vr-enter-overlay');
  const rotateWarning = document.getElementById('rotate-warning');

  const state = { https: false, sensors: false, motion: false, fullscreen: false };

  // --- Immediate, non-interactive checks ---
  state.https = !!window.isSecureContext;
  setRow('https', state.https ? 'pass' : 'fail',
    state.https ? '' : 'Serve this page over HTTPS (or via localhost).');

  state.sensors = typeof DeviceOrientationEvent !== 'undefined';
  setRow('sensors', state.sensors ? 'pass' : 'fail',
    state.sensors ? '' : "This browser doesn't expose device orientation. Use Safari on iPhone.");

  const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  state.fullscreen = fsSupported; // optional — never blocks START
  setRow('fullscreen', fsSupported ? 'pass' : 'warn',
    fsSupported ? '' : 'Not supported on this browser. The game still works, just without hiding browser chrome.');

  setRow('motion', 'checking', '');

  function checkReady() {
    const ready = state.https && state.sensors && state.motion;
    startBtn.classList.toggle('hidden', !ready);
    grantBtn.classList.toggle('hidden', ready);
  }
  checkReady();

  // --- Motion permission + live-data verification (requires a tap) ---
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

  startBtn.addEventListener('click', () => {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    }
    overlay.style.display = 'none';
    rotateWarning.classList.add('armed');
    onStart();
  });
}
