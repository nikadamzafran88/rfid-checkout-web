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
import { doc, getDoc, collection, query, where, orderBy, getDocs, collectionGroup } from 'firebase/firestore'
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

function formatTimestamp(ts) {
  if (!ts) return '—'
  try {
    if (typeof ts?.toDate === 'function') return ts.toDate().toLocaleString('en-MY')
    if (typeof ts === 'object' && typeof ts?.seconds === 'number') return new Date(Math.floor(ts.seconds * 1000)).toLocaleString('en-MY')
    const n = Number(ts)
    if (Number.isFinite(n)) return new Date(n).toLocaleString('en-MY')
    const p = Date.parse(String(ts))
    if (Number.isFinite(p)) return new Date(p).toLocaleString('en-MY')
  } catch {}
  return 'Invalid Date'
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
  const [ledgerEntries, setLedgerEntries] = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(false)

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

  // Load membership ledger entries related to this transaction (if any)
  useEffect(() => {
    let mounted = true
    const loadLedger = async () => {
      setLedgerEntries([])
      setLedgerLoading(true)
      try {
        const membershipId = tx?.membershipId || tx?.membership_id || ''
        if (!membershipId || !tx?.id) {
          if (mounted) setLedgerEntries([])
          return
        }

        let items = []

        if (membershipId) {
          const colRef = collection(db, 'memberships', String(membershipId), 'transactions')
          const q = query(colRef, where('txId', '==', tx.id), orderBy('timestamp', 'asc'))
          const snap = await getDocs(q)
          if (!mounted) return
          items = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
        }

        // If no membershipId present or no entries found, fall back to a collectionGroup query
        // which searches all `memberships/*/transactions` subcollections for this txId.
        if ((items.length === 0)) {
          const cg = collectionGroup(db, 'transactions')
          const q2 = query(cg, where('txId', '==', tx.id), orderBy('timestamp', 'asc'))
          const snap2 = await getDocs(q2)
          if (!mounted) return
          items = snap2.docs.map((d) => {
            const data = d.data() || {}
            // attempt to derive membershipId from the document path: memberships/{membershipId}/transactions/{docId}
            let derivedMembershipId = ''
            try {
              const parent = d.ref.parent // transactions collection
              const membershipDoc = parent.parent
              derivedMembershipId = membershipDoc ? String(membershipDoc.id) : ''
            } catch {}
            return ({ id: d.id, membershipId: derivedMembershipId, ...(data) })
          })
        }

        setLedgerEntries(items)
      } catch (e) {
        console.warn('Failed to load membership ledger entries', e)
        if (mounted) setLedgerEntries([])
      } finally {
        if (mounted) setLedgerLoading(false)
      }
    }
    loadLedger()
    return () => { mounted = false }
  }, [tx])

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
        <>
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
              <Typography variant="subtitle2" color="text.secondary">Subtotal</Typography>
              <Typography sx={{ fontWeight: 700 }}>RM{safeNumber(tx?.subtotalAmount ?? tx?.subtotal_amount ?? totalFromItems, 0).toFixed(2)}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Discount</Typography>
              <Typography sx={{ fontWeight: 700 }}>RM{safeNumber(tx?.discountAmount ?? tx?.discount_amount ?? 0, 0).toFixed(2)}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Total Paid</Typography>
              <Typography sx={{ fontWeight: 700 }}>RM{safeNumber(displayedTotal, 0).toFixed(2)}</Typography>
            </Box>
          </Box>

          <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Promo Code</Typography>
              <Typography sx={{ fontWeight: 600 }}>{tx.promoCode || tx.promo_code || '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Promo Discount</Typography>
              <Typography sx={{ fontWeight: 600 }}>RM{safeNumber(tx?.promoDiscount ?? tx?.promo_discount ?? 0, 0).toFixed(2)}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Redeemed Points</Typography>
              <Typography sx={{ fontWeight: 600 }}>{safeNumber(tx?.redeemedPoints ?? 0, 0)} pts</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Redeemed Amount</Typography>
              <Typography sx={{ fontWeight: 600 }}>RM{safeNumber(tx?.redeemedAmount ?? tx?.redeemed_amount ?? 0, 0).toFixed(2)}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Membership</Typography>
              <Typography sx={{ fontWeight: 600 }}>{tx.membershipId || tx.membership_id || '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">Receipt Token</Typography>
              <Typography sx={{ fontWeight: 600 }}>{tx.receiptToken || tx.receipt_token || '—'}</Typography>
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

        <SectionCard title="Membership Ledger" sx={{ mt: 2 }}>
          {ledgerLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={18} />
              <Typography variant="body2">Loading membership ledger…</Typography>
            </Box>
          ) : ledgerEntries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No membership ledger entries for this transaction.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Points Δ</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Amount (RM)</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Reason</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Timestamp</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ledgerEntries.map((le) => (
                  <TableRow key={le.id}>
                    <TableCell>{String(le.type || le.reason || '—')}</TableCell>
                    <TableCell>{Number(le.pointsDelta || 0)}</TableCell>
                    <TableCell>RM{Number(le.amount || 0).toFixed(2)}</TableCell>
                    <TableCell>{String(le.reason || le.source || '—')}</TableCell>
                    <TableCell>{formatTimestamp(le.timestamp)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
        </>
      )}
    </Box>
  )
}
