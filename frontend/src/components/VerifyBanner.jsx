import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, setEmailVerified } from '../api/client';
import './VerifyBanner.css';

function readUnverified() {
  try {
    return !!localStorage.getItem('token') && localStorage.getItem('emailVerified') !== 'true';
  } catch {
    return false;
  }
}

function takeWelcomeNote() {
  try {
    const note = sessionStorage.getItem('osgWelcomeNote') || '';
    sessionStorage.removeItem('osgWelcomeNote');
    return note;
  } catch {
    return '';
  }
}

export default function VerifyBanner() {
  const [unverified, setUnverified] = useState(readUnverified);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(() => ({ kind: 'info', text: takeWelcomeNote() }));

  const refresh = useCallback(async () => {
    if (!localStorage.getItem('token')) { setUnverified(false); return; }
    try {
      const me = await apiFetch('/auth/me');
      if (typeof me?.email_verified === 'boolean') setEmailVerified(me.email_verified);
    } catch {
      // Keep the last known state when offline or the session expired.
    }
    setUnverified(readUnverified());
  }, []);

  useEffect(() => {
    refresh();
    const sync = () => setUnverified(readUnverified());
    window.addEventListener('focus', refresh);
    window.addEventListener('osg-email-verified-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('osg-email-verified-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, [refresh]);

  async function resend() {
    setBusy(true);
    setStatus({ kind: 'info', text: '' });
    try {
      const data = await apiFetch('/auth/resend-verification/me', { method: 'POST' });
      if (data?.email_verified) setEmailVerified(true);
      setStatus({ kind: 'ok', text: data?.message || 'Verification email sent.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!unverified) return null;

  return (
    <div className="osg-verify" role="status">
      <div className="osg-verify-inner">
        <i className="bi bi-envelope-exclamation-fill osg-verify-icon" aria-hidden="true" />
        <p className="osg-verify-text">Verify your email to play online, enter tournaments and post scores.</p>
        <button type="button" className="osg-verify-btn" onClick={resend} disabled={busy}>
          {busy ? 'Sending...' : 'Resend email'}
        </button>
        {status.text ? (
          <span className={`osg-verify-status osg-verify-status--${status.kind}`} aria-live="polite">{status.text}</span>
        ) : null}
      </div>
    </div>
  );
}
