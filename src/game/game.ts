import Matter from 'matter-js';
import { JiroAsset, loadJiroAssets } from './assets';

const { Engine, Composite, Bodies, Body, Events } = Matter;

// ---- ゲーム世界の定数（カメラや画面サイズに依存しない） ----
export const PX_PER_M = 60; // 60px = 1m として高度を表示
const WORLD_W = 672; // 台地（地面）の幅
const VIEW_W = 780; // 画面横いっぱいに見える世界の幅（台地より広い＝引きの画角）
const VIEW_H = 1280; // 縦の基準画角
const GROUND_Y = 560; // 地面の上面（世界座標）
const GROUND_H = 220;
const VOID_Y = GROUND_Y + 400; // ここまで落ちたら画面外＝消失
const ROT_STEP = Math.PI / 12; // 15度
const MOVE_SPEED = 340; // 左右移動速度（世界px/秒）
const MIN_FALL_MS = 450; // 落下後、安定判定を始めるまでの最低待機
const STABLE_MS = 350; // 全体が低速になり続ける時間
const FALL_TIMEOUT_MS = 3500; // 安定判定の待機上限
const SCORE_COMMIT_MS = 600; // 高度記録の確定に必要な維持時間
const MAX_LIVES = 3;
const BEST_KEY = 'jiro-tower-best-v1';

export type Phase = 'loading' | 'aiming' | 'falling' | 'gameover';

export interface HudState {
  phase: Phase;
  lives: number;
  height: number; // 最高到達高度（m）
  best: number;
  isNewRecord: boolean;
  nextPreviewUrl: string | null;
  stackCount: number;
}

interface JiroMeta {
  inTower: boolean; // 次のジローが生成済み＝積み上げ済み扱い
  touchedAny: boolean;
  fallen: boolean; // 落下済み（ライフ消費済み）
}

interface Cloud {
  x: number;
  y: number;
  s: number;
}

export class Game {
  phase: Phase = 'loading';

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pushHud: (s: HudState) => void;

  private engine: Matter.Engine | null = null;
  private ground: Matter.Body | null = null;
  private pieces: Matter.Body[] = [];
  private metas = new WeakMap<Matter.Body, JiroMeta>();
  private current: Matter.Body | null = null;
  private currentAsset: JiroAsset | null = null;

  private assets: JiroAsset[] = [];
  private aimIndex = 0;
  private nextIndex = 0;
  private aimX = WORLD_W / 2;
  private aimAngle = 0;
  private moveInput = 0;

  // カメラ（描画専用。物理座標は変更しない）
  private vw = 0;
  private vh = 0;
  private dpr = 1;
  private scale = 1;
  private offX = 0;
  private visibleH = VIEW_H;
  private camTop = 0;
  private startedCamTop = 0;
  private goStage = 0; // ゲームオーバー演出: 0=地面まで降下, 1=タワー全体をゆっくり表示
  private clouds: Cloud[] = [];

  private lives = MAX_LIVES;
  private maxHeight = 0;
  private best = 0;
  private candidateH = 0;
  private isNewRecord = false;

  private physicsMs = 0; // 物理演算の積算時間（バックグラウンド時は実時間から遅れる）
  private fallStartPhys = 0;
  private candidateSincePhys = 0;
  private stableTimer = 0;
  private acc = 0;
  private lastT = 0;
  private raf = 0;
  private fallbackTimer = 0;
  private lastFrameTs = 0;
  private lastHudJson = '';
  private resizeObserver: ResizeObserver | null = null;
  private destroyFlag = false;

  constructor(canvas: HTMLCanvasElement, pushHud: (s: HudState) => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas を初期化できませんでした');
    this.ctx = ctx;
    this.pushHud = pushHud;
    this.best = Number(localStorage.getItem(BEST_KEY) ?? '0') || 0;
    for (let i = 0; i < 16; i++) {
      this.clouds.push({
        x: Math.random() * VIEW_W,
        y: Math.random() * 2600,
        s: 0.6 + Math.random() * 0.9,
      });
    }
  }

