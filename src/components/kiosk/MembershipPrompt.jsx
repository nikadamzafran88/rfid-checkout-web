import React, { useState } from 'react'
import { Box, Button, Typography, TextField, Divider } from '@mui/material'
import { httpsCallable } from 'firebase/functions'
import { useTransaction } from '../../contexts/TransactionContext'
import { fns } from '../../services/firebase'

export default function MembershipPrompt() {
  const { setStep, setMembership, touchActivity } = useTransaction()
  const [phone, setPhone] = useState('')
  const [countryCode, setCountryCode] = useState('+60')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const lookup = async () => {
    touchActivity?.()
    setError('')
    if (!countryCode || !/^\+\d{1,4}$/.test(countryCode.trim())) {
      setError('Enter valid country code (e.g. +60)')
      return
    }
    if (!phone || !/^\d{6,12}$/.test(phone.trim())) {
      setError('Enter a valid phone number (digits only, 6-12 digits)')
      return
    }
    const fullPhone = `${countryCode.trim()}${phone.trim()}`
    setLoading(true)
    try {
      const getMembership = httpsCallable(fns, 'getMembership')
      const r = await getMembership({ phone: String(fullPhone).trim() })
      const data = r?.data || null
      if (!data || !data.membershipId) {
        setError('Membership not found')
        setLoading(false)
        return
      }
      // set membership and go to scanning
      setMembership(data)
      setStep('SCANNING')
    } catch (e) {
      console.error('Membership lookup failed', e)
      setError(e?.message || 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>Have a membership?</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>Enter your phone number to use your membership benefits.</Typography>

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mb: 2, alignItems: 'center' }}>
        <TextField size="small" placeholder="Code" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} sx={{ width: 100 }} />
        <TextField size="small" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} sx={{ width: 200 }} />
        <Button size="small" variant="contained" onClick={lookup} disabled={loading} sx={{ height: 36 }}>{loading ? 'Checking…' : 'Enter'}</Button>
      </Box>
      {error ? <Typography variant="caption" sx={{ color: 'error.main' }}>{error}</Typography> : null}

      <Divider sx={{ my: 3 }} />

      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
        Didn't have the membership yet? <Box component="span" sx={{ fontWeight: 800 }}>Register Now</Box>
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center', width: 320, mx: 'auto' }}>
        <Button size="small" variant="contained" onClick={() => { touchActivity?.(); setStep('MEMBERSHIP_REGISTER') }} sx={{ width: '100%', height: 40 }}>Register membership</Button>
        <Button size="small" variant="outlined" onClick={() => { touchActivity?.(); setMembership(null); setStep('SCANNING') }} sx={{ width: '100%', height: 36 }}>Skip to scanning</Button>
      </Box>
    </Box>
  )
}
