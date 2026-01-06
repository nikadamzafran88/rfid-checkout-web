import React, { useState } from 'react'
import { Box, Paper, Typography, TextField, Button, Alert, CircularProgress, Divider } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig'
import { useAuth } from '../context/AuthContext'

export default function StationLogin() {
  const [stationId, setStationId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const { logout } = useAuth()
  const theme = useTheme()

  const handleStaffAdmin = async (e) => {
    e.preventDefault()
    // On shared kiosk devices, never carry an existing admin session into the portal
    try { localStorage.removeItem('station_id') } catch (err) { /* ignore */ }
    try { localStorage.removeItem('station_authenticated') } catch (err) { /* ignore */ }
    try { await logout() } catch (err) { /* ignore */ }
    navigate('/login', { replace: true })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!stationId) return setError('Enter station id')
    setSubmitting(true)
    try {
      const stationRef = doc(db, 'stations', stationId)
      const snap = await getDoc(stationRef)
      if (!snap.exists()) {
        setError('Station not found')
        setSubmitting(false)
        return
      }
      const data = snap.data() || {}
      if (data.password && data.password === password) {
        localStorage.setItem('station_id', stationId)
        localStorage.setItem('station_authenticated', String(Date.now()))
        navigate('/checkout', { replace: true })
      } else {
        setError('Invalid station password')
      }
    } catch (err) {
      console.error('Station login error', err)
      setError('Failed to authenticate station')
    } finally {
      setSubmitting(false)
    }
  }

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
                Kiosk Mode
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 900, mt: 0.5, lineHeight: 1.1 }}>
                Station Check-in
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 360 }}>
                Enter station credentials to open kiosk mode for customer checkout.
              </Typography>
            </Box>

            <Box>
              <Divider sx={{ mb: 1.5, borderColor: alpha(theme.palette.text.primary, 0.10) }} />
              <Typography variant="caption" color="text.secondary">
                Tip: Use a unique station ID per device.
              </Typography>
            </Box>
          </Box>

          <Box sx={{ p: { xs: 3, sm: 4 } }}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 900 }}>
                Open kiosk
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                This device will enter customer checkout
              </Typography>
            </Box>

            {error ? (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            ) : null}

            <Box component="form" onSubmit={handleSubmit}>
              <TextField
                margin="normal"
                label="Station ID"
                fullWidth
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
              />
              <TextField
                margin="normal"
                label="Password"
                type="password"
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={submitting}
                sx={{ mt: 2, py: 1.15, fontWeight: 800 }}
              >
                {submitting ? <CircularProgress size={20} /> : 'Open Kiosk'}
              </Button>
            </Box>

            <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}` }}>
              <Typography variant="body2" color="text.secondary">
                Not a kiosk?
                <Box
                  component="span"
                  onClick={handleStaffAdmin}
                  sx={{ color: 'primary.main', cursor: 'pointer', ml: 0.75, fontWeight: 800 }}
                >
                  Staff / Admin login
                </Box>
              </Typography>
            </Box>
          </Box>
        </Box>
      </Paper>
    </Box>
  )
}
