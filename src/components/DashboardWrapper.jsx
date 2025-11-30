import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import Dashboard from './Dashboard';

const DashboardWrapper = ({ session, onLogout }) => {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchProfile = async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .single();

            if (error) {
                console.error('Error fetching profile:', error);
            } else {
                setProfile(data);
            }
            setLoading(false);
        };

        fetchProfile();
    }, [session]);

    if (loading) {
        return <div className="flex items-center justify-center h-screen bg-gray-100">Loading profile...</div>;
    }

    if (profile && !profile.is_approved) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <div className="bg-white p-8 rounded-lg shadow-xl max-w-md text-center border-t-4 border-yellow-500">
                    <div className="mb-4">
                        <i className="fas fa-clock text-5xl text-yellow-500"></i>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Account Pending Approval</h2>
                    <p className="text-gray-600 mb-6">
                        Your account has been created but requires administrator approval before you can access the system.
                        Please check back later or contact the lab manager.
                    </p>
                    <button
                        onClick={onLogout}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition"
                    >
                        Sign Out
                    </button>
                </div>
            </div>
        );
    }

    return <Dashboard user={session.user} profile={profile} onLogout={onLogout} />;
};

export default DashboardWrapper;
