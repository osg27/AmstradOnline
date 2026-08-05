import React, { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { apiFetch } from './api/client';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import LobbyPage from './pages/LobbyPage';
import RoomPage from './pages/RoomPage';
import AdminPage from './pages/AdminPage';
import FeedbackPage from './pages/FeedbackPage';
import MessagesPage from './pages/MessagesPage';
import LocalLibraryPage from './pages/LocalLibraryPage';
import MyLocalGamesPage from './pages/MyLocalGamesPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ResendVerificationPage from './pages/ResendVerificationPage';
import TournamentsPage from './pages/TournamentsPage';
import ProfilePage from './pages/ProfilePage';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');

  useEffect(() => {
    if (!token) return undefined;

    const sendHeartbeat = () => {
      apiFetch('/auth/social/heartbeat', { method: 'POST' }).catch(() => {});
    };
    sendHeartbeat();
    const heartbeatTimer = window.setInterval(sendHeartbeat, 30000);
    return () => window.clearInterval(heartbeatTimer);
  }, [token]);

  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/lobby" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/resend-verification" element={<ResendVerificationPage />} />
      <Route
        path="/lobby"
        element={(
          <PrivateRoute>
            <LobbyPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/library"
        element={(
          <PrivateRoute>
            <LocalLibraryPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/my-local-games"
        element={(
          <PrivateRoute>
            <MyLocalGamesPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/profile"
        element={(
          <PrivateRoute>
            <ProfilePage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/tournaments"
        element={(
          <PrivateRoute>
            <TournamentsPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/tournaments/:code"
        element={(
          <PrivateRoute>
            <TournamentsPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/room/:roomCode"
        element={(
          <PrivateRoute>
            <RoomPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/admin"
        element={(
          <PrivateRoute>
            <AdminPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/feedback"
        element={(
          <PrivateRoute>
            <FeedbackPage />
          </PrivateRoute>
        )}
      />
      <Route
        path="/messages"
        element={(
          <PrivateRoute>
            <MessagesPage />
          </PrivateRoute>
        )}
      />
    </Routes>
  );
}
