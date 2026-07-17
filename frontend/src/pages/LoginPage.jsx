import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify(form),
      });

      localStorage.setItem('token', data.access_token);
      localStorage.setItem('username', data.username);
      localStorage.setItem('isAdmin', data.is_admin ? 'true' : 'false');
      localStorage.setItem('isSuperAdmin', data.is_super_admin ? 'true' : 'false');
      localStorage.setItem('isTester', data.is_tester ? 'true' : 'false');
      localStorage.setItem('isXyphoe', data.is_xyphoe ? 'true' : 'false');
      navigate('/library');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page auth-page">
      <div className="card auth-card">
        <BrandMark />
        <div className="auth-heading">
          <h1>Welcome back</h1>
          <p>Sign in to host or join a retro session.</p>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          <input
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
        </form>
        <p className="auth-switch"><Link to="/forgot-password">Forgot your password?</Link></p>
        <p className="auth-switch"><Link to="/resend-verification">Resend verification email</Link></p>
        <p className="auth-switch">Need an account? <Link to="/register">Create one</Link></p>
      </div>
    </div>
  );
}
