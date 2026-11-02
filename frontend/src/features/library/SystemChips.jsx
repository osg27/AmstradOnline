import React, { useEffect, useRef } from 'react';

/** Horizontal scroller of system filter chips (All, Favourites, one per system). */
export default function SystemChips({ chips, active, onSelect }) {
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [active]);

  return (
    <div className="osg-lib-chips" role="group" aria-label="Filter by system">
      {chips.map((chip) => (
        <button
          key={chip.id}
          ref={active === chip.id ? activeRef : null}
          type="button"
          className="osg-lib-chip"
          aria-pressed={active === chip.id}
          onClick={() => onSelect(chip.id)}
          style={chip.color ? { '--sys': chip.color } : undefined}
        >
          {chip.color ? <i aria-hidden="true" /> : null}
          {chip.star ? <i className="bi bi-star-fill osg-lib-chip-star" aria-hidden="true" /> : null}
          <span>{chip.label}</span>
          <b>{chip.count.toLocaleString('en-GB')}</b>
        </button>
      ))}
    </div>
  );
}
