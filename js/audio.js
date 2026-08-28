// Procedural + streamed audio, ported from the CSS3D version.
// Panners now take real (x, y, z) world meters instead of faked 2D game-px coords.

export const AudioController = {
  ctx: null,
  masterGain: null,
  musicGain: null,
  bgMusicElement: null,
  bgMusicNode: null,
  playlist: [
    './assets/audio/looping-a-disc.mp3',
    './assets/audio/tornado-cones.mp3'
  ],
  currentSongIndex: 0,
  isInit: false,
  sfxMuted: false,
  musicMuted: false,

  init() {
    if (this.isInit) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.2;
    this.musicGain.connect(this.ctx.destination);

    this.isInit = true;
    this.startMusic();
  },

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
    if (this.bgMusicElement) this.bgMusicElement.pause();
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if (this.bgMusicElement && !this.musicMuted) {
      this.bgMusicElement.play().catch(() => {});
    }
  },

  setSong(index) {
    if (!this.isInit) return;
    this.currentSongIndex = index % this.playlist.length;
    if (this.bgMusicElement) {
      const wasPlaying = (this.ctx.state === 'running' && !this.musicMuted && !this.bgMusicElement.paused);
      this.bgMusicElement.pause();
      this.bgMusicElement.src = this.playlist[this.currentSongIndex];
      if (wasPlaying) this.bgMusicElement.play().catch(() => {});
    }
  },

  startMusic() {
    if (this.bgMusicElement) {
      if (this.ctx.state === 'running' && !this.musicMuted) {
        this.bgMusicElement.play().catch(() => {});
      }
      return;
    }
    this.bgMusicElement = new Audio(this.playlist[this.currentSongIndex]);
    this.bgMusicElement.loop = true;
    this.bgMusicElement.volume = 1.0;
    try {
      this.bgMusicNode = this.ctx.createMediaElementSource(this.bgMusicElement);
      this.bgMusicNode.connect(this.musicGain);
    } catch (e) {
      console.warn('Could not connect audio to WebAudio context:', e);
    }
    if (!this.musicMuted) this.bgMusicElement.play().catch(() => {});
  },

  toggleSfx() {
    this.sfxMuted = !this.sfxMuted;
    if (this.masterGain) this.masterGain.gain.value = this.sfxMuted ? 0 : 0.5;
    return this.sfxMuted;
  },

  toggleMusic() {
    this.musicMuted = !this.musicMuted;
    if (this.musicGain) this.musicGain.gain.value = this.musicMuted ? 0 : 0.2;
    return this.musicMuted;
  },

  // "Szouip" flip sound
  playFlip() {
    if (!this.isInit) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.connect(filter); filter.connect(gain); gain.connect(this.masterGain);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.1);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.exponentialRampToValueAtTime(3000, t + 0.1);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.5, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    osc.start(t); osc.stop(t + 0.3);
  },

  // "Twomp" launch sound
  playLaunch() {
    if (!this.isInit) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.masterGain);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    osc.start(t); osc.stop(t + 0.3);
  },

  createDiscLoop() {
    if (!this.isInit) return null;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createPanner();
    osc.connect(gain); gain.connect(panner); panner.connect(this.masterGain);
    osc.type = 'sine';
    osc.frequency.value = 800;
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'exponential';
    panner.refDistance = 1;
    panner.maxDistance = 10;
    panner.rolloffFactor = 1;
    osc.start(t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.5);
    return { osc, gain, panner };
  },

  createTornadoLoop() {
    if (!this.isInit) return null;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createPanner();
    osc.connect(gain); gain.connect(panner); panner.connect(this.masterGain);
    osc.type = 'triangle';
    osc.frequency.value = 50;
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.refDistance = 1;
    panner.maxDistance = 8;
    panner.rolloffFactor = 1.5;
    osc.start(t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.4, t + 1.0);
    return { osc, gain, panner };
  },

  // pos: THREE.Vector3 in world meters
  updatePanner(panner, pos) {
    if (!panner) return;
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
  },

  updateListener(camera, tmpVec3) {
    if (!this.ctx || !this.ctx.listener) return;
    const l = this.ctx.listener;
    const p = camera.position;
    const fwd = tmpVec3;
    camera.getWorldDirection(fwd);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }
};
