import ErrorBoundary from './components/ErrorBoundary';
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { supabase } from './supabaseClient';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import LoginScreen from './components/LoginScreen';
import LoadingSpinner from './components/LoadingSpinner';
const DashboardWrapper = lazy(() => import('./components/DashboardWrapper'));

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => window.location.hash.includes('type=recovery'));
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') || '');

  const clearInviteToken = () => {
    setInviteToken('');
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <ErrorBoundary><ThemeProvider>
      <ToastProvider>
        {!session || isPasswordRecovery || inviteToken ? (
          <LoginScreen
            isPasswordRecovery={isPasswordRecovery}
            onRecoveryComplete={() => setIsPasswordRecovery(false)}
            inviteToken={inviteToken}
            onInviteComplete={clearInviteToken}
          />
        ) : (
          <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900"><LoadingSpinner /></div>}>
            <DashboardWrapper session={session} onLogout={() => supabase.auth.signOut()} />
          </Suspense>
        )}
      </ToastProvider>
    </ThemeProvider></ErrorBoundary>
  );
}

export default App;
