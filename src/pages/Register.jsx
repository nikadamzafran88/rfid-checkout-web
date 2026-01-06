import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore'; // For Firestore operations
import { auth, db } from '../firebaseConfig'; // Import your initialized services
import { Paper, Box, Typography, TextField, Button, Alert, CircularProgress } from '@mui/material';

const RegisterPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();

    const handleRegister = async (e) => {
        e.preventDefault();
        setError(''); // Clear previous errors
        setSubmitting(true);

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
            // newly created users are automatically signed in by Firebase.
            // Sign them out so the login page doesn't auto-redirect based on currentUser.
            await signOut(auth);
            navigate('/login'); // Redirect to login page after successful registration

        } catch (err) {
            console.error('Registration Error:', err);
            // Display a user-friendly error message
            setError(err?.message || 'Registration failed.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Box sx={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
            <Paper elevation={3} sx={{ width: '100%', maxWidth: 460, p: 4, borderRadius: 2 }}>
                <Box sx={{ textAlign: 'center', mb: 2 }}>
                    <Typography variant="h5" component="h1" gutterBottom>
                        Create Retail Account
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Create an account to start using the self-checkout.
                    </Typography>
                </Box>

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <Box component="form" onSubmit={handleRegister} noValidate>
                    <TextField
                        margin="normal"
                        label="Full name"
                        type="text"
                        required
                        fullWidth
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                    />

                    <TextField
                        margin="normal"
                        label="Email"
                        type="email"
                        required
                        fullWidth
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />

                    <TextField
                        margin="normal"
                        label="Password"
                        type="password"
                        required
                        fullWidth
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />

                    <Button
                        type="submit"
                        variant="contained"
                        color="primary"
                        fullWidth
                        sx={{ mt: 2 }}
                        disabled={submitting}
                    >
                        {submitting ? <CircularProgress size={20} /> : 'Register'}
                    </Button>
                </Box>

                <Box sx={{ mt: 2, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                        Already have an account?{' '}
                        <Box component="span" onClick={() => navigate('/login')} sx={{ color: 'primary.main', cursor: 'pointer', ml: 0.5 }}>
                            Login here
                        </Box>
                    </Typography>
                </Box>
            </Paper>
        </Box>
    );
};

export default RegisterPage;