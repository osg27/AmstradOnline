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

  useEffect(() => {
    async function loadStats() {
      try {
        const data = await apiFetch('/auth/admin/stats');
        if (!data?.totals) {
          throw new Error('Admin stats endpoint did not return stats');
        }
        setStats(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, []);

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

            <div className="panel admin-users-panel">
              <h2>Recent users</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Email</th>
                      <th>Joined</th>
                      <th>Last login</th>
                      <th>Logins</th>
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
