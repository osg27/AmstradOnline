import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import MemberMessages from '../components/MemberMessages';

export default function MessagesPage() {
  const [searchParams] = useSearchParams();
  const targetUserId = Number(searchParams.get('user')) || null;

  return (
    <div className="page messages-page">
      <div className="card messages-card">
        <div className="lobby-header">
          <BrandMark compact />
          <div className="room-actions">
            <Link className="button-like secondary" to="/lobby">Lobby</Link>
          </div>
        </div>

        <div className="lobby-intro">
          <h1>Messages</h1>
          <p>Direct member-to-member messages.</p>
        </div>

        <MemberMessages targetUserId={targetUserId} layout="page" />
      </div>
    </div>
  );
}
