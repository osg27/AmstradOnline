import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../api/client';

function messageTime(createdAt) {
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MemberMessages({
  targetUser = null,
  targetUserId = null,
  onTargetHandled = () => {},
  layout = 'panel',
}) {
  const [conversations, setConversations] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [thread, setThread] = useState([]);
  const [recipientUsername, setRecipientUsername] = useState('');
  const [memberResults, setMemberResults] = useState([]);
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
    if (!targetUserId) return;
    loadThread(targetUserId).catch((err) => setError(err.message));
  }, [targetUserId]);

  useEffect(() => {
    if (activeUserId) {
      loadThread(activeUserId).catch((err) => setError(err.message));
    }
  }, [activeUserId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const results = await apiFetch(`/auth/social/players/search?q=${encodeURIComponent(recipientUsername.trim())}`);
        if (active) setMemberResults(results);
      } catch {
        if (active) setMemberResults([]);
      }
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [recipientUsername]);

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

  async function openPlayer(player) {
    setActiveUser(player);
    setRecipientUsername('');
    await loadThread(player.id);
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

  async function sendFriendRequest(player) {
    setSending(true);
    setError('');
    try {
      await apiFetch('/auth/social/requests', {
        method: 'POST',
        body: JSON.stringify({ username: player.username }),
      });
      setMemberResults((items) => items.map((item) => (
        item.id === player.id ? { ...item, request_pending: true } : item
      )));
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={`member-messages ${layout === 'page' ? 'member-messages-page' : ''}`} aria-label="Member messages">
      <div className="member-message-body">
        <aside className="member-message-sidebar">
          <div className="member-messages-head">
            <div>
              <h2>Messages</h2>
              <p>{totalUnread ? `${totalUnread} unread` : 'Direct member chat'}</p>
            </div>
          </div>

          <form className="member-message-start" onSubmit={startConversation}>
            <i className="bi bi-search" aria-hidden="true" />
            <input
              value={recipientUsername}
              onChange={(event) => setRecipientUsername(event.target.value)}
              placeholder="Find or start a DM"
              maxLength={50}
              disabled={sending}
            />
          </form>

          <div className="member-sidebar-scroll">
            <section className="member-conversation-section">
              <div className="member-list-label">Direct messages</div>
              <div className="member-conversation-list" aria-label="Conversations">
                {conversations.length ? conversations.map((item) => (
                  <button
                    key={item.user.id}
                    type="button"
                    className={activeUserId === item.user.id ? 'active' : 'secondary'}
                    onClick={() => setActiveUser(item.user)}
                  >
                    <span className={item.user.is_online ? 'online-dot' : 'offline-dot'} aria-label={item.user.is_online ? 'Online' : 'Offline'} />
                    <span>
                      <strong>{item.user.username}</strong>
                      <small>{item.mine ? 'You: ' : ''}{item.message}</small>
                    </span>
                    {item.unread_count ? <em>{item.unread_count}</em> : null}
                  </button>
                )) : (
                  <p className="member-empty">No DMs yet. Pick a member below.</p>
                )}
              </div>
            </section>

            <section className="member-search-results" aria-label="Member search results">
              <div className="member-list-label">{recipientUsername.trim() ? 'Search results' : 'Members'}</div>
              {memberResults.length ? memberResults.map((player) => (
                <div className="member-search-result" key={player.id}>
                  <button type="button" className="member-person" disabled={sending} onClick={() => openPlayer(player)}>
                    <span className={player.is_online ? 'online-dot' : 'offline-dot'} aria-label={player.is_online ? 'Online' : 'Offline'} />
                    <span>
                      <strong>{player.username}</strong>
                      <small>{player.is_friend ? 'Friend' : player.request_pending ? 'Pending' : player.is_online ? 'Online' : 'Member'}</small>
                    </span>
                  </button>
                  {!player.is_friend && !player.request_pending ? (
                    <button type="button" className="secondary icon-action" disabled={sending} onClick={() => sendFriendRequest(player)} title="Add friend" aria-label={`Add ${player.username} as a friend`}>
                      <i className="bi bi-person-plus-fill" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              )) : (
                <p className="member-empty">No members found.</p>
              )}
            </section>
          </div>
        </aside>

        <div className="member-thread">
          <div className="member-thread-title">
            <div>
              <strong>{activeUser?.username || 'Select a conversation'}</strong>
              <small>{activeUser ? (activeUser.is_online ? 'Online' : 'Offline') : 'Search members or choose a DM'}</small>
            </div>
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

      {error ? <p className="error member-message-error">{error}</p> : null}
    </section>
  );
}
