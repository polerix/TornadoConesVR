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

// "Be still to select" — a bottom fill bar showing dwell progress toward
// activation. This is the primary discoverability mechanism: the player
// learns the interaction by watching it fill as they hold their gaze.
function drawDwellBar(ctx, canvas, progress, color) {
  if (progress <= 0) return;
  const barH = Math.max(10, canvas.height * 0.07);
  const margin = canvas.width * 0.04;
  const barW = canvas.width - margin * 2;
  const y = canvas.height - barH - margin * 0.6;
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(margin, y, barW, barH);
  ctx.fillStyle = color;
  ctx.fillRect(margin, y, barW * progress, barH);
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

    // --- Lobby buttons (world-fixed, near the title) ---
    this.playPanel = makeCanvasPanel(600, 200);
    const playGeo = new THREE.PlaneGeometry(0.55, 0.18);
    this.playButton = new THREE.Mesh(playGeo, this.playPanel.material);
    this.playButton.position.set(0, 1.35, GRID_CENTER_Z - 0.35);
    this.group.add(this.playButton);

    this.scoresBtnPanel = makeCanvasPanel(500, 180);
    const scoresBtnGeo = new THREE.PlaneGeometry(0.42, 0.15);
    this.scoresButton = new THREE.Mesh(scoresBtnGeo, this.scoresBtnPanel.material);
    this.scoresButton.position.set(-0.32, 1.12, GRID_CENTER_Z - 0.35);
    this.group.add(this.scoresButton);

    this.soundBtnPanel = makeCanvasPanel(500, 180);
    const soundBtnGeo = new THREE.PlaneGeometry(0.42, 0.15);
    this.soundButton = new THREE.Mesh(soundBtnGeo, this.soundBtnPanel.material);
    this.soundButton.position.set(0.32, 1.12, GRID_CENTER_Z - 0.35);
    this.group.add(this.soundButton);

    this.scoresPanelTex = makeCanvasPanel(700, 560);
    const scoresPanelGeo = new THREE.PlaneGeometry(0.75, 0.6);
    this.scoresPanel = new THREE.Mesh(scoresPanelGeo, this.scoresPanelTex.material);
    this.scoresPanel.position.set(0, 1.6, GRID_CENTER_Z - 0.42);
    this.scoresPanel.visible = false;
    this.group.add(this.scoresPanel);

    this.drawPlayButton(false);
    this.drawScoresButton(false);
    this.drawSoundButton(true, false);

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
    ctx.font = 'bold 40px sans-serif';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText('HOLD YOUR GAZE STEADY TO SELECT', canvas.width / 2, 360);
    texture.needsUpdate = true;
  }

  drawPlayButton(highlighted, progress = 0) {
    const { ctx, canvas, texture } = this.playPanel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = highlighted ? 'rgba(0,255,100,0.25)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = highlighted ? '#00ff66' : '#00aa44';
    ctx.lineWidth = highlighted ? 14 : 8;
    ctx.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
    ctx.textAlign = 'center';
    ctx.fillStyle = highlighted ? '#ffffff' : '#00ff88';
    ctx.shadowColor = '#00ff66';
    ctx.shadowBlur = highlighted ? 30 : 12;
    ctx.font = 'bold 110px sans-serif';
    ctx.fillText('PLAY', canvas.width / 2, canvas.height / 2 + (progress > 0 ? 20 : 38));
    drawDwellBar(ctx, canvas, progress, '#00ff66');
    texture.needsUpdate = true;
  }

  drawScoresButton(highlighted, progress = 0) {
    const { ctx, canvas, texture } = this.scoresBtnPanel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = highlighted ? 'rgba(0,170,255,0.25)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = highlighted ? '#00aaff' : '#0077aa';
    ctx.lineWidth = highlighted ? 12 : 7;
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = highlighted ? '#ffffff' : '#00aaff';
    ctx.shadowColor = '#00aaff';
    ctx.shadowBlur = highlighted ? 24 : 10;
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText('HIGH SCORES', canvas.width / 2, canvas.height / 2 + (progress > 0 ? 4 : 20));
    drawDwellBar(ctx, canvas, progress, '#00aaff');
    texture.needsUpdate = true;
  }

  drawSoundButton(soundOn, highlighted, progress = 0) {
    const { ctx, canvas, texture } = this.soundBtnPanel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = highlighted ? 'rgba(255,170,0,0.25)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = highlighted ? '#ffaa00' : '#aa7700';
    ctx.lineWidth = highlighted ? 12 : 7;
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = highlighted ? '#ffffff' : '#ffaa00';
    ctx.shadowColor = '#ffaa00';
    ctx.shadowBlur = highlighted ? 24 : 10;
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText('SOUND: ' + (soundOn ? 'ON' : 'OFF'), canvas.width / 2, canvas.height / 2 + (progress > 0 ? 4 : 20));
    drawDwellBar(ctx, canvas, progress, '#ffaa00');
    texture.needsUpdate = true;
  }

  drawScoresPanel(list) {
    const { ctx, canvas, texture } = this.scoresPanelTex;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10,5,20,0.94)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#00aaff';
    ctx.shadowColor = '#00aaff';
    ctx.shadowBlur = 16;
    ctx.font = 'bold 54px sans-serif';
    ctx.fillText('TOP SCORES', canvas.width / 2, 80);
    ctx.shadowBlur = 0;

    if (!list || list.length === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '40px sans-serif';
      ctx.fillText('No runs yet', canvas.width / 2, 200);
    } else {
      list.forEach((s, i) => {
        ctx.fillStyle = i === 0 ? '#ffd700' : '#ffffff';
        ctx.font = 'bold 48px sans-serif';
        ctx.fillText((i + 1) + '.  ' + s, canvas.width / 2, 170 + i * 70);
      });
    }

    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('look at HIGH SCORES again to close', canvas.width / 2, canvas.height - 30);
    texture.needsUpdate = true;
  }

  toggleScoresPanel(list) {
    this.scoresPanel.visible = !this.scoresPanel.visible;
    if (this.scoresPanel.visible) this.drawScoresPanel(list);
    return this.scoresPanel.visible;
  }

  getLobbyButtons() {
    return [
      { name: 'PLAY', mesh: this.playButton },
      { name: 'SCORES', mesh: this.scoresButton },
      { name: 'SOUND', mesh: this.soundButton }
    ];
  }

  pulseLobbyButtons(gazedName) {
    this.getLobbyButtons().forEach(b => {
      const target = (b.name === gazedName) ? 1.12 : 1.0;
      const s = b.mesh.scale.x + (target - b.mesh.scale.x) * 0.2;
      b.mesh.scale.setScalar(s);
    });
  }

  setTitleVisible(visible) {
    this.titleMesh.visible = visible;
  }

  setLobbyVisible(visible) {
    this.playButton.visible = visible;
    this.scoresButton.visible = visible;
    this.soundButton.visible = visible;
    if (!visible) this.scoresPanel.visible = false;
  }

  setHudVisible(visible) {
    this.statusMesh.visible = visible;
    this.hiScoreMesh.visible = visible;
  }
}
