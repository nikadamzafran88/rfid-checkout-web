import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Alert, Box, Button, CircularProgress, Divider, Paper, Typography } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig'
import { jsPDF } from 'jspdf'

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
  const navigate = useNavigate()

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

  const invoiceNumber = useMemo(() => {
    const txId = tx?.txId ? String(tx.txId).slice(-8).toUpperCase() : 'N/A'
    return `INV-${txId}`
  }, [tx])

  const stationLabel = String(tx?.stationId ?? tx?.station_id ?? '')
  const whenLabel = formatDateMaybe(tx?.createdAt ?? tx?.timestamp ?? tx?.created_at)

  const downloadPDF = useCallback(() => {
    if (!tx) return
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      let y = 20

      // Header
      doc.setFontSize(20)
      doc.setFont('helvetica', 'bold')
      doc.text('NAZ Retails', 20, y)
      y += 8

      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100)
      doc.text('Self-Checkout Receipt', 20, y)
      y += 12

      // Invoice details box
      doc.setDrawColor(200)
      doc.setFillColor(248, 249, 250)
      doc.roundedRect(20, y, pageWidth - 40, 28, 2, 2, 'F')

      doc.setTextColor(100)
      doc.setFontSize(9)
      doc.text('Invoice Number', 25, y + 6)
      doc.text('Date & Time', 25, y + 18)
      doc.text('Station', pageWidth / 2 + 10, y + 6)
      doc.text('Transaction ID', pageWidth / 2 + 10, y + 18)

      doc.setTextColor(0)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.text(invoiceNumber, 25, y + 11)
      doc.text(whenLabel || '—', 25, y + 23)
      doc.text(stationLabel || '—', pageWidth / 2 + 10, y + 11)
      doc.text(tx?.txId ? String(tx.txId).slice(0, 20) : '—', pageWidth / 2 + 10, y + 23)

      y += 36

      // Items table header
      doc.setFillColor(33, 37, 41)
      doc.rect(20, y, pageWidth - 40, 8, 'F')
      doc.setTextColor(255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text('No.', 25, y + 5.5)
      doc.text('Item Description', 35, y + 5.5)
      doc.text('SKU/UID', pageWidth - 70, y + 5.5)
      doc.text('Amount', pageWidth - 35, y + 5.5, { align: 'right' })
      y += 8

      // Items
      doc.setTextColor(0)
      doc.setFont('helvetica', 'normal')
      if (rows.length === 0) {
        y += 6
        doc.setTextColor(100)
        doc.text('No items', 25, y)
        y += 6
      } else {
        rows.forEach((r, idx) => {
          const rowY = y + 6
          const isEven = idx % 2 === 0
          if (isEven) {
            doc.setFillColor(248, 249, 250)
            doc.rect(20, y, pageWidth - 40, 10, 'F')
          }

          doc.setTextColor(0)
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(9)
          doc.text(String(idx + 1), 25, rowY)
          doc.setFont('helvetica', 'bold')
          doc.text(String(r.name || 'Item').slice(0, 40), 35, rowY)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(100)
          doc.text(String(r.sku || '—').slice(0, 18), pageWidth - 70, rowY)
          doc.setTextColor(0)
          const itemTotal = safeNumber(r.subtotal, 0)
          doc.text(`RM ${itemTotal.toFixed(2)}`, pageWidth - 35, rowY, { align: 'right' })
          y += 10
        })
      }

      // Subtotal line
      y += 4
      doc.setDrawColor(200)
      doc.line(20, y, pageWidth - 20, y)
      y += 8

      // Total
      doc.setFontSize(10)
      doc.setTextColor(100)
      doc.text('Total', pageWidth - 70, y)
      doc.setTextColor(0)
      doc.setFont('helvetica', 'bold')
      doc.text(`RM ${safeNumber(displayedTotal, 0).toFixed(2)}`, pageWidth - 35, y, { align: 'right' })
      y += 10

      doc.setFillColor(33, 150, 83)
      doc.roundedRect(pageWidth - 80, y - 2, 60, 12, 2, 2, 'F')
      doc.setTextColor(255)
      doc.setFontSize(11)
      doc.text('PAID', pageWidth - 50, y + 6, { align: 'center' })

      y += 20

      // Footer
      doc.setTextColor(100)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text('Thank you for shopping with us!', pageWidth / 2, y, { align: 'center' })
      y += 5
      doc.text('This is a computer-generated receipt. No signature required.', pageWidth / 2, y, { align: 'center' })

      // Save PDF
      doc.save(`${invoiceNumber}.pdf`)
    } catch (err) {
      console.error('PDF generation failed', err)
    }
  }, [tx, rows, displayedTotal, invoiceNumber, stationLabel, whenLabel])

  const paymentLabel = String(tx?.paymentStatus ?? tx?.payment_status ?? 'Paid')

  // Auto-download PDF when receipt loads
  useEffect(() => {
    if (tx && !loading && !error) {
      // Small delay to ensure page renders first
      const timer = setTimeout(() => {
        downloadPDF()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [tx, loading, error, downloadPDF])

  // Auto-return to home after 25 seconds when viewing a public invoice
  useEffect(() => {
    if (tx && !loading && !error) {
      const t = setTimeout(() => {
        try { navigate('/', { replace: true }) } catch (e) { /* ignore */ }
      }, 25 * 1000)
      return () => clearTimeout(t)
    }
    return undefined
  }, [tx, loading, error, navigate])

  return (
    <Box sx={{ p: 2, maxWidth: 720, mx: 'auto' }}>
      <Paper variant="outlined" sx={{ p: 0, borderColor: 'divider', overflow: 'hidden', maxWidth: 480, mx: 'auto' }}>
        {/* Dark header */}
        <Box sx={{ bgcolor: 'grey.900', color: 'common.white', py: 2, px: 3, textAlign: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 950, letterSpacing: 1 }}>NAZ Retails</Typography>
          <Typography variant="caption" sx={{ color: 'grey.300', letterSpacing: 1 }}>Self-Checkout Receipt</Typography>
        </Box>
        <Box sx={{ p: 2.5 }}>
          {loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2">Loading…</Typography>
            </Box>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {tx && !loading ? (
            <>
              {/* Info bar */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5, gap: 2, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Transaction</Typography>
                  <Typography sx={{ fontWeight: 900 }}>{tx.txId || '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Date</Typography>
                  <Typography sx={{ fontWeight: 900 }}>{whenLabel || '—'}</Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5, gap: 2, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Station</Typography>
                  <Typography sx={{ fontWeight: 900 }}>{stationLabel || '—'}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Status</Typography>
                  <Typography sx={{ fontWeight: 900 }}>{paymentLabel}</Typography>
                </Box>
              </Box>
              {/* Table header */}
              <Box sx={{ display: 'flex', bgcolor: 'grey.100', borderRadius: 1, px: 1.5, py: 0.75, fontWeight: 700, mb: 0.5 }}>
                <Box sx={{ width: 32 }}>No.</Box>
                <Box sx={{ flex: 2 }}>Item</Box>
                <Box sx={{ flex: 1 }}>SKU</Box>
                <Box sx={{ width: 48, textAlign: 'right' }}>Qty</Box>
                <Box sx={{ width: 80, textAlign: 'right' }}>Amount</Box>
              </Box>
              <Divider sx={{ mb: 0.5 }} />
              {/* Items */}
              {rows.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography sx={{ fontWeight: 800 }}>No items</Typography>
                </Box>
              ) : (
                rows.map((r, idx) => (
                  <Box
                    key={r.key}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      px: 1.5,
                      py: 0.75,
                      bgcolor: idx % 2 === 0 ? 'grey.50' : 'background.paper',
                      borderBottom: idx === rows.length - 1 ? 'none' : '1px solid',
                      borderColor: 'divider',
                      fontSize: 15,
                    }}
                  >
                    <Box sx={{ width: 32 }}>{idx + 1}</Box>
                    <Box sx={{ flex: 2, fontWeight: 700 }}>{r.name}</Box>
                    <Box sx={{ flex: 1, color: 'text.secondary', fontSize: 13 }}>{r.sku || '—'}</Box>
                    <Box sx={{ width: 48, textAlign: 'right' }}>{r.quantity}</Box>
                    <Box sx={{ width: 80, textAlign: 'right', fontWeight: 700 }}>RM {safeNumber(r.subtotal, 0).toFixed(2)}</Box>
                  </Box>
                ))
              )}
              <Divider sx={{ my: 1.5 }} />
              {/* Total and PAID badge */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 950 }}>Total</Typography>
                <Typography variant="h6" sx={{ fontWeight: 950 }}>RM {safeNumber(displayedTotal, 0).toFixed(2)}</Typography>
                <Box sx={{ ml: 2, bgcolor: 'success.main', color: 'common.white', px: 2, py: 0.5, borderRadius: 2, fontWeight: 900, fontSize: 16 }}>
                  PAID
                </Box>
              </Box>
              <Divider sx={{ mb: 1.5 }} />
              <Button 
                variant="contained" 
                fullWidth 
                onClick={downloadPDF}
                sx={{ mt: 1 }}
              >
                Download PDF Receipt
              </Button>
              <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center', display: 'block', mt: 2 }}>
                This receipt was generated by the kiosk system.
              </Typography>
            </>
          ) : null}
        </Box>
      </Paper>
    </Box>
  )
}
