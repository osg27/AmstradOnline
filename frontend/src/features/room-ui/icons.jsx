import React from 'react';

const STROKE = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' };

const ICONS = {
  back: [STROKE, 2.4, <path key="a" d="M15 18l-6-6 6-6" />],
  play: [{ fill: 'currentColor' }, 0, <path key="a" d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />],
  pause: [{ fill: 'currentColor' }, 0, <><rect key="a" x="6" y="4.5" width="4.2" height="15" rx="1.2" /><rect key="b" x="13.8" y="4.5" width="4.2" height="15" rx="1.2" /></>],
  vol: [STROKE, 2.2, <><path key="a" d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" /><path key="b" d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></>],
  mute: [STROKE, 2.2, <><path key="a" d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" /><path key="b" d="m16 9 5 6M21 9l-5 6" /></>],
  full: [STROKE, 2.3, <path key="a" d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />],
  exitFull: [STROKE, 2.3, <path key="a" d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4" />],
  menu: [STROKE, 2.4, <path key="a" d="M4 7h16M4 12h16M4 17h16" />],
  more: [{ fill: 'currentColor' }, 0, <><circle key="a" cx="5" cy="12" r="2" /><circle key="b" cx="12" cy="12" r="2" /><circle key="c" cx="19" cy="12" r="2" /></>],
  pad: [STROKE, 2, <><path key="a" d="M6 11h4M8 9v4M15 12h.01M18 10h.01" /><path key="b" d="M17.32 5H6.68a4 4 0 0 0-3.98 3.59L2 15.2a3 3 0 0 0 5.2 2.2L9 15h6l1.8 2.4a3 3 0 0 0 5.2-2.2l-.7-6.6A4 4 0 0 0 17.32 5z" /></>],
  kb: [STROKE, 2, <><rect key="a" x="2" y="6" width="20" height="12" rx="2" /><path key="b" d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>],
  stick: [STROKE, 2, <><circle key="a" cx="8" cy="6" r="3" /><path key="b" d="M8 9v6" /><rect key="c" x="2" y="15" width="20" height="6" rx="2" /><circle key="d" cx="15" cy="12" r="1.5" /><circle key="e" cx="19" cy="12" r="1.5" /></>],
  touch: [STROKE, 2, <><rect key="a" x="6" y="2" width="12" height="20" rx="2.5" /><path key="b" d="M11 18h2" /></>],
  game: [STROKE, 2, <><rect key="a" x="3" y="4" width="18" height="13" rx="2" /><path key="b" d="M8 21h8M12 17v4" /></>],
  display: [STROKE, 2, <><circle key="a" cx="12" cy="12" r="4" /><path key="b" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>],
  rec: [STROKE, 2, <><rect key="a" x="2" y="6" width="14" height="12" rx="2" /><path key="b" d="m22 8-6 4 6 4V8z" /></>],
  trophy: [STROKE, 2, <path key="a" d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3" />],
  gem: [STROKE, 2, <><path key="a" d="M6 3h12l4 6-10 12L2 9z" /><path key="b" d="M11 3 8 9l4 12 4-12-3-6M2 9h20" /></>],
  people: [STROKE, 2, <><path key="a" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle key="b" cx="9" cy="7" r="4" /><path key="c" d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>],
  chip: [STROKE, 2, <><rect key="a" x="5" y="5" width="14" height="14" rx="2" /><path key="b" d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>],
  reset: [STROKE, 2.2, <><path key="a" d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path key="b" d="M3 3v5h5" /></>],
  swap: [STROKE, 2.2, <path key="a" d="M4 7h13l-3-3M20 17H7l3 3" />],
  file: [STROKE, 2, <><path key="a" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path key="b" d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" /></>],
  lib: [{ fill: 'none', stroke: 'currentColor', strokeLinejoin: 'round' }, 2, <><rect key="a" x="3" y="3" width="7" height="9" rx="1.5" /><rect key="b" x="14" y="3" width="7" height="9" rx="1.5" /><rect key="c" x="3" y="15" width="7" height="6" rx="1.5" /><rect key="d" x="14" y="15" width="7" height="6" rx="1.5" /></>],
  exit: [STROKE, 2.2, <path key="a" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />],
  wiz: [STROKE, 2, <path key="a" d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" />],
  mic: [STROKE, 2, <><rect key="a" x="9" y="2" width="6" height="12" rx="3" /><path key="b" d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" /></>],
  micOff: [STROKE, 2, <><path key="a" d="M2 2l20 20M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7" /><path key="b" d="M19 10v1a7 7 0 0 1-1.2 3.9M5 10v1a7 7 0 0 0 11.4 5.4M12 18v4" /></>],
  link: [STROKE, 2, <><path key="a" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path key="b" d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>],
  chat: [STROKE, 2, <path key="a" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />],
  info: [{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' }, 2.2, <><circle key="a" cx="12" cy="12" r="10" /><path key="b" d="M12 16v-4M12 8h.01" /></>],
  book: [STROKE, 2, <><path key="a" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><path key="b" d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></>],
  obs: [STROKE, 2, <><circle key="a" cx="12" cy="12" r="2" /><path key="b" d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" /></>],
  bug: [STROKE, 2, <><path key="a" d="M8 2l1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3 3 0 1 1 6 0v1" /><path key="b" d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4" /></>],
  folder: [STROKE, 2, <path key="a" d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />],
  coin: [{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' }, 2, <><circle key="a" cx="12" cy="12" r="9" /><path key="b" d="M12 7v10" /></>],
  save: [STROKE, 2, <><path key="a" d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path key="b" d="M17 21v-8H7v8M7 3v5h8" /></>],
  mouse: [STROKE, 2, <><rect key="a" x="6" y="3" width="12" height="18" rx="6" /><path key="b" d="M12 7v4" /></>],
  power: [STROKE, 2.2, <><path key="a" d="M12 2v10" /><path key="b" d="M18.4 6.6a9 9 0 1 1-12.8 0" /></>],
};

export default function Icon({ name, className, style }) {
  const entry = ICONS[name];
  if (!entry) return null;
  const [attrs, strokeWidth, children] = entry;
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
      {...attrs}
      {...(strokeWidth ? { strokeWidth } : {})}
    >
      {children}
    </svg>
  );
}
