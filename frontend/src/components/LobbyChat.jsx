import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

function messageTime(createdAt) {
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function LobbyChat({ showAllMessages = false }) {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lobbyChatCollapsed') === 'true');
  const [hasUnread, setHasUnread] = useState(false);
  const listRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const lastMessageIdRef = useRef(null);

  function isNearBottom() {
    const list = listRef.current;
    if (!list) return true;
    return list.scrollHeight - list.scrollTop - list.clientHeight < 56;
  }

  function scrollToBottom() {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    shouldStickToBottomRef.current = true;
    setHasUnread(false);
  }

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      localStorage.setItem('lobbyChatCollapsed', String(next));
      if (!next) {
        window.setTimeout(scrollToBottom, 0);
      }
      return next;
    });
  }

  async function loadMessages() {
    try {
      const items = await apiFetch('/auth/social/chat');
      shouldStickToBottomRef.current = isNearBottom();
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
    const latestMessageId = messages[messages.length - 1]?.id || null;
    const latestChanged = latestMessageId && latestMessageId !== lastMessageIdRef.current;
    lastMessageIdRef.current = latestMessageId;

    if (!list || collapsed) {
      if (latestChanged && collapsed) setHasUnread(true);
      return;
    }

    if (shouldStickToBottomRef.current) {
      scrollToBottom();
      return;
    }

    if (latestChanged) {
      setHasUnread(true);
    }
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
      shouldStickToBottomRef.current = true;
      setMessages((items) => [...items.slice(-99), sent]);
      setMessage('');
      window.setTimeout(scrollToBottom, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={`room-chat lobby-chat ${collapsed ? 'collapsed' : ''}`} aria-label={showAllMessages ? 'All lobby chat' : 'Friends lobby chat'}>
      <div className="room-chat-head">
        <div>
          <h2>{showAllMessages ? 'All lobby chat' : 'Friends lobby chat'}</h2>
          <p>{showAllMessages ? 'Super admin view includes everyone' : 'Only accepted friends can see your messages'}</p>
        </div>
        <div className="lobby-chat-head-actions">
          {hasUnread ? <span className="lobby-chat-unread">New</span> : null}
          <button type="button" className="secondary" onClick={toggleCollapsed}>
            {collapsed ? 'Open' : 'Hide'}
          </button>
          <span className="online-dot" aria-hidden="true" />
        </div>
      </div>

      {!collapsed ? (
        <>
          <div
            className="room-chat-messages"
            ref={listRef}
            aria-live="polite"
            onScroll={() => {
              const atBottom = isNearBottom();
              shouldStickToBottomRef.current = atBottom;
              if (atBottom) setHasUnread(false);
            }}
          >
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
            {hasUnread ? (
              <button type="button" className="lobby-chat-jump" onClick={scrollToBottom}>
                New messages
              </button>
            ) : null}
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
        </>
      ) : (
        <div className="lobby-chat-collapsed-body">
          {messages.length ? `${messages.length} recent message${messages.length === 1 ? '' : 's'}` : 'No messages yet'}
        </div>
      )}
    </section>
  );
}
