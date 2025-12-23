import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import logo from '../assets/ktu_mmi.svg';
import { useToast } from '../context/ToastContext';

const LoginScreen = () => {
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [jobTitle, setJobTitle] = useState('');
    const [isSignUp, setIsSignUp] = useState(false);
    const [registrationSuccess, setRegistrationSuccess] = useState(false);
    const { showToast } = useToast();

    const handleAuth = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            if (isSignUp) {
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            first_name: firstName,
                            last_name: lastName,
                            job_title: jobTitle
                            // access_level removed for security. Handled by DB default.
                        }
                    }
                });
                if (error) throw error;

                // Check if user already exists (Supabase returns success with empty identities for existing users)
                if (data.user && data.user.identities && data.user.identities.length === 0) {
                    throw new Error('User already exists. Please sign in instead.');
                }

                setRegistrationSuccess(true);
                showToast('Registration successful! Please check your email.', 'success');
            } else {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
            }
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700 p-4">
            <div className="bg-white/95 backdrop-blur-sm p-8 rounded-2xl shadow-2xl w-full max-w-md border border-white/20">
                <div className="text-center mb-8">
                    <div className="bg-white p-4 rounded-full w-24 h-24 mx-auto mb-4 flex items-center justify-center shadow-md">
                        <img src={logo} alt="KTU MMI Logo" className="h-12 w-auto" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-800">MMI-LIMS</h1>
                    <p className="text-gray-500 text-sm mt-2">Institute of Materials Science</p>
                </div>

                {registrationSuccess ? (
                    <div className="text-center space-y-6">
                        <div className="bg-green-50 p-4 rounded-lg border border-green-100">
                            <h3 className="text-xl font-semibold text-green-800 mb-2">Registration Successful!</h3>
                            <p className="text-green-700">
                                Please check your email inbox for a confirmation link to activate your account.
                            </p>
                        </div>
                        <p className="text-gray-600 text-sm">
                            Once confirmed, you will be able to sign in.
                        </p>
                        <button
                            onClick={() => {
                                setRegistrationSuccess(false);
                                setIsSignUp(false);
                                setEmail('');
                                setPassword('');
                                setFirstName('');
                                setLastName('');
                                setJobTitle('');
                            }}
                            className="btn btn-primary w-full"
                        >
                            Back to Sign In
                        </button>
                    </div>
                ) : (
                    <>
                        <form onSubmit={handleAuth} className="space-y-5">
                            {isSignUp && (
                                <>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="label">First Name</label>
                                            <input
                                                type="text"
                                                required
                                                value={firstName}
                                                onChange={(e) => setFirstName(e.target.value)}
                                                className="input-field"
                                                placeholder="John"
                                            />
                                        </div>
                                        <div>
                                            <label className="label">Last Name</label>
                                            <input
                                                type="text"
                                                required
                                                value={lastName}
                                                onChange={(e) => setLastName(e.target.value)}
                                                className="input-field"
                                                placeholder="Doe"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="label">Job Title</label>
                                        <input
                                            type="text"
                                            required
                                            value={jobTitle}
                                            onChange={(e) => setJobTitle(e.target.value)}
                                            className="input-field"
                                            placeholder="Researcher"
                                        />
                                    </div>
                                </>
                            )}
                            <div>
                                <label className="label">Email Address</label>
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="input-field"
                                    placeholder="name@example.com"
                                />
                            </div>
                            <div>
                                <label className="label">Password</label>
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="input-field"
                                    placeholder="••••••••"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="btn btn-primary w-full mt-6"
                            >
                                {loading ? (
                                    <span className="flex items-center justify-center">
                                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Processing...
                                    </span>
                                ) : (isSignUp ? 'Create Account' : 'Sign In')}
                            </button>
                        </form>

                        <div className="mt-6 text-center">
                            <button
                                onClick={() => setIsSignUp(!isSignUp)}
                                className="text-sm text-blue-700 hover:text-blue-900 font-medium transition-colors"
                            >
                                {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
                            </button>
                        </div>
                    </>
                )}

                <div className="mt-8 pt-6 border-t border-gray-100 text-center">
                    <p className="text-xs text-gray-400">Protected by Supabase Auth</p>
                </div>
            </div>
        </div>
    );
};

export default LoginScreen;
