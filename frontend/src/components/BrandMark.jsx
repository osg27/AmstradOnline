import React from 'react';
import logoUrl from '../../assets/Logo.png';

export default function BrandMark({ compact = false }) {
  return (
    <div className={`brand-mark ${compact ? 'compact' : ''}`}>
      <img src={logoUrl} alt="Old Style Gaming" />
      {!compact ? (
        <div className="brand-copy">
          <strong>Old Style Gaming</strong>
        </div>
      ) : null}
    </div>
  );
}
