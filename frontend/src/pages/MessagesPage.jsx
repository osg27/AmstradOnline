import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import MemberMessages from '../components/MemberMessages';
import SocialSidebar from '../components/SocialSidebar';
import '../features/friends/friends.css';

export default function MessagesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [openSignal, setOpenSignal] = useState(0);
  const targetUserId = Number(searchParams.get('user')) || null;

  return (
    <AppShell className="osg-legacy-page">
      <div className="osg-friends-page frd-page">
        <div className="osg-page-head frd-head">
          <span className="osg-eyebrow">Friends</span>
          <h1>Friends &amp; messages</h1>
          <p>Room invites, friend requests, who’s online, and direct messages.</p>
        </div>
        <div className="osg-friends-layout frd-layout">
          <aside className="osg-friends-side frd-side" aria-label="Friends">
            <SocialSidebar onMessagePlayer={(player) => { navigate(`/messages?user=${player.id}`); setOpenSignal((value) => value + 1); }} />
          </aside>
          <section className="card messages-card frd-messages" aria-label="Messages">
            <MemberMessages targetUserId={targetUserId} openSignal={openSignal} layout="page" />
          </section>
        </div>
      </div>
    </AppShell>
  );
}
