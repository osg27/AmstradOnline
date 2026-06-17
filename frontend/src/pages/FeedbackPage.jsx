import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';

const SYSTEM_OPTIONS = [
  ['general', 'General'],
  ['cpc', 'Amstrad CPC'],
  ['cpc_party', 'Amstrad Party'],
  ['spectrum', 'ZX Spectrum'],
  ['amiga', 'Amiga'],
  ['amiga_aga', 'Amiga AGA'],
  ['megadrive', 'Mega Drive'],
  ['snes', 'SNES'],
  ['pcengine', 'PC Engine / TurboGrafx-16'],
  ['playstation', 'Sony PlayStation'],
  ['dreamcast', 'Sega Dreamcast'],
  ['arcade', 'Arcade / MAME'],
];

const STATUS_OPTIONS = [
  ['unstarted', 'Unstarted'],
  ['in_review', 'In review'],
  ['resolved', 'Resolved'],
  ['archived', 'Archived'],
];

function statusLabel(value) {
  return STATUS_OPTIONS.find(([status]) => status === value)?.[1] || value;
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

export default function FeedbackPage() {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState('bug');
  const [system, setSystem] = useState('general');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [commentDrafts, setCommentDrafts] = useState({});
  const [commentingId, setCommentingId] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const isAdmin = localStorage.getItem('isAdmin') === 'true';

  async function loadFeedback() {
    setError('');
    try {
      const data = await apiFetch('/auth/feedback');
      setItems(data || []);
      const notificationData = await apiFetch('/auth/feedback/notifications');
      setNotifications(notificationData || []);
      if (notificationData?.some((notification) => !notification.is_read)) {
        await apiFetch('/auth/feedback/notifications/read', { method: 'PATCH' });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFeedback();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const created = await apiFetch('/auth/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category,
          system,
          title,
          details,
        }),
      });
      setItems((current) => [created, ...current]);
      setTitle('');
      setDetails('');
      setSuccess('Thanks, logged.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id, status) {
    setError('');
    try {
      const updated = await apiFetch(`/auth/feedback/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setItems((current) => current.map((item) => (
        item.id === id ? { ...updated, comments: item.comments || [] } : item
      )));
    } catch (err) {
      setError(err.message);
    }
  }

  async function addComment(event, id) {
    event.preventDefault();
    const details = commentDrafts[id]?.trim();
    if (!details) return;

    setError('');
    setCommentingId(id);
    try {
      const comment = await apiFetch(`/auth/feedback/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ details }),
      });
      setItems((current) => current.map((item) => (
        item.id === id ? { ...item, comments: [...(item.comments || []), comment] } : item
      )));
      setCommentDrafts((current) => ({ ...current, [id]: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setCommentingId(null);
    }
  }

  async function deleteFeedback(id) {
    if (!window.confirm('Permanently delete this feedback and all its replies?')) return;

    setError('');
    try {
      await apiFetch(`/auth/feedback/${id}`, { method: 'DELETE' });
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  const filteredItems = items.filter((item) => {
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'active' && item.status !== 'archived')
      || item.status === statusFilter;
    return matchesCategory && matchesStatus;
  });

  return (
    <div className="page feedback-page">
      <div className="card feedback-card">
        <div className="lobby-header">
          <BrandMark />
          <div className="account-strip">
            <Link className="button-like secondary" to="/lobby">Lobby</Link>
          </div>
        </div>

        <div className="lobby-intro">
          <h1>Tester feedback</h1>
          <p>Log bugs and suggestions from test sessions.</p>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}

        {notifications.length > 0 ? (
          <div className="panel feedback-notifications">
            <h2>Notifications</h2>
            {notifications.slice(0, 8).map((notification) => (
              <button
                type="button"
                className={notification.is_read ? 'secondary' : ''}
                key={notification.id}
                onClick={() => {
                  setStatusFilter('all');
                  window.setTimeout(() => {
                    document.getElementById(`feedback-${notification.feedback_id}`)?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center',
                    });
                  }, 0);
                }}
              >
                <span>{notification.message}</span>
                <small>{formatDate(notification.created_at)}</small>
              </button>
            ))}
          </div>
        ) : null}

        <div className="feedback-layout">
          <form className="panel feedback-form" onSubmit={handleSubmit}>
            <div className="feedback-row">
              <label>
                <span>Type</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="bug">Bug</option>
                  <option value="suggestion">Suggestion</option>
                </select>
              </label>

              <label>
                <span>System</span>
                <select value={system} onChange={(event) => setSystem(event.target.value)}>
                  {SYSTEM_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              <span>Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Short summary"
                maxLength={140}
                required
              />
            </label>

            <label>
              <span>Details</span>
              <textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                placeholder="What happened? What did you expect?"
                rows={8}
                required
              />
            </label>

            <button type="submit" disabled={saving || title.trim().length < 3 || details.trim().length < 5}>
              {saving ? 'Logging...' : 'Log feedback'}
            </button>
          </form>

          <div className="panel feedback-list-panel">
            <div className="feedback-list-toolbar">
              <h2>Feedback</h2>
              <div className="feedback-filters">
                <label>
                  <span>Type</span>
                  <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                    <option value="all">All types</option>
                    <option value="bug">Bugs</option>
                    <option value="suggestion">Suggestions</option>
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="active">Active</option>
                    <option value="all">All statuses</option>
                    {STATUS_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {loading ? <p className="muted">Loading feedback...</p> : null}
            {!loading && filteredItems.length === 0 ? <p className="muted">No feedback matches these filters.</p> : null}

            <div className="feedback-list">
              {filteredItems.map((item) => (
                <article id={`feedback-${item.id}`} key={item.id} className="feedback-item">
                  <div className="feedback-item-head">
                    <div>
                      <span className={`feedback-pill ${item.category}`}>{item.category}</span>
                      <span className="feedback-pill">{item.system}</span>
                      <span className={`feedback-pill status-${item.status}`}>{statusLabel(item.status)}</span>
                    </div>
                    <small>{formatDate(item.created_at)}</small>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.details}</p>
                  <div className="feedback-item-foot">
                    <span>{item.username}</span>
                    {isAdmin ? (
                      <div className="feedback-admin-actions">
                        <select value={item.status} onChange={(event) => updateStatus(item.id, event.target.value)}>
                          {STATUS_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                        {item.status !== 'archived' ? (
                          <button className="secondary" type="button" onClick={() => updateStatus(item.id, 'archived')}>
                            Archive
                          </button>
                        ) : (
                          <button className="secondary" type="button" onClick={() => updateStatus(item.id, 'unstarted')}>
                            Restore
                          </button>
                        )}
                        <button className="danger" type="button" onClick={() => deleteFeedback(item.id)}>Delete</button>
                      </div>
                    ) : null}
                  </div>

                  <div className="feedback-comments">
                    {(item.comments || []).map((comment) => (
                      <div className="feedback-comment" key={comment.id}>
                        <div>
                          <strong>{comment.username}</strong>
                          <small>{formatDate(comment.created_at)}</small>
                        </div>
                        <p>{comment.details}</p>
                      </div>
                    ))}
                    <form className="feedback-comment-form" onSubmit={(event) => addComment(event, item.id)}>
                      <input
                        value={commentDrafts[item.id] || ''}
                        onChange={(event) => setCommentDrafts((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))}
                        placeholder="Reply to this feedback"
                        maxLength={2000}
                      />
                      <button type="submit" disabled={commentingId === item.id || !commentDrafts[item.id]?.trim()}>
                        {commentingId === item.id ? 'Posting...' : 'Reply'}
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
