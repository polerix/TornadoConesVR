import { DiscTornado, GreenBall, OrangeCube } from './entities.js';

export class LevelManager {
  constructor(scene, audio, clock, hud, world) {
    this.scene = scene;
    this.audio = audio;
    this.clock = clock;
    this.hud = hud;
    this.world = world; // { tornadoes, balls, cubes, entities }
    this.level = 1;
    this.flipsInLevel = 0;
    this.goal = 5;
  }

  init() {
    this.level = 1;
    this.flipsInLevel = 0;
    this.startLevel(1);
  }

  startLevel(n) {
    this.level = n;
    this.flipsInLevel = 0;
    this.goal = 5;

    if (this.audio.isInit) this.audio.setSong(n - 1);

    this.clearEntities();

    this.hud.announce('LEVEL UP!', '#00ffff');
    this.clock.after(2000, () => this.hud.announce('HURRY UP!', '#ffffff'));

    this.spawnTornado(1.0);
    if (n >= 2) this.spawnTornado(0.5);
    if (n >= 3) this.spawnBall('player');
    if (n >= 4) this.spawnBall('tornado');
    if (n >= 5) this.spawnTornado(1.0);
  }

  clearEntities() {
    this.world.entities.forEach(e => e.destroy());
    this.world.entities.length = 0;
    this.world.tornadoes.length = 0;
    this.world.balls.length = 0;
    this.world.cubes.length = 0;
  }

  spawnTornado(scale) {
    const t = new DiscTornado(scale, this.scene, this.audio);
    this.world.entities.push(t);
    this.world.tornadoes.push(t);
  }

  spawnBall(targetType) {
    const b = new GreenBall(targetType, this.scene);
    b.onRingCleared = () => this.onBallRingCleared && this.onBallRingCleared();
    this.world.entities.push(b);
    this.world.balls.push(b);
  }

  spawnCube() {
    if (this.world.cubes.length > 0) return;
    const c = new OrangeCube(this.scene);
    this.world.entities.push(c);
    this.world.cubes.push(c);
    this.hud.announce('RENEWED!', '#ffaa00');
  }

  onFlip() {
    this.flipsInLevel++;
    if (this.level >= 5 && this.flipsInLevel === 3) this.spawnCube();
    if (this.flipsInLevel >= this.goal) this.nextLevel();
  }

  nextLevel() {
    this.onLevelComplete && this.onLevelComplete();
    this.clock.after(1000, () => this.startLevel(this.level + 1));
  }
}
