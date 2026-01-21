import React, { useEffect, useState } from 'react'
import { Box, Paper, Typography, TextField, Button, Alert, CircularProgress } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { updatePassword, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebaseConfig'
import { useAuth } from '../context/AuthContext.jsx'

export default function ForceReset() {
  const { currentUser, currentRole, refreshCurrentUser, loading } = useAuth()
  const navigate = useNavigate()

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!loading && !currentUser) {
      navigate('/login', { replace: true })
    }
  }, [loading, currentUser, navigate])

  const finalizeRedirect = () => {
    const role = (currentRole || '').toString().toLowerCase()
    if (role === 'admin' || role === 'staff' || role === 'manager') {
      navigate('/admin', { replace: true })
      return
    }
    if (role === 'customer') {
      navigate('/checkout', { replace: true })
      return
    }
    navigate('/', { replace: true })
  }

  const handleSetPassword = async () => {
    setError('')
    setSuccess('')
    if (!currentUser) return setError('No authenticated user.')
    const pw = String(newPassword || '')
    if (pw.length < 6) return setError('Password must be at least 6 characters.')
    if (pw !== String(confirmPassword || '')) return setError('Passwords do not match.')

    setWorking(true)
    try {
      await updatePassword(currentUser, pw)
      try {
        await setDoc(doc(db, 'users', currentUser.uid), { forcePasswordReset: false }, { merge: true })
      } catch (err) {
        console.warn('Failed to clear forcePasswordReset flag', err)
      }
      setSuccess('Password updated. Redirecting…')
      setNewPassword('')
      setConfirmPassword('')
      if (typeof refreshCurrentUser === 'function') await refreshCurrentUser()
      setTimeout(() => finalizeRedirect(), 900)
    } catch (err) {
      const code = err?.code || ''
      if (code.includes('requires-recent-login')) {
        try {
            await sendPasswordResetEmail(auth, currentUser.email)
            setSuccess('You must re-authenticate; a reset email has been sent to your address.')
          } catch (emailErr) {
            setError(emailErr?.message || 'Failed to send reset email.')
          }
      } else {
        setError(err?.message || 'Failed to update password.')
      }
    } finally {
      setWorking(false)
    }
  }

  const handleSendResetEmail = async () => {
    setError('')
    setSuccess('')
    if (!currentUser?.email) return setError('No email available for this account.')
    setWorking(true)
        // Require current password and reauthenticate first
        if (!currentPassword) {
          setError('Please enter your current password to confirm the change.')
          setWorking(false)
          return
        }
        try {
          const cred = EmailAuthProvider.credential(currentUser.email, currentPassword)
          await reauthenticateWithCredential(currentUser, cred)
        } catch (reauthErr) {
          setError('Current password is incorrect or reauthentication failed.')
          setWorking(false)
          return
        }
    try {
      await sendPasswordResetEmail(auth, currentUser.email)
      setSuccess('Password reset email sent. Check your inbox.')
    } catch (err) {
      setError(err?.message || 'Failed to send reset email.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Box sx={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
      <Paper elevation={3} sx={{ width: '100%', maxWidth: 520, p: 4, borderRadius: 2 }}>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 800 }}>Set a new password</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Your account requires a password change before continuing.</Typography>

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
        {success ? <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert> : null}

        <TextField label="New password" type="password" fullWidth sx={{ mb: 2 }} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <TextField label="Confirm password" type="password" fullWidth sx={{ mb: 2 }} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
          <Button variant="outlined" onClick={handleSendResetEmail} disabled={working}>Send Reset Email</Button>
          <Button variant="contained" onClick={handleSetPassword} disabled={working} startIcon={working ? <CircularProgress size={16} /> : null}>
            {working ? 'Working…' : 'Set Password'}
          </Button>
        </Box>
      </Paper>
    </Box>
  )
}
