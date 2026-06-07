import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import BrandMark from '../components/BrandMark';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const [message, setMessage] = useState('Verifying your email...');
  const [error, setError] = useState('');

  useEffect(() => {
    async function verify() {
      const token = searchParams.get('token');
      if (!token) {
        setMessage('');
        setError('Verification link is missing its token');
        return;
      }
      try {
        const data = await apiFetch('/auth/verify-email', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
        setMessage(data.message);
      } catch (err) {
        setMessage('');
        setError(err.message);
      }
    }
    verify();
  }, [searchParams]);

  return (
    <div className="page auth-page">
      <div className="card auth-card">
        <BrandMark />
        <div className="auth-heading">
          <h1>Email verification</h1>
        </div>
        {message ? <p className="success">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}
        <Link className="button-like" to="/login">Back to sign in</Link>
      </div>
    </div>
  );
}
