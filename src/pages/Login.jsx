import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext.jsx';
import { Paper, Box, Typography, TextField, Button, Alert, CircularProgress, Divider, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { sendPasswordResetEmail } from 'firebase/auth';
import { alpha, useTheme } from '@mui/material/styles';

const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [signingIn, setSigningIn] = useState(false);
    const [resetOpen, setResetOpen] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [resetSending, setResetSending] = useState(false);
    const [resetStatus, setResetStatus] = useState({ message: '', severity: 'success' });
    const navigate = useNavigate();

    const theme = useTheme();

    const location = useLocation();

    const { currentUser, currentRole, loading, blockedUntilMs, logout, forcePasswordReset } = useAuth();

    const formatUntil = (ms) => {
        if (!ms) return '';
        try {
            return new Date(ms).toLocaleString('en-MY', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    };

    useEffect(() => {
        // If redirected here due to a block, log the message once.
        const until = location?.state?.blockedUntilMs;
        if (until && until > Date.now()) {
            console.warn(`Your account is temporarily blocked until ${formatUntil(until)}.`);
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
                    console.warn('[Login] blocked account detected; signing out', msg);
                    try { logout(); } catch { /* ignore */ }
                    return;
                }

                // If account requires password reset, send to profile page to set a new password first
                if (forcePasswordReset) {
                    console.debug('[Login] forcePasswordReset detected; redirecting to force-reset');
                    navigate('/force-reset', { replace: true });
                    return
                }

                // If role hasn't been determined yet, wait (avoid premature redirect)
                if (currentRole === null || currentRole === undefined) {
                    if (!signingIn) {
                        console.warn('[Login] role not yet loaded; waiting for role resolution');
                    }
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
                // Don't redirect to `/` (kiosk) by default — log an error so the
                // administrator can investigate their Firestore `users/{uid}` document
                // or security rules. This prevents accidental redirection into kiosk mode.
                console.error('[Login] Unknown or missing role for user; not redirecting. currentRole=', currentRole);
            }
    }, [loading, currentUser, currentRole, blockedUntilMs, navigate, logout, forcePasswordReset]);

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
        // clear previous UX notifications (no-op)
        setSubmitting(true);

        try {
            setSigningIn(true);
            const cred = await signInWithEmailAndPassword(auth, email, password);
                // Immediate enforcement check: if Firestore doc has forcePasswordReset, redirect.
                try {
                    const snap = await getDoc(doc(db, 'users', cred.user.uid));
                    if (snap.exists() && snap.data()?.forcePasswordReset) {
                        navigate('/force-reset', { replace: true });
                        return;
                    }
                } catch (e) {
                    console.warn('Failed to read user profile after login for forcePasswordReset check', e);
                }
        } catch (err) {
            console.error('Login Error:', err);
        } finally {
            setSubmitting(false);
            setSigningIn(false);
        }
    };

    const handleOpenReset = () => {
        setResetEmail(email || '');
        setResetStatus({ message: '', severity: 'success' });
        setResetOpen(true);
    }

    const handleSendReset = async () => {
        const target = (resetEmail || '').trim();
        if (!target) return setResetStatus({ message: 'Please enter an email address.', severity: 'error' });
        setResetSending(true);
        setResetStatus({ message: '', severity: 'success' });
        try {
            await sendPasswordResetEmail(auth, target);
            setResetStatus({ message: `Password reset email sent to ${target}.`, severity: 'success' });
        } catch (e) {
            console.error('Password reset failed', e);
            const msg = e?.code ? String(e.code) : (e?.message ? String(e.message) : 'Failed to send reset email');
            setResetStatus({ message: msg, severity: 'error' });
        } finally {
            setResetSending(false);
        }
    }

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
                                NAZ Retails
                            </Typography>
                            <Typography variant="h4" sx={{ fontWeight: 900, mt: 0.5, lineHeight: 1.1 }}>
                                Admin-Staff System
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 340 }}>
                                Sign in to manage inventory, products, users, and view the analytics dashboard.
                            </Typography>
                        </Box>

                        <Box>
                            <Divider sx={{ mb: 1.5, borderColor: alpha(theme.palette.text.primary, 0.10) }} />
                            <Typography variant="caption" color="text.secondary">
                                Tip: Use “NAZ RETAILS Self-Check Out Kiosk” for kiosk devices.
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

                        {/* Top-level notification removed per request */}

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
                            <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
                                <Button variant="text" size="small" onClick={handleOpenReset} sx={{ textTransform: 'none' }}>
                                    Forgot password?
                                </Button>
                            </Box>
                        </Box>

                        <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}` }}>
                            <Typography variant="body2" color="text.secondary">
                                Want the kiosk station?
                                <Box
                                    component="span"
                                    onClick={() => navigate('/station-login')}
                                    sx={{ color: 'primary.main', cursor: 'pointer', ml: 0.75, fontWeight: 800 }}
                                >
                                    NAZ RETAILS Self-Check Out Kiosk
                                </Box>
                            </Typography>
                        </Box>
                    </Box>
                </Box>
            </Paper>
            <Dialog open={resetOpen} onClose={() => setResetOpen(false)} aria-labelledby="reset-dialog-title">
                <DialogTitle id="reset-dialog-title">Reset your password</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Enter your account email and we'll send a password reset link.
                    </DialogContentText>
                    <TextField
                        margin="normal"
                        label="Email"
                        type="email"
                        required
                        fullWidth
                        autoComplete="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                    />
                    {resetStatus.message ? (
                        <Alert severity={resetStatus.severity} sx={{ mt: 1 }}>{resetStatus.message}</Alert>
                    ) : null}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResetOpen(false)}>Cancel</Button>
                    <Button onClick={handleSendReset} disabled={resetSending} variant="contained" sx={{ backgroundColor: '#a259ff', color: '#fff', '&:hover': { backgroundColor: '#8b45e6' } }}>
                        {resetSending ? <CircularProgress size={18} /> : 'Send reset email'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default LoginPage;