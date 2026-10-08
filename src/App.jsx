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
    <ThemeProvider>
      <ToastProvider>
        {!session || isPasswordRecovery ? (
          <LoginScreen isPasswordRecovery={isPasswordRecovery} onRecoveryComplete={() => setIsPasswordRecovery(false)} />
        ) : (
          <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900"><LoadingSpinner /></div>}>
            <DashboardWrapper session={session} onLogout={() => supabase.auth.signOut()} />
          </Suspense>
        )}
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
