import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import LobbyPage from './pages/LobbyPage';
import RoomPage from './pages/RoomPage';
import AdminPage from './pages/AdminPage';
import FeedbackPage from './pages/FeedbackPage';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/lobby" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/lobby"
        element={(
          <PrivateRoute>
            <LobbyPage />
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
    </Routes>
  );
}
