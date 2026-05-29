import React, { useEffect, useState } from 'react';
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
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem('isAdmin') === 'true');
  const [selectedSystem, setSelectedSystem] = useState('cpc');

  useEffect(() => {
    async function loadSession() {
      try {
        const session = await apiFetch('/auth/me');
        const nextIsAdmin = Boolean(session.is_admin);

        setIsAdmin(nextIsAdmin);
        localStorage.setItem('isAdmin', nextIsAdmin ? 'true' : 'false');
      } catch {
        setIsAdmin(false);
        localStorage.removeItem('isAdmin');
      }
    }

    loadSession();
  }, []);

  async function handleCreate() {
    setError('');
    setLoadingCreate(true);
    try {
      const room = await apiFetch('/rooms/create', {
        method: 'POST',
        body: JSON.stringify({ system: selectedSystem }),
      });
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
    localStorage.removeItem('isAdmin');
    navigate('/login');
  }

  return (
    <div className="page lobby-page">
      <div className="card lobby-card">
        <div className="lobby-header">
          <BrandMark />
          <div className="account-strip">
            <span>{username}</span>
            {isAdmin ? (
              <button className="secondary" onClick={() => navigate('/admin')}>Admin</button>
            ) : null}
            <button className="secondary" onClick={logout}>Logout</button>
          </div>
        </div>

        <div className="lobby-intro">
          <h1>Because Retro Games Are Better With Mates</h1>
          <p>Create a room, pick a system, and stream the session straight from the browser.</p>
        </div>

        <div className="lobby-actions">
          <div className="panel action-panel">
            <span className="panel-kicker">Host</span>
            <h2>Create room</h2>
            <p>Start a fresh multiplayer session.</p>
            <div className="system-picker" aria-label="System">
              <button
                type="button"
                className={selectedSystem === 'cpc' ? 'active' : 'secondary'}
                onClick={() => setSelectedSystem('cpc')}
              >
                Amstrad CPC
              </button>
              <button
                type="button"
                className={selectedSystem === 'spectrum' ? 'active' : 'secondary'}
                onClick={() => setSelectedSystem('spectrum')}
              >
                ZX Spectrum
              </button>
            </div>
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
