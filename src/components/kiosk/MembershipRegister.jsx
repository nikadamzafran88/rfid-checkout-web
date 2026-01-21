import React, { useState } from 'react'
import { Box, Button, Typography, TextField } from '@mui/material'
import { httpsCallable } from 'firebase/functions'
import { useTransaction } from '../../contexts/TransactionContext'
import { fns } from '../../services/firebase'

export default function MembershipRegister() {
  const { setMembership, setStep, touchActivity } = useTransaction()
  const [name, setName] = useState('')
  const [countryCode, setCountryCode] = useState('+60')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    touchActivity?.()
    setError('')
    if (!name) {
      setError('Enter name')
      return
    }
    if (!countryCode || !/^\+\d{1,4}$/.test(countryCode.trim())) {
      setError('Enter valid country code (e.g. +60)')
      return
    }
    // National number must be digits only, 6-12 long, and must not start with 0
    if (!phone || !/^[1-9]\d{5,11}$/.test(phone.trim())) {
      setError('Enter a valid phone number (6-12 digits) and do not start with 0')
      return
    }
    const fullPhone = `${countryCode.trim()}${phone.trim()}`
    setLoading(true)
    try {
      // Ensure number is not already registered
      const getMembership = httpsCallable(fns, 'getMembership')
      const lookup = await getMembership({ phone: String(fullPhone).trim() })
      const existing = lookup?.data || null
      if (existing && existing.membershipId) {
        setError('This number is already in use')
        setLoading(false)
        return
      }
      const createMembership = httpsCallable(fns, 'createMembership')
      const r = await createMembership({ name: String(name).trim(), phone: String(fullPhone).trim() })
      const data = r?.data || null
      if (!data || !data.membershipId) throw new Error('Create failed')
      setMembership(data)
      setStep('SCANNING')
    } catch (e) {
      console.error('Membership create failed', e)
      setError(e?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>Register Membership</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>Enter your name and phone number to create a membership.</Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, alignItems: 'center' }}>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} sx={{ width: '100%', maxWidth: 420 }} />
        <Box sx={{ display: 'flex', gap: 1, width: '100%', maxWidth: 420 }}>
          <TextField label="Code" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} sx={{ width: 110 }} />
          <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} sx={{ flex: 1 }} helperText="Digits only, no leading zero" />
        </Box>
        {error ? <Typography variant="caption" sx={{ color: 'error.main' }}>{error}</Typography> : null}

        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          <Button variant="outlined" onClick={() => setStep('MEMBERSHIP')}>Back</Button>
          <Button variant="contained" onClick={submit} disabled={loading}>{loading ? 'Registering…' : 'Register & Start'}</Button>
        </Box>
      </Box>
    </Box>
  )
}
