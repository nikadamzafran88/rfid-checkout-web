import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Typography, Alert, CircularProgress, Divider, Paper } from '@mui/material'
import { useTransaction } from '../../contexts/TransactionContext'
import { httpsCallable } from 'firebase/functions'
import { fns } from '../../services/firebase'
import QRCode from 'react-qr-code'

export default function PaymentScreen() {
  const { amount, cart, stationId, saveTransaction, setStep, setLastTxId, setLastReceiptToken, touchActivity } = useTransaction()
  const [method, setMethod] = useState('BILLPLZ')
  const [loading, setLoading] = useState(false)
  const [bill, setBill] = useState(null) // { billId, billUrl }
  const [billStatus, setBillStatus] = useState(null)
  const [stripeSession, setStripeSession] = useState(null) // { sessionId, url }
  const [stripeStatus, setStripeStatus] = useState(null)
  const [finalizing, setFinalizing] = useState(false)
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef(null)
  const scrollContainerRef = useRef(null)
  const qrSectionRef = useRef(null)

  const money = useMemo(() => {
    try {
      return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' })
    } catch {
      return null
    }
  }, [])

  const totalLabel = money ? money.format(Number(amount || 0)) : `RM ${Number(amount || 0).toFixed(2)}`
  const canStartPayment = Boolean(stationId) && cart.length > 0 && Number(amount || 0) > 0

  const formatMoney = useCallback((v) => {
    const n = Number(v || 0)
    if (money) return money.format(Number.isFinite(n) ? n : 0)
    return `RM ${Number.isFinite(n) ? n.toFixed(2) : '0.00'}`
  }, [money])

  const formatCallableError = (e, fallback) => {
    const msg = e?.message ? String(e.message) : String(fallback || 'Request failed')
    const code = e?.code ? String(e.code) : ''
    const details = e?.details ? (typeof e.details === 'string' ? e.details : JSON.stringify(e.details)) : ''
    const extra = [code ? `code=${code}` : null, details ? `details=${details}` : null].filter(Boolean).join(' | ')
    return extra ? `${msg} (${extra})` : msg
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setPolling(false)
  }, [])

  const resetBillplz = useCallback(() => {
    stopPolling()
    setBill(null)
    setBillStatus(null)
    setFinalizing(false)
  }, [stopPolling])

  const resetStripe = useCallback(() => {
    stopPolling()
    setStripeSession(null)
    setStripeStatus(null)
    setFinalizing(false)
  }, [stopPolling])

  // When a QR becomes available, scroll it into view within the payment panel.
  useEffect(() => {
    const hasQr = Boolean(bill?.billUrl) || Boolean(stripeSession?.url)
    if (!hasQr) return

    const t = setTimeout(() => {
      try {
        qrSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch {
        // ignore
      }
    }, 50)

    return () => clearTimeout(t)
  }, [bill?.billUrl, stripeSession?.url])

  const startStripe = async () => {
    setError('')
    setStripeStatus(null)
    setLoading(true)
    try {
      resetStripe()
      const createSession = httpsCallable(fns, 'createStripeCheckoutSession')
      const res = await createSession({
        stationId,
        amount,
        currency: 'myr',
        origin: typeof window !== 'undefined' ? window.location.origin : '',
      })

      const data = res?.data || {}
      if (!data.sessionId || !data.url) throw new Error('Invalid Stripe response')
      const next = { sessionId: String(data.sessionId), url: String(data.url) }
      setStripeSession(next)

      // Poll status
      stopPolling()
      const getSession = httpsCallable(fns, 'getStripeCheckoutSession')
      setPolling(true)
      pollRef.current = setInterval(async () => {
        try {
          const r = await getSession({ sessionId: next.sessionId })
          const s = r?.data || {}
          setStripeStatus(s)
          if (String(s.paymentStatus || '') === 'paid') {
            stopPolling()
            setFinalizing(true)
            try {
              const docRef = await saveTransaction('STRIPE', {
                provider: 'stripe',
                session_id: next.sessionId,
                status: s.status || null,
                payment_status: s.paymentStatus || null,
              })
              if (docRef?.id) setLastTxId(docRef.id)
              if (docRef?.receiptToken) setLastReceiptToken(docRef.receiptToken)
              setStep('RECEIPT')
            } catch (e) {
              console.error('Stripe payment recorded failed', e)
              setError(formatCallableError(e, 'Payment was received but failed to record transaction'))
            } finally {
              setFinalizing(false)
            }
          }
        } catch (e) {
          console.warn('Stripe status poll failed', e)
        }
      }, 2000)
    } catch (e) {
      console.error('Stripe create failed', e)
      setError(formatCallableError(e, 'Failed to start Stripe payment'))
    } finally {
      setLoading(false)
    }
  }

  const finalizeBillplz = useCallback(async ({ billId }) => {
    setFinalizing(true)
    try {
      const finalize = httpsCallable(fns, 'finalizeBillplzTransaction')
      const fr = await finalize({
        stationId,
        billId,
        amount,
        items: cart,
      })
      const txId = fr?.data?.txId
      if (txId) setLastTxId(String(txId))
      const receiptToken = fr?.data?.receiptToken
      if (receiptToken) setLastReceiptToken(String(receiptToken))
      setStep('RECEIPT')
    } catch (e) {
      console.error('Finalize Billplz transaction failed', e)
      setError(e?.message || 'Payment was received but failed to record transaction')
    } finally {
      setFinalizing(false)
    }
  }, [amount, cart, setLastReceiptToken, setLastTxId, setStep, stationId])

  const startBillplz = async () => {
    setError('')
    setBillStatus(null)
    setLoading(true)
    try {
      resetBillplz()
      const createBill = httpsCallable(fns, 'createBillplzBill')
      const res = await createBill({
        stationId,
        amount,
        description: `RFID Checkout - ${stationId} (${cart.length} item(s))`,
      })

      const data = res?.data || {}
      if (!data.billId || !data.billUrl) throw new Error('Invalid Billplz response')
      const nextBill = { billId: String(data.billId), billUrl: String(data.billUrl) }
      setBill(nextBill)

      // Start polling
      stopPolling()
      const getBill = httpsCallable(fns, 'getBillplzBill')
      setPolling(true)
      pollRef.current = setInterval(async () => {
        try {
          const r = await getBill({ billId: nextBill.billId })
          const s = r?.data || {}
          setBillStatus(s)
          if (s.paid) {
            stopPolling()
            try {
              await finalizeBillplz({ billId: nextBill.billId })
            } catch (e) {
              console.error('Finalize Billplz transaction failed', e)
              setError(e?.message || 'Payment was received but failed to record transaction')
            }
          }
        } catch (e) {
          // keep polling; transient network errors are ok
          console.warn('Billplz status poll failed', e)
        }
      }, 2000)
    } catch (e) {
      console.error('Billplz create failed', e)
      const code = e?.code ? String(e.code) : ''
      const status = e?.details?.status
      const resp = e?.details?.response
      const respText = resp ? (typeof resp === 'string' ? resp : JSON.stringify(resp)) : ''
      const extra = [
        code ? `code=${code}` : null,
        status ? `status=${status}` : null,
        respText ? `response=${respText}` : null,
      ].filter(Boolean).join(' | ')
      setError(`${e?.message || 'Failed to start Billplz payment'}${extra ? ` (${extra})` : ''}`)
    } finally {
      setLoading(false)
    }
  }

  const onSelectMethod = (next) => {
    touchActivity?.()
    setError('')
    setMethod(next)
    resetBillplz()
    resetStripe()
  }

  const goBack = () => {
    touchActivity?.()
    resetBillplz()
    resetStripe()
    setError('')
    setStep('SCANNING')
  }

  return (
    <Box
      ref={scrollContainerRef}
      sx={{
        p: 3,
        height: '100%',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1.35fr' }, gap: 2.25, alignItems: 'start' }}>
        {/* Left: payment methods */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 900, mb: 1 }}>Payment method</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button
              variant={method === 'BILLPLZ' ? 'contained' : 'outlined'}
              onClick={() => onSelectMethod('BILLPLZ')}
              disabled={loading || finalizing}
              sx={{ py: 1.6, justifyContent: 'space-between', fontWeight: 900 }}
            >
              Online Payment & QR
            </Button>
            <Button
              variant={method === 'STRIPE' ? 'contained' : 'outlined'}
              onClick={() => onSelectMethod('STRIPE')}
              disabled={loading || finalizing}
              sx={{ py: 1.6, justifyContent: 'space-between', fontWeight: 900 }}
            >
              Card Payment
            </Button>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Online Payment & QR supports FPX/online banking and DuitNow QR depending on your Billplz Collection settings.
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Card Payment supports debit/credit card payments via Stripe Checkout.
            </Typography>
          </Box>

          {/* When QR is generated, show it under payment selection */}
          {method === 'BILLPLZ' && bill?.billUrl ? (
            <Paper variant="outlined" sx={{ mt: 2, p: 1.5 }} ref={qrSectionRef}>
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <Box
                  sx={{
                    bgcolor: 'background.paper',
                    p: 1.25,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    display: 'inline-block',
                  }}
                >
                  <QRCode value={bill.billUrl} size={200} level="M" />
                </Box>

                <Box sx={{ minWidth: 220, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 0.5 }}>Scan to pay</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Use your phone to open the online payment page.
                  </Typography>

                  <Box sx={{ mt: 1.25 }}>
                    <Button
                      variant="outlined"
                      href={bill.billUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => touchActivity?.()}
                    >
                      Open payment link
                    </Button>
                  </Box>

                  <Box sx={{ mt: 1.25, fontSize: 12, opacity: 0.85 }}>
                    Status: {billStatus?.paid ? 'Paid' : (billStatus?.state || 'Pending')}
                  </Box>
                  <Box sx={{ mt: 0.5, fontSize: 12, opacity: 0.85 }}>
                    Bill ID: <strong>{bill.billId}</strong>
                  </Box>
                </Box>
              </Box>
            </Paper>
          ) : null}

          {method === 'STRIPE' && stripeSession?.url ? (
            <Paper variant="outlined" sx={{ mt: 2, p: 1.5 }} ref={qrSectionRef}>
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <Box
                  sx={{
                    bgcolor: 'background.paper',
                    p: 1.25,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    display: 'inline-block',
                  }}
                >
                  <QRCode value={stripeSession.url} size={200} level="M" />
                </Box>

                <Box sx={{ minWidth: 220, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 0.5 }}>Scan to pay</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Use your phone to open Stripe Checkout.
                  </Typography>

                  <Box sx={{ mt: 1.25 }}>
                    <Button
                      variant="outlined"
                      href={stripeSession.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => touchActivity?.()}
                    >
                      Open payment link
                    </Button>
                  </Box>

                  <Box sx={{ mt: 1.25, fontSize: 12, opacity: 0.85 }}>
                    Status: {String(stripeStatus?.paymentStatus || '').toLowerCase() === 'paid' ? 'Paid' : (stripeStatus?.paymentStatus || stripeStatus?.status || 'Pending')}
                  </Box>
                  <Box sx={{ mt: 0.5, fontSize: 12, opacity: 0.85 }}>
                    Session: <strong>{stripeSession.sessionId}</strong>
                  </Box>
                </Box>
              </Box>
            </Paper>
          ) : null}
        </Paper>

        {/* Right: total + payment process */}
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="h4" sx={{ lineHeight: 1.1, fontWeight: 900 }}>Payment</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
                {cart.length} item(s) • Station {stationId || '—'}
              </Typography>
            </Box>

            <Button variant="outlined" onClick={goBack} disabled={loading || finalizing}>
              Back to scanning
            </Button>
          </Box>

          <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Total</Typography>
            <Typography variant="h4" sx={{ fontWeight: 950 }}>{totalLabel}</Typography>
          </Box>

          <Paper variant="outlined" sx={{ mt: 1.5, p: 1.5, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Items</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{cart.length} item(s)</Typography>
            </Box>

            <Box sx={{ mt: 1, maxHeight: 220, overflowY: 'auto', pr: 0.5 }}>
              {cart.map((it, idx) => (
                <Box key={String(it?.uid || it?.id || idx)}>
                  {idx > 0 ? <Divider sx={{ my: 1 }} /> : null}
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                        {String(it?.name || 'Item')}
                      </Typography>
                      {it?.sku ? (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                          {String(it.sku)}
                        </Typography>
                      ) : null}
                    </Box>

                    <Typography variant="body2" sx={{ fontWeight: 900, whiteSpace: 'nowrap' }}>
                      {formatMoney(it?.price)}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Paper>

          <Alert severity="info" sx={{ mt: 1.5 }}>
            Scan the QR code to pay. When payment is successful, this kiosk will auto-continue.
          </Alert>

          {error ? <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert> : null}

          <Box sx={{ mt: 1.75 }}>
            {method === 'BILLPLZ' && (
              <Box>
                {!stationId ? (
                  <Alert severity="warning">Station ID is missing. Please set up the station first.</Alert>
                ) : !canStartPayment ? (
                  <Alert severity="warning">Cart is empty. Please scan items first.</Alert>
                ) : null}

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', mt: 0.5 }}>
                  <Button
                    variant="contained"
                    onClick={() => { touchActivity?.(); startBillplz() }}
                    disabled={loading || finalizing || !canStartPayment}
                    sx={{ py: 1.4, px: 2.5 }}
                  >
                    {loading ? <CircularProgress size={18} /> : (bill?.billUrl ? 'Regenerate QR' : 'Show QR to Pay')}
                  </Button>

                  {bill?.billUrl ? (
                    <Button
                      variant="outlined"
                      onClick={() => { touchActivity?.(); resetBillplz() }}
                      disabled={loading || finalizing}
                    >
                      Reset QR
                    </Button>
                  ) : null}

                  {polling ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>Waiting for payment…</Typography>
                    </Box>
                  ) : null}

                  {finalizing ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>Finalizing…</Typography>
                    </Box>
                  ) : null}
                </Box>

                {/* QR moved under payment selection (left panel) */}
              </Box>
            )}

            {method === 'STRIPE' && (
              <Box>
                {!stationId ? (
                  <Alert severity="warning">Station ID is missing. Please set up the station first.</Alert>
                ) : !canStartPayment ? (
                  <Alert severity="warning">Cart is empty. Please scan items first.</Alert>
                ) : null}

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', mt: 0.5 }}>
                  <Button
                    variant="contained"
                    onClick={() => { touchActivity?.(); startStripe() }}
                    disabled={loading || finalizing || !canStartPayment}
                    sx={{ py: 1.4, px: 2.5 }}
                  >
                    {loading ? <CircularProgress size={18} /> : (stripeSession?.url ? 'Regenerate QR' : 'Show QR to Pay')}
                  </Button>

                  {stripeSession?.url ? (
                    <Button
                      variant="outlined"
                      onClick={() => { touchActivity?.(); resetStripe() }}
                      disabled={loading || finalizing}
                    >
                      Reset
                    </Button>
                  ) : null}

                  {polling ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>Waiting for payment…</Typography>
                    </Box>
                  ) : null}

                  {finalizing ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>Finalizing…</Typography>
                    </Box>
                  ) : null}
                </Box>

                {/* QR moved under payment selection (left panel) */}
              </Box>
            )}

          </Box>

          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Tip: Keep the phone on the payment page until it shows success.
            </Typography>
          </Box>
        </Paper>
      </Box>
    </Box>
  )
}
