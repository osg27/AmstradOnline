import React, { useState } from 'react';
import { RECORDING_COUNTDOWNS, RECORDING_DURATIONS, RECORDING_QUALITIES } from './gameRecorder';
import { useGameRecorder } from './useGameRecorder';

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
  const recorder = useGameRecorder(sourceFactory);
  const active = recorder.status === 'countdown' || recorder.status === 'recording';
  React.useEffect(() => onActiveChange?.(active), [active, onActiveChange]);

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
        {recorder.error ? <p className="error">{recorder.error}</p> : null}
        <button type="button" onClick={() => recorder.startRecording({ durationSeconds, countdownSeconds, quality, gameTitle, system: systemLabel })}>Start Recording</button>
        <small>Captures game video and audio only. No microphone or site controls are included.</small>
      </div>
    </details>
  );
}
