function getDefaultApiBaseUrl() {
  if (window.location.port === '5173') {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }

  return window.location.origin;
}

function getDefaultWsBaseUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (window.location.port === '5173') {
    return `${protocol}//${window.location.hostname}:8000`;
  }

  return `${protocol}//${window.location.host}`;
}

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || getDefaultApiBaseUrl();
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || getDefaultWsBaseUrl();
let refreshPromise = null;

function formatApiErrorDetail(detail) {
  if (!detail) return 'Request failed';
  if (typeof detail === 'string') return detail;

  if (Array.isArray(detail)) {
    return detail.map((item) => {
      if (typeof item === 'string') return item;
      if (item?.msg) {
        const location = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body').join('.') : '';
        return location ? `${location}: ${item.msg}` : item.msg;
      }
      return JSON.stringify(item);
    }).join('; ');
  }

  if (detail.message) return String(detail.message);
  return JSON.stringify(detail);
}

function storeAuthSession(data) {
  if (!data?.access_token) return;
  localStorage.setItem('token', data.access_token);
  localStorage.setItem('username', data.username);
  localStorage.setItem('isAdmin', data.is_admin ? 'true' : 'false');
  localStorage.setItem('isSuperAdmin', data.is_super_admin ? 'true' : 'false');
  localStorage.setItem('isTester', data.is_tester ? 'true' : 'false');
  localStorage.removeItem('isVip');
  localStorage.removeItem('isXyphoe');
}

export function clearAuthSession() {
  ['token', 'username', 'isAdmin', 'isSuperAdmin', 'isTester', 'isVip', 'isXyphoe', 'playerAvatar']
    .forEach((key) => localStorage.removeItem(key));
}

export async function renewSession() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Session expired');
    const data = await response.json();
    storeAuthSession(data);
    return data.access_token;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function apiFetch(path, options = {}, hasRetried = false) {
  const token = localStorage.getItem('token');

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: options.credentials || 'include',
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const canRefresh = response.status === 401
      && !hasRetried
      && path !== '/auth/login'
      && path !== '/auth/refresh';
    if (canRefresh) {
      try {
        await renewSession();
        return apiFetch(path, options, true);
      } catch {
        clearAuthSession();
        window.dispatchEvent(new CustomEvent('auth-session-expired'));
        if (!window.location.pathname.startsWith('/room/')) window.location.assign('/login');
      }
    }

    throw new Error(formatApiErrorDetail(data?.detail));
  }

  return data;
}

export function getSignalingUrl(roomCode) {
  return `${WS_BASE_URL}/ws/signaling/${roomCode}`;
}
