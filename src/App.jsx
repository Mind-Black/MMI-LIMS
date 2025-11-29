import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { ToastProvider } from './context/ToastContext';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';

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
    return <div className="flex items-center justify-center h-screen bg-gray-100">Loading...</div>;
  }

  return (
    <ToastProvider>
      {!session ? (
        <LoginScreen />
      ) : (
        <Dashboard
          user={session.user}
          onLogout={() => supabase.auth.signOut()}
        />
      )}
    </ToastProvider>
  );
}

export default App;
