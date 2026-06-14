import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';

function formatDate(value) {
  if (!value) return 'Never';

  return new Date(value).toLocaleString();
}

export default function AdminPage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [savingRoleUserId, setSavingRoleUserId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      try {
        const data = await apiFetch('/auth/admin/stats');
        if (!data?.totals) {
          throw new Error('Admin stats endpoint did not return stats');
        }
        if (!cancelled) {
          setStats(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadStats();
    const timer = window.setInterval(loadStats, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function deleteUser(user) {
    if (!window.confirm(`Delete ${user.username}? Their rooms and feedback will also be deleted.`)) return;

    setError('');
    setDeletingUserId(user.id);
    try {
      await apiFetch(`/auth/admin/users/${user.id}`, { method: 'DELETE' });
      setStats((current) => ({
        ...current,
        totals: {
          ...current.totals,
          users: Math.max(0, current.totals.users - 1),
        },
        recent_users: current.recent_users.filter((item) => item.id !== user.id),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingUserId(null);
    }
  }

  async function updateRole(user, role) {
    setError('');
    setSavingRoleUserId(user.id);
    try {
      const updated = await apiFetch(`/auth/admin/users/${user.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setStats((current) => ({
        ...current,
        recent_users: current.recent_users.map((item) => (
          item.id === user.id ? { ...item, role: updated.role } : item
        )),
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRoleUserId(null);
    }
  }

  return (
    <div className="page admin-page">
      <div className="card admin-card">
        <div className="lobby-header">
          <BrandMark />
          <div className="account-strip">
            <Link className="button-like secondary" to="/lobby">Lobby</Link>
          </div>
        </div>

        <div className="lobby-intro">
          <h1>Admin stats</h1>
          <p>Users, logins, and recent account activity.</p>
        </div>

        {loading ? <p className="muted">Loading stats...</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {stats ? (
          <>
            <div className="admin-stat-grid">
              <div className="panel admin-stat">
                <span>Users</span>
                <strong>{stats.totals.users}</strong>
              </div>
              <div className="panel admin-stat">
                <span>Total logins</span>
                <strong>{stats.totals.logins}</strong>
              </div>
              <div className="panel admin-stat">
                <span>Active today</span>
                <strong>{stats.totals.active_today}</strong>
              </div>
              <div className="panel admin-stat">
                <span>Active week</span>
                <strong>{stats.totals.active_week}</strong>
              </div>
              <div className="panel admin-stat">
                <span>Rooms created</span>
                <strong>{stats.totals.rooms}</strong>
              </div>
            </div>

            {stats.is_super_admin ? (
              <div className="panel admin-users-panel">
                <h2>Live rooms</h2>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th>System</th>
                        <th>Players</th>
                        <th>Game</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.active_rooms?.length ? stats.active_rooms.map((room) => (
                        <tr key={room.room_code}>
                          <td>{room.room_code}</td>
                          <td>{room.system}</td>
                          <td>{room.players.map((player) => `${player.username} (${player.role})`).join(', ')}</td>
                          <td>{room.game_name || 'No game loaded'}</td>
                          <td>{formatDate(room.created_at)}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan="5">No active rooms</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="panel admin-users-panel">
              <h2>Users</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Email</th>
                      <th>Joined</th>
                      <th>Last login</th>
                      <th>Logins</th>
                      <th>Role</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recent_users.map((user) => (
                      <tr key={user.id}>
                        <td>{user.username}</td>
                        <td>{user.email}</td>
                        <td>{formatDate(user.created_at)}</td>
                        <td>{formatDate(user.last_login_at)}</td>
                        <td>{user.login_count}</td>
                        <td>
                          {user.is_super_admin ? <strong>Super admin</strong> : (
                            <select
                              aria-label={`${user.username} role`}
                              value={user.role || 'user'}
                              disabled={savingRoleUserId === user.id || user.username === stats.admin}
                              onChange={(event) => updateRole(user, event.target.value)}
                            >
                              <option value="user">User</option>
                              <option value="tester">Tester</option>
                              <option value="admin">Admin</option>
                            </select>
                          )}
                        </td>
                        <td>
                          <button
                            className="danger"
                            type="button"
                            disabled={deletingUserId === user.id || user.is_super_admin}
                            onClick={() => deleteUser(user)}
                          >
                            {deletingUserId === user.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
