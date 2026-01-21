import React, { useEffect, useMemo, useState } from 'react'
import { Box, Grid, TextField, Button, Alert, CircularProgress } from '@mui/material'
import { updateProfile, updatePassword, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth'
import { doc, serverTimestamp, setDoc, getDoc } from 'firebase/firestore'
import { db, auth } from '../firebaseConfig'
import { useAuth } from '../context/AuthContext.jsx'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'

export default function Profile() {
  const { currentUser, currentRole, refreshCurrentUser } = useAuth()

  const isAdmin = String(currentRole || '').toLowerCase() === 'admin'

  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState('')
  // Password reset state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetSuccess, setResetSuccess] = useState('')
  const [forceReset, setForceReset] = useState(false)

  useEffect(() => {
    setDisplayNameDraft(String(currentUser?.displayName || '').trim())
    // Load user's Firestore profile to check for force-password-reset flag
    let cancelled = false
    async function loadProfileFlag() {
      try {
        if (!currentUser) return
        const snap = await getDoc(doc(db, 'users', currentUser.uid))
        if (!cancelled && snap.exists()) {
          const data = snap.data() || {}
          setForceReset(Boolean(data.forcePasswordReset))
        }
      } catch (err) {
        console.warn('Failed to read user profile for forceReset flag', err)
      }
    }
    loadProfileFlag()
    return () => { cancelled = true }
  }, [currentUser])

  const canSave = useMemo(() => {
    if (!isAdmin) return false
    if (!currentUser) return false
    const next = String(displayNameDraft || '').trim()
    if (!next) return false
    const prev = String(currentUser?.displayName || '').trim()
    return next !== prev
  }, [currentUser, displayNameDraft, isAdmin])

  const handleSaveName = async () => {
    if (!canSave || saving) return
    setSaveError('')
    setSaveSuccess('')

    const next = String(displayNameDraft || '').trim()
    if (!next) {
      setSaveError('Display name cannot be empty.')
      return
    }

    setSaving(true)
    try {
      await updateProfile(currentUser, { displayName: next })

      // Mirror into Firestore user profile for consistency across the app.
      // Use merge so we don't overwrite role/other metadata.
      try {
        await setDoc(
          doc(db, 'users', currentUser.uid),
          {
            displayName: next,
            fullName: next,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      } catch (err) {
        console.warn('Failed to update Firestore user profile name (Auth updated successfully).', err)
      }

      if (typeof refreshCurrentUser === 'function') {
        await refreshCurrentUser()
      }

      setSaveSuccess('Name updated successfully.')
    } catch (err) {
      console.error('Failed to update display name', err)
      const code = err?.code ? ` (${err.code})` : ''
      setSaveError(`Failed to update name.${code} ${err?.message || ''}`.trim())
    } finally {
      setSaving(false)
    }
  }

  const handleSetPassword = async () => {
    setResetError('')
    setResetSuccess('')
    if (!currentUser) {
      setResetError('No authenticated user.')
      return
    }
    const pw = String(newPassword || '')
    if (pw.length < 6) {
      setResetError('Password must be at least 6 characters.')
      return
    }
    if (pw !== String(confirmPassword || '')) {
      setResetError('Passwords do not match.')
      return
    }

    setResetting(true)
    try {
      // Reauthenticate using current password before updating
      if (!currentPassword) {
        setResetError('Please enter your current password to confirm the change.')
        setResetting(false)
        return
      }
      try {
        const cred = EmailAuthProvider.credential(currentUser.email, currentPassword)
        await reauthenticateWithCredential(currentUser, cred)
      } catch (reauthErr) {
        setResetError('Current password is incorrect or reauthentication failed.')
        setResetting(false)
        return
      }

      await updatePassword(currentUser, pw)
      // Clear the force flag in Firestore
      try {
        await setDoc(doc(db, 'users', currentUser.uid), { forcePasswordReset: false }, { merge: true })
      } catch (err) {
        console.warn('Failed to clear forcePasswordReset flag in Firestore', err)
      }

      setResetSuccess('Password updated successfully.')
      setNewPassword('')
      setConfirmPassword('')
      setForceReset(false)
      if (typeof refreshCurrentUser === 'function') await refreshCurrentUser()
    } catch (err) {
      console.error('Failed to update password', err)
      // If updatePassword fails due to recent login requirement, fall back to sending a reset email
      const code = err?.code || ''
      if (code.includes('requires-recent-login')) {
        try {
            await sendPasswordResetEmail(auth, currentUser.email)
            setResetSuccess('You must re-authenticate; a reset email has been sent to your address.')
          } catch (emailErr) {
            setResetError(`Failed to send reset email: ${emailErr?.message || emailErr}`)
          }
      } else {
        setResetError(err?.message || 'Failed to update password.')
      }
    } finally {
      setResetting(false)
    }
  }

  const handleSendResetEmail = async () => {
    setResetError('')
    setResetSuccess('')
    if (!currentUser?.email) {
      setResetError('No email available for this account.')
      return
    }
    setResetting(true)
      try {
      await sendPasswordResetEmail(auth, currentUser.email)
      setResetSuccess('Password reset email sent. Check your inbox.')
    } catch (err) {
      setResetError(err?.message || 'Failed to send reset email.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Profile" subtitle="Your account information." />

      <SectionCard title="Account Details">

        {saveError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {saveError}
          </Alert>
        ) : null}

        {saveSuccess ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            {saveSuccess}
          </Alert>
        ) : null}

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              label="Display Name"
              value={displayNameDraft}
              onChange={(e) => setDisplayNameDraft(e.target.value)}
              fullWidth
              InputProps={{ readOnly: !isAdmin }}
              helperText={isAdmin ? 'Admins can update their display name.' : 'Only admins can update the display name.'}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Email"
              value={currentUser?.email || ''}
              fullWidth
              InputProps={{ readOnly: true }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Role"
              value={currentRole || ''}
              fullWidth
              InputProps={{ readOnly: true }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="User ID"
              value={currentUser?.uid || ''}
              fullWidth
              InputProps={{ readOnly: true }}
            />
          </Grid>

          {isAdmin ? (
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
                <Button
                  variant="contained"
                  onClick={handleSaveName}
                  disabled={!canSave || saving}
                  startIcon={saving ? <CircularProgress size={16} /> : null}
                >
                  {saving ? 'Saving…' : 'Save Name'}
                </Button>
              </Box>
            </Grid>
          ) : null}
        </Grid>
      </SectionCard>
      <SectionCard title="Reset Password" sx={{ mt: 2 }}>
        {forceReset ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Your account requires a password change. Please set a new password now.
          </Alert>
        ) : null}

        {resetError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {resetError}
          </Alert>
        ) : null}

        {resetSuccess ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            {resetSuccess}
          </Alert>
        ) : null}

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              fullWidth
              autoComplete="current-password"
              helperText="Enter your current password to confirm the change."
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              fullWidth
              autoComplete="new-password"
              helperText="Enter a new secure password (min 6 characters)."
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <TextField
              label="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              fullWidth
              autoComplete="new-password"
            />
          </Grid>

          <Grid item xs={12}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
              <Button variant="outlined" color="primary" onClick={handleSendResetEmail} disabled={resetting}>
                Send Reset Email
              </Button>
              <Button variant="contained" onClick={handleSetPassword} disabled={resetting} startIcon={resetting ? <CircularProgress size={16} /> : null}>
                {resetting ? 'Working…' : 'Set Password'}
              </Button>
            </Box>
          </Grid>
        </Grid>
      </SectionCard>
    </Box>
  )
}
