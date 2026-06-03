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
  ['megadrive', 'Mega Drive'],
  ['snes', 'SNES'],
  ['arcade', 'Arcade / MAME'],
];

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
  const isAdmin = localStorage.getItem('isAdmin') === 'true';

  async function loadFeedback() {
    setError('');
    try {
      const data = await apiFetch('/auth/feedback');
      setItems(data || []);
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
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    } catch (err) {
      setError(err.message);
    }
  }

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
            <h2>Recent feedback</h2>
            {loading ? <p className="muted">Loading feedback...</p> : null}
            {!loading && items.length === 0 ? <p className="muted">No feedback logged yet.</p> : null}

            <div className="feedback-list">
              {items.map((item) => (
                <article key={item.id} className="feedback-item">
                  <div className="feedback-item-head">
                    <div>
                      <span className={`feedback-pill ${item.category}`}>{item.category}</span>
                      <span className="feedback-pill">{item.system}</span>
                      <span className={`feedback-pill status-${item.status}`}>{item.status}</span>
                    </div>
                    <small>{formatDate(item.created_at)}</small>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.details}</p>
                  <div className="feedback-item-foot">
                    <span>{item.username}</span>
                    {isAdmin ? (
                      <select value={item.status} onChange={(event) => updateStatus(item.id, event.target.value)}>
                        <option value="open">open</option>
                        <option value="reviewing">reviewing</option>
                        <option value="done">done</option>
                      </select>
                    ) : null}
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
