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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || getDefaultApiBaseUrl();
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || getDefaultWsBaseUrl();

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

export async function apiFetch(path, options = {}) {
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
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      window.location.assign('/login');
    }

    throw new Error(formatApiErrorDetail(data?.detail));
  }

  return data;
}

export function getSignalingUrl(roomCode) {
  return `${WS_BASE_URL}/ws/signaling/${roomCode}`;
}
