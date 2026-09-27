import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import Dashboard from './Dashboard';
import LoadingSpinner from './LoadingSpinner';

const DashboardWrapper = ({ session, onLogout }) => {
    const [profile, setProfile] = useState(null);
    const [status, setStatus] = useState('loading'); // 'loading' | 'error' | 'pending' | 'ready'
    const [errorMessage, setErrorMessage] = useState('');
    const [refreshIndex, setRefreshIndex] = useState(0);

    const userId = session?.user?.id;

    const handleRefresh = () => {
        setStatus('loading');
        setRefreshIndex(prev => prev + 1);
    };

    useEffect(() => {
        if (!userId) {
            return;
        }

        let isCancelled = false;

        const loadProfile = async () => {
            try {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('id, first_name, last_name, job_title, access_level, is_approved, licenses, projects')
                    .eq('id', userId)
                    .single();

                if (isCancelled) return;

                if (error) {
                    console.error('Error fetching profile:', error);
                    setStatus('error');
                    setErrorMessage(error.message || 'Failed to load user profile.');
                    return;
                }

                if (!data) {
                    setStatus('error');
                    setErrorMessage('User profile does not exist. Please contact laboratory management.');
                    return;
                }

                setProfile(data);
                setStatus(data.is_approved ? 'ready' : 'pending');
            } catch (err) {
                if (isCancelled) return;
                console.error('Unexpected error loading profile:', err);
                setStatus('error');
                setErrorMessage(err.message || 'Network error loading profile.');
            }
        };

        loadProfile();

        return () => {
            isCancelled = true;
        };
    }, [userId, refreshIndex]);

    if (!session?.user?.id) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4 transition-colors">
                <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-xl max-w-md w-full text-center">
                    <p className="text-gray-600 dark:text-gray-300">No active session found.</p>
                    <button onClick={onLogout} className="mt-4 btn btn-primary">Sign In</button>
                </div>
            </div>
        );
    }

    if (status === 'loading') {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900 transition-colors">
                <LoadingSpinner />
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4 transition-colors">
                <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-xl max-w-md w-full text-center border-t-4 border-red-500">
                    <div className="mb-4">
                        <i className="fas fa-exclamation-triangle text-5xl text-red-500"></i>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Unable to Load Account</h2>
                    <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">
                        {errorMessage || 'An error occurred while loading your profile data.'}
                    </p>
                    <div className="flex justify-center gap-3">
                        <button
                            onClick={handleRefresh}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
                        >
                            Retry
                        </button>
                        <button
                            onClick={onLogout}
                            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded transition"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (status === 'pending' || (profile && !profile.is_approved)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 p-4 transition-colors">
                <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-xl max-w-md w-full text-center border-t-4 border-yellow-500">
                    <div className="mb-4">
                        <i className="fas fa-clock text-5xl text-yellow-500 animate-pulse"></i>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Account Pending Approval</h2>
                    <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">
                        Welcome, <strong>{profile?.first_name ? `${profile.first_name} ${profile.last_name}` : session.user.email}</strong>.
                        Your account requires administrator approval before you can access laboratory equipment bookings.
                        Please contact the lab manager.
                    </p>
                    <div className="flex justify-center gap-3">
                        <button
                            onClick={handleRefresh}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition"
                        >
                            Check Status
                        </button>
                        <button
                            onClick={onLogout}
                            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded transition"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <Dashboard
            user={session.user}
            profile={profile}
            onLogout={onLogout}
            onProfileRefresh={handleRefresh}
        />
    );
};

export default DashboardWrapper;
