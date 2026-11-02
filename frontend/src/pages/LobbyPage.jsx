import React, { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { apiFetch } from '../api/client';
import { getLocalLibrarySetting } from '../localLibraryDb';
import LocalLibraryPage from './LocalLibraryPage';
import PlayHome from '../features/home/PlayHome';

/**
 * Signed-in home ("Play"). First visit runs the library onboarding; after that it
 * shows the Play home. Room creation and launching live in features/home and reuse
 * the old lobby's request bodies and the Library's launch helper.
 */
// Once setup is done it stays done, so return visits skip the "Loading your library…" step.
let setupKnownComplete = false;

export default function LobbyPage() {
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem('isAdmin') === 'true');
  const [isSuperAdmin, setIsSuperAdmin] = useState(localStorage.getItem('isSuperAdmin') === 'true');
  const [librarySetupComplete, setLibrarySetupComplete] = useState(() => (setupKnownComplete ? true : null));
  const roles = useMemo(() => ({ isAdmin, isSuperAdmin }), [isAdmin, isSuperAdmin]);

  useEffect(() => {
    if (setupKnownComplete) return;
    async function loadLibrarySetup() {
      // If the browser's library store doesn't answer, show the Play home rather than spinning forever.
      const timeout = new Promise((resolve) => { window.setTimeout(() => resolve(true), 4000); });
      try {
        const complete = await Promise.race([getLocalLibrarySetting('librarySetupComplete', false), timeout]);
        if (complete) setupKnownComplete = true;
        setLibrarySetupComplete(Boolean(complete));
      } catch {
        setLibrarySetupComplete(false);
      }
    }
    loadLibrarySetup();
  }, []);

  useEffect(() => {
    async function loadSession() {
      try {
        const session = await apiFetch('/auth/me');
        const nextIsAdmin = Boolean(session.is_admin);
        const nextIsSuperAdmin = Boolean(session.is_super_admin);
        const nextIsTester = Boolean(session.is_tester);
        setIsAdmin(nextIsAdmin);
        setIsSuperAdmin(nextIsSuperAdmin);
        localStorage.setItem('isAdmin', nextIsAdmin ? 'true' : 'false');
        localStorage.setItem('isSuperAdmin', nextIsSuperAdmin ? 'true' : 'false');
        localStorage.setItem('isTester', nextIsTester ? 'true' : 'false');
        localStorage.removeItem('isVip');
        localStorage.removeItem('isXyphoe');
        window.dispatchEvent(new CustomEvent('osg-session-roles-changed'));
      } catch {
        setIsAdmin(false);
        setIsSuperAdmin(false);
        localStorage.removeItem('isAdmin');
        localStorage.removeItem('isSuperAdmin');
        localStorage.removeItem('isTester');
        localStorage.removeItem('isVip');
        localStorage.removeItem('isXyphoe');
        window.dispatchEvent(new CustomEvent('osg-session-roles-changed'));
      }
    }
    loadSession();
  }, []);

  if (librarySetupComplete === false) {
    return (
      <AppShell className="osg-legacy-page osg-onboarding">
        <div className="page local-library-page welcome-home-page">
          <LocalLibraryPage embedded onboarding onComplete={() => { setupKnownComplete = true; setLibrarySetupComplete(true); }} />
        </div>
      </AppShell>
    );
  }

  if (librarySetupComplete === null) {
    return (
      <AppShell>
        <p className="osg-page-loading" role="status">Loading your library…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PlayHome roles={roles} />
    </AppShell>
  );
}
