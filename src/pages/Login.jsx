import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { useAuth } from '../context/AuthContext.jsx';
import { Paper, Box, Typography, TextField, Button, Alert, CircularProgress, Divider } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const navigate = useNavigate();

    const theme = useTheme();

    const location = useLocation();

    const { currentUser, currentRole, loading, blockedUntilMs, logout } = useAuth();

    const formatUntil = (ms) => {
        if (!ms) return '';
        try {
            return new Date(ms).toLocaleString('en-MY', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    };

    useEffect(() => {
        // If redirected here due to a block, show the message once.
        const until = location?.state?.blockedUntilMs;
        if (until && until > Date.now()) {
            setError(`Your account is temporarily blocked until ${formatUntil(until)}.`);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        console.debug('[Login] useEffect auth values -> loading:', loading, 'currentUser:', currentUser, 'currentRole:', currentRole);
            // Only proceed after loading completes and a currentUser exists
            if (!loading && currentUser) {
                // If temporarily blocked, force sign-out and show message.
                if (blockedUntilMs && blockedUntilMs > Date.now()) {
                    const msg = `Your account is temporarily blocked until ${formatUntil(blockedUntilMs)}.`;
                    console.warn('[Login] blocked account detected; signing out');
                    setError(msg);
                    try { logout(); } catch { /* ignore */ }
                    return;
                }

                // If role hasn't been determined yet, wait (avoid premature redirect)
                if (currentRole === null || currentRole === undefined) {
                    console.warn('[Login] role not yet loaded; waiting for role resolution');
                    return
                }

                const role = (currentRole || '').toString().toLowerCase();

                // Standard routing for known roles
                if (role === 'admin' || role === 'staff' || role === 'manager') {
                    console.debug('[Login] redirecting to /admin');
                    navigate('/admin', { replace: true });
                    return
                }
                if (role === 'customer') {
                    console.debug('[Login] redirecting to /checkout');
                    navigate('/checkout', { replace: true });
                    return
                }

                // If we reach here, role lookup failed or returned an unexpected value.
                // Don't redirect to `/` (kiosk) by default — surface an error so the
                // administrator can investigate their Firestore `users/{uid}` document
                // or security rules. This prevents accidental redirection into kiosk mode.
                console.error('[Login] Unknown or missing role for user; not redirecting. currentRole=', currentRole);
                setError('Unable to determine your account role. Contact the system administrator.');
            }
    }, [loading, currentUser, currentRole, blockedUntilMs, navigate, logout]);

    if (loading) {
        return (
            <Box
                sx={{
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <CircularProgress />
            </Box>
        );
    }

    // If a user is already signed in (but we're not loading), show a spinner while navigation occurs.
    // Returning `null` produced a white screen in some environments; a visible spinner helps debugging.
    if (currentUser) {
        return (
            <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);

        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
            console.error('Login Error:', err);
            setError('Login failed. Check credentials.');
        } finally {
            setSubmitting(false);
        }
    };

    // Kiosk station login moved to dedicated page `/station-login`

    return (
        <Box
            sx={{
                position: 'fixed',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                px: 2,
                backgroundColor: 'background.default',
                backgroundImage: `radial-gradient(900px circle at 15% 10%, ${alpha(theme.palette.primary.main, 0.16)}, transparent 55%), radial-gradient(900px circle at 85% 20%, ${alpha(theme.palette.primary.main, 0.10)}, transparent 50%)`,
            }}
        >
            <Paper
                elevation={3}
                sx={{
                    width: '100%',
                    maxWidth: 920,
                    borderRadius: 3,
                    overflow: 'hidden',
                    border: `1px solid ${alpha(theme.palette.text.primary, 0.10)}`,
                }}
            >
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.05fr 1fr' } }}>
                    <Box
                        sx={{
                            display: { xs: 'none', md: 'flex' },
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            p: 4,
                            backgroundColor: alpha(theme.palette.primary.main, 0.06),
                        }}
                    >
                        <Box>
                            <Typography variant="overline" sx={{ letterSpacing: 1.2, fontWeight: 800 }} color="text.secondary">
                                Admin Panel
                            </Typography>
                            <Typography variant="h4" sx={{ fontWeight: 900, mt: 0.5, lineHeight: 1.1 }}>
                                RFID Self-Checkout
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 340 }}>
                                Sign in to manage inventory, products, users, and view financial reports.
                            </Typography>
                        </Box>

                        <Box>
                            <Divider sx={{ mb: 1.5, borderColor: alpha(theme.palette.text.primary, 0.10) }} />
                            <Typography variant="caption" color="text.secondary">
                                Tip: Use “Station Check-in” for kiosk devices.
                            </Typography>
                        </Box>
                    </Box>

                    <Box sx={{ p: { xs: 3, sm: 4 } }}>
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="h5" component="h1" sx={{ fontWeight: 900 }}>
                                Sign in
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                                Continue to the admin panel
                            </Typography>
                        </Box>

                        {error && (
                            <Alert severity="error" sx={{ mb: 2 }}>
                                {error}
                            </Alert>
                        )}

                        <Box component="form" onSubmit={handleLogin} noValidate>
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
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />

                            <Button
                                type="submit"
                                variant="contained"
                                color="primary"
                                fullWidth
                                sx={{ mt: 2, py: 1.15, fontWeight: 800 }}
                                disabled={submitting}
                            >
                                {submitting ? <CircularProgress size={20} /> : 'Sign In'}
                            </Button>
                        </Box>

                        <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}` }}>
                            <Typography variant="body2" color="text.secondary">
                                Want the kiosk station?
                                <Box
                                    component="span"
                                    onClick={() => navigate('/station-login')}
                                    sx={{ color: 'primary.main', cursor: 'pointer', ml: 0.75, fontWeight: 800 }}
                                >
                                    Station Check-in
                                </Box>
                            </Typography>
                        </Box>
                    </Box>
                </Box>
            </Paper>
        </Box>
    );
};

export default LoginPage;