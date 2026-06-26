import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

function messageTime(createdAt) {
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MemberMessages({ targetUser = null, onTargetHandled = () => {} }) {
  const [conversations, setConversations] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [thread, setThread] = useState([]);
  const [recipientUsername, setRecipientUsername] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const activeUserId = activeUser?.id || null;
  const totalUnread = useMemo(
    () => conversations.reduce((total, item) => total + (Number(item.unread_count) || 0), 0),
    [conversations],
  );

  function scrollToBottom() {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }

  async function loadConversations() {
    const items = await apiFetch('/auth/social/messages');
    setConversations(items);
    return items;
  }

  async function loadThread(userId = activeUserId) {
    if (!userId) {
      setThread([]);
      return null;
    }
    const data = await apiFetch(`/auth/social/messages/${userId}`);
    setActiveUser(data.user);
    setThread(data.messages);
    window.setTimeout(scrollToBottom, 0);
    return data;
  }

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const items = await loadConversations();
        if (!active) return;
        if (!activeUserId && items.length) {
          setActiveUser(items[0].user);
        }
        if (activeUserId) {
          await loadThread(activeUserId);
        }
        setError('');
      } catch (err) {
        if (active) setError(err.message);
      }
    }

    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeUserId]);

  useEffect(() => {
    if (!targetUser) return;
    setActiveUser(targetUser);
    setRecipientUsername('');
    onTargetHandled();
  }, [targetUser, onTargetHandled]);

  useEffect(() => {
    if (activeUserId) {
      loadThread(activeUserId).catch((err) => setError(err.message));
    }
  }, [activeUserId]);

  async function startConversation(event) {
    event.preventDefault();
    const username = recipientUsername.trim();
    if (!username) return;
    setSending(true);
    setError('');
    try {
      const player = await apiFetch(`/auth/social/players/${encodeURIComponent(username)}`);
      setRecipientUsername('');
      setActiveUser(player);
      await loadConversations();
      await loadThread(player.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || sending || !activeUserId) return;
    setSending(true);
    setError('');
    try {
      const sent = await apiFetch('/auth/social/messages', {
        method: 'POST',
        body: JSON.stringify({ recipient_id: activeUserId, message: trimmed }),
      });
      setThread((items) => [...items.slice(-99), sent]);
      setMessage('');
      await loadConversations();
      window.setTimeout(scrollToBottom, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="member-messages" aria-label="Member messages">
      <div className="room-chat-head member-messages-head">
        <div>
          <h2>Messages</h2>
          <p>{totalUnread ? `${totalUnread} unread` : 'Direct member chat'}</p>
        </div>
      </div>

      <form className="member-message-start" onSubmit={startConversation}>
        <input
          value={recipientUsername}
          onChange={(event) => setRecipientUsername(event.target.value)}
          placeholder="Message username"
          maxLength={50}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !recipientUsername.trim()}>Start</button>
      </form>

      <div className="member-message-body">
        <div className="member-conversation-list" aria-label="Conversations">
          {conversations.length ? conversations.map((item) => (
            <button
              key={item.user.id}
              type="button"
              className={activeUserId === item.user.id ? 'active' : 'secondary'}
              onClick={() => setActiveUser(item.user)}
            >
              <span>
                <strong>{item.user.username}</strong>
                <small>{item.mine ? 'You: ' : ''}{item.message}</small>
              </span>
              {item.unread_count ? <em>{item.unread_count}</em> : null}
            </button>
          )) : (
            <p className="room-chat-empty">Pick someone online and say hello.</p>
          )}
        </div>

        <div className="member-thread">
          <div className="member-thread-title">
            <strong>{activeUser?.username || 'No conversation selected'}</strong>
            {activeUser ? <span className={activeUser.is_online ? 'online-dot' : 'offline-dot'} aria-label={activeUser.is_online ? 'Online' : 'Offline'} /> : null}
          </div>

          <div className="room-chat-messages" ref={listRef} aria-live="polite">
            {thread.length ? thread.map((item) => (
              <div className={`room-chat-message ${item.mine ? 'mine' : ''}`} key={item.id}>
                <div>
                  <strong>{item.username}</strong>
                  <small>{messageTime(item.created_at)}</small>
                </div>
                <p>{item.message}</p>
              </div>
            )) : (
              <p className="room-chat-empty">{activeUser ? 'No messages yet.' : 'Choose a member to message.'}</p>
            )}
          </div>

          <form className="room-chat-form" onSubmit={sendMessage}>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={activeUser ? `Message ${activeUser.username}` : 'Choose a member first'}
              maxLength={500}
              disabled={sending || !activeUser}
            />
            <button type="submit" disabled={sending || !activeUser || !message.trim()}>Send</button>
          </form>
        </div>
      </div>

      {error ? <p className="error lobby-chat-error">{error}</p> : null}
    </section>
  );
}
