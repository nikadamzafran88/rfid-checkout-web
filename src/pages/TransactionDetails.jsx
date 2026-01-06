import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'

function parseTxIdParam(raw) {
  const v = String(raw || '').trim()
  return v
}

function safeNumber(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function aggregateItems(items) {
  const arr = Array.isArray(items) ? items : []
  const map = new Map()

  for (const it of arr) {
    if (!it || typeof it !== 'object') continue

    const productId = it.productId ?? it.productID ?? it.id ?? ''
    const sku = it.sku ?? ''
    const name = it.name ?? it.productName ?? ''
    const price = safeNumber(it.price, 0)
    const rfid = it.RFID_tag_UID ?? it.rfid ?? ''

    const key = String(productId || sku || name || 'unknown')
    const qty = Math.max(1, Math.floor(safeNumber(it.quantity ?? it.qty ?? it.count, 1)))

    const prev = map.get(key)
    if (!prev) {
      map.set(key, {
        key,
        productId: productId ? String(productId) : '',
        sku: sku ? String(sku) : '',
        name: name ? String(name) : (sku ? String(sku) : String(productId || 'Unknown')),
        rfid: rfid ? String(rfid) : '',
        unitPrice: price,
        quantity: qty,
      })
    } else {
      prev.quantity += qty
      // Prefer first non-empty identifiers
      if (!prev.productId && productId) prev.productId = String(productId)
      if (!prev.sku && sku) prev.sku = String(sku)
      if (!prev.rfid && rfid) prev.rfid = String(rfid)
      if (!prev.name && name) prev.name = String(name)
      // Keep the first unit price unless the previous was 0
      if (!prev.unitPrice && price) prev.unitPrice = price
    }
  }

  return Array.from(map.values()).map((r) => ({
    ...r,
    subtotal: safeNumber(r.unitPrice, 0) * safeNumber(r.quantity, 0),
  }))
}

export default function TransactionDetails() {
  const params = useParams()
  const navigate = useNavigate()

  const initialTxId = parseTxIdParam(params.txId)
  const [txIdInput, setTxIdInput] = useState(initialTxId)
  const [txId, setTxId] = useState(initialTxId)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tx, setTx] = useState(null)

  useEffect(() => {
    setTxId(parseTxIdParam(params.txId))
    setTxIdInput(parseTxIdParam(params.txId))
  }, [params.txId])

  useEffect(() => {
    const run = async () => {
      if (!txId) {
        setTx(null)
        setError('')
        return
      }

      setLoading(true)
      setError('')
      try {
        const snap = await getDoc(doc(db, 'transactions', txId))
        if (!snap.exists()) {
          setTx(null)
          setError('Transaction not found.')
          return
        }
        setTx({ id: snap.id, ...snap.data() })
      } catch (e) {
        console.error('Load transaction failed', e)
        setTx(null)
        setError(e?.message || 'Failed to load transaction.')
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [txId])

  const rows = useMemo(() => aggregateItems(tx?.items), [tx])
  const totalFromItems = useMemo(() => rows.reduce((s, r) => s + safeNumber(r.subtotal, 0), 0), [rows])

  const displayedTotal = useMemo(() => {
    const t = safeNumber(tx?.totalAmount ?? tx?.total_amount, NaN)
    return Number.isFinite(t) ? t : totalFromItems
  }, [tx, totalFromItems])

  const goSearch = () => {
    const next = parseTxIdParam(txIdInput)
    setTxId(next)
    if (next) navigate(`/admin/transactions/${encodeURIComponent(next)}`)
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader
        title="Transaction Items"
        subtitle="View what items were purchased for a transaction."
        actions={<Button variant="outlined" onClick={() => navigate('/admin/transactions')}>Back to Transactions</Button>}
      />

      <SectionCard title="Find Transaction">
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            label="Transaction ID"
            size="small"
            value={txIdInput}
            onChange={(e) => setTxIdInput(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 360 } }}
          />
          <Button variant="contained" onClick={goSearch} disabled={!parseTxIdParam(txIdInput) || loading}>Search</Button>
        </Box>
      </SectionCard>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Loading…</Typography>
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {tx && !loading && (
        <SectionCard title="Summary">
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Transaction ID</Typography>
              <Typography sx={{ fontWeight: 600 }}>{tx.id}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Station</Typography>
              <Typography sx={{ fontWeight: 600 }}>{tx.stationId || tx.station_id || 'N/A'}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Payment</Typography>
              <Typography sx={{ fontWeight: 600 }}>{tx.paymentStatus || 'N/A'}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Total</Typography>
              <Typography sx={{ fontWeight: 700 }}>RM{safeNumber(displayedTotal, 0).toFixed(2)}</Typography>
            </Box>
          </Box>

          <Box sx={{ mt: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Product</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>SKU</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>RFID</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Unit Price (RM)</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Qty</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Subtotal (RM)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary">No items found in this transaction.</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }}>{r.name}</Typography>
                        {r.productId && (
                          <Typography variant="caption" color="text.secondary">Product ID: {r.productId}</Typography>
                        )}
                      </TableCell>
                      <TableCell>{r.sku || '—'}</TableCell>
                      <TableCell>{r.rfid || '—'}</TableCell>
                      <TableCell align="right">{safeNumber(r.unitPrice, 0).toFixed(2)}</TableCell>
                      <TableCell align="right">{safeNumber(r.quantity, 0)}</TableCell>
                      <TableCell align="right">{safeNumber(r.subtotal, 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))
                )}

                {rows.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="right" sx={{ fontWeight: 700 }}>Total</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>RM{safeNumber(totalFromItems, 0).toFixed(2)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </SectionCard>
      )}
    </Box>
  )
}
