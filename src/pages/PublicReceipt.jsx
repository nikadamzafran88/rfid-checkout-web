import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Box, CircularProgress, Divider, Paper, Typography } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig'

function parseTxIdParam(raw) {
  return String(raw || '').trim()
}

function safeNumber(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function formatDateMaybe(ts) {
  try {
    if (!ts) return ''
    // Firestore Timestamp support
    if (typeof ts?.toDate === 'function') return ts.toDate().toLocaleString()
    const d = ts instanceof Date ? ts : new Date(ts)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString()
  } catch {
    return ''
  }
}

function aggregateItems(items) {
  const arr = Array.isArray(items) ? items : []
  const map = new Map()

  for (const it of arr) {
    if (!it || typeof it !== 'object') continue

    const sku = it.sku ?? it.RFID_tag_UID ?? it.uid ?? ''
    const name = it.name ?? it.productName ?? (sku ? String(sku) : 'Item')
    const unitPrice = safeNumber(it.price, 0)
    const qty = Math.max(1, Math.floor(safeNumber(it.quantity ?? it.qty ?? it.count, 1)))
    const key = String(it.productId ?? it.productID ?? it.id ?? sku ?? name ?? 'unknown')

    const prev = map.get(key)
    if (!prev) {
      map.set(key, {
        key,
        name: String(name),
        sku: sku ? String(sku) : '',
        unitPrice,
        quantity: qty,
      })
    } else {
      prev.quantity += qty
      if (!prev.sku && sku) prev.sku = String(sku)
      if (!prev.unitPrice && unitPrice) prev.unitPrice = unitPrice
      if (!prev.name && name) prev.name = String(name)
    }
  }

  return Array.from(map.values()).map((r) => ({
    ...r,
    subtotal: safeNumber(r.unitPrice, 0) * safeNumber(r.quantity, 0),
  }))
}

export default function PublicReceipt() {
  const params = useParams()
  const token = parseTxIdParam(params.token)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tx, setTx] = useState(null)

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setTx(null)
        setError('Receipt link is invalid.')
        return
      }

      setLoading(true)
      setError('')
      try {
        const snap = await getDoc(doc(db, 'public_receipts', token))
        if (!snap.exists()) {
          setTx(null)
          setError('Receipt not found.')
          return
        }
        setTx({ id: snap.id, ...snap.data() })
      } catch (e) {
        console.error('Load receipt failed', e)
        setTx(null)
        setError(e?.message || 'Failed to load receipt.')
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [token])

  const rows = useMemo(() => aggregateItems(tx?.items), [tx])

  const displayedTotal = useMemo(() => {
    const t = safeNumber(tx?.totalAmount ?? tx?.total_amount ?? tx?.amount, NaN)
    if (Number.isFinite(t)) return t
    return rows.reduce((s, r) => s + safeNumber(r.subtotal, 0), 0)
  }, [tx, rows])

  const stationLabel = String(tx?.stationId ?? tx?.station_id ?? '')
  const whenLabel = formatDateMaybe(tx?.createdAt ?? tx?.timestamp ?? tx?.created_at)
  const paymentLabel = String(tx?.paymentStatus ?? tx?.payment_status ?? 'Paid')

  return (
    <Box sx={{ p: 2, maxWidth: 720, mx: 'auto' }}>
      <Paper variant="outlined" sx={{ p: 2.25, borderColor: 'divider' }}>
        <Typography variant="overline" sx={{ letterSpacing: 1, color: 'text.secondary' }}>
          RECEIPT
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 950, lineHeight: 1.1 }}>
          RFID Checkout
        </Typography>

        <Divider sx={{ my: 1.75 }} />

        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2">Loading…</Typography>
          </Box>
        ) : null}

        {error ? <Alert severity="error">{error}</Alert> : null}

        {tx && !loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Transaction</Typography>
                <Typography sx={{ fontWeight: 900 }}>{tx.txId || '—'}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Status</Typography>
                <Typography sx={{ fontWeight: 900 }}>{paymentLabel}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Station</Typography>
                <Typography sx={{ fontWeight: 900 }}>{stationLabel || '—'}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Date</Typography>
                <Typography sx={{ fontWeight: 900 }}>{whenLabel || '—'}</Typography>
              </Box>
            </Box>

            <Divider />

            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>Item</Typography>
                <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>Amount</Typography>
              </Box>

              <Paper variant="outlined" sx={{ borderColor: 'divider', overflow: 'hidden' }}>
                {rows.length === 0 ? (
                  <Box sx={{ p: 2 }}>
                    <Typography sx={{ fontWeight: 800 }}>No items</Typography>
                  </Box>
                ) : (
                  rows.map((r, idx) => (
                    <Box
                      key={r.key}
                      sx={{
                        px: 2,
                        py: 1.25,
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 2,
                        borderBottom: idx === rows.length - 1 ? 'none' : '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 900 }} noWrap>
                          {r.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                          {r.sku || '—'}{r.quantity > 1 ? ` • Qty ${r.quantity}` : ''}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontWeight: 900 }}>RM {safeNumber(r.subtotal, 0).toFixed(2)}</Typography>
                    </Box>
                  ))
                )}
              </Paper>
            </Box>

            <Divider />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>Total</Typography>
              <Typography variant="h5" sx={{ fontWeight: 950 }}>RM {safeNumber(displayedTotal, 0).toFixed(2)}</Typography>
            </Box>

            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              This receipt was generated by the kiosk system.
            </Typography>
          </Box>
        ) : null}
      </Paper>
    </Box>
  )
}
