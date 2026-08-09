// Detects gamepad button and axis input for controller configuration

const DEADZONE = 0.5;

export async function detectNextControllerInput(gamepadIndex, ignoreCurrentState = true) {
  // Get initial state to ignore already-pressed buttons
  let initialState = null;
  if (ignoreCurrentState) {
    const pads = navigator.getGamepads?.() || [];
    const pad = pads[gamepadIndex];
    if (pad) {
      initialState = {
        buttons: Array.from(pad.buttons || []).map(b => b?.pressed || false),
        axes: Array.from(pad.axes || []).map(a => Number(a) || 0),
      };
    }
  }

  return new Promise((resolve) => {
    let resolved = false;
    let pollCount = 0;
    const maxPolls = 600; // 10 seconds at 60fps

    function poll() {
      pollCount++;
      if (pollCount > maxPolls) {
        resolve(null);
        return;
      }

      const pads = navigator.getGamepads?.() || [];
      const pad = pads[gamepadIndex];

      if (!pad) {
        if (!resolved) {
          resolved = true;
          resolve({ type: 'disconnected' });
        }
        return;
      }

      // Check buttons
      for (let i = 0; i < pad.buttons.length; i++) {
        const pressed = pad.buttons[i]?.pressed || false;
        const wasPressed = initialState?.buttons[i] || false;

        // Detect button press (transition from not-pressed to pressed)
        if (pressed && !wasPressed) {
          if (!resolved) {
            resolved = true;
            resolve({ type: 'button', index: i });
          }
          return;
        }
      }

      // Check axes (look for movement beyond deadzone)
      for (let i = 0; i < pad.axes.length; i++) {
        const value = Number(pad.axes[i]) || 0;
        const initialValue = initialState?.axes[i] || 0;

        // Detect axis movement that exceeds deadzone
        if (Math.abs(value) > DEADZONE && Math.abs(initialValue) <= DEADZONE) {
          const direction = value > 0 ? 1 : -1;
          if (!resolved) {
            resolved = true;
            resolve({ type: 'axis', index: i, direction });
          }
          return;
        }
      }

      requestAnimationFrame(poll);
    }

    poll();
  });
}

export function getDetectionLabel(detection) {
  if (!detection) return null;
  if (detection.type === 'button') {
    return `Button ${detection.index}`;
  }
  if (detection.type === 'axis') {
    const dir = detection.direction > 0 ? 'positive' : 'negative';
    return `Axis ${detection.index} (${dir})`;
  }
  if (detection.type === 'disconnected') {
    return 'Controller disconnected';
  }
  return 'Unknown input';
}

export function getGamepadNameAndId(gamepadIndex) {
  const pads = navigator.getGamepads?.() || [];
  const pad = pads[gamepadIndex];
  if (!pad) return { name: 'No controller', id: null };
  return { name: pad.id, id: pad.id };
}

export function isAxisActive(axis, threshold = DEADZONE) {
  return Math.abs(axis) > threshold;
}
