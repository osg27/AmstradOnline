import React from 'react';

/** Input monitor + session log (moved from RoomPage), plus the old diagnostics summary strip. */
export default function DiagnosticsPanel({
  status,
  micStatus,
  showMicStatus,
  controlLabel,
  healthItems,
  inputDebug,
  inputLabels,
  channelState,
  inputCaptured,
  logs,
}) {
  return (
    <div className="osg-diagnostics">
      <div className="session-strip diagnostics-summary">
        <span>{status}</span>
        {showMicStatus ? <span>{micStatus}</span> : null}
        <span>{controlLabel}</span>
      </div>

      <div className="health-strip" aria-label="Connection status">
        {healthItems.map((item) => (
          <span key={item.label} className={`health-item ${item.ok ? 'ok' : 'waiting'}`}>
            <span className="health-dot" aria-hidden="true" />
            {item.label}
          </span>
        ))}
      </div>

      <div className="panel input-debug-panel">
        <div className="play-header">
          <h2>Input monitor</h2>
          <div className="assigned-control">
            {inputDebug.source}
          </div>
        </div>

        <div className="input-debug-grid">
          {inputLabels.map(([label, active]) => (
            <div
              key={label}
              className={`input-bit ${active ? 'active' : ''}`}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="input-debug-meta">
          <span>Mask {inputDebug.mask}</span>
          <span>{channelState}</span>
          <span>{inputCaptured ? 'captured' : 'released'}</span>
        </div>

        <div className="log-list input-debug-list">
          {inputDebug.events.length === 0 ? (
            <div className="log-entry">No inputs seen yet.</div>
          ) : inputDebug.events.map((event, index) => (
            <div key={`${event}-${index}`} className="log-entry">
              {event}
            </div>
          ))}
        </div>
      </div>

      <div className="panel log-panel">
        <h2>Session log</h2>

        {logs.length === 0 ? <p className="muted">No events yet.</p> : null}

        <div className="log-list">
          {logs.map((log, index) => (
            <div key={`${log}-${index}`} className="log-entry">
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
