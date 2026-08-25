import React, { useState } from 'react';
import { RECORDING_COUNTDOWNS, RECORDING_DURATIONS, RECORDING_QUALITIES } from './gameRecorder';
import { useGameRecorder } from './useGameRecorder';
import { detectNextControllerInput, getDetectionLabel } from '../../utils/controllerInputDetection';

const RECORD_BUTTON_STORAGE_KEY = 'gameRecordingButtonBinding';

function loadRecordButtonBinding() {
  try {
    const value = JSON.parse(localStorage.getItem(RECORD_BUTTON_STORAGE_KEY));
    return Number.isInteger(value?.buttonIndex) ? value : null;
  } catch {
    return null;
  }
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function durationLabel(value) {
  if (value == null) return 'Manual';
  if (value < 60) return `${value}s`;
  return `${value / 60}m`;
}

export default function GameRecorderControls({ available, unavailableReason, sourceFactory, gameTitle, systemLabel, onActiveChange }) {
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const [quality, setQuality] = useState('standard');
  const [recordButton, setRecordButton] = useState(loadRecordButtonBinding);
  const [assigningButton, setAssigningButton] = useState(false);
  const recorder = useGameRecorder(sourceFactory);
  const active = recorder.status === 'countdown' || recorder.status === 'recording';
  React.useEffect(() => onActiveChange?.(active), [active, onActiveChange]);

  const startWithCurrentSettings = React.useCallback(() => {
    if (!available || active) return;
    if (recorder.status === 'ready') recorder.resetRecording();
    recorder.startRecording({ durationSeconds, countdownSeconds, quality, gameTitle, system: systemLabel });
  }, [active, available, countdownSeconds, durationSeconds, gameTitle, quality, recorder, systemLabel]);

  React.useEffect(() => {
    if (!recordButton || !available || active || assigningButton) return undefined;
    let frameId = 0;
    let wasPressed = false;
    const poll = () => {
      const pads = navigator.getGamepads?.() || [];
      const pad = Array.from(pads).find((item) => item?.id === recordButton.gamepadId)
        || pads[recordButton.gamepadIndex];
      const pressed = Boolean(pad?.buttons?.[recordButton.buttonIndex]?.pressed);
      if (pressed && !wasPressed) startWithCurrentSettings();
      wasPressed = pressed;
      frameId = requestAnimationFrame(poll);
    };
    frameId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frameId);
  }, [active, assigningButton, available, recordButton, startWithCurrentSettings]);

  async function assignRecordButton() {
    const pads = Array.from(navigator.getGamepads?.() || []);
    const gamepadIndex = pads.findIndex(Boolean);
    if (gamepadIndex < 0) return;
    setAssigningButton(true);
    const detection = await detectNextControllerInput(gamepadIndex, true);
    setAssigningButton(false);
    if (detection?.type !== 'button') return;
    const binding = {
      gamepadIndex,
      gamepadId: pads[gamepadIndex]?.id || '',
      buttonIndex: detection.index,
      label: getDetectionLabel(detection),
    };
    localStorage.setItem(RECORD_BUTTON_STORAGE_KEY, JSON.stringify(binding));
    setRecordButton(binding);
  }

  function clearRecordButton() {
    localStorage.removeItem(RECORD_BUTTON_STORAGE_KEY);
    setRecordButton(null);
  }

  if (!available) {
    return <div className="game-recorder unavailable"><strong>Recording unavailable</strong><span>{unavailableReason}</span></div>;
  }

  if (recorder.status === 'countdown') {
    return (
      <div className="game-recorder active" role="status">
        <strong>Recording starts in {recorder.countdownRemaining}...</strong>
        <button type="button" className="secondary" onClick={recorder.stopRecording}>Cancel</button>
      </div>
    );
  }

  if (recorder.status === 'recording') {
    return (
      <div className="game-recorder active" role="status">
        <strong className="recording-live"><span aria-hidden="true">●</span> REC {formatTime(recorder.elapsedSeconds)}{durationSeconds == null ? '' : ` / ${formatTime(durationSeconds)}`}</strong>
        <button type="button" onClick={recorder.stopRecording}>Stop</button>
      </div>
    );
  }

  if (recorder.status === 'finalizing') {
    return <div className="game-recorder active" role="status"><strong>Finalizing recording...</strong></div>;
  }

  if (recorder.status === 'ready') {
    return (
      <div className="game-recorder ready" role="status">
        <div><strong>Recording ready</strong><span>{recorder.filename}</span></div>
        <a className="button-like" href={recorder.downloadUrl} download={recorder.filename}>Download</a>
        <button type="button" className="secondary" onClick={recorder.resetRecording}>Record Again</button>
      </div>
    );
  }

  return (
    <details className="game-recorder" open={recorder.status === 'error'}>
      <summary>Record gameplay</summary>
      <div className="game-recorder-settings">
        <fieldset><legend>Duration</legend><div>{RECORDING_DURATIONS.map((value) => <button type="button" key={value ?? 'manual'} className={durationSeconds === value ? 'active' : 'secondary'} onClick={() => setDurationSeconds(value)}>{durationLabel(value)}</button>)}</div></fieldset>
        <fieldset><legend>Countdown</legend><div>{RECORDING_COUNTDOWNS.map((value) => <button type="button" key={value} className={countdownSeconds === value ? 'active' : 'secondary'} onClick={() => setCountdownSeconds(value)}>{value ? `${value}s` : 'None'}</button>)}</div></fieldset>
        <fieldset><legend>Quality</legend><div>{Object.entries(RECORDING_QUALITIES).map(([value, item]) => <button type="button" key={value} className={quality === value ? 'active' : 'secondary'} onClick={() => setQuality(value)}>{item.label}</button>)}</div></fieldset>
        <fieldset>
          <legend>Controller shortcut (optional)</legend>
          <div>
            <button type="button" className="secondary" onClick={assignRecordButton} disabled={assigningButton}>{assigningButton ? 'Press a controller button...' : recordButton ? `Change ${recordButton.label}` : 'Assign button'}</button>
            {recordButton ? <button type="button" className="secondary" onClick={clearRecordButton}>Clear</button> : null}
          </div>
          <small>{recordButton ? `${recordButton.label} starts recording with these settings.` : 'Assign any connected controller button to start recording.'}</small>
        </fieldset>
        {recorder.error ? <p className="error">{recorder.error}</p> : null}
        <button type="button" onClick={startWithCurrentSettings}>Start Recording</button>
        <small>Captures game video and audio only. No microphone or site controls are included.</small>
      </div>
    </details>
  );
}
