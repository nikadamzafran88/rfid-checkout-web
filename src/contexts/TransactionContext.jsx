import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { auth, db, rtdb, fns } from '../services/firebase'
import { ref as rdbRef, onValue, set as rdbSet, onDisconnect, update, serverTimestamp } from 'firebase/database'
import { collection, query, where, getDocs, doc as fsDoc, setDoc, serverTimestamp as firestoreServerTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'

const TransactionContext = createContext(null)

export function useTransaction() {
  return useContext(TransactionContext)
}

export function TransactionProvider({ children }) {
  const [stationId, setStationId] = useState(() => localStorage.getItem('station_id') || '')
  const [step, setStep] = useState('IDLE') // IDLE, SCANNING, PAYMENT, RECEIPT
  const [cart, setCart] = useState([])
  const [amount, setAmount] = useState(0)
  const [lastTxId, setLastTxId] = useState(null)
  const [lastReceiptToken, setLastReceiptToken] = useState(null)
  const [membership, setMembership] = useState(() => {
    try {
      const raw = localStorage.getItem('membership')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [lastActivity, setLastActivity] = useState(() => Date.now())
  const [redeemPoints, setRedeemPoints] = useState(0)
  const POINT_TO_MYR = 0.01 // 1 point = RM0.01
  const discountAmount = Math.max(0, Math.round((Number(redeemPoints || 0) * POINT_TO_MYR) * 100) / 100)
  const [lastTransactionDiscount, setLastTransactionDiscount] = useState(0)
  const [lastTransactionRedeemedAmount, setLastTransactionRedeemedAmount] = useState(0)
  const [idleRemainingSeconds, setIdleRemainingSeconds] = useState(0)
  const [rtdbConnected, setRtdbConnected] = useState(false)
  const IDLE_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes inactivity -> reset to IDLE

  const addItem = useCallback((item) => {
    setCart((c) => [...c, item])
  }, [])

  useEffect(() => {
    const total = cart.reduce((s, it) => s + (it.price || 0), 0)
    setAmount(total)
  }, [cart])

  const saveTransaction = useCallback(async (paymentMethod = 'SIMULATED', paymentDetails = null) => {
    if (!stationId) throw new Error('stationId missing')
    const customerUID = auth?.currentUser?.uid || 'Guest'
    const paymentStatus = paymentMethod === 'BILLPLZ' ? 'Paid (Billplz)' : paymentMethod === 'STRIPE' ? 'Paid (Stripe)' : 'Paid'

    const recordTx = httpsCallable(fns, 'recordTransactionAndDecrement')
    const payloadAmount = paymentDetails && Number(paymentDetails.amountOverride) >= 0 ? Number(paymentDetails.amountOverride) : Number(amount || 0)
    const res = await recordTx({
      stationId,
      amount: payloadAmount,
      items: cart,
      paymentMethod,
      paymentDetails: paymentDetails || null,
      membershipId: membership?.membershipId || null,
      redeemedPoints: Number(redeemPoints || 0),
      discountAmount: Number(discountAmount || 0),
      promoCode: paymentDetails?.promoCode || null,
      // Keep customerUID in doc (function will use auth uid; this is informational only)
      customerUID,
      paymentStatus,
    })

    const txId = res?.data?.txId
    if (!txId) throw new Error('Failed to record transaction')
    const receiptToken = res?.data?.receiptToken ? String(res.data.receiptToken) : null
    setLastTxId(String(txId))
    setLastReceiptToken(receiptToken)
    // capture server-applied discounts: promo and redeemed amounts
    try {
      const serverPromo = Number(res?.data?.promoDiscount || 0)
      const serverRedeemed = Number(res?.data?.redeemedAmount || 0)
      setLastTransactionDiscount(Number.isFinite(serverPromo) ? serverPromo : 0)
      setLastTransactionRedeemedAmount(Number.isFinite(serverRedeemed) ? serverRedeemed : 0)
    } catch {}
    // clear any in-progress redemption selection now that transaction recorded
    try { setRedeemPoints(0) } catch {}

    // Refresh membership data after transaction so UI shows updated points
    try {
      if (membership && membership.membershipId) {
        const getMembership = httpsCallable(fns, 'getMembership')
        const mres = await getMembership({ membershipId: membership.membershipId })
        const mdata = mres?.data || null
        if (mdata) {
          try {
            if (mdata.membershipId) delete mdata.membershipId
          } catch {}
          setMembership({ membershipId: mres.data.membershipId, ...(mres.data || {}) })
        }
      }
    } catch (e) {
      console.warn('Failed to refresh membership after transaction', e)
    }

    // Persist sold RFID UIDs so scanning them again will show "sold" until the tag is moved.
    try {
      const writes = []
      for (const it of cart) {
        const uid = it?.uid
        const productId = it?.id || it?.productId || null
        if (uid && productId) {
          writes.push(
            setDoc(fsDoc(db, 'soldRFIDs', String(uid)), {
              productId: String(productId),
              txId: String(txId),
              soldAt: firestoreServerTimestamp(),
            })
          )
        }
      }
      if (writes.length > 0) await Promise.all(writes)
    } catch (e) {
      console.warn('Failed to write soldRFIDs markers', e)
    }
    return { id: String(txId), receiptToken }
  }, [cart, amount, stationId, membership, redeemPoints, discountAmount])

  // Bound setter for redeem points (ensure not negative)
  const setRedeemPointsBounded = useCallback((n) => {
    const v = Math.max(0, Math.floor(Number(n) || 0))
    setRedeemPoints(v)
  }, [])

  const clearCart = useCallback(() => {
    setCart([])
    setAmount(0)
  }, [])

  const touchActivity = useCallback(() => {
    setLastActivity(Date.now())
  }, [])

  // Global RTDB connectivity (used for kiosk RFID status indicator).
  useEffect(() => {
    const connRef = rdbRef(rtdb, '.info/connected')
    const unsub = onValue(connRef, (snap) => {
      setRtdbConnected(Boolean(snap.val()))
    })
    return () => {
      try { unsub() } catch { /* ignore */ }
    }
  }, [])

  // When entering an active step, treat it as user activity so we don't immediately time out
  // if the kiosk sat on the welcome screen for a long time.
  useEffect(() => {
    if (step === 'SCANNING' || step === 'PAYMENT') {
      setLastActivity(Date.now())
    }
  }, [step])

  // Realtime presence: mark this station online/offline in RTDB while kiosk is open.
  useEffect(() => {
    if (!stationId) return undefined

    const presencePath = `stations_presence/${stationId}`
    const presenceRef = rdbRef(rtdb, presencePath)
    const connRef = rdbRef(rtdb, '.info/connected')

    let heartbeatTimer = null
    const unsub = onValue(connRef, (snap) => {
      const connected = !!snap.val()
      if (!connected) return

      // Ensure we flip to offline if the client disconnects unexpectedly.
      try {
        onDisconnect(presenceRef).update({ online: false, lastSeen: serverTimestamp() })
      } catch {
        // ignore
      }

      // Mark online immediately.
      try {
        update(presenceRef, { online: true, lastSeen: serverTimestamp() })
      } catch {
        // ignore
      }

      // Heartbeat so Station Management can treat stale sessions as offline.
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = setInterval(() => {
        try {
          update(presenceRef, { online: true, lastSeen: serverTimestamp() })
        } catch {
          // ignore
        }
      }, 20000)
    })

    return () => {
      try { if (heartbeatTimer) clearInterval(heartbeatTimer) } catch { /* ignore */ }
      try { unsub() } catch { /* ignore */ }
      // Best-effort offline update on clean unmount.
      try { update(presenceRef, { online: false, lastSeen: serverTimestamp() }) } catch { /* ignore */ }
    }
  }, [stationId])

  // Auto-reset to IDLE after inactivity while in SCANNING or PAYMENT.
  // Also expose a 1s countdown so kiosk pages can show "auto reset in mm:ss".
  useEffect(() => {
    const active = step === 'SCANNING' || step === 'PAYMENT'
    if (!active) {
      setIdleRemainingSeconds(0)
      return undefined
    }

    const tick = () => {
      const msLeft = IDLE_TIMEOUT_MS - (Date.now() - lastActivity)
      const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000))
      setIdleRemainingSeconds(secondsLeft)
      if (msLeft <= 0) {
        clearCart()
        setStep('IDLE')
      }
    }

    tick()
    const t = setInterval(tick, 1000)
    return () => {
      try { clearInterval(t) } catch { /* ignore */ }
    }
  }, [step, lastActivity, clearCart])

  const start = useCallback((id) => {
    if (id) {
      setStationId(id)
      localStorage.setItem('station_id', id)
    }
    setCart([])
    setLastActivity(Date.now())
    setStep('MEMBERSHIP')
  }, [])

  const end = useCallback(() => {
    clearCart()
    setStep('IDLE')
    setLastReceiptToken(null)
  }, [clearCart])

  const value = {
    stationId,
    setStationId: (id) => { setStationId(id); localStorage.setItem('station_id', id) },
    membership,
    setMembership: (m) => {
      try { if (m) localStorage.setItem('membership', JSON.stringify(m)); else localStorage.removeItem('membership') } catch {}
      setMembership(m)
    },
    step,
    setStep,
    cart,
    amount,
    addItem,
    start,
    saveTransaction,
    clearCart,
    end,
    lastTxId,
    setLastTxId,
    lastReceiptToken,
    setLastReceiptToken,
    lastActivity,
    touchActivity,
    idleRemainingSeconds,
    rtdbConnected,
    rtdb, // expose for scanning component
    rdbRef,
    onValue,
    rdbSet,
    db,
    query,
    collection,
    where,
    getDocs
    ,
    redeemPoints,
    setRedeemPoints: setRedeemPointsBounded,
    discountAmount,
    lastTransactionDiscount,
    lastTransactionRedeemedAmount,
    setLastTransactionDiscount,
    setLastTransactionRedeemedAmount,
    POINT_TO_MYR,
  }

  return (
    <TransactionContext.Provider value={value}>
      {children}
    </TransactionContext.Provider>
  )
}

export default TransactionContext
