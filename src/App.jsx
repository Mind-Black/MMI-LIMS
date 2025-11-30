import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import LoginScreen from './components/LoginScreen';
import DashboardWrapper from './components/DashboardWrapper';
import LoadingSpinner from './components/LoadingSpinner';

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
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
        {!session ? (
          <LoginScreen />
        ) : (
          <DashboardWrapper session={session} onLogout={() => supabase.auth.signOut()} />
        )}
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
