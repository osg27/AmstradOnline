import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

const WIDTH = 768;
const HEIGHT = 544;
const SCALE = 2;
const MAX_KEY_LOG = 8;

function normalizeInput(input) {
  if (!input) return null;

  try {
    return typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    return { type: 'key', key: String(input), action: 'keydown' };
  }
}

const CanvasAmstradHost = forwardRef(function CanvasAmstradHost(_, ref) {
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const pressedKeysRef = useRef(new Set());
  const tickRef = useRef(0);
  const [recentInputs, setRecentInputs] = useState([]);

  const addRecentInput = (payload, source = 'local') => {
    if (!payload?.key) return;

    const label = `${source}:${payload.action === 'keyup' ? '↑' : '↓'} ${payload.key}`;
    setRecentInputs((prev) => [label, ...prev].slice(0, MAX_KEY_LOG));
  };

  const applyInput = (rawInput, source = 'local') => {
    const payload = normalizeInput(rawInput);
    if (!payload || payload.type !== 'key' || !payload.key) {
      return;
    }

    const normalizedAction = payload.action === 'keyup' || payload.action === 'up' ? 'keyup' : 'keydown';

    if (normalizedAction === 'keydown') {
      pressedKeysRef.current.add(payload.key);
    } else {
      pressedKeysRef.current.delete(payload.key);
    }

    addRecentInput({ ...payload, action: normalizedAction }, source);
  };

  useImperativeHandle(ref, () => ({
    captureStream: (fps = 30) => canvasRef.current?.captureStream(fps) ?? null,
    handleRemoteInput: (payload) => applyInput(payload, 'guest'),
    handleLocalInput: (payload) => applyInput(payload, 'host'),
    focus: () => canvasRef.current?.focus(),
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return undefined;
    }

    const render = () => {
      tickRef.current += 1;
      const tick = tickRef.current;
      const pressedKeys = Array.from(pressedKeysRef.current);

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#001122';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      ctx.fillStyle = '#0b2f1f';
      ctx.fillRect(16, 16, WIDTH - 32, HEIGHT - 32);

      ctx.strokeStyle = '#39ff88';
      ctx.lineWidth = 4;
      ctx.strokeRect(16, 16, WIDTH - 32, HEIGHT - 32);

      ctx.fillStyle = '#7CFFB2';
      ctx.font = '28px monospace';
      ctx.fillText('AMSTRAD CPC HOST SURFACE', 36, 60);

      ctx.fillStyle = '#c6ffd6';
      ctx.font = '20px monospace';
      ctx.fillText('WebRTC authoritative host demo', 36, 98);
      ctx.fillText('Next step: swap this canvas for a real CPC emulator output', 36, 128);

      ctx.fillStyle = '#7CFFB2';
      ctx.fillText('Pressed keys:', 36, 184);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(pressedKeys.length ? pressedKeys.join(', ') : '(none)', 36, 214);

      ctx.fillStyle = '#7CFFB2';
      ctx.fillText('Recent input events:', 36, 270);
      ctx.fillStyle = '#ffffff';
      recentInputs.forEach((entry, index) => {
        ctx.fillText(`${index + 1}. ${entry}`, 36, 304 + (index * 28));
      });

      const leftPressed = pressedKeysRef.current.has('ArrowLeft');
      const rightPressed = pressedKeysRef.current.has('ArrowRight');
      const upPressed = pressedKeysRef.current.has('ArrowUp');
      const downPressed = pressedKeysRef.current.has('ArrowDown');
      const firePressed = pressedKeysRef.current.has(' ') || pressedKeysRef.current.has('Space') || pressedKeysRef.current.has('Enter');

      const baseX = 470 + Math.sin(tick / 20) * 40 + (leftPressed ? -60 : 0) + (rightPressed ? 60 : 0);
      const baseY = 280 + Math.cos(tick / 24) * 28 + (upPressed ? -50 : 0) + (downPressed ? 50 : 0);

      ctx.fillStyle = firePressed ? '#ffdd57' : '#ff5a5a';
      ctx.fillRect(baseX, baseY, 80, 80);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(baseX, baseY, 80, 80);

      ctx.fillStyle = '#ffffff';
      ctx.fillText(firePressed ? 'FIRE' : 'MOVE', baseX - 6, baseY - 16);

      ctx.fillStyle = '#7CFFB2';
      ctx.fillText('Controls: arrows + space/enter', 36, HEIGHT - 38);

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [recentInputs]);

  useEffect(() => {
    function handleKeyDown(event) {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter'];
      if (keys.includes(event.key)) {
        event.preventDefault();
      }
      applyInput({ type: 'key', key: event.key, action: 'keydown' }, 'host');
    }

    function handleKeyUp(event) {
      applyInput({ type: 'key', key: event.key, action: 'keyup' }, 'host');
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <div className="amstrad-surface-wrap">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        tabIndex={0}
        className="amstrad-surface"
        style={{ width: `${WIDTH / SCALE}px`, height: `${HEIGHT / SCALE}px` }}
      />
    </div>
  );
});

export default CanvasAmstradHost;
