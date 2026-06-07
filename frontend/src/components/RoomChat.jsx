import React, { useEffect, useRef, useState } from 'react';

export default function RoomChat({ messages, onSend, connected }) {
  const [message, setMessage] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function submitMessage(event) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || !connected) return;
    onSend(trimmed);
    setMessage('');
  }

  return (
    <section className="room-chat" aria-label="Room chat">
      <div className="room-chat-head">
        <div>
          <h2>Room chat</h2>
          <p>{connected ? 'Live' : 'Connecting...'}</p>
        </div>
        <span className={connected ? 'online-dot' : 'offline-dot'} aria-hidden="true" />
      </div>

      <div className="room-chat-messages" ref={listRef} aria-live="polite">
        {messages.length ? messages.map((item) => (
          <div className={`room-chat-message ${item.mine ? 'mine' : ''}`} key={item.id}>
            <div>
              <strong>{item.username}</strong>
              <small>{item.time}</small>
            </div>
            <p>{item.message}</p>
          </div>
        )) : (
          <p className="room-chat-empty">No messages yet. Say hello.</p>
        )}
      </div>

      <form className="room-chat-form" onSubmit={submitMessage}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={connected ? 'Write a message...' : 'Waiting for room connection...'}
          maxLength={300}
          disabled={!connected}
        />
        <button type="submit" disabled={!connected || !message.trim()}>Send</button>
      </form>
    </section>
  );
}
