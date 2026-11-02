import { useEffect, useState } from 'react';

const PHONE_PORTRAIT = '(max-width: 700px) and (orientation: portrait)';
const PHONE_LANDSCAPE = '(max-height: 520px) and (orientation: landscape) and (pointer: coarse)';

function readViewport() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  if (window.matchMedia(PHONE_PORTRAIT).matches) return 'phone';
  if (window.matchMedia(PHONE_LANDSCAPE).matches) return 'land';
  return 'desktop';
}

/** 'desktop' | 'phone' (portrait) | 'land' (phone landscape). */
export default function useRoomViewport() {
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const queries = [window.matchMedia(PHONE_PORTRAIT), window.matchMedia(PHONE_LANDSCAPE)];
    const update = () => setViewport(readViewport());
    queries.forEach((query) => query.addEventListener?.('change', update));
    window.addEventListener('resize', update);
    return () => {
      queries.forEach((query) => query.removeEventListener?.('change', update));
      window.removeEventListener('resize', update);
    };
  }, []);

  return viewport;
}

/** Window inner width, updated on resize. */
export function useWindowWidth() {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}
