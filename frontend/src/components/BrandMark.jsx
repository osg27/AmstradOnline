import React from 'react';
import logoUrl from '../../assets/Logo.png';

export default function BrandMark({ compact = false }) {
  return (
    <div className={`brand-mark ${compact ? 'compact' : ''}`}>
      <img src={logoUrl} alt="Old Style Gaming" />
      <div className="brand-copy">
        <span>Old Style Gaming</span>
        {!compact ? <strong>Amstrad Multiplayer</strong> : null}
      </div>
    </div>
  );
}