  async init(): Promise<void> {
    this.assets = await loadJiroAssets();
    this.buildEngine();
    this.attachPointer();
    this.observeResize();
    this.reset();
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    // 組み込みプレビュー等で rAF が停止しても動き続けるフォールバック
    this.fallbackTimer = window.setInterval(() => {
      if (performance.now() - this.lastFrameTs > 250) {
        this.tick(performance.now());
      }
    }, 100);
  }

  destroy(): void {
    this.destroyFlag = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.fallbackTimer);
    this.resizeObserver?.disconnect();
  }

  // ---- 公開操作 API ----

  setMoveInput(dir: number): void {
    this.moveInput = dir;
  }

  rotate(dir: number): void {
    if (this.phase !== 'aiming') return;
    this.aimAngle += dir * ROT_STEP;
  }

  drop(): void {
    if (this.phase !== 'aiming' || !this.engine) return;
    const asset = this.assets[this.aimIndex];
    const w = asset.width;
    const h = asset.colliderH; // 当たり判定はフェード延長を含まない
    const body = Bodies.rectangle(this.aimX, this.aimY(), w, h, {
      angle: this.aimAngle,
      chamfer: { radius: Math.min(w, h) * 0.07 },
      friction: 0.7,
      frictionStatic: 1,
      restitution: 0.02,
      density: 0.0015,
    });
    body.__jiro = { asset, drawW: w, drawH: asset.height };
    this.metas.set(body, {
      inTower: false,
      touchedAny: false,
      fallen: false,
    });
    Composite.add(this.engine.world, body);
    this.pieces.push(body);
    this.current = body;
    this.currentAsset = asset;
    this.fallStartPhys = this.physicsMs;
    this.stableTimer = 0;
    this.phase = 'falling';
    this.pushHudState();
  }

  reset(): void {
    if (!this.engine) return;
    for (const p of this.pieces) Composite.remove(this.engine.world, p);
    this.pieces = [];
    this.current = null;
    this.currentAsset = null;
    this.aimX = WORLD_W / 2;
    this.aimAngle = 0;
    this.moveInput = 0;
    this.lives = MAX_LIVES;
    this.maxHeight = 0;
    this.candidateH = 0;
    this.isNewRecord = false;
    this.camTop = this.startedCamTop;
    this.goStage = 0;
    this.aimIndex = this.pickRandom(-1);
    this.nextIndex = this.pickRandom(this.aimIndex);
    this.phase = 'aiming';
    this.pushHudState();
  }

  // ---- 内部処理 ----

  private buildEngine(): void {
    const engine = Engine.create({
      enableSleeping: true,
      positionIterations: 8,
      velocityIterations: 6,
    });
    engine.gravity.y = 1.5;
    // 地面は台地の幅ちょうど。端から外れると奈落に落ちる
    this.ground = Bodies.rectangle(WORLD_W / 2, GROUND_Y + GROUND_H / 2, WORLD_W, GROUND_H, {
      isStatic: true,
      friction: 0.9,
    });
    Composite.add(engine.world, this.ground);

    Events.on(engine, 'collisionStart', (e) => {
      for (const pair of e.pairs) {
        this.noteTouch(pair.bodyA);
        this.noteTouch(pair.bodyB);
      }
    });

    this.engine = engine;
  }

  private noteTouch(b: Matter.Body): void {
    const meta = this.metas.get(b);
    if (meta) meta.touchedAny = true;
  }

  private loseLife(): void {
    if (this.phase !== 'aiming' && this.phase !== 'falling') return;
    if (this.lives <= 0) return;
    this.lives--;
    this.pushHudState();
    if (this.lives <= 0) this.gameOver();
  }

  private pickRandom(not: number): number {
    if (this.assets.length === 1) return 0;
    let i = Math.floor(Math.random() * this.assets.length);
    while (i === not) i = Math.floor(Math.random() * this.assets.length);
    return i;
  }

  private aimY(): number {
    return this.camTop + this.visibleH * 0.14;
  }

  private aimHalfW(): number {
    return this.assets[this.aimIndex].width / 2;
  }

  private observeResize(): void {
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.canvas);
    this.resizeObserver = ro;
    this.resize();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    this.vw = rect.width;
    this.vh = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    // 台地は画面の半分程度に見え、ピースが大きく見える画角
    this.scale = Math.min(this.vw / VIEW_W, this.vh / VIEW_H);
    this.offX = (this.vw - WORLD_W * this.scale) / 2;
    const newVisibleH = this.vh / this.scale;
    const newTop0 = GROUND_Y + 140 - newVisibleH;
    if (this.camTop <= this.startedCamTop + 1 || this.startedCamTop === 0) {
      this.camTop = newTop0;
    }
    this.startedCamTop = newTop0;
    this.visibleH = newVisibleH;
  }

  private attachPointer(): void {
    const canvas = this.canvas;
    let pid: number | null = null;
    let startX = 0;
    let dragged = false;

    const toWorldX = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      return (clientX - rect.left - this.offX) / this.scale;
    };

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      pid = e.pointerId;
      startX = e.clientX;
      dragged = false;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.phase !== 'aiming') return;
      if (pid === e.pointerId || e.pointerType === 'mouse') {
        if (pid === e.pointerId && Math.abs(e.clientX - startX) > 6) dragged = true;
        this.setAimX(toWorldX(e.clientX));
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (pid !== e.pointerId) return;
      pid = null;
      if (!dragged) this.drop();
    });
    canvas.addEventListener('pointercancel', () => {
      pid = null;
    });
  }

  private setAimX(x: number): void {
    const half = this.aimHalfW() + 4;
    this.aimX = Math.min(WORLD_W - half, Math.max(half, x));
  }

  private tick = (t: number): void => {
    if (this.destroyFlag) return;
    this.lastFrameTs = t;
    // バックグラウンドで rAF が止まっている間は、再開時に一気に物理を追いつかせる
    const dtMs = Math.min(1000, t - this.lastT);
    this.lastT = t;

    if (this.phase === 'aiming' || this.phase === 'falling') {
      this.acc += dtMs;
      let steps = 0;
      while (this.acc >= 1000 / 60 && steps < 60) {
        if (this.engine) Engine.update(this.engine, 1000 / 60);
        this.physicsMs += 1000 / 60;
        this.acc -= 1000 / 60;
        steps++;
      }
      this.checkFallenPieces();
      this.updateScore();
    }
    if (this.phase === 'falling') this.updateFallState();
    if (this.phase === 'aiming') this.updateAim(dtMs);
    this.updateCamera(dtMs);
    this.render();
    this.raf = requestAnimationFrame(this.tick);
  };

  private updateAim(dtMs: number): void {
    if (this.moveInput !== 0) {
      this.setAimX(this.aimX + this.moveInput * MOVE_SPEED * (dtMs / 1000));
    }
  }

  private updateFallState(): void {
    if (!this.current || !this.engine) return;
    const elapsed = this.physicsMs - this.fallStartPhys;
    if (elapsed < MIN_FALL_MS) return;
    if (this.current.isSleeping) {
      this.settle();
      return;
    }
    let allSlow = true;
    for (const b of this.pieces) {
      if (b.speed > 0.4 || Math.abs(b.angularSpeed) > 0.06) {
        allSlow = false;
        break;
      }
    }
    if (allSlow) this.stableTimer += 1000 / 60;
    else this.stableTimer = 0;
    if (this.stableTimer > STABLE_MS || elapsed > FALL_TIMEOUT_MS) this.settle();
  }

  private settle(): void {
    const meta = this.current ? this.metas.get(this.current) : null;
    if (meta) meta.inTower = true;
    this.current = null;
    this.currentAsset = null;
    this.aimIndex = this.nextIndex;
    this.nextIndex = this.pickRandom(this.aimIndex);
    this.aimAngle = 0;
    this.phase = 'aiming';
    this.pushHudState();
  }

  private checkFallenPieces(): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const b = this.pieces[i];
      const meta = this.metas.get(b);
      if (!meta || meta.fallen) continue;
      // ピースが地面の高さより下に落下した時だけライフを消費する。
      // 台地の上に載っている間（中心が GROUND_Y より上）は減らさない
      if (b.position.y <= GROUND_Y + 20) continue;
      meta.fallen = true;
      const isCurrent = b === this.current;
      if (b.position.y > VOID_Y) {
        Composite.remove(this.engine!.world, b);
        this.pieces.splice(i, 1);
      }
      this.loseLife();
      if (isCurrent && this.phase === 'falling') {
        // 落下中のピースが落ちたので、次のジローへ即座に進む
        this.current = null;
        this.currentAsset = null;
        this.aimIndex = this.nextIndex;
        this.nextIndex = this.pickRandom(this.aimIndex);
        this.aimAngle = 0;
        this.phase = 'aiming';
        this.pushHudState();
      }
    }
  }

  private towerTopY(): number {
    let top = GROUND_Y;
    for (const b of this.pieces) {
      const meta = this.metas.get(b);
      if (meta?.inTower && !meta.fallen) top = Math.min(top, b.bounds.min.y);
    }
    return top;
  }

  private updateScore(): void {
    let top = Infinity;
    for (const b of this.pieces) {
      const meta = this.metas.get(b);
      const eligible =
        (meta?.inTower && !meta.fallen) ||
        (b === this.current && meta?.touchedAny && b.speed < 2.5 && Math.abs(b.angularSpeed) < 0.3);
      if (!eligible) continue;
      top = Math.min(top, b.bounds.min.y);
    }
    if (top === Infinity) return;
    const h = Math.max(0, (GROUND_Y - top) / PX_PER_M);
    if (h > this.maxHeight + 0.001) {
      if (h > this.candidateH) {
        this.candidateH = h;
        this.candidateSincePhys = this.physicsMs;
      }
      if (this.physicsMs - this.candidateSincePhys >= SCORE_COMMIT_MS) {
        this.maxHeight = h;
        this.pushHudState();
      }
    } else {
      this.candidateH = this.maxHeight;
    }
  }

  private updateCamera(dtMs: number): void {
    let target: number;
    let rate: number;
    if (this.phase === 'gameover') {
      // 1) 地面まで降下して塔の根元を見せ、2) 高い塔はゆっくり上へパンして全体を見せる
      const groundCam = GROUND_Y + 140 - this.visibleH;
      if (this.goStage === 0) {
        target = groundCam;
        rate = 3.2;
        if (this.camTop >= groundCam - 5) {
          this.camTop = groundCam;
          this.goStage = 1;
          return;
        }
      } else {
        target = Math.min(groundCam, this.towerTopY() - 80);
        rate = 0.9;
      }
    } else {
      // タワーが高くなるほどカメラが上へスライドする
      target = Math.min(this.startedCamTop, this.towerTopY() - this.visibleH * 0.45);
      rate = 2.5;
    }
    const k = 1 - Math.exp(-(dtMs / 1000) * rate);
    this.camTop += (target - this.camTop) * k;
  }

  private gameOver(): void {
    if (this.phase === 'gameover') return;
    this.phase = 'gameover';
    this.goStage = 0;
    if (this.maxHeight > this.best) {
      this.best = this.maxHeight;
      this.isNewRecord = true;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
    this.pushHudState();
  }

  private pushHudState(): void {
    const asset = this.assets[this.nextIndex];
    let stacks = 0;
    for (const b of this.pieces) {
      const meta = this.metas.get(b);
      if (meta?.inTower && !meta.fallen) stacks++;
    }
    const state: HudState = {
      phase: this.phase,
      lives: this.lives,
      height: Math.round(this.maxHeight * 10) / 10,
      best: Math.round(this.best * 10) / 10,
      isNewRecord: this.isNewRecord,
      nextPreviewUrl: asset ? asset.url : null,
      stackCount: stacks,
    };
    const json = JSON.stringify(state);
    if (json !== this.lastHudJson) {
      this.lastHudJson = json;
      this.pushHud(state);
    }
  }

  // ---- 描画 ----

  private render(): void {
    const ctx = this.ctx;
    const { vw, vh, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 空
    const sky = ctx.createLinearGradient(0, 0, 0, vh);
    sky.addColorStop(0, '#274672');
    sky.addColorStop(0.55, '#6f9ecf');
    sky.addColorStop(1, '#cfe3f2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, vw, vh);

    // 雲（視差付き・画面座標で描画）
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const span = 2600;
    for (const c of this.clouds) {
      let sy = (c.y - this.camTop * 0.4) % span;
      if (sy < 0) sy += span;
      const px = this.offX + c.x * this.scale;
      const py = sy * this.scale - span * 0.25;
      if (py < -80 || py > vh + 80) continue;
      this.drawCloud(px, py, c.s * this.scale);
    }

    // 世界座標系へ
    ctx.save();
    ctx.translate(this.offX, 0);
    ctx.scale(this.scale, this.scale);
    ctx.translate(0, -this.camTop);

    this.drawRuler(ctx);
    this.drawGuide(ctx);
    this.drawGround(ctx);
    this.drawPieces(ctx);
    if (this.phase === 'aiming') this.drawAimPiece(ctx);

    ctx.restore();
  }

  private drawCloud(x: number, y: number, s: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.ellipse(x, y, 42 * s, 16 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 30 * s, y - 10 * s, 26 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 32 * s, y - 6 * s, 22 * s, 11 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawRuler(ctx: CanvasRenderingContext2D): void {
    const step = 5 * PX_PER_M;
    const topY = this.camTop - 40;
    const bottomY = this.camTop + this.visibleH + 40;
    const gutter = Math.max(0, this.vw / this.scale - WORLD_W) / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (let y = Math.floor(GROUND_Y / step) * step; y > topY; y -= step) {
      if (y > bottomY) continue;
      if (y >= GROUND_Y) continue;
      ctx.beginPath();
      ctx.moveTo(-gutter, y);
      ctx.lineTo(WORLD_W + gutter, y);
      ctx.stroke();
      ctx.fillText(`${((GROUND_Y - y) / PX_PER_M).toFixed(0)}m`, -gutter + 6, y - 4);
    }
    ctx.restore();
  }

  private drawGuide(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'aiming') return;
    const y0 = this.aimY() + this.assets[this.aimIndex].colliderH / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.aimX, y0);
    ctx.lineTo(this.aimX, GROUND_Y);
    ctx.stroke();
    ctx.restore();
  }

  private drawGround(ctx: CanvasRenderingContext2D): void {
    // 浮遊台地（画面半分程度の幅）
    ctx.fillStyle = '#7a4d2b';
    ctx.fillRect(0, GROUND_Y, WORLD_W, GROUND_H);
    ctx.fillStyle = '#6b4224';
    ctx.fillRect(0, GROUND_Y + GROUND_H - 26, WORLD_W, 26);
    ctx.fillStyle = '#5da33f';
    ctx.fillRect(0, GROUND_Y, WORLD_W, 16);
    ctx.fillStyle = '#4c8a34';
    ctx.fillRect(0, GROUND_Y + 16, WORLD_W, 6);
    // 側面の薄影
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, GROUND_Y, 10, GROUND_H);
    ctx.fillRect(WORLD_W - 10, GROUND_Y, 10, GROUND_H);
  }

  private drawPieces(ctx: CanvasRenderingContext2D): void {
    for (const b of this.pieces) {
      const meta = this.metas.get(b);
      if (!meta) continue;
      const asset = this.assetOfBody(b);
      if (!asset) continue;
      const w = asset.drawW;
      const h = asset.drawH;
      const ch = asset.asset.colliderH;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      // 当たり判定の上端に画像の上端を合わせ、フェード延長部分は下へはみ出させる
      ctx.drawImage(asset.asset.img, -w / 2, -ch / 2, w, h);
      ctx.restore();
    }
  }

  private drawAimPiece(ctx: CanvasRenderingContext2D): void {
    const asset = this.assets[this.aimIndex];
    const w = asset.width;
    const h = asset.height;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.translate(this.aimX, this.aimY());
    ctx.rotate(this.aimAngle);
    ctx.drawImage(asset.img, -w / 2, -asset.colliderH / 2, w, h);
    ctx.restore();
  }

  // ボディごとの表示サイズをキャッシュするための簡易タグ
  private assetOfBody(b: Matter.Body): { asset: JiroAsset; drawW: number; drawH: number } | null {
    const tag = (b as unknown as { __jiro?: { asset: JiroAsset; drawW: number; drawH: number } }).__jiro;
    if (tag) return tag;
    return null;
  }
}

// Body 生成時に表示サイズを記録できるよう、drop() を拡張するヘルパー
declare module 'matter-js' {
  interface Body {
    __jiro?: { asset: JiroAsset; drawW: number; drawH: number };
  }
}
