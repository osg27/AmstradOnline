import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';

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
        <div className="row spread center-gap">
          <div>
            <h1>Amstrad Multiplayer</h1>
            <p>Logged in as <strong>{username}</strong></p>
          </div>
          <button className="secondary" onClick={logout}>Logout</button>
        </div>

        <div className="lobby-actions">
          <div className="panel">
            <h2>Create Room</h2>
            <p>Start a new host-controlled session.</p>
            <button onClick={handleCreate} disabled={loadingCreate}>
              {loadingCreate ? 'Creating...' : 'Create room'}
            </button>
          </div>

          <div className="panel">
            <h2>Join Room</h2>
            <p>Enter a room code to join an existing session.</p>
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
