import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Typography, Alert, CircularProgress, Divider, Paper, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, TextField } from '@mui/material'
import { useTransaction } from '../../contexts/TransactionContext'
import { httpsCallable } from 'firebase/functions'
import { fns, rtdb } from '../../services/firebase'
import { ref as dbRef, onValue } from 'firebase/database'
import QRCode from 'react-qr-code'

export default function PaymentScreen() {
  const { amount, cart, stationId, saveTransaction, setStep, setLastTxId, setLastReceiptToken, touchActivity, end, membership, setMembership, redeemPoints, setRedeemPoints, discountAmount, POINT_TO_MYR } = useTransaction()
  const [promoCode, setPromoCode] = useState('')
  const [promoPreview, setPromoPreview] = useState(null)
  const [promoChecking, setPromoChecking] = useState(false)
  const promoDiscount = promoPreview?.discountAmount ? Number(promoPreview.discountAmount) : 0
  const effectiveAmount = Math.max(0, Number(amount || 0) - promoDiscount - Number(discountAmount || 0))
  const [method, setMethod] = useState('BILLPLZ')
  const [loading, setLoading] = useState(false)
  const [bill, setBill] = useState(null) // { billId, billUrl }
  const [billStatus, setBillStatus] = useState(null)
  const [stripeSession, setStripeSession] = useState(null) // { sessionId, url }
  const [stripeStatus, setStripeStatus] = useState(null)
  const [finalizing, setFinalizing] = useState(false)
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState('')
  const [openCancelConfirm, setOpenCancelConfirm] = useState(false)
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
  const effectiveLabel = money ? money.format(Number(effectiveAmount || 0)) : `RM ${Number(effectiveAmount || 0).toFixed(2)}`
  const canStartPayment = Boolean(stationId) && cart.length > 0 && Number(effectiveAmount || 0) > 0

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

  // Realtime RTDB listener for instant Billplz callback/status updates.
  // (moved) Realtime RTDB listener is declared below after `finalizeBillplz`

  const startStripe = async () => {
    setError('')
    setStripeStatus(null)
    setLoading(true)
    try {
      resetStripe()
      const createSession = httpsCallable(fns, 'createStripeCheckoutSession')
      const res = await createSession({
        stationId,
        amount: effectiveAmount,
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
                amountOverride: effectiveAmount,
                promoCode: promoCode || null,
              })
              if (docRef?.id) setLastTxId(docRef.id)
              if (docRef?.receiptToken) setLastReceiptToken(docRef.receiptToken)
              // Refresh membership so receipt shows updated points (if any)
              try {
                if (membership && membership.membershipId) {
                  const getMembership = httpsCallable(fns, 'getMembership')
                  const mres = await getMembership({ membershipId: membership.membershipId })
                  const mdata = mres?.data || null
                  if (mdata) {
                    try { if (mdata.membershipId) delete mdata.membershipId } catch {}
                    setMembership({ membershipId: mres.data.membershipId, ...(mres.data || {}) })
                  }
                }
              } catch (err) {
                console.warn('Failed to refresh membership after Stripe saveTransaction', err)
              }

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

  const finalizeBillplz = useCallback(async ({ billId, membershipId = null, redeemedPoints = 0, discountAmount = 0 }) => {
    setFinalizing(true)
    try {
      const finalize = httpsCallable(fns, 'finalizeBillplzTransaction')
      const fr = await finalize({
        stationId,
        billId,
        amount: effectiveAmount,
        items: cart,
        membershipId: membershipId || null,
        redeemedPoints: Number(redeemedPoints || 0),
        discountAmount: Number(discountAmount || 0),
      })
      const txId = fr?.data?.txId
      if (txId) setLastTxId(String(txId))
      const receiptToken = fr?.data?.receiptToken
      if (receiptToken) setLastReceiptToken(String(receiptToken))
      // Refresh membership so receipt shows updated points
      try {
        if (membership && membership.membershipId) {
          const getMembership = httpsCallable(fns, 'getMembership')
          const mres = await getMembership({ membershipId: membership.membershipId })
          const mdata = mres?.data || null
          if (mdata) {
            try { if (mdata.membershipId) delete mdata.membershipId } catch {}
            setMembership({ membershipId: mres.data.membershipId, ...(mres.data || {}) })
          }
        }
      } catch (err) {
        console.warn('Failed to refresh membership after finalizeBillplz', err)
      }
      setStep('RECEIPT')
    } catch (e) {
      console.error('Finalize Billplz transaction failed', e)
      setError(e?.message || 'Payment was received but failed to record transaction')
    } finally {
      setFinalizing(false)
    }
  }, [effectiveAmount, cart, setLastReceiptToken, setLastTxId, setStep, stationId])

  // Realtime RTDB listener for instant Billplz callback/status updates.
  useEffect(() => {
    if (!bill?.billId || !rtdb) return undefined
    const statusPath = `billplz_status/${String(bill.billId)}`
    const statusRef = dbRef(rtdb, statusPath)

    const unsubscribe = onValue(statusRef, (snap) => {
      const val = snap.val()
      if (!val) return
      // Merge RTDB status into billStatus so UI can show it
      try { setBillStatus(s => ({ ...(s || {}), ...val })) } catch {}

      const status = String(val.status || '').toLowerCase()
      const state = String(val.state || '').toLowerCase()

      if (status === 'paid') {
        stopPolling()
        ;(async () => {
            try {
            await finalizeBillplz({ billId: bill.billId, membershipId: membership?.membershipId, redeemedPoints: redeemPoints, promoCode: promoCode })
          } catch (e) {
            console.error('Finalize Billplz (RTDB) failed', e)
            setError(e?.message || 'Payment was received but failed to record transaction')
          }
        })()
        return
      }

      // If callback payload explicitly marks paid=false, treat as failure.
      if (val.callback && Object.prototype.hasOwnProperty.call(val.callback, 'paid')) {
        const cbPaid = val.callback.paid
        const cbPaidBool = (typeof cbPaid === 'boolean') ? cbPaid : String(cbPaid).toLowerCase() === 'true'
        if (cbPaidBool === false) {
          stopPolling()
          setError('Payment not successful. Please try again.')
          return
        }
      }

      const terminalFailStates = ['failed', 'cancelled', 'canceled', 'expired', 'deleted']
      if (state && terminalFailStates.includes(state)) {
        stopPolling()
        setError(`Payment ${state}. Please try again.`)
        return
      }
    })

    return () => {
      try { unsubscribe() } catch {}
    }
  }, [bill?.billId, rtdb, finalizeBillplz, stopPolling])

  const startBillplz = async () => {
    setError('')
    setBillStatus(null)
    setLoading(true)
    try {
      resetBillplz()
      const createBill = httpsCallable(fns, 'createBillplzBill')
      const res = await createBill({
        stationId,
        amount: effectiveAmount,
        description: `RFID Checkout - ${stationId} (${cart.length} item(s))`,
      })

      const data = res?.data || {}
      if (!data.billId || !data.billUrl) throw new Error('Invalid Billplz response')
      const nextBill = { billId: String(data.billId), billUrl: String(data.billUrl) }
      setBill(nextBill)

      // Start polling
      stopPolling()
      const getBill = httpsCallable(fns, 'getBillplzBill')
      const startedAt = Date.now()
      const maxWaitMs = 5 * 60 * 1000
      
      setPolling(true)
      pollRef.current = setInterval(async () => {
        try {
          if (Date.now() - startedAt > maxWaitMs) {
            stopPolling()
            setError('Payment timed out. Please try again.')
            return
          }

          const r = await getBill({ billId: nextBill.billId })
          const s = r?.data || {}
          setBillStatus(s)
          // Helpful debug log to inspect returned Billplz status
          console.debug('Billplz poll status', s)
          const state = String(s.state || '').toLowerCase()
          if (s.paid) {
            stopPolling()
              try {
              await finalizeBillplz({ billId: nextBill.billId, membershipId: membership?.membershipId, redeemedPoints: redeemPoints, promoCode: promoCode })
            } catch (e) {
              console.error('Finalize Billplz transaction failed', e)
              setError(e?.message || 'Payment was received but failed to record transaction')
            }
          } else {
            // If Billplz has already hit our callback URL with paid=false, treat this as a terminal not-paid outcome.
            if (s.callbackReceivedAt && s.callbackPaid === false) {
              stopPolling()
              setError('Payment not successful. Please try again.')
              return
            }

            const state = String(s.state || '').toLowerCase()
            const terminalFailStates = ['failed', 'cancelled', 'canceled', 'expired', 'deleted']
            if (state && terminalFailStates.includes(state)) {
              stopPolling()
              setError(`Payment ${state}. Please try again.`)
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

  const endToStart = () => {
    touchActivity?.()
    resetBillplz()
    resetStripe()
    setError('')
    try { setLastTxId(null) } catch { /* ignore */ }
    try { setLastReceiptToken(null) } catch { /* ignore */ }
    try { end?.() } catch { /* ignore */ }
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
          {/* Show payment selection only if no QR is active */}
          {!(method === 'BILLPLZ' && bill?.billUrl) && !(method === 'STRIPE' && stripeSession?.url) && (
            <>
              <Typography variant="subtitle1" sx={{ fontWeight: 900, mb: 1 }}>Payment method</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Button
                  variant={method === 'BILLPLZ' ? 'contained' : 'outlined'}
                  onClick={() => onSelectMethod('BILLPLZ')}
                  disabled={loading || finalizing}
                  sx={{
                    py: 1.6,
                    justifyContent: 'space-between',
                    fontWeight: 900,
                    '&.MuiButton-contained': { backgroundColor: '#a259ff', color: '#fff', '&:hover': { backgroundColor: '#8b45e6' } },
                    '&.MuiButton-outlined': { borderColor: '#a259ff', color: '#a259ff', '&:hover': { borderColor: '#8b45e6', backgroundColor: 'rgba(162,89,255,0.04)' } },
                  }}
                >
                  Online Payment & QR
                </Button>
                <Button
                  variant={method === 'STRIPE' ? 'contained' : 'outlined'}
                  onClick={() => onSelectMethod('STRIPE')}
                  disabled={loading || finalizing}
                  sx={{
                    py: 1.6,
                    justifyContent: 'space-between',
                    fontWeight: 900,
                    '&.MuiButton-contained': { backgroundColor: '#a259ff', color: '#fff', '&:hover': { backgroundColor: '#8b45e6' } },
                    '&.MuiButton-outlined': { borderColor: '#a259ff', color: '#a259ff', '&:hover': { borderColor: '#8b45e6', backgroundColor: 'rgba(162,89,255,0.04)' } },
                  }}
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
            </>
          )}
          {/* When QR is generated, show it big and hide payment selection */}
          {method === 'BILLPLZ' && bill?.billUrl && (
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }} ref={qrSectionRef}>
              <Box sx={{
                border: '5px solid #a259ff',
                borderRadius: 4,
                p: 1.5,
                mb: 2,
                display: 'inline-block',
                background: 'white',
              }}>
                <QRCode value={bill.billUrl} size={340} level="M" style={{ margin: '0 auto' }} />
              </Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 900, mt: 1 }}>Scan to pay</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                Use your phone to open the online payment page.
              </Typography>
              {/* Payment link button removed as requested */}
              <Box sx={{ fontSize: 13, opacity: 0.85, mb: 0.5 }}>
                Status: {billStatus?.paid
                  ? 'Paid'
                  : (billStatus?.callbackReceivedAt && billStatus?.callbackPaid === false)
                    ? 'Not successful'
                    : (billStatus?.state || 'Pending')}
              </Box>
              {/* Debug box removed in production */}
              <Box sx={{ fontSize: 13, opacity: 0.85 }}>
                Bill ID: <strong>{bill.billId}</strong>
              </Box>
              <Box
                sx={{
                  mt: 2,
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <Box
                  sx={{
                    background: '#a259ff',
                    color: 'white',
                    borderRadius: 2,
                    px: 3,
                    py: 0.5,
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: 1,
                    boxShadow: '0 2px 8px 0 rgba(162,89,255,0.08)',
                  }}
                >
                  naz system
                </Box>
              </Box>
            </Box>
          )}
          {method === 'STRIPE' && stripeSession?.url && (
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }} ref={qrSectionRef}>
              <Box sx={{
                border: '5px solid #a259ff',
                borderRadius: 4,
                p: 1.5,
                mb: 2,
                display: 'inline-block',
                background: 'white',
              }}>
                <QRCode value={stripeSession.url} size={340} level="M" style={{ margin: '0 auto' }} />
              </Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 900, mt: 1 }}>Scan to pay</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                Use your phone to open Stripe Checkout.
              </Typography>
              {/* Payment link button removed as requested */}
              <Box sx={{ fontSize: 13, opacity: 0.85, mb: 0.5 }}>
                Status: {String(stripeStatus?.paymentStatus || '').toLowerCase() === 'paid' ? 'Paid' : (stripeStatus?.paymentStatus || stripeStatus?.status || 'Pending')}
              </Box>
              <Box sx={{ fontSize: 13, opacity: 0.85 }}>
                Session: <strong>{stripeSession.sessionId}</strong>
              </Box>
              <Box
                sx={{
                  mt: 2,
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                }}
              >
                <Box
                  sx={{
                    background: '#a259ff',
                    color: 'white',
                    borderRadius: 2,
                    px: 3,
                    py: 0.5,
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: 1,
                    boxShadow: '0 2px 8px 0 rgba(162,89,255,0.08)',
                  }}
                >
                  naz system
                </Box>
              </Box>
            </Box>
          )}
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

            <Button variant="outlined" onClick={goBack} disabled={loading || finalizing} sx={{ borderColor: '#a259ff', color: '#a259ff', '&:hover': { borderColor: '#8b45e6', backgroundColor: 'rgba(162,89,255,0.04)' } }}>
              Back to scanning
            </Button>
          </Box>

          <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{(discountAmount && Number(discountAmount) > 0) || (redeemPoints && Number(redeemPoints) > 0) ? 'Total (Payable)' : 'Total'}</Typography>
            <Typography variant="h4" sx={{ fontWeight: 950 }}>{effectiveLabel}</Typography>
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

          {membership && membership.name ? (
            <Paper variant="outlined" sx={{ mt: 1.5, p: 1, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>Member</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>{membership.name} • {typeof membership.points === 'number' ? `${membership.points} pts` : '—'}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField
                    label="Redeem points"
                    type="number"
                    size="small"
                    value={redeemPoints || 0}
                    onChange={(e) => setRedeemPoints(Math.max(0, Math.floor(Number(e.target.value || 0))))}
                    inputProps={{ min: 0, max: membership?.points || 0 }}
                    sx={{ width: 160 }}
                  />
                  <Button onClick={() => setRedeemPoints(Math.min(Number(membership?.points || 0), Math.floor(Number(amount || 0) / POINT_TO_MYR)))} size="small" variant="outlined">Max</Button>
                </Box>
              </Box>
                <Box sx={{ mt: 1, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TextField size="small" label="Promo code" value={promoCode} onChange={(e) => setPromoCode(e.target.value)} sx={{ width: 160 }} />
                  <Button size="small" variant="outlined" onClick={async () => {
                    setPromoChecking(true)
                    try {
                      const validate = httpsCallable(fns, 'validatePromoCode')
                      const res = await validate({ code: promoCode, subtotal: amount, stationId })
                      const d = res?.data || {}
                      if (d?.valid) setPromoPreview(d)
                      else setPromoPreview({ valid: false, reason: d?.reason || 'invalid' })
                    } catch (err) {
                      setPromoPreview({ valid: false, reason: err?.message || 'failed' })
                    } finally { setPromoChecking(false) }
                  }}>Apply</Button>
                  <Box sx={{ ml: 1 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>Discount: {formatMoney(promoDiscount + Number(discountAmount || 0))} • Payable: {effectiveLabel}</Typography>
                  </Box>
                </Box>
            </Paper>
          ) : null}

          {error ? (
            <Alert
              severity="error"
              sx={{ mt: 1.5 }}
              action={(
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      touchActivity?.()
                      endToStart()
                    }}
                    disabled={loading || finalizing}
                    sx={{ borderColor: '#a259ff', color: '#a259ff', '&:hover': { borderColor: '#8b45e6', backgroundColor: 'rgba(162,89,255,0.04)' } }}
                    >
                      End now
                    </Button>
                </Box>
              )}
            >
              {error}
            </Alert>
          ) : null}

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
                    sx={{ py: 1.4, px: 2.5, backgroundColor: '#a259ff', color: '#fff', '&:hover': { backgroundColor: '#8b45e6' } }}
                  >
                      {loading ? <CircularProgress size={18} /> : 'Show QR to Pay'}
                  </Button>

                  <Button
                    color="error"
                    variant="contained"
                    onClick={() => { touchActivity?.(); setOpenCancelConfirm(true) }}
                    sx={{ py: 1.4, px: 2.5 }}
                  >
                    Cancel
                  </Button>

                  {bill?.billUrl ? (
                    <Button
                      variant="outlined"
                      onClick={() => { touchActivity?.(); resetBillplz() }}
                      disabled={loading || finalizing}
                      sx={{ borderColor: '#a259ff', color: '#a259ff', '&:hover': { borderColor: '#8b45e6', backgroundColor: 'rgba(162,89,255,0.04)' } }}
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
                    sx={{ py: 1.4, px: 2.5, backgroundColor: '#a259ff', color: '#fff', '&:hover': { backgroundColor: '#8b45e6' } }}
                  >
                      {loading ? <CircularProgress size={18} /> : 'Show QR to Pay'}
                  </Button>

                  <Button
                    color="error"
                    variant="contained"
                    onClick={() => { touchActivity?.(); setOpenCancelConfirm(true) }}
                    sx={{ py: 1.4, px: 2.5 }}
                  >
                    Cancel
                  </Button>

                  {stripeSession?.url ? (
                    <Button
                      variant="outlined"
                      onClick={() => { touchActivity?.(); resetStripe() }}
                      disabled={loading || finalizing}
                      sx={{ borderColor: '#a259ff', color: '#a259ff', '&:hover': { borderColor: '#8b45e6', backgroundColor: 'rgba(162,89,255,0.04)' } }}
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

          <Dialog
            open={openCancelConfirm}
            onClose={() => setOpenCancelConfirm(false)}
            aria-labelledby="cancel-payment-dialog-title"
            container={() => document.fullscreenElement || document.body}
            disablePortal
          >
            <DialogTitle id="cancel-payment-dialog-title">Cancel Transaction?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                This will clear the current cart and return to the station start screen. Are you sure you want to cancel this transaction?
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpenCancelConfirm(false)} sx={{ backgroundColor: '#a259ff', color: '#fff', '&:hover': { backgroundColor: '#8b45e6' } }}>No, keep it</Button>
              <Button
                color="error"
                onClick={() => {
                  try {
                    endToStart()
                  } catch {
                    try { end?.() } catch { /* ignore */ }
                    try { setStep('IDLE') } catch { /* ignore */ }
                  }
                  setOpenCancelConfirm(false)
                }}
                autoFocus
              >
                Yes, cancel
              </Button>
            </DialogActions>
          </Dialog>
        </Paper>
      </Box>
    </Box>
  )
}
