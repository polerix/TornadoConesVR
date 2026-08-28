import * as THREE from 'three';
import { GRID_CENTER_Z } from './constants.js';

// World-locked HUD panels rendered as canvas textures on planes.
// DOM overlays don't reliably work in Quest Browser immersive sessions,
// so score/status/announcer text all live in-scene instead.

function makeCanvasPanel(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  return { canvas, ctx, texture, material };
}

export class Hud {
  constructor(scene, rig) {
    this.scene = scene;
    this.rig = rig;
    this.group = new THREE.Group();
    scene.add(this.group);

    // --- Score / status panel (upper edge of the table, always facing player start) ---
    this.statusPanel = makeCanvasPanel(1024, 256);
    const statusGeo = new THREE.PlaneGeometry(1.1, 0.28);
    this.statusMesh = new THREE.Mesh(statusGeo, this.statusPanel.material);
    this.statusMesh.position.set(0, 1.62, GRID_CENTER_Z - 0.55);
    this.group.add(this.statusMesh);

    // --- High score panel (top right) ---
    this.hiScorePanel = makeCanvasPanel(512, 160);
    const hiGeo = new THREE.PlaneGeometry(0.55, 0.17);
    this.hiScoreMesh = new THREE.Mesh(hiGeo, this.hiScorePanel.material);
    this.hiScoreMesh.position.set(0.75, 1.78, GRID_CENTER_Z - 0.55);
    this.group.add(this.hiScoreMesh);

    // --- Announcer banner (floats above table center) ---
    this.announcePanel = makeCanvasPanel(1024, 256);
    const annGeo = new THREE.PlaneGeometry(1.4, 0.35);
    this.announceMesh = new THREE.Mesh(annGeo, this.announcePanel.material);
    this.announceMesh.position.set(0, 1.4, GRID_CENTER_Z);
    this.announceMesh.visible = false;
    this.group.add(this.announceMesh);

    // --- Title screen panel ---
    this.titlePanel = makeCanvasPanel(1200, 700);
    const titleGeo = new THREE.PlaneGeometry(1.6, 0.93);
    this.titleMesh = new THREE.Mesh(titleGeo, this.titlePanel.material);
    this.titleMesh.position.set(0, 1.75, GRID_CENTER_Z - 0.5);
    this.group.add(this.titleMesh);

    this._announceTimer = null;

    // --- Head-locked reticle (gaze center marker) ---
    const reticleGeo = new THREE.RingGeometry(0.006, 0.01, 20);
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false });
    this.reticle = new THREE.Mesh(reticleGeo, reticleMat);
    this.reticle.position.set(0, 0, -1.2);
    this.reticle.renderOrder = 999;
    this.rig.add(this.reticle);

    // --- Head-locked pause icon (gaze-dwell target) ---
    this.pauseIconPanel = makeCanvasPanel(256, 256);
    const pauseGeo = new THREE.CircleGeometry(0.045, 24);
    this.pauseIcon = new THREE.Mesh(pauseGeo, this.pauseIconPanel.material);
    this.pauseIcon.position.set(0.32, 0.16, -1.0);
    this.pauseIcon.renderOrder = 998;
    this.rig.add(this.pauseIcon);
    this.drawPauseIcon(0);

    this.drawStatus('STANDBY', '#aaaaaa');
    this.drawHighScore(0);
    this.drawTitle();
  }

  drawPauseIcon(progress) {
    const { ctx, canvas, texture } = this.pauseIconPanel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2, cy = canvas.height / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 110, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,10,30,0.75)';
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#00aaff';
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 40, cy - 45, 24, 90);
    ctx.fillRect(cx + 16, cy - 45, 24, 90);

    if (progress > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, 100, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#00ff88';
      ctx.stroke();
    }
    texture.needsUpdate = true;
  }

  getPauseIconWorldPosition(target) {
    return this.pauseIcon.getWorldPosition(target);
  }

  drawStatus(text, color = '#ffffff', score = 0) {
    const { ctx, canvas, texture } = this.statusPanel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.fillStyle = color;
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('STATUS: ' + text, canvas.width / 2, 100);
    ctx.shadowColor = '#00ff00';
    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 80px sans-serif';
    ctx.fillText('SCORE: ' + score, canvas.width / 2, 210);
    texture.needsUpdate = true;
  }

  drawHighScore(hi) {
    const { ctx, canvas, texture } = this.hiScorePanel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff4400';
    ctx.shadowBlur = 15;
    ctx.fillStyle = '#ffaa00';
    ctx.font = 'bold 72px sans-serif';
    ctx.fillText('PEL: ' + hi, canvas.width / 2, canvas.height / 2 + 24);
    texture.needsUpdate = true;
  }

  announce(text, color = '#ffffff') {
    const { ctx, canvas, texture } = this.announcePanel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.shadowColor = color;
    ctx.shadowBlur = 25;
    ctx.fillStyle = color;
    ctx.font = 'bold 96px sans-serif';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 32);
    texture.needsUpdate = true;
    this.announceMesh.visible = true;

    clearTimeout(this._announceTimer);
    this._announceTimer = setTimeout(() => { this.announceMesh.visible = false; }, 2200);
  }

  drawTitle() {
    const { ctx, canvas, texture } = this.titlePanel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff00ff';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 110px sans-serif';
    ctx.fillText('TORNADO CONES', canvas.width / 2, 260);
    ctx.font = 'bold 44px sans-serif';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText('PULL TRIGGER ON THE DISC TO START', canvas.width / 2, 360);
    texture.needsUpdate = true;
  }

  setTitleVisible(visible) {
    this.titleMesh.visible = visible;
  }

  setHudVisible(visible) {
    this.statusMesh.visible = visible;
    this.hiScoreMesh.visible = visible;
  }
}
