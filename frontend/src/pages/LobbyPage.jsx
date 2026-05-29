import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';

export default function LobbyPage() {
  const navigate = useNavigate();
  const username = localStorage.getItem('username');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [loadingJoin, setLoadingJoin] = useState(false);

  async function handleCreate() {
    setError('');
    setLoadingCreate(true);
    try {
      const room = await apiFetch('/rooms/create', { method: 'POST' });
      navigate(`/room/${room.room_code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingCreate(false);
    }
  }

  async function handleJoin() {
    setError('');
    setLoadingJoin(true);
    try {
      const room = await apiFetch('/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ room_code: joinCode.trim().toUpperCase() }),
      });
      navigate(`/room/${room.room_code}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingJoin(false);
    }
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    navigate('/login');
  }

  return (
    <div className="page lobby-page">
      <div className="card lobby-card">
        <div className="lobby-header">
          <BrandMark />
          <div className="account-strip">
            <span>{username}</span>
            <button className="secondary" onClick={() => navigate('/admin')}>Admin</button>
            <button className="secondary" onClick={logout}>Logout</button>
          </div>
        </div>

        <div className="lobby-intro">
          <h1>Play CPC games together</h1>
          <p>Create a room, share the code, and stream the session straight from the browser.</p>
        </div>

        <div className="lobby-actions">
          <div className="panel action-panel">
            <span className="panel-kicker">Host</span>
            <h2>Create room</h2>
            <p>Start a fresh multiplayer session.</p>
            <button onClick={handleCreate} disabled={loadingCreate}>
              {loadingCreate ? 'Creating...' : 'Create room'}
            </button>
          </div>

          <div className="panel action-panel">
            <span className="panel-kicker">Guest</span>
            <h2>Join room</h2>
            <p>Enter the six-character room code.</p>
            <input
              placeholder="Room code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
            <button onClick={handleJoin} disabled={!joinCode || loadingJoin}>
              {loadingJoin ? 'Joining...' : 'Join room'}
            </button>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
