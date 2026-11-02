import { getMameDisplayName } from '../../data/mameTitleLookup';

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, '0')}m`;
}

export function formatPlayedAgo(value, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (minutes < 1) return 'just now';
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 7) return formatter.format(-days, 'day');
  if (days < 30) return formatter.format(-Math.floor(days / 7), 'week');
  return formatter.format(-Math.floor(days / 30), 'month');
}

/** The recent-scores "LIVE" badge is only honest while the newest score is under a day old. */
export function isRecentScoreLive(value, now = Date.now()) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp < DAY_MS;
}

/** A readable title for a game we only know by the file name the room reported. */
export function titleFromPlayedFile(fileName, system) {
  const base = String(fileName || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{1,4}$/i, '');
  if (system === 'arcade') return getMameDisplayName(base.toLowerCase(), base);
  const cleaned = base
    .replace(/[_]+/g, ' ')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || base || 'Unknown game';
}
