import React, { useMemo, useState, useEffect } from 'react'
import { Box, Button, Typography, TextField, Paper, Divider, Alert, CircularProgress } from '@mui/material'
import { useTransaction } from '../../contexts/TransactionContext'
import QRCode from 'react-qr-code'

export default function ReceiptScreen() {
  const { lastTxId, lastReceiptToken, end, cart, amount, stationId, touchActivity } = useTransaction()
  const [email, setEmail] = useState('')
  const [autoReturn, setAutoReturn] = useState(15)
  const [issuedAt] = useState(() => new Date())
  const [emailState, setEmailState] = useState({ sending: false, message: '', severity: 'success' })

  const receiptUrl = useMemo(() => {
    const token = lastReceiptToken ? String(lastReceiptToken) : ''
    if (!token) return ''
    const path = `/r/${encodeURIComponent(token)}`
    try {
      return new URL(path, window.location.origin).toString()
    } catch {
      return path
    }
  }, [lastReceiptToken])

  // finish function (declared before effect so it's available)
  function finish() {
    end()
  }

  // auto-return countdown
  useEffect(() => {
    let t = null
    if (autoReturn > 0) {
      t = setInterval(() => setAutoReturn(s => s - 1), 1000)
    }
    if (autoReturn === 0) {
      finish()
    }
    return () => { if (t) clearInterval(t) }
  }, [autoReturn])

  const isValidEmail = (v) => {
    const s = String(v || '').trim()
    if (!s) return false
    // Simple, practical check for kiosk use (simulation only)
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
  }

  const sendEmail = async () => {
    touchActivity?.()
    const target = String(email || '').trim()
    if (!isValidEmail(target)) {
      setEmailState({ sending: false, message: 'Please enter a valid email address.', severity: 'error' })
      return
    }

    setEmailState({ sending: true, message: '', severity: 'success' })
    try {
      // Simulated send
      await new Promise((r) => setTimeout(r, 650))
      setEmailState({ sending: false, message: `Receipt sent to ${target} (simulated).`, severity: 'success' })
      setEmail('')
    } catch {
      setEmailState({ sending: false, message: 'Failed to send email (simulated).', severity: 'error' })
    }
  }

  const printReceipt = () => {
    touchActivity?.()
    try {
      window.print()
    } catch {
      // ignore
    }
  }


  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Print styling */}
      <Box
        component="style"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              .print-hidden { display: none !important; }
              .kiosk-header, .kiosk-footer { display: none !important; }
              body { background: #fff !important; }
            }
          `,
        }}
      />

      <Box className="print-hidden" sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 950, lineHeight: 1.1 }}>Payment Successful</Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            Auto returning to start in <strong>{autoReturn}s</strong>
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={printReceipt}>
            Print receipt (simulate)
          </Button>
          <Button variant="contained" onClick={finish}>
            End now
          </Button>
        </Box>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          pr: { xs: 0, sm: 0.5 },
        }}
      >
        <Paper variant="outlined" sx={{ p: 2.25, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="overline" sx={{ letterSpacing: 1, color: 'text.secondary' }}>INVOICE / RECEIPT</Typography>
              <Typography variant="h5" sx={{ fontWeight: 950, lineHeight: 1.1 }}>RFID Checkout</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
                Station {stationId || '—'}
              </Typography>
            </Box>
            <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>Transaction</Typography>
              <Typography sx={{ fontWeight: 900 }}>{lastTxId || '—'}</Typography>
            </Box>
          </Box>

          <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ maxWidth: 520 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Scan the QR to open your receipt on your phone.
              </Typography>
            </Box>

            <Box
              sx={{
                p: 1.25,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'background.paper',
                display: 'inline-block',
              }}
            >
              <QRCode value={receiptUrl || 'about:blank'} size={132} level="M" />
            </Box>
          </Box>

          <Divider sx={{ my: 1.75 }} />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Date</Typography>
              <Typography sx={{ fontWeight: 900 }}>{issuedAt.toLocaleString()}</Typography>
            </Box>
            <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Items</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Array.isArray(cart) ? cart.length : 0}</Typography>
            </Box>
          </Box>

          <Divider sx={{ my: 1.75 }} />

          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>Item</Typography>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>Amount</Typography>
            </Box>

            <Paper variant="outlined" sx={{ borderColor: 'divider', overflow: 'hidden' }}>
              {cart.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography sx={{ fontWeight: 800 }}>No items</Typography>
                </Box>
              ) : (
                cart.map((it, idx) => (
                  <Box
                    key={`${it.id || it.sku || it.uid || idx}`}
                    sx={{
                      px: 2,
                      py: 1.25,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 2,
                      borderBottom: idx === cart.length - 1 ? 'none' : '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 900 }} noWrap>{it.name || 'Item'}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                        {it.sku || it.uid || '—'}
                      </Typography>
                    </Box>
                    <Typography sx={{ fontWeight: 900 }}>RM {Number(it.price || 0).toFixed(2)}</Typography>
                  </Box>
                ))
              )}
            </Paper>
          </Box>

          <Divider sx={{ my: 1.75 }} />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Total</Typography>
            <Typography variant="h5" sx={{ fontWeight: 950 }}>
              RM {Number(amount || 0).toFixed(2)}
            </Typography>
          </Box>
        </Paper>

        <Box className="print-hidden" sx={{ mt: 2 }}>
          <Paper variant="outlined" sx={{ p: 2, borderColor: 'divider' }}>
            <Typography sx={{ fontWeight: 900, mb: 1 }}>Send receipt to email</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField
                label="Email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setEmailState({ sending: false, message: '', severity: 'success' }) }}
                sx={{ flex: 1, minWidth: 240 }}
              />
              <Button variant="contained" onClick={sendEmail} disabled={emailState.sending}>
                {emailState.sending ? <CircularProgress size={18} /> : 'Send (simulate)'}
              </Button>
            </Box>
            {emailState.message ? (
              <Alert severity={emailState.severity} sx={{ mt: 1.25 }}>
                {emailState.message}
              </Alert>
            ) : null}
          </Paper>

          <Box sx={{ mt: 1.25, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="text" onClick={() => { touchActivity?.(); setAutoReturn(3) }}>
              Return soon
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
