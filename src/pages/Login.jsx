import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebaseConfig'; 
import { useAuth } from '../context/AuthContext.jsx'; 

const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();
    
    const { currentUser, currentRole, loading } = useAuth(); 

    // FIX: Redirection logic MUST be inside useEffect
    useEffect(() => {
        if (!loading && currentUser) {
            // CRITICAL FIX: Redirect to the simplified path /admin
            if (currentRole === 'admin' || currentRole === 'staff') {
                navigate('/admin', { replace: true });
            } else if (currentRole === 'customer') {
                navigate('/checkout', { replace: true });
            } else {
                navigate('/', { replace: true });
            }
        }
    }, [loading, currentUser, currentRole, navigate]); 

    // 1. Wait for authentication and role fetch to complete
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="text-gray-600 text-xl font-medium">Loading user data...</div>
            </div>
        );
    }
    
    if (currentUser) {
        return null;
    }

    const handleLogin = async (e) => {
        e.preventDefault();
        setError(''); 

        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
            console.error('Login Error:', err);
            setError(`Login failed. Check credentials.`);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
            <div className="p-10 bg-white rounded-xl shadow-2xl w-full max-w-sm border border-gray-100">
                <h2 className="text-3xl font-light mb-8 text-center text-gray-800">
                    RFID Self-Checkout Sign In
                </h2>
                <form onSubmit={handleLogin}>
                    {error && <p className="text-red-500 mb-4 text-sm font-medium">{error}</p>}
                    
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full p-3 mb-4 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition duration-150"
                        required
                    />
                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full p-3 mb-6 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition duration-150"
                        required
                    />
                    <button
                        type="submit"
                        className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 transition duration-200"
                    >
                        Sign In
                    </button>
                </form>
                <p className="mt-6 text-center text-sm text-gray-500">
                    Need an account? 
                    <span onClick={() => navigate('/register')} className="text-indigo-600 cursor-pointer hover:underline ml-1 font-medium">
                        Register here
                    </span>
                </p>
            </div>
        </div>
    );
};

export default LoginPage;