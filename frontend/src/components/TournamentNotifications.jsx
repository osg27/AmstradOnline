import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { armNotificationSound, playRoomInviteSound } from '../utils/notificationSound';

export default function TournamentNotifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const displayedIdsRef = useRef(new Set());

  useEffect(() => {
    let active = true;
    const disarm = armNotificationSound();

    async function pollNotifications() {
      try {
        const payload = await apiFetch('/auth/tournaments/notifications');
        if (!active || !Array.isArray(payload) || !payload.length) return;
        const fresh = payload.filter((item) => !displayedIdsRef.current.has(item.id));
        if (!fresh.length) return;
        fresh.forEach((item) => displayedIdsRef.current.add(item.id));
        setNotifications((current) => [...current, ...fresh].slice(-4));
        playRoomInviteSound();
        await Promise.all(fresh.map((item) => apiFetch(
          `/auth/tournaments/notifications/${item.id}/read`,
          { method: 'PATCH' },
        ).catch(() => {})));
      } catch {
        // A notification poll must never interrupt a game or page navigation.
      }
    }

    pollNotifications();
    const timer = window.setInterval(pollNotifications, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
      disarm();
    };
  }, []);

  function dismiss(id) {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }

  if (!notifications.length) return null;

  return (
    <aside className="tournament-notification-stack" aria-live="polite" aria-label="Tournament notifications">
      {notifications.map((notification) => (
        <article className="tournament-overtaken-toast" key={notification.id}>
          <span className="tournament-toast-icon" aria-hidden="true">10p</span>
          <div>
            <strong>{notification.username} has moved ahead of you!</strong>
            <span>{notification.tournament_name}</span>
            <small>{notification.game_name} · {Number(notification.score).toLocaleString()}</small>
          </div>
          <button
            type="button"
            onClick={() => {
              dismiss(notification.id);
              navigate(`/tournaments/${notification.tournament_code}`);
            }}
          >
            View
          </button>
          <button
            className="secondary tournament-toast-close"
            type="button"
            aria-label="Dismiss notification"
            onClick={() => dismiss(notification.id)}
          >
            ×
          </button>
        </article>
      ))}
    </aside>
  );
}
