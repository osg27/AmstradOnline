import { SUPPORTER_UI_ENABLED } from '../config/supporterUi';
import React from 'react';

export default function SupporterLockModal({ feature, onClose }) {
  if (!feature) return null;
  if (!SUPPORTER_UI_ENABLED) {
    return (
      <div className="tournament-modal-backdrop">
        <section className="tournament-modal" role="dialog" aria-modal="true" aria-label="Feature unavailable">
          <h2>This option is currently unavailable for your account.</h2>
          <button type="button" onClick={onClose}>Close</button>
        </section>
      </div>
    );
  }
  return (
    <div className="tournament-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="tournament-modal" role="dialog" aria-modal="true" aria-label="Supporter feature">
        <h2>{feature} {/(rooms|sessions)$/.test(feature) ? 'are' : 'is'} available to OldStyleGaming Supporters.</h2>
        <p>{feature === 'Protected rooms'
          ? 'Normal rooms are unlisted and shared by code or link. Protected rooms also require a host invite or password.'
          : 'Supporters help keep the arcade running.'}</p>
        <button type="button" onClick={onClose}>Become a Supporter</button>
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}
