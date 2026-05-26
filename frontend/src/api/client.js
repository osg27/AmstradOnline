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
    throw new Error(data?.detail || 'Request failed');
  }

  return data;
}

export function getSignalingUrl(roomCode) {
  return `${WS_BASE_URL}/ws/signaling/${roomCode}`;
}
