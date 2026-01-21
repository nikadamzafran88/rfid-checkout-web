import React, { useEffect, useMemo, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { useLocation, useNavigate } from 'react-router-dom'

function useQuery() {
  return new URLSearchParams(useLocation().search)
}

export default function PaymentResult() {
  const q = useQuery()
  const navigate = useNavigate()
  const status = String(q.get('status') || '').toLowerCase()
  const sessionId = q.get('session_id') || q.get('sessionId') || ''

  const title = status === 'success' ? 'Payment Successful' : status === 'cancel' ? 'Payment Cancelled' : 'Payment'
  const message = status === 'success'
    ? 'Thank you — your payment was received.'
    : status === 'cancel'
      ? 'Payment was cancelled. You may try again on the kiosk.'
      : 'Payment completed.'

  // Auto-close on mobile: try window.close(), fallback to redirect to '/'
  const [countdown, setCountdown] = useState(5)

  const isMobile = useMemo(() => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ''), [])

  useEffect(() => {
    if (!isMobile) return undefined
    const t = setInterval(() => setCountdown(c => c - 1), 1000)
    return () => clearInterval(t)
  }, [isMobile])

  useEffect(() => {
    if (!isMobile) return
    if (countdown <= 0) {
      try {
        // Attempt to close the tab (may be blocked by browser). If blocked, fall back to navigate.
        window.close()
      } catch {}
      try {
        navigate('/', { replace: true })
      } catch {
        try { window.location.assign('/') } catch {}
      }
    }
  }, [countdown, isMobile, navigate])

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 3, textAlign: 'center' }}>
      <Typography variant="h4" sx={{ fontWeight: 900, mb: 1 }}>{title}</Typography>
      <Typography variant="body1" sx={{ mb: 2 }}>{message}</Typography>
      {sessionId ? <Typography variant="caption" sx={{ display: 'block', mb: 2 }}>Session: {sessionId}</Typography> : null}
      {isMobile ? (
        <Typography variant="caption" sx={{ display: 'block', mb: 2 }}>This page will close in {countdown}s</Typography>
      ) : null}
    </Box>
  )
}
