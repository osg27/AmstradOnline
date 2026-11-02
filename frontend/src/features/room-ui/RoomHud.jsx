import React from 'react';
import Icon from './icons';

export function Pill({ children, className = '', onClick, title }) {
  if (onClick) {
    return <button type="button" className={`osg-pill ${className}`.trim()} onClick={onClick} title={title}>{children}</button>;
  }
  return <span className={`osg-pill ${className}`.trim()} title={title}>{children}</span>;
}

function Toast({ toast, onDismiss }) {
  return (
    <div className={`osg-toast ${toast.kind}`} role="status">
      <span className="osg-toast-ic" style={toast.iconBackground ? { background: toast.iconBackground } : undefined}>{toast.icon}</span>
      <div>
        {toast.kicker ? <div className="osg-toast-k">{toast.kicker}</div> : null}
        <div className="osg-toast-t">{toast.title}</div>
        {toast.detail ? <div className="osg-toast-d">{toast.detail}</div> : null}
      </div>
      {onDismiss ? (
        <button type="button" className="osg-toast-x" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">×</button>
      ) : null}
    </div>
  );
}

/** HUD pills (input, achievements, scores, REC), toasts and arcade coin hints. */
export default function RoomHud({ leftPills = [], rightPills = [], stripPills = [], toasts = [], onDismissToast, coinHint, error, onDismissError }) {
  return (
    <>
      <div className="osg-hud-l">{leftPills}</div>
      <div className="osg-hud-r">{rightPills}</div>
      <div className="osg-ph-strip">{stripPills}</div>
      <div className="osg-toasts" aria-live="polite">
        {error ? (
          <div className="osg-toast error" role="alert">
            <span className="osg-toast-ic"><Icon name="info" /></span>
            <div>
              <div className="osg-toast-k">Something went wrong</div>
              <div className="osg-toast-d">{error}</div>
            </div>
            {onDismissError ? <button type="button" className="osg-toast-x" onClick={onDismissError} aria-label="Dismiss error">×</button> : null}
          </div>
        ) : null}
        {toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={onDismissToast} />)}
      </div>
      {coinHint ? <div className="osg-coin-hint">{coinHint}</div> : null}
    </>
  );
}
