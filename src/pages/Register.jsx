import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore'; // For Firestore operations
import { auth, db } from '../firebaseConfig'; // Import your initialized services

const RegisterPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleRegister = async (e) => {
        e.preventDefault();
        setError(''); // Clear previous errors

        try {
            // STEP 1: Create user in Firebase Authentication
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // STEP 2: Add user profile and default role to Firestore 'users' collection
            await setDoc(doc(db, 'users', user.uid), {
                uid: user.uid,
                email: user.email,
                fullName: fullName,
                role: 'customer', // Default role for a self-registered user
                registeredAt: new Date().toISOString(),
            });

            console.log('User Registered Successfully and profile created in Firestore.');
            navigate('/login'); // Redirect to login page after successful registration

        } catch (err) {
            console.error('Registration Error:', err);
            // Display a user-friendly error message
            setError(`Registration failed. Error: ${err.message}`);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
            <div className="p-10 bg-white rounded-xl shadow-2xl w-full max-w-sm border border-gray-100">
                <h2 className="text-3xl font-light mb-8 text-center text-gray-800">
                    Create Retail Account
                </h2>
                <form onSubmit={handleRegister}>
                    {error && <p className="text-red-500 mb-4 text-sm font-medium">{error}</p>}
                    
                    {/* Full Name Input (Minimalist Style) */}
                    <input
                        type="text"
                        placeholder="Full Name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full p-3 mb-4 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition duration-150"
                        required
                    />
                    {/* Email Input (Minimalist Style) */}
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full p-3 mb-4 border border-gray-300 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition duration-150"
                        required
                    />
                    {/* Password Input (Minimalist Style) */}
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
                        Register
                    </button>
                </form>
                <p className="mt-6 text-center text-sm text-gray-500">
                    Already have an account? 
                    <span onClick={() => navigate('/login')} className="text-indigo-600 cursor-pointer hover:underline ml-1 font-medium">
                        Login here
                    </span>
                </p>
            </div>
        </div>
    );
};

export default RegisterPage;