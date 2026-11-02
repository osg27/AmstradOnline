import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch, storeAuthSession } from '../api/client';
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

      storeAuthSession(data);
      navigate('/lobby');
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
        <div className="auth-alt">
          <span>New here?</span>
          <Link className="button-like secondary" to="/register">Create account</Link>
        </div>
      </div>
    </div>
  );
}
