import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

function messageTime(createdAt) {
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function LobbyChat() {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  async function loadMessages() {
    try {
      const items = await apiFetch('/auth/social/chat');
      setMessages(items);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    let active = true;

    async function refresh() {
      if (active) await loadMessages();
    }

    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  async function sendMessage(event) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError('');
    try {
      const sent = await apiFetch('/auth/social/chat', {
        method: 'POST',
        body: JSON.stringify({ message: trimmed }),
      });
      setMessages((items) => [...items.slice(-99), sent]);
      setMessage('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="room-chat lobby-chat" aria-label="Friends lobby chat">
      <div className="room-chat-head">
        <div>
          <h2>Friends lobby chat</h2>
          <p>Only accepted friends can see your messages</p>
        </div>
        <span className="online-dot" aria-hidden="true" />
      </div>

      <div className="room-chat-messages" ref={listRef} aria-live="polite">
        {messages.length ? messages.map((item) => (
          <div className={`room-chat-message ${item.mine ? 'mine' : ''}`} key={item.id}>
            <div>
              <strong>{item.username}</strong>
              <small>{messageTime(item.created_at)}</small>
            </div>
            <p>{item.message}</p>
          </div>
        )) : (
          <p className="room-chat-empty">Ask your friends if they fancy a game.</p>
        )}
      </div>

      <form className="room-chat-form" onSubmit={sendMessage}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Anyone fancy a game?"
          maxLength={300}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !message.trim()}>Send</button>
      </form>
      {error ? <p className="error lobby-chat-error">{error}</p> : null}
    </section>
  );
}
