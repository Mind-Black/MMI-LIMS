import ErrorBoundary from './components/ErrorBoundary';
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { supabase } from './supabaseClient';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import LoginScreen from './components/LoginScreen';
import LoadingSpinner from './components/LoadingSpinner';
const DashboardWrapper = lazy(() => import('./components/DashboardWrapper'));

function readAuthRedirectError() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(window.location.search);

  const hasAuthError =
    hashParams.has('error_description') ||
    hashParams.has('error_code') ||
    hashParams.has('error') ||
    searchParams.has('error_description') ||
    searchParams.has('error_code');

  if (!hasAuthError) return '';

  return (
    hashParams.get('error_description') ||
    searchParams.get('error_description') ||
    hashParams.get('error') ||
    searchParams.get('error') ||
    ''
  );
}

function clearAuthErrorFromUrl() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const searchParams = new URLSearchParams(window.location.search);
  const keys = ['error', 'error_code', 'error_description'];

  const hasAny = keys.some((key) => hashParams.has(key) || searchParams.has(key));
  if (!hasAny) return;

  for (const key of keys) {
    hashParams.delete(key);
    searchParams.delete(key);
  }

  const nextSearch = searchParams.toString();
  const nextHash = hashParams.toString();
  const nextUrl =
    window.location.pathname +
    (nextSearch ? `?${nextSearch}` : '') +
    (nextHash ? `#${nextHash}` : '');
  window.history.replaceState({}, '', nextUrl);
}

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => window.location.hash.includes('type=recovery'));
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(window.location.search).get('invite') || '');
  const [authError, setAuthError] = useState(readAuthRedirectError);

  const clearInviteToken = () => {
    setInviteToken('');
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  };

  useEffect(() => {
    clearAuthErrorFromUrl();

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      setSession(session);
      if (error && !readAuthRedirectError()) {
        setAuthError((prev) => prev || error.message);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setLoading(false);
      if (session) setAuthError('');
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-dvh bg-gray-100">
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
            authError={authError}
            onDismissAuthError={() => setAuthError('')}
          />
        ) : (
          <Suspense fallback={<div className="flex items-center justify-center h-dvh bg-gray-100 dark:bg-gray-900"><LoadingSpinner /></div>}>
            <DashboardWrapper session={session} onLogout={() => supabase.auth.signOut()} />
          </Suspense>
        )}
      </ToastProvider>
    </ThemeProvider></ErrorBoundary>
  );
}

export default App;
