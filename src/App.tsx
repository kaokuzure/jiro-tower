import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Game, HudState } from './game/game';

const INITIAL_HUD: HudState = {
  phase: 'loading',
  lives: 3,
  height: 0,
  best: 0,
  isNewRecord: false,
  nextPreviewUrl: null,
  stackCount: 0,
};

function useHoldRepeat() {
  const timers = useRef<{ t: number; i: number } | null>(null);
  const stop = () => {
    if (timers.current) {
      clearTimeout(timers.current.t);
      clearInterval(timers.current.i);
      timers.current = null;
    }
  };
  const start = (fn: () => void) => {
    stop();
    fn();
    const t = window.setTimeout(() => {
      if (timers.current) timers.current.i = window.setInterval(fn, 120);
    }, 350);
    timers.current = { t, i: 0 };
  };
  useEffect(() => stop, []);
  return { start, stop };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [error, setError] = useState<string | null>(null);
  const rotate = useHoldRepeat();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new Game(canvas, setHud);
    gameRef.current = game;
    (window as unknown as { __jiroGame?: Game }).__jiroGame = game;
    game.init().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      game.destroy();
      delete (window as unknown as { __jiroGame?: Game }).__jiroGame;
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g) return;
      switch (e.key) {
        case 'ArrowLeft':
          g.setMoveInput(-1);
          e.preventDefault();
          break;
        case 'ArrowRight':
          g.setMoveInput(1);
          e.preventDefault();
          break;
        case 'q':
        case 'Q':
        case 'z':
        case 'Z':
          g.rotate(-1);
          e.preventDefault();
          break;
        case 'e':
        case 'E':
        case 'x':
        case 'X':
          g.rotate(1);
          e.preventDefault();
          break;
        case ' ':
        case 'Enter':
        case 'ArrowDown':
          g.drop();
          e.preventDefault();
          break;
        case 'r':
        case 'R':
          if (g.phase === 'gameover') g.reset();
          break;
      }
    };
    const up = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') g.setMoveInput(0);
    };
    const blur = () => gameRef.current?.setMoveInput(0);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const move = (dir: number) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      gameRef.current?.setMoveInput(dir);
    },
    onPointerUp: () => gameRef.current?.setMoveInput(0),
    onPointerLeave: () => gameRef.current?.setMoveInput(0),
    onPointerCancel: () => gameRef.current?.setMoveInput(0),
  });

  const spin = (dir: number) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      rotate.start(() => gameRef.current?.rotate(dir));
    },
    onPointerUp: rotate.stop,
    onPointerLeave: rotate.stop,
    onPointerCancel: rotate.stop,
  });

  return (
    <main className='app'>
      <header className='hud'>
        <div className='hud-title'>
          <h1>ジロータワー</h1>
          <p className='hud-sub'>{hud.stackCount} 段</p>
        </div>
        <div className='hud-stats'>
          <div className='stat'>
            <span className='stat-label'>ライフ</span>
            <span className='hearts' key={hud.lives}>
              {'♥'.repeat(hud.lives)}
              <span className='hearts-lost'>{'♥'.repeat(Math.max(0, 3 - hud.lives))}</span>
            </span>
          </div>
          <div className='stat'>
            <span className='stat-label'>高度</span>
            <span className='stat-value'>{hud.height.toFixed(1)}m</span>
          </div>
          <div className='stat'>
            <span className='stat-label'>ベスト</span>
            <span className='stat-value'>{hud.best.toFixed(1)}m</span>
          </div>
          <div className='stat next'>
            <span className='stat-label'>次</span>
            {hud.nextPreviewUrl ? <img src={hud.nextPreviewUrl} alt='次のジロー' /> : <span className='stat-value'>-</span>}
          </div>
        </div>
      </header>

      <div className='stage'>
        <canvas ref={canvasRef} />
        {hud.phase === 'loading' && !error && <div className='overlay'>読み込み中…</div>}
        {error && <div className='overlay error'>{error}</div>}
        {hud.phase === 'gameover' && (
          <div className='overlay gameover'>
            <div className='go-panel'>
              <p className='go-title'>GAME OVER</p>
              <p className='go-height'>
                最高到達高度 <strong>{hud.height.toFixed(1)}m</strong>
              </p>
              <p className='go-best'>自己ベスト {hud.best.toFixed(1)}m</p>
              {hud.isNewRecord && <p className='go-record'>自己ベスト更新！</p>}
              <button className='btn retry' onClick={() => gameRef.current?.reset()}>
                もう一回
              </button>
            </div>
          </div>
        )}
      </div>

      <footer className='controls'>
        <button className='btn pad' {...move(-1)} aria-label='左へ移動'>
          ◀
        </button>
        <button className='btn pad' {...spin(-1)} aria-label='反時計回りに回転'>
          ↺
        </button>
        <button
          className='btn drop'
          onClick={() => gameRef.current?.drop()}
          disabled={hud.phase !== 'aiming'}
          aria-label='ジローを落とす'
        >
          落とす
        </button>
        <button className='btn pad' {...spin(1)} aria-label='時計回りに回転'>
          ↻
        </button>
        <button className='btn pad' {...move(1)} aria-label='右へ移動'>
          ▶
        </button>
      </footer>
    </main>
  );
}
