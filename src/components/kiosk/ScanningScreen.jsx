import React, { useEffect, useState, useRef } from 'react'
import {
  Box,
  Button,
  Typography,
  Paper,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material'
import { useTransaction } from '../../contexts/TransactionContext'
import { get as rtdbGet } from 'firebase/database'
import { doc, getDoc } from 'firebase/firestore'

export default function ScanningScreen() {
  const {
    stationId,
    rtdb,
    rdbRef,
    onValue,
    rdbSet,
    db,
    query,
    collection,
    where,
    getDocs,
    addItem,
    cart,
    setStep,
    touchActivity,
    clearCart,
    end,
  } = useTransaction()

  const { membership } = useTransaction()

  const [autoCountdown, setAutoCountdown] = useState(0)
  const autoProceedRef = useRef(null)
  const [openCancelConfirm, setOpenCancelConfirm] = useState(false)
  const [scanError, setScanError] = useState('')

  const [lastScannedPreview, setLastScannedPreview] = useState(null)
  const [showLastScannedPreview, setShowLastScannedPreview] = useState(false)
  const lastScannedTimeoutRef = useRef(null)

  const processedUidsRef = useRef(new Set())
  const cartRef = useRef(cart)
  const cartEndRef = useRef(null)
  const prevCartLenRef = useRef(cart.length)

  useEffect(() => {
    cartRef.current = cart
  }, [cart])

  // Keep the newest scanned item visible in long carts + show a brief preview on the left.
  useEffect(() => {
    const prevLen = prevCartLenRef.current
    prevCartLenRef.current = cart.length

    if (cart.length === 0) {
      setShowLastScannedPreview(false)
      setLastScannedPreview(null)
      if (lastScannedTimeoutRef.current) {
        clearTimeout(lastScannedTimeoutRef.current)
        lastScannedTimeoutRef.current = null
      }
      return
    }

    if (cart.length <= prevLen) return

    const newest = cart[cart.length - 1] || null
    setLastScannedPreview(newest)
    setShowLastScannedPreview(true)

    if (lastScannedTimeoutRef.current) {
      clearTimeout(lastScannedTimeoutRef.current)
      lastScannedTimeoutRef.current = null
    }
    lastScannedTimeoutRef.current = setTimeout(() => {
      setShowLastScannedPreview(false)
    }, 5500)

    const t = setTimeout(() => {
      try {
        cartEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      } catch {
        // ignore
      }
    }, 50)

    return () => clearTimeout(t)
  }, [cart])

  useEffect(() => {
    // New transaction: allow scanning the same UIDs again.
    if (cart.length === 0) processedUidsRef.current = new Set()
  }, [cart.length])

  useEffect(() => {
    if (!stationId) return
    processedUidsRef.current = new Set()

    // Flag to ignore initial listener values until paths are cleared
    let isReady = false

    const normalizeUid = (v) => String(v || '').trim()

    const processUid = async (uidRaw, clearRef = null) => {
      const uid = normalizeUid(uidRaw)
      if (!uid) return

      // Ignore scans until we've cleared stale data
      if (!isReady) {
        if (clearRef) {
          try {
            await rdbSet(clearRef, null)
          } catch {
            // ignore
          }
        }
        return
      }

      const alreadyInCart = cartRef.current.some(
        (it) => String(it?.uid || '').trim() === uid || String(it?.id || '') === `unknown_${uid}`
      )
      if (alreadyInCart) {
        if (clearRef) {
          try {
            await rdbSet(clearRef, null)
          } catch {
            // ignore
          }
        }
        return
      }

      if (processedUidsRef.current.has(uid)) {
        if (clearRef) {
          try {
            await rdbSet(clearRef, null)
          } catch {
            // ignore
          }
        }
        return
      }

      processedUidsRef.current.add(uid)
      touchActivity()

      try {
        let handled = false
        const productsRef = collection(db, 'products')

        // Try common RFID field first.
        let docs = await getDocs(query(productsRef, where('RFID_tag_UID', '==', uid)))

        // Then RTDB tag map (tags/{uid} -> productId)
        if (docs.empty) {
          try {
            const tagSnap = await rtdbGet(rdbRef(rtdb, `tags/${uid}`))
            const productId =
              tagSnap && typeof tagSnap.exists === 'function' && tagSnap.exists() ? tagSnap.val() : null

            if (productId) {
              const prodSnap = await getDoc(doc(db, 'products', String(productId)))
              if (prodSnap.exists()) {
                const data = prodSnap.data() || {}
                // check sold UID marker first
                try {
                  const soldSnap = await getDoc(doc(db, 'soldRFIDs', uid))
                  if (soldSnap.exists()) {
                    const soldData = soldSnap.data() || {}
                    const soldProduct = String(soldData.productId || '')
                    if (soldProduct === String(prodSnap.id)) {
                      setScanError('This RFID tag has already been sold with this item. Move the tag to another product to use it.')
                      setTimeout(() => setScanError(''), 3500)
                      handled = true
                    }
                  }
                } catch (e) {
                  // ignore sold marker check failures and continue to inventory check
                }

                // check inventory before adding to cart
                try {
                  const invRef = doc(db, 'inventory', prodSnap.id)
                  const invSnap = await getDoc(invRef)
                  const stock = invSnap.exists() ? Number(invSnap.data()?.stockLevel ?? 0) || 0 : 0
                  if (stock <= 0) {
                    setScanError('This item appears to be out of stock / already sold.')
                    setTimeout(() => setScanError(''), 3500)
                    handled = true
                  } else {
                    addItem({
                      id: prodSnap.id,
                      uid,
                      sku: data.sku || data.RFID_tag_UID || uid,
                      name: data.name || `Product ${prodSnap.id}`,
                      price: data.price || 0,
                      image_url: data.image_url || '',
                    })
                    handled = true
                  }
                } catch (e) {
                  console.warn('inventory check failed', e)
                  addItem({
                    id: prodSnap.id,
                    uid,
                    sku: data.sku || data.RFID_tag_UID || uid,
                    name: data.name || `Product ${prodSnap.id}`,
                    price: data.price || 0,
                    image_url: data.image_url || '',
                  })
                  handled = true
                }
              }
            }
          } catch {
            // ignore
          }

          // Finally try SKU == UID.
          if (!handled) {
            docs = await getDocs(query(productsRef, where('sku', '==', uid)))
          }
        }

        if (!handled && !docs.empty) {
          const d = docs.docs[0]
          const data = d.data() || {}
          try {
            // check sold UID marker first
            try {
              const soldSnap2 = await getDoc(doc(db, 'soldRFIDs', uid))
              if (soldSnap2.exists()) {
                const soldData2 = soldSnap2.data() || {}
                const soldProduct2 = String(soldData2.productId || '')
                if (soldProduct2 === String(d.id)) {
                  setScanError('This RFID tag has already been sold with this item. Move the tag to another product to use it.')
                  setTimeout(() => setScanError(''), 3500)
                  handled = true
                }
              }
            } catch (e) {
              // ignore
            }

            const invRef = doc(db, 'inventory', d.id)
            const invSnap = await getDoc(invRef)
            const stock = invSnap.exists() ? Number(invSnap.data()?.stockLevel ?? 0) || 0 : 0
            if (stock <= 0) {
              setScanError('This item appears to be out of stock / already sold.')
              setTimeout(() => setScanError(''), 3500)
              handled = true
            } else {
              addItem({
                id: d.id,
                uid,
                sku: data.sku || data.RFID_tag_UID || uid,
                name: data.name,
                price: data.price || 0,
                image_url: data.image_url || '',
              })
              handled = true
            }
          } catch (e) {
            console.warn('inventory check failed', e)
            addItem({
              id: d.id,
              uid,
              sku: data.sku || data.RFID_tag_UID || uid,
              name: data.name,
              price: data.price || 0,
              image_url: data.image_url || '',
            })
            handled = true
          }
        }

        if (!handled) {
          // If UID isn't mapped to any product, show a clear message and do not add to cart.
          setScanError('This RFID tag is not registered to any product.')
          setTimeout(() => setScanError(''), 3500)
          handled = true
        }
      } catch (err) {
        console.error('lookup error', err)
      } finally {
        if (clearRef) {
          try {
            await rdbSet(clearRef, null)
          } catch {
            // ignore
          }
        }
      }
    }

    // Render scan error alert briefly (inside effect's scope we can't render, so expose state)

    // Clear stale scan paths first, then enable processing
    const clearAndEnable = async () => {
      try {
        await rdbSet(rdbRef(rtdb, 'system/last_scanned_uid'), null)
      } catch { /* ignore */ }
      try {
        await rdbSet(rdbRef(rtdb, `stations/${stationId}/current_scan`), null)
      } catch { /* ignore */ }
      try {
        await rdbSet(rdbRef(rtdb, `checkout_cart/${stationId}/scanned_items`), null)
      } catch { /* ignore */ }
      // Now ready to process new scans
      isReady = true
    }
    clearAndEnable()

    const legacyPath = `stations/${stationId}/current_scan`
    const legacyRef = rdbRef(rtdb, legacyPath)
    const unsubLegacy = onValue(
      legacyRef,
      async (snap) => {
        const uid = snap.val()
        if (!uid) return
        await processUid(uid, legacyRef)
      },
      () => {}
    )

    const espPath = `checkout_cart/${stationId}/scanned_items`
    const espRef = rdbRef(rtdb, espPath)
    const unsubEsp = onValue(
      espRef,
      async (snap) => {
        const v = snap.val()
        if (!v) return

        if (typeof v === 'string' || typeof v === 'number') {
          await processUid(v, espRef)
          return
        }

        if (typeof v === 'object') {
          const uids = Object.keys(v)
            .map((k) => normalizeUid(k))
            .filter(Boolean)

          for (const uid of uids) {
            const childRef = rdbRef(rtdb, `${espPath}/${uid}`)
            await processUid(uid, childRef)
          }
        }
      },
      () => {}
    )

    const clipPath = 'system/last_scanned_uid'
    const clipRef = rdbRef(rtdb, clipPath)
    const unsubClip = onValue(
      clipRef,
      async (snap) => {
        const uid = snap.val()
        if (!uid) return
        await processUid(uid, clipRef)
      },
      () => {}
    )

    return () => {
      try {
        unsubLegacy()
      } catch {
        // ignore
      }
      try {
        unsubEsp()
      } catch {
        // ignore
      }
      try {
        unsubClip()
      } catch {
        // ignore
      }
    }
  }, [stationId, rtdb, rdbRef, onValue, rdbSet, db, query, collection, where, getDocs, addItem, touchActivity])

  const totalAmount = cart.reduce((s, it) => s + (it.price || 0), 0)

  // Auto-proceed: when cart has items start a countdown to auto open payment.
  useEffect(() => {
    if (cart.length === 0) {
      setAutoCountdown(0)
      if (autoProceedRef.current) {
        clearInterval(autoProceedRef.current)
        autoProceedRef.current = null
      }
      return
    }

    let seconds = 15
    setAutoCountdown(seconds)

    if (autoProceedRef.current) clearInterval(autoProceedRef.current)
    autoProceedRef.current = setInterval(() => {
      seconds -= 1
      setAutoCountdown(seconds)
      if (seconds <= 0) {
        clearInterval(autoProceedRef.current)
        autoProceedRef.current = null
        setStep('PAYMENT')
      }
    }, 1000)

    return () => {
      if (autoProceedRef.current) {
        clearInterval(autoProceedRef.current)
        autoProceedRef.current = null
      }
    }
  }, [cart.length, setStep])

  return (
    <Box
      sx={{
        p: 3,
        height: '100%',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
        pb: '56px',
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        {/* Left: scan instructions */}
        <Box>
          {/* Auto-proceed alert moved under the Proceed button */}

          {scanError ? (
            <Alert severity="error" sx={{ mb: 1.25 }}>
              {scanError}
            </Alert>
          ) : null}

          {membership && membership.name ? (
            <>
              <Typography sx={{ fontWeight: 800, mb: 0.25, color: '#a259ff', fontSize: '1.25rem' }}>{`Hello ${membership.name}`}</Typography>
              {typeof membership.points === 'number' ? (
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.25 }}>
                  {`Points: ${membership.points}`}
                </Typography>
              ) : null}
            </>
          ) : null}

          {showLastScannedPreview && lastScannedPreview ? (
            <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 900, mb: 1 }}>Item scanned</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                {lastScannedPreview.image_url ? (
                  <Box
                    component="img"
                    src={lastScannedPreview.image_url}
                    alt={lastScannedPreview.name}
                    sx={{
                      width: { xs: 160, md: 220 },
                      height: { xs: 160, md: 220 },
                      borderRadius: 2,
                      objectFit: 'cover',
                      border: '2px solid',
                      borderColor: 'divider',
                      
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: { xs: 160, md: 220 },
                      height: { xs: 160, md: 220 },
                      borderRadius: 2,
                      border: '2px dashed',
                      borderColor: 'divider',
                      display: 'block',
                    }}
                  />
                )}

                <Box sx={{ textAlign: 'center', width: '100%' }}>
                  <Typography sx={{ fontWeight: 900 }}>{lastScannedPreview.name || 'Item'}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {lastScannedPreview.sku
                      ? `SKU: ${lastScannedPreview.sku}`
                      : lastScannedPreview.uid
                        ? `UID: ${lastScannedPreview.uid}`
                        : ''}
                  </Typography>
                  <Typography sx={{ fontWeight: 950, fontSize: 20, mt: 0.5 }}>
                    ${(lastScannedPreview.price || 0).toFixed(2)}
                  </Typography>
                </Box>
              </Box>
            </Paper>
          ) : (
            <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 900, mb: 0.25 }}>Ready to scan</Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                <Box
                  sx={{
                    width: { xs: 160, md: 220 },
                    height: { xs: 160, md: 220 },
                    borderRadius: 2,
                    border: '2px dashed',
                    borderColor: 'divider',
                  }}
                />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Scan item tags to add them to the cart.
              </Typography>
            </Paper>
          )}

          <Paper
            variant="outlined"
            sx={{
              mt: 1.25,
              p: 1.25,
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Box
              component="svg"
              aria-hidden
              viewBox="0 0 24 24"
              sx={{ width: 22, height: 22, flex: '0 0 auto', color: 'text.secondary' }}
            >
              <path d="M12 3v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path
                d="M9 9.5 12 12.5 15 9.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M6.5 10.5 5 20h14l-1.5-9.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="M9 10.5 12 7.5 15 10.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M8 15h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>
              Scan your item to the scanner and put the scanned item into the bag
            </Typography>
          </Paper>

          <Paper
            variant="outlined"
            sx={{
              mt: 1.25,
              p: 1.25,
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: 1,
              flexWrap: 'wrap',
            }}
          >
            <Button
              variant="outlined"
              onClick={() => {
                clearCart()
                setAutoCountdown(0)
              }}
              disabled={cart.length === 0}
              sx={{
                py: 1.25,
                fontWeight: 800,
                minWidth: 120,
                borderColor: '#a259ff',
                color: '#a259ff',
                '&:hover': { borderColor: '#8b45e6', backgroundColor: 'rgba(162,89,255,0.04)' },
              }}
            >
              Clear
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => {
                setOpenCancelConfirm(true)
              }}
              sx={{ py: 1.25, fontWeight: 900, minWidth: 120 }}
            >
              Cancel
            </Button>
          </Paper>
        </Box>

        {/* Right: item list */}
        <Box>
          <Paper variant="outlined" sx={{ borderColor: 'divider', overflow: 'hidden' }}>
            {cart.length === 0 ? (
              <Box sx={{ p: 2 }}>
                <Typography sx={{ fontWeight: 700 }}>No items scanned</Typography>
                <Typography variant="body2" color="text.secondary">
                  Scan an item tag to add it to the list.
                </Typography>
              </Box>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr' }}>
                {cart.map((it, idx) => (
                  <Box
                    key={`${String(it?.id || 'item')}_${idx}`}
                    sx={{
                      px: 2,
                      py: 1.25,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 2,
                      borderBottom: idx === cart.length - 1 ? 'none' : '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                      <Box sx={{ width: 22, textAlign: 'center', color: 'text.secondary', fontSize: 12 }}>
                        {idx + 1}
                      </Box>
                      {it.image_url ? (
                        <Box
                          component="img"
                          src={it.image_url}
                          alt={it.name}
                          sx={{
                            width: 44,
                            height: 44,
                            borderRadius: 1,
                            objectFit: 'cover',
                            border: '1px solid',
                            borderColor: 'divider',
                          }}
                        />
                      ) : (
                        <Box
                          sx={{
                            width: 44,
                            height: 44,
                            borderRadius: 1,
                            border: '1px dashed',
                            borderColor: 'divider',
                          }}
                        />
                      )}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 900 }} noWrap>
                          {it.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {it.sku || ''}
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography sx={{ fontWeight: 900 }}>${(it.price || 0).toFixed(2)}</Typography>
                    </Box>
                  </Box>
                ))}
                <Box ref={cartEndRef} />
              </Box>
            )}

            <Box
              sx={{
                px: 2,
                py: 1.25,
                borderTop: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 1.25,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 2,
                  flexWrap: 'wrap',
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 800, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  Items: <Box component="span" sx={{ color: 'text.primary', fontWeight: 900 }}>{cart.length}</Box>
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, whiteSpace: 'nowrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 800, color: 'text.secondary' }}>
                    Subtotal
                  </Typography>
                  <Typography sx={{ fontWeight: 950, fontSize: 24 }}>${totalAmount.toFixed(2)}</Typography>
                </Box>
              </Box>

              <Button
                variant="contained"
                onClick={() => setStep('PAYMENT')}
                disabled={cart.length === 0}
                fullWidth
                sx={{ py: 1.1, fontWeight: 900, backgroundColor: '#a259ff', color: '#fff', '&:hover': { backgroundColor: '#8b45e6' } }}
              >
                Proceed to Payment
              </Button>
              {autoCountdown > 0 ? (
                <Alert severity="info" sx={{ mt: 1 }}>
                  Auto-proceeding to payment in <strong>{autoCountdown}s</strong>
                </Alert>
              ) : null}
            </Box>
          </Paper>
        </Box>
      </Box>

          <Dialog
            open={openCancelConfirm}
            onClose={() => setOpenCancelConfirm(false)}
            aria-labelledby="cancel-tx-dialog-title"
            // Ensure the dialog is rendered inside the fullscreen element so it appears
            // without exiting browser fullscreen mode.
            container={() => document.fullscreenElement || document.body}
            disablePortal
          >
        <DialogTitle id="cancel-tx-dialog-title">Cancel Transaction?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will clear the current cart and return to the station start screen. Are you sure you want to cancel this transaction?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
              <Button
                onClick={() => setOpenCancelConfirm(false)}
                sx={{ color: '#fff', backgroundColor: '#a259ff', '&:hover': { backgroundColor: '#8b45e6' } }}
              >
                No, keep it
              </Button>
              <Button
                color="error"
                onClick={() => {
                  try {
                    end()
                  } catch {
                    clearCart()
                    setStep('IDLE')
                  }
                  setAutoCountdown(0)
                  setOpenCancelConfirm(false)
                }}
                autoFocus
              >
                Yes, cancel
              </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
