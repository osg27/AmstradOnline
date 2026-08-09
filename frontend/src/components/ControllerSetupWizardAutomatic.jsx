import React, { useEffect, useRef, useState } from 'react';
import { getControllerMapping, setControllerMapping } from '../utils/controllerMappingStorage';
import { getActionLabel, getDefaultMapping, getSystemActions } from '../utils/defaultControllerMappings';
import { getGamepadNameAndId } from '../utils/controllerInputDetection';
import { detectControllerFamily, getPhysicalButtonLabel } from '../utils/controllerFamilyDetection';
import './ControllerSetupWizardAutomatic.css';

const DEADZONE = 0.45;
const CAPTURE_TIMEOUT_MS = 10000;

export default function ControllerSetupWizardAutomatic({
  isOpen,
  gamepadIndex,
  system,
  systemLabel = 'this system',
  onClose,
  onInputCaptureStateChange,
}) {
  const actions = getSystemActions(system);
  const [stage, setStage] = useState('configuring');
  const [stepIndex, setStepIndex] = useState(0);
  const [mapping, setMapping] = useState({});
  const [controllerInfo, setControllerInfo] = useState({ name: 'No controller', id: null });
  const [controllerFamily, setControllerFamily] = useState('generic');
  const [detectedInput, setDetectedInput] = useState(null);
  const [error, setError] = useState('');

  const mappingRef = useRef({});
  const frameRef = useRef(null);
  const timerRef = useRef(null);
  const successTimerRef = useRef(null);
  const generationRef = useRef(0);

  function stopCapture() {
    generationRef.current += 1;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    clearTimeout(timerRef.current);
    frameRef.current = null;
    timerRef.current = null;
    onInputCaptureStateChange?.(false);
  }

  function closeWizard() {
    stopCapture();
    clearTimeout(successTimerRef.current);
    onClose();
  }

  function finishConfiguration() {
    stopCapture();
    if (!controllerInfo.id) return;
    setControllerMapping(system, controllerInfo.id, mappingRef.current);
    setMapping(mappingRef.current);
    setStage('success');
  }

  function beginCapture(nextStepIndex) {
    stopCapture();
    const generation = generationRef.current;
    const initialPad = navigator.getGamepads?.()[gamepadIndex];
    if (!initialPad) {
      setError('Controller disconnected');
      return;
    }

    setStepIndex(nextStepIndex);
    setDetectedInput(null);
    setError('');
    onInputCaptureStateChange?.(true);
    const initialButtons = Array.from(initialPad.buttons || [], (button) => Boolean(button?.pressed));
    const initialAxes = Array.from(initialPad.axes || [], (axis) => Number(axis) || 0);
    const startedAt = performance.now();

    const waitUntilReleased = (input) => {
      if (generation !== generationRef.current) return;
      const pad = navigator.getGamepads?.()[gamepadIndex];
      if (!pad) {
        setError('Controller disconnected');
        stopCapture();
        return;
      }
      const released = input.type === 'button'
        ? !pad.buttons[input.index]?.pressed
        : input.direction > 0
          ? (Number(pad.axes[input.index]) || 0) <= DEADZONE
          : (Number(pad.axes[input.index]) || 0) >= -DEADZONE;
      if (!released) {
        timerRef.current = setTimeout(() => waitUntilReleased(input), 50);
        return;
      }
      timerRef.current = setTimeout(() => {
        if (generation !== generationRef.current) return;
        if (nextStepIndex === actions.length - 1) finishConfiguration();
        else beginCapture(nextStepIndex + 1);
      }, 300);
    };

    const record = (input) => {
      if (generation !== generationRef.current) return;
      const action = actions[nextStepIndex];
      const nextMapping = { ...mappingRef.current, [action]: input };
      mappingRef.current = nextMapping;
      setMapping(nextMapping);
      setDetectedInput(input);
      waitUntilReleased(input);
    };

    const poll = (now) => {
      if (generation !== generationRef.current) return;
      const pad = navigator.getGamepads?.()[gamepadIndex];
      if (!pad) {
        setError('Controller disconnected');
        stopCapture();
        return;
      }
      for (let index = 0; index < pad.buttons.length; index += 1) {
        if (pad.buttons[index]?.pressed && !initialButtons[index]) {
          record({ type: 'button', index });
          return;
        }
      }
      for (let index = 0; index < pad.axes.length; index += 1) {
        const value = Number(pad.axes[index]) || 0;
        if (Math.abs(value) > DEADZONE && Math.abs(initialAxes[index] || 0) <= DEADZONE) {
          record({ type: 'axis', index, direction: value > 0 ? 1 : -1 });
          return;
        }
      }
      if (now - startedAt >= CAPTURE_TIMEOUT_MS) {
        setError('No input detected — try again or keep the current mapping');
        stopCapture();
        return;
      }
      frameRef.current = requestAnimationFrame(poll);
    };
    frameRef.current = requestAnimationFrame(poll);
  }

  function keepCurrentAndContinue() {
    stopCapture();
    if (stepIndex === actions.length - 1) finishConfiguration();
    else beginCapture(stepIndex + 1);
  }

  useEffect(() => {
    if (!isOpen) {
      stopCapture();
      return undefined;
    }
    const info = getGamepadNameAndId(gamepadIndex);
    setControllerInfo(info);
    setControllerFamily(detectControllerFamily(info.id));
    setStage('configuring');
    setStepIndex(0);
    setDetectedInput(null);
    setError('');
    const initialMapping = info.id
      ? getControllerMapping(system, info.id) || getDefaultMapping(system) || {}
      : {};
    mappingRef.current = initialMapping;
    setMapping(initialMapping);
    if (info.id && actions.length) beginCapture(0);
    return stopCapture;
  }, [isOpen, gamepadIndex, system]);

  useEffect(() => {
    if (!isOpen || stage !== 'success') return undefined;
    successTimerRef.current = setTimeout(closeWizard, 1600);
    return () => clearTimeout(successTimerRef.current);
  }, [isOpen, stage]);

  if (!isOpen) return null;
  if (!controllerInfo.id) {
    return (
      <div className="wizard-overlay" onClick={closeWizard}>
        <div className="wizard-container" onClick={(event) => event.stopPropagation()}>
          <h2>Controller Setup</h2>
          <div className="wizard-no-controller">
            <p>No controller detected</p>
            <p>Connect a gamepad, joystick or arcade stick, then reopen Controller Setup.</p>
            <button type="button" className="wizard-btn-cancel" onClick={closeWizard}>Close</button>
          </div>
        </div>
      </div>
    );
  }
  if (stage === 'success') {
    return (
      <div className="wizard-overlay" onClick={closeWizard}>
        <div className="wizard-container" onClick={(event) => event.stopPropagation()}>
          <div className="wizard-success">
            <h2>✓ Controller saved</h2>
            <p>Your custom {systemLabel} controls are ready to use.</p>
          </div>
        </div>
      </div>
    );
  }

  const action = actions[stepIndex];
  const existing = mapping[action];
  const existingLabel = existing
    ? getPhysicalButtonLabel(controllerFamily, existing.type, existing.index, existing.direction)
    : 'Not configured';
  return (
    <div className="wizard-overlay" onClick={closeWizard}>
      <div className="wizard-container" onClick={(event) => event.stopPropagation()}>
        <h2>Controller Setup</h2>
        <div className="wizard-controller-header">
          <p className="controller-name">{controllerInfo.name}</p>
          <p className="controller-family">Configuring controls for {systemLabel}</p>
        </div>
        <div className="wizard-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${((stepIndex + 1) / actions.length) * 100}%` }} />
          </div>
          <span className="progress-label">{stepIndex + 1} of {actions.length}</span>
        </div>
        <div className="wizard-prompt-section">
          {detectedInput ? (
            <>
              <h3 className="prompt-success">✓ Detected</h3>
              <p className="prompt-detected">{getPhysicalButtonLabel(controllerFamily, detectedInput.type, detectedInput.index, detectedInput.direction)}</p>
              <p className="prompt-advancing">Release it to continue…</p>
            </>
          ) : (
            <>
              <h3 className="prompt-main">Press {getActionLabel(system, action)}</h3>
              <p className="prompt-sub">Current mapping: {existingLabel}</p>
              <p className="prompt-waiting">Waiting for input…</p>
            </>
          )}
          {error && <p className="wizard-error-message">{error}</p>}
        </div>
        <div className="wizard-button-group">
          {error ? (
            <button type="button" className="wizard-btn-secondary" onClick={() => beginCapture(stepIndex)}>Try again</button>
          ) : null}
          <button type="button" className="wizard-btn-secondary" onClick={keepCurrentAndContinue}>Keep current / skip</button>
          <button type="button" className="wizard-btn-cancel" onClick={closeWizard}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
