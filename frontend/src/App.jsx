import React, { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { apiFetch, renewSession } from './api/client';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import LobbyPage from './pages/LobbyPage';
const RoomPage = lazy(() => import('./pages/RoomPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
import LocalLibraryPage from './pages/LocalLibraryPage';
const MyLocalGamesPage = lazy(() => import('./pages/MyLocalGamesPage'));
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ResendVerificationPage from './pages/ResendVerificationPage';
const TournamentsPage = lazy(() => import('./pages/TournamentsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const MameAchievementsPreviewPage = lazy(() => import('./pages/MameAchievementsPreviewPage'));
import TournamentNotifications from './components/TournamentNotifications';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');

  useEffect(() => {
    if (!token) return undefined;

    const sendHeartbeat = () => {
      apiFetch('/auth/social/heartbeat', { method: 'POST' }).catch(() => {});
    };
    const renewActiveSession = () => renewSession().catch(() => {});
    sendHeartbeat();
    renewActiveSession();
    const heartbeatTimer = window.setInterval(sendHeartbeat, 30000);
    const renewalTimer = window.setInterval(renewActiveSession, 30 * 60 * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') renewActiveSession();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(heartbeatTimer);
      window.clearInterval(renewalTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [token]);

  return token ? (
    <>
      {children}
      <TournamentNotifications />
    </>
  ) : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="osg-route-loading" role="status" aria-label="Loading" />}>
    <Routes>
      <Route path="/experiments/mame-retroachievements" element={<PrivateRoute><MameAchievementsPreviewPage /></PrivateRoute>} />
      <Route path="/" element={localStorage.getItem('token') ? <Navigate to="/lobby" replace /> : <LandingPage />} />
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
        path="/room/:roomCode"
        element={(
          <PrivateRoute>
            <RoomPage />
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
    </Suspense>
  );
}
