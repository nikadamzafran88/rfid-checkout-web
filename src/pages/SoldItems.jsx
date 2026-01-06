import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../firebaseConfig'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'

function safeNumber(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function isPaidTx(tx) {
  const status = String(tx?.paymentStatus ?? tx?.payment_status ?? tx?.status ?? '').toLowerCase()
  if (!status) return true
  if (status.includes('fail') || status.includes('failed') || status.includes('cancel') || status.includes('cancelled') || status.includes('unpaid')) return false
  if (status.includes('paid') || status.includes('success') || status.includes('completed')) return true
  return true
}

function getItemQuantity(it) {
  const q = safeNumber(it?.quantity ?? it?.qty ?? it?.count, 1)
  return Math.max(1, Math.floor(q))
}

function getItemProductId(it) {
  const productId = it?.productId ?? it?.productID ?? it?.id ?? ''
  return String(productId || '').trim()
}

function isUnknownProductId(productId) {
  return productId.startsWith('unknown_')
}

function aggregateSoldItems(transactions) {
  const map = new Map()

  for (const tx of transactions) {
    if (!isPaidTx(tx)) continue

    const items = Array.isArray(tx?.items) ? tx.items : []
    for (const it of items) {
      if (!it || typeof it !== 'object') continue

      const productId = getItemProductId(it)
      if (!productId || isUnknownProductId(productId)) continue

      const sku = String(it.sku ?? '').trim()
      const name = String(it.name ?? it.productName ?? '').trim()
      const qty = getItemQuantity(it)

      const key = productId
      const prev = map.get(key)
      if (!prev) {
        map.set(key, {
          productId,
          sku,
          name: name || sku || productId,
          soldQty: qty,
        })
      } else {
        prev.soldQty += qty
        if (!prev.sku && sku) prev.sku = sku
        if (!prev.name && name) prev.name = name
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => (b.soldQty || 0) - (a.soldQty || 0))
}

export default function SoldItems() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [transactions, setTransactions] = useState([])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const snap = await getDocs(collection(db, 'transactions'))
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        setTransactions(list)
      } catch (e) {
        console.error('Failed to load transactions', e)
        setError(e?.message || 'Failed to load transactions.')
        setTransactions([])
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [])

  const rows = useMemo(() => aggregateSoldItems(transactions), [transactions])

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title="Sold Items" subtitle="Inventory items sold across paid transactions." />

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Loading…</Typography>
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {!loading && !error && (
        <SectionCard title={`Summary (${rows.length})`}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Product</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>SKU</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Product ID</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Sold Qty</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body2" color="text.secondary">No sold items found.</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.productId} hover>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{r.name}</Typography>
                    </TableCell>
                    <TableCell>{r.sku || '—'}</TableCell>
                    <TableCell>{r.productId}</TableCell>
                    <TableCell align="right">{safeNumber(r.soldQty, 0)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </SectionCard>
      )}
    </Box>
  )
}
